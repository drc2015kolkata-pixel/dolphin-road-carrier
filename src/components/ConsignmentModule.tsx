import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileCode2,
  FilePlus2,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  Printer,
  QrCode,
  Save,
  ScanLine,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  Usb,
  X,
} from 'lucide-react';
import {
  CompanySettings,
  ConsignmentNote,
  Driver,
  DriveFolderName,
  ExtraEwayBill,
  ExtraInsuranceItem,
  ExtraTaxInvoice,
  LorryHire,
  MultiGoodsItem,
  MultiWeightRow,
  Party,
  Vehicle,
} from '../types/erp';
import {
  amountToIndianWords,
  computeRateModeAmount,
  extractTrailingSerialNumber,
  formatDateDDMMYYYY,
  formatINR,
  getFyShortCode,
  makeSafeDocId,
  normalizeFyLabel,
  resolveFinancialYearFromDate,
  todayISO,
} from '../lib/formatters';
import {
  DbfLatestSerialSummary,
  extractHighestBillAndCnFromRawDbf,
  loadRawDbfArchiveFromIdb,
} from '../lib/foxproDbfImport';
import { scanPhysicalLR } from '../lib/ocrEngine';
import {
  GST_STATE_CODE_OPTIONS,
  inferGstStateCodeAndName,
  validateIndianGstin,
  validateSafeUploadFile,
} from '../lib/gstinValidator';
import { GstinInputField } from './GstinInputField';
import {
  addDropdownItem,
  ALL_INDIA_BRANCH_OPTIONS,
  COMMON_REMARK_PRESETS,
  DEFAULT_PACKAGE_MODES,
  deleteDropdownItem,
  DELIVERY_MODE_CODES,
  editDropdownItem,
  getEffectiveCreditDayPresets,
  getEffectiveDistrictsForState,
  getEffectiveDropdownList,
  GST_PAID_BY_CODES,
  RISK_TYPE_CODES,
  upsertDistrictItem,
} from '../lib/dropdownMasterStore';
import {
  logBranchActivity,
  removeDocument,
  reserveNextSerialNumber,
  upsertDocument,
} from '../lib/firestoreStore';
import {
  GeneratedPdfResult,
  downloadPdfDirect,
  generateLR3CopyPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { EditableSearchSelect, YesNoSelect } from './EditableSearchSelect';
import { SearchableSelect } from './SearchableSelect';
import { downloadNicPartBJson, getEwayBillExpiryState, ParsedQrPayload } from '../lib/ewayBillUtils';
import { filterBillingCustomerParties } from '../lib/partySeparation';
import { CameraPodQrScannerModal } from './CameraPodQrScannerModal';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { sharePdfDirect } from '../lib/shareUtils';
import { SupportedCountry } from '../lib/postalPinLookup';
import { VoiceDraftFields } from '../lib/voicePilot';
import { PinCountryInputs, useAutoPinLookup } from './CityPinCountryAutoFill';
import {
  EntityQuickPreviewCard,
  formatDriverDetailsLine,
  formatPartyDetailsLine,
  formatVehicleDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import { deleteIdbObject, loadIdbObject, saveIdbObject } from '../lib/indexedDbStore';
import { ExpiryAlertBadge } from './ExpiryAlertBadge';

interface ConsignmentModuleProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
  readOnly?: boolean;
  consignments: ConsignmentNote[];
  lorryHires?: LorryHire[];
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  company: CompanySettings;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: DriveFolderName) => void;
  onAutoUploadPdfToDrive?: (pdf: GeneratedPdfResult, category: 'LR_Copy', subFolder?: string) => Promise<void>;
  onSendCnToInvoice: (cn: ConsignmentNote) => void;
  onSwitchFy: (fy: string) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const ConsignmentModuleInner: React.FC<ConsignmentModuleProps> = ({
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  activeFy,
  isMasterAdmin,
  readOnly = false,
  consignments,
  lorryHires = [],
  parties,
  vehicles,
  drivers,
  company,
  onPreviewPdf,
  onAutoUploadPdfToDrive,
  onSendCnToInvoice,
  onSwitchFy,
  onShowConfirm,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const totalFreightInputRef = useRef<HTMLInputElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const [liveCameraOpen, setLiveCameraOpen] = useState(false);
  const [usbStatus, setUsbStatus] = useState<string | null>(null);
  const fyShort = getFyShortCode(activeFy);
  const branchPrefix =
    activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode.slice(0, 3) : 'KOL';

  const isMobileDevice = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''),
    []
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBilled, setEditingBilled] = useState(false);
  const [division, setDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [billedAtBranch, setBilledAtBranch] = useState<string>(() => {
    if (activeBranchCode && activeBranchCode !== 'ALL') {
      const matched = (company.branches || []).find((b) => b.branchCode === activeBranchCode);
      if (matched) return matched.branchName;
    }
    return 'Kolkata';
  });
  const [dbfSerialStats, setDbfSerialStats] = useState<DbfLatestSerialSummary | null>(null);
  const cnNoDirtyRef = useRef(false);

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

  const nextSequentialCnNo = useMemo(() => {
    const activeFyNorm = normalizeFyLabel(activeFy);
    const prefix = (company.serialConfig?.ftlCnPrefix || branchPrefix || 'KOL').trim().toUpperCase();
    const startNo = Number(company.serialConfig?.ftlCnStart || 147);
    let maxNum = 0;
    consignments.forEach((c) => {
      const cFy = normalizeFyLabel(c.financialYear || resolveFinancialYearFromDate(c.cnDate));
      if (cFy !== activeFyNorm) return;
      const n = extractTrailingSerialNumber(c.cnNo);
      if (n > maxNum && n < 1000000) {
        maxNum = n;
      }
    });
    if (dbfSerialStats?.maxCnNum && dbfSerialStats.maxCnNum > maxNum && dbfSerialStats.maxCnNum < 1000000) {
      maxNum = dbfSerialStats.maxCnNum;
    }
    const nextNum = Math.max(startNo, maxNum > 0 ? maxNum + 1 : startNo);
    return `${prefix}-${nextNum}/${fyShort}`;
  }, [consignments, activeFy, company.serialConfig, branchPrefix, fyShort, dbfSerialStats]);

  const [autoAtomicCn, setAutoAtomicCn] = useState(true);
  const [cnNo, setCnNo] = useState(() => nextSequentialCnNo);
  const [cnDate, setCnDate] = useState(todayISO());
  const [deliveryOffice, setDeliveryOffice] = useState('');
  const [deliveryType, setDeliveryType] = useState<'Door Delivery' | 'Port Delivery' | 'Party Delivery' | 'Godown Delivery'>('Party Delivery');
  const [freightMode, setFreightMode] = useState<'To Pay' | 'Paid' | 'To Be Billed'>('To Pay');
  const [originGstStateCode, setOriginGstStateCode] = useState('19');
  const [destGstStateCode, setDestGstStateCode] = useState('');
  const [stockTransfer, setStockTransfer] = useState(false);

  // Mandatory Billing Party & Credit Days Lock
  const [billingPartyName, setBillingPartyName] = useState('');
  const [selectedBillingPartyId, setSelectedBillingPartyId] = useState('');
  const [creditDaysOption, setCreditDaysOption] = useState<string>('');
  const [customCreditDays, setCustomCreditDays] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [shareStatusMsg, setShareStatusMsg] = useState<string | null>(null);

  const [consignorName, setConsignorName] = useState('');
  const [selectedConsignorId, setSelectedConsignorId] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorPinCode, setConsignorPinCode] = useState('');
  const [consignorCountry, setConsignorCountry] = useState<SupportedCountry>('India');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consigneeName, setConsigneeName] = useState('');
  const [selectedConsigneeId, setSelectedConsigneeId] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneePinCode, setConsigneePinCode] = useState('');
  const [consigneeCountry, setConsigneeCountry] = useState<SupportedCountry>('India');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [packages, setPackages] = useState('');
  const [packageMode, setPackageMode] = useState('NOS');
  const [particulars, setParticulars] = useState('');
  const [multiGoodsItems, setMultiGoodsItems] = useState<MultiGoodsItem[]>([]);
  const [hasMultiWeight, setHasMultiWeight] = useState(false);
  const [multiWeights, setMultiWeights] = useState<MultiWeightRow[]>([]);
  const [rateMode, setRateMode] = useState('Fixed Lorry Freight (Lump Sum)');
  const [ratePerUnit, setRatePerUnit] = useState('');
  const [nettWeight, setNettWeight] = useState('0');
  const [grossWeight, setGrossWeight] = useState('0');
  const [chargedWeight, setChargedWeight] = useState('0');
  const [loadingCharge, setLoadingCharge] = useState('0');
  const [unloadingCharge, setUnloadingCharge] = useState('0');
  const [returnLorryCharge, setReturnLorryCharge] = useState('0');
  const [sttCharge, setSttCharge] = useState('0');
  const [otherCharge, setOtherCharge] = useState('0');
  const [totalFreight, setTotalFreight] = useState('0');
  const [highlightFreightWarning, setHighlightFreightWarning] = useState(false);
  const [paidAmount, setPaidAmount] = useState('0');
  const [toPayAmount, setToPayAmount] = useState('0');

  // Yes/No Toggles for Vehicle Input, Tax Invoice, Multi E-Way Bill, Multi Vehicle & Insurance
  const [hasVehicleNo, setHasVehicleNo] = useState(true);
  const [hasTaxInvoice, setHasTaxInvoice] = useState(true);
  const [hasMultiEwayBill, setHasMultiEwayBill] = useState(false);
  const [hasMultiVehicle, setHasMultiVehicle] = useState(false);

  const [taxInvNo, setTaxInvNo] = useState('');
  const [taxInvDate, setTaxInvDate] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [ewayBillDate, setEwayBillDate] = useState('');
  const [ewayBillValidUpto, setEwayBillValidUpto] = useState('');
  const [ewayPlace, setEwayPlace] = useState('');
  const [ewayPinCode, setEwayPinCode] = useState('');
  const [ewbQrModalOpen, setEwbQrModalOpen] = useState(false);
  const [ewbTrackerMsg, setEwbTrackerMsg] = useState<string | null>(null);
  const [extraTaxInvoices, setExtraTaxInvoices] = useState<ExtraTaxInvoice[]>([]);
  const [extraEwayBills, setExtraEwayBills] = useState<ExtraEwayBill[]>([]);
  const [extraVehicles, setExtraVehicles] = useState<string[]>([]);
  const [valueOfGoods, setValueOfGoods] = useState('0');
  const [truckNo, setTruckNo] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');

  // All-India Geo Cascade (State with GST code -> District -> Place/City)
  const [fromState, setFromState] = useState('19 - West Bengal');
  const [fromDistrict, setFromDistrict] = useState('Kolkata');
  const [fromCity, setFromCity] = useState('KOLKATA');
  const [fromPinCode, setFromPinCode] = useState('700001');
  const [fromCountry, setFromCountry] = useState<SupportedCountry>('India');
  const [toState, setToState] = useState('');
  const [toDistrict, setToDistrict] = useState('');
  const [toCity, setToCity] = useState('');
  const [toPinCode, setToPinCode] = useState('');
  const [toCountry, setToCountry] = useState<SupportedCountry>('India');

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
  useAutoPinLookup(ewayPlace, ewayPinCode, toCountry, (pin) => {
    setEwayPinCode(pin);
  });

  useEffect(() => {
    const onVoiceDraft = (evt: Event) => {
      const detail = (evt as CustomEvent<VoiceDraftFields>).detail;
      if (!detail) return;
      if (detail.consignorName) setConsignorName(detail.consignorName);
      if (detail.consigneeName) setConsigneeName(detail.consigneeName);
      if (detail.partyName && !detail.consignorName) setBillingPartyName(detail.partyName);
      if (detail.fromCity) setFromCity(detail.fromCity);
      if (detail.toCity) setToCity(detail.toCity);
      if (detail.truckNo) {
        setHasVehicleNo(true);
        setTruckNo(detail.truckNo);
      }
      if (detail.ewayBillNo) setEwayBillNo(detail.ewayBillNo);
      if (detail.freight) setTotalFreight(detail.freight);
      if (detail.goodsDesc) setParticulars(detail.goodsDesc);
    };
    window.addEventListener('drc:voice-draft-fill', onVoiceDraft);
    return () => window.removeEventListener('drc:voice-draft-fill', onVoiceDraft);
  }, []);

  const [engineNo, setEngineNo] = useState('');
  const [chassisNo, setChassisNo] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [selectedBrokerId, setSelectedBrokerId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [driverDlNo, setDriverDlNo] = useState('');
  const [driverDlExpiry, setDriverDlExpiry] = useState('');
  const [driverMobile, setDriverMobile] = useState('');

  // Short Codes & Insurance
  const [deliveryModeCode, setDeliveryModeCode] = useState<'P' | 'G' | 'D'>('P');
  const [gstPaidByCode, setGstPaidByCode] = useState<'R' | 'E' | 'T'>('E');
  const [gstPaidBy, setGstPaidBy] = useState('Consignee');
  const [riskTakenBy, setRiskTakenBy] = useState<'O' | 'C' | 'I'>('O');
  const [billToPartyFlag, setBillToPartyFlag] = useState(false);
  const [insurancePolicyNo, setInsurancePolicyNo] = useState('');
  const [insurancePolicyDate, setInsurancePolicyDate] = useState('');
  const [insuranceAmount, setInsuranceAmount] = useState('0');
  const [hasMultiInsurance, setHasMultiInsurance] = useState(false);
  const [extraInsurances, setExtraInsurances] = useState<ExtraInsuranceItem[]>([]);
  const [insuranceStatus, setInsuranceStatus] = useState('The Customer has not insured the consignment');
  const [remarks, setRemarks] = useState('');
  const [scannedLrDataUrl, setScannedLrDataUrl] = useState('');

  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrMissingFields, setOcrMissingFields] = useState<string[]>([]);
  const [ocrFyMismatch, setOcrFyMismatch] = useState<{
    detectedFy: string;
    detectedDate: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const lrDraftHydratedRef = useRef(false);
  const FTL_LR_DRAFT_KEY = 'drc_draft_lr_ftl_v1';

  // Live Dropdown Master Lists (Firestore synced)
  const branchDropdownOptions = useMemo(() => {
    const companyBranches = (company.branches || []).map((b) => b.branchName).filter(Boolean);
    return Array.from(new Set([...ALL_INDIA_BRANCH_OPTIONS, ...companyBranches])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [company.branches]);
  const goodsOptions = useMemo(() => {
    const base = getEffectiveDropdownList(company, 'goodsTypes');
    return base.includes('MULTI') ? base : [...base, 'MULTI'];
  }, [company]);
  const packageModeOptions = useMemo(() => {
    const base = getEffectiveDropdownList(company, 'packageModes');
    const merged = Array.from(new Set([...DEFAULT_PACKAGE_MODES, ...base]));
    return merged;
  }, [company]);
  const rateModeOptions = useMemo(() => getEffectiveDropdownList(company, 'rateModes'), [company]);
  const deliveryPlaceOptions = useMemo(() => getEffectiveDropdownList(company, 'deliveryPlaces'), [company]);
  const stateOptions = useMemo(() => getEffectiveDropdownList(company, 'states'), [company]);
  const fromDistrictOptions = useMemo(
    () => getEffectiveDistrictsForState(company, fromState),
    [company, fromState]
  );
  const toDistrictOptions = useMemo(
    () => getEffectiveDistrictsForState(company, toState),
    [company, toState]
  );
  const creditDayPresets = useMemo(() => getEffectiveCreditDayPresets(company), [company]);
  const billingCustomerParties = useMemo(
    () => filterBillingCustomerParties({ parties, drivers, consignments }),
    [parties, drivers, consignments]
  );
  const brokerMasterParties = useMemo(
    () =>
      [...parties]
        .filter((p) => p.partyType === 'Broker')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [parties]
  );
  const ownerAndBrokerParties = useMemo(
    () =>
      [...parties]
        .filter((p) => p.partyType === 'TruckOwner' || p.partyType === 'Broker')
        .sort((a, b) =>
          a.partyType === b.partyType
            ? a.name.localeCompare(b.name)
            : a.partyType === 'TruckOwner'
              ? -1
              : 1
        ),
    [parties]
  );

  const resolvedCreditDays = useMemo(() => {
    if (!creditDaysOption) return 0;
    if (creditDaysOption === 'custom') {
      const n = Math.round(Number(customCreditDays));
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    const n = Math.round(Number(creditDaysOption));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [creditDaysOption, customCreditDays]);

  useEffect(() => {
    if (!editingId && !cnNoDirtyRef.current) {
      setCnNo(nextSequentialCnNo);
    }
  }, [editingId, nextSequentialCnNo]);

  useEffect(() => {
    let cancelled = false;
    void loadIdbObject<Record<string, unknown>>(FTL_LR_DRAFT_KEY).then((draft) => {
      lrDraftHydratedRef.current = true;
      if (cancelled || !draft || editingId) return;
      if (typeof draft.cnNo === 'string' && draft.cnNo.trim()) {
        setCnNo(draft.cnNo);
        cnNoDirtyRef.current = true;
      }
      if (typeof draft.cnDate === 'string' && draft.cnDate) setCnDate(draft.cnDate);
      if (typeof draft.billedAtBranch === 'string' && draft.billedAtBranch) setBilledAtBranch(draft.billedAtBranch);
      if (typeof draft.billingPartyName === 'string') setBillingPartyName(draft.billingPartyName);
      if (typeof draft.creditDaysOption === 'string') setCreditDaysOption(draft.creditDaysOption);
      if (typeof draft.consignorName === 'string') setConsignorName(draft.consignorName);
      if (typeof draft.consignorAddress === 'string') setConsignorAddress(draft.consignorAddress);
      if (typeof draft.consignorGstin === 'string') setConsignorGstin(draft.consignorGstin);
      if (typeof draft.consigneeName === 'string') setConsigneeName(draft.consigneeName);
      if (typeof draft.consigneeAddress === 'string') setConsigneeAddress(draft.consigneeAddress);
      if (typeof draft.consigneeGstin === 'string') setConsigneeGstin(draft.consigneeGstin);
      if (typeof draft.truckNo === 'string') setTruckNo(draft.truckNo);
      if (typeof draft.fromCity === 'string' && draft.fromCity) setFromCity(draft.fromCity);
      if (typeof draft.toCity === 'string') setToCity(draft.toCity);
      if (typeof draft.packages === 'string') setPackages(draft.packages);
      if (typeof draft.particulars === 'string') setParticulars(draft.particulars);
      if (typeof draft.nettWeight === 'string') setNettWeight(draft.nettWeight);
      if (typeof draft.rateMode === 'string') setRateMode(draft.rateMode);
      if (typeof draft.ratePerUnit === 'string') setRatePerUnit(draft.ratePerUnit);
      if (typeof draft.totalFreight === 'string') setTotalFreight(draft.totalFreight);
      if (typeof draft.ewayBillNo === 'string') setEwayBillNo(draft.ewayBillNo);
      if (typeof draft.driverName === 'string') setDriverName(draft.driverName);
      if (typeof draft.driverMobile === 'string') setDriverMobile(draft.driverMobile);
      if (typeof draft.remarks === 'string') setRemarks(draft.remarks);
      if (draft.billingPartyName || draft.consignorName || draft.toCity || draft.truckNo) {
        setOcrStatus('Restored unsaved LR / Consignment draft cleanly after refresh.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lrDraftHydratedRef.current || editingId) return;
    const hasInput = Boolean(
      billingPartyName.trim() ||
        consignorName.trim() ||
        consigneeName.trim() ||
        toCity.trim() ||
        truckNo.trim() ||
        ewayBillNo.trim() ||
        Number(totalFreight || 0) > 0
    );
    if (!hasInput) return;
    const timer = window.setTimeout(() => {
      void saveIdbObject(FTL_LR_DRAFT_KEY, {
        cnNo,
        cnDate,
        billedAtBranch,
        billingPartyName,
        creditDaysOption,
        consignorName,
        consignorAddress,
        consignorGstin,
        consigneeName,
        consigneeAddress,
        consigneeGstin,
        truckNo,
        fromCity,
        toCity,
        packages,
        particulars,
        nettWeight,
        rateMode,
        ratePerUnit,
        totalFreight,
        ewayBillNo,
        driverName,
        driverMobile,
        remarks,
        savedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    editingId,
    cnNo,
    cnDate,
    billedAtBranch,
    billingPartyName,
    creditDaysOption,
    consignorName,
    consignorAddress,
    consignorGstin,
    consigneeName,
    consigneeAddress,
    consigneeGstin,
    truckNo,
    fromCity,
    toCity,
    packages,
    particulars,
    nettWeight,
    rateMode,
    ratePerUnit,
    totalFreight,
    ewayBillNo,
    driverName,
    driverMobile,
    remarks,
  ]);

  const indexedCNs = useMemo(() => {
    const sorted = [...consignments].sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''));
    return sorted.map((c) => ({
      item: c,
      haystack: `${c.cnNo || ''} ${c.consignorName || ''} ${c.consigneeName || ''} ${c.truckNo || ''} ${c.toCity || ''} ${c.branchCode || ''} ${(c.extraVehicles || []).join(' ')}`.toLowerCase(),
    }));
  }, [consignments]);

  const filteredCNs = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return indexedCNs.map((x) => x.item);
    return indexedCNs.filter((x) => x.haystack.includes(q)).map((x) => x.item);
  }, [indexedCNs, debouncedSearch]);

  const handleOCRFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const uploadCheck = validateSafeUploadFile(file, 'image_only');
      if (!uploadCheck.valid) {
        playAlertBeep();
        setOcrError(uploadCheck.reason || 'Blocked unsupported file.');
        return;
      }
      setOcrError(null);
      setOcrFyMismatch(null);
      setOcrMissingFields([]);
      setHighlightFreightWarning(false);
      setOcrStatus('Auto-rotating & scanning document (OCR + AI Vision)...');
      try {
        const { result, compressedDataUrl } = await scanPhysicalLR(
          file,
          (msg) => setOcrStatus(msg),
          Boolean(company?.backgroundAiEnabled)
        );
        if (compressedDataUrl) {
          setScannedLrDataUrl(compressedDataUrl.slice(0, 350000));
        }
        if (result.cnNo) {
          setCnNo(result.cnNo);
          setAutoAtomicCn(false);
        }
        if (result.cnDate) {
          setCnDate(result.cnDate);
          const detectedFy = resolveFinancialYearFromDate(result.cnDate);
          if (normalizeFyLabel(detectedFy) !== normalizeFyLabel(activeFy)) {
            setOcrFyMismatch({ detectedFy, detectedDate: result.cnDate });
          }
        }
        if (result.consignorName) setConsignorName(result.consignorName);
        if (result.consignorAddress) setConsignorAddress(result.consignorAddress);
        if (result.consignorGstin) setConsignorGstin(result.consignorGstin);
        if (result.consigneeName) setConsigneeName(result.consigneeName);
        if (result.consigneeAddress) setConsigneeAddress(result.consigneeAddress);
        if (result.consigneeGstin) setConsigneeGstin(result.consigneeGstin);
        if (result.packages) setPackages(result.packages);
        if (result.packageMode) setPackageMode(result.packageMode);
        if (result.particulars) setParticulars(result.particulars);
        if (result.goodsRemarks) setRemarks(result.goodsRemarks);
        if (result.nettWeight) setNettWeight(String(result.nettWeight));
        if (result.grossWeight) setGrossWeight(String(result.grossWeight));
        if (result.chargedWeight) setChargedWeight(String(result.chargedWeight));
        if (result.rateType) setRateMode(result.rateType);
        if (result.fixedOrWeightRate) setRatePerUnit(String(result.fixedOrWeightRate));
        if (result.gstPaidByCode) {
          setGstPaidByCode(result.gstPaidByCode);
          setGstPaidBy(
            result.gstPaidByCode === 'R'
              ? 'Consignor'
              : result.gstPaidByCode === 'T'
                ? 'Transporter'
                : 'Consignee'
          );
        }
        if (typeof result.stockTransfer === 'boolean') {
          setStockTransfer(result.stockTransfer);
        }
        if (result.totalFreight && Number(result.totalFreight) > 0) {
          setTotalFreight(String(result.totalFreight));
          setToPayAmount(String(result.totalFreight));
          setHighlightFreightWarning(false);
        } else if (result.highlightTotalFreight) {
          setHighlightFreightWarning(true);
          playAlertBeep();
          setTimeout(() => {
            totalFreightInputRef.current?.focus();
            totalFreightInputRef.current?.select();
          }, 120);
        }
        const extractedTruck = (result.vehicleNo || result.truckNo || '').trim().toUpperCase();
        if (extractedTruck) {
          setHasVehicleNo(true);
          handleSelectVehicle(extractedTruck);
        }
        if (result.fromCity) setFromCity(result.fromCity);
        if (result.toCity) setToCity(result.toCity);
        if (result.ewayBillNo) setEwayBillNo(result.ewayBillNo);
        if (result.ewayBillDate) setEwayBillDate(result.ewayBillDate);
        if (result.ewayBillValidUpto) setEwayBillValidUpto(result.ewayBillValidUpto);
        if (result.extraEwayBills && result.extraEwayBills.length > 0) {
          setHasMultiEwayBill(true);
          setExtraEwayBills(
            result.extraEwayBills.map((e) => ({
              no: e.no || '',
              date: e.date || result.ewayBillDate || todayISO(),
              ...(e.validUpto ? { validUpto: e.validUpto } : {}),
            }))
          );
        }
        if (result.taxInvNo) {
          setHasTaxInvoice(true);
          setTaxInvNo(result.taxInvNo);
        }
        if (result.taxInvDate) setTaxInvDate(result.taxInvDate);
        if (result.extraTaxInvoices && result.extraTaxInvoices.length > 0) {
          setHasTaxInvoice(true);
          setExtraTaxInvoices(
            result.extraTaxInvoices.map((inv) => ({
              no: inv.no || '',
              date: inv.date || result.taxInvDate || todayISO(),
              value: inv.amount || 0,
            }))
          );
        }
        if (result.valueOfGoods) setValueOfGoods(String(result.valueOfGoods));
        if (result.ownerName) setOwnerName(result.ownerName);
        if (result.driverName) setDriverName(result.driverName);
        if (result.driverDlNo) setDriverDlNo(result.driverDlNo);
        if (result.missingOrUnclearFields && result.missingOrUnclearFields.length > 0) {
          setOcrMissingFields(result.missingOrUnclearFields);
        }
        setOcrStatus(
          `${result.appliedRotationDeg ? `[Auto-rotated ${result.appliedRotationDeg}°] ` : ''}${
            result.isCrossBorder
              ? `Cross-Border (${result.destinationCountry}) Detected — `
              : ''
          }${
            result.confidenceNote ||
            'Scanned values auto-filled below — every field remains 100% editable before saving.'
          }`
        );
      } catch (err) {
        setOcrError(err instanceof Error ? err.message : 'Document scan failed');
        setOcrStatus(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFy]
  );

  // Ctrl + V clipboard image paste support anywhere in the LR workspace
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blobFile = item.getAsFile();
          if (blobFile) {
            e.preventDefault();
            void handleOCRFile(blobFile);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleOCRFile, readOnly]);

  const stopLiveCamera = useCallback(() => {
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((t) => t.stop());
      liveStreamRef.current = null;
    }
    setLiveCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (liveStreamRef.current) {
        liveStreamRef.current.getTracks().forEach((t) => t.stop());
        liveStreamRef.current = null;
      }
    };
  }, []);

  const handleOpenLiveCamera = async () => {
    setOcrError(null);
    setUsbStatus(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Fall back to mobile rear camera input if getUserMedia unsupported
      if (cameraInputRef.current) {
        cameraInputRef.current.click();
      } else {
        setOcrError('Live camera stream is not supported in this browser.');
      }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      liveStreamRef.current = stream;
      setLiveCameraOpen(true);
      setTimeout(() => {
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream;
          void liveVideoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      if (cameraInputRef.current) {
        cameraInputRef.current.click();
      } else {
        setOcrError('Camera permission denied. Allow camera access or use Upload / Ctrl+V.');
      }
    }
  };

  const handleCaptureLiveFrame = async () => {
    const video = liveVideoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    stopLiveCamera();
    if (blob) {
      const file = new File([blob], `drc-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      void handleOCRFile(file);
    }
  };

  const handleAutoUsbScannerProbe = async () => {
    setOcrError(null);
    setUsbStatus('Probing USB / local WIA scanner hardware...');
    try {
      const navWithUsb = navigator as Navigator & {
        usb?: {
          getDevices: () => Promise<Array<{ productName?: string; manufacturerName?: string }>>;
          requestDevice: (opts: { filters: Array<Record<string, unknown>> }) => Promise<{
            productName?: string;
            manufacturerName?: string;
          }>;
        };
      };
      if (navWithUsb.usb) {
        const paired = await navWithUsb.usb.getDevices();
        if (paired.length > 0) {
          const devName = paired[0].productName || paired[0].manufacturerName || 'USB Scanner/Printer';
          setUsbStatus(
            `Detected ${devName}. Triggering Windows/Local scan picker or press Ctrl+V after scanning.`
          );
          fileInputRef.current?.click();
          return;
        }
        try {
          const picked = await navWithUsb.usb.requestDevice({ filters: [] });
          const devName = picked.productName || picked.manufacturerName || 'USB Device';
          setUsbStatus(
            `Linked ${devName}! Select your scanned image or press Ctrl+V to auto-fill.`
          );
          fileInputRef.current?.click();
          return;
        } catch {
          // User cancelled WebUSB prompt; open Windows/WIA file scanner fallback cleanly
        }
      }
      setUsbStatus(
        'HP Ink Tank 315 / WIA Scanner Bridge Ready — select scanned slip or paste via Ctrl+V.'
      );
      fileInputRef.current?.click();
    } catch {
      setUsbStatus('Ready for USB Scanner / WIA file upload or Ctrl+V paste.');
      fileInputRef.current?.click();
    }
  };

  const handleOneTapScanClick = () => {
    if (isMobileDevice && cameraInputRef.current) {
      cameraInputRef.current.click();
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const applyRouteSmartAutoFill = useCallback(
    (partyCandidate: string, destinationCandidate: string) => {
      const cleanParty = partyCandidate.trim().toLowerCase();
      const cleanDest = destinationCandidate.trim().toLowerCase();
      if (!cleanParty && !cleanDest) return;

      const sortedCns = [...consignments].sort((a, b) =>
        (b.cnDate || '').localeCompare(a.cnDate || '')
      );
      const exactMatch = sortedCns.find(
        (c) =>
          cleanParty &&
          cleanDest &&
          (c.billingPartyName?.toLowerCase() === cleanParty ||
            c.consignorName?.toLowerCase() === cleanParty) &&
          c.toCity?.toLowerCase() === cleanDest
      );
      const partyMatch = sortedCns.find(
        (c) =>
          cleanParty &&
          (c.billingPartyName?.toLowerCase() === cleanParty ||
            c.consignorName?.toLowerCase() === cleanParty)
      );
      const destMatch = sortedCns.find((c) => cleanDest && c.toCity?.toLowerCase() === cleanDest);

      const best = exactMatch || partyMatch || destMatch;
      if (!best) return;

      if (!creditDaysOption && best.creditDays && best.creditDays > 0) {
        if (creditDayPresets.includes(best.creditDays)) {
          setCreditDaysOption(String(best.creditDays));
        } else {
          setCreditDaysOption('custom');
          setCustomCreditDays(String(best.creditDays));
        }
      }
      if (!deliveryOffice.trim() && best.deliveryOffice) {
        setDeliveryOffice(best.deliveryOffice);
      }
      if (!particulars.trim() && best.particulars) {
        setParticulars(best.particulars);
      }
      const currentFreightNum = Number(totalFreight || 0);
      if ((totalFreight === '' || currentFreightNum <= 0) && Number(best.totalFreight || 0) > 0) {
        setTotalFreight(String(best.totalFreight));
        if (best.rateMode) setRateMode(best.rateMode);
        if (best.ratePerUnit) setRatePerUnit(String(best.ratePerUnit));
      }
    },
    [consignments, creditDaysOption, creditDayPresets, deliveryOffice, particulars, totalFreight]
  );

  const handleSelectConsignorEntity = (found: Party) => {
    setConsignorName(found.name);
    setSelectedConsignorId(found.id);
    setConsignorAddress(found.address || '');
    setConsignorGstin(found.gstin || '');
    applyRouteSmartAutoFill(billingPartyName || found.name, toCity);
  };

  const handleSelectConsignor = (name: string) => {
    setConsignorName(name);
    const clean = name.trim().toLowerCase();
    const matches = billingCustomerParties.filter((p) => p.name.trim().toLowerCase() === clean);
    if (matches.length === 1) {
      handleSelectConsignorEntity(matches[0]);
      return;
    }
    setSelectedConsignorId('');
    applyRouteSmartAutoFill(billingPartyName || name, toCity);
  };

  const handleSelectConsigneeEntity = (found: Party) => {
    setConsigneeName(found.name);
    setSelectedConsigneeId(found.id);
    setConsigneeAddress(found.address || '');
    setConsigneeGstin(found.gstin || '');
  };

  const handleSelectConsignee = (name: string) => {
    setConsigneeName(name);
    const clean = name.trim().toLowerCase();
    const matches = billingCustomerParties.filter((p) => p.name.trim().toLowerCase() === clean);
    if (matches.length === 1) {
      handleSelectConsigneeEntity(matches[0]);
      return;
    }
    setSelectedConsigneeId('');
  };

  const handleSelectVehicleEntity = (found: Vehicle) => {
    const upper = found.truckNo.toUpperCase();
    setTruckNo(upper);
    setSelectedVehicleId(found.id);
    setEngineNo(found.engineNo || '');
    setChassisNo(found.chassisNo || '');
    setOwnerName(found.ownerName || '');
    const ownerMatches = ownerAndBrokerParties.filter(
      (p) => p.name.trim().toLowerCase() === (found.ownerName || '').trim().toLowerCase()
    );
    setSelectedOwnerId(ownerMatches.length === 1 ? ownerMatches[0].id : '');
    const lastTrip = [...consignments]
      .filter((c) => c.truckNo?.toUpperCase() === upper)
      .sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''))[0];
    if (lastTrip) {
      if (lastTrip.driverName) {
        const drvNameLower = (lastTrip.driverName || '').trim().toLowerCase();
        const drvMatch = drivers.find(
          (d) => d.name.trim().toLowerCase() === drvNameLower
        );
        setDriverName(lastTrip.driverName);
        setDriverDlNo(lastTrip.driverDlNo || drvMatch?.dlNo || '');
        setDriverDlExpiry(lastTrip.driverDlExpiry || drvMatch?.dlExpiry || '');
        setDriverMobile(lastTrip.driverMobile || drvMatch?.phone || '');
        setSelectedDriverId(drvMatch?.id || '');
      }
    }
  };

  const handleSelectVehicle = (tNo: string) => {
    const upper = tNo.toUpperCase();
    setTruckNo(upper);
    const matches = vehicles.filter((v) => v.truckNo.trim().toUpperCase() === upper.trim());
    if (matches.length === 1) {
      handleSelectVehicleEntity(matches[0]);
      return;
    }
    setSelectedVehicleId('');
    const lastTrip = [...consignments]
      .filter((c) => c.truckNo?.toUpperCase() === upper.trim())
      .sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''))[0];
    if (lastTrip && lastTrip.driverName) {
      const drvNameLower = (lastTrip.driverName || '').trim().toLowerCase();
      const drvMatch = drivers.find(
        (d) => d.name.trim().toLowerCase() === drvNameLower
      );
      setDriverName(lastTrip.driverName);
      setDriverDlNo(lastTrip.driverDlNo || drvMatch?.dlNo || '');
      setDriverDlExpiry(lastTrip.driverDlExpiry || drvMatch?.dlExpiry || '');
      setDriverMobile(lastTrip.driverMobile || drvMatch?.phone || '');
      setSelectedDriverId(drvMatch?.id || '');
    }
  };

  const handleSelectDriverEntity = (found: Driver) => {
    setDriverName(found.name);
    setSelectedDriverId(found.id);
    setDriverDlNo(found.dlNo || '');
    setDriverDlExpiry(found.dlExpiry || '');
    setDriverMobile(found.phone || '');
  };

  const handleSelectDriver = (name: string) => {
    setDriverName(name);
    const clean = name.trim().toLowerCase();
    const matches = drivers.filter((d) => d.name.trim().toLowerCase() === clean);
    if (matches.length === 1) {
      handleSelectDriverEntity(matches[0]);
      return;
    }
    setSelectedDriverId('');
  };

  const handleAddBillingPartyOption = async (partyName: string) => {
    const clean = partyName.trim();
    if (!clean) return;
    const exists = parties.some((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (exists) return;
    await upsertDocument(
      'parties',
      makeSafeDocId('party'),
      {
        name: clean,
        partyType: 'Customer',
        address: '',
        gstin: '',
        pan: '',
        phone: '',
        email: '',
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Dr',
        ownerUid,
      },
      true
    );
  };

  const recomputeTotalFreight = (
    nextRateMode: string,
    nextRateStr: string,
    nextNettWtStr: string,
    nextChargedWtStr: string,
    nextOtherStr: string,
    nextLoadingStr: string,
    nextUnloadingStr: string,
    nextReturnStr: string,
    nextSttStr: string,
    nextPaidStr: string
  ) => {
    const rateNum = Number(nextRateStr) || 0;
    const wt = Number(nextChargedWtStr) || Number(nextNettWtStr) || Number(grossWeight) || 0;
    const extras =
      (Number(nextOtherStr) || 0) +
      (Number(nextLoadingStr) || 0) +
      (Number(nextUnloadingStr) || 0) +
      (Number(nextReturnStr) || 0) +
      (Number(nextSttStr) || 0);
    if (rateNum > 0) {
      const base = computeRateModeAmount({
        rateMode: nextRateMode,
        ratePerUnit: rateNum,
        weightMt: wt,
        packages: Number(packages) || 0,
      });
      const calc = Math.round((base + extras) * 100) / 100;
      setTotalFreight(String(calc));
      setToPayAmount(String(Math.max(0, calc - (Number(nextPaidStr) || 0))));
      setHighlightFreightWarning(false);
    }
  };

  const resetForm = () => {
    cnNoDirtyRef.current = false;
    setEditingId(null);
    setEditingBilled(false);
    setDivision('FTL');
    setAutoAtomicCn(true);
    setCnNo(nextSequentialCnNo);
    setCnDate(todayISO());
    setDeliveryOffice('');
    setDeliveryType('Party Delivery');
    setFreightMode('To Pay');
    setOriginGstStateCode('19');
    setDestGstStateCode('');
    setStockTransfer(false);
    setBillingPartyName('');
    setSelectedBillingPartyId('');
    setCreditDaysOption('');
    setCustomCreditDays('');
    setValidationError(null);
    setConsignorName('');
    setSelectedConsignorId('');
    setConsignorAddress('');
    setConsignorGstin('');
    setConsigneeName('');
    setSelectedConsigneeId('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setPackages('');
    setPackageMode('NOS');
    setParticulars('');
    setMultiGoodsItems([]);
    setHasMultiWeight(false);
    setMultiWeights([]);
    setRateMode('Fixed Lorry Freight (Lump Sum)');
    setRatePerUnit('');
    setNettWeight('0');
    setGrossWeight('0');
    setChargedWeight('0');
    setLoadingCharge('0');
    setUnloadingCharge('0');
    setReturnLorryCharge('0');
    setSttCharge('0');
    setOtherCharge('0');
    setTotalFreight('0');
    setHighlightFreightWarning(false);
    setPaidAmount('0');
    setToPayAmount('0');
    setHasVehicleNo(true);
    setHasTaxInvoice(true);
    setHasMultiEwayBill(false);
    setHasMultiVehicle(false);
    setTaxInvNo('');
    setTaxInvDate('');
    setEwayBillNo('');
    setEwayBillDate('');
    setEwayBillValidUpto('');
    setEwbTrackerMsg(null);
    setExtraTaxInvoices([]);
    setExtraEwayBills([]);
    setExtraVehicles([]);
    setValueOfGoods('0');
    setTruckNo('');
    setSelectedVehicleId('');
    setFromState('19 - West Bengal');
    setFromDistrict('Kolkata');
    setFromCity('KOLKATA');
    setFromPinCode('700001');
    setFromCountry('India');
    setToState('');
    setToDistrict('');
    setToCity('');
    setToPinCode('');
    setToCountry('India');
    setConsignorPinCode('');
    setConsignorCountry('India');
    setConsigneePinCode('');
    setConsigneeCountry('India');
    setEwayPlace('');
    setEwayPinCode('');
    setEngineNo('');
    setChassisNo('');
    setOwnerName('');
    setSelectedOwnerId('');
    setBrokerName('');
    setSelectedBrokerId('');
    setDriverName('');
    setSelectedDriverId('');
    setDriverDlNo('');
    setDriverDlExpiry('');
    setDriverMobile('');
    setDeliveryModeCode('P');
    setGstPaidByCode('E');
    setGstPaidBy('Consignee');
    setRiskTakenBy('O');
    setBillToPartyFlag(false);
    setInsurancePolicyNo('');
    setInsurancePolicyDate('');
    setInsuranceAmount('0');
    setHasMultiInsurance(false);
    setExtraInsurances([]);
    setInsuranceStatus('The Customer has not insured the consignment');
    setRemarks('');
    setScannedLrDataUrl('');
    setOcrMissingFields([]);
    setOcrFyMismatch(null);
    void deleteIdbObject('drc_draft_lr_ftl_v1');
  };

  const handleLoadForEdit = (cn: ConsignmentNote) => {
    if (!isMasterAdmin && cn.billed) return;
    setEditingId(cn.id);
    setEditingBilled(Boolean(cn.billed));
    setDivision(cn.division === 'LOGISTICS' ? 'LOGISTICS' : 'FTL');
    if (cn.billedAtBranch) setBilledAtBranch(cn.billedAtBranch);
    setAutoAtomicCn(false);
    setCnNo(cn.cnNo);
    setCnDate(cn.cnDate || todayISO());
    setDeliveryOffice(cn.deliveryOffice || '');
    setStockTransfer(Boolean(cn.stockTransfer));
    setBillingPartyName(cn.billingPartyName || cn.consignorName || '');
    if (cn.creditDays && cn.creditDays > 0) {
      if (creditDayPresets.includes(cn.creditDays)) {
        setCreditDaysOption(String(cn.creditDays));
        setCustomCreditDays('');
      } else {
        setCreditDaysOption('custom');
        setCustomCreditDays(String(cn.creditDays));
      }
    } else {
      setCreditDaysOption('');
      setCustomCreditDays('');
    }
    setValidationError(null);
    setConsignorName(cn.consignorName || '');
    setConsignorAddress(cn.consignorAddress || '');
    setConsignorPinCode(cn.consignorPinCode || '');
    setConsignorCountry((cn.consignorCountry as SupportedCountry) || 'India');
    setConsignorGstin(cn.consignorGstin || '');
    setConsigneeName(cn.consigneeName || '');
    setConsigneeAddress(cn.consigneeAddress || '');
    setConsigneePinCode(cn.consigneePinCode || '');
    setConsigneeCountry((cn.consigneeCountry as SupportedCountry) || 'India');
    setConsigneeGstin(cn.consigneeGstin || '');
    setPackages(cn.packages || '');
    setPackageMode(cn.packageMode || 'NOS');
    setParticulars(cn.particulars || '');
    setMultiGoodsItems(cn.multiGoodsItems || []);
    setHasMultiWeight(Boolean(cn.multiWeights && cn.multiWeights.length > 0));
    setMultiWeights(cn.multiWeights || []);
    setRateMode(cn.rateMode || 'Fixed Lorry Freight (Lump Sum)');
    setRatePerUnit(cn.ratePerUnit ? String(cn.ratePerUnit) : '');
    setNettWeight(String(cn.nettWeight ?? 0));
    setGrossWeight(String(cn.grossWeight ?? 0));
    setChargedWeight(String(cn.chargedWeight ?? cn.nettWeight ?? 0));
    setLoadingCharge(String(cn.loadingCharge ?? 0));
    setUnloadingCharge(String(cn.unloadingCharge ?? 0));
    setReturnLorryCharge(String(cn.returnLorryCharge ?? 0));
    setSttCharge(String(cn.sttCharge ?? 0));
    setOtherCharge(String(cn.otherCharge ?? 0));
    setTotalFreight(String(cn.totalFreight ?? 0));
    setPaidAmount(String(cn.paidAmount ?? 0));
    setToPayAmount(String(cn.toPayAmount ?? 0));
    setHasVehicleNo(cn.hasVehicleNo !== false && Boolean(cn.truckNo));
    setHasTaxInvoice(cn.hasTaxInvoice !== false);
    setHasMultiEwayBill(Boolean(cn.hasMultiEwayBill || (cn.extraEwayBills && cn.extraEwayBills.length > 0)));
    setHasMultiVehicle(Boolean(cn.hasMultiVehicle || (cn.extraVehicles && cn.extraVehicles.length > 0)));
    setTaxInvNo(cn.taxInvNo || '');
    setTaxInvDate(cn.taxInvDate || '');
    setEwayBillNo(cn.ewayBillNo || '');
    setEwayBillDate(cn.ewayBillDate || '');
    setEwayBillValidUpto(cn.ewayBillValidUpto || '');
    setEwayPlace(cn.ewayPlace || '');
    setEwayPinCode(cn.ewayPinCode || '');
    setEwbTrackerMsg(null);
    setExtraTaxInvoices(cn.extraTaxInvoices || []);
    setExtraEwayBills(cn.extraEwayBills || []);
    setExtraVehicles(cn.extraVehicles || []);
    setValueOfGoods(String(cn.valueOfGoods ?? 0));
    setTruckNo(cn.truckNo || '');
    setFromState(cn.fromState || '19 - West Bengal');
    setFromDistrict(cn.fromDistrict || 'Kolkata');
    setFromCity(cn.fromCity || 'KOLKATA');
    setFromPinCode(cn.fromPinCode || '');
    setFromCountry((cn.fromCountry as SupportedCountry) || 'India');
    setToState(cn.toState || '');
    setToDistrict(cn.toDistrict || '');
    setToCity(cn.toCity || '');
    setToPinCode(cn.toPinCode || '');
    setToCountry((cn.toCountry as SupportedCountry) || 'India');
    setEngineNo(cn.engineNo || '');
    setChassisNo(cn.chassisNo || '');
    setOwnerName(cn.ownerName || '');
    setBrokerName(cn.brokerName || '');
    setDriverName(cn.driverName || '');
    setDriverDlNo(cn.driverDlNo || '');
    setDriverDlExpiry(cn.driverDlExpiry || '');
    setDriverMobile(cn.driverMobile || '');
    setDeliveryModeCode(((cn.deliveryModeCode || 'P') as 'P' | 'G' | 'D'));
    setDeliveryType(
      (cn.deliveryType ||
        (cn.deliveryModeCode === 'D'
          ? 'Door Delivery'
          : cn.deliveryModeCode === 'G'
            ? 'Godown Delivery'
            : 'Party Delivery')) as
        | 'Door Delivery'
        | 'Port Delivery'
        | 'Party Delivery'
        | 'Godown Delivery'
    );
    setFreightMode(
      (cn.freightMode ||
        (cn.billToPartyFlag
          ? 'To Be Billed'
          : Number(cn.paidAmount || 0) > 0 && Number(cn.toPayAmount || 0) === 0
            ? 'Paid'
            : 'To Pay')) as 'To Pay' | 'Paid' | 'To Be Billed'
    );
    setOriginGstStateCode(
      cn.originGstStateCode ||
        inferGstStateCodeAndName({
          gstin: cn.consignorGstin || '',
          state: cn.fromState || '',
          city: cn.fromCity || '',
        }).code ||
        '19'
    );
    setDestGstStateCode(
      cn.destGstStateCode ||
        inferGstStateCodeAndName({
          gstin: cn.consigneeGstin || '',
          state: cn.toState || '',
          city: cn.toCity || '',
        }).code ||
        ''
    );
    const rawGst = String(cn.gstPaidBy || 'Consignee').trim();
    setGstPaidBy(rawGst.startsWith('Consignee') ? 'Consignee' : rawGst);
    setGstPaidByCode(
      ((cn.gstPaidByCode ||
        (rawGst.toLowerCase().includes('consignor')
          ? 'R'
          : rawGst.toLowerCase().includes('transporter')
            ? 'T'
            : 'E')) as 'E' | 'R' | 'T')
    );
    setRiskTakenBy(((cn.riskTakenBy || 'O') as 'O' | 'C' | 'I'));
    setBillToPartyFlag(Boolean(cn.billToPartyFlag));
    setInsurancePolicyNo(cn.insurancePolicyNo || '');
    setInsurancePolicyDate(cn.insurancePolicyDate || '');
    setInsuranceAmount(String(cn.insuranceAmount ?? 0));
    setHasMultiInsurance(Boolean(cn.extraInsurances && cn.extraInsurances.length > 0));
    setExtraInsurances(cn.extraInsurances || []);
    setInsuranceStatus(cn.insuranceStatus || 'The Customer has not insured the consignment');
    setRemarks(cn.remarks || '');
    setScannedLrDataUrl(cn.scannedLrDataUrl || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validateMandatoryFields = (): boolean => {
    if (!billingPartyName.trim()) {
      setValidationError(
        'LOCKED: Select a Mandatory "Billing Party" before saving, previewing, or billing this Consignment Note.'
      );
      return false;
    }
    if (!resolvedCreditDays || resolvedCreditDays <= 0) {
      setValidationError(
        'LOCKED: Select Mandatory "Payment Credit Days" (10, 15, 20, 30, or custom days) before proceeding.'
      );
      return false;
    }
    if (consignorGstin.trim()) {
      const c1 = validateIndianGstin(consignorGstin);
      if (!c1.valid) {
        playAlertBeep();
        setValidationError(`Blocked: Consignor GSTIN invalid — ${c1.error}`);
        return false;
      }
    }
    if (consigneeGstin.trim()) {
      const c2 = validateIndianGstin(consigneeGstin);
      if (!c2.valid) {
        playAlertBeep();
        setValidationError(`Blocked: Consignee GSTIN invalid — ${c2.error}`);
        return false;
      }
    }
    setValidationError(null);
    return true;
  };

  const buildPayload = (resolvedCnNo?: string): Omit<ConsignmentNote, 'id' | 'createdAt' | 'updatedAt'> => ({
    cnNo: (resolvedCnNo || cnNo).trim().slice(0, 40),
    cnDate,
    financialYear: normalizeFyLabel(activeFy),
    division,
    billedAtBranch: billedAtBranch.trim().slice(0, 80),
    deliveryOffice: deliveryOffice.trim().slice(0, 200),
    deliveryType,
    freightMode,
    originGstStateCode: originGstStateCode.trim().slice(0, 10),
    destGstStateCode: destGstStateCode.trim().slice(0, 10),
    stockTransfer,
    billingPartyName: billingPartyName.trim().slice(0, 180),
    billToPartyFlag,
    creditDays: resolvedCreditDays,
    consignorName: consignorName.trim().slice(0, 180),
    consignorAddress: consignorAddress.trim().slice(0, 350),
    consignorPinCode: consignorPinCode.trim(),
    consignorCountry,
    consignorGstin: consignorGstin.trim().slice(0, 24),
    consigneeName: consigneeName.trim().slice(0, 180),
    consigneeAddress: consigneeAddress.trim().slice(0, 350),
    consigneePinCode: consigneePinCode.trim(),
    consigneeCountry,
    consigneeGstin: consigneeGstin.trim().slice(0, 24),
    packages: packages.trim().slice(0, 40),
    packageMode: packageMode.trim().slice(0, 60),
    particulars:
      packageMode === 'MULTI' && multiGoodsItems.length > 0 && !particulars.trim()
        ? multiGoodsItems
            .map((g) => `${g.packages || 1} ${g.packageMode || ''} ${g.description}`.trim())
            .filter(Boolean)
            .join('; ')
            .slice(0, 400)
        : particulars.trim().slice(0, 400),
    ...(multiGoodsItems.length > 0
      ? {
          multiGoodsItems: multiGoodsItems
            .filter((g) => g.description.trim() || Number(g.packages) > 0)
            .slice(0, 50)
            .map((g) => ({
              description: g.description.trim().slice(0, 140),
              packages: Number(g.packages) || 0,
              packageMode: (g.packageMode || 'NOS').trim().slice(0, 40),
              weightKg: Number(g.weightKg) || 0,
              ...(g.hsnCode ? { hsnCode: g.hsnCode.trim().slice(0, 20) } : {}),
            })),
        }
      : {}),
    ...(hasMultiWeight && multiWeights.length > 0
      ? {
          multiWeights: multiWeights
            .filter((w) => Number(w.actualWeightKg) > 0 || Number(w.chargedWeightKg) > 0)
            .slice(0, 50)
            .map((w) => ({
              label: (w.label || 'Lot').trim().slice(0, 80),
              actualWeightKg: Number(w.actualWeightKg) || 0,
              grossWeightKg: Number(w.grossWeightKg) || 0,
              chargedWeightKg: Number(w.chargedWeightKg) || 0,
            })),
        }
      : {}),
    rateMode: rateMode.trim().slice(0, 80),
    ratePerUnit: Number(ratePerUnit) || 0,
    nettWeight: Number(nettWeight) || 0,
    grossWeight: Number(grossWeight) || 0,
    chargedWeight: Number(chargedWeight) || Number(nettWeight) || 0,
    loadingCharge: Number(loadingCharge) || 0,
    unloadingCharge: Number(unloadingCharge) || 0,
    returnLorryCharge: Number(returnLorryCharge) || 0,
    sttCharge: Number(sttCharge) || 0,
    otherCharge: Number(otherCharge) || 0,
    totalFreight: Number(totalFreight) || 0,
    paidAmount: Number(paidAmount) || 0,
    toPayAmount: Number(toPayAmount) || 0,
    hasVehicleNo,
    hasTaxInvoice,
    hasMultiEwayBill,
    hasMultiVehicle: hasVehicleNo && hasMultiVehicle,
    taxInvNo: hasTaxInvoice ? taxInvNo.trim().slice(0, 80) : '',
    taxInvDate: hasTaxInvoice ? taxInvDate.trim().slice(0, 20) : '',
    ewayBillNo: ewayBillNo.trim().slice(0, 60),
    ewayBillDate: ewayBillDate.trim().slice(0, 20),
    ewayBillValidUpto: ewayBillValidUpto.trim().slice(0, 30),
    ewayPlace: ewayPlace.trim().slice(0, 120),
    ewayPinCode: ewayPinCode.trim().slice(0, 10),
    extraTaxInvoices: hasTaxInvoice
      ? extraTaxInvoices
          .filter((x) => x.no.trim())
          .map((x) => ({ no: x.no.trim(), date: x.date.trim(), value: Number(x.value) || 0 }))
      : [],
    extraEwayBills: hasMultiEwayBill
      ? extraEwayBills
          .filter((x) => x.no.trim())
          .map((x) => ({
            no: x.no.trim(),
            date: x.date.trim(),
            ...(x.validUpto ? { validUpto: x.validUpto.trim() } : {}),
          }))
      : [],
    extraVehicles:
      hasVehicleNo && hasMultiVehicle
        ? extraVehicles.map((v) => v.trim().toUpperCase()).filter(Boolean)
        : [],
    valueOfGoods: Number(valueOfGoods) || 0,
    truckNo: hasVehicleNo ? truckNo.trim().toUpperCase().slice(0, 30) : '',
    fromState: fromState.trim().slice(0, 80),
    fromDistrict: fromDistrict.trim().slice(0, 80),
    fromCity: (fromCity || fromDistrict).trim().slice(0, 120),
    fromPinCode: fromPinCode.trim(),
    fromCountry,
    toState: toState.trim().slice(0, 80),
    toDistrict: toDistrict.trim().slice(0, 80),
    toCity: (toCity || toDistrict).trim().slice(0, 120),
    toPinCode: toPinCode.trim(),
    toCountry,
    engineNo: hasVehicleNo ? engineNo.trim().slice(0, 40) : '',
    chassisNo: hasVehicleNo ? chassisNo.trim().slice(0, 40) : '',
    ownerName: hasVehicleNo ? ownerName.trim().slice(0, 140) : '',
    brokerName: brokerName.trim().slice(0, 140),
    driverName: hasVehicleNo ? driverName.trim().slice(0, 140) : '',
    driverDlNo: hasVehicleNo ? driverDlNo.trim().slice(0, 40) : '',
    driverDlExpiry: hasVehicleNo ? driverDlExpiry.trim().slice(0, 24) : '',
    driverMobile: hasVehicleNo ? driverMobile.trim().slice(0, 24) : '',
    deliveryModeCode,
    gstPaidByCode,
    gstPaidBy: gstPaidBy.slice(0, 40),
    riskTakenBy,
    insurancePolicyNo: insurancePolicyNo.trim().slice(0, 60),
    insurancePolicyDate: insurancePolicyDate.trim().slice(0, 24),
    insuranceAmount: Number(insuranceAmount) || 0,
    ...(hasMultiInsurance && extraInsurances.length > 0
      ? {
          extraInsurances: extraInsurances
            .filter((ins) => ins.policyNo.trim() || Number(ins.amount) > 0)
            .slice(0, 50)
            .map((ins) => ({
              policyNo: ins.policyNo.trim().slice(0, 60),
              policyDate: (ins.policyDate || '').trim().slice(0, 24),
              amount: Number(ins.amount) || 0,
            })),
        }
      : {}),
    insuranceStatus: insurancePolicyNo.trim()
      ? `Insured (Policy: ${insurancePolicyNo.trim()})`
      : insuranceStatus.slice(0, 80),
    remarks: remarks.trim().slice(0, 1200),
    scannedLrDataUrl: scannedLrDataUrl || '',
    billed: editingBilled,
    invoiceId: '',
    branchCode: activeBranchCode,
    createdByStaff: activeStaffCode,
    ownerUid,
  });

  const handleSave = async (e: React.FormEvent, andSendToBilling = false) => {
    e.preventDefault();
    if (!validateMandatoryFields()) return;
    if (
      (!autoAtomicCn && !cnNo.trim()) ||
      !consignorName.trim() ||
      !consigneeName.trim() ||
      (hasVehicleNo && !truckNo.trim())
    ) {
      setValidationError(
        hasVehicleNo
          ? 'Please fill mandatory C/N, Consignor, Consignee, and Primary Truck fields (or toggle Input Vehicle No? to No).'
          : 'Please fill mandatory C/N, Consignor, and Consignee fields.'
      );
      return;
    }
    setSaving(true);
    try {
      let finalCnNo = cnNo.trim();
      if (!editingId && autoAtomicCn && !cnNoDirtyRef.current) {
        const { formattedNo } = await reserveNextSerialNumber({
          type: 'cn',
          fy: activeFy,
          branchCode: activeBranchCode,
          staffCode: activeStaffCode,
          ownerUid,
        });
        finalCnNo =
          extractTrailingSerialNumber(nextSequentialCnNo) > extractTrailingSerialNumber(formattedNo)
            ? nextSequentialCnNo
            : formattedNo;
      }

      const id = editingId || makeSafeDocId('cn');
      const payload = buildPayload(finalCnNo);
      await upsertDocument('consignments', id, payload, !editingId);
      playVerifiedBeep();

      if (onAutoUploadPdfToDrive) {
        try {
          const pdf = await generateLR3CopyPDF({ id, ...payload }, company);
          void onAutoUploadPdfToDrive(pdf, 'LR_Copy');
        } catch {
          // Silent background upload fallback
        }
      }

      await logBranchActivity({
        action: editingId ? 'Updated LR / CN' : 'Created LR / CN',
        module: 'Consignment',
        docRefCode: finalCnNo,
        summary: `${consignorName.trim()} → ${(toCity || toDistrict).trim()} (Billed At: ${billedAtBranch} | Bill To: ${billingPartyName.trim()} · ${resolvedCreditDays}d) · ₹${formatINR(Number(totalFreight) || 0)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      await deleteIdbObject('drc_draft_lr_ftl_v1');
      resetForm();
      if (andSendToBilling) {
        onSendCnToInvoice({ id, ...payload });
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePrint4CopyCurrent = async () => {
    if (!validateMandatoryFields()) return;
    const tempCn: ConsignmentNote = {
      id: editingId || 'preview',
      ...buildPayload(),
    };
    const pdf = await generateLR3CopyPDF(tempCn, company, 'l', undefined, false);
    onPreviewPdf(pdf, 'LR Copy');
  };

  const handleShareCnPdf = useCallback(
    async (cn: ConsignmentNote, channel: 'whatsapp' | 'email') => {
      const targetParty = cn.billingPartyName || cn.consignorName || cn.consigneeName;
      const partyRec = parties.find(
        (p) => p.name.trim().toLowerCase() === (targetParty || '').trim().toLowerCase()
      );
      const pdf = await generateLR3CopyPDF(cn, company);
      const res = await sharePdfDirect({
        pdf,
        channel,
        phone: partyRec?.phone,
        email: partyRec?.email,
        partyName: targetParty,
        docNo: cn.cnNo,
        docLabel: 'LR',
        company,
      });
      setShareStatusMsg(res.message);
    },
    [parties, company]
  );

  const cnColumns = useMemo<Array<TableColumn<ConsignmentNote>>>(
    () => [
      {
        key: 'cnNo',
        header: 'C/N No',
        cellClassName: 'font-mono-num font-bold text-blue-800 whitespace-nowrap',
        render: (cn) => (
          <div>
            <span>{cn.cnNo}</span>
            {cn.division === 'LOGISTICS' && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px]">
                LOGISTICS
              </span>
            )}
            {cn.branchCode && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                {cn.branchCode}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'cnDate',
        header: 'Date',
        cellClassName: 'font-mono-num whitespace-nowrap',
        render: (cn) => formatDateDDMMYYYY(cn.cnDate),
      },
      {
        key: 'consignorName',
        header: 'Consignor',
        cellClassName: 'font-medium',
        render: (cn) => cn.consignorName,
      },
      {
        key: 'route',
        header: 'Route',
        cellClassName: 'whitespace-nowrap',
        render: (cn) => `${cn.fromCity} → ${cn.toCity}`,
      },
      {
        key: 'truckNo',
        header: 'Truck No',
        cellClassName: 'font-mono-num font-semibold whitespace-nowrap',
        render: (cn) => (
          <span>
            {cn.truckNo}
            {cn.extraVehicles && cn.extraVehicles.length > 0 && (
              <span className="ml-1 px-1 py-0.2 rounded bg-blue-50 text-blue-700 text-[10px]">
                +{cn.extraVehicles.length}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'totalFreight',
        header: 'Freight (₹)',
        align: 'right',
        cellClassName: 'font-mono-num font-bold',
        render: (cn) => formatINR(cn.totalFreight),
      },
      {
        key: 'billed',
        header: 'Status & EWB Tracker',
        cellClassName: 'whitespace-nowrap',
        render: (cn) => {
          const allEwbStates = [
            cn.ewayBillValidUpto,
            ...(cn.extraEwayBills || []).map((e) => e.validUpto),
          ]
            .map((dt) => getEwayBillExpiryState(dt))
            .filter((st) => st.status === 'expired' || st.status === 'expiringSoon');
          const ewbSt =
            allEwbStates.find((s) => s.status === 'expired') ||
            allEwbStates[0] ||
            getEwayBillExpiryState(cn.ewayBillValidUpto);
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span className={`font-semibold ${cn.billed ? 'text-emerald-700' : 'text-orange-700'}`}>
                {cn.billed ? 'Billed (Locked)' : 'Unbilled'}
              </span>
              {(ewbSt.status === 'expired' || ewbSt.status === 'expiringSoon') && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                    ewbSt.status === 'expired'
                      ? 'bg-red-600 text-white'
                      : 'bg-amber-400 text-slate-950'
                  }`}
                >
                  {ewbSt.label}
                </span>
              )}
              {cn.ewayBillNo && (
                <button
                  type="button"
                  onClick={() => downloadNicPartBJson(cn, company)}
                  className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-100 text-slate-800 text-[10px] font-bold cursor-pointer"
                  title="Download NIC Part-B Vehicle Update JSON"
                >
                  Part-B
                </button>
              )}
            </div>
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1.5',
        render: (cn) => {
          const staffLocked = !isMasterAdmin && cn.billed;
          return (
            <>
              <button
                type="button"
                onClick={async () => {
                  const pdf = await generateLR3CopyPDF(cn, company);
                  onPreviewPdf(pdf, 'LR Copy');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold cursor-pointer"
                title="Print Combined 4-Copy LR (Consignor, Consignee, Driver/Lorry, Office)"
              >
                <Printer className="w-3 h-3" />
                4-Copy
              </button>
              <button
                type="button"
                onClick={() => void handleShareCnPdf(cn, 'whatsapp')}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                title="Share Real LR PDF on WhatsApp"
              >
                <MessageSquare className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => void handleShareCnPdf(cn, 'email')}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                title="Share Real LR PDF via Email"
              >
                <Mail className="w-3 h-3" />
              </button>
                <button
                type="button"
                onClick={() => onSendCnToInvoice(cn)}
                disabled={readOnly}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold cursor-pointer disabled:opacity-40"
                title="Auto-paste into Tax Invoice"
              >
                <FilePlus2 className="w-3 h-3" />
                Bill
              </button>
              {staffLocked || readOnly ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-500 text-[10px] font-bold"
                  title={readOnly ? 'View-Only Access' : 'Billed LRs are locked for non-admin staff'}
                >
                  <Lock className="w-3 h-3" />
                  {readOnly ? 'View Only' : 'Locked'}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleLoadForEdit(cn)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold cursor-pointer"
                    title="Rectify / Edit LR"
                  >
                    <Edit3 className="w-3 h-3" />
                    Rectify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onShowConfirm({
                        title: `Delete Consignment ${cn.cnNo}?`,
                        description: `Delete LR ${cn.cnNo} (${cn.consignorName}) permanently?`,
                        confirmLabel: 'Delete LR',
                        variant: 'danger',
                        onConfirm: () => removeDocument('consignments', cn.id),
                      });
                    }}
                    className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </>
          );
        },
      },
    ],
    [company, isMasterAdmin, readOnly, onPreviewPdf, onSendCnToInvoice, onShowConfirm, handleShareCnPdf]
  );

  return (
    <div className="space-y-4">
      {/* Hidden File & Rear-Camera Inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleOCRFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleOCRFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* One-Tap Device Scanner + Ctrl+V Paste Banner */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-blue-700 shrink-0" />
            <span>One-Tap Device Scanner &amp; Smart OCR Auto-Fill (100% Editable)</span>
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Tap <strong>Scan Bill / Document</strong> (opens rear camera on Mobile, File / HP Ink Tank
            315 scanner on Windows PC), or press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono-num text-[10px]">Ctrl + V</kbd> to
            paste any clipped document image and auto-fill Party, Date, Goods, Weight, Inv/Challan &amp; Freight.
          </p>
          {ocrStatus && (
            <p className="text-xs text-emerald-700 font-semibold mt-1.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{ocrStatus}</span>
            </p>
          )}
          {usbStatus && (
            <p className="text-xs text-blue-800 font-semibold mt-1.5 flex items-center gap-1.5">
              <Usb className="w-3.5 h-3.5 shrink-0" />
              <span>{usbStatus}</span>
            </p>
          )}
          {shareStatusMsg && (
            <p className="text-xs text-emerald-800 font-semibold mt-1.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{shareStatusMsg}</span>
            </p>
          )}
          {ocrError && <p className="text-xs text-red-600 font-semibold mt-1.5">{ocrError}</p>}
          {ocrMissingFields.length > 0 && (
            <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-300 text-xs text-red-900 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                OCR Alert — Verify or Enter Unreadable/Missing Fields:{' '}
                <span className="underline">{ocrMissingFields.join(', ')}</span>
              </span>
              <button
                type="button"
                onClick={() => setOcrMissingFields([])}
                className="px-2 py-0.5 rounded bg-white border border-red-300 text-[10px] font-bold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
          {ocrFyMismatch && (
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                Scanned date ({formatDateDDMMYYYY(ocrFyMismatch.detectedDate)}) belongs to{' '}
                <strong>{ocrFyMismatch.detectedFy}</strong> (currently viewing {activeFy}).
              </span>
              <button
                type="button"
                onClick={() => {
                  onSwitchFy(ocrFyMismatch.detectedFy);
                  setOcrFyMismatch(null);
                }}
                className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer whitespace-nowrap"
              >
                Switch to {ocrFyMismatch.detectedFy}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={readOnly}
            onClick={handleOpenLiveCamera}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            <span>Live Camera Scan</span>
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={handleAutoUsbScannerProbe}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <Usb className="w-4 h-4" />
            <span>Auto USB Printer/Scanner</span>
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={handleOneTapScanClick}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-900 text-xs font-bold shadow-sm transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <Upload className="w-4 h-4 text-blue-700" />
            <span>Upload / Ctrl+V</span>
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="px-4 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs font-bold flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>VIEW-ONLY ACCESS: You can search and Print/Download 4-Copy LR PDFs, while Create/Edit/Delete are restricted by Admin.</span>
        </div>
      )}

      {/* Consignment Note Form */}
      <form
        onSubmit={handleSave}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold">
            {editingId
              ? `Editing Consignment Note: ${cnNo} (${activeFy})`
              : `New Consignment Note (Branch: ${activeBranchCode} · ${activeFy})`}
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <ExpiryAlertBadge
              vehicles={vehicles}
              drivers={drivers}
              consignments={consignments}
              lorryHires={lorryHires}
              filterTruckNo={truckNo.trim() || undefined}
              filterDriverName={driverName.trim() || undefined}
              draftVehicle={{
                truckNo,
                driverName,
                driverDlNo,
                driverDlExpiry,
                cnNo,
                ewayBillNo,
                ewayBillValidUpto,
              }}
              scopeLabel={truckNo.trim() ? truckNo.trim().toUpperCase() : 'LR / Fleet'}
              compact
            />
            <div className="w-40">
              <SearchableSelect
                ariaLabel="Division Selector"
                value={division}
                onChange={(val) => setDivision(val === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
                options={[
                  { value: 'FTL', label: 'FTL Division' },
                  { value: 'LOGISTICS', label: 'LOGISTICS Division' },
                ]}
                buttonClassName="py-1 text-[#0D47A1] font-extrabold"
              />
            </div>
            {!editingId && (
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoAtomicCn}
                  onChange={(e) => setAutoAtomicCn(e.target.checked)}
                />
                Auto Atomic CN Serial
              </label>
            )}
            <button
              type="button"
              disabled={readOnly}
              onClick={handleOneTapScanClick}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Scan Bill / Document
            </button>
            <button
              type="button"
              onClick={handlePrint4CopyCurrent}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Preview 4-Copy LR
            </button>
          </div>
        </div>

        {/* Mandatory Billing Party & Payment Credit Days Validation Lock Bar */}
        {validationError && (
          <div className="mx-4 mt-3 p-2.5 rounded-lg bg-red-50 border border-red-300 text-red-800 text-xs font-bold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-50/70 border border-amber-200 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <label className="font-bold text-slate-900">
                Mandatory Billing Party * <span className="text-[10px] text-amber-800">(Required before Save / Billing)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {consignorName.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setBillingPartyName(consignorName.trim());
                      setSelectedBillingPartyId(selectedConsignorId);
                      setValidationError(null);
                      applyRouteSmartAutoFill(consignorName.trim(), toCity);
                    }}
                    className="px-2 py-0.5 rounded bg-white border border-amber-300 hover:bg-amber-100 text-[10px] font-bold text-amber-900 cursor-pointer"
                  >
                    Use Consignor
                  </button>
                )}
                {consigneeName.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setBillingPartyName(consigneeName.trim());
                      setSelectedBillingPartyId(selectedConsigneeId);
                      setValidationError(null);
                      applyRouteSmartAutoFill(consigneeName.trim(), toCity);
                    }}
                    className="px-2 py-0.5 rounded bg-white border border-amber-300 hover:bg-amber-100 text-[10px] font-bold text-amber-900 cursor-pointer"
                  >
                    Use Consignee
                  </button>
                )}
                {billingPartyName.trim() &&
                  !parties.some(
                    (p) => p.name.trim().toLowerCase() === billingPartyName.trim().toLowerCase()
                  ) && (
                    <button
                      type="button"
                      onClick={() => handleAddBillingPartyOption(billingPartyName)}
                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-[10px] font-bold text-white cursor-pointer"
                    >
                      + Save to Customer Master
                    </button>
                  )}
              </div>
            </div>
            <RichEntityPicker<Party>
              ariaLabel="Mandatory Billing Party"
              value={billingPartyName}
              selectedId={selectedBillingPartyId}
              onChangeText={(val) => {
                setBillingPartyName(val);
                const matches = billingCustomerParties.filter(
                  (p) => p.name.trim().toLowerCase() === val.trim().toLowerCase()
                );
                setSelectedBillingPartyId(matches.length === 1 ? matches[0].id : '');
                if (val.trim()) setValidationError(null);
                applyRouteSmartAutoFill(val, toCity);
              }}
              onSelectEntity={(p) => {
                setBillingPartyName(p.name);
                setSelectedBillingPartyId(p.id);
                setValidationError(null);
                applyRouteSmartAutoFill(p.name, toCity);
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
              placeholder="Search Customer by Name, GSTIN, City, Address or Phone..."
              inputClassName={!billingPartyName.trim() ? 'border-amber-400' : 'border-emerald-400'}
              quickPreview={(() => {
                const clean = billingPartyName.trim().toLowerCase();
                if (!clean) return null;
                const matches = billingCustomerParties.filter(
                  (p) => p.name.trim().toLowerCase() === clean
                );
                const resolved =
                  (selectedBillingPartyId
                    ? billingCustomerParties.find((p) => p.id === selectedBillingPartyId)
                    : undefined) ||
                  (matches.length === 1 ? matches[0] : matches[0]);
                return (
                  <EntityQuickPreviewCard
                    kind="party"
                    party={resolved}
                    duplicateCount={matches.length}
                    ambiguousSelected={matches.length > 1 && !selectedBillingPartyId}
                  />
                );
              })()}
            />
          </div>

          <div>
            <label className="block font-bold text-slate-900 mb-1">
              Mandatory Payment Credit Days *
            </label>
            <div className="flex items-center gap-1.5">
              <SearchableSelect
                ariaLabel="Mandatory Payment Credit Days"
                value={creditDaysOption}
                onChange={(val) => {
                  setCreditDaysOption(val);
                  if (val) setValidationError(null);
                }}
                options={[
                  { value: '', label: '-- Select Credit Days --' },
                  ...creditDayPresets.map((days) => ({
                    value: String(days),
                    label: `${days} Days Credit`,
                  })),
                  { value: 'custom', label: 'Custom Days...' },
                ]}
                className="flex-1 min-w-0"
                buttonClassName={`font-bold ${
                  !resolvedCreditDays ? 'border-amber-400 text-amber-900' : 'border-emerald-400 text-emerald-900'
                }`}
              />
              {creditDaysOption === 'custom' && (
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={customCreditDays}
                  onChange={(e) => {
                    setCustomCreditDays(e.target.value);
                    if (Number(e.target.value) > 0) setValidationError(null);
                  }}
                  placeholder="Days"
                  className="w-20 px-2 py-1.5 rounded border border-blue-400 font-mono-num text-xs"
                />
              )}
            </div>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3.5 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Billed At (Branch Link) *
            </label>
            <EditableSearchSelect
              ariaLabel="Billed At Branch"
              value={billedAtBranch}
              onChange={setBilledAtBranch}
              options={branchDropdownOptions}
              placeholder="Kolkata / Varanasi / Jharkhand..."
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              C/N Number * <span className="text-[10px] font-normal text-blue-700">(Auto Last+1 · Editable)</span>
            </label>
            <input
              type="text"
              required
              value={cnNo}
              onChange={(e) => {
                cnNoDirtyRef.current = true;
                setAutoAtomicCn(false);
                setCnNo(e.target.value.toUpperCase());
              }}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-blue-900 bg-blue-50/40"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">C/N Date *</label>
            <input
              type="date"
              required
              value={cnDate}
              onChange={(e) => setCnDate(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="font-semibold text-slate-700">Delivery Office</label>
              <div className="inline-flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-600">Stock Transfer:</span>
                <YesNoSelect
                  ariaLabel="Stock Transfer (Yes/No)"
                  value={stockTransfer}
                  onChange={(next) => setStockTransfer(next)}
                />
              </div>
            </div>
            <EditableSearchSelect
              ariaLabel="Delivery Office"
              value={deliveryOffice}
              onChange={setDeliveryOffice}
              options={deliveryPlaceOptions}
              placeholder="Search Delivery Office / Border Hub..."
              onAddOption={(val) => addDropdownItem(ownerUid, company, 'deliveryPlaces', val)}
              onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'deliveryPlaces', oldV, newV)}
              onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'deliveryPlaces', val)}
            />
          </div>
        </div>
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignor Name *</label>
            <RichEntityPicker<Party>
              ariaLabel="Consignor Name"
              value={consignorName}
              selectedId={selectedConsignorId}
              onChangeText={(val) => handleSelectConsignor(val)}
              onSelectEntity={(p) => handleSelectConsignorEntity(p)}
              items={billingCustomerParties}
              getId={(p) => p.id}
              getValue={(p) => p.name}
              getSearchText={(p) =>
                `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''}`
              }
              renderTitle={(p) => p.name}
              renderBadge={(p) => p.partyType}
              renderDetails={(p) => formatPartyDetailsLine(p)}
              placeholder="Search Consignor by Name, GSTIN, City or Phone..."
              required
              quickPreview={(() => {
                const clean = consignorName.trim().toLowerCase();
                if (!clean) return null;
                const matches = billingCustomerParties.filter(
                  (p) => p.name.trim().toLowerCase() === clean
                );
                const resolved =
                  (selectedConsignorId
                    ? billingCustomerParties.find((p) => p.id === selectedConsignorId)
                    : undefined) ||
                  (matches.length === 1 ? matches[0] : matches[0]);
                return (
                  <EntityQuickPreviewCard
                    kind="party"
                    party={resolved}
                    duplicateCount={matches.length}
                    ambiguousSelected={matches.length > 1 && !selectedConsignorId}
                    compact
                  />
                );
              })()}
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignor Address (Auto-fills PIN &amp; Country)</label>
            <input
              type="text"
              value={consignorAddress}
              onChange={(e) => setConsignorAddress(e.target.value)}
              placeholder="City / Address (India, BD, Nepal, Bhutan)"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
          <div>
            <GstinInputField
              label="Consignor GSTIN"
              value={consignorGstin}
              onChange={setConsignorGstin}
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignee Name *</label>
            <RichEntityPicker<Party>
              ariaLabel="Consignee Name"
              value={consigneeName}
              selectedId={selectedConsigneeId}
              onChangeText={(val) => handleSelectConsignee(val)}
              onSelectEntity={(p) => handleSelectConsigneeEntity(p)}
              items={billingCustomerParties}
              getId={(p) => p.id}
              getValue={(p) => p.name}
              getSearchText={(p) =>
                `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''}`
              }
              renderTitle={(p) => p.name}
              renderBadge={(p) => p.partyType}
              renderDetails={(p) => formatPartyDetailsLine(p)}
              placeholder="Search Consignee by Name, GSTIN, City or Phone..."
              required
              quickPreview={(() => {
                const clean = consigneeName.trim().toLowerCase();
                if (!clean) return null;
                const matches = billingCustomerParties.filter(
                  (p) => p.name.trim().toLowerCase() === clean
                );
                const resolved =
                  (selectedConsigneeId
                    ? billingCustomerParties.find((p) => p.id === selectedConsigneeId)
                    : undefined) ||
                  (matches.length === 1 ? matches[0] : matches[0]);
                return (
                  <EntityQuickPreviewCard
                    kind="party"
                    party={resolved}
                    duplicateCount={matches.length}
                    ambiguousSelected={matches.length > 1 && !selectedConsigneeId}
                    compact
                  />
                );
              })()}
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignee Address (Auto-fills PIN &amp; Country)</label>
            <input
              type="text"
              value={consigneeAddress}
              onChange={(e) => setConsigneeAddress(e.target.value)}
              placeholder="City / Address (India, BD, Nepal, Bhutan)"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
          <div>
            <GstinInputField
              label="Consignee GSTIN"
              value={consigneeGstin}
              onChange={setConsigneeGstin}
            />
          </div>

          {/* All-India + Cross-Border Route Cascade (Origin & Destination States / Districts) */}
          <div className="md:col-span-3 p-3 rounded-lg bg-blue-50/50 border border-blue-200 grid grid-cols-1 md:grid-cols-6 gap-2.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">From State / Country</label>
              <EditableSearchSelect
                ariaLabel="From State or Country"
                value={fromState}
                onChange={(val) => {
                  setFromState(val);
                  setFromDistrict('');
                  const inf = inferGstStateCodeAndName({ state: val });
                  if (inf.code) setOriginGstStateCode(inf.code);
                }}
                options={stateOptions}
                placeholder="19 - West Bengal"
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'states', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'states', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'states', val)}
              />
              <div className="mt-1">
                <SearchableSelect
                  ariaLabel="Origin GST State Code"
                  value={originGstStateCode}
                  onChange={setOriginGstStateCode}
                  options={GST_STATE_CODE_OPTIONS.map((s) => ({ value: s.code, label: `GST ${s.label}` }))}
                  buttonClassName="text-[10px] py-1 font-mono-num"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">From District</label>
              <EditableSearchSelect
                ariaLabel="From District"
                value={fromDistrict}
                onChange={(val) => {
                  setFromDistrict(val);
                  if (val && (!fromCity || fromCity === 'KOLKATA')) {
                    setFromCity(val.split('(')[0].trim().toUpperCase());
                  }
                }}
                options={fromDistrictOptions}
                placeholder="Select Origin District..."
                onAddOption={(val) => upsertDistrictItem(ownerUid, company, fromState, { type: 'add', value: val })}
                onEditOption={(oldV, newV) => upsertDistrictItem(ownerUid, company, fromState, { type: 'edit', oldValue: oldV, newValue: newV })}
                onDeleteOption={(val) => upsertDistrictItem(ownerUid, company, fromState, { type: 'delete', value: val })}
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">From City / Town *</label>
              <input
                type="text"
                required
                value={fromCity}
                onChange={(e) => setFromCity(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
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
              <label className="block font-semibold text-slate-700 mb-1">To State / Country</label>
              <EditableSearchSelect
                ariaLabel="To State or Country"
                value={toState}
                onChange={(val) => {
                  setToState(val);
                  setToDistrict('');
                  const inf = inferGstStateCodeAndName({ state: val });
                  if (inf.code) setDestGstStateCode(inf.code);
                }}
                options={stateOptions}
                placeholder="Select State / Nepal / BD / Bhutan"
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'states', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'states', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'states', val)}
              />
              <div className="mt-1">
                <SearchableSelect
                  ariaLabel="Destination GST State Code"
                  value={destGstStateCode}
                  onChange={setDestGstStateCode}
                  options={GST_STATE_CODE_OPTIONS.map((s) => ({ value: s.code, label: `GST ${s.label}` }))}
                  buttonClassName="text-[10px] py-1 font-mono-num"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">To District / ICP</label>
              <EditableSearchSelect
                ariaLabel="To District"
                value={toDistrict}
                onChange={(val) => {
                  setToDistrict(val);
                  if (val) {
                    const nextCity = val.split('(')[0].trim().toUpperCase();
                    setToCity(nextCity);
                    applyRouteSmartAutoFill(billingPartyName || consignorName, nextCity);
                  }
                }}
                options={toDistrictOptions}
                placeholder="Select Destination District..."
                onAddOption={(val) => upsertDistrictItem(ownerUid, company, toState, { type: 'add', value: val })}
                onEditOption={(oldV, newV) => upsertDistrictItem(ownerUid, company, toState, { type: 'edit', oldValue: oldV, newValue: newV })}
                onDeleteOption={(val) => upsertDistrictItem(ownerUid, company, toState, { type: 'delete', value: val })}
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">To City / Destination *</label>
              <input
                type="text"
                required
                value={toCity}
                onChange={(e) => {
                  const nextCity = e.target.value;
                  setToCity(nextCity);
                  applyRouteSmartAutoFill(billingPartyName || consignorName, nextCity);
                }}
                placeholder="SILIGURI / BIRGUNJ / DHAKA"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
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
          </div>

          {/* Vehicles Toggle + Single/Multi-Lorry & Driver Auto-Fill */}
          <div className="md:col-span-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-slate-800">Input Vehicle No.?</span>
                  <YesNoSelect
                    ariaLabel="Input Vehicle No Yes or No"
                    value={hasVehicleNo}
                    onChange={(next) => setHasVehicleNo(next)}
                  />
                </div>
                {hasVehicleNo && (
                  <div className="inline-flex items-center gap-1.5">
                    <span className="font-bold text-slate-700">Multi-Lorry:</span>
                    <YesNoSelect
                      ariaLabel="Multi Lorry Yes or No"
                      value={hasMultiVehicle}
                      onChange={(next) => {
                        setHasMultiVehicle(next);
                        if (next && extraVehicles.length === 0) {
                          setExtraVehicles(['']);
                        }
                      }}
                    />
                  </div>
                )}
                <div className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-slate-700">Bill-To Party Flag [P]:</span>
                  <YesNoSelect
                    ariaLabel="Bill To Party Flag P"
                    value={billToPartyFlag}
                    onChange={setBillToPartyFlag}
                  />
                </div>
              </div>
              {!hasVehicleNo && (
                <span className="text-[11px] font-bold text-emerald-700">
                  Vehicle fields hidden — ready for instant save without Truck No.
                </span>
              )}
            </div>

            {hasVehicleNo && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Primary Truck No *</label>
                  <RichEntityPicker<Vehicle>
                    ariaLabel="Primary Truck No"
                    value={truckNo}
                    selectedId={selectedVehicleId}
                    onChangeText={(val) => handleSelectVehicle(val)}
                    onSelectEntity={(v) => handleSelectVehicleEntity(v)}
                    items={vehicles}
                    getId={(v) => v.id}
                    getValue={(v) => v.truckNo}
                    getSearchText={(v) =>
                      `${v.truckNo} ${v.ownerName || ''} ${v.vehicleMake || ''} ${v.bodyType || ''} ${v.vehicleType || ''} ${v.ownerPhone || ''}`
                    }
                    renderTitle={(v) => v.truckNo}
                    renderBadge={(v) => v.vehicleMake || v.bodyType || v.vehicleType || 'Truck'}
                    renderDetails={(v) => formatVehicleDetailsLine(v)}
                    placeholder="WB51B0800 — Search Truck, Owner, Make or Body..."
                    required={hasVehicleNo}
                    uppercase
                    inputClassName="font-mono-num"
                    quickPreview={(() => {
                      const clean = truckNo.trim().toUpperCase();
                      if (!clean) return null;
                      const resolved =
                        (selectedVehicleId
                          ? vehicles.find((v) => v.id === selectedVehicleId)
                          : undefined) ||
                        vehicles.find((v) => v.truckNo.trim().toUpperCase() === clean);
                      return <EntityQuickPreviewCard kind="vehicle" vehicle={resolved} />;
                    })()}
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Owner Name <span className="text-[10px] text-slate-500">(Vehicle Owner)</span>
                  </label>
                  <RichEntityPicker<Party>
                    ariaLabel="Owner Name"
                    value={ownerName}
                    selectedId={selectedOwnerId}
                    onChangeText={(val) => {
                      setOwnerName(val);
                      const clean = val.trim().toLowerCase();
                      const matches = ownerAndBrokerParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      setSelectedOwnerId(matches.length === 1 ? matches[0].id : '');
                    }}
                    onSelectEntity={(p) => {
                      setOwnerName(p.name);
                      setSelectedOwnerId(p.id);
                    }}
                    items={ownerAndBrokerParties}
                    getId={(p) => p.id}
                    getValue={(p) => p.name}
                    getSearchText={(p) =>
                      `${p.name} ${p.pan || ''} ${p.phone || ''} ${p.address || ''} ${p.partyType}`
                    }
                    renderTitle={(p) => p.name}
                    renderBadge={(p) => p.partyType}
                    renderDetails={(p) => formatPartyDetailsLine(p)}
                    placeholder="Search Lorry Owner..."
                    quickPreview={(() => {
                      const clean = ownerName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = ownerAndBrokerParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedOwnerId
                          ? ownerAndBrokerParties.find((p) => p.id === selectedOwnerId)
                          : undefined) ||
                        (matches.length === 1 ? matches[0] : matches[0]);
                      return (
                        <EntityQuickPreviewCard
                          kind="owner"
                          party={resolved}
                          duplicateCount={matches.length}
                          ambiguousSelected={matches.length > 1 && !selectedOwnerId}
                          compact
                        />
                      );
                    })()}
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Driver Name <span className="text-[10px] text-emerald-700">(Auto-Fills DL &amp; Mobile)</span>
                  </label>
                  <RichEntityPicker<Driver>
                    ariaLabel="Driver Name"
                    value={driverName}
                    selectedId={selectedDriverId}
                    onChangeText={(val) => handleSelectDriver(val)}
                    onSelectEntity={(d) => handleSelectDriverEntity(d)}
                    items={drivers}
                    getId={(d) => d.id}
                    getValue={(d) => d.name}
                    getSearchText={(d) => `${d.name} ${d.dlNo || ''} ${d.phone || ''}`}
                    renderTitle={(d) => d.name}
                    renderDetails={(d) => formatDriverDetailsLine(d)}
                    placeholder="Search Driver by Name, D/L No or Mobile..."
                    quickPreview={(() => {
                      const clean = driverName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = drivers.filter((d) => d.name.trim().toLowerCase() === clean);
                      const resolved =
                        (selectedDriverId
                          ? drivers.find((d) => d.id === selectedDriverId)
                          : undefined) ||
                        (matches.length === 1 ? matches[0] : matches[0]);
                      return (
                        <EntityQuickPreviewCard
                          kind="driver"
                          driver={resolved}
                          duplicateCount={matches.length}
                          compact
                        />
                      );
                    })()}
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Driver D/L No</label>
                  <input
                    type="text"
                    value={driverDlNo}
                    onChange={(e) => setDriverDlNo(e.target.value.toUpperCase())}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Driver D/L Validity</label>
                  <input
                    type="date"
                    value={driverDlExpiry}
                    onChange={(e) => setDriverDlExpiry(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Driver Mobile</label>
                  <input
                    type="text"
                    value={driverMobile}
                    onChange={(e) => setDriverMobile(e.target.value)}
                    placeholder="10-digit Mobile"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Searchable Broker Master + Short-Code Selectors [P/G/D], [R/E/T], [O/C/I] */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Broker (A-Z Broker Master)</label>
            <RichEntityPicker<Party>
              ariaLabel="Broker Name"
              value={brokerName}
              selectedId={selectedBrokerId}
              onChangeText={(val) => {
                setBrokerName(val);
                const matches = brokerMasterParties.filter(
                  (p) => p.name.trim().toLowerCase() === val.trim().toLowerCase()
                );
                setSelectedBrokerId(matches.length === 1 ? matches[0].id : '');
              }}
              onSelectEntity={(b) => {
                setBrokerName(b.name);
                setSelectedBrokerId(b.id);
              }}
              items={brokerMasterParties}
              getId={(b) => b.id}
              getValue={(b) => b.name}
              getSearchText={(b) => `${b.name} ${b.pan || ''} ${b.phone || ''} ${b.address || ''}`}
              renderTitle={(b) => b.name}
              renderBadge={(b) => b.pan || 'Broker'}
              renderDetails={(b) => formatPartyDetailsLine(b)}
              placeholder="Search Broker by Name, PAN or Mobile..."
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Delivery Type &amp; Risk [O / C / I]
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <SearchableSelect
                ariaLabel="Delivery Type"
                value={deliveryType}
                onChange={(val) => {
                  const next = (val || 'Party Delivery') as
                    | 'Door Delivery'
                    | 'Port Delivery'
                    | 'Party Delivery'
                    | 'Godown Delivery';
                  setDeliveryType(next);
                  setDeliveryModeCode(
                    next === 'Door Delivery' ? 'D' : next === 'Godown Delivery' ? 'G' : 'P'
                  );
                }}
                options={[
                  { value: 'Door Delivery', label: 'Door Delivery (D)' },
                  { value: 'Port Delivery', label: 'Port Delivery (P)' },
                  { value: 'Party Delivery', label: 'Party Delivery (P)' },
                  { value: 'Godown Delivery', label: 'Godown Delivery (G)' },
                ]}
              />
              <SearchableSelect
                ariaLabel="Risk Taken By O C I"
                value={riskTakenBy}
                onChange={(val) => setRiskTakenBy((val || 'O') as 'O' | 'C' | 'I')}
                options={RISK_TYPE_CODES.map((c) => ({ value: c.code, label: c.label }))}
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Freight Mode &amp; GST Paid By [R/E/T]</label>
            <div className="grid grid-cols-2 gap-1.5">
              <SearchableSelect
                ariaLabel="Freight Mode"
                value={freightMode}
                onChange={(val) => {
                  const next = (val || 'To Pay') as 'To Pay' | 'Paid' | 'To Be Billed';
                  setFreightMode(next);
                  if (next === 'Paid') {
                    setPaidAmount(totalFreight || '0');
                    setToPayAmount('0');
                    setBillToPartyFlag(false);
                  } else if (next === 'To Pay') {
                    setToPayAmount(totalFreight || '0');
                    setPaidAmount('0');
                    setBillToPartyFlag(false);
                  } else {
                    setBillToPartyFlag(true);
                  }
                }}
                options={[
                  { value: 'To Pay', label: 'To Pay' },
                  { value: 'Paid', label: 'Paid' },
                  { value: 'To Be Billed', label: 'To Be Billed' },
                ]}
              />
              <SearchableSelect
                ariaLabel="GST Paid By R E T"
                value={gstPaidByCode}
                onChange={(val) => {
                  const code = (val || 'E') as 'R' | 'E' | 'T';
                  setGstPaidByCode(code);
                  setGstPaidBy(code === 'R' ? 'Consignor' : code === 'T' ? 'Transporter' : 'Consignee');
                }}
                options={GST_PAID_BY_CODES.map((c) => ({ value: c.code, label: c.label }))}
              />
            </div>
          </div>

          {/* Package Count & Mode (Supports MULTI) */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              No. of Packages &amp; Packing Mode
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={packages}
                onChange={(e) => setPackages(e.target.value)}
                placeholder="400"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
              <EditableSearchSelect
                ariaLabel="Package Mode"
                value={packageMode}
                onChange={(val) => {
                  setPackageMode(val);
                  if (val === 'MULTI' && multiGoodsItems.length === 0) {
                    setMultiGoodsItems([{ description: particulars || '', packages: Number(packages) || 1, packageMode: 'BOXES', weightKg: 0 }]);
                  }
                }}
                options={packageModeOptions}
                placeholder="NOS / BOXES / MULTI..."
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'packageModes', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'packageModes', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'packageModes', val)}
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Goods Description / Particulars (All-India or MULTI)
            </label>
            <EditableSearchSelect
              ariaLabel="Non-Liquid Goods Description"
              value={particulars}
              onChange={(val) => {
                setParticulars(val);
                if (val === 'MULTI') {
                  setPackageMode('MULTI');
                  if (multiGoodsItems.length === 0) {
                    setMultiGoodsItems([{ description: '', packages: 1, packageMode: 'BOXES', weightKg: 0 }]);
                  }
                }
              }}
              options={goodsOptions}
              placeholder="Search Tea, Steel, Pipes, Machinery or MULTI..."
              onAddOption={(val) => addDropdownItem(ownerUid, company, 'goodsTypes', val)}
              onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'goodsTypes', oldV, newV)}
              onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'goodsTypes', val)}
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Weights — Actual / Gross / Charged (MT or Kg)
            </label>
            <div className="grid grid-cols-3 gap-1">
              <input
                type="number"
                step="0.001"
                value={nettWeight}
                onChange={(e) => {
                  const nextWt = e.target.value;
                  setNettWeight(nextWt);
                  if (!chargedWeight || chargedWeight === '0') setChargedWeight(nextWt);
                  recomputeTotalFreight(rateMode, ratePerUnit, nextWt, chargedWeight || nextWt, otherCharge, loadingCharge, unloadingCharge, returnLorryCharge, sttCharge, paidAmount);
                }}
                placeholder="Actual"
                title="Actual / Nett Weight"
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
              <input
                type="number"
                step="0.001"
                value={grossWeight}
                onChange={(e) => setGrossWeight(e.target.value)}
                placeholder="Gross"
                title="Gross Weight"
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
              <input
                type="number"
                step="0.001"
                value={chargedWeight}
                onChange={(e) => {
                  const cw = e.target.value;
                  setChargedWeight(cw);
                  recomputeTotalFreight(rateMode, ratePerUnit, nettWeight, cw, otherCharge, loadingCharge, unloadingCharge, returnLorryCharge, sttCharge, paidAmount);
                }}
                placeholder="Charged"
                title="Charged Weight"
                className="w-full px-2 py-1.5 rounded border border-blue-300 bg-blue-50/40 font-mono-num font-semibold"
              />
            </div>
          </div>

          {/* Dynamic Multi-Goods Table (when Package Mode / Goods = MULTI) */}
          {(packageMode === 'MULTI' || particulars === 'MULTI' || multiGoodsItems.length > 0) && (
            <div className="md:col-span-3 p-3 rounded-lg bg-indigo-50/60 border border-indigo-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-indigo-950">
                  Multi-Goods / Mixed Consignment Schedule ({multiGoodsItems.length} rows — up to 50 items)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setMultiGoodsItems((prev) =>
                      prev.length < 50
                        ? [...prev, { description: '', packages: 1, packageMode: 'BOXES', weightKg: 0 }]
                        : prev
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Item Row
                </button>
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {multiGoodsItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 bg-white p-1.5 rounded border border-indigo-100">
                    <input
                      type="number"
                      value={item.packages}
                      onChange={(e) =>
                        setMultiGoodsItems((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, packages: Number(e.target.value) || 0 } : r))
                        )
                      }
                      placeholder="Pkgs"
                      className="sm:col-span-2 px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <input
                      type="text"
                      value={item.packageMode}
                      onChange={(e) =>
                        setMultiGoodsItems((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, packageMode: e.target.value.toUpperCase() } : r))
                        )
                      }
                      placeholder="Mode (BOX/BAG)"
                      className="sm:col-span-2 px-2 py-1 rounded border border-slate-300 uppercase"
                    />
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) =>
                        setMultiGoodsItems((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r))
                        )
                      }
                      placeholder={`Item #${idx + 1} Description`}
                      className="sm:col-span-5 px-2 py-1 rounded border border-slate-300"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={item.weightKg}
                      onChange={(e) =>
                        setMultiGoodsItems((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, weightKg: Number(e.target.value) || 0 } : r))
                        )
                      }
                      placeholder="Wt (Kg)"
                      className="sm:col-span-2 px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <button
                      type="button"
                      onClick={() => setMultiGoodsItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="sm:col-span-1 text-red-600 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dynamic Multi-Weight Split Form (Mixed 1kg - 5,000kg) */}
          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
            <div className="inline-flex items-center gap-2">
              <span className="font-bold text-slate-800">Multi-Weight Schedule (Mixed 1 kg – 5,000 kg):</span>
              <YesNoSelect
                ariaLabel="Multi Weight Yes or No"
                value={hasMultiWeight}
                onChange={(next) => {
                  setHasMultiWeight(next);
                  if (next && multiWeights.length === 0) {
                    setMultiWeights([{ label: 'Lot 1', actualWeightKg: 0, grossWeightKg: 0, chargedWeightKg: 0 }]);
                  }
                }}
              />
            </div>
            {hasMultiWeight && (
              <button
                type="button"
                onClick={() =>
                  setMultiWeights((prev) => [
                    ...prev,
                    { label: `Lot ${prev.length + 1}`, actualWeightKg: 0, grossWeightKg: 0, chargedWeightKg: 0 },
                  ])
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 text-[11px] font-bold cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Add Weight Split
              </button>
            )}
          </div>
          {hasMultiWeight && multiWeights.length > 0 && (
            <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {multiWeights.map((mw, idx) => (
                <div key={idx} className="p-2 rounded border border-slate-300 bg-white space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <input
                      type="text"
                      value={mw.label}
                      onChange={(e) =>
                        setMultiWeights((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x))
                        )
                      }
                      placeholder="Lot / Size Label"
                      className="flex-1 text-xs font-semibold border-b border-slate-200 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMultiWeights((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-600 text-xs font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px]">
                    <input
                      type="number"
                      value={mw.actualWeightKg}
                      onChange={(e) =>
                        setMultiWeights((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, actualWeightKg: Number(e.target.value) || 0 } : x))
                        )
                      }
                      placeholder="Act Kg"
                      className="px-1.5 py-1 rounded border border-slate-200 font-mono-num"
                    />
                    <input
                      type="number"
                      value={mw.grossWeightKg}
                      onChange={(e) =>
                        setMultiWeights((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, grossWeightKg: Number(e.target.value) || 0 } : x))
                        )
                      }
                      placeholder="Grs Kg"
                      className="px-1.5 py-1 rounded border border-slate-200 font-mono-num"
                    />
                    <input
                      type="number"
                      value={mw.chargedWeightKg}
                      onChange={(e) =>
                        setMultiWeights((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, chargedWeightKg: Number(e.target.value) || 0 } : x))
                        )
                      }
                      placeholder="Chg Kg"
                      className="px-1.5 py-1 rounded border border-blue-200 font-mono-num font-bold"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rate Mode + Others Charge + Total Freight */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Rate Mode &amp; Rate (₹)</label>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="col-span-2">
                <EditableSearchSelect
                  ariaLabel="Rate Mode"
                  value={rateMode}
                  onChange={(nextMode) => {
                    setRateMode(nextMode);
                    recomputeTotalFreight(nextMode, ratePerUnit, nettWeight, chargedWeight, otherCharge, loadingCharge, unloadingCharge, returnLorryCharge, sttCharge, paidAmount);
                  }}
                  options={rateModeOptions}
                  placeholder="Fixed / Per MT / Per Kg"
                  onAddOption={(val) => addDropdownItem(ownerUid, company, 'rateModes', val)}
                  onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'rateModes', oldV, newV)}
                  onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'rateModes', val)}
                />
              </div>
              <input
                type="number"
                step="0.01"
                value={ratePerUnit}
                onChange={(e) => {
                  const r = e.target.value;
                  setRatePerUnit(r);
                  recomputeTotalFreight(rateMode, r, nettWeight, chargedWeight, otherCharge, loadingCharge, unloadingCharge, returnLorryCharge, sttCharge, paidAmount);
                }}
                placeholder="Rate ₹"
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Others Charge (₹) (+ Auto Total)</label>
            <input
              type="number"
              step="0.01"
              value={otherCharge}
              onChange={(e) => {
                const oth = e.target.value;
                setOtherCharge(oth);
                recomputeTotalFreight(rateMode, ratePerUnit, nettWeight, chargedWeight, oth, loadingCharge, unloadingCharge, returnLorryCharge, sttCharge, paidAmount);
              }}
              placeholder="0.00"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Total Freight Cost (₹) *
              {highlightFreightWarning && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-extrabold">
                  Domestic Blank — Enter Freight!
                </span>
              )}
            </label>
            <input
              ref={totalFreightInputRef}
              type="number"
              step="0.01"
              required
              value={totalFreight}
              onChange={(e) => {
                setTotalFreight(e.target.value);
                setHighlightFreightWarning(false);
                const f = Number(e.target.value) || 0;
                const p = Number(paidAmount) || 0;
                setToPayAmount(String(Math.max(0, f - p)));
              }}
              className={`w-full px-2.5 py-1.5 rounded font-mono-num font-bold transition-all ${
                highlightFreightWarning
                  ? 'border-2 border-red-600 bg-yellow-100 ring-2 ring-red-400 text-red-900'
                  : 'border border-slate-300 text-blue-800'
              }`}
            />
            <p className="mt-1 text-[10px] font-bold text-blue-900 bg-blue-50/80 border border-blue-200 rounded px-2 py-0.5">
              Freight in Words: {amountToIndianWords(Number(totalFreight) || 0)}
            </p>
          </div>

          {/* Attached Tax Invoice (Yes/No) + Multi E-Way Bill (Yes/No) */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="font-semibold text-slate-700">Attached Tax Inv. / Challan</label>
              <YesNoSelect
                ariaLabel="Attached Tax Invoice / Challan (Yes/No)"
                value={hasTaxInvoice}
                onChange={(next) => {
                  setHasTaxInvoice(next);
                  if (!next) {
                    setTaxInvNo('');
                    setTaxInvDate('');
                    setExtraTaxInvoices([]);
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                disabled={!hasTaxInvoice}
                value={hasTaxInvoice ? taxInvNo : 'NO TAX INV'}
                onChange={(e) => setTaxInvNo(e.target.value)}
                placeholder="Tax Invoice No"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num disabled:bg-slate-100 disabled:text-slate-500"
              />
              <input
                type="date"
                disabled={!hasTaxInvoice}
                value={taxInvDate}
                onChange={(e) => setTaxInvDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="md:col-span-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label className="font-bold text-slate-800">E-Way Bill Master Link ({autoAtomicCn && !editingId ? 'Auto CN' : cnNo})</label>
                {ewayBillValidUpto && (() => {
                  const st = getEwayBillExpiryState(ewayBillValidUpto);
                  return (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                        st.status === 'expired'
                          ? 'bg-red-600 text-white'
                          : st.status === 'expiringSoon'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {st.label}
                    </span>
                  );
                })()}
              </div>
              <div className="inline-flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEwbQrModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer"
                >
                  <QrCode className="w-3 h-3" />
                  Scan EWB QR
                </button>
                <button
                  type="button"
                  onClick={() => downloadNicPartBJson(buildPayload(), company)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-700 hover:bg-blue-800 text-white text-[10px] font-bold cursor-pointer"
                >
                  <FileCode2 className="w-3 h-3" />
                  Part-B JSON
                </button>
                <a
                  href="https://ewaybillgst.gov.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-300 bg-white hover:bg-blue-50 text-blue-800 text-[10px] font-bold"
                >
                  <span>NIC Portal</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
                <span className="text-[10px] font-bold text-slate-600 ml-1">Multi EWB (1-10+):</span>
                <YesNoSelect
                  ariaLabel="Multi E-Way Bill (Yes/No)"
                  value={hasMultiEwayBill}
                  onChange={(next) => {
                    setHasMultiEwayBill(next);
                    if (next && extraEwayBills.length === 0) {
                      setExtraEwayBills([{ no: '', date: ewayBillDate || todayISO(), validUpto: ewayBillValidUpto || '' }]);
                    }
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={ewayBillNo}
                onChange={(e) => setEwayBillNo(e.target.value)}
                placeholder="Primary 12-Digit EWB No"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
              <input
                type="date"
                aria-label="E-Way Bill Date"
                value={ewayBillDate}
                onChange={(e) => setEwayBillDate(e.target.value)}
                title="E-Way Bill Date"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
              <input
                type="datetime-local"
                aria-label="E-Way Bill Valid Upto"
                value={ewayBillValidUpto}
                onChange={(e) => setEwayBillValidUpto(e.target.value)}
                title="E-Way Bill Valid Upto Date & Time"
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={ewayPlace}
                onChange={(e) => setEwayPlace(e.target.value)}
                placeholder="EWB Dispatch / ICP Place (e.g. Petrapole / Jaigaon / Raxaul)"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs"
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={ewayPinCode}
                onChange={(e) => setEwayPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="EWB PIN (Auto-Filled 6-digit)"
                className="w-full px-2.5 py-1.5 rounded border border-emerald-400 bg-emerald-50/40 font-mono-num font-bold text-xs"
              />
            </div>
            {ewbTrackerMsg && (
              <p className="text-[11px] font-semibold text-emerald-800">{ewbTrackerMsg}</p>
            )}
          </div>

          {/* Insurance Details (Single + Multi) & Value of Goods */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Value of Goods (₹)</label>
            <input
              type="number"
              step="0.01"
              value={valueOfGoods}
              onChange={(e) => setValueOfGoods(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div className="md:col-span-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-800">Insurance Details (Policy No / Date / Amount)</span>
              <div className="inline-flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-600">Multi Insurance:</span>
                <YesNoSelect
                  ariaLabel="Multi Insurance Yes or No"
                  value={hasMultiInsurance}
                  onChange={(next) => {
                    setHasMultiInsurance(next);
                    if (next && extraInsurances.length === 0) {
                      setExtraInsurances([{ policyNo: '', policyDate: todayISO(), amount: 0 }]);
                    }
                  }}
                />
                {hasMultiInsurance && (
                  <button
                    type="button"
                    onClick={() =>
                      setExtraInsurances((prev) => [
                        ...prev,
                        { policyNo: '', policyDate: todayISO(), amount: 0 },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-300 text-blue-800 text-[10px] font-bold cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add Policy
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={insurancePolicyNo}
                onChange={(e) => setInsurancePolicyNo(e.target.value)}
                placeholder="Policy No (if insured)"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
              <input
                type="date"
                value={insurancePolicyDate}
                onChange={(e) => setInsurancePolicyDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
              <input
                type="number"
                step="0.01"
                value={insuranceAmount}
                onChange={(e) => setInsuranceAmount(e.target.value)}
                placeholder="Insured Value ₹"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            {hasMultiInsurance && extraInsurances.length > 0 && (
              <div className="space-y-1">
                {extraInsurances.map((ins, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-10 gap-1.5 bg-white p-1.5 rounded border border-slate-200">
                    <input
                      type="text"
                      value={ins.policyNo}
                      onChange={(e) =>
                        setExtraInsurances((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, policyNo: e.target.value } : x))
                        )
                      }
                      placeholder={`Policy #${idx + 2}`}
                      className="sm:col-span-4 px-2 py-1 rounded border border-slate-200 font-mono-num"
                    />
                    <input
                      type="date"
                      value={ins.policyDate || ''}
                      onChange={(e) =>
                        setExtraInsurances((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, policyDate: e.target.value } : x))
                        )
                      }
                      className="sm:col-span-3 px-2 py-1 rounded border border-slate-200 font-mono-num"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={ins.amount}
                      onChange={(e) =>
                        setExtraInsurances((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value) || 0 } : x))
                        )
                      }
                      placeholder="Amount ₹"
                      className="sm:col-span-2 px-2 py-1 rounded border border-slate-200 font-mono-num"
                    />
                    <button
                      type="button"
                      onClick={() => setExtraInsurances((prev) => prev.filter((_, i) => i !== idx))}
                      className="sm:col-span-1 text-red-600 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conditional Multi-Vehicle, Extra Tax Invoices & Multi-EWB Rows */}
          {(hasMultiVehicle || hasMultiEwayBill || hasTaxInvoice) && (
            <div className="md:col-span-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-800">
                  Expanded Multi-Items (Controlled by Yes/No Toggles Above)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {hasMultiVehicle && (
                    <button
                      type="button"
                      onClick={() => setExtraVehicles((prev) => [...prev, ''])}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add Vehicle
                    </button>
                  )}
                  {hasTaxInvoice && (
                    <button
                      type="button"
                      onClick={() =>
                        setExtraTaxInvoices((prev) => [...prev, { no: '', date: taxInvDate || todayISO() }])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add Extra Tax Inv
                    </button>
                  )}
                  {hasMultiEwayBill && (
                    <button
                      type="button"
                      onClick={() =>
                        setExtraEwayBills((prev) => [...prev, { no: '', date: ewayBillDate || todayISO() }])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add E-Way Bill
                    </button>
                  )}
                </div>
              </div>

              {hasMultiVehicle && extraVehicles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {extraVehicles.map((veh, idx) => (
                    <div key={idx} className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded px-2 py-1">
                      <input
                        type="text"
                        list="cn-vehicle-list"
                        value={veh}
                        onChange={(e) =>
                          setExtraVehicles((prev) =>
                            prev.map((v, i) => (i === idx ? e.target.value.toUpperCase() : v))
                          )
                        }
                        placeholder={`Truck #${idx + 2}`}
                        className="w-28 font-mono-num uppercase focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setExtraVehicles((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-red-600 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {hasTaxInvoice && extraTaxInvoices.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {extraTaxInvoices.map((inv, idx) => (
                    <div key={idx} className="flex items-center gap-1 bg-white border border-slate-300 rounded px-2 py-1">
                      <input
                        type="text"
                        value={inv.no}
                        onChange={(e) =>
                          setExtraTaxInvoices((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, no: e.target.value } : x))
                          )
                        }
                        placeholder={`Inv/Challan #${idx + 2}`}
                        className="flex-1 min-w-0 font-mono-num focus:outline-none"
                      />
                      <input
                        type="date"
                        value={inv.date}
                        onChange={(e) =>
                          setExtraTaxInvoices((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, date: e.target.value } : x))
                          )
                        }
                        className="w-28 font-mono-num text-[11px] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExtraTaxInvoices((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-red-600 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {hasMultiEwayBill && extraEwayBills.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {extraEwayBills.map((ewb, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-1 bg-white border border-slate-300 rounded px-2 py-1">
                      <input
                        type="text"
                        value={ewb.no}
                        onChange={(e) =>
                          setExtraEwayBills((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, no: e.target.value } : x))
                          )
                        }
                        placeholder={`EWB #${idx + 2}`}
                        className="flex-1 min-w-[90px] font-mono-num focus:outline-none"
                      />
                      <input
                        type="date"
                        value={ewb.date}
                        onChange={(e) =>
                          setExtraEwayBills((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, date: e.target.value } : x))
                          )
                        }
                        className="w-28 font-mono-num text-[11px] focus:outline-none"
                      />
                      <input
                        type="datetime-local"
                        value={ewb.validUpto || ''}
                        onChange={(e) =>
                          setExtraEwayBills((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, validUpto: e.target.value } : x))
                          )
                        }
                        title="Valid Upto"
                        className="w-36 font-mono-num text-[10px] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setExtraEwayBills((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-red-600 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Extra-Large Wide Remarks Box + A-to-Z Preset Picker */}
          <div className="md:col-span-3 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-bold text-slate-800">
                Remarks / Material &amp; Size Details &amp; Delivery Instructions (Prints Inside Wide LR Box)
              </label>
              <div className="w-64 max-w-full">
                <SearchableSelect
                  ariaLabel="Quick Remarks Preset"
                  value=""
                  onChange={(preset) => {
                    if (!preset) return;
                    setRemarks((prev) => (prev.trim() ? `${prev.trim()} | ${preset}` : preset));
                  }}
                  placeholder="+ Insert Remark Preset (A-Z)..."
                  searchPlaceholder="Search remarks A-Z..."
                  options={COMMON_REMARK_PRESETS}
                />
              </div>
            </div>
            <textarea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter detailed material size/dimensions, route instructions, delivery endorsements, detention terms, or special cargo notes..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-[11px] font-semibold text-slate-600">
            {!billingPartyName.trim() || !resolvedCreditDays
              ? 'Select Billing Party & Payment Credit Days above to unlock Save & Billing.'
              : `Ready: Bill To "${billingPartyName}" (${resolvedCreditDays} Days Credit)`}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Cancel Edit
              </button>
            ) : (
              filteredCNs.length > 0 && (
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    const target = filteredCNs.find((c) => isMasterAdmin || !c.billed);
                    if (target) handleLoadForEdit(target);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold cursor-pointer disabled:opacity-40"
                  title="Reload latest editable Consignment Note for Rectification (keeps serial no intact)"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Rectify Last</span>
                </button>
              )
            )}
            <button
              type="button"
              disabled={readOnly}
              onClick={handleOneTapScanClick}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold cursor-pointer disabled:opacity-50"
              title="Scan Physical LR / Document"
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Scan</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const snap: ConsignmentNote = { id: editingId || 'preview', ...buildPayload() };
                const pdf = await generateLR3CopyPDF(snap, company, 'l', undefined, true);
                onPreviewPdf(pdf, 'LR Copy');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
              title="Preview 1-Page A4 Landscape LR Copy"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const snap: ConsignmentNote = { id: editingId || 'preview', ...buildPayload() };
                const pdf = await generateLR3CopyPDF(snap, company, 'l', undefined, true);
                downloadPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold cursor-pointer"
              title="Download Low-KB 1-Page LR PDF (<= 350 KB)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Low-KB PDF</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const snap: ConsignmentNote = { id: editingId || 'preview', ...buildPayload() };
                const pdf = await generateLR3CopyPDF(snap, company, 'l', undefined, true);
                printPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
              title="Manual Print A4 Landscape LR Copy"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Manual Print</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!cnNo.trim() || !consignorName.trim()) {
                  setValidationError('Enter C/N No and Consignor Name before sharing LR PDF.');
                  return;
                }
                void handleShareCnPdf({ id: editingId || 'preview', ...buildPayload() }, 'whatsapp');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              title="Share Real LR PDF on WhatsApp"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp PDF</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!cnNo.trim() || !consignorName.trim()) {
                  setValidationError('Enter C/N No and Consignor Name before sharing LR PDF.');
                  return;
                }
                void handleShareCnPdf({ id: editingId || 'preview', ...buildPayload() }, 'email');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
              title="Share Real LR PDF via Email"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Email PDF</span>
            </button>
            <button
              type="button"
              disabled={saving || readOnly}
              onClick={(e) => void handleSave(e, true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Save &amp; Send to Bill</span>
            </button>
            <button
              type="submit"
              disabled={saving || readOnly}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Assigning Serial & Saving...' : editingId ? 'Update LR/CN' : 'Save LR/CN'}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Saved Consignments Table (Paginated 50 rows/page) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold">
            Saved Consignment Notes ({filteredCNs.length} · {activeFy})
          </span>
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-blue-100" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search CN No, Party, Truck..."
              className="px-2.5 py-1 rounded bg-white text-slate-900 text-xs w-52 focus:outline-none"
            />
          </div>
        </div>

        <PaginatedDataTable
          data={filteredCNs}
          columns={cnColumns}
          getRowId={(cn) => cn.id}
          defaultPageSize={50}
          emptyMessage="No consignment notes found in this Financial Year. Scan a physical document or fill the form above."
        />
      </div>

      {/* Live In-App WebRTC Camera Capture Modal */}
      {liveCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 no-print">
          <div className="w-full max-w-xl bg-white rounded-xl border border-slate-300 shadow-2xl overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Camera className="w-4 h-4 text-amber-300" />
                <span>Live Camera LR / Document Scanner</span>
              </div>
              <button
                type="button"
                onClick={stopLiveCamera}
                className="p-1 rounded hover:bg-white/15 cursor-pointer"
                aria-label="Close Live Camera"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-slate-900">
              <video
                ref={liveVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-[60vh] rounded-lg object-contain bg-black"
              />
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-700 font-medium">
                Hold LR / Tax Invoice steady inside frame and capture to run smart OCR auto-fill.
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={stopLiveCamera}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCaptureLiveFrame}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Capture &amp; OCR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <CameraPodQrScannerModal
        open={ewbQrModalOpen}
        mode="qr"
        title="NIC E-Way Bill & DRC Verification QR Scanner"
        onClose={() => setEwbQrModalOpen(false)}
        onQrDecoded={(parsed: ParsedQrPayload) => {
          if (parsed.ewbNo) setEwayBillNo(parsed.ewbNo);
          if (parsed.ewbDate) setEwayBillDate(parsed.ewbDate);
          if (parsed.validUpto) setEwayBillValidUpto(parsed.validUpto);
          if (parsed.vehicleNo && !truckNo.trim()) {
            handleSelectVehicle(parsed.vehicleNo);
          }
          setEwbTrackerMsg(`QR Decoded: ${parsed.summary}`);
        }}
      />
    </div>
  );
};

export const ConsignmentModule = React.memo(ConsignmentModuleInner);
