import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Sparkles,
  Trash2,
  Truck,
  Unlock,
  Upload,
  Usb,
} from 'lucide-react';
import {
  BusinessMode,
  CompanySettings,
  ConsignmentNote,
  DEFAULT_COMPANY_SETTINGS,
  DriveFolderName,
  LorryAdvanceRow,
  LorryHire,
  Party,
  StaffAccount,
  StaffCommissionEntry,
  Vehicle,
} from '../types/erp';
import {
  amountToIndianWords,
  computeRateModeAmount,
  formatDateDDMMYYYY,
  formatDateHyphenDDMMYYYY,
  formatINR,
  isLumpSumRateMode,
  makeSafeDocId,
  normalizeFyLabel,
  todayISO,
} from '../lib/formatters';
import { scanPODDocument } from '../lib/ocrEngine';
import { logBranchActivity, removeDocument, upsertDocument } from '../lib/firestoreStore';
import { uploadPdfToDivisionVaultFolder } from '../lib/driveBackup';
import {
  GeneratedPdfResult,
  downloadPdfDirect,
  generateFoxproStatementPDF,
  generatePodScanPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { StaffCommissionModule } from './StaffCommissionModule';
import { CameraPodQrScannerModal } from './CameraPodQrScannerModal';
import {
  EntityQuickPreviewCard,
  formatPartyDetailsLine,
  formatVehicleDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import { EditableSearchSelect } from './EditableSearchSelect';
import { SearchableSelect } from './SearchableSelect';
import {
  addDropdownItem,
  DEFAULT_RATE_MODES,
  deleteDropdownItem,
  editDropdownItem,
  getEffectiveDropdownList,
  sortAlphaList,
} from '../lib/dropdownMasterStore';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { validateSafeUploadFile } from '../lib/gstinValidator';
import { PinCountryInputs, useAutoPinLookup } from './CityPinCountryAutoFill';
import { SupportedCountry } from '../lib/postalPinLookup';
import {
  applyScanner300DpiAutoCropAndFilter,
  connectUsbScannerFolder,
  isFileSystemDirectorySupported,
  ScannerFilterMode,
  startUsbScannerFolderWatcher,
  UsbScannerWatcherHandle,
} from '../lib/usbScannerWatch';

interface LorryHirePodModuleProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
  readOnly?: boolean;
  lorryHires: LorryHire[];
  consignments: ConsignmentNote[];
  parties?: Party[];
  vehicles?: Vehicle[];
  staffAccounts?: StaffAccount[];
  staffCommissions?: StaffCommissionEntry[];
  company?: CompanySettings;
  driveAccessToken: string | null;
  onConnectDrive: () => Promise<void>;
  onPreviewPdf?: (pdf: GeneratedPdfResult, folder: DriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const DEFAULT_ADVANCE_ROW = (): LorryAdvanceRow => ({
  payeeType: 'Lorry Owner',
  accountName: 'PUNJAB NATIONAL BANK',
  advanceDate: todayISO(),
  mode: 'NEFT',
  amount: 0,
});

function parseBookedPkgs(pkgStr?: string): string {
  if (!pkgStr) return '';
  const m = String(pkgStr).match(/\d+(\.\d+)?/);
  return m ? m[0] : '';
}

export function computeLorryNetPayable(params: {
  hireAmount: number;
  advancePaid: number;
  extraAdvanceAmt?: number;
  loadingCharge: number;
  unloadingCharge: number;
  parkingCharge: number;
  kataCharge: number;
  detentionCharge?: number;
  shortageCharge: number;
  damageCharge: number;
  tdsAmount?: number;
}): {
  grossWithDetention: number;
  totalDeductions: number;
  balancePayable: number;
} {
  const grossWithDetention =
    Math.round((Number(params.hireAmount || 0) + Number(params.detentionCharge || 0)) * 100) / 100;
  const totalDeductions =
    Math.round(
      (Number(params.advancePaid || 0) +
        Number(params.extraAdvanceAmt || 0) +
        Number(params.loadingCharge || 0) +
        Number(params.unloadingCharge || 0) +
        Number(params.parkingCharge || 0) +
        Number(params.kataCharge || 0) +
        Number(params.shortageCharge || 0) +
        Number(params.damageCharge || 0) +
        Number(params.tdsAmount || 0)) *
        100
    ) / 100;
  const balancePayable = Math.max(
    0,
    Math.round((grossWithDetention - totalDeductions) * 100) / 100
  );
  return { grossWithDetention, totalDeductions, balancePayable };
}

const LorryHirePodModuleInner: React.FC<LorryHirePodModuleProps> = ({
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  activeFy,
  isMasterAdmin,
  readOnly = false,
  lorryHires,
  consignments,
  parties = [],
  vehicles = [],
  staffAccounts = [],
  staffCommissions = [],
  company,
  driveAccessToken,
  onConnectDrive,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [showCommissionLedger, setShowCommissionLedger] = useState(false);
  const podFileRef = useRef<HTMLInputElement | null>(null);
  const podCamRef = useRef<HTMLInputElement | null>(null);

  const effectiveCompany: CompanySettings = useMemo(
    () =>
      company || {
        ...DEFAULT_COMPANY_SETTINGS,
        ownerUid,
      },
    [company, ownerUid]
  );

  const accountBankOptions = useMemo(() => {
    const bankMain = effectiveCompany.bankName
      ? `${effectiveCompany.bankName}${effectiveCompany.bankBranch ? ` (${effectiveCompany.bankBranch})` : ''}`
      : 'PUNJAB NATIONAL BANK';
    const base = [
      bankMain,
      'Cash in Hand',
      'HDFC Bank A/c',
      'ICICI Bank A/c',
      'SBI Current A/c',
      'Axis Bank A/c',
      'Diesel / Pump Credit A/c',
    ];
    const partyBanks = parties
      .filter((p) => p.partyType === 'TruckOwner' || p.partyType === 'Broker')
      .map((p) => (p.bankName ? `${p.name} — ${p.bankName}` : p.name));
    return Array.from(new Set([...base, ...partyBanks]));
  }, [effectiveCompany.bankName, effectiveCompany.bankBranch, parties]);

  const brokerParties = useMemo(
    () => parties.filter((p) => p.partyType === 'Broker'),
    [parties]
  );

  const ownerParties = useMemo(
    () => parties.filter((p) => p.partyType === 'TruckOwner'),
    [parties]
  );

  // Edit / Form state
  const [editingHireId, setEditingHireId] = useState<string | null>(null);
  const [division, setDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [cnNo, setCnNo] = useState('');
  const [cnDate, setCnDate] = useState(todayISO());
  const [truckNo, setTruckNo] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [selectedBrokerId, setSelectedBrokerId] = useState('');
  const [fromCity, setFromCity] = useState('KOLKATA');
  const [fromPinCode, setFromPinCode] = useState('700001');
  const [fromCountry, setFromCountry] = useState<SupportedCountry>('India');
  const [toCity, setToCity] = useState('');
  const [toPinCode, setToPinCode] = useState('');
  const [toCountry, setToCountry] = useState<SupportedCountry>('India');

  useAutoPinLookup(fromCity, fromPinCode, fromCountry, (pin, country) => {
    setFromPinCode(pin);
    setFromCountry(country);
  });
  useAutoPinLookup(toCity, toPinCode, toCountry, (pin, country) => {
    setToPinCode(pin);
    setToCountry(country);
  });
  const [weightMt, setWeightMt] = useState('');
  const [rateMode, setRateMode] = useState<string>('Fixed');
  const [ratePerUnit, setRatePerUnit] = useState('');
  const [bookedPkgs, setBookedPkgs] = useState('');
  const [deliveredPkgs, setDeliveredPkgs] = useState('');
  const [hireAmount, setHireAmount] = useState('');

  // Multi-Advance (Yes/No)
  const [hasMultiAdvance, setHasMultiAdvance] = useState(false);
  const [advances, setAdvances] = useState<LorryAdvanceRow[]>([DEFAULT_ADVANCE_ROW()]);
  const [extraAdvanceAmt, setExtraAdvanceAmt] = useState('0');
  const [balancePaidAmt, setBalancePaidAmt] = useState('0');

  // Step-by-step Deductions, Detention (2-day free), TDS 194C & Receipt Challan
  const [loadingCharge, setLoadingCharge] = useState('0');
  const [unloadingCharge, setUnloadingCharge] = useState('0');
  const [parkingCharge, setParkingCharge] = useState('0');
  const [kataCharge, setKataCharge] = useState('0');
  const [detentionDays, setDetentionDays] = useState('0');
  const [detentionRatePerDay, setDetentionRatePerDay] = useState('1500');
  const [detentionCharge, setDetentionCharge] = useState('0');
  const [shortageCharge, setShortageCharge] = useState('0');
  const [damageCharge, setDamageCharge] = useState('0');
  const [tdsRatePct, setTdsRatePct] = useState('0');
  const [tdsAmount, setTdsAmount] = useState('0');
  const [receiptChallanNo, setReceiptChallanNo] = useState('');
  const [receiptChallanDate, setReceiptChallanDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  // Active POD modal state (includes Pkgs, Truck No Override, USB Scanner Auto-Watch & Shortage Reconciliation)
  const [activePodTarget, setActivePodTarget] = useState<LorryHire | null>(null);
  const [podTruckNo, setPodTruckNo] = useState('');
  const [podDate, setPodDate] = useState(todayISO());
  const [podBookedPkgs, setPodBookedPkgs] = useState('');
  const [podDeliveredPkgs, setPodDeliveredPkgs] = useState('');
  const [podShortageCharge, setPodShortageCharge] = useState('0');
  const [podDamageCharge, setPodDamageCharge] = useState('0');
  const [podRemarks, setPodRemarks] = useState('');
  const [podShortageAlert, setPodShortageAlert] = useState(false);
  const [podImageUrl, setPodImageUrl] = useState('');
  const [podFileName, setPodFileName] = useState('');
  const [podScanStatus, setPodScanStatus] = useState<string | null>(null);
  const [podUploading, setPodUploading] = useState(false);
  const [camScannerOpen, setCamScannerOpen] = useState(false);
  const [usbFolderName, setUsbFolderName] = useState('');
  const [usbWatcherActive, setUsbWatcherActive] = useState(false);
  const [usbFilterMode, setUsbFilterMode] = useState<ScannerFilterMode>('magic_color');
  const [usbAutoCrop, setUsbAutoCrop] = useState(true);
  const usbWatcherRef = useRef<UsbScannerWatcherHandle | null>(null);

  useEffect(() => {
    return () => {
      usbWatcherRef.current?.stop();
      usbWatcherRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activePodTarget && usbWatcherRef.current) {
      usbWatcherRef.current.stop();
      usbWatcherRef.current = null;
      setUsbWatcherActive(false);
      setUsbFolderName('');
    }
  }, [activePodTarget]);

  // Balance payment modal state
  const [payTarget, setPayTarget] = useState<LorryHire | null>(null);
  const [payMode, setPayMode] = useState('Bank Transfer');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(todayISO());

  // Live Pkgs Shortage/Damage Calculation
  const bookedNum = Number(bookedPkgs) || 0;
  const deliveredNum = deliveredPkgs === '' ? bookedNum : Number(deliveredPkgs) || 0;
  const shortageDamagePkgs = Math.max(0, bookedNum - deliveredNum);

  // Live Multi-Advance & Net Payable Calculation
  const activeAdvanceRows = useMemo(
    () => (hasMultiAdvance ? advances : advances.slice(0, 1)),
    [hasMultiAdvance, advances]
  );
  const totalAdvances = useMemo(
    () => activeAdvanceRows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [activeAdvanceRows]
  );

  const hireNum = Number(hireAmount) || 0;
  const extraAdvNum = Number(extraAdvanceAmt) || 0;
  const loadNum = Number(loadingCharge) || 0;
  const unloadNum = Number(unloadingCharge) || 0;
  const parkNum = Number(parkingCharge) || 0;
  const kataNum = Number(kataCharge) || 0;
  const detChgNum = Number(detentionCharge) || 0;
  const shortChgNum = Number(shortageCharge) || 0;
  const dmgChgNum = Number(damageCharge) || 0;
  const tdsAmtNum = Number(tdsAmount) || 0;

  const { grossWithDetention, balancePayable } = computeLorryNetPayable({
    hireAmount: hireNum,
    advancePaid: totalAdvances,
    extraAdvanceAmt: extraAdvNum,
    loadingCharge: loadNum,
    unloadingCharge: unloadNum,
    parkingCharge: parkNum,
    kataCharge: kataNum,
    detentionCharge: detChgNum,
    shortageCharge: shortChgNum,
    damageCharge: dmgChgNum,
    tdsAmount: tdsAmtNum,
  });

  // Running balance per advance row down to final due
  const advanceRunningBalances = useMemo(() => {
    const startAfterTripDed =
      Math.round(
        (grossWithDetention -
          (extraAdvNum + loadNum + unloadNum + parkNum + kataNum + shortChgNum + dmgChgNum + tdsAmtNum)) *
          100
      ) / 100;
    let cursor = startAfterTripDed;
    return activeAdvanceRows.map((row) => {
      cursor = Math.round((cursor - (Number(row.amount) || 0)) * 100) / 100;
      return cursor;
    });
  }, [
    grossWithDetention,
    extraAdvNum,
    loadNum,
    unloadNum,
    parkNum,
    kataNum,
    shortChgNum,
    dmgChgNum,
    tdsAmtNum,
    activeAdvanceRows,
  ]);

  const indexedHires = useMemo(() => {
    const sorted = [...lorryHires].sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''));
    return sorted.map((h) => ({
      item: h,
      haystack: `${h.cnNo || ''} ${h.truckNo || ''} ${h.ownerName || ''} ${h.brokerName || ''} ${h.toCity || ''} ${h.branchCode || ''}`.toLowerCase(),
    }));
  }, [lorryHires]);

  const filteredHires = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return indexedHires.map((x) => x.item);
    return indexedHires.filter((x) => x.haystack.includes(q)).map((x) => x.item);
  }, [indexedHires, debouncedSearch]);

  const applyHireSmartAutoFill = (tNo: string, oName: string, destCity: string) => {
    const cleanTruck = tNo.trim().toUpperCase();
    const cleanOwner = oName.trim().toLowerCase();
    const cleanDest = destCity.trim().toLowerCase();
    const sorted = [...lorryHires].sort((a, b) =>
      (b.cnDate || '').localeCompare(a.cnDate || '')
    );
    const match =
      sorted.find((h) => cleanTruck && h.truckNo?.toUpperCase() === cleanTruck) ||
      sorted.find((h) => cleanOwner && h.ownerName?.toLowerCase() === cleanOwner) ||
      sorted.find((h) => cleanDest && h.toCity?.toLowerCase() === cleanDest);
    if (!match) return;
    if (!ownerName.trim() && match.ownerName) setOwnerName(match.ownerName);
    if (!brokerName.trim() && match.brokerName) setBrokerName(match.brokerName);
    if ((!hireAmount || Number(hireAmount) <= 0) && Number(match.hireAmount || 0) > 0) {
      setHireAmount(String(match.hireAmount));
    }
  };

  const handleSelectCn = (selectedCnNo: string) => {
    setCnNo(selectedCnNo);
    const cn = consignments.find((c) => c.cnNo.toLowerCase() === selectedCnNo.toLowerCase());
    if (cn) {
      setDivision(cn.division === 'LOGISTICS' ? 'LOGISTICS' : 'FTL');
      setCnDate(cn.cnDate);
      setTruckNo(cn.truckNo);
      setOwnerName(cn.ownerName || '');
      setFromCity(cn.fromCity);
      setToCity(cn.toCity);
      const parsedPkgs = parseBookedPkgs(cn.packages);
      if (parsedPkgs) {
        setBookedPkgs(parsedPkgs);
        setDeliveredPkgs(parsedPkgs);
      }
      applyHireSmartAutoFill(cn.truckNo, cn.ownerName || '', cn.toCity || '');
      if (!hireAmount && cn.totalFreight) {
        setHireAmount(String(cn.totalFreight));
      }
    }
  };

  const resetForm = () => {
    setEditingHireId(null);
    setDivision('FTL');
    setCnNo('');
    setCnDate(todayISO());
    setTruckNo('');
    setSelectedVehicleId('');
    setOwnerName('');
    setSelectedOwnerId('');
    setBrokerName('');
    setSelectedBrokerId('');
    setFromCity('KOLKATA');
    setFromPinCode('700001');
    setFromCountry('India');
    setToCity('');
    setToPinCode('');
    setToCountry('India');
    setWeightMt('');
    setRateMode('Fixed');
    setRatePerUnit('');
    setBookedPkgs('');
    setDeliveredPkgs('');
    setHireAmount('');
    setHasMultiAdvance(false);
    setAdvances([DEFAULT_ADVANCE_ROW()]);
    setExtraAdvanceAmt('0');
    setBalancePaidAmt('0');
    setLoadingCharge('0');
    setUnloadingCharge('0');
    setParkingCharge('0');
    setKataCharge('0');
    setDetentionDays('0');
    setDetentionRatePerDay('1500');
    setDetentionCharge('0');
    setShortageCharge('0');
    setDamageCharge('0');
    setTdsRatePct('0');
    setTdsAmount('0');
    setReceiptChallanNo('');
    setReceiptChallanDate('');
    setRemarks('');
  };

  const handleLoadForEdit = (h: LorryHire) => {
    setEditingHireId(h.id);
    setDivision(h.division === 'LOGISTICS' ? 'LOGISTICS' : 'FTL');
    setCnNo(h.cnNo || '');
    setCnDate(h.cnDate || todayISO());
    setTruckNo(h.truckNo || '');
    setOwnerName(h.ownerName || '');
    setBrokerName(h.brokerName || '');
    setFromCity(h.fromCity || 'KOLKATA');
    setFromPinCode(h.fromPinCode || '');
    setFromCountry(
      (h.fromCountry as SupportedCountry) || 'India'
    );
    setToCity(h.toCity || '');
    setToPinCode(h.toPinCode || '');
    setToCountry(
      (h.toCountry as SupportedCountry) || 'India'
    );
    setWeightMt(h.weightMt != null ? String(h.weightMt) : '');
    setRateMode(h.rateMode || 'Fixed');
    setRatePerUnit(h.ratePerUnit != null ? String(h.ratePerUnit) : '');
    setBookedPkgs(h.bookedPkgs != null ? String(h.bookedPkgs) : '');
    setDeliveredPkgs(h.deliveredPkgs != null ? String(h.deliveredPkgs) : '');
    setHireAmount(String(h.hireAmount || ''));
    const savedAdv =
      Array.isArray(h.advances) && h.advances.length > 0
        ? h.advances
        : [{ ...DEFAULT_ADVANCE_ROW(), amount: Number(h.advancePaid || 0) }];
    setHasMultiAdvance(Boolean(h.hasMultiAdvance || savedAdv.length > 1));
    setAdvances(savedAdv);
    setExtraAdvanceAmt(String(h.extraAdvanceAmt ?? 0));
    setBalancePaidAmt(String(h.balancePaidAmt ?? 0));
    setLoadingCharge(String(h.loadingCharge ?? 0));
    setUnloadingCharge(String(h.unloadingCharge ?? 0));
    setParkingCharge(String(h.parkingCharge ?? 0));
    setKataCharge(String(h.kataCharge ?? 0));
    setDetentionDays(String(h.detentionDays ?? 0));
    setDetentionCharge(String(h.detentionCharge ?? 0));
    setShortageCharge(String(h.shortageCharge ?? 0));
    setDamageCharge(String(h.damageCharge ?? 0));
    setTdsRatePct(String(h.tdsRatePct ?? 0));
    setTdsAmount(String(h.tdsAmount ?? 0));
    setReceiptChallanNo(h.receiptChallanNo || '');
    setReceiptChallanDate(h.receiptChallanDate || '');
    setRemarks(h.remarks || '');
  };

  const handleDetentionDaysChange = (daysVal: string, rateVal = detentionRatePerDay) => {
    setDetentionDays(daysVal);
    const days = Math.max(0, Number(daysVal) || 0);
    const rate = Math.max(0, Number(rateVal) || 0);
    const chargeableDays = Math.max(0, days - 2);
    setDetentionCharge(String(Math.round(chargeableDays * rate * 100) / 100));
  };

  const handleTdsPctChange = (pctVal: string, baseHire = hireNum) => {
    setTdsRatePct(pctVal);
    const pct = Math.max(0, Number(pctVal) || 0);
    setTdsAmount(String(Math.round(((baseHire * pct) / 100) * 100) / 100));
  };

  const handleCreateOrUpdateHire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnNo.trim() || !truckNo.trim() || hireNum <= 0) return;
    if (receiptChallanNo.trim() && !receiptChallanDate.trim()) {
      setFormError('Challan Receipt Date is mandatory when Receipt Challan No is entered.');
      playAlertBeep();
      return;
    }
    setFormError(null);

    setSaving(true);
    try {
      const id = editingHireId || makeSafeDocId('hire');
      const cleanedAdvances = activeAdvanceRows
        .slice(0, 50)
        .map((a) => ({
          payeeType: a.payeeType || 'Lorry Owner',
          accountName: a.accountName || accountBankOptions[0] || 'Cash in Hand',
          holderName: (a.holderName || '').trim(),
          bankAccountNo: (a.bankAccountNo || '').trim(),
          upiId: (a.upiId || '').trim(),
          refNo: (a.refNo || '').trim(),
          advanceDate: a.advanceDate || todayISO(),
          mode: a.mode || 'NEFT',
          amount: Number(a.amount) || 0,
        }))
        .filter((a) => a.amount > 0 || activeAdvanceRows.length === 1);

      const existing = editingHireId ? lorryHires.find((x) => x.id === editingHireId) : undefined;

      await upsertDocument(
        'lorry_hires',
        id,
        {
          cnNo: cnNo.trim().slice(0, 40),
          cnDate,
          financialYear: normalizeFyLabel(activeFy),
          division,
          truckNo: truckNo.trim().toUpperCase().slice(0, 30),
          ownerName: ownerName.trim().slice(0, 140),
          brokerName: brokerName.trim().slice(0, 140),
          fromCity: fromCity.trim().slice(0, 120),
          fromPinCode: fromPinCode.trim(),
          fromCountry,
          toCity: toCity.trim().slice(0, 120),
          toPinCode: toPinCode.trim(),
          toCountry,
          weightMt: Number(weightMt) || 0,
          rateMode,
          ratePerUnit: Number(ratePerUnit) || 0,
          bookedPkgs: bookedNum,
          deliveredPkgs: deliveredNum,
          shortageDamagePkgs,
          hasMultiAdvance,
          advances: cleanedAdvances,
          hireAmount: hireNum,
          advancePaid: totalAdvances,
          extraAdvanceAmt: extraAdvNum,
          balancePaidAmt: Number(balancePaidAmt) || 0,
          loadingCharge: loadNum,
          unloadingCharge: unloadNum,
          parkingCharge: parkNum,
          kataCharge: kataNum,
          detentionDays: Number(detentionDays) || 0,
          detentionCharge: detChgNum,
          shortageCharge: shortChgNum,
          damageCharge: dmgChgNum,
          tdsRatePct: Number(tdsRatePct) || 0,
          tdsAmount: tdsAmtNum,
          receiptChallanNo: receiptChallanNo.trim(),
          receiptChallanDate: receiptChallanDate.trim(),
          remarks: remarks.trim(),
          balancePayable,
          podReceived: existing?.podReceived ?? false,
          podReceiveDate: existing?.podReceiveDate ?? '',
          podImageDataUrl: existing?.podImageDataUrl ?? '',
          podFileName: existing?.podFileName ?? '',
          podRemarks: existing?.podRemarks ?? '',
          balancePaid: existing?.balancePaid ?? false,
          balancePaidDate: existing?.balancePaidDate ?? '',
          paymentMode: existing?.paymentMode ?? '',
          paymentRef: existing?.paymentRef ?? '',
          branchCode: existing?.branchCode || activeBranchCode,
          createdByStaff: existing?.createdByStaff || activeStaffCode,
          ownerUid,
        },
        !editingHireId
      );

      await logBranchActivity({
        action: editingHireId ? 'Updated Lorry Hire & Deductions' : 'Created Lorry Hire',
        module: 'Lorry Hire',
        docRefCode: cnNo.trim(),
        summary: `${truckNo.trim().toUpperCase()} · Gross ₹${formatINR(hireNum)} · Net Payable ₹${formatINR(balancePayable)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      playVerifiedBeep();
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handlePodScanUpload = async (file: File | undefined, scannerBrandHint?: string) => {
    if (!file || !activePodTarget) return;
    const uploadCheck = validateSafeUploadFile(file, 'image_only');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setPodScanStatus(uploadCheck.reason || 'Blocked unsupported file.');
      return;
    }
    setPodScanStatus(
      scannerBrandHint
        ? `USB Auto-Captured (${scannerBrandHint}) · Applying ${usbAutoCrop ? '300-DPI Auto-Crop + ' : ''}${usbFilterMode === 'bw_sharp' ? 'B&W Sharp' : 'Magic Color'} & OCR...`
        : 'Compressing & scanning POD in background worker...'
    );
    setPodShortageAlert(false);
    try {
      let fileToScan: File = file;
      if (usbAutoCrop && file.type.startsWith('image/')) {
        const enhanced = await applyScanner300DpiAutoCropAndFilter(file, usbFilterMode);
        const resBlob = await (await fetch(enhanced.dataUrl)).blob();
        fileToScan = new File([resBlob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
      }
      const { result, compressedDataUrl } = await scanPODDocument(
        fileToScan,
        (m) => setPodScanStatus(m),
        Boolean(company?.backgroundAiEnabled)
      );
      setPodImageUrl(compressedDataUrl);
      const effectiveTruck = (podTruckNo.trim() || activePodTarget.truckNo || activePodTarget.cnNo || 'TRUCK')
        .toUpperCase()
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanName = `POD_${effectiveTruck}_${formatDateHyphenDDMMYYYY(podDate || todayISO())}.pdf`;
      setPodFileName(cleanName);
      if (result.podDate) setPodDate(result.podDate);
      if (result.shortageBreakageLeakageDetected) {
        setPodShortageAlert(true);
        setPodRemarks(result.remarks || 'ALERT: Shortage / Breakage / Leakage detected on POD!');
        playAlertBeep();
      } else if (result.remarks) {
        setPodRemarks(result.remarks);
      }
      if (!result.shortageBreakageLeakageDetected) {
        playVerifiedBeep();
      }
      setPodScanStatus(
        result.shortageBreakageLeakageDetected
          ? `RED ALERT: Shortage / Breakage / Leakage detected! ${result.remarks || ''}`
          : result.signedDetected
            ? `Signed POD verified${scannerBrandHint ? ` (${scannerBrandHint})` : ''}! ${result.remarks || ''}`
            : `POD enhanced & ready (${cleanName}). Verify Truck No & POD Date, then click Save.`
      );
    } catch (err) {
      setPodScanStatus(err instanceof Error ? err.message : 'POD scan failed');
    }
  };

  const handleToggleUsbScannerWatch = async () => {
    if (usbWatcherRef.current) {
      usbWatcherRef.current.stop();
      usbWatcherRef.current = null;
      setUsbWatcherActive(false);
      setUsbFolderName('');
      setPodScanStatus('USB Scanner Folder Auto-Watch stopped.');
      return;
    }
    try {
      const dirHandle = await connectUsbScannerFolder();
      const watcher = await startUsbScannerFolderWatcher(dirHandle, async (evt) => {
        if (!evt.file.type.startsWith('image/') && !/\.(jpe?g|png|webp|bmp)$/i.test(evt.fileName)) {
          setPodScanStatus(`Skipped non-image scanner file ${evt.fileName}. Set scanner output to JPG/PNG for auto-crop.`);
          return;
        }
        await handlePodScanUpload(evt.file, evt.scannerBrandHint);
      });
      usbWatcherRef.current = watcher;
      setUsbFolderName(watcher.folderName);
      setUsbWatcherActive(true);
      playVerifiedBeep();
      setPodScanStatus(
        `USB Auto-Watch ACTIVE on folder "${watcher.folderName}" — Press SCAN on your HP / Canon / Epson / Brother scanner!`
      );
    } catch (err) {
      playAlertBeep();
      setPodScanStatus(err instanceof Error ? err.message : 'Could not open USB scanner folder.');
    }
  };

  const handleSavePodScan = async () => {
    if (!activePodTarget || !podImageUrl || !podDate) return;
    setPodUploading(true);
    try {
      const bPkgs = Number(podBookedPkgs) || 0;
      const dPkgs = podDeliveredPkgs === '' ? bPkgs : Number(podDeliveredPkgs) || 0;
      const sdPkgs = Math.max(0, bPkgs - dPkgs);
      const sChg = Number(podShortageCharge) || 0;
      const dChg = Number(podDamageCharge) || 0;
      const finalTruckNo = (podTruckNo.trim() || activePodTarget.truckNo || '').toUpperCase();

      const { balancePayable: recomputedNet } = computeLorryNetPayable({
        hireAmount: Number(activePodTarget.hireAmount || 0),
        advancePaid: Number(activePodTarget.advancePaid || 0),
        extraAdvanceAmt: Number(activePodTarget.extraAdvanceAmt || 0),
        loadingCharge: Number(activePodTarget.loadingCharge || 0),
        unloadingCharge: Number(activePodTarget.unloadingCharge || 0),
        parkingCharge: Number(activePodTarget.parkingCharge || 0),
        kataCharge: Number(activePodTarget.kataCharge || 0),
        detentionCharge: Number(activePodTarget.detentionCharge || 0),
        shortageCharge: sChg,
        damageCharge: dChg,
        tdsAmount: Number(activePodTarget.tdsAmount || 0),
      });

      const targetDivision: BusinessMode =
        (activePodTarget.division as BusinessMode) || 'FTL';
      const podPdf = await generatePodScanPDF({
        imageDataUrl: podImageUrl,
        truckNo: finalTruckNo || activePodTarget.cnNo,
        cnNo: activePodTarget.cnNo,
        podDate,
        remarks: podRemarks.trim(),
        partyName: activePodTarget.ownerName || activePodTarget.brokerName,
        division: targetDivision,
        company: effectiveCompany,
      });

      await upsertDocument(
        'lorry_hires',
        activePodTarget.id,
        {
          truckNo: finalTruckNo || activePodTarget.truckNo,
          bookedPkgs: bPkgs,
          deliveredPkgs: dPkgs,
          shortageDamagePkgs: sdPkgs,
          shortageCharge: sChg,
          damageCharge: dChg,
          balancePayable: recomputedNet,
          podReceived: true,
          podReceiveDate: podDate,
          podImageDataUrl: podImageUrl.slice(0, 440000),
          podFileName: podPdf.fileName,
          podRemarks: podRemarks.trim(),
        },
        false
      );

      if (driveAccessToken) {
        await uploadPdfToDivisionVaultFolder({
          accessToken: driveAccessToken,
          division: targetDivision,
          folderName: '5. POD_Scans_PDFs',
          fileName: podPdf.fileName,
          blob: podPdf.blob,
        });
      }
      if (onPreviewPdf) {
        onPreviewPdf(podPdf, 'POD_Scans');
      } else {
        URL.revokeObjectURL(podPdf.blobUrl);
      }

      await logBranchActivity({
        action: 'Verified POD & Reconciled Pkgs',
        module: 'Lorry Hire',
        docRefCode: activePodTarget.cnNo,
        summary: `POD ${finalTruckNo} · ${podPdf.fileName} · Deliv ${dPkgs}/${bPkgs} Pkgs (${sdPkgs} Short/Dmg) · Net ₹${formatINR(recomputedNet)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      playVerifiedBeep();
      usbWatcherRef.current?.stop();
      usbWatcherRef.current = null;
      setUsbWatcherActive(false);
      setUsbFolderName('');
      setActivePodTarget(null);
      setPodTruckNo('');
      setPodImageUrl('');
      setPodFileName('');
      setPodRemarks('');
      setPodShortageAlert(false);
      setPodScanStatus(null);
    } finally {
      setPodUploading(false);
    }
  };

  const handleReleaseBalancePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    if (!payTarget.podReceived || !payTarget.podReceiveDate || !payTarget.podFileName) {
      return;
    }
    await upsertDocument(
      'lorry_hires',
      payTarget.id,
      {
        balancePaid: true,
        balancePaidDate: payDate,
        paymentMode: payMode,
        paymentRef: payRef.trim(),
      },
      false
    );

    const txCode = `LH-${payTarget.cnNo.slice(0, 12)}`;
    await upsertDocument(
      'transactions',
      makeSafeDocId('tx_pod'),
      {
        txCode,
        txDate: payDate,
        financialYear: normalizeFyLabel(activeFy),
        txType: 'Expense',
        ledgerAccount: 'Lorry Hire Payable A/c',
        partyName: payTarget.ownerName || payTarget.brokerName || payTarget.truckNo,
        amount: payTarget.balancePayable,
        narration: `Balance Lorry Hire Paid after POD (${payTarget.cnNo} · ${payTarget.truckNo})`,
        paymentMode: payMode,
        referenceNo: payRef.trim(),
        linkedCnNo: payTarget.cnNo,
        linkedInvoiceNo: '',
        branchCode: activeBranchCode,
        createdByStaff: activeStaffCode,
        ownerUid,
      },
      true
    );

    await logBranchActivity({
      action: 'Released Balance Payment',
      module: 'Lorry Hire',
      docRefCode: payTarget.cnNo,
      summary: `Paid ₹${formatINR(payTarget.balancePayable)} to ${payTarget.ownerName || payTarget.truckNo}`,
      staffCode: activeStaffCode,
      staffName: activeStaffName,
      branchCode: activeBranchCode,
      ownerUid,
    });

    playVerifiedBeep();
    setPayTarget(null);
    setPayRef('');
  };

  const buildCurrentHireSnapshot = (): LorryHire => {
    const cleanedAdvances = activeAdvanceRows
      .slice(0, 50)
      .map((a) => ({
        payeeType: a.payeeType || 'Lorry Owner',
        accountName: a.accountName || accountBankOptions[0] || 'Cash in Hand',
        holderName: (a.holderName || '').trim(),
        bankAccountNo: (a.bankAccountNo || '').trim(),
        upiId: (a.upiId || '').trim(),
        refNo: (a.refNo || '').trim(),
        advanceDate: a.advanceDate || todayISO(),
        mode: a.mode || 'NEFT',
        amount: Number(a.amount) || 0,
      }))
      .filter((a) => a.amount > 0 || activeAdvanceRows.length === 1);
    const existing = editingHireId ? lorryHires.find((x) => x.id === editingHireId) : undefined;
    return {
      id: editingHireId || 'preview_hire',
      cnNo: cnNo.trim() || 'PREVIEW',
      cnDate: cnDate || todayISO(),
      financialYear: normalizeFyLabel(activeFy),
      division,
      truckNo: truckNo.trim().toUpperCase() || '-',
      ownerName: ownerName.trim(),
      brokerName: brokerName.trim(),
      fromCity: fromCity.trim(),
      fromPinCode: fromPinCode.trim(),
      fromCountry,
      toCity: toCity.trim(),
      toPinCode: toPinCode.trim(),
      toCountry,
      weightMt: Number(weightMt) || 0,
      rateMode,
      ratePerUnit: Number(ratePerUnit) || 0,
      bookedPkgs: bookedNum,
      deliveredPkgs: deliveredNum,
      shortageDamagePkgs,
      hasMultiAdvance,
      advances: cleanedAdvances,
      hireAmount: hireNum,
      advancePaid: totalAdvances,
      extraAdvanceAmt: extraAdvNum,
      balancePaidAmt: Number(balancePaidAmt) || 0,
      loadingCharge: loadNum,
      unloadingCharge: unloadNum,
      parkingCharge: parkNum,
      kataCharge: kataNum,
      detentionDays: Number(detentionDays) || 0,
      detentionCharge: detChgNum,
      shortageCharge: shortChgNum,
      damageCharge: dmgChgNum,
      tdsRatePct: Number(tdsRatePct) || 0,
      tdsAmount: tdsAmtNum,
      receiptChallanNo: receiptChallanNo.trim(),
      receiptChallanDate: receiptChallanDate.trim(),
      remarks: remarks.trim(),
      balancePayable,
      podReceived: existing?.podReceived ?? false,
      podReceiveDate: existing?.podReceiveDate ?? '',
      podImageDataUrl: existing?.podImageDataUrl ?? '',
      podFileName: existing?.podFileName ?? '',
      podRemarks: existing?.podRemarks ?? '',
      balancePaid: existing?.balancePaid ?? false,
      balancePaidDate: existing?.balancePaidDate ?? '',
      paymentMode: existing?.paymentMode ?? '',
      paymentRef: existing?.paymentRef ?? '',
      branchCode: existing?.branchCode || activeBranchCode,
      createdByStaff: existing?.createdByStaff || activeStaffCode,
      ownerUid,
    };
  };

  const buildHireVoucherPdf = async (h: LorryHire): Promise<GeneratedPdfResult> => {
    const advRows = Array.isArray(h.advances) ? h.advances : [];
    const totalDed =
      Number(h.advancePaid || 0) +
      Number(h.loadingCharge || 0) +
      Number(h.unloadingCharge || 0) +
      Number(h.parkingCharge || 0) +
      Number(h.kataCharge || 0) +
      Number(h.shortageCharge || 0) +
      Number(h.damageCharge || 0);

    const voucherRows: Array<{ line1: string[]; line2?: string[] }> = [
      { line1: ['1', 'Gross Lorry Hire Agreed', `${h.fromCity || '-'} -> ${h.toCity || '-'}`, formatINR(h.hireAmount)] },
      ...advRows.map((a, idx) => ({
        line1: [
          `${idx + 2}`,
          `(-) Advance (${a.payeeType})`,
          `${a.accountName} · ${a.mode} · ${formatDateDDMMYYYY(a.advanceDate)}`,
          `-${formatINR(a.amount)}`,
        ],
      })),
      ...(advRows.length === 0 && (h.advancePaid || 0) > 0
        ? [{ line1: ['2', '(-) Advance Paid', '-', `-${formatINR(h.advancePaid)}`] }]
        : []),
      { line1: ['-', '(-) Loading Charge', 'Trip Deduction', `-${formatINR(h.loadingCharge || 0)}`] },
      { line1: ['-', '(-) Unloading Charge', 'Trip Deduction', `-${formatINR(h.unloadingCharge || 0)}`] },
      { line1: ['-', '(-) Parking Charge', 'Trip Deduction', `-${formatINR(h.parkingCharge || 0)}`] },
      { line1: ['-', '(-) Kata Charge', 'Weighbridge Deduction', `-${formatINR(h.kataCharge || 0)}`] },
      {
        line1: [
          '-',
          '(-) Shortage Charge',
          `Booked: ${h.bookedPkgs || 0} | Delivered: ${h.deliveredPkgs ?? h.bookedPkgs ?? 0} | Short/Dmg: ${h.shortageDamagePkgs || 0} Pkgs`,
          `-${formatINR(h.shortageCharge || 0)}`,
        ],
      },
      { line1: ['-', '(-) Damage Charge', 'POD Damage Claim', `-${formatINR(h.damageCharge || 0)}`] },
    ];

    const totalAdv = Number(h.advancePaid || 0) + Number(h.extraAdvanceAmt || 0);
    return generateFoxproStatementPDF(
      {
        title: 'L-O-R-R-Y   H-I-R-E   S-E-T-T-L-E-M-E-N-T   V-O-U-C-H-E-R',
        subtitle: `CN: ${h.cnNo} (${formatDateDDMMYYYY(h.cnDate)}) | Truck: ${h.truckNo} | Branch: ${h.branchCode || activeBranchCode}`,
        fileName: `LorryHire_${h.cnNo.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
        orientation: 'p',
        summaryLines: [
          { label: 'Lorry Owner', value: h.ownerName || '-' },
          { label: 'Broker', value: h.brokerName || '-' },
          { label: 'Route', value: `${h.fromCity || '-'} -> ${h.toCity || '-'}` },
          { label: 'Gross Hire (+Detn)', value: `Rs. ${formatINR(Number(h.hireAmount || 0) + Number(h.detentionCharge || 0))}` },
          { label: 'Advances Paid', value: `Rs. ${formatINR(totalAdv)} (${amountToIndianWords(totalAdv)})` },
          { label: 'Booked / Short Pkgs', value: `${h.bookedPkgs ?? 0} / ${h.shortageDamagePkgs ?? 0} Short` },
        ],
        columns: [
          { label: 'S.NO', widthPct: 8, align: 'center' },
          { label: 'PARTICULARS (STEP-BY-STEP)', widthPct: 36, align: 'left' },
          { label: 'REMARKS / PAYEE / ACCOUNT', widthPct: 36, align: 'left' },
          { label: 'AMOUNT (INR)', widthPct: 20, align: 'right' },
        ],
        rows: voucherRows,
        totalsLabel: 'NET PAYABLE BALANCE IN RUPEES :',
        totalsLine1: ['', '', `Total Deductions: ${formatINR(totalDed)}`, formatINR(h.balancePayable)],
        totalAmountForWords: h.balancePayable,
        legalNotice:
          'INDEMNITY CLAUSE: 100% Leakage, Breakage, Wet Damage & Shortage Indemnity by Lorry Owner & Broker (Indian Contract Act Sec 124). Transporter liability NIL; full shortage, wet/leakage damage & delay claim recoverable from Lorry Hire balance & security.',
      },
      effectiveCompany,
      'p'
    );
  };

  const handlePreviewHireVoucher = async (h: LorryHire) => {
    if (!onPreviewPdf) return;
    const pdf = await buildHireVoucherPdf(h);
    onPreviewPdf(pdf, 'Reports_Ledgers');
  };

  const handlePodPdfAction = async (
    h: LorryHire,
    action: 'preview' | 'whatsapp' | 'email'
  ) => {
    if (!h.podImageDataUrl) return;
    const matchedParty = parties.find(
      (p) =>
        p.name.trim().toLowerCase() === (h.ownerName || '').trim().toLowerCase() ||
        p.name.trim().toLowerCase() === (h.brokerName || '').trim().toLowerCase()
    );
    const pdf = await generatePodScanPDF({
      imageDataUrl: h.podImageDataUrl,
      truckNo: h.truckNo,
      cnNo: h.cnNo,
      podDate: h.podReceiveDate || todayISO(),
      remarks: h.podRemarks,
      partyName: h.ownerName || h.brokerName,
      division: (h.division as BusinessMode) || 'FTL',
      company: effectiveCompany,
    });
    if (action === 'preview') {
      if (onPreviewPdf) {
        onPreviewPdf(pdf, 'POD_Scans');
      }
      return;
    }
    await sharePdfDirect({
      pdf,
      channel: action,
      phone: matchedParty?.phone,
      email: matchedParty?.email,
      partyName: h.ownerName || h.brokerName,
      docNo: h.cnNo || h.truckNo,
      docLabel: 'POD Scan',
      company: effectiveCompany,
    });
    URL.revokeObjectURL(pdf.blobUrl);
  };

  const hireColumns = useMemo<Array<TableColumn<LorryHire>>>(
    () => [
      {
        key: 'cnNo',
        header: 'C/N No',
        cellClassName: 'font-mono-num font-bold text-blue-800 whitespace-nowrap',
        render: (h) => (
          <div>
            <span>{h.cnNo}</span>
            {h.division === 'LOGISTICS' && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px]">
                LOGISTICS
              </span>
            )}
            {h.branchCode && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                {h.branchCode}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'truck',
        header: 'Truck, Owner & Broker',
        render: (h) => (
          <div>
            <div className="font-mono-num font-bold">{h.truckNo}</div>
            <div className="text-[11px] text-slate-600">
              Own: {h.ownerName || '-'} {h.brokerName ? `· Brk: ${h.brokerName}` : ''}
            </div>
          </div>
        ),
      },
      {
        key: 'pkgs',
        header: 'Pkgs (Bkd / Deliv / Short)',
        cellClassName: 'font-mono-num whitespace-nowrap',
        render: (h) => {
          const b = Number(h.bookedPkgs || 0);
          const d = h.deliveredPkgs ?? b;
          const sd = h.shortageDamagePkgs ?? Math.max(0, b - d);
          return b > 0 ? (
            <span>
              {b} / {d}{' '}
              {sd > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold text-[10px]">
                  -{sd}
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">-</span>
          );
        },
      },
      {
        key: 'hireAmount',
        header: 'Gross Hire (₹)',
        align: 'right',
        cellClassName: 'font-mono-num',
        render: (h) => formatINR(h.hireAmount),
      },
      {
        key: 'deductions',
        header: 'Adv + Ded. (₹)',
        align: 'right',
        cellClassName: 'font-mono-num text-slate-700',
        render: (h) => {
          const tripDed =
            Number(h.loadingCharge || 0) +
            Number(h.unloadingCharge || 0) +
            Number(h.parkingCharge || 0) +
            Number(h.kataCharge || 0) +
            Number(h.shortageCharge || 0) +
            Number(h.damageCharge || 0);
          return (
            <div>
              <div>{formatINR(Number(h.advancePaid || 0) + tripDed)}</div>
              <div className="text-[10px] text-slate-500">
                Adv:{formatINR(h.advancePaid)} | Ded:{formatINR(tripDed)}
              </div>
            </div>
          );
        },
      },
      {
        key: 'balancePayable',
        header: 'Net Payable (₹)',
        align: 'right',
        cellClassName: 'font-mono-num font-bold text-orange-700',
        render: (h) => formatINR(h.balancePayable),
      },
      {
        key: 'podStatus',
        header: 'POD Reconciliation',
        render: (h) => {
          const isUnlocked = Boolean(h.podReceived && h.podReceiveDate && h.podFileName);
          return isUnlocked ? (
            <div className="text-emerald-700 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>POD Recd ({formatDateDDMMYYYY(h.podReceiveDate)})</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setActivePodTarget(h);
                setPodTruckNo(h.truckNo || '');
                setPodDate(h.podReceiveDate || todayISO());
                setPodBookedPkgs(h.bookedPkgs != null ? String(h.bookedPkgs) : '');
                setPodDeliveredPkgs(
                  h.deliveredPkgs != null
                    ? String(h.deliveredPkgs)
                    : h.bookedPkgs != null
                      ? String(h.bookedPkgs)
                      : ''
                );
                setPodShortageCharge(String(h.shortageCharge ?? 0));
                setPodDamageCharge(String(h.damageCharge ?? 0));
                setPodRemarks(h.podRemarks || '');
                setPodShortageAlert(false);
                setPodImageUrl(h.podImageDataUrl || '');
                setPodFileName(h.podFileName || '');
                setPodScanStatus(null);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-orange-50 border border-orange-300 hover:bg-orange-100 text-orange-800 font-bold cursor-pointer whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" />
              Scan / Reconcile POD
            </button>
          );
        },
      },
      {
        key: 'gate',
        header: 'Payment Gate & Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (h) => {
          const isUnlocked = Boolean(h.podReceived && h.podReceiveDate && h.podFileName);
          return (
            <>
              {onPreviewPdf && (
                <button
                  type="button"
                  onClick={() => void handlePreviewHireVoucher(h)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold cursor-pointer"
                  title="Lorry Hire Settlement PDF"
                >
                  <Printer className="w-3 h-3" />
                  PDF
                </button>
              )}
              {isUnlocked && h.podImageDataUrl && (
                <>
                  <button
                    type="button"
                    onClick={() => void handlePodPdfAction(h, 'preview')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-semibold cursor-pointer"
                    title="Preview Binary POD PDF"
                  >
                    <Camera className="w-3 h-3" />
                    POD PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePodPdfAction(h, 'whatsapp')}
                    className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                    title="Share Pure Binary POD PDF on WhatsApp"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePodPdfAction(h, 'email')}
                    className="p-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 cursor-pointer"
                    title="Share Pure Binary POD PDF via Email"
                  >
                    <Mail className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {h.balancePaid ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Paid ({formatDateDDMMYYYY(h.balancePaidDate)})
                </span>
              ) : isUnlocked ? (
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    setPayTarget(h);
                    setPayDate(todayISO());
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-40"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Pay ₹{formatINR(h.balancePayable)}
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700 font-bold"
                  title="Strictly locked until signed POD is uploaded and POD Receive Date is entered"
                >
                  <Lock className="w-3 h-3" />
                  POD Locked
                </span>
              )}
              {!h.balancePaid && !readOnly && (
                <button
                  type="button"
                  onClick={() => handleLoadForEdit(h)}
                  className="p-1 rounded hover:bg-blue-50 text-blue-700 cursor-pointer"
                  title="Edit Lorry Hire / Multi-Advances / Deductions"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              )}
              {readOnly || (!isMasterAdmin && h.balancePaid) ? (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                  <Lock className="w-3 h-3" />
                  {readOnly ? 'View' : 'Locked'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    onShowConfirm({
                      title: `Delete Lorry Hire ${h.cnNo}?`,
                      description: `Remove hire register record for ${h.truckNo}?`,
                      confirmLabel: 'Delete',
                      variant: 'danger',
                      onConfirm: () => removeDocument('lorry_hires', h.id),
                    })
                  }
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
    [onShowConfirm, isMasterAdmin, readOnly, onPreviewPdf]
  );

  // Live POD Modal shortage/damage preview
  const podBookedNum = Number(podBookedPkgs) || 0;
  const podDeliveredNum = podDeliveredPkgs === '' ? podBookedNum : Number(podDeliveredPkgs) || 0;
  const podShortDamaged = Math.max(0, podBookedNum - podDeliveredNum);
  const podPreviewNet = activePodTarget
    ? computeLorryNetPayable({
        hireAmount: Number(activePodTarget.hireAmount || 0),
        advancePaid: Number(activePodTarget.advancePaid || 0),
        loadingCharge: Number(activePodTarget.loadingCharge || 0),
        unloadingCharge: Number(activePodTarget.unloadingCharge || 0),
        parkingCharge: Number(activePodTarget.parkingCharge || 0),
        kataCharge: Number(activePodTarget.kataCharge || 0),
        shortageCharge: Number(podShortageCharge) || 0,
        damageCharge: Number(podDamageCharge) || 0,
      }).balancePayable
    : 0;

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleCreateOrUpdateHire}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Truck className="w-4 h-4" />
            <span>
              {editingHireId
                ? `Editing Lorry Hire & Deductions (${cnNo})`
                : `Lorry Hire & POD Reconciliation (${activeBranchCode})`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[165px]">
              <SearchableSelect
                ariaLabel="Lorry Hire Division"
                value={division}
                onChange={(val) => setDivision(val === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
                options={[
                  { value: 'FTL', label: 'FTL Division' },
                  { value: 'LOGISTICS', label: 'LOGISTICS Division' },
                ]}
                triggerClassName="!py-1 !text-[#0D47A1] !font-extrabold"
                searchPlaceholder="Search division..."
              />
            </div>
            <span className="text-xs text-blue-100">
              Booked vs Delivered Pkgs · Multi-Advance · Step-by-Step Deductions
            </span>
            {editingHireId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Cancel Edit
              </button>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* Trip & Pkgs Reconciliation */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">C/N Number *</label>
              <input
                type="text"
                required
                list="hire-cn-list"
                value={cnNo}
                onChange={(e) => handleSelectCn(e.target.value)}
                placeholder="KOL/146/26-27"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
              />
              <datalist id="hire-cn-list">
                {consignments.map((c) => (
                  <option key={c.id} value={c.cnNo} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Truck No *</label>
              <RichEntityPicker<Vehicle>
                ariaLabel="Lorry Hire Truck No"
                value={truckNo}
                selectedId={selectedVehicleId}
                onChangeText={(nextText) => {
                  const val = nextText.toUpperCase();
                  setTruckNo(val);
                  const matches = vehicles.filter(
                    (v) => v.truckNo.trim().toUpperCase() === val.trim()
                  );
                  if (matches.length === 1) {
                    const v = matches[0];
                    setSelectedVehicleId(v.id);
                    if (v.ownerName && !ownerName.trim()) {
                      setOwnerName(v.ownerName);
                    }
                    applyHireSmartAutoFill(val, v.ownerName || ownerName, toCity);
                  } else {
                    setSelectedVehicleId('');
                    applyHireSmartAutoFill(val, ownerName, toCity);
                  }
                }}
                onSelectEntity={(v) => {
                  const upper = v.truckNo.toUpperCase();
                  setTruckNo(upper);
                  setSelectedVehicleId(v.id);
                  const nextOwner = v.ownerName || ownerName;
                  if (v.ownerName) {
                    setOwnerName(v.ownerName);
                    const om = ownerParties.filter(
                      (p) => p.name.trim().toLowerCase() === v.ownerName.trim().toLowerCase()
                    );
                    setSelectedOwnerId(om.length === 1 ? om[0].id : '');
                  }
                  applyHireSmartAutoFill(upper, nextOwner, toCity);
                }}
                items={vehicles}
                getId={(v) => v.id}
                getValue={(v) => v.truckNo}
                getSearchText={(v) =>
                  `${v.truckNo} ${v.ownerName || ''} ${v.vehicleType || ''} ${v.ownerPhone || ''}`
                }
                renderTitle={(v) => v.truckNo}
                renderBadge={(v) => v.vehicleType || 'Truck'}
                renderDetails={(v) => formatVehicleDetailsLine(v)}
                placeholder="WB51B0800 — Search Truck, Owner or Type..."
                required
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
              <label className="block font-semibold text-slate-700 mb-1">Lorry Owner</label>
              <RichEntityPicker<Party>
                ariaLabel="Lorry Owner"
                value={ownerName}
                selectedId={selectedOwnerId}
                onChangeText={(val) => {
                  setOwnerName(val);
                  const matches = ownerParties.filter(
                    (o) => o.name.trim().toLowerCase() === val.trim().toLowerCase()
                  );
                  setSelectedOwnerId(matches.length === 1 ? matches[0].id : '');
                  applyHireSmartAutoFill(truckNo, val, toCity);
                }}
                onSelectEntity={(o) => {
                  setOwnerName(o.name);
                  setSelectedOwnerId(o.id);
                  applyHireSmartAutoFill(truckNo, o.name, toCity);
                }}
                items={ownerParties}
                getId={(o) => o.id}
                getValue={(o) => o.name}
                getSearchText={(o) =>
                  `${o.name} ${o.pan || ''} ${o.phone || ''} ${o.address || ''}`
                }
                renderTitle={(o) => o.name}
                renderBadge={(o) => o.partyType}
                renderDetails={(o) => formatPartyDetailsLine(o)}
                placeholder="Search Owner by Name, PAN, Mobile or City..."
                quickPreview={(() => {
                  const clean = ownerName.trim().toLowerCase();
                  if (!clean) return null;
                  const matches = ownerParties.filter(
                    (o) => o.name.trim().toLowerCase() === clean
                  );
                  const resolved =
                    (selectedOwnerId
                      ? ownerParties.find((o) => o.id === selectedOwnerId)
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
              <label className="block font-semibold text-slate-700 mb-1">Broker (Optional)</label>
              <RichEntityPicker<Party>
                ariaLabel="Broker (Optional)"
                value={brokerName}
                selectedId={selectedBrokerId}
                onChangeText={(val) => {
                  setBrokerName(val);
                  const matches = brokerParties.filter(
                    (b) => b.name.trim().toLowerCase() === val.trim().toLowerCase()
                  );
                  setSelectedBrokerId(matches.length === 1 ? matches[0].id : '');
                }}
                onSelectEntity={(b) => {
                  setBrokerName(b.name);
                  setSelectedBrokerId(b.id);
                }}
                items={brokerParties}
                getId={(b) => b.id}
                getValue={(b) => b.name}
                getSearchText={(b) =>
                  `${b.name} ${b.pan || ''} ${b.phone || ''} ${b.address || ''}`
                }
                renderTitle={(b) => b.name}
                renderBadge={(b) => b.partyType}
                renderDetails={(b) => formatPartyDetailsLine(b)}
                placeholder="Search Broker by Name, PAN, Mobile or City..."
                quickPreview={(() => {
                  const clean = brokerName.trim().toLowerCase();
                  if (!clean) return null;
                  const matches = brokerParties.filter(
                    (b) => b.name.trim().toLowerCase() === clean
                  );
                  const resolved =
                    (selectedBrokerId
                      ? brokerParties.find((b) => b.id === selectedBrokerId)
                      : undefined) ||
                    (matches.length === 1 ? matches[0] : matches[0]);
                  return (
                    <EntityQuickPreviewCard
                      kind="broker"
                      party={resolved}
                      duplicateCount={matches.length}
                      ambiguousSelected={matches.length > 1 && !selectedBrokerId}
                      compact
                    />
                  );
                })()}
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">C/N Date</label>
              <input
                type="date"
                value={cnDate}
                onChange={(e) => setCnDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">From</label>
              <input
                type="text"
                value={fromCity}
                onChange={(e) => setFromCity(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
              <label className="block font-semibold text-slate-700 mb-1">To</label>
              <input
                type="text"
                value={toCity}
                onChange={(e) => setToCity(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
              <label className="block font-semibold text-slate-700 mb-1">Gross Lorry Hire (₹) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={hireAmount}
                onChange={(e) => {
                  setHireAmount(e.target.value);
                  const h = Number(e.target.value) || 0;
                  const pct = Number(tdsRatePct) || 0;
                  if (pct > 0) {
                    setTdsAmount(String(Math.round(((h * pct) / 100) * 100) / 100));
                  }
                }}
                placeholder="45000"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-blue-900"
              />
            </div>
          </div>

          {/* Weight / Rate / TDS 194C / Receipt Challan / Detention (2-Day Free Rule) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Weight (MT)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={weightMt}
                onChange={(e) => {
                  setWeightMt(e.target.value);
                  if (!isLumpSumRateMode(rateMode)) {
                    const wt = Number(e.target.value) || 0;
                    const rt = Number(ratePerUnit) || 0;
                    if (rt > 0) {
                      const nextHire = computeRateModeAmount({
                        rateMode,
                        ratePerUnit: rt,
                        weightMt: wt,
                        packages: bookedNum,
                      });
                      if (nextHire > 0) {
                        setHireAmount(String(nextHire));
                        if (Number(tdsRatePct) > 0) handleTdsPctChange(tdsRatePct, nextHire);
                      }
                    }
                  }
                }}
                placeholder="20.00"
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Hire Rate Mode</label>
              <EditableSearchSelect
                ariaLabel="Hire Rate Mode"
                value={rateMode}
                onChange={(val) => {
                  setRateMode(val);
                  const rt = Number(ratePerUnit) || 0;
                  if (rt > 0) {
                    const nextHire = computeRateModeAmount({
                      rateMode: val,
                      ratePerUnit: rt,
                      weightMt: Number(weightMt) || 0,
                      packages: bookedNum,
                    });
                    if (nextHire > 0) {
                      setHireAmount(String(nextHire));
                      if (Number(tdsRatePct) > 0) handleTdsPctChange(tdsRatePct, nextHire);
                    }
                  }
                }}
                options={Array.from(
                  new Set([...DEFAULT_RATE_MODES, ...getEffectiveDropdownList(effectiveCompany, 'rateModes')])
                )}
                onAddOption={(val) => addDropdownItem(ownerUid, effectiveCompany, 'rateModes', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, effectiveCompany, 'rateModes', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, effectiveCompany, 'rateModes', val)}
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Rate (₹ / Unit)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={ratePerUnit}
                onChange={(e) => {
                  setRatePerUnit(e.target.value);
                  const rt = Number(e.target.value) || 0;
                  if (rt > 0) {
                    const nextHire = computeRateModeAmount({
                      rateMode,
                      ratePerUnit: rt,
                      weightMt: Number(weightMt) || 0,
                      packages: bookedNum,
                    });
                    if (nextHire > 0) {
                      setHireAmount(String(nextHire));
                      if (Number(tdsRatePct) > 0) handleTdsPctChange(tdsRatePct, nextHire);
                    }
                  }
                }}
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Detention Days (2d Free)</label>
              <input
                type="number"
                min={0}
                value={detentionDays}
                onChange={(e) => handleDetentionDaysChange(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Detention Rate/Day (₹)</label>
              <input
                type="number"
                min={0}
                value={detentionRatePerDay}
                onChange={(e) => {
                  setDetentionRatePerDay(e.target.value);
                  handleDetentionDaysChange(detentionDays, e.target.value);
                }}
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold text-emerald-800 mb-1">(+) Detention Chg (₹)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={detentionCharge}
                onChange={(e) => setDetentionCharge(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-emerald-300 bg-emerald-50 font-mono-num font-bold text-emerald-900"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">TDS 194C (%)</label>
              <SearchableSelect
                ariaLabel="TDS 194C Percentage"
                value={tdsRatePct}
                onChange={(val) => handleTdsPctChange(val)}
                options={[
                  { value: '0', label: '0% (194C Decl)' },
                  { value: '1', label: '1% (Individual/HUF)' },
                  { value: '2', label: '2% (Company/Firm)' },
                ]}
                triggerClassName="!py-1.5 !font-semibold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">(-) TDS Amount (₹)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={tdsAmount}
                onChange={(e) => setTdsAmount(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Receipt Challan No.</label>
              <input
                type="text"
                value={receiptChallanNo}
                onChange={(e) => setReceiptChallanNo(e.target.value)}
                placeholder="CH-1042"
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Challan Receipt Date {receiptChallanNo.trim() ? <span className="text-red-600">*</span> : ''}
              </label>
              <input
                type="date"
                required={Boolean(receiptChallanNo.trim())}
                value={receiptChallanDate}
                onChange={(e) => {
                  setReceiptChallanDate(e.target.value);
                  if (e.target.value.trim()) setFormError(null);
                }}
                className={`w-full px-2 py-1.5 rounded border bg-white font-mono-num ${
                  receiptChallanNo.trim() && !receiptChallanDate.trim()
                    ? 'border-red-400 bg-red-50'
                    : 'border-slate-300'
                }`}
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Extra Advance (₹)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={extraAdvanceAmt}
                onChange={(e) => setExtraAdvanceAmt(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Remarks</label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional note..."
                className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white"
              />
            </div>
          </div>

          {/* Booked Pkgs vs Delivered Pkgs -> Auto Shortage/Damage */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-blue-50/70 p-3 rounded-lg border border-blue-200">
            <div>
              <label className="block font-bold text-blue-900 mb-1">Booked Pkgs</label>
              <input
                type="number"
                min={0}
                value={bookedPkgs}
                onChange={(e) => {
                  setBookedPkgs(e.target.value);
                  if (deliveredPkgs === '' || deliveredPkgs === bookedPkgs) {
                    setDeliveredPkgs(e.target.value);
                  }
                }}
                placeholder="e.g. 100"
                className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white font-mono-num font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-blue-900 mb-1">Delivered Pkgs (As per POD)</label>
              <input
                type="number"
                min={0}
                value={deliveredPkgs}
                onChange={(e) => setDeliveredPkgs(e.target.value)}
                placeholder="e.g. 97"
                className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-white font-mono-num font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-blue-900 mb-1">Auto Shortage / Damage Pkgs</label>
              <div
                className={`px-3 py-1.5 rounded border font-mono-num font-extrabold flex items-center justify-between ${
                  shortageDamagePkgs > 0
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                }`}
              >
                <span>{shortageDamagePkgs} Pkgs Short / Damaged</span>
                {shortageDamagePkgs > 0 && <AlertTriangle className="w-4 h-4 shrink-0" />}
              </div>
            </div>
          </div>

          {/* Multi-Advance (Yes/No) Rows up to 50 with Live Running Balance */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">ADVANCE PAYMENTS ({activeAdvanceRows.length}/50)</span>
                <div className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                  <span>Multi-Advance:</span>
                  <SearchableSelect
                    ariaLabel="Multi-Advance (Yes/No)"
                    value={hasMultiAdvance ? 'Yes' : 'No'}
                    onChange={(val) => {
                      const next = val === 'Yes';
                      setHasMultiAdvance(next);
                      if (next && advances.length === 0) {
                        setAdvances([DEFAULT_ADVANCE_ROW()]);
                      }
                    }}
                    options={[
                      { value: 'No', label: 'No' },
                      { value: 'Yes', label: 'Yes' },
                    ]}
                    triggerClassName="!py-0.5 !px-2 !text-xs !font-bold !text-blue-900 !min-w-[82px]"
                  />
                </div>
              </div>
              {hasMultiAdvance && (
                <button
                  type="button"
                  disabled={advances.length >= 50}
                  onClick={() => setAdvances((prev) => [...prev.slice(0, 49), DEFAULT_ADVANCE_ROW()])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Advance Row
                </button>
              )}
            </div>

            <div className="space-y-2">
              {activeAdvanceRows.map((adv, idx) => (
                <div
                  key={idx}
                  className="bg-white p-2.5 rounded border border-slate-200 space-y-2"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-end">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        Payee Type
                      </label>
                      <SearchableSelect
                        ariaLabel={`Advance ${idx + 1} Payee Type`}
                        value={adv.payeeType}
                        onChange={(val) =>
                          setAdvances((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, payeeType: val } : r))
                          )
                        }
                        options={[
                          { value: 'Broker', label: 'Broker' },
                          { value: 'Lorry Owner', label: 'Lorry Owner' },
                          { value: 'Driver', label: 'Driver' },
                        ]}
                        triggerClassName="!py-1.5 !font-semibold"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        Account Name / Bank
                      </label>
                      <SearchableSelect
                        ariaLabel={`Advance ${idx + 1} Account Name`}
                        value={adv.accountName}
                        onChange={(val) =>
                          setAdvances((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, accountName: val } : r))
                          )
                        }
                        options={sortAlphaList(
                          adv.accountName &&
                            !accountBankOptions.some((o) => o.toLowerCase() === adv.accountName.toLowerCase())
                            ? [...accountBankOptions, adv.accountName]
                            : accountBankOptions
                        ).map((opt) => ({ value: opt, label: opt }))}
                        triggerClassName="!py-1.5"
                        searchPlaceholder="Search bank / account..."
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        Advance Date
                      </label>
                      <input
                        type="date"
                        value={adv.advanceDate}
                        onChange={(e) =>
                          setAdvances((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, advanceDate: e.target.value } : r))
                          )
                        }
                        className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        Mode
                      </label>
                      <EditableSearchSelect
                        ariaLabel={`Advance ${idx + 1} Mode`}
                        value={adv.mode}
                        onChange={(val) =>
                          setAdvances((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, mode: val } : r))
                          )
                        }
                        options={getEffectiveDropdownList(effectiveCompany, 'paymentModes')}
                        onAddOption={(val) => addDropdownItem(ownerUid, effectiveCompany, 'paymentModes', val)}
                        onEditOption={(oldV, newV) => editDropdownItem(ownerUid, effectiveCompany, 'paymentModes', oldV, newV)}
                        onDeleteOption={(val) => deleteDropdownItem(ownerUid, effectiveCompany, 'paymentModes', val)}
                        placeholder="Payment Mode..."
                      />
                    </div>
                    <div className="flex items-end gap-1.5">
                      <div className="flex-1">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Amount (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={adv.amount}
                          onChange={(e) =>
                            setAdvances((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, amount: Number(e.target.value) || 0 } : r
                              )
                            )
                          }
                          className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-right"
                        />
                      </div>
                      {hasMultiAdvance && activeAdvanceRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setAdvances((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 rounded text-red-600 hover:bg-red-50 cursor-pointer"
                          title="Remove advance row"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center text-[11px]">
                    <input
                      type="text"
                      value={adv.holderName || ''}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, holderName: e.target.value } : r))
                        )
                      }
                      placeholder="Holder Name"
                      className="px-2 py-1 rounded border border-slate-200 bg-slate-50"
                    />
                    <input
                      type="text"
                      value={adv.bankAccountNo || ''}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, bankAccountNo: e.target.value } : r
                          )
                        )
                      }
                      placeholder="A/c No."
                      className="px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono-num"
                    />
                    <input
                      type="text"
                      value={adv.upiId || ''}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, upiId: e.target.value } : r))
                        )
                      }
                      placeholder="UPI ID"
                      className="px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono-num"
                    />
                    <input
                      type="text"
                      value={adv.refNo || ''}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, refNo: e.target.value } : r))
                        )
                      }
                      placeholder="UTR / Cheque / Ref No."
                      className="px-2 py-1 rounded border border-slate-200 bg-slate-50 font-mono-num"
                    />
                    <div className="px-2 py-1 rounded bg-emerald-50 border border-emerald-200 font-mono-num font-bold text-emerald-900 text-right">
                      Running Bal: ₹{formatINR(advanceRunningBalances[idx] ?? balancePayable)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end text-xs font-extrabold text-slate-900 pt-1">
              <span>
                Final Balance Due after {activeAdvanceRows.length} Advance(s): ₹{' '}
                <span className="font-mono-num text-emerald-700">{formatINR(balancePayable)}</span>
              </span>
            </div>
          </div>

          {/* Step-by-Step Deductions & Live Net Payable Ledger */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">(-) Loading Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={loadingCharge}
                  onChange={(e) => setLoadingCharge(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">(-) Unloading Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={unloadingCharge}
                  onChange={(e) => setUnloadingCharge(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">(-) Parking Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={parkingCharge}
                  onChange={(e) => setParkingCharge(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">(-) Kata Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={kataCharge}
                  onChange={(e) => setKataCharge(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-red-700 mb-1">(-) Shortage Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={shortageCharge}
                  onChange={(e) => setShortageCharge(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-red-300 bg-white font-mono-num font-bold text-red-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-red-700 mb-1">(-) Damage Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={damageCharge}
                  onChange={(e) => setDamageCharge(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-red-300 bg-white font-mono-num font-bold text-red-700"
                />
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-blue-200 space-y-1 text-[11px] font-mono-num">
              <div className="font-sans font-extrabold text-blue-900 text-xs pb-1 border-b border-slate-200">
                STEP-BY-STEP SETTLEMENT LEDGER
              </div>
              <div className="flex justify-between">
                <span>Gross Lorry Hire:</span>
                <span className="font-bold">₹ {formatINR(hireNum)}</span>
              </div>
              {detChgNum > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>(+) Detention ({Math.max(0, (Number(detentionDays) || 0) - 2)}d):</span>
                  <span>+ ₹ {formatINR(detChgNum)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>(-) Advances ({activeAdvanceRows.length}) + Extra:</span>
                <span>- ₹ {formatINR(totalAdvances + extraAdvNum)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>(-) Loading + Unloading:</span>
                <span>- ₹ {formatINR(loadNum + unloadNum)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>(-) Parking + Kata:</span>
                <span>- ₹ {formatINR(parkNum + kataNum)}</span>
              </div>
              {tdsAmtNum > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>(-) TDS 194C ({tdsRatePct}%):</span>
                  <span>- ₹ {formatINR(tdsAmtNum)}</span>
                </div>
              )}
              <div className="flex justify-between text-red-700">
                <span>(-) Shortage ({shortageDamagePkgs} Pkgs) / Damage:</span>
                <span>- ₹ {formatINR(shortChgNum + dmgChgNum)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-300 text-sm font-extrabold text-emerald-700">
                <span className="font-sans">Net Payable Balance:</span>
                <span>₹ {formatINR(balancePayable)}</span>
              </div>
              <div className="pt-1 text-[10px] font-sans text-slate-700 space-y-0.5">
                <div>
                  <span className="font-bold text-amber-900">Advance in Words:</span>{' '}
                  {amountToIndianWords(totalAdvances + extraAdvNum)}
                </div>
                <div>
                  <span className="font-bold text-emerald-900">Balance in Words:</span>{' '}
                  {amountToIndianWords(balancePayable)}
                </div>
              </div>
            </div>
          </div>
          {formError && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
          {filteredHires.length > 0 && !editingHireId && (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                const target = filteredHires.find((x) => !x.balancePaid) || filteredHires[0];
                if (target) handleLoadForEdit(target);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold cursor-pointer disabled:opacity-40"
              title="Reload latest Lorry Hire into form for Rectification"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Rectify Last
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const target =
                (editingHireId && lorryHires.find((x) => x.id === editingHireId)) ||
                filteredHires[0];
              if (!target) return;
              setActivePodTarget(target);
              setPodTruckNo(target.truckNo || '');
              setPodDate(target.podReceiveDate || todayISO());
              setPodBookedPkgs(target.bookedPkgs != null ? String(target.bookedPkgs) : '');
              setPodDeliveredPkgs(
                target.deliveredPkgs != null
                  ? String(target.deliveredPkgs)
                  : target.bookedPkgs != null
                    ? String(target.bookedPkgs)
                    : ''
              );
              setPodShortageCharge(String(target.shortageCharge ?? 0));
              setPodDamageCharge(String(target.damageCharge ?? 0));
              setPodRemarks(target.podRemarks || '');
              setPodShortageAlert(false);
              setPodImageUrl(target.podImageDataUrl || '');
              setPodFileName(target.podFileName || '');
              setPodScanStatus(null);
            }}
            disabled={filteredHires.length === 0 && !editingHireId}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold cursor-pointer disabled:opacity-40"
          >
            <ScanLine className="w-3.5 h-3.5" />
            Scan POD
          </button>
          <button
            type="button"
            onClick={async () => {
              const pdf = await buildHireVoucherPdf(buildCurrentHireSnapshot());
              if (onPreviewPdf) onPreviewPdf(pdf, 'Reports_Ledgers');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
          <button
            type="button"
            onClick={async () => {
              const pdf = await buildHireVoucherPdf(buildCurrentHireSnapshot());
              downloadPdfDirect(pdf);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Low-KB PDF
          </button>
          <button
            type="button"
            onClick={async () => {
              const pdf = await buildHireVoucherPdf(buildCurrentHireSnapshot());
              printPdfDirect(pdf);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Manual Print
          </button>
          <button
            type="button"
            onClick={async () => {
              const snap = buildCurrentHireSnapshot();
              const pdf = await buildHireVoucherPdf(snap);
              const matchedParty = parties.find(
                (p) =>
                  p.name.trim().toLowerCase() === (snap.ownerName || '').trim().toLowerCase() ||
                  p.name.trim().toLowerCase() === (snap.brokerName || '').trim().toLowerCase()
              );
              await sharePdfDirect({
                pdf,
                channel: 'whatsapp',
                phone: matchedParty?.phone,
                email: matchedParty?.email,
                partyName: snap.ownerName || snap.brokerName || snap.truckNo,
                docNo: snap.cnNo,
                docLabel: 'Lorry Hire Challan',
                company: effectiveCompany,
              });
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Share WA
          </button>
          <button
            type="submit"
            disabled={saving || readOnly}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving
              ? 'Saving...'
              : editingHireId
                ? 'Update Lorry Hire & Deductions'
                : 'Save Lorry Hire (Locked Until POD)'}
          </button>
        </div>
      </form>

      {/* Paginated Lorry Hire Register Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold">Lorry Hire Register ({filteredHires.length})</span>
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-blue-100" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search CN, Truck, Owner, Broker..."
              className="px-2.5 py-1 rounded bg-white text-slate-900 text-xs w-56 focus:outline-none"
            />
          </div>
        </div>
        <PaginatedDataTable
          data={filteredHires}
          columns={hireColumns}
          getRowId={(h) => h.id}
          defaultPageSize={50}
          emptyMessage="No lorry hire entries recorded yet."
        />
      </div>

      {/* Collapsible Linked Staff Commission & Advance Ledger */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCommissionLedger((v) => !v)}
          className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white flex items-center justify-between text-xs font-bold cursor-pointer"
        >
          <span>
            Linked Staff Commission &amp; Advance Ledger ({staffCommissions.length} entries · Wheel Rates 4-Wh to 22-Wh)
          </span>
          {showCommissionLedger ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
        {showCommissionLedger && (
          <div className="p-3 bg-slate-50">
            <StaffCommissionModule
              commissions={staffCommissions}
              staffAccounts={staffAccounts}
              company={company || { ...DEFAULT_COMPANY_SETTINGS, ownerUid }}
              activeFy={activeFy}
              ownerUid={ownerUid}
              currentStaffCode={activeStaffCode}
              currentBranchCode={activeBranchCode}
              readOnly={readOnly}
              compact
              prefillChallanNo={cnNo}
              prefillTruckNo={truckNo}
              onOpenPreview={(pdf) => onPreviewPdf?.(pdf, 'Reports_Ledgers')}
            />
          </div>
        )}
      </div>

      {/* POD Scanner & Shortage/Damage Reconciliation Modal */}
      {activePodTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl">
            <div className="bg-[#0D47A1] text-white px-5 py-3 flex items-center justify-between sticky top-0 z-10">
              <h3 className="text-sm font-bold">
                POD Scan &amp; Shortage/Damage Reconciliation — {activePodTarget.cnNo} ({activePodTarget.truckNo})
              </h3>
              <button
                type="button"
                onClick={() => setActivePodTarget(null)}
                className="text-xs text-blue-100 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="flex flex-wrap gap-2">
                <input
                  ref={podCamRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handlePodScanUpload(e.target.files?.[0])}
                />
                <input
                  ref={podFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePodScanUpload(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => setCamScannerOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Live Camera POD &amp; QR
                </button>
                <button
                  type="button"
                  onClick={() => podCamRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Quick Photo POD
                </button>
                <button
                  type="button"
                  onClick={() => podFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Upload POD Image
                </button>
                <button
                  type="button"
                  onClick={handleToggleUsbScannerWatch}
                  disabled={!isFileSystemDirectorySupported()}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white font-bold cursor-pointer disabled:opacity-50 ${
                    usbWatcherActive
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-indigo-700 hover:bg-indigo-800'
                  }`}
                  title="Works with HP, Canon, Epson & Brother USB Scanners saving to a folder"
                >
                  <Usb className="w-4 h-4" />
                  {usbWatcherActive
                    ? `Watching "${usbFolderName}" (Click to Stop)`
                    : '🔌 Connect Any USB Scanner Folder (Auto-Watch)'}
                </button>
                {!driveAccessToken && (
                  <button
                    type="button"
                    onClick={onConnectDrive}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold cursor-pointer"
                  >
                    <CloudUpload className="w-4 h-4" />
                    Connect Drive (POD_Scans)
                  </button>
                )}
              </div>

              {/* USB 300-DPI Auto-Crop + CamScanner Magic Color / B&W Sharp Enhancement Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-indigo-950 font-bold">
                  <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Scanner Engine:</span>
                  <button
                    type="button"
                    onClick={() => setUsbFilterMode('magic_color')}
                    className={`px-2 py-0.5 rounded border text-[11px] font-bold cursor-pointer ${
                      usbFilterMode === 'magic_color'
                        ? 'bg-indigo-700 text-white border-indigo-700'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Magic Color
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsbFilterMode('bw_sharp')}
                    className={`px-2 py-0.5 rounded border text-[11px] font-bold cursor-pointer ${
                      usbFilterMode === 'bw_sharp'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    B&amp;W Sharp
                  </button>
                </div>
                <label className="inline-flex items-center gap-1.5 font-bold text-indigo-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={usbAutoCrop}
                    onChange={(e) => setUsbAutoCrop(e.target.checked)}
                    className="rounded border-indigo-400"
                  />
                  <span>300-DPI Auto-Crop</span>
                </label>
              </div>

              {podShortageAlert && (
                <div className="p-3 rounded-lg bg-red-600 text-white font-extrabold flex items-center gap-2 shadow-sm">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span>
                    SHORTAGE / BREAKAGE / LEAKAGE DETECTED ON POD! Verify Delivered Pkgs &amp; Deduction Charges before unlocking payment.
                  </span>
                </div>
              )}

              {podScanStatus && (
                <p
                  className={`text-xs font-semibold p-2.5 rounded-lg border ${
                    podShortageAlert
                      ? 'text-red-900 bg-red-50 border-red-300'
                      : 'text-blue-800 bg-blue-50 border-blue-200'
                  }`}
                >
                  {podScanStatus}
                </p>
              )}

              {podImageUrl && (
                <div className="border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1">
                  <img
                    src={podImageUrl}
                    alt="Scanned POD"
                    referrerPolicy="no-referrer"
                    className="max-h-44 mx-auto rounded object-contain"
                  />
                  <p className="text-[11px] font-mono-num text-center font-bold text-slate-700">
                    Output PDF: POD_{(podTruckNo.trim() || activePodTarget.truckNo || activePodTarget.cnNo || 'TRUCK').toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '_')}_{formatDateHyphenDDMMYYYY(podDate || todayISO())}.pdf
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Booked Pkgs</label>
                  <input
                    type="number"
                    min={0}
                    value={podBookedPkgs}
                    onChange={(e) => setPodBookedPkgs(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Delivered Pkgs</label>
                  <input
                    type="number"
                    min={0}
                    value={podDeliveredPkgs}
                    onChange={(e) => setPodDeliveredPkgs(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Short / Damaged Pkgs</label>
                  <div
                    className={`px-2.5 py-1.5 rounded border font-mono-num font-extrabold ${
                      podShortDamaged > 0
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    }`}
                  >
                    {podShortDamaged} Pkgs
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-red-700 mb-1">Shortage Charge (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={podShortageCharge}
                    onChange={(e) => setPodShortageCharge(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-red-300 bg-white font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-red-700 mb-1">Damage Charge (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={podDamageCharge}
                    onChange={(e) => setPodDamageCharge(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-red-300 bg-white font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-emerald-800 mb-1">Recomputed Net Payable</label>
                  <div className="px-2.5 py-1.5 rounded border border-emerald-300 bg-emerald-50 font-mono-num font-extrabold text-emerald-800">
                    ₹ {formatINR(podPreviewNet)}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">POD Remarks / Shortage Note</label>
                <input
                  type="text"
                  value={podRemarks}
                  onChange={(e) => setPodRemarks(e.target.value)}
                  placeholder="Clean delivery / shortage or damage observation..."
                  className="w-full px-3 py-1.5 rounded border border-slate-300 bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div>
                  <label className="block font-bold text-amber-950 mb-1">
                    Truck No (Editable for POD PDF Filename) *
                  </label>
                  <input
                    type="text"
                    required
                    value={podTruckNo}
                    onChange={(e) => setPodTruckNo(e.target.value.toUpperCase())}
                    placeholder="e.g. WB23D4589"
                    className="w-full px-3 py-2 rounded border border-amber-300 bg-white font-mono-num font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="block font-bold text-amber-950 mb-1">
                    POD Submission / Receive Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={podDate}
                    onChange={(e) => setPodDate(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-amber-300 bg-white font-mono-num font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200">
                {podImageUrl && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        const pdf = await generatePodScanPDF({
                          imageDataUrl: podImageUrl,
                          truckNo: (podTruckNo.trim() || activePodTarget.truckNo || activePodTarget.cnNo).toUpperCase(),
                          cnNo: activePodTarget.cnNo,
                          podDate: podDate || todayISO(),
                          remarks: podRemarks.trim(),
                          partyName: activePodTarget.ownerName || activePodTarget.brokerName,
                          division: (activePodTarget.division as BusinessMode) || 'FTL',
                          company: effectiveCompany,
                        });
                        if (onPreviewPdf) onPreviewPdf(pdf, 'POD_Scans');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-semibold cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const pdf = await generatePodScanPDF({
                          imageDataUrl: podImageUrl,
                          truckNo: (podTruckNo.trim() || activePodTarget.truckNo || activePodTarget.cnNo).toUpperCase(),
                          cnNo: activePodTarget.cnNo,
                          podDate: podDate || todayISO(),
                          remarks: podRemarks.trim(),
                          partyName: activePodTarget.ownerName || activePodTarget.brokerName,
                          division: (activePodTarget.division as BusinessMode) || 'FTL',
                          company: effectiveCompany,
                        });
                        downloadPdfDirect(pdf);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Low-KB PDF
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const pdf = await generatePodScanPDF({
                          imageDataUrl: podImageUrl,
                          truckNo: (podTruckNo.trim() || activePodTarget.truckNo || activePodTarget.cnNo).toUpperCase(),
                          cnNo: activePodTarget.cnNo,
                          podDate: podDate || todayISO(),
                          remarks: podRemarks.trim(),
                          partyName: activePodTarget.ownerName || activePodTarget.brokerName,
                          division: (activePodTarget.division as BusinessMode) || 'FTL',
                          company: effectiveCompany,
                        });
                        printPdfDirect(pdf);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-semibold cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Manual Print
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const pdf = await generatePodScanPDF({
                          imageDataUrl: podImageUrl,
                          truckNo: (podTruckNo.trim() || activePodTarget.truckNo || activePodTarget.cnNo).toUpperCase(),
                          cnNo: activePodTarget.cnNo,
                          podDate: podDate || todayISO(),
                          remarks: podRemarks.trim(),
                          partyName: activePodTarget.ownerName || activePodTarget.brokerName,
                          division: (activePodTarget.division as BusinessMode) || 'FTL',
                          company: effectiveCompany,
                        });
                        const matchedParty = parties.find(
                          (p) =>
                            p.name.trim().toLowerCase() === (activePodTarget.ownerName || '').trim().toLowerCase() ||
                            p.name.trim().toLowerCase() === (activePodTarget.brokerName || '').trim().toLowerCase()
                        );
                        await sharePdfDirect({
                          pdf,
                          channel: 'whatsapp',
                          phone: matchedParty?.phone,
                          email: matchedParty?.email,
                          partyName: activePodTarget.ownerName || activePodTarget.brokerName,
                          docNo: activePodTarget.cnNo,
                          docLabel: 'POD Scan',
                          company: effectiveCompany,
                        });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Share WA
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setActivePodTarget(null)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!podImageUrl || !podDate || !podTruckNo.trim() || podUploading}
                  onClick={handleSavePodScan}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                >
                  {podUploading ? 'Saving POD...' : 'Save POD & Unlock Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Release Balance Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <form
            onSubmit={handleReleaseBalancePayment}
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
          >
            <div className="bg-emerald-700 text-white px-5 py-3 text-sm font-bold">
              Release Lorry Balance — {payTarget.cnNo}
            </div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700">
                POD verified on <span className="font-mono-num font-bold">{formatDateDDMMYYYY(payTarget.podReceiveDate)}</span>.
                Releasing Net Payable balance <span className="font-mono-num font-bold text-emerald-700">₹{formatINR(payTarget.balancePayable)}</span> to{' '}
                <span className="font-bold">{payTarget.ownerName || payTarget.brokerName || payTarget.truckNo}</span>.
              </p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
                <EditableSearchSelect
                  ariaLabel="Balance Payment Mode"
                  value={payMode}
                  onChange={setPayMode}
                  options={getEffectiveDropdownList(effectiveCompany, 'paymentModes')}
                  onAddOption={(v) => addDropdownItem(ownerUid, effectiveCompany, 'paymentModes', v)}
                  onEditOption={(o, n) => editDropdownItem(ownerUid, effectiveCompany, 'paymentModes', o, n)}
                  onDeleteOption={(v) => deleteDropdownItem(ownerUid, effectiveCompany, 'paymentModes', v)}
                  inputClassName="!py-1.5"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reference / UTR No</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UTR-99102"
                  className="w-full px-3 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-4 py-1.5 rounded border border-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirm Balance Payment
              </button>
            </div>
          </form>
        </div>
      )}
      <CameraPodQrScannerModal
        open={camScannerOpen}
        mode="both"
        title={
          activePodTarget
            ? `POD & QR Camera Scanner — ${activePodTarget.cnNo} (${activePodTarget.truckNo})`
            : 'In-App Camera POD & QR Scanner'
        }
        onClose={() => setCamScannerOpen(false)}
        onCapturePodImage={(dataUrl, fileName) => {
          setPodImageUrl(dataUrl);
          setPodFileName(fileName);
          setPodScanStatus('Live camera POD captured & compressed (<440KB). Confirm POD Receive Date & Delivered Pkgs.');
        }}
        onQrDecoded={(parsed) => {
          setPodScanStatus(`QR Verified: ${parsed.summary}`);
        }}
      />
    </div>
  );
};

export const LorryHirePodModule = React.memo(LorryHirePodModuleInner);
