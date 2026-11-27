import React, { useMemo, useState } from 'react';
import {
  FileText,
  IndianRupee,
  Mail,
  MessageSquare,
  Plus,
  Printer,
  Receipt,
  Search,
  Trash2,
} from 'lucide-react';
import {
  CompanySettings,
  LogisticsDivisionCode,
  LogisticsDocket,
  LogisticsDriveFolderName,
  LogisticsInvoice,
  LogisticsInvoiceDocketRow,
  LogisticsLedgerEntry,
  LogisticsParty,
  makeDivisionDocId,
} from '../types/erp';
import { removeDocument, upsertDocument } from '../lib/firestoreStore';
import {
  amountToIndianWords,
  formatDateDDMMYYYY,
  formatINR,
  normalizeFyLabel,
} from '../lib/formatters';
import {
  GeneratedPdfResult,
  generateFoxproStatementPDF,
  generateLogisticsInvoicePDF,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import {
  EntityQuickPreviewCard,
  formatPartyDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import { SearchableSelect } from './SearchableSelect';
import { EditableSearchSelect } from './EditableSearchSelect';
import {
  COMMON_REMARK_PRESETS,
  addDropdownItem,
  deleteDropdownItem,
  editDropdownItem,
  getEffectiveDropdownList,
} from '../lib/dropdownMasterStore';
import { validateIndianGstin } from '../lib/gstinValidator';
import { GstinInputField } from './GstinInputField';
import { playAlertBeep } from '../lib/audioFeedback';

interface LogisticsBillingLedgerPanelProps {
  divisionMode?: LogisticsDivisionCode;
  subView: 'billing' | 'ledgers';
  ownerUid: string;
  activeStaffCode: string;
  activeBranchCode: string;
  activeFy: string;
  dockets: LogisticsDocket[];
  invoices: LogisticsInvoice[];
  ledgers: LogisticsLedgerEntry[];
  parties: LogisticsParty[];
  company: CompanySettings;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: LogisticsDriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

function buildNextDocNo(
  existing: LogisticsInvoice[],
  docType: 'Tax Invoice' | 'Credit Note' | 'Debit Note',
  fy: string,
  divisionMode: LogisticsDivisionCode = 'LOGISTICS'
): string {
  const shortFy = fy.replace(/^FY\s+/i, '');
  const baseTag = divisionMode === 'PTL' ? 'P' : divisionMode === 'COURIER' ? 'C' : 'L';
  const prefix =
    docType === 'Credit Note'
      ? `${baseTag}CN`
      : docType === 'Debit Note'
      ? `${baseTag}DN`
      : `${baseTag}INV`;
  const sameType = existing.filter((i) => i.docType === docType);
  const maxNum = sameType.reduce((max, inv) => {
    const m = String(inv.docNo || '').match(/(\d+)/);
    const n = m ? Number(m[1]) : 0;
    return n > max ? n : max;
  }, 100);
  return `${prefix}/${maxNum + 1}/${shortFy}`;
}

export const LogisticsBillingLedgerPanel: React.FC<LogisticsBillingLedgerPanelProps> = ({
  divisionMode = 'LOGISTICS',
  subView,
  ownerUid,
  activeStaffCode,
  activeBranchCode,
  activeFy,
  dockets,
  invoices,
  ledgers,
  parties,
  company,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const branch = activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode : 'KOL-HQ';

  // ---------------- BILLING (TAX INVOICE / CN / DN) ----------------
  const [docType, setDocType] = useState<'Tax Invoice' | 'Credit Note' | 'Debit Note'>('Tax Invoice');
  const [docNo, setDocNo] = useState(() => buildNextDocNo(invoices, 'Tax Invoice', activeFy, divisionMode));
  const [docDate, setDocDate] = useState(today);
  const [linkedDocNo, setLinkedDocNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [selectedBillPartyId, setSelectedBillPartyId] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyGstin, setPartyGstin] = useState('');
  const [partyPan, setPartyPan] = useState('');
  const [sac, setSac] = useState(company.hsn || '996791');
  const [reverseCharge, setReverseCharge] = useState(true);
  const [interstate, setInterstate] = useState(false);
  const [gstRate, setGstRate] = useState('5');
  const [manualAdjustmentAmt, setManualAdjustmentAmt] = useState('0');
  const [selectedDocketIds, setSelectedDocketIds] = useState<string[]>([]);
  const [remarks, setRemarks] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);

  // ---------------- LEDGER VOUCHER STATE ----------------
  const [voucherNo, setVoucherNo] = useState(() => `LVCH-${101 + ledgers.length}`);
  const [voucherDate, setVoucherDate] = useState(today);
  const [voucherType, setVoucherType] = useState<'Receipt' | 'Payment' | 'COD Cash' | 'Adjustment'>('Receipt');
  const [ledgerParty, setLedgerParty] = useState('');
  const [selectedLedgerPartyId, setSelectedLedgerPartyId] = useState('');
  const [ledgerAmt, setLedgerAmt] = useState('');
  const [tdsAmt, setTdsAmt] = useState('0');
  const [paymentMode, setPaymentMode] = useState('UPI');
  const [upiRefId, setUpiRefId] = useState('');
  const [utrNo, setUtrNo] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [ledgerLinkedDoc, setLedgerLinkedDoc] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [savingVoucher, setSavingVoucher] = useState(false);

  const logisticsBillingParties = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.partyType === 'Customer' ||
          p.partyType === 'Consignor' ||
          p.partyType === 'Consignee'
      ),
    [parties]
  );

  const applySelectedBillingParty = (p: LogisticsParty) => {
    setPartyName(p.name);
    setSelectedBillPartyId(p.id);
    setPartyAddress(p.address || '');
    setPartyGstin(p.gstin || '');
    setPartyPan(p.pan || '');
  };

  const handleSelectParty = (val: string) => {
    setPartyName(val);
    const clean = val.trim().toLowerCase();
    const matches = logisticsBillingParties.filter(
      (x) => x.name.trim().toLowerCase() === clean
    );
    if (matches.length === 1) {
      applySelectedBillingParty(matches[0]);
      return;
    }
    setSelectedBillPartyId('');
  };

  const unbilledDocketsForParty = useMemo(() => {
    const cleanP = partyName.trim().toLowerCase();
    return dockets.filter((d) => {
      if (d.billed) return false;
      if (!cleanP) return true;
      return (
        (d.billingPartyName || '').toLowerCase().includes(cleanP) ||
        d.consignorName.toLowerCase().includes(cleanP) ||
        d.consigneeName.toLowerCase().includes(cleanP)
      );
    });
  }, [dockets, partyName]);

  const billingTotals = useMemo(() => {
    const picked = dockets.filter((d) => selectedDocketIds.includes(d.id));
    const docketSum = picked.reduce((s, d) => s + Number(d.totalAmount || 0), 0);
    const taxableAmount = Math.round((docketSum + (Number(manualAdjustmentAmt) || 0)) * 100) / 100;
    const ratePct = reverseCharge ? 0 : Math.max(0, Number(gstRate) || 0);
    const totalTax = Math.round(((taxableAmount * ratePct) / 100) * 100) / 100;
    const cgstAmt = interstate ? 0 : Math.round((totalTax / 2) * 100) / 100;
    const sgstAmt = interstate ? 0 : Math.round((totalTax - cgstAmt) * 100) / 100;
    const igstAmt = interstate ? totalTax : 0;
    const grandTotal = Math.round((taxableAmount + cgstAmt + sgstAmt + igstAmt) * 100) / 100;
    return { picked, taxableAmount, cgstAmt, sgstAmt, igstAmt, grandTotal };
  }, [dockets, selectedDocketIds, manualAdjustmentAmt, reverseCharge, gstRate, interstate]);

  const handleSaveBillingDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim() || !docNo.trim()) return;
    if (partyGstin.trim()) {
      const gstCheck = validateIndianGstin(partyGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        return;
      }
    }
    setSavingDoc(true);
    try {
      const id = makeDivisionDocId(divisionMode, 'linv');
      const rows: LogisticsInvoiceDocketRow[] =
        billingTotals.picked.length > 0
          ? billingTotals.picked.map((d) => ({
              docketNo: d.docketNo,
              docketDate: d.docketDate,
              originBranch: d.originBranch,
              destBranch: d.destBranch,
              packages: d.packages,
              weightKg: d.chargedWeightKg,
              goodsDesc: d.goodsDesc,
              freightAmt: d.totalAmount,
            }))
          : [
              {
                docketNo: linkedDocNo || docNo,
                docketDate: docDate,
                originBranch: branch,
                destBranch: branch,
                packages: 1,
                weightKg: 0,
                goodsDesc: `${docType} Adjustment`,
                freightAmt: Number(manualAdjustmentAmt) || 0,
              },
            ];

      await upsertDocument(
        'logistics_invoices',
        id,
        {
          docType,
          docNo: docNo.trim().toUpperCase(),
          docDate,
          financialYear: normalizeFyLabel(activeFy),
          linkedDocNo: linkedDocNo.trim(),
          partyName: partyName.trim(),
          partyAddress: partyAddress.trim(),
          partyGstin: partyGstin.trim().toUpperCase(),
          partyPan: partyPan.trim().toUpperCase(),
          sac: sac.trim(),
          reverseCharge,
          interstate,
          gstRate: reverseCharge ? 0 : Number(gstRate) || 0,
          taxableAmount: billingTotals.taxableAmount,
          cgstAmt: billingTotals.cgstAmt,
          sgstAmt: billingTotals.sgstAmt,
          igstAmt: billingTotals.igstAmt,
          grandTotal: billingTotals.grandTotal,
          paidAmount: 0,
          status: 'Unpaid',
          docketRows: rows,
          remarks: remarks.trim(),
          branchCode: branch,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        true
      );

      if (docType === 'Tax Invoice') {
        for (const d of billingTotals.picked) {
          await upsertDocument(
            'logistics_dockets',
            d.id,
            { billed: true, invoiceId: id },
            false
          );
        }
      }
      setSelectedDocketIds([]);
      setManualAdjustmentAmt('0');
      setDocNo(buildNextDocNo(invoices, docType, activeFy, divisionMode));
    } finally {
      setSavingDoc(false);
    }
  };

  // Automatic Detailed Narration
  const autoNarration = useMemo(() => {
    const refParts = [
      upiRefId ? `UPI Ref: ${upiRefId}` : '',
      utrNo ? `UTR: ${utrNo}` : '',
      chequeNo ? `Chq: ${chequeNo}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    const tdsNote = Number(tdsAmt) > 0 ? ` + TDS u/s 194C Rs.${formatINR(Number(tdsAmt))}` : '';
    const refDoc = ledgerLinkedDoc ? ` against ${ledgerLinkedDoc}` : '';
    return `Logistics ${voucherType} (${paymentMode}) from/to ${ledgerParty || 'Party'}${refDoc}${tdsNote}${refParts ? ` [${refParts}]` : ''}`.slice(
      0,
      295
    );
  }, [voucherType, paymentMode, ledgerParty, ledgerLinkedDoc, tdsAmt, upiRefId, utrNo, chequeNo]);

  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(ledgerAmt) || 0;
    if (!ledgerParty.trim() || amt <= 0) return;
    setSavingVoucher(true);
    try {
      const id = makeDivisionDocId(divisionMode, 'lled');
      const tds = Number(tdsAmt) || 0;
      await upsertDocument(
        'logistics_ledgers',
        id,
        {
          voucherNo: voucherNo.trim().toUpperCase(),
          voucherDate,
          financialYear: normalizeFyLabel(activeFy),
          voucherType,
          partyName: ledgerParty.trim(),
          amount: amt,
          tdsAmount: tds,
          paymentMode,
          upiRefId: upiRefId.trim(),
          utrNo: utrNo.trim(),
          chequeNo: chequeNo.trim(),
          linkedDocNo: ledgerLinkedDoc.trim(),
          narration: autoNarration,
          branchCode: branch,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        true
      );

      // Auto-settle matching Logistics Tax Invoice if linked
      if (ledgerLinkedDoc.trim() && (voucherType === 'Receipt' || voucherType === 'COD Cash')) {
        const inv = invoices.find(
          (i) => i.docNo.toLowerCase() === ledgerLinkedDoc.trim().toLowerCase()
        );
        if (inv) {
          const nextPaid = Math.min(inv.grandTotal, Number(inv.paidAmount || 0) + amt + tds);
          const nextStatus = nextPaid >= inv.grandTotal - 0.5 ? 'Paid' : 'Partial';
          await upsertDocument(
            'logistics_invoices',
            inv.id,
            { paidAmount: Math.round(nextPaid * 100) / 100, status: nextStatus },
            false
          );
        }
      }

      setVoucherNo(`LVCH-${102 + ledgers.length}`);
      setLedgerAmt('');
      setTdsAmt('0');
      setUpiRefId('');
      setUtrNo('');
      setChequeNo('');
      setLedgerLinkedDoc('');
    } finally {
      setSavingVoucher(false);
    }
  };

  // KPI metrics for Logistics Ledgers
  const ledgerKpis = useMemo(() => {
    const totalBilled = invoices
      .filter((i) => i.docType === 'Tax Invoice' || i.docType === 'Debit Note')
      .reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const creditNotes = invoices
      .filter((i) => i.docType === 'Credit Note')
      .reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const totalReceived = ledgers
      .filter((l) => l.voucherType === 'Receipt' || l.voucherType === 'COD Cash')
      .reduce((s, l) => s + Number(l.amount || 0), 0);
    const totalTds = ledgers.reduce((s, l) => s + Number(l.tdsAmount || 0), 0);
    return {
      totalBilled: totalBilled - creditNotes,
      totalReceived,
      totalTds,
      netBalance: Math.max(0, totalBilled - creditNotes - totalReceived - totalTds),
    };
  }, [invoices, ledgers]);

  const filteredLedgers = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return ledgers.filter((l) => {
      if (!q) return true;
      return (
        l.voucherNo.toLowerCase().includes(q) ||
        l.partyName.toLowerCase().includes(q) ||
        (l.upiRefId || '').toLowerCase().includes(q) ||
        (l.utrNo || '').toLowerCase().includes(q) ||
        (l.chequeNo || '').toLowerCase().includes(q)
      );
    });
  }, [ledgers, ledgerSearch]);

  const handlePrintLedgerPdf = async () => {
    const pdf = await generateFoxproStatementPDF(
      {
        title: 'EXPRESS LOGISTICS DIVISION — PARTY LEDGER STATEMENT',
        subtitle: `Filter: ${ledgerSearch || 'ALL'} | ${activeFy}`,
        fileName: `Logistics_Party_Ledger_${new Date().toISOString().slice(0, 10)}.pdf`,
        summaryLines: [
          { label: 'Total Billed', value: `Rs. ${formatINR(ledgerKpis.totalBilled)}` },
          { label: 'Total Received', value: `Rs. ${formatINR(ledgerKpis.totalReceived)}` },
          { label: 'TDS Deducted', value: `Rs. ${formatINR(ledgerKpis.totalTds)}` },
          { label: 'Net Receivable', value: `Rs. ${formatINR(ledgerKpis.netBalance)}` },
        ],
        columns: [
          { label: 'VOUCHER / DATE', widthPct: 16 },
          { label: 'PARTY NAME / TYPE', widthPct: 24 },
          { label: 'AUTO NARRATION & BANK REF', widthPct: 36 },
          { label: 'MODE / TDS', widthPct: 12 },
          { label: 'AMOUNT (INR)', widthPct: 12, align: 'right' },
        ],
        rows: filteredLedgers.map((l) => ({
          line1: [
            l.voucherNo,
            l.partyName,
            l.narration,
            l.paymentMode,
            formatINR(l.amount),
          ],
          line2: [
            formatDateDDMMYYYY(l.voucherDate),
            l.voucherType,
            [l.upiRefId && `UPI:${l.upiRefId}`, l.utrNo && `UTR:${l.utrNo}`, l.chequeNo && `Chq:${l.chequeNo}`]
              .filter(Boolean)
              .join(' | '),
            Number(l.tdsAmount || 0) > 0 ? `TDS: ${formatINR(l.tdsAmount || 0)}` : '',
            l.linkedDocNo || '',
          ],
        })),
        totalsLabel: 'LEDGER RECEIPTS :',
        totalsLine1: ['', '', '', '', `Rs.${formatINR(ledgerKpis.totalReceived)}`],
        orientation: 'l',
      },
      company
    );
    onPreviewPdf(pdf, 'Logistics_Ledgers');
  };

  return (
    <div className="space-y-4">
      {subView === 'billing' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <form
            onSubmit={handleSaveBillingDoc}
            className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0F766E] to-[#0D47A1] text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <h3 className="text-xs font-extrabold uppercase">
                  Logistics Tax Invoice / Credit Note / Debit Note
                </h3>
              </div>
            </div>

            <div className="p-3.5 space-y-2.5 text-xs">
              <div className="grid grid-cols-3 gap-1.5">
                {(['Tax Invoice', 'Credit Note', 'Debit Note'] as const).map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => {
                      setDocType(dt);
                      setDocNo(buildNextDocNo(invoices, dt, activeFy));
                    }}
                    className={`py-1.5 rounded-lg font-extrabold cursor-pointer border ${
                      docType === dt
                        ? 'bg-[#0F766E] text-white border-[#0F766E]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {dt}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Document No*</label>
                  <input
                    required
                    value={docNo}
                    onChange={(e) => setDocNo(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Date*</label>
                  <input
                    type="date"
                    required
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">
                    {docType === 'Tax Invoice' ? 'SAC Code' : 'Orig. Invoice No'}
                  </label>
                  {docType === 'Tax Invoice' ? (
                    <input
                      value={sac}
                      onChange={(e) => setSac(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  ) : (
                    <input
                      value={linkedDocNo}
                      onChange={(e) => setLinkedDocNo(e.target.value)}
                      placeholder="LINV/..."
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">
                    Billing Party* (Customers Only: {logisticsBillingParties.length})
                  </label>
                  <RichEntityPicker<LogisticsParty>
                    ariaLabel="Logistics Billing Party"
                    value={partyName}
                    selectedId={selectedBillPartyId}
                    onChangeText={(val) => handleSelectParty(val)}
                    onSelectEntity={(p) => applySelectedBillingParty(p)}
                    items={logisticsBillingParties}
                    getId={(p) => p.id}
                    getValue={(p) => p.name}
                    getSearchText={(p) =>
                      `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''}`
                    }
                    renderTitle={(p) => p.name}
                    renderBadge={(p) => p.partyType}
                    renderDetails={(p) => formatPartyDetailsLine(p)}
                    placeholder="Search Customer by Name, GSTIN, City or Phone..."
                    required
                    quickPreview={(() => {
                      const clean = partyName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = logisticsBillingParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedBillPartyId
                          ? logisticsBillingParties.find((p) => p.id === selectedBillPartyId)
                          : undefined) ||
                        (matches.length === 1 ? matches[0] : matches[0]);
                      return (
                        <EntityQuickPreviewCard
                          kind="party"
                          party={resolved}
                          duplicateCount={matches.length}
                          ambiguousSelected={matches.length > 1 && !selectedBillPartyId}
                          compact
                        />
                      );
                    })()}
                  />
                </div>
                <div>
                  <GstinInputField
                    label="Party GSTIN"
                    value={partyGstin}
                    onChange={setPartyGstin}
                    compact
                  />
                </div>
              </div>

              {/* Unbilled Dockets Puller */}
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    Pull Unbilled Dockets ({unbilledDocketsForParty.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDocketIds(
                        selectedDocketIds.length === unbilledDocketsForParty.length
                          ? []
                          : unbilledDocketsForParty.map((d) => d.id)
                      )
                    }
                    className="text-[11px] font-bold text-[#0F766E] hover:underline cursor-pointer"
                  >
                    {selectedDocketIds.length === unbilledDocketsForParty.length ? 'Clear All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 bg-white rounded border border-slate-200">
                  {unbilledDocketsForParty.length === 0 ? (
                    <p className="p-2.5 text-center text-slate-500">
                      No unbilled dockets match this party. Enter manual adjustment amount below if CN/DN.
                    </p>
                  ) : (
                    unbilledDocketsForParty.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center justify-between px-2.5 py-1.5 hover:bg-teal-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedDocketIds.includes(d.id)}
                            onChange={(e) =>
                              setSelectedDocketIds((prev) =>
                                e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                              )
                            }
                          />
                          <span className="font-mono-num font-bold text-[#0F766E]">{d.docketNo}</span>
                          <span className="text-slate-600">{d.originBranch}&rarr;{d.destBranch}</span>
                        </div>
                        <span className="font-mono-num font-bold">₹{formatINR(d.totalAmount)}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">
                    Extra / CN-DN Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={manualAdjustmentAmt}
                    onChange={(e) => setManualAdjustmentAmt(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Remarks</label>
                  <input
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Billing note..."
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                  <SearchableSelect
                    ariaLabel="Billing Remarks Preset"
                    value=""
                    onChange={(val) => {
                      if (val) setRemarks(val);
                    }}
                    options={[
                      { value: '', label: '+ Quick Remark Preset (A-Z)...', pinFirst: true },
                      ...COMMON_REMARK_PRESETS.map((r) => ({ value: r, label: r })),
                    ]}
                    triggerClassName="!py-1 !text-[11px]"
                    searchPlaceholder="Search remarks..."
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-teal-50 border border-teal-200">
                <label className="inline-flex items-center gap-1.5 font-bold text-teal-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reverseCharge}
                    onChange={(e) => setReverseCharge(e.target.checked)}
                  />
                  <span>GST RCM (5% Payable by Recipient)</span>
                </label>
                {!reverseCharge && (
                  <div className="flex items-center gap-2">
                    <div className="w-[95px]">
                      <SearchableSelect
                        ariaLabel="Billing GST Rate"
                        value={gstRate}
                        onChange={setGstRate}
                        options={[
                          { value: '0', label: '0% (Exempt)' },
                          { value: '5', label: '5%' },
                          { value: '12', label: '12%' },
                          { value: '18', label: '18%' },
                        ]}
                        triggerClassName="!py-1 !text-[11px] !font-bold !border-teal-300"
                      />
                    </div>
                    <label className="inline-flex items-center gap-1 text-[11px] font-bold">
                      <input
                        type="checkbox"
                        checked={interstate}
                        onChange={(e) => setInterstate(e.target.checked)}
                      />
                      IGST
                    </label>
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-300">
                    Taxable ₹{formatINR(billingTotals.taxableAmount)} + Tax ₹
                    {formatINR(billingTotals.cgstAmt + billingTotals.sgstAmt + billingTotals.igstAmt)}
                  </div>
                  <div className="text-sm font-extrabold font-mono-num">
                    Grand Total: ₹{formatINR(billingTotals.grandTotal)}
                  </div>
                  <div className="text-[10px] text-emerald-300 mt-0.5">
                    {amountToIndianWords(billingTotals.grandTotal)}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingDoc}
                  className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold cursor-pointer disabled:opacity-60"
                >
                  {savingDoc ? 'Saving...' : `Generate ${docType}`}
                </button>
              </div>
            </div>
          </form>

          {/* Invoices / CN / DN List */}
          <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <h3 className="text-xs font-extrabold text-slate-900">
                Logistics Billing Register — Invoices, Credit Notes &amp; Debit Notes ({invoices.length})
              </h3>
            </div>
            <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Type / Doc No</th>
                    <th className="px-3 py-2 text-left">Party &amp; GSTIN</th>
                    <th className="px-3 py-2 text-right">Dockets / Taxable</th>
                    <th className="px-3 py-2 text-right">Grand Total / Paid</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">
                        No Logistics Invoices, Credit Notes, or Debit Notes generated yet.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mb-0.5 ${
                              inv.docType === 'Credit Note'
                                ? 'bg-amber-100 text-amber-900'
                                : inv.docType === 'Debit Note'
                                ? 'bg-purple-100 text-purple-900'
                                : 'bg-blue-100 text-blue-900'
                            }`}
                          >
                            {inv.docType}
                          </span>
                          <div className="font-mono-num font-extrabold text-slate-900">{inv.docNo}</div>
                          <div className="text-[11px] text-slate-500">{formatDateDDMMYYYY(inv.docDate)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-bold text-slate-900">{inv.partyName}</div>
                          <div className="font-mono-num text-[11px] text-slate-500">
                            {inv.partyGstin || 'URD'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num">
                          <div>{(inv.docketRows || []).length} Dockets</div>
                          <div className="text-[11px] text-slate-500">₹{formatINR(inv.taxableAmount)}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num">
                          <div className="font-extrabold text-slate-900">₹{formatINR(inv.grandTotal)}</div>
                          <div className="text-[11px] text-emerald-700">Paid: ₹{formatINR(inv.paidAmount)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              inv.status === 'Paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.status === 'Partial'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                          <button
                            type="button"
                            onClick={async () => {
                              const pdf = await generateLogisticsInvoicePDF(inv, company);
                              onPreviewPdf(pdf, 'Logistics_Invoices_CN_DN');
                            }}
                            className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 cursor-pointer"
                            title="Preview A4 PDF"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const pdf = await generateLogisticsInvoicePDF(inv, company);
                              const matched = parties.find(
                                (p) => p.name.trim().toLowerCase() === inv.partyName.trim().toLowerCase()
                              );
                              await sharePdfDirect({
                                pdf,
                                channel: 'whatsapp',
                                phone: matched?.phone,
                                email: matched?.email,
                                partyName: inv.partyName,
                                docNo: inv.docNo,
                                docLabel: inv.docType,
                                company,
                              });
                              URL.revokeObjectURL(pdf.blobUrl);
                            }}
                            className="p-1.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                            title="Share Pure Binary Invoice PDF on WhatsApp"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const pdf = await generateLogisticsInvoicePDF(inv, company);
                              const matched = parties.find(
                                (p) => p.name.trim().toLowerCase() === inv.partyName.trim().toLowerCase()
                              );
                              await sharePdfDirect({
                                pdf,
                                channel: 'email',
                                phone: matched?.phone,
                                email: matched?.email,
                                partyName: inv.partyName,
                                docNo: inv.docNo,
                                docLabel: inv.docType,
                                company,
                              });
                              URL.revokeObjectURL(pdf.blobUrl);
                            }}
                            className="p-1.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 cursor-pointer"
                            title="Share Pure Binary Invoice PDF via Email"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onShowConfirm({
                                title: `Delete ${inv.docType} ${inv.docNo}?`,
                                description: 'Removes billing document from Logistics records.',
                                confirmLabel: 'Delete',
                                variant: 'danger',
                                onConfirm: () => removeDocument('logistics_invoices', inv.id),
                              })
                            }
                            className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subView === 'ledgers' && (
        <div className="space-y-4">
          {/* Top KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Total Logistics Billed</div>
              <div className="text-lg font-extrabold font-mono-num text-[#0D47A1]">
                ₹{formatINR(ledgerKpis.totalBilled)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Total Received / COD</div>
              <div className="text-lg font-extrabold font-mono-num text-emerald-700">
                ₹{formatINR(ledgerKpis.totalReceived)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Total TDS u/s 194C</div>
              <div className="text-lg font-extrabold font-mono-num text-amber-700">
                ₹{formatINR(ledgerKpis.totalTds)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Net Balance Due</div>
              <div className="text-lg font-extrabold font-mono-num text-red-700">
                ₹{formatINR(ledgerKpis.netBalance)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <form
              onSubmit={handleSaveVoucher}
              className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="bg-gradient-to-r from-[#0F766E] to-[#115E59] text-white px-4 py-2.5 flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                <h3 className="text-xs font-extrabold uppercase">
                  Logistics Receipt / COD Cash / Payment Entry
                </h3>
              </div>
              <div className="p-3.5 space-y-2.5 text-xs">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Voucher No*</label>
                    <input
                      required
                      value={voucherNo}
                      onChange={(e) => setVoucherNo(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Date*</label>
                    <input
                      type="date"
                      required
                      value={voucherDate}
                      onChange={(e) => setVoucherDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Type</label>
                    <SearchableSelect
                      ariaLabel="Logistics Voucher Type"
                      value={voucherType}
                      onChange={(val) =>
                        setVoucherType(val as 'Receipt' | 'Payment' | 'COD Cash' | 'Adjustment')
                      }
                      options={[
                        { value: 'Adjustment', label: 'Adjustment' },
                        { value: 'Payment', label: 'Line-Haul / Vendor Pay' },
                        { value: 'Receipt', label: 'Receipt (TBB / Paid)' },
                        { value: 'COD Cash', label: 'To-Pay COD Cash' },
                      ]}
                      triggerClassName="!py-1.5 !font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Party / Driver Name*</label>
                    <RichEntityPicker<LogisticsParty>
                      ariaLabel="Logistics Ledger Party"
                      value={ledgerParty}
                      selectedId={selectedLedgerPartyId}
                      onChangeText={(val) => {
                        setLedgerParty(val);
                        const matches = parties.filter(
                          (p) => p.name.trim().toLowerCase() === val.trim().toLowerCase()
                        );
                        setSelectedLedgerPartyId(matches.length === 1 ? matches[0].id : '');
                      }}
                      onSelectEntity={(p) => {
                        setLedgerParty(p.name);
                        setSelectedLedgerPartyId(p.id);
                      }}
                      items={parties}
                      getId={(p) => p.id}
                      getValue={(p) => p.name}
                      getSearchText={(p) =>
                        `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''} ${p.partyType}`
                      }
                      renderTitle={(p) => p.name}
                      renderBadge={(p) => p.partyType}
                      renderDetails={(p) => formatPartyDetailsLine(p)}
                      placeholder="Search Party by Name, GSTIN, PAN, City or Phone..."
                      required
                      quickPreview={(() => {
                        const clean = ledgerParty.trim().toLowerCase();
                        if (!clean) return null;
                        const matches = parties.filter(
                          (p) => p.name.trim().toLowerCase() === clean
                        );
                        const resolved =
                          (selectedLedgerPartyId
                            ? parties.find((p) => p.id === selectedLedgerPartyId)
                            : undefined) ||
                          (matches.length === 1 ? matches[0] : matches[0]);
                        return (
                          <EntityQuickPreviewCard
                            kind="party"
                            party={resolved}
                            duplicateCount={matches.length}
                            ambiguousSelected={matches.length > 1 && !selectedLedgerPartyId}
                            compact
                          />
                        );
                      })()}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Linked Invoice / Docket No</label>
                    <input
                      value={ledgerLinkedDoc}
                      onChange={(e) => setLedgerLinkedDoc(e.target.value)}
                      placeholder="LINV/... or LOG-..."
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Amount (₹)*</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={ledgerAmt}
                      onChange={(e) => setLedgerAmt(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">TDS u/s 194C (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tdsAmt}
                      onChange={(e) => setTdsAmt(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Payment Mode</label>
                    <EditableSearchSelect
                      ariaLabel="Logistics Payment Mode"
                      value={paymentMode}
                      onChange={setPaymentMode}
                      options={getEffectiveDropdownList(company, 'paymentModes')}
                      onAddOption={(v) => addDropdownItem(ownerUid, company, 'paymentModes', v)}
                      onEditOption={(o, n) => editDropdownItem(ownerUid, company, 'paymentModes', o, n)}
                      onDeleteOption={(v) => deleteDropdownItem(ownerUid, company, 'paymentModes', v)}
                      inputClassName="!py-1.5 !font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">UPI Reference ID</label>
                    <input
                      value={upiRefId}
                      onChange={(e) => setUpiRefId(e.target.value)}
                      placeholder="4129..."
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">UTR No.</label>
                    <input
                      value={utrNo}
                      onChange={(e) => setUtrNo(e.target.value)}
                      placeholder="PUNB..."
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Cheque No.</label>
                    <input
                      value={chequeNo}
                      onChange={(e) => setChequeNo(e.target.value)}
                      placeholder="004512"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                  <span className="font-bold text-[#0F766E]">Auto Narration:</span> {autoNarration}
                </div>

                <button
                  type="submit"
                  disabled={savingVoucher}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#0F766E] hover:bg-[#0D9488] text-white font-extrabold cursor-pointer disabled:opacity-60"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingVoucher ? 'Posting...' : 'Save Logistics Voucher'}</span>
                </button>
              </div>
            </form>

            {/* Ledger Register */}
            <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IndianRupee className="w-4 h-4 text-[#0F766E]" />
                  <h3 className="text-xs font-extrabold text-slate-900">
                    Logistics Party Ledger Vouchers ({filteredLedgers.length})
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-52">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                    <input
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                      placeholder="Search Party, UPI, UTR..."
                      className="w-full pl-8 pr-2 py-1 rounded border border-slate-300 text-xs bg-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePrintLedgerPdf()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0D47A1] hover:bg-[#0B3B8C] text-white text-xs font-bold cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>A4 Statement</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Voucher / Date</th>
                      <th className="px-3 py-2 text-left">Party &amp; Auto Narration</th>
                      <th className="px-3 py-2 text-left">UPI / UTR / Chq</th>
                      <th className="px-3 py-2 text-right">Amount / TDS</th>
                      <th className="px-3 py-2 text-right">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLedgers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500">
                          No Logistics Receipts or Payment Vouchers recorded yet.
                        </td>
                      </tr>
                    ) : (
                      filteredLedgers.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <div className="font-mono-num font-bold text-[#0F766E]">{l.voucherNo}</div>
                            <div className="text-[11px] text-slate-500">{formatDateDDMMYYYY(l.voucherDate)}</div>
                            <span className="px-1.5 py-0.2 rounded bg-slate-100 text-[10px] font-bold">
                              {l.voucherType}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-900">{l.partyName}</div>
                            <div className="text-[11px] text-slate-600">{l.narration}</div>
                          </td>
                          <td className="px-3 py-2 font-mono-num text-[11px]">
                            <div className="font-bold">{l.paymentMode}</div>
                            {l.upiRefId && <div>UPI: {l.upiRefId}</div>}
                            {l.utrNo && <div>UTR: {l.utrNo}</div>}
                            {l.chequeNo && <div>Chq: {l.chequeNo}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-num">
                            <div className="font-extrabold text-emerald-700">₹{formatINR(l.amount)}</div>
                            {Number(l.tdsAmount || 0) > 0 && (
                              <div className="text-[11px] text-amber-700">TDS ₹{formatINR(l.tdsAmount || 0)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                onShowConfirm({
                                  title: `Delete Voucher ${l.voucherNo}?`,
                                  description: 'Removes ledger entry from Logistics Accounts.',
                                  confirmLabel: 'Delete',
                                  variant: 'danger',
                                  onConfirm: () => removeDocument('logistics_ledgers', l.id),
                                })
                              }
                              className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
