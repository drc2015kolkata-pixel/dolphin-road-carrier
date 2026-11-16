import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CloudUpload,
  Lock,
  Save,
  Search,
  Trash2,
  Truck,
  Unlock,
  Upload,
} from 'lucide-react';
import { ConsignmentNote, LorryHire } from '../types/erp';
import { formatDateDDMMYYYY, formatINR, makeSafeDocId, todayISO } from '../lib/formatters';
import { scanPODDocument } from '../lib/ocrEngine';
import { logBranchActivity, removeDocument, upsertDocument } from '../lib/firestoreStore';
import { uploadBlobToDriveFolder } from '../lib/driveBackup';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

interface LorryHirePodModuleProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  lorryHires: LorryHire[];
  consignments: ConsignmentNote[];
  driveAccessToken: string | null;
  onConnectDrive: () => Promise<void>;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const LorryHirePodModuleInner: React.FC<LorryHirePodModuleProps> = ({
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  lorryHires,
  consignments,
  driveAccessToken,
  onConnectDrive,
  onShowConfirm,
}) => {
  const podFileRef = useRef<HTMLInputElement | null>(null);
  const podCamRef = useRef<HTMLInputElement | null>(null);

  const [cnNo, setCnNo] = useState('');
  const [cnDate, setCnDate] = useState(todayISO());
  const [truckNo, setTruckNo] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [fromCity, setFromCity] = useState('KOLKATA');
  const [toCity, setToCity] = useState('');
  const [hireAmount, setHireAmount] = useState('');
  const [advancePaid, setAdvancePaid] = useState('0');
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  // Active POD modal state
  const [activePodTarget, setActivePodTarget] = useState<LorryHire | null>(null);
  const [podDate, setPodDate] = useState(todayISO());
  const [podImageUrl, setPodImageUrl] = useState('');
  const [podFileName, setPodFileName] = useState('');
  const [podScanStatus, setPodScanStatus] = useState<string | null>(null);
  const [podUploading, setPodUploading] = useState(false);

  // Balance payment modal state
  const [payTarget, setPayTarget] = useState<LorryHire | null>(null);
  const [payMode, setPayMode] = useState('Bank Transfer');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(todayISO());

  const indexedHires = useMemo(() => {
    const sorted = [...lorryHires].sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''));
    return sorted.map((h) => ({
      item: h,
      haystack: `${h.cnNo || ''} ${h.truckNo || ''} ${h.ownerName || ''} ${h.toCity || ''} ${h.branchCode || ''}`.toLowerCase(),
    }));
  }, [lorryHires]);

  const filteredHires = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return indexedHires.map((x) => x.item);
    return indexedHires.filter((x) => x.haystack.includes(q)).map((x) => x.item);
  }, [indexedHires, debouncedSearch]);

  const handleSelectCn = (selectedCnNo: string) => {
    setCnNo(selectedCnNo);
    const cn = consignments.find((c) => c.cnNo.toLowerCase() === selectedCnNo.toLowerCase());
    if (cn) {
      setCnDate(cn.cnDate);
      setTruckNo(cn.truckNo);
      setOwnerName(cn.ownerName || '');
      setFromCity(cn.fromCity);
      setToCity(cn.toCity);
    }
  };

  const handleCreateHire = async (e: React.FormEvent) => {
    e.preventDefault();
    const hireNum = Number(hireAmount) || 0;
    const advNum = Number(advancePaid) || 0;
    if (!cnNo.trim() || !truckNo.trim() || hireNum <= 0) return;

    setSaving(true);
    try {
      const id = makeSafeDocId('hire');
      await upsertDocument(
        'lorry_hires',
        id,
        {
          cnNo: cnNo.trim().slice(0, 40),
          cnDate,
          truckNo: truckNo.trim().toUpperCase().slice(0, 30),
          ownerName: ownerName.trim().slice(0, 140),
          fromCity: fromCity.trim().slice(0, 120),
          toCity: toCity.trim().slice(0, 120),
          hireAmount: hireNum,
          advancePaid: advNum,
          balancePayable: Math.max(0, hireNum - advNum),
          podReceived: false,
          podReceiveDate: '',
          podImageDataUrl: '',
          podFileName: '',
          balancePaid: false,
          balancePaidDate: '',
          paymentMode: '',
          paymentRef: '',
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        true
      );

      await logBranchActivity({
        action: 'Created Lorry Hire',
        module: 'Lorry Hire',
        docRefCode: cnNo.trim(),
        summary: `${truckNo.trim().toUpperCase()} · Hire ₹${formatINR(hireNum)} (POD Locked)`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      setCnNo('');
      setTruckNo('');
      setOwnerName('');
      setToCity('');
      setHireAmount('');
      setAdvancePaid('0');
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
          : 'POD scanned. Confirm receiver signature & POD Receive Date.'
      );
    } catch (err) {
      setPodScanStatus(err instanceof Error ? err.message : 'POD scan failed');
    }
  };

  const handleSavePodScan = async () => {
    if (!activePodTarget || !podImageUrl || !podDate) return;
    setPodUploading(true);
    try {
      await upsertDocument(
        'lorry_hires',
        activePodTarget.id,
        {
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
        action: 'Verified & Unlocked POD',
        module: 'Lorry Hire',
        docRefCode: activePodTarget.cnNo,
        summary: `POD scanned for ${activePodTarget.truckNo} (Recd ${formatDateDDMMYYYY(podDate)})`,
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
        txType: 'Expense',
        ledgerAccount: 'Lorry Hire Payable A/c',
        partyName: payTarget.ownerName || payTarget.truckNo,
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

  const hireColumns = useMemo<Array<TableColumn<LorryHire>>>(
    () => [
      {
        key: 'cnNo',
        header: 'C/N No',
        cellClassName: 'font-mono-num font-bold text-blue-800 whitespace-nowrap',
        render: (h) => (
          <div>
            <span>{h.cnNo}</span>
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
        header: 'Truck & Owner',
        render: (h) => (
          <div>
            <div className="font-mono-num font-bold">{h.truckNo}</div>
            <div className="text-[11px] text-slate-500">{h.ownerName || '-'}</div>
          </div>
        ),
      },
      {
        key: 'route',
        header: 'Route',
        cellClassName: 'whitespace-nowrap',
        render: (h) => `${h.fromCity} → ${h.toCity}`,
      },
      {
        key: 'hireAmount',
        header: 'Hire (₹)',
        align: 'right',
        cellClassName: 'font-mono-num',
        render: (h) => formatINR(h.hireAmount),
      },
      {
        key: 'advancePaid',
        header: 'Advance (₹)',
        align: 'right',
        cellClassName: 'font-mono-num',
        render: (h) => formatINR(h.advancePaid),
      },
      {
        key: 'balancePayable',
        header: 'Balance (₹)',
        align: 'right',
        cellClassName: 'font-mono-num font-bold text-orange-700',
        render: (h) => formatINR(h.balancePayable),
      },
      {
        key: 'podStatus',
        header: 'POD Status',
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
                setPodImageUrl(h.podImageDataUrl || '');
                setPodFileName(h.podFileName || '');
                setPodScanStatus(null);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-orange-50 border border-orange-300 hover:bg-orange-100 text-orange-800 font-bold cursor-pointer whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" />
              Scan / Upload POD
            </button>
          );
        },
      },
      {
        key: 'gate',
        header: 'Balance Payment Gate',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1.5',
        render: (h) => {
          const isUnlocked = Boolean(h.podReceived && h.podReceiveDate && h.podFileName);
          return (
            <>
              {h.balancePaid ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Paid ({formatDateDDMMYYYY(h.balancePaidDate)})
                </span>
              ) : isUnlocked ? (
                <button
                  type="button"
                  onClick={() => {
                    setPayTarget(h);
                    setPayDate(todayISO());
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Pay Balance ₹{formatINR(h.balancePayable)}
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-50 border border-red-200 text-red-700 font-bold"
                  title="Strictly locked until signed POD is uploaded and POD Receive Date is entered"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Locked (POD Required)
                </span>
              )}
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
            </>
          );
        },
      },
    ],
    [onShowConfirm]
  );

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleCreateHire}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Truck className="w-4 h-4" />
            <span>Lorry Hire Register &amp; POD Payment Lock ({activeBranchCode})</span>
          </div>
          <span className="text-xs text-blue-100">
            Balance payment remains locked until signed POD &amp; Receive Date are recorded
          </span>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">C/N Number *</label>
            <input
              type="text"
              required
              list="hire-cn-list"
              value={cnNo}
              onChange={(e) => handleSelectCn(e.target.value)}
              placeholder="KOL-146/26-27"
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
              onChange={(e) => setTruckNo(e.target.value.toUpperCase())}
              placeholder="WB51B0800"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Truck Owner / Broker</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
            <label className="block font-semibold text-slate-700 mb-1">Total Lorry Hire (₹) *</label>
            <input
              type="number"
              required
              value={hireAmount}
              onChange={(e) => setHireAmount(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Advance Paid (₹)</label>
            <input
              type="number"
              value={advancePaid}
              onChange={(e) => setAdvancePaid(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Lorry Hire (Locked Until POD)'}
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
              placeholder="Search CN, Truck, Owner..."
              className="px-2.5 py-1 rounded bg-white text-slate-900 text-xs w-52 focus:outline-none"
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

      {/* POD Scanner Modal */}
      {activePodTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">
                Scan Signed POD — {activePodTarget.cnNo} ({activePodTarget.truckNo})
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
                  onClick={() => podCamRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Camera Scan Signed POD
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
                    className="max-h-48 mx-auto rounded object-contain"
                  />
                </div>
              )}

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
                Releasing balance <span className="font-mono-num font-bold text-emerald-700">₹{formatINR(payTarget.balancePayable)}</span> to{' '}
                <span className="font-bold">{payTarget.ownerName || payTarget.truckNo}</span>.
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
    </div>
  );
};

export const LorryHirePodModule = React.memo(LorryHirePodModuleInner);
