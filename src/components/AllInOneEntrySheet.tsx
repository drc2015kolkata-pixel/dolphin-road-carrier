import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Eye,
  FileSpreadsheet,
  Keyboard,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  AnyDriveFolderName,
  BUSINESS_MODE_META,
  BusinessMode,
  CompanySettings,
  ConsignmentNote,
  Driver,
  ExtraEwayBill,
  ExtraInsuranceItem,
  Invoice,
  LogisticsDocket,
  LogisticsDriver,
  LogisticsInvoice,
  LogisticsParty,
  LogisticsVehicle,
  LorryAdvanceRow,
  LorryHire,
  MultiGoodsItem,
  MultiWeightRow,
  Party,
  StaffAccount,
  StaffCommissionEntry,
  StaffMultiAdvanceLog,
  StaffMultiBalanceDateLog,
  StaffMultiPaidReturnLog,
  Vehicle,
} from '../types/erp';
import {
  formatDateDDMMYYYY,
  formatINR,
  makeSafeDocId,
  normalizeFyLabel,
  todayISO,
} from '../lib/formatters';
import { logBranchActivity, upsertDocument } from '../lib/firestoreStore';
import {
  ALL_INDIA_BRANCH_OPTIONS,
  ALL_INDIA_STATES_DISTRICTS,
  BILL_FOOTNOTE_PRESETS,
  BILL_REMARK_PRESETS,
  DEFAULT_RATE_MODES,
  DELIVERY_MODE_CODES,
  getEffectiveCreditDayPresets,
  getEffectiveDropdownList,
  GST_PAID_BY_CODES,
  PAYMENT_MODE_OPTIONS,
  RISK_TYPE_CODES,
  VEHICLE_BODY_TYPE_OPTIONS,
  VEHICLE_COLOR_OPTIONS,
  VEHICLE_MAKE_OPTIONS,
} from '../lib/dropdownMasterStore';
import {
  filterBillingCustomerParties,
  normalizePartyMatchKey,
  resolveGstStateCode,
} from '../lib/partySeparation';
import {
  AnyPartyEntity,
  EntityQuickPreviewCard,
  formatDriverDetailsLine,
  formatPartyDetailsLine,
  formatVehicleDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import { EditableSearchSelect } from './EditableSearchSelect';
import { SearchableSelect } from './SearchableSelect';
import { computeLorryNetPayable } from './LorryHirePodModule';
import { DEFAULT_WHEEL_RATES, WHEEL_TYPES } from './StaffCommissionModule';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import {
  GeneratedPdfResult,
  generateInvoicePDF,
  generateLogisticsDocketPDF,
  generateLogisticsInvoicePDF,
  generateLR3CopyPDF,
  printPdfDirect,
} from '../lib/pdfEngine';

interface AllInOneEntrySheetProps {
  divisionMode: BusinessMode;
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
  readOnly?: boolean;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  staffAccounts: StaffAccount[];
  consignments: ConsignmentNote[];
  lorryHires: LorryHire[];
  staffCommissions: StaffCommissionEntry[];
  invoices: Invoice[];
  logisticsDockets?: LogisticsDocket[];
  logisticsInvoices?: LogisticsInvoice[];
  logisticsParties?: LogisticsParty[];
  logisticsVehicles?: LogisticsVehicle[];
  logisticsDrivers?: LogisticsDriver[];
  company: CompanySettings;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => void;
  onShowConfirm?: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
  onExitToDashboard: () => void;
}

interface UnifiedRegisterRow {
  id: string;
  docNo: string;
  docDate: string;
  branch: string;
  consignorName: string;
  consigneeName: string;
  billingPartyName: string;
  route: string;
  truckNo: string;
  driverName: string;
  cnFreight: number;
  hireGross: number;
  hireBalance: number;
  podReceived: boolean;
  staffName: string;
  staffAmount: number;
  billNo: string;
  billTotal: number;
  billBalance: number;
  cnRecord?: ConsignmentNote;
  docketRecord?: LogisticsDocket;
  lorryHireRecord?: LorryHire;
  staffRecord?: StaffCommissionEntry;
  invoiceRecord?: Invoice;
  logiInvoiceRecord?: LogisticsInvoice;
}

const DEFAULT_ADV_ROW = (): LorryAdvanceRow => ({
  payeeType: 'Lorry Owner',
  accountName: 'PUNJAB NATIONAL BANK',
  holderName: '',
  bankAccountNo: '',
  upiId: '',
  refNo: '',
  advanceDate: todayISO(),
  mode: 'NEFT',
  amount: 0,
});

function addDaysISO(dateStr: string, days: number): string {
  const base = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(base.getTime())) return todayISO();
  base.setDate(base.getDate() + Math.max(0, days));
  return base.toISOString().slice(0, 10);
}

