import React, { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ExternalLink,
  FileJson,
  Package,
  Plus,
  Printer,
  QrCode,
  Search,
  Trash2,
  Truck,
  Warehouse,
} from 'lucide-react';
import {
  BRANCH_OPTIONS,
  CompanySettings,
  LogisticsDivisionCode,
  LogisticsDocket,
  LogisticsDriveFolderName,
  LogisticsDriver,
  LogisticsManifest,
  LogisticsParty,
  LogisticsStockStage,
  LogisticsVehicle,
  makeDivisionDocId,
} from '../types/erp';
import { removeDocument, upsertDocument } from '../lib/firestoreStore';
import { formatDateDDMMYYYY, formatINR, normalizeFyLabel } from '../lib/formatters';
import { downloadNicPartBJson, getEwayBillExpiryState } from '../lib/ewayBillUtils';
import {
  GeneratedPdfResult,
  generateFoxproStatementPDF,
  generateLogisticsDocketPDF,
  generateLogisticsManifestPDF,
} from '../lib/pdfEngine';
import { CameraPodQrScannerModal } from './CameraPodQrScannerModal';
import {
  EntityQuickPreviewCard,
  formatDriverDetailsLine,
  formatPartyDetailsLine,
  formatVehicleDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import { SearchableSelect } from './SearchableSelect';
import { EditableSearchSelect } from './EditableSearchSelect';
import {
  ALL_INDIA_BRANCH_OPTIONS,
  DEFAULT_PACKAGE_MODES,
  getEffectiveDropdownList,
} from '../lib/dropdownMasterStore';
import { playVerifiedBeep } from '../lib/audioFeedback';

interface LogisticsDocketManifestPanelProps {
  divisionMode?: LogisticsDivisionCode;
  subView: 'docket' | 'manifest' | 'godown';
  ownerUid: string;
  activeStaffCode: string;
  activeBranchCode: string;
  activeFy: string;
  dockets: LogisticsDocket[];
  manifests: LogisticsManifest[];
  parties: LogisticsParty[];
  vehicles: LogisticsVehicle[];
  drivers: LogisticsDriver[];
  company: CompanySettings;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: LogisticsDriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const HUB_BRANCHES = BRANCH_OPTIONS.filter((b) => b !== 'ALL');

function buildNextDocketNo(
  existing: LogisticsDocket[],
  branch: string,
  fy: string,
  divisionMode: LogisticsDivisionCode = 'LOGISTICS'
): string {
  const shortFy = fy.replace(/^FY\s+/i, '');
  const br = (branch || 'KOL').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 3) || 'KOL';
  const divCode = divisionMode === 'PTL' ? 'PTL' : divisionMode === 'COURIER' ? 'COUR' : 'LOG';
  const maxNum = existing.reduce((max, d) => {
    const m = String(d.docketNo || '').match(/(\d+)/);
    const n = m ? Number(m[1]) : 0;
    return n > max ? n : max;
  }, 100);
  return `${divCode}-${br}-${maxNum + 1}/${shortFy}`;
}

function buildNextManifestNo(
  existing: LogisticsManifest[],
  fy: string,
  divisionMode: LogisticsDivisionCode = 'LOGISTICS'
): string {
  const shortFy = fy.replace(/^FY\s+/i, '');
  const divPrefix = divisionMode === 'PTL' ? 'PMNF' : divisionMode === 'COURIER' ? 'CMNF' : 'MNF';
  const maxNum = existing.reduce((max, m) => {
    const match = String(m.manifestNo || '').match(/(\d+)/);
    const n = match ? Number(match[1]) : 0;
    return n > max ? n : max;
  }, 10);
  return `${divPrefix}-${maxNum + 1}/${shortFy}`;
}

export const LogisticsDocketManifestPanel: React.FC<LogisticsDocketManifestPanelProps> = ({
  divisionMode = 'LOGISTICS',
  subView,
  ownerUid,
  activeStaffCode,
  activeBranchCode,
  activeFy,
  dockets,
  manifests,
  parties,
  vehicles,
  drivers,
  company,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const defaultOrigin = activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode : 'KOL-HQ';

  // ---------------- DOCKET FORM STATE ----------------
  const [editingDocketId, setEditingDocketId] = useState<string | null>(null);
  const [docketNo, setDocketNo] = useState(() => buildNextDocketNo(dockets, defaultOrigin, activeFy, divisionMode));
  const [docketDate, setDocketDate] = useState(today);
  const [billedAtBranch, setBilledAtBranch] = useState<string>(defaultOrigin);
  const [originBranch, setOriginBranch] = useState<string>(defaultOrigin);
  const [destBranch, setDestBranch] = useState<string>('SILIGURI');
  const [deliveryMode, setDeliveryMode] = useState<'Door Delivery' | 'Godown Delivery'>('Godown Delivery');
  const [payMode, setPayMode] = useState<'Paid' | 'To-Pay' | 'TBB'>('TBB');

  const [consignorName, setConsignorName] = useState('');
  const [selectedConsignorId, setSelectedConsignorId] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consigneeName, setConsigneeName] = useState('');
  const [selectedConsigneeId, setSelectedConsigneeId] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [billingPartyName, setBillingPartyName] = useState('');

  const [packages, setPackages] = useState('1');
  const [packingType, setPackingType] = useState('Carton Box');
  const [goodsDesc, setGoodsDesc] = useState('Hardware / Spare Parts');
  const [actualWeightKg, setActualWeightKg] = useState('25');
  const [chargedWeightKg, setChargedWeightKg] = useState('30');
  const [rateBasis, setRateBasis] = useState<'Per Kg' | 'Per Package' | 'Fixed'>('Per Kg');
  const [ratePerUnit, setRatePerUnit] = useState('18');
  const [fovCharge, setFovCharge] = useState('0');
  const [docketCharge, setDocketCharge] = useState('80');
  const [hamaliCharge, setHamaliCharge] = useState('50');
  const [doorCharge, setDoorCharge] = useState('0');
  const [gstRate, setGstRate] = useState('5');
  const [interstateGst, setInterstateGst] = useState(false);
  const [reverseCharge, setReverseCharge] = useState(true);
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [ewayBillValidUpto, setEwayBillValidUpto] = useState('');
  const [valueOfGoods, setValueOfGoods] = useState('0');
  const [godownRack, setGodownRack] = useState('BAY-A1');
  const [remarks, setRemarks] = useState('');
  const [docketSearch, setDocketSearch] = useState('');
  const [docketSaving, setDocketSaving] = useState(false);

  // Camera & QR Scanner modal
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'pod' | 'qr' | 'both'>('qr');
  const [scannerDocketTarget, setScannerDocketTarget] = useState<LogisticsDocket | null>(null);

  // ---------------- MANIFEST STATE ----------------
  const [manifestNo, setManifestNo] = useState(() => buildNextManifestNo(manifests, activeFy));
  const [manifestDate, setManifestDate] = useState(today);
  const [mnfFromBranch, setMnfFromBranch] = useState<string>(defaultOrigin);
  const [mnfToBranch, setMnfToBranch] = useState<string>('SILIGURI');
  const [mnfTruckNo, setMnfTruckNo] = useState('');
  const [selectedMnfVehicleId, setSelectedMnfVehicleId] = useState('');
  const [mnfDriverName, setMnfDriverName] = useState('');
  const [selectedMnfDriverId, setSelectedMnfDriverId] = useState('');
  const [mnfDriverPhone, setMnfDriverPhone] = useState('');
  const [mnfBrokerName, setMnfBrokerName] = useState('');
  const [selectedMnfBrokerId, setSelectedMnfBrokerId] = useState('');
  const [mnfHireAmount, setMnfHireAmount] = useState('14500');
  const [mnfAdvancePaid, setMnfAdvancePaid] = useState('8000');
  const [selectedDocketIds, setSelectedDocketIds] = useState<string[]>([]);
  const [manifestSaving, setManifestSaving] = useState(false);

  const logisticsCustomerParties = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.partyType === 'Customer' ||
          p.partyType === 'Consignor' ||
          p.partyType === 'Consignee'
      ),
    [parties]
  );
  const logisticsBrokerParties = useMemo(
    () =>
      parties.filter(
        (p) => p.partyType === 'Broker' || p.partyType === 'DeliveryAgent'
      ),
    [parties]
  );

  // ---------------- GODOWN STOCK STATE ----------------
  const [godownBranchFilter, setGodownBranchFilter] = useState<string>('ALL');
  const [godownStageFilter, setGodownStageFilter] = useState<string>('ALL');
  const [godownSearch, setGodownSearch] = useState('');

  // Auto-calculated freight preview
  const docketTotals = useMemo(() => {
    const qty =
      rateBasis === 'Per Kg'
        ? Math.max(0, Number(chargedWeightKg) || 0)
        : rateBasis === 'Per Package'
        ? Math.max(0, Number(packages) || 0)
        : 1;
    const baseFreight = Math.round(qty * (Number(ratePerUnit) || 0) * 100) / 100;
    const subTotal =
      baseFreight +
      (Number(fovCharge) || 0) +
      (Number(docketCharge) || 0) +
      (Number(hamaliCharge) || 0) +
      (Number(doorCharge) || 0);
    const ratePct = reverseCharge ? 0 : Math.max(0, Number(gstRate) || 0);
    const taxAmt = Math.round(((subTotal * ratePct) / 100) * 100) / 100;
    const cgstAmt = interstateGst ? 0 : Math.round((taxAmt / 2) * 100) / 100;
    const sgstAmt = interstateGst ? 0 : Math.round((taxAmt - cgstAmt) * 100) / 100;
    const igstAmt = interstateGst ? taxAmt : 0;
    const totalAmount = Math.round((subTotal + cgstAmt + sgstAmt + igstAmt) * 100) / 100;
    return { baseFreight, subTotal, cgstAmt, sgstAmt, igstAmt, totalAmount };
  }, [
    rateBasis,
    chargedWeightKg,
    packages,
    ratePerUnit,
    fovCharge,
    docketCharge,
    hamaliCharge,
    doorCharge,
    gstRate,
    interstateGst,
    reverseCharge,
  ]);

  const handlePickConsignorEntity = (found: LogisticsParty) => {
    setConsignorName(found.name);
    setSelectedConsignorId(found.id);
    setConsignorAddress(found.address || '');
    setConsignorGstin(found.gstin || '');
    if (payMode === 'TBB' && !billingPartyName) {
      setBillingPartyName(found.name);
    }
  };

  const handlePickConsignor = (name: string) => {
    setConsignorName(name);
    const clean = name.trim().toLowerCase();
    const matches = logisticsCustomerParties.filter(
      (p) => p.name.trim().toLowerCase() === clean
    );
    if (matches.length === 1) {
      handlePickConsignorEntity(matches[0]);
      return;
    }
    setSelectedConsignorId('');
  };

  const handlePickConsigneeEntity = (found: LogisticsParty) => {
    setConsigneeName(found.name);
    setSelectedConsigneeId(found.id);
    setConsigneeAddress(found.address || '');
    setConsigneeGstin(found.gstin || '');
  };

  const handlePickConsignee = (name: string) => {
    setConsigneeName(name);
    const clean = name.trim().toLowerCase();
    const matches = logisticsCustomerParties.filter(
      (p) => p.name.trim().toLowerCase() === clean
    );
    if (matches.length === 1) {
      handlePickConsigneeEntity(matches[0]);
      return;
    }
    setSelectedConsigneeId('');
  };

  const resetDocketForm = () => {
    setEditingDocketId(null);
    setDocketNo(buildNextDocketNo(dockets, originBranch, activeFy, divisionMode));
    setConsignorName('');
    setSelectedConsignorId('');
    setConsignorAddress('');
    setConsignorGstin('');
    setConsigneeName('');
    setSelectedConsigneeId('');
    setConsigneeAddress('');
    setConsigneeGstin('');
    setBillingPartyName('');
    setEwayBillNo('');
    setEwayBillValidUpto('');
    setValueOfGoods('0');
    setRemarks('');
  };

  const handleSaveDocket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consignorName.trim() || !consigneeName.trim() || !docketNo.trim()) return;
    setDocketSaving(true);
    try {
      const existing = editingDocketId ? dockets.find((d) => d.id === editingDocketId) : undefined;
      const docId = editingDocketId || makeDivisionDocId(divisionMode, 'ldkt');
      const payload: Record<string, unknown> = {
        docketNo: docketNo.trim().toUpperCase(),
        docketDate,
        financialYear: normalizeFyLabel(activeFy),
        billedAtBranch: billedAtBranch.trim() || originBranch,
        originBranch,
        destBranch,
        deliveryMode,
        payMode,
        consignorName: consignorName.trim(),
        consignorAddress: consignorAddress.trim(),
        consignorGstin: consignorGstin.trim().toUpperCase(),
        consigneeName: consigneeName.trim(),
        consigneeAddress: consigneeAddress.trim(),
        consigneeGstin: consigneeGstin.trim().toUpperCase(),
        billingPartyName: (billingPartyName || consignorName).trim(),
        packages: Math.max(1, Number(packages) || 1),
        packingType: packingType.trim(),
        goodsDesc: goodsDesc.trim(),
        actualWeightKg: Number(actualWeightKg) || 0,
        chargedWeightKg: Number(chargedWeightKg) || 0,
        rateBasis,
        ratePerUnit: Number(ratePerUnit) || 0,
        baseFreight: docketTotals.baseFreight,
        fovCharge: Number(fovCharge) || 0,
        docketCharge: Number(docketCharge) || 0,
        hamaliCharge: Number(hamaliCharge) || 0,
        doorCharge: Number(doorCharge) || 0,
        gstRate: reverseCharge ? 0 : Number(gstRate) || 0,
        cgstAmt: docketTotals.cgstAmt,
        sgstAmt: docketTotals.sgstAmt,
        igstAmt: docketTotals.igstAmt,
        reverseCharge,
        totalAmount: docketTotals.totalAmount,
        ewayBillNo: ewayBillNo.trim(),
        ewayBillValidUpto: ewayBillValidUpto.trim(),
        valueOfGoods: Number(valueOfGoods) || 0,
        stockStage: existing?.stockStage || 'Origin Godown',
        godownRack: godownRack.trim() || 'BAY-A1',
        godownBranch: existing?.godownBranch || originBranch,
        manifestId: existing?.manifestId || '',
        manifestNo: existing?.manifestNo || '',
        invoiceId: existing?.invoiceId || '',
        billed: existing?.billed ?? false,
        remarks: remarks.trim(),
        branchCode: originBranch,
        createdByStaff: activeStaffCode,
        ownerUid,
      };
      await upsertDocument('logistics_dockets', docId, payload, !editingDocketId);
      playVerifiedBeep();
      resetDocketForm();
    } finally {
      setDocketSaving(false);
    }
  };

  const handleLoadDocketEdit = (d: LogisticsDocket) => {
    setEditingDocketId(d.id);
    setDocketNo(d.docketNo);
    setDocketDate(d.docketDate);
    setBilledAtBranch(d.billedAtBranch || d.originBranch || defaultOrigin);
    setOriginBranch(d.originBranch);
    setDestBranch(d.destBranch);
    setDeliveryMode(d.deliveryMode);
    setPayMode(d.payMode);
    setConsignorName(d.consignorName);
    setConsignorAddress(d.consignorAddress || '');
    setConsignorGstin(d.consignorGstin || '');
    setConsigneeName(d.consigneeName);
    setConsigneeAddress(d.consigneeAddress || '');
    setConsigneeGstin(d.consigneeGstin || '');
    setBillingPartyName(d.billingPartyName || '');
    setPackages(String(d.packages || 1));
    setPackingType(d.packingType || 'Carton Box');
    setGoodsDesc(d.goodsDesc || '');
    setActualWeightKg(String(d.actualWeightKg || 0));
    setChargedWeightKg(String(d.chargedWeightKg || 0));
    setRateBasis(d.rateBasis || 'Per Kg');
    setRatePerUnit(String(d.ratePerUnit || 0));
    setFovCharge(String(d.fovCharge || 0));
    setDocketCharge(String(d.docketCharge || 0));
    setHamaliCharge(String(d.hamaliCharge || 0));
    setDoorCharge(String(d.doorCharge || 0));
    setReverseCharge(Boolean(d.reverseCharge));
    setGstRate(String(d.gstRate || 5));
    setEwayBillNo(d.ewayBillNo || '');
    setEwayBillValidUpto(d.ewayBillValidUpto || '');
    setValueOfGoods(String(d.valueOfGoods || 0));
    setGodownRack(d.godownRack || 'BAY-A1');
    setRemarks(d.remarks || '');
  };

  // Filtered dockets list
  const filteredDockets = useMemo(() => {
    const q = docketSearch.trim().toLowerCase();
    return [...dockets]
      .filter((d) => {
        if (!q) return true;
        return (
          d.docketNo.toLowerCase().includes(q) ||
          d.consignorName.toLowerCase().includes(q) ||
          d.consigneeName.toLowerCase().includes(q) ||
          d.destBranch.toLowerCase().includes(q) ||
          (d.ewayBillNo || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.docketDate || '').localeCompare(a.docketDate || ''));
  }, [dockets, docketSearch]);

  // Available dockets for Line-Haul Manifest (Origin Godown & not currently manifested)
  const unmanifestedDockets = useMemo(
    () => dockets.filter((d) => !d.manifestId && d.stockStage === 'Origin Godown'),
    [dockets]
  );

  const selectedManifestDockets = useMemo(
    () => dockets.filter((d) => selectedDocketIds.includes(d.id)),
    [dockets, selectedDocketIds]
  );

  const handleDispatchManifest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manifestNo.trim() || !mnfTruckNo.trim() || selectedManifestDockets.length === 0) return;
    setManifestSaving(true);
    try {
      const mId = makeDivisionDocId(divisionMode, 'lmnf');
      const totalPkgs = selectedManifestDockets.reduce((s, d) => s + Number(d.packages || 0), 0);
      const totalWeightKg = selectedManifestDockets.reduce((s, d) => s + Number(d.chargedWeightKg || 0), 0);
      const totalTopayAmount = selectedManifestDockets
        .filter((d) => d.payMode === 'To-Pay')
        .reduce((s, d) => s + Number(d.totalAmount || 0), 0);
      const hireAmount = Number(mnfHireAmount) || 0;
      const advancePaid = Number(mnfAdvancePaid) || 0;

      await upsertDocument(
        'logistics_manifests',
        mId,
        {
          manifestNo: manifestNo.trim().toUpperCase(),
          manifestDate,
          financialYear: normalizeFyLabel(activeFy),
          fromBranch: mnfFromBranch,
          toBranch: mnfToBranch,
          truckNo: mnfTruckNo.trim().toUpperCase(),
          driverName: mnfDriverName.trim(),
          driverPhone: mnfDriverPhone.trim(),
          brokerName: mnfBrokerName.trim(),
          docketIds: selectedManifestDockets.map((d) => d.id),
          docketNos: selectedManifestDockets.map((d) => d.docketNo),
          totalPkgs,
          totalWeightKg: Math.round(totalWeightKg * 100) / 100,
          totalTopayAmount: Math.round(totalTopayAmount * 100) / 100,
          hireAmount,
          advancePaid,
          balancePayable: Math.max(0, hireAmount - advancePaid),
          status: 'In Transit',
          branchCode: mnfFromBranch,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        true
      );

      for (const d of selectedManifestDockets) {
        await upsertDocument(
          'logistics_dockets',
          d.id,
          {
            stockStage: 'Manifested / In Transit',
            manifestId: mId,
            manifestNo: manifestNo.trim().toUpperCase(),
            godownBranch: 'IN-TRANSIT',
          },
          false
        );
      }
      setSelectedDocketIds([]);
      setManifestNo(buildNextManifestNo(manifests, activeFy, divisionMode));
      playVerifiedBeep();
    } finally {
      setManifestSaving(false);
    }
  };

  const handleArriveUnloadManifest = async (m: LogisticsManifest) => {
    const arrDate = new Date().toISOString().slice(0, 10);
    await upsertDocument(
      'logistics_manifests',
      m.id,
      { status: 'Unloaded', arrivalDate: arrDate },
      false
    );
    const linkedSet = new Set(m.docketIds || []);
    for (const d of dockets) {
      if (linkedSet.has(d.id) && d.stockStage !== 'Delivered') {
        await upsertDocument(
          'logistics_dockets',
          d.id,
          {
            stockStage: 'Destination Godown',
            godownBranch: m.toBranch,
            godownRack: d.godownRack || 'UNLOAD-BAY',
          },
          false
        );
      }
    }
  };

  // Godown stock filtering
  const godownFilteredDockets = useMemo(() => {
    const q = godownSearch.trim().toLowerCase();
    return dockets.filter((d) => {
      if (godownBranchFilter !== 'ALL') {
        const effectiveBranch = d.godownBranch || d.originBranch;
        if (effectiveBranch !== godownBranchFilter && d.destBranch !== godownBranchFilter) {
          return false;
        }
      }
      if (godownStageFilter !== 'ALL' && d.stockStage !== godownStageFilter) return false;
      if (q) {
        return (
          d.docketNo.toLowerCase().includes(q) ||
          d.consignorName.toLowerCase().includes(q) ||
          d.consigneeName.toLowerCase().includes(q) ||
          (d.godownRack || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [dockets, godownBranchFilter, godownStageFilter, godownSearch]);

  const handlePrintGodownStockPdf = async () => {
    const totalPkgs = godownFilteredDockets.reduce((s, d) => s + Number(d.packages || 0), 0);
    const totalWt = godownFilteredDockets.reduce((s, d) => s + Number(d.chargedWeightKg || 0), 0);
    const totalTopay = godownFilteredDockets
      .filter((d) => d.payMode === 'To-Pay')
      .reduce((s, d) => s + Number(d.totalAmount || 0), 0);

    const pdf = await generateFoxproStatementPDF(
      {
        title: 'EXPRESS LOGISTICS — BRANCH GODOWN STOCK REGISTER',
        subtitle: `Hub: ${godownBranchFilter} | Stage: ${godownStageFilter} | ${activeFy}`,
        fileName: `Logistics_Godown_Stock_${new Date().toISOString().slice(0, 10)}.pdf`,
        summaryLines: [
          { label: 'Total Dockets', value: String(godownFilteredDockets.length) },
          { label: 'Total Packages', value: String(totalPkgs) },
          { label: 'Total Charge Wt', value: `${totalWt.toFixed(1)} Kg` },
          { label: 'To-Pay Cash Due', value: `Rs. ${formatINR(totalTopay)}` },
        ],
        columns: [
          { label: 'DOCKET NO / DATE', widthPct: 17 },
          { label: 'ROUTE', widthPct: 16 },
          { label: 'CONSIGNOR / CONSIGNEE', widthPct: 29 },
          { label: 'STAGE / RACK', widthPct: 16 },
          { label: 'PKGS / WT', widthPct: 10, align: 'right' },
          { label: 'MODE / AMT', widthPct: 12, align: 'right' },
        ],
        rows: godownFilteredDockets.map((d) => ({
          line1: [
            d.docketNo,
            `${d.originBranch} -> ${d.destBranch}`,
            d.consigneeName,
            `${d.stockStage} (${d.godownBranch || d.originBranch})`,
            `${d.packages} Pkg`,
            `Rs.${formatINR(d.totalAmount)}`,
          ],
          line2: [
            formatDateDDMMYYYY(d.docketDate),
            d.manifestNo ? `Mnf: ${d.manifestNo}` : d.deliveryMode,
            `From: ${d.consignorName}`,
            `Rack: ${d.godownRack || 'BAY-1'}`,
            `${Number(d.chargedWeightKg || 0).toFixed(1)} Kg`,
            d.payMode,
          ],
        })),
        totalsLabel: 'GODOWN TOTALS :',
        totalsLine1: ['', '', '', '', `${totalPkgs} Pkgs`, `Rs.${formatINR(totalTopay)}`],
        orientation: 'l',
      },
      company
    );
    onPreviewPdf(pdf, 'Godown_POD_Scans');
  };

  return (
    <div className="space-y-4">
      {/* ---------------- VIEW 1: PARCEL DOCKET / LR ---------------- */}
      {subView === 'docket' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <form
            onSubmit={handleSaveDocket}
            className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0F766E] to-[#0D9488] text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                <h3 className="text-xs font-extrabold tracking-wide uppercase">
                  {editingDocketId ? 'Edit Parcel Docket' : 'New Express Parcel Docket / LR'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setScannerDocketTarget(null);
                  setScannerMode('qr');
                  setScannerOpen(true);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-bold cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Scan EWB QR</span>
              </button>
            </div>

            <div className="p-3.5 space-y-2.5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Docket / LR No*</label>
                  <input
                    required
                    value={docketNo}
                    onChange={(e) => setDocketNo(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Date*</label>
                  <input
                    type="date"
                    required
                    value={docketDate}
                    onChange={(e) => setDocketDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Pay Mode</label>
                  <SearchableSelect
                    ariaLabel="Docket Pay Mode"
                    value={payMode}
                    onChange={(val) => setPayMode(val as 'Paid' | 'To-Pay' | 'TBB')}
                    options={[
                      { value: 'Paid', label: 'Paid' },
                      { value: 'TBB', label: 'TBB (To Be Billed)' },
                      { value: 'To-Pay', label: 'To-Pay (COD)' },
                    ]}
                    triggerClassName="!py-1.5 !font-bold !text-[#0F766E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Origin Hub</label>
                  <SearchableSelect
                    ariaLabel="Origin Hub"
                    value={originBranch}
                    onChange={setOriginBranch}
                    options={HUB_BRANCHES}
                    triggerClassName="!py-1.5 !font-semibold"
                    searchPlaceholder="Search origin hub..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Dest Hub</label>
                  <SearchableSelect
                    ariaLabel="Destination Hub"
                    value={destBranch}
                    onChange={setDestBranch}
                    options={HUB_BRANCHES}
                    triggerClassName="!py-1.5 !font-semibold"
                    searchPlaceholder="Search dest hub..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Billed At (Branch)</label>
                  <EditableSearchSelect
                    ariaLabel="Docket Billed At Branch"
                    value={billedAtBranch}
                    onChange={setBilledAtBranch}
                    options={ALL_INDIA_BRANCH_OPTIONS}
                    placeholder="Select billing branch..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Delivery Type</label>
                  <SearchableSelect
                    ariaLabel="Delivery Type"
                    value={deliveryMode}
                    onChange={(val) => setDeliveryMode(val as 'Door Delivery' | 'Godown Delivery')}
                    options={[
                      { value: 'Door Delivery', label: 'Door Delivery' },
                      { value: 'Godown Delivery', label: 'Godown Delivery' },
                    ]}
                    triggerClassName="!py-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Consignor Name*</label>
                  <RichEntityPicker<LogisticsParty>
                    ariaLabel="Logistics Consignor Name"
                    value={consignorName}
                    selectedId={selectedConsignorId}
                    onChangeText={(val) => handlePickConsignor(val)}
                    onSelectEntity={(p) => handlePickConsignorEntity(p)}
                    items={logisticsCustomerParties}
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
                      const matches = logisticsCustomerParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedConsignorId
                          ? logisticsCustomerParties.find((p) => p.id === selectedConsignorId)
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
                  <input
                    value={consignorGstin}
                    onChange={(e) => setConsignorGstin(e.target.value)}
                    placeholder="Consignor GSTIN"
                    className="w-full px-2 py-1 mt-1 rounded border border-slate-200 bg-white text-[11px] font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-0.5">Consignee Name*</label>
                  <RichEntityPicker<LogisticsParty>
                    ariaLabel="Logistics Consignee Name"
                    value={consigneeName}
                    selectedId={selectedConsigneeId}
                    onChangeText={(val) => handlePickConsignee(val)}
                    onSelectEntity={(p) => handlePickConsigneeEntity(p)}
                    items={logisticsCustomerParties}
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
                      const matches = logisticsCustomerParties.filter(
                        (p) => p.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedConsigneeId
                          ? logisticsCustomerParties.find((p) => p.id === selectedConsigneeId)
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
                  <input
                    value={consigneeGstin}
                    onChange={(e) => setConsigneeGstin(e.target.value)}
                    placeholder="Consignee GSTIN"
                    className="w-full px-2 py-1 mt-1 rounded border border-slate-200 bg-white text-[11px] font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Packages*</label>
                  <input
                    type="number"
                    min="1"
                    value={packages}
                    onChange={(e) => setPackages(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Actual Wt (Kg)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={actualWeightKg}
                    onChange={(e) => setActualWeightKg(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Charged Wt (Kg)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={chargedWeightKg}
                    onChange={(e) => setChargedWeightKg(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Goods Description</label>
                  <EditableSearchSelect
                    ariaLabel="Docket Goods Description"
                    value={goodsDesc}
                    onChange={setGoodsDesc}
                    options={getEffectiveDropdownList(company, 'goodsTypes')}
                    placeholder="Select or type goods A-Z..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Packing / Godown Rack</label>
                  <div className="grid grid-cols-2 gap-1">
                    <EditableSearchSelect
                      ariaLabel="Docket Packing Type"
                      value={packingType}
                      onChange={setPackingType}
                      options={Array.from(
                        new Set([
                          ...DEFAULT_PACKAGE_MODES,
                          ...getEffectiveDropdownList(company, 'packageModes'),
                        ])
                      )}
                      placeholder="Carton / Drum..."
                    />
                    <input
                      value={godownRack}
                      onChange={(e) => setGodownRack(e.target.value)}
                      placeholder="BAY-A1"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Rate Basis</label>
                  <SearchableSelect
                    ariaLabel="Docket Rate Basis"
                    value={rateBasis}
                    onChange={(val) => setRateBasis(val as 'Per Kg' | 'Per Package' | 'Fixed')}
                    options={[
                      { value: 'Fixed', label: 'Fixed' },
                      { value: 'Per Kg', label: 'Per Kg' },
                      { value: 'Per Package', label: 'Per Pkg' },
                    ]}
                    triggerClassName="!py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Rate (₹)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={ratePerUnit}
                    onChange={(e) => setRatePerUnit(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Docket Chg</label>
                  <input
                    type="number"
                    value={docketCharge}
                    onChange={(e) => setDocketCharge(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Hamali/Door</label>
                  <input
                    type="number"
                    value={hamaliCharge}
                    onChange={(e) => setHamaliCharge(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">E-Way Bill No</label>
                  <input
                    value={ewayBillNo}
                    onChange={(e) => setEwayBillNo(e.target.value)}
                    placeholder="12-digit EWB"
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">EWB Valid Upto</label>
                  <input
                    type="datetime-local"
                    value={ewayBillValidUpto}
                    onChange={(e) => setEwayBillValidUpto(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 text-[11px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Goods Value (₹)</label>
                  <input
                    type="number"
                    value={valueOfGoods}
                    onChange={(e) => setValueOfGoods(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-teal-50 border border-teal-200">
                <label className="inline-flex items-center gap-1.5 font-bold text-teal-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reverseCharge}
                    onChange={(e) => setReverseCharge(e.target.checked)}
                  />
                  <span>GST RCM (5% by Consignor/Consignee)</span>
                </label>
                {!reverseCharge && (
                  <div className="flex items-center gap-2">
                    <div className="w-[115px]">
                      <SearchableSelect
                        ariaLabel="Docket GST Rate"
                        value={gstRate}
                        onChange={setGstRate}
                        options={[
                          { value: '0', label: '0%' },
                          { value: '12', label: '12% GST' },
                          { value: '18', label: '18% GST' },
                          { value: '5', label: '5% GST' },
                        ]}
                        triggerClassName="!py-1 !text-[11px] !font-bold !border-teal-300"
                      />
                    </div>
                    <label className="inline-flex items-center gap-1 text-[11px] font-semibold">
                      <input
                        type="checkbox"
                        checked={interstateGst}
                        onChange={(e) => setInterstateGst(e.target.checked)}
                      />
                      IGST
                    </label>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 text-white">
                <div>
                  <div className="text-[10px] text-slate-300">Base Freight: ₹{formatINR(docketTotals.baseFreight)}</div>
                  <div className="text-sm font-extrabold font-mono-num">
                    Total Docket Amount: ₹{formatINR(docketTotals.totalAmount)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editingDocketId && (
                    <button
                      type="button"
                      onClick={resetDocketForm}
                      className="px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={docketSaving}
                    className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold cursor-pointer disabled:opacity-60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{docketSaving ? 'Saving...' : editingDocketId ? 'Update Docket' : 'Save Docket'}</span>
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Docket Register Table */}
          <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
              <div>
                <h3 className="text-xs font-extrabold text-slate-900">
                  Express Parcel Docket / LR Register ({filteredDockets.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Strictly isolated Logistics Dockets · EWB Expiry &amp; Part-B JSON enabled
                </p>
              </div>
              <div className="relative w-60">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  value={docketSearch}
                  onChange={(e) => setDocketSearch(e.target.value)}
                  placeholder="Search Docket No, Party, Hub..."
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left">Docket &amp; Date</th>
                    <th className="px-3 py-2 text-left">Hub Route</th>
                    <th className="px-3 py-2 text-left">Consignor &rarr; Consignee</th>
                    <th className="px-3 py-2 text-right">Pkgs / Wt / Amt</th>
                    <th className="px-3 py-2 text-left">Stage &amp; EWB</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDockets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">
                        No Express Parcel Dockets booked yet. Create your first Docket on the left.
                      </td>
                    </tr>
                  ) : (
                    filteredDockets.map((d) => {
                      const ewbSt = d.ewayBillValidUpto ? getEwayBillExpiryState(d.ewayBillValidUpto) : null;
                      return (
                        <tr key={d.id} className="hover:bg-teal-50/40">
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleLoadDocketEdit(d)}
                              className="font-mono-num font-extrabold text-[#0F766E] hover:underline cursor-pointer"
                            >
                              {d.docketNo}
                            </button>
                            <div className="text-[11px] text-slate-500">{formatDateDDMMYYYY(d.docketDate)}</div>
                            <span className="inline-block px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                              {d.payMode}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            <div>{d.originBranch} &rarr; {d.destBranch}</div>
                            <div className="text-[10px] text-slate-500">{d.deliveryMode}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-900 truncate max-w-[180px]">{d.consignorName}</div>
                            <div className="text-[11px] text-slate-600 truncate max-w-[180px]">&rarr; {d.consigneeName}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono-num">
                            <div className="font-bold text-slate-900">₹{formatINR(d.totalAmount)}</div>
                            <div className="text-[11px] text-slate-500">
                              {d.packages} Pkg · {d.chargedWeightKg} Kg
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                d.stockStage === 'Delivered'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : d.stockStage === 'Manifested / In Transit'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {d.stockStage}
                            </span>
                            {ewbSt && (ewbSt.status === 'expired' || ewbSt.status === 'expiringSoon') && (
                              <div className="text-[10px] font-bold text-red-700 mt-0.5">{ewbSt.label}</div>
                            )}
                            {d.ewayBillNo && (
                              <button
                                type="button"
                                onClick={() =>
                                  downloadNicPartBJson(
                                    {
                                      cnNo: d.docketNo,
                                      cnDate: d.docketDate,
                                      truckNo: d.manifestNo || 'HUB-TRANSFER',
                                      fromCity: d.originBranch,
                                      ewayBillNo: d.ewayBillNo,
                                      division: 'LOGISTICS',
                                    },
                                    company
                                  )
                                }
                                className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-indigo-700 hover:underline cursor-pointer"
                              >
                                <FileJson className="w-3 h-3" />
                                Part-B JSON
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                            <button
                              type="button"
                              onClick={async () => {
                                const pdf = await generateLogisticsDocketPDF(d, company);
                                onPreviewPdf(pdf, 'Docket_LR');
                              }}
                              className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 cursor-pointer"
                              title="Preview & Print Docket PDF"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onShowConfirm({
                                  title: `Delete Docket ${d.docketNo}?`,
                                  description: 'This removes the parcel docket from Logistics Division records.',
                                  confirmLabel: 'Delete Docket',
                                  variant: 'danger',
                                  onConfirm: () => removeDocument('logistics_dockets', d.id),
                                })
                              }
                              className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                              title="Delete Docket"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- VIEW 2: LINE-HAUL MANIFEST ---------------- */}
      {subView === 'manifest' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <form
            onSubmit={handleDispatchManifest}
            className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0F766E] to-[#0D47A1] text-white px-4 py-2.5 flex items-center gap-2">
              <Truck className="w-4 h-4" />
              <h3 className="text-xs font-extrabold uppercase tracking-wide">
                Create Line-Haul Dispatch Manifest
              </h3>
            </div>
            <div className="p-3.5 space-y-2.5 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Manifest No*</label>
                  <input
                    required
                    value={manifestNo}
                    onChange={(e) => setManifestNo(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Dispatch Date*</label>
                  <input
                    type="date"
                    required
                    value={manifestDate}
                    onChange={(e) => setManifestDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">From Hub</label>
                  <SearchableSelect
                    ariaLabel="Manifest From Hub"
                    value={mnfFromBranch}
                    onChange={setMnfFromBranch}
                    options={HUB_BRANCHES}
                    triggerClassName="!py-1.5 !font-semibold"
                    searchPlaceholder="Search from hub..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Destination Hub</label>
                  <SearchableSelect
                    ariaLabel="Manifest Destination Hub"
                    value={mnfToBranch}
                    onChange={setMnfToBranch}
                    options={HUB_BRANCHES}
                    triggerClassName="!py-1.5 !font-semibold"
                    searchPlaceholder="Search destination hub..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Vehicle / Tempo No*</label>
                  <RichEntityPicker<LogisticsVehicle>
                    ariaLabel="Manifest Vehicle No"
                    value={mnfTruckNo}
                    selectedId={selectedMnfVehicleId}
                    onChangeText={(nextText) => {
                      const upper = nextText.toUpperCase();
                      setMnfTruckNo(upper);
                      const matches = vehicles.filter(
                        (v) => v.truckNo.trim().toUpperCase() === upper.trim()
                      );
                      setSelectedMnfVehicleId(matches.length === 1 ? matches[0].id : '');
                    }}
                    onSelectEntity={(v) => {
                      setMnfTruckNo(v.truckNo.toUpperCase());
                      setSelectedMnfVehicleId(v.id);
                    }}
                    items={vehicles}
                    getId={(v) => v.id}
                    getValue={(v) => v.truckNo}
                    getSearchText={(v) =>
                      `${v.truckNo} ${v.ownerName || ''} ${v.vehicleType || ''} ${v.ownerPhone || ''}`
                    }
                    renderTitle={(v) => v.truckNo}
                    renderBadge={(v) => v.vehicleType || 'Tempo'}
                    renderDetails={(v) => formatVehicleDetailsLine(v)}
                    placeholder="WB23C6597 — Search Truck, Owner or Type..."
                    required
                    uppercase
                    inputClassName="font-mono-num font-bold"
                    quickPreview={(() => {
                      const clean = mnfTruckNo.trim().toUpperCase();
                      if (!clean) return null;
                      const resolved =
                        (selectedMnfVehicleId
                          ? vehicles.find((v) => v.id === selectedMnfVehicleId)
                          : undefined) ||
                        vehicles.find((v) => v.truckNo.trim().toUpperCase() === clean);
                      return <EntityQuickPreviewCard kind="vehicle" vehicle={resolved} />;
                    })()}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Driver Name</label>
                  <RichEntityPicker<LogisticsDriver>
                    ariaLabel="Manifest Driver Name"
                    value={mnfDriverName}
                    selectedId={selectedMnfDriverId}
                    onChangeText={(val) => {
                      setMnfDriverName(val);
                      const matches = drivers.filter(
                        (dr) => dr.name.trim().toLowerCase() === val.trim().toLowerCase()
                      );
                      if (matches.length === 1) {
                        setSelectedMnfDriverId(matches[0].id);
                        if (matches[0].phone) setMnfDriverPhone(matches[0].phone);
                      } else {
                        setSelectedMnfDriverId('');
                      }
                    }}
                    onSelectEntity={(dr) => {
                      setMnfDriverName(dr.name);
                      setSelectedMnfDriverId(dr.id);
                      if (dr.phone) setMnfDriverPhone(dr.phone);
                    }}
                    items={drivers}
                    getId={(dr) => dr.id}
                    getValue={(dr) => dr.name}
                    getSearchText={(dr) => `${dr.name} ${dr.dlNo || ''} ${dr.phone || ''}`}
                    renderTitle={(dr) => dr.name}
                    renderDetails={(dr) => formatDriverDetailsLine(dr)}
                    placeholder="Search Driver by Name, D/L No or Mobile..."
                    quickPreview={(() => {
                      const clean = mnfDriverName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = drivers.filter(
                        (dr) => dr.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedMnfDriverId
                          ? drivers.find((dr) => dr.id === selectedMnfDriverId)
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
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Driver Phone</label>
                  <input
                    value={mnfDriverPhone}
                    onChange={(e) => setMnfDriverPhone(e.target.value)}
                    placeholder="10-digit mobile"
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Broker / Fleet</label>
                  <RichEntityPicker<LogisticsParty>
                    ariaLabel="Manifest Broker / Fleet"
                    value={mnfBrokerName}
                    selectedId={selectedMnfBrokerId}
                    onChangeText={(val) => {
                      setMnfBrokerName(val);
                      const matches = logisticsBrokerParties.filter(
                        (b) => b.name.trim().toLowerCase() === val.trim().toLowerCase()
                      );
                      setSelectedMnfBrokerId(matches.length === 1 ? matches[0].id : '');
                    }}
                    onSelectEntity={(b) => {
                      setMnfBrokerName(b.name);
                      setSelectedMnfBrokerId(b.id);
                    }}
                    items={logisticsBrokerParties}
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
                      const clean = mnfBrokerName.trim().toLowerCase();
                      if (!clean) return null;
                      const matches = logisticsBrokerParties.filter(
                        (b) => b.name.trim().toLowerCase() === clean
                      );
                      const resolved =
                        (selectedMnfBrokerId
                          ? logisticsBrokerParties.find((b) => b.id === selectedMnfBrokerId)
                          : undefined) ||
                        (matches.length === 1 ? matches[0] : matches[0]);
                      return (
                        <EntityQuickPreviewCard
                          kind="broker"
                          party={resolved}
                          duplicateCount={matches.length}
                          ambiguousSelected={matches.length > 1 && !selectedMnfBrokerId}
                          compact
                        />
                      );
                    })()}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Line-Haul Hire (₹)</label>
                  <input
                    type="number"
                    value={mnfHireAmount}
                    onChange={(e) => setMnfHireAmount(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Advance Paid (₹)</label>
                  <input
                    type="number"
                    value={mnfAdvancePaid}
                    onChange={(e) => setMnfAdvancePaid(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
              </div>

              {/* Bundle Dockets Checkboxes */}
              <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    Select Ready Dockets in Origin Godown ({unmanifestedDockets.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDocketIds(
                        selectedDocketIds.length === unmanifestedDockets.length
                          ? []
                          : unmanifestedDockets.map((d) => d.id)
                      )
                    }
                    className="text-[11px] font-bold text-[#0F766E] hover:underline cursor-pointer"
                  >
                    {selectedDocketIds.length === unmanifestedDockets.length ? 'Clear All' : 'Select All'}
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-200 bg-white rounded border border-slate-200">
                  {unmanifestedDockets.length === 0 ? (
                    <p className="p-3 text-center text-slate-500">
                      No unmanifested dockets in Origin Godown.
                    </p>
                  ) : (
                    unmanifestedDockets.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center justify-between px-2.5 py-1.5 hover:bg-teal-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedDocketIds.includes(d.id)}
                            onChange={(e) =>
                              setSelectedDocketIds((prev) =>
                                e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                              )
                            }
                          />
                          <span className="font-mono-num font-bold text-[#0F766E]">{d.docketNo}</span>
                          <span className="text-slate-600">{d.originBranch}&rarr;{d.destBranch}</span>
                        </div>
                        <span className="font-mono-num text-slate-700">
                          {d.packages}Pkg / {d.chargedWeightKg}Kg
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={manifestSaving || selectedManifestDockets.length === 0}
                className="w-full py-2 rounded-lg bg-[#0F766E] hover:bg-[#0D9488] text-white font-extrabold cursor-pointer disabled:opacity-50"
              >
                {manifestSaving
                  ? 'Dispatching...'
                  : `Dispatch Line-Haul Manifest (${selectedManifestDockets.length} Dockets)`}
              </button>
            </div>
          </form>

          {/* Manifest History Table */}
          <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-extrabold text-slate-900">
                  Line-Haul Dispatch Manifests ({manifests.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Click &ldquo;Arrive &amp; Unload&rdquo; to move all bundled dockets into Destination Branch Godown
                </p>
              </div>
              <a
                href="https://ewaybillgst.gov.in"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 text-indigo-800 text-[11px] font-bold hover:bg-indigo-100"
              >
                <span>NIC EWB Portal</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Manifest / Date</th>
                    <th className="px-3 py-2 text-left">Route &amp; Truck</th>
                    <th className="px-3 py-2 text-right">Dockets / Load</th>
                    <th className="px-3 py-2 text-right">Hire / Balance</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {manifests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">
                        No Line-Haul Manifests dispatched yet.
                      </td>
                    </tr>
                  ) : (
                    manifests.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-mono-num font-extrabold text-[#0D47A1]">{m.manifestNo}</div>
                          <div className="text-[11px] text-slate-500">{formatDateDDMMYYYY(m.manifestDate)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-bold">
                            {m.fromBranch} &rarr; {m.toBranch}
                          </div>
                          <div className="font-mono-num text-[11px] text-slate-600">
                            {m.truckNo} {m.driverName ? `· ${m.driverName}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num">
                          <div className="font-bold">{m.docketIds.length} Dockets</div>
                          <div className="text-[11px] text-slate-500">
                            {m.totalPkgs} Pkg · {m.totalWeightKg} Kg
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono-num">
                          <div>Hire ₹{formatINR(m.hireAmount)}</div>
                          <div className="text-[11px] text-amber-700 font-bold">
                            Bal ₹{formatINR(m.balancePayable)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.status === 'Unloaded'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                          {m.status !== 'Unloaded' && (
                            <button
                              type="button"
                              onClick={() => void handleArriveUnloadManifest(m)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                            >
                              Arrive &amp; Unload
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              const pdf = await generateLogisticsManifestPDF(m, dockets, company);
                              onPreviewPdf(pdf, 'LineHaul_Manifests');
                            }}
                            className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 cursor-pointer"
                            title="Print Manifest PDF"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onShowConfirm({
                                title: `Delete Manifest ${m.manifestNo}?`,
                                description: 'Removes manifest record from Dispatch register.',
                                confirmLabel: 'Delete',
                                variant: 'danger',
                                onConfirm: () => removeDocument('logistics_manifests', m.id),
                              })
                            }
                            className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- VIEW 3: BRANCH GODOWN STOCK ---------------- */}
      {subView === 'godown' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-[#0F766E] to-[#115E59] text-white flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-amber-300" />
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wide">
                  Branch Godown Live Parcel Stock &amp; Delivery Desk
                </h3>
                <p className="text-[11px] text-teal-100">
                  Track bay/rack allocation, To-Pay collection &amp; instant Camera POD gate-pass delivery
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handlePrintGodownStockPdf()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-[#0F766E] hover:bg-teal-50 text-xs font-extrabold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Godown Stock Register</span>
            </button>
          </div>

          <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs">
            <div className="min-w-[180px]">
              <SearchableSelect
                ariaLabel="Godown Branch Filter"
                value={godownBranchFilter}
                onChange={setGodownBranchFilter}
                options={[
                  { value: 'ALL', label: 'All Branch Godowns', pinFirst: true },
                  ...HUB_BRANCHES.map((b) => ({ value: b, label: `Hub: ${b}` })),
                ]}
                triggerClassName="!py-1.5 !font-bold !text-[#0F766E]"
                searchPlaceholder="Search branch..."
              />
            </div>
            <div className="min-w-[175px]">
              <SearchableSelect
                ariaLabel="Godown Stage Filter"
                value={godownStageFilter}
                onChange={setGodownStageFilter}
                options={[
                  { value: 'ALL', label: 'All Stages', pinFirst: true },
                  { value: 'Delivered', label: 'Delivered (POD Done)' },
                  { value: 'Destination Godown', label: 'Destination Godown' },
                  { value: 'Manifested / In Transit', label: 'In Transit' },
                  { value: 'Origin Godown', label: 'Origin Godown' },
                  { value: 'Out for Delivery', label: 'Out for Delivery' },
                ]}
                triggerClassName="!py-1.5 !font-bold"
              />
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                value={godownSearch}
                onChange={(e) => setGodownSearch(e.target.value)}
                placeholder="Search Docket No, Party or Godown Rack..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Docket &amp; Route</th>
                  <th className="px-3 py-2 text-left">Consignee</th>
                  <th className="px-3 py-2 text-left">Rack / Godown</th>
                  <th className="px-3 py-2 text-right">Pkgs / Wt / To-Pay</th>
                  <th className="px-3 py-2 text-left">Stock Stage</th>
                  <th className="px-3 py-2 text-right">Delivery &amp; POD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {godownFilteredDockets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      No parcels match this branch godown filter.
                    </td>
                  </tr>
                ) : (
                  godownFilteredDockets.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-mono-num font-extrabold text-[#0F766E]">{d.docketNo}</div>
                        <div className="text-[11px] text-slate-500">
                          {d.originBranch} &rarr; {d.destBranch} ({formatDateDDMMYYYY(d.docketDate)})
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-900">{d.consigneeName}</div>
                        <div className="text-[11px] text-slate-500">{d.goodsDesc}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono-num px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-bold">
                          {d.godownBranch || d.originBranch} · {d.godownRack || 'BAY-1'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        <div className="font-bold">
                          {d.packages} Pkg · {d.chargedWeightKg} Kg
                        </div>
                        <div className={`text-[11px] font-bold ${d.payMode === 'To-Pay' ? 'text-red-700' : 'text-slate-500'}`}>
                          {d.payMode}: ₹{formatINR(d.totalAmount)}
                        </div>
                      </td>
                      <td className="px-3 py-2 min-w-[165px]">
                        <SearchableSelect
                          ariaLabel={`Stock stage for ${d.docketNo}`}
                          value={d.stockStage}
                          onChange={(val) =>
                            void upsertDocument(
                              'logistics_dockets',
                              d.id,
                              { stockStage: val as LogisticsStockStage },
                              false
                            )
                          }
                          options={[
                            { value: 'Delivered', label: 'Delivered' },
                            { value: 'Destination Godown', label: 'Destination Godown' },
                            { value: 'Manifested / In Transit', label: 'In Transit' },
                            { value: 'Origin Godown', label: 'Origin Godown' },
                            { value: 'Out for Delivery', label: 'Out for Delivery' },
                          ]}
                          triggerClassName="!py-1 !text-[11px] !font-bold"
                        />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                        {d.podImageDataUrl ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            POD {d.podDate ? formatDateDDMMYYYY(d.podDate) : 'Saved'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setScannerDocketTarget(d);
                              setScannerMode('pod');
                              setScannerOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Deliver + POD</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Built-in Camera POD & EWB QR Scanner Modal */}
      <CameraPodQrScannerModal
        open={scannerOpen}
        mode={scannerMode}
        title={
          scannerDocketTarget
            ? `Capture Delivery POD for Docket ${scannerDocketTarget.docketNo}`
            : 'Logistics E-Way Bill / Docket QR Scanner'
        }
        onClose={() => {
          setScannerOpen(false);
          setScannerDocketTarget(null);
        }}
        onQrDecoded={(parsed) => {
          if (parsed.ewbNo) setEwayBillNo(parsed.ewbNo);
          if (parsed.validUpto) setEwayBillValidUpto(parsed.validUpto);
          setScannerOpen(false);
        }}
        onCapturePodImage={async (dataUrl) => {
          if (scannerDocketTarget) {
            await upsertDocument(
              'logistics_dockets',
              scannerDocketTarget.id,
              {
                stockStage: 'Delivered',
                podImageDataUrl: dataUrl,
                podDate: new Date().toISOString().slice(0, 10),
              },
              false
            );
          }
        }}
      />
    </div>
  );
};
