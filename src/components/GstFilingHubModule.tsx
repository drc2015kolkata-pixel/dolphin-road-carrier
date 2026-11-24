import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Lock,
  Plus,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import {
  BusinessMode,
  CompanySettings,
  ConsignmentNote,
  getLogisticsDivisionFromId,
  Invoice,
  KycDocType,
  KycVaultItem,
  LogisticsInvoice,
  TransactionRecord,
} from '../types/erp';
import { formatDateDDMMYYYY, formatINR, todayISO } from '../lib/formatters';
import { FoxproStatementSpec } from '../lib/pdfBuilders';
import {
  generateAppFormatBlueprintPDF,
  generateFoxproStatementPDF,
  GeneratedPdfResult,
  printPdfDirect,
} from '../lib/pdfEngine';
import { uploadBlueprintPdfToDrive, uploadNamedPdfToDrive } from '../lib/driveBackup';
import { BACKUP_ISOLATED_DRIVE_EMAIL } from '../lib/firebase';
import { validateSafeUploadFile } from '../lib/gstinValidator';
import { saveSettingsDocument } from '../lib/firestoreStore';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { verifyAdminPin } from '../lib/selfHealing';
import {
  compressComplianceFileToDataUrl,
  deleteKycPdfLocal,
  evaluateKycExpiryAlarms,
  evaluateMonthlyGstAlarms,
  getKycPdfLocal,
  saveKycPdfLocal,
  STATUTORY_DOC_PRESETS,
  StoredKycFile,
} from '../lib/kycVaultStorage';
import { SearchableSelect } from './SearchableSelect';

interface GstFilingHubModuleProps {
  invoices: Invoice[];
  logisticsInvoices?: LogisticsInvoice[];
  consignments: ConsignmentNote[];
  transactions?: TransactionRecord[];
  company: CompanySettings;
  activeFy: string;
  ownerUid?: string;
  driveAccessToken?: string | null;
  onConnectDrive?: () => Promise<void>;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'Reports_Ledgers' | 'Declarations') => void;
}

type GstSubTab = 'gstr1' | 'gstr3b' | 'cdnr' | 'auditorPack' | 'kycVault';
type BusinessFilter = 'ALL' | BusinessMode;

interface NormalizedGstBill {
  id: string;
  businessMode: BusinessMode;
  docKind: 'Tax Invoice' | 'Credit Note' | 'Debit Note';
  docNo: string;
  docDate: string;
  partyName: string;
  partyGstin: string;
  billingCountry: string;
  sac: string;
  gstPaidBy: string;
  reverseCharge: boolean;
  gstRate: number;
  taxableValue: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  totalTax: number;
  grandTotal: number;
  status: string;
  linkedDocNo?: string;
}

