import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  Printer,
  ReceiptText,
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
  ALL_INDIA_STATES_DISTRICTS,
  getEffectiveDropdownList,
} from '../lib/dropdownMasterStore';
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
  const fyShort = getFyShortCode(activeFy);

  // ---- TAX INVOICE STATE ----
  const branchTag = activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode.slice(0, 3) : 'KOL';
  const [invDivision, setInvDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [autoAtomicInvoice, setAutoAtomicInvoice] = useState(true);
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
  const [detentionCharges, setDetentionCharges] = useState('0');
  const [unloadingCharges, setUnloadingCharges] = useState('0');
  const [stCharges, setStCharges] = useState('0');
  const [remarks, setRemarks] = useState('');
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

  const detNum = Math.max(0, Number(detentionCharges) || 0);
  const unlNum = Math.max(0, Number(unloadingCharges) || 0);
  const stNum = Math.max(0, Number(stCharges) || 0);
  const taxableSubtotal = freightSum + detNum + unlNum + stNum;
  const effectiveGstRate = isExportCountry ? 0 : gstRate;
  const totalTax = Number(((taxableSubtotal * effectiveGstRate) / 100).toFixed(2));
  const cgstAmt = isExportCountry || interstate ? 0 : Number((totalTax / 2).toFixed(2));
  const sgstAmt = isExportCountry || interstate ? 0 : Number((totalTax - cgstAmt).toFixed(2));
  const igstAmt = !isExportCountry && interstate ? totalTax : 0;
  const grandTotal = Number(
    (isExportCountry || reverseCharge ? taxableSubtotal : taxableSubtotal + totalTax).toFixed(2)
  );

  const pickerConsignments = useMemo(() => {
    const q = debouncedCnPickerSearch.trim().toLowerCase();
    const list = q
      ? consignments.filter((cn) =>
          `${cn.cnNo} ${cn.truckNo} ${cn.consignorName} ${cn.fromCity} ${cn.toCity}`
            .toLowerCase()
            .includes(q)
        )
      : consignments;
    return list.slice(0, 50);
  }, [consignments, debouncedCnPickerSearch]);

  // Strictly Customer / Billing Parties ONLY (excludes Brokers, Vehicle Owners, Vendors & Drivers)
  const billingCustomerParties = useMemo(
    () =>
      filterBillingCustomerParties({
        parties,
        drivers,
        lorryHires,
        invoices,
        consignments,
      }),
    [parties, drivers, lorryHires, invoices, consignments]
  );

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

  const buildInvoiceObject = (overrideNo?: string): Invoice => ({
    id: 'preview',
    invoiceNo: (overrideNo || invoiceNo).trim(),
    invoiceDate,
    dueDate,
    financialYear: normalizeFyLabel(activeFy),
    division: invDivision,
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
    detentionCharges: detNum,
    unloadingCharges: unlNum,
    stCharges: stNum,
    grandTotal,
    paidAmount: 0,
    status: 'Unpaid',
    remarks,
    copyCount,
    selectedBankId: selectedBankId || undefined,
    consignmentRows: rows.filter((r) => r.cnNo || r.vehicle || r.freight > 0),
    annexureLorries: rows
      .filter((r) => r.cnNo || r.vehicle)
      .map((r) => ({ cnNo: r.cnNo || '-', lorryNumbers: r.vehicle || '-' })),
    branchCode: activeBranchCode,
    createdByStaff: activeStaffCode,
    ownerUid,
  });

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
      if (autoAtomicInvoice) {
        try {
          const serial = await reserveNextSerialNumber({
            type: 'invoice',
            fy: activeFy,
            branchCode: activeBranchCode,
            staffCode: activeStaffCode,
            ownerUid,
          });
          finalInvoiceNo = serial.formattedNo;
          setInvoiceNo(finalInvoiceNo);
        } catch {
          // Offline fallback preserves entered invoiceNo
        }
      }

      const id = makeSafeDocId('inv');
      const invObj = buildInvoiceObject(finalInvoiceNo);
      await upsertDocument(
        'invoices',
        id,
        {
          invoiceNo: invObj.invoiceNo,
          invoiceDate: invObj.invoiceDate,
          dueDate: invObj.dueDate,
          financialYear: normalizeFyLabel(activeFy),
          division: invDivision,
          partyName: invObj.partyName,
          partyAddress: invObj.partyAddress,
          partyGstin: invObj.partyGstin,
          partyPan: invObj.partyPan,
          billingCountry: invObj.billingCountry,
          sac: invObj.sac,
          reverseCharge: invObj.reverseCharge,
          interstate: invObj.interstate,
          gstPaidBy: invObj.gstPaidBy,
          gstRate: invObj.gstRate,
          cgstAmt: invObj.cgstAmt,
          sgstAmt: invObj.sgstAmt,
          igstAmt: invObj.igstAmt,
          totalTax: invObj.totalTax,
          freightCharges: invObj.freightCharges,
          detentionCharges: invObj.detentionCharges,
          unloadingCharges: invObj.unloadingCharges,
          stCharges: invObj.stCharges,
          grandTotal: invObj.grandTotal,
          paidAmount: 0,
          status: 'Unpaid',
          remarks: invObj.remarks,
          copyCount: invObj.copyCount,
          selectedBankId: invObj.selectedBankId || '',
          consignmentRows: validRows,
          annexureLorries: invObj.annexureLorries || [],
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        true
      );
      await logBranchActivity({
        action: 'Created Tax Invoice',
        module: 'Billing',
        docRefCode: finalInvoiceNo,
        summary: `Billed ${invObj.partyName} (${billingCountry}) · ₹${formatINR(invObj.grandTotal)} (${validRows.length} CNs)`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      const pdf = await generateInvoicePDF(invObj, company, includeAnnexure, 'p', copyCount);
      onPreviewPdf(pdf, 'Bills_Invoices');
      setInvoiceNo(`${branchTag}/${106 + invoices.length}/${fyShort}`);
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
                Tax Invoice / Bill of Supply Builder ({activeBranchCode}) — Background PDF &amp; Atomic Serials
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Invoice Division"
                  value={invDivision}
                  onChange={(e) => setInvDivision(e.target.value === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
                  className="px-2 py-1 rounded bg-white text-[#0D47A1] text-xs font-extrabold cursor-pointer"
                >
                  <option value="FTL">FTL Division</option>
                  <option value="LOGISTICS">LOGISTICS Division</option>
                </select>
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
                  onClick={() => setShowCnPicker((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Pick Saved CNs ({consignments.length})
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
                      (Customers Only: {billingCustomerParties.length})
                    </span>
                  </label>
                  <select
                    aria-label="Bill To Party Customer Dropdown"
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
                    onChange={(e) => {
                      const chosen = billingCustomerParties.find((p) => p.id === e.target.value);
                      if (chosen) applyPartyEntityDetails(chosen);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-blue-50/40 font-semibold text-slate-900 mb-1.5 cursor-pointer"
                  >
                    <option value="">
                      -- Select Customer / Billing Party ({billingCustomerParties.length}) --
                    </option>
                    {billingCustomerParties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} | {formatPartyDetailsLine(p)}
                      </option>
                    ))}
                  </select>
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
                  <select
                    aria-label="Billing Country"
                    value={billingCountry}
                    onChange={(e) => {
                      const nextC = e.target.value as 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan';
                      setBillingCountry(nextC);
                      setInvValidationError(null);
                      const st = resolveGstStateCode(partyGstin, partyAddress, nextC);
                      setPartyStateCode(st.code);
                      applyAutoGstRules(nextC, partyGstin, gstPaidBy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="India">India (Auto GST by State Code)</option>
                    <option value="Nepal">Nepal (GST Exempt 0% · PAN Only)</option>
                    <option value="Bangladesh">Bangladesh (GST Exempt 0% · PAN Only)</option>
                    <option value="Bhutan">Bhutan (GST Exempt 0% · PAN Only)</option>
                  </select>
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
                    <select
                      aria-label="Party State Code"
                      value={partyStateCode}
                      onChange={(e) => {
                        const nextCode = e.target.value;
                        setPartyStateCode(nextCode);
                        if (billingCountry === 'India' && nextCode) {
                          setInterstate(nextCode !== '19' && nextCode !== '99');
                        }
                      }}
                      className="w-full px-1.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num font-bold text-blue-900"
                    >
                      <option value="">--</option>
                      {ALL_INDIA_STATES_DISTRICTS.map((st) => (
                        <option key={st.code} value={st.code}>
                          {st.code} - {st.name}
                        </option>
                      ))}
                    </select>
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
                      type="date"
                      required
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
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
                  <select
                    aria-label="Bank Account for Tax Invoice"
                    value={selectedBankId}
                    onChange={(e) => setSelectedBankId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                  >
                    {availableBanks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.accountName} — {b.bankName} ({b.accountNo})
                      </option>
                    ))}
                  </select>
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
                          <td className="p-1.5">
                            <select
                              value={row.rateType || 'Fixed'}
                              onChange={(e) => {
                                const rt = e.target.value as 'Fixed' | 'Per Ton';
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
                              className="px-1.5 py-1 rounded border border-slate-300 bg-white font-semibold"
                            >
                              <option value="Fixed">Fixed</option>
                              <option value="Per Ton">Per Ton</option>
                            </select>
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
                      <select
                        disabled={isExportCountry}
                        value={effectiveGstRate}
                        onChange={(e) => setGstRate(Number(e.target.value))}
                        className="px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      >
                        <option value={5}>5%</option>
                        <option value={12}>12%</option>
                        <option value={0}>0% (Exempt)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="font-bold text-slate-800">GST Paid By:</label>
                    <select
                      aria-label="GST Paid By"
                      value={gstPaidBy}
                      onChange={(e) => {
                        const next = e.target.value as 'Consignee' | 'Consignor' | 'Transporter' | 'Others';
                        setGstPaidBy(next);
                        if (!isExportCountry) {
                          if (next === 'Transporter') setReverseCharge(false);
                          else if (next === 'Consignee' || next === 'Consignor') setReverseCharge(true);
                        }
                      }}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white font-bold text-blue-900"
                    >
                      <option value="Consignee">Consignee</option>
                      <option value="Consignor">Consignor</option>
                      <option value="Transporter">Transporter</option>
                      <option value="Others">Others</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-slate-700 font-mono-num pt-1">
                    <span>CGST ({(effectiveGstRate / 2).toFixed(1)}%): ₹{formatINR(cgstAmt)}</span>
                    <span>SGST ({(effectiveGstRate / 2).toFixed(1)}%): ₹{formatINR(sgstAmt)}</span>
                    <span>IGST ({effectiveGstRate.toFixed(1)}%): ₹{formatINR(igstAmt)}</span>
                    <span className="font-bold">Total Tax: ₹{formatINR(totalTax)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="font-bold text-slate-900">FREIGHT DETAILS &amp; TOTAL</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600">Detention (₹)</label>
                      <input
                        type="number"
                        value={detentionCharges}
                        onChange={(e) => setDetentionCharges(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600">Unloading (₹)</label>
                      <input
                        type="number"
                        value={unloadingCharges}
                        onChange={(e) => setUnloadingCharges(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600">ST Charges (₹)</label>
                      <input
                        type="number"
                        value={stCharges}
                        onChange={(e) => setStCharges(e.target.value)}
                        className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                      />
                    </div>
                  </div>
                  <div className="pt-1 flex items-center justify-between border-t border-slate-300">
                    <span className="font-bold text-slate-900">GRAND TOTAL:</span>
                    <span className="text-base font-extrabold font-mono-num text-[#0D47A1]">
                      ₹ {formatINR(grandTotal)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">{amountToIndianWords(grandTotal)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Remarks</label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="1) INV- PFPL/26-27/E/21"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 mt-4">
                  <input
                    type="checkbox"
                    checked={includeAnnexure}
                    onChange={(e) => setIncludeAnnexure(e.target.checked)}
                  />
                  Include Invoice Annexure Page
                </label>
              </div>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs">
                <label className="font-bold text-slate-700">Print Copies:</label>
                <select
                  aria-label="Bill Copy Selector"
                  value={copyCount}
                  onChange={(e) => setCopyCount(Number(e.target.value) as BillCopyCount)}
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white font-bold text-blue-900"
                >
                  <option value={1}>1 Copy (Original)</option>
                  <option value={2}>2 Copies (Original + Office)</option>
                  <option value={3}>3 Copies (Original + Transporter + Office)</option>
                  <option value={4}>4 Copies (All)</option>
                </select>
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
                  type="submit"
                  disabled={savingInv || readOnly}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingInv ? 'Saving...' : 'Save & Preview Invoice PDF'}
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
                <select
                  aria-label="Quotation Division"
                  value={qDivision}
                  onChange={(e) => setQDivision(e.target.value === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
                  className="px-2 py-1 rounded bg-white text-[#0D47A1] text-xs font-extrabold cursor-pointer"
                >
                  <option value="FTL">FTL Division</option>
                  <option value="LOGISTICS">LOGISTICS Division</option>
                </select>
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
                <input
                  type="text"
                  required
                  list="q-dest-list"
                  value={qDest}
                  onChange={(e) => {
                    const nextDest = e.target.value;
                    setQDest(nextDest);
                    applyQuotationSmartAutoFill(qParty, nextDest);
                  }}
                  placeholder={PRIORITY_CORRIDOR_REGIONS.join(', ')}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <datalist id="q-dest-list">
                  {QUICK_CORRIDOR_DESTINATIONS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Goods Type</label>
                <input
                  type="text"
                  list="q-goods-list"
                  value={qGoodsType}
                  onChange={(e) => setQGoodsType(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <datalist id="q-goods-list">
                  {effectiveGoodsList.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
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
                  <select
                    aria-label="Quotation Rate Mode"
                    value={qRateMode}
                    onChange={(e) => setQRateMode(e.target.value as 'Fixed' | 'Per Ton')}
                    className="px-2 py-1.5 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="Fixed">Fixed</option>
                    <option value="Per Ton">Per Ton</option>
                  </select>
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
