import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Keyboard,
  Landmark,
  Lock,
  MessageCircle,
  Plus,
  Printer,
  Search,
  Settings2,
  Smartphone,
  Trash2,
  Unlock,
  Wallet,
  X,
} from 'lucide-react';
import { logBranchActivity, removeDocument, upsertDocument } from '../lib/firestoreStore';
import { formatDateDDMMYYYY, formatINR, todayISO } from '../lib/formatters';
import { GeneratedPdfResult, generateFoxproStatementPDF, printPdfDirect } from '../lib/pdfEngine';
import { playVerifiedBeep } from '../lib/audioFeedback';
import { buildWhatsAppShareHref, triggerExternalShareLink } from '../lib/shareUtils';
import {
  BUSINESS_MODE_META,
  BusinessMode,
  CompanySettings,
  StaffAccount,
  StaffCommissionEntry,
  StaffMultiAdvanceLog,
  StaffMultiBalanceDateLog,
  StaffMultiPaidReturnLog,
} from '../types/erp';
import { ConfirmModal } from './ConfirmModal';
import { SearchableSelect } from './SearchableSelect';
import { COMMON_REMARK_PRESETS, PAYMENT_MODE_OPTIONS } from '../lib/dropdownMasterStore';

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
  const [division, setDivision] = useState<BusinessMode>('FTL');
  const [staffName, setStaffName] = useState(
    () => staffAccounts[0]?.displayName || 'Field Booking Staff'
  );
  const [staffBankAccount, setStaffBankAccount] = useState('');
  const [staffUpiId, setStaffUpiId] = useState('');
  const [challanNo, setChallanNo] = useState(prefillChallanNo);
  const [truckNo, setTruckNo] = useState(prefillTruckNo);
  const [wheelType, setWheelType] = useState<string>('10-Wheeler');
  const [entryType, setEntryType] = useState<'Commission' | 'Advance Taken' | 'Paid'>('Commission');
  const [amount, setAmount] = useState<string>(() => String(DEFAULT_WHEEL_RATES['10-Wheeler']));
  const [challanAmt, setChallanAmt] = useState<string>('0');
  const [travellingAmt, setTravellingAmt] = useState<string>('0');
  const [miscAmt, setMiscAmt] = useState<string>('0');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [advanceDate, setAdvanceDate] = useState('');
  const [monthlyPaidDate, setMonthlyPaidDate] = useState('');
  const [settledZeroFlag, setSettledZeroFlag] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [showMultiLogs, setShowMultiLogs] = useState(false);
  const [multiAdvances, setMultiAdvances] = useState<StaffMultiAdvanceLog[]>([]);
  const [multiPaidReturns, setMultiPaidReturns] = useState<StaffMultiPaidReturnLog[]>([]);
  const [multiBalanceDates, setMultiBalanceDates] = useState<StaffMultiBalanceDateLog[]>([]);
  const [saving, setSaving] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffCommissionEntry | null>(null);
  const [bankUpiModalOpen, setBankUpiModalOpen] = useState(false);
  const [bankUpiUnlocked, setBankUpiUnlocked] = useState(false);
  const [wheelRateModalOpen, setWheelRateModalOpen] = useState(false);
  const [draftWheelRates, setDraftWheelRates] = useState<Record<string, number>>(() => ({
    ...DEFAULT_WHEEL_RATES,
    ...(company.dropdownMaster?.wheelCommissionRates || {}),
  }));

  const matchedStaffProfile = useMemo(
    () =>
      staffAccounts.find(
        (s) => s.displayName.trim().toLowerCase() === staffName.trim().toLowerCase()
      ) || null,
    [staffAccounts, staffName]
  );

  useEffect(() => {
    if (!matchedStaffProfile) return;
    const formattedBank = matchedStaffProfile.bankAccountNo
      ? `${matchedStaffProfile.bankName || 'Bank'} A/c ${matchedStaffProfile.bankAccountNo}${
          matchedStaffProfile.bankIfsc ? ` (${matchedStaffProfile.bankIfsc})` : ''
        }`
      : '';
    if (formattedBank && !editingId) setStaffBankAccount(formattedBank);
    if (matchedStaffProfile.upiId && !editingId) setStaffUpiId(matchedStaffProfile.upiId);
  }, [matchedStaffProfile, editingId]);

  useEffect(() => {
    if (prefillChallanNo) setChallanNo(prefillChallanNo);
    if (prefillTruckNo) setTruckNo(prefillTruckNo);
  }, [prefillChallanNo, prefillTruckNo]);

  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setShowMultiLogs((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly]);

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

    let dayTotal = 0;
    let monthTotal = 0;
    const activeDay = entryDate || todayISO();
    const activeMonth = activeDay.slice(0, 7);

    const rows = fyFiltered.map((entry) => {
      const rawAmt = Number(entry.amount);
      const amt = Number.isFinite(rawAmt) ? Math.max(0, rawAmt) : 0;
      const extras = Number(entry.challanAmt || 0) + Number(entry.travellingAmt || 0) + Number(entry.miscAmt || 0);
      if (entry.entryDate === activeDay) dayTotal += amt + extras;
      if ((entry.entryDate || '').startsWith(activeMonth)) monthTotal += amt + extras;
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
      dayTotal,
      monthTotal,
      activeDay,
      activeMonth,
    };
  }, [fyFiltered, entryDate]);

  const resetForm = () => {
    setEditingId(null);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setDivision('FTL');
    setChallanNo(prefillChallanNo || '');
    setTruckNo(prefillTruckNo || '');
    setEntryType('Commission');
    setWheelType('10-Wheeler');
    setAmount(String(wheelRates['10-Wheeler'] ?? 600));
    setChallanAmt('0');
    setTravellingAmt('0');
    setMiscAmt('0');
    setPaymentMode('Cash');
    setAdvanceDate('');
    setMonthlyPaidDate('');
    setSettledZeroFlag(false);
    setRemarks('');
    setMultiAdvances([]);
    setMultiPaidReturns([]);
    setMultiBalanceDates([]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!staffName.trim()) {
      setBannerMsg('Please enter or select Staff Name.');
      return;
    }
    const numAmount = Math.max(0, Number(amount || 0));
    const numChallanAmt = Math.max(0, Number(challanAmt || 0));
    const numTrav = Math.max(0, Number(travellingAmt || 0));
    const numMisc = Math.max(0, Number(miscAmt || 0));
    if (numAmount <= 0 && numChallanAmt <= 0 && numTrav <= 0 && numMisc <= 0) {
      setBannerMsg('Please enter an amount greater than 0.');
      return;
    }

    setSaving(true);
    setBannerMsg(null);
    const id = editingId || `comm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      const cleanAdvances = multiAdvances
        .filter((a) => Number(a.amount) > 0 || a.account.trim())
        .slice(0, 50)
        .map((a) => ({
          date: a.date || entryDate,
          account: (a.account || 'Cash').trim(),
          amount: Math.max(0, Number(a.amount) || 0),
          mode: a.mode || 'Cash',
        }));
      const cleanReturns = multiPaidReturns
        .filter((r) => Number(r.amount) > 0 || (r.refNo || '').trim())
        .slice(0, 50)
        .map((r) => ({
          date: r.date || entryDate,
          amount: Math.max(0, Number(r.amount) || 0),
          mode: r.mode || 'Cash',
          refNo: (r.refNo || '').trim(),
        }));
      const cleanBalDates = multiBalanceDates
        .filter((b) => Number(b.balanceAmt) > 0 || (b.note || '').trim())
        .slice(0, 50)
        .map((b) => ({
          date: b.date || entryDate,
          balanceAmt: Math.max(0, Number(b.balanceAmt) || 0),
          note: (b.note || '').trim(),
        }));

      await upsertDocument(
        'staff_commissions',
        id,
        {
          id,
          entryDate,
          financialYear: activeFy,
          division,
          staffName: staffName.trim(),
          staffBankAccount: staffBankAccount.trim(),
          staffUpiId: staffUpiId.trim(),
          challanNo: challanNo.trim().toUpperCase(),
          truckNo: truckNo.trim().toUpperCase(),
          wheelType,
          entryType,
          commissionRate: wheelRates[wheelType] ?? 0,
          challanAmt: numChallanAmt,
          travellingAmt: numTrav,
          miscAmt: numMisc,
          amount: numAmount,
          paymentMode,
          advanceDate: advanceDate || '',
          monthlyPaidDate: monthlyPaidDate || '',
          settledZeroFlag: Boolean(settledZeroFlag || monthlyPaidDate),
          remarks: remarks.trim(),
          multiAdvances: cleanAdvances,
          multiPaidReturns: cleanReturns,
          multiBalanceDates: cleanBalDates,
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
        summary: `[${division}] ${entryType} Rs.${numAmount} for ${staffName} (${wheelType})`,
        staffCode: currentStaffCode,
        branchCode: currentBranchCode,
        ownerUid,
      });

      playVerifiedBeep();
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
    if (entryType === 'Commission' && draftWheelRates[wheelType] !== undefined) {
      setAmount(String(draftWheelRates[wheelType]));
    }
    setWheelRateModalOpen(false);
    playVerifiedBeep();
    setBannerMsg('Updated Wheel Commission Rate Master cleanly.');
  };

  const handleEditRow = (row: StaffCommissionEntry) => {
    if (readOnly) return;
    setEditingId(row.id);
    setEntryDate(row.entryDate || new Date().toISOString().slice(0, 10));
    setDivision((row.division as BusinessMode) || 'FTL');
    setStaffName(row.staffName);
    setStaffBankAccount(row.staffBankAccount || '');
    setStaffUpiId(row.staffUpiId || '');
    setChallanNo(row.challanNo || '');
    setTruckNo(row.truckNo || '');
    setWheelType(row.wheelType || '10-Wheeler');
    setEntryType(row.entryType);
    setAmount(String(row.amount || 0));
    setChallanAmt(String(row.challanAmt ?? 0));
    setTravellingAmt(String(row.travellingAmt ?? 0));
    setMiscAmt(String(row.miscAmt ?? 0));
    setPaymentMode(row.paymentMode || 'Cash');
    setAdvanceDate(row.advanceDate || '');
    setMonthlyPaidDate(row.monthlyPaidDate || '');
    setSettledZeroFlag(Boolean(row.settledZeroFlag || row.monthlyPaidDate));
    setRemarks(row.remarks || '');
    setMultiAdvances(Array.isArray(row.multiAdvances) ? row.multiAdvances : []);
    setMultiPaidReturns(Array.isArray(row.multiPaidReturns) ? row.multiPaidReturns : []);
    setMultiBalanceDates(Array.isArray(row.multiBalanceDates) ? row.multiBalanceDates : []);
    if (
      (row.multiAdvances?.length || 0) > 0 ||
      (row.multiPaidReturns?.length || 0) > 0 ||
      (row.multiBalanceDates?.length || 0) > 0
    ) {
      setShowMultiLogs(true);
    }
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
            <div className="min-w-[185px]">
              <SearchableSelect
                ariaLabel="Filter by Staff Member"
                value={staffFilter}
                onChange={setStaffFilter}
                options={[
                  { value: 'ALL', label: 'All Staff Members', pinFirst: true },
                  ...staffNameOptions.map((n) => ({ value: n, label: n })),
                ]}
                triggerClassName="!py-1.5 !font-bold"
                searchPlaceholder="Search staff member..."
              />
            </div>
            <button
              type="button"
              onClick={() => setWheelRateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-300 cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5 text-[#0D47A1]" />
              Edit Wheel Rates
            </button>
            <button
              type="button"
              onClick={() => void handlePrintPdf()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Preview / Low-MB PDF
            </button>
            <button
              type="button"
              onClick={() =>
                void generateFoxproStatementPDF(
                  {
                    title: 'STAFF COMMISSION & ADVANCE LEDGER',
                    subtitle: `Staff: ${staffFilter === 'ALL' ? 'All Booking Staff' : staffFilter} | FY: ${activeFy}`,
                    fileName: `Staff_Commission_${activeFy.replace(/\s+/g, '_')}.pdf`,
                    orientation: 'l',
                    columns: [
                      { label: 'DATE', widthPct: 12 },
                      { label: 'STAFF NAME', widthPct: 22 },
                      { label: 'CHALLAN / TRUCK', widthPct: 18 },
                      { label: 'TYPE / WHEELS', widthPct: 18 },
                      { label: 'COMMISSION (+)', widthPct: 10, align: 'right' },
                      { label: 'ADV / PAID (-)', widthPct: 10, align: 'right' },
                      { label: 'BALANCE', widthPct: 10, align: 'right' },
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
                    })),
                  },
                  company
                ).then((pdf) => printPdfDirect(pdf))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={() =>
                triggerExternalShareLink(
                  buildWhatsAppShareHref({
                    message: `DRC Staff Ledger (${staffFilter} · ${activeFy})\nDay Total: Rs. ${formatINR(ledgerRows.dayTotal)}\nMonth Total: Rs. ${formatINR(ledgerRows.monthTotal)}\nClosing Balance: Rs. ${formatINR(ledgerRows.netBalance)}`,
                  })
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Share
            </button>
          </div>
        </div>

        {/* Date-Wise + Monthly + Yearly Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3 text-xs font-mono-num">
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
            <span className="font-sans font-bold text-slate-600">Date-Wise ({formatDateDDMMYYYY(ledgerRows.activeDay)}):</span>
            <span className="font-extrabold text-[#0D47A1]">Rs. {formatINR(ledgerRows.dayTotal)}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
            <span className="font-sans font-bold text-slate-600">Monthly ({ledgerRows.activeMonth}):</span>
            <span className="font-extrabold text-indigo-800">Rs. {formatINR(ledgerRows.monthTotal)}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 flex justify-between">
            <span className="font-sans font-bold text-indigo-900">Yearly Total ({activeFy}):</span>
            <span className="font-extrabold text-indigo-950">Rs. {formatINR(ledgerRows.totalCommission + ledgerRows.totalPaid)}</span>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-extrabold text-slate-900">
              {editingId ? 'Edit Staff Commission / Advance Entry' : 'Add Staff Commission / Advance / Settlement'}
            </h4>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowMultiLogs((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold cursor-pointer ${
                  showMultiLogs
                    ? 'bg-amber-100 border-amber-400 text-amber-900'
                    : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                }`}
                title="Shortcut: Press M when outside text inputs"
              >
                <Keyboard className="w-3.5 h-3.5" />
                M (Multi Logs:{' '}
                {multiAdvances.length + multiPaidReturns.length + multiBalanceDates.length})
              </button>
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
                Business Division
              </label>
              <SearchableSelect
                ariaLabel="Staff Commission Division"
                value={division}
                onChange={(val) => setDivision((val as BusinessMode) || 'FTL')}
                options={[
                  { value: 'FTL', label: BUSINESS_MODE_META.FTL.shortLabel },
                  { value: 'LOGISTICS', label: BUSINESS_MODE_META.LOGISTICS.shortLabel },
                  { value: 'PTL', label: BUSINESS_MODE_META.PTL.shortLabel },
                  { value: 'COURIER', label: BUSINESS_MODE_META.COURIER.shortLabel },
                ]}
                triggerClassName="!py-2 !font-bold"
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
              <SearchableSelect
                ariaLabel="Staff Commission Entry Type"
                value={entryType}
                onChange={(val) =>
                  handleEntryTypeChange(val as 'Commission' | 'Advance Taken' | 'Paid')
                }
                options={[
                  { value: 'Advance Taken', label: 'Advance Taken (-)' },
                  { value: 'Commission', label: 'Commission Earned (+)' },
                  { value: 'Paid', label: 'Settlement Paid (-)' },
                ]}
                triggerClassName="!py-2 !font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Vehicle Wheel Type
              </label>
              <SearchableSelect
                ariaLabel="Vehicle Wheel Type"
                value={wheelType}
                onChange={handleWheelChange}
                options={WHEEL_TYPES.map((w) => ({
                  value: w,
                  label: `${w} (Rate Rs.${wheelRates[w] ?? 500})`,
                }))}
                triggerClassName="!py-2 !font-bold"
                searchPlaceholder="Search wheel type..."
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Challan Against (CN/Challan)</label>
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
                Amount / Rupees (Rs.)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Challan Amt (Rs.)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={challanAmt}
                onChange={(e) => setChallanAmt(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Travelling Expense (Rs.)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={travellingAmt}
                onChange={(e) => setTravellingAmt(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Miscellaneous Expense (Rs.)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={miscAmt}
                onChange={(e) => setMiscAmt(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Advance Date / Monthly Paid Date
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="date"
                  value={advanceDate}
                  onChange={(e) => setAdvanceDate(e.target.value)}
                  title="Advance Date"
                  className="w-full px-2 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num"
                />
                <input
                  type="date"
                  value={monthlyPaidDate}
                  onChange={(e) => {
                    setMonthlyPaidDate(e.target.value);
                    if (e.target.value) setSettledZeroFlag(true);
                  }}
                  title="Monthly Paid Date"
                  className="w-full px-2 py-2 rounded-lg border border-slate-300 text-xs bg-white font-mono-num"
                />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settledZeroFlag}
                    onChange={(e) => setSettledZeroFlag(e.target.checked)}
                  />
                  Mark Settled
                </label>
                {(settledZeroFlag || monthlyPaidDate) && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 border border-emerald-400 text-emerald-900 text-[10px] font-extrabold">
                    ✅ PAID (No Balance Due)
                  </span>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Staff Bank A/c &amp; UPI (Edit-Lock Protected)
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setBankUpiModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 text-xs font-bold cursor-pointer"
                >
                  <Landmark className="w-3.5 h-3.5" /> 🏦 Bank A/c
                </button>
                <button
                  type="button"
                  onClick={() => setBankUpiModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold cursor-pointer"
                >
                  <Smartphone className="w-3.5 h-3.5" /> 📱 UPI ID
                </button>
                <div className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono-num truncate">
                  {staffBankAccount || staffUpiId || 'Auto-loaded from Master'}
                </div>
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-4">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Payment Mode &amp; Remarks
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                <SearchableSelect
                  ariaLabel="Commission Payment Mode"
                  value={paymentMode}
                  onChange={setPaymentMode}
                  options={[...PAYMENT_MODE_OPTIONS, 'Adjustment']}
                  triggerClassName="!py-2"
                />
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional remark..."
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                />
                <SearchableSelect
                  ariaLabel="Quick Remark Preset"
                  value=""
                  onChange={(val) => {
                    if (val) setRemarks(val);
                  }}
                  options={[
                    { value: '', label: '+ Quick Remark Preset (A-Z)...', pinFirst: true },
                    ...COMMON_REMARK_PRESETS.map((r) => ({ value: r, label: r })),
                  ]}
                  triggerClassName="!py-2 !text-xs"
                  searchPlaceholder="Search remarks..."
                />
              </div>
            </div>
          </div>

          {showMultiLogs && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3 rounded-lg bg-amber-50/70 border border-amber-200">
              {/* Log 1: Multi Advances */}
              <div className="bg-white p-2.5 rounded-lg border border-amber-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-amber-900">
                    Multi-Advance Log ({multiAdvances.length}/50)
                  </span>
                  <button
                    type="button"
                    disabled={multiAdvances.length >= 50}
                    onClick={() =>
                      setMultiAdvances((prev) => [
                        ...prev,
                        { date: entryDate, account: 'Cash', amount: 0, mode: 'Cash' },
                      ])
                    }
                    className="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
                {multiAdvances.map((a, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1 items-center text-[11px]">
                    <input
                      type="date"
                      value={a.date}
                      onChange={(e) =>
                        setMultiAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, date: e.target.value } : r))
                        )
                      }
                      className="col-span-4 px-1.5 py-1 rounded border border-slate-300"
                    />
                    <input
                      value={a.account}
                      placeholder="Account"
                      onChange={(e) =>
                        setMultiAdvances((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, account: e.target.value } : r))
                        )
                      }
                      className="col-span-4 px-1.5 py-1 rounded border border-slate-300"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={a.amount}
                      onChange={(e) =>
                        setMultiAdvances((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, amount: Number(e.target.value) || 0 } : r
                          )
                        )
                      }
                      className="col-span-3 px-1.5 py-1 rounded border border-slate-300 font-mono-num text-right"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMultiAdvances((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-red-600 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Log 2: Multi Paid / Returns */}
              <div className="bg-white p-2.5 rounded-lg border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-emerald-900">
                    Multi Paid / Returns ({multiPaidReturns.length}/50)
                  </span>
                  <button
                    type="button"
                    disabled={multiPaidReturns.length >= 50}
                    onClick={() =>
                      setMultiPaidReturns((prev) => [
                        ...prev,
                        { date: entryDate, amount: 0, mode: 'Cash', refNo: '' },
                      ])
                    }
                    className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
                {multiPaidReturns.map((r, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1 items-center text-[11px]">
                    <input
                      type="date"
                      value={r.date}
                      onChange={(e) =>
                        setMultiPaidReturns((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, date: e.target.value } : row))
                        )
                      }
                      className="col-span-4 px-1.5 py-1 rounded border border-slate-300"
                    />
                    <input
                      value={r.refNo || ''}
                      placeholder="Ref/Mode"
                      onChange={(e) =>
                        setMultiPaidReturns((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, refNo: e.target.value } : row))
                        )
                      }
                      className="col-span-4 px-1.5 py-1 rounded border border-slate-300"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={r.amount}
                      onChange={(e) =>
                        setMultiPaidReturns((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, amount: Number(e.target.value) || 0 } : row
                          )
                        )
                      }
                      className="col-span-3 px-1.5 py-1 rounded border border-slate-300 font-mono-num text-right"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMultiPaidReturns((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-red-600 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Log 3: Multi Balance Dates */}
              <div className="bg-white p-2.5 rounded-lg border border-blue-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-blue-900">
                    Multi Balance Dates ({multiBalanceDates.length}/50)
                  </span>
                  <button
                    type="button"
                    disabled={multiBalanceDates.length >= 50}
                    onClick={() =>
                      setMultiBalanceDates((prev) => [
                        ...prev,
                        { date: entryDate, balanceAmt: 0, note: '' },
                      ])
                    }
                    className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
                {multiBalanceDates.map((b, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1 items-center text-[11px]">
                    <input
                      type="date"
                      value={b.date}
                      onChange={(e) =>
                        setMultiBalanceDates((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, date: e.target.value } : row))
                        )
                      }
                      className="col-span-4 px-1.5 py-1 rounded border border-slate-300"
                    />
                    <input
                      value={b.note || ''}
                      placeholder="Note"
                      onChange={(e) =>
                        setMultiBalanceDates((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, note: e.target.value } : row))
                        )
                      }
                      className="col-span-4 px-1.5 py-1 rounded border border-slate-300"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={b.balanceAmt}
                      onChange={(e) =>
                        setMultiBalanceDates((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, balanceAmt: Number(e.target.value) || 0 } : row
                          )
                        )
                      }
                      className="col-span-3 px-1.5 py-1 rounded border border-slate-300 font-mono-num text-right"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMultiBalanceDates((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-red-600 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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

      {bankUpiModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-extrabold">Bank &amp; UPI Modal — {staffName}</span>
              <button type="button" onClick={() => setBankUpiModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between bg-slate-100 px-3 py-2 rounded-lg">
                <span className="font-bold">Edit Unlock [YES / NO]:</span>
                <button
                  type="button"
                  onClick={() => setBankUpiUnlocked((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-extrabold cursor-pointer ${
                    bankUpiUnlocked ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-white'
                  }`}
                >
                  {bankUpiUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {bankUpiUnlocked ? 'YES (Editable)' : 'NO (Locked)'}
                </button>
              </div>
              <div>
                <label className="block font-bold mb-1">Bank A/c &amp; IFSC</label>
                <input
                  type="text"
                  value={staffBankAccount}
                  disabled={!bankUpiUnlocked}
                  onChange={(e) => setStaffBankAccount(e.target.value)}
                  className="w-full px-2.5 py-2 rounded border border-slate-300 font-mono-num disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">UPI ID</label>
                <input
                  type="text"
                  value={staffUpiId}
                  disabled={!bankUpiUnlocked}
                  onChange={(e) => setStaffUpiId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded border border-slate-300 font-mono-num disabled:bg-slate-100"
                />
              </div>
            </div>
            <div className="px-4 py-2.5 bg-slate-50 border-t flex justify-end">
              <button
                type="button"
                onClick={() => setBankUpiModalOpen(false)}
                className="px-4 py-1.5 rounded bg-[#0D47A1] text-white text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {wheelRateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-extrabold">Wheel Commission Rate Master (Rs.)</span>
              <button type="button" onClick={() => setWheelRateModalOpen(false)} className="cursor-pointer">
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
                      setDraftWheelRates((p) => ({ ...p, [wt]: Math.max(0, Number(e.target.value || 0)) }))
                    }
                    className="w-28 px-2 py-1 rounded border border-slate-300 text-right font-mono-num font-bold"
                  />
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 bg-slate-50 border-t flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWheelRateModalOpen(false)}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveWheelRates()}
                className="px-4 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold cursor-pointer"
              >
                Save Rate Master
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
