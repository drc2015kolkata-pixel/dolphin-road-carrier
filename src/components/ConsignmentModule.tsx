import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Edit3,
  FilePlus2,
  Lock,
  Plus,
  Printer,
  Save,
  ScanLine,
  Search,
  Trash2,
  Upload,
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
  logBranchActivity,
  removeDocument,
  reserveNextSerialNumber,
  upsertDocument,
} from '../lib/firestoreStore';
import { GeneratedPdfResult, generateLR3CopyPDF } from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

interface ConsignmentModuleProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
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
  const [autoAtomicCn, setAutoAtomicCn] = useState(true);
  const [cnNo, setCnNo] = useState(`${branchPrefix}-${147 + consignments.length}/${fyShort}`);
  const [cnDate, setCnDate] = useState(todayISO());
  const [deliveryOffice, setDeliveryOffice] = useState('');
  const [consignorName, setConsignorName] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [packages, setPackages] = useState('');
  const [particulars, setParticulars] = useState('');
  const [nettWeight, setNettWeight] = useState('0');
  const [grossWeight, setGrossWeight] = useState('0');
  const [loadingCharge, setLoadingCharge] = useState('0');
  const [unloadingCharge, setUnloadingCharge] = useState('0');
  const [returnLorryCharge, setReturnLorryCharge] = useState('0');
  const [sttCharge, setSttCharge] = useState('0');
  const [totalFreight, setTotalFreight] = useState('0');
  const [paidAmount, setPaidAmount] = useState('0');
  const [toPayAmount, setToPayAmount] = useState('0');
  const [taxInvNo, setTaxInvNo] = useState('');
  const [taxInvDate, setTaxInvDate] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [ewayBillDate, setEwayBillDate] = useState('');
  const [extraTaxInvoices, setExtraTaxInvoices] = useState<ExtraTaxInvoice[]>([]);
  const [extraEwayBills, setExtraEwayBills] = useState<ExtraEwayBill[]>([]);
  const [extraVehicles, setExtraVehicles] = useState<string[]>([]);
  const [valueOfGoods, setValueOfGoods] = useState('0');
  const [truckNo, setTruckNo] = useState('');
  const [fromCity, setFromCity] = useState('KOLKATA');
  const [toCity, setToCity] = useState('');
  const [engineNo, setEngineNo] = useState('');
  const [chassisNo, setChassisNo] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverDlNo, setDriverDlNo] = useState('');
  const [gstPaidBy] = useState('Consignee (RCM)');
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
        if (result.taxInvNo) setTaxInvNo(result.taxInvNo);
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
  }, [handleOCRFile]);

  const handleOneTapScanClick = () => {
    if (isMobileDevice && cameraInputRef.current) {
      cameraInputRef.current.click();
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleSelectConsignor = (name: string) => {
    setConsignorName(name);
    const found = parties.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found) {
      setConsignorAddress(found.address || '');
      setConsignorGstin(found.gstin || '');
    }
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
    setTruckNo(tNo.toUpperCase());
    const found = vehicles.find((v) => v.truckNo.toUpperCase() === tNo.toUpperCase());
    if (found) {
      setEngineNo(found.engineNo || '');
      setChassisNo(found.chassisNo || '');
      setOwnerName(found.ownerName || '');
    }
  };

  const handleSelectDriver = (name: string) => {
    setDriverName(name);
    const found = drivers.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (found) {
      setDriverDlNo(found.dlNo || '');
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setEditingBilled(false);
    setAutoAtomicCn(true);
    setCnNo(`${branchPrefix}-${147 + consignments.length}/${fyShort}`);
    setCnDate(todayISO());
    setDeliveryOffice('');
    setConsignorName('');
    setConsignorAddress('');
    setConsignorGstin('');
    setConsigneeName('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setPackages('');
    setParticulars('');
    setNettWeight('0');
    setGrossWeight('0');
    setLoadingCharge('0');
    setUnloadingCharge('0');
    setReturnLorryCharge('0');
    setSttCharge('0');
    setTotalFreight('0');
    setPaidAmount('0');
    setToPayAmount('0');
    setTaxInvNo('');
    setTaxInvDate('');
    setEwayBillNo('');
    setEwayBillDate('');
    setExtraTaxInvoices([]);
    setExtraEwayBills([]);
    setExtraVehicles([]);
    setValueOfGoods('0');
    setTruckNo('');
    setFromCity('KOLKATA');
    setToCity('');
    setEngineNo('');
    setChassisNo('');
    setOwnerName('');
    setDriverName('');
    setDriverDlNo('');
    setRemarks('');
    setScannedLrDataUrl('');
    setOcrFyMismatch(null);
  };

  const handleLoadForEdit = (cn: ConsignmentNote) => {
    if (!isMasterAdmin && cn.billed) return;
    setEditingId(cn.id);
    setEditingBilled(Boolean(cn.billed));
    setAutoAtomicCn(false);
    setCnNo(cn.cnNo);
    setCnDate(cn.cnDate || todayISO());
    setDeliveryOffice(cn.deliveryOffice || '');
    setConsignorName(cn.consignorName || '');
    setConsignorAddress(cn.consignorAddress || '');
    setConsignorGstin(cn.consignorGstin || '');
    setConsigneeName(cn.consigneeName || '');
    setConsigneeAddress(cn.consigneeAddress || '');
    setConsigneeGstin(cn.consigneeGstin || '');
    setPackages(cn.packages || '');
    setParticulars(cn.particulars || '');
    setNettWeight(String(cn.nettWeight ?? 0));
    setGrossWeight(String(cn.grossWeight ?? 0));
    setLoadingCharge(String(cn.loadingCharge ?? 0));
    setUnloadingCharge(String(cn.unloadingCharge ?? 0));
    setReturnLorryCharge(String(cn.returnLorryCharge ?? 0));
    setSttCharge(String(cn.sttCharge ?? 0));
    setTotalFreight(String(cn.totalFreight ?? 0));
    setPaidAmount(String(cn.paidAmount ?? 0));
    setToPayAmount(String(cn.toPayAmount ?? 0));
    setTaxInvNo(cn.taxInvNo || '');
    setTaxInvDate(cn.taxInvDate || '');
    setEwayBillNo(cn.ewayBillNo || '');
    setEwayBillDate(cn.ewayBillDate || '');
    setExtraTaxInvoices(cn.extraTaxInvoices || []);
    setExtraEwayBills(cn.extraEwayBills || []);
    setExtraVehicles(cn.extraVehicles || []);
    setValueOfGoods(String(cn.valueOfGoods ?? 0));
    setTruckNo(cn.truckNo || '');
    setFromCity(cn.fromCity || 'KOLKATA');
    setToCity(cn.toCity || '');
    setEngineNo(cn.engineNo || '');
    setChassisNo(cn.chassisNo || '');
    setOwnerName(cn.ownerName || '');
    setDriverName(cn.driverName || '');
    setDriverDlNo(cn.driverDlNo || '');
    setRemarks(cn.remarks || '');
    setScannedLrDataUrl(cn.scannedLrDataUrl || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const buildPayload = (resolvedCnNo?: string): Omit<ConsignmentNote, 'id' | 'createdAt' | 'updatedAt'> => ({
    cnNo: (resolvedCnNo || cnNo).trim().slice(0, 40),
    cnDate,
    financialYear: normalizeFyLabel(activeFy),
    deliveryOffice: deliveryOffice.trim().slice(0, 200),
    consignorName: consignorName.trim().slice(0, 180),
    consignorAddress: consignorAddress.trim().slice(0, 350),
    consignorGstin: consignorGstin.trim().slice(0, 24),
    consigneeName: consigneeName.trim().slice(0, 180),
    consigneeAddress: consigneeAddress.trim().slice(0, 350),
    consigneeGstin: consigneeGstin.trim().slice(0, 24),
    packages: packages.trim().slice(0, 40),
    particulars: particulars.trim().slice(0, 400),
    nettWeight: Number(nettWeight) || 0,
    grossWeight: Number(grossWeight) || 0,
    loadingCharge: Number(loadingCharge) || 0,
    unloadingCharge: Number(unloadingCharge) || 0,
    returnLorryCharge: Number(returnLorryCharge) || 0,
    sttCharge: Number(sttCharge) || 0,
    totalFreight: Number(totalFreight) || 0,
    paidAmount: Number(paidAmount) || 0,
    toPayAmount: Number(toPayAmount) || 0,
    taxInvNo: taxInvNo.trim().slice(0, 80),
    taxInvDate: taxInvDate.trim().slice(0, 20),
    ewayBillNo: ewayBillNo.trim().slice(0, 60),
    ewayBillDate: ewayBillDate.trim().slice(0, 20),
    extraTaxInvoices: extraTaxInvoices
      .filter((x) => x.no.trim())
      .map((x) => ({ no: x.no.trim(), date: x.date.trim(), value: Number(x.value) || 0 })),
    extraEwayBills: extraEwayBills
      .filter((x) => x.no.trim())
      .map((x) => ({ no: x.no.trim(), date: x.date.trim() })),
    extraVehicles: extraVehicles.map((v) => v.trim().toUpperCase()).filter(Boolean),
    valueOfGoods: Number(valueOfGoods) || 0,
    truckNo: truckNo.trim().toUpperCase().slice(0, 30),
    fromCity: fromCity.trim().slice(0, 120),
    toCity: toCity.trim().slice(0, 120),
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!autoAtomicCn && !cnNo.trim()) || !consignorName.trim() || !consigneeName.trim() || !truckNo.trim()) return;
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
      await upsertDocument('consignments', id, buildPayload(finalCnNo), !editingId);

      await logBranchActivity({
        action: editingId ? 'Updated LR / CN' : 'Created LR / CN',
        module: 'Consignment',
        docRefCode: finalCnNo,
        summary: `${consignorName.trim()} → ${toCity.trim()} (${truckNo.trim().toUpperCase()}) · ₹${formatINR(Number(totalFreight) || 0)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handlePrint3CopyCurrent = async () => {
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
        header: 'Status',
        cellClassName: 'whitespace-nowrap',
        render: (cn) => (
          <span className={`font-semibold ${cn.billed ? 'text-emerald-700' : 'text-orange-700'}`}>
            {cn.billed ? 'Billed (Locked)' : 'Unbilled'}
          </span>
        ),
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
                title="Print Combined 3-Copy LR"
              >
                <Printer className="w-3 h-3" />
                3-Copy
              </button>
              <button
                type="button"
                onClick={() => onSendCnToInvoice(cn)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold cursor-pointer"
                title="Auto-paste into Tax Invoice"
              >
                <FilePlus2 className="w-3 h-3" />
                Bill
              </button>
              {staffLocked ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-500 text-[10px] font-bold"
                  title="Billed LRs are locked for non-admin staff"
                >
                  <Lock className="w-3 h-3" />
                  Locked
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
    [company, isMasterAdmin, onPreviewPdf, onSendCnToInvoice, onShowConfirm]
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
            onClick={handleOneTapScanClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            <ScanLine className="w-4 h-4" />
            <span>Scan Bill / Document</span>
          </button>
          {isMobileDevice && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              Gallery File
            </button>
          )}
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
            <ClipboardPaste className="w-3.5 h-3.5 text-blue-700" />
            Ctrl + V Ready
          </span>
        </div>
      </div>

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
              onClick={handleOneTapScanClick}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Scan Bill / Document
            </button>
            <button
              type="button"
              onClick={handlePrint3CopyCurrent}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Preview 3-Copy LR
            </button>
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
            <label className="block font-semibold text-slate-700 mb-1">Delivery Office</label>
            <input
              type="text"
              value={deliveryOffice}
              onChange={(e) => setDeliveryOffice(e.target.value)}
              placeholder="SILIGURI / DHAKA BORDER"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Primary Truck / Lorry No *</label>
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
            <label className="block font-semibold text-slate-700 mb-1">From *</label>
            <input
              type="text"
              required
              value={fromCity}
              onChange={(e) => setFromCity(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">To *</label>
            <input
              type="text"
              required
              value={toCity}
              onChange={(e) => setToCity(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">No. of Packages</label>
            <input
              type="text"
              value={packages}
              onChange={(e) => setPackages(e.target.value)}
              placeholder="400 Nos"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Particulars / Description</label>
            <input
              type="text"
              value={particulars}
              onChange={(e) => setParticulars(e.target.value)}
              placeholder="Compost 50 Kg Bags / Tea Machinery / As per challan"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nett Weight (MT)</label>
            <input
              type="number"
              step="0.001"
              value={nettWeight}
              onChange={(e) => setNettWeight(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Gross Weight (MT)</label>
            <input
              type="number"
              step="0.001"
              value={grossWeight}
              onChange={(e) => setGrossWeight(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Total Freight (₹) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={totalFreight}
              onChange={(e) => setTotalFreight(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-blue-800"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Party Tax Inv. / Challan No</label>
            <input
              type="text"
              value={taxInvNo}
              onChange={(e) => setTaxInvNo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">E-Way Bill No</label>
            <input
              type="text"
              value={ewayBillNo}
              onChange={(e) => setEwayBillNo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
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

          {/* Multi-Vehicle, Multi-Invoice & Multi-EWB Schedule Builders */}
          <div className="md:col-span-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-800">
                Additional Vehicles, Invoices / Challans &amp; E-Way Bills (Auto-Spills to Page 2 in PDF)
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setExtraVehicles((prev) => [...prev, ''])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Vehicle
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setExtraTaxInvoices((prev) => [...prev, { no: '', date: taxInvDate || todayISO() }])
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Tax Inv
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setExtraEwayBills((prev) => [...prev, { no: '', date: ewayBillDate || todayISO() }])
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add E-Way Bill
                </button>
              </div>
            </div>

            {extraVehicles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {extraVehicles.map((veh, idx) => (
                  <div key={idx} className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded px-2 py-1">
                    <input
                      type="text"
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

            {extraTaxInvoices.length > 0 && (
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

            {extraEwayBills.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {extraEwayBills.map((ewb, idx) => (
                  <div key={idx} className="flex items-center gap-1 bg-white border border-slate-300 rounded px-2 py-1">
                    <input
                      type="text"
                      value={ewb.no}
                      onChange={(e) =>
                        setExtraEwayBills((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, no: e.target.value } : x))
                        )
                      }
                      placeholder={`EWB #${idx + 2}`}
                      className="flex-1 min-w-0 font-mono-num focus:outline-none"
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

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
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
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Assigning Serial & Saving...' : editingId ? 'Update LR' : 'Save Consignment Note'}</span>
          </button>
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
    </div>
  );
};

export const ConsignmentModule = React.memo(ConsignmentModuleInner);
