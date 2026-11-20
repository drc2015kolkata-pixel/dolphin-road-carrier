import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import { CompanySettings, ConsignmentNote, Invoice } from '../types/erp';
import { formatDateDDMMYYYY, formatINR, todayISO } from '../lib/formatters';
import { FoxproStatementSpec } from '../lib/pdfBuilders';
import { generateFoxproStatementPDF, GeneratedPdfResult } from '../lib/pdfEngine';

interface GstFilingHubModuleProps {
  invoices: Invoice[];
  consignments: ConsignmentNote[];
  company: CompanySettings;
  activeFy: string;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'Reports_Ledgers') => void;
}

type GstSubTab = 'gstr1' | 'gstr3b' | 'cdnr';

export const GstFilingHubModule: React.FC<GstFilingHubModuleProps> = ({
  invoices,
  consignments,
  company,
  activeFy,
  onPreviewPdf,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedDivision, setSelectedDivision] = useState<'ALL' | 'FTL' | 'LOGISTICS'>('ALL');
  const [subTab, setSubTab] = useState<GstSubTab>('gstr1');
  const [exportStatus, setExportStatus] = useState('');

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((inv) => {
      if (inv.invoiceDate && inv.invoiceDate.length >= 7) {
        set.add(inv.invoiceDate.slice(0, 7));
      }
    });
    consignments.forEach((cn) => {
      if (cn.cnDate && cn.cnDate.length >= 7) {
        set.add(cn.cnDate.slice(0, 7));
      }
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [invoices, consignments]);

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (selectedMonth !== 'ALL' && !(inv.invoiceDate || '').startsWith(selectedMonth)) {
          return false;
        }
        const div = (inv.division || 'FTL').toUpperCase();
        if (selectedDivision !== 'ALL' && div !== selectedDivision) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.invoiceDate || '').localeCompare(b.invoiceDate || ''));
  }, [invoices, selectedMonth, selectedDivision]);

  const summary = useMemo(() => {
    let fcmTaxable = 0;
    let fcmCgst = 0;
    let fcmSgst = 0;
    let fcmIgst = 0;
    let fcmTotalTax = 0;
    let rcmTaxable = 0;
    let rcmNotionalTax5 = 0;
    let exportExemptTotal = 0;
    let grandTotal = 0;

    filteredInvoices.forEach((inv) => {
      const taxable =
        Number(inv.freightCharges || 0) +
        Number(inv.detentionCharges || 0) +
        Number(inv.unloadingCharges || 0) +
        Number(inv.stCharges || 0) ||
        Math.max(0, Number(inv.grandTotal || 0) - Number(inv.totalTax || 0));
      const cgst = Number(inv.cgstAmt || 0);
      const sgst = Number(inv.sgstAmt || 0);
      const igst = Number(inv.igstAmt || 0);
      const totTax = Number(inv.totalTax || 0);
      const isExport = /^(Nepal|Bangladesh|Bhutan)$/i.test(String(inv.billingCountry || 'India'));
      const isRcm =
        Boolean(inv.reverseCharge) ||
        (totTax === 0 && !isExport && (inv.gstPaidBy === 'Consignee' || inv.gstPaidBy === 'Consignor'));

      grandTotal += Number(inv.grandTotal || 0);
      if (isExport) {
        exportExemptTotal += taxable;
      } else if (isRcm) {
        rcmTaxable += taxable;
        rcmNotionalTax5 += Math.round(taxable * 0.05 * 100) / 100;
      } else {
        fcmTaxable += taxable;
        fcmCgst += cgst;
        fcmSgst += sgst;
        fcmIgst += igst;
        fcmTotalTax += totTax;
      }
    });

    const filteredCns = consignments.filter((cn) => {
      if (selectedMonth !== 'ALL' && !(cn.cnDate || '').startsWith(selectedMonth)) return false;
      const div = (cn.division || 'FTL').toUpperCase();
      if (selectedDivision !== 'ALL' && div !== selectedDivision) return false;
      return true;
    });

    return {
      invoiceCount: filteredInvoices.length,
      cnCount: filteredCns.length,
      fcmTaxable,
      fcmCgst,
      fcmSgst,
      fcmIgst,
      fcmTotalTax,
      rcmTaxable,
      rcmNotionalTax5,
      exportExemptTotal,
      grandTotal,
    };
  }, [filteredInvoices, consignments, selectedMonth, selectedDivision]);

  const handleExportGstrJson = () => {
    const returnPeriod =
      selectedMonth !== 'ALL'
        ? `${selectedMonth.slice(5, 7)}${selectedMonth.slice(0, 4)}`
        : `FY_${activeFy.replace(/[^0-9]/g, '')}`;

    const payload = {
      gstin: company.gstin || '19DOTPS3540M1ZZ',
      fp: returnPeriod,
      division: selectedDivision,
      version: 'GST3.1',
      b2b: filteredInvoices
        .filter((inv) => Boolean(inv.partyGstin) && !/^(Nepal|Bangladesh|Bhutan)$/i.test(inv.billingCountry || 'India'))
        .map((inv) => {
          const taxable =
            Math.max(0, Number(inv.grandTotal || 0) - Number(inv.totalTax || 0));
          return {
            ctin: inv.partyGstin,
            inum: inv.invoiceNo,
            idt: formatDateDDMMYYYY(inv.invoiceDate),
            val: Number(inv.grandTotal || 0),
            rchrg: inv.reverseCharge ? 'Y' : 'N',
            inv_typ: 'R',
            division: inv.division || 'FTL',
            itms: [
              {
                num: 1,
                itm_det: {
                  rt: Number(inv.gstRate ?? 5),
                  txval: taxable,
                  iamt: Number(inv.igstAmt || 0),
                  camt: Number(inv.cgstAmt || 0),
                  samt: Number(inv.sgstAmt || 0),
                },
              },
            ],
          };
        }),
      exp: filteredInvoices
        .filter((inv) => /^(Nepal|Bangladesh|Bhutan)$/i.test(inv.billingCountry || 'India'))
        .map((inv) => ({
          inum: inv.invoiceNo,
          idt: formatDateDDMMYYYY(inv.invoiceDate),
          val: Number(inv.grandTotal || 0),
          country: inv.billingCountry,
        })),
      gstr3b_summary: {
        outward_fcm_taxable: summary.fcmTaxable,
        outward_fcm_igst: summary.fcmIgst,
        outward_fcm_cgst: summary.fcmCgst,
        outward_fcm_sgst: summary.fcmSgst,
        gta_rcm_5pct_taxable: summary.rcmTaxable,
        gta_rcm_5pct_tax_recipient_liability: summary.rcmNotionalTax5,
        export_zero_rated: summary.exportExemptTotal,
      },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST_GSTR1_3B_${company.gstin || 'DRC'}_${returnPeriod}_${selectedDivision}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setExportStatus(`Exported GST Portal JSON (${filteredInvoices.length} invoices).`);
  };

  const handleExportGstrExcel = () => {
    const wb = XLSX.utils.book_new();
    const gstr1Rows = filteredInvoices.map((inv, idx) => {
      const taxable = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.totalTax || 0));
      return {
        'S.No': idx + 1,
        Division: inv.division || 'FTL',
        'Invoice No': inv.invoiceNo,
        'Invoice Date': formatDateDDMMYYYY(inv.invoiceDate),
        'Party Name': inv.partyName,
        GSTIN: inv.partyGstin || '-',
        Country: inv.billingCountry || 'India',
        SAC: inv.sac || company.hsn || '996791',
        'GST Paid By': inv.gstPaidBy || (inv.reverseCharge ? 'Consignee' : 'Transporter'),
        'RCM Applicable': inv.reverseCharge ? 'YES' : 'NO',
        'Taxable Value': taxable,
        'CGST (Rs)': Number(inv.cgstAmt || 0),
        'SGST (Rs)': Number(inv.sgstAmt || 0),
        'IGST (Rs)': Number(inv.igstAmt || 0),
        'Total Tax': Number(inv.totalTax || 0),
        'Invoice Value': Number(inv.grandTotal || 0),
        Status: inv.status,
      };
    });
    const gstr3bRows = [
      {
        Section: '3.1(a) Outward Taxable Supplies (Forward Charge)',
        Taxable: summary.fcmTaxable,
        IGST: summary.fcmIgst,
        CGST: summary.fcmCgst,
        SGST: summary.fcmSgst,
        TotalTax: summary.fcmTotalTax,
      },
      {
        Section: '3.1(d) GTA Reverse Charge Supplies (RCM 5% by Recipient)',
        Taxable: summary.rcmTaxable,
        IGST: 0,
        CGST: Math.round((summary.rcmNotionalTax5 / 2) * 100) / 100,
        SGST: Math.round((summary.rcmNotionalTax5 / 2) * 100) / 100,
        TotalTax: summary.rcmNotionalTax5,
      },
      {
        Section: '3.1(b) Zero-Rated Export Supplies (Nepal / Bangladesh / Bhutan)',
        Taxable: summary.exportExemptTotal,
        IGST: 0,
        CGST: 0,
        SGST: 0,
        TotalTax: 0,
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gstr1Rows), 'GSTR1_B2B_Export');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gstr3bRows), 'GSTR3B_Summary');
    XLSX.writeFile(wb, `DRC_GST_Filing_${selectedMonth}_${selectedDivision}_${todayISO()}.xlsx`);
    setExportStatus(`Exported GSTR-1 & GSTR-3B Excel workbook (${filteredInvoices.length} rows).`);
  };

  const handlePrintGstHubPdf = async () => {
    const spec: FoxproStatementSpec = {
      title: 'G-S-T   &   R-C-M   F-I-L-I-N-G   H-U-B   R-E-P-O-R-T',
      subtitle: `FY: ${activeFy} · Month: ${selectedMonth} · Division: ${selectedDivision} · GSTIN: ${company.gstin}`,
      fileName: `GST_RCM_Filing_${selectedMonth}_${selectedDivision}.pdf`,
      orientation: 'l',
      summaryLines: [
        { label: 'FCM Taxable', value: `Rs. ${formatINR(summary.fcmTaxable)}` },
        { label: 'FCM Tax Collected', value: `Rs. ${formatINR(summary.fcmTotalTax)}` },
        { label: 'RCM 5% GTA Value', value: `Rs. ${formatINR(summary.rcmTaxable)}` },
        { label: 'RCM 5% Liability', value: `Rs. ${formatINR(summary.rcmNotionalTax5)}` },
      ],
      columns: [
        { label: 'INV NO / DATE', widthPct: 16, align: 'left' },
        { label: 'PARTY NAME / GSTIN', widthPct: 30, align: 'left' },
        { label: 'DIV / RCM / PAID BY', widthPct: 18, align: 'left' },
        { label: 'TAXABLE VALUE', widthPct: 12, align: 'right' },
        { label: 'CGST + SGST + IGST', widthPct: 12, align: 'right' },
        { label: 'INVOICE TOTAL', widthPct: 12, align: 'right' },
      ],
      rows: filteredInvoices.map((inv) => {
        const taxable = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.totalTax || 0));
        return {
          line1: [
            inv.invoiceNo,
            inv.partyName,
            `${inv.division || 'FTL'} · ${inv.reverseCharge ? 'RCM Y' : 'FCM'}`,
            formatINR(taxable),
            formatINR(inv.totalTax || 0),
            formatINR(inv.grandTotal),
          ],
          line2: [
            formatDateDDMMYYYY(inv.invoiceDate),
            inv.partyGstin || inv.billingCountry || 'URP',
            inv.gstPaidBy || '-',
            `SAC ${inv.sac || company.hsn || '996791'}`,
            `C:${formatINR(inv.cgstAmt || 0)} S:${formatINR(inv.sgstAmt || 0)}`,
            inv.status,
          ],
        };
      }),
      totalsLabel: 'TOTAL INVOICE VALUE :',
      totalsLine1: [
        '',
        '',
        '',
        formatINR(summary.fcmTaxable + summary.rcmTaxable + summary.exportExemptTotal),
        formatINR(summary.fcmTotalTax),
        formatINR(summary.grandTotal),
      ],
      totalAmountForWords: summary.grandTotal,
    };
    const pdf = await generateFoxproStatementPDF(spec, company, 'l');
    onPreviewPdf(pdf, 'Reports_Ledgers');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              GST &amp; RCM Report &amp; Online Filing Hub (GSTR-1 / GSTR-3B / CDNR / PMT-06)
            </h3>
            <p className="text-xs text-slate-500">
              Filter by Month &amp; FTL / LOGISTICS Division · One-click GST Portal JSON, Excel &amp; Challan PMT-06 payment links
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://services.gst.gov.in/services/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-extrabold"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              GST Portal Login
            </a>
            <a
              href="https://payment.gst.gov.in/payment/auth/createChallan"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Challan PMT-06 Pay
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-slate-50"
          >
            <option value="ALL">All Months ({activeFy})</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                Month: {m}
              </option>
            ))}
          </select>

          <select
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value as 'ALL' | 'FTL' | 'LOGISTICS')}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold bg-slate-50"
          >
            <option value="ALL">All Divisions (FTL + LOGISTICS)</option>
            <option value="FTL">FTL Division Only</option>
            <option value="LOGISTICS">LOGISTICS Division Only</option>
          </select>

          <button
            type="button"
            onClick={handleExportGstrJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            Export GST Portal JSON
          </button>
          <button
            type="button"
            onClick={handleExportGstrExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export GSTR Excel
          </button>
          <button
            type="button"
            onClick={() => void handlePrintGstHubPdf()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            A4 PDF Print
          </button>
        </div>

        {exportStatus && (
          <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            {exportStatus}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Invoices / CNs</div>
          <div className="text-lg font-extrabold text-slate-900 font-mono-num">
            {summary.invoiceCount} / {summary.cnCount}
          </div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3">
          <div className="text-[10px] font-bold uppercase text-blue-700">FCM Taxable Outward</div>
          <div className="text-lg font-extrabold text-blue-900 font-mono-num">₹{formatINR(summary.fcmTaxable)}</div>
        </div>
        <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-3">
          <div className="text-[10px] font-bold uppercase text-indigo-700">Forward Charge GST</div>
          <div className="text-lg font-extrabold text-indigo-900 font-mono-num">₹{formatINR(summary.fcmTotalTax)}</div>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-3">
          <div className="text-[10px] font-bold uppercase text-amber-800">RCM GTA 5% Value</div>
          <div className="text-lg font-extrabold text-amber-900 font-mono-num">₹{formatINR(summary.rcmTaxable)}</div>
          <div className="text-[10px] text-amber-700 font-semibold">Recipient Tax ~ ₹{formatINR(summary.rcmNotionalTax5)}</div>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-3">
          <div className="text-[10px] font-bold uppercase text-emerald-700">Export 0% Exempt</div>
          <div className="text-lg font-extrabold text-emerald-900 font-mono-num">₹{formatINR(summary.exportExemptTotal)}</div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['gstr1', 'GSTR-1 (B2B & Outward Supply)'],
            ['gstr3b', 'GSTR-3B (FCM vs RCM 5% GTA)'],
            ['cdnr', 'CDNR / Export / Exemptions'],
          ] as Array<[GstSubTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-extrabold border cursor-pointer ${
              subTab === id
                ? 'bg-blue-900 text-white border-blue-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'gstr1' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="p-2.5 text-left">Inv No</th>
                <th className="p-2.5 text-left">Date</th>
                <th className="p-2.5 text-left">Division</th>
                <th className="p-2.5 text-left">Party &amp; GSTIN</th>
                <th className="p-2.5 text-left">RCM / Mode</th>
                <th className="p-2.5 text-right">Taxable</th>
                <th className="p-2.5 text-right">CGST</th>
                <th className="p-2.5 text-right">SGST</th>
                <th className="p-2.5 text-right">IGST</th>
                <th className="p-2.5 text-right">Total (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.map((inv) => {
                const taxable = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.totalTax || 0));
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono-num font-bold text-blue-800">{inv.invoiceNo}</td>
                    <td className="p-2.5 font-mono-num">{formatDateDDMMYYYY(inv.invoiceDate)}</td>
                    <td className="p-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">
                        {inv.division || 'FTL'}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <div className="font-bold text-slate-900">{inv.partyName}</div>
                      <div className="text-[10px] text-slate-500 font-mono-num">{inv.partyGstin || inv.billingCountry || 'URP'}</div>
                    </td>
                    <td className="p-2.5 text-[11px] font-semibold">
                      {inv.reverseCharge ? 'RCM 5% (Recipient)' : inv.gstPaidBy || 'FCM'}
                    </td>
                    <td className="p-2.5 text-right font-mono-num">{formatINR(taxable)}</td>
                    <td className="p-2.5 text-right font-mono-num">{formatINR(inv.cgstAmt || 0)}</td>
                    <td className="p-2.5 text-right font-mono-num">{formatINR(inv.sgstAmt || 0)}</td>
                    <td className="p-2.5 text-right font-mono-num">{formatINR(inv.igstAmt || 0)}</td>
                    <td className="p-2.5 text-right font-mono-num font-extrabold">{formatINR(inv.grandTotal)}</td>
                  </tr>
                );
              })}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-500">
                    No invoices matched the selected month / division filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'gstr3b' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="p-2.5 text-left">GSTR-3B Table Head</th>
                <th className="p-2.5 text-right">Taxable Value (₹)</th>
                <th className="p-2.5 text-right">IGST (₹)</th>
                <th className="p-2.5 text-right">CGST (₹)</th>
                <th className="p-2.5 text-right">SGST (₹)</th>
                <th className="p-2.5 text-right">Total Tax (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono-num">
              <tr>
                <td className="p-2.5 font-sans font-bold text-slate-900">
                  3.1(a) Outward Taxable Supplies (Forward Charge GTA)
                </td>
                <td className="p-2.5 text-right">{formatINR(summary.fcmTaxable)}</td>
                <td className="p-2.5 text-right">{formatINR(summary.fcmIgst)}</td>
                <td className="p-2.5 text-right">{formatINR(summary.fcmCgst)}</td>
                <td className="p-2.5 text-right">{formatINR(summary.fcmSgst)}</td>
                <td className="p-2.5 text-right font-extrabold">{formatINR(summary.fcmTotalTax)}</td>
              </tr>
              <tr>
                <td className="p-2.5 font-sans font-bold text-amber-900">
                  3.1(d) GTA Reverse Charge (RCM 5% — Payable by Consignor / Consignee u/s 9(3))
                </td>
                <td className="p-2.5 text-right">{formatINR(summary.rcmTaxable)}</td>
                <td className="p-2.5 text-right">0.00</td>
                <td className="p-2.5 text-right">{formatINR(summary.rcmNotionalTax5 / 2)}</td>
                <td className="p-2.5 text-right">{formatINR(summary.rcmNotionalTax5 / 2)}</td>
                <td className="p-2.5 text-right font-bold">{formatINR(summary.rcmNotionalTax5)}</td>
              </tr>
              <tr>
                <td className="p-2.5 font-sans font-bold text-emerald-800">
                  3.1(b) Zero-Rated International Export (Nepal / Bangladesh / Bhutan 0%)
                </td>
                <td className="p-2.5 text-right">{formatINR(summary.exportExemptTotal)}</td>
                <td className="p-2.5 text-right">0.00</td>
                <td className="p-2.5 text-right">0.00</td>
                <td className="p-2.5 text-right">0.00</td>
                <td className="p-2.5 text-right">0.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'cdnr' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 text-xs text-slate-700">
          <div className="font-extrabold text-slate-900">
            CDNR / Export &amp; Unregistered Supply Reconciliation ({filteredInvoices.length} Total Bills)
          </div>
          <p>
            Export Exempt Bills (Nepal / Bangladesh / Bhutan):{' '}
            <strong>
              {filteredInvoices.filter((i) => /^(Nepal|Bangladesh|Bhutan)$/i.test(i.billingCountry || 'India')).length}
            </strong>{' '}
            · Taxable Value <strong>₹{formatINR(summary.exportExemptTotal)}</strong>
          </p>
          <p>
            RCM 5% Consignee/Consignor Bills:{' '}
            <strong>{filteredInvoices.filter((i) => Boolean(i.reverseCharge)).length}</strong> · Value{' '}
            <strong>₹{formatINR(summary.rcmTaxable)}</strong>
          </p>
          <p>
            Pending / Unpaid GST Invoices in filter:{' '}
            <strong>{filteredInvoices.filter((i) => i.status !== 'Paid').length}</strong> · Total Billed{' '}
            <strong>₹{formatINR(summary.grandTotal)}</strong>
          </p>
        </div>
      )}
    </div>
  );
};
