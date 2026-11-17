import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  DatabaseBackup,
  Eraser,
  FileBarChart2,
  FileSpreadsheet,
  FolderSync,
  Landmark,
  Lock,
  Printer,
  Save,
  ScanLine,
  Search,
  Settings,
  Star,
  Trash2,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  CompanySettings,
  Party,
  SheetTabId,
  TransactionRecord,
} from '../types/erp';
import {
  formatDateDDMMYYYY,
  formatINR,
  formatINRCompact,
  makeSafeDocId,
  normalizeFyLabel,
  todayISO,
} from '../lib/formatters';
import {
  logBranchActivity,
  removeDocument,
  reserveNextSerialNumber,
  seedSampleDataset,
  upsertDocument,
} from '../lib/firestoreStore';
import { generateTableReportPDF, GeneratedPdfResult } from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

interface DashboardHomeProps {
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin: boolean;
  shipmentsCount: number;
  customersCount: number;
  transactions: TransactionRecord[];
  parties: Party[];
  company: CompanySettings;
  onOpenTab: (tab: SheetTabId) => void;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'Reports_Ledgers') => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const DashboardHomeInner: React.FC<DashboardHomeProps> = ({
  ownerUid,
  activeStaffCode,
  activeStaffName,
  activeBranchCode,
  activeFy,
  isMasterAdmin,
  shipmentsCount,
  customersCount,
  transactions,
  parties,
  company,
  onOpenTab,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [txType, setTxType] = useState<'Income' | 'Expense'>('Income');
  const [ledgerAccount, setLedgerAccount] = useState('Customer A/c');
  const [partyName, setPartyName] = useState('');
  const [amount, setAmount] = useState('');
  const [txDate, setTxDate] = useState(todayISO());
  const [narration, setNarration] = useState('');
  const [paymentMode, setPaymentMode] = useState('Bank Transfer');
  const [referenceNo, setReferenceNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 200);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(true);

  const { totalIncome, totalExpense, cashBalance, bankBalance } = useMemo(() => {
    const fyOpenings = company.fyOpeningBalances?.[normalizeFyLabel(activeFy)] || {};
    let cash = Number(fyOpenings['__CASH__']?.amount || 0);
    if (fyOpenings['__CASH__']?.balanceType === 'Cr') cash = -cash;
    let bank = Number(fyOpenings['__BANK__']?.amount || 0);
    if (fyOpenings['__BANK__']?.balanceType === 'Cr') bank = -bank;

    let inc = 0;
    let exp = 0;
    transactions.forEach((t) => {
      const amt = Number(t.amount || 0);
      const isCash = t.paymentMode === 'Cash';
      if (t.txType === 'Income') {
        inc += amt;
        if (isCash) cash += amt;
        else bank += amt;
      } else {
        exp += amt;
        if (isCash) cash -= amt;
        else bank -= amt;
      }
    });
    return { totalIncome: inc, totalExpense: exp, cashBalance: cash, bankBalance: bank };
  }, [transactions, company.fyOpeningBalances, activeFy]);

  // Pre-indexed search index + descending date sort
  const indexedTransactions = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => (b.txDate || '').localeCompare(a.txDate || ''));
    return sorted.map((t) => ({
      item: t,
      searchHaystack: `${t.txCode || ''} ${t.partyName || ''} ${t.narration || ''} ${t.paymentMode || ''} ${t.txType || ''} ${t.branchCode || ''}`.toLowerCase(),
    }));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return indexedTransactions.map((x) => x.item);
    return indexedTransactions
      .filter((x) => x.searchHaystack.includes(q))
      .map((x) => x.item);
  }, [indexedTransactions, debouncedSearch]);

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(amount);
    if (!partyName.trim() || !Number.isFinite(numAmt) || numAmt <= 0) return;

    setSaving(true);
    try {
      const { formattedNo: txCode } = await reserveNextSerialNumber({
        type: 'tx',
        fy: activeFy,
        branchCode: activeBranchCode,
        staffCode: activeStaffCode,
        ownerUid,
      });

      const id = makeSafeDocId('tx');
      await upsertDocument(
        'transactions',
        id,
        {
          txCode,
          txDate,
          financialYear: normalizeFyLabel(activeFy),
          txType,
          ledgerAccount: ledgerAccount.slice(0, 100),
          partyName: partyName.trim().slice(0, 180),
          amount: numAmt,
          narration: narration.trim().slice(0, 300),
          paymentMode: paymentMode.slice(0, 60),
          referenceNo: referenceNo.trim().slice(0, 80),
          linkedCnNo: '',
          linkedInvoiceNo: '',
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        true
      );

      await logBranchActivity({
        action: `Recorded ${txType}`,
        module: 'Accounts',
        docRefCode: txCode,
        summary: `${txType} ₹${formatINR(numAmt)} · ${partyName.trim()} (${paymentMode})`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      setPartyName('');
      setAmount('');
      setNarration('');
      setReferenceNo('');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setTxType('Income');
    setLedgerAccount('Customer A/c');
    setPartyName('');
    setAmount('');
    setTxDate(todayISO());
    setNarration('');
    setPaymentMode('Bank Transfer');
    setReferenceNo('');
  };

  const handlePrintTransactions = async () => {
    const pdf = await generateTableReportPDF({
      title: 'Transaction Records Register',
      subtitle: `Printed on ${formatDateDDMMYYYY(todayISO())}`,
      headers: ['ID', 'Date', 'Type', 'Party Name', 'Amount (Rs)', 'Mode', 'Narration'],
      rows: filteredTransactions.slice(0, 1000).map((t) => [
        t.txCode,
        formatDateDDMMYYYY(t.txDate),
        t.txType,
        t.partyName,
        formatINR(t.amount),
        t.paymentMode,
        t.narration || '-',
      ]),
      company,
      fileName: `Transaction_Records_${todayISO()}.pdf`,
    });
    onPreviewPdf(pdf, 'Reports_Ledgers');
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await seedSampleDataset(ownerUid);
    } finally {
      setSeeding(false);
    }
  };

  const txColumns = useMemo<Array<TableColumn<TransactionRecord>>>(
    () => [
      {
        key: 'txCode',
        header: 'ID',
        cellClassName: 'font-mono-num font-semibold whitespace-nowrap',
        render: (tx) => tx.txCode,
      },
      {
        key: 'txDate',
        header: 'Date',
        cellClassName: 'font-mono-num whitespace-nowrap',
        render: (tx) => formatDateDDMMYYYY(tx.txDate),
      },
      {
        key: 'txType',
        header: 'Type',
        cellClassName: 'whitespace-nowrap font-medium',
        render: (tx, _i, isSelected) => (
          <span
            className={
              isSelected
                ? 'text-white'
                : tx.txType === 'Income'
                ? 'text-emerald-700'
                : 'text-orange-700'
            }
          >
            {tx.txType}
          </span>
        ),
      },
      {
        key: 'partyName',
        header: 'Party Name',
        cellClassName: 'font-medium',
        render: (tx) => (
          <div>
            <span>{tx.partyName}</span>
            {tx.branchCode && (
              <span className="ml-1.5 text-[10px] font-mono-num opacity-75">
                [{tx.branchCode}]
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'amount',
        header: 'Amount (₹)',
        align: 'right',
        cellClassName: 'font-mono-num font-semibold whitespace-nowrap',
        render: (tx) => formatINR(tx.amount),
      },
      {
        key: 'paymentMode',
        header: 'Mode',
        cellClassName: 'whitespace-nowrap',
        render: (tx) => tx.paymentMode,
      },
      {
        key: 'narration',
        header: 'Narration',
        cellClassName: 'truncate max-w-[200px]',
        render: (tx) => tx.narration || '-',
      },
      {
        key: 'action',
        header: 'Action',
        align: 'right',
        cellClassName: 'whitespace-nowrap',
        render: (tx, _i, isSelected) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowConfirm({
                title: `Delete Transaction ${tx.txCode}?`,
                description: `This will permanently remove ${tx.txCode} (${tx.partyName} · ₹${formatINR(tx.amount)}) from Firestore.`,
                confirmLabel: 'Delete',
                variant: 'danger',
                onConfirm: () => removeDocument('transactions', tx.id),
              });
            }}
            className={`p-1 rounded transition-colors ${
              isSelected
                ? 'hover:bg-white/20 text-white'
                : 'hover:bg-red-50 text-slate-500 hover:text-red-600'
            }`}
            title="Delete transaction"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ),
      },
    ],
    [onShowConfirm]
  );

  return (
    <div className="space-y-4">
      {/* 4 KPI Cards (Royal Blue, Emerald Green, Orange, Purple) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-blue-100">Total Shipments</p>
            <p className="text-2xl font-extrabold font-mono-num tracking-tight">
              {shipmentsCount}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-[#22C55E] to-[#15803D] text-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-emerald-100">
              {isMasterAdmin ? `FY Income (${activeFy})` : 'Cash Ledger Balance'}
            </p>
            <p className="text-2xl font-extrabold font-mono-num tracking-tight truncate">
              {isMasterAdmin
                ? `₹ ${formatINRCompact(totalIncome)}`
                : `₹ ${formatINRCompact(cashBalance)}`}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-[#FB923C] to-[#EA580C] text-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            {isMasterAdmin ? <Landmark className="w-6 h-6 text-white" /> : <Lock className="w-6 h-6 text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-orange-100">
              {isMasterAdmin ? 'PNB Bank / Expenses' : 'Bank & Company P&L'}
            </p>
            {isMasterAdmin ? (
              <>
                <p className="text-lg font-extrabold font-mono-num tracking-tight truncate">
                  Bank ₹ {formatINRCompact(bankBalance)}
                </p>
                <p className="text-[11px] font-mono-num text-orange-100 truncate">
                  Exp: ₹ {formatINRCompact(totalExpense)} · Cash: ₹ {formatINRCompact(cashBalance)}
                </p>
              </>
            ) : (
              <p className="text-sm font-bold text-white/95 mt-0.5">Locked (Admin Only)</p>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-[#9333EA] to-[#6D28D9] text-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            <Users className="w-7 h-7 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-purple-100">Total Customers</p>
            <p className="text-2xl font-extrabold font-mono-num tracking-tight">
              {customersCount}
            </p>
          </div>
        </div>
      </div>

      {/* Middle Split: New Transaction + Truck Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* New Transaction Card */}
        <form
          onSubmit={handleSaveTransaction}
          className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
        >
          <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold">
              <ArrowLeftRight className="w-4 h-4" />
              <span>New Transaction (Atomic ID · {activeBranchCode})</span>
            </div>
            {transactions.length === 0 && (
              <button
                type="button"
                disabled={seeding}
                onClick={handleSeedDemo}
                className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                {seeding ? 'Loading Sample Data...' : 'Load Sample DRC Data'}
              </button>
            )}
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3 text-xs">
            <div className="flex items-center gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0">Transaction Type :</label>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as 'Income' | 'Expense')}
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="Income">Income</option>
                <option value="Expense">Expense</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Narration :</label>
              <input
                type="text"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="Freight Charges for Kolkata"
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0">Ledger Account :</label>
              <select
                value={ledgerAccount}
                onChange={(e) => setLedgerAccount(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="Customer A/c">Customer A/c</option>
                <option value="Lorry Hire Payable A/c">Lorry Hire Payable A/c</option>
                <option value="Diesel & Fuel A/c">Diesel &amp; Fuel A/c</option>
                <option value="Highway Toll A/c">Highway Toll A/c</option>
                <option value="Loading / Unloading A/c">Loading / Unloading A/c</option>
                <option value="Office & Admin A/c">Office &amp; Admin A/c</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Payment Mode :</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
                <option value="Cash">Cash</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0">Party Name :</label>
              <input
                type="text"
                list="drc-party-suggestions"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="ABC Transport Ltd."
                required
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <datalist id="drc-party-suggestions">
                {parties.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Reference No :</label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="RT-2026-1111"
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0">Amount :</label>
              <input
                type="number"
                step="0.01"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
                required
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Date :</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                required
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 mt-auto">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-gradient-to-b from-[#1976D2] to-[#0D47A1] hover:from-[#1565C0] hover:to-[#0A367A] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5 text-amber-600" />
              <span>Clear</span>
            </button>
            <button
              type="button"
              onClick={handlePrintTransactions}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-700" />
              <span>Print</span>
            </button>
          </div>
        </form>

        {/* Right: Truck Banner ("On Time Delivery...") */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 shadow-sm overflow-hidden relative bg-gradient-to-br from-[#DBEAFE] via-[#EFF6FF] to-[#BFDBFE] flex flex-col justify-between min-h-[220px]">
          <svg
            viewBox="0 0 600 260"
            className="w-full h-full object-cover absolute inset-0"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#93C5FD" />
                <stop offset="65%" stopColor="#EFF6FF" />
                <stop offset="100%" stopColor="#CBD5E1" />
              </linearGradient>
              <linearGradient id="trailerGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#0D47A1" />
                <stop offset="100%" stopColor="#1D4ED8" />
              </linearGradient>
            </defs>
            <rect width="600" height="260" fill="url(#skyGrad)" />
            <path d="M0 170 Q150 140 320 165 T600 155 L600 205 L0 205 Z" fill="#86EFAC" opacity="0.55" />
            <path d="M0 182 L600 182 L600 260 L0 260 Z" fill="#475569" />
            <line x1="0" y1="218" x2="600" y2="218" stroke="#F8FAFC" strokeWidth="3" strokeDasharray="24 18" />
            <rect x="130" y="96" width="235" height="82" rx="4" fill="url(#trailerGrad)" />
            <text x="248" y="142" textAnchor="middle" fill="#FFFFFF" fontWeight="800" fontSize="20" fontFamily="sans-serif" letterSpacing="2">
              DOLPHIN ROAD
            </text>
            <path d="M368 112 L442 112 Q458 112 465 134 L472 178 L368 178 Z" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M382 122 L438 122 L450 146 L382 146 Z" fill="#1E293B" />
            <rect x="372" y="156" width="94" height="12" rx="2" fill="#1D4ED8" />
            <circle cx="176" cy="182" r="16" fill="#0F172A" />
            <circle cx="176" cy="182" r="7" fill="#CBD5E1" />
            <circle cx="218" cy="182" r="16" fill="#0F172A" />
            <circle cx="218" cy="182" r="7" fill="#CBD5E1" />
            <circle cx="330" cy="182" r="16" fill="#0F172A" />
            <circle cx="330" cy="182" r="7" fill="#CBD5E1" />
            <circle cx="432" cy="182" r="17" fill="#0F172A" />
            <circle cx="432" cy="182" r="7" fill="#CBD5E1" />
          </svg>

          <div className="relative z-10 p-4 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-900/80">
                Kolkata Fleet Corridor
              </p>
            </div>
            <p className="text-xl font-extrabold italic text-[#0D47A1] drop-shadow-sm">
              On Time Delivery...
            </p>
          </div>

          <div className="relative z-10 p-3 bg-slate-900/75 backdrop-blur-[2px] text-white flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-blue-100">
              Scan Physical LR or Build GST Invoice
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenTab('lr')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Scan LR
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('billing')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Tax Invoice
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Split: Paginated Transaction Records + Collapsible Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div
          className={`${
            quickActionsOpen ? 'lg:col-span-9' : 'lg:col-span-12'
          } bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`}
        >
          <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Search className="w-4 h-4" />
              <span>Transaction Records ({filteredTransactions.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-blue-100 font-medium">Search:</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Party, ID, mode..."
                className="px-2.5 py-1 rounded bg-white text-slate-900 text-xs w-44 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-3 py-1 rounded bg-white text-slate-800 hover:bg-blue-50 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                Show All
              </button>
              {!quickActionsOpen && (
                <button
                  type="button"
                  onClick={() => setQuickActionsOpen(true)}
                  className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  Show Quick Actions
                </button>
              )}
            </div>
          </div>

          <PaginatedDataTable
            data={filteredTransactions}
            columns={txColumns}
            getRowId={(tx) => tx.id}
            defaultPageSize={50}
            selectedRowId={selectedTxId}
            onRowClick={(tx) => setSelectedTxId(tx.id)}
            maxHeightClass="max-h-[340px]"
            stickyHeader
            emptyMessage="No transactions recorded yet. Use the New Transaction form above or load sample DRC data."
          />
        </div>

        {/* Collapsible Quick Actions Panel */}
        {quickActionsOpen && (
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setQuickActionsOpen(false)}
              className="w-full bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex items-center justify-between text-sm font-bold cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
                <span>Quick Actions</span>
              </span>
              <ChevronUp className="w-4 h-4" />
            </button>
            <div className="p-2.5 space-y-2 text-xs">
              <button
                type="button"
                onClick={() => onOpenTab('master')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <Users className="w-4 h-4 text-blue-700" />
                <span>Ledger Account &amp; Parties</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('reports')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <FileBarChart2 className="w-4 h-4 text-emerald-700" />
                <span>View Reports</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('backup')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <DatabaseBackup className="w-4 h-4 text-blue-700" />
                <span>Backup Database</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('backup')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <FolderSync className="w-4 h-4 text-emerald-700" />
                <span>Restore Database</span>
              </button>
              {isMasterAdmin && (
                <button
                  type="button"
                  onClick={() => onOpenTab('settings')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-800 font-semibold transition-colors cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-purple-700" />
                  <span>Settings &amp; Staff</span>
                </button>
              )}
            </div>
          </div>
        )}

        {!quickActionsOpen && (
          <div className="lg:col-span-12 flex justify-end">
            <button
              type="button"
              onClick={() => setQuickActionsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Expand Quick Actions
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const DashboardHome = React.memo(DashboardHomeInner);
