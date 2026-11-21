import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  FileCheck2,
  FileSpreadsheet,
  Keyboard,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Trash2,
} from 'lucide-react';
import {
  BillCopyCount,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Driver,
  DriveFolderName,
  Invoice,
  InvoiceConsignmentRow,
  LorryHire,
  Party,
  Quotation,
} from '../types/erp';
import {
  amountToIndianWords,
  formatDateDDMMYYYY,
  formatINR,
  getDynamicFinancialYear,
  getFyShortCode,
  makeSafeDocId,
  normalizeFyLabel,
  todayISO,
} from '../lib/formatters';
import {
  GeneratedPdfResult,
  generateDeclaration194CPDF,
  generateInvoicePDF,
  generateQuotationPDF,
} from '../lib/pdfEngine';
import { scanPhysicalLR } from '../lib/ocrEngine';
import {
  logBranchActivity,
  removeDocument,
  reserveNextSerialNumber,
  upsertDocument,
} from '../lib/firestoreStore';
import {
  ALL_INDIA_BRANCH_OPTIONS,
  ALL_INDIA_STATES_DISTRICTS,
  BILL_FOOTNOTE_PRESETS,
  BILL_REMARK_PRESETS,
  COMMON_REMARK_PRESETS,
  PAYMENT_MODE_OPTIONS,
  getEffectiveDropdownList,
} from '../lib/dropdownMasterStore';
import { playVerifiedBeep } from '../lib/audioFeedback';
import {
  filterBillingCustomerParties,
  resolveGstStateCode,
} from '../lib/partySeparation';
import {
  PRIORITY_CORRIDOR_REGIONS,
  buildEmailShareHref,
  buildOverdueBillMessage,
  buildWhatsAppShareHref,
  getInvoicePendingDays,
  triggerExternalShareLink,
} from '../lib/shareUtils';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { EditableSearchSelect } from './EditableSearchSelect';
import { SearchableSelect } from './SearchableSelect';
import {
  EntityQuickPreviewCard,
  formatPartyDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';

interface BillingQuotesModuleProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
  readOnly?: boolean;
  quotationsAccess?: 'edit' | 'view' | 'blocked';
  declarationsAccess?: 'edit' | 'view' | 'blocked';
  initialSubTab?: 'invoice' | 'quotation' | '194c';
  invoices: Invoice[];
  quotations: Quotation[];
  declarations: Declaration194C[];
  consignments: ConsignmentNote[];
  parties: Party[];
  drivers?: Driver[];
  lorryHires?: LorryHire[];
  company: CompanySettings;
  pendingCnForInvoice: ConsignmentNote | null;
  onClearPendingCn: () => void;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: DriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const QUICK_CORRIDOR_DESTINATIONS = [
  'KOLKATA to SILIGURI',
  'KOLKATA to GUWAHATI (ASSAM)',
  'KOLKATA to COOCH BEHAR',
  'KOLKATA to ALIPURDUAR',
  'KOLKATA to MALDA',
  'KOLKATA to RAIGANJ',
  'KOLKATA to PATNA (BIHAR)',
  'KOLKATA to BHUBANESWAR (ODISHA)',
  'KOLKATA to RANCHI (JHARKHAND)',
  'KOLKATA to CHENNAI (TAMIL NADU)',
  'KOLKATA to BIRGUNJ / KATHMANDU (NEPAL)',
  'KOLKATA to BENAPOLE / DHAKA (BANGLADESH)',
  'KOLKATA to PHUENTSHOLING / THIMPHU (BHUTAN)',
];

const BillingQuotesModuleInner: React.FC<BillingQuotesModuleProps> = ({
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  activeFy,
  isMasterAdmin,
  readOnly = false,
  quotationsAccess = 'edit',
  declarationsAccess = 'edit',
  initialSubTab = 'invoice',
  invoices,
  quotations,
  declarations,
  consignments,
  parties,
  drivers = [],
  lorryHires = [],
  company,
  pendingCnForInvoice,
  onClearPendingCn,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [subTab, setSubTab] = useState<'invoice' | 'quotation' | '194c'>(() => {
    if (initialSubTab === 'quotation' && quotationsAccess === 'blocked') return 'invoice';
    if (initialSubTab === '194c' && declarationsAccess === 'blocked') return 'invoice';
    return initialSubTab;
  });
  useEffect(() => {
    if (!initialSubTab) return;
    if (initialSubTab === 'quotation' && quotationsAccess === 'blocked') {
      setSubTab('invoice');
      return;
    }
    if (initialSubTab === '194c' && declarationsAccess === 'blocked') {
      setSubTab('invoice');
      return;
    }
    setSubTab(initialSubTab);
  }, [initialSubTab, quotationsAccess, declarationsAccess]);

  const quotationReadOnly = quotationsAccess !== 'edit';
  const declarationReadOnly = declarationsAccess !== 'edit';

  const availableBanks = useMemo(() => {
    if (company.bankAccounts && company.bankAccounts.length > 0) {
      return company.bankAccounts;
    }
    return [
      {
        id: 'default-pnb',
        accountName: `${company.bankName || 'Punjab National Bank'} (Primary)`,
        bankName: company.bankName || 'Punjab National Bank',
        branch: company.bankBranch || 'Kolkata',
        accountNo: company.accountNo || '',
        ifsc: company.ifsc || '',
        swift: company.swift || '',
        upiId: company.upiId || '',
        isDefault: true,
      },
    ];
  }, [company]);

  const [selectedBankId, setSelectedBankId] = useState<string>(
    () => availableBanks.find((b) => b.isDefault)?.id || availableBanks[0]?.id || ''
  );
  useEffect(() => {
    if (availableBanks.length === 0) return;
    if (!availableBanks.some((b) => b.id === selectedBankId)) {
      setSelectedBankId(availableBanks.find((b) => b.isDefault)?.id || availableBanks[0]?.id || '');
    }
  }, [availableBanks, selectedBankId]);
  const effectiveGoodsList = useMemo(
    () => getEffectiveDropdownList(company, 'goodsTypes'),
    [company]
  );

  const lrScanRef = useRef<HTMLInputElement | null>(null);
  const billDateInputRef = useRef<HTMLInputElement | null>(null);
  const remarksInputRef = useRef<HTMLInputElement | null>(null);
  const saveInvBtnRef = useRef<HTMLButtonElement | null>(null);
  const fyShort = getFyShortCode(activeFy);

  // ---- TAX INVOICE STATE ----
  const branchTag = activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode.slice(0, 3) : 'KOL';
  const defaultBranchLabel =
    activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode : 'KOLKATA';
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingOriginalPaidAmount, setEditingOriginalPaidAmount] = useState(0);
  const [invDivision, setInvDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [autoAtomicInvoice, setAutoAtomicInvoice] = useState(true);
  const [billedAtBranch, setBilledAtBranch] = useState(defaultBranchLabel);
  const [billId, setBillId] = useState(() => String(105 + invoices.length));
  const [billedByCode, setBilledByCode] = useState<'B' | 'P'>('B');
  const [finalizeBill, setFinalizeBill] = useState(true);
  const [invoiceNo, setInvoiceNo] = useState(`${branchTag}/${105 + invoices.length}/${fyShort}`);
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [partyName, setPartyName] = useState('');
  const [selectedInvPartyId, setSelectedInvPartyId] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyGstin, setPartyGstin] = useState('');
  const [partyStateCode, setPartyStateCode] = useState('');
  const [partyPan, setPartyPan] = useState('');
  const [billingCountry, setBillingCountry] = useState<'India' | 'Nepal' | 'Bangladesh' | 'Bhutan'>('India');
  const [sac, setSac] = useState(company.hsn || '996791');
  const [reverseCharge, setReverseCharge] = useState(true);
  const [gstPaidBy, setGstPaidBy] = useState<'Consignee' | 'Consignor' | 'Transporter' | 'Others'>('Consignee');
  const [gstRate, setGstRate] = useState(5);
  const [interstate, setInterstate] = useState(false);
  const [copyCount, setCopyCount] = useState<BillCopyCount>(1);
  const [invValidationError, setInvValidationError] = useState<string | null>(null);
  const [insuranceCharge, setInsuranceCharge] = useState('0');
  const [collCharge, setCollCharge] = useState('0');
  const [loadingCharge, setLoadingCharge] = useState('0');
  const [detentionCharges, setDetentionCharges] = useState('0');
  const [unloadingCharges, setUnloadingCharges] = useState('0');
  const [surchargeAmt, setSurchargeAmt] = useState('0');
  const [stCharges, setStCharges] = useState('0');
  const [fumigationCharge, setFumigationCharge] = useState('0');
  const [extraCharge, setExtraCharge] = useState('0');
  const [advanceReceived, setAdvanceReceived] = useState('0');
  const [advanceMode, setAdvanceMode] = useState('NEFT');
  const [fullPaymentReceived, setFullPaymentReceived] = useState(false);
  const [fullPaymentMode, setFullPaymentMode] = useState('NEFT');
  const [remarks, setRemarks] = useState('');
  const [billFootnote, setBillFootnote] = useState(BILL_FOOTNOTE_PRESETS[0] || '');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [includeAnnexure, setIncludeAnnexure] = useState(true);
  const [rows, setRows] = useState<InvoiceConsignmentRow[]>([
    {
      cnNo: '',
      cnDate: todayISO(),
      vehicle: '',
      from: 'KOLKATA',
      to: '',
      weight: 0,
      packages: '',
      rateType: 'Fixed',
      ratePerMt: 0,
      freight: 0,
      description: '',
    },
  ]);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [showCnPicker, setShowCnPicker] = useState(false);
  const [biltyModalOpen, setBiltyModalOpen] = useState(false);
  const [biltyCursorIdx, setBiltyCursorIdx] = useState(0);
  const [selectedModalCnIds, setSelectedModalCnIds] = useState<string[]>([]);
  const [cnPickerSearch, setCnPickerSearch] = useState('');
  const debouncedCnPickerSearch = useDebouncedValue(cnPickerSearch, 200);
  const [savingInv, setSavingInv] = useState(false);

  const [invSearch, setInvSearch] = useState('');
  const debouncedInvSearch = useDebouncedValue(invSearch, 200);

  const isExportCountry = billingCountry !== 'India';

  const detectCountryFromText = (
    text: string
  ): 'Nepal' | 'Bangladesh' | 'Bhutan' | null => {
    const t = String(text || '');
    if (/\b(nepal|birgunj|kathmandu|kakarvitta|biratnagar|bhairahawa|pokhara|nepalgunj)\b/i.test(t)) {
      return 'Nepal';
    }
    if (/\b(bangladesh|dhaka|benapole|chattogram|chittagong|burimari|hili|sylhet|bhomra)\b/i.test(t)) {
      return 'Bangladesh';
    }
    if (/\b(bhutan|phuentsholing|thimphu|pasakha|paro|gelephu|samtse)\b/i.test(t)) {
      return 'Bhutan';
    }
    return null;
  };

  const applyAutoGstRules = (
    nextCountry: 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan',
    nextGstin: string,
    nextPaidBy = gstPaidBy
  ) => {
    if (nextCountry !== 'India') {
      setInterstate(false);
      setGstRate(0);
      setReverseCharge(false);
      return;
    }
    const cleanGst = nextGstin.trim().toUpperCase();
    if (/^19/.test(cleanGst)) {
      setInterstate(false);
      setGstRate(5);
    } else if (/^(0[1-9]|[1-3][0-9])/.test(cleanGst)) {
      setInterstate(true);
      setGstRate(5);
    } else {
      setGstRate((prev) => (prev === 0 ? 5 : prev));
    }
    if (nextPaidBy === 'Transporter') {
      setReverseCharge(false);
    } else if (nextPaidBy === 'Consignee' || nextPaidBy === 'Consignor') {
      setReverseCharge(true);
    }
  };

  // Auto-paste CN sent from ConsignmentModule
  useEffect(() => {
    if (!pendingCnForInvoice) return;
    setSubTab('invoice');
    if (pendingCnForInvoice.division === 'LOGISTICS') {
      setInvDivision('LOGISTICS');
    }
    const targetBillingName =
      pendingCnForInvoice.billingPartyName?.trim() || pendingCnForInvoice.consignorName;

    let resolvedCountry = billingCountry;
    let resolvedGstin = partyGstin;

    if (!partyName && targetBillingName) {
      const matched = parties.find(
        (p) => p.name.trim().toLowerCase() === targetBillingName.trim().toLowerCase()
      );
      const isConsignor =
        targetBillingName.trim().toLowerCase() ===
        pendingCnForInvoice.consignorName.trim().toLowerCase();
      const isConsignee =
        targetBillingName.trim().toLowerCase() ===
        pendingCnForInvoice.consigneeName.trim().toLowerCase();
      const nextAddr =
        matched?.address ||
        (isConsignor
          ? pendingCnForInvoice.consignorAddress || ''
          : isConsignee
            ? pendingCnForInvoice.consigneeAddress || ''
            : '');
      const nextGstin =
        matched?.gstin || (isConsignor ? pendingCnForInvoice.consignorGstin || '' : '');
      const detectedCountry =
        detectCountryFromText(`${pendingCnForInvoice.toState || ''} ${nextAddr}`) || 'India';
      resolvedCountry = detectedCountry;
      resolvedGstin = nextGstin;

      const stInfo = resolveGstStateCode(nextGstin, nextAddr, detectedCountry);
      setPartyName(matched?.name || targetBillingName);
      setSelectedInvPartyId(matched?.id || '');
      setPartyAddress(nextAddr);
      setPartyGstin(nextGstin);
      setPartyStateCode(stInfo.code);
      setBillingCountry(detectedCountry);
      if (matched?.pan) setPartyPan(matched.pan);
    }

    const rawGstPaid = String(pendingCnForInvoice.gstPaidBy || 'Consignee').trim();
    const normPaidBy: 'Consignee' | 'Consignor' | 'Transporter' | 'Others' = rawGstPaid.startsWith('Consignor')
      ? 'Consignor'
      : rawGstPaid.startsWith('Transporter')
        ? 'Transporter'
        : rawGstPaid.startsWith('Others')
          ? 'Others'
          : 'Consignee';
    setGstPaidBy(normPaidBy);
    applyAutoGstRules(resolvedCountry, resolvedGstin, normPaidBy);

    if (pendingCnForInvoice.creditDays && pendingCnForInvoice.creditDays > 0) {
      const baseDate = new Date(invoiceDate || todayISO());
      if (!Number.isNaN(baseDate.getTime())) {
        baseDate.setDate(baseDate.getDate() + pendingCnForInvoice.creditDays);
        setDueDate(baseDate.toISOString().slice(0, 10));
      }
    }

    const isPerTon = /ton|mt/i.test(pendingCnForInvoice.rateMode || '');
    const pkgText = [pendingCnForInvoice.packages, pendingCnForInvoice.packageMode?.split(' ')[0]]
      .filter(Boolean)
      .join(' ');

    const newRow: InvoiceConsignmentRow = {
      cnNo: pendingCnForInvoice.cnNo,
      cnDate: pendingCnForInvoice.cnDate,
      vehicle: pendingCnForInvoice.truckNo,
      from: pendingCnForInvoice.fromCity,
      to: pendingCnForInvoice.toCity,
      weight: Number(pendingCnForInvoice.nettWeight || 0),
      packages: pkgText,
      rateType: isPerTon ? 'Per Ton' : 'Fixed',
      ratePerMt: Number(pendingCnForInvoice.ratePerUnit || pendingCnForInvoice.totalFreight || 0),
      freight: Number(pendingCnForInvoice.totalFreight || 0),
      description: pendingCnForInvoice.particulars || 'GOODS TRANSPORT',
    };
    setRows((prev) => {
      const cleaned = prev.filter((r) => r.cnNo || r.freight > 0);
      return [...cleaned, newRow];
    });
    setScanMsg(
      `Auto-pasted CN ${pendingCnForInvoice.cnNo} (${targetBillingName}${pendingCnForInvoice.creditDays ? ` · ${pendingCnForInvoice.creditDays} Days Credit` : ''}) into Tax Invoice.`
    );
    onClearPendingCn();
  }, [pendingCnForInvoice, onClearPendingCn, partyName, parties, invoiceDate, billingCountry, partyGstin]);

  const freightSum = useMemo(
    () => rows.reduce((s, r) => s + Number(r.freight || 0), 0),
    [rows]
  );

  const insNum = Math.max(0, Number(insuranceCharge) || 0);
  const collNum = Math.max(0, Number(collCharge) || 0);
  const loadChgNum = Math.max(0, Number(loadingCharge) || 0);
  const detNum = Math.max(0, Number(detentionCharges) || 0);
  const unlNum = Math.max(0, Number(unloadingCharges) || 0);
  const surchgNum = Math.max(0, Number(surchargeAmt) || 0);
  const stNum = Math.max(0, Number(stCharges) || 0);
  const fumNum = Math.max(0, Number(fumigationCharge) || 0);
  const extraChgNum = Math.max(0, Number(extraCharge) || 0);
  const taxableSubtotal =
    freightSum +
    insNum +
    collNum +
    loadChgNum +
    detNum +
    unlNum +
    surchgNum +
    stNum +
    fumNum +
    extraChgNum;
  const effectiveGstRate = isExportCountry ? 0 : gstRate;
  const totalTax = Number(((taxableSubtotal * effectiveGstRate) / 100).toFixed(2));
  const cgstAmt = isExportCountry || interstate ? 0 : Number((totalTax / 2).toFixed(2));
  const sgstAmt = isExportCountry || interstate ? 0 : Number((totalTax - cgstAmt).toFixed(2));
  const igstAmt = !isExportCountry && interstate ? totalTax : 0;
  const grossBillAmount = Number(
    (isExportCountry || reverseCharge ? taxableSubtotal : taxableSubtotal + totalTax).toFixed(2)
  );
  const advRecNum = Math.min(grossBillAmount, Math.max(0, Number(advanceReceived) || 0));
  const netBalanceAfterAdvance = Number(Math.max(0, grossBillAmount - advRecNum).toFixed(2));
  const grandTotal = grossBillAmount;

  const pickerConsignments = useMemo(() => {
    const q = debouncedCnPickerSearch.trim().toLowerCase();
    const list = q
      ? consignments.filter((cn) =>
          `${cn.cnNo} ${cn.truckNo} ${cn.consignorName} ${cn.billingPartyName || ''} ${cn.fromCity} ${cn.toCity}`
            .toLowerCase()
            .includes(q)
        )
      : consignments;
    return list.slice(0, 50);
  }, [consignments, debouncedCnPickerSearch]);

  const unbilledPartyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    consignments.forEach((c) => {
      if (c.billed) return;
      const key = (c.billingPartyName || c.consignorName || '').trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [consignments]);

  // Strictly Customer / Billing Parties ONLY, prioritizing those with Unbilled CNs first
  const billingCustomerParties = useMemo(() => {
    const base = filterBillingCustomerParties({
      parties,
      drivers,
      lorryHires,
      invoices,
      consignments,
    });
    return [...base].sort((a, b) => {
      const ca = unbilledPartyCounts.get(a.name.trim().toLowerCase()) || 0;
      const cb = unbilledPartyCounts.get(b.name.trim().toLowerCase()) || 0;
      if (ca > 0 && cb === 0) return -1;
      if (cb > 0 && ca === 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [parties, drivers, lorryHires, invoices, consignments, unbilledPartyCounts]);

  const modalUnbilledCns = useMemo(() => {
    const partyClean = partyName.trim().toLowerCase();
    const unbilled = consignments.filter((c) => !c.billed);
    if (!partyClean) return unbilled;
    const matching = unbilled.filter(
      (c) =>
        (c.billingPartyName || c.consignorName || '').trim().toLowerCase() === partyClean ||
        c.consignorName.trim().toLowerCase() === partyClean
    );
    const others = unbilled.filter((c) => !matching.includes(c));
    return [...matching, ...others];
  }, [consignments, partyName]);

  const commitSelectedModalCns = () => {
    const chosen = modalUnbilledCns.filter((c) => selectedModalCnIds.includes(c.id));
    if (chosen.length > 0) {
      const pastedRows: InvoiceConsignmentRow[] = chosen.map((cn) => {
        const isPerTon = /ton|mt/i.test(cn.rateMode || '');
        const pkgText = [cn.packages, cn.packageMode?.split(' ')[0]].filter(Boolean).join(' ');
        return {
          cnNo: cn.cnNo,
          cnDate: cn.cnDate,
          vehicle: cn.truckNo,
          from: cn.fromCity,
          to: cn.toCity,
          weight: Number(cn.nettWeight || 0),
          packages: pkgText,
          rateType: isPerTon ? 'Per Ton' : 'Fixed',
          ratePerMt: Number(cn.ratePerUnit || cn.totalFreight || 0),
          freight: Number(cn.totalFreight || 0),
          description: cn.particulars || 'GOODS TRANSPORT',
        };
      });
      setRows((prev) => {
        const existingNonEmpty = prev.filter(
          (r) => (r.cnNo || r.freight > 0) && !pastedRows.some((p) => p.cnNo === r.cnNo)
        );
        return [...existingNonEmpty, ...pastedRows];
      });
      const cnListText = chosen.map((c) => c.cnNo).join(', ');
      setAdditionalNotes(`Linked Bilty/CN(s): ${cnListText}`);
      if (!partyName.trim() && chosen[0]) {
        handlePartySelect(chosen[0].billingPartyName || chosen[0].consignorName);
      }
      setScanMsg(`Pasted ${chosen.length} Bilty/CN row(s) (${cnListText}). Finalize Bill: Y`);
    }
    setFinalizeBill(true);
    setBiltyModalOpen(false);
  };

  useEffect(() => {
    if (!biltyModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalUnbilledCns.length === 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setBiltyModalOpen(false);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setBiltyCursorIdx((prev) => Math.min(modalUnbilledCns.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setBiltyCursorIdx((prev) => Math.max(0, prev - 1));
      } else if (e.key === 's' || e.key === 'S' || e.key === ' ') {
        e.preventDefault();
        const target = modalUnbilledCns[biltyCursorIdx];
        if (target) {
          setSelectedModalCnIds((prev) =>
            prev.includes(target.id)
              ? prev.filter((id) => id !== target.id)
              : [...prev, target.id]
          );
        }
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        commitSelectedModalCns();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const applyPartyEntityDetails = (p: Party) => {
    setPartyName(p.name);
    setSelectedInvPartyId(p.id);
    const nextGstin = (p.gstin || '').trim().toUpperCase();
    const nextAddr = p.address || '';
    const detected = detectCountryFromText(nextAddr) || 'India';
    const stInfo = resolveGstStateCode(nextGstin, nextAddr, detected);
    setPartyAddress(nextAddr);
    setPartyGstin(nextGstin);
    setPartyStateCode(stInfo.code);
    setPartyPan((p.pan || '').trim().toUpperCase());
    setBillingCountry(detected);
    applyAutoGstRules(detected, nextGstin, gstPaidBy);
  };

  const handlePartySelect = (name: string) => {
    setPartyName(name);
    const clean = name.trim().toLowerCase();
    if (!clean) {
      setSelectedInvPartyId('');
      return;
    }
    const custMatches = billingCustomerParties.filter(
      (x) => x.name.trim().toLowerCase() === clean
    );
    if (custMatches.length === 1) {
      applyPartyEntityDetails(custMatches[0]);
      return;
    }
    setSelectedInvPartyId('');
    if (custMatches.length === 0) {
      const fallback = parties.filter((x) => x.name.trim().toLowerCase() === clean);
      if (fallback.length === 1) {
        applyPartyEntityDetails(fallback[0]);
      }
    }
  };

  const applyQuotationSmartAutoFill = (partyVal: string, destVal: string) => {
    const cleanP = partyVal.trim().toLowerCase();
    const cleanD = destVal.trim().toLowerCase();
    if (!cleanP && !cleanD) return;
    const sortedQ = [...quotations].sort((a, b) =>
      (b.quotationDate || '').localeCompare(a.quotationDate || '')
    );
    const prevQ =
      sortedQ.find(
        (x) =>
          cleanP &&
          cleanD &&
          x.partyName?.toLowerCase() === cleanP &&
          x.destination?.toLowerCase().includes(cleanD)
      ) ||
      sortedQ.find((x) => cleanP && x.partyName?.toLowerCase() === cleanP) ||
      sortedQ.find((x) => cleanD && x.destination?.toLowerCase().includes(cleanD));

    if (prevQ) {
      if (!qDest.trim() && prevQ.destination) setQDest(prevQ.destination);
      if (prevQ.vehicleType) setQVehicleType(prevQ.vehicleType);
      if (prevQ.goodsType) setQGoodsType(prevQ.goodsType);
      if (prevQ.rateMode === 'Fixed' || prevQ.rateMode === 'Per Ton') setQRateMode(prevQ.rateMode);
      if ((!qFreight || Number(qFreight) <= 0) && Number(prevQ.freight || 0) > 0) {
        setQFreight(String(prevQ.freight));
      }
      if (!qTonGuarantee.trim() && prevQ.tonGuarantee) setQTonGuarantee(prevQ.tonGuarantee);
      return;
    }

    const sortedCns = [...consignments].sort((a, b) =>
      (b.cnDate || '').localeCompare(a.cnDate || '')
    );
    const prevCn =
      sortedCns.find(
        (c) =>
          cleanP &&
          cleanD &&
          (c.billingPartyName?.toLowerCase() === cleanP || c.consignorName?.toLowerCase() === cleanP) &&
          c.toCity?.toLowerCase().includes(cleanD)
      ) ||
      sortedCns.find(
        (c) =>
          cleanP &&
          (c.billingPartyName?.toLowerCase() === cleanP || c.consignorName?.toLowerCase() === cleanP)
      ) ||
      sortedCns.find((c) => cleanD && c.toCity?.toLowerCase().includes(cleanD));

    if (prevCn) {
      if ((!qFreight || Number(qFreight) <= 0) && Number(prevCn.totalFreight || 0) > 0) {
        setQFreight(String(prevCn.totalFreight));
      }
      if (!qGoodsType.trim() && prevCn.particulars) setQGoodsType(prevCn.particulars);
      if (prevCn.rateMode && /ton|mt/i.test(prevCn.rateMode)) setQRateMode('Per Ton');
    }
  };

  const handleScanLRIntoBill = async (file: File | undefined) => {
    if (!file) return;
    setScanMsg('Scanning physical LR copy in background worker...');
    try {
      const { result } = await scanPhysicalLR(file, (m) => setScanMsg(m));
      const newRow: InvoiceConsignmentRow = {
        cnNo: result.cnNo || '',
        cnDate: result.cnDate || todayISO(),
        vehicle: result.truckNo || '',
        from: result.fromCity || 'KOLKATA',
        to: result.toCity || '',
        weight: Number(result.nettWeight || result.grossWeight || 0),
        packages: result.packages || '',
        rateType: 'Fixed',
        ratePerMt: Number(result.totalFreight || 0),
        freight: Number(result.totalFreight || 0),
        description: result.particulars || 'GOODS TRANSPORT',
      };
      if (!partyName && result.consignorName) {
        handlePartySelect(result.consignorName);
        if (result.consignorAddress) setPartyAddress(result.consignorAddress);
        if (result.consignorGstin) {
          setPartyGstin(result.consignorGstin);
          applyAutoGstRules(billingCountry, result.consignorGstin, gstPaidBy);
        }
      }
      setRows((prev) => {
        const cleaned = prev.filter((r) => r.cnNo || r.freight > 0);
        return [...cleaned, newRow];
      });
      setScanMsg(`Auto-pasted scanned LR ${newRow.cnNo || newRow.vehicle} into invoice table!`);
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Failed to scan LR');
    }
  };

  const handlePasteSavedCN = (cn: ConsignmentNote) => {
    if (!partyName) {
      handlePartySelect(cn.billingPartyName || cn.consignorName);
    }
    const isPerTon = /ton|mt/i.test(cn.rateMode || '');
    const pkgText = [cn.packages, cn.packageMode?.split(' ')[0]].filter(Boolean).join(' ');
    const newRow: InvoiceConsignmentRow = {
      cnNo: cn.cnNo,
      cnDate: cn.cnDate,
      vehicle: cn.truckNo,
      from: cn.fromCity,
      to: cn.toCity,
      weight: Number(cn.nettWeight || 0),
      packages: pkgText,
      rateType: isPerTon ? 'Per Ton' : 'Fixed',
      ratePerMt: Number(cn.ratePerUnit || cn.totalFreight || 0),
      freight: Number(cn.totalFreight || 0),
      description: cn.particulars || 'FREIGHT',
    };
    setRows((prev) => {
      const cleaned = prev.filter((r) => r.cnNo || r.freight > 0);
      return [...cleaned, newRow];
    });
    setShowCnPicker(false);
  };

  const computeSettlementAmounts = (): { paid: number; status: 'Unpaid' | 'Partial' | 'Paid' } => {
    if (fullPaymentReceived) {
      return { paid: grossBillAmount, status: 'Paid' };
    }
    const basePaid = Math.max(advRecNum, editingInvoiceId ? editingOriginalPaidAmount : 0);
    const clamped = Math.min(grossBillAmount, Math.round(basePaid * 100) / 100);
    const status: 'Unpaid' | 'Partial' | 'Paid' =
      clamped >= grossBillAmount && grossBillAmount > 0
        ? 'Paid'
        : clamped > 0
          ? 'Partial'
          : 'Unpaid';
    return { paid: clamped, status };
  };

  const resetInvoiceForm = () => {
    setEditingInvoiceId(null);
    setEditingOriginalPaidAmount(0);
    const nextSeq = 106 + invoices.length;
    setBillId(String(nextSeq));
    setInvoiceNo(`${(billedAtBranch || branchTag).slice(0, 3).toUpperCase()}/${nextSeq}/${fyShort}`);
    setPartyName('');
    setSelectedInvPartyId('');
    setPartyAddress('');
    setPartyGstin('');
    setPartyPan('');
    setPartyStateCode('');
    setInsuranceCharge('0');
    setCollCharge('0');
    setLoadingCharge('0');
    setDetentionCharges('0');
    setUnloadingCharges('0');
    setSurchargeAmt('0');
    setStCharges('0');
    setFumigationCharge('0');
    setExtraCharge('0');
    setAdvanceReceived('0');
    setFullPaymentReceived(false);
    setRemarks('');
    setAdditionalNotes('');
    setRows([
      {
        cnNo: '',
        cnDate: todayISO(),
        vehicle: '',
        from: 'KOLKATA',
        to: '',
        weight: 0,
        packages: '',
        rateType: 'Fixed',
        ratePerMt: 0,
        freight: 0,
        description: '',
      },
    ]);
  };

  const handleLoadInvoiceForEdit = (inv: Invoice) => {
    setSubTab('invoice');
    setEditingInvoiceId(inv.id);
    setEditingOriginalPaidAmount(Number(inv.paidAmount || 0));
    setInvDivision(inv.division === 'LOGISTICS' ? 'LOGISTICS' : 'FTL');
    setBilledAtBranch(inv.billedAtBranch || inv.branchCode || defaultBranchLabel);
    setBillId(inv.billId || inv.invoiceNo.split('/')[1] || inv.invoiceNo);
    setBilledByCode(inv.billedByCode === 'P' ? 'P' : 'B');
    setInvoiceNo(inv.invoiceNo);
    setInvoiceDate(inv.invoiceDate || todayISO());
    setDueDate(inv.dueDate || todayISO());
    setPartyName(inv.partyName || '');
    const matched = billingCustomerParties.find(
      (p) => p.name.trim().toLowerCase() === (inv.partyName || '').trim().toLowerCase()
    );
    setSelectedInvPartyId(matched?.id || '');
    setPartyAddress(inv.partyAddress || '');
    setPartyGstin(inv.partyGstin || '');
    setPartyPan(inv.partyPan || '');
    const ctry = (inv.billingCountry as 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan') || 'India';
    setBillingCountry(ctry);
    const st = resolveGstStateCode(inv.partyGstin || '', inv.partyAddress || '', ctry);
    setPartyStateCode(st.code);
    setSac(inv.sac || company.hsn || '996791');
    setReverseCharge(Boolean(inv.reverseCharge));
    setInterstate(Boolean(inv.interstate));
    setGstPaidBy((inv.gstPaidBy as 'Consignee' | 'Consignor' | 'Transporter' | 'Others') || 'Consignee');
    setGstRate(Number(inv.gstRate ?? 5));
    setCopyCount((inv.copyCount as BillCopyCount) || 1);
    if (inv.selectedBankId) setSelectedBankId(inv.selectedBankId);
    setInsuranceCharge(String(inv.insuranceCharge ?? 0));
    setCollCharge(String(inv.collCharge ?? 0));
    setLoadingCharge(String(inv.loadingCharge ?? 0));
    setDetentionCharges(String(inv.detentionCharges ?? 0));
    setUnloadingCharges(String(inv.unloadingCharges ?? 0));
    setSurchargeAmt(String(inv.surchargeAmt ?? 0));
    setStCharges(String(inv.stCharges ?? 0));
    setFumigationCharge(String(inv.fumigationCharge ?? 0));
    setExtraCharge(String(inv.extraCharge ?? 0));
    setAdvanceReceived(String(inv.advanceReceived ?? 0));
    setAdvanceMode(inv.advanceMode || 'NEFT');
    setFullPaymentMode(inv.fullPaymentMode || 'NEFT');
    setFullPaymentReceived(inv.status === 'Paid');
    setRemarks(inv.remarks || '');
    setBillFootnote(inv.billFootnote || BILL_FOOTNOTE_PRESETS[0] || '');
    setAdditionalNotes(inv.additionalNotes || '');
    setRows(
      inv.consignmentRows && inv.consignmentRows.length > 0
        ? inv.consignmentRows
        : [
            {
              cnNo: '',
              cnDate: todayISO(),
              vehicle: '',
              from: 'KOLKATA',
              to: '',
              weight: 0,
              packages: '',
              rateType: 'Fixed',
              ratePerMt: 0,
              freight: 0,
              description: '',
            },
          ]
    );
    setScanMsg(`Editing Tax Invoice ${inv.invoiceNo} — make changes and click Update & Preview PDF.`);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const buildInvoiceObject = (overrideNo?: string): Invoice => {
    const settlement = computeSettlementAmounts();
    return {
      id: editingInvoiceId || 'preview',
      billId: billId.trim(),
      invoiceNo: (overrideNo || invoiceNo).trim(),
      invoiceDate,
      dueDate,
      financialYear: normalizeFyLabel(activeFy),
      division: invDivision,
      billedByCode,
      billedAtBranch: billedAtBranch.trim() || defaultBranchLabel,
      partyName: partyName.trim(),
      partyAddress: partyAddress.trim(),
      partyGstin: partyGstin.trim(),
      partyPan: partyPan.trim().toUpperCase(),
      billingCountry,
      sac,
      reverseCharge: isExportCountry ? false : reverseCharge,
      interstate: isExportCountry ? false : interstate,
      gstPaidBy,
      gstRate: effectiveGstRate,
      cgstAmt,
      sgstAmt,
      igstAmt,
      totalTax,
      freightCharges: freightSum,
      insuranceCharge: insNum,
      collCharge: collNum,
      loadingCharge: loadChgNum,
      detentionCharges: detNum,
      unloadingCharges: unlNum,
      surchargeAmt: surchgNum,
      stCharges: stNum,
      fumigationCharge: fumNum,
      extraCharge: extraChgNum,
      grossBillAmount,
      advanceReceived: advRecNum,
      advanceMode,
      fullPaymentMode,
      grandTotal,
      paidAmount: settlement.paid,
      status: settlement.status,
      remarks,
      billFootnote: billFootnote.trim(),
      additionalNotes: additionalNotes.trim(),
      copyCount,
      selectedBankId: selectedBankId || undefined,
      consignmentRows: rows.filter((r) => r.cnNo || r.vehicle || r.freight > 0),
      annexureLorries: rows
        .filter((r) => r.cnNo || r.vehicle)
        .map((r) => ({ cnNo: r.cnNo || '-', lorryNumbers: r.vehicle || '-' })),
      branchCode: billedAtBranch.trim() || activeBranchCode,
      createdByStaff: activeStaffCode,
      ownerUid,
    };
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setInvValidationError(null);
    const validRows = rows.filter((r) => r.cnNo || r.vehicle || r.freight > 0);
    if (!partyName.trim() || validRows.length === 0) return;

    if (isExportCountry && !partyPan.trim()) {
      setInvValidationError(
        `PAN Number is mandatory for ${billingCountry} export billing (GST Exempt 0%, GSTIN optional).`
      );
      return;
    }

    setSavingInv(true);
    try {
      let finalInvoiceNo = invoiceNo.trim();
      if (!editingInvoiceId && autoAtomicInvoice) {
        try {
          const serial = await reserveNextSerialNumber({
            type: 'invoice',
            fy: activeFy,
            branchCode: billedAtBranch || activeBranchCode,
            staffCode: activeStaffCode,
            ownerUid,
          });
          finalInvoiceNo = serial.formattedNo;
          setInvoiceNo(finalInvoiceNo);
        } catch {
          // Offline fallback preserves entered invoiceNo
        }
      }

      const id = editingInvoiceId || makeSafeDocId('inv');
      const invObj = buildInvoiceObject(finalInvoiceNo);
      await upsertDocument(
        'invoices',
        id,
        {
          billId: invObj.billId || '',
          invoiceNo: invObj.invoiceNo,
          invoiceDate: invObj.invoiceDate,
          dueDate: invObj.dueDate || '',
          financialYear: normalizeFyLabel(activeFy),
          division: invDivision,
          billedByCode: invObj.billedByCode || 'B',
          billedAtBranch: invObj.billedAtBranch || defaultBranchLabel,
          partyName: invObj.partyName,
          partyAddress: invObj.partyAddress || '',
          partyGstin: invObj.partyGstin || '',
          partyPan: invObj.partyPan || '',
          billingCountry: invObj.billingCountry || 'India',
          sac: invObj.sac || '996791',
          reverseCharge: Boolean(invObj.reverseCharge),
          interstate: Boolean(invObj.interstate),
          gstPaidBy: invObj.gstPaidBy || 'Consignee',
          gstRate: invObj.gstRate ?? 5,
          cgstAmt: invObj.cgstAmt ?? 0,
          sgstAmt: invObj.sgstAmt ?? 0,
          igstAmt: invObj.igstAmt ?? 0,
          totalTax: invObj.totalTax ?? 0,
          freightCharges: invObj.freightCharges ?? 0,
          insuranceCharge: invObj.insuranceCharge ?? 0,
          collCharge: invObj.collCharge ?? 0,
          loadingCharge: invObj.loadingCharge ?? 0,
          detentionCharges: invObj.detentionCharges ?? 0,
          unloadingCharges: invObj.unloadingCharges ?? 0,
          surchargeAmt: invObj.surchargeAmt ?? 0,
          stCharges: invObj.stCharges ?? 0,
          fumigationCharge: invObj.fumigationCharge ?? 0,
          extraCharge: invObj.extraCharge ?? 0,
          grossBillAmount: invObj.grossBillAmount ?? invObj.grandTotal,
          advanceReceived: invObj.advanceReceived ?? 0,
          advanceMode: invObj.advanceMode || 'NEFT',
          fullPaymentMode: invObj.fullPaymentMode || 'NEFT',
          grandTotal: invObj.grandTotal,
          paidAmount: invObj.paidAmount,
          status: invObj.status,
          remarks: invObj.remarks || '',
          billFootnote: invObj.billFootnote || '',
          additionalNotes: invObj.additionalNotes || '',
          copyCount: invObj.copyCount || 1,
          selectedBankId: invObj.selectedBankId || '',
          consignmentRows: validRows,
          annexureLorries: invObj.annexureLorries || [],
          branchCode: invObj.billedAtBranch || activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        !editingInvoiceId
      );

      // Sync linked consignments as billed
      const billedCnSet = new Set(
        validRows.map((r) => String(r.cnNo || '').trim().toUpperCase()).filter(Boolean)
      );
      for (const cn of consignments) {
        if (billedCnSet.has(cn.cnNo.trim().toUpperCase()) && (!cn.billed || cn.invoiceId !== id)) {
          await upsertDocument(
            'consignments',
            cn.id,
            { billed: true, invoiceId: id },
            false
          );
        }
      }

      await logBranchActivity({
        action: editingInvoiceId ? 'Updated Tax Invoice' : 'Created Tax Invoice',
        module: 'Billing',
        docRefCode: finalInvoiceNo,
        summary: `Billed ${invObj.partyName} (${billingCountry}) · ₹${formatINR(invObj.grandTotal)} (${validRows.length} CNs)`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: invObj.billedAtBranch || activeBranchCode,
        ownerUid,
      });

      playVerifiedBeep();
      const pdf = await generateInvoicePDF(invObj, company, includeAnnexure, 'p', copyCount);
      onPreviewPdf(pdf, 'Bills_Invoices');
      resetInvoiceForm();
    } finally {
      setSavingInv(false);
    }
  };

  // ---- QUOTATION STATE (10-Second Auto-Fill) ----
  const [autoAtomicQuotation, setAutoAtomicQuotation] = useState(true);
  const [qDivision, setQDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [qNo, setQNo] = useState(`QTN/2026/${String(19 + quotations.length).padStart(3, '0')}`);
  const [qDate, setQDate] = useState(todayISO());
  const [qParty, setQParty] = useState('');
  const [selectedQPartyId, setSelectedQPartyId] = useState('');
  const [qAddr, setQAddr] = useState('');
  const [qGstin, setQGstin] = useState('');
  const [qPhone, setQPhone] = useState('');
  const [qEmail, setQEmail] = useState('');
  const [qGuarantorName, setQGuarantorName] = useState('');
  const [qGuarantorPhone, setQGuarantorPhone] = useState('');
  const [qSubject] = useState('To Vehicles Freight Rate Quotation');
  const [qValidity, setQValidity] = useState('7 Days After Lorry Unloading');
  const [qVehicleType, setQVehicleType] = useState('09 TON Open / Closed Truck');
  const [qGoodsType, setQGoodsType] = useState('General Merchandise / Industrial Goods');
  const [qRateMode, setQRateMode] = useState<'Fixed' | 'Per Ton'>('Fixed');
  const [qFreight, setQFreight] = useState('34500');
  const [qLoading, setQLoading] = useState('NO Extra Charges');
  const [qUnloading, setQUnloading] = useState('YES Extra Charges');
  const [qParking] = useState('YES Extra Charges');
  const [qDetention, setQDetention] = useState('YES Extra Charges');
  const [qTonGuarantee, setQTonGuarantee] = useState('09 TON Loading Capacity');
  const [qDest, setQDest] = useState('KOLKATA to SILIGURI');
  const [qAdvance, setQAdvance] = useState('No Advance Before Lorry Loading');
  const [qEntryPoint, setQEntryPoint] = useState('As Applicable');
  const [qSearch, setQSearch] = useState('');
  const debouncedQSearch = useDebouncedValue(qSearch, 200);

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qParty.trim() || quotationReadOnly) return;

    let finalQNo = qNo.trim();
    if (autoAtomicQuotation) {
      try {
        const serial = await reserveNextSerialNumber({
          type: 'quotation',
          fy: activeFy,
          branchCode: activeBranchCode,
          staffCode: activeStaffCode,
          ownerUid,
        });
        finalQNo = serial.formattedNo;
        setQNo(finalQNo);
      } catch {
        // Offline fallback
      }
    }

    const id = makeSafeDocId('qtn');
    const qObj: Quotation = {
      id,
      quotationNo: finalQNo,
      quotationDate: qDate,
      financialYear: normalizeFyLabel(activeFy),
      division: qDivision,
      partyName: qParty.trim(),
      partyAddress: qAddr.trim(),
      partyGstin: qGstin.trim(),
      partyPhone: qPhone.trim(),
      partyEmail: qEmail.trim(),
      guarantorName: qGuarantorName.trim(),
      guarantorPhone: qGuarantorPhone.trim(),
      acceptanceEmailOnly: true,
      subject: qSubject.trim(),
      validityText: qValidity.trim(),
      vehicleType: qVehicleType.trim(),
      goodsType: qGoodsType.trim(),
      rateMode: qRateMode,
      freight: Number(qFreight) || 0,
      loadingCharge: qLoading,
      unloadingCharge: qUnloading,
      parkingCharge: qParking,
      detentionCharge: qDetention,
      tonGuarantee: qTonGuarantee,
      destination: qDest,
      advancePay: qAdvance,
      entryPoint: qEntryPoint,
      branchCode: activeBranchCode,
      createdByStaff: activeStaffCode,
      ownerUid,
    };
    await upsertDocument(
      'quotations',
      id,
      {
        quotationNo: qObj.quotationNo,
        quotationDate: qObj.quotationDate,
        financialYear: normalizeFyLabel(activeFy),
        division: qDivision,
        partyName: qObj.partyName,
        partyAddress: qObj.partyAddress,
        partyGstin: qObj.partyGstin,
        partyPhone: qObj.partyPhone || '',
        partyEmail: qObj.partyEmail || '',
        guarantorName: qObj.guarantorName || '',
        guarantorPhone: qObj.guarantorPhone || '',
        acceptanceEmailOnly: true,
        subject: qObj.subject,
        validityText: qObj.validityText,
        vehicleType: qObj.vehicleType,
        goodsType: qObj.goodsType || '',
        rateMode: qObj.rateMode || 'Fixed',
        freight: qObj.freight,
        loadingCharge: qObj.loadingCharge,
        unloadingCharge: qObj.unloadingCharge,
        parkingCharge: qObj.parkingCharge,
        detentionCharge: qObj.detentionCharge,
        tonGuarantee: qObj.tonGuarantee,
        destination: qObj.destination,
        advancePay: qObj.advancePay,
        entryPoint: qObj.entryPoint,
        branchCode: activeBranchCode,
        createdByStaff: activeStaffCode,
        ownerUid,
      },
      true
    );
    await logBranchActivity({
      action: 'Created Rate Quotation',
      module: 'Billing',
      docRefCode: finalQNo,
      summary: `${qObj.partyName} · ${qObj.destination} · ₹${formatINR(qObj.freight)}`,
      staffCode: activeStaffCode,
      staffName: activeStaffName,
      branchCode: activeBranchCode,
      ownerUid,
    });
    const pdf = await generateQuotationPDF(qObj, company);
    onPreviewPdf(pdf, 'Quotations');
  };

  // ---- SECTION 194C DECLARATION STATE ----
  const [dParty, setDParty] = useState('');
  const [selectedDPartyId, setSelectedDPartyId] = useState('');
  const [dAddr, setDAddr] = useState('');
  const [dGstin, setDGstin] = useState('');
  const [dDate, setDDate] = useState(todayISO());
  const [dFy, setDFy] = useState(normalizeFyLabel(activeFy));
  const [dPlace, setDPlace] = useState('Kolkata');
  const [declSearch, setDeclSearch] = useState('');
  const debouncedDeclSearch = useDebouncedValue(declSearch, 200);

  const handleSave194C = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dParty.trim() || declarationReadOnly) return;
    const id = makeSafeDocId('decl');
    const decl: Declaration194C = {
      id,
      partyName: dParty.trim(),
      partyAddress: dAddr.trim(),
      partyGstin: dGstin.trim(),
      financialYear: dFy.trim(),
      declarationDate: dDate,
      place: dPlace.trim(),
      branchCode: activeBranchCode,
      createdByStaff: activeStaffCode,
      ownerUid,
    };
    await upsertDocument(
      'declarations',
      id,
      {
        partyName: decl.partyName,
        partyAddress: decl.partyAddress,
        partyGstin: decl.partyGstin,
        financialYear: decl.financialYear,
        declarationDate: decl.declarationDate,
        place: decl.place,
        branchCode: activeBranchCode,
        createdByStaff: activeStaffCode,
        ownerUid,
      },
      true
    );
    await logBranchActivity({
      action: 'Issued 194C Declaration',
      module: 'Billing',
      docRefCode: decl.financialYear,
      summary: `Non-Deduction 194C issued to ${decl.partyName}`,
      staffCode: activeStaffCode,
      staffName: activeStaffName,
      branchCode: activeBranchCode,
      ownerUid,
    });
    const pdf = await generateDeclaration194CPDF(decl, company);
    onPreviewPdf(pdf, 'Declarations');
  };

  // Filtered + Indexed Registers for PaginatedDataTable (50 rows/page)
  const filteredInvoices = useMemo(() => {
    const sorted = [...invoices].sort((a, b) => (b.invoiceDate || '').localeCompare(a.invoiceDate || ''));
    const q = debouncedInvSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((inv) =>
      `${inv.invoiceNo} ${inv.partyName} ${inv.status} ${inv.branchCode || ''}`.toLowerCase().includes(q)
    );
  }, [invoices, debouncedInvSearch]);

  const filteredQuotations = useMemo(() => {
    const sorted = [...quotations].sort((a, b) => (b.quotationDate || '').localeCompare(a.quotationDate || ''));
    const q = debouncedQSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) =>
      `${item.quotationNo} ${item.partyName} ${item.destination} ${item.branchCode || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [quotations, debouncedQSearch]);

  const filteredDeclarations = useMemo(() => {
    const sorted = [...declarations].sort((a, b) =>
      (b.declarationDate || '').localeCompare(a.declarationDate || '')
    );
    const q = debouncedDeclSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((d) =>
      `${d.partyName} ${d.financialYear} ${d.partyGstin || ''} ${d.branchCode || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [declarations, debouncedDeclSearch]);

  const invoiceColumns: TableColumn<Invoice>[] = useMemo(
    () => [
      {
        key: 'invoiceNo',
        header: 'Invoice No',
        render: (inv) => (
          <div>
            <span className="font-mono-num font-bold text-blue-800">{inv.invoiceNo}</span>
            {inv.branchCode && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                {inv.branchCode}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'invoiceDate',
        header: 'Date',
        cellClassName: 'font-mono-num',
        render: (inv) => formatDateDDMMYYYY(inv.invoiceDate),
      },
      {
        key: 'partyName',
        header: 'Party Name',
        cellClassName: 'font-medium',
        render: (inv) => inv.partyName,
      },
      {
        key: 'grandTotal',
        header: 'Grand Total (₹)',
        headerClassName: 'text-right',
        cellClassName: 'text-right font-mono-num font-bold',
        render: (inv) => formatINR(inv.grandTotal),
      },
      {
        key: 'paidAmount',
        header: 'Paid (₹)',
        headerClassName: 'text-right',
        cellClassName: 'text-right font-mono-num',
        render: (inv) => formatINR(inv.paidAmount),
      },
      {
        key: 'status',
        header: 'Status & 15/30d Aging',
        render: (inv) => {
          const pendingDays = inv.status === 'Paid' ? 0 : getInvoicePendingDays(inv);
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`font-semibold ${
                  inv.status === 'Paid'
                    ? 'text-emerald-700'
                    : inv.status === 'Partial'
                    ? 'text-orange-700'
                    : 'text-red-700'
                }`}
              >
                {inv.status}
              </span>
              {inv.status !== 'Paid' && pendingDays >= 30 && (
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-extrabold">
                  30d+ Due ({pendingDays}d)
                </span>
              )}
              {inv.status !== 'Paid' && pendingDays >= 15 && pendingDays < 30 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-extrabold">
                  15d+ Alert ({pendingDays}d)
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        headerClassName: 'text-right',
        cellClassName: 'text-right space-x-1.5 whitespace-nowrap',
        render: (inv) => {
          const pendingDays = inv.status === 'Paid' ? 0 : getInvoicePendingDays(inv);
          const partyRec = parties.find(
            (p) => p.name.trim().toLowerCase() === (inv.partyName || '').trim().toLowerCase()
          );
          return (
            <>
              <button
                type="button"
                onClick={async () => {
                  const pdf = await generateInvoicePDF(inv, company, true, 'p', inv.copyCount || 1);
                  onPreviewPdf(pdf, 'Bills_Invoices');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold cursor-pointer"
              >
                <Printer className="w-3 h-3" />
                PDF
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleLoadInvoiceForEdit(inv)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold cursor-pointer"
                  title="Edit / Rectify Bill"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
              )}
              {inv.status !== 'Paid' && pendingDays >= 15 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const msg = buildOverdueBillMessage({
                        invoice: inv,
                        companyName: company.companyName,
                        pendingDays,
                      });
                      const href = buildWhatsAppShareHref({
                        phone: partyRec?.phone || '',
                        message: msg,
                      });
                      triggerExternalShareLink(href);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                    title="Send WhatsApp payment alert"
                  >
                    <MessageSquare className="w-3 h-3" />
                    WA
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const msg = buildOverdueBillMessage({
                        invoice: inv,
                        companyName: company.companyName,
                        pendingDays,
                      });
                      const href = buildEmailShareHref({
                        email: partyRec?.email || '',
                        subject: `Payment Reminder: Bill ${inv.invoiceNo} (${pendingDays} Days Pending)`,
                        body: msg,
                      });
                      triggerExternalShareLink(href);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                    title="Send Email payment alert"
                  >
                    <Mail className="w-3 h-3" />
                    Email
                  </button>
                </>
              )}
              {inv.status !== 'Paid' && !readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    onShowConfirm({
                      title: `Mark Invoice ${inv.invoiceNo} as Paid?`,
                      description: `Record full settlement of ₹${formatINR(inv.grandTotal)} from ${inv.partyName}?`,
                      confirmLabel: 'Mark Paid',
                      onConfirm: async () => {
                        await upsertDocument(
                          'invoices',
                          inv.id,
                          { paidAmount: inv.grandTotal, status: 'Paid' },
                          false
                        );
                        await logBranchActivity({
                          action: 'Marked Invoice Paid',
                          module: 'Billing',
                          docRefCode: inv.invoiceNo,
                          summary: `Full payment ₹${formatINR(inv.grandTotal)} received from ${inv.partyName}`,
                          staffCode: activeStaffCode,
                          staffName: activeStaffName,
                          branchCode: activeBranchCode,
                          ownerUid,
                        });
                      },
                    });
                  }}
                  className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold cursor-pointer"
                >
                  Mark Paid
                </button>
              )}
              {readOnly || (!isMasterAdmin && inv.status === 'Paid') ? (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                  <Lock className="w-3 h-3" />
                  {readOnly ? 'View' : 'Locked'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onShowConfirm({
                      title: `Delete Invoice ${inv.invoiceNo}?`,
                      description: `Permanently delete ${inv.invoiceNo}?`,
                      confirmLabel: 'Delete',
                      variant: 'danger',
                      onConfirm: () => removeDocument('invoices', inv.id),
                    });
                  }}
                  className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          );
        },
      },
    ],
    [
      company,
      parties,
      isMasterAdmin,
      readOnly,
      onPreviewPdf,
      onShowConfirm,
      activeStaffCode,
      activeStaffName,
      activeBranchCode,
      ownerUid,
    ]
  );

  const overdue15Or30Invoices = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status !== 'Paid' && getInvoicePendingDays(inv) >= 15)
        .sort((a, b) => getInvoicePendingDays(b) - getInvoicePendingDays(a)),
    [invoices]
  );

  const quotationColumns: TableColumn<Quotation>[] = useMemo(
    () => [
      {
        key: 'quotationNo',
        header: 'Ref No',
        cellClassName: 'font-mono-num font-bold text-blue-800',
        render: (q) => (
          <div>
            {q.quotationNo}
            {q.branchCode && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                {q.branchCode}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'quotationDate',
        header: 'Date',
        cellClassName: 'font-mono-num',
        render: (q) => formatDateDDMMYYYY(q.quotationDate),
      },
      { key: 'partyName', header: 'Party', render: (q) => q.partyName },
      { key: 'destination', header: 'Destination', render: (q) => q.destination },
      {
        key: 'freight',
        header: 'Freight (₹)',
        headerClassName: 'text-right',
        cellClassName: 'text-right font-mono-num font-bold',
        render: (q) => formatINR(q.freight),
      },
      {
        key: 'actions',
        header: 'Action',
        headerClassName: 'text-right',
        cellClassName: 'text-right',
        render: (q) => (
          <button
            type="button"
            onClick={async () => {
              const pdf = await generateQuotationPDF(q, company);
              onPreviewPdf(pdf, 'Quotations');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold cursor-pointer"
          >
            <Printer className="w-3 h-3" />
            PDF
          </button>
        ),
      },
    ],
    [company, onPreviewPdf]
  );

  const declarationColumns: TableColumn<Declaration194C>[] = useMemo(
    () => [
      {
        key: 'date',
        header: 'Date',
        cellClassName: 'font-mono-num',
        render: (d) => formatDateDDMMYYYY(d.declarationDate),
      },
      { key: 'partyName', header: 'Party Name', cellClassName: 'font-medium', render: (d) => d.partyName },
      { key: 'fy', header: 'Financial Year', cellClassName: 'font-mono-num', render: (d) => d.financialYear },
      { key: 'gstin', header: 'GSTIN', cellClassName: 'font-mono-num', render: (d) => d.partyGstin || '-' },
      {
        key: 'actions',
        header: 'Action',
        headerClassName: 'text-right',
        cellClassName: 'text-right',
        render: (d) => (
          <button
            type="button"
            onClick={async () => {
              const pdf = await generateDeclaration194CPDF(d, company);
              onPreviewPdf(pdf, 'Declarations');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold cursor-pointer"
          >
            <Printer className="w-3 h-3" />
            PDF
          </button>
        ),
      },
    ],
    [company, onPreviewPdf]
  );

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <button
          type="button"
          onClick={() => setSubTab('invoice')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
            subTab === 'invoice'
              ? 'bg-[#0D47A1] text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Tax Invoice / Bill of Supply
        </button>
        {quotationsAccess !== 'blocked' && (
          <button
            type="button"
            onClick={() => setSubTab('quotation')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'quotation'
                ? 'bg-[#0D47A1] text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <ReceiptText className="w-4 h-4" />
            Proforma Rate Quotation
          </button>
        )}
        {declarationsAccess !== 'blocked' && (
          <button
            type="button"
            onClick={() => setSubTab('194c')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              subTab === '194c'
                ? 'bg-[#0D47A1] text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileCheck2 className="w-4 h-4" />
            Section 194C Declaration
          </button>
        )}
      </div>

      {/* ================================================================= */}
      {/* TAB 1: TAX INVOICE / BILL OF SUPPLY                               */}
      {/* ================================================================= */}
      {subTab === 'invoice' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveInvoice}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                {editingInvoiceId
                  ? `Editing Invoice ${invoiceNo} (${billedAtBranch})`
                  : `Tax Invoice / Bill of Supply Builder (${billedAtBranch}) — Background PDF & Atomic Serials`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {editingInvoiceId && (
                  <button
                    type="button"
                    onClick={resetInvoiceForm}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Cancel Edit
                  </button>
                )}
                <div className="w-40">
                  <SearchableSelect
                    ariaLabel="Invoice Division"
                    value={invDivision}
                    onChange={(val) => setInvDivision(val === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
                    options={[
                      { value: 'FTL', label: 'FTL Division' },
                      { value: 'LOGISTICS', label: 'LOGISTICS Division' },
                    ]}
                    buttonClassName="py-1 text-[#0D47A1] font-extrabold"
                  />
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] bg-white/10 px-2.5 py-1 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoAtomicInvoice}
                    onChange={(e) => setAutoAtomicInvoice(e.target.checked)}
                  />
                  Auto Atomic Serial
                </label>
                <input
                  ref={lrScanRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleScanLRIntoBill(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => lrScanRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  Scan LR &amp; Auto-Paste
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedModalCnIds([]);
                    setBiltyCursorIdx(0);
                    setBiltyModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs font-extrabold cursor-pointer whitespace-nowrap"
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  Select Bilty? [Y/N] ({modalUnbilledCns.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowCnPicker((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Quick CNs ({consignments.length})
                </button>
              </div>
            </div>

            {/* FoxPro Fast Keyboard Billing Strip */}
            <div className="px-4 py-2.5 bg-slate-900 text-white grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs border-b border-slate-700">
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Billing Branch (Billed At)
                </label>
                <EditableSearchSelect
                  ariaLabel="Bill Branch"
                  value={billedAtBranch}
                  onChange={(val) => {
                    setBilledAtBranch(val);
                    if (!editingInvoiceId && val.trim()) {
                      const code = val.replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase() || branchTag;
                      setInvoiceNo(`${code}/${billId || '105'}/${fyShort}`);
                    }
                  }}
                  options={ALL_INDIA_BRANCH_OPTIONS}
                  placeholder="Branch..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Bill ID (Editable)
                </label>
                <input
                  type="text"
                  value={billId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setBillId(nextId);
                    if (!editingInvoiceId) {
                      const code = (billedAtBranch || branchTag).replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase() || branchTag;
                      setInvoiceNo(`${code}/${nextId || '105'}/${fyShort}`);
                    }
                  }}
                  className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white font-mono-num font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Billed By [B / P] + Enter
                </label>
                <input
                  type="text"
                  maxLength={1}
                  value={billedByCode}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    if (v === 'P') setBilledByCode('P');
                    else setBilledByCode('B');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'b' || e.key === 'B') {
                      e.preventDefault();
                      setBilledByCode('B');
                    } else if (e.key === 'p' || e.key === 'P') {
                      e.preventDefault();
                      setBilledByCode('P');
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      billDateInputRef.current?.focus();
                    }
                  }}
                  className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-amber-300 font-mono-num font-extrabold text-center uppercase"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Select Bilty? [Y / N]
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedModalCnIds([]);
                    setBiltyCursorIdx(0);
                    setBiltyModalOpen(true);
                  }}
                  className="w-full px-2.5 py-1.5 rounded bg-amber-400 hover:bg-amber-500 text-slate-950 font-extrabold text-xs cursor-pointer"
                >
                  Open Unbilled Bilty List ({modalUnbilledCns.length})
                </button>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Finalize Bill [Y / N]
                </label>
                <button
                  type="button"
                  onClick={() => setFinalizeBill((v) => !v)}
                  className={`w-full px-2.5 py-1.5 rounded font-extrabold text-xs cursor-pointer ${
                    finalizeBill ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-white'
                  }`}
                >
                  Finalize: {finalizeBill ? 'YES [Y]' : 'DRAFT [N]'}
                </button>
              </div>
            </div>

            {scanMsg && (
              <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>{scanMsg}</span>
              </div>
            )}

            {showCnPicker && (
              <div className="p-3 bg-blue-50 border-b border-blue-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-blue-900">
                    Click any Saved Consignment Note to auto-paste (showing up to 50 matches):
                  </p>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      value={cnPickerSearch}
                      onChange={(e) => setCnPickerSearch(e.target.value)}
                      placeholder="Filter CN, truck, party..."
                      className="pl-7 pr-2.5 py-1 rounded border border-blue-300 bg-white text-xs"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {pickerConsignments.map((cn) => (
                    <button
                      key={cn.id}
                      type="button"
                      onClick={() => handlePasteSavedCN(cn)}
                      className="px-2.5 py-1.5 rounded bg-white border border-blue-300 hover:bg-blue-100 text-xs text-slate-800 font-medium cursor-pointer"
                    >
                      <span className="font-mono-num font-bold text-blue-800">{cn.cnNo}</span> ·{' '}
                      {cn.truckNo} · {cn.fromCity}→{cn.toCity} · ₹{formatINR(cn.totalFreight)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {invValidationError && (
              <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-red-50 border border-red-300 text-xs font-bold text-red-800">
                {invValidationError}
              </div>
            )}

            <div className="p-4 space-y-4 text-xs">
              {/* Party, Country & Invoice Header Fields */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Bill To Party *{' '}
                    <span className="text-[10px] font-bold text-blue-700">
                      (Customers Only: {billingCustomerParties.length} · Unbilled CN Parties First)
                    </span>
                  </label>
                  <div className="mb-1.5">
                    <SearchableSelect
                      ariaLabel="Bill To Party Customer Dropdown"
                      value={
                        selectedInvPartyId ||
                        (() => {
                          const clean = partyName.trim().toLowerCase();
                          const m = billingCustomerParties.filter(
                            (p) => p.name.trim().toLowerCase() === clean
                          );
                          return m.length === 1 ? m[0].id : '';
                        })()
                      }
                      onChange={(nextId) => {
                        const chosen = billingCustomerParties.find((p) => p.id === nextId);
                        if (chosen) applyPartyEntityDetails(chosen);
                      }}
                      placeholder={`-- Select Customer / Billing Party (${billingCustomerParties.length}) --`}
                      searchPlaceholder="Search Customer A-Z by Name, GSTIN, City..."
                      options={[
                        {
                          value: '',
                          label: `-- Select Customer / Billing Party (${billingCustomerParties.length}) --`,
                        },
                        ...billingCustomerParties.map((p) => {
                          const unb = unbilledPartyCounts.get(p.name.trim().toLowerCase()) || 0;
                          return {
                            value: p.id,
                            label: `${unb > 0 ? `[${unb} UNBILLED CN] ` : ''}${p.name} | ${formatPartyDetailsLine(p)}`,
                          };
                        }),
                      ]}
                      buttonClassName="border-blue-300 bg-blue-50/40"
                    />
                  </div>
                  <RichEntityPicker<Party>
                    ariaLabel="Bill To Party Search"
                    value={partyName}
                    selectedId={selectedInvPartyId}
                    onChangeText={(nextText) => handlePartySelect(nextText)}
                    onSelectEntity={(p) => applyPartyEntityDetails(p)}
                    items={billingCustomerParties}
                    getId={(p) => p.id}
                    getValue={(p) => p.name}
                    getSearchText={(p) =>
                      `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''}`
                    }
                    renderTitle={(p) => p.name}
                    renderBadge={(p) => p.partyType}
                    renderDetails={(p) => formatPartyDetailsLine(p)}
                    placeholder="Or search Customer by Name, GSTIN, City, Address or Phone..."
                    required
                    quickPreview={(() => {
                      const clean = partyName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = billingCustomerParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedInvPartyId
                          ? billingCustomerParties.find((p) => p.id === selectedInvPartyId)
                          : undefined) ||
                        (matches.length === 1 ? matches[0] : matches[0]);
                      return (
                        <EntityQuickPreviewCard
                          kind="party"
                          party={resolved}
                          duplicateCount={matches.length}
                          ambiguousSelected={matches.length > 1 && !selectedInvPartyId}
                        />
                      );
                    })()}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Party Address</label>
                  <input
                    type="text"
                    value={partyAddress}
                    onChange={(e) => setPartyAddress(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Billing Country *</label>
                  <SearchableSelect
                    ariaLabel="Billing Country"
                    value={billingCountry}
                    onChange={(val) => {
                      const nextC = val as 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan';
                      setBillingCountry(nextC);
                      setInvValidationError(null);
                      const st = resolveGstStateCode(partyGstin, partyAddress, nextC);
                      setPartyStateCode(st.code);
                      applyAutoGstRules(nextC, partyGstin, gstPaidBy);
                    }}
                    options={[
                      { value: 'Bangladesh', label: 'Bangladesh (GST Exempt 0% · PAN Only)' },
                      { value: 'Bhutan', label: 'Bhutan (GST Exempt 0% · PAN Only)' },
                      { value: 'India', label: 'India (Auto GST by State Code)' },
                      { value: 'Nepal', label: 'Nepal (GST Exempt 0% · PAN Only)' },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <div className="col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">
                      Party GSTIN {isExportCountry ? <span className="text-slate-500">(Optional)</span> : ''}
                    </label>
                    <input
                      type="text"
                      value={partyGstin}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setPartyGstin(val);
                        const st = resolveGstStateCode(val, partyAddress, billingCountry);
                        if (st.code) setPartyStateCode(st.code);
                        applyAutoGstRules(billingCountry, val, gstPaidBy);
                      }}
                      placeholder={isExportCountry ? 'Optional (Export)' : '19XXXXX... (WB) or other'}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">State Code</label>
                    <SearchableSelect
                      ariaLabel="Party State Code"
                      value={partyStateCode}
                      onChange={(nextCode) => {
                        setPartyStateCode(nextCode);
                        if (billingCountry === 'India' && nextCode) {
                          setInterstate(nextCode !== '19' && nextCode !== '99');
                        }
                      }}
                      options={[
                        { value: '', label: '--' },
                        ...ALL_INDIA_STATES_DISTRICTS.map((st) => ({
                          value: st.code,
                          label: `${st.code} - ${st.name}`,
                        })),
                      ]}
                      buttonClassName="font-mono-num font-bold text-blue-900"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Party PAN {isExportCountry ? <span className="text-red-600">* (Required)</span> : ''}
                  </label>
                  <input
                    type="text"
                    required={isExportCountry}
                    value={partyPan}
                    onChange={(e) => {
                      setPartyPan(e.target.value.toUpperCase());
                      if (e.target.value.trim()) setInvValidationError(null);
                    }}
                    placeholder="ABCDE1234F"
                    className={`w-full px-2.5 py-1.5 rounded border font-mono-num uppercase ${
                      isExportCountry && !partyPan.trim() ? 'border-red-400 bg-red-50/40' : 'border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Invoice No * {autoAtomicInvoice && <span className="text-emerald-700">(Atomic)</span>}
                  </label>
                  <input
                    type="text"
                    required
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Inv Date *</label>
                    <input
                      ref={billDateInputRef}
                      type="date"
                      required
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setSelectedModalCnIds([]);
                          setBiltyCursorIdx(0);
                          setBiltyModalOpen(true);
                        }
                      }}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">SAC / HSN</label>
                  <input
                    type="text"
                    value={sac}
                    onChange={(e) => setSac(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Bank Account &amp; UPI QR on Invoice PDF
                  </label>
                  <SearchableSelect
                    ariaLabel="Bank Account for Tax Invoice"
                    value={selectedBankId}
                    onChange={setSelectedBankId}
                    options={availableBanks.map((b) => ({
                      value: b.id,
                      label: `${b.accountName} — ${b.bankName} (${b.accountNo})`,
                    }))}
                  />
                </div>
              </div>

              {/* Unlimited Consignment & Vehicle Rows */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800">
                    Consignment / Vehicle Rows ({rows.length} row{rows.length > 1 ? 's' : ''} — Unlimited Multi-Page A4)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => [
                        ...prev,
                        {
                          cnNo: '',
                          cnDate: todayISO(),
                          vehicle: '',
                          from: 'KOLKATA',
                          to: '',
                          weight: 0,
                          packages: '',
                          rateType: 'Fixed',
                          ratePerMt: 0,
                          freight: 0,
                          description: '',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Vehicle Row
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">CN/LR NO</th>
                        <th className="p-2 text-left">DATE</th>
                        <th className="p-2 text-left">VEHICLE NO.</th>
                        <th className="p-2 text-left">FROM</th>
                        <th className="p-2 text-left">TO</th>
                        <th className="p-2 text-right">WT (MT)</th>
                        <th className="p-2 text-left">PKGS</th>
                        <th className="p-2 text-left">RATE TYPE</th>
                        <th className="p-2 text-right">RATE (₹)</th>
                        <th className="p-2 text-right">FREIGHT (₹)</th>
                        <th className="p-2 text-left">DESCRIPTION</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {rows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="p-1.5 font-mono-num text-slate-500">{idx + 1}</td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.cnNo}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, cnNo: e.target.value } : r))
                                )
                              }
                              placeholder="KOL/118/26-27"
                              className="w-24 px-2 py-1 rounded border border-slate-300 font-mono-num"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="date"
                              value={row.cnDate}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, cnDate: e.target.value } : r))
                                )
                              }
                              className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.vehicle}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, vehicle: e.target.value.toUpperCase() } : r
                                  )
                                )
                              }
                              placeholder="WB23C6597"
                              className="w-24 px-2 py-1 rounded border border-slate-300 font-mono-num uppercase"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.from}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, from: e.target.value } : r))
                                )
                              }
                              className="w-20 px-2 py-1 rounded border border-slate-300"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.to}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, to: e.target.value } : r))
                                )
                              }
                              className="w-24 px-2 py-1 rounded border border-slate-300"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.001"
                              value={row.weight}
                              onChange={(e) => {
                                const w = Math.max(0, Number(e.target.value) || 0);
                                setRows((prev) =>
                                  prev.map((r, i) => {
                                    if (i !== idx) return r;
                                    const autoFreight =
                                      r.rateType === 'Per Ton' && w > 0 && (r.ratePerMt || 0) > 0
                                        ? Math.round(w * r.ratePerMt * 100) / 100
                                        : r.freight;
                                    return { ...r, weight: w, freight: autoFreight };
                                  })
                                );
                              }}
                              className="w-16 px-2 py-1 rounded border border-slate-300 text-right font-mono-num"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.packages || ''}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, packages: e.target.value } : r))
                                )
                              }
                              placeholder="120 Box"
                              className="w-16 px-2 py-1 rounded border border-slate-300"
                            />
                          </td>
                          <td className="p-1.5 min-w-[110px]">
                            <SearchableSelect
                              ariaLabel="Row Rate Type"
                              value={row.rateType || 'Fixed'}
                              onChange={(val) => {
                                const rt = val as 'Fixed' | 'Per Ton';
                                setRows((prev) =>
                                  prev.map((r, i) => {
                                    if (i !== idx) return r;
                                    const autoFreight =
                                      rt === 'Per Ton' && (r.weight || 0) > 0 && (r.ratePerMt || 0) > 0
                                        ? Math.round(r.weight * r.ratePerMt * 100) / 100
                                        : r.freight;
                                    return { ...r, rateType: rt, freight: autoFreight };
                                  })
                                );
                              }}
                              options={['Fixed', 'Per Ton']}
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={row.ratePerMt}
                              onChange={(e) => {
                                const rate = Math.max(0, Number(e.target.value) || 0);
                                setRows((prev) =>
                                  prev.map((r, i) => {
                                    if (i !== idx) return r;
                                    const autoFreight =
                                      r.rateType === 'Per Ton' && (r.weight || 0) > 0 && rate > 0
                                        ? Math.round(r.weight * rate * 100) / 100
                                        : r.freight;
                                    return { ...r, ratePerMt: rate, freight: autoFreight };
                                  })
                                );
                              }}
                              className="w-20 px-2 py-1 rounded border border-slate-300 text-right font-mono-num"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={row.freight}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, freight: Math.max(0, Number(e.target.value) || 0) } : r
                                  )
                                )
                              }
                              className="w-24 px-2 py-1 rounded border border-slate-300 text-right font-mono-num font-bold"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.description}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, description: e.target.value } : r
                                  )
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && idx === rows.length - 1)) {
                                  e.preventDefault();
                                  remarksInputRef.current?.focus();
                                }
                              }}
                              className="w-28 px-2 py-1 rounded border border-slate-300"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            {rows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Split Tax Calculation & Extra Freight Boxes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-slate-900">TAX CALCULATION &amp; AUTO-GST</p>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isExportCountry
                          ? 'bg-red-100 text-red-800'
                          : /^19/.test(partyGstin.trim())
                            ? 'bg-emerald-100 text-emerald-800'
                            : interstate
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {isExportCountry
                        ? `${billingCountry}: GST Exempt (0%)`
                        : /^19/.test(partyGstin.trim())
                          ? `WB (19): CGST ${(effectiveGstRate / 2).toFixed(1)}% + SGST ${(effectiveGstRate / 2).toFixed(1)}%`
                          : interstate
                            ? `Interstate: IGST ${effectiveGstRate.toFixed(1)}%`
                            : `Intra-State: CGST ${(effectiveGstRate / 2).toFixed(1)}% + SGST ${(effectiveGstRate / 2).toFixed(1)}%`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 font-medium">
                      <input
                        type="checkbox"
                        disabled={isExportCountry}
                        checked={!isExportCountry && reverseCharge}
                        onChange={(e) => setReverseCharge(e.target.checked)}
                      />
                      Reverse Charge (RCM)
                    </label>
                    <label className="inline-flex items-center gap-1.5 font-medium">
                      <input
                        type="checkbox"
                        disabled={isExportCountry}
                        checked={!isExportCountry && interstate}
                        onChange={(e) => setInterstate(e.target.checked)}
                      />
                      IGST (Outside WB)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span>GST %:</span>
                      <div className="w-32">
                        <SearchableSelect
                          ariaLabel="GST Slab Percent"
                          disabled={isExportCountry}
                          value={String(effectiveGstRate)}
                          onChange={(val) => setGstRate(Number(val))}
                          options={[
                            { value: '0', label: '0% (Exempt)' },
                            { value: '12', label: '12%' },
                            { value: '5', label: '5%' },
                          ]}
                          buttonClassName="font-mono-num"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="font-bold text-slate-800">GST Paid By:</label>
                    <div className="w-40">
                      <SearchableSelect
                        ariaLabel="GST Paid By"
                        value={gstPaidBy}
                        onChange={(val) => {
                          const next = val as 'Consignee' | 'Consignor' | 'Transporter' | 'Others';
                          setGstPaidBy(next);
                          if (!isExportCountry) {
                            if (next === 'Transporter') setReverseCharge(false);
                            else if (next === 'Consignee' || next === 'Consignor') setReverseCharge(true);
                          }
                        }}
                        options={['Consignee', 'Consignor', 'Others', 'Transporter']}
                        buttonClassName="font-bold text-blue-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-slate-700 font-mono-num pt-1">
                    <span>CGST ({(effectiveGstRate / 2).toFixed(1)}%): ₹{formatINR(cgstAmt)}</span>
                    <span>SGST ({(effectiveGstRate / 2).toFixed(1)}%): ₹{formatINR(sgstAmt)}</span>
                    <span>IGST ({effectiveGstRate.toFixed(1)}%): ₹{formatINR(igstAmt)}</span>
                    <span className="font-bold">Total Tax: ₹{formatINR(totalTax)}</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <p className="font-bold text-slate-900">PARTY BILL ITEMIZED CHARGES &amp; SETTLEMENT</p>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Insurance (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={insuranceCharge}
                        onChange={(e) => setInsuranceCharge(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Coll. Chg (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={collCharge}
                        onChange={(e) => setCollCharge(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Loading (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={loadingCharge}
                        onChange={(e) => setLoadingCharge(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Unloading (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={unloadingCharges}
                        onChange={(e) => setUnloadingCharges(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Surcharge (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={surchargeAmt}
                        onChange={(e) => setSurchargeAmt(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Detention (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={detentionCharges}
                        onChange={(e) => setDetentionCharges(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">ST Charges (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={stCharges}
                        onChange={(e) => setStCharges(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Fumigation (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={fumigationCharge}
                        onChange={(e) => setFumigationCharge(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600">Extra Chg (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={extraCharge}
                        onChange={(e) => setExtraCharge(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-200">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600">Adv. Recd (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={advanceReceived}
                        onChange={(e) => setAdvanceReceived(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600">Adv. Mode</label>
                      <select
                        value={advanceMode}
                        onChange={(e) => setAdvanceMode(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                      >
                        {PAYMENT_MODE_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="inline-flex items-center gap-1.5 font-bold text-emerald-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={fullPaymentReceived}
                          onChange={(e) => setFullPaymentReceived(e.target.checked)}
                        />
                        Full Paid Now
                      </label>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600">Pay Mode</label>
                      <select
                        value={fullPaymentMode}
                        onChange={(e) => setFullPaymentMode(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                      >
                        {PAYMENT_MODE_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-300">
                    <div>
                      <span className="font-bold text-slate-900">GROSS / GRAND TOTAL:</span>{' '}
                      <span className="text-base font-extrabold font-mono-num text-[#0D47A1]">
                        ₹ {formatINR(grandTotal)}
                      </span>
                    </div>
                    {advRecNum > 0 && !fullPaymentReceived && (
                      <div className="text-xs font-extrabold text-orange-700 font-mono-num">
                        Net Due after Adv: ₹ {formatINR(netBalanceAfterAdvance)}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">{amountToIndianWords(grandTotal)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <label className="font-semibold text-slate-700">Remarks</label>
                    <div className="w-48 max-w-full">
                      <SearchableSelect
                        ariaLabel="Invoice Remark Preset"
                        value=""
                        onChange={(preset) => {
                          if (!preset) return;
                          setRemarks((prev) => (prev.trim() ? `${prev.trim()} | ${preset}` : preset));
                        }}
                        placeholder="+ Remark Preset..."
                        options={[...BILL_REMARK_PRESETS, ...COMMON_REMARK_PRESETS]}
                      />
                    </div>
                  </div>
                  <input
                    ref={remarksInputRef}
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="1) INV- PFPL/26-27/E/21"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-700">Bill Footnote Preset</label>
                  <EditableSearchSelect
                    ariaLabel="Bill Footnote"
                    value={billFootnote}
                    onChange={setBillFootnote}
                    options={BILL_FOOTNOTE_PRESETS}
                    placeholder="Select or type footnote..."
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-700">Additional Notes (Auto CNs)</label>
                  <input
                    type="text"
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    placeholder="Linked Bilty/CNs appear here..."
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                  <label className="inline-flex items-center gap-2 font-semibold text-slate-700 pt-1">
                    <input
                      type="checkbox"
                      checked={includeAnnexure}
                      onChange={(e) => setIncludeAnnexure(e.target.checked)}
                    />
                    Include Invoice Annexure Page
                  </label>
                </div>
              </div>
            </div>

            {/* FoxPro Keyboard Bilty Selection Modal */}
            {biltyModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-4">
                <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-300 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-extrabold">
                        FoxPro Bilty Picker — {partyName ? partyName : 'All Parties'} ({modalUnbilledCns.length} Unbilled)
                      </h4>
                      <p className="text-[11px] text-amber-300">
                        Keys: ↑ / ↓ Navigate · Press &apos;S&apos; or Click to Toggle Selection · Press &apos;Esc&apos; or &apos;Enter&apos; to Paste &amp; Finalize Bill
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBiltyModalOpen(false)}
                      className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs font-bold cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  <div className="overflow-y-auto flex-1 divide-y divide-slate-100 text-xs">
                    {modalUnbilledCns.length === 0 ? (
                      <div className="p-8 text-center text-slate-500">
                        All Consignment Notes are already marked billed.
                      </div>
                    ) : (
                      modalUnbilledCns.map((cn, idx) => {
                        const isSelected = selectedModalCnIds.includes(cn.id);
                        const isCursor = idx === biltyCursorIdx;
                        return (
                          <div
                            key={cn.id}
                            onClick={() => {
                              setBiltyCursorIdx(idx);
                              setSelectedModalCnIds((prev) =>
                                prev.includes(cn.id)
                                  ? prev.filter((id) => id !== cn.id)
                                  : [...prev, cn.id]
                              );
                            }}
                            className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-50 border-l-4 border-emerald-600'
                                : isCursor
                                  ? 'bg-amber-50 border-l-4 border-amber-500'
                                  : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                readOnly
                                checked={isSelected}
                                className="w-4 h-4 accent-emerald-600"
                              />
                              <div className="min-w-0">
                                <div className="font-mono-num font-extrabold text-blue-900">
                                  {cn.cnNo} · {formatDateDDMMYYYY(cn.cnDate)} · {cn.truckNo}
                                </div>
                                <div className="text-[11px] text-slate-600 truncate">
                                  {cn.billingPartyName || cn.consignorName} ({cn.fromCity} → {cn.toCity})
                                </div>
                              </div>
                            </div>
                            <div className="text-right font-mono-num font-bold text-slate-900 shrink-0">
                              ₹{formatINR(cn.totalFreight)}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">
                      Selected: {selectedModalCnIds.length} Bilty/CN(s)
                    </span>
                    <button
                      type="button"
                      onClick={commitSelectedModalCns}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
                    >
                      Paste {selectedModalCnIds.length} Bilty(s) &amp; Finalize [Esc]
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs">
                <label className="font-bold text-slate-700">Print Copies:</label>
                <div className="w-56">
                  <SearchableSelect
                    ariaLabel="Bill Copy Selector"
                    value={String(copyCount)}
                    onChange={(val) => setCopyCount(Number(val) as BillCopyCount)}
                    options={[
                      { value: '1', label: '1 Copy (Original)' },
                      { value: '2', label: '2 Copies (Original + Office)' },
                      { value: '3', label: '3 Copies (Original + Transporter + Office)' },
                      { value: '4', label: '4 Copies (All)' },
                    ]}
                    buttonClassName="font-bold text-blue-900"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    setInvValidationError(null);
                    if (isExportCountry && !partyPan.trim()) {
                      setInvValidationError(
                        `PAN Number is mandatory for ${billingCountry} export billing.`
                      );
                      return;
                    }
                    const pdf = await generateInvoicePDF(
                      buildInvoiceObject(),
                      company,
                      includeAnnexure,
                      'p',
                      copyCount
                    );
                    onPreviewPdf(pdf, 'Bills_Invoices');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Live A4 Preview
                </button>
                <button
                  ref={saveInvBtnRef}
                  type="submit"
                  disabled={savingInv || readOnly}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingInv
                    ? 'Saving...'
                    : editingInvoiceId
                      ? 'Update & Preview Invoice PDF'
                      : 'Save [Y] & Preview Invoice PDF'}
                </button>
              </div>
            </div>
          </form>

          {/* 15 / 30-Day Overdue Payment Alert Strip */}
          {overdue15Or30Invoices.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>
                  {overdue15Or30Invoices.length} Pending Tax Invoice(s) Reached 15 / 30+ Days Credit Limit — Use WA or Email alert buttons in the register below.
                </span>
              </div>
            </div>
          )}

          {/* Saved Invoices Table (Paginated 50/page) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">Saved Tax Invoices ({filteredInvoices.length})</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                  placeholder="Search invoice, party, branch..."
                  className="pl-8 pr-3 py-1 rounded bg-white text-slate-900 text-xs w-56 focus:outline-none"
                />
              </div>
            </div>
            <PaginatedDataTable
              data={filteredInvoices}
              columns={invoiceColumns}
              getRowId={(inv) => inv.id}
              defaultPageSize={50}
              emptyMessage="No tax invoices recorded yet."
            />
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: PROFORMA INVOICE / RATE OF QUOTATION                       */}
      {/* ================================================================= */}
      {subTab === 'quotation' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveQuotation}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">Proforma Invoice / Rate of Quotation Generator</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <SearchableSelect
                    ariaLabel="Quotation Division"
                    value={qDivision}
                    onChange={(val) => setQDivision(val === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
                    options={[
                      { value: 'FTL', label: 'FTL Division' },
                      { value: 'LOGISTICS', label: 'LOGISTICS Division' },
                    ]}
                    buttonClassName="py-1 text-[#0D47A1] font-extrabold"
                  />
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] bg-white/10 px-2.5 py-1 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoAtomicQuotation}
                    onChange={(e) => setAutoAtomicQuotation(e.target.checked)}
                  />
                  Auto Atomic Serial
                </label>
              </div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Quotation No * {autoAtomicQuotation && <span className="text-emerald-700">(Atomic)</span>}
                </label>
                <input
                  type="text"
                  required
                  value={qNo}
                  onChange={(e) => setQNo(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={qDate}
                  onChange={(e) => setQDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Quotation For (M/S) *</label>
                <RichEntityPicker<Party>
                  ariaLabel="Quotation For (M/S)"
                  value={qParty}
                  selectedId={selectedQPartyId}
                  onChangeText={(nextVal) => {
                    setQParty(nextVal);
                    const matches = billingCustomerParties.filter(
                      (x) => x.name.trim().toLowerCase() === nextVal.trim().toLowerCase()
                    );
                    if (matches.length === 1) {
                      const p = matches[0];
                      setSelectedQPartyId(p.id);
                      setQAddr(p.address || '');
                      setQGstin(p.gstin || '');
                      setQPhone(p.phone || '');
                      setQEmail(p.email || '');
                    } else {
                      setSelectedQPartyId('');
                    }
                    applyQuotationSmartAutoFill(nextVal, qDest);
                  }}
                  onSelectEntity={(p) => {
                    setQParty(p.name);
                    setSelectedQPartyId(p.id);
                    setQAddr(p.address || '');
                    setQGstin(p.gstin || '');
                    setQPhone(p.phone || '');
                    setQEmail(p.email || '');
                    applyQuotationSmartAutoFill(p.name, qDest);
                  }}
                  items={billingCustomerParties}
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
                    const clean = qParty.trim().toLowerCase();
                    if (!clean) return null;
                    const matches = billingCustomerParties.filter(
                      (x) => x.name.trim().toLowerCase() === clean
                    );
                    const resolved =
                      (selectedQPartyId
                        ? billingCustomerParties.find((x) => x.id === selectedQPartyId)
                        : undefined) ||
                      (matches.length === 1 ? matches[0] : matches[0]);
                    return (
                      <EntityQuickPreviewCard
                        kind="party"
                        party={resolved}
                        duplicateCount={matches.length}
                        ambiguousSelected={matches.length > 1 && !selectedQPartyId}
                        compact
                      />
                    );
                  })()}
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party Address</label>
                <input
                  type="text"
                  value={qAddr}
                  onChange={(e) => setQAddr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party GSTIN</label>
                <input
                  type="text"
                  value={qGstin}
                  onChange={(e) => setQGstin(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party Phone (WhatsApp Share)</label>
                <input
                  type="text"
                  value={qPhone}
                  onChange={(e) => setQPhone(e.target.value)}
                  placeholder="10-digit WhatsApp no"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party Email</label>
                <input
                  type="email"
                  value={qEmail}
                  onChange={(e) => setQEmail(e.target.value)}
                  placeholder="dispatch@party.com"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div className="md:col-span-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-extrabold text-amber-950 mb-1 text-xs">
                    Payment Responsible / Guarantor *
                  </label>
                  <input
                    type="text"
                    value={qGuarantorName}
                    onChange={(e) => setQGuarantorName(e.target.value)}
                    placeholder="Authorized Director / Payment Signatory Name"
                    className="w-full px-3 py-2 rounded border border-amber-400 bg-white text-sm font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-extrabold text-amber-950 mb-1 text-xs">
                    Guarantor Contact No / Email Ref
                  </label>
                  <input
                    type="text"
                    value={qGuarantorPhone}
                    onChange={(e) => setQGuarantorPhone(e.target.value)}
                    placeholder="Mobile / Direct Contact"
                    className="w-full px-3 py-2 rounded border border-amber-400 bg-white text-sm font-mono-num font-bold text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Destination Route *</label>
                <EditableSearchSelect
                  ariaLabel="Quotation Destination Route"
                  value={qDest}
                  onChange={(nextDest) => {
                    setQDest(nextDest);
                    applyQuotationSmartAutoFill(qParty, nextDest);
                  }}
                  options={QUICK_CORRIDOR_DESTINATIONS}
                  placeholder={PRIORITY_CORRIDOR_REGIONS.join(', ')}
                  required
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Goods Type</label>
                <EditableSearchSelect
                  ariaLabel="Quotation Goods Type"
                  value={qGoodsType}
                  onChange={setQGoodsType}
                  options={effectiveGoodsList}
                  placeholder="Search Goods A-Z..."
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Vehicle Type *</label>
                <input
                  type="text"
                  required
                  value={qVehicleType}
                  onChange={(e) => setQVehicleType(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Rate Mode &amp; Freight Amount (₹) *</label>
                <div className="flex gap-1.5">
                  <div className="w-32">
                    <SearchableSelect
                      ariaLabel="Quotation Rate Mode"
                      value={qRateMode}
                      onChange={(val) => setQRateMode(val as 'Fixed' | 'Per Ton')}
                      options={['Fixed', 'Per Ton']}
                      buttonClassName="font-bold"
                    />
                  </div>
                  <input
                    type="number"
                    required
                    value={qFreight}
                    onChange={(e) => setQFreight(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ton Guarantee</label>
                <input
                  type="text"
                  value={qTonGuarantee}
                  onChange={(e) => setQTonGuarantee(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Loading Charges</label>
                <input
                  type="text"
                  value={qLoading}
                  onChange={(e) => setQLoading(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Unloading Charges</label>
                <input
                  type="text"
                  value={qUnloading}
                  onChange={(e) => setQUnloading(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Detention / Parking</label>
                <input
                  type="text"
                  value={qDetention}
                  onChange={(e) => setQDetention(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Advance Pay</label>
                <input
                  type="text"
                  value={qAdvance}
                  onChange={(e) => setQAdvance(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Entry Point</label>
                <input
                  type="text"
                  value={qEntryPoint}
                  onChange={(e) => setQEntryPoint(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Validity After Unloading</label>
                <input
                  type="text"
                  value={qValidity}
                  onChange={(e) => setQValidity(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
            </div>
            <div className="mx-4 mb-3 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-red-700 shrink-0" />
              <span>
                EMAIL-ONLY ACCEPTANCE POLICY PRINTED ON A4 PDF: Signed Quotation acceptance is valid ONLY via Official Email ({company.email}) — WhatsApp / SMS acceptance is NOT accepted.
              </span>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={quotationReadOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                Save &amp; Preview Quotation PDF
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold">Saved Quotations ({filteredQuotations.length})</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1.5" />
                <input
                  type="text"
                  value={qSearch}
                  onChange={(e) => setQSearch(e.target.value)}
                  placeholder="Search quotation, party..."
                  className="pl-8 pr-3 py-1 rounded bg-white text-slate-900 text-xs w-52 focus:outline-none"
                />
              </div>
            </div>
            <PaginatedDataTable
              data={filteredQuotations}
              columns={quotationColumns}
              getRowId={(q) => q.id}
              defaultPageSize={50}
              emptyMessage="No quotations generated yet."
            />
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: SECTION 194C DECLARATION GENERATOR                         */}
      {/* ================================================================= */}
      {subTab === '194c' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSave194C}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 text-sm font-bold">
              Declaration Under Section 194C (Non-Deduction of Tax) — Proprietor: Subhajit Saha (PAN: DOTPS3540M)
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Party (To) *</label>
                <RichEntityPicker<Party>
                  ariaLabel="194C Select Party (To)"
                  value={dParty}
                  selectedId={selectedDPartyId}
                  onChangeText={(nextVal) => {
                    setDParty(nextVal);
                    const matches = billingCustomerParties.filter(
                      (x) => x.name.trim().toLowerCase() === nextVal.trim().toLowerCase()
                    );
                    if (matches.length === 1) {
                      setSelectedDPartyId(matches[0].id);
                      setDAddr(matches[0].address || '');
                      setDGstin(matches[0].gstin || '');
                    } else {
                      setSelectedDPartyId('');
                    }
                  }}
                  onSelectEntity={(p) => {
                    setDParty(p.name);
                    setSelectedDPartyId(p.id);
                    setDAddr(p.address || '');
                    setDGstin(p.gstin || '');
                  }}
                  items={billingCustomerParties}
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
                    const clean = dParty.trim().toLowerCase();
                    if (!clean) return null;
                    const matches = billingCustomerParties.filter(
                      (x) => x.name.trim().toLowerCase() === clean
                    );
                    const resolved =
                      (selectedDPartyId
                        ? billingCustomerParties.find((x) => x.id === selectedDPartyId)
                        : undefined) ||
                      (matches.length === 1 ? matches[0] : matches[0]);
                    return (
                      <EntityQuickPreviewCard
                        kind="party"
                        party={resolved}
                        duplicateCount={matches.length}
                        ambiguousSelected={matches.length > 1 && !selectedDPartyId}
                        compact
                      />
                    );
                  })()}
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party Address</label>
                <input
                  type="text"
                  value={dAddr}
                  onChange={(e) => setDAddr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party GSTIN</label>
                <input
                  type="text"
                  value={dGstin}
                  onChange={(e) => setDGstin(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Financial Year *</label>
                <input
                  type="text"
                  required
                  value={dFy}
                  onChange={(e) => setDFy(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Declaration Date *</label>
                <input
                  type="date"
                  required
                  value={dDate}
                  onChange={(e) => {
                    setDDate(e.target.value);
                    setDFy(getDynamicFinancialYear(e.target.value));
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Place</label>
                <input
                  type="text"
                  value={dPlace}
                  onChange={(e) => setDPlace(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
            </div>
            <div className="px-4 py-2.5 bg-blue-50 border-t border-blue-200 text-xs text-blue-900">
              Includes Proprietor PAN Card photo auto-attached on the RIGHT below Declarant Details (PAN: {company.pan}), Dolphin Road Carrier diagonal
              watermark, Verification block, and TOP-LEFT Triangular DRC Logo (strictly NO stamp or signature at bottom).
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={declarationReadOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                Generate &amp; Preview 194C PDF
              </button>
            </div>
          </form>

          {declarations.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-800 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold">
                  Issued Section 194C Declarations ({filteredDeclarations.length})
                </span>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1.5" />
                  <input
                    type="text"
                    value={declSearch}
                    onChange={(e) => setDeclSearch(e.target.value)}
                    placeholder="Search party, FY..."
                    className="pl-8 pr-3 py-1 rounded bg-white text-slate-900 text-xs w-48 focus:outline-none"
                  />
                </div>
              </div>
              <PaginatedDataTable
                data={filteredDeclarations}
                columns={declarationColumns}
                getRowId={(d) => d.id}
                defaultPageSize={50}
                emptyMessage="No 194C declarations issued."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const BillingQuotesModule = React.memo(BillingQuotesModuleInner);
