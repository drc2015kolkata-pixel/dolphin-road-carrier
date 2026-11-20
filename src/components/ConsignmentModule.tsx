import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileCode2,
  FilePlus2,
  Lock,
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
  ExtraTaxInvoice,
  Party,
  Vehicle,
} from '../types/erp';
import {
  formatDateDDMMYYYY,
  formatINR,
  getFyShortCode,
  makeSafeDocId,
  normalizeFyLabel,
  resolveFinancialYearFromDate,
  todayISO,
} from '../lib/formatters';
import { scanPhysicalLR } from '../lib/ocrEngine';
import {
  addDropdownItem,
  deleteDropdownItem,
  editDropdownItem,
  getEffectiveCreditDayPresets,
  getEffectiveDistrictsForState,
  getEffectiveDropdownList,
  upsertDistrictItem,
} from '../lib/dropdownMasterStore';
import {
  logBranchActivity,
  removeDocument,
  reserveNextSerialNumber,
  upsertDocument,
} from '../lib/firestoreStore';
import { GeneratedPdfResult, generateLR3CopyPDF } from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { EditableSearchSelect, YesNoSelect } from './EditableSearchSelect';
import { downloadNicPartBJson, getEwayBillExpiryState, ParsedQrPayload } from '../lib/ewayBillUtils';
import { CameraPodQrScannerModal } from './CameraPodQrScannerModal';

