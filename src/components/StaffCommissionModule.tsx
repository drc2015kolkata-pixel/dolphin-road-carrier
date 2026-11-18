import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { logBranchActivity, removeDocument, upsertDocument } from '../lib/firestoreStore';
import { formatDateDDMMYYYY, formatINR } from '../lib/formatters';
import { GeneratedPdfResult, generateFoxproStatementPDF } from '../lib/pdfEngine';
import { CompanySettings, StaffAccount, StaffCommissionEntry } from '../types/erp';
import { ConfirmModal } from './ConfirmModal';

export const WHEEL_TYPES = [
  '4-Wheeler',
  '6-Wheeler',
  '10-Wheeler',
  '12-Wheeler',
  '14-Wheeler',
  '16-Wheeler',
  '18-Wheeler',
  '22-Wheeler Trailer',
] as const;

export const DEFAULT_WHEEL_RATES: Record<string, number> = {
  '4-Wheeler': 250,
  '6-Wheeler': 400,
  '10-Wheeler': 600,
  '12-Wheeler': 750,
  '14-Wheeler': 900,
  '16-Wheeler': 1100,
  '18-Wheeler': 1250,
  '22-Wheeler Trailer': 1500,
};

interface StaffCommissionModuleProps {
  commissions: StaffCommissionEntry[];
  staffAccounts: StaffAccount[];
  company: CompanySettings;
  activeFy: string;
  ownerUid: string;
  currentStaffCode: string;
  currentBranchCode: string;
  readOnly?: boolean;
  prefillChallanNo?: string;
  prefillTruckNo?: string;
  compact?: boolean;
  onOpenPreview: (pdf: GeneratedPdfResult) => void;
}