function roundPaise(n: unknown): number {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num)) return 0;
  const r = Math.round((num + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

const isLorryHireLedger = (tx: TransactionRecord): boolean => {
  const hay = `${tx.ledgerAccount || ''} ${tx.narration || ''}`.toLowerCase();
  return /lorry hire|truck advance|lorry balance|broker hire|owner hire/.test(hay);
};

const isExplicitItcPurchase = (tx: TransactionRecord): boolean => {
  const hay = `${tx.ledgerAccount || ''} ${tx.narration || ''}`.toLowerCase();
  return /gst|itc|input tax|cgst|sgst|igst|purchase|tyre|repair|spare|office rent|stationery|computer|service bill|tax invoice/.test(
    hay
  );
};

export const GstFilingHubModule: React.FC<GstFilingHubModuleProps> = ({
  invoices,
  logisticsInvoices = [],
  consignments,
  transactions = [],
  company,
  activeFy,
  ownerUid,
  driveAccessToken = null,
  onConnectDrive,
  onPreviewPdf,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessFilter>('ALL');
  const [subTab, setSubTab] = useState<GstSubTab>('gstr1');
  const [exportStatus, setExportStatus] = useState('');
  const [exportError, setExportError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Alarms popup modal (Monthly GST + Pre-expiry KYC)
  const monthlyAlarms = useMemo(() => evaluateMonthlyGstAlarms(new Date()), []);
  const kycAlarms = useMemo(
    () => evaluateKycExpiryAlarms(company.kycVault, new Date()),
    [company.kycVault]
  );
  const [showAlarmModal, setShowAlarmModal] = useState(false);
  const alarmBeepPlayedRef = useRef(false);

  useEffect(() => {
    if (alarmBeepPlayedRef.current) return;
    const hasUrgentKyc = kycAlarms.some((a) => a.tier === 'expired' || a.tier === '2-day');
    if (monthlyAlarms.length > 0 || hasUrgentKyc) {
      alarmBeepPlayedRef.current = true;
      playAlertBeep();
      setShowAlarmModal(true);
    }
  }, [monthlyAlarms, kycAlarms]);

  // Annual Auditor & ITR Pack pre-export selector
  const [packColumns, setPackColumns] = useState({
    includeSalesRegister: true,
    includeGstr3bSummary: true,
    includePurchaseItc: true,
    includeItReturnSummary: true,
  });
  const [itcRatePct, setItcRatePct] = useState<number>(18);
  const [onlyTaggedItcPurchases, setOnlyTaggedItcPurchases] = useState<boolean>(true);

  // PIN-protected KYC Vault state
  const [pinInput, setPinInput] = useState('');
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinError, setPinError] = useState('');
  const [kycDocType, setKycDocType] = useState<KycDocType>('WB_TRADE_LICENSE');
  const [kycLabel, setKycLabel] = useState(STATUTORY_DOC_PRESETS[0].label);
  const [kycDocNumber, setKycDocNumber] = useState('');
  const [kycIssueDate, setKycIssueDate] = useState('');
  const [kycExpiryDate, setKycExpiryDate] = useState('');
  const [kycPortalUrl, setKycPortalUrl] = useState(STATUTORY_DOC_PRESETS[0].portalUrl);
  const [kycPendingFile, setKycPendingFile] = useState<File | null>(null);
  const [kycConfirmDeleteId, setKycConfirmDeleteId] = useState<string | null>(null);
  const [previewStoredFile, setPreviewStoredFile] = useState<{
    item: KycVaultItem;
    file: StoredKycFile;
  } | null>(null);

  // Combine strictly Billed Invoices across FTL, LOGISTICS, PTL, and COURIER
  // (Never mixes Lorry Hire register rows into GST sales)
  const allNormalizedBills = useMemo<NormalizedGstBill[]>(() => {
    const out: NormalizedGstBill[] = [];

    invoices.forEach((inv) => {
      const rawDiv = String(inv.division || 'FTL').toUpperCase();
      const businessMode: BusinessMode =
        rawDiv === 'LOGISTICS' || rawDiv === 'PTL' || rawDiv === 'COURIER'
          ? (rawDiv as BusinessMode)
          : 'FTL';
      const cgst = roundPaise(inv.cgstAmt);
      const sgst = roundPaise(inv.sgstAmt);
      const igst = roundPaise(inv.igstAmt);
      const totalTax = roundPaise(inv.totalTax ?? cgst + sgst + igst);
      const grandTotal = roundPaise(inv.grandTotal);
      const chargesSum = roundPaise(
        Number(inv.freightCharges || 0) +
          Number(inv.detentionCharges || 0) +
          Number(inv.unloadingCharges || 0) +
          Number(inv.stCharges || 0)
      );
      const taxableValue = roundPaise(
        chargesSum > 0 ? chargesSum : Math.max(0, grandTotal - totalTax)
      );
      const kind: NormalizedGstBill['docKind'] =
        inv.docKind === 'Credit Note'
          ? 'Credit Note'
          : inv.docKind === 'Debit Note'
          ? 'Debit Note'
          : 'Tax Invoice';

      out.push({
        id: inv.id,
        businessMode,
        docKind: kind,
        docNo: inv.invoiceNo,
        docDate: inv.invoiceDate,
        partyName: inv.partyName,
        partyGstin: inv.partyGstin || '',
        billingCountry: inv.billingCountry || 'India',
        sac: inv.sac || company.hsn || '996791',
        gstPaidBy: inv.gstPaidBy || (inv.reverseCharge ? 'Consignee' : 'Transporter'),
        reverseCharge: Boolean(inv.reverseCharge),
        gstRate: Number(inv.gstRate ?? 5),
        taxableValue,
        cgstAmt: cgst,
        sgstAmt: sgst,
        igstAmt: igst,
        totalTax,
        grandTotal,
        status: inv.status,
        linkedDocNo: inv.againstInvoiceNo,
      });
    });

    logisticsInvoices.forEach((li) => {
      const div = getLogisticsDivisionFromId(li.id);
      const cgst = roundPaise(li.cgstAmt);
      const sgst = roundPaise(li.sgstAmt);
      const igst = roundPaise(li.igstAmt);
      const totalTax = roundPaise(cgst + sgst + igst);
      const grandTotal = roundPaise(li.grandTotal);
      const taxableValue = roundPaise(
        Number(li.taxableAmount || 0) || Math.max(0, grandTotal - totalTax)
      );

      out.push({
        id: li.id,
        businessMode: div,
        docKind: li.docType || 'Tax Invoice',
        docNo: li.docNo,
        docDate: li.docDate,
        partyName: li.partyName,
        partyGstin: li.partyGstin || '',
        billingCountry: 'India',
        sac: li.sac || company.hsn || '996791',
        gstPaidBy: li.reverseCharge ? 'Consignee' : 'Transporter',
        reverseCharge: Boolean(li.reverseCharge),
        gstRate: Number(li.gstRate ?? 5),
        taxableValue,
        cgstAmt: cgst,
        sgstAmt: sgst,
        igstAmt: igst,
        totalTax,
        grandTotal,
        status: li.status,
        linkedDocNo: li.linkedDocNo,
      });
    });

    return out.sort((a, b) => (a.docDate || '').localeCompare(b.docDate || ''));
  }, [invoices, logisticsInvoices, company.hsn]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    allNormalizedBills.forEach((b) => {
      if (b.docDate && b.docDate.length >= 7) set.add(b.docDate.slice(0, 7));
    });
    consignments.forEach((cn) => {
      if (cn.cnDate && cn.cnDate.length >= 7) set.add(cn.cnDate.slice(0, 7));
    });
    transactions.forEach((tx) => {
      if (tx.txDate && tx.txDate.length >= 7) set.add(tx.txDate.slice(0, 7));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allNormalizedBills, consignments, transactions]);

  const filteredBills = useMemo(() => {
    return allNormalizedBills.filter((b) => {
      if (selectedMonth !== 'ALL' && !(b.docDate || '').startsWith(selectedMonth)) {
        return false;
      }
      if (selectedBusiness !== 'ALL' && b.businessMode !== selectedBusiness) {
        return false;
      }
      return true;
    });
  }, [allNormalizedBills, selectedMonth, selectedBusiness]);

  // Purchase & Expense ITC Register (strictly excluding Lorry Hire register payouts)
  const purchaseVouchers = useMemo(() => {
    return transactions.filter((tx) => {
      if (tx.txType !== 'Expense') return false;
      if (selectedMonth !== 'ALL' && !(tx.txDate || '').startsWith(selectedMonth)) return false;
      if (isLorryHireLedger(tx)) return false;
      if (onlyTaggedItcPurchases && !isExplicitItcPurchase(tx)) return false;
      return true;
    });
  }, [transactions, selectedMonth, onlyTaggedItcPurchases]);

  const allOperatingExpensesForItr = useMemo(() => {
    return transactions.filter((tx) => {
      if (tx.txType !== 'Expense') return false;
      if (selectedMonth !== 'ALL' && !(tx.txDate || '').startsWith(selectedMonth)) return false;
      return true;
    });
  }, [transactions, selectedMonth]);

  const summary = useMemo(() => {
    let fcmTaxable = 0;
    let fcmCgst = 0;
    let fcmSgst = 0;
    let fcmIgst = 0;
    let fcmTotalTax = 0;
    let rcmTaxable = 0;
    let rcmNotionalTax5 = 0;
    let exportExemptTotal = 0;
    let creditNoteTotal = 0;
    let grandTotal = 0;

    const byDivision: Record<BusinessMode, { count: number; taxable: number; tax: number; total: number }> = {
      FTL: { count: 0, taxable: 0, tax: 0, total: 0 },
      LOGISTICS: { count: 0, taxable: 0, tax: 0, total: 0 },
      PTL: { count: 0, taxable: 0, tax: 0, total: 0 },
      COURIER: { count: 0, taxable: 0, tax: 0, total: 0 },
    };

    filteredBills.forEach((b) => {
      const sign = b.docKind === 'Credit Note' ? -1 : 1;
      const isExport = /^(Nepal|Bangladesh|Bhutan)$/i.test(b.billingCountry || 'India');
      const isRcm =
        b.reverseCharge ||
        (b.totalTax === 0 && !isExport && (b.gstPaidBy === 'Consignee' || b.gstPaidBy === 'Consignor'));

      if (b.docKind === 'Credit Note') {
        creditNoteTotal = roundPaise(creditNoteTotal + b.grandTotal);
      }

      grandTotal = roundPaise(grandTotal + sign * b.grandTotal);
      byDivision[b.businessMode].count += 1;
      byDivision[b.businessMode].taxable = roundPaise(byDivision[b.businessMode].taxable + sign * b.taxableValue);
      byDivision[b.businessMode].tax = roundPaise(byDivision[b.businessMode].tax + sign * b.totalTax);
      byDivision[b.businessMode].total = roundPaise(byDivision[b.businessMode].total + sign * b.grandTotal);

      if (isExport) {
        exportExemptTotal = roundPaise(exportExemptTotal + sign * b.taxableValue);
      } else if (isRcm) {
        rcmTaxable = roundPaise(rcmTaxable + sign * b.taxableValue);
        rcmNotionalTax5 = roundPaise(rcmNotionalTax5 + sign * roundPaise(b.taxableValue * 0.05));
      } else {
        fcmTaxable = roundPaise(fcmTaxable + sign * b.taxableValue);
        fcmCgst = roundPaise(fcmCgst + sign * b.cgstAmt);
        fcmSgst = roundPaise(fcmSgst + sign * b.sgstAmt);
        fcmIgst = roundPaise(fcmIgst + sign * b.igstAmt);
        fcmTotalTax = roundPaise(fcmTotalTax + sign * b.totalTax);
      }
    });

    // Purchase ITC computation from inclusive expense vouchers
    const purchaseGrossTotal = roundPaise(
      purchaseVouchers.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    );
    const divisor = 1 + itcRatePct / 100;
    const purchaseItcTax =
      itcRatePct > 0
        ? roundPaise(purchaseGrossTotal - roundPaise(purchaseGrossTotal / divisor))
        : 0;
    const purchaseTaxableBase = roundPaise(purchaseGrossTotal - purchaseItcTax);
    const netGstCashPayable = roundPaise(Math.max(0, fcmTotalTax - purchaseItcTax));

    // ITR Turnover & Expense totals
    const totalExpenseForItr = roundPaise(
      allOperatingExpensesForItr.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
    );
    const totalTdsDeducted = roundPaise(
      allOperatingExpensesForItr.reduce((sum, tx) => sum + Number(tx.tdsAmount || 0), 0)
    );
    const grossSalesExclTax = roundPaise(fcmTaxable + rcmTaxable + exportExemptTotal);
    const estimatedNetProfit = roundPaise(grossSalesExclTax - totalExpenseForItr);

    const filteredCns = consignments.filter((cn) => {
      if (selectedMonth !== 'ALL' && !(cn.cnDate || '').startsWith(selectedMonth)) return false;
      const div = String(cn.division || 'FTL').toUpperCase();
      if (selectedBusiness !== 'ALL' && div !== selectedBusiness) return false;
      return true;
    });

    return {
      invoiceCount: filteredBills.length,
      cnCount: filteredCns.length,
      fcmTaxable,
      fcmCgst,
      fcmSgst,
      fcmIgst,
      fcmTotalTax,
      rcmTaxable,
      rcmNotionalTax5,
      exportExemptTotal,
      creditNoteTotal,
      grandTotal,
      purchaseGrossTotal,
      purchaseTaxableBase,
      purchaseItcTax,
      netGstCashPayable,
      totalExpenseForItr,
      totalTdsDeducted,
      grossSalesExclTax,
      estimatedNetProfit,
      byDivision,
    };
  }, [
    filteredBills,
    purchaseVouchers,
    allOperatingExpensesForItr,
    itcRatePct,
    consignments,
    selectedMonth,
    selectedBusiness,
  ]);

  const setMsg = (msg: string) => {
    setExportError('');
    setExportStatus(msg);
  };

  const setErr = (err: string) => {
    setExportStatus('');
    setExportError(err);
  };

  const handleExportGstrJson = () => {
    const returnPeriod =
      selectedMonth !== 'ALL'
        ? `${selectedMonth.slice(5, 7)}${selectedMonth.slice(0, 4)}`
        : `FY_${activeFy.replace(/[^0-9]/g, '')}`;

    const payload = {
      gstin: company.gstin || '19DOTPS3540M1ZZ',
      fp: returnPeriod,
      businessScope: selectedBusiness,
      version: 'GST3.1',
      b2b: filteredBills
        .filter(
          (b) =>
            b.docKind !== 'Credit Note' &&
            Boolean(b.partyGstin) &&
            !/^(Nepal|Bangladesh|Bhutan)$/i.test(b.billingCountry)
        )
        .map((b) => ({
          ctin: b.partyGstin,
          inum: b.docNo,
          idt: formatDateDDMMYYYY(b.docDate),
          val: b.grandTotal,
          rchrg: b.reverseCharge ? 'Y' : 'N',
          inv_typ: 'R',
          division: b.businessMode,
          itms: [
            {
              num: 1,
              itm_det: {
                rt: b.gstRate,
                txval: b.taxableValue,
                iamt: b.igstAmt,
                camt: b.cgstAmt,
                samt: b.sgstAmt,
              },
            },
          ],
        })),
      b2cs: filteredBills
        .filter(
          (b) =>
            b.docKind !== 'Credit Note' &&
            !b.partyGstin &&
            !/^(Nepal|Bangladesh|Bhutan)$/i.test(b.billingCountry)
        )
        .map((b) => ({
          division: b.businessMode,
          inum: b.docNo,
          idt: formatDateDDMMYYYY(b.docDate),
          txval: b.taxableValue,
          rt: b.gstRate,
          camt: b.cgstAmt,
          samt: b.sgstAmt,
          iamt: b.igstAmt,
        })),
      cdnr: filteredBills
        .filter((b) => b.docKind === 'Credit Note' || b.docKind === 'Debit Note')
        .map((b) => ({
          ntty: b.docKind === 'Credit Note' ? 'C' : 'D',
          nt_num: b.docNo,
          nt_dt: formatDateDDMMYYYY(b.docDate),
          ctin: b.partyGstin || 'URP',
          val: b.grandTotal,
          txval: b.taxableValue,
          division: b.businessMode,
        })),
      exp: filteredBills
        .filter((b) => /^(Nepal|Bangladesh|Bhutan)$/i.test(b.billingCountry))
        .map((b) => ({
          inum: b.docNo,
          idt: formatDateDDMMYYYY(b.docDate),
          val: b.grandTotal,
          country: b.billingCountry,
          division: b.businessMode,
        })),
      gstr3b_summary: {
        outward_fcm_taxable: summary.fcmTaxable,
        outward_fcm_igst: summary.fcmIgst,
        outward_fcm_cgst: summary.fcmCgst,
        outward_fcm_sgst: summary.fcmSgst,
        gta_rcm_5pct_taxable: summary.rcmTaxable,
        gta_rcm_5pct_tax_recipient_liability: summary.rcmNotionalTax5,
        export_zero_rated: summary.exportExemptTotal,
        eligible_purchase_itc: summary.purchaseItcTax,
        net_gst_cash_payable: summary.netGstCashPayable,
      },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST_GSTR1_3B_${company.gstin || 'DRC'}_${returnPeriod}_${selectedBusiness}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    playVerifiedBeep();
    setMsg(`Exported GSTR-1 & GSTR-3B GST Portal JSON (${filteredBills.length} bills, ${selectedBusiness}).`);
  };

  const handleExportGstrExcel = (auditorPackMode = false) => {
    const wb = XLSX.utils.book_new();

    if (!auditorPackMode || packColumns.includeSalesRegister) {
      const gstr1Rows = filteredBills.map((b, idx) => ({
        'S.No': idx + 1,
        Business: b.businessMode,
        'Doc Kind': b.docKind,
        'Invoice / Note No': b.docNo,
        'Doc Date': formatDateDDMMYYYY(b.docDate),
        'Party Name': b.partyName,
        GSTIN: b.partyGstin || '-',
        Country: b.billingCountry,
        SAC: b.sac,
        'GST Paid By': b.gstPaidBy,
        'RCM Applicable': b.reverseCharge ? 'YES' : 'NO',
        'Taxable Value (Rs)': b.taxableValue,
        'CGST (Rs)': b.cgstAmt,
        'SGST (Rs)': b.sgstAmt,
        'IGST (Rs)': b.igstAmt,
        'Total Tax (Rs)': b.totalTax,
        'Invoice Value (Rs)': b.grandTotal,
        Status: b.status,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gstr1Rows), 'GSTR1_Sales_Register');
    }

    if (!auditorPackMode || packColumns.includeGstr3bSummary) {
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
          CGST: roundPaise(summary.rcmNotionalTax5 / 2),
          SGST: roundPaise(summary.rcmNotionalTax5 / 2),
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
        {
          Section: `4(A) Eligible Input Tax Credit (Purchase Vouchers @ ${itcRatePct}%)`,
          Taxable: summary.purchaseTaxableBase,
          IGST: 0,
          CGST: roundPaise(summary.purchaseItcTax / 2),
          SGST: roundPaise(summary.purchaseItcTax / 2),
          TotalTax: summary.purchaseItcTax,
        },
        {
          Section: '6.1 Net GST Payable in Cash (Outward FCM Tax minus Purchase ITC)',
          Taxable: 0,
          IGST: 0,
          CGST: 0,
          SGST: 0,
          TotalTax: summary.netGstCashPayable,
        },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gstr3bRows), 'GSTR3B_ITC_Summary');
    }

    if (auditorPackMode && packColumns.includePurchaseItc) {
      const purchaseRows = purchaseVouchers.map((tx, idx) => {
        const amt = roundPaise(tx.amount);
        const estItc = itcRatePct > 0 ? roundPaise(amt - roundPaise(amt / (1 + itcRatePct / 100))) : 0;
        return {
          'S.No': idx + 1,
          'Voucher Code': tx.txCode,
          Date: formatDateDDMMYYYY(tx.txDate),
          'Ledger Account': tx.ledgerAccount,
          Party: tx.partyName,
          Mode: tx.paymentMode,
          'Ref / UTR': tx.utrNo || tx.upiRefId || tx.chequeNo || tx.referenceNo || '-',
          'Gross Amount (Rs)': amt,
          'Estimated Taxable (Rs)': roundPaise(amt - estItc),
          [`Est ITC @ ${itcRatePct}% (Rs)`]: estItc,
          Narration: tx.narration || '-',
        };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchaseRows), 'Purchase_ITC_Vouchers');
    }

    if (auditorPackMode && packColumns.includeItReturnSummary) {
      const itrRows = (['FTL', 'LOGISTICS', 'PTL', 'COURIER'] as BusinessMode[]).map((div) => ({
        Business: div,
        'Billed Docs': summary.byDivision[div].count,
        'Taxable Turnover (Rs)': summary.byDivision[div].taxable,
        'GST Tax (Rs)': summary.byDivision[div].tax,
        'Gross Billed (Rs)': summary.byDivision[div].total,
      }));
      itrRows.push({
        Business: 'COMBINED' as unknown as BusinessMode,
        'Billed Docs': summary.invoiceCount,
        'Taxable Turnover (Rs)': summary.grossSalesExclTax,
        'GST Tax (Rs)': summary.fcmTotalTax,
        'Gross Billed (Rs)': summary.grandTotal,
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itrRows), 'ITR_4Business_Turnover');
    }

    const fileName = auditorPackMode
      ? `DRC_Annual_Auditor_ITR_Pack_${activeFy.replace(/[^a-zA-Z0-9-]/g, '_')}_${selectedBusiness}_${todayISO()}.xlsx`
      : `DRC_GST_Filing_${selectedMonth}_${selectedBusiness}_${todayISO()}.xlsx`;

    XLSX.writeFile(wb, fileName);
    playVerifiedBeep();
    setMsg(`Exported Excel workbook ${fileName} (${filteredBills.length} bills).`);
  };

  const buildGstReturnsPdf = async (): Promise<GeneratedPdfResult> => {
    const spec: FoxproStatementSpec = {
      title: 'D-R-C   G-S-T   R-E-T-U-R-N-S   (GSTR-1  /  GSTR-3B  /  ITC)',
      subtitle: `FY: ${activeFy} · Period: ${selectedMonth} · Scope: ${selectedBusiness === 'ALL' ? 'ALL 4 BUSINESSES (FTL+LOGISTICS+PTL+COURIER)' : selectedBusiness} · GSTIN: ${company.gstin}`,
      fileName: 'DRC_GST_RETURNS.pdf',
      orientation: 'l',
      summaryLines: [
        { label: 'FCM Taxable', value: `Rs. ${formatINR(summary.fcmTaxable)}` },
        { label: 'FCM Output GST', value: `Rs. ${formatINR(summary.fcmTotalTax)}` },
        { label: 'RCM 5% GTA Value', value: `Rs. ${formatINR(summary.rcmTaxable)}` },
        { label: 'Eligible Purchase ITC', value: `Rs. ${formatINR(summary.purchaseItcTax)}` },
        { label: 'Net GST Payable', value: `Rs. ${formatINR(summary.netGstCashPayable)}` },
      ],
      columns: [
        { label: 'BILL NO / DATE', widthPct: 16, align: 'left' },
        { label: 'PARTY NAME / GSTIN', widthPct: 30, align: 'left' },
        { label: 'BUSINESS / MODE', widthPct: 18, align: 'left' },
        { label: 'TAXABLE VALUE', widthPct: 12, align: 'right' },
        { label: 'CGST + SGST + IGST', widthPct: 12, align: 'right' },
        { label: 'BILL TOTAL', widthPct: 12, align: 'right' },
      ],
      rows: filteredBills.map((b) => ({
        line1: [
          b.docNo,
          b.partyName,
          `${b.businessMode} · ${b.reverseCharge ? 'RCM 5%' : 'FCM'}`,
          formatINR(b.taxableValue),
          formatINR(b.totalTax),
          formatINR(b.grandTotal),
        ],
        line2: [
          `${formatDateDDMMYYYY(b.docDate)} · ${b.docKind}`,
          b.partyGstin || b.billingCountry || 'URP',
          b.gstPaidBy,
          `SAC ${b.sac}`,
          `C:${formatINR(b.cgstAmt)} S:${formatINR(b.sgstAmt)} I:${formatINR(b.igstAmt)}`,
          b.status,
        ],
      })),
      totalsLabel: 'TOTAL GST RETURN TURNOVER :',
      totalsLine1: [
        '',
        '',
        '',
        formatINR(summary.grossSalesExclTax),
        formatINR(summary.fcmTotalTax),
        formatINR(summary.grandTotal),
      ],
      totalAmountForWords: summary.grandTotal,
    };
    return generateFoxproStatementPDF(spec, company, 'l');
  };

  const buildItReturnAuditPdf = async (): Promise<GeneratedPdfResult> => {
    const divisionRows = (['FTL', 'LOGISTICS', 'PTL', 'COURIER'] as BusinessMode[]).map((div) => ({
      line1: [
        `${div} DIVISION`,
        `${summary.byDivision[div].count} Billed Invoices / Notes`,
        `Taxable Turnover`,
        formatINR(summary.byDivision[div].taxable),
        formatINR(summary.byDivision[div].tax),
        formatINR(summary.byDivision[div].total),
      ],
      line2: [
        `FY ${activeFy}`,
        `Excludes Lorry Hire Register`,
        `Output GST + Net`,
        '',
        '',
        '',
      ],
    }));

    const purchaseRows = packColumns.includePurchaseItc
      ? purchaseVouchers.slice(0, 80).map((tx) => ({
          line1: [
            tx.txCode,
            tx.partyName || tx.ledgerAccount,
            `${tx.ledgerAccount} (${tx.paymentMode})`,
            formatINR(tx.amount),
            formatINR(tx.tdsAmount || 0),
            formatINR(tx.amount),
          ],
          line2: [
            formatDateDDMMYYYY(tx.txDate),
            tx.narration || '-',
            tx.utrNo || tx.upiRefId || tx.chequeNo || tx.referenceNo || '-',
            'Expense / Purchase',
            'TDS',
            'Debit',
          ],
        }))
      : [];

    const spec: FoxproStatementSpec = {
      title: 'D-R-C   I-T   R-E-T-U-R-N   &   A-U-D-I-T   P-A-C-K',
      subtitle: `FY: ${activeFy} · Proprietor PAN: ${company.pan} · GSTIN: ${company.gstin} · Udyam: ${company.msme}`,
      fileName: 'DRC_IT_RETURN_AUDIT.pdf',
      orientation: 'l',
      summaryLines: [
        { label: 'Gross Turnover (Excl GST)', value: `Rs. ${formatINR(summary.grossSalesExclTax)}` },
        { label: 'Total Operating Expenses', value: `Rs. ${formatINR(summary.totalExpenseForItr)}` },
        { label: 'Est. Net Operating Surplus', value: `Rs. ${formatINR(summary.estimatedNetProfit)}` },
        { label: '194C TDS Recorded', value: `Rs. ${formatINR(summary.totalTdsDeducted)}` },
        { label: 'Eligible Purchase ITC', value: `Rs. ${formatINR(summary.purchaseItcTax)}` },
      ],
      columns: [
        { label: 'HEAD / VOUCHER', widthPct: 16, align: 'left' },
        { label: 'PARTICULARS / PARTY', widthPct: 30, align: 'left' },
        { label: 'LEDGER / MODE', widthPct: 18, align: 'left' },
        { label: 'TAXABLE / GROSS', widthPct: 12, align: 'right' },
        { label: 'GST / TDS', widthPct: 12, align: 'right' },
        { label: 'NET TOTAL', widthPct: 12, align: 'right' },
      ],
      rows: [...divisionRows, ...purchaseRows],
      totalsLabel: 'ESTIMATED ANNUAL NET SURPLUS :',
      totalsLine1: [
        '',
        '',
        '',
        formatINR(summary.grossSalesExclTax),
        formatINR(summary.totalTdsDeducted),
        formatINR(summary.estimatedNetProfit),
      ],
      totalAmountForWords: Math.max(0, summary.estimatedNetProfit),
    };
    return generateFoxproStatementPDF(spec, company, 'l');
  };

  const handlePrintGstHubPdf = async () => {
    try {
      setBusyAction('gst-pdf');
      const pdf = await buildGstReturnsPdf();
      playVerifiedBeep();
      printPdfDirect(pdf);
      onPreviewPdf(pdf, 'Reports_Ledgers');
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Failed to build GST PDF');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrintAuditorPack = async () => {
    try {
      setBusyAction('auditor-print');
      const gstPdf = packColumns.includeSalesRegister || packColumns.includeGstr3bSummary
        ? await buildGstReturnsPdf()
        : null;
      const itrPdf = packColumns.includeItReturnSummary || packColumns.includePurchaseItc
        ? await buildItReturnAuditPdf()
        : null;
      const target = itrPdf || gstPdf || (await buildGstReturnsPdf());
      playVerifiedBeep();
      printPdfDirect(target);
      onPreviewPdf(target, 'Reports_Ledgers');
      setMsg('Annual Auditor & ITR Pack PDF ready & sent to printer.');
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Failed to build Auditor Pack PDF');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveStatutoryPdfsToDrive = async (
    targetKind: 'gstAndItr' | 'tradeAndKyc'
  ) => {
    try {
      if (!driveAccessToken) {
        if (onConnectDrive) {
          setBusyAction(`connect_${targetKind}`);
          await onConnectDrive();
          setMsg('Google Drive connected! Click the Save to Drive button once more to upload the PDFs.');
        } else {
          setErr('Connect Google Drive in Backup / Cloud Sync first to upload compliance PDFs.');
        }
        return;
      }

      setBusyAction(targetKind);
      if (targetKind === 'gstAndItr') {
        const gstPdf = await buildGstReturnsPdf();
        const itrPdf = await buildItReturnAuditPdf();
        await uploadNamedPdfToDrive({
          accessToken: driveAccessToken,
          folderName: 'Reports_Ledgers',
          fileName: 'DRC_GST_RETURNS.pdf',
          blob: gstPdf.blob,
        });
        await uploadNamedPdfToDrive({
          accessToken: driveAccessToken,
          folderName: 'Reports_Ledgers',
          fileName: 'DRC_IT_RETURN_AUDIT.pdf',
          blob: itrPdf.blob,
        });
        playVerifiedBeep();
        setMsg(
          'Saved separate low-KB files DRC_GST_RETURNS.pdf & DRC_IT_RETURN_AUDIT.pdf to Google Drive -> Reports_Ledgers!'
        );
      } else {
        const vault = company.kycVault || [];
        const tradePtaxItems = vault.filter(
          (i) =>
            i.docType === 'WB_TRADE_LICENSE' ||
            i.docType === 'WB_PTAX' ||
            i.docType === 'UDYAM_MSME'
        );
        const buildVaultSpec = (title: string, fileName: string, items: KycVaultItem[]): FoxproStatementSpec => ({
          title,
          subtitle: `${company.companyName} · PAN: ${company.pan} · GSTIN: ${company.gstin} · Udyam: ${company.msme}`,
          fileName,
          orientation: 'p',
          summaryLines: [
            { label: 'Total Certificates', value: String(items.length) },
            { label: 'Proprietor PAN', value: company.pan || 'DOTPS3540M' },
            { label: 'GSTIN', value: company.gstin || '19DOTPS3540M1ZZ' },
          ],
          columns: [
            { label: 'DOCUMENT TYPE', widthPct: 30, align: 'left' },
            { label: 'CERTIFICATE NO', widthPct: 24, align: 'left' },
            { label: 'ISSUE DATE', widthPct: 15, align: 'left' },
            { label: 'EXPIRY DATE', widthPct: 15, align: 'left' },
            { label: 'SCAN STORED', widthPct: 16, align: 'right' },
          ],
          rows: (items.length > 0 ? items : vault).map((i) => ({
            line1: [
              i.label,
              i.docNumber || 'Not Entered',
              i.issueDate ? formatDateDDMMYYYY(i.issueDate) : '-',
              i.expiryDate ? formatDateDDMMYYYY(i.expiryDate) : 'Perpetual',
              i.localStorageKey ? 'YES (Vault)' : 'Meta Only',
            ],
            line2: [
              String(i.docType),
              i.portalUrl || '-',
              '',
              '',
              i.updatedAt ? i.updatedAt.slice(0, 10) : '',
            ],
          })),
          totalsLabel: 'STATUTORY COMPLIANCE RECORDS :',
          totalsLine1: ['', '', '', '', `${items.length} Docs`],
        });

        const tradePdf = await generateFoxproStatementPDF(
          buildVaultSpec(
            'D-R-C   W-B   T-R-A-D-E   L-I-C-E-N-S-E  ,  P-T-A-X   &   U-D-Y-A-M',
            'DRC_TRADE_LICENSE_PTAX.pdf',
            tradePtaxItems
          ),
          company,
          'p'
        );
        const kycPdf = await generateFoxproStatementPDF(
          buildVaultSpec(
            'D-R-C   M-A-S-T-E-R   K-Y-C   &   S-T-A-T-U-T-O-R-Y   V-A-U-L-T',
            'DRC_KYC_VAULT.pdf',
            vault
          ),
          company,
          'p'
        );

        await uploadNamedPdfToDrive({
          accessToken: driveAccessToken,
          folderName: 'Declarations',
          fileName: 'DRC_TRADE_LICENSE_PTAX.pdf',
          blob: tradePdf.blob,
        });
        await uploadNamedPdfToDrive({
          accessToken: driveAccessToken,
          folderName: 'Declarations',
          fileName: 'DRC_KYC_VAULT.pdf',
          blob: kycPdf.blob,
        });
        playVerifiedBeep();
        setMsg(
          'Saved DRC_TRADE_LICENSE_PTAX.pdf & DRC_KYC_VAULT.pdf cleanly inside Google Drive -> Declarations!'
        );
      }
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Google Drive upload failed');
    } finally {
      setBusyAction(null);
    }
  };

  // KYC Vault PIN Unlock
  const handleUnlockKycVault = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyAdminPin(pinInput)) {
      setPinUnlocked(true);
      setPinError('');
      setPinInput('');
      playVerifiedBeep();
    } else {
      playAlertBeep();
      setPinError('Invalid Admin PIN. Enter the Master Admin PIN configured in Settings.');
    }
  };

  const handleSelectKycPreset = (docType: KycDocType) => {
    const preset = STATUTORY_DOC_PRESETS.find((p) => p.docType === docType);
    setKycDocType(docType);
    if (preset) {
      setKycLabel(preset.label);
      setKycPortalUrl(preset.portalUrl);
    }
  };

  const handleSaveKycItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kycLabel.trim()) {
      setErr('Please enter a Statutory Document Label.');
      return;
    }

    try {
      setBusyAction('save-kyc');
      const itemId = `kyc_${kycDocType.toLowerCase()}_${Date.now().toString(36)}`;
      let localKey: string | undefined;

      if (kycPendingFile) {
        const uploadCheck = validateSafeUploadFile(kycPendingFile, 'media_docs');
        if (!uploadCheck.valid) {
          playAlertBeep();
          setErr(uploadCheck.reason || 'Unsupported file type blocked by DRC Security Policy.');
          setBusyAction(null);
          return;
        }
        const compressed = await compressComplianceFileToDataUrl(kycPendingFile);
        localKey = `scan_${itemId}`;
        await saveKycPdfLocal({
          key: localKey,
          fileName: kycPendingFile.name,
          mimeType: compressed.mimeType,
          dataUrl: compressed.dataUrl,
          sizeKB: compressed.sizeKB,
          updatedAt: new Date().toISOString(),
        });
      }

      const newItem: KycVaultItem = {
        id: itemId,
        docType: kycDocType,
        label: kycLabel.trim(),
        ...(kycDocNumber.trim() ? { docNumber: kycDocNumber.trim() } : {}),
        ...(kycIssueDate ? { issueDate: kycIssueDate } : {}),
        ...(kycExpiryDate ? { expiryDate: kycExpiryDate } : {}),
        ...(kycPortalUrl.trim() ? { portalUrl: kycPortalUrl.trim() } : {}),
        ...(localKey ? { localStorageKey: localKey } : {}),
        updatedAt: new Date().toISOString(),
      };

      const nextVault = [newItem, ...(company.kycVault || [])];
      await saveSettingsDocument(
        'company',
        {
          kycVault: nextVault,
          ...(ownerUid ? { ownerUid } : company.ownerUid ? { ownerUid: company.ownerUid } : {}),
        },
        Boolean(company.id)
      );

      setKycDocNumber('');
      setKycIssueDate('');
      setKycExpiryDate('');
      setKycPendingFile(null);
      playVerifiedBeep();
      setMsg(`Saved "${newItem.label}" to PIN-Protected Statutory KYC Vault.`);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Failed to save KYC item');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePreviewStoredKyc = async (item: KycVaultItem) => {
    if (!item.localStorageKey) {
      setErr('No scanned PDF/Image file attached for this certificate yet.');
      return;
    }
    const stored = await getKycPdfLocal(item.localStorageKey);
    if (!stored) {
      setErr('Local scan was not found on this browser/device. Re-upload scan or check Drive Declarations folder.');
      return;
    }
    setPreviewStoredFile({ item, file: stored });
  };

  const handleDeleteKycItem = async (item: KycVaultItem) => {
    try {
      if (item.localStorageKey) {
        await deleteKycPdfLocal(item.localStorageKey);
      }
      const nextVault = (company.kycVault || []).filter((v) => v.id !== item.id);
      await saveSettingsDocument(
        'company',
        {
          kycVault: nextVault,
          ...(ownerUid ? { ownerUid } : company.ownerUid ? { ownerUid: company.ownerUid } : {}),
        },
        Boolean(company.id)
      );
      setKycConfirmDeleteId(null);
      playVerifiedBeep();
      setMsg(`Removed "${item.label}" from KYC Vault.`);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Failed to delete KYC item');
    }
  };

  return (
    <div className="space-y-4">
      {/* Monthly GST (7th/8th/15th) & KYC (10/5/2-day) Alarm Strip */}
      {(monthlyAlarms.length > 0 || kycAlarms.length > 0) && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="flex items-start gap-2.5">
            <Bell className="w-5 h-5 text-amber-700 shrink-0 mt-0.5 animate-pulse" />
            <div className="text-xs text-amber-950 space-y-0.5">
              {monthlyAlarms.map((al) => (
                <div key={al.id} className="font-extrabold">
                  [{al.returnType} Due {al.dueDay}th] {al.message}
                </div>
              ))}
              {kycAlarms.slice(0, 3).map((ka) => (
                <div key={ka.id} className="font-bold text-red-800">
                  [{ka.tier.toUpperCase()}] {ka.message}
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              playAlertBeep();
              setShowAlarmModal(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold cursor-pointer"
          >
            View All Alerts ({monthlyAlarms.length + kycAlarms.length})
          </button>
        </div>
      )}

      {/* Main Header & Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              GST Self-Filing Hub, Annual Auditor Pack &amp; Statutory KYC Vault
            </h3>
            <p className="text-xs text-slate-500">
              Uses strictly Billed Invoices + Purchase ITC across All 4 Businesses (FTL + Logistics + PTL + Courier) · Lorry Hire excluded from GST Sales
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
              Challan PMT-06
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="w-48">
            <SearchableSelect
              ariaLabel="Filter GST Filing Month"
              value={selectedMonth}
              onChange={(val) => setSelectedMonth(val)}
              options={[
                { value: 'ALL', label: `All Months (${activeFy})` },
                ...availableMonths.map((m) => ({ value: m, label: `Month: ${m}` })),
              ]}
              buttonClassName="px-2.5 py-1.5 rounded-lg border-slate-300 text-xs font-bold bg-slate-50"
            />
          </div>

          <div className="w-72">
            <SearchableSelect
              ariaLabel="Filter Business Scope"
              value={selectedBusiness}
              onChange={(val) => setSelectedBusiness(val as BusinessFilter)}
              options={[
                { value: 'ALL', label: 'All 4 Businesses (FTL + LOGISTICS + PTL + COURIER)' },
                { value: 'FTL', label: 'FTL Business Only' },
                { value: 'LOGISTICS', label: 'LOGISTICS Division Only' },
                { value: 'PTL', label: 'PTL Business Only' },
                { value: 'COURIER', label: 'COURIER & Parcel Only' },
              ]}
              buttonClassName="px-2.5 py-1.5 rounded-lg border-slate-300 text-xs font-bold bg-slate-50"
            />
          </div>

          <button
            type="button"
            onClick={handleExportGstrJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            GSTR-1 / 3B JSON
          </button>
          <button
            type="button"
            onClick={() => handleExportGstrExcel(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            GSTR Excel
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handlePrintGstHubPdf()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Auto-Print A4 PDF
          </button>
        </div>

        {exportStatus && (
          <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {exportStatus}
          </div>
        )}
        {exportError && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-800 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {exportError}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Billed Docs / CNs</div>
          <div className="text-base font-extrabold text-slate-900 font-mono-num">
            {summary.invoiceCount} / {summary.cnCount}
          </div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3">
          <div className="text-[10px] font-bold uppercase text-blue-700">FCM Taxable</div>
          <div className="text-base font-extrabold text-blue-900 font-mono-num">
            ₹{formatINR(summary.fcmTaxable)}
          </div>
        </div>
        <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-3">
          <div className="text-[10px] font-bold uppercase text-indigo-700">Output FCM GST</div>
          <div className="text-base font-extrabold text-indigo-900 font-mono-num">
            ₹{formatINR(summary.fcmTotalTax)}
          </div>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-3">
          <div className="text-[10px] font-bold uppercase text-amber-800">RCM GTA 5%</div>
          <div className="text-base font-extrabold text-amber-900 font-mono-num">
            ₹{formatINR(summary.rcmTaxable)}
          </div>
          <div className="text-[10px] text-amber-700 font-semibold">
            Recip. ~₹{formatINR(summary.rcmNotionalTax5)}
          </div>
        </div>
        <div className="bg-teal-50 rounded-xl border border-teal-200 p-3">
          <div className="text-[10px] font-bold uppercase text-teal-800">Purchase ITC</div>
          <div className="text-base font-extrabold text-teal-900 font-mono-num">
            ₹{formatINR(summary.purchaseItcTax)}
          </div>
          <div className="text-[10px] text-teal-700 font-semibold">
            {purchaseVouchers.length} Vouchers
          </div>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-3">
          <div className="text-[10px] font-bold uppercase text-emerald-800">Net GST Cash</div>
          <div className="text-base font-extrabold text-emerald-900 font-mono-num">
            ₹{formatINR(summary.netGstCashPayable)}
          </div>
          <div className="text-[10px] text-emerald-700 font-semibold">
            Export 0%: ₹{formatINR(summary.exportExemptTotal)}
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['gstr1', 'GSTR-1 (Outward B2B/B2C)'],
            ['gstr3b', 'GSTR-3B (FCM, RCM & ITC)'],
            ['cdnr', 'CDNR / Export / Exemptions'],
            ['auditorPack', 'Annual Auditor & ITR Pack'],
            ['kycVault', 'PIN Statutory & KYC Vault'],
          ] as Array<[GstSubTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-extrabold border cursor-pointer inline-flex items-center gap-1.5 ${
              subTab === id
                ? id === 'kycVault'
                  ? 'bg-slate-900 text-amber-300 border-slate-900'
                  : 'bg-blue-900 text-white border-blue-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {id === 'kycVault' && (pinUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />)}
            {label}
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: GSTR-1 */}
      {subTab === 'gstr1' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="p-2.5 text-left">Doc No</th>
                <th className="p-2.5 text-left">Date</th>
                <th className="p-2.5 text-left">Business</th>
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
              {filteredBills.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="p-2.5 font-mono-num font-bold text-blue-800">
                    {b.docNo}
                    {b.docKind !== 'Tax Invoice' && (
                      <div className="text-[10px] text-purple-700 font-bold">{b.docKind}</div>
                    )}
                  </td>
                  <td className="p-2.5 font-mono-num">{formatDateDDMMYYYY(b.docDate)}</td>
                  <td className="p-2.5">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">
                      {b.businessMode}
                    </span>
                  </td>
                  <td className="p-2.5">
                    <div className="font-bold text-slate-900">{b.partyName}</div>
                    <div className="text-[10px] text-slate-500 font-mono-num">
                      {b.partyGstin || b.billingCountry || 'URP'}
                    </div>
                  </td>
                  <td className="p-2.5 text-[11px] font-semibold">
                    {b.reverseCharge ? 'RCM 5% (Recipient)' : b.gstPaidBy || 'FCM'}
                  </td>
                  <td className="p-2.5 text-right font-mono-num">{formatINR(b.taxableValue)}</td>
                  <td className="p-2.5 text-right font-mono-num">{formatINR(b.cgstAmt)}</td>
                  <td className="p-2.5 text-right font-mono-num">{formatINR(b.sgstAmt)}</td>
                  <td className="p-2.5 text-right font-mono-num">{formatINR(b.igstAmt)}</td>
                  <td className="p-2.5 text-right font-mono-num font-extrabold">{formatINR(b.grandTotal)}</td>
                </tr>
              ))}
              {filteredBills.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-500">
                    No billed invoices matched the selected month / business scope filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUB-TAB 2: GSTR-3B WITH PURCHASE ITC */}
      {subTab === 'gstr3b' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-slate-800">
                GSTR-3B Consolidated Summary (Outward Sales + Purchase ITC)
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyTaggedItcPurchases}
                    onChange={(e) => setOnlyTaggedItcPurchases(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Only GST/Purchase-tagged vouchers
                </label>
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-slate-600">ITC Slab %:</span>
                  <div className="w-44">
                    <SearchableSelect
                      ariaLabel="ITC Slab Percentage"
                      value={String(itcRatePct)}
                      onChange={(val) => setItcRatePct(Number(val))}
                      sortAlphabetically={false}
                      options={[
                        { value: '18', label: '18% Standard' },
                        { value: '12', label: '12% Transport/Machinery' },
                        { value: '5', label: '5% Basic' },
                        { value: '0', label: '0% Exempt / None' },
                      ]}
                      buttonClassName="!py-1 !text-xs !font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>

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
                    3.1(a) Outward Taxable Supplies (Forward Charge GTA / Logistics / PTL / Courier)
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
                <tr className="bg-teal-50/60">
                  <td className="p-2.5 font-sans font-bold text-teal-900">
                    4(A) Eligible Input Tax Credit (Purchase / Expense Vouchers: {purchaseVouchers.length})
                  </td>
                  <td className="p-2.5 text-right">{formatINR(summary.purchaseTaxableBase)}</td>
                  <td className="p-2.5 text-right">0.00</td>
                  <td className="p-2.5 text-right">{formatINR(summary.purchaseItcTax / 2)}</td>
                  <td className="p-2.5 text-right">{formatINR(summary.purchaseItcTax / 2)}</td>
                  <td className="p-2.5 text-right font-extrabold text-teal-900">
                    -{formatINR(summary.purchaseItcTax)}
                  </td>
                </tr>
                <tr className="bg-blue-50 font-extrabold">
                  <td className="p-2.5 font-sans text-blue-950">
                    6.1 Net Outward GST Cash Payable via Challan PMT-06 (Output FCM Tax - Purchase ITC)
                  </td>
                  <td className="p-2.5 text-right">-</td>
                  <td className="p-2.5 text-right">-</td>
                  <td className="p-2.5 text-right">-</td>
                  <td className="p-2.5 text-right">-</td>
                  <td className="p-2.5 text-right text-blue-950 text-sm">
                    ₹{formatINR(summary.netGstCashPayable)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: CDNR / EXPORT / EXEMPTIONS */}
      {subTab === 'cdnr' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 text-xs text-slate-700">
          <div className="font-extrabold text-slate-900">
            CDNR (Credit / Debit Notes), Export &amp; Unregistered Supply Reconciliation ({filteredBills.length} Total Docs)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Credit / Debit Notes</div>
              <div className="text-sm font-extrabold font-mono-num text-purple-800">
                {filteredBills.filter((b) => b.docKind !== 'Tax Invoice').length} Docs · ₹{formatINR(summary.creditNoteTotal)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Export 0% Bills</div>
              <div className="text-sm font-extrabold font-mono-num text-emerald-800">
                {filteredBills.filter((i) => /^(Nepal|Bangladesh|Bhutan)$/i.test(i.billingCountry)).length} · ₹
                {formatINR(summary.exportExemptTotal)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">RCM 5% Bills</div>
              <div className="text-sm font-extrabold font-mono-num text-amber-800">
                {filteredBills.filter((i) => i.reverseCharge).length} · ₹{formatINR(summary.rcmTaxable)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Pending Payment Bills</div>
              <div className="text-sm font-extrabold font-mono-num text-rose-800">
                {filteredBills.filter((i) => i.status !== 'Paid').length} · ₹{formatINR(summary.grandTotal)}
              </div>
            </div>
          </div>

          {filteredBills.some((b) => b.docKind !== 'Tax Invoice') && (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 text-left">Note No</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Business</th>
                    <th className="p-2 text-left">Party</th>
                    <th className="p-2 text-left">Against Invoice</th>
                    <th className="p-2 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBills
                    .filter((b) => b.docKind !== 'Tax Invoice')
                    .map((n) => (
                      <tr key={n.id}>
                        <td className="p-2 font-mono-num font-bold text-purple-800">{n.docNo}</td>
                        <td className="p-2 font-bold">{n.docKind}</td>
                        <td className="p-2 font-mono-num">{formatDateDDMMYYYY(n.docDate)}</td>
                        <td className="p-2">{n.businessMode}</td>
                        <td className="p-2">{n.partyName}</td>
                        <td className="p-2 font-mono-num">{n.linkedDocNo || '-'}</td>
                        <td className="p-2 text-right font-mono-num font-bold">{formatINR(n.grandTotal)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: ANNUAL AUDITOR & ITR PACK */}
      {subTab === 'auditorPack' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-extrabold text-slate-900">
                1-Click Annual Auditor &amp; Income Tax (ITR) Pack — FY {activeFy}
              </h4>
              <p className="text-xs text-slate-500">
                Select columns/ledgers below, Auto-Print low-KB A4 PDFs, export Excel, and save{' '}
                <code className="font-bold">DRC_GST_RETURNS.pdf</code> &amp;{' '}
                <code className="font-bold">DRC_IT_RETURN_AUDIT.pdf</code> separately to Google Drive.
              </p>
            </div>
          </div>

          {/* Pre-Export Column / Ledger Selector */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="text-xs font-extrabold text-slate-800 uppercase tracking-wide">
              Pre-Export Ledger &amp; Column Selector
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              {(
                [
                  ['includeSalesRegister', '1. GSTR-1 Sales Register (Billed Only)'],
                  ['includeGstr3bSummary', '2. GSTR-3B Tax & RCM 5% Summary'],
                  ['includePurchaseItc', '3. Purchase & Expense ITC Ledger'],
                  ['includeItReturnSummary', '4. Annual 4-Business ITR & TDS Summary'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 font-bold text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={packColumns[key]}
                    onChange={(e) =>
                      setPackColumns((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    className="rounded border-slate-300"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 4-Business Combined Turnover Matrix */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="p-2.5 text-left">Business Division</th>
                  <th className="p-2.5 text-right">Billed Invoices / Notes</th>
                  <th className="p-2.5 text-right">Taxable Turnover (₹)</th>
                  <th className="p-2.5 text-right">GST Collected (₹)</th>
                  <th className="p-2.5 text-right">Gross Billed Value (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-num">
                {(['FTL', 'LOGISTICS', 'PTL', 'COURIER'] as BusinessMode[]).map((div) => (
                  <tr key={div}>
                    <td className="p-2.5 font-sans font-extrabold text-slate-900">{div}</td>
                    <td className="p-2.5 text-right">{summary.byDivision[div].count}</td>
                    <td className="p-2.5 text-right">{formatINR(summary.byDivision[div].taxable)}</td>
                    <td className="p-2.5 text-right">{formatINR(summary.byDivision[div].tax)}</td>
                    <td className="p-2.5 text-right font-bold">{formatINR(summary.byDivision[div].total)}</td>
                  </tr>
                ))}
                <tr className="bg-blue-50 font-extrabold">
                  <td className="p-2.5 font-sans text-blue-950">ALL 4 BUSINESSES COMBINED</td>
                  <td className="p-2.5 text-right">{summary.invoiceCount}</td>
                  <td className="p-2.5 text-right">{formatINR(summary.grossSalesExclTax)}</td>
                  <td className="p-2.5 text-right">{formatINR(summary.fcmTotalTax)}</td>
                  <td className="p-2.5 text-right text-blue-950">₹{formatINR(summary.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
              <div className="text-[10px] font-bold uppercase text-indigo-700">Operating Expenses (ITR)</div>
              <div className="text-base font-extrabold font-mono-num text-indigo-950">
                ₹{formatINR(summary.totalExpenseForItr)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-[10px] font-bold uppercase text-amber-800">194C TDS Recorded</div>
              <div className="text-base font-extrabold font-mono-num text-amber-950">
                ₹{formatINR(summary.totalTdsDeducted)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-[10px] font-bold uppercase text-emerald-700">Est. Annual Net Surplus</div>
              <div className="text-base font-extrabold font-mono-num text-emerald-950">
                ₹{formatINR(summary.estimatedNetProfit)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handlePrintAuditorPack()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-800 hover:bg-blue-900 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              {busyAction === 'auditor-print'
                ? 'Generating PDF...'
                : 'Preview & Auto-Print Auditor Pack (A4 PDF)'}
            </button>

            <button
              type="button"
              onClick={() => handleExportGstrExcel(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Annual Auditor &amp; ITR Excel
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleSaveStatutoryPdfsToDrive('gstAndItr')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-black disabled:opacity-60 text-amber-300 text-xs font-extrabold cursor-pointer"
            >
              <CloudUpload className="w-4 h-4" />
              {busyAction === 'gstAndItr'
                ? 'Uploading to Google Drive...'
                : driveAccessToken
                ? 'Save DRC_GST_RETURNS.pdf & DRC_IT_RETURN_AUDIT.pdf to Drive'
                : 'Connect Drive & Save GST/ITR PDFs'}
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={async () => {
                try {
                  setBusyAction('blueprint');
                  const pdf = await generateAppFormatBlueprintPDF(company, 'p');
                  onPreviewPdf(pdf, 'Reports_Ledgers');
                  if (driveAccessToken) {
                    await uploadBlueprintPdfToDrive(driveAccessToken, pdf.blob);
                    setMsg(
                      `Generated 3-Page DRC_APP_FORMAT_BLUEPRINT.pdf (${pdf.sizeKB} KB) & synced to Drive (${BACKUP_ISOLATED_DRIVE_EMAIL})!`
                    );
                  } else {
                    setMsg(`Generated compact 3-Page DRC_APP_FORMAT_BLUEPRINT.pdf (${pdf.sizeKB} KB) for preview/print.`);
                  }
                  playVerifiedBeep();
                } catch (err) {
                  setErr(err instanceof Error ? err.message : 'Failed to generate Blueprint PDF');
                } finally {
                  setBusyAction(null);
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              {busyAction === 'blueprint'
                ? 'Building 3-Page Blueprint...'
                : '3-Page DRC_APP_FORMAT_BLUEPRINT.pdf'}
            </button>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: PIN-PROTECTED STATUTORY COMPLIANCE & MASTER KYC VAULT */}
      {subTab === 'kycVault' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          {!pinUnlocked ? (
            <form
              onSubmit={handleUnlockKycVault}
              className="max-w-md mx-auto my-6 p-5 rounded-2xl border-2 border-slate-300 bg-slate-50 space-y-3 text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-extrabold text-slate-900">
                PIN-Protected Statutory Compliance &amp; Master KYC Vault
              </h4>
              <p className="text-xs text-slate-600">
                Stores WB Trade License, WB P-Tax, Udyam MSME, GST REG-06, PAN, Aadhaar &amp; Vehicle Papers with 10 / 5 / 2-day renewal alerts.
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="Enter Master Admin PIN"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-bold bg-white"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-800 hover:bg-blue-900 text-white text-xs font-extrabold cursor-pointer"
                >
                  Unlock Vault
                </button>
              </div>
              {pinError && <div className="text-xs font-bold text-red-600">{pinError}</div>}
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div>
                  <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-emerald-700" />
                    Statutory Compliance &amp; Master KYC Vault (Unlocked)
                  </h4>
                  <p className="text-xs text-slate-500">
                    Scans stored compressed offline + uploaded cleanly to Google Drive (<code className="font-bold">Declarations</code> folder). Never stores large base64 files in Firestore.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleSaveStatutoryPdfsToDrive('tradeAndKyc')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-black text-amber-300 text-xs font-extrabold cursor-pointer"
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    {busyAction === 'tradeAndKyc'
                      ? 'Uploading...'
                      : 'Save DRC_TRADE_LICENSE_PTAX.pdf & DRC_KYC_VAULT.pdf'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinUnlocked(false)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Lock Vault
                  </button>
                </div>
              </div>

              {/* Official Gov Portal Presets */}
              <div className="flex flex-wrap gap-1.5">
                {STATUTORY_DOC_PRESETS.map((preset) => (
                  <button
                    key={preset.docType}
                    type="button"
                    onClick={() => handleSelectKycPreset(preset.docType)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                      kycDocType === preset.docType
                        ? 'bg-blue-900 text-white border-blue-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    + {preset.docType.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>

              {/* Direct Gov Portal Links */}
              <div className="flex flex-wrap gap-2">
                <a
                  href="https://silpasathi.wb.gov.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-bold"
                >
                  <ExternalLink className="w-3 h-3" /> WB Trade License (Silpasathi)
                </a>
                <a
                  href="https://wbcomtax.gov.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 border border-blue-200 text-blue-900 text-[11px] font-bold"
                >
                  <ExternalLink className="w-3 h-3" /> WB P-Tax Portal
                </a>
                <a
                  href="https://udyamregistration.gov.in/Udyam_Verify.aspx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-900 text-[11px] font-bold"
                >
                  <ExternalLink className="w-3 h-3" /> Udyam Verify / Download
                </a>
              </div>

              {/* Upload / Add KYC Entry Form */}
              <form
                onSubmit={(e) => void handleSaveKycItem(e)}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-6 gap-2.5 items-end"
              >
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Document Name / Label *
                  </label>
                  <input
                    value={kycLabel}
                    onChange={(e) => setKycLabel(e.target.value)}
                    placeholder="WB Trade License / P-Tax / Udyam..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Certificate / Reg No
                  </label>
                  <input
                    value={kycDocNumber}
                    onChange={(e) => setKycDocNumber(e.target.value)}
                    placeholder="License / Reg No"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono-num bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Issue Date
                  </label>
                  <input
                    type="date"
                    value={kycIssueDate}
                    onChange={(e) => setKycIssueDate(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Expiry Date (10/5/2d Alert)
                  </label>
                  <input
                    type="date"
                    value={kycExpiryDate}
                    onChange={(e) => setKycExpiryDate(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Attach PDF / Photo Scan
                  </label>
                  <label className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-blue-400 bg-blue-50 text-blue-900 text-xs font-bold cursor-pointer truncate">
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{kycPendingFile ? kycPendingFile.name : 'Choose File'}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) {
                          setKycPendingFile(null);
                          return;
                        }
                        const check = validateSafeUploadFile(file, 'media_docs');
                        if (!check.valid) {
                          playAlertBeep();
                          setErr(check.reason || 'Unsupported file blocked by DRC Security Policy.');
                          e.target.value = '';
                          return;
                        }
                        setErr('');
                        setKycPendingFile(file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="md:col-span-4">
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Official Gov Verification Portal URL
                  </label>
                  <input
                    value={kycPortalUrl}
                    onChange={(e) => setKycPortalUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={busyAction === 'save-kyc'}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    {busyAction === 'save-kyc' ? 'Compressing & Saving...' : 'Save Document to Vault'}
                  </button>
                </div>
              </form>

              {/* Vault Documents Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="p-2.5 text-left">Document &amp; Type</th>
                      <th className="p-2.5 text-left">Certificate No</th>
                      <th className="p-2.5 text-left">Issue / Expiry</th>
                      <th className="p-2.5 text-left">Portal</th>
                      <th className="p-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(company.kycVault || []).map((item) => {
                      const matchingAlarm = kycAlarms.find((a) => a.id === item.id);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="p-2.5">
                            <div className="font-extrabold text-slate-900">{item.label}</div>
                            <div className="text-[10px] text-slate-500">{item.docType}</div>
                          </td>
                          <td className="p-2.5 font-mono-num font-bold">{item.docNumber || '-'}</td>
                          <td className="p-2.5">
                            <div>
                              Issue: {item.issueDate ? formatDateDDMMYYYY(item.issueDate) : '-'} · Exp:{' '}
                              {item.expiryDate ? formatDateDDMMYYYY(item.expiryDate) : 'Perpetual'}
                            </div>
                            {matchingAlarm && (
                              <span
                                className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                  matchingAlarm.tier === 'expired' || matchingAlarm.tier === '2-day'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {matchingAlarm.title}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5">
                            {item.portalUrl ? (
                              <a
                                href={item.portalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-700 hover:underline font-bold"
                              >
                                <ExternalLink className="w-3 h-3" /> Open Portal
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="p-2.5 text-right space-x-1.5">
                            {item.localStorageKey && (
                              <button
                                type="button"
                                onClick={() => void handlePreviewStoredKyc(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-900 font-bold cursor-pointer"
                              >
                                <Eye className="w-3 h-3" /> View Scan
                              </button>
                            )}
                            {kycConfirmDeleteId === item.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteKycItem(item)}
                                  className="px-2 py-1 rounded bg-red-700 text-white font-bold cursor-pointer"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setKycConfirmDeleteId(null)}
                                  className="px-2 py-1 rounded bg-slate-200 text-slate-700 font-bold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setKycConfirmDeleteId(item.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" /> Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {(company.kycVault || []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500">
                          No statutory certificates saved yet. Pick a preset above (WB Trade License, P-Tax, Udyam, GST, PAN, Aadhaar, Vehicle Papers) and upload a scan.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly GST & KYC Pre-Expiry Popup Alarm Modal */}
      {showAlarmModal && (monthlyAlarms.length > 0 || kycAlarms.length > 0) && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="bg-amber-600 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-extrabold text-sm">
                <CalendarClock className="w-5 h-5" />
                Statutory Compliance &amp; Filing Alerts
              </div>
              <button
                type="button"
                onClick={() => setShowAlarmModal(false)}
                className="p-1 rounded hover:bg-white/20 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5 max-h-[65vh] overflow-y-auto text-xs">
              {monthlyAlarms.map((al) => (
                <div
                  key={al.id}
                  className="p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-1"
                >
                  <div className="font-extrabold text-amber-950 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-700" />
                    {al.title}
                  </div>
                  <p className="text-amber-900">{al.message}</p>
                </div>
              ))}
              {kycAlarms.map((ka) => (
                <div
                  key={ka.id}
                  className={`p-3 rounded-xl border space-y-1 ${
                    ka.tier === 'expired' || ka.tier === '2-day'
                      ? 'bg-red-50 border-red-300 text-red-950'
                      : 'bg-orange-50 border-orange-300 text-orange-950'
                  }`}
                >
                  <div className="font-extrabold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {ka.title}
                  </div>
                  <p>{ka.message}</p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              {kycAlarms.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('kycVault');
                    setShowAlarmModal(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-amber-300 text-xs font-extrabold cursor-pointer"
                >
                  Open KYC Vault
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAlarmModal(false)}
                className="px-4 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-extrabold cursor-pointer"
              >
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local KYC Scan Inline Preview Modal */}
      {previewStoredFile && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="text-xs font-extrabold truncate">
                {previewStoredFile.item.label} ({previewStoredFile.file.sizeKB} KB)
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewStoredFile.file.dataUrl}
                  download={previewStoredFile.file.fileName}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-bold"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewStoredFile(null)}
                  className="p-1 rounded hover:bg-white/20 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-slate-100 flex items-center justify-center">
              {previewStoredFile.file.mimeType === 'application/pdf' ? (
                <iframe
                  title={previewStoredFile.item.label}
                  src={previewStoredFile.file.dataUrl}
                  className="w-full h-[70vh] rounded border border-slate-300 bg-white"
                />
              ) : (
                <img
                  src={previewStoredFile.file.dataUrl}
                  alt={previewStoredFile.item.label}
                  className="max-w-full max-h-[70vh] rounded shadow"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
