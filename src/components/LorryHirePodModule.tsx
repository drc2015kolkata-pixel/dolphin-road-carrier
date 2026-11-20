import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Edit3,
  Lock,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Truck,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  CompanySettings,
  ConsignmentNote,
  DEFAULT_COMPANY_SETTINGS,
  DriveFolderName,
  LorryAdvanceRow,
  LorryHire,
  Party,
  StaffAccount,
  StaffCommissionEntry,
} from '../types/erp';
import { formatDateDDMMYYYY, formatINR, makeSafeDocId, normalizeFyLabel, todayISO } from '../lib/formatters';
import { scanPODDocument } from '../lib/ocrEngine';
import { logBranchActivity, removeDocument, upsertDocument } from '../lib/firestoreStore';
import { uploadBlobToDriveFolder } from '../lib/driveBackup';
import { GeneratedPdfResult, generateFoxproStatementPDF } from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { StaffCommissionModule } from './StaffCommissionModule';
import { CameraPodQrScannerModal } from './CameraPodQrScannerModal';

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
  loadingCharge: number;
  unloadingCharge: number;
  parkingCharge: number;
  kataCharge: number;
  shortageCharge: number;
  damageCharge: number;
}): {
  totalDeductions: number;
  balancePayable: number;
} {
  const totalDeductions =
    Number(params.advancePaid || 0) +
    Number(params.loadingCharge || 0) +
    Number(params.unloadingCharge || 0) +
    Number(params.parkingCharge || 0) +
    Number(params.kataCharge || 0) +
    Number(params.shortageCharge || 0) +
    Number(params.damageCharge || 0);
  const balancePayable = Math.max(
    0,
    Math.round((Number(params.hireAmount || 0) - totalDeductions) * 100) / 100
  );
  return { totalDeductions, balancePayable };
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

  const brokerOptions = useMemo(
    () => parties.filter((p) => p.partyType === 'Broker').map((p) => p.name),
    [parties]
  );

  const ownerOptions = useMemo(
    () => parties.filter((p) => p.partyType === 'TruckOwner').map((p) => p.name),
    [parties]
  );

  // Edit / Form state
  const [editingHireId, setEditingHireId] = useState<string | null>(null);
  const [division, setDivision] = useState<'FTL' | 'LOGISTICS'>('FTL');
  const [cnNo, setCnNo] = useState('');
  const [cnDate, setCnDate] = useState(todayISO());
  const [truckNo, setTruckNo] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [fromCity, setFromCity] = useState('KOLKATA');
  const [toCity, setToCity] = useState('');
  const [bookedPkgs, setBookedPkgs] = useState('');
  const [deliveredPkgs, setDeliveredPkgs] = useState('');
  const [hireAmount, setHireAmount] = useState('');

  // Multi-Advance (Yes/No)
  const [hasMultiAdvance, setHasMultiAdvance] = useState(false);
  const [advances, setAdvances] = useState<LorryAdvanceRow[]>([DEFAULT_ADVANCE_ROW()]);

  // Step-by-step Deductions
  const [loadingCharge, setLoadingCharge] = useState('0');
  const [unloadingCharge, setUnloadingCharge] = useState('0');
  const [parkingCharge, setParkingCharge] = useState('0');
  const [kataCharge, setKataCharge] = useState('0');
  const [shortageCharge, setShortageCharge] = useState('0');
  const [damageCharge, setDamageCharge] = useState('0');
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  // Active POD modal state (includes Pkgs & Shortage/Damage Reconciliation)
  const [activePodTarget, setActivePodTarget] = useState<LorryHire | null>(null);
  const [podDate, setPodDate] = useState(todayISO());
  const [podBookedPkgs, setPodBookedPkgs] = useState('');
  const [podDeliveredPkgs, setPodDeliveredPkgs] = useState('');
  const [podShortageCharge, setPodShortageCharge] = useState('0');
  const [podDamageCharge, setPodDamageCharge] = useState('0');
  const [podImageUrl, setPodImageUrl] = useState('');
  const [podFileName, setPodFileName] = useState('');
  const [podScanStatus, setPodScanStatus] = useState<string | null>(null);
  const [podUploading, setPodUploading] = useState(false);
  const [camScannerOpen, setCamScannerOpen] = useState(false);

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
  const loadNum = Number(loadingCharge) || 0;
  const unloadNum = Number(unloadingCharge) || 0;
  const parkNum = Number(parkingCharge) || 0;
  const kataNum = Number(kataCharge) || 0;
  const shortChgNum = Number(shortageCharge) || 0;
  const dmgChgNum = Number(damageCharge) || 0;

  const { balancePayable } = computeLorryNetPayable({
    hireAmount: hireNum,
    advancePaid: totalAdvances,
    loadingCharge: loadNum,
    unloadingCharge: unloadNum,
    parkingCharge: parkNum,
    kataCharge: kataNum,
    shortageCharge: shortChgNum,
    damageCharge: dmgChgNum,
  });

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
    setOwnerName('');
    setBrokerName('');
    setFromCity('KOLKATA');
    setToCity('');
    setBookedPkgs('');
    setDeliveredPkgs('');
    setHireAmount('');
    setHasMultiAdvance(false);
    setAdvances([DEFAULT_ADVANCE_ROW()]);
    setLoadingCharge('0');
    setUnloadingCharge('0');
    setParkingCharge('0');
    setKataCharge('0');
    setShortageCharge('0');
    setDamageCharge('0');
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
    setToCity(h.toCity || '');
    setBookedPkgs(h.bookedPkgs != null ? String(h.bookedPkgs) : '');
    setDeliveredPkgs(h.deliveredPkgs != null ? String(h.deliveredPkgs) : '');
    setHireAmount(String(h.hireAmount || ''));
    const savedAdv = Array.isArray(h.advances) && h.advances.length > 0
      ? h.advances
      : [{ ...DEFAULT_ADVANCE_ROW(), amount: Number(h.advancePaid || 0) }];
    setHasMultiAdvance(Boolean(h.hasMultiAdvance || savedAdv.length > 1));
    setAdvances(savedAdv);
    setLoadingCharge(String(h.loadingCharge ?? 0));
    setUnloadingCharge(String(h.unloadingCharge ?? 0));
    setParkingCharge(String(h.parkingCharge ?? 0));
    setKataCharge(String(h.kataCharge ?? 0));
    setShortageCharge(String(h.shortageCharge ?? 0));
    setDamageCharge(String(h.damageCharge ?? 0));
  };

  const handleCreateOrUpdateHire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnNo.trim() || !truckNo.trim() || hireNum <= 0) return;

    setSaving(true);
    try {
      const id = editingHireId || makeSafeDocId('hire');
      const cleanedAdvances = activeAdvanceRows
        .map((a) => ({
          payeeType: a.payeeType || 'Lorry Owner',
          accountName: a.accountName || accountBankOptions[0] || 'Cash in Hand',
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
          toCity: toCity.trim().slice(0, 120),
          bookedPkgs: bookedNum,
          deliveredPkgs: deliveredNum,
          shortageDamagePkgs,
          hasMultiAdvance,
          advances: cleanedAdvances,
          hireAmount: hireNum,
          advancePaid: totalAdvances,
          loadingCharge: loadNum,
          unloadingCharge: unloadNum,
          parkingCharge: parkNum,
          kataCharge: kataNum,
          shortageCharge: shortChgNum,
          damageCharge: dmgChgNum,
          balancePayable,
          podReceived: existing?.podReceived ?? false,
          podReceiveDate: existing?.podReceiveDate ?? '',
          podImageDataUrl: existing?.podImageDataUrl ?? '',
          podFileName: existing?.podFileName ?? '',
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

      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handlePodScanUpload = async (file: File | undefined) => {
    if (!file || !activePodTarget) return;
    setPodScanStatus('Compressing & scanning POD in background worker...');
    try {
      const { result, compressedDataUrl } = await scanPODDocument(file, (m) =>
        setPodScanStatus(m)
      );
      setPodImageUrl(compressedDataUrl);
      const cleanName = `POD_${activePodTarget.cnNo.replace(/[^a-zA-Z0-9]/g, '_')}_${todayISO()}.jpg`;
      setPodFileName(cleanName);
      if (result.podDate) setPodDate(result.podDate);
      setPodScanStatus(
        result.signedDetected
          ? `Signed POD verified! ${result.remarks || ''}`
          : 'POD scanned. Confirm receiver signature, Delivered Pkgs & POD Receive Date.'
      );
    } catch (err) {
      setPodScanStatus(err instanceof Error ? err.message : 'POD scan failed');
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

      const { balancePayable: recomputedNet } = computeLorryNetPayable({
        hireAmount: Number(activePodTarget.hireAmount || 0),
        advancePaid: Number(activePodTarget.advancePaid || 0),
        loadingCharge: Number(activePodTarget.loadingCharge || 0),
        unloadingCharge: Number(activePodTarget.unloadingCharge || 0),
        parkingCharge: Number(activePodTarget.parkingCharge || 0),
        kataCharge: Number(activePodTarget.kataCharge || 0),
        shortageCharge: sChg,
        damageCharge: dChg,
      });

      await upsertDocument(
        'lorry_hires',
        activePodTarget.id,
        {
          bookedPkgs: bPkgs,
          deliveredPkgs: dPkgs,
          shortageDamagePkgs: sdPkgs,
          shortageCharge: sChg,
          damageCharge: dChg,
          balancePayable: recomputedNet,
          podReceived: true,
          podReceiveDate: podDate,
          podImageDataUrl: podImageUrl.slice(0, 440000),
          podFileName: podFileName || `POD_${activePodTarget.cnNo}.jpg`,
        },
        false
      );

      if (driveAccessToken) {
        const res = await fetch(podImageUrl);
        const blob = await res.blob();
        await uploadBlobToDriveFolder({
          accessToken: driveAccessToken,
          folderName: 'POD_Scans',
          fileName: podFileName || `POD_${activePodTarget.cnNo}.jpg`,
          blob,
          mimeType: 'image/jpeg',
        });
      }

      await logBranchActivity({
        action: 'Verified POD & Reconciled Pkgs',
        module: 'Lorry Hire',
        docRefCode: activePodTarget.cnNo,
        summary: `POD ${activePodTarget.truckNo} · Deliv ${dPkgs}/${bPkgs} Pkgs (${sdPkgs} Short/Dmg) · Net ₹${formatINR(recomputedNet)}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      setActivePodTarget(null);
      setPodImageUrl('');
      setPodFileName('');
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

    setPayTarget(null);
    setPayRef('');
  };

  const handlePreviewHireVoucher = async (h: LorryHire) => {
    if (!onPreviewPdf) return;
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

    const pdf = await generateFoxproStatementPDF(
      {
        title: 'L-O-R-R-Y   H-I-R-E   S-E-T-T-L-E-M-E-N-T   V-O-U-C-H-E-R',
        subtitle: `CN: ${h.cnNo} (${formatDateDDMMYYYY(h.cnDate)}) | Truck: ${h.truckNo} | Branch: ${h.branchCode || activeBranchCode}`,
        fileName: `LorryHire_${h.cnNo.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
        orientation: 'p',
        summaryLines: [
          { label: 'Lorry Owner', value: h.ownerName || '-' },
          { label: 'Broker', value: h.brokerName || '-' },
          { label: 'Route', value: `${h.fromCity || '-'} -> ${h.toCity || '-'}` },
          { label: 'Booked Pkgs', value: String(h.bookedPkgs ?? 0) },
          { label: 'Delivered Pkgs', value: String(h.deliveredPkgs ?? h.bookedPkgs ?? 0) },
          { label: 'Short/Damage Pkgs', value: String(h.shortageDamagePkgs ?? 0) },
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
      },
      effectiveCompany,
      'p'
    );
    onPreviewPdf(pdf, 'Reports_Ledgers');
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
                setPodDate(todayISO());
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
            <select
              aria-label="Lorry Hire Division"
              value={division}
              onChange={(e) => setDivision(e.target.value === 'LOGISTICS' ? 'LOGISTICS' : 'FTL')}
              className="px-2 py-1 rounded bg-white text-[#0D47A1] text-xs font-extrabold cursor-pointer"
            >
              <option value="FTL">FTL Division</option>
              <option value="LOGISTICS">LOGISTICS Division</option>
            </select>
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
              <input
                type="text"
                required
                value={truckNo}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setTruckNo(val);
                  applyHireSmartAutoFill(val, ownerName, toCity);
                }}
                placeholder="WB51B0800"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Lorry Owner</label>
              <input
                type="text"
                list="hire-owner-list"
                value={ownerName}
                onChange={(e) => {
                  const val = e.target.value;
                  setOwnerName(val);
                  applyHireSmartAutoFill(truckNo, val, toCity);
                }}
                placeholder="Owner Name"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
              <datalist id="hire-owner-list">
                {ownerOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Broker (Optional)</label>
              <input
                type="text"
                list="hire-broker-list"
                value={brokerName}
                onChange={(e) => setBrokerName(e.target.value)}
                placeholder="Broker / Transport Agent"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
              <datalist id="hire-broker-list">
                {brokerOptions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
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
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">To</label>
              <input
                type="text"
                value={toCity}
                onChange={(e) => setToCity(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Gross Lorry Hire (₹) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={hireAmount}
                onChange={(e) => setHireAmount(e.target.value)}
                placeholder="45000"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold text-blue-900"
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

          {/* Multi-Advance (Yes/No) Rows */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">ADVANCE PAYMENTS</span>
                <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                  <span>Multi-Advance:</span>
                  <select
                    aria-label="Multi-Advance (Yes/No)"
                    value={hasMultiAdvance ? 'Yes' : 'No'}
                    onChange={(e) => {
                      const next = e.target.value === 'Yes';
                      setHasMultiAdvance(next);
                      if (next && advances.length === 0) {
                        setAdvances([DEFAULT_ADVANCE_ROW()]);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'y' || e.key === 'Y') {
                        e.preventDefault();
                        setHasMultiAdvance(true);
                      } else if (e.key === 'n' || e.key === 'N') {
                        e.preventDefault();
                        setHasMultiAdvance(false);
                      }
                    }}
                    className="px-2 py-0.5 rounded border border-slate-300 bg-white font-bold text-blue-900"
                  >
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </label>
              </div>
              {hasMultiAdvance && (
                <button
                  type="button"
                  onClick={() => setAdvances((prev) => [...prev, DEFAULT_ADVANCE_ROW()])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
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
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-end bg-white p-2 rounded border border-slate-200"
                >
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                      Payee Type
                    </label>
                    <select
                      aria-label={`Advance ${idx + 1} Payee Type`}
                      value={adv.payeeType}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, payeeType: e.target.value } : r))
                        )
                      }
                      className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                    >
                      <option value="Lorry Owner">Lorry Owner</option>
                      <option value="Broker">Broker</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                      Account Name / Bank
                    </label>
                    <select
                      aria-label={`Advance ${idx + 1} Account Name`}
                      value={adv.accountName}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, accountName: e.target.value } : r))
                        )
                      }
                      className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white"
                    >
                      {accountBankOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {!accountBankOptions.includes(adv.accountName) && adv.accountName && (
                        <option value={adv.accountName}>{adv.accountName}</option>
                      )}
                    </select>
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
                    <select
                      aria-label={`Advance ${idx + 1} Mode`}
                      value={adv.mode}
                      onChange={(e) =>
                        setAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, mode: e.target.value } : r))
                        )
                      }
                      className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white"
                    >
                      <option value="NEFT">NEFT</option>
                      <option value="RTGS">RTGS</option>
                      <option value="IMPS">IMPS</option>
                      <option value="UPI">UPI</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Cash">Cash</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Diesel Slip">Diesel Slip</option>
                    </select>
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
              ))}
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
              <div className="flex justify-between text-slate-600">
                <span>(-) Multi-Advances ({activeAdvanceRows.length}):</span>
                <span>- ₹ {formatINR(totalAdvances)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>(-) Loading + Unloading:</span>
                <span>- ₹ {formatINR(loadNum + unloadNum)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>(-) Parking + Kata:</span>
                <span>- ₹ {formatINR(parkNum + kataNum)}</span>
              </div>
              <div className="flex justify-between text-red-700">
                <span>(-) Shortage ({shortageDamagePkgs} Pkgs) / Damage:</span>
                <span>- ₹ {formatINR(shortChgNum + dmgChgNum)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-300 text-sm font-extrabold text-emerald-700">
                <span className="font-sans">Net Payable Balance:</span>
                <span>₹ {formatINR(balancePayable)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
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

              {podScanStatus && (
                <p className="text-xs font-semibold text-blue-800 bg-blue-50 p-2.5 rounded-lg border border-blue-200">
                  {podScanStatus}
                </p>
              )}

              {podImageUrl && (
                <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
                  <img
                    src={podImageUrl}
                    alt="Scanned POD"
                    referrerPolicy="no-referrer"
                    className="max-h-44 mx-auto rounded object-contain"
                  />
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
                <label className="block font-semibold text-slate-700 mb-1">
                  POD Receive Date (Mandatory to Unlock Balance Payment) *
                </label>
                <input
                  type="date"
                  required
                  value={podDate}
                  onChange={(e) => setPodDate(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono-num"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setActivePodTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!podImageUrl || !podDate || podUploading}
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
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-slate-300"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="NEFT">NEFT</option>
                  <option value="UPI">UPI</option>
                  <option value="Cash">Cash</option>
                </select>
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