export const StaffCommissionModule: React.FC<StaffCommissionModuleProps> = ({
  commissions,
  staffAccounts,
  company,
  activeFy,
  ownerUid,
  currentStaffCode,
  currentBranchCode,
  readOnly = false,
  prefillChallanNo = '',
  prefillTruckNo = '',
  compact = false,
  onOpenPreview,
}) => {
  const wheelRates = useMemo(
    () => ({ ...DEFAULT_WHEEL_RATES, ...(company.dropdownMaster?.wheelCommissionRates || {}) }),
    [company.dropdownMaster?.wheelCommissionRates]
  );

  const [staffFilter, setStaffFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [staffName, setStaffName] = useState(
    () => staffAccounts[0]?.displayName || 'Field Booking Staff'
  );
  const [challanNo, setChallanNo] = useState(prefillChallanNo);
  const [truckNo, setTruckNo] = useState(prefillTruckNo);
  const [wheelType, setWheelType] = useState<string>('10-Wheeler');
  const [entryType, setEntryType] = useState<'Commission' | 'Advance Taken' | 'Paid'>('Commission');
  const [amount, setAmount] = useState<string>(() => String(DEFAULT_WHEEL_RATES['10-Wheeler']));
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffCommissionEntry | null>(null);

  useEffect(() => {
    if (prefillChallanNo) setChallanNo(prefillChallanNo);
    if (prefillTruckNo) setTruckNo(prefillTruckNo);
  }, [prefillChallanNo, prefillTruckNo]);

  const handleWheelChange = (nextWheel: string) => {
    setWheelType(nextWheel);
    if (entryType === 'Commission' && !editingId) {
      setAmount(String(wheelRates[nextWheel] ?? 500));
    }
  };

  const handleEntryTypeChange = (nextType: 'Commission' | 'Advance Taken' | 'Paid') => {
    setEntryType(nextType);
    if (nextType === 'Commission' && !editingId) {
      setAmount(String(wheelRates[wheelType] ?? 500));
    }
  };

  const staffNameOptions = useMemo(() => {
    const names = new Set<string>();
    staffAccounts.forEach((s) => names.add(s.displayName));
    commissions.forEach((c) => c.staffName && names.add(c.staffName));
    if (names.size === 0) names.add('Field Booking Staff');
    return Array.from(names);
  }, [staffAccounts, commissions]);

  const fyFiltered = useMemo(() => {
    return commissions
      .filter((c) => !c.financialYear || c.financialYear === activeFy)
      .filter((c) => (staffFilter === 'ALL' ? true : c.staffName === staffFilter))
      .filter((c) => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return (
          (c.staffName || '').toLowerCase().includes(q) ||
          (c.challanNo || '').toLowerCase().includes(q) ||
          (c.truckNo || '').toLowerCase().includes(q) ||
          (c.wheelType || '').toLowerCase().includes(q) ||
          (c.remarks || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const dCmp = (a.entryDate || '').localeCompare(b.entryDate || '');
        if (dCmp !== 0) return dCmp;
        const order = { Commission: 0, 'Advance Taken': 1, Paid: 2 } as const;
        const tCmp = (order[a.entryType] ?? 3) - (order[b.entryType] ?? 3);
        if (tCmp !== 0) return tCmp;
        return (a.id || '').localeCompare(b.id || '');
      });
  }, [commissions, activeFy, staffFilter, searchTerm]);

  // Compute running balance row-by-row down to 0
  const ledgerRows = useMemo(() => {
    let runningBalance = 0;
    let totalCommission = 0;
    let totalAdvanceTaken = 0;
    let totalPaid = 0;

    const rows = fyFiltered.map((entry) => {
      const rawAmt = Number(entry.amount);
      const amt = Number.isFinite(rawAmt) ? Math.max(0, rawAmt) : 0;
      if (entry.entryType === 'Commission') {
        totalCommission += amt;
        runningBalance += amt;
      } else if (entry.entryType === 'Advance Taken') {
        totalAdvanceTaken += amt;
        runningBalance -= amt;
      } else {
        totalPaid += amt;
        runningBalance -= amt;
      }
      runningBalance = Math.round(runningBalance * 100) / 100;
      return {
        ...entry,
        runningBalance,
      };
    });

    return {
      rows,
      totalCommission,
      totalAdvanceTaken,
      totalPaid,
      netBalance: runningBalance,
    };
  }, [fyFiltered]);

  const resetForm = () => {
    setEditingId(null);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setChallanNo(prefillChallanNo || '');
    setTruckNo(prefillTruckNo || '');
    setEntryType('Commission');
    setWheelType('10-Wheeler');
    setAmount(String(wheelRates['10-Wheeler'] ?? 600));
    setPaymentMode('Cash');
    setRemarks('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!staffName.trim()) {
      setBannerMsg('Please enter or select Staff Name.');
      return;
    }
    const numAmount = Math.max(0, Number(amount || 0));
    if (numAmount <= 0) {
      setBannerMsg('Please enter an amount greater than 0.');
      return;
    }

    setSaving(true);
    setBannerMsg(null);
    const id = editingId || `comm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await upsertDocument(
        'staff_commissions',
        id,
        {
          id,
          entryDate,
          financialYear: activeFy,
          staffName: staffName.trim(),
          challanNo: challanNo.trim().toUpperCase(),
          truckNo: truckNo.trim().toUpperCase(),
          wheelType,
          entryType,
          commissionRate: wheelRates[wheelType] ?? 0,
          amount: numAmount,
          paymentMode,
          remarks: remarks.trim(),
          branchCode: currentBranchCode,
          createdByStaff: currentStaffCode,
          ownerUid,
        },
        !editingId
      );

      await logBranchActivity({
        action: editingId ? 'UPDATE_STAFF_COMMISSION' : 'ADD_STAFF_COMMISSION',
        module: 'STAFF_COMMISSION',
        docRefCode: challanNo || staffName,
        summary: `${entryType} Rs.${numAmount} for ${staffName} (${wheelType})`,
        staffCode: currentStaffCode,
        branchCode: currentBranchCode,
        ownerUid,
      });

      setBannerMsg(
        editingId
          ? `Updated ${entryType} entry (Rs. ${formatINR(numAmount)}) for ${staffName}.`
          : `Saved ${entryType} Rs. ${formatINR(numAmount)} for ${staffName}.`
      );
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleEditRow = (row: StaffCommissionEntry) => {
    if (readOnly) return;
    setEditingId(row.id);
    setEntryDate(row.entryDate || new Date().toISOString().slice(0, 10));
    setStaffName(row.staffName);
    setChallanNo(row.challanNo || '');
    setTruckNo(row.truckNo || '');
    setWheelType(row.wheelType || '10-Wheeler');
    setEntryType(row.entryType);
    setAmount(String(row.amount || 0));
    setPaymentMode(row.paymentMode || 'Cash');
    setRemarks(row.remarks || '');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await removeDocument('staff_commissions', deleteTarget.id);
    setBannerMsg(`Deleted ${deleteTarget.entryType} row for ${deleteTarget.staffName}.`);
    setDeleteTarget(null);
  };

  const handlePrintPdf = async () => {
    const pdf = await generateFoxproStatementPDF(
      {
        title: 'STAFF COMMISSION & ADVANCE LEDGER',
        subtitle: `Staff: ${staffFilter === 'ALL' ? 'All Booking Staff' : staffFilter}   |   Season: ${activeFy}`,
        fileName: `Staff_Commission_Ledger_${activeFy.replace(/\s+/g, '_')}.pdf`,
        orientation: 'l',
        summaryLines: [
          { label: 'Total Commission', value: `Rs. ${formatINR(ledgerRows.totalCommission)}` },
          { label: 'Advance Taken', value: `Rs. ${formatINR(ledgerRows.totalAdvanceTaken)}` },
          { label: 'Net Paid', value: `Rs. ${formatINR(ledgerRows.totalPaid)}` },
          { label: 'Closing Balance', value: `Rs. ${formatINR(ledgerRows.netBalance)}` },
        ],
        columns: [
          { label: 'DATE', widthPct: 10 },
          { label: 'STAFF NAME', widthPct: 20 },
          { label: 'CHALLAN / TRUCK', widthPct: 16 },
          { label: 'WHEEL / TYPE', widthPct: 16 },
          { label: 'COMMISSION (+)', widthPct: 12, align: 'right' },
          { label: 'ADV / PAID (-)', widthPct: 12, align: 'right' },
          { label: 'BALANCE', widthPct: 14, align: 'right' },
        ],
        rows: ledgerRows.rows.map((r) => ({
          line1: [
            formatDateDDMMYYYY(r.entryDate),
            r.staffName,
            `${r.challanNo || '-'} ${r.truckNo ? `/ ${r.truckNo}` : ''}`,
            `${r.wheelType} (${r.entryType})`,
            r.entryType === 'Commission' ? formatINR(r.amount) : '-',
            r.entryType !== 'Commission' ? formatINR(r.amount) : '-',
            formatINR(r.runningBalance),
          ],
          line2: r.remarks ? ['', `Note: ${r.remarks}`, '', `Mode: ${r.paymentMode || '-'}`, '', '', ''] : undefined,
        })),
        totalsLabel: 'TOTAL IN RUPEES :',
        totalsLine1: [
          '',
          '',
          '',
          '',
          formatINR(ledgerRows.totalCommission),
          formatINR(ledgerRows.totalAdvanceTaken + ledgerRows.totalPaid),
          formatINR(ledgerRows.netBalance),
        ],
        totalAmountForWords: Math.abs(ledgerRows.netBalance),
      },
      company
    );
    onOpenPreview(pdf);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className={compact ? 'text-base font-extrabold text-slate-900' : 'text-lg font-extrabold text-slate-900'}>
                Staff Commission &amp; Advance Ledger ({activeFy})
              </h3>
              <p className="text-xs text-slate-600">
                Date-wise wheel-type commission, advances taken, settlements &amp; running ₹0 balance reconciliation. 100% inline editable.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
            >
              <option value="ALL">All Staff Members</option>
              {staffNameOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handlePrintPdf()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / PDF / Share
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="text-[11px] font-bold text-blue-800 uppercase">Commission Earned</div>
            <div className="text-lg font-extrabold text-blue-950 font-mono-num">
              Rs. {formatINR(ledgerRows.totalCommission)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
            <div className="text-[11px] font-bold text-amber-800 uppercase">Advance Taken</div>
            <div className="text-lg font-extrabold text-amber-950 font-mono-num">
              Rs. {formatINR(ledgerRows.totalAdvanceTaken)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <div className="text-[11px] font-bold text-emerald-800 uppercase">Settled / Paid</div>
            <div className="text-lg font-extrabold text-emerald-950 font-mono-num">
              Rs. {formatINR(ledgerRows.totalPaid)}
            </div>
          </div>
          <div
            className={`p-3 rounded-lg border ${
              ledgerRows.netBalance === 0
                ? 'bg-emerald-50 border-emerald-300'
                : 'bg-slate-900 text-white border-slate-900'
            }`}
          >
            <div
              className={`text-[11px] font-bold uppercase ${
                ledgerRows.netBalance === 0 ? 'text-emerald-800' : 'text-amber-300'
              }`}
            >
              Running Closing Balance
            </div>
            <div className="text-lg font-extrabold font-mono-num">
              Rs. {formatINR(ledgerRows.netBalance)}
            </div>
          </div>
        </div>

        {bannerMsg && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{bannerMsg}</span>
          </div>
        )}
      </div>

      {/* Add / Edit Entry Form */}
      {!readOnly && (
        <form
          onSubmit={(e) => void handleSave(e)}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-extrabold text-slate-900">
              {editingId ? 'Edit Staff Commission / Advance Entry' : 'Add Staff Commission / Advance / Settlement'}
            </h4>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-bold text-red-700 hover:underline cursor-pointer"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Entry Date</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Staff Name (Select or Type)
              </label>
              <input
                list="drc-commission-staff-names"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                required
                placeholder="Staff Name"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
              />
              <datalist id="drc-commission-staff-names">
                {staffNameOptions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Entry Type
              </label>
              <select
                value={entryType}
                onChange={(e) =>
                  handleEntryTypeChange(e.target.value as 'Commission' | 'Advance Taken' | 'Paid')
                }
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-bold"
              >
                <option value="Commission">Commission Earned (+)</option>
                <option value="Advance Taken">Advance Taken (-)</option>
                <option value="Paid">Settlement Paid (-)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Vehicle Wheel Type
              </label>
              <select
                value={wheelType}
                onChange={(e) => handleWheelChange(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-bold"
              >
                {WHEEL_TYPES.map((w) => (
                  <option key={w} value={w}>
                    {w} (Rate Rs.{wheelRates[w] ?? 500})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Challan / CN No.</label>
              <input
                type="text"
                value={challanNo}
                onChange={(e) => setChallanNo(e.target.value)}
                placeholder="e.g. KOL-147/26-27"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Truck No.</label>
              <input
                type="text"
                value={truckNo}
                onChange={(e) => setTruckNo(e.target.value)}
                placeholder="e.g. WB23D4589"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Amount (Rs.)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Payment Mode &amp; Remarks
              </label>
              <div className="flex gap-1.5">
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="px-2 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank">Bank</option>
                  <option value="Adjustment">Adj</option>
                </select>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional remark..."
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            {ledgerRows.netBalance > 0 && !editingId && (
              <button
                type="button"
                onClick={() => {
                  setEntryType('Paid');
                  setAmount(String(ledgerRows.netBalance));
                  setRemarks('Full & final settlement to Rs. 0 balance');
                }}
                className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold hover:bg-emerald-100 cursor-pointer"
              >
                Settle Exact Balance (Rs. {formatINR(ledgerRows.netBalance)}) to ₹0
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Save Ledger Entry'}
            </button>
          </div>
        </form>
      )}

      {/* Searchable Running Balance Register Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
          <div className="text-xs font-extrabold text-slate-800">
            Running Ledger Entries ({ledgerRows.rows.length})
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search staff, challan, truck..."
              className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs w-60"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2.5">Date</th>
                <th className="p-2.5">Staff Name</th>
                <th className="p-2.5">Challan / Truck</th>
                <th className="p-2.5">Wheel Type</th>
                <th className="p-2.5">Entry Type</th>
                <th className="p-2.5 text-right">Commission (+)</th>
                <th className="p-2.5 text-right">Advance / Paid (-)</th>
                <th className="p-2.5 text-right">Running Bal</th>
                {!readOnly && <th className="p-2.5 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {ledgerRows.rows.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 8 : 9} className="p-6 text-center text-slate-500">
                    No staff commission entries for {activeFy}. Add an entry above.
                  </td>
                </tr>
              ) : (
                ledgerRows.rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2.5 font-mono-num whitespace-nowrap">
                      {formatDateDDMMYYYY(row.entryDate)}
                    </td>
                    <td className="p-2.5 font-bold text-slate-900">{row.staffName}</td>
                    <td className="p-2.5">
                      <span className="font-semibold">{row.challanNo || '-'}</span>
                      {row.truckNo && (
                        <span className="block text-[11px] text-slate-500">{row.truckNo}</span>
                      )}
                    </td>
                    <td className="p-2.5">{row.wheelType}</td>
                    <td className="p-2.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                          row.entryType === 'Commission'
                            ? 'bg-blue-100 text-blue-900'
                            : row.entryType === 'Advance Taken'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {row.entryType}
                      </span>
                    </td>
                    <td className="p-2.5 text-right font-mono-num font-bold text-blue-900">
                      {row.entryType === 'Commission' ? formatINR(row.amount) : '-'}
                    </td>
                    <td className="p-2.5 text-right font-mono-num font-bold text-red-700">
                      {row.entryType !== 'Commission' ? formatINR(row.amount) : '-'}
                    </td>
                    <td className="p-2.5 text-right font-mono-num font-extrabold text-slate-900">
                      Rs. {formatINR(row.runningBalance)}
                    </td>
                    {!readOnly && (
                      <td className="p-2.5 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleEditRow(row)}
                          className="p-1.5 rounded text-blue-700 hover:bg-blue-50 cursor-pointer"
                          title="Inline Edit Entry"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className="p-1.5 rounded text-red-600 hover:bg-red-50 cursor-pointer"
                          title="Delete Entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Commission Entry?"
        description={`Delete ${deleteTarget?.entryType || ''} of Rs. ${formatINR(
          deleteTarget?.amount || 0
        )} for "${deleteTarget?.staffName || ''}"? Running balance will automatically recalculate.`}
        variant="danger"
        confirmLabel="Delete Entry"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
};
