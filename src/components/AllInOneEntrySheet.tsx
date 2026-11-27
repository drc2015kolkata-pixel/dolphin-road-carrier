import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Edit3,
  Eye,
  FileSpreadsheet,
  Keyboard,
  Landmark,
  Layers,
  Lock,
  Mail,
  MessageCircle,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Smartphone,
  Trash2,
  Truck,
  Unlock,
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
  EwbExtensionLog,
  ExtraEwayBill,
  ExtraInsuranceItem,
  ExtraTaxInvoice,
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
  PayInstallmentRow,
  StaffAccount,
  StaffCommissionEntry,
  StaffMultiAdvanceLog,
  StaffMultiBalanceDateLog,
  StaffMultiPaidReturnLog,
  Vehicle,
} from '../types/erp';
import {
  amountToIndianWords,
  computeRateModeAmount,
  extractTrailingSerialNumber,
  formatDateDDMMYYYY,
  formatINR,
  getFyShortCode,
  isLumpSumRateMode,
  makeSafeDocId,
  normalizeFyLabel,
  todayISO,
} from '../lib/formatters';
import { logBranchActivity, upsertDocument } from '../lib/firestoreStore';
import {
  addDropdownItem,
  ALL_INDIA_BRANCH_OPTIONS,
  ALL_INDIA_STATES_DISTRICTS,
  DEFAULT_RATE_MODES,
  deleteDropdownItem,
  DELIVERY_MODE_CODES,
  editDropdownItem,
  getEffectiveCreditDayPresets,
  getEffectiveDropdownList,
  GST_PAID_BY_CODES,
  RISK_TYPE_CODES,
  VEHICLE_COLOR_OPTIONS,
  VEHICLE_MAKE_OPTIONS,
} from '../lib/dropdownMasterStore';
import {
  DbfLatestSerialSummary,
  extractHighestBillAndCnFromRawDbf,
  loadRawDbfArchiveFromIdb,
} from '../lib/foxproDbfImport';
import {
  filterBillingCustomerParties,
  normalizePartyMatchKey,
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
  generateFoxproStatementPDF,
  generateLogisticsDocketPDF,
  generateLR3CopyPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { compressComplianceFileToDataUrl } from '../lib/kycVaultStorage';
import { validateIndianGstin, validateSafeUploadFile } from '../lib/gstinValidator';
import { GstinInputField } from './GstinInputField';
import {
  buildWhatsAppShareHref,
  sharePdfDirect,
  triggerExternalShareLink,
} from '../lib/shareUtils';
import { SupportedCountry } from '../lib/postalPinLookup';
import { VoiceDraftFields } from '../lib/voicePilot';
import { PinCountryInputs, useAutoPinLookup } from './CityPinCountryAutoFill';
import { deleteIdbObject, loadIdbObject, saveIdbObject } from '../lib/indexedDbStore';

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
  showFreightOnPrint: boolean;
  hireGross: number;
  hireBalance: number;
  podReceived: boolean;
  staffName: string;
  staffAmount: number;
  staffSettledZero: boolean;
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

const EMPTY_PAY_12 = (): PayInstallmentRow[] =>
  Array.from({ length: 12 }, (_, idx) => ({
    slot: idx + 1,
    date: '',
    refNo: '',
    amount: 0,
  }));

function mergePay12Rows(existing?: PayInstallmentRow[]): PayInstallmentRow[] {
  const base = EMPTY_PAY_12();
  if (!Array.isArray(existing)) return base;
  existing.forEach((row, idx) => {
    const slotIdx = row.slot >= 1 && row.slot <= 12 ? row.slot - 1 : idx;
    if (slotIdx >= 0 && slotIdx < 12) {
      base[slotIdx] = {
        slot: slotIdx + 1,
        date: row.date || '',
        refNo: row.refNo || '',
        amount: Number(row.amount || 0),
      };
    }
  });
  return base;
}

function diffDaysInclusive(fromDate: string, toDate: string): number {
  if (!fromDate || !toDate) return 0;
  const a = new Date(fromDate);
  const b = new Date(toDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

const AllInOneEntrySheetInner: React.FC<AllInOneEntrySheetProps> = ({
  divisionMode,
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  activeFy,
  isMasterAdmin,
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
  const scanFileInputRef = useRef<HTMLInputElement | null>(null);

  // Linked edit IDs (Strictly CN/Docket + Lorry Hire + Staff — NO Tax Invoice inside Sheet A)
  const [editingCnId, setEditingCnId] = useState<string | null>(null);
  const [editingDocketId, setEditingDocketId] = useState<string | null>(null);
  const [editingHireId, setEditingHireId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  // Find CN/LR Instant Search
  const [findCnQuery, setFindCnQuery] = useState('');
  const [findCnFocused, setFindCnFocused] = useState(false);

  // Section Toggles (Band 1 Lorry Hire & Band 2 Staff)
  const [includeHireSection, setIncludeHireSection] = useState(true);
  const [includeStaffSection, setIncludeStaffSection] = useState(true);

  const [dbfSerialStats, setDbfSerialStats] = useState<DbfLatestSerialSummary | null>(null);
  const docNoDirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadRawDbfArchiveFromIdb()
      .then((tables) => {
        if (!cancelled && tables && tables.length > 0) {
          setDbfSerialStats(extractHighestBillAndCnFromRawDbf(tables));
        }
      })
      .catch(() => {
        // Ignore raw archive read errors
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const computedLastCnNo = useMemo(() => {
    let bestNo = '';
    let bestSeq = 0;
    if (isFtl) {
      consignments.forEach((c) => {
        const seq = extractTrailingSerialNumber(c.cnNo);
        if (seq > bestSeq) {
          bestSeq = seq;
          bestNo = c.cnNo;
        }
      });
      if (!bestNo && consignments.length > 0) {
        const sorted = [...consignments].sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''));
        bestNo = sorted[0]?.cnNo || '';
        bestSeq = extractTrailingSerialNumber(bestNo);
      }
      if (dbfSerialStats?.maxCnNum && dbfSerialStats.maxCnNum >= bestSeq) {
        return dbfSerialStats.maxCnNo || bestNo || 'None';
      }
      return bestNo || 'None';
    }
    if (logisticsDockets.length === 0) return 'None';
    const sorted = [...logisticsDockets].sort((a, b) => (b.docketDate || '').localeCompare(a.docketDate || ''));
    return sorted[0]?.docketNo || 'None';
  }, [isFtl, consignments, logisticsDockets, dbfSerialStats]);

  const nextSuggestedDocNo = useMemo(() => {
    const prefix = isFtl
      ? (company.serialConfig?.ftlCnPrefix || 'KOL').trim().toUpperCase()
      : divisionMeta.docPrefix;
    const fyShort = getFyShortCode(activeFy);
    const baseStart = isFtl ? Number(company.serialConfig?.ftlCnStart || 150) : 150;
    let maxSeq = 0;
    if (isFtl) {
      consignments.forEach((c) => {
        const seq = extractTrailingSerialNumber(c.cnNo);
        if (seq > maxSeq) maxSeq = seq;
      });
      if (dbfSerialStats?.maxCnNum && dbfSerialStats.maxCnNum > maxSeq) {
        maxSeq = dbfSerialStats.maxCnNum;
      }
    } else {
      logisticsDockets.forEach((d) => {
        const seq = extractTrailingSerialNumber(d.docketNo);
        if (seq > maxSeq) maxSeq = seq;
      });
    }
    const nextSeq = Math.max(baseStart, maxSeq > 0 ? maxSeq + 1 : baseStart);
    return `${prefix}-${nextSeq}/${fyShort}`;
  }, [isFtl, company.serialConfig, divisionMeta.docPrefix, activeFy, consignments, logisticsDockets, dbfSerialStats]);

  // SECTION 1: CLASSIC FOXPRO BILTY RECORDS ENTRY FIELDS
  const [branchShort, setBranchShort] = useState(() => (isFtl ? 'KOL' : divisionMeta.docPrefix));
  const [refCnNo, setRefCnNo] = useState('');
  const [docNo, setDocNo] = useState(() => nextSuggestedDocNo);
  const [docDate, setDocDate] = useState(todayISO());
  const [billedAtBranch, setBilledAtBranch] = useState('Kolkata');
  const [transportMode, setTransportMode] = useState<'Road' | 'Rail' | 'Air'>('Road');
  const [bookingBasis, setBookingBasis] = useState<'Party' | 'Franchise' | 'Cash'>('Party');
  const [payBasis, setPayBasis] = useState<'TBB' | 'Paid' | 'To-Pay'>('TBB');
  const [deliverAt, setDeliverAt] = useState('');
  const [deliverAtPinCode, setDeliverAtPinCode] = useState('');
  const [deliverAtCountry, setDeliverAtCountry] = useState<SupportedCountry>('India');
  const [isChallanAttached, setIsChallanAttached] = useState(false);
  const [creditDays, setCreditDays] = useState(15);

  const [billingPartyName, setBillingPartyName] = useState('');
  const [selectedBillingPartyId, setSelectedBillingPartyId] = useState('');

  const [consignorName, setConsignorName] = useState('');
  const [selectedConsignorId, setSelectedConsignorId] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorPinCode, setConsignorPinCode] = useState('');
  const [consignorCountry, setConsignorCountry] = useState<SupportedCountry>('India');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consignorHsn, setConsignorHsn] = useState('');

  const [consigneeName, setConsigneeName] = useState('');
  const [selectedConsigneeId, setSelectedConsigneeId] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneePinCode, setConsigneePinCode] = useState('');
  const [consigneeCountry, setConsigneeCountry] = useState<SupportedCountry>('India');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [consigneeHsn, setConsigneeHsn] = useState('');

  const [fromCity, setFromCity] = useState('Kolkata');
  const [fromPinCode, setFromPinCode] = useState('700001');
  const [fromCountry, setFromCountry] = useState<SupportedCountry>('India');
  const [toCity, setToCity] = useState('');
  const [toPinCode, setToPinCode] = useState('');
  const [toCountry, setToCountry] = useState<SupportedCountry>('India');
  const [ewayPlace, setEwayPlace] = useState('');
  const [ewayPinCode, setEwayPinCode] = useState('');

  useAutoPinLookup(consignorAddress, consignorPinCode, consignorCountry, (pin, country) => {
    setConsignorPinCode(pin);
    setConsignorCountry(country);
  });
  useAutoPinLookup(consigneeAddress, consigneePinCode, consigneeCountry, (pin, country) => {
    setConsigneePinCode(pin);
    setConsigneeCountry(country);
  });
  useAutoPinLookup(fromCity, fromPinCode, fromCountry, (pin, country) => {
    setFromPinCode(pin);
    setFromCountry(country);
  });
  useAutoPinLookup(toCity, toPinCode, toCountry, (pin, country) => {
    setToPinCode(pin);
    setToCountry(country);
    if (!ewayPlace.trim()) setEwayPinCode(pin);
  });
  useAutoPinLookup(deliverAt, deliverAtPinCode, deliverAtCountry, (pin, country) => {
    setDeliverAtPinCode(pin);
    setDeliverAtCountry(country);
  });
  useAutoPinLookup(ewayPlace, ewayPinCode, toCountry, (pin) => {
    setEwayPinCode(pin);
  });

  useEffect(() => {
    const onVoiceDraft = (evt: Event) => {
      const detail = (evt as CustomEvent<VoiceDraftFields>).detail;
      if (!detail || readOnly) return;
      if (detail.consignorName) setConsignorName(detail.consignorName);
      if (detail.consigneeName) setConsigneeName(detail.consigneeName);
      if (detail.partyName && !detail.consignorName) setBillingPartyName(detail.partyName);
      if (detail.fromCity) setFromCity(detail.fromCity);
      if (detail.toCity) setToCity(detail.toCity);
      if (detail.deliverAt) setDeliverAt(detail.deliverAt);
      if (detail.truckNo) {
        setHasVehicleNo(true);
        setTruckNo(detail.truckNo);
      }
      if (detail.ewayBillNo) setEwayBillNo(detail.ewayBillNo);
      if (detail.freight) setBaseFreight(detail.freight);
      if (detail.goodsDesc) setParticulars(detail.goodsDesc);
    };
    window.addEventListener('drc:voice-draft-fill', onVoiceDraft);
    return () => window.removeEventListener('drc:voice-draft-fill', onVoiceDraft);
  }, [readOnly]);

  // Vehicle & Driver + Multi Lorry [Y/N]
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

  // Packages & Goods + Multi Package/Goods [Y/N]
  const [packages, setPackages] = useState('1');
  const [packageMode, setPackageMode] = useState('PACKAGES');
  const [particulars, setParticulars] = useState('MS Steel Pipes & Tubes');
  const [hasMultiGoods, setHasMultiGoods] = useState(false);
  const [multiGoodsItems, setMultiGoodsItems] = useState<MultiGoodsItem[]>([]);

  // Supplier Tax Invoice + Multi Invoice [Y/N]
  const [taxInvNo, setTaxInvNo] = useState('');
  const [taxInvDate, setTaxInvDate] = useState('');
  const [valueOfGoods, setValueOfGoods] = useState('0');
  const [hasMultiTaxInv, setHasMultiTaxInv] = useState(false);
  const [extraTaxInvoices, setExtraTaxInvoices] = useState<ExtraTaxInvoice[]>([]);

  // E-Way Bill + Multi EWB [Y/N] + Extension Log (1st/2nd/3rd)
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [ewayBillDate, setEwayBillDate] = useState('');
  const [ewayBillValidUpto, setEwayBillValidUpto] = useState('');
  const [hasMultiEwb, setHasMultiEwb] = useState(false);
  const [extraEwayBills, setExtraEwayBills] = useState<ExtraEwayBill[]>([]);
  const [ewbExtensions, setEwbExtensions] = useState<EwbExtensionLog[]>([]);

  // Unlocked Weights + Multi Weight [Y/N] + Editable Total Freight + Print Toggle
  const [nettWeight, setNettWeight] = useState('15');
  const [grossWeight, setGrossWeight] = useState('15.5');
  const [chargedWeight, setChargedWeight] = useState('15');
  const [hasMultiWeight, setHasMultiWeight] = useState(false);
  const [multiWeights, setMultiWeights] = useState<MultiWeightRow[]>([]);
  const [rateMode, setRateMode] = useState('Fixed');
  const [ratePerUnit, setRatePerUnit] = useState('0');
  const [baseFreight, setBaseFreight] = useState('0');
  const [otherCharge, setOtherCharge] = useState('0');
  const [manualFreightOverride, setManualFreightOverride] = useState<string | null>(null);
  const [showFreightOnPrint, setShowFreightOnPrint] = useState(true);

  // Insurance + Multi Insurance [Y/N]
  const [insuranceCo, setInsuranceCo] = useState('');
  const [insurancePolicyNo, setInsurancePolicyNo] = useState('');
  const [insurancePolicyDate, setInsurancePolicyDate] = useState('');
  const [insuranceAmount, setInsuranceAmount] = useState('0');
  const [hasMultiInsurance, setHasMultiInsurance] = useState(false);
  const [extraInsurances, setExtraInsurances] = useState<ExtraInsuranceItem[]>([]);

  // Codes, Adjustments, Additional Details, Scan
  const [deliveryModeCode, setDeliveryModeCode] = useState('P');
  const [gstPaidByCode, setGstPaidByCode] = useState('E');
  const [riskTakenBy, setRiskTakenBy] = useState('O');
  const [billAdjustmentDetails, setBillAdjustmentDetails] = useState('');
  const [addlDetailsEnabled, setAddlDetailsEnabled] = useState(false);
  const [cnRemarks, setCnRemarks] = useState('');
  const [scannedLrDataUrl, setScannedLrDataUrl] = useState('');
  const [docketDeliveryMode, setDocketDeliveryMode] = useState<'Door Delivery' | 'Godown Delivery'>('Door Delivery');

  // BAND 1: LORRY HIRE + BROKER + 2-DAY FREE DETENTION + MULTI ADV [Y/N] (4-50 rows)
  const [brokerName, setBrokerName] = useState('');
  const [selectedBrokerId, setSelectedBrokerId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [hireWeightMt, setHireWeightMt] = useState('15');
  const [hireRateMode, setHireRateMode] = useState<string>('Fixed');
  const [hireRatePerUnit, setHireRatePerUnit] = useState('0');
  const [hireAmount, setHireAmount] = useState('0');
  const [detentionFromDate, setDetentionFromDate] = useState('');
  const [detentionToDate, setDetentionToDate] = useState('');
  const [detentionDays, setDetentionDays] = useState('0');
  const [detentionRatePerDay, setDetentionRatePerDay] = useState('1500');
  const [detentionChargeOverride, setDetentionChargeOverride] = useState<string | null>(null);
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
  const [hasMultiAdvance, setHasMultiAdvance] = useState(false);
  const [hireAdvances, setHireAdvances] = useState<LorryAdvanceRow[]>([DEFAULT_ADV_ROW()]);
  const [podReceived, setPodReceived] = useState(false);
  const [podReceiveDate, setPodReceiveDate] = useState('');
  const [podRemarks, setPodRemarks] = useState('');
  const [podAlertActive, setPodAlertActive] = useState(false);

  // BAND 2: STAFF DETAILS + WHEEL RATE MASTER + BANK/UPI EDIT-LOCK MODAL + LIVE CHART
  const [staffName, setStaffName] = useState(() => staffAccounts[0]?.displayName || 'Field Booking Staff');
  const [staffBankAccount, setStaffBankAccount] = useState('');
  const [staffUpiId, setStaffUpiId] = useState('');
  const [bankUpiModalOpen, setBankUpiModalOpen] = useState(false);
  const [bankUpiEditUnlocked, setBankUpiEditUnlocked] = useState(false);
  const [staffEntryType, setStaffEntryType] = useState<'Commission' | 'Advance Taken' | 'Paid'>('Commission');
  const [wheelType, setWheelType] = useState<string>('10-Wheeler');
  const [staffAmount, setStaffAmount] = useState(() => String(DEFAULT_WHEEL_RATES['10-Wheeler']));
  const [challanAmt, setChallanAmt] = useState('0');
  const [travellingAmt, setTravellingAmt] = useState('0');
  const [miscAmt, setMiscAmt] = useState('0');
  const [staffPayMode, setStaffPayMode] = useState('Cash');
  const [staffAdvanceDate, setStaffAdvanceDate] = useState('');
  const [staffMonthlyPaidDate, setStaffMonthlyPaidDate] = useState('');
  const [staffSettledZero, setStaffSettledZero] = useState(false);
  const [staffRemarks, setStaffRemarks] = useState('');
  const [showMultiLogs, setShowMultiLogs] = useState(false);
  const [multiAdvances, setMultiAdvances] = useState<StaffMultiAdvanceLog[]>([]);
  const [multiPaidReturns, setMultiPaidReturns] = useState<StaffMultiPaidReturnLog[]>([]);
  const [multiBalanceDates, setMultiBalanceDates] = useState<StaffMultiBalanceDateLog[]>([]);
  const [wheelRatesModalOpen, setWheelRatesModalOpen] = useState(false);
  const [draftWheelRates, setDraftWheelRates] = useState<Record<string, number>>(() => ({
    ...DEFAULT_WHEEL_RATES,
    ...(company.dropdownMaster?.wheelCommissionRates || {}),
  }));
  const [staffChartFilter, setStaffChartFilter] = useState<'ALL' | 'Commission' | 'Advance Taken' | 'Paid'>('ALL');
  const [staffChartExpanded, setStaffChartExpanded] = useState(true);

  // BAND 3: PAY 1 TO PAY 12 INSTALLMENT TRACKER + ADV EX DATE + TDS + SAVE [Y/N]
  const [payInstallments, setPayInstallments] = useState<PayInstallmentRow[]>(EMPTY_PAY_12);
  const [showAllPay12, setShowAllPay12] = useState(false);
  const [advExDate, setAdvExDate] = useState('');
  const [payTdsOverride, setPayTdsOverride] = useState('');
  const [saveConfirmYN, setSaveConfirmYN] = useState<'Y' | 'N'>('Y');

  // Register & UI State
  const [saving, setSaving] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [registerSearch, setRegisterSearch] = useState('');
  const [registerPage, setRegisterPage] = useState(1);
  const REGISTER_PAGE_SIZE = 50;
  const deferredFindCnQuery = useDeferredValue(findCnQuery);
  const deferredRegisterSearch = useDeferredValue(registerSearch);
  const [viewModalRow, setViewModalRow] = useState<UnifiedRegisterRow | null>(null);
  const draftHydratedRef = useRef(false);

  const ALL_IN_ONE_DRAFT_KEY = 'drc_draft_lr_allinone_v1';

  useEffect(() => {
    let cancelled = false;
    void loadIdbObject<Record<string, unknown>>(ALL_IN_ONE_DRAFT_KEY).then((draft) => {
      draftHydratedRef.current = true;
      if (cancelled || !draft || editingCnId || editingDocketId) return;
      if (draft.divisionMode && draft.divisionMode !== divisionMode) return;
      if (typeof draft.docNo === 'string' && draft.docNo.trim()) {
        setDocNo(draft.docNo);
        docNoDirtyRef.current = true;
      }
      if (typeof draft.docDate === 'string' && draft.docDate) setDocDate(draft.docDate);
      if (typeof draft.billedAtBranch === 'string' && draft.billedAtBranch) setBilledAtBranch(draft.billedAtBranch);
      if (draft.transportMode === 'Road' || draft.transportMode === 'Rail' || draft.transportMode === 'Air') setTransportMode(draft.transportMode);
      if (draft.bookingBasis === 'Party' || draft.bookingBasis === 'Franchise' || draft.bookingBasis === 'Cash') setBookingBasis(draft.bookingBasis);
      if (draft.payBasis === 'TBB' || draft.payBasis === 'Paid' || draft.payBasis === 'To-Pay') setPayBasis(draft.payBasis);
      if (typeof draft.deliverAt === 'string') setDeliverAt(draft.deliverAt);
      if (typeof draft.billingPartyName === 'string') setBillingPartyName(draft.billingPartyName);
      if (typeof draft.consignorName === 'string') setConsignorName(draft.consignorName);
      if (typeof draft.consignorAddress === 'string') setConsignorAddress(draft.consignorAddress);
      if (typeof draft.consignorGstin === 'string') setConsignorGstin(draft.consignorGstin);
      if (typeof draft.consigneeName === 'string') setConsigneeName(draft.consigneeName);
      if (typeof draft.consigneeAddress === 'string') setConsigneeAddress(draft.consigneeAddress);
      if (typeof draft.consigneeGstin === 'string') setConsigneeGstin(draft.consigneeGstin);
      if (typeof draft.fromCity === 'string' && draft.fromCity) setFromCity(draft.fromCity);
      if (typeof draft.toCity === 'string') setToCity(draft.toCity);
      if (typeof draft.truckNo === 'string') setTruckNo(draft.truckNo);
      if (typeof draft.driverName === 'string') setDriverName(draft.driverName);
      if (typeof draft.driverMobile === 'string') setDriverMobile(draft.driverMobile);
      if (typeof draft.packages === 'string') setPackages(draft.packages);
      if (typeof draft.particulars === 'string') setParticulars(draft.particulars);
      if (typeof draft.ewayBillNo === 'string') setEwayBillNo(draft.ewayBillNo);
      if (typeof draft.nettWeight === 'string') setNettWeight(draft.nettWeight);
      if (typeof draft.chargedWeight === 'string') setChargedWeight(draft.chargedWeight);
      if (typeof draft.rateMode === 'string') setRateMode(draft.rateMode);
      if (typeof draft.ratePerUnit === 'string') setRatePerUnit(draft.ratePerUnit);
      if (typeof draft.baseFreight === 'string') setBaseFreight(draft.baseFreight);
      if (typeof draft.otherCharge === 'string') setOtherCharge(draft.otherCharge);
      if (draft.manualFreightOverride === null || typeof draft.manualFreightOverride === 'string') {
        setManualFreightOverride(draft.manualFreightOverride as string | null);
      }
      if (typeof draft.brokerName === 'string') setBrokerName(draft.brokerName);
      if (typeof draft.ownerName === 'string') setOwnerName(draft.ownerName);
      if (typeof draft.hireAmount === 'string') setHireAmount(draft.hireAmount);
      if (typeof draft.hireRatePerUnit === 'string') setHireRatePerUnit(draft.hireRatePerUnit);
      if (typeof draft.cnRemarks === 'string') setCnRemarks(draft.cnRemarks);
      if (draft.consignorName || draft.toCity || draft.truckNo || draft.billingPartyName) {
        setStatusToast('Restored unsaved LR / Bilty draft automatically from offline vault.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editingCnId && !editingDocketId && !docNoDirtyRef.current) {
      setDocNo(nextSuggestedDocNo);
    }
  }, [editingCnId, editingDocketId, nextSuggestedDocNo]);

  useEffect(() => {
    if (!draftHydratedRef.current || editingCnId || editingDocketId) return;
    const hasMeaningfulInput = Boolean(
      billingPartyName.trim() ||
        consignorName.trim() ||
        consigneeName.trim() ||
        toCity.trim() ||
        truckNo.trim() ||
        ewayBillNo.trim() ||
        Number(baseFreight || 0) > 0 ||
        manualFreightOverride !== null
    );
    if (!hasMeaningfulInput) return;
    const timer = window.setTimeout(() => {
      void saveIdbObject(ALL_IN_ONE_DRAFT_KEY, {
        divisionMode,
        docNo,
        docDate,
        billedAtBranch,
        transportMode,
        bookingBasis,
        payBasis,
        deliverAt,
        billingPartyName,
        consignorName,
        consignorAddress,
        consignorGstin,
        consigneeName,
        consigneeAddress,
        consigneeGstin,
        fromCity,
        toCity,
        truckNo,
        driverName,
        driverMobile,
        packages,
        particulars,
        ewayBillNo,
        nettWeight,
        chargedWeight,
        rateMode,
        ratePerUnit,
        baseFreight,
        otherCharge,
        manualFreightOverride,
        brokerName,
        ownerName,
        hireAmount,
        hireRatePerUnit,
        cnRemarks,
        savedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    editingCnId,
    editingDocketId,
    divisionMode,
    docNo,
    docDate,
    billedAtBranch,
    transportMode,
    bookingBasis,
    payBasis,
    deliverAt,
    billingPartyName,
    consignorName,
    consignorAddress,
    consignorGstin,
    consigneeName,
    consigneeAddress,
    consigneeGstin,
    fromCity,
    toCity,
    truckNo,
    driverName,
    driverMobile,
    packages,
    particulars,
    ewayBillNo,
    nettWeight,
    chargedWeight,
    rateMode,
    ratePerUnit,
    baseFreight,
    otherCharge,
    manualFreightOverride,
    brokerName,
    ownerName,
    hireAmount,
    hireRatePerUnit,
    cnRemarks,
  ]);

  // Master Data Lists
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
  const rateModeOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...DEFAULT_RATE_MODES,
          ...getEffectiveDropdownList(company, 'rateModes'),
        ])
      ),
    [company]
  );
  const bodyTypeOptions = useMemo(
    () => getEffectiveDropdownList(company, 'vehicleBodyTypes'),
    [company]
  );
  const paymentModeOptions = useMemo(
    () => getEffectiveDropdownList(company, 'paymentModes'),
    [company]
  );
  const creditDayPresets = useMemo(() => getEffectiveCreditDayPresets(company), [company]);
  const allCities = useMemo(() => {
    const set = new Set<string>([
      'Kolkata',
      'Howrah',
      'Siliguri',
      'Patna',
      'Guwahati',
      'Varanasi',
      'Delhi',
      'Mumbai',
      'Ranchi',
      'Durgapur',
      'Jamshedpur',
    ]);
    ALL_INDIA_STATES_DISTRICTS.forEach((s) => s.districts.forEach((d) => set.add(d.split('(')[0].trim())));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, []);

  const wheelRates = useMemo(
    () => ({ ...DEFAULT_WHEEL_RATES, ...(company.dropdownMaster?.wheelCommissionRates || {}) }),
    [company.dropdownMaster?.wheelCommissionRates]
  );

  useEffect(() => {
    setDraftWheelRates({ ...DEFAULT_WHEEL_RATES, ...(company.dropdownMaster?.wheelCommissionRates || {}) });
  }, [company.dropdownMaster?.wheelCommissionRates]);

  // Sync Staff Bank & UPI on staff change (locked by default)
  useEffect(() => {
    if (bankUpiEditUnlocked || editingStaffId) return;
    const matched = staffAccounts.find(
      (s) => s.displayName.trim().toLowerCase() === staffName.trim().toLowerCase()
    );
    if (matched) {
      setStaffBankAccount(
        matched.bankAccountNo
          ? `${matched.bankName ? `${matched.bankName} ` : ''}${matched.bankAccountNo}${matched.bankIfsc ? ` (${matched.bankIfsc})` : ''}`
          : ''
      );
      setStaffUpiId(matched.upiId || '');
    }
  }, [staffName, staffAccounts, bankUpiEditUnlocked, editingStaffId]);

  // Auto compute detention days when DETN FROM & DETN TO both entered
  useEffect(() => {
    if (detentionFromDate && detentionToDate) {
      setDetentionDays(String(diffDaysInclusive(detentionFromDate, detentionToDate)));
      setDetentionChargeOverride(null);
    }
  }, [detentionFromDate, detentionToDate]);

  // Global 'M' shortcut for Staff Multi-Logs (outside inputs)
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

  // Toggle Multi ADV to auto-expand to 4 rows when turned YES
  const handleToggleMultiAdvance = () => {
    const next = !hasMultiAdvance;
    setHasMultiAdvance(next);
    if (next && hireAdvances.length < 4) {
      setHireAdvances((prev) => {
        const copy = [...prev];
        while (copy.length < 4) copy.push(DEFAULT_ADV_ROW());
        return copy;
      });
    }
  };

  // Total Freight (Unlocked — auto calculates unless manually overridden in Total Freight input)
  const autoComputedCnBaseFreight = useMemo(() => {
    const rate = Number(ratePerUnit || 0);
    const wt = Number(chargedWeight || nettWeight || 0);
    const pkgs = Number(packages || 0);
    const calcBase = computeRateModeAmount({
      rateMode,
      ratePerUnit: rate,
      weightMt: wt,
      packages: pkgs,
    });
    if (calcBase > 0) return calcBase;
    return Math.round(Number(baseFreight || 0) * 100) / 100;
  }, [baseFreight, ratePerUnit, rateMode, chargedWeight, nettWeight, packages]);

  const autoComputedCnFreight = useMemo(() => {
    return Math.round((autoComputedCnBaseFreight + Number(otherCharge || 0)) * 100) / 100;
  }, [autoComputedCnBaseFreight, otherCharge]);

  const computedCnFreight = useMemo(() => {
    if (manualFreightOverride !== null && manualFreightOverride !== '') {
      const n = Number(manualFreightOverride);
      if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
    }
    return autoComputedCnFreight;
  }, [manualFreightOverride, autoComputedCnFreight]);

  // Lorry Hire Calculations (2-day free detention + hybrid override + TDS 194C + Multi Advances + Pay 1-12)
  const autoDetentionCharge = useMemo(() => {
    const days = Number(detentionDays || 0);
    const chargeableDays = Math.max(0, days - 2);
    return Math.round(chargeableDays * Number(detentionRatePerDay || 0) * 100) / 100;
  }, [detentionDays, detentionRatePerDay]);

  const effectiveDetentionCharge = useMemo(() => {
    if (detentionChargeOverride !== null && detentionChargeOverride.trim() !== '') {
      const ov = Number(detentionChargeOverride);
      if (Number.isFinite(ov) && ov >= 0) return Math.round(ov * 100) / 100;
    }
    return autoDetentionCharge;
  }, [detentionChargeOverride, autoDetentionCharge]);

  const effectiveHireGross = useMemo(() => {
    const rate = Number(hireRatePerUnit || 0);
    if (!isLumpSumRateMode(hireRateMode) && rate > 0) {
      return computeRateModeAmount({
        rateMode: hireRateMode,
        ratePerUnit: rate,
        weightMt: Number(hireWeightMt || 0),
        packages: Number(packages || 0),
      });
    }
    const amt = Number(hireAmount || 0);
    if (amt > 0) return Math.round(amt * 100) / 100;
    return Math.round(rate * 100) / 100;
  }, [hireRateMode, hireRatePerUnit, hireWeightMt, hireAmount, packages]);

  const effectiveTdsAmt = useMemo(() => {
    if (payTdsOverride.trim() !== '') {
      const ov = Number(payTdsOverride);
      if (Number.isFinite(ov) && ov >= 0) return Math.round(ov * 100) / 100;
    }
    const pct = Number(tdsRatePct || 0);
    if (pct <= 0) return 0;
    return Math.round(((effectiveHireGross * pct) / 100) * 100) / 100;
  }, [effectiveHireGross, tdsRatePct, payTdsOverride]);

  const totalMultiAdvancePaid = useMemo(
    () => Math.round(hireAdvances.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100,
    [hireAdvances]
  );

  const totalPay1To12Paid = useMemo(
    () => Math.round(payInstallments.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100,
    [payInstallments]
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

  const netPaymentDueAfterPay12 = useMemo(
    () => Math.max(0, Math.round((hireNetSummary.balancePayable - totalPay1To12Paid) * 100) / 100),
    [hireNetSummary.balancePayable, totalPay1To12Paid]
  );

  // POD Shortage/Breakage/Leakage Red Alert check
  useEffect(() => {
    const hasDeduction = Number(hireShortageCharge || 0) > 0 || Number(hireDamageCharge || 0) > 0;
    const hasKeyword = /(short|damage|break|leak|wet|broken)/i.test(podRemarks || '');
    const active = hasDeduction || hasKeyword;
    if (active && !podAlertActive) {
      playAlertBeep();
    }
    setPodAlertActive(active);
  }, [hireShortageCharge, hireDamageCharge, podRemarks, podAlertActive]);

  // Autofill Driver/Owner when Vehicle selected
  const handleSelectVehicle = (v: {
    truckNo: string;
    ownerName?: string;
    vehicleMake?: string;
    bodyType?: string;
    vehicleColor?: string;
    id: string;
  }) => {
    setTruckNo(v.truckNo);
    setSelectedVehicleId(v.id);
    if (v.ownerName) setOwnerName(v.ownerName);
    if (v.vehicleMake) setVehicleMake(v.vehicleMake);
    if (v.bodyType) setBodyType(v.bodyType);
    if (v.vehicleColor) setVehicleColor(v.vehicleColor);

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

  const resetFormToBlank = useCallback(() => {
    setEditingCnId(null);
    setEditingDocketId(null);
    setEditingHireId(null);
    setEditingStaffId(null);
    const prefix = isFtl ? 'KOL' : divisionMeta.docPrefix;
    docNoDirtyRef.current = false;
    setBranchShort(prefix);
    setRefCnNo('');
    setDocNo(nextSuggestedDocNo);
    setDocDate(todayISO());
    setBillingPartyName('');
    setSelectedBillingPartyId('');
    setConsignorName('');
    setSelectedConsignorId('');
    setConsignorAddress('');
    setConsignorGstin('');
    setConsignorHsn('');
    setConsigneeName('');
    setSelectedConsigneeId('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setConsigneeHsn('');
    setDeliverAt('');
    setIsChallanAttached(false);
    setToCity('');
    setTruckNo('');
    setSelectedVehicleId('');
    setExtraVehicles([]);
    setHasMultiVehicle(false);
    setDriverName('');
    setSelectedDriverId('');
    setDriverDlNo('');
    setDriverDlExpiry('');
    setDriverMobile('');
    setHasMultiGoods(false);
    setMultiGoodsItems([]);
    setTaxInvNo('');
    setTaxInvDate('');
    setValueOfGoods('0');
    setHasMultiTaxInv(false);
    setExtraTaxInvoices([]);
    setEwayBillNo('');
    setEwayBillDate('');
    setEwayBillValidUpto('');
    setEwayPlace('');
    setEwayPinCode('');
    setDeliverAt('');
    setDeliverAtPinCode('');
    setDeliverAtCountry('India');
    setConsignorPinCode('');
    setConsignorCountry('India');
    setConsigneePinCode('');
    setConsigneeCountry('India');
    setFromPinCode('700001');
    setFromCountry('India');
    setToCity('');
    setToPinCode('');
    setToCountry('India');
    setHasMultiEwb(false);
    setExtraEwayBills([]);
    setEwbExtensions([]);
    setHasMultiWeight(false);
    setMultiWeights([]);
    setBaseFreight('0');
    setRatePerUnit('0');
    setOtherCharge('0');
    setManualFreightOverride(null);
    setShowFreightOnPrint(true);
    setInsuranceCo('');
    setInsurancePolicyNo('');
    setInsurancePolicyDate('');
    setInsuranceAmount('0');
    setHasMultiInsurance(false);
    setExtraInsurances([]);
    setBillAdjustmentDetails('');
    setAddlDetailsEnabled(false);
    setCnRemarks('');
    setScannedLrDataUrl('');
    setBrokerName('');
    setSelectedBrokerId('');
    setOwnerName('');
    setSelectedOwnerId('');
    setHireAmount('0');
    setHireRatePerUnit('0');
    setDetentionFromDate('');
    setDetentionToDate('');
    setDetentionDays('0');
    setDetentionChargeOverride(null);
    setHasMultiAdvance(false);
    setHireAdvances([DEFAULT_ADV_ROW()]);
    setPayInstallments(EMPTY_PAY_12());
    setAdvExDate('');
    setPayTdsOverride('');
    setPodReceived(false);
    setPodRemarks('');
    setChallanAmt('0');
    setTravellingAmt('0');
    setMiscAmt('0');
    setStaffAdvanceDate('');
    setStaffMonthlyPaidDate('');
    setStaffSettledZero(false);
    setStaffRemarks('');
    setMultiAdvances([]);
    setMultiPaidReturns([]);
    setMultiBalanceDates([]);
    setReceiptChallanNo('');
    setReceiptChallanDate('');
    setHireRemarks('');
    void deleteIdbObject('drc_draft_lr_allinone_v1');
  }, [isFtl, divisionMeta.docPrefix, nextSuggestedDocNo]);

  const buildCurrentCnSnapshot = useCallback((): ConsignmentNote => {
    const cnTruckValue = hasVehicleNo ? truckNo.trim() || 'UNASSIGNED' : 'UNASSIGNED';
    const gstPaidLabel = GST_PAID_BY_CODES.find((c) => c.code === gstPaidByCode)?.mapped || 'Consignee';
    return {
      id: editingCnId || 'preview_cn',
      cnNo: docNo.trim() || 'DRAFT',
      cnDate: docDate,
      financialYear: normalizeFyLabel(activeFy),
      division: 'FTL',
      branchShort: branchShort.trim(),
      lastCnNo: computedLastCnNo,
      refCnNo: refCnNo.trim(),
      transportMode,
      bookingBasis,
      payBasis,
      billedAtBranch,
      hasVehicleNo,
      hasMultiVehicle,
      billingPartyName: billingPartyName.trim() || consignorName.trim(),
      creditDays: Number(creditDays || 15),
      consignorName: consignorName.trim() || 'Consignor',
      consignorAddress: consignorAddress.trim(),
      consignorPinCode: consignorPinCode.trim(),
      consignorCountry,
      consignorGstin: consignorGstin.trim().toUpperCase(),
      consignorHsn: consignorHsn.trim(),
      consigneeName: consigneeName.trim() || consignorName.trim() || 'Consignee',
      consigneeAddress: consigneeAddress.trim(),
      consigneePinCode: consigneePinCode.trim(),
      consigneeCountry,
      consigneeGstin: consigneeGstin.trim().toUpperCase(),
      consigneeHsn: consigneeHsn.trim(),
      deliverAt: deliverAt.trim(),
      deliverAtPinCode: deliverAtPinCode.trim(),
      deliverAtCountry,
      isChallanAttached,
      packages: packages.trim(),
      packageMode,
      particulars: particulars.trim(),
      multiGoodsItems: (hasMultiGoods ? multiGoodsItems : []).slice(0, 50),
      rateMode,
      ratePerUnit: Number(ratePerUnit || 0),
      nettWeight: Number(nettWeight || 0),
      grossWeight: Number(grossWeight || 0),
      chargedWeight: Number(chargedWeight || 0),
      multiWeights: (hasMultiWeight ? multiWeights : []).slice(0, 50),
      otherCharge: Number(otherCharge || 0),
      totalFreight: computedCnFreight,
      showFreightOnPrint,
      taxInvNo: taxInvNo.trim(),
      taxInvDate: taxInvDate.trim(),
      hasTaxInvoice: hasMultiTaxInv || Boolean(taxInvNo.trim()),
      extraTaxInvoices: (hasMultiTaxInv ? extraTaxInvoices : []).slice(0, 50),
      ewayBillNo: ewayBillNo.trim(),
      ewayBillDate: ewayBillDate.trim(),
      ewayBillValidUpto: ewayBillValidUpto.trim(),
      ewayPlace: ewayPlace.trim(),
      ewayPinCode: ewayPinCode.trim(),
      hasMultiEwayBill: hasMultiEwb,
      extraEwayBills: (hasMultiEwb ? extraEwayBills : []).slice(0, 50),
      ewbExtensions: ewbExtensions.slice(0, 10),
      valueOfGoods: Number(valueOfGoods || 0),
      truckNo: cnTruckValue,
      extraVehicles: (hasMultiVehicle ? extraVehicles : []).slice(0, 50),
      fromCity: fromCity.trim() || 'Kolkata',
      fromPinCode: fromPinCode.trim(),
      fromCountry,
      toCity: toCity.trim() || 'Destination',
      toPinCode: toPinCode.trim(),
      toCountry,
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
      insuranceCo: insuranceCo.trim(),
      insurancePolicyNo: insurancePolicyNo.trim(),
      insurancePolicyDate: insurancePolicyDate.trim(),
      insuranceAmount: Number(insuranceAmount || 0),
      extraInsurances: (hasMultiInsurance ? extraInsurances : []).slice(0, 50),
      billAdjustmentDetails: billAdjustmentDetails.trim(),
      addlDetailsEnabled,
      remarks: cnRemarks.trim(),
      scannedLrDataUrl: scannedLrDataUrl || undefined,
      billed: false,
      branchCode: activeBranchCode,
      createdByStaff: activeStaffCode,
      ownerUid,
    };
  }, [
    editingCnId,
    docNo,
    docDate,
    activeFy,
    branchShort,
    computedLastCnNo,
    refCnNo,
    transportMode,
    bookingBasis,
    payBasis,
    billedAtBranch,
    hasVehicleNo,
    hasMultiVehicle,
    billingPartyName,
    consignorName,
    creditDays,
    consignorAddress,
    consignorGstin,
    consignorHsn,
    consigneeName,
    consigneeAddress,
    consigneeGstin,
    consigneeHsn,
    deliverAt,
    isChallanAttached,
    packages,
    packageMode,
    particulars,
    hasMultiGoods,
    multiGoodsItems,
    rateMode,
    ratePerUnit,
    nettWeight,
    grossWeight,
    chargedWeight,
    hasMultiWeight,
    multiWeights,
    otherCharge,
    computedCnFreight,
    showFreightOnPrint,
    taxInvNo,
    taxInvDate,
    hasMultiTaxInv,
    extraTaxInvoices,
    ewayBillNo,
    ewayBillDate,
    ewayBillValidUpto,
    hasMultiEwb,
    extraEwayBills,
    ewbExtensions,
    valueOfGoods,
    truckNo,
    extraVehicles,
    fromCity,
    toCity,
    ownerName,
    brokerName,
    driverName,
    driverDlNo,
    driverDlExpiry,
    driverMobile,
    deliveryModeCode,
    gstPaidByCode,
    riskTakenBy,
    insuranceCo,
    insurancePolicyNo,
    insurancePolicyDate,
    insuranceAmount,
    hasMultiInsurance,
    extraInsurances,
    billAdjustmentDetails,
    addlDetailsEnabled,
    cnRemarks,
    scannedLrDataUrl,
    activeBranchCode,
    activeStaffCode,
    ownerUid,
  ]);

  const handleSaveWheelRates = async () => {
    await upsertDocument(
      'settings',
      'company',
      {
        dropdownMaster: {
          ...(company.dropdownMaster || {}),
          wheelCommissionRates: draftWheelRates,
        },
      },
      false
    );
    if (draftWheelRates[wheelType] !== undefined && staffEntryType === 'Commission') {
      setStaffAmount(String(draftWheelRates[wheelType]));
    }
    setWheelRatesModalOpen(false);
    playVerifiedBeep();
    setStatusToast('Wheel Commission Rate Master saved & synced to cloud.');
  };

  const handleSaveCompleteSheet = useCallback(
    async (afterAction: 'exit' | 'pdf' | 'stay') => {
      if (readOnly) {
        setStatusToast('View-Only permission: saving is restricted.');
        return;
      }
      if (saveConfirmYN !== 'Y') {
        setStatusToast('SAVE switch is set to [N]. Flip SAVE [Y / N] to Y to save changes.');
        playAlertBeep();
        return;
      }
      if (!docNo.trim() || !consignorName.trim() || !fromCity.trim() || !toCity.trim()) {
        setStatusToast('Please fill C/N or Docket No, Consignor, From City, and To City.');
        playAlertBeep();
        return;
      }
      if (includeHireSection && receiptChallanNo.trim() && !receiptChallanDate.trim()) {
        setStatusToast('Receipt Challan Date is mandatory when Receipt Challan No is entered.');
        playAlertBeep();
        return;
      }
      if (consignorGstin.trim()) {
        const res = validateIndianGstin(consignorGstin);
        if (!res.valid) {
          setStatusToast(`Consignor GSTIN Invalid: ${res.error}`);
          playAlertBeep();
          return;
        }
      }
      if (consigneeGstin.trim()) {
        const res = validateIndianGstin(consigneeGstin);
        if (!res.valid) {
          setStatusToast(`Consignee GSTIN Invalid: ${res.error}`);
          playAlertBeep();
          return;
        }
      }

      setSaving(true);
      setStatusToast(null);
      try {
        const fyNorm = normalizeFyLabel(activeFy);
        const cnTruckValue = hasVehicleNo ? truckNo.trim() || 'UNASSIGNED' : 'UNASSIGNED';

        let savedCnObj: ConsignmentNote | null = null;
        let savedDocketObj: LogisticsDocket | null = null;

        // 1. Save CN/LR (FTL) or Logistics Docket (LOGISTICS / PTL / COURIER) — NO Invoice auto-creation
        if (isFtl) {
          const cnId = editingCnId || makeSafeDocId('cn');
          const snap = buildCurrentCnSnapshot();
          const existingCn = editingCnId ? consignments.find((c) => c.id === editingCnId) : undefined;
          const cnPayload: Record<string, unknown> = {
            ...snap,
            billed: existingCn?.billed || false,
            invoiceId: existingCn?.invoiceId || '',
            scannedLrDataUrl: snap.scannedLrDataUrl || '',
          };
          delete cnPayload.id;
          await upsertDocument('consignments', cnId, cnPayload, !editingCnId);
          savedCnObj = { ...snap, id: cnId, billed: existingCn?.billed || false, invoiceId: existingCn?.invoiceId || '' };
        } else {
          const docketId = editingDocketId || makeSafeDocId(`${divisionMeta.idPrefix}dkt`);
          const existingDk = editingDocketId
            ? logisticsDockets.find((d) => d.id === editingDocketId)
            : undefined;
          const docketPayload: Omit<LogisticsDocket, 'id' | 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
            docketNo: docNo.trim(),
            docketDate: docDate,
            financialYear: fyNorm,
            billedAtBranch,
            originBranch: fromCity.trim() || billedAtBranch,
            originPinCode: fromPinCode.trim(),
            originCountry: fromCountry,
            destBranch: toCity.trim() || billedAtBranch,
            destPinCode: toPinCode.trim(),
            destCountry: toCountry,
            deliveryMode: docketDeliveryMode,
            payMode: payBasis,
            consignorName: consignorName.trim(),
            consignorAddress: consignorAddress.trim(),
            consignorPinCode: consignorPinCode.trim(),
            consignorCountry,
            consignorGstin: consignorGstin.trim().toUpperCase(),
            consigneeName: consigneeName.trim() || consignorName.trim(),
            consigneeAddress: consigneeAddress.trim(),
            consigneePinCode: consigneePinCode.trim(),
            consigneeCountry,
            consigneeGstin: consigneeGstin.trim().toUpperCase(),
            billingPartyName: billingPartyName.trim() || consignorName.trim(),
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
            gstRate: 0,
            cgstAmt: 0,
            sgstAmt: 0,
            igstAmt: 0,
            reverseCharge: gstPaidByCode !== 'T',
            totalAmount: computedCnFreight,
            ewayBillNo: ewayBillNo.trim(),
            ewayBillValidUpto: ewayBillValidUpto.trim(),
            ewayPlace: ewayPlace.trim(),
            ewayPinCode: ewayPinCode.trim(),
            valueOfGoods: Number(valueOfGoods || 0),
            stockStage: podReceived ? 'Delivered' : 'Origin Godown',
            billed: existingDk?.billed || false,
            invoiceId: existingDk?.invoiceId || '',
            remarks: cnRemarks.trim(),
            branchCode: activeBranchCode,
            createdByStaff: activeStaffCode,
            ownerUid,
          };
          await upsertDocument('logistics_dockets', docketId, docketPayload, !editingDocketId);
          savedDocketObj = { id: docketId, ...docketPayload };
        }

        // 2. Save Band 1 + Band 3 (Lorry Hire, Multi-Advance, Pay 1-12 Installments)
        if (includeHireSection && (effectiveHireGross > 0 || totalMultiAdvancePaid > 0 || totalPay1To12Paid > 0)) {
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
          const activePay12 = payInstallments
            .filter((p) => Number(p.amount || 0) > 0 || p.date || p.refNo)
            .map((p) => ({
              slot: p.slot,
              date: p.date || '',
              refNo: p.refNo || '',
              amount: Number(p.amount || 0),
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
            fromPinCode: fromPinCode.trim(),
            fromCountry,
            toCity: toCity.trim(),
            toPinCode: toPinCode.trim(),
            toCountry,
            weightMt: Number(hireWeightMt || nettWeight || 0),
            ratePerUnit: Number(hireRatePerUnit || 0),
            rateMode: hireRateMode,
            hasMultiAdvance: hasMultiAdvance || cappedAdvs.length > 1,
            advances: cappedAdvs,
            hireAmount: effectiveHireGross,
            advancePaid: totalMultiAdvancePaid,
            extraAdvanceAmt: Number(extraAdvanceAmt || 0),
            loadingCharge: Number(hireLoadingCharge || 0),
            unloadingCharge: Number(hireUnloadingCharge || 0),
            parkingCharge: Number(hireParkingCharge || 0),
            kataCharge: Number(hireKataCharge || 0),
            detentionFromDate: detentionFromDate || '',
            detentionToDate: detentionToDate || '',
            detentionDays: Number(detentionDays || 0),
            detentionCharge: effectiveDetentionCharge,
            shortageCharge: Number(hireShortageCharge || 0),
            damageCharge: Number(hireDamageCharge || 0),
            tdsRatePct: Number(tdsRatePct || 0),
            tdsAmount: effectiveTdsAmt,
            receiptChallanNo: receiptChallanNo.trim(),
            receiptChallanDate: receiptChallanDate || '',
            payInstallments: activePay12,
            paymentDueAmt: netPaymentDueAfterPay12,
            advExDate: advExDate || '',
            payTdsAmt: effectiveTdsAmt,
            balancePayable: netPaymentDueAfterPay12,
            balancePaidAmt: totalPay1To12Paid,
            podReceived,
            podReceiveDate: podReceived ? podReceiveDate || todayISO() : '',
            podRemarks: podRemarks.trim(),
            balancePaid: netPaymentDueAfterPay12 <= 0 && effectiveHireGross > 0,
            remarks: hireRemarks.trim(),
            branchCode: activeBranchCode,
            createdByStaff: activeStaffCode,
            ownerUid,
          };
          await upsertDocument('lorry_hires', lhId, lhPayload, !editingHireId);
        }

        // 3. Save Band 2 (Staff Details)
        if (
          includeStaffSection &&
          staffName.trim() &&
          (Number(staffAmount || 0) > 0 || Number(challanAmt || 0) > 0 || Number(travellingAmt || 0) > 0 || Number(miscAmt || 0) > 0)
        ) {
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
            challanAmt: Number(challanAmt || 0),
            travellingAmt: Number(travellingAmt || 0),
            miscAmt: Number(miscAmt || 0),
            amount: Number(staffAmount || 0),
            paymentMode: staffPayMode,
            advanceDate: staffAdvanceDate || '',
            monthlyPaidDate: staffMonthlyPaidDate || '',
            settledZeroFlag: Boolean(staffSettledZero || staffMonthlyPaidDate),
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
          action: editingCnId || editingDocketId ? 'Updated Bilty & Lorry Sheet' : 'Saved Bilty & Lorry Sheet',
          module: `Bilty Master (${divisionMode})`,
          docRefCode: docNo.trim(),
          summary: `${docNo.trim()} · ${consignorName.trim()} → ${toCity.trim()} · ${showFreightOnPrint ? `Freight ₹${formatINR(computedCnFreight)}` : 'As Agreed'}`,
          staffCode: activeStaffCode,
          staffName: activeStaffName,
          branchCode: activeBranchCode,
          ownerUid,
        });

        await deleteIdbObject('drc_draft_lr_allinone_v1');
        playVerifiedBeep();

        if (afterAction === 'pdf') {
          if (savedCnObj) {
            const pdf = await generateLR3CopyPDF(savedCnObj, company, 'l');
            onPreviewPdf(pdf, 'LR Copy');
          } else if (savedDocketObj) {
            const pdf = await generateLogisticsDocketPDF(savedDocketObj, company, 'l');
            onPreviewPdf(pdf, 'Docket_LR');
          }
          resetFormToBlank();
          setStatusToast('Bilty & Lorry Master Sheet saved & LR PDF opened.');
        } else if (afterAction === 'stay') {
          setStatusToast(`Saved ${docNo.trim()} & linked Lorry Hire / Staff records cleanly.`);
        } else {
          resetFormToBlank();
          onExitToDashboard();
        }
      } finally {
        setSaving(false);
      }
    },
    [
      readOnly,
      saveConfirmYN,
      docNo,
      consignorName,
      fromCity,
      toCity,
      activeFy,
      hasVehicleNo,
      truckNo,
      isFtl,
      editingCnId,
      buildCurrentCnSnapshot,
      consignments,
      editingDocketId,
      divisionMeta.idPrefix,
      logisticsDockets,
      docDate,
      billedAtBranch,
      docketDeliveryMode,
      payBasis,
      consignorAddress,
      consignorGstin,
      consigneeName,
      consigneeAddress,
      consigneeGstin,
      billingPartyName,
      packages,
      packageMode,
      particulars,
      nettWeight,
      chargedWeight,
      rateMode,
      ratePerUnit,
      baseFreight,
      computedCnFreight,
      otherCharge,
      gstPaidByCode,
      ewayBillNo,
      ewayBillValidUpto,
      valueOfGoods,
      podReceived,
      cnRemarks,
      activeBranchCode,
      activeStaffCode,
      ownerUid,
      includeHireSection,
      effectiveHireGross,
      totalMultiAdvancePaid,
      totalPay1To12Paid,
      editingHireId,
      hireAdvances,
      payInstallments,
      divisionMode,
      ownerName,
      brokerName,
      hireWeightMt,
      hireRatePerUnit,
      hireRateMode,
      hasMultiAdvance,
      extraAdvanceAmt,
      hireLoadingCharge,
      hireUnloadingCharge,
      hireParkingCharge,
      hireKataCharge,
      detentionFromDate,
      detentionToDate,
      detentionDays,
      effectiveDetentionCharge,
      hireShortageCharge,
      hireDamageCharge,
      tdsRatePct,
      effectiveTdsAmt,
      receiptChallanNo,
      receiptChallanDate,
      netPaymentDueAfterPay12,
      advExDate,
      podReceiveDate,
      podRemarks,
      hireRemarks,
      includeStaffSection,
      staffName,
      staffAmount,
      challanAmt,
      travellingAmt,
      miscAmt,
      editingStaffId,
      staffBankAccount,
      staffUpiId,
      wheelType,
      staffEntryType,
      wheelRates,
      staffPayMode,
      staffAdvanceDate,
      staffMonthlyPaidDate,
      staffSettledZero,
      staffRemarks,
      multiAdvances,
      multiPaidReturns,
      multiBalanceDates,
      activeStaffName,
      showFreightOnPrint,
      company,
      onPreviewPdf,
      resetFormToBlank,
      onExitToDashboard,
    ]
  );

  // Connect slim header "Save" button via custom event
  useEffect(() => {
    const handler = () => {
      void handleSaveCompleteSheet('stay');
    };
    window.addEventListener('drc:form-save', handler);
    return () => window.removeEventListener('drc:form-save', handler);
  }, [handleSaveCompleteSheet]);

  const buildCurrentDocketMock = (): LogisticsDocket => ({
    id: editingDocketId || 'preview_dkt',
    docketNo: docNo.trim() || 'DRAFT',
    docketDate: docDate,
    financialYear: normalizeFyLabel(activeFy),
    billedAtBranch,
    originBranch: fromCity.trim() || billedAtBranch,
    destBranch: toCity.trim() || billedAtBranch,
    deliveryMode: docketDeliveryMode,
    payMode: payBasis,
    consignorName: consignorName.trim() || 'Consignor',
    consignorAddress,
    consignorGstin,
    consigneeName: consigneeName.trim() || 'Consignee',
    consigneeAddress,
    consigneeGstin,
    billingPartyName: billingPartyName.trim() || consignorName.trim(),
    packages: Number(packages || 1),
    packingType: packageMode,
    goodsDesc: particulars,
    actualWeightKg: Number(nettWeight || 0),
    chargedWeightKg: Number(chargedWeight || nettWeight || 0),
    rateBasis: 'Fixed',
    ratePerUnit: Number(ratePerUnit || 0),
    baseFreight: computedCnFreight,
    gstRate: 0,
    cgstAmt: 0,
    sgstAmt: 0,
    igstAmt: 0,
    totalAmount: computedCnFreight,
    stockStage: 'Origin Godown',
    billed: false,
    ownerUid,
  });

  // Inline LR Quick Actions
  const handleInlineLrPdf = async (action: 'preview' | 'print') => {
    if (isFtl) {
      const snap = buildCurrentCnSnapshot();
      const pdf = await generateLR3CopyPDF(snap, company, 'l');
      if (action === 'print') printPdfDirect(pdf);
      else onPreviewPdf(pdf, 'LR Copy');
    } else {
      const pdf = await generateLogisticsDocketPDF(buildCurrentDocketMock(), company, 'l');
      if (action === 'print') printPdfDirect(pdf);
      else onPreviewPdf(pdf, 'Docket_LR');
    }
  };

  const handleScanPhysicalLr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const uploadCheck = validateSafeUploadFile(file, 'media_docs');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setStatusToast(uploadCheck.reason || 'Unsupported scan file blocked by DRC Security.');
      e.target.value = '';
      return;
    }
    try {
      const res = await compressComplianceFileToDataUrl(file);
      setScannedLrDataUrl(res.dataUrl);
      setStatusToast(`Scanned Physical LR / POD compressed (${res.sizeKB} KB) & attached to CN.`);
      playVerifiedBeep();
    } catch {
      setStatusToast('Could not read scanned file.');
    } finally {
      e.target.value = '';
    }
  };

  const findPartyContact = useCallback(
    (partyLabel: string) => {
      const key = (partyLabel || '').trim().toLowerCase();
      if (!key) return undefined;
      return combinedParties.find((p) => (p.name || '').trim().toLowerCase() === key);
    },
    [combinedParties]
  );

  const handleShareLr = async (channel: 'whatsapp' | 'email') => {
    const targetPartyName = billingPartyName.trim() || consignorName.trim() || consigneeName.trim();
    const partyRec = findPartyContact(targetPartyName);
    const pdf = isFtl
      ? await generateLR3CopyPDF(buildCurrentCnSnapshot(), company, 'l')
      : await generateLogisticsDocketPDF(buildCurrentDocketMock(), company, 'l');
    const res = await sharePdfDirect({
      pdf,
      channel,
      phone: partyRec?.phone,
      email: partyRec?.email,
      partyName: targetPartyName,
      docNo: docNo.trim() || 'DRAFT',
      docLabel: isFtl ? 'LR' : divisionMeta.shortLabel,
      company,
    });
    setStatusToast(res.message);
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
            showFreightOnPrint: cn.showFreightOnPrint !== false,
            hireGross: Number(lh?.hireAmount || 0),
            hireBalance: Number(lh?.balancePayable || 0),
            podReceived: Boolean(lh?.podReceived),
            staffName: sc?.staffName || '-',
            staffAmount: Number(sc?.amount || 0),
            staffSettledZero: Boolean(sc?.settledZeroFlag || sc?.monthlyPaidDate),
            billNo: inv?.invoiceNo || (cn.billed ? 'Billed' : 'Pending Billing Tab'),
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
          showFreightOnPrint: true,
          hireGross: Number(lh?.hireAmount || 0),
          hireBalance: Number(lh?.balancePayable || 0),
          podReceived: Boolean(lh?.podReceived || dk.stockStage === 'Delivered'),
          staffName: sc?.staffName || '-',
          staffAmount: Number(sc?.amount || 0),
          staffSettledZero: Boolean(sc?.settledZeroFlag || sc?.monthlyPaidDate),
          billNo: inv?.docNo || (dk.billed ? 'Billed' : 'Pending Billing Tab'),
          billTotal: Number(inv?.grandTotal || 0),
          billBalance: invBal,
          docketRecord: dk,
          lorryHireRecord: lh,
          staffRecord: sc,
          logiInvoiceRecord: inv,
        };
      });
  }, [isFtl, consignments, logisticsDockets, lorryHires, staffCommissions, invoices, logisticsInvoices]);

  const findCnMatches = useMemo(() => {
    const q = deferredFindCnQuery.trim().toLowerCase();
    if (!q) return registerRows.slice(0, 12);
    return registerRows
      .filter((r) =>
        `${r.docNo} ${r.truckNo} ${r.consignorName} ${r.consigneeName} ${r.route}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 15);
  }, [registerRows, deferredFindCnQuery]);

  const filteredRegisterRows = useMemo(() => {
    const q = deferredRegisterSearch.trim().toLowerCase();
    if (!q) return registerRows;
    return registerRows.filter((r) =>
      `${r.docNo} ${r.branch} ${r.consignorName} ${r.consigneeName} ${r.billingPartyName} ${r.truckNo} ${r.billNo} ${r.route}`
        .toLowerCase()
        .includes(q)
    );
  }, [registerRows, deferredRegisterSearch]);

  useEffect(() => {
    setRegisterPage(1);
  }, [deferredRegisterSearch, divisionMode]);

  const registerTotalPages = Math.max(1, Math.ceil(filteredRegisterRows.length / REGISTER_PAGE_SIZE));
  const safeRegisterPage = Math.min(registerPage, registerTotalPages);
  const paginatedRegisterRows = useMemo(() => {
    const start = (safeRegisterPage - 1) * REGISTER_PAGE_SIZE;
    return filteredRegisterRows.slice(start, start + REGISTER_PAGE_SIZE);
  }, [filteredRegisterRows, safeRegisterPage]);

  // Band 2 Live Staff Chart Metrics (Date-Wise + Monthly + Yearly FY)
  const staffChartStats = useMemo(() => {
    const activeMonth = (docDate || todayISO()).slice(0, 7);
    const activeDay = docDate || todayISO();
    const list = staffCommissions.filter(
      (s) =>
        (!s.financialYear || normalizeFyLabel(s.financialYear) === normalizeFyLabel(activeFy)) &&
        (staffChartFilter === 'ALL' ? true : s.entryType === staffChartFilter)
    );
    const sumRow = (s: StaffCommissionEntry) =>
      Number(s.amount || 0) + Number(s.challanAmt || 0) + Number(s.travellingAmt || 0) + Number(s.miscAmt || 0);

    const dayTotal = list.filter((s) => s.entryDate === activeDay).reduce((acc, s) => acc + sumRow(s), 0);
    const monthTotal = list.filter((s) => (s.entryDate || '').startsWith(activeMonth)).reduce((acc, s) => acc + sumRow(s), 0);
    const fyTotal = list.reduce((acc, s) => acc + sumRow(s), 0);

    return {
      rows: [...list].sort((a, b) => (b.entryDate || '').localeCompare(a.entryDate || '')),
      dayTotal,
      monthTotal,
      fyTotal,
      activeDay,
      activeMonth,
    };
  }, [staffCommissions, activeFy, staffChartFilter, docDate]);

  const buildStaffChartPdf = async (): Promise<GeneratedPdfResult> => {
    return generateFoxproStatementPDF(
      {
        title: `STAFF DETAILS & COMMISSION CHART (${staffChartFilter})`,
        subtitle: `FY: ${activeFy}  |  Day (${formatDateDDMMYYYY(staffChartStats.activeDay)}): Rs. ${formatINR(staffChartStats.dayTotal)}  |  Month: Rs. ${formatINR(staffChartStats.monthTotal)}`,
        fileName: `Staff_Chart_${activeFy.replace(/\s+/g, '_')}.pdf`,
        orientation: 'l',
        summaryLines: [
          { label: 'Date-Wise Total', value: `Rs. ${formatINR(staffChartStats.dayTotal)}` },
          { label: 'Monthly Total', value: `Rs. ${formatINR(staffChartStats.monthTotal)}` },
          { label: 'Yearly FY Total', value: `Rs. ${formatINR(staffChartStats.fyTotal)}` },
        ],
        columns: [
          { label: 'DATE', widthPct: 10 },
          { label: 'STAFF NAME', widthPct: 18 },
          { label: 'CHALLAN / TRUCK', widthPct: 15 },
          { label: 'TYPE / WHEELS', widthPct: 16 },
          { label: 'RUPEES', widthPct: 10, align: 'right' },
          { label: 'CHAL+TRV+MISC', widthPct: 15, align: 'right' },
          { label: 'PAID STAMP', widthPct: 16 },
        ],
        rows: staffChartStats.rows.slice(0, 150).map((s) => {
          const extras = Number(s.challanAmt || 0) + Number(s.travellingAmt || 0) + Number(s.miscAmt || 0);
          const paidTag = s.settledZeroFlag || s.monthlyPaidDate ? `PAID (${s.monthlyPaidDate || 'Zero Due'})` : 'OPEN';
          return {
            line1: [
              formatDateDDMMYYYY(s.entryDate),
              s.staffName,
              `${s.challanNo || '-'} / ${s.truckNo || '-'}`,
              `${s.entryType} (${s.wheelType})`,
              formatINR(s.amount),
              formatINR(extras),
              paidTag,
            ],
          };
        }),
        totalsLabel: 'YEARLY FY TOTAL :',
        totalsLine1: ['', '', '', '', formatINR(staffChartStats.fyTotal), '', ''],
        totalAmountForWords: staffChartStats.fyTotal,
      },
      company
    );
  };

  const loadRowForEdit = (row: UnifiedRegisterRow) => {
    resetFormToBlank();
    if (row.cnRecord) {
      const cn = row.cnRecord;
      setEditingCnId(cn.id);
      setBranchShort(cn.branchShort || 'KOL');
      setRefCnNo(cn.refCnNo || '');
      setDocNo(cn.cnNo);
      setDocDate(cn.cnDate);
      setBilledAtBranch(cn.billedAtBranch || 'Kolkata');
      setTransportMode((cn.transportMode as 'Road' | 'Rail' | 'Air') || 'Road');
      setBookingBasis((cn.bookingBasis as 'Party' | 'Franchise' | 'Cash') || 'Party');
      setPayBasis((cn.payBasis as 'TBB' | 'Paid' | 'To-Pay') || 'TBB');
      setDeliverAt(cn.deliverAt || '');
      setDeliverAtPinCode(cn.deliverAtPinCode || '');
      setDeliverAtCountry((cn.deliverAtCountry as SupportedCountry) || 'India');
      setIsChallanAttached(Boolean(cn.isChallanAttached));
      setCreditDays(cn.creditDays || 15);
      setBillingPartyName(cn.billingPartyName || '');
      setConsignorName(cn.consignorName);
      setConsignorAddress(cn.consignorAddress || '');
      setConsignorPinCode(cn.consignorPinCode || '');
      setConsignorCountry((cn.consignorCountry as SupportedCountry) || 'India');
      setConsignorGstin(cn.consignorGstin || '');
      setConsignorHsn(cn.consignorHsn || '');
      setConsigneeName(cn.consigneeName);
      setConsigneeAddress(cn.consigneeAddress || '');
      setConsigneePinCode(cn.consigneePinCode || '');
      setConsigneeCountry((cn.consigneeCountry as SupportedCountry) || 'India');
      setConsigneeGstin(cn.consigneeGstin || '');
      setConsigneeHsn(cn.consigneeHsn || '');
      setFromCity(cn.fromCity);
      setFromPinCode(cn.fromPinCode || '');
      setFromCountry((cn.fromCountry as SupportedCountry) || 'India');
      setToCity(cn.toCity);
      setToPinCode(cn.toPinCode || '');
      setToCountry((cn.toCountry as SupportedCountry) || 'India');
      setHasVehicleNo(cn.hasVehicleNo !== false && cn.truckNo !== 'UNASSIGNED');
      setHasMultiVehicle(Boolean(cn.hasMultiVehicle || (cn.extraVehicles && cn.extraVehicles.length > 0)));
      setTruckNo(cn.truckNo === 'UNASSIGNED' ? '' : cn.truckNo);
      setExtraVehicles(cn.extraVehicles || []);
      setDriverName(cn.driverName || '');
      setDriverDlNo(cn.driverDlNo || '');
      setDriverDlExpiry(cn.driverDlExpiry || '');
      setDriverMobile(cn.driverMobile || '');
      setPackages(cn.packages || '1');
      setPackageMode(cn.packageMode || 'PACKAGES');
      setParticulars(cn.particulars || '');
      setHasMultiGoods(Boolean(cn.multiGoodsItems && cn.multiGoodsItems.length > 0));
      setMultiGoodsItems(cn.multiGoodsItems || []);
      setTaxInvNo(cn.taxInvNo || '');
      setTaxInvDate(cn.taxInvDate || '');
      setValueOfGoods(String(cn.valueOfGoods || 0));
      setHasMultiTaxInv(Boolean(cn.extraTaxInvoices && cn.extraTaxInvoices.length > 0));
      setExtraTaxInvoices(cn.extraTaxInvoices || []);
      setEwayBillNo(cn.ewayBillNo || '');
      setEwayBillDate(cn.ewayBillDate || '');
      setEwayBillValidUpto(cn.ewayBillValidUpto || '');
      setEwayPlace(cn.ewayPlace || '');
      setEwayPinCode(cn.ewayPinCode || '');
      setHasMultiEwb(Boolean(cn.hasMultiEwayBill || (cn.extraEwayBills && cn.extraEwayBills.length > 0)));
      setExtraEwayBills(cn.extraEwayBills || []);
      setEwbExtensions(cn.ewbExtensions || []);
      setNettWeight(String(cn.nettWeight || 0));
      setGrossWeight(String(cn.grossWeight || 0));
      setChargedWeight(String(cn.chargedWeight || cn.nettWeight || 0));
      setHasMultiWeight(Boolean(cn.multiWeights && cn.multiWeights.length > 0));
      setMultiWeights(cn.multiWeights || []);
      setRateMode(cn.rateMode || 'Fixed');
      setRatePerUnit(String(cn.ratePerUnit || 0));
      setBaseFreight(String(Math.max(0, Number(cn.totalFreight || 0) - Number(cn.otherCharge || 0))));
      setOtherCharge(String(cn.otherCharge || 0));
      setManualFreightOverride(cn.totalFreight ? String(cn.totalFreight) : null);
      setShowFreightOnPrint(cn.showFreightOnPrint !== false);
      setInsuranceCo(cn.insuranceCo || '');
      setInsurancePolicyNo(cn.insurancePolicyNo || '');
      setInsurancePolicyDate(cn.insurancePolicyDate || '');
      setInsuranceAmount(String(cn.insuranceAmount || 0));
      setHasMultiInsurance(Boolean(cn.extraInsurances && cn.extraInsurances.length > 0));
      setExtraInsurances(cn.extraInsurances || []);
      setDeliveryModeCode(cn.deliveryModeCode || 'P');
      setGstPaidByCode(cn.gstPaidByCode || 'E');
      setRiskTakenBy(cn.riskTakenBy || 'O');
      setBillAdjustmentDetails(cn.billAdjustmentDetails || '');
      setAddlDetailsEnabled(Boolean(cn.addlDetailsEnabled));
      setCnRemarks(cn.remarks || '');
      setScannedLrDataUrl(cn.scannedLrDataUrl || '');
    } else if (row.docketRecord) {
      const dk = row.docketRecord;
      setEditingDocketId(dk.id);
      setDocNo(dk.docketNo);
      setDocDate(dk.docketDate);
      setBilledAtBranch(dk.billedAtBranch || dk.originBranch || 'Kolkata');
      setConsignorName(dk.consignorName);
      setConsignorAddress(dk.consignorAddress || '');
      setConsignorPinCode(dk.consignorPinCode || '');
      setConsignorCountry((dk.consignorCountry as SupportedCountry) || 'India');
      setConsignorGstin(dk.consignorGstin || '');
      setConsigneeName(dk.consigneeName);
      setConsigneeAddress(dk.consigneeAddress || '');
      setConsigneePinCode(dk.consigneePinCode || '');
      setConsigneeCountry((dk.consigneeCountry as SupportedCountry) || 'India');
      setConsigneeGstin(dk.consigneeGstin || '');
      setFromCity(dk.originBranch);
      setFromPinCode(dk.originPinCode || '');
      setFromCountry((dk.originCountry as SupportedCountry) || 'India');
      setToCity(dk.destBranch);
      setToPinCode(dk.destPinCode || '');
      setToCountry((dk.destCountry as SupportedCountry) || 'India');
      setDocketDeliveryMode(dk.deliveryMode);
      setPayBasis(dk.payMode);
      setPackages(String(dk.packages || 1));
      setPackageMode(dk.packingType || 'PACKAGES');
      setParticulars(dk.goodsDesc || '');
      setNettWeight(String(dk.actualWeightKg || 0));
      setChargedWeight(String(dk.chargedWeightKg || 0));
      setRatePerUnit(String(dk.ratePerUnit || 0));
      setBaseFreight(String(dk.baseFreight || dk.totalAmount || 0));
      setOtherCharge(String(dk.docketCharge || 0));
      setEwayBillNo(dk.ewayBillNo || '');
      setEwayBillValidUpto(dk.ewayBillValidUpto || '');
      setEwayPlace(dk.ewayPlace || '');
      setEwayPinCode(dk.ewayPinCode || '');
      setValueOfGoods(String(dk.valueOfGoods || 0));
      setCnRemarks(dk.remarks || '');
    }

    if (row.lorryHireRecord) {
      const lh = row.lorryHireRecord;
      setEditingHireId(lh.id);
      setIncludeHireSection(true);
      setBrokerName(lh.brokerName || '');
      setOwnerName(lh.ownerName || '');
      setHireWeightMt(String(lh.weightMt || 0));
      setHireRateMode(lh.rateMode || 'Fixed');
      setHireRatePerUnit(String(lh.ratePerUnit || 0));
      setHireAmount(String(lh.hireAmount || 0));
      setDetentionFromDate(lh.detentionFromDate || '');
      setDetentionToDate(lh.detentionToDate || '');
      setDetentionDays(String(lh.detentionDays || 0));
      setDetentionChargeOverride(lh.detentionCharge ? String(lh.detentionCharge) : null);
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
      setHasMultiAdvance(Boolean(lh.hasMultiAdvance || (lh.advances?.length || 0) > 1));
      setHireAdvances(lh.advances?.length ? lh.advances : [DEFAULT_ADV_ROW()]);
      setPayInstallments(mergePay12Rows(lh.payInstallments));
      setAdvExDate(lh.advExDate || '');
      setPayTdsOverride(lh.payTdsAmt ? String(lh.payTdsAmt) : '');
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
      setChallanAmt(String(sc.challanAmt || 0));
      setTravellingAmt(String(sc.travellingAmt || 0));
      setMiscAmt(String(sc.miscAmt || 0));
      setStaffPayMode(sc.paymentMode || 'Cash');
      setStaffAdvanceDate(sc.advanceDate || '');
      setStaffMonthlyPaidDate(sc.monthlyPaidDate || '');
      setStaffSettledZero(Boolean(sc.settledZeroFlag || sc.monthlyPaidDate));
      setStaffRemarks(sc.remarks || '');
      setMultiAdvances(sc.multiAdvances || []);
      setMultiPaidReturns(sc.multiPaidReturns || []);
      setMultiBalanceDates(sc.multiBalanceDates || []);
    }

    setFindCnFocused(false);
    setStatusToast(`Loaded CN/LR ${row.docNo} & linked Lorry Hire / Staff records for editing.`);
    topFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const buildPdfForRow = async (
    row: UnifiedRegisterRow
  ): Promise<{ pdf: GeneratedPdfResult; folder: AnyDriveFolderName } | null> => {
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

  const handleShareRowPdf = async (row: UnifiedRegisterRow, channel: 'whatsapp' | 'email') => {
    const built = await buildPdfForRow(row);
    if (!built) return;
    const partyLabel = row.billingPartyName || row.consignorName || row.consigneeName;
    const partyRec = findPartyContact(partyLabel);
    const res = await sharePdfDirect({
      pdf: built.pdf,
      channel,
      phone: partyRec?.phone,
      email: partyRec?.email,
      partyName: partyLabel,
      docNo: row.docNo,
      docLabel: isFtl ? 'LR' : divisionMeta.shortLabel,
      company,
    });
    setStatusToast(res.message);
  };

  return (
    <div ref={topFormRef} className="space-y-4">
      {/* TOP MASTER STICKY BAR + FIND CN/LR */}
      <div className="bg-gradient-to-r from-[#0B3B8C] via-[#0D47A1] to-[#1565C0] text-white rounded-xl p-3.5 shadow-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <ClipboardList className="w-6 h-6 text-amber-300 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-extrabold tracking-tight truncate">
              A. BILTY &amp; LORRY MASTER SHEET ({divisionMeta.shortLabel} · {activeFy})
            </h2>
            <p className="text-[11px] text-blue-100 truncate">
              FoxPro Bilty Entry + Multi [Y/N] Extensions → Band 1 Lorry Hire/Broker → Band 2 Staff Chart → Band 3 Pay 1–12
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Find CN / LR Instant Lookup */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-blue-900 absolute left-2.5 top-2 pointer-events-none" />
            <input
              type="text"
              value={findCnQuery}
              onFocus={() => setFindCnFocused(true)}
              onBlur={() => setTimeout(() => setFindCnFocused(false), 180)}
              onChange={(e) => {
                setFindCnQuery(e.target.value);
                setFindCnFocused(true);
              }}
              placeholder="🔍 Find CN / LR No..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-amber-50 text-slate-900 placeholder:text-slate-600 text-xs font-bold w-48 sm:w-56 border border-amber-300 focus:outline-none"
            />
            {findCnFocused && findCnMatches.length > 0 && (
              <div className="absolute right-0 mt-1 w-80 max-h-64 overflow-y-auto rounded-xl bg-white text-slate-900 border border-slate-300 shadow-2xl z-50 divide-y divide-slate-100">
                {findCnMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={() => loadRowForEdit(m)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs cursor-pointer"
                  >
                    <div className="flex items-center justify-between font-extrabold text-[#0D47A1]">
                      <span className="font-mono-num">{m.docNo}</span>
                      <span className="text-[10px] font-mono-num text-slate-500">
                        {formatDateDDMMYYYY(m.docDate)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-700 truncate">
                      {m.consignorName} → {m.consigneeName} · {m.truckNo}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={resetFormToBlank}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Sheet</span>
          </button>
          <button
            type="button"
            disabled={saving || readOnly}
            onClick={() => void handleSaveCompleteSheet('pdf')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save & LR PDF'}</span>
          </button>
          <button
            type="button"
            disabled={saving || readOnly}
            onClick={() => void handleSaveCompleteSheet('exit')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save & Exit'}</span>
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

      {/* ============================================================ */}
      {/* TOP HALF: CLASSIC FOXPRO BILTY RECORDS ENTRY (NO INVOICE!) */}
      {/* ============================================================ */}
      <div className="bg-white rounded-xl border-2 border-[#0D47A1] shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2 rounded-t-lg flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold tracking-wide">
            <Layers className="w-4 h-4 text-amber-300" />
            <span>
              CLASSIC FOXPRO — {isFtl ? 'BILTY RECORDS ENTRY (CN / LR)' : `${divisionMeta.shortLabel} DOCKET / LR ENTRY`}
              {(editingCnId || editingDocketId) && ' [EDITING]'}
            </span>
            <span className="px-2 py-0.5 rounded bg-white/15 text-[10px] font-mono-num">
              Last CN: {computedLastCnNo}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
            <div className="flex items-center gap-1.5">
              <span>Show Freight on LR PDF:</span>
              <button
                type="button"
                onClick={() => setShowFreightOnPrint((v) => !v)}
                className={`px-2 py-0.5 rounded font-extrabold cursor-pointer ${
                  showFreightOnPrint ? 'bg-emerald-400 text-slate-950' : 'bg-amber-300 text-slate-950'
                }`}
              >
                {showFreightOnPrint ? 'YES (Show ₹)' : 'NO (As Agreed)'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Input Vehicle No.?</span>
              <button
                type="button"
                onClick={() => setHasVehicleNo((v) => !v)}
                className={`px-2 py-0.5 rounded font-extrabold cursor-pointer ${
                  hasVehicleNo ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-amber-300'
                }`}
              >
                {hasVehicleNo ? 'YES' : 'NO'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3 text-xs">
          {/* Row 1: FoxPro Header Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Branch Short</label>
              <input
                type="text"
                value={branchShort}
                onChange={(e) => setBranchShort(e.target.value.toUpperCase())}
                placeholder="KOL"
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
              />
            </div>
            <div className="col-span-2 sm:col-span-1 lg:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                {isFtl ? 'C/N (Bilty) No *' : 'Docket / AWB No *'}
              </label>
              <input
                type="text"
                value={docNo}
                onChange={(e) => {
                  docNoDirtyRef.current = true;
                  setDocNo(e.target.value.toUpperCase());
                }}
                className="w-full px-2.5 py-1.5 rounded border border-slate-400 bg-amber-50/40 font-mono-num font-extrabold text-slate-950"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Ref CN / Manual No</label>
              <input
                type="text"
                value={refCnNo}
                onChange={(e) => setRefCnNo(e.target.value.toUpperCase())}
                placeholder="Optional Ref"
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Booking Date *</label>
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Billed At (Branch)</label>
              <EditableSearchSelect
                ariaLabel="Billed At Branch"
                value={billedAtBranch}
                onChange={setBilledAtBranch}
                options={ALL_INDIA_BRANCH_OPTIONS}
                placeholder="Branch..."
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Mode / Basis</label>
              <div className="flex gap-1">
                <div className="w-1/2">
                  <SearchableSelect
                    ariaLabel="Transport Mode"
                    value={transportMode}
                    onChange={(val) => setTransportMode(val as 'Road' | 'Rail' | 'Air')}
                    sortAlphabetically={false}
                    options={['Road', 'Rail', 'Air']}
                    buttonClassName="!py-1.5 !font-semibold"
                  />
                </div>
                <div className="w-1/2">
                  <SearchableSelect
                    ariaLabel="Booking Basis"
                    value={bookingBasis}
                    onChange={(val) => setBookingBasis(val as 'Party' | 'Franchise' | 'Cash')}
                    sortAlphabetically={false}
                    options={['Party', 'Franchise', 'Cash']}
                    buttonClassName="!py-1.5 !font-semibold"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Pay Basis</label>
              <SearchableSelect
                ariaLabel="Pay Basis"
                value={payBasis}
                onChange={(val) => setPayBasis(val as 'TBB' | 'Paid' | 'To-Pay')}
                sortAlphabetically={false}
                options={[
                  { value: 'TBB', label: 'TBB (To Be Billed)' },
                  { value: 'Paid', label: 'Paid' },
                  { value: 'To-Pay', label: 'To-Pay' },
                ]}
                buttonClassName="!py-1.5 !font-bold !text-[#0D47A1]"
              />
            </div>
          </div>

          {/* Row 2: Deliver At, Challan Attached, Credit Days, Billing Customer Ref */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Deliver At (Hub/Point)</label>
              <input
                type="text"
                value={deliverAt}
                onChange={(e) => setDeliverAt(e.target.value)}
                placeholder="Door / Godown / Petrapole / Dhaka"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
              <PinCountryInputs
                labelPrefix="Deliver"
                pinCode={deliverAtPinCode}
                country={deliverAtCountry}
                onPinChange={setDeliverAtPinCode}
                onCountryChange={setDeliverAtCountry}
                compact
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Challan Attached [Y/N]</label>
              <button
                type="button"
                onClick={() => setIsChallanAttached((v) => !v)}
                className={`w-full py-1.5 px-3 rounded border font-extrabold cursor-pointer ${
                  isChallanAttached
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                    : 'bg-slate-50 border-slate-300 text-slate-700'
                }`}
              >
                {isChallanAttached ? 'YES — Challan Attached' : 'NO — Separate'}
              </button>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Credit Days (Ref)</label>
              <SearchableSelect
                ariaLabel="Credit Days"
                value={String(creditDays)}
                onChange={(v) => setCreditDays(Number(v || 15))}
                options={creditDayPresets.map((d) => ({ value: String(d), label: `${d} Days` }))}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                TBB Billing Party Reference (Optional — Customers Only)
              </label>
              <RichEntityPicker<Party>
                ariaLabel="Billing Customer Reference"
                value={billingPartyName}
                selectedId={selectedBillingPartyId}
                onChangeText={(txt) => {
                  setBillingPartyName(txt);
                  setSelectedBillingPartyId('');
                }}
                onSelectEntity={(p) => {
                  setBillingPartyName(p.name);
                  setSelectedBillingPartyId(p.id);
                }}
                items={billingCustomerParties}
                getId={(p) => p.id}
                getValue={(p) => p.name}
                getSearchText={(p) => `${p.name} ${p.gstin || ''} ${p.address || ''}`}
                renderTitle={(p) => p.name}
                renderBadge={(p) => p.partyType}
                renderDetails={(p) => formatPartyDetailsLine(p)}
                placeholder="Select TBB Customer (Actual GST Bill in Tab B)..."
              />
            </div>
          </div>

          {/* Row 3: Consignor & Consignee + HSN */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="font-bold text-slate-700">Consignor *</label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500">HSN/SAC:</span>
                  <input
                    type="text"
                    value={consignorHsn}
                    onChange={(e) => setConsignorHsn(e.target.value)}
                    placeholder="996511"
                    className="w-24 px-1.5 py-0.5 rounded border border-slate-300 font-mono-num text-[11px]"
                  />
                </div>
              </div>
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
              <GstinInputField
                label="Consignor GSTIN (15-Char Checksum)"
                value={consignorGstin}
                onChange={setConsignorGstin}
                compact
                placeholder="Consignor GSTIN (Optional)"
              />
              <input
                type="text"
                value={consignorAddress}
                onChange={(e) => setConsignorAddress(e.target.value)}
                placeholder="Consignor Address / City (auto-fills PIN & Country)"
                className="w-full px-2 py-1 rounded border border-slate-300 text-xs"
              />
              <PinCountryInputs
                labelPrefix="Consignor"
                pinCode={consignorPinCode}
                country={consignorCountry}
                onPinChange={setConsignorPinCode}
                onCountryChange={setConsignorCountry}
                compact
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="font-bold text-slate-700">Consignee *</label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500">HSN/SAC:</span>
                  <input
                    type="text"
                    value={consigneeHsn}
                    onChange={(e) => setConsigneeHsn(e.target.value)}
                    placeholder="996511"
                    className="w-24 px-1.5 py-0.5 rounded border border-slate-300 font-mono-num text-[11px]"
                  />
                </div>
              </div>
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
              <GstinInputField
                label="Consignee GSTIN (15-Char Checksum)"
                value={consigneeGstin}
                onChange={setConsigneeGstin}
                compact
                placeholder="Consignee GSTIN (Optional)"
              />
              <input
                type="text"
                value={consigneeAddress}
                onChange={(e) => setConsigneeAddress(e.target.value)}
                placeholder="Consignee Address / City (auto-fills PIN & Country)"
                className="w-full px-2 py-1 rounded border border-slate-300 text-xs"
              />
              <PinCountryInputs
                labelPrefix="Consignee"
                pinCode={consigneePinCode}
                country={consigneeCountry}
                onPinChange={setConsigneePinCode}
                onCountryChange={setConsigneeCountry}
                compact
              />
            </div>
          </div>

          {/* Row 4: Origin, Destination, Packages + Inline Multi Package/Goods [Y/N] */}
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
              <PinCountryInputs
                labelPrefix="From"
                pinCode={fromPinCode}
                country={fromCountry}
                onPinChange={setFromPinCode}
                onCountryChange={setFromCountry}
                compact
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
              <PinCountryInputs
                labelPrefix="To"
                pinCode={toPinCode}
                country={toCountry}
                onPinChange={setToPinCode}
                onCountryChange={setToCountry}
                compact
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">Packages &amp; Mode</label>
                <button
                  type="button"
                  onClick={() => setHasMultiGoods((v) => !v)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                    hasMultiGoods ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 border border-slate-300'
                  }`}
                >
                  Multi Pkg/Goods [{hasMultiGoods ? 'Y' : 'N'}]
                </button>
              </div>
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
                  onAddOption={(val) => addDropdownItem(ownerUid, company, 'packageModes', val)}
                  onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'packageModes', oldV, newV)}
                  onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'packageModes', val)}
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
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'goodsTypes', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'goodsTypes', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'goodsTypes', val)}
              />
            </div>
          </div>

          {hasMultiGoods && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[#0D47A1]">
                  Multi-Package / Multi-Goods Items ({multiGoodsItems.length}/50)
                </span>
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
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-1.5 items-center bg-white p-1.5 rounded border border-slate-200">
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
            </div>
          )}

          {/* Row 5: Vehicle + Driver + Inline Multi Lorry [Y/N] */}
          {hasVehicleNo && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-[#0D47A1] flex items-center gap-1.5">
                  <Truck className="w-4 h-4" />
                  Vehicle &amp; Auto-Fetched Driver Details
                </span>
                <button
                  type="button"
                  onClick={() => setHasMultiVehicle((v) => !v)}
                  className={`px-2 py-0.5 rounded text-[11px] font-extrabold cursor-pointer ${
                    hasMultiVehicle ? 'bg-blue-700 text-white' : 'bg-white border border-blue-300 text-blue-900'
                  }`}
                >
                  Multi-Lorry [{hasMultiVehicle ? 'Y' : 'N'}]
                </button>
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
                    options={bodyTypeOptions}
                    onAddOption={(val) => addDropdownItem(ownerUid, company, 'vehicleBodyTypes', val)}
                    onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'vehicleBodyTypes', oldV, newV)}
                    onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'vehicleBodyTypes', val)}
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
                    <span className="text-[11px] font-bold text-slate-700">
                      Additional Multi-Lorries ({extraVehicles.length}/50)
                    </span>
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

          {/* Row 6: Supplier Invoice + E-Way Bill + Inline Multi [Y/N] & EWB Extension (1st/2nd/3rd) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Supplier Tax Inv Card */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-slate-800">Supplier Invoice &amp; Goods Value</span>
                <button
                  type="button"
                  onClick={() => setHasMultiTaxInv((v) => !v)}
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                    hasMultiTaxInv ? 'bg-blue-700 text-white' : 'bg-white border border-slate-300 text-slate-700'
                  }`}
                >
                  Multi Invoice [{hasMultiTaxInv ? 'Y' : 'N'}]
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Consignor Inv No</label>
                  <input
                    type="text"
                    value={taxInvNo}
                    onChange={(e) => setTaxInvNo(e.target.value.toUpperCase())}
                    placeholder="INV-001"
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Inv Date</label>
                  <input
                    type="date"
                    value={taxInvDate}
                    onChange={(e) => setTaxInvDate(e.target.value)}
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Goods Value (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={valueOfGoods}
                    onChange={(e) => setValueOfGoods(e.target.value)}
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
              </div>
              {hasMultiTaxInv && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-600">
                    <span>Extra Supplier Invoices ({extraTaxInvoices.length}/50)</span>
                    <button
                      type="button"
                      onClick={() =>
                        extraTaxInvoices.length < 50 &&
                        setExtraTaxInvoices((p) => [...p, { no: '', date: docDate, value: 0 }])
                      }
                      className="px-2 py-0.5 rounded bg-blue-600 text-white cursor-pointer"
                    >
                      + Add Inv
                    </button>
                  </div>
                  {extraTaxInvoices.map((inv, idx) => (
                    <div key={idx} className="flex gap-1 items-center">
                      <input
                        type="text"
                        value={inv.no}
                        placeholder="Inv No"
                        onChange={(e) =>
                          setExtraTaxInvoices((p) =>
                            p.map((x, i) => (i === idx ? { ...x, no: e.target.value.toUpperCase() } : x))
                          )
                        }
                        className="flex-1 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                      />
                      <input
                        type="date"
                        value={inv.date}
                        onChange={(e) =>
                          setExtraTaxInvoices((p) => p.map((x, i) => (i === idx ? { ...x, date: e.target.value } : x)))
                        }
                        className="w-28 px-1 py-1 rounded border border-slate-300 bg-white text-[11px]"
                      />
                      <input
                        type="number"
                        value={inv.value || 0}
                        onChange={(e) =>
                          setExtraTaxInvoices((p) =>
                            p.map((x, i) => (i === idx ? { ...x, value: Number(e.target.value || 0) } : x))
                          )
                        }
                        className="w-24 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setExtraTaxInvoices((p) => p.filter((_, i) => i !== idx))}
                        className="text-red-600 font-bold cursor-pointer px-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* E-Way Bill + Extension Card */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-extrabold text-slate-800">E-Way Bill &amp; Extension Log</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={ewbExtensions.length >= 3}
                    onClick={() =>
                      ewbExtensions.length < 3 &&
                      setEwbExtensions((p) => [
                        ...p,
                        {
                          extNo: p.length + 1,
                          extendedDate: todayISO(),
                          validUpto: ewayBillValidUpto || todayISO(),
                          reason: 'In-transit delay',
                        },
                      ])
                    }
                    className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-extrabold cursor-pointer disabled:opacity-40"
                  >
                    + Extend Date ({ewbExtensions.length}/3)
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasMultiEwb((v) => !v)}
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                      hasMultiEwb ? 'bg-blue-700 text-white' : 'bg-white border border-slate-300 text-slate-700'
                    }`}
                  >
                    Multi EWB [{hasMultiEwb ? 'Y' : 'N'}]
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">E-Way Bill No</label>
                  <input
                    type="text"
                    value={ewayBillNo}
                    onChange={(e) => setEwayBillNo(e.target.value.replace(/\s/g, ''))}
                    placeholder="12-digit EWB"
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">EWB Date</label>
                  <input
                    type="date"
                    value={ewayBillDate}
                    onChange={(e) => setEwayBillDate(e.target.value)}
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Valid Upto</label>
                  <input
                    type="date"
                    value={ewayBillValidUpto}
                    onChange={(e) => setEwayBillValidUpto(e.target.value)}
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">EWB Dispatch / ICP Place</label>
                  <input
                    type="text"
                    value={ewayPlace}
                    onChange={(e) => setEwayPlace(e.target.value)}
                    placeholder="e.g. Baranagar / Petrapole / Raxaul"
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">EWB PIN (Auto-Fill)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={ewayPinCode}
                    onChange={(e) => setEwayPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit EWB PIN"
                    className="w-full px-2 py-1 rounded border border-emerald-400 bg-emerald-50/40 font-mono-num font-bold"
                  />
                </div>
              </div>

              {ewbExtensions.length > 0 && (
                <div className="space-y-1 bg-amber-50 border border-amber-200 rounded p-1.5">
                  {ewbExtensions.map((ext, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-1 items-center text-[10px]">
                      <span className="col-span-2 font-extrabold text-amber-900">
                        {ext.extNo === 1 ? '1st Ext' : ext.extNo === 2 ? '2nd Ext' : '3rd Ext'}
                      </span>
                      <input
                        type="date"
                        value={ext.extendedDate}
                        onChange={(e) =>
                          setEwbExtensions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, extendedDate: e.target.value } : x))
                          )
                        }
                        className="col-span-3 px-1 py-0.5 rounded border border-amber-300 bg-white font-mono-num"
                      />
                      <input
                        type="date"
                        value={ext.validUpto}
                        onChange={(e) => {
                          setEwayBillValidUpto(e.target.value);
                          setEwbExtensions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, validUpto: e.target.value } : x))
                          );
                        }}
                        className="col-span-3 px-1 py-0.5 rounded border border-amber-300 bg-white font-mono-num"
                      />
                      <input
                        type="text"
                        value={ext.reason || ''}
                        placeholder="Reason"
                        onChange={(e) =>
                          setEwbExtensions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, reason: e.target.value } : x))
                          )
                        }
                        className="col-span-3 px-1 py-0.5 rounded border border-amber-300 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setEwbExtensions((p) => p.filter((_, i) => i !== idx))}
                        className="col-span-1 text-red-600 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {hasMultiEwb && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-600">
                    <span>Extra E-Way Bills ({extraEwayBills.length}/50)</span>
                    <button
                      type="button"
                      onClick={() =>
                        extraEwayBills.length < 50 &&
                        setExtraEwayBills((p) => [...p, { no: '', date: docDate, validUpto: '' }])
                      }
                      className="px-2 py-0.5 rounded bg-blue-600 text-white cursor-pointer"
                    >
                      + Add EWB
                    </button>
                  </div>
                  {extraEwayBills.map((ewb, idx) => (
                    <div key={idx} className="flex gap-1 items-center">
                      <input
                        type="text"
                        value={ewb.no}
                        placeholder="12-digit EWB No"
                        onChange={(e) =>
                          setExtraEwayBills((p) => p.map((x, i) => (i === idx ? { ...x, no: e.target.value } : x)))
                        }
                        className="flex-1 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                      />
                      <input
                        type="date"
                        value={ewb.validUpto || ''}
                        onChange={(e) =>
                          setExtraEwayBills((p) =>
                            p.map((x, i) => (i === idx ? { ...x, validUpto: e.target.value } : x))
                          )
                        }
                        className="w-32 px-1 py-1 rounded border border-slate-300 bg-white text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setExtraEwayBills((p) => p.filter((_, i) => i !== idx))}
                        className="text-red-600 font-bold cursor-pointer px-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 7: Unlocked Weights, Editable Rate Mode, Base/Total Freight + Multi Weight [Y/N] */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-800">
                Weights (Unlocked) &amp; Freight Valuation
              </span>
              <button
                type="button"
                onClick={() => setHasMultiWeight((v) => !v)}
                className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                  hasMultiWeight ? 'bg-blue-700 text-white' : 'bg-slate-100 border border-slate-300 text-slate-700'
                }`}
              >
                Multi Weight [{hasMultiWeight ? 'Y' : 'N'}]
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nett Wt (MT)</label>
                <input
                  type="number"
                  step="0.001"
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
                  step="0.001"
                  value={grossWeight}
                  onChange={(e) => setGrossWeight(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Charged Wt (MT)</label>
                <input
                  type="number"
                  step="0.001"
                  value={chargedWeight}
                  onChange={(e) => setChargedWeight(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Rate Mode (Edit/Drop)</label>
                <EditableSearchSelect
                  ariaLabel="Rate Mode"
                  value={rateMode}
                  onChange={(val) => {
                    setRateMode(val);
                    setManualFreightOverride(null);
                  }}
                  options={rateModeOptions}
                  onAddOption={(val) => addDropdownItem(ownerUid, company, 'rateModes', val)}
                  onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'rateModes', oldV, newV)}
                  onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'rateModes', val)}
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Rate (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={ratePerUnit}
                  onChange={(e) => {
                    setRatePerUnit(e.target.value);
                    setManualFreightOverride(null);
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Base Freight (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={!isLumpSumRateMode(rateMode) && Number(ratePerUnit || 0) > 0 ? autoComputedCnBaseFreight : baseFreight}
                  onChange={(e) => {
                    setBaseFreight(e.target.value);
                    setManualFreightOverride(null);
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Others (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={otherCharge}
                  onChange={(e) => {
                    setOtherCharge(e.target.value);
                    setManualFreightOverride(null);
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-[#0D47A1] mb-1">
                  Total Freight (Unlocked ₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={manualFreightOverride !== null ? manualFreightOverride : computedCnFreight}
                  onChange={(e) => setManualFreightOverride(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border-2 border-blue-400 bg-blue-50 font-mono-num font-extrabold text-[#0D47A1]"
                />
              </div>
            </div>
            <div className="px-2.5 py-1.5 rounded bg-blue-50/70 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-[#0D47A1]">
                Freight in Words:{' '}
                <span className="font-extrabold text-slate-900">
                  {amountToIndianWords(computedCnFreight)}
                </span>
              </span>
              <span className="font-mono-num font-bold text-slate-700">
                Base: ₹ {formatINR(autoComputedCnBaseFreight)} + Others: ₹ {formatINR(Number(otherCharge || 0))} = Total: ₹ {formatINR(computedCnFreight)}
              </span>
            </div>

            {hasMultiWeight && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2 space-y-1">
                <div className="flex justify-between items-center text-[11px] font-bold text-[#0D47A1]">
                  <span>Multi-Weight Breakdown ({multiWeights.length}/50)</span>
                  <button
                    type="button"
                    onClick={() =>
                      multiWeights.length < 50 &&
                      setMultiWeights((p) => [
                        ...p,
                        { label: `Lot ${p.length + 1}`, actualWeightKg: 0, grossWeightKg: 0, chargedWeightKg: 0 },
                      ])
                    }
                    className="px-2 py-0.5 rounded bg-blue-600 text-white cursor-pointer"
                  >
                    + Add Weight Row
                  </button>
                </div>
                {multiWeights.map((mw, idx) => (
                  <div key={idx} className="grid grid-cols-5 gap-1.5 items-center bg-white p-1.5 rounded border border-slate-200">
                    <input
                      type="text"
                      value={mw.label}
                      placeholder="Label"
                      onChange={(e) =>
                        setMultiWeights((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                      }
                      className="px-2 py-1 rounded border border-slate-300"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={mw.actualWeightKg}
                      placeholder="Nett Kg"
                      onChange={(e) =>
                        setMultiWeights((p) =>
                          p.map((x, i) => (i === idx ? { ...x, actualWeightKg: Number(e.target.value || 0) } : x))
                        )
                      }
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={mw.grossWeightKg}
                      placeholder="Gross Kg"
                      onChange={(e) =>
                        setMultiWeights((p) =>
                          p.map((x, i) => (i === idx ? { ...x, grossWeightKg: Number(e.target.value || 0) } : x))
                        )
                      }
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={mw.chargedWeightKg}
                      placeholder="Charged Kg"
                      onChange={(e) =>
                        setMultiWeights((p) =>
                          p.map((x, i) => (i === idx ? { ...x, chargedWeightKg: Number(e.target.value || 0) } : x))
                        )
                      }
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <button
                      type="button"
                      onClick={() => setMultiWeights((p) => p.filter((_, i) => i !== idx))}
                      className="text-red-600 font-bold cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 8: Insurance + Multi Insurance [Y/N] + Codes + Adjustments */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-slate-800">Insurance, Risk &amp; Statutory Codes</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAddlDetailsEnabled((v) => !v)}
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                    addlDetailsEnabled ? 'bg-indigo-700 text-white' : 'bg-white border border-slate-300 text-slate-700'
                  }`}
                >
                  Addl Details [{addlDetailsEnabled ? 'Y' : 'N'}]
                </button>
                <button
                  type="button"
                  onClick={() => setHasMultiInsurance((v) => !v)}
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                    hasMultiInsurance ? 'bg-blue-700 text-white' : 'bg-white border border-slate-300 text-slate-700'
                  }`}
                >
                  Multi Insurance [{hasMultiInsurance ? 'Y' : 'N'}]
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Del [P/G/D]</label>
                <SearchableSelect
                  ariaLabel="Delivery Mode Code"
                  value={deliveryModeCode}
                  onChange={setDeliveryModeCode}
                  options={DELIVERY_MODE_CODES.map((c) => ({ value: c.code, label: c.label }))}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">GST [R/E/T]</label>
                <SearchableSelect
                  ariaLabel="GST Paid By Code"
                  value={gstPaidByCode}
                  onChange={setGstPaidByCode}
                  options={GST_PAID_BY_CODES.map((c) => ({ value: c.code, label: c.label }))}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Risk [O/C/I]</label>
                <SearchableSelect
                  ariaLabel="Risk Code"
                  value={riskTakenBy}
                  onChange={setRiskTakenBy}
                  options={RISK_TYPE_CODES.map((c) => ({ value: c.code, label: c.label }))}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Insurance Co</label>
                <input
                  type="text"
                  value={insuranceCo}
                  onChange={(e) => setInsuranceCo(e.target.value)}
                  placeholder="New India / ICICI"
                  className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Policy No</label>
                <input
                  type="text"
                  value={insurancePolicyNo}
                  onChange={(e) => setInsurancePolicyNo(e.target.value.toUpperCase())}
                  placeholder="Policy No"
                  className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Policy Date</label>
                <input
                  type="date"
                  value={insurancePolicyDate}
                  onChange={(e) => setInsurancePolicyDate(e.target.value)}
                  className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Insured Amt (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={insuranceAmount}
                  onChange={(e) => setInsuranceAmount(e.target.value)}
                  className="w-full px-2 py-1 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
            </div>

            {hasMultiInsurance && (
              <div className="space-y-1 pt-1">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-600">
                  <span>Extra Insurance Policies ({extraInsurances.length}/50)</span>
                  <button
                    type="button"
                    onClick={() =>
                      extraInsurances.length < 50 &&
                      setExtraInsurances((p) => [...p, { policyNo: '', policyDate: docDate, amount: 0 }])
                    }
                    className="px-2 py-0.5 rounded bg-blue-600 text-white cursor-pointer"
                  >
                    + Add Policy
                  </button>
                </div>
                {extraInsurances.map((ins, idx) => (
                  <div key={idx} className="flex gap-1 items-center">
                    <input
                      type="text"
                      value={ins.policyNo}
                      placeholder="Policy No"
                      onChange={(e) =>
                        setExtraInsurances((p) =>
                          p.map((x, i) => (i === idx ? { ...x, policyNo: e.target.value.toUpperCase() } : x))
                        )
                      }
                      className="flex-1 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                    />
                    <input
                      type="date"
                      value={ins.policyDate || ''}
                      onChange={(e) =>
                        setExtraInsurances((p) =>
                          p.map((x, i) => (i === idx ? { ...x, policyDate: e.target.value } : x))
                        )
                      }
                      className="w-32 px-1 py-1 rounded border border-slate-300 bg-white text-[11px]"
                    />
                    <input
                      type="number"
                      value={ins.amount}
                      onChange={(e) =>
                        setExtraInsurances((p) =>
                          p.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value || 0) } : x))
                        )
                      }
                      className="w-28 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => setExtraInsurances((p) => p.filter((_, i) => i !== idx))}
                      className="text-red-600 font-bold cursor-pointer px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(addlDetailsEnabled || billAdjustmentDetails || cnRemarks) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                    Bill Adjustment Details
                  </label>
                  <input
                    type="text"
                    value={billAdjustmentDetails}
                    onChange={(e) => setBillAdjustmentDetails(e.target.value)}
                    placeholder="Bill adjustment / advance deduction notes..."
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">CN / LR Remarks</label>
                  <input
                    type="text"
                    value={cnRemarks}
                    onChange={(e) => setCnRemarks(e.target.value)}
                    placeholder="Delivery / detention / weighment notes..."
                    className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Inline LR Quick Action Bar (Save Y/N, Preview, Print, Low-MB PDF, Scan LR/POD, WhatsApp, Email) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50/70 p-0.5 gap-0.5">
                {(['Y', 'N'] as const).map((yn) => (
                  <button
                    key={yn}
                    type="button"
                    onClick={() => setSaveConfirmYN(yn)}
                    className={`px-2 py-1 rounded text-[10px] font-extrabold cursor-pointer ${
                      saveConfirmYN === yn
                        ? yn === 'Y'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-red-600 text-white'
                        : 'text-slate-700 hover:bg-white'
                    }`}
                  >
                    {yn === 'Y' ? 'Y (Ready)' : 'N (Hold)'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={saving || readOnly}
                onClick={() => void handleSaveCompleteSheet('stay')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : '💾 Save LR/CN'}
              </button>
              <button
                type="button"
                onClick={() => void handleInlineLrPdf('preview')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-[11px] font-bold cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview LR (Yellow Logo)
              </button>
              <button
                type="button"
                onClick={() => void handleInlineLrPdf('print')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-extrabold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Auto-Print LR
              </button>
              <button
                type="button"
                onClick={() => void handleInlineLrPdf('preview')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Low-MB PDF
              </button>
              <input
                ref={scanFileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => void handleScanPhysicalLr(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => scanFileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                {scannedLrDataUrl ? 'LR Scan Attached ✓' : 'Scan LR / POD'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleShareLr('whatsapp')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[11px] font-bold cursor-pointer"
                title="Share Real LR PDF on WhatsApp"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                WhatsApp PDF
              </button>
              <button
                type="button"
                onClick={() => void handleShareLr('email')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-bold cursor-pointer"
                title="Share Real LR PDF via Email"
              >
                <Mail className="w-3.5 h-3.5" />
                Email PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* BOTTOM BAND 1: LORRY HIRE + BROKER & DETN FROM/TO            */}
      {/* ============================================================ */}
      <div className="bg-white rounded-xl border border-amber-300 shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-amber-700 to-orange-600 text-white px-4 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Truck className="w-4 h-4 text-amber-200" />
            <span>BAND 1 — Lorry Hire, Broker, DETN FROM/TO (2-Day Free) &amp; Multi ADV [Y/N]</span>
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
                <span>POD SHORTAGE / BREAKAGE / LEAKAGE ALERT — Verify deductions before balance payment!</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Broker Name (Excluded from Customer Billing)</label>
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

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
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
                <label className="block font-bold text-slate-700 mb-1">Hire Mode</label>
                <EditableSearchSelect
                  ariaLabel="Hire Rate Mode"
                  value={hireRateMode}
                  onChange={setHireRateMode}
                  options={rateModeOptions}
                  onAddOption={(val) => addDropdownItem(ownerUid, company, 'rateModes', val)}
                  onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'rateModes', oldV, newV)}
                  onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'rateModes', val)}
                />
              </div>
              {!isLumpSumRateMode(hireRateMode) ? (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Hire Rate ({hireRateMode}) · Gross ₹{formatINR(effectiveHireGross)}
                  </label>
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
                <label className="block font-bold text-slate-700 mb-1">DETN FROM</label>
                <input
                  type="date"
                  value={detentionFromDate}
                  onChange={(e) => setDetentionFromDate(e.target.value)}
                  className="w-full px-1.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">DETN TO</label>
                <input
                  type="date"
                  value={detentionToDate}
                  onChange={(e) => setDetentionToDate(e.target.value)}
                  className="w-full px-1.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Detn Days &amp; Rate</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={detentionDays}
                    onChange={(e) => {
                      setDetentionDays(e.target.value);
                      setDetentionChargeOverride(null);
                    }}
                    className="w-12 px-1 py-1.5 rounded border border-slate-300 font-mono-num"
                    title="Total halt days (first 2 days free)"
                  />
                  <input
                    type="number"
                    value={detentionRatePerDay}
                    onChange={(e) => {
                      setDetentionRatePerDay(e.target.value);
                      setDetentionChargeOverride(null);
                    }}
                    className="flex-1 min-w-0 px-1 py-1.5 rounded border border-slate-300 font-mono-num"
                    title="Rate per chargeable day"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Detention ₹ (2d Free / Edit)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={detentionChargeOverride !== null ? detentionChargeOverride : effectiveDetentionCharge}
                  onChange={(e) => setDetentionChargeOverride(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-amber-50 border border-amber-300 font-mono-num font-bold text-amber-900"
                  title="Auto-calculates (Days-2)*Rate; type any manual amount to override"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">TDS 194C (%)</label>
                <SearchableSelect
                  ariaLabel="TDS 194C Percentage"
                  value={tdsRatePct}
                  onChange={(val) => {
                    setTdsRatePct(val);
                    setPayTdsOverride('');
                  }}
                  sortAlphabetically={false}
                  options={[
                    { value: '0', label: '0% Exempt' },
                    { value: '1', label: '1% Indv' },
                    { value: '2', label: '2% Co' },
                  ]}
                  buttonClassName="!py-1.5 !font-mono-num"
                />
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
              <div>
                <label className="block font-semibold text-slate-600 mb-0.5">
                  Recpt Challan Date {receiptChallanNo.trim() ? <span className="text-red-600">*</span> : ''}
                </label>
                <input
                  type="date"
                  required={Boolean(receiptChallanNo.trim())}
                  value={receiptChallanDate}
                  onChange={(e) => setReceiptChallanDate(e.target.value)}
                  className={`w-full px-2 py-1 rounded border font-mono-num ${
                    receiptChallanNo.trim() && !receiptChallanDate.trim()
                      ? 'border-red-400 bg-red-50'
                      : 'border-slate-300'
                  }`}
                />
              </div>
            </div>

            {/* Multi ADV [Y/N] (4-50 rows) */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-amber-900">
                    Advances Paid ({hireAdvances.length}/50 Rows) — Total: ₹ {formatINR(totalMultiAdvancePaid)}
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleMultiAdvance}
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                      hasMultiAdvance ? 'bg-amber-700 text-white' : 'bg-white border border-amber-400 text-amber-900'
                    }`}
                  >
                    Multi ADV [{hasMultiAdvance ? 'Y (4–50)' : 'N'}]
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (hireAdvances.length < 50) {
                      setHasMultiAdvance(true);
                      setHireAdvances((prev) => [...prev, DEFAULT_ADV_ROW()]);
                    }
                  }}
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
                      const rowsToRender = hasMultiAdvance ? hireAdvances : hireAdvances.slice(0, 1);
                      return rowsToRender.map((adv, idx) => {
                        runningCum += Number(adv.amount || 0);
                        const rowBal = Math.max(
                          0,
                          Math.round((hireNetSummary.grossWithDetention - staticDeductions - runningCum) * 100) / 100
                        );
                        return (
                          <tr key={idx} className="border-b border-amber-100 bg-white">
                            <td className="p-1 min-w-[115px]">
                              <SearchableSelect
                                ariaLabel={`Advance ${idx + 1} Payee Type`}
                                value={adv.payeeType}
                                onChange={(val) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, payeeType: val } : r))
                                  )
                                }
                                sortAlphabetically={false}
                                options={['Lorry Owner', 'Broker', 'Driver']}
                                buttonClassName="!py-1 !text-[11px]"
                              />
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
                            <td className="p-1 min-w-[130px]">
                              <EditableSearchSelect
                                ariaLabel={`Advance ${idx + 1} Payment Mode`}
                                value={adv.mode}
                                onChange={(val) =>
                                  setHireAdvances((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, mode: val } : r))
                                  )
                                }
                                options={paymentModeOptions}
                                onAddOption={(val) => addDropdownItem(ownerUid, company, 'paymentModes', val)}
                                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'paymentModes', oldV, newV)}
                                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'paymentModes', val)}
                              />
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
              <div className="rounded bg-white border border-amber-200 px-2.5 py-2 space-y-1 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono-num">
                  <span>
                    Gross Hire (+Detn): <strong>₹ {formatINR(hireNetSummary.grossWithDetention)}</strong>
                  </span>
                  <span>
                    Advances + Extra: <strong>₹ {formatINR(totalMultiAdvancePaid + Number(extraAdvanceAmt || 0))}</strong>
                  </span>
                  <span>
                    Deductions + TDS: <strong>₹ {formatINR(hireNetSummary.totalDeductions)}</strong>
                  </span>
                  <span className="text-emerald-800 font-extrabold">
                    Net Balance Payable: ₹ {formatINR(hireNetSummary.balancePayable)}
                  </span>
                </div>
                <div className="text-slate-700">
                  <span className="font-bold text-amber-900">Advance in Words:</span>{' '}
                  {amountToIndianWords(totalMultiAdvancePaid)}
                  {' · '}
                  <span className="font-bold text-emerald-900">Balance in Words:</span>{' '}
                  {amountToIndianWords(hireNetSummary.balancePayable)}
                </div>
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

      {/* ============================================================ */}
      {/* BOTTOM BAND 2: STAFF DETAILS, WHEEL RATE MASTER & LIVE CHART */}
      {/* ============================================================ */}
      <div className="bg-white rounded-xl border border-indigo-300 shadow-sm overflow-visible">
        <div className="bg-gradient-to-r from-indigo-700 to-blue-700 text-white px-4 py-2 rounded-t-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Users className="w-4 h-4 text-amber-300" />
            <span>BAND 2 — Staff Details, Editable Wheel Rates, Paid Stamp &amp; Live Chart</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setWheelRatesModalOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5 text-amber-300" />
              Edit Wheel Rate Master
            </button>
            <button
              type="button"
              onClick={() => setShowMultiLogs((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-extrabold cursor-pointer"
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
                <label className="block font-bold text-slate-700 mb-1">NAME OF STAFF</label>
                <EditableSearchSelect
                  ariaLabel="Staff Name"
                  value={staffName}
                  onChange={setStaffName}
                  options={staffAccounts.map((s) => s.displayName)}
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Bank &amp; UPI Modal [Lock]</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setBankUpiModalOpen(true)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-bold cursor-pointer"
                    title="Open Staff Bank A/c modal"
                  >
                    <Landmark className="w-3.5 h-3.5 text-indigo-700" />
                    <span>🏦 Bank</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBankUpiModalOpen(true)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold cursor-pointer"
                    title="Open Staff UPI modal"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
                    <span>📱 UPI</span>
                  </button>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Entry Type</label>
                <SearchableSelect
                  ariaLabel="Staff Entry Type"
                  value={staffEntryType}
                  onChange={(val) => setStaffEntryType(val as 'Commission' | 'Advance Taken' | 'Paid')}
                  sortAlphabetically={false}
                  options={[
                    { value: 'Commission', label: 'Commission (+)' },
                    { value: 'Advance Taken', label: 'Advance Taken (-)' },
                    { value: 'Paid', label: 'Monthly Paid (-)' },
                  ]}
                  buttonClassName="!py-1.5 !font-semibold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">WHEELS (Auto Rate)</label>
                <SearchableSelect
                  ariaLabel="Wheel Type Auto Rate"
                  value={wheelType}
                  onChange={(wt) => {
                    setWheelType(wt);
                    setStaffAmount(String(wheelRates[wt] || 0));
                  }}
                  sortAlphabetically={false}
                  options={WHEEL_TYPES.map((w) => ({
                    value: w,
                    label: `${w} (₹${wheelRates[w] || 0})`,
                  }))}
                  buttonClassName="!py-1.5 !font-semibold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">RUPEES (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={staffAmount}
                  onChange={(e) => setStaffAmount(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">CHALLAN AMT (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={challanAmt}
                  onChange={(e) => setChallanAmt(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
              <div>
                <label className="block font-bold text-slate-700 mb-1">TRAVELLING (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={travellingAmt}
                  onChange={(e) => setTravellingAmt(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">MISCELLANEOUS (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={miscAmt}
                  onChange={(e) => setMiscAmt(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">ADVANCE DATE</label>
                <input
                  type="date"
                  value={staffAdvanceDate}
                  onChange={(e) => setStaffAdvanceDate(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">MONTHLY PAID DATE</label>
                <input
                  type="date"
                  value={staffMonthlyPaidDate}
                  onChange={(e) => {
                    setStaffMonthlyPaidDate(e.target.value);
                    if (e.target.value) setStaffSettledZero(true);
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div className="lg:col-span-2 flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffSettledZero}
                    onChange={(e) => setStaffSettledZero(e.target.checked)}
                  />
                  Settled to ₹0
                </label>
                {(staffSettledZero || staffMonthlyPaidDate) && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-100 border border-emerald-400 text-emerald-900 font-extrabold">
                    ✅ PAID (No Balance Due)
                  </span>
                )}
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

            {/* Live Filterable Staff Chart + Totals + Print/PDF/Share */}
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-extrabold text-indigo-950">Staff Chart &amp; Totals:</span>
                  {(['ALL', 'Commission', 'Advance Taken', 'Paid'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStaffChartFilter(f)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                        staffChartFilter === f
                          ? 'bg-indigo-700 text-white'
                          : 'bg-white border border-indigo-200 text-indigo-900'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void buildStaffChartPdf().then((pdf) => onPreviewPdf(pdf, 'Reports_Ledgers'))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-indigo-300 text-indigo-900 text-[11px] font-bold cursor-pointer"
                  >
                    <Eye className="w-3 h-3" /> Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => void buildStaffChartPdf().then((pdf) => printPdfDirect(pdf))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-400 text-slate-950 text-[11px] font-extrabold cursor-pointer"
                  >
                    <Printer className="w-3 h-3" /> Print / Low-MB PDF
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerExternalShareLink(
                        buildWhatsAppShareHref({
                          message: `DRC Staff Chart (${activeFy} - ${staffChartFilter})\nDay Total: Rs. ${formatINR(staffChartStats.dayTotal)}\nMonth Total: Rs. ${formatINR(staffChartStats.monthTotal)}\nYearly FY Total: Rs. ${formatINR(staffChartStats.fyTotal)}`,
                        })
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-600 text-white text-[11px] font-bold cursor-pointer"
                  >
                    <MessageCircle className="w-3 h-3" /> Share
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffChartExpanded((v) => !v)}
                    className="p-1 rounded hover:bg-indigo-100 text-indigo-900 cursor-pointer"
                  >
                    {staffChartExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono-num">
                <div className="p-2 rounded bg-white border border-indigo-200 flex justify-between">
                  <span className="font-sans font-bold text-slate-600">Date-Wise ({formatDateDDMMYYYY(staffChartStats.activeDay)}):</span>
                  <span className="font-extrabold text-indigo-900">₹ {formatINR(staffChartStats.dayTotal)}</span>
                </div>
                <div className="p-2 rounded bg-white border border-indigo-200 flex justify-between">
                  <span className="font-sans font-bold text-slate-600">Monthly ({staffChartStats.activeMonth}):</span>
                  <span className="font-extrabold text-blue-900">₹ {formatINR(staffChartStats.monthTotal)}</span>
                </div>
                <div className="p-2 rounded bg-indigo-900 text-white flex justify-between">
                  <span className="font-sans font-bold">Yearly ({activeFy}):</span>
                  <span className="font-extrabold text-amber-300">₹ {formatINR(staffChartStats.fyTotal)}</span>
                </div>
              </div>

              {staffChartExpanded && staffChartStats.rows.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded border border-indigo-200 bg-white">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-indigo-100 text-indigo-950 font-bold text-left">
                      <tr>
                        <th className="p-1.5">Date</th>
                        <th className="p-1.5">Staff</th>
                        <th className="p-1.5">CN / Truck</th>
                        <th className="p-1.5">Type / Wheels</th>
                        <th className="p-1.5 text-right">Rupees + Extras</th>
                        <th className="p-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {staffChartStats.rows.slice(0, 25).map((r) => {
                        const tot =
                          Number(r.amount || 0) +
                          Number(r.challanAmt || 0) +
                          Number(r.travellingAmt || 0) +
                          Number(r.miscAmt || 0);
                        const paidOk = Boolean(r.settledZeroFlag || r.monthlyPaidDate);
                        return (
                          <tr key={r.id}>
                            <td className="p-1.5 font-mono-num">{formatDateDDMMYYYY(r.entryDate)}</td>
                            <td className="p-1.5 font-bold">{r.staffName}</td>
                            <td className="p-1.5 font-mono-num">{r.challanNo || '-'} / {r.truckNo || '-'}</td>
                            <td className="p-1.5">{r.entryType} ({r.wheelType})</td>
                            <td className="p-1.5 text-right font-mono-num font-bold">₹ {formatINR(tot)}</td>
                            <td className="p-1.5">
                              {paidOk ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-[10px]">
                                  ✅ PAID
                                </span>
                              ) : (
                                <span className="text-slate-500 text-[10px]">Open</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* BOTTOM BAND 3: PAY 1 TO PAY 12 INSTALLMENTS & FINAL SAVE     */}
      {/* ============================================================ */}
      <div className="bg-white rounded-xl border border-emerald-400 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-800 to-teal-700 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Wallet className="w-4 h-4 text-amber-300" />
            <span>BAND 3 — PAY 1 TO PAY 12 Installment Tracker, ADV EX DATE, TDS &amp; SAVE [Y/N]</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAllPay12((v) => !v)}
            className="px-2.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold cursor-pointer"
          >
            {showAllPay12 ? 'Show PAY 1–4 Compact' : 'Expand All PAY 1–12 Slots'}
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {(showAllPay12 ? payInstallments : payInstallments.slice(0, 4)).map((row, idx) => (
              <div key={row.slot} className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-emerald-900">PAY {row.slot}</span>
                  <input
                    type="date"
                    value={row.date}
                    onChange={(e) =>
                      setPayInstallments((p) =>
                        p.map((x, i) => (i === idx ? { ...x, date: e.target.value } : x))
                      )
                    }
                    className="px-1.5 py-0.5 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                  />
                </div>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={row.refNo}
                    onChange={(e) =>
                      setPayInstallments((p) =>
                        p.map((x, i) => (i === idx ? { ...x, refNo: e.target.value } : x))
                      )
                    }
                    placeholder="UTR / Chq Ref"
                    className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={row.amount || ''}
                    onChange={(e) =>
                      setPayInstallments((p) =>
                        p.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value || 0) } : x))
                      )
                    }
                    placeholder="₹ Amt"
                    className="w-24 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono-num font-bold text-right text-[11px]"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end pt-2 border-t border-slate-200">
            <div>
              <label className="block font-bold text-slate-700 mb-1">ADV EX DATE</label>
              <input
                type="date"
                value={advExDate}
                onChange={(e) => setAdvExDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">TDS Amount (₹)</label>
              <input
                type="number"
                step="0.01"
                value={payTdsOverride !== '' ? payTdsOverride : String(effectiveTdsAmt)}
                onChange={(e) => setPayTdsOverride(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">PAYMENT DUE (After Pay 1–12)</label>
              <div className="px-2.5 py-1.5 rounded bg-amber-50 border border-amber-300 font-mono-num font-extrabold text-amber-950">
                ₹ {formatINR(netPaymentDueAfterPay12)} (Paid ₹ {formatINR(totalPay1To12Paid)})
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">SAVE [Y / N]</label>
              <div className="flex gap-1">
                {(['Y', 'N'] as const).map((yn) => (
                  <button
                    key={yn}
                    type="button"
                    onClick={() => setSaveConfirmYN(yn)}
                    className={`flex-1 py-1.5 rounded font-extrabold cursor-pointer ${
                      saveConfirmYN === yn
                        ? yn === 'Y'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-red-600 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {yn === 'Y' ? 'Y (Ready)' : 'N (Hold)'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <button
                type="button"
                disabled={saving || readOnly}
                onClick={() => void handleSaveCompleteSheet('exit')}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Save Bilty &amp; Lorry Sheet</span>
              </button>
            </div>
          </div>

          <div className="text-[11px] font-semibold text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
            Note: Party GST Tax Invoices are created cleanly in standalone{' '}
            <span className="font-extrabold text-[#0D47A1]">B. PARTY TAX INVOICE (BILLING)</span> (select single or multiple saved CNs there).
          </div>
        </div>
      </div>

      {/* LIVE VIEW ENTRY SHEET / REGISTER TABLE */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden">
        <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>
              Live Bilty &amp; Lorry Register ({filteredRegisterRows.length} {isFtl ? 'Trips' : 'Dockets'})
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
                <th className="p-2.5 text-right">Hire &amp; Due (₹)</th>
                <th className="p-2.5">Staff Comm</th>
                <th className="p-2.5 text-right">Invoice Status</th>
                <th className="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredRegisterRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500 font-semibold">
                    No entries recorded yet for {divisionMeta.shortLabel} ({activeFy}). Fill Bilty &amp; Lorry Sheet above and click Save.
                  </td>
                </tr>
              ) : (
                paginatedRegisterRows.map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/40">
                    <td className="p-2.5 font-mono-num font-extrabold text-[#0D47A1] whitespace-nowrap">
                      {row.docNo}
                      <div className="text-[10px] font-normal text-slate-500">
                        {row.showFreightOnPrint ? `Freight ₹${formatINR(row.cnFreight)}` : 'As Agreed on PDF'}
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
                        Due ₹{formatINR(row.hireBalance)} · {row.podReceived ? 'POD OK' : 'POD Pend'}
                      </div>
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-800 truncate max-w-[110px]">{row.staffName}</div>
                      <div className="text-[10px] font-mono-num text-indigo-700">
                        ₹{formatINR(row.staffAmount)} {row.staffSettledZero ? '✅' : ''}
                      </div>
                    </td>
                    <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                      <div className="font-bold text-emerald-800">{row.billNo}</div>
                      {row.billTotal > 0 && (
                        <div className="text-[10px] text-slate-600">
                          Tot ₹{formatINR(row.billTotal)} · Due ₹{formatINR(row.billBalance)}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setViewModalRow(row)}
                          className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 cursor-pointer"
                          title="View Summary"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => loadRowForEdit(row)}
                          className="p-1.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0D47A1] cursor-pointer"
                          title="Edit / Rectify"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void buildPdfForRow(row).then((res) => res && onPreviewPdf(res.pdf, res.folder))
                          }
                          className="p-1.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 cursor-pointer"
                          title="Low-MB LR PDF Preview"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void buildPdfForRow(row).then((res) => res && printPdfDirect(res.pdf))}
                          className="p-1.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 cursor-pointer"
                          title="Auto-Print LR"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleShareRowPdf(row, 'whatsapp')}
                          className="p-1.5 rounded border border-green-300 bg-green-50 hover:bg-green-100 text-green-800 cursor-pointer"
                          title="Share Real PDF via WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleShareRowPdf(row, 'email')}
                          className="p-1.5 rounded border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 cursor-pointer"
                          title="Share Real PDF via Email"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {registerTotalPages > 1 && (
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-700">
            <span className="font-mono-num">
              Showing {(safeRegisterPage - 1) * REGISTER_PAGE_SIZE + 1}–
              {Math.min(safeRegisterPage * REGISTER_PAGE_SIZE, filteredRegisterRows.length)} of{' '}
              {filteredRegisterRows.length} entries
            </span>
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                disabled={safeRegisterPage <= 1}
                onClick={() => setRegisterPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Prev
              </button>
              <span className="font-mono-num font-bold px-2">
                Page {safeRegisterPage} / {registerTotalPages}
              </span>
              <button
                type="button"
                disabled={safeRegisterPage >= registerTotalPages}
                onClick={() => setRegisterPage((p) => Math.min(registerTotalPages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Staff Bank / UPI Modal with [YES/NO] Edit-Lock */}
      {bankUpiModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-indigo-800 text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-extrabold flex items-center gap-2">
                <Landmark className="w-4 h-4 text-amber-300" />
                Staff Bank &amp; UPI Details — {staffName}
              </span>
              <button
                type="button"
                onClick={() => setBankUpiModalOpen(false)}
                className="p-1 rounded hover:bg-white/20 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between bg-slate-100 px-3 py-2 rounded-lg">
                <span className="font-bold text-slate-800">
                  Edit Unlock [YES / NO]:
                </span>
                <button
                  type="button"
                  onClick={() => setBankUpiEditUnlocked((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-extrabold cursor-pointer ${
                    bankUpiEditUnlocked ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-white'
                  }`}
                >
                  {bankUpiEditUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {bankUpiEditUnlocked ? 'YES (Editable)' : 'NO (Locked)'}
                </button>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Bank Name, A/c No &amp; IFSC</label>
                <input
                  type="text"
                  value={staffBankAccount}
                  disabled={!bankUpiEditUnlocked}
                  onChange={(e) => setStaffBankAccount(e.target.value)}
                  placeholder="Enter Bank A/c & IFSC"
                  className="w-full px-2.5 py-2 rounded border border-slate-300 font-mono-num disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">UPI ID</label>
                <input
                  type="text"
                  value={staffUpiId}
                  disabled={!bankUpiEditUnlocked}
                  onChange={(e) => setStaffUpiId(e.target.value)}
                  placeholder="name@okaxis / mobile@upi"
                  className="w-full px-2.5 py-2 rounded border border-slate-300 font-mono-num disabled:bg-slate-100"
                />
              </div>
            </div>
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setBankUpiModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-[#0D47A1] text-white text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wheel Rate Master Modal */}
      {wheelRatesModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-extrabold">Wheel Commission Rate Master (₹)</span>
              <button
                type="button"
                onClick={() => setWheelRatesModalOpen(false)}
                className="p-1 rounded hover:bg-white/20 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2 text-xs">
              {WHEEL_TYPES.map((wt) => (
                <div key={wt} className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">{wt}</span>
                  <input
                    type="number"
                    step="1"
                    value={draftWheelRates[wt] ?? DEFAULT_WHEEL_RATES[wt]}
                    onChange={(e) =>
                      setDraftWheelRates((prev) => ({
                        ...prev,
                        [wt]: Math.max(0, Number(e.target.value || 0)),
                      }))
                    }
                    className="w-28 px-2 py-1 rounded border border-slate-300 text-right font-mono-num font-bold"
                  />
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWheelRatesModalOpen(false)}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!isMasterAdmin && readOnly}
                onClick={() => void handleSaveWheelRates()}
                className="px-4 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold cursor-pointer"
              >
                Save Rate Master
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Read-Only View Modal */}
      {viewModalRow && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-extrabold">Bilty &amp; Lorry Summary — {viewModalRow.docNo}</span>
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
                <p className="font-extrabold text-[#0D47A1]">1. Bilty / CN</p>
                <p><b>Date &amp; Branch:</b> {formatDateDDMMYYYY(viewModalRow.docDate)} · {viewModalRow.branch}</p>
                <p><b>Route:</b> {viewModalRow.route}</p>
                <p><b>Consignor:</b> {viewModalRow.consignorName}</p>
                <p><b>Consignee:</b> {viewModalRow.consigneeName}</p>
                <p><b>Truck / Driver:</b> {viewModalRow.truckNo} ({viewModalRow.driverName})</p>
                <p><b>Freight:</b> {viewModalRow.showFreightOnPrint ? `₹ ${formatINR(viewModalRow.cnFreight)}` : 'As Agreed on Print'}</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                <p className="font-extrabold text-amber-900">2. Lorry Hire &amp; POD</p>
                <p><b>Gross Hire:</b> ₹ {formatINR(viewModalRow.hireGross)}</p>
                <p><b>Balance Due:</b> ₹ {formatINR(viewModalRow.hireBalance)}</p>
                <p><b>POD Status:</b> {viewModalRow.podReceived ? 'Received / Verified' : 'Pending'}</p>
                <p className="font-extrabold text-indigo-900 pt-2">3. Staff Ledger</p>
                <p><b>Staff:</b> {viewModalRow.staffName} · ₹ {formatINR(viewModalRow.staffAmount)} {viewModalRow.staffSettledZero ? '✅ PAID' : ''}</p>
                <p className="font-extrabold text-emerald-900 pt-2">4. Billing Tab Status</p>
                <p><b>Invoice:</b> {viewModalRow.billNo}</p>
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
                onClick={() => void handleShareRowPdf(viewModalRow, 'whatsapp')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-green-600 text-white text-xs font-bold cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                WhatsApp PDF
              </button>
              <button
                type="button"
                onClick={() => void handleShareRowPdf(viewModalRow, 'email')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-sky-700 text-white text-xs font-bold cursor-pointer"
              >
                <Mail className="w-3.5 h-3.5" />
                Email PDF
              </button>
              <button
                type="button"
                onClick={() => void buildPdfForRow(viewModalRow).then((res) => res && printPdfDirect(res.pdf))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 text-slate-950 text-xs font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Auto-Print LR
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

export const AllInOneEntrySheet = React.memo(AllInOneEntrySheetInner);