interface ConsignmentModuleProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
  readOnly?: boolean;
  consignments: ConsignmentNote[];
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  company: CompanySettings;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: DriveFolderName) => void;
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
  parties,
  vehicles,
  drivers,
  company,
  onPreviewPdf,
  onSendCnToInvoice,
  onSwitchFy,
  onShowConfirm,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
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
  const [autoAtomicCn, setAutoAtomicCn] = useState(true);
  const [cnNo, setCnNo] = useState(`${branchPrefix}-${147 + consignments.length}/${fyShort}`);
  const [cnDate, setCnDate] = useState(todayISO());
  const [deliveryOffice, setDeliveryOffice] = useState('');
  const [stockTransfer, setStockTransfer] = useState(false);

  // Mandatory Billing Party & Credit Days Lock
  const [billingPartyName, setBillingPartyName] = useState('');
  const [creditDaysOption, setCreditDaysOption] = useState<string>('');
  const [customCreditDays, setCustomCreditDays] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const [consignorName, setConsignorName] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [packages, setPackages] = useState('');
  const [packageMode, setPackageMode] = useState('Bags / Sacks');
  const [particulars, setParticulars] = useState('');
  const [rateMode, setRateMode] = useState('Fixed Lorry Freight (Lump Sum)');
  const [ratePerUnit, setRatePerUnit] = useState('');
  const [nettWeight, setNettWeight] = useState('0');
  const [grossWeight, setGrossWeight] = useState('0');
  const [loadingCharge, setLoadingCharge] = useState('0');
  const [unloadingCharge, setUnloadingCharge] = useState('0');
  const [returnLorryCharge, setReturnLorryCharge] = useState('0');
  const [sttCharge, setSttCharge] = useState('0');
  const [totalFreight, setTotalFreight] = useState('0');
  const [paidAmount, setPaidAmount] = useState('0');
  const [toPayAmount, setToPayAmount] = useState('0');

  // Yes/No Toggles for Tax Invoice, Multi E-Way Bill & Multi Vehicle
  const [hasTaxInvoice, setHasTaxInvoice] = useState(true);
  const [hasMultiEwayBill, setHasMultiEwayBill] = useState(false);
  const [hasMultiVehicle, setHasMultiVehicle] = useState(false);

  const [taxInvNo, setTaxInvNo] = useState('');
  const [taxInvDate, setTaxInvDate] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [ewayBillDate, setEwayBillDate] = useState('');
  const [ewayBillValidUpto, setEwayBillValidUpto] = useState('');
  const [ewbQrModalOpen, setEwbQrModalOpen] = useState(false);
  const [ewbTrackerMsg, setEwbTrackerMsg] = useState<string | null>(null);
  const [extraTaxInvoices, setExtraTaxInvoices] = useState<ExtraTaxInvoice[]>([]);
  const [extraEwayBills, setExtraEwayBills] = useState<ExtraEwayBill[]>([]);
  const [extraVehicles, setExtraVehicles] = useState<string[]>([]);
  const [valueOfGoods, setValueOfGoods] = useState('0');
  const [truckNo, setTruckNo] = useState('');

  // All-India Geo Cascade (State with GST code -> District -> Place/City)
  const [fromState, setFromState] = useState('19 - West Bengal');
  const [fromDistrict, setFromDistrict] = useState('Kolkata');
  const [fromCity, setFromCity] = useState('KOLKATA');
  const [toState, setToState] = useState('');
  const [toDistrict, setToDistrict] = useState('');
  const [toCity, setToCity] = useState('');

  const [engineNo, setEngineNo] = useState('');
  const [chassisNo, setChassisNo] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverDlNo, setDriverDlNo] = useState('');
  const [gstPaidBy, setGstPaidBy] = useState('Consignee');
  const [insuranceStatus] = useState('The Customer has not insured the consignment');
  const [remarks, setRemarks] = useState('');
  const [scannedLrDataUrl, setScannedLrDataUrl] = useState('');

  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrFyMismatch, setOcrFyMismatch] = useState<{
    detectedFy: string;
    detectedDate: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  // Live Dropdown Master Lists (Firestore synced)
  const goodsOptions = useMemo(() => getEffectiveDropdownList(company, 'goodsTypes'), [company]);
  const packageModeOptions = useMemo(() => getEffectiveDropdownList(company, 'packageModes'), [company]);
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
  const partyNameOptions = useMemo(() => {
    const set = new Set<string>(parties.map((p) => p.name).filter(Boolean));
    if (consignorName.trim()) set.add(consignorName.trim());
    if (consigneeName.trim()) set.add(consigneeName.trim());
    return Array.from(set);
  }, [parties, consignorName, consigneeName]);

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
    if (!editingId) {
      setCnNo(`${branchPrefix}-${147 + consignments.length}/${fyShort}`);
    }
  }, [activeFy, branchPrefix, consignments.length, editingId, fyShort]);

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
      setOcrError(null);
      setOcrFyMismatch(null);
      setOcrStatus('Scanning document in background worker (OCR + AI extraction)...');
      try {
        const { result, compressedDataUrl } = await scanPhysicalLR(file, (msg) =>
          setOcrStatus(msg)
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
        if (result.particulars) setParticulars(result.particulars);
        if (result.nettWeight) setNettWeight(String(result.nettWeight));
        if (result.grossWeight) setGrossWeight(String(result.grossWeight));
        if (result.totalFreight) {
          setTotalFreight(String(result.totalFreight));
          setToPayAmount(String(result.totalFreight));
        }
        if (result.truckNo) setTruckNo(result.truckNo);
        if (result.fromCity) setFromCity(result.fromCity);
        if (result.toCity) setToCity(result.toCity);
        if (result.ewayBillNo) setEwayBillNo(result.ewayBillNo);
        if (result.ewayBillDate) setEwayBillDate(result.ewayBillDate);
        if (result.taxInvNo) {
          setHasTaxInvoice(true);
          setTaxInvNo(result.taxInvNo);
        }
        if (result.taxInvDate) setTaxInvDate(result.taxInvDate);
        if (result.valueOfGoods) setValueOfGoods(String(result.valueOfGoods));
        if (result.ownerName) setOwnerName(result.ownerName);
        if (result.driverName) setDriverName(result.driverName);
        if (result.driverDlNo) setDriverDlNo(result.driverDlNo);
        setOcrStatus(
          result.confidenceNote ||
            'Scanned values auto-filled below — every field remains 100% editable before saving.'
        );
      } catch (err) {
        setOcrError(err instanceof Error ? err.message : 'Document scan failed');
        setOcrStatus(null);
      }
    },
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

  const handleSelectConsignor = (name: string) => {
    setConsignorName(name);
    const found = parties.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found) {
      setConsignorAddress(found.address || '');
      setConsignorGstin(found.gstin || '');
    }
    applyRouteSmartAutoFill(billingPartyName || name, toCity);
  };

  const handleSelectConsignee = (name: string) => {
    setConsigneeName(name);
    const found = parties.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found) {
      setConsigneeAddress(found.address || '');
      setConsigneeGstin(found.gstin || '');
    }
  };

  const handleSelectVehicle = (tNo: string) => {
    const upper = tNo.toUpperCase();
    setTruckNo(upper);
    const found = vehicles.find((v) => v.truckNo.toUpperCase() === upper);
    if (found) {
      setEngineNo(found.engineNo || '');
      setChassisNo(found.chassisNo || '');
      setOwnerName(found.ownerName || '');
    }
    const lastTrip = [...consignments]
      .filter((c) => c.truckNo?.toUpperCase() === upper)
      .sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''))[0];
    if (lastTrip) {
      if (!driverName.trim() && lastTrip.driverName) setDriverName(lastTrip.driverName);
      if (!driverDlNo.trim() && lastTrip.driverDlNo) setDriverDlNo(lastTrip.driverDlNo);
    }
  };

  const handleSelectDriver = (name: string) => {
    setDriverName(name);
    const found = drivers.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (found) {
      setDriverDlNo(found.dlNo || '');
    }
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

  const resetForm = () => {
    setEditingId(null);
    setEditingBilled(false);
    setDivision('FTL');
    setAutoAtomicCn(true);
    setCnNo(`${branchPrefix}-${147 + consignments.length}/${fyShort}`);
    setCnDate(todayISO());
    setDeliveryOffice('');
    setStockTransfer(false);
    setBillingPartyName('');
    setCreditDaysOption('');
    setCustomCreditDays('');
    setValidationError(null);
    setConsignorName('');
    setConsignorAddress('');
    setConsignorGstin('');
    setConsigneeName('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setPackages('');
    setPackageMode('Bags / Sacks');
    setParticulars('');
    setRateMode('Fixed Lorry Freight (Lump Sum)');
    setRatePerUnit('');
    setNettWeight('0');
    setGrossWeight('0');
    setLoadingCharge('0');
    setUnloadingCharge('0');
    setReturnLorryCharge('0');
    setSttCharge('0');
    setTotalFreight('0');
    setPaidAmount('0');
    setToPayAmount('0');
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
    setFromState('19 - West Bengal');
    setFromDistrict('Kolkata');
    setFromCity('KOLKATA');
    setToState('');
    setToDistrict('');
    setToCity('');
    setEngineNo('');
    setChassisNo('');
    setOwnerName('');
    setDriverName('');
    setDriverDlNo('');
    setGstPaidBy('Consignee');
    setRemarks('');
    setScannedLrDataUrl('');
    setOcrFyMismatch(null);
  };

  const handleLoadForEdit = (cn: ConsignmentNote) => {
    if (!isMasterAdmin && cn.billed) return;
    setEditingId(cn.id);
    setEditingBilled(Boolean(cn.billed));
    setDivision(cn.division === 'LOGISTICS' ? 'LOGISTICS' : 'FTL');
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
    setConsignorGstin(cn.consignorGstin || '');
    setConsigneeName(cn.consigneeName || '');
    setConsigneeAddress(cn.consigneeAddress || '');
    setConsigneeGstin(cn.consigneeGstin || '');
    setPackages(cn.packages || '');
    setPackageMode(cn.packageMode || 'Bags / Sacks');
    setParticulars(cn.particulars || '');
    setRateMode(cn.rateMode || 'Fixed Lorry Freight (Lump Sum)');
    setRatePerUnit(cn.ratePerUnit ? String(cn.ratePerUnit) : '');
    setNettWeight(String(cn.nettWeight ?? 0));
    setGrossWeight(String(cn.grossWeight ?? 0));
    setLoadingCharge(String(cn.loadingCharge ?? 0));
    setUnloadingCharge(String(cn.unloadingCharge ?? 0));
    setReturnLorryCharge(String(cn.returnLorryCharge ?? 0));
    setSttCharge(String(cn.sttCharge ?? 0));
    setTotalFreight(String(cn.totalFreight ?? 0));
    setPaidAmount(String(cn.paidAmount ?? 0));
    setToPayAmount(String(cn.toPayAmount ?? 0));
    setHasTaxInvoice(cn.hasTaxInvoice !== false);
    setHasMultiEwayBill(Boolean(cn.hasMultiEwayBill || (cn.extraEwayBills && cn.extraEwayBills.length > 0)));
    setHasMultiVehicle(Boolean(cn.hasMultiVehicle || (cn.extraVehicles && cn.extraVehicles.length > 0)));
    setTaxInvNo(cn.taxInvNo || '');
    setTaxInvDate(cn.taxInvDate || '');
    setEwayBillNo(cn.ewayBillNo || '');
    setEwayBillDate(cn.ewayBillDate || '');
    setEwayBillValidUpto(cn.ewayBillValidUpto || '');
    setEwbTrackerMsg(null);
    setExtraTaxInvoices(cn.extraTaxInvoices || []);
    setExtraEwayBills(cn.extraEwayBills || []);
    setExtraVehicles(cn.extraVehicles || []);
    setValueOfGoods(String(cn.valueOfGoods ?? 0));
    setTruckNo(cn.truckNo || '');
    setFromState(cn.fromState || '19 - West Bengal');
    setFromDistrict(cn.fromDistrict || 'Kolkata');
    setFromCity(cn.fromCity || 'KOLKATA');
    setToState(cn.toState || '');
    setToDistrict(cn.toDistrict || '');
    setToCity(cn.toCity || '');
    setEngineNo(cn.engineNo || '');
    setChassisNo(cn.chassisNo || '');
    setOwnerName(cn.ownerName || '');
    setDriverName(cn.driverName || '');
    setDriverDlNo(cn.driverDlNo || '');
    const rawGst = String(cn.gstPaidBy || 'Consignee').trim();
    setGstPaidBy(rawGst.startsWith('Consignee') ? 'Consignee' : rawGst);
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
    setValidationError(null);
    return true;
  };

  const buildPayload = (resolvedCnNo?: string): Omit<ConsignmentNote, 'id' | 'createdAt' | 'updatedAt'> => ({
    cnNo: (resolvedCnNo || cnNo).trim().slice(0, 40),
    cnDate,
    financialYear: normalizeFyLabel(activeFy),
    division,
    deliveryOffice: deliveryOffice.trim().slice(0, 200),
    stockTransfer,
    billingPartyName: billingPartyName.trim().slice(0, 180),
    creditDays: resolvedCreditDays,
    consignorName: consignorName.trim().slice(0, 180),
    consignorAddress: consignorAddress.trim().slice(0, 350),
    consignorGstin: consignorGstin.trim().slice(0, 24),
    consigneeName: consigneeName.trim().slice(0, 180),
    consigneeAddress: consigneeAddress.trim().slice(0, 350),
    consigneeGstin: consigneeGstin.trim().slice(0, 24),
    packages: packages.trim().slice(0, 40),
    packageMode: packageMode.trim().slice(0, 60),
    particulars: particulars.trim().slice(0, 400),
    rateMode: rateMode.trim().slice(0, 80),
    ratePerUnit: Number(ratePerUnit) || 0,
    nettWeight: Number(nettWeight) || 0,
    grossWeight: Number(grossWeight) || 0,
    loadingCharge: Number(loadingCharge) || 0,
    unloadingCharge: Number(unloadingCharge) || 0,
    returnLorryCharge: Number(returnLorryCharge) || 0,
    sttCharge: Number(sttCharge) || 0,
    totalFreight: Number(totalFreight) || 0,
    paidAmount: Number(paidAmount) || 0,
    toPayAmount: Number(toPayAmount) || 0,
    hasTaxInvoice,
    hasMultiEwayBill,
    hasMultiVehicle,
    taxInvNo: hasTaxInvoice ? taxInvNo.trim().slice(0, 80) : '',
    taxInvDate: hasTaxInvoice ? taxInvDate.trim().slice(0, 20) : '',
    ewayBillNo: ewayBillNo.trim().slice(0, 60),
    ewayBillDate: ewayBillDate.trim().slice(0, 20),
    ewayBillValidUpto: ewayBillValidUpto.trim().slice(0, 30),
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
    extraVehicles: hasMultiVehicle
      ? extraVehicles.map((v) => v.trim().toUpperCase()).filter(Boolean)
      : [],
    valueOfGoods: Number(valueOfGoods) || 0,
    truckNo: truckNo.trim().toUpperCase().slice(0, 30),
    fromState: fromState.trim().slice(0, 80),
    fromDistrict: fromDistrict.trim().slice(0, 80),
    fromCity: (fromCity || fromDistrict).trim().slice(0, 120),
    toState: toState.trim().slice(0, 80),
    toDistrict: toDistrict.trim().slice(0, 80),
    toCity: (toCity || toDistrict).trim().slice(0, 120),
    engineNo: engineNo.trim().slice(0, 40),
    chassisNo: chassisNo.trim().slice(0, 40),
    ownerName: ownerName.trim().slice(0, 140),
    driverName: driverName.trim().slice(0, 140),
    driverDlNo: driverDlNo.trim().slice(0, 40),
    gstPaidBy: gstPaidBy.slice(0, 40),
    insuranceStatus: insuranceStatus.slice(0, 80),
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
    if ((!autoAtomicCn && !cnNo.trim()) || !consignorName.trim() || !consigneeName.trim() || !truckNo.trim()) {
      setValidationError('Please fill mandatory C/N, Consignor, Consignee, and Primary Truck fields.');
      return;
    }
    setSaving(true);
    try {
      let finalCnNo = cnNo.trim();
      if (!editingId && autoAtomicCn) {
        const { formattedNo } = await reserveNextSerialNumber({
          type: 'cn',
          fy: activeFy,
          branchCode: activeBranchCode,
          staffCode: activeStaffCode,
          ownerUid,
        });
        finalCnNo = formattedNo;
      }

      const id = editingId || makeSafeDocId('cn');
      const payload = buildPayload(finalCnNo);
      await upsertDocument('consignments', id, payload, !editingId);

      await logBranchActivity({
        action: editingId ? 'Updated LR / CN' : 'Created LR / CN',
        module: 'Consignment',
        docRefCode: finalCnNo,
        summary: `${consignorName.trim()} → ${(toCity || toDistrict).trim()} (Bill To: ${billingPartyName.trim()} · ${resolvedCreditDays}d) · ₹${formatINR(Number(totalFreight) || 0)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

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
    const pdf = await generateLR3CopyPDF(tempCn, company);
    onPreviewPdf(pdf, 'LR Copy');
  };

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
                    className="p-1 rounded hover:bg-blue-50 text-slate-500 hover:text-blue-700 cursor-pointer"
                    title="Edit LR"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
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
    [company, isMasterAdmin, readOnly, onPreviewPdf, onSendCnToInvoice, onShowConfirm]
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
          {ocrError && <p className="text-xs text-red-600 font-semibold mt-1.5">{ocrError}</p>}
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
            <select
              aria-label="Division Selector"
              value={division}
              onChange={(e) => setDivision(e.target.value === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
              className="px-2 py-1 rounded bg-white text-[#0D47A1] text-xs font-extrabold cursor-pointer"
            >
              <option value="FTL">FTL Division</option>
              <option value="LOGISTICS">LOGISTICS Division</option>
            </select>
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
              <div className="flex gap-1.5">
                {consignorName.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setBillingPartyName(consignorName.trim());
                      setValidationError(null);
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
                      setValidationError(null);
                    }}
                    className="px-2 py-0.5 rounded bg-white border border-amber-300 hover:bg-amber-100 text-[10px] font-bold text-amber-900 cursor-pointer"
                  >
                    Use Consignee
                  </button>
                )}
              </div>
            </div>
            <EditableSearchSelect
              ariaLabel="Mandatory Billing Party"
              value={billingPartyName}
              onChange={(val) => {
                setBillingPartyName(val);
                if (val.trim()) setValidationError(null);
                applyRouteSmartAutoFill(val, toCity);
              }}
              options={partyNameOptions}
              placeholder="Select or search Billing Party (or click + Edit to add new)..."
              allowFreeInput
              inputClassName={!billingPartyName.trim() ? 'border-amber-400' : 'border-emerald-400'}
              onAddOption={handleAddBillingPartyOption}
            />
          </div>

          <div>
            <label className="block font-bold text-slate-900 mb-1">
              Mandatory Payment Credit Days *
            </label>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Mandatory Payment Credit Days"
                value={creditDaysOption}
                onChange={(e) => {
                  setCreditDaysOption(e.target.value);
                  if (e.target.value) setValidationError(null);
                }}
                className={`flex-1 px-2.5 py-1.5 rounded border bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  !resolvedCreditDays ? 'border-amber-400 text-amber-900' : 'border-emerald-400 text-emerald-900'
                }`}
              >
                <option value="">-- Select Credit Days --</option>
                {creditDayPresets.map((days) => (
                  <option key={days} value={String(days)}>
                    {days} Days Credit
                  </option>
                ))}
                <option value="custom">Custom Days...</option>
              </select>
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

        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              C/N Number {autoAtomicCn && !editingId ? '(Auto Assigned on Save)' : '*'}
            </label>
            <input
              type="text"
              required={!autoAtomicCn || Boolean(editingId)}
              disabled={autoAtomicCn && !editingId}
              value={autoAtomicCn && !editingId ? `AUTO SERVER SERIAL (${fyShort})` : cnNo}
              onChange={(e) => setCnNo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num disabled:bg-blue-50 disabled:text-blue-800 disabled:font-bold"
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

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignor Name *</label>
            <input
              type="text"
              required
              list="cn-party-list"
              value={consignorName}
              onChange={(e) => handleSelectConsignor(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignor Address</label>
            <input
              type="text"
              value={consignorAddress}
              onChange={(e) => setConsignorAddress(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignor GSTIN</label>
            <input
              type="text"
              value={consignorGstin}
              onChange={(e) => setConsignorGstin(e.target.value.toUpperCase())}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignee Name *</label>
            <input
              type="text"
              required
              list="cn-party-list"
              value={consigneeName}
              onChange={(e) => handleSelectConsignee(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignee Address</label>
            <input
              type="text"
              value={consigneeAddress}
              onChange={(e) => setConsigneeAddress(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Consignee GSTIN</label>
            <input
              type="text"
              value={consigneeGstin}
              onChange={(e) => setConsigneeGstin(e.target.value.toUpperCase())}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <datalist id="cn-party-list">
            {parties.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>

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
                }}
                options={stateOptions}
                placeholder="19 - West Bengal"
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'states', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'states', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'states', val)}
              />
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
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">To State / Country</label>
              <EditableSearchSelect
                ariaLabel="To State or Country"
                value={toState}
                onChange={(val) => {
                  setToState(val);
                  setToDistrict('');
                }}
                options={stateOptions}
                placeholder="Select State / Nepal / BD / Bhutan"
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'states', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'states', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'states', val)}
              />
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
            </div>
          </div>

          {/* Vehicles Row with Multi Vehicle (Yes/No) Toggle Right Beside Truck Field */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="font-semibold text-slate-700">Primary Truck No *</label>
              <div className="inline-flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-600">Multi Vehicle:</span>
                <YesNoSelect
                  ariaLabel="Multi Vehicle (Yes/No)"
                  value={hasMultiVehicle}
                  onChange={(next) => {
                    setHasMultiVehicle(next);
                    if (next && extraVehicles.length === 0) {
                      setExtraVehicles(['']);
                    }
                  }}
                />
              </div>
            </div>
            <input
              type="text"
              required
              list="cn-vehicle-list"
              value={truckNo}
              onChange={(e) => handleSelectVehicle(e.target.value)}
              placeholder="WB51B0800"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
            />
            <datalist id="cn-vehicle-list">
              {vehicles.map((v) => (
                <option key={v.id} value={v.truckNo} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">No. of Packages &amp; Mode</label>
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
                onChange={setPackageMode}
                options={packageModeOptions}
                placeholder="Package Mode"
                onAddOption={(val) => addDropdownItem(ownerUid, company, 'packageModes', val)}
                onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'packageModes', oldV, newV)}
                onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'packageModes', val)}
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Non-Liquid Goods / Particulars (All-India)
            </label>
            <EditableSearchSelect
              ariaLabel="Non-Liquid Goods Description"
              value={particulars}
              onChange={setParticulars}
              options={goodsOptions}
              placeholder="Search Tea, Steel, Pipes, Machinery..."
              onAddOption={(val) => addDropdownItem(ownerUid, company, 'goodsTypes', val)}
              onEditOption={(oldV, newV) => editDropdownItem(ownerUid, company, 'goodsTypes', oldV, newV)}
              onDeleteOption={(val) => deleteDropdownItem(ownerUid, company, 'goodsTypes', val)}
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Rate Mode &amp; Rate (₹)</label>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="col-span-2">
                <EditableSearchSelect
                  ariaLabel="Rate Mode"
                  value={rateMode}
                  onChange={(nextMode) => {
                    setRateMode(nextMode);
                    const rateNum = Number(ratePerUnit);
                    const wt = Number(nettWeight) || Number(grossWeight) || 0;
                    if (Number.isFinite(rateNum) && rateNum > 0 && /ton|mt/i.test(nextMode) && wt > 0) {
                      const calc = Math.round(rateNum * wt * 100) / 100;
                      setTotalFreight(String(calc));
                      setToPayAmount(String(Math.max(0, calc - (Number(paidAmount) || 0))));
                    }
                  }}
                  options={rateModeOptions}
                  placeholder="Fixed / Per MT"
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
                  const rateNum = Number(r);
                  const wt = Number(nettWeight) || Number(grossWeight) || 0;
                  if (Number.isFinite(rateNum) && rateNum > 0 && /ton|mt/i.test(rateMode) && wt > 0) {
                    const calc = Math.round(rateNum * wt * 100) / 100;
                    setTotalFreight(String(calc));
                    setToPayAmount(String(Math.max(0, calc - (Number(paidAmount) || 0))));
                  }
                }}
                placeholder="Rate ₹"
                className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nett / Gross Weight (MT)</label>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                step="0.001"
                value={nettWeight}
                onChange={(e) => {
                  const nextWt = e.target.value;
                  setNettWeight(nextWt);
                  const rateNum = Number(ratePerUnit);
                  const wtNum = Number(nextWt);
                  if (Number.isFinite(rateNum) && rateNum > 0 && /ton|mt/i.test(rateMode) && wtNum > 0) {
                    const calc = Math.round(rateNum * wtNum * 100) / 100;
                    setTotalFreight(String(calc));
                    setToPayAmount(String(Math.max(0, calc - (Number(paidAmount) || 0))));
                  }
                }}
                placeholder="Nett MT"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
              />
              <input
                type="number"
                step="0.001"
                value={grossWeight}
                onChange={(e) => setGrossWeight(e.target.value)}
                placeholder="Gross MT"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Total Freight (₹) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={totalFreight}
              onChange={(e) => {
                setTotalFreight(e.target.value);
                const f = Number(e.target.value) || 0;
                const p = Number(paidAmount) || 0;
                setToPayAmount(String(Math.max(0, f - p)));
              }}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-blue-800"
            />
          </div>

          {/* Attached Tax Invoice (Yes/No) + Multi E-Way Bill (Yes/No) + Value of Goods */}
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
            <input
              type="text"
              disabled={!hasTaxInvoice}
              value={hasTaxInvoice ? taxInvNo : 'NO TAX INVOICE ATTACHED'}
              onChange={(e) => setTaxInvNo(e.target.value)}
              placeholder="Tax Invoice / Challan No"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>

          <div className="md:col-span-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label className="font-bold text-slate-800">E-Way Bill Tracker</label>
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
                <span className="text-[10px] font-bold text-slate-600 ml-1">Multi EWB:</span>
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
                placeholder="12-Digit E-Way Bill No"
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
            {ewbTrackerMsg && (
              <p className="text-[11px] font-semibold text-emerald-800">{ewbTrackerMsg}</p>
            )}
          </div>

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

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Owner Name</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Driver Name</label>
            <input
              type="text"
              list="cn-driver-list"
              value={driverName}
              onChange={(e) => handleSelectDriver(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
            <datalist id="cn-driver-list">
              {drivers.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Driver D/L No</label>
            <input
              type="text"
              value={driverDlNo}
              onChange={(e) => setDriverDlNo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">GST Paid By</label>
            <select
              aria-label="GST Paid By"
              value={gstPaidBy}
              onChange={(e) => setGstPaidBy(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
            >
              <option value="Consignee">Consignee</option>
              <option value="Consignor">Consignor</option>
              <option value="Transporter">Transporter</option>
              <option value="Others">Others</option>
            </select>
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

          {/* Extra-Large Wide Remarks Box */}
          <div className="md:col-span-3">
            <label className="block font-bold text-slate-800 mb-1">
              Large Remarks / Delivery &amp; Freight Instructions (Prints Inside Wide LR Remarks Box)
            </label>
            <textarea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter detailed route instructions, delivery endorsements, detention terms, door delivery notes, or special cargo instructions..."
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
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Cancel Edit
              </button>
            )}
            <button
              type="button"
              disabled={saving || readOnly}
              onClick={(e) => void handleSave(e, true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
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
              <span>{saving ? 'Assigning Serial & Saving...' : editingId ? 'Update LR' : 'Save Consignment Note'}</span>
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
