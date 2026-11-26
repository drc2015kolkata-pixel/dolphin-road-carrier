import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  Keyboard,
  Layers,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Split,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  BillCopyCount,
  BusinessMode,
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
  QuotationRouteRow,
} from '../types/erp';
import {
  amountToIndianWords,
  formatDateDDMMYYYY,
  formatINR,
  getDynamicFinancialYear,
  getFyShortCode,
  makeSafeDocId,
  normalizeFyLabel,
  roundPaise,
  todayISO,
} from '../lib/formatters';
import {
  GeneratedPdfResult,
  downloadPdfDirect,
  generateDeclaration194CPDF,
  generateInvoicePDF,
  generateQuotationPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { validateIndianGstin, validateSafeUploadFile } from '../lib/gstinValidator';
import { GstinInputField } from './GstinInputField';
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
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
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
  sharePdfDirect,
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
import { PinCountryInputs, useAutoPinLookup } from './CityPinCountryAutoFill';
import { resolvePinSync, SupportedCountry } from '../lib/postalPinLookup';
import { VoiceDraftFields } from '../lib/voicePilot';
import { deleteIdbObject, loadIdbObject, saveIdbObject } from '../lib/indexedDbStore';
import { buildAutoCreditDebitNoteForRectifiedInvoice } from '../lib/autoCreditDebitNote';

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
  onAutoUploadPdfToDrive?: (
    pdf: GeneratedPdfResult,
    category: 'Bills_Invoices' | 'Quotations' | 'Declarations',
    subFolder?: string
  ) => Promise<void>;
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
  onAutoUploadPdfToDrive,
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

  const nextSequentialBillInfo = useMemo(() => {
    const activeFyNorm = normalizeFyLabel(activeFy);
    const prefix = (company.serialConfig?.ftlBillPrefix || branchTag || 'KOL').trim().toUpperCase();
    const startNo = Number(company.serialConfig?.ftlBillStart || 105);
    let maxNum = 0;
    invoices.forEach((inv) => {
      if (inv.docKind && inv.docKind !== 'Tax Invoice') return;
      const invFy = normalizeFyLabel(inv.financialYear || getDynamicFinancialYear(inv.invoiceDate));
      if (invFy !== activeFyNorm) return;
      const bid = Number(inv.billId || 0);
      if (Number.isFinite(bid) && bid > maxNum && bid < 1000000) maxNum = bid;
      const m = String(inv.invoiceNo || '').match(/(\d+)(?=\/\d{2}-\d{2}|$)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxNum && n < 1000000) maxNum = n;
      }
    });
    const seqNum = Math.max(startNo, maxNum > 0 ? maxNum + 1 : startNo);
    return {
      seqNum,
      formattedNo: `${prefix}/${seqNum}/${fyShort}`,
    };
  }, [invoices, activeFy, company.serialConfig, branchTag, fyShort]);

  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingOriginalPaidAmount, setEditingOriginalPaidAmount] = useState(0);
  const [invDivision, setInvDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [autoAtomicInvoice, setAutoAtomicInvoice] = useState(true);
  const [billedAtBranch, setBilledAtBranch] = useState(defaultBranchLabel);
  const [billId, setBillId] = useState(() => String(nextSequentialBillInfo.seqNum));
  const [billedByCode, setBilledByCode] = useState<'B' | 'P'>('B');
  const [docKind, setDocKind] = useState<'Tax Invoice' | 'Credit Note' | 'Debit Note'>('Tax Invoice');
  const [againstInvoiceId, setAgainstInvoiceId] = useState('');
  const [againstInvoiceNo, setAgainstInvoiceNo] = useState('');
  const [poWorkOrderNo, setPoWorkOrderNo] = useState('');
  const [creditDays, setCreditDays] = useState<number>(15);
  const [autoRoundOff, setAutoRoundOff] = useState(true);
  const [narrationText, setNarrationText] = useState('');
  const [narrationCustom, setNarrationCustom] = useState(false);
  const [finalizeBill, setFinalizeBill] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [syncCounter, setSyncCounter] = useState(0);
  const [lastSavedInvoiceId, setLastSavedInvoiceId] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(() => nextSequentialBillInfo.formattedNo);
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  const [partyName, setPartyName] = useState('');
  const [selectedInvPartyId, setSelectedInvPartyId] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyPinCode, setPartyPinCode] = useState('');
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
  const [batchSavingTrucks, setBatchSavingTrucks] = useState(false);
  const [rectifyPartyMap, setRectifyPartyMap] = useState<Record<string, string>>({});
  const [editCnFreightMap, setEditCnFreightMap] = useState<Record<string, string>>({});
  const [divideFreightMap, setDivideFreightMap] = useState<Record<string, string>>({});
  const [busyCnActionId, setBusyCnActionId] = useState<string | null>(null);
  const [manualTotalOverride, setManualTotalOverride] = useState<string | null>(null);

  const [invSearch, setInvSearch] = useState('');
  const debouncedInvSearch = useDebouncedValue(invSearch, 200);
  const invDraftHydratedRef = useRef(false);
  const INVOICE_DRAFT_KEY = 'drc_draft_invoice_v1';

  // Sync Due Date automatically from Invoice Date + Credit Days
  const updateDueDateFromCredit = (baseInvDate: string, days: number) => {
    const cleanDays = Math.max(0, Math.min(365, Math.round(Number(days) || 0)));
    const dt = new Date(baseInvDate || todayISO());
    if (!Number.isNaN(dt.getTime())) {
      dt.setDate(dt.getDate() + cleanDays);
      setDueDate(dt.toISOString().slice(0, 10));
    }
  };

  // Bridge sticky top-bar Save button to active subTab form
  useEffect(() => {
    const onGlobalFormSave = () => {
      if (subTab === 'invoice') {
        saveInvBtnRef.current?.click();
      }
    };
    window.addEventListener('drc:form-save', onGlobalFormSave);
    return () => window.removeEventListener('drc:form-save', onGlobalFormSave);
  }, [subTab]);

  // Voice Pilot draft-only filler (never auto-saves or auto-prints)
  useEffect(() => {
    const onVoiceDraftFill = (ev: Event) => {
      const fields = (ev as CustomEvent<VoiceDraftFields>).detail;
      if (!fields) return;
      if (subTab === 'quotation') {
        if (fields.partyName) setQParty(fields.partyName);
        if (fields.destination) setQDest(fields.destination);
        if (fields.freight) setQFreight(fields.freight);
        if (fields.goodsDesc) setQGoodsType(fields.goodsDesc);
        return;
      }
      if (subTab === '194c') {
        if (fields.partyName) setDParty(fields.partyName);
        if (fields.destination) setDPlace(fields.destination);
        return;
      }
      if (fields.partyName) handlePartySelect(fields.partyName);
      if (fields.fromCity || fields.toCity || fields.destination || fields.truckNo || fields.freight || fields.goodsDesc) {
        setRows((prev) => {
          const first = prev[0] || {
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
          };
          const updated: InvoiceConsignmentRow = {
            ...first,
            vehicle: fields.truckNo || first.vehicle,
            from: fields.fromCity || first.from,
            to: fields.toCity || fields.destination || first.to,
            freight: fields.freight ? Number(fields.freight) || first.freight : first.freight,
            description: fields.goodsDesc || first.description,
          };
          return [updated, ...prev.slice(1)];
        });
      }
    };
    window.addEventListener('drc:voice-draft-fill', onVoiceDraftFill);
    return () => window.removeEventListener('drc:voice-draft-fill', onVoiceDraftFill);
  }, [subTab]);

  useEffect(() => {
    let cancelled = false;
    void loadIdbObject<Record<string, unknown>>(INVOICE_DRAFT_KEY).then((draft) => {
      invDraftHydratedRef.current = true;
      if (cancelled || !draft || editingInvoiceId || pendingCnForInvoice) return;
      if (typeof draft.invoiceNo === 'string' && draft.invoiceNo.trim()) setInvoiceNo(draft.invoiceNo);
      if (typeof draft.invoiceDate === 'string' && draft.invoiceDate) setInvoiceDate(draft.invoiceDate);
      if (typeof draft.dueDate === 'string' && draft.dueDate) setDueDate(draft.dueDate);
      if (typeof draft.partyName === 'string') setPartyName(draft.partyName);
      if (typeof draft.partyAddress === 'string') setPartyAddress(draft.partyAddress);
      if (typeof draft.partyGstin === 'string') setPartyGstin(draft.partyGstin);
      if (typeof draft.partyPan === 'string') setPartyPan(draft.partyPan);
      if (typeof draft.billedAtBranch === 'string' && draft.billedAtBranch) setBilledAtBranch(draft.billedAtBranch);
      if (typeof draft.remarks === 'string') setRemarks(draft.remarks);
      if (typeof draft.advanceReceived === 'string') setAdvanceReceived(draft.advanceReceived);
      if (draft.manualTotalOverride === null || typeof draft.manualTotalOverride === 'string') {
        setManualTotalOverride(draft.manualTotalOverride as string | null);
      }
      if (Array.isArray(draft.rows) && draft.rows.length > 0) {
        setRows(draft.rows as InvoiceConsignmentRow[]);
      }
      if (draft.partyName || (Array.isArray(draft.rows) && draft.rows.some((r: Record<string, unknown>) => r.cnNo || Number(r.freight || 0) > 0))) {
        setScanMsg('Restored unsaved Tax Invoice draft cleanly from offline vault.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!invDraftHydratedRef.current || editingInvoiceId) return;
    const hasInput = Boolean(
      partyName.trim() ||
        rows.some((r) => r.cnNo || r.vehicle || Number(r.freight || 0) > 0) ||
        manualTotalOverride !== null
    );
    if (!hasInput) return;
    const timer = window.setTimeout(() => {
      void saveIdbObject(INVOICE_DRAFT_KEY, {
        invoiceNo,
        invoiceDate,
        dueDate,
        partyName,
        partyAddress,
        partyGstin,
        partyPan,
        billedAtBranch,
        remarks,
        advanceReceived,
        manualTotalOverride,
        rows,
        savedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    editingInvoiceId,
    invoiceNo,
    invoiceDate,
    dueDate,
    partyName,
    partyAddress,
    partyGstin,
    partyPan,
    billedAtBranch,
    remarks,
    advanceReceived,
    manualTotalOverride,
    rows,
  ]);

  useAutoPinLookup(partyAddress, partyPinCode, billingCountry, (pin, country) => {
    setPartyPinCode(pin);
    if (country !== billingCountry) {
      setBillingCountry(country);
      const st = resolveGstStateCode(partyGstin, partyAddress, country);
      setPartyStateCode(st.code);
      applyAutoGstRules(country, partyGstin, gstPaidBy);
    }
  });

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
  const rawGrossBillAmount = Number(
    (isExportCountry || reverseCharge ? taxableSubtotal : taxableSubtotal + totalTax).toFixed(2)
  );
  const roundOffAmt = autoRoundOff
    ? Number((Math.round(rawGrossBillAmount) - rawGrossBillAmount).toFixed(2))
    : 0;
  const computedGrossBillAmount = Number((rawGrossBillAmount + roundOffAmt).toFixed(2));
  const hasManualTotalOverride = manualTotalOverride !== null && manualTotalOverride.trim() !== '';
  const grossBillAmount = hasManualTotalOverride
    ? Math.max(0, Number(Number(manualTotalOverride || 0).toFixed(2)))
    : computedGrossBillAmount;
  const advRecNum = Math.min(grossBillAmount, Math.max(0, Number(advanceReceived) || 0));
  const netBalanceAfterAdvance = Number(Math.max(0, grossBillAmount - advRecNum).toFixed(2));
  const grandTotal = grossBillAmount;

  const autoGeneratedNarration = useMemo(() => {
    const valid = rows.filter((r) => r.cnNo || r.vehicle || r.freight > 0);
    const cnPart = valid
      .slice(0, 4)
      .map((r) => `${r.cnNo || 'LR'}${r.to ? ` (${r.from || 'KOL'}→${r.to})` : ''}`)
      .join(', ');
    const moreText = valid.length > 4 ? ` +${valid.length - 4} more` : '';
    const gstText = isExportCountry
      ? `Export to ${billingCountry} (0% GST)`
      : reverseCharge
        ? `GTA ${effectiveGstRate}% under RCM`
        : `GTA ${effectiveGstRate}% FCM`;
    const refPart = againstInvoiceNo ? ` against Inv ${againstInvoiceNo}` : '';
    const poPart = poWorkOrderNo.trim() ? ` | PO/WO: ${poWorkOrderNo.trim()}` : '';
    return `Being ${docKind} raised on M/s ${partyName.trim() || 'Customer'}${refPart}${cnPart ? ` for CN ${cnPart}${moreText}` : ''} (${gstText}${poPart}).`;
  }, [
    rows,
    isExportCountry,
    billingCountry,
    reverseCharge,
    effectiveGstRate,
    againstInvoiceNo,
    poWorkOrderNo,
    docKind,
    partyName,
  ]);

  const effectiveNarration = narrationCustom ? narrationText : autoGeneratedNarration;

  const validInvoiceRows = useMemo(
    () => rows.filter((r) => r.cnNo || r.vehicle || r.freight > 0),
    [rows]
  );

  const invoiceMandatoryReady = Boolean(
    partyName.trim() &&
      invoiceNo.trim() &&
      invoiceDate &&
      validInvoiceRows.length > 0 &&
      (!isExportCountry || partyPan.trim())
  );

  const currentInvoiceFingerprint = useMemo(
    () =>
      JSON.stringify({
        invDivision,
        billedAtBranch,
        billId,
        billedByCode,
        docKind,
        againstInvoiceId,
        againstInvoiceNo,
        poWorkOrderNo,
        creditDays,
        autoRoundOff,
        narrationText,
        narrationCustom,
        finalizeBill,
        invoiceNo,
        invoiceDate,
        dueDate,
        partyName,
        partyAddress,
        partyGstin,
        partyPan,
        billingCountry,
        sac,
        reverseCharge,
        interstate,
        gstPaidBy,
        gstRate,
        copyCount,
        selectedBankId,
        insuranceCharge,
        collCharge,
        loadingCharge,
        detentionCharges,
        unloadingCharges,
        surchargeAmt,
        stCharges,
        fumigationCharge,
        extraCharge,
        advanceReceived,
        advanceMode,
        fullPaymentReceived,
        fullPaymentMode,
        manualTotalOverride,
        remarks,
        billFootnote,
        additionalNotes,
        includeAnnexure,
        rows,
      }),
    [
      invDivision,
      billedAtBranch,
      billId,
      billedByCode,
      docKind,
      againstInvoiceId,
      againstInvoiceNo,
      poWorkOrderNo,
      creditDays,
      autoRoundOff,
      narrationText,
      narrationCustom,
      finalizeBill,
      invoiceNo,
      invoiceDate,
      dueDate,
      partyName,
      partyAddress,
      partyGstin,
      partyPan,
      billingCountry,
      sac,
      reverseCharge,
      interstate,
      gstPaidBy,
      gstRate,
      copyCount,
      selectedBankId,
      insuranceCharge,
      collCharge,
      loadingCharge,
      detentionCharges,
      unloadingCharges,
      surchargeAmt,
      stCharges,
      fumigationCharge,
      extraCharge,
      advanceReceived,
      advanceMode,
      fullPaymentReceived,
      fullPaymentMode,
      manualTotalOverride,
      remarks,
      billFootnote,
      additionalNotes,
      includeAnnexure,
      rows,
    ]
  );

  useEffect(() => {
    if (syncCounter > 0) {
      setSavedFingerprint(currentInvoiceFingerprint);
    }
    // Intentionally sync snapshot only when syncCounter increments after load/save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCounter]);

  const hasUnsavedChanges = savedFingerprint !== currentInvoiceFingerprint;

  useEffect(() => {
    if (!editingInvoiceId && docKind === 'Tax Invoice') {
      setBillId(String(nextSequentialBillInfo.seqNum));
      setInvoiceNo(nextSequentialBillInfo.formattedNo);
    }
  }, [editingInvoiceId, docKind, nextSequentialBillInfo]);

  const resolveCnBillingParty = (c: ConsignmentNote): string =>
    (c.billingPartyName || c.consignorName || '').trim();

  const normalizeTruckKey = (v?: string): string => {
    const clean = String(v || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    return clean || 'NO-VEHICLE';
  };

  // Unbilled-Only Quick CNs list: strictly unbilled CNs; filtered to selected Party when Tax Invoice party is selected
  const pickerConsignments = useMemo(() => {
    const q = debouncedCnPickerSearch.trim().toLowerCase();
    const partyClean = partyName.trim().toLowerCase();
    const base =
      docKind === 'Tax Invoice' && !editingInvoiceId
        ? consignments.filter((cn) => !cn.billed)
        : consignments;
    const partyFiltered =
      docKind === 'Tax Invoice' && !editingInvoiceId && partyClean
        ? base.filter((cn) => resolveCnBillingParty(cn).toLowerCase() === partyClean)
        : base;
    const list = q
      ? partyFiltered.filter((cn) =>
          `${cn.cnNo} ${cn.truckNo} ${cn.consignorName} ${cn.billingPartyName || ''} ${cn.fromCity} ${cn.toCity}`
            .toLowerCase()
            .includes(q)
        )
      : partyFiltered;
    return list.slice(0, 60);
  }, [consignments, debouncedCnPickerSearch, docKind, editingInvoiceId, partyName]);

  const unbilledPartyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    consignments.forEach((c) => {
      if (c.billed) return;
      const key = resolveCnBillingParty(c).toLowerCase();
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

  // Tax Invoice Party Dropdown: Show ONLY parties with Pending Unbilled CNs when creating a Tax Invoice;
  // keep full customer list only when editing a historical invoice or drafting Credit/Debit Note.
  const taxInvoiceCustomerParties = useMemo(() => {
    if (editingInvoiceId || docKind !== 'Tax Invoice') {
      return billingCustomerParties;
    }
    const knownPending = billingCustomerParties.filter(
      (p) => (unbilledPartyCounts.get(p.name.trim().toLowerCase()) || 0) > 0
    );
    const knownKeys = new Set(knownPending.map((p) => p.name.trim().toLowerCase()));
    const syntheticExtras: Party[] = [];
    const seenExtra = new Set<string>();
    consignments.forEach((c) => {
      if (c.billed) return;
      const label = resolveCnBillingParty(c);
      const key = label.toLowerCase();
      if (!key || knownKeys.has(key) || seenExtra.has(key)) return;
      seenExtra.add(key);
      syntheticExtras.push({
        id: `__unbilled_party__:${key}`,
        name: label,
        partyType: 'Customer',
        address: c.consignorAddress || '',
        gstin: c.consignorGstin || '',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Dr',
        ownerUid,
      });
    });
    return [...knownPending, ...syntheticExtras].sort((a, b) => {
      const ca = unbilledPartyCounts.get(a.name.trim().toLowerCase()) || 0;
      const cb = unbilledPartyCounts.get(b.name.trim().toLowerCase()) || 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [
    editingInvoiceId,
    docKind,
    billingCustomerParties,
    unbilledPartyCounts,
    consignments,
    ownerUid,
  ]);

  // Strictly unbilled CNs ONLY — when a party is selected, show ONLY that party's unbilled CNs (never hide billed mixing)
  const modalUnbilledCns = useMemo(() => {
    const partyClean = partyName.trim().toLowerCase();
    const unbilled = consignments.filter((c) => !c.billed);
    if (!partyClean) return unbilled;
    return unbilled.filter(
      (c) => resolveCnBillingParty(c).toLowerCase() === partyClean
    );
  }, [consignments, partyName]);

  const selectedPartyUnbilledCns = useMemo(() => {
    const partyClean = partyName.trim().toLowerCase();
    if (!partyClean) return [];
    return consignments
      .filter((c) => !c.billed && resolveCnBillingParty(c).toLowerCase() === partyClean)
      .sort((a, b) => (a.cnDate || '').localeCompare(b.cnDate || '') || a.cnNo.localeCompare(b.cnNo));
  }, [consignments, partyName]);

  const partyUnbilledTruckGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        truckKey: string;
        truckLabel: string;
        cns: ConsignmentNote[];
        totalFreight: number;
        totalWeight: number;
      }
    >();
    selectedPartyUnbilledCns.forEach((cn) => {
      const tKey = normalizeTruckKey(cn.truckNo);
      const tLabel = cn.truckNo?.trim().toUpperCase() || 'NO VEHICLE';
      const existing = map.get(tKey);
      const freightAmt = roundPaise(Number(cn.totalFreight || 0));
      const wtAmt = Number(cn.nettWeight || 0);
      if (existing) {
        existing.cns.push(cn);
        existing.totalFreight = roundPaise(existing.totalFreight + freightAmt);
        existing.totalWeight = Number((existing.totalWeight + wtAmt).toFixed(3));
      } else {
        map.set(tKey, {
          truckKey: tKey,
          truckLabel: tLabel,
          cns: [cn],
          totalFreight: freightAmt,
          totalWeight: Number(wtAmt.toFixed(3)),
        });
      }
    });
    return Array.from(map.values());
  }, [selectedPartyUnbilledCns]);

  const mapCnToInvoiceRow = (cn: ConsignmentNote): InvoiceConsignmentRow => {
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
      freight: roundPaise(Number(cn.totalFreight || 0)),
      description: cn.particulars || 'GOODS TRANSPORT',
    };
  };

  const handleLoadTruckGroupIntoInvoice = (cnsToLoad: ConsignmentNote[], truckLabel: string) => {
    if (cnsToLoad.length === 0) return;
    const mapped = cnsToLoad.map(mapCnToInvoiceRow);
    setRows(mapped);
    const cnListText = cnsToLoad.map((c) => c.cnNo).join(', ');
    setAdditionalNotes(`Vehicle ${truckLabel} · Linked Bilty/CN(s): ${cnListText}`);
    setFinalizeBill(true);
    playVerifiedBeep();
    setScanMsg(
      cnsToLoad.length > 1
        ? `Combined ${cnsToLoad.length} unbilled CN(s) on Vehicle ${truckLabel} (${cnListText}) into 1 Tax Invoice! Click Save to finalize.`
        : `Loaded CN ${cnsToLoad[0].cnNo} (${truckLabel}) into Tax Invoice! Click Save to finalize.`
    );
  };

  const handleRectifyUnbilledCnParty = async (cn: ConsignmentNote, nextBillingParty: string) => {
    const cleanTarget = nextBillingParty.trim();
    if (!cleanTarget || cn.billed) return;
    setBusyCnActionId(cn.id);
    try {
      await upsertDocument(
        'consignments',
        cn.id,
        { billingPartyName: cleanTarget },
        false
      );
      await logBranchActivity({
        action: 'Rectified CN Billing Party',
        module: 'Billing',
        docRefCode: cn.cnNo,
        summary: `Changed Billing Party on unbilled CN ${cn.cnNo}: ${resolveCnBillingParty(cn) || '—'} → ${cleanTarget}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: cn.billedAtBranch || activeBranchCode,
        ownerUid,
      });
      setRows((prev) => prev.filter((r) => r.cnNo.trim().toUpperCase() !== cn.cnNo.trim().toUpperCase()));
      setRectifyPartyMap((prev) => {
        const next = { ...prev };
        delete next[cn.id];
        return next;
      });
      playVerifiedBeep();
      setScanMsg(`Moved unbilled CN ${cn.cnNo} to Billing Party "${cleanTarget}".`);
    } finally {
      setBusyCnActionId(null);
    }
  };

  const handleSaveUnbilledCnFreight = async (cn: ConsignmentNote, rawAmount: string) => {
    if (cn.billed) return;
    const nextFreight = roundPaise(Math.max(0, Number(rawAmount) || 0));
    setBusyCnActionId(cn.id);
    try {
      await upsertDocument(
        'consignments',
        cn.id,
        { totalFreight: nextFreight },
        false
      );
      setRows((prev) =>
        prev.map((r) =>
          r.cnNo.trim().toUpperCase() === cn.cnNo.trim().toUpperCase()
            ? { ...r, freight: nextFreight }
            : r
        )
      );
      setEditCnFreightMap((prev) => {
        const next = { ...prev };
        delete next[cn.id];
        return next;
      });
      playVerifiedBeep();
      setScanMsg(`Updated unbilled CN ${cn.cnNo} freight to ₹${formatINR(nextFreight)}.`);
    } finally {
      setBusyCnActionId(null);
    }
  };

  const handleDivideTruckGroupFreight = async (
    groupCns: ConsignmentNote[],
    truckLabel: string,
    rawTotal: string,
    mode: 'equal' | 'weight'
  ) => {
    if (groupCns.length === 0) return;
    const totalAmt = roundPaise(Math.max(0, Number(rawTotal) || 0));
    if (totalAmt <= 0) {
      playAlertBeep();
      setScanMsg('Enter a positive Total Truck Freight amount (₹) to split.');
      return;
    }
    const editableCns = groupCns.filter((c) => !c.billed);
    if (editableCns.length === 0) return;
    setBusyCnActionId(`truck:${truckLabel}`);
    try {
      const weights = editableCns.map((c) => Math.max(0, Number(c.nettWeight || 0)));
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const useWeight = mode === 'weight' && weightSum > 0;
      const allocations: number[] = [];
      let running = 0;
      editableCns.forEach((_, idx) => {
        if (idx === editableCns.length - 1) {
          allocations.push(roundPaise(Math.max(0, totalAmt - running)));
        } else {
          const share = useWeight
            ? roundPaise((totalAmt * weights[idx]) / weightSum)
            : roundPaise(totalAmt / editableCns.length);
          allocations.push(share);
          running = roundPaise(running + share);
        }
      });

      const updatedByCnNo = new Map<string, number>();
      for (let i = 0; i < editableCns.length; i += 1) {
        const cn = editableCns[i];
        const newAmt = allocations[i];
        await upsertDocument('consignments', cn.id, { totalFreight: newAmt }, false);
        updatedByCnNo.set(cn.cnNo.trim().toUpperCase(), newAmt);
      }

      setRows((prev) =>
        prev.map((r) => {
          const key = r.cnNo.trim().toUpperCase();
          return updatedByCnNo.has(key) ? { ...r, freight: updatedByCnNo.get(key)! } : r;
        })
      );
      setEditCnFreightMap((prev) => {
        const next = { ...prev };
        editableCns.forEach((c) => delete next[c.id]);
        return next;
      });
      playVerifiedBeep();
      setScanMsg(
        `Divided ₹${formatINR(totalAmt)} across ${editableCns.length} unbilled CN(s) of Vehicle ${truckLabel} (${useWeight ? 'by Weight MT' : 'Equal Split'}).`
      );
    } finally {
      setBusyCnActionId(null);
    }
  };

  const handleGenerateSeparateInvoicesPerTruck = async () => {
    if (readOnly || batchSavingTrucks || partyUnbilledTruckGroups.length === 0 || !partyName.trim()) {
      return;
    }
    if (isExportCountry && !partyPan.trim()) {
      playAlertBeep();
      setInvValidationError(
        `PAN Number is mandatory for ${billingCountry} export billing (GST Exempt 0%, GSTIN optional).`
      );
      return;
    }
    if (partyGstin.trim()) {
      const gstCheck = validateIndianGstin(partyGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        setInvValidationError(`Blocked: Party GSTIN invalid — ${gstCheck.error}`);
        return;
      }
    }

    setInvValidationError(null);
    setBatchSavingTrucks(true);
    try {
      const createdInvoices: Invoice[] = [];
      const baseSeqNum = Math.max(101, 105 + invoices.length);
      const branchPref =
        (billedAtBranch || branchTag)
          .replace(/[^A-Z0-9]/gi, '')
          .slice(0, 3)
          .toUpperCase() || branchTag;

      for (let idx = 0; idx < partyUnbilledTruckGroups.length; idx += 1) {
        const group = partyUnbilledTruckGroups[idx];
        const groupRows = group.cns.map(mapCnToInvoiceRow);
        const groupFreight = roundPaise(groupRows.reduce((s, r) => s + Number(r.freight || 0), 0));
        const gRate = isExportCountry ? 0 : gstRate;
        const gIsInter = isExportCountry ? false : interstate;
        const gRcm = isExportCountry ? false : reverseCharge;
        const gTax = roundPaise((groupFreight * gRate) / 100);
        const gCgst = isExportCountry || gIsInter ? 0 : roundPaise(gTax / 2);
        const gSgst = isExportCountry || gIsInter ? 0 : roundPaise(gTax - gCgst);
        const gIgst = !isExportCountry && gIsInter ? gTax : 0;
        const rawGross = roundPaise(isExportCountry || gRcm ? groupFreight : groupFreight + gTax);
        const rOff = autoRoundOff ? roundPaise(Math.round(rawGross) - rawGross) : 0;
        const gross = roundPaise(rawGross + rOff);

        const fallbackBillNo = String(baseSeqNum + idx);
        let finalNo = `${branchPref}/${fallbackBillNo}/${fyShort}`;
        if (autoAtomicInvoice) {
          try {
            const serial = await reserveNextSerialNumber({
              type: 'invoice',
              fy: activeFy,
              branchCode: billedAtBranch || activeBranchCode,
              staffCode: activeStaffCode,
              ownerUid,
            });
            finalNo = serial.formattedNo;
          } catch {
            // Sequential fallback stays deterministic offline
          }
        }

        const invId = makeSafeDocId('inv');
        const cnNosList = group.cns.map((c) => c.cnNo).join(', ');
        const notesText = `Vehicle ${group.truckLabel} · Linked Bilty/CN(s): ${cnNosList}`;
        const narration = `Being Tax Invoice raised on M/s ${partyName.trim()} for Vehicle ${group.truckLabel} (CN ${cnNosList}, ${
          isExportCountry
            ? `Export to ${billingCountry} (0% GST)`
            : gRcm
              ? `GTA ${gRate}% under RCM`
              : `GTA ${gRate}% FCM`
        }).`;

        const invPayload: Invoice = {
          id: invId,
          billId: fallbackBillNo,
          invoiceNo: finalNo,
          invoiceDate,
          dueDate,
          creditDays: Number(creditDays) || 15,
          poWorkOrderNo: poWorkOrderNo.trim(),
          docKind: 'Tax Invoice',
          againstInvoiceId: '',
          againstInvoiceNo: '',
          finalized: true,
          roundOffAmt: rOff,
          narrationText: narration,
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
          reverseCharge: gRcm,
          interstate: gIsInter,
          gstPaidBy,
          gstRate: gRate,
          cgstAmt: gCgst,
          sgstAmt: gSgst,
          igstAmt: gIgst,
          totalTax: gTax,
          freightCharges: groupFreight,
          insuranceCharge: 0,
          collCharge: 0,
          loadingCharge: 0,
          detentionCharges: 0,
          unloadingCharges: 0,
          surchargeAmt: 0,
          stCharges: 0,
          fumigationCharge: 0,
          extraCharge: 0,
          grossBillAmount: gross,
          advanceReceived: 0,
          advanceMode,
          fullPaymentMode,
          grandTotal: gross,
          paidAmount: 0,
          status: 'Unpaid',
          remarks,
          billFootnote: billFootnote.trim(),
          additionalNotes: notesText,
          copyCount,
          selectedBankId: selectedBankId || undefined,
          consignmentRows: groupRows,
          annexureLorries: groupRows.map((r) => ({
            cnNo: r.cnNo || '-',
            lorryNumbers: r.vehicle || '-',
          })),
          branchCode: billedAtBranch.trim() || activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        };

        await upsertDocument(
          'invoices',
          invId,
          {
            billId: invPayload.billId || '',
            invoiceNo: invPayload.invoiceNo,
            invoiceDate: invPayload.invoiceDate,
            dueDate: invPayload.dueDate || '',
            creditDays: invPayload.creditDays ?? 15,
            poWorkOrderNo: invPayload.poWorkOrderNo || '',
            docKind: 'Tax Invoice',
            againstInvoiceId: '',
            againstInvoiceNo: '',
            finalized: true,
            roundOffAmt: invPayload.roundOffAmt ?? 0,
            narrationText: invPayload.narrationText || '',
            financialYear: invPayload.financialYear,
            division: invPayload.division,
            billedByCode: invPayload.billedByCode || 'B',
            billedAtBranch: invPayload.billedAtBranch || defaultBranchLabel,
            partyName: invPayload.partyName,
            partyAddress: invPayload.partyAddress || '',
            partyGstin: invPayload.partyGstin || '',
            partyPan: invPayload.partyPan || '',
            billingCountry: invPayload.billingCountry || 'India',
            sac: invPayload.sac || '996791',
            reverseCharge: Boolean(invPayload.reverseCharge),
            interstate: Boolean(invPayload.interstate),
            gstPaidBy: invPayload.gstPaidBy || 'Consignee',
            gstRate: invPayload.gstRate ?? 5,
            cgstAmt: invPayload.cgstAmt ?? 0,
            sgstAmt: invPayload.sgstAmt ?? 0,
            igstAmt: invPayload.igstAmt ?? 0,
            totalTax: invPayload.totalTax ?? 0,
            freightCharges: invPayload.freightCharges ?? 0,
            insuranceCharge: 0,
            collCharge: 0,
            loadingCharge: 0,
            detentionCharges: 0,
            unloadingCharges: 0,
            surchargeAmt: 0,
            stCharges: 0,
            fumigationCharge: 0,
            extraCharge: 0,
            grossBillAmount: invPayload.grossBillAmount,
            advanceReceived: 0,
            advanceMode: invPayload.advanceMode || 'NEFT',
            fullPaymentMode: invPayload.fullPaymentMode || 'NEFT',
            grandTotal: invPayload.grandTotal,
            paidAmount: 0,
            status: 'Unpaid',
            remarks: invPayload.remarks || '',
            billFootnote: invPayload.billFootnote || '',
            additionalNotes: invPayload.additionalNotes || '',
            copyCount: invPayload.copyCount || 1,
            selectedBankId: invPayload.selectedBankId || '',
            consignmentRows: invPayload.consignmentRows,
            annexureLorries: invPayload.annexureLorries || [],
            branchCode: invPayload.branchCode || activeBranchCode,
            createdByStaff: activeStaffCode,
            ownerUid,
          },
          true
        );

        for (const cn of group.cns) {
          await upsertDocument(
            'consignments',
            cn.id,
            { billed: true, invoiceId: invId, taxInvNo: finalNo },
            false
          );
        }

        await logBranchActivity({
          action: 'Created Vehicle Tax Invoice',
          module: 'Billing',
          docRefCode: finalNo,
          summary: `Separate Truck Invoice ${finalNo} · Vehicle ${group.truckLabel} · ${invPayload.partyName} · ₹${formatINR(invPayload.grandTotal)} (${group.cns.length} CNs)`,
          staffCode: activeStaffCode,
          staffName: activeStaffName,
          branchCode: invPayload.billedAtBranch || activeBranchCode,
          ownerUid,
        });

        createdInvoices.push(invPayload);
      }

      playVerifiedBeep();
      const summaryList = createdInvoices.map((x) => `${x.invoiceNo} (₹${formatINR(x.grandTotal)})`).join(', ');
      setScanMsg(
        `Generated ${createdInvoices.length} Separate Tax Invoice(s) (1 per Truck No): ${summaryList}`
      );
      if (createdInvoices.length > 0 && onAutoUploadPdfToDrive) {
        try {
          const pdf = await generateInvoicePDF(createdInvoices[0], company, includeAnnexure, 'p', copyCount);
          void onAutoUploadPdfToDrive(pdf, 'Bills_Invoices');
        } catch {
          // Silent background upload fallback
        }
      }
      resetInvoiceForm();
    } finally {
      setBatchSavingTrucks(false);
    }
  };

  const commitSelectedModalCns = () => {
    const chosen = modalUnbilledCns.filter((c) => selectedModalCnIds.includes(c.id));
    if (chosen.length > 0) {
      const pastedRows: InvoiceConsignmentRow[] = chosen.map(mapCnToInvoiceRow);
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
    const pinHit = resolvePinSync(nextAddr);
    const detected =
      (p.country === 'Nepal' || p.country === 'Bangladesh' || p.country === 'Bhutan' || p.country === 'India'
        ? p.country
        : null) ||
      pinHit?.country ||
      detectCountryFromText(nextAddr) ||
      'India';
    const stInfo = resolveGstStateCode(nextGstin, nextAddr, detected);
    setPartyAddress(nextAddr);
    setPartyPinCode(p.pinCode || pinHit?.pinCode || '');
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
    const uploadCheck = validateSafeUploadFile(file, 'image_only');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setScanMsg(uploadCheck.reason || 'Blocked unsupported file.');
      return;
    }
    setScanMsg('Scanning physical document in background worker...');
    try {
      const { result } = await scanPhysicalLR(
        file,
        (m) => setScanMsg(m),
        Boolean(company?.backgroundAiEnabled)
      );
      if (subTab === 'quotation') {
        if (result.consignorName) setQParty(result.consignorName);
        if (result.consignorAddress) setQAddr(result.consignorAddress);
        if (result.consignorGstin) setQGstin(result.consignorGstin);
        if (result.fromCity) setQEntryPoint(result.fromCity);
        if (result.fromCity || result.toCity) {
          setQDest(`${result.fromCity || 'KOLKATA'} to ${result.toCity || 'SILIGURI'}`);
        }
        if (result.totalFreight) {
          setQFreight(String(Number(result.totalFreight) || 0));
        }
        if (result.particulars) setQGoodsType(result.particulars);
        setScanMsg(`Scanned party & route details into Quotation (${result.consignorName || result.toCity || 'Document'})!`);
        return;
      }
      if (subTab === '194c') {
        if (result.consignorName) setDParty(result.consignorName);
        if (result.consignorAddress) setDAddr(result.consignorAddress);
        if (result.consignorGstin) setDGstin(result.consignorGstin);
        setScanMsg(`Scanned Party details into Sec 194C Declaration (${result.consignorName || 'Document'})!`);
        return;
      }
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
      setScanMsg(err instanceof Error ? err.message : 'Failed to scan document');
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
    setLastSavedInvoiceId(null);
    setSavedFingerprint('');
    setEditingOriginalPaidAmount(0);
    setDocKind('Tax Invoice');
    setAgainstInvoiceId('');
    setAgainstInvoiceNo('');
    setPoWorkOrderNo('');
    setCreditDays(15);
    setAutoRoundOff(true);
    setNarrationText('');
    setNarrationCustom(false);
    setFinalizeBill(false);
    const nextSeq = nextSequentialBillInfo.seqNum;
    setBillId(String(nextSeq));
    setInvoiceNo(nextSequentialBillInfo.formattedNo);
    const today = todayISO();
    setInvoiceDate(today);
    updateDueDateFromCredit(today, 15);
    setPartyName('');
    setSelectedInvPartyId('');
    setPartyAddress('');
    setPartyPinCode('');
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
    setManualTotalOverride(null);
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
    void deleteIdbObject('drc_draft_invoice_v1');
  };

  const handleLoadInvoiceForEdit = (inv: Invoice) => {
    setSubTab('invoice');
    setEditingInvoiceId(inv.id);
    setLastSavedInvoiceId(inv.id);
    setEditingOriginalPaidAmount(Number(inv.paidAmount || 0));
    setInvDivision(inv.division === 'LOGISTICS' ? 'LOGISTICS' : 'FTL');
    setBilledAtBranch(inv.billedAtBranch || inv.branchCode || defaultBranchLabel);
    setBillId(inv.billId || inv.invoiceNo.split('/')[1] || inv.invoiceNo);
    setBilledByCode(inv.billedByCode === 'P' ? 'P' : 'B');
    const kind =
      inv.docKind === 'Credit Note'
        ? 'Credit Note'
        : inv.docKind === 'Debit Note'
          ? 'Debit Note'
          : 'Tax Invoice';
    setDocKind(kind);
    setAgainstInvoiceId(inv.againstInvoiceId || '');
    setAgainstInvoiceNo(inv.againstInvoiceNo || '');
    setPoWorkOrderNo(inv.poWorkOrderNo || '');
    setCreditDays(Number(inv.creditDays ?? 15));
    setAutoRoundOff(inv.roundOffAmt !== 0);
    if (inv.narrationText) {
      setNarrationText(inv.narrationText);
      setNarrationCustom(true);
    } else {
      setNarrationText('');
      setNarrationCustom(false);
    }
    setFinalizeBill(inv.finalized !== false);
    setInvoiceNo(inv.invoiceNo);
    setInvoiceDate(inv.invoiceDate || todayISO());
    setDueDate(inv.dueDate || todayISO());
    setPartyName(inv.partyName || '');
    const matched = billingCustomerParties.find(
      (p) => p.name.trim().toLowerCase() === (inv.partyName || '').trim().toLowerCase()
    );
    setSelectedInvPartyId(matched?.id || '');
    setPartyAddress(inv.partyAddress || '');
    setPartyPinCode(resolvePinSync(inv.partyAddress || '')?.pinCode || '');
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
    setManualTotalOverride(inv.manualTotalOverride ? String(inv.grandTotal ?? 0) : null);
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
    setSyncCounter((c) => c + 1);
    setScanMsg(
      inv.finalized === false
        ? `Loaded Draft ${inv.invoiceNo} — set Finalize Bill = YES [Y] and click Save to unlock Print/PDF.`
        : `Editing ${kind} ${inv.invoiceNo} — Print/PDF/Share ready (or update changes and Save).`
    );
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStartCreditNoteRebill = (origInv: Invoice) => {
    handleLoadInvoiceForEdit(origInv);
    const branchPref = (origInv.billedAtBranch || origInv.branchCode || branchTag)
      .replace(/[^A-Z0-9]/gi, '')
      .slice(0, 3)
      .toUpperCase() || branchTag;
    const nextSeq = 100 + invoices.length;
    setEditingInvoiceId(null);
    setLastSavedInvoiceId(null);
    setSavedFingerprint('');
    setEditingOriginalPaidAmount(0);
    setDocKind('Credit Note');
    setAgainstInvoiceId(origInv.id);
    setAgainstInvoiceNo(origInv.invoiceNo);
    setBillId(String(nextSeq));
    setInvoiceNo(`CRN/${branchPref}/${nextSeq}/${fyShort}`);
    setInvoiceDate(todayISO());
    setAdvanceReceived('0');
    setFullPaymentReceived(false);
    setFinalizeBill(false);
    setNarrationCustom(false);
    setScanMsg(
      `Credit Note drafted against ${origInv.invoiceNo}. Click Save to reverse GST & unlock its Bilty/CNs for Re-Billing!`
    );
  };

  const handleStartDebitNote = (origInv: Invoice) => {
    handleLoadInvoiceForEdit(origInv);
    const branchPref = (origInv.billedAtBranch || origInv.branchCode || branchTag)
      .replace(/[^A-Z0-9]/gi, '')
      .slice(0, 3)
      .toUpperCase() || branchTag;
    const nextSeq = 100 + invoices.length;
    setEditingInvoiceId(null);
    setLastSavedInvoiceId(null);
    setSavedFingerprint('');
    setEditingOriginalPaidAmount(0);
    setDocKind('Debit Note');
    setAgainstInvoiceId(origInv.id);
    setAgainstInvoiceNo(origInv.invoiceNo);
    setBillId(String(nextSeq));
    setInvoiceNo(`DRN/${branchPref}/${nextSeq}/${fyShort}`);
    setInvoiceDate(todayISO());
    setAdvanceReceived('0');
    setFullPaymentReceived(false);
    setFinalizeBill(false);
    setNarrationCustom(false);
    setInsuranceCharge('0');
    setCollCharge('0');
    setLoadingCharge('0');
    setDetentionCharges('0');
    setUnloadingCharges('0');
    setSurchargeAmt('0');
    setStCharges('0');
    setFumigationCharge('0');
    setExtraCharge('0');
    setRows([
      {
        cnNo: origInv.consignmentRows?.[0]?.cnNo || '',
        cnDate: todayISO(),
        vehicle: origInv.consignmentRows?.[0]?.vehicle || '',
        from: origInv.consignmentRows?.[0]?.from || 'KOLKATA',
        to: origInv.consignmentRows?.[0]?.to || '',
        weight: 0,
        packages: '',
        rateType: 'Fixed',
        ratePerMt: 0,
        freight: 0,
        description: `SUPPLEMENTARY / DETENTION AGAINST ${origInv.invoiceNo}`,
      },
    ]);
    setScanMsg(
      `GST Debit Note drafted against ${origInv.invoiceNo}. Enter supplementary/detention charges & Save.`
    );
  };

  const buildInvoiceObject = (overrideNo?: string): Invoice => {
    const settlement = computeSettlementAmounts();
    const matchedStateObj = ALL_INDIA_STATES_DISTRICTS.find((s) => s.code === partyStateCode);
    return {
      id: editingInvoiceId || lastSavedInvoiceId || 'preview',
      billId: billId.trim(),
      invoiceNo: (overrideNo || invoiceNo).trim(),
      invoiceDate,
      dueDate,
      creditDays: Number(creditDays) || 15,
      poWorkOrderNo: poWorkOrderNo.trim(),
      docKind,
      againstInvoiceId: againstInvoiceId || '',
      againstInvoiceNo: againstInvoiceNo || '',
      finalized: finalizeBill,
      roundOffAmt,
      narrationText: effectiveNarration,
      financialYear: normalizeFyLabel(activeFy),
      division: invDivision,
      billedByCode,
      billedAtBranch: billedAtBranch.trim() || defaultBranchLabel,
      partyName: partyName.trim(),
      partyAddress: partyAddress.trim(),
      partyGstin: partyGstin.trim(),
      partyStateCode: partyStateCode.trim(),
      partyStateName: matchedStateObj?.name || '',
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
      manualTotalOverride: hasManualTotalOverride,
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
    if (!partyName.trim() || validRows.length === 0) {
      setInvValidationError('Bill To Party and at least 1 Bilty/Freight row are mandatory.');
      return;
    }

    if (isExportCountry && !partyPan.trim()) {
      setInvValidationError(
        `PAN Number is mandatory for ${billingCountry} export billing (GST Exempt 0%, GSTIN optional).`
      );
      return;
    }

    if (partyGstin.trim()) {
      const gstCheck = validateIndianGstin(partyGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        setInvValidationError(`Blocked: Party GSTIN invalid — ${gstCheck.error}`);
        return;
      }
    }

    setSavingInv(true);
    try {
      let finalInvoiceNo = invoiceNo.trim();
      if (!editingInvoiceId && autoAtomicInvoice && docKind === 'Tax Invoice') {
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
          creditDays: invObj.creditDays ?? 15,
          poWorkOrderNo: invObj.poWorkOrderNo || '',
          docKind: invObj.docKind || 'Tax Invoice',
          againstInvoiceId: invObj.againstInvoiceId || '',
          againstInvoiceNo: invObj.againstInvoiceNo || '',
          finalized: Boolean(finalizeBill),
          roundOffAmt: invObj.roundOffAmt ?? 0,
          narrationText: invObj.narrationText || '',
          financialYear: normalizeFyLabel(activeFy),
          division: invDivision,
          billedByCode: invObj.billedByCode || 'B',
          billedAtBranch: invObj.billedAtBranch || defaultBranchLabel,
          partyName: invObj.partyName,
          partyAddress: invObj.partyAddress || '',
          partyGstin: invObj.partyGstin || '',
          partyStateCode: invObj.partyStateCode || '',
          partyStateName: invObj.partyStateName || '',
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
          manualTotalOverride: Boolean(invObj.manualTotalOverride),
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

      // Bidirectional CN tagging: Tax Invoice marks CNs billed; Credit Note unlocks CNs for Re-Billing
      const cnSet = new Set(
        validRows.map((r) => String(r.cnNo || '').trim().toUpperCase()).filter(Boolean)
      );
      if (docKind === 'Credit Note') {
        for (const cn of consignments) {
          if (
            cnSet.has(cn.cnNo.trim().toUpperCase()) ||
            (againstInvoiceId && cn.invoiceId === againstInvoiceId)
          ) {
            await upsertDocument(
              'consignments',
              cn.id,
              { billed: false, invoiceId: '', taxInvNo: '' },
              false
            );
          }
        }
      } else if (docKind === 'Tax Invoice') {
        for (const cn of consignments) {
          if (
            cnSet.has(cn.cnNo.trim().toUpperCase()) &&
            (!cn.billed || cn.invoiceId !== id || cn.taxInvNo !== finalInvoiceNo)
          ) {
            await upsertDocument(
              'consignments',
              cn.id,
              { billed: true, invoiceId: id, taxInvNo: finalInvoiceNo },
              false
            );
          }
        }
      }

      // Auto Credit/Debit Note with Narration when a Tax Invoice is rectified & amount changes
      let autoNoteBanner = '';
      if (editingInvoiceId && docKind === 'Tax Invoice') {
        const previousInvoice = invoices.find((x) => x.id === editingInvoiceId);
        if (previousInvoice) {
          const autoNote = buildAutoCreditDebitNoteForRectifiedInvoice({
            previousInvoice,
            revisedInvoice: { ...invObj, id },
            existingInvoicesCount: invoices.length,
            reason: invObj.remarks || undefined,
            fy: activeFy,
            branchCode: invObj.billedAtBranch || activeBranchCode,
            staffCode: activeStaffCode,
            ownerUid,
          });
          if (autoNote && autoNote.needed) {
            const noteId = makeSafeDocId(autoNote.docKind === 'Credit Note' ? 'crn' : 'drn');
            await upsertDocument('invoices', noteId, autoNote.payload as unknown as Record<string, unknown>, true);
            await logBranchActivity({
              action: `Auto-Issued ${autoNote.docKind}`,
              module: 'Billing',
              docRefCode: autoNote.noteNo,
              summary: autoNote.narrationText,
              staffCode: activeStaffCode,
              staffName: activeStaffName,
              branchCode: invObj.billedAtBranch || activeBranchCode,
              ownerUid,
            });
            autoNoteBanner = ` · Auto-generated ${autoNote.docKind} ${autoNote.noteNo} (₹${formatINR(autoNote.grandTotal)}) with narration!`;
          }
        }
      }

      await logBranchActivity({
        action: editingInvoiceId ? `Updated ${docKind}` : `Created ${docKind}`,
        module: 'Billing',
        docRefCode: finalInvoiceNo,
        summary: `${docKind} ${finalInvoiceNo} · ${invObj.partyName} (${billingCountry}) · ₹${formatINR(invObj.grandTotal)} (${validRows.length} CNs)`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: invObj.billedAtBranch || activeBranchCode,
        ownerUid,
      });

      setEditingInvoiceId(id);
      setLastSavedInvoiceId(id);
      setSyncCounter((c) => c + 1);
      await deleteIdbObject('drc_draft_invoice_v1');
      playVerifiedBeep();

      if (onAutoUploadPdfToDrive) {
        try {
          const pdf = await generateInvoicePDF({ ...invObj, id }, company, includeAnnexure, 'p', copyCount);
          void onAutoUploadPdfToDrive(pdf, 'Bills_Invoices');
        } catch {
          // Silent background upload fallback
        }
      }

      if (finalizeBill) {
        setScanMsg(
          (docKind === 'Credit Note'
            ? `Saved Finalized Credit Note ${finalInvoiceNo}! Linked CNs unlocked for Re-Billing.`
            : `Saved & Finalized ${docKind} ${finalInvoiceNo}! Use Manual Print / Preview PDF below.`) + autoNoteBanner
        );
      } else {
        setScanMsg(
          `Saved Draft ${finalInvoiceNo} (Finalize = N). Click Preview PDF or Manual Print anytime below.${autoNoteBanner}`
        );
      }
    } finally {
      setSavingInv(false);
    }
  };

  // ---- QUOTATION STATE (10-Second Auto-Fill + Rectify + Sequential No Lock) ----
  const nextSequentialQuotationNo = useMemo(() => {
    const activeFyNorm = normalizeFyLabel(activeFy);
    const prefix = (company.serialConfig?.ftlQuotePrefix || 'QTN/2026').trim();
    let maxNum = 0;
    quotations.forEach((q) => {
      const qFy = normalizeFyLabel(q.financialYear || getDynamicFinancialYear(q.quotationDate));
      if (qFy !== activeFyNorm) return;
      const m = String(q.quotationNo || '').match(/(\d+)\s*$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxNum && n < 1000000) maxNum = n;
      }
    });
    const nextNum = Math.max(19, maxNum > 0 ? maxNum + 1 : 19);
    return `${prefix}/${String(nextNum).padStart(3, '0')}`;
  }, [quotations, activeFy, company.serialConfig]);

  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [autoAtomicQuotation, setAutoAtomicQuotation] = useState(true);
  const [qDivision, setQDivision] = useState<BusinessMode>('FTL');
  const [qNo, setQNo] = useState(() => nextSequentialQuotationNo);
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
  const [qDestinationPinCode, setQDestinationPinCode] = useState('734001');
  const [qDestinationCountry, setQDestinationCountry] = useState<SupportedCountry>('India');
  const [qAdvance, setQAdvance] = useState('No Advance Before Lorry Loading');
  const [qEntryPoint, setQEntryPoint] = useState('As Applicable');
  const [qEntryPointPinCode, setQEntryPointPinCode] = useState('');
  const [qEntryPointCountry, setQEntryPointCountry] = useState<SupportedCountry>('India');
  const [qRouteRates, setQRouteRates] = useState<QuotationRouteRow[]>([
    {
      slNo: 1,
      origin: 'Kolkata',
      destination: 'KOLKATA to SILIGURI',
      vehicleType: '09 TON Open / Closed Truck',
      loadCapacity: '09 TON Loading Capacity',
      freightRate: 34500,
      detentionExtra: 'YES Extra Charges',
      remarks: 'No Advance Before Lorry Loading',
    },
  ]);
  const [qSearch, setQSearch] = useState('');
  const debouncedQSearch = useDebouncedValue(qSearch, 200);

  useAutoPinLookup(qDest, qDestinationPinCode, qDestinationCountry, (pin, country) => {
    setQDestinationPinCode(pin);
    setQDestinationCountry(country);
  });
  useAutoPinLookup(qEntryPoint, qEntryPointPinCode, qEntryPointCountry, (pin, country) => {
    setQEntryPointPinCode(pin);
    setQEntryPointCountry(country);
  });

  useEffect(() => {
    if (!editingQuotationId) {
      setQNo(nextSequentialQuotationNo);
    }
  }, [editingQuotationId, nextSequentialQuotationNo]);

  const resetQuotationForm = () => {
    setEditingQuotationId(null);
    setQNo(nextSequentialQuotationNo);
    setQDate(todayISO());
    setQParty('');
    setSelectedQPartyId('');
    setQAddr('');
    setQGstin('');
    setQPhone('');
    setQEmail('');
    setQGuarantorName('');
    setQGuarantorPhone('');
    setQRouteRates([
      {
        slNo: 1,
        origin: 'Kolkata',
        destination: 'KOLKATA to SILIGURI',
        vehicleType: '09 TON Open / Closed Truck',
        loadCapacity: '09 TON Loading Capacity',
        freightRate: 34500,
        detentionExtra: 'YES Extra Charges',
        remarks: 'No Advance Before Lorry Loading',
      },
    ]);
  };

  const loadQuotationForEdit = (q: Quotation) => {
    setSubTab('quotation');
    setEditingQuotationId(q.id);
    setQDivision((q.division as BusinessMode) || 'FTL');
    setQNo(q.quotationNo || nextSequentialQuotationNo);
    setQDate(q.quotationDate || todayISO());
    setQParty(q.partyName || '');
    setSelectedQPartyId('');
    setQAddr(q.partyAddress || '');
    setQGstin(q.partyGstin || '');
    setQPhone(q.partyPhone || '');
    setQEmail(q.partyEmail || '');
    setQGuarantorName(q.guarantorName || '');
    setQGuarantorPhone(q.guarantorPhone || '');
    setQValidity(q.validityText || '7 Days After Lorry Unloading');
    setQVehicleType(q.vehicleType || '09 TON Open / Closed Truck');
    setQGoodsType(q.goodsType || 'General Merchandise / Industrial Goods');
    setQRateMode((q.rateMode as 'Fixed' | 'Per Ton') || 'Fixed');
    setQFreight(String(q.freight ?? 0));
    setQLoading(q.loadingCharge || 'NO Extra Charges');
    setQUnloading(q.unloadingCharge || 'YES Extra Charges');
    setQDetention(q.detentionCharge || 'YES Extra Charges');
    setQTonGuarantee(q.tonGuarantee || '09 TON Loading Capacity');
    setQDest(q.destination || '');
    setQDestinationPinCode(q.destinationPinCode || '');
    setQDestinationCountry((q.destinationCountry as SupportedCountry) || 'India');
    setQAdvance(q.advancePay || 'No Advance Before Lorry Loading');
    setQEntryPoint(q.entryPoint || 'As Applicable');
    setQEntryPointPinCode(q.entryPointPinCode || '');
    setQEntryPointCountry((q.entryPointCountry as SupportedCountry) || 'India');
    setQRouteRates(
      q.routeRates && q.routeRates.length > 0
        ? q.routeRates
        : [
            {
              slNo: 1,
              origin: q.entryPoint || 'Kolkata',
              destination: q.destination || '-',
              vehicleType: q.vehicleType || '09 TON Open / Closed Truck',
              loadCapacity: q.tonGuarantee || '09 TON Loading Capacity',
              freightRate: Number(q.freight ?? 0),
              detentionExtra: q.detentionCharge || 'YES Extra Charges',
              remarks: q.advancePay || 'No Advance Before Lorry Loading',
            },
          ]
    );
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const buildQuotationObject = (overrideNo?: string, overrideId?: string): Quotation => {
    const cleanRoutes = (qRouteRates.length > 0
      ? qRouteRates
      : [
          {
            slNo: 1,
            origin: qEntryPoint.trim() || 'Kolkata',
            destination: qDest.trim() || '-',
            vehicleType: qVehicleType.trim(),
            loadCapacity: qTonGuarantee.trim(),
            freightRate: Number(qFreight) || 0,
            detentionExtra: qDetention,
            remarks: qAdvance,
          },
        ]
    ).map((r, i) => ({
      slNo: i + 1,
      origin: (r.origin || '').trim() || 'Kolkata',
      destination: (r.destination || '').trim() || '-',
      vehicleType: (r.vehicleType || '').trim() || '-',
      loadCapacity: (r.loadCapacity || '').trim() || '-',
      freightRate: Number(r.freightRate) || 0,
      detentionExtra: (r.detentionExtra || '').trim() || '-',
      remarks: (r.remarks || '').trim() || '-',
    }));
    const firstRow = cleanRoutes[0];
    return {
      id: overrideId || editingQuotationId || 'preview_qtn',
      quotationNo: (overrideNo || qNo).trim(),
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
      vehicleType: firstRow?.vehicleType || qVehicleType.trim(),
      goodsType: qGoodsType.trim(),
      rateMode: qRateMode,
      freight: firstRow ? Number(firstRow.freightRate) || Number(qFreight) || 0 : Number(qFreight) || 0,
      loadingCharge: qLoading,
      unloadingCharge: qUnloading,
      parkingCharge: qParking,
      detentionCharge: firstRow?.detentionExtra || qDetention,
      tonGuarantee: firstRow?.loadCapacity || qTonGuarantee,
      destination: firstRow?.destination || qDest,
      destinationPinCode: qDestinationPinCode.trim(),
      destinationCountry: qDestinationCountry,
      advancePay: qAdvance,
      entryPoint: firstRow?.origin || qEntryPoint,
      entryPointPinCode: qEntryPointPinCode.trim(),
      entryPointCountry: qEntryPointCountry,
      routeRates: cleanRoutes,
      branchCode: activeBranchCode,
      createdByStaff: activeStaffCode,
      ownerUid,
    };
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qParty.trim() || quotationReadOnly) return;
    if (qGstin.trim()) {
      const gstCheck = validateIndianGstin(qGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        setScanMsg(`Blocked Quotation Save: Party GSTIN invalid — ${gstCheck.error}`);
        return;
      }
    }

    let finalQNo = qNo.trim();
    if (!editingQuotationId && autoAtomicQuotation) {
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

    const id = editingQuotationId || makeSafeDocId('qtn');
    const isNew = !editingQuotationId;
    const qObj = buildQuotationObject(finalQNo, id);
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
        destinationPinCode: qObj.destinationPinCode || '',
        destinationCountry: qObj.destinationCountry || 'India',
        advancePay: qObj.advancePay,
        entryPoint: qObj.entryPoint,
        entryPointPinCode: qObj.entryPointPinCode || '',
        entryPointCountry: qObj.entryPointCountry || 'India',
        routeRates: qObj.routeRates || [],
        branchCode: activeBranchCode,
        createdByStaff: activeStaffCode,
        ownerUid,
      },
      isNew
    );
    await logBranchActivity({
      action: isNew ? 'Created Rate Quotation' : 'Rectified Rate Quotation',
      module: 'Billing',
      docRefCode: finalQNo,
      summary: `${qObj.partyName} · ${qObj.destination} · ₹${formatINR(qObj.freight)}`,
      staffCode: activeStaffCode,
      staffName: activeStaffName,
      branchCode: activeBranchCode,
      ownerUid,
    });
    playVerifiedBeep();
    if (onAutoUploadPdfToDrive) {
      try {
        const pdf = await generateQuotationPDF(qObj, company);
        void onAutoUploadPdfToDrive(pdf, 'Quotations');
      } catch {
        // Silent background upload fallback
      }
    }
    setScanMsg(`Saved Quotation ${finalQNo} (${qObj.partyName}) cleanly. Click Preview PDF when ready.`);
    if (!isNew) resetQuotationForm();
  };

  // ---- SECTION 194C DECLARATION STATE (Date + Party Only — NO Serial Lock) ----
  const [editingDeclId, setEditingDeclId] = useState<string | null>(null);
  const [dDivision, setDDivision] = useState<BusinessMode>('FTL');
  const [dParty, setDParty] = useState('');
  const [selectedDPartyId, setSelectedDPartyId] = useState('');
  const [dAddr, setDAddr] = useState('');
  const [dGstin, setDGstin] = useState('');
  const [dDate, setDDate] = useState(todayISO());
  const [dFy, setDFy] = useState(normalizeFyLabel(activeFy));
  const [dPlace, setDPlace] = useState('Kolkata');
  const [dPlacePinCode, setDPlacePinCode] = useState('700001');
  const [dPlaceCountry, setDPlaceCountry] = useState<SupportedCountry>('India');
  const [declSearch, setDeclSearch] = useState('');
  const debouncedDeclSearch = useDebouncedValue(declSearch, 200);

  useAutoPinLookup(dPlace, dPlacePinCode, dPlaceCountry, (pin, country) => {
    setDPlacePinCode(pin);
    setDPlaceCountry(country);
  });

  const resetDeclForm = () => {
    setEditingDeclId(null);
    setDParty('');
    setSelectedDPartyId('');
    setDAddr('');
    setDGstin('');
    setDDate(todayISO());
    setDFy(normalizeFyLabel(activeFy));
    setDPlace('Kolkata');
    setDPlacePinCode('700001');
    setDPlaceCountry('India');
  };

  const loadDeclForEdit = (d: Declaration194C) => {
    setSubTab('194c');
    setEditingDeclId(d.id);
    setDDivision((d.division as BusinessMode) || 'FTL');
    setDParty(d.partyName || '');
    setSelectedDPartyId('');
    setDAddr(d.partyAddress || '');
    setDGstin(d.partyGstin || '');
    setDDate(d.declarationDate || todayISO());
    setDFy(d.financialYear || normalizeFyLabel(activeFy));
    setDPlace(d.place || 'Kolkata');
    setDPlacePinCode(d.placePinCode || '700001');
    setDPlaceCountry((d.placeCountry as SupportedCountry) || 'India');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const buildDeclarationObject = (overrideId?: string): Declaration194C => ({
    id: overrideId || editingDeclId || 'preview_decl',
    division: dDivision,
    partyName: dParty.trim(),
    partyAddress: dAddr.trim(),
    partyGstin: dGstin.trim(),
    financialYear: dFy.trim(),
    declarationDate: dDate,
    place: dPlace.trim(),
    placePinCode: dPlacePinCode.trim(),
    placeCountry: dPlaceCountry,
    branchCode: activeBranchCode,
    createdByStaff: activeStaffCode,
    ownerUid,
  });

  const handleSave194C = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dParty.trim() || declarationReadOnly) return;
    if (dGstin.trim()) {
      const gstCheck = validateIndianGstin(dGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        setScanMsg(`Blocked 194C Save: Party GSTIN invalid — ${gstCheck.error}`);
        return;
      }
    }
    const id = editingDeclId || makeSafeDocId('decl');
    const isNew = !editingDeclId;
    const decl = buildDeclarationObject(id);
    await upsertDocument(
      'declarations',
      id,
      {
        division: decl.division || 'FTL',
        partyName: decl.partyName,
        partyAddress: decl.partyAddress,
        partyGstin: decl.partyGstin,
        financialYear: decl.financialYear,
        declarationDate: decl.declarationDate,
        place: decl.place,
        placePinCode: decl.placePinCode || '',
        placeCountry: decl.placeCountry || 'India',
        branchCode: activeBranchCode,
        createdByStaff: activeStaffCode,
        ownerUid,
      },
      isNew
    );
    await logBranchActivity({
      action: isNew ? 'Issued 194C Declaration' : 'Rectified 194C Declaration',
      module: 'Billing',
      docRefCode: decl.financialYear,
      summary: `Non-Deduction 194C ${isNew ? 'issued to' : 'updated for'} ${decl.partyName}`,
      staffCode: activeStaffCode,
      staffName: activeStaffName,
      branchCode: activeBranchCode,
      ownerUid,
    });
    playVerifiedBeep();
    if (onAutoUploadPdfToDrive) {
      try {
        const pdf = await generateDeclaration194CPDF(decl, company);
        void onAutoUploadPdfToDrive(pdf, 'Declarations');
      } catch {
        // Silent background upload fallback
      }
    }
    setScanMsg(`Saved Section 194C Declaration for "${decl.partyName}" (${decl.financialYear}). Click Preview 194C PDF if needed.`);
    if (!isNew) resetDeclForm();
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
        header: 'Doc / Invoice No',
        render: (inv) => {
          const kind = inv.docKind || 'Tax Invoice';
          const isFinal = inv.finalized !== false;
          return (
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono-num font-bold text-blue-800">{inv.invoiceNo}</span>
                {inv.branchCode && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {inv.branchCode}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span
                  className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                    kind === 'Credit Note'
                      ? 'bg-rose-100 text-rose-800'
                      : kind === 'Debit Note'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {kind.toUpperCase()}
                </span>
                <span
                  className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                    isFinal ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {isFinal ? 'FINAL [Y]' : 'DRAFT [N]'}
                </span>
                {inv.againstInvoiceNo && (
                  <span className="text-[9px] font-mono-num text-slate-500">
                    Ref: {inv.againstInvoiceNo}
                  </span>
                )}
              </div>
            </div>
          );
        },
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
        render: (inv) => (
          <div>
            <div>{inv.partyName}</div>
            {inv.poWorkOrderNo && (
              <div className="text-[10px] text-slate-500 font-mono-num">PO: {inv.poWorkOrderNo}</div>
            )}
          </div>
        ),
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
        cellClassName: 'text-right space-x-1 whitespace-nowrap',
        render: (inv) => {
          const pendingDays = inv.status === 'Paid' ? 0 : getInvoicePendingDays(inv);
          const isFinalized = inv.finalized !== false;
          const partyRec = parties.find(
            (p) => p.name.trim().toLowerCase() === (inv.partyName || '').trim().toLowerCase()
          );
          return (
            <>
              <button
                type="button"
                title="Preview / Low-MB PDF"
                onClick={async () => {
                  const pdf = await generateInvoicePDF(inv, company, true, 'p', inv.copyCount || 1);
                  onPreviewPdf(pdf, 'Bills_Invoices');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold cursor-pointer"
              >
                <Eye className="w-3 h-3" />
                PDF
              </button>
              <button
                type="button"
                title="Manual Print A4"
                onClick={async () => {
                  const pdf = await generateInvoicePDF(inv, company, true, 'p', inv.copyCount || 1);
                  printPdfDirect(pdf);
                }}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold cursor-pointer"
              >
                <Printer className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="Share Real Invoice PDF on WhatsApp"
                onClick={async () => {
                  const pdf = await generateInvoicePDF(inv, company, true, 'p', inv.copyCount || 1);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'whatsapp',
                    phone: partyRec?.phone,
                    email: partyRec?.email,
                    partyName: inv.partyName,
                    docNo: inv.invoiceNo,
                    docLabel: inv.docKind || 'Tax Invoice',
                    company,
                  });
                  setScanMsg(res.message);
                }}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
              >
                <MessageSquare className="w-3 h-3" />
              </button>
              <button
                type="button"
                title="Share Real Invoice PDF via Email"
                onClick={async () => {
                  const pdf = await generateInvoicePDF(inv, company, true, 'p', inv.copyCount || 1);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'email',
                    phone: partyRec?.phone,
                    email: partyRec?.email,
                    partyName: inv.partyName,
                    docNo: inv.invoiceNo,
                    docLabel: inv.docKind || 'Tax Invoice',
                    company,
                  });
                  setScanMsg(res.message);
                }}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
              >
                <Mail className="w-3 h-3" />
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleLoadInvoiceForEdit(inv)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold cursor-pointer"
                  title="Rectify / Edit Bill (Auto CRN/DRN on amount change)"
                >
                  <Edit3 className="w-3 h-3" />
                  Rectify
                </button>
              )}
              {!readOnly && (!inv.docKind || inv.docKind === 'Tax Invoice') && (
                <>
                  <button
                    type="button"
                    onClick={() => handleStartCreditNoteRebill(inv)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold cursor-pointer"
                    title="Issue Credit Note & Unlock Bilty/CNs for Re-Billing"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Credit Note &amp; Re-Bill
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartDebitNote(inv)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-800 font-bold cursor-pointer"
                    title="Issue GST Debit Note for Detention / Supplementary Charges"
                  >
                    +DN
                  </button>
                </>
              )}
              {isFinalized && inv.status !== 'Paid' && pendingDays >= 15 && (
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
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold cursor-pointer"
                    title="Send Overdue Payment Reminder on WhatsApp"
                  >
                    <MessageSquare className="w-3 h-3" />
                    15d+ WA
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
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer"
                    title="Send Overdue Payment Reminder via Email"
                  >
                    <Mail className="w-3 h-3" />
                    15d+ Email
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        cellClassName: 'text-right whitespace-nowrap space-x-1',
        render: (q) => {
          const partyRec = parties.find(
            (p) => p.name.trim().toLowerCase() === (q.partyName || '').trim().toLowerCase()
          );
          return (
            <>
              {!quotationReadOnly && (
                <button
                  type="button"
                  onClick={() => loadQuotationForEdit(q)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold cursor-pointer"
                  title="Rectify Quotation"
                >
                  <Edit3 className="w-3 h-3" />
                  Rectify
                </button>
              )}
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
              <button
                type="button"
                onClick={async () => {
                  const pdf = await generateQuotationPDF(q, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'whatsapp',
                    phone: q.partyPhone || partyRec?.phone,
                    email: q.partyEmail || partyRec?.email,
                    partyName: q.partyName,
                    docNo: q.quotationNo,
                    docLabel: 'Quotation',
                    company,
                  });
                  setScanMsg(res.message);
                }}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                title="Share Quotation PDF on WhatsApp"
              >
                <MessageSquare className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const pdf = await generateQuotationPDF(q, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'email',
                    phone: q.partyPhone || partyRec?.phone,
                    email: q.partyEmail || partyRec?.email,
                    partyName: q.partyName,
                    docNo: q.quotationNo,
                    docLabel: 'Quotation',
                    company,
                  });
                  setScanMsg(res.message);
                }}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                title="Share Quotation PDF via Email"
              >
                <Mail className="w-3 h-3" />
              </button>
            </>
          );
        },
      },
    ],
    [company, parties, onPreviewPdf]
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
        cellClassName: 'text-right whitespace-nowrap space-x-1',
        render: (d) => {
          const matchedParty = parties.find(
            (p) => p.name.trim().toLowerCase() === d.partyName.trim().toLowerCase()
          );
          return (
            <>
              {!declarationReadOnly && (
                <button
                  type="button"
                  onClick={() => loadDeclForEdit(d)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold cursor-pointer"
                  title="Rectify 194C Declaration"
                >
                  <Edit3 className="w-3 h-3" />
                  Rectify
                </button>
              )}
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
              <button
                type="button"
                onClick={async () => {
                  const pdf = await generateDeclaration194CPDF(d, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'whatsapp',
                    phone: matchedParty?.phone,
                    email: matchedParty?.email,
                    partyName: d.partyName,
                    docNo: `194C-${d.financialYear}`,
                    docLabel: 'Section 194C Declaration',
                    company,
                  });
                  setScanMsg(res.message);
                  URL.revokeObjectURL(pdf.blobUrl);
                }}
                className="p-1.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                title="Share Pure Binary 194C PDF on WhatsApp"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const pdf = await generateDeclaration194CPDF(d, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'email',
                    phone: matchedParty?.phone,
                    email: matchedParty?.email,
                    partyName: d.partyName,
                    docNo: `194C-${d.financialYear}`,
                    docLabel: 'Section 194C Declaration',
                    company,
                  });
                  setScanMsg(res.message);
                  URL.revokeObjectURL(pdf.blobUrl);
                }}
                className="p-1.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 cursor-pointer"
                title="Share Pure Binary 194C PDF via Email"
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
            </>
          );
        },
      },
    ],
    [company, onPreviewPdf, parties]
  );

  return (
    <div className="space-y-4">
      <input
        ref={lrScanRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleScanLRIntoBill(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
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

      {scanMsg && subTab !== 'invoice' && (
        <div className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{scanMsg}</span>
        </div>
      )}

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
                  Quick Unbilled CNs ({pickerConsignments.length})
                </button>
              </div>
            </div>

            {/* FoxPro Fast Keyboard Billing Strip */}
            <div className="px-4 py-2.5 bg-slate-900 text-white grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs border-b border-slate-700">
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Document Type *
                </label>
                <SearchableSelect
                  ariaLabel="Document Type"
                  value={docKind}
                  onChange={(val) => {
                    const nextKind =
                      val === 'Credit Note'
                        ? 'Credit Note'
                        : val === 'Debit Note'
                          ? 'Debit Note'
                          : 'Tax Invoice';
                    setDocKind(nextKind);
                    if (!editingInvoiceId) {
                      const code =
                        (billedAtBranch || branchTag)
                          .replace(/[^A-Z0-9]/gi, '')
                          .slice(0, 3)
                          .toUpperCase() || branchTag;
                      const pref =
                        nextKind === 'Credit Note'
                          ? `CRN/${code}`
                          : nextKind === 'Debit Note'
                            ? `DRN/${code}`
                            : code;
                      setInvoiceNo(`${pref}/${billId || '105'}/${fyShort}`);
                    }
                  }}
                  options={['Tax Invoice', 'Credit Note', 'Debit Note']}
                  buttonClassName="py-1 text-slate-900 font-extrabold bg-amber-50"
                />
              </div>
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
                      const pref =
                        docKind === 'Credit Note'
                          ? `CRN/${code}`
                          : docKind === 'Debit Note'
                            ? `DRN/${code}`
                            : code;
                      setInvoiceNo(`${pref}/${billId || '105'}/${fyShort}`);
                    }
                  }}
                  options={ALL_INDIA_BRANCH_OPTIONS}
                  placeholder="Branch..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-300 uppercase mb-0.5">
                  Bill ID &amp; Against Inv
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={billId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setBillId(nextId);
                      if (!editingInvoiceId) {
                        const code =
                          (billedAtBranch || branchTag)
                            .replace(/[^A-Z0-9]/gi, '')
                            .slice(0, 3)
                            .toUpperCase() || branchTag;
                        const pref =
                          docKind === 'Credit Note'
                            ? `CRN/${code}`
                            : docKind === 'Debit Note'
                              ? `DRN/${code}`
                              : code;
                        setInvoiceNo(`${pref}/${nextId || '105'}/${fyShort}`);
                      }
                    }}
                    placeholder="Bill ID"
                    className="w-16 px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white font-mono-num font-bold"
                  />
                  <input
                    type="text"
                    value={againstInvoiceNo}
                    onChange={(e) => setAgainstInvoiceNo(e.target.value)}
                    placeholder="Against Inv (CN/DN)"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-amber-200 font-mono-num"
                  />
                </div>
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
                  Open Unbilled Bilty ({modalUnbilledCns.length})
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
                    finalizeBill ? 'bg-emerald-500 text-slate-950' : 'bg-rose-600 text-white'
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
                      {editingInvoiceId || docKind !== 'Tax Invoice'
                        ? `(All Billing Parties: ${taxInvoiceCustomerParties.length})`
                        : `(Pending Unbilled Parties Only: ${taxInvoiceCustomerParties.length} of ${billingCustomerParties.length})`}
                    </span>
                  </label>
                  <div className="mb-1.5">
                    <SearchableSelect
                      ariaLabel="Bill To Party Customer Dropdown"
                      value={
                        selectedInvPartyId ||
                        (() => {
                          const clean = partyName.trim().toLowerCase();
                          const m = taxInvoiceCustomerParties.filter(
                            (p) => p.name.trim().toLowerCase() === clean
                          );
                          return m.length === 1 ? m[0].id : '';
                        })()
                      }
                      onChange={(nextId) => {
                        const chosen = taxInvoiceCustomerParties.find((p) => p.id === nextId);
                        if (chosen) applyPartyEntityDetails(chosen);
                      }}
                      placeholder={
                        editingInvoiceId || docKind !== 'Tax Invoice'
                          ? `-- Select Customer / Billing Party (${taxInvoiceCustomerParties.length}) --`
                          : `-- Select Party with Unbilled CN (${taxInvoiceCustomerParties.length} Pending) --`
                      }
                      searchPlaceholder="Search Party with Unbilled CNs..."
                      options={[
                        {
                          value: '',
                          label:
                            editingInvoiceId || docKind !== 'Tax Invoice'
                              ? `-- Select Customer / Billing Party (${taxInvoiceCustomerParties.length}) --`
                              : `-- Select Party with Unbilled CN (${taxInvoiceCustomerParties.length} Pending) --`,
                        },
                        ...taxInvoiceCustomerParties.map((p) => {
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
                    items={taxInvoiceCustomerParties}
                    getId={(p) => p.id}
                    getValue={(p) => p.name}
                    getSearchText={(p) =>
                      `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''}`
                    }
                    renderTitle={(p) => {
                      const unb = unbilledPartyCounts.get(p.name.trim().toLowerCase()) || 0;
                      return unb > 0 ? `[${unb} UNBILLED] ${p.name}` : p.name;
                    }}
                    renderBadge={(p) => {
                      const unb = unbilledPartyCounts.get(p.name.trim().toLowerCase()) || 0;
                      return unb > 0 ? `${unb} CN` : p.partyType;
                    }}
                    renderDetails={(p) => formatPartyDetailsLine(p)}
                    placeholder="Or search Unbilled Customer by Name, GSTIN, City, Address or Phone..."
                    required
                    quickPreview={(() => {
                      const clean = partyName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = taxInvoiceCustomerParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedInvPartyId
                          ? taxInvoiceCustomerParties.find((p) => p.id === selectedInvPartyId)
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
                  <label className="block font-semibold text-slate-700 mb-1">
                    Party Address &amp; Auto-PIN {partyPinCode ? <span className="text-emerald-700 font-mono-num">({partyPinCode})</span> : ''}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={partyAddress}
                      onChange={(e) => setPartyAddress(e.target.value)}
                      placeholder="City / Address (auto-fills PIN & Country)"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded border border-slate-300"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={partyPinCode}
                      onChange={(e) => setPartyPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="PIN"
                      title="Auto-filled Postal PIN Code (India 6d / BD 4d / NP & BT 5d)"
                      className="w-20 px-2 py-1.5 rounded border border-emerald-300 bg-emerald-50/40 font-mono-num font-bold text-emerald-900"
                    />
                  </div>
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
                    <GstinInputField
                      label={isExportCountry ? 'Party GSTIN (Optional)' : 'Party GSTIN'}
                      value={partyGstin}
                      onChange={(val) => {
                        setPartyGstin(val);
                        const st = resolveGstStateCode(val, partyAddress, billingCountry);
                        if (st.code) setPartyStateCode(st.code);
                        applyAutoGstRules(billingCountry, val, gstPaidBy);
                      }}
                      placeholder={isExportCountry ? 'Optional (Export)' : '19XXXXX... (WB) or other'}
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
                    Invoice No * {!editingInvoiceId && docKind === 'Tax Invoice' && company.lastSavedNoLock !== false ? '(Last Saved No + 1 Lock)' : autoAtomicInvoice ? '(Atomic)' : ''}
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!editingInvoiceId && docKind === 'Tax Invoice' && company.lastSavedNoLock !== false}
                    value={!editingInvoiceId && docKind === 'Tax Invoice' && company.lastSavedNoLock !== false ? nextSequentialBillInfo.formattedNo : invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold disabled:bg-blue-50 disabled:text-blue-800"
                  />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Inv Date *</label>
                    <input
                      ref={billDateInputRef}
                      type="date"
                      required
                      value={invoiceDate}
                      onChange={(e) => {
                        setInvoiceDate(e.target.value);
                        updateDueDateFromCredit(e.target.value, creditDays);
                      }}
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
                    <label className="block font-semibold text-slate-700 mb-1">Credit Days</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={creditDays}
                      onChange={(e) => {
                        const d = Math.max(0, Math.min(365, Number(e.target.value) || 0));
                        setCreditDays(d);
                        updateDueDateFromCredit(invoiceDate, d);
                      }}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-center"
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
                  <label className="block font-semibold text-slate-700 mb-1">PO / Work Order No.</label>
                  <input
                    type="text"
                    value={poWorkOrderNo}
                    onChange={(e) => setPoWorkOrderNo(e.target.value)}
                    placeholder="Optional Customer PO / WO No."
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
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

              {/* Smart Vehicle-Grouped Unbilled CN Panel, Combined vs Separate Bills & Unbilled CN Rectification */}
              {docKind === 'Tax Invoice' && partyName.trim() && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-indigo-700" />
                      <div>
                        <p className="text-xs font-extrabold text-indigo-950">
                          Smart Vehicle-Grouped Billing &amp; Unbilled CN Rectification — {partyName.trim()}
                        </p>
                        <p className="text-[11px] text-indigo-800">
                          {selectedPartyUnbilledCns.length > 0
                            ? `${selectedPartyUnbilledCns.length} unbilled CN(s) across ${partyUnbilledTruckGroups.length} vehicle(s). Same-truck CNs can combine into 1 invoice, or generate 1 separate invoice per truck.`
                            : 'No pending unbilled Bilty/CNs found for this party.'}
                        </p>
                      </div>
                    </div>

                    {!editingInvoiceId && partyUnbilledTruckGroups.length > 1 && !readOnly && (
                      <button
                        type="button"
                        disabled={batchSavingTrucks}
                        onClick={handleGenerateSeparateInvoicesPerTruck}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        {batchSavingTrucks
                          ? 'Generating Truck Invoices...'
                          : `Generate ${partyUnbilledTruckGroups.length} Separate Invoices (1 per Truck No)`}
                      </button>
                    )}
                  </div>

                  {partyUnbilledTruckGroups.length > 0 && (
                    <div className="space-y-2.5">
                      {partyUnbilledTruckGroups.map((group) => {
                        const isMultiCnTruck = group.cns.length > 1;
                        const isDividing = busyCnActionId === `truck:${group.truckLabel}`;
                        const divideVal = divideFreightMap[group.truckKey] ?? String(group.totalFreight || '');
                        return (
                          <div
                            key={group.truckKey}
                            className="rounded-lg border border-indigo-200 bg-white overflow-hidden"
                          >
                            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-900 text-amber-300 font-mono-num text-[11px] font-extrabold">
                                  {group.truckLabel}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                                    isMultiCnTruck
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {group.cns.length} CN{isMultiCnTruck ? 's · Same Truck (Combine Eligible)' : ''}
                                </span>
                                <span className="text-[11px] font-mono-num text-slate-700 font-semibold">
                                  Wt: {group.totalWeight.toFixed(2)} MT · Sum: ₹{formatINR(group.totalFreight)}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                {isMultiCnTruck && !readOnly && (
                                  <div className="flex items-center gap-1 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5">
                                    <Split className="w-3 h-3 text-amber-700 shrink-0" />
                                    <span className="text-[10px] font-bold text-amber-900">Divide ₹:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={divideVal}
                                      onChange={(e) =>
                                        setDivideFreightMap((prev) => ({
                                          ...prev,
                                          [group.truckKey]: e.target.value,
                                        }))
                                      }
                                      className="w-20 px-1.5 py-0.5 rounded border border-amber-300 bg-white text-[11px] font-mono-num text-right"
                                      placeholder="Truck ₹"
                                    />
                                    <button
                                      type="button"
                                      disabled={isDividing}
                                      onClick={() =>
                                        handleDivideTruckGroupFreight(
                                          group.cns,
                                          group.truckLabel,
                                          divideVal,
                                          'equal'
                                        )
                                      }
                                      className="px-1.5 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                                    >
                                      Split Equal
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDividing}
                                      onClick={() =>
                                        handleDivideTruckGroupFreight(
                                          group.cns,
                                          group.truckLabel,
                                          divideVal,
                                          'weight'
                                        )
                                      }
                                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                                    >
                                      By Wt
                                    </button>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleLoadTruckGroupIntoInvoice(group.cns, group.truckLabel)}
                                  className={`px-2.5 py-1 rounded text-[11px] font-extrabold cursor-pointer ${
                                    isMultiCnTruck
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                                  }`}
                                >
                                  {isMultiCnTruck
                                    ? `Combine ${group.cns.length} CNs into 1 Invoice`
                                    : 'Load into 1 Invoice'}
                                </button>
                              </div>
                            </div>

                            <div className="divide-y divide-slate-100">
                              {group.cns.map((cn) => {
                                const currentParty = resolveCnBillingParty(cn);
                                const nextPartyDraft = rectifyPartyMap[cn.id] ?? currentParty;
                                const nextFreightDraft =
                                  editCnFreightMap[cn.id] ?? String(roundPaise(cn.totalFreight || 0));
                                const partyChanged =
                                  nextPartyDraft.trim().toLowerCase() !== currentParty.toLowerCase();
                                const freightChanged =
                                  roundPaise(Number(nextFreightDraft) || 0) !==
                                  roundPaise(Number(cn.totalFreight || 0));
                                const cnBusy = busyCnActionId === cn.id;

                                return (
                                  <div
                                    key={cn.id}
                                    className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                                  >
                                    <div className="min-w-[200px]">
                                      <span className="font-mono-num font-extrabold text-blue-900">
                                        {cn.cnNo}
                                      </span>{' '}
                                      · {formatDateDDMMYYYY(cn.cnDate)} · {cn.fromCity} → {cn.toCity} ·{' '}
                                      <span className="font-mono-num">
                                        {Number(cn.nettWeight || 0).toFixed(2)} MT
                                      </span>
                                    </div>

                                    {!readOnly && (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex items-center gap-1">
                                          <ArrowRightLeft className="w-3 h-3 text-indigo-600 shrink-0" />
                                          <div className="w-52">
                                            <SearchableSelect
                                              ariaLabel={`Rectify Billing Party for ${cn.cnNo}`}
                                              value={nextPartyDraft}
                                              onChange={(val) =>
                                                setRectifyPartyMap((prev) => ({ ...prev, [cn.id]: val }))
                                              }
                                              options={billingCustomerParties.map((p) => ({
                                                value: p.name,
                                                label: p.name,
                                              }))}
                                              placeholder="Billing Party..."
                                              buttonClassName="py-0.5 text-[11px] bg-white"
                                            />
                                          </div>
                                          {partyChanged && (
                                            <button
                                              type="button"
                                              disabled={cnBusy}
                                              onClick={() =>
                                                handleRectifyUnbilledCnParty(cn, nextPartyDraft)
                                              }
                                              className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer disabled:opacity-50"
                                            >
                                              {cnBusy ? '...' : 'Move Party'}
                                            </button>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-1">
                                          <span className="font-bold text-slate-600">Freight ₹</span>
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={nextFreightDraft}
                                            onChange={(e) =>
                                              setEditCnFreightMap((prev) => ({
                                                ...prev,
                                                [cn.id]: e.target.value,
                                              }))
                                            }
                                            className="w-24 px-2 py-0.5 rounded border border-slate-300 font-mono-num text-right font-bold"
                                          />
                                          <button
                                            type="button"
                                            disabled={cnBusy || !freightChanged}
                                            onClick={() =>
                                              handleSaveUnbilledCnFreight(cn, nextFreightDraft)
                                            }
                                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-40"
                                          >
                                            Save ₹
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

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
                      <SearchableSelect
                        ariaLabel="Advance Payment Mode"
                        value={advanceMode}
                        onChange={setAdvanceMode}
                        sortAlphabetically={false}
                        options={PAYMENT_MODE_OPTIONS}
                        buttonClassName="!py-1 !text-xs"
                      />
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
                      <SearchableSelect
                        ariaLabel="Full Payment Mode"
                        value={fullPaymentMode}
                        onChange={setFullPaymentMode}
                        sortAlphabetically={false}
                        options={PAYMENT_MODE_OPTIONS}
                        buttonClassName="!py-1 !text-xs"
                      />
                    </div>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-300">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoRoundOff}
                          onChange={(e) => setAutoRoundOff(e.target.checked)}
                        />
                        Auto Round-Off ({roundOffAmt >= 0 ? '+' : ''}
                        {roundOffAmt.toFixed(2)})
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900">GROSS / GRAND TOTAL:</span>
                        <span className="text-base font-extrabold font-mono-num text-[#0D47A1]">
                          ₹ {formatINR(grandTotal)}
                        </span>
                        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 cursor-pointer ml-1">
                          <input
                            type="checkbox"
                            checked={hasManualTotalOverride}
                            onChange={(e) =>
                              setManualTotalOverride(
                                e.target.checked ? String(computedGrossBillAmount) : null
                              )
                            }
                          />
                          Manual Override
                        </label>
                        {hasManualTotalOverride && (
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            aria-label="Manual Grand Total Override"
                            value={manualTotalOverride ?? ''}
                            onChange={(e) => setManualTotalOverride(e.target.value)}
                            className="w-28 px-2 py-0.5 rounded border border-amber-400 bg-amber-50 font-mono-num font-bold text-amber-950 text-xs"
                          />
                        )}
                      </div>
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

              {/* Tally-Grade Auto Narration Row */}
              <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold text-blue-900 uppercase">
                    Voucher Narration (Auto-Generated · Editable for Tax Audit)
                  </label>
                  {narrationCustom && (
                    <button
                      type="button"
                      onClick={() => {
                        setNarrationCustom(false);
                        setNarrationText('');
                      }}
                      className="text-[10px] font-bold text-blue-700 underline cursor-pointer"
                    >
                      Reset to Auto Narration
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={effectiveNarration}
                  onChange={(e) => {
                    setNarrationCustom(true);
                    setNarrationText(e.target.value);
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white text-xs text-slate-800"
                />
              </div>
            </div>

            {/* FoxPro Keyboard Bilty Selection Modal */}
            {biltyModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-4">
                <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-300 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-extrabold">
                        FoxPro Unbilled Bilty Picker — {partyName ? partyName : 'Pending Unbilled CNs'} ({modalUnbilledCns.length} Unbilled)
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
                        {partyName
                          ? `No pending unbilled Bilty/CNs found for ${partyName}.`
                          : 'All Consignment Notes are already marked billed.'}
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
                                ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-600'
                                : isCursor
                                  ? 'bg-amber-50 ring-1 ring-inset ring-amber-500'
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

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
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

                <div className="flex flex-wrap items-center gap-2">
                  {!editingInvoiceId && filteredInvoices.length > 0 && (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => handleLoadInvoiceForEdit(filteredInvoices[0])}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold cursor-pointer disabled:opacity-40"
                      title="Reload latest Tax Invoice for Rectification (keeps serial number & creates CRN/DRN on amount change)"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Rectify Last
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => lrScanRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-900 cursor-pointer"
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    Scan LR
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const pdf = await generateInvoicePDF(
                        buildInvoiceObject(),
                        company,
                        includeAnnexure,
                        'p',
                        copyCount
                      );
                      onPreviewPdf(pdf, 'Bills_Invoices');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview PDF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const pdf = await generateInvoicePDF(
                        buildInvoiceObject(),
                        company,
                        includeAnnexure,
                        'p',
                        copyCount
                      );
                      printPdfDirect(pdf);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Manual Print
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const pdf = await generateInvoicePDF(
                        buildInvoiceObject(),
                        company,
                        includeAnnexure,
                        'p',
                        copyCount
                      );
                      downloadPdfDirect(pdf);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-xs font-bold text-blue-900 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Low-KB PDF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const partyRec = parties.find(
                        (p) => p.name.trim().toLowerCase() === partyName.trim().toLowerCase()
                      );
                      const invObj = buildInvoiceObject();
                      const pdf = await generateInvoicePDF(
                        invObj,
                        company,
                        includeAnnexure,
                        'p',
                        copyCount
                      );
                      const res = await sharePdfDirect({
                        pdf,
                        channel: 'whatsapp',
                        phone: partyRec?.phone,
                        email: partyRec?.email,
                        partyName: invObj.partyName,
                        docNo: invObj.invoiceNo,
                        docLabel: docKind,
                        company,
                      });
                      setScanMsg(res.message);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                    title="Attach & Share Real Invoice PDF on WhatsApp"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    WhatsApp PDF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const partyRec = parties.find(
                        (p) => p.name.trim().toLowerCase() === partyName.trim().toLowerCase()
                      );
                      const invObj = buildInvoiceObject();
                      const pdf = await generateInvoicePDF(
                        invObj,
                        company,
                        includeAnnexure,
                        'p',
                        copyCount
                      );
                      const res = await sharePdfDirect({
                        pdf,
                        channel: 'email',
                        phone: partyRec?.phone,
                        email: partyRec?.email,
                        partyName: invObj.partyName,
                        docNo: invObj.invoiceNo,
                        docLabel: docKind,
                        company,
                      });
                      setScanMsg(res.message);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                    title="Attach & Share Real Invoice PDF via Email"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Email PDF
                  </button>
                  <button
                    type="button"
                    onClick={resetInvoiceForm}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Bill
                  </button>
                  <button
                    ref={saveInvBtnRef}
                    type="submit"
                    disabled={savingInv || readOnly}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-white text-xs font-bold cursor-pointer disabled:opacity-50 bg-blue-700 hover:bg-blue-800"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingInv
                      ? 'Saving...'
                      : editingInvoiceId
                        ? 'Save Rectified Bill'
                        : 'Save Bill'}
                  </button>
                </div>
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
                <div className="w-44">
                  <SearchableSelect
                    ariaLabel="Quotation Division"
                    value={qDivision}
                    onChange={(val) =>
                      setQDivision(
                        val === 'LOGISTICS' || val === 'PTL' || val === 'COURIER' ? val : 'FTL'
                      )
                    }
                    options={[
                      { value: 'FTL', label: 'FTL Division' },
                      { value: 'LOGISTICS', label: 'LOGISTICS Division' },
                      { value: 'PTL', label: 'PTL Division' },
                      { value: 'COURIER', label: 'COURIER Division' },
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
                  Quotation No * {!editingQuotationId && company.lastSavedNoLock !== false ? '(Last Saved No + 1 Lock)' : autoAtomicQuotation ? '(Atomic)' : ''}
                </label>
                <input
                  type="text"
                  required
                  disabled={!editingQuotationId && company.lastSavedNoLock !== false}
                  value={!editingQuotationId && company.lastSavedNoLock !== false ? nextSequentialQuotationNo : qNo}
                  onChange={(e) => setQNo(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num disabled:bg-blue-50 disabled:text-blue-800 disabled:font-bold"
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
                <GstinInputField
                  label="Party GSTIN"
                  value={qGstin}
                  onChange={setQGstin}
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
                <PinCountryInputs
                  labelPrefix="Dest"
                  pinCode={qDestinationPinCode}
                  country={qDestinationCountry}
                  onPinChange={setQDestinationPinCode}
                  onCountryChange={setQDestinationCountry}
                  compact
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
                <label className="block font-semibold text-slate-700 mb-1">Entry Point / Border Hub</label>
                <input
                  type="text"
                  value={qEntryPoint}
                  onChange={(e) => setQEntryPoint(e.target.value)}
                  placeholder="Petrapole / Raxaul / Jaigaon / As Applicable"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <PinCountryInputs
                  labelPrefix="Border"
                  pinCode={qEntryPointPinCode}
                  country={qEntryPointCountry}
                  onPinChange={setQEntryPointPinCode}
                  onCountryChange={setQEntryPointCountry}
                  compact
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
            {/* Dynamic Multi-Row Route & Vehicle Rate Schedule (Page 1 PDF) */}
            <div className="mx-4 mb-3 rounded-lg border border-blue-200 bg-blue-50/40 overflow-hidden">
              <div className="px-3 py-2 bg-[#0D47A1]/10 border-b border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#0D47A1]">
                  Multi-Row Route &amp; Vehicle Rate Schedule ({qRouteRates.length} Route(s))
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setQRouteRates((prev) => [
                      ...prev,
                      {
                        slNo: prev.length + 1,
                        origin: qEntryPoint.trim() || 'Kolkata',
                        destination: qDest.trim() || 'KOLKATA to SILIGURI',
                        vehicleType: qVehicleType.trim() || '09 TON Open / Closed Truck',
                        loadCapacity: qTonGuarantee.trim() || '09 TON Loading Capacity',
                        freightRate: Number(qFreight) || 0,
                        detentionExtra: qDetention || 'YES Extra Charges',
                        remarks: qAdvance || 'No Advance Before Lorry Loading',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0D47A1] hover:bg-blue-900 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add Row
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-left">
                      <th className="px-2 py-1.5 w-10">Sl</th>
                      <th className="px-2 py-1.5">Origin</th>
                      <th className="px-2 py-1.5">Destination</th>
                      <th className="px-2 py-1.5">Vehicle Type</th>
                      <th className="px-2 py-1.5">Load Capacity</th>
                      <th className="px-2 py-1.5 w-28">Freight Rate (₹)</th>
                      <th className="px-2 py-1.5">Detention / Extra</th>
                      <th className="px-2 py-1.5">Remarks</th>
                      <th className="px-2 py-1.5 w-10 text-center">Del</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qRouteRates.map((rr, idx) => (
                      <tr key={idx} className="border-b border-slate-200 bg-white">
                        <td className="px-2 py-1 font-mono-num font-bold text-center">{idx + 1}</td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={rr.origin}
                            onChange={(e) => {
                              const v = e.target.value;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, origin: v } : x))
                              );
                              if (idx === 0) setQEntryPoint(v);
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={rr.destination}
                            onChange={(e) => {
                              const v = e.target.value;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, destination: v } : x))
                              );
                              if (idx === 0) setQDest(v);
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={rr.vehicleType}
                            onChange={(e) => {
                              const v = e.target.value;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, vehicleType: v } : x))
                              );
                              if (idx === 0) setQVehicleType(v);
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={rr.loadCapacity}
                            onChange={(e) => {
                              const v = e.target.value;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, loadCapacity: v } : x))
                              );
                              if (idx === 0) setQTonGuarantee(v);
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number"
                            value={rr.freightRate}
                            onChange={(e) => {
                              const num = Number(e.target.value) || 0;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, freightRate: num } : x))
                              );
                              if (idx === 0) setQFreight(String(num));
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300 font-mono-num font-bold text-right"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={rr.detentionExtra}
                            onChange={(e) => {
                              const v = e.target.value;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, detentionExtra: v } : x))
                              );
                              if (idx === 0) setQDetention(v);
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={rr.remarks}
                            onChange={(e) => {
                              const v = e.target.value;
                              setQRouteRates((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, remarks: v } : x))
                              );
                              if (idx === 0) setQAdvance(v);
                            }}
                            className="w-full px-1.5 py-1 rounded border border-slate-300"
                          />
                        </td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            disabled={qRouteRates.length <= 1}
                            onClick={() =>
                              setQRouteRates((prev) =>
                                prev
                                  .filter((_, i) => i !== idx)
                                  .map((row, ri) => ({ ...row, slNo: ri + 1 }))
                              )
                            }
                            className="p-1 rounded hover:bg-red-50 text-red-600 disabled:opacity-30 cursor-pointer"
                            title="Remove Route Row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mx-4 mb-3 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-red-700 shrink-0" />
              <span>
                EMAIL-ONLY ACCEPTANCE POLICY PRINTED ON A4 PDF: Signed Quotation acceptance is valid ONLY via Official Email ({company.email}) — WhatsApp / SMS acceptance is NOT accepted.
              </span>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-end gap-2">
              {!editingQuotationId && filteredQuotations.length > 0 && (
                <button
                  type="button"
                  disabled={quotationReadOnly}
                  onClick={() => loadQuotationForEdit(filteredQuotations[0])}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold cursor-pointer disabled:opacity-40"
                  title="Reload latest Quotation for Rectification (keeps serial no intact)"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Rectify Last
                </button>
              )}
              <button
                type="button"
                onClick={() => lrScanRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold cursor-pointer"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Scan
              </button>
              <button
                type="button"
                onClick={async () => {
                  const qObj = buildQuotationObject();
                  if (!qObj.partyName) {
                    setScanMsg('Enter Quotation Party Name before sharing PDF.');
                    return;
                  }
                  const pdf = await generateQuotationPDF(qObj, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'whatsapp',
                    phone: qObj.partyPhone,
                    email: qObj.partyEmail,
                    partyName: qObj.partyName,
                    docNo: qObj.quotationNo,
                    docLabel: 'Quotation',
                    company,
                  });
                  setScanMsg(res.message);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                title="Share Real Quotation PDF on WhatsApp"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                WhatsApp PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  const qObj = buildQuotationObject();
                  if (!qObj.partyName) {
                    setScanMsg('Enter Quotation Party Name before sharing PDF.');
                    return;
                  }
                  const pdf = await generateQuotationPDF(qObj, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'email',
                    phone: qObj.partyPhone,
                    email: qObj.partyEmail,
                    partyName: qObj.partyName,
                    docNo: qObj.quotationNo,
                    docLabel: 'Quotation',
                    company,
                  });
                  setScanMsg(res.message);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                title="Share Real Quotation PDF via Email"
              >
                <Mail className="w-3.5 h-3.5" />
                Email PDF
              </button>
              {editingQuotationId && (
                <button
                  type="button"
                  onClick={resetQuotationForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  const qObj = buildQuotationObject();
                  if (!qObj.partyName) {
                    setScanMsg('Enter Quotation Party Name before downloading PDF.');
                    return;
                  }
                  const pdf = await generateQuotationPDF(qObj, company);
                  downloadPdfDirect(pdf);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Low-KB PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  const qObj = buildQuotationObject();
                  if (!qObj.partyName) {
                    setScanMsg('Enter Quotation Party Name before printing.');
                    return;
                  }
                  const pdf = await generateQuotationPDF(qObj, company);
                  printPdfDirect(pdf);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Manual Print
              </button>
              <button
                type="button"
                onClick={async () => {
                  const qObj = buildQuotationObject();
                  if (!qObj.partyName) {
                    setScanMsg('Enter Quotation Party Name before previewing PDF.');
                    return;
                  }
                  const pdf = await generateQuotationPDF(qObj, company);
                  onPreviewPdf(pdf, 'Quotations');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview PDF
              </button>
              <button
                type="submit"
                disabled={quotationReadOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingQuotationId ? 'Save Rectified Quotation' : 'Save Quotation'}
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
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                Declaration Under Section 194C (Non-Deduction of Tax) — Proprietor: Subhajit Saha (PAN: {company.pan})
              </span>
              <div className="w-44">
                <SearchableSelect
                  ariaLabel="194C Division"
                  value={dDivision}
                  onChange={(val) =>
                    setDDivision(
                      val === 'LOGISTICS' || val === 'PTL' || val === 'COURIER' ? val : 'FTL'
                    )
                  }
                  options={[
                    { value: 'FTL', label: 'FTL Division' },
                    { value: 'LOGISTICS', label: 'LOGISTICS Division' },
                    { value: 'PTL', label: 'PTL Division' },
                    { value: 'COURIER', label: 'COURIER Division' },
                  ]}
                  buttonClassName="py-1 text-[#0D47A1] font-extrabold"
                />
              </div>
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
                <GstinInputField
                  label="Party GSTIN"
                  value={dGstin}
                  onChange={setDGstin}
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
                <PinCountryInputs
                  labelPrefix="Place"
                  pinCode={dPlacePinCode}
                  country={dPlaceCountry}
                  onPinChange={setDPlacePinCode}
                  onCountryChange={setDPlaceCountry}
                  compact
                />
              </div>
            </div>
            <div className="px-4 py-2.5 bg-blue-50 border-t border-blue-200 text-xs text-blue-900">
              Includes Royal Blue Dolphin Ring top-left logo, 11% Twin-Dolphin Heart D.R.C center watermark, Proprietor PAN Card photo bottom-left (PAN: {company.pan}), and Subhajit Saha Proprietor Signature with Blue Round Seal bottom-right identically across all 4 divisions.
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-end gap-2">
              {!editingDeclId && filteredDeclarations.length > 0 && (
                <button
                  type="button"
                  disabled={declarationReadOnly}
                  onClick={() => loadDeclForEdit(filteredDeclarations[0])}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold cursor-pointer disabled:opacity-40"
                  title="Reload latest Section 194C Declaration for Rectification"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Rectify Last
                </button>
              )}
              <button
                type="button"
                onClick={() => lrScanRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold cursor-pointer"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Scan
              </button>
              <button
                type="button"
                onClick={async () => {
                  const decl = buildDeclarationObject();
                  if (!decl.partyName) {
                    setScanMsg('Select or enter Party Name before sharing 194C PDF.');
                    return;
                  }
                  const matched = parties.find(
                    (p) => p.name.trim().toLowerCase() === decl.partyName.trim().toLowerCase()
                  );
                  const pdf = await generateDeclaration194CPDF(decl, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'whatsapp',
                    phone: matched?.phone,
                    email: matched?.email,
                    partyName: decl.partyName,
                    docNo: `194C-${decl.financialYear}`,
                    docLabel: 'Section 194C Declaration',
                    company,
                  });
                  setScanMsg(res.message);
                  URL.revokeObjectURL(pdf.blobUrl);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                title="Share Pure Binary 194C PDF on WhatsApp"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                WhatsApp PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  const decl = buildDeclarationObject();
                  if (!decl.partyName) {
                    setScanMsg('Select or enter Party Name before sharing 194C PDF.');
                    return;
                  }
                  const matched = parties.find(
                    (p) => p.name.trim().toLowerCase() === decl.partyName.trim().toLowerCase()
                  );
                  const pdf = await generateDeclaration194CPDF(decl, company);
                  const res = await sharePdfDirect({
                    pdf,
                    channel: 'email',
                    phone: matched?.phone,
                    email: matched?.email,
                    partyName: decl.partyName,
                    docNo: `194C-${decl.financialYear}`,
                    docLabel: 'Section 194C Declaration',
                    company,
                  });
                  setScanMsg(res.message);
                  URL.revokeObjectURL(pdf.blobUrl);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                title="Share Pure Binary 194C PDF via Email"
              >
                <Mail className="w-3.5 h-3.5" />
                Email PDF
              </button>
              {editingDeclId && (
                <button
                  type="button"
                  onClick={resetDeclForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  const decl = buildDeclarationObject();
                  if (!decl.partyName) {
                    setScanMsg('Select or enter Party Name before downloading 194C PDF.');
                    return;
                  }
                  const pdf = await generateDeclaration194CPDF(decl, company);
                  downloadPdfDirect(pdf);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Low-KB PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  const decl = buildDeclarationObject();
                  if (!decl.partyName) {
                    setScanMsg('Select or enter Party Name before printing 194C PDF.');
                    return;
                  }
                  const pdf = await generateDeclaration194CPDF(decl, company);
                  printPdfDirect(pdf);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Manual Print
              </button>
              <button
                type="button"
                onClick={async () => {
                  const decl = buildDeclarationObject();
                  if (!decl.partyName) {
                    setScanMsg('Select or enter Party Name before previewing 194C PDF.');
                    return;
                  }
                  const pdf = await generateDeclaration194CPDF(decl, company);
                  onPreviewPdf(pdf, 'Declarations');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview 194C PDF
              </button>
              <button
                type="submit"
                disabled={declarationReadOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingDeclId ? 'Save Rectified 194C' : 'Save 194C Declaration'}
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