export const AllInOneEntrySheet: React.FC<AllInOneEntrySheetProps> = ({
  divisionMode,
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  activeFy,
  readOnly = false,
  parties,
  vehicles,
  drivers,
  staffAccounts,
  consignments,
  lorryHires,
  staffCommissions,
  invoices,
  logisticsDockets = [],
  logisticsInvoices = [],
  logisticsParties = [],
  logisticsVehicles = [],
  logisticsDrivers = [],
  company,
  onPreviewPdf,
  onExitToDashboard,
}) => {
  const divisionMeta = BUSINESS_MODE_META[divisionMode];
  const isFtl = divisionMode === 'FTL';
  const topFormRef = useRef<HTMLDivElement | null>(null);

  // Linked edit IDs
  const [editingCnId, setEditingCnId] = useState<string | null>(null);
  const [editingDocketId, setEditingDocketId] = useState<string | null>(null);
  const [editingHireId, setEditingHireId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);

  // Section Toggles (Section 1 CN/Docket is always active; Sections 2, 3, 4 can be toggled seamlessly)
  const [includeHireSection, setIncludeHireSection] = useState(true);
  const [includeStaffSection, setIncludeStaffSection] = useState(true);
  const [includeBillSection, setIncludeBillSection] = useState(true);

  // Section 1: CN / LR or Docket Fields
  const [docNo, setDocNo] = useState(() => {
    const prefix = isFtl ? 'KOL' : divisionMeta.docPrefix;
    const count = isFtl ? consignments.length : logisticsDockets.length;
    return `${prefix}-${150 + count}/26-27`;
  });
  const [docDate, setDocDate] = useState(todayISO());
  const [billedAtBranch, setBilledAtBranch] = useState('Kolkata');
  const [creditDays, setCreditDays] = useState(15);
  const [consignorName, setConsignorName] = useState('');
  const [selectedConsignorId, setSelectedConsignorId] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consigneeName, setConsigneeName] = useState('');
  const [selectedConsigneeId, setSelectedConsigneeId] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [fromCity, setFromCity] = useState('Kolkata');
  const [toCity, setToCity] = useState('');

  // Dynamic Vehicle & Driver
  const [hasVehicleNo, setHasVehicleNo] = useState(true);
  const [hasMultiVehicle, setHasMultiVehicle] = useState(false);
  const [truckNo, setTruckNo] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [extraVehicles, setExtraVehicles] = useState<string[]>([]);
  const [vehicleMake, setVehicleMake] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [driverName, setDriverName] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [driverDlNo, setDriverDlNo] = useState('');
  const [driverDlExpiry, setDriverDlExpiry] = useState('');
  const [driverMobile, setDriverMobile] = useState('');

  // Packages, Goods, Weight & Freight
  const [packages, setPackages] = useState('1');
  const [packageMode, setPackageMode] = useState('PACKAGES');
  const [particulars, setParticulars] = useState('MS Steel Pipes & Tubes');
  const [nettWeight, setNettWeight] = useState('15');
  const [grossWeight, setGrossWeight] = useState('15.5');
  const [chargedWeight, setChargedWeight] = useState('15');
  const [rateMode, setRateMode] = useState('Fixed');
  const [ratePerUnit, setRatePerUnit] = useState('0');
  const [baseFreight, setBaseFreight] = useState('0');
  const [otherCharge, setOtherCharge] = useState('0');
  const [deliveryModeCode, setDeliveryModeCode] = useState('P');
  const [gstPaidByCode, setGstPaidByCode] = useState('E');
  const [riskTakenBy, setRiskTakenBy] = useState('O');
  const [cnRemarks, setCnRemarks] = useState('');
  const [multiGoodsOpen, setMultiGoodsOpen] = useState(false);
  const [multiGoodsItems, setMultiGoodsItems] = useState<MultiGoodsItem[]>([]);
  const [multiWeights, setMultiWeights] = useState<MultiWeightRow[]>([]);
  const [extraEwayBills, setExtraEwayBills] = useState<ExtraEwayBill[]>([]);
  const [extraInsurances, setExtraInsurances] = useState<ExtraInsuranceItem[]>([]);

  // Logistics Docket specifics (when division !== 'FTL')
  const [docketDeliveryMode, setDocketDeliveryMode] = useState<'Door Delivery' | 'Godown Delivery'>('Door Delivery');
  const [docketPayMode, setDocketPayMode] = useState<'Paid' | 'To-Pay' | 'TBB'>('TBB');

  // Section 2: Lorry Hire Challan
  const [brokerName, setBrokerName] = useState('');
  const [selectedBrokerId, setSelectedBrokerId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [hireWeightMt, setHireWeightMt] = useState('15');
  const [hireRateMode, setHireRateMode] = useState<'Fixed' | 'Per MT'>('Fixed');
  const [hireRatePerUnit, setHireRatePerUnit] = useState('0');
  const [hireAmount, setHireAmount] = useState('0');
  const [detentionDays, setDetentionDays] = useState('0');
  const [detentionRatePerDay, setDetentionRatePerDay] = useState('1500');
  const [hireLoadingCharge, setHireLoadingCharge] = useState('0');
  const [hireUnloadingCharge, setHireUnloadingCharge] = useState('0');
  const [hireKataCharge, setHireKataCharge] = useState('0');
  const [hireParkingCharge, setHireParkingCharge] = useState('0');
  const [hireShortageCharge, setHireShortageCharge] = useState('0');
  const [hireDamageCharge, setHireDamageCharge] = useState('0');
  const [tdsRatePct, setTdsRatePct] = useState('0');
  const [extraAdvanceAmt, setExtraAdvanceAmt] = useState('0');
  const [receiptChallanNo, setReceiptChallanNo] = useState('');
  const [receiptChallanDate, setReceiptChallanDate] = useState('');
  const [hireRemarks, setHireRemarks] = useState('');
  const [hireAdvances, setHireAdvances] = useState<LorryAdvanceRow[]>([DEFAULT_ADV_ROW()]);
  const [podReceived, setPodReceived] = useState(false);
  const [podReceiveDate, setPodReceiveDate] = useState('');
  const [podRemarks, setPodRemarks] = useState('');
  const [podAlertActive, setPodAlertActive] = useState(false);

  // Section 3: Staff Ledger & Multi Logs
  const [staffName, setStaffName] = useState(() => staffAccounts[0]?.displayName || 'Field Booking Staff');
  const [staffBankAccount, setStaffBankAccount] = useState('');
  const [staffUpiId, setStaffUpiId] = useState('');
  const [staffEntryType, setStaffEntryType] = useState<'Commission' | 'Advance Taken' | 'Paid'>('Commission');
  const [wheelType, setWheelType] = useState<string>('10-Wheeler');
  const [staffAmount, setStaffAmount] = useState(() => String(DEFAULT_WHEEL_RATES['10-Wheeler']));
  const [travellingAmt, setTravellingAmt] = useState('0');
  const [miscAmt, setMiscAmt] = useState('0');
  const [staffPayMode, setStaffPayMode] = useState('Cash');
  const [staffRemarks, setStaffRemarks] = useState('');
  const [showMultiLogs, setShowMultiLogs] = useState(false);
  const [multiAdvances, setMultiAdvances] = useState<StaffMultiAdvanceLog[]>([]);
  const [multiPaidReturns, setMultiPaidReturns] = useState<StaffMultiPaidReturnLog[]>([]);
  const [multiBalanceDates, setMultiBalanceDates] = useState<StaffMultiBalanceDateLog[]>([]);

  // Section 4: Party Bill / Tax Invoice
  const [billId, setBillId] = useState(() => `B-${100 + invoices.length + 1}`);
  const [invoiceNo, setInvoiceNo] = useState(() => `${divisionMeta.docPrefix}/${105 + invoices.length}/26-27`);
  const [billedByCode, setBilledByCode] = useState<'B' | 'P'>('B');
  const [billDate, setBillDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(() => addDaysISO(todayISO(), 15));
  const [billingCountry, setBillingCountry] = useState<'India' | 'Nepal' | 'Bangladesh' | 'Bhutan'>('India');
  const [billPartyName, setBillPartyName] = useState('');
  const [selectedBillPartyId, setSelectedBillPartyId] = useState('');
  const [billPartyGstin, setBillPartyGstin] = useState('');
  const [billPartyPan, setBillPartyPan] = useState('');
  const [billPartyAddress, setBillPartyAddress] = useState('');
  const [gstPaidByBill, setGstPaidByBill] = useState<'Consignor' | 'Consignee' | 'Transporter'>('Consignee');
  const [interstateBill, setInterstateBill] = useState(false);
  const [insuranceCharge, setInsuranceCharge] = useState('0');
  const [collCharge, setCollCharge] = useState('0');
  const [billLoadingCharge, setBillLoadingCharge] = useState('0');
  const [billUnloadingCharge, setBillUnloadingCharge] = useState('0');
  const [surchargeAmt, setSurchargeAmt] = useState('0');
  const [detentionBillCharge, setDetentionBillCharge] = useState('0');
  const [stCharge, setStCharge] = useState('0');
  const [fumigationCharge, setFumigationCharge] = useState('0');
  const [extraBillCharge, setExtraBillCharge] = useState('0');
  const [advanceReceived, setAdvanceReceived] = useState('0');
  const [advanceMode, setAdvanceMode] = useState('NEFT');
  const [fullPaymentReceived, setFullPaymentReceived] = useState(false);
  const [fullPaymentMode, setFullPaymentMode] = useState('NEFT');
  const [billRemarks, setBillRemarks] = useState('');
  const [billFootnote, setBillFootnote] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');

  // Register & UI State
  const [saving, setSaving] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [registerSearch, setRegisterSearch] = useState('');
  const [viewModalRow, setViewModalRow] = useState<UnifiedRegisterRow | null>(null);

  // Merged Master Data Lists (supports FTL and Logistics/PTL/Courier seamlessly)
  const combinedParties = useMemo<AnyPartyEntity[]>(() => {
    if (isFtl) return parties;
    return logisticsParties.length > 0 ? [...logisticsParties, ...parties] : parties;
  }, [isFtl, parties, logisticsParties]);

  const combinedVehicles = useMemo(() => {
    if (isFtl) return vehicles;
    return logisticsVehicles.length > 0 ? [...logisticsVehicles, ...vehicles] : vehicles;
  }, [isFtl, vehicles, logisticsVehicles]);

  const combinedDrivers = useMemo(() => {
    if (isFtl) return drivers;
    return logisticsDrivers.length > 0 ? [...logisticsDrivers, ...drivers] : drivers;
  }, [isFtl, drivers, logisticsDrivers]);

  const billingCustomerParties = useMemo(() => {
    return filterBillingCustomerParties({
      parties,
      drivers,
      lorryHires,
      invoices,
      consignments,
    });
  }, [parties, drivers, lorryHires, invoices, consignments]);

  const brokerParties = useMemo(
    () => combinedParties.filter((p) => p.partyType === 'Broker'),
    [combinedParties]
  );

  const ownerParties = useMemo(
    () =>
      combinedParties.filter(
        (p) => p.partyType === 'TruckOwner' || p.partyType === 'Vendor' || p.partyType === 'Broker'
      ),
    [combinedParties]
  );

  const goodsOptions = useMemo(() => getEffectiveDropdownList(company, 'goodsTypes'), [company]);
  const pkgModeOptions = useMemo(() => getEffectiveDropdownList(company, 'packageModes'), [company]);
  const creditDayPresets = useMemo(() => getEffectiveCreditDayPresets(company), [company]);
  const allCities = useMemo(() => {
    const set = new Set<string>(['Kolkata', 'Howrah', 'Siliguri', 'Patna', 'Guwahati', 'Varanasi', 'Delhi', 'Mumbai', 'Ranchi', 'Durgapur']);
    ALL_INDIA_STATES_DISTRICTS.forEach((s) => s.districts.forEach((d) => set.add(d.split('(')[0].trim())));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, []);

  const wheelRates = useMemo(
    () => ({ ...DEFAULT_WHEEL_RATES, ...(company.dropdownMaster?.wheelCommissionRates || {}) }),
    [company.dropdownMaster?.wheelCommissionRates]
  );

  // Sync Staff Bank & UPI on staff change
  useEffect(() => {
    const matched = staffAccounts.find(
      (s) => s.displayName.trim().toLowerCase() === staffName.trim().toLowerCase()
    );
    if (matched) {
      if (matched.bankAccountNo) setStaffBankAccount(`${matched.bankName ? `${matched.bankName} ` : ''}${matched.bankAccountNo}`);
      if (matched.upiId) setStaffUpiId(matched.upiId);
    }
  }, [staffName, staffAccounts]);

  // Global 'M' shortcut for Staff Multi-Logs (only outside inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase() || '';
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setShowMultiLogs((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Auto Freight Calculation
  const computedCnFreight = useMemo(() => {
    const base = Number(baseFreight || 0);
    const rate = Number(ratePerUnit || 0);
    const wt = Number(chargedWeight || nettWeight || 0);
    const calcBase =
      rateMode === 'Per Ton' || rateMode === 'Per MT'
        ? Math.round(rate * wt * 100) / 100
        : rateMode === 'Per Package'
        ? Math.round(rate * Number(packages || 0) * 100) / 100
        : base;
    return Math.round(((calcBase || base) + Number(otherCharge || 0)) * 100) / 100;
  }, [baseFreight, ratePerUnit, rateMode, chargedWeight, nettWeight, packages, otherCharge]);

  // Lorry Hire Calculations (2-day free detention rule + TDS 194C + 50-row multi-advance)
  const effectiveDetentionCharge = useMemo(() => {
    const days = Number(detentionDays || 0);
    const chargeableDays = Math.max(0, days - 2);
    return Math.round(chargeableDays * Number(detentionRatePerDay || 0) * 100) / 100;
  }, [detentionDays, detentionRatePerDay]);

  const effectiveHireGross = useMemo(() => {
    if (hireRateMode === 'Per MT') {
      return Math.round(Number(hireRatePerUnit || 0) * Number(hireWeightMt || 0) * 100) / 100;
    }
    return Math.round(Number(hireAmount || 0) * 100) / 100;
  }, [hireRateMode, hireRatePerUnit, hireWeightMt, hireAmount]);

  const effectiveTdsAmt = useMemo(() => {
    const pct = Number(tdsRatePct || 0);
    if (pct <= 0) return 0;
    return Math.round((effectiveHireGross * pct) / 100 * 100) / 100;
  }, [effectiveHireGross, tdsRatePct]);

  const totalMultiAdvancePaid = useMemo(
    () =>
      Math.round(
        hireAdvances.reduce((s, r) => s + Number(r.amount || 0), 0) * 100
      ) / 100,
    [hireAdvances]
  );

  const hireNetSummary = useMemo(
    () =>
      computeLorryNetPayable({
        hireAmount: effectiveHireGross,
        advancePaid: totalMultiAdvancePaid,
        extraAdvanceAmt: Number(extraAdvanceAmt || 0),
        loadingCharge: Number(hireLoadingCharge || 0),
        unloadingCharge: Number(hireUnloadingCharge || 0),
        parkingCharge: Number(hireParkingCharge || 0),
        kataCharge: Number(hireKataCharge || 0),
        detentionCharge: effectiveDetentionCharge,
        shortageCharge: Number(hireShortageCharge || 0),
        damageCharge: Number(hireDamageCharge || 0),
        tdsAmount: effectiveTdsAmt,
      }),
    [
      effectiveHireGross,
      totalMultiAdvancePaid,
      extraAdvanceAmt,
      hireLoadingCharge,
      hireUnloadingCharge,
      hireParkingCharge,
      hireKataCharge,
      effectiveDetentionCharge,
      hireShortageCharge,
      hireDamageCharge,
      effectiveTdsAmt,
    ]
  );

  // POD Shortage/Breakage/Leakage Red Alert check
  useEffect(() => {
    const hasDeduction =
      Number(hireShortageCharge || 0) > 0 || Number(hireDamageCharge || 0) > 0;
    const hasKeyword = /(short|damage|break|leak|wet|broken)/i.test(podRemarks || '');
    const active = hasDeduction || hasKeyword;
    if (active && !podAlertActive) {
      playAlertBeep();
    }
    setPodAlertActive(active);
  }, [hireShortageCharge, hireDamageCharge, podRemarks, podAlertActive]);

  // Party Bill GST & Grand Total Calculation
  const billSummary = useMemo(() => {
    const freightSub = computedCnFreight;
    const extras =
      Number(insuranceCharge || 0) +
      Number(collCharge || 0) +
      Number(billLoadingCharge || 0) +
      Number(billUnloadingCharge || 0) +
      Number(surchargeAmt || 0) +
      Number(detentionBillCharge || 0) +
      Number(stCharge || 0) +
      Number(fumigationCharge || 0) +
      Number(extraBillCharge || 0);
    const taxableTotal = Math.round((freightSub + extras) * 100) / 100;
    const isExport = billingCountry !== 'India';
    const isRcm = gstPaidByBill === 'Consignor' || gstPaidByBill === 'Consignee';
    const gstRate = isExport || isRcm ? 0 : 12;
    const totalTax = Math.round(((taxableTotal * gstRate) / 100) * 100) / 100;
    const cgstAmt = !interstateBill && gstRate > 0 ? Math.round((totalTax / 2) * 100) / 100 : 0;
    const sgstAmt = !interstateBill && gstRate > 0 ? Math.round((totalTax / 2) * 100) / 100 : 0;
    const igstAmt = interstateBill && gstRate > 0 ? totalTax : 0;
    const grossBillAmount = Math.round((taxableTotal + totalTax) * 100) / 100;
    const advPaid = Math.round(Number(advanceReceived || 0) * 100) / 100;
    const paidAmount = fullPaymentReceived ? grossBillAmount : Math.min(grossBillAmount, advPaid);
    const balanceDue = Math.max(0, Math.round((grossBillAmount - paidAmount) * 100) / 100);
    const status: 'Unpaid' | 'Partial' | 'Paid' =
      balanceDue <= 0 && grossBillAmount > 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid';
    return {
      freightSub,
      extras,
      taxableTotal,
      gstRate,
      cgstAmt,
      sgstAmt,
      igstAmt,
      totalTax,
      grossBillAmount,
      paidAmount,
      balanceDue,
      status,
    };
  }, [
    computedCnFreight,
    insuranceCharge,
    collCharge,
    billLoadingCharge,
    billUnloadingCharge,
    surchargeAmt,
    detentionBillCharge,
    stCharge,
    fumigationCharge,
    extraBillCharge,
    billingCountry,
    gstPaidByBill,
    interstateBill,
    advanceReceived,
    fullPaymentReceived,
  ]);

  // Autofill Driver/Owner when Vehicle selected
  const handleSelectVehicle = (v: { truckNo: string; ownerName?: string; vehicleMake?: string; bodyType?: string; vehicleColor?: string; id: string }) => {
    setTruckNo(v.truckNo);
    setSelectedVehicleId(v.id);
    if (v.ownerName) setOwnerName(v.ownerName);
    if (v.vehicleMake) setVehicleMake(v.vehicleMake);
    if (v.bodyType) setBodyType(v.bodyType);
    if (v.vehicleColor) setVehicleColor(v.vehicleColor);

    // Try matching most recent consignment with this truckNo to auto-fetch Driver
    const recentCn = consignments.find(
      (c) => (c.truckNo || '').trim().toUpperCase() === v.truckNo.trim().toUpperCase() && c.driverName
    );
    if (recentCn) {
      setDriverName(recentCn.driverName || '');
      if (recentCn.driverDlNo) setDriverDlNo(recentCn.driverDlNo);
      if (recentCn.driverDlExpiry) setDriverDlExpiry(recentCn.driverDlExpiry);
      if (recentCn.driverMobile) setDriverMobile(recentCn.driverMobile);
    } else if (combinedDrivers.length > 0) {
      const matchedDrv = combinedDrivers.find((d) =>
        (d.address || '').toUpperCase().includes(v.truckNo.toUpperCase())
      );
      if (matchedDrv) {
        setDriverName(matchedDrv.name);
        setSelectedDriverId(matchedDrv.id);
        setDriverDlNo(matchedDrv.dlNo || '');
        setDriverDlExpiry(matchedDrv.dlExpiry || '');
        setDriverMobile(matchedDrv.phone || '');
      }
    }
  };

  const handleSelectBillParty = (p: AnyPartyEntity) => {
    setBillPartyName(p.name);
    setSelectedBillPartyId(p.id);
    setBillPartyGstin(p.gstin || '');
    setBillPartyPan(p.pan || (p.gstin && p.gstin.length >= 12 ? p.gstin.slice(2, 12) : ''));
    setBillPartyAddress(p.address || '');
    const stateInfo = resolveGstStateCode(p.gstin, p.address, billingCountry);
    if (stateInfo.code && stateInfo.code !== '19' && stateInfo.code !== '99') {
      setInterstateBill(true);
    } else if (stateInfo.code === '19') {
      setInterstateBill(false);
    }
  };

  const resetFormToBlank = () => {
    setEditingCnId(null);
    setEditingDocketId(null);
    setEditingHireId(null);
    setEditingStaffId(null);
    setEditingInvoiceId(null);
    const prefix = isFtl ? 'KOL' : divisionMeta.docPrefix;
    const count = isFtl ? consignments.length : logisticsDockets.length;
    setDocNo(`${prefix}-${151 + count}/26-27`);
    setDocDate(todayISO());
    setConsignorName('');
    setSelectedConsignorId('');
    setConsignorAddress('');
    setConsignorGstin('');
    setConsigneeName('');
    setSelectedConsigneeId('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setToCity('');
    setTruckNo('');
    setSelectedVehicleId('');
    setDriverName('');
    setSelectedDriverId('');
    setDriverDlNo('');
    setDriverDlExpiry('');
    setDriverMobile('');
    setBaseFreight('0');
    setRatePerUnit('0');
    setOtherCharge('0');
    setBrokerName('');
    setOwnerName('');
    setHireAmount('0');
    setHireRatePerUnit('0');
    setHireAdvances([DEFAULT_ADV_ROW()]);
    setPodReceived(false);
    setPodRemarks('');
    setBillId(`B-${100 + invoices.length + 2}`);
    setInvoiceNo(`${divisionMeta.docPrefix}/${106 + invoices.length}/26-27`);
    setBillPartyName('');
    setSelectedBillPartyId('');
    setBillPartyGstin('');
    setBillPartyPan('');
    setBillPartyAddress('');
    setAdvanceReceived('0');
    setFullPaymentReceived(false);
  };

  const saveCompleteSheet = async (afterAction: 'exit' | 'pdf') => {
    if (readOnly) {
      setStatusToast('View-Only permission: saving is restricted.');
      return;
    }
    if (!docNo.trim() || !consignorName.trim() || !fromCity.trim() || !toCity.trim()) {
      setStatusToast('Please fill C/N or Docket No, Consignor, From City, and To City.');
      playAlertBeep();
      return;
    }

    setSaving(true);
    setStatusToast(null);
    try {
      const fyNorm = normalizeFyLabel(activeFy);
      const effectivePartyForBill = billPartyName.trim() || consignorName.trim();
      const cnTruckValue = hasVehicleNo ? truckNo.trim() : 'UNASSIGNED';

      let savedInvoiceId = editingInvoiceId || '';
      let savedInvoiceObj: Invoice | null = null;
      let savedLogiInvoiceObj: LogisticsInvoice | null = null;
      let savedCnObj: ConsignmentNote | null = null;
      let savedDocketObj: LogisticsDocket | null = null;

      // 1. Save Party Bill / Invoice first (if enabled and party selected) so CN/Docket gets invoiceId & billed: true
      if (includeBillSection && effectivePartyForBill && billSummary.grossBillAmount > 0) {
        if (isFtl) {
          savedInvoiceId = editingInvoiceId || makeSafeDocId('inv');
          const invPayload: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
            billId: billId.trim(),
            invoiceNo: invoiceNo.trim(),
            invoiceDate: billDate,
            dueDate,
            financialYear: fyNorm,
            division: 'FTL',
            billedByCode,
            billedAtBranch,
            partyName: effectivePartyForBill,
            partyAddress: billPartyAddress.trim(),
            partyGstin: billPartyGstin.trim().toUpperCase(),
            partyPan: billPartyPan.trim().toUpperCase(),
            billingCountry,
            sac: company.hsn || '996791',
            reverseCharge: gstPaidByBill !== 'Transporter' && billingCountry === 'India',
            interstate: interstateBill,
            gstPaidBy: gstPaidByBill,
            gstRate: billSummary.gstRate,
            cgstAmt: billSummary.cgstAmt,
            sgstAmt: billSummary.sgstAmt,
            igstAmt: billSummary.igstAmt,
            totalTax: billSummary.totalTax,
            freightCharges: billSummary.freightSub,
            insuranceCharge: Number(insuranceCharge || 0),
            collCharge: Number(collCharge || 0),
            loadingCharge: Number(billLoadingCharge || 0),
            unloadingCharges: Number(billUnloadingCharge || 0),
            surchargeAmt: Number(surchargeAmt || 0),
            detentionCharges: Number(detentionBillCharge || 0),
            stCharges: Number(stCharge || 0),
            fumigationCharge: Number(fumigationCharge || 0),
            extraCharge: Number(extraBillCharge || 0),
            grossBillAmount: billSummary.grossBillAmount,
            advanceReceived: Number(advanceReceived || 0),
            advanceMode,
            fullPaymentMode: fullPaymentReceived ? fullPaymentMode : '',
            grandTotal: billSummary.grossBillAmount,
            paidAmount: billSummary.paidAmount,
            status: billSummary.status,
            remarks: billRemarks.trim(),
            billFootnote: billFootnote.trim(),
            additionalNotes: additionalNotes.trim(),
            copyCount: 1,
            consignmentRows: [
              {
                cnNo: docNo.trim(),
                cnDate: docDate,
                vehicle: cnTruckValue,
                from: fromCity.trim(),
                to: toCity.trim(),
                weight: Number(chargedWeight || nettWeight || 0),
                packages: `${packages} ${packageMode}`.trim(),
                rateType: rateMode,
                ratePerMt: Number(ratePerUnit || 0),
                freight: computedCnFreight,
                description: particulars.trim(),
              },
            ],
            annexureLorries: hasVehicleNo && truckNo ? [{ cnNo: docNo.trim(), lorryNumbers: [truckNo, ...extraVehicles].filter(Boolean).join(', ') }] : [],
            branchCode: activeBranchCode,
            createdByStaff: activeStaffCode,
            ownerUid,
          };
          await upsertDocument('invoices', savedInvoiceId, invPayload, !editingInvoiceId);
          savedInvoiceObj = { id: savedInvoiceId, ...invPayload };
        } else {
          savedInvoiceId = editingInvoiceId || makeSafeDocId(`${divisionMeta.idPrefix}inv`);
          const logiInvPayload: Omit<LogisticsInvoice, 'id' | 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
            docType: 'Tax Invoice',
            docNo: invoiceNo.trim(),
            docDate: billDate,
            financialYear: fyNorm,
            linkedDocNo: docNo.trim(),
            partyName: effectivePartyForBill,
            partyAddress: billPartyAddress.trim(),
            partyGstin: billPartyGstin.trim().toUpperCase(),
            partyPan: billPartyPan.trim().toUpperCase(),
            sac: company.hsn || '996791',
            reverseCharge: gstPaidByBill !== 'Transporter' && billingCountry === 'India',
            interstate: interstateBill,
            gstRate: billSummary.gstRate,
            taxableAmount: billSummary.taxableTotal,
            cgstAmt: billSummary.cgstAmt,
            sgstAmt: billSummary.sgstAmt,
            igstAmt: billSummary.igstAmt,
            grandTotal: billSummary.grossBillAmount,
            paidAmount: billSummary.paidAmount,
            status: billSummary.status,
            docketRows: [
              {
                docketNo: docNo.trim(),
                docketDate: docDate,
                originBranch: fromCity.trim(),
                destBranch: toCity.trim(),
                packages: Number(packages || 0),
                weightKg: Number(chargedWeight || nettWeight || 0),
                goodsDesc: particulars.trim(),
                freightAmt: computedCnFreight,
              },
            ],
            remarks: [billRemarks, additionalNotes, billFootnote].filter(Boolean).join(' | '),
            branchCode: activeBranchCode,
            createdByStaff: activeStaffCode,
            ownerUid,
          };
          await upsertDocument('logistics_invoices', savedInvoiceId, logiInvPayload, !editingInvoiceId);
          savedLogiInvoiceObj = { id: savedInvoiceId, ...logiInvPayload };
        }
      }

      // 2. Save CN/LR (FTL) or Logistics Docket (LOGISTICS / PTL / COURIER)
      const isBilledNow = Boolean(savedInvoiceId);
      if (isFtl) {
        const cnId = editingCnId || makeSafeDocId('cn');
        const gstPaidLabel =
          GST_PAID_BY_CODES.find((c) => c.code === gstPaidByCode)?.mapped || 'Consignee';
        const cnPayload: Omit<ConsignmentNote, 'id' | 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
          cnNo: docNo.trim(),
          cnDate: docDate,
          financialYear: fyNorm,
          division: 'FTL',
          billedAtBranch,
          hasVehicleNo,
          hasMultiVehicle,
          billingPartyName: effectivePartyForBill,
          creditDays: Number(creditDays || 15),
          consignorName: consignorName.trim(),
          consignorAddress: consignorAddress.trim(),
          consignorGstin: consignorGstin.trim().toUpperCase(),
          consigneeName: consigneeName.trim() || consignorName.trim(),
          consigneeAddress: consigneeAddress.trim(),
          consigneeGstin: consigneeGstin.trim().toUpperCase(),
          packages: packages.trim(),
          packageMode,
          particulars: particulars.trim(),
          multiGoodsItems: multiGoodsItems.slice(0, 50),
          rateMode,
          ratePerUnit: Number(ratePerUnit || 0),
          nettWeight: Number(nettWeight || 0),
          grossWeight: Number(grossWeight || 0),
          chargedWeight: Number(chargedWeight || 0),
          multiWeights: multiWeights.slice(0, 50),
          otherCharge: Number(otherCharge || 0),
          totalFreight: computedCnFreight,
          truckNo: cnTruckValue,
          extraVehicles: (hasMultiVehicle ? extraVehicles : []).slice(0, 50),
          fromCity: fromCity.trim(),
          toCity: toCity.trim(),
          ownerName: ownerName.trim(),
          brokerName: brokerName.trim(),
          driverName: hasVehicleNo ? driverName.trim() : '',
          driverDlNo: hasVehicleNo ? driverDlNo.trim() : '',
          driverDlExpiry: hasVehicleNo ? driverDlExpiry : '',
          driverMobile: hasVehicleNo ? driverMobile.trim() : '',
          deliveryModeCode,
          gstPaidBy: gstPaidLabel,
          gstPaidByCode,
          riskTakenBy,
          extraEwayBills: extraEwayBills.slice(0, 50),
          extraInsurances: extraInsurances.slice(0, 50),
          remarks: cnRemarks.trim(),
          billed: isBilledNow,
          invoiceId: savedInvoiceId || '',
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        };
        await upsertDocument('consignments', cnId, cnPayload, !editingCnId);
        savedCnObj = { id: cnId, ...cnPayload };
      } else {
        const docketId = editingDocketId || makeSafeDocId(`${divisionMeta.idPrefix}dkt`);
        const docketPayload: Omit<LogisticsDocket, 'id' | 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
          docketNo: docNo.trim(),
          docketDate: docDate,
          financialYear: fyNorm,
          billedAtBranch,
          originBranch: fromCity.trim() || billedAtBranch,
          destBranch: toCity.trim() || billedAtBranch,
          deliveryMode: docketDeliveryMode,
          payMode: docketPayMode,
          consignorName: consignorName.trim(),
          consignorAddress: consignorAddress.trim(),
          consignorGstin: consignorGstin.trim().toUpperCase(),
          consigneeName: consigneeName.trim() || consignorName.trim(),
          consigneeAddress: consigneeAddress.trim(),
          consigneeGstin: consigneeGstin.trim().toUpperCase(),
          billingPartyName: effectivePartyForBill,
          packages: Number(packages || 1),
          packingType: packageMode,
          goodsDesc: particulars.trim(),
          actualWeightKg: Number(nettWeight || 0),
          chargedWeightKg: Number(chargedWeight || nettWeight || 0),
          rateBasis: rateMode === 'Per Package' ? 'Per Package' : rateMode === 'Per Kg' ? 'Per Kg' : 'Fixed',
          ratePerUnit: Number(ratePerUnit || 0),
          baseFreight: Number(baseFreight || computedCnFreight),
          fovCharge: 0,
          docketCharge: Number(otherCharge || 0),
          hamaliCharge: 0,
          doorCharge: 0,
          gstRate: billSummary.gstRate,
          cgstAmt: billSummary.cgstAmt,
          sgstAmt: billSummary.sgstAmt,
          igstAmt: billSummary.igstAmt,
          reverseCharge: gstPaidByBill !== 'Transporter',
          totalAmount: computedCnFreight,
          stockStage: podReceived ? 'Delivered' : 'Origin Godown',
          billed: isBilledNow,
          invoiceId: savedInvoiceId || '',
          remarks: cnRemarks.trim(),
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        };
        await upsertDocument('logistics_dockets', docketId, docketPayload, !editingDocketId);
        savedDocketObj = { id: docketId, ...docketPayload };
      }

      // 3. Save Lorry Hire (if enabled & hire > 0)
      if (includeHireSection && (effectiveHireGross > 0 || totalMultiAdvancePaid > 0)) {
        const lhId = editingHireId || makeSafeDocId('lh');
        const cappedAdvs = hireAdvances
          .filter((a) => Number(a.amount || 0) > 0 || a.accountName.trim())
          .slice(0, 50)
          .map((a) => ({
            payeeType: a.payeeType || 'Lorry Owner',
            accountName: a.accountName || '',
            holderName: a.holderName || '',
            bankAccountNo: a.bankAccountNo || '',
            upiId: a.upiId || '',
            refNo: a.refNo || '',
            advanceDate: a.advanceDate || docDate,
            mode: a.mode || 'NEFT',
            amount: Number(a.amount || 0),
          }));
        const lhPayload: Record<string, unknown> = {
          cnNo: docNo.trim(),
          cnDate: docDate,
          financialYear: fyNorm,
          division: divisionMode,
          truckNo: cnTruckValue,
          ownerName: ownerName.trim(),
          brokerName: brokerName.trim(),
          fromCity: fromCity.trim(),
          toCity: toCity.trim(),
          weightMt: Number(hireWeightMt || nettWeight || 0),
          ratePerUnit: Number(hireRatePerUnit || 0),
          rateMode: hireRateMode,
          hasMultiAdvance: cappedAdvs.length > 1,
          advances: cappedAdvs,
          hireAmount: effectiveHireGross,
          advancePaid: totalMultiAdvancePaid,
          extraAdvanceAmt: Number(extraAdvanceAmt || 0),
          loadingCharge: Number(hireLoadingCharge || 0),
          unloadingCharge: Number(hireUnloadingCharge || 0),
          parkingCharge: Number(hireParkingCharge || 0),
          kataCharge: Number(hireKataCharge || 0),
          detentionDays: Number(detentionDays || 0),
          detentionCharge: effectiveDetentionCharge,
          shortageCharge: Number(hireShortageCharge || 0),
          damageCharge: Number(hireDamageCharge || 0),
          tdsRatePct: Number(tdsRatePct || 0),
          tdsAmount: effectiveTdsAmt,
          receiptChallanNo: receiptChallanNo.trim(),
          receiptChallanDate: receiptChallanDate || '',
          balancePayable: hireNetSummary.balancePayable,
          podReceived,
          podReceiveDate: podReceived ? podReceiveDate || todayISO() : '',
          podRemarks: podRemarks.trim(),
          balancePaid: false,
          remarks: hireRemarks.trim(),
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        };
        await upsertDocument('lorry_hires', lhId, lhPayload, !editingHireId);
      }

      // 4. Save Staff Commission / Advance Ledger (if enabled & amount > 0)
      if (includeStaffSection && staffName.trim() && Number(staffAmount || 0) > 0) {
        const scId = editingStaffId || makeSafeDocId('comm');
        const scPayload: Record<string, unknown> = {
          entryDate: docDate,
          financialYear: fyNorm,
          division: divisionMode,
          staffName: staffName.trim(),
          staffBankAccount: staffBankAccount.trim(),
          staffUpiId: staffUpiId.trim(),
          challanNo: docNo.trim(),
          truckNo: cnTruckValue,
          wheelType,
          entryType: staffEntryType,
          commissionRate: wheelRates[wheelType] || 0,
          travellingAmt: Number(travellingAmt || 0),
          miscAmt: Number(miscAmt || 0),
          amount: Number(staffAmount || 0),
          paymentMode: staffPayMode,
          remarks: staffRemarks.trim(),
          multiAdvances: multiAdvances.slice(0, 50),
          multiPaidReturns: multiPaidReturns.slice(0, 50),
          multiBalanceDates: multiBalanceDates.slice(0, 50),
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        };
        await upsertDocument('staff_commissions', scId, scPayload, !editingStaffId);
      }

      await logBranchActivity({
        action: editingCnId || editingDocketId ? 'Updated Master Entry Sheet' : 'Saved Master Entry Sheet',
        module: `All-in-One (${divisionMode})`,
        docRefCode: docNo.trim(),
        summary: `${docNo.trim()} · ${consignorName.trim()} -> ${effectivePartyForBill} · Freight ₹${formatINR(computedCnFreight)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      playVerifiedBeep();

      if (afterAction === 'pdf') {
        if (savedInvoiceObj) {
          const pdf = await generateInvoicePDF(savedInvoiceObj, company, true, 'p', 1);
          onPreviewPdf(pdf, 'Bills_Invoices');
        } else if (savedLogiInvoiceObj) {
          const pdf = await generateLogisticsInvoicePDF(savedLogiInvoiceObj, company, 'p');
          onPreviewPdf(pdf, 'Logistics_Invoices_CN_DN');
        } else if (savedCnObj) {
          const pdf = await generateLR3CopyPDF(savedCnObj, company, 'l');
          onPreviewPdf(pdf, 'LR Copy');
        } else if (savedDocketObj) {
          const pdf = await generateLogisticsDocketPDF(savedDocketObj, company, 'l');
          onPreviewPdf(pdf, 'Docket_LR');
        }
        resetFormToBlank();
        setStatusToast('Complete sheet saved & PDF opened.');
      } else {
        resetFormToBlank();
        onExitToDashboard();
      }
    } finally {
      setSaving(false);
    }
  };

  // Correlated Live "View Entry Sheet / Register" Rows
  const registerRows = useMemo<UnifiedRegisterRow[]>(() => {
    const hireByCn = new Map<string, LorryHire>();
    for (const lh of lorryHires) {
      const k = normalizePartyMatchKey(lh.cnNo);
      if (k) hireByCn.set(k, lh);
    }

    const staffByCn = new Map<string, StaffCommissionEntry>();
    for (const sc of staffCommissions) {
      const k = normalizePartyMatchKey(sc.challanNo);
      if (k) staffByCn.set(k, sc);
    }

    if (isFtl) {
      const invByCn = new Map<string, Invoice>();
      const invById = new Map<string, Invoice>();
      for (const inv of invoices) {
        invById.set(inv.id, inv);
        for (const r of inv.consignmentRows || []) {
          const k = normalizePartyMatchKey(r.cnNo);
          if (k) invByCn.set(k, inv);
        }
      }

      return [...consignments]
        .sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''))
        .map((cn) => {
          const k = normalizePartyMatchKey(cn.cnNo);
          const lh = hireByCn.get(k);
          const sc = staffByCn.get(k);
          const inv = (cn.invoiceId ? invById.get(cn.invoiceId) : undefined) || invByCn.get(k);
          const invBal = inv ? Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0)) : 0;
          return {
            id: cn.id,
            docNo: cn.cnNo,
            docDate: cn.cnDate,
            branch: cn.billedAtBranch || cn.branchCode || 'Kolkata',
            consignorName: cn.consignorName,
            consigneeName: cn.consigneeName,
            billingPartyName: cn.billingPartyName || cn.consignorName,
            route: `${cn.fromCity} → ${cn.toCity}`,
            truckNo: cn.truckNo || 'UNASSIGNED',
            driverName: cn.driverName || '-',
            cnFreight: Number(cn.totalFreight || 0),
            hireGross: Number(lh?.hireAmount || 0),
            hireBalance: Number(lh?.balancePayable || 0),
            podReceived: Boolean(lh?.podReceived),
            staffName: sc?.staffName || '-',
            staffAmount: Number(sc?.amount || 0),
            billNo: inv?.invoiceNo || (cn.billed ? 'Billed' : 'Unbilled'),
            billTotal: Number(inv?.grandTotal || 0),
            billBalance: invBal,
            cnRecord: cn,
            lorryHireRecord: lh,
            staffRecord: sc,
            invoiceRecord: inv,
          };
        });
    }

    const logiInvByDocket = new Map<string, LogisticsInvoice>();
    const logiInvById = new Map<string, LogisticsInvoice>();
    for (const inv of logisticsInvoices) {
      logiInvById.set(inv.id, inv);
      if (inv.linkedDocNo) logiInvByDocket.set(normalizePartyMatchKey(inv.linkedDocNo), inv);
      for (const r of inv.docketRows || []) {
        logiInvByDocket.set(normalizePartyMatchKey(r.docketNo), inv);
      }
    }

    return [...logisticsDockets]
      .sort((a, b) => (b.docketDate || '').localeCompare(a.docketDate || ''))
      .map((dk) => {
        const k = normalizePartyMatchKey(dk.docketNo);
        const lh = hireByCn.get(k);
        const sc = staffByCn.get(k);
        const inv =
          (dk.invoiceId ? logiInvById.get(dk.invoiceId) : undefined) || logiInvByDocket.get(k);
        const invBal = inv ? Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0)) : 0;
        return {
          id: dk.id,
          docNo: dk.docketNo,
          docDate: dk.docketDate,
          branch: dk.billedAtBranch || dk.originBranch || 'Kolkata',
          consignorName: dk.consignorName,
          consigneeName: dk.consigneeName,
          billingPartyName: dk.billingPartyName || dk.consignorName,
          route: `${dk.originBranch} → ${dk.destBranch}`,
          truckNo: lh?.truckNo || '-',
          driverName: '-',
          cnFreight: Number(dk.totalAmount || 0),
          hireGross: Number(lh?.hireAmount || 0),
          hireBalance: Number(lh?.balancePayable || 0),
          podReceived: Boolean(lh?.podReceived || dk.stockStage === 'Delivered'),
          staffName: sc?.staffName || '-',
          staffAmount: Number(sc?.amount || 0),
          billNo: inv?.docNo || (dk.billed ? 'Billed' : 'Unbilled'),
          billTotal: Number(inv?.grandTotal || 0),
          billBalance: invBal,
          docketRecord: dk,
          lorryHireRecord: lh,
          staffRecord: sc,
          logiInvoiceRecord: inv,
        };
      });
  }, [isFtl, consignments, logisticsDockets, lorryHires, staffCommissions, invoices, logisticsInvoices]);

  const filteredRegisterRows = useMemo(() => {
    const q = registerSearch.trim().toLowerCase();
    if (!q) return registerRows;
    return registerRows.filter((r) =>
      `${r.docNo} ${r.branch} ${r.consignorName} ${r.consigneeName} ${r.billingPartyName} ${r.truckNo} ${r.billNo} ${r.route}`
        .toLowerCase()
        .includes(q)
    );
  }, [registerRows, registerSearch]);

  const loadRowForEdit = (row: UnifiedRegisterRow) => {
    resetFormToBlank();
    if (row.cnRecord) {
      const cn = row.cnRecord;
      setEditingCnId(cn.id);
      setDocNo(cn.cnNo);
      setDocDate(cn.cnDate);
      setBilledAtBranch(cn.billedAtBranch || 'Kolkata');
      setCreditDays(cn.creditDays || 15);
      setConsignorName(cn.consignorName);
      setConsignorAddress(cn.consignorAddress || '');
      setConsignorGstin(cn.consignorGstin || '');
      setConsigneeName(cn.consigneeName);
      setConsigneeAddress(cn.consigneeAddress || '');
      setConsigneeGstin(cn.consigneeGstin || '');
      setFromCity(cn.fromCity);
      setToCity(cn.toCity);
      setHasVehicleNo(cn.hasVehicleNo !== false && cn.truckNo !== 'UNASSIGNED');
      setHasMultiVehicle(Boolean(cn.hasMultiVehicle));
      setTruckNo(cn.truckNo === 'UNASSIGNED' ? '' : cn.truckNo);
      setExtraVehicles(cn.extraVehicles || []);
      setDriverName(cn.driverName || '');
      setDriverDlNo(cn.driverDlNo || '');
      setDriverDlExpiry(cn.driverDlExpiry || '');
      setDriverMobile(cn.driverMobile || '');
      setPackages(cn.packages || '1');
      setPackageMode(cn.packageMode || 'PACKAGES');
      setParticulars(cn.particulars || '');
      setNettWeight(String(cn.nettWeight || 0));
      setGrossWeight(String(cn.grossWeight || 0));
      setChargedWeight(String(cn.chargedWeight || cn.nettWeight || 0));
      setRateMode(cn.rateMode || 'Fixed');
      setRatePerUnit(String(cn.ratePerUnit || 0));
      setBaseFreight(String(Math.max(0, Number(cn.totalFreight || 0) - Number(cn.otherCharge || 0))));
      setOtherCharge(String(cn.otherCharge || 0));
      setDeliveryModeCode(cn.deliveryModeCode || 'P');
      setGstPaidByCode(cn.gstPaidByCode || 'E');
      setRiskTakenBy(cn.riskTakenBy || 'O');
      setCnRemarks(cn.remarks || '');
    } else if (row.docketRecord) {
      const dk = row.docketRecord;
      setEditingDocketId(dk.id);
      setDocNo(dk.docketNo);
      setDocDate(dk.docketDate);
      setBilledAtBranch(dk.billedAtBranch || dk.originBranch || 'Kolkata');
      setConsignorName(dk.consignorName);
      setConsignorAddress(dk.consignorAddress || '');
      setConsignorGstin(dk.consignorGstin || '');
      setConsigneeName(dk.consigneeName);
      setConsigneeAddress(dk.consigneeAddress || '');
      setConsigneeGstin(dk.consigneeGstin || '');
      setFromCity(dk.originBranch);
      setToCity(dk.destBranch);
      setDocketDeliveryMode(dk.deliveryMode);
      setDocketPayMode(dk.payMode);
      setPackages(String(dk.packages || 1));
      setPackageMode(dk.packingType || 'PACKAGES');
      setParticulars(dk.goodsDesc || '');
      setNettWeight(String(dk.actualWeightKg || 0));
      setChargedWeight(String(dk.chargedWeightKg || 0));
      setRatePerUnit(String(dk.ratePerUnit || 0));
      setBaseFreight(String(dk.baseFreight || dk.totalAmount || 0));
      setOtherCharge(String(dk.docketCharge || 0));
      setCnRemarks(dk.remarks || '');
    }

    if (row.lorryHireRecord) {
      const lh = row.lorryHireRecord;
      setEditingHireId(lh.id);
      setIncludeHireSection(true);
      setBrokerName(lh.brokerName || '');
      setOwnerName(lh.ownerName || '');
      setHireWeightMt(String(lh.weightMt || 0));
      setHireRateMode(lh.rateMode === 'Per MT' ? 'Per MT' : 'Fixed');
      setHireRatePerUnit(String(lh.ratePerUnit || 0));
      setHireAmount(String(lh.hireAmount || 0));
      setDetentionDays(String(lh.detentionDays || 0));
      setHireLoadingCharge(String(lh.loadingCharge || 0));
      setHireUnloadingCharge(String(lh.unloadingCharge || 0));
      setHireKataCharge(String(lh.kataCharge || 0));
      setHireParkingCharge(String(lh.parkingCharge || 0));
      setHireShortageCharge(String(lh.shortageCharge || 0));
      setHireDamageCharge(String(lh.damageCharge || 0));
      setTdsRatePct(String(lh.tdsRatePct || 0));
      setExtraAdvanceAmt(String(lh.extraAdvanceAmt || 0));
      setReceiptChallanNo(lh.receiptChallanNo || '');
      setReceiptChallanDate(lh.receiptChallanDate || '');
      setHireRemarks(lh.remarks || '');
      setHireAdvances(lh.advances?.length ? lh.advances : [DEFAULT_ADV_ROW()]);
      setPodReceived(Boolean(lh.podReceived));
      setPodReceiveDate(lh.podReceiveDate || '');
      setPodRemarks(lh.podRemarks || '');
    }

    if (row.staffRecord) {
      const sc = row.staffRecord;
      setEditingStaffId(sc.id);
      setIncludeStaffSection(true);
      setStaffName(sc.staffName);
      setStaffBankAccount(sc.staffBankAccount || '');
      setStaffUpiId(sc.staffUpiId || '');
      setStaffEntryType(sc.entryType);
      setWheelType(sc.wheelType || '10-Wheeler');
      setStaffAmount(String(sc.amount || 0));
      setTravellingAmt(String(sc.travellingAmt || 0));
      setMiscAmt(String(sc.miscAmt || 0));
      setStaffPayMode(sc.paymentMode || 'Cash');
      setStaffRemarks(sc.remarks || '');
      setMultiAdvances(sc.multiAdvances || []);
      setMultiPaidReturns(sc.multiPaidReturns || []);
      setMultiBalanceDates(sc.multiBalanceDates || []);
    }

    if (row.invoiceRecord) {
      const inv = row.invoiceRecord;
      setEditingInvoiceId(inv.id);
      setIncludeBillSection(true);
      setBillId(inv.billId || '');
      setInvoiceNo(inv.invoiceNo);
      setBilledByCode(inv.billedByCode === 'P' ? 'P' : 'B');
      setBillDate(inv.invoiceDate);
      setDueDate(inv.dueDate || addDaysISO(inv.invoiceDate, 15));
      setBillingCountry((inv.billingCountry as 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan') || 'India');
      setBillPartyName(inv.partyName);
      setBillPartyGstin(inv.partyGstin || '');
      setBillPartyPan(inv.partyPan || '');
      setBillPartyAddress(inv.partyAddress || '');
      setGstPaidByBill((inv.gstPaidBy as 'Consignor' | 'Consignee' | 'Transporter') || 'Consignee');
      setInterstateBill(Boolean(inv.interstate));
      setInsuranceCharge(String(inv.insuranceCharge || 0));
      setCollCharge(String(inv.collCharge || 0));
      setBillLoadingCharge(String(inv.loadingCharge || 0));
      setBillUnloadingCharge(String(inv.unloadingCharges || 0));
      setSurchargeAmt(String(inv.surchargeAmt || 0));
      setDetentionBillCharge(String(inv.detentionCharges || 0));
      setStCharge(String(inv.stCharges || 0));
      setFumigationCharge(String(inv.fumigationCharge || 0));
      setExtraBillCharge(String(inv.extraCharge || 0));
      setAdvanceReceived(String(inv.advanceReceived || 0));
      setAdvanceMode(inv.advanceMode || 'NEFT');
      setFullPaymentReceived(inv.status === 'Paid');
      setFullPaymentMode(inv.fullPaymentMode || 'NEFT');
      setBillRemarks(inv.remarks || '');
      setBillFootnote(inv.billFootnote || '');
      setAdditionalNotes(inv.additionalNotes || '');
    } else if (row.logiInvoiceRecord) {
      const inv = row.logiInvoiceRecord;
      setEditingInvoiceId(inv.id);
      setIncludeBillSection(true);
      setInvoiceNo(inv.docNo);
      setBillDate(inv.docDate);
      setBillPartyName(inv.partyName);
      setBillPartyGstin(inv.partyGstin || '');
      setBillPartyPan(inv.partyPan || '');
      setBillPartyAddress(inv.partyAddress || '');
      setInterstateBill(Boolean(inv.interstate));
      setFullPaymentReceived(inv.status === 'Paid');
      setBillRemarks(inv.remarks || '');
    }

    setStatusToast(`Loaded ${row.docNo} & linked records for Edit / Rectify.`);
    topFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const buildPdfForRow = async (
    row: UnifiedRegisterRow
  ): Promise<{ pdf: GeneratedPdfResult; folder: AnyDriveFolderName } | null> => {
    if (row.invoiceRecord) {
      const pdf = await generateInvoicePDF(row.invoiceRecord, company, true, 'p', 1);
      return { pdf, folder: 'Bills_Invoices' };
    }
    if (row.logiInvoiceRecord) {
      const pdf = await generateLogisticsInvoicePDF(row.logiInvoiceRecord, company, 'p');
      return { pdf, folder: 'Logistics_Invoices_CN_DN' };
    }
    if (row.cnRecord) {
      const pdf = await generateLR3CopyPDF(row.cnRecord, company, 'l');
      return { pdf, folder: 'LR Copy' };
    }
    if (row.docketRecord) {
      const pdf = await generateLogisticsDocketPDF(row.docketRecord, company, 'l');
      return { pdf, folder: 'Docket_LR' };
    }
    return null;
  };

  const handleRowPdfPreview = async (row: UnifiedRegisterRow) => {
    const res = await buildPdfForRow(row);
    if (res) {
      onPreviewPdf(res.pdf, res.folder);
    }
  };

  const handleRowAutoPrint = async (row: UnifiedRegisterRow) => {
    const res = await buildPdfForRow(row);
    if (res) {
      printPdfDirect(res.pdf);
    }
  };

  return (
    <div ref={topFormRef} className="space-y-4">
      {/* Top Sticky Master Bar */}
      <div className="bg-gradient-to-r from-[#0B3B8C] via-[#0D47A1] to-[#1565C0] text-white rounded-xl p-3.5 shadow-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ClipboardList className="w-6 h-6 text-amber-300 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-extrabold tracking-tight truncate">
              All-in-One Complete Entry Sheet ({divisionMeta.shortLabel} · {activeFy})
            </h2>
            <p className="text-[11px] text-blue-100 truncate">
              Single continuous sheet: CN/Docket → Lorry Hire &amp; Multi-Adv → Staff Ledger (M) → Party Bill &amp; Live Register
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetFormToBlank}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Blank Sheet</span>
          </button>
          <button
            type="button"
            disabled={saving || readOnly}
            onClick={() => void saveCompleteSheet('pdf')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save & PDF Preview'}</span>
          </button>
          <button
            type="button"
            disabled={saving || readOnly}
            onClick={() => void saveCompleteSheet('exit')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Complete Sheet & Exit'}</span>
          </button>
        </div>
      </div>

      {statusToast && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-bold text-[#0D47A1] flex items-center justify-between gap-2">
          <span>{statusToast}</span>
          <button
            type="button"
            onClick={() => setStatusToast(null)}
            className="p-0.5 text-blue-700 hover:text-blue-950 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SECTION 1: CN / LR OR LOGISTICS DOCKET */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Layers className="w-4 h-4 text-amber-300" />
            <span>
              SECTION 1 — {isFtl ? 'Consignment Note (CN / LR Bilty)' : `${divisionMeta.shortLabel} Docket / AWB`}
              {(editingCnId || editingDocketId) && ' (Editing Mode)'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold">
            <span>Input Vehicle No.?</span>
            <button
              type="button"
              onClick={() => setHasVehicleNo((v) => !v)}
              className={`px-2.5 py-0.5 rounded font-extrabold cursor-pointer ${
                hasVehicleNo ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-amber-300'
              }`}
            >
              {hasVehicleNo ? 'Yes' : 'No'}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {isFtl ? 'C/N (Bilty) No *' : 'Docket / AWB No *'}
              </label>
              <input
                type="text"
                value={docNo}
                onChange={(e) => setDocNo(e.target.value.toUpperCase())}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Booking Date *</label>
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Billed At (Branch)</label>
              <EditableSearchSelect
                ariaLabel="Billed At Branch"
                value={billedAtBranch}
                onChange={setBilledAtBranch}
                options={ALL_INDIA_BRANCH_OPTIONS}
                placeholder="Select branch..."
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Credit Days</label>
              <SearchableSelect
                ariaLabel="Credit Days"
                value={String(creditDays)}
                onChange={(v) => {
                  const n = Number(v || 15);
                  setCreditDays(n);
                  setDueDate(addDaysISO(billDate, n));
                }}
                options={creditDayPresets.map((d) => ({ value: String(d), label: `${d} Days` }))}
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {isFtl ? 'Total CN Freight (₹)' : 'Docket Pay Mode'}
              </label>
              {isFtl ? (
                <div className="px-2.5 py-1.5 rounded bg-blue-50 border border-blue-200 font-mono-num font-extrabold text-[#0D47A1]">
                  ₹ {formatINR(computedCnFreight)}
                </div>
              ) : (
                <div className="flex gap-1">
                  {(['TBB', 'Paid', 'To-Pay'] as const).map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setDocketPayMode(pm)}
                      className={`flex-1 py-1.5 rounded text-[11px] font-extrabold cursor-pointer ${
                        docketPayMode === pm ? 'bg-[#0F766E] text-white' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Consignor *</label>
              <RichEntityPicker<AnyPartyEntity>
                ariaLabel="Consignor"
                value={consignorName}
                selectedId={selectedConsignorId}
                onChangeText={(txt) => {
                  setConsignorName(txt);
                  setSelectedConsignorId('');
                }}
                onSelectEntity={(p) => {
                  setConsignorName(p.name);
                  setSelectedConsignorId(p.id);
                  setConsignorAddress(p.address || '');
                  setConsignorGstin(p.gstin || '');
                }}
                items={combinedParties}
                getId={(p) => p.id}
                getValue={(p) => p.name}
                getSearchText={(p) => `${p.name} ${p.gstin || ''} ${p.address || ''} ${p.phone || ''}`}
                renderTitle={(p) => p.name}
                renderBadge={(p) => p.partyType}
                renderDetails={(p) => formatPartyDetailsLine(p)}
                placeholder="Search Consignor Name, GSTIN, City or Phone..."
                quickPreview={(() => {
                  const matched = combinedParties.find(
                    (p) => p.id === selectedConsignorId || p.name.toLowerCase() === consignorName.trim().toLowerCase()
                  );
                  return matched ? <EntityQuickPreviewCard kind="party" party={matched} compact /> : null;
                })()}
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Consignee *</label>
              <RichEntityPicker<AnyPartyEntity>
                ariaLabel="Consignee"
                value={consigneeName}
                selectedId={selectedConsigneeId}
                onChangeText={(txt) => {
                  setConsigneeName(txt);
                  setSelectedConsigneeId('');
                }}
                onSelectEntity={(p) => {
                  setConsigneeName(p.name);
                  setSelectedConsigneeId(p.id);
                  setConsigneeAddress(p.address || '');
                  setConsigneeGstin(p.gstin || '');
                }}
                items={combinedParties}
                getId={(p) => p.id}
                getValue={(p) => p.name}
                getSearchText={(p) => `${p.name} ${p.gstin || ''} ${p.address || ''} ${p.phone || ''}`}
                renderTitle={(p) => p.name}
                renderBadge={(p) => p.partyType}
                renderDetails={(p) => formatPartyDetailsLine(p)}
                placeholder="Search Consignee Name, GSTIN, City or Phone..."
                quickPreview={(() => {
                  const matched = combinedParties.find(
                    (p) => p.id === selectedConsigneeId || p.name.toLowerCase() === consigneeName.trim().toLowerCase()
                  );
                  return matched ? <EntityQuickPreviewCard kind="party" party={matched} compact /> : null;
                })()}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">From City / Origin *</label>
              <EditableSearchSelect
                ariaLabel="From City"
                value={fromCity}
                onChange={setFromCity}
                options={allCities}
                placeholder="Origin city..."
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">To City / Destination *</label>
              <EditableSearchSelect
                ariaLabel="To City"
                value={toCity}
                onChange={setToCity}
                options={allCities}
                placeholder="Destination city..."
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Packages &amp; Mode</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={packages}
                  onChange={(e) => setPackages(e.target.value)}
                  placeholder="Pkgs"
                  className="w-20 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
                <EditableSearchSelect
                  ariaLabel="Package Mode"
                  value={packageMode}
                  onChange={setPackageMode}
                  options={pkgModeOptions}
                  className="flex-1 min-w-0"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Goods Particulars</label>
              <EditableSearchSelect
                ariaLabel="Goods Particulars"
                value={particulars}
                onChange={setParticulars}
                options={goodsOptions}
              />
            </div>
          </div>

          {/* Vehicle + Auto-Fetched Driver Fields (Shown only when hasVehicleNo = Yes) */}
          {hasVehicleNo && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-[#0D47A1] flex items-center gap-1.5">
                  <Truck className="w-4 h-4" />
                  Vehicle &amp; Auto-Fetched Driver Details
                </span>
                <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasMultiVehicle}
                    onChange={(e) => setHasMultiVehicle(e.target.checked)}
                  />
                  Multi-Lorry [Yes/No]
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Truck / Lorry No</label>
                  <RichEntityPicker
                    ariaLabel="Truck Number"
                    value={truckNo}
                    selectedId={selectedVehicleId}
                    uppercase
                    onChangeText={(txt) => {
                      setTruckNo(txt);
                      setSelectedVehicleId('');
                    }}
                    onSelectEntity={(v) => handleSelectVehicle(v)}
                    items={combinedVehicles}
                    getId={(v) => v.id}
                    getValue={(v) => v.truckNo}
                    getSearchText={(v) => `${v.truckNo} ${v.ownerName || ''} ${v.vehicleType || ''}`}
                    renderTitle={(v) => v.truckNo}
                    renderBadge={(v) => v.vehicleType || 'Fleet'}
                    renderDetails={(v) => formatVehicleDetailsLine(v)}
                    placeholder="WB23D1234..."
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Driver Name (Auto-Fill)</label>
                  <RichEntityPicker
                    ariaLabel="Driver Name"
                    value={driverName}
                    selectedId={selectedDriverId}
                    onChangeText={(txt) => {
                      setDriverName(txt);
                      setSelectedDriverId('');
                    }}
                    onSelectEntity={(d) => {
                      setDriverName(d.name);
                      setSelectedDriverId(d.id);
                      setDriverDlNo(d.dlNo || '');
                      setDriverDlExpiry(d.dlExpiry || '');
                      setDriverMobile(d.phone || '');
                    }}
                    items={combinedDrivers}
                    getId={(d) => d.id}
                    getValue={(d) => d.name}
                    getSearchText={(d) => `${d.name} ${d.dlNo} ${d.phone || ''}`}
                    renderTitle={(d) => d.name}
                    renderDetails={(d) => formatDriverDetailsLine(d)}
                    placeholder="Select / type Driver..."
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">D/L No &amp; Validity</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={driverDlNo}
                      onChange={(e) => setDriverDlNo(e.target.value.toUpperCase())}
                      placeholder="DL No"
                      className="flex-1 min-w-0 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                    <input
                      type="date"
                      value={driverDlExpiry}
                      onChange={(e) => setDriverDlExpiry(e.target.value)}
                      className="w-32 px-1.5 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Driver Mobile</label>
                  <input
                    type="text"
                    value={driverMobile}
                    onChange={(e) => setDriverMobile(e.target.value)}
                    placeholder="10-digit Mobile"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vehicle Make</label>
                  <EditableSearchSelect
                    ariaLabel="Vehicle Make"
                    value={vehicleMake}
                    onChange={setVehicleMake}
                    options={VEHICLE_MAKE_OPTIONS}
                    placeholder="Tata, Ashok Leyland..."
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Body Type</label>
                  <EditableSearchSelect
                    ariaLabel="Body Type"
                    value={bodyType}
                    onChange={setBodyType}
                    options={VEHICLE_BODY_TYPE_OPTIONS}
                    placeholder="Open Body, 32ft Container..."
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vehicle Color</label>
                  <EditableSearchSelect
                    ariaLabel="Vehicle Color"
                    value={vehicleColor}
                    onChange={setVehicleColor}
                    options={VEHICLE_COLOR_OPTIONS}
                    placeholder="Blue, Yellow, White..."
                  />
                </div>
              </div>

              {hasMultiVehicle && (
                <div className="pt-1 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700">Additional Multi-Lorries ({extraVehicles.length}/50)</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (extraVehicles.length < 50) setExtraVehicles((prev) => [...prev, '']);
                      }}
                      className="px-2 py-0.5 rounded bg-blue-600 text-white text-[11px] font-bold cursor-pointer"
                    >
                      + Add Truck
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {extraVehicles.map((tv, idx) => (
                      <div key={idx} className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded px-2 py-1">
                        <input
                          type="text"
                          value={tv}
                          onChange={(e) =>
                            setExtraVehicles((prev) => prev.map((x, i) => (i === idx ? e.target.value.toUpperCase() : x)))
                          }
                          placeholder={`Lorry #${idx + 2}`}
                          className="w-28 text-xs font-mono-num focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setExtraVehicles((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Weights, Rate, Freight & Single-Key Codes */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Nett Wt (MT)</label>
              <input
                type="number"
                step="0.01"
                value={nettWeight}
                onChange={(e) => {
                  setNettWeight(e.target.value);
                  setChargedWeight(e.target.value);
                  setHireWeightMt(e.target.value);
                }}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Gross Wt (MT)</label>
              <input
                type="number"
                step="0.01"
                value={grossWeight}
                onChange={(e) => setGrossWeight(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Rate Mode</label>
              <SearchableSelect
                ariaLabel="Rate Mode"
                value={rateMode}
                onChange={setRateMode}
                options={DEFAULT_RATE_MODES}
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                value={ratePerUnit}
                onChange={(e) => setRatePerUnit(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Base Freight (₹)</label>
              <input
                type="number"
                step="0.01"
                value={baseFreight}
                onChange={(e) => setBaseFreight(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Others (₹)</label>
              <input
                type="number"
                step="0.01"
                value={otherCharge}
                onChange={(e) => setOtherCharge(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Del [P/G/D]</label>
              <SearchableSelect
                ariaLabel="Delivery Mode Code"
                value={deliveryModeCode}
                onChange={setDeliveryModeCode}
                options={DELIVERY_MODE_CODES.map((c) => ({ value: c.code, label: c.label }))}
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">GST [R/E/T]</label>
              <SearchableSelect
                ariaLabel="GST Paid By Code"
                value={gstPaidByCode}
                onChange={(v) => {
                  setGstPaidByCode(v);
                  const mapped = GST_PAID_BY_CODES.find((c) => c.code === v)?.mapped;
                  if (mapped) setGstPaidByBill(mapped as 'Consignor' | 'Consignee' | 'Transporter');
                }}
                options={GST_PAID_BY_CODES.map((c) => ({ value: c.code, label: c.label }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-center">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Risk [O/C/I]</label>
              <SearchableSelect
                ariaLabel="Risk Code"
                value={riskTakenBy}
                onChange={setRiskTakenBy}
                options={RISK_TYPE_CODES.map((c) => ({ value: c.code, label: c.label }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">CN / LR Remarks</label>
              <input
                type="text"
                value={cnRemarks}
                onChange={(e) => setCnRemarks(e.target.value)}
                placeholder="Notes, detention instructions, delivery terms..."
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </div>
            <div className="pt-4">
              <button
                type="button"
                onClick={() => setMultiGoodsOpen((v) => !v)}
                className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-[#0D47A1] font-bold cursor-pointer"
              >
                {multiGoodsOpen ? 'Hide Multi-Goods / EWB' : `+ Multi-Goods (${multiGoodsItems.length}) / EWB (${extraEwayBills.length})`}
              </button>
            </div>
          </div>

          {multiGoodsOpen && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-800">Multi-Goods Items (max 50)</span>
                <button
                  type="button"
                  onClick={() =>
                    multiGoodsItems.length < 50 &&
                    setMultiGoodsItems((prev) => [
                      ...prev,
                      { description: particulars, packages: 1, packageMode, weightKg: 0 },
                    ])
                  }
                  className="px-2 py-0.5 rounded bg-[#0D47A1] text-white text-[11px] font-bold cursor-pointer"
                >
                  + Add Goods Item
                </button>
              </div>
              {multiGoodsItems.map((g, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center bg-white p-2 rounded border border-slate-200">
                  <input
                    type="text"
                    value={g.description}
                    onChange={(e) =>
                      setMultiGoodsItems((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row))
                      )
                    }
                    placeholder="Description"
                    className="sm:col-span-2 px-2 py-1 rounded border border-slate-300"
                  />
                  <input
                    type="number"
                    value={g.packages}
                    onChange={(e) =>
                      setMultiGoodsItems((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, packages: Number(e.target.value || 0) } : row))
                      )
                    }
                    placeholder="Pkgs"
                    className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={g.weightKg}
                    onChange={(e) =>
                      setMultiGoodsItems((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, weightKg: Number(e.target.value || 0) } : row))
                      )
                    }
                    placeholder="Wt Kg"
                    className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={() => setMultiGoodsItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-red-600 text-xs font-bold cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {!isFtl && (
                <div className="pt-1 flex items-center gap-3 text-xs">
                  <span className="font-bold text-slate-700">Logistics Delivery:</span>
                  {(['Door Delivery', 'Godown Delivery'] as const).map((dm) => (
                    <label key={dm} className="inline-flex items-center gap-1 font-semibold cursor-pointer">
                      <input
                        type="radio"
                        checked={docketDeliveryMode === dm}
                        onChange={() => setDocketDeliveryMode(dm)}
                      />
                      {dm}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: LORRY HIRE CHALLAN & MULTI-ADVANCE */}
      <div className="bg-white rounded-xl border border-amber-300 shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-amber-700 to-orange-600 text-white px-4 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Truck className="w-4 h-4 text-amber-200" />
            <span>SECTION 2 — Lorry Hire Challan, 2-Day Free Detention &amp; Multi-Advance</span>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs font-extrabold cursor-pointer">
            <input
              type="checkbox"
              checked={includeHireSection}
              onChange={(e) => setIncludeHireSection(e.target.checked)}
            />
            Include Lorry Hire in Save
          </label>
        </div>

        {includeHireSection && (
          <div className="p-4 space-y-3 text-xs">
            {podAlertActive && (
              <div className="rounded-lg border-2 border-red-500 bg-red-50 px-3 py-2 flex items-center gap-2 text-red-900 font-extrabold">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>
                  POD SHORTAGE / BREAKAGE / LEAKAGE ALERT DETECTED — Verify deductions before releasing balance!
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Broker Name</label>
                <RichEntityPicker<AnyPartyEntity>
                  ariaLabel="Broker Name"
                  value={brokerName}
                  selectedId={selectedBrokerId}
                  onChangeText={(txt) => {
                    setBrokerName(txt);
                    setSelectedBrokerId('');
                  }}
                  onSelectEntity={(b) => {
                    setBrokerName(b.name);
                    setSelectedBrokerId(b.id);
                  }}
                  items={brokerParties}
                  getId={(p) => p.id}
                  getValue={(p) => p.name}
                  getSearchText={(p) => `${p.name} ${p.pan || ''} ${p.phone || ''} ${p.address || ''}`}
                  renderTitle={(p) => p.name}
                  renderBadge={(p) => p.partyType}
                  renderDetails={(p) => formatPartyDetailsLine(p)}
                  placeholder="Search Broker by Name, PAN, Mobile, City..."
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Lorry Owner Name</label>
                <RichEntityPicker<AnyPartyEntity>
                  ariaLabel="Lorry Owner Name"
                  value={ownerName}
                  selectedId={selectedOwnerId}
                  onChangeText={(txt) => {
                    setOwnerName(txt);
                    setSelectedOwnerId('');
                  }}
                  onSelectEntity={(o) => {
                    setOwnerName(o.name);
                    setSelectedOwnerId(o.id);
                  }}
                  items={ownerParties}
                  getId={(p) => p.id}
                  getValue={(p) => p.name}
                  getSearchText={(p) => `${p.name} ${p.pan || ''} ${p.phone || ''} ${p.address || ''}`}
                  renderTitle={(p) => p.name}
                  renderBadge={(p) => p.partyType}
                  renderDetails={(p) => formatPartyDetailsLine(p)}
                  placeholder="Search Lorry Owner by Name, PAN, Mobile..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Weight (MT)</label>
                <input
                  type="number"
                  step="0.01"
                  value={hireWeightMt}
                  onChange={(e) => setHireWeightMt(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Rate Mode</label>
                <select
                  value={hireRateMode}
                  onChange={(e) => setHireRateMode(e.target.value as 'Fixed' | 'Per MT')}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="Fixed">Fixed</option>
                  <option value="Per MT">Per MT</option>
                </select>
              </div>
              {hireRateMode === 'Per MT' ? (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Rate / MT (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={hireRatePerUnit}
                    onChange={(e) => setHireRatePerUnit(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              ) : (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Gross Hire (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={hireAmount}
                    onChange={(e) => setHireAmount(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
              )}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Detention Days (2 Free)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={detentionDays}
                    onChange={(e) => setDetentionDays(e.target.value)}
                    className="w-16 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    title="Total halt days (first 2 days free)"
                  />
                  <input
                    type="number"
                    value={detentionRatePerDay}
                    onChange={(e) => setDetentionRatePerDay(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    title="Rate per chargeable day"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">TDS 194C (%)</label>
                <select
                  value={tdsRatePct}
                  onChange={(e) => setTdsRatePct(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                >
                  <option value="0">0% (194C Exempt)</option>
                  <option value="1">1% (Individual)</option>
                  <option value="2">2% (Company)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Net Balance Due</label>
                <div className="px-2.5 py-1.5 rounded bg-amber-50 border border-amber-300 font-mono-num font-extrabold text-amber-900">
                  ₹ {formatINR(hireNetSummary.balancePayable)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">Loading</label>
                <input type="number" step="0.01" value={hireLoadingCharge} onChange={(e) => setHireLoadingCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">Unloading</label>
                <input type="number" step="0.01" value={hireUnloadingCharge} onChange={(e) => setHireUnloadingCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">Kata</label>
                <input type="number" step="0.01" value={hireKataCharge} onChange={(e) => setHireKataCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">Parking</label>
                <input type="number" step="0.01" value={hireParkingCharge} onChange={(e) => setHireParkingCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-red-700 mb-0.5">Shortage Ded.</label>
                <input type="number" step="0.01" value={hireShortageCharge} onChange={(e) => setHireShortageCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-red-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-red-700 mb-0.5">Damage Ded.</label>
                <input type="number" step="0.01" value={hireDamageCharge} onChange={(e) => setHireDamageCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-red-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">Extra Adv.</label>
                <input type="number" step="0.01" value={extraAdvanceAmt} onChange={(e) => setExtraAdvanceAmt(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">Recpt Challan No</label>
                <input type="text" value={receiptChallanNo} onChange={(e) => setReceiptChallanNo(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
            </div>

            {/* 50-Row Multi-Advance with Live Running Balance */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-amber-900">
                  Multi-Advance Ledger ({hireAdvances.length}/50 Rows) — Total Paid: ₹ {formatINR(totalMultiAdvancePaid)}
                </span>
                <button
                  type="button"
                  onClick={() => hireAdvances.length < 50 && setHireAdvances((prev) => [...prev, DEFAULT_ADV_ROW()])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add Advance Row
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-amber-100 text-amber-950 font-bold text-left">
                      <th className="p-1.5">Payee</th>
                      <th className="p-1.5">Account / Holder</th>
                      <th className="p-1.5">Bank A/c / UPI / Ref</th>
                      <th className="p-1.5">Date</th>
                      <th className="p-1.5">Mode</th>
                      <th className="p-1.5 text-right">Amt (₹)</th>
                      <th className="p-1.5 text-right">Running Bal</th>
                      <th className="p-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const staticDeductions =
                        Number(extraAdvanceAmt || 0) +
                        Number(hireLoadingCharge || 0) +
                        Number(hireUnloadingCharge || 0) +
                        Number(hireParkingCharge || 0) +
                        Number(hireKataCharge || 0) +
                        Number(hireShortageCharge || 0) +
                        Number(hireDamageCharge || 0) +
                        effectiveTdsAmt;
                      let runningCum = 0;
                      return hireAdvances.map((adv, idx) => {
                        runningCum += Number(adv.amount || 0);
                        const rowBal = Math.max(
                          0,
                          Math.round((hireNetSummary.grossWithDetention - staticDeductions - runningCum) * 100) / 100
                        );
                        return (
                          <tr key={idx} className="border-b border-amber-100 bg-white">
                            <td className="p-1">
                              <select
                                value={adv.payeeType}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, payeeType: e.target.value } : r))
                                  )
                                }
                                className="px-1.5 py-1 rounded border border-slate-300"
                              >
                                <option value="Lorry Owner">Lorry Owner</option>
                                <option value="Broker">Broker</option>
                                <option value="Driver">Driver</option>
                              </select>
                            </td>
                            <td className="p-1">
                              <input
                                type="text"
                                value={adv.holderName || adv.accountName}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, holderName: e.target.value, accountName: e.target.value } : r
                                    )
                                  )
                                }
                                placeholder="Holder / A/c Name"
                                className="w-32 px-1.5 py-1 rounded border border-slate-300"
                              />
                            </td>
                            <td className="p-1 flex gap-1">
                              <input
                                type="text"
                                value={adv.bankAccountNo || ''}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, bankAccountNo: e.target.value } : r))
                                  )
                                }
                                placeholder="A/c"
                                className="w-24 px-1.5 py-1 rounded border border-slate-300 font-mono-num"
                              />
                              <input
                                type="text"
                                value={adv.upiId || ''}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, upiId: e.target.value } : r))
                                  )
                                }
                                placeholder="UPI / Ref"
                                className="w-24 px-1.5 py-1 rounded border border-slate-300"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="date"
                                value={adv.advanceDate}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, advanceDate: e.target.value } : r))
                                  )
                                }
                                className="px-1 py-1 rounded border border-slate-300 font-mono-num"
                              />
                            </td>
                            <td className="p-1">
                              <select
                                value={adv.mode}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, mode: e.target.value } : r))
                                  )
                                }
                                className="px-1 py-1 rounded border border-slate-300"
                              >
                                {PAYMENT_MODE_OPTIONS.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1">
                              <input
                                type="number"
                                step="0.01"
                                value={adv.amount}
                                onChange={(e) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, amount: Number(e.target.value || 0) } : r
                                    )
                                  )
                                }
                                className="w-24 px-1.5 py-1 rounded border border-slate-300 text-right font-mono-num font-bold"
                              />
                            </td>
                            <td className="p-1 text-right font-mono-num font-extrabold text-amber-900 whitespace-nowrap">
                              ₹ {formatINR(rowBal)}
                            </td>
                            <td className="p-1 text-center">
                              {hireAdvances.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setHireAdvances((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-red-600 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center">
              <label className="inline-flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={podReceived}
                  onChange={(e) => setPodReceived(e.target.checked)}
                />
                POD Verified / Received
              </label>
              <input
                type="text"
                value={podRemarks}
                onChange={(e) => setPodRemarks(e.target.value)}
                placeholder="POD Remarks (type 'shortage'/'damage' for Red Alert)"
                className="px-2.5 py-1.5 rounded border border-slate-300"
              />
              <input
                type="text"
                value={hireRemarks}
                onChange={(e) => setHireRemarks(e.target.value)}
                placeholder="Lorry Hire / Challan Remarks..."
                className="px-2.5 py-1.5 rounded border border-slate-300"
              />
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: STAFF LEDGER & M (MULTI-LOGS) */}
      <div className="bg-white rounded-xl border border-indigo-300 shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-indigo-700 to-blue-700 text-white px-4 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Users className="w-4 h-4 text-amber-300" />
            <span>SECTION 3 — Staff Commission &amp; Advance Ledger (Press M for Multi Logs)</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowMultiLogs((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-extrabold cursor-pointer"
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>{showMultiLogs ? 'Hide M (Multi)' : 'M (Multi Logs)'}</span>
            </button>
            <label className="inline-flex items-center gap-1.5 text-xs font-extrabold cursor-pointer">
              <input
                type="checkbox"
                checked={includeStaffSection}
                onChange={(e) => setIncludeStaffSection(e.target.checked)}
              />
              Include Staff Entry
            </label>
          </div>
        </div>

        {includeStaffSection && (
          <div className="p-4 space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Staff Name</label>
                <EditableSearchSelect
                  ariaLabel="Staff Name"
                  value={staffName}
                  onChange={setStaffName}
                  options={staffAccounts.map((s) => s.displayName)}
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Auto Bank / UPI</label>
                <div className="px-2 py-1.5 rounded bg-indigo-50 border border-indigo-200 font-mono-num text-[11px] truncate">
                  {staffBankAccount || staffUpiId || 'No Bank/UPI on profile'}
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Entry Type</label>
                <select
                  value={staffEntryType}
                  onChange={(e) => setStaffEntryType(e.target.value as 'Commission' | 'Advance Taken' | 'Paid')}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="Commission">Commission</option>
                  <option value="Advance Taken">Advance Taken</option>
                  <option value="Paid">Paid / Settlement</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Wheel Type (Auto-Rate)</label>
                <select
                  value={wheelType}
                  onChange={(e) => {
                    const wt = e.target.value;
                    setWheelType(wt);
                    setStaffAmount(String(wheelRates[wt] || 0));
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  {WHEEL_TYPES.map((w) => (
                    <option key={w} value={w}>
                      {w} (₹{wheelRates[w] || 0})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={staffAmount}
                  onChange={(e) => setStaffAmount(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Travelling + Misc (₹)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={travellingAmt}
                    onChange={(e) => setTravellingAmt(e.target.value)}
                    placeholder="Travel"
                    className="w-1/2 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={miscAmt}
                    onChange={(e) => setMiscAmt(e.target.value)}
                    placeholder="Misc"
                    className="w-1/2 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              </div>
            </div>

            {showMultiLogs && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 bg-indigo-50/50 border border-indigo-200 rounded-lg p-3">
                <div>
                  <div className="flex justify-between font-bold text-indigo-900 mb-1">
                    <span>Multi Advances ({multiAdvances.length}/50)</span>
                    <button
                      type="button"
                      onClick={() =>
                        multiAdvances.length < 50 &&
                        setMultiAdvances((prev) => [...prev, { date: docDate, account: 'Cash', amount: 0 }])
                      }
                      className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] cursor-pointer"
                    >
                      + Row
                    </button>
                  </div>
                  {multiAdvances.map((r, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <input type="date" value={r.date} onChange={(e) => setMultiAdvances((p) => p.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))} className="w-28 px-1 py-0.5 rounded border border-slate-300 text-[11px]" />
                      <input type="text" value={r.account} onChange={(e) => setMultiAdvances((p) => p.map((x, idx) => (idx === i ? { ...x, account: e.target.value } : x)))} placeholder="A/c" className="flex-1 min-w-0 px-1 py-0.5 rounded border border-slate-300 text-[11px]" />
                      <input type="number" value={r.amount} onChange={(e) => setMultiAdvances((p) => p.map((x, idx) => (idx === i ? { ...x, amount: Number(e.target.value || 0) } : x)))} className="w-20 px-1 py-0.5 rounded border border-slate-300 text-right font-mono-num text-[11px]" />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between font-bold text-indigo-900 mb-1">
                    <span>Paid Returns ({multiPaidReturns.length}/50)</span>
                    <button
                      type="button"
                      onClick={() =>
                        multiPaidReturns.length < 50 &&
                        setMultiPaidReturns((prev) => [...prev, { date: docDate, amount: 0, mode: 'Cash' }])
                      }
                      className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] cursor-pointer"
                    >
                      + Row
                    </button>
                  </div>
                  {multiPaidReturns.map((r, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <input type="date" value={r.date} onChange={(e) => setMultiPaidReturns((p) => p.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))} className="w-28 px-1 py-0.5 rounded border border-slate-300 text-[11px]" />
                      <input type="number" value={r.amount} onChange={(e) => setMultiPaidReturns((p) => p.map((x, idx) => (idx === i ? { ...x, amount: Number(e.target.value || 0) } : x)))} className="flex-1 px-1 py-0.5 rounded border border-slate-300 text-right font-mono-num text-[11px]" />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between font-bold text-indigo-900 mb-1">
                    <span>Balance Dates ({multiBalanceDates.length}/50)</span>
                    <button
                      type="button"
                      onClick={() =>
                        multiBalanceDates.length < 50 &&
                        setMultiBalanceDates((prev) => [...prev, { date: docDate, balanceAmt: 0 }])
                      }
                      className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] cursor-pointer"
                    >
                      + Row
                    </button>
                  </div>
                  {multiBalanceDates.map((r, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <input type="date" value={r.date} onChange={(e) => setMultiBalanceDates((p) => p.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))} className="w-28 px-1 py-0.5 rounded border border-slate-300 text-[11px]" />
                      <input type="number" value={r.balanceAmt} onChange={(e) => setMultiBalanceDates((p) => p.map((x, idx) => (idx === i ? { ...x, balanceAmt: Number(e.target.value || 0) } : x)))} className="flex-1 px-1 py-0.5 rounded border border-slate-300 text-right font-mono-num text-[11px]" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: PARTY BILL & TAX INVOICE BUILDER */}
      <div className="bg-white rounded-xl border border-emerald-300 shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-emerald-800 to-teal-700 text-white px-4 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <FileSpreadsheet className="w-4 h-4 text-amber-300" />
            <span>SECTION 4 — Party Bill, Itemized Charges &amp; Tax Invoice</span>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs font-extrabold cursor-pointer">
            <input
              type="checkbox"
              checked={includeBillSection}
              onChange={(e) => setIncludeBillSection(e.target.checked)}
            />
            Generate &amp; Link Party Bill
          </label>
        </div>

        {includeBillSection && (
          <div className="p-4 space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Bill ID</label>
                <input
                  type="text"
                  value={billId}
                  onChange={(e) => setBillId(e.target.value.toUpperCase())}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Invoice No *</label>
                <input
                  type="text"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value.toUpperCase())}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Billed By [B/P]</label>
                <select
                  value={billedByCode}
                  onChange={(e) => setBilledByCode(e.target.value as 'B' | 'P')}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="B">B = Branch Billing</option>
                  <option value="P">P = Principal / HO</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Bill Date *</label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => {
                    setBillDate(e.target.value);
                    setDueDate(addDaysISO(e.target.value, creditDays));
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Billing Country</label>
                <select
                  value={billingCountry}
                  onChange={(e) => setBillingCountry(e.target.value as 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan')}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="India">India (GST)</option>
                  <option value="Nepal">Nepal (0% Export)</option>
                  <option value="Bangladesh">Bangladesh (0% Export)</option>
                  <option value="Bhutan">Bhutan (0% Export)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Grand Bill Total</label>
                <div className="px-2.5 py-1.5 rounded bg-emerald-50 border border-emerald-300 font-mono-num font-extrabold text-emerald-900">
                  ₹ {formatINR(billSummary.grossBillAmount)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Bill To Party * (Customers Only — Brokers/Owners Excluded)
                </label>
                <RichEntityPicker<Party>
                  ariaLabel="Bill To Party"
                  value={billPartyName}
                  selectedId={selectedBillPartyId}
                  onChangeText={(txt) => {
                    setBillPartyName(txt);
                    setSelectedBillPartyId('');
                  }}
                  onSelectEntity={handleSelectBillParty}
                  items={billingCustomerParties}
                  getId={(p) => p.id}
                  getValue={(p) => p.name}
                  getSearchText={(p) => `${p.name} ${p.gstin || ''} ${p.address || ''} ${p.phone || ''}`}
                  renderTitle={(p) => p.name}
                  renderBadge={(p) => p.partyType}
                  renderDetails={(p) => formatPartyDetailsLine(p)}
                  placeholder="Select Customer / Billing Party (auto-fills GSTIN & State)..."
                  quickPreview={(() => {
                    const matched = billingCustomerParties.find(
                      (p) => p.id === selectedBillPartyId || p.name.toLowerCase() === billPartyName.trim().toLowerCase()
                    );
                    return matched ? <EntityQuickPreviewCard kind="party" party={matched} compact /> : null;
                  })()}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Party GSTIN</label>
                  <input
                    type="text"
                    value={billPartyGstin}
                    onChange={(e) => setBillPartyGstin(e.target.value.toUpperCase())}
                    placeholder="19AAAAA0000A1Z5"
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">GST Mode</label>
                  <select
                    value={gstPaidByBill}
                    onChange={(e) => setGstPaidByBill(e.target.value as 'Consignor' | 'Consignee' | 'Transporter')}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Consignee">Consignee (RCM 5%)</option>
                    <option value="Consignor">Consignor (RCM 5%)</option>
                    <option value="Transporter">Transporter (FCM 12%)</option>
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="inline-flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={interstateBill}
                      onChange={(e) => setInterstateBill(e.target.checked)}
                    />
                    Interstate (IGST)
                  </label>
                </div>
              </div>
            </div>

            {/* Itemized Party Bill Charges */}
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 bg-emerald-50/50 border border-emerald-200 rounded-lg p-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Insurance</label>
                <input type="number" step="0.01" value={insuranceCharge} onChange={(e) => setInsuranceCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Coll</label>
                <input type="number" step="0.01" value={collCharge} onChange={(e) => setCollCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Loading</label>
                <input type="number" step="0.01" value={billLoadingCharge} onChange={(e) => setBillLoadingCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Unloading</label>
                <input type="number" step="0.01" value={billUnloadingCharge} onChange={(e) => setBillUnloadingCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Surcharge</label>
                <input type="number" step="0.01" value={surchargeAmt} onChange={(e) => setSurchargeAmt(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Detention</label>
                <input type="number" step="0.01" value={detentionBillCharge} onChange={(e) => setDetentionBillCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">ST Charge</label>
                <input type="number" step="0.01" value={stCharge} onChange={(e) => setStCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Fumigation</label>
                <input type="number" step="0.01" value={fumigationCharge} onChange={(e) => setFumigationCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Extra Chg</label>
                <input type="number" step="0.01" value={extraBillCharge} onChange={(e) => setExtraBillCharge(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300 font-mono-num" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-center">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Advance Received (₹) &amp; Mode</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={advanceReceived}
                    onChange={(e) => setAdvanceReceived(e.target.value)}
                    className="w-1/2 px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                  <select
                    value={advanceMode}
                    onChange={(e) => setAdvanceMode(e.target.value)}
                    className="w-1/2 px-1.5 py-1.5 rounded border border-slate-300 bg-white"
                  >
                    {PAYMENT_MODE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-4 flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 font-bold text-emerald-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fullPaymentReceived}
                    onChange={(e) => setFullPaymentReceived(e.target.checked)}
                  />
                  Full Paid
                </label>
                {fullPaymentReceived && (
                  <select
                    value={fullPaymentMode}
                    onChange={(e) => setFullPaymentMode(e.target.value)}
                    className="px-2 py-1 rounded border border-slate-300 bg-white"
                  >
                    {PAYMENT_MODE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Bill Remarks Preset</label>
                <EditableSearchSelect
                  ariaLabel="Bill Remarks"
                  value={billRemarks}
                  onChange={setBillRemarks}
                  options={BILL_REMARK_PRESETS}
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Footnote / Additional Notes</label>
                <EditableSearchSelect
                  ariaLabel="Bill Footnote"
                  value={billFootnote}
                  onChange={setBillFootnote}
                  options={BILL_FOOTNOTE_PRESETS}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
              <div className="text-xs font-mono-num font-bold text-slate-700">
                Taxable: ₹{formatINR(billSummary.taxableTotal)} · GST ({billSummary.gstRate}%): ₹{formatINR(billSummary.totalTax)} · Paid: ₹{formatINR(billSummary.paidAmount)} · Net Due: <span className="text-emerald-800">₹{formatINR(billSummary.balanceDue)}</span>
              </div>
              <button
                type="button"
                disabled={saving || readOnly}
                onClick={() => void saveCompleteSheet('exit')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Save Complete Sheet &amp; Exit</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* LIVE VIEW ENTRY SHEET / REGISTER TABLE */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden">
        <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>
              View Entry Sheet / Live Register ({filteredRegisterRows.length} {isFtl ? 'Trips' : 'Dockets'})
            </span>
          </div>
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={registerSearch}
              onChange={(e) => setRegisterSearch(e.target.value)}
              placeholder="Search CN, Bill No, Party, Truck..."
              className="w-full pl-8 pr-3 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-left">
              <tr>
                <th className="p-2.5">CN / Docket</th>
                <th className="p-2.5">Date &amp; Branch</th>
                <th className="p-2.5">Parties &amp; Route</th>
                <th className="p-2.5">Truck / Driver</th>
                <th className="p-2.5 text-right">Hire &amp; Bal (₹)</th>
                <th className="p-2.5">Staff Comm</th>
                <th className="p-2.5 text-right">Bill &amp; Due (₹)</th>
                <th className="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredRegisterRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500 font-semibold">
                    No entries recorded yet for {divisionMeta.shortLabel} ({activeFy}). Fill Section 1-4 above and click Save.
                  </td>
                </tr>
              ) : (
                filteredRegisterRows.slice(0, 200).map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/40">
                    <td className="p-2.5 font-mono-num font-extrabold text-[#0D47A1] whitespace-nowrap">
                      {row.docNo}
                      <div className="text-[10px] font-normal text-slate-500">
                        Freight ₹{formatINR(row.cnFreight)}
                      </div>
                    </td>
                    <td className="p-2.5 font-mono-num whitespace-nowrap">
                      {formatDateDDMMYYYY(row.docDate)}
                      <div className="text-[10px] text-slate-600 font-sans font-semibold">{row.branch}</div>
                    </td>
                    <td className="p-2.5 max-w-[240px]">
                      <div className="font-bold text-slate-900 truncate">{row.billingPartyName}</div>
                      <div className="text-[11px] text-slate-600 truncate">
                        {row.consignorName} → {row.consigneeName} ({row.route})
                      </div>
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      <span className="font-mono-num font-bold text-slate-800">{row.truckNo}</span>
                      <div className="text-[10px] text-slate-500">{row.driverName}</div>
                    </td>
                    <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                      <div className="font-bold text-slate-800">₹{formatINR(row.hireGross)}</div>
                      <div className="text-[10px] text-amber-800">
                        Bal ₹{formatINR(row.hireBalance)} · {row.podReceived ? 'POD OK' : 'POD Pend'}
                      </div>
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-800 truncate max-w-[110px]">{row.staffName}</div>
                      <div className="text-[10px] font-mono-num text-indigo-700">₹{formatINR(row.staffAmount)}</div>
                    </td>
                    <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                      <div className="font-bold text-emerald-800">{row.billNo}</div>
                      <div className="text-[10px] text-slate-600">
                        Tot ₹{formatINR(row.billTotal)} · Due ₹{formatINR(row.billBalance)}
                      </div>
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setViewModalRow(row)}
                          className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 cursor-pointer"
                          title="View Complete Linked Summary"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => loadRowForEdit(row)}
                          className="p-1.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0D47A1] cursor-pointer"
                          title="Edit / Rectify Complete Entry"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRowPdfPreview(row)}
                          className="p-1.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 cursor-pointer"
                          title="Low-MB PDF Preview"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRowAutoPrint(row)}
                          className="p-1.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 cursor-pointer"
                          title="Auto-Print PDF"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Read-Only View Modal */}
      {viewModalRow && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-extrabold">
                Master Entry Summary — {viewModalRow.docNo}
              </span>
              <button
                type="button"
                onClick={() => setViewModalRow(null)}
                className="p-1 rounded hover:bg-white/20 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <p className="font-extrabold text-[#0D47A1]">1. CN / Docket</p>
                <p><b>Date &amp; Branch:</b> {formatDateDDMMYYYY(viewModalRow.docDate)} · {viewModalRow.branch}</p>
                <p><b>Route:</b> {viewModalRow.route}</p>
                <p><b>Consignor:</b> {viewModalRow.consignorName}</p>
                <p><b>Consignee:</b> {viewModalRow.consigneeName}</p>
                <p><b>Truck / Driver:</b> {viewModalRow.truckNo} ({viewModalRow.driverName})</p>
                <p><b>Freight:</b> ₹ {formatINR(viewModalRow.cnFreight)}</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                <p className="font-extrabold text-amber-900">2. Lorry Hire &amp; POD</p>
                <p><b>Gross Hire:</b> ₹ {formatINR(viewModalRow.hireGross)}</p>
                <p><b>Balance Payable:</b> ₹ {formatINR(viewModalRow.hireBalance)}</p>
                <p><b>POD Status:</b> {viewModalRow.podReceived ? 'Received / Verified' : 'Pending'}</p>
                <p className="font-extrabold text-indigo-900 pt-2">3. Staff Ledger</p>
                <p><b>Staff:</b> {viewModalRow.staffName} · ₹ {formatINR(viewModalRow.staffAmount)}</p>
                <p className="font-extrabold text-emerald-900 pt-2">4. Party Bill</p>
                <p><b>Bill To:</b> {viewModalRow.billingPartyName}</p>
                <p><b>Invoice:</b> {viewModalRow.billNo} · Total ₹ {formatINR(viewModalRow.billTotal)} · Due ₹ {formatINR(viewModalRow.billBalance)}</p>
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-100 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const row = viewModalRow;
                  setViewModalRow(null);
                  loadRowForEdit(row);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#0D47A1] text-white text-xs font-bold cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit / Rectify
              </button>
              <button
                type="button"
                onClick={() => void handleRowAutoPrint(viewModalRow)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 text-slate-950 text-xs font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Auto-Print
              </button>
              <button
                type="button"
                onClick={() => setViewModalRow(null)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 text-xs font-bold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
