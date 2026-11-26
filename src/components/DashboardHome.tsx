import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  Camera,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  DatabaseBackup,
  Download,
  Edit3,
  Eraser,
  Eye,
  FileBarChart2,
  FileSpreadsheet,
  Landmark,
  Layers,
  Lock,
  Printer,
  Save,
  ScanLine,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  CompanySettings,
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
  SheetTabId,
  TransactionRecord,
  Vehicle,
} from '../types/erp';
import {
  formatDateDDMMYYYY,
  formatINR,
  makeSafeDocId,
  normalizeFyLabel,
  todayISO,
} from '../lib/formatters';
import {
  COMMON_EXPENSE_HEAD_OPTIONS,
  PAYMENT_MODE_OPTIONS,
  sortAlphaList,
} from '../lib/dropdownMasterStore';
import {
  logBranchActivity,
  removeDocument,
  reserveNextSerialNumber,
  seedSampleDataset,
  upsertDocument,
} from '../lib/firestoreStore';
import { buildAutomaticNarration, formatReferenceChain } from '../lib/paymentNarration';
import {
  downloadPdfDirect,
  generateTableReportPDF,
  GeneratedPdfResult,
  printPdfDirect,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import {
  EntityQuickPreviewCard,
  formatPartyDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import { SearchableSelect } from './SearchableSelect';
import { EditableSearchSelect } from './EditableSearchSelect';
import { ExpiryAlertBadge } from './ExpiryAlertBadge';

export interface DashboardLastSavedNos {
  cnNo: string;
  cnParty: string;
  billNo: string;
  billParty: string;
  quoteNo: string;
  quoteParty: string;
  declDate: string;
  declParty: string;
  podRef: string;
  podPartyTruck: string;
}

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
  invoices?: Invoice[];
  vehicles?: Vehicle[];
  drivers?: Driver[];
  consignments?: ConsignmentNote[];
  lorryHires?: LorryHire[];
  company: CompanySettings;
  lastSavedNos?: DashboardLastSavedNos;
  focusTransactionsNonce?: number;
  onOpenTab: (tab: SheetTabId) => void;
  onOpenPodScanner?: () => void;
  onOpenMasterVehicles?: () => void;
  onOpenMasterDrivers?: () => void;
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
  invoices = [],
  vehicles = [],
  drivers = [],
  consignments = [],
  lorryHires = [],
  company,
  lastSavedNos,
  focusTransactionsNonce = 0,
  onOpenTab,
  onOpenPodScanner,
  onOpenMasterVehicles,
  onOpenMasterDrivers,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [txType, setTxType] = useState<'Income' | 'Expense'>('Income');
  const [ledgerAccount, setLedgerAccount] = useState('Customer A/c');
  const [partyName, setPartyName] = useState('');
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [txDate, setTxDate] = useState(todayISO());
  const [narration, setNarration] = useState('');
  const [narrationManual, setNarrationManual] = useState(false);
  const [paymentMode, setPaymentMode] = useState('UPI');
  const [upiRefId, setUpiRefId] = useState('');
  const [utrNo, setUtrNo] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editingTxCode, setEditingTxCode] = useState<string>('');
  const [voucherMsg, setVoucherMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 200);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(true);
  const [txSectionOpen, setTxSectionOpen] = useState(false);
  const txSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focusTransactionsNonce > 0) {
      setTxSectionOpen(true);
      window.setTimeout(() => {
        txSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  }, [focusTransactionsNonce]);

  const partyUnpaidInvoices = useMemo(() => {
    const cleanParty = partyName.trim().toLowerCase();
    return invoices
      .filter((inv) => {
        const due = Math.round((Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0)) * 100) / 100;
        if (due <= 0.5) return false;
        if (!cleanParty) return true;
        return String(inv.partyName || '').trim().toLowerCase() === cleanParty;
      })
      .sort((a, b) => (b.invoiceDate || '').localeCompare(a.invoiceDate || ''));
  }, [invoices, partyName]);

  const selectedInvoicesList = useMemo(
    () => partyUnpaidInvoices.filter((inv) => selectedInvoiceIds.includes(inv.id)),
    [partyUnpaidInvoices, selectedInvoiceIds]
  );

  const toggleBillCheckbox = (inv: Invoice) => {
    const exists = selectedInvoiceIds.includes(inv.id);
    const nextIds = exists
      ? selectedInvoiceIds.filter((id) => id !== inv.id)
      : [...selectedInvoiceIds, inv.id];
    setSelectedInvoiceIds(nextIds);
    const nextBills = partyUnpaidInvoices.filter((i) => nextIds.includes(i.id));
    if (nextBills.length > 0) {
      const dueSum = nextBills.reduce(
        (s, i) => s + Math.max(0, Number(i.grandTotal || 0) - Number(i.paidAmount || 0)),
        0
      );
      setAmount(String(Math.round(dueSum * 100) / 100));
      if (!partyName.trim() && nextBills[0].partyName) {
        setPartyName(nextBills[0].partyName);
      }
    }
  };

  const ledgerHeadOptions = useMemo(
    () =>
      sortAlphaList(
        Array.from(
          new Set([
            'Customer A/c',
            'Lorry Hire Payable A/c',
            ...COMMON_EXPENSE_HEAD_OPTIONS,
            'Office & Admin A/c',
          ])
        )
      ),
    []
  );

  const autoGeneratedNarration = useMemo(
    () =>
      buildAutomaticNarration({
        txType,
        partyName: partyName || 'Account Party',
        amount: Number(amount || 0),
        ledgerAccount,
        paymentMode,
        upiRefId,
        utrNo,
        chequeNo,
        referenceNo,
        linkedInvoiceNo:
          selectedInvoicesList.length > 0
            ? selectedInvoicesList.map((i) => i.invoiceNo).join(', ')
            : undefined,
      }),
    [
      txType,
      partyName,
      amount,
      ledgerAccount,
      paymentMode,
      upiRefId,
      utrNo,
      chequeNo,
      referenceNo,
      selectedInvoicesList,
    ]
  );

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
    setVoucherMsg(null);
    try {
      const txCode =
        editingTxId && editingTxCode
          ? editingTxCode
          : (
              await reserveNextSerialNumber({
                type: 'tx',
                fy: activeFy,
                branchCode: activeBranchCode,
                staffCode: activeStaffCode,
                ownerUid,
              })
            ).formattedNo;

      const primaryRef = (upiRefId || utrNo || chequeNo || referenceNo).trim();
      const linkedNos = selectedInvoicesList.map((i) => i.invoiceNo);
      const finalNarration = (
        narrationManual && narration.trim() ? narration.trim() : autoGeneratedNarration
      ).slice(0, 300);

      const id = editingTxId || makeSafeDocId('tx');
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
          narration: finalNarration,
          paymentMode: paymentMode.slice(0, 60),
          referenceNo: primaryRef.slice(0, 80),
          upiRefId: upiRefId.trim().slice(0, 80),
          utrNo: utrNo.trim().slice(0, 80),
          chequeNo: chequeNo.trim().slice(0, 40),
          linkedCnNo: '',
          linkedInvoiceNo: linkedNos.join(', '),
          linkedInvoiceNos: linkedNos,
          branchCode: activeBranchCode,
          createdByStaff: activeStaffCode,
          ownerUid,
        },
        !editingTxId
      );

      // Multi-bill settlement: allocate voucher amount across all checked Tax Invoices
      if (txType === 'Income' && selectedInvoicesList.length > 0 && !editingTxId) {
        let remainingToApply = Math.round(numAmt * 100) / 100;
        for (const inv of selectedInvoicesList) {
          if (remainingToApply <= 0) break;
          const total = Number(inv.grandTotal || 0);
          const alreadyPaid = Number(inv.paidAmount || 0);
          const due = Math.max(0, Math.round((total - alreadyPaid) * 100) / 100);
          const applyHere = Math.min(due > 0 ? due : remainingToApply, remainingToApply);
          const nextPaid = Math.min(total, Math.round((alreadyPaid + applyHere) * 100) / 100);
          const nextStatus: Invoice['status'] = nextPaid >= total - 1 ? 'Paid' : 'Partial';
          await upsertDocument(
            'invoices',
            inv.id,
            {
              paidAmount: nextPaid,
              status: nextStatus,
            },
            false
          );
          remainingToApply = Math.max(0, Math.round((remainingToApply - applyHere) * 100) / 100);
        }
      }

      await logBranchActivity({
        action: editingTxId ? `Rectified ${txType}` : `Recorded ${txType}`,
        module: 'Accounts',
        docRefCode: txCode,
        summary: `${txType} ₹${formatINR(numAmt)} · ${partyName.trim()} (${paymentMode}${primaryRef ? ` · ${primaryRef}` : ''})${linkedNos.length ? ` · Bills: ${linkedNos.join(', ')}` : ''}`,
        staffCode: activeStaffCode,
        staffName: activeStaffName,
        branchCode: activeBranchCode,
        ownerUid,
      });

      setVoucherMsg(
        `${editingTxId ? 'Rectified' : 'Saved'} Voucher ${txCode} (₹${formatINR(numAmt)})${linkedNos.length ? ` · Settled Bills: ${linkedNos.join(', ')}` : ''}.`
      );
      setPartyName('');
      setSelectedPartyId('');
      setAmount('');
      setNarration('');
      setNarrationManual(false);
      setUpiRefId('');
      setUtrNo('');
      setChequeNo('');
      setReferenceNo('');
      setSelectedInvoiceIds([]);
      setEditingTxId(null);
      setEditingTxCode('');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setTxType('Income');
    setLedgerAccount('Customer A/c');
    setPartyName('');
    setSelectedPartyId('');
    setAmount('');
    setTxDate(todayISO());
    setNarration('');
    setNarrationManual(false);
    setPaymentMode('UPI');
    setUpiRefId('');
    setUtrNo('');
    setChequeNo('');
    setReferenceNo('');
    setSelectedInvoiceIds([]);
    setEditingTxId(null);
    setEditingTxCode('');
    setVoucherMsg(null);
  };

  const handleRectifyVoucher = () => {
    const target =
      (selectedTxId ? transactions.find((t) => t.id === selectedTxId) : undefined) ||
      filteredTransactions[0] ||
      transactions[0];
    if (!target) return;
    setEditingTxId(target.id);
    setEditingTxCode(target.txCode || '');
    setTxType(target.txType);
    setLedgerAccount(target.ledgerAccount || 'Customer A/c');
    setPartyName(target.partyName || '');
    setAmount(String(target.amount || ''));
    setTxDate(target.txDate || todayISO());
    setNarration(target.narration || '');
    setNarrationManual(Boolean(target.narration));
    setPaymentMode(target.paymentMode || 'UPI');
    setUpiRefId(target.upiRefId || '');
    setUtrNo(target.utrNo || '');
    setChequeNo(target.chequeNo || '');
    setReferenceNo(target.referenceNo || '');
    setSelectedInvoiceIds([]);
    setVoucherMsg(`Rectifying Voucher ${target.txCode} (${target.partyName}). Edit and click Save.`);
  };

  const buildTransactionsPdf = async () =>
    generateTableReportPDF({
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

  const handlePrintTransactions = async () => {
    const pdf = await buildTransactionsPdf();
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
        header: 'Mode / Ref',
        cellClassName: 'whitespace-nowrap',
        render: (tx) => {
          const refChain = formatReferenceChain({
            upiRefId: tx.upiRefId,
            utrNo: tx.utrNo,
            chequeNo: tx.chequeNo,
            referenceNo: tx.referenceNo,
          });
          return (
            <div>
              <span className="font-semibold">{tx.paymentMode}</span>
              {refChain && <div className="text-[10px] font-mono-num opacity-80">{refChain}</div>}
            </div>
          );
        },
      },
      {
        key: 'narration',
        header: 'Narration',
        cellClassName: 'truncate max-w-[240px]',
        render: (tx) =>
          tx.narration ||
          buildAutomaticNarration({
            txType: tx.txType,
            partyName: tx.partyName,
            amount: tx.amount,
            ledgerAccount: tx.ledgerAccount,
            paymentMode: tx.paymentMode,
            upiRefId: tx.upiRefId,
            utrNo: tx.utrNo,
            chequeNo: tx.chequeNo,
            referenceNo: tx.referenceNo,
            linkedInvoiceNo: tx.linkedInvoiceNo,
            linkedCnNo: tx.linkedCnNo,
          }),
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
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num tracking-tight truncate">
              {isMasterAdmin
                ? `₹ ${formatINR(totalIncome)}`
                : `₹ ${formatINR(cashBalance)}`}
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
                <p className="text-base sm:text-lg font-extrabold font-mono-num tracking-tight truncate">
                  Bank ₹ {formatINR(bankBalance)}
                </p>
                <p className="text-[11px] font-mono-num text-orange-100 truncate">
                  Exp: ₹ {formatINR(totalExpense)} · Cash: ₹ {formatINR(cashBalance)}
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

      {/* Clean Last Saved No Status Cards + Essential Primary Actions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0D47A1]" />
              Live Sequential Number Tracker &amp; Primary Actions ({activeFy})
            </h2>
            <p className="text-[11px] text-slate-500">
              Clean full-screen dashboard · Open [ ☰ Menu ] top-left anytime for all Operations, 6 Role Ledgers &amp; Masters.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExpiryAlertBadge
              vehicles={vehicles}
              drivers={drivers}
              consignments={consignments}
              lorryHires={lorryHires}
              compact
              onOpenMasterVehicles={onOpenMasterVehicles || (() => onOpenTab('master'))}
              onOpenMasterDrivers={onOpenMasterDrivers || (() => onOpenTab('master'))}
              onOpenLrScreen={() => onOpenTab('lr')}
            />
            <button
              type="button"
              onClick={() => setTxSectionOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                txSectionOpen
                  ? 'bg-[#0D47A1] text-white border-[#0D47A1]'
                  : 'bg-slate-50 hover:bg-blue-50 text-slate-800 border-slate-300'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>
                {txSectionOpen
                  ? `Hide Quick Voucher & Records (${filteredTransactions.length})`
                  : `Quick Voucher & Transaction Records (${filteredTransactions.length})`}
              </span>
              {txSectionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Last Saved No Status Cards */}
        {lastSavedNos && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
            <button
              type="button"
              onClick={() => onOpenTab('lr')}
              className="p-2.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 text-left cursor-pointer transition-colors"
            >
              <div className="text-[10px] font-bold text-blue-700 uppercase">Last CN / LR No</div>
              <div className="font-mono-num font-extrabold text-slate-900 text-sm truncate">
                {lastSavedNos.cnNo || '—'}
              </div>
              <div className="text-[11px] text-slate-600 truncate">{lastSavedNos.cnParty || 'No CN saved yet'}</div>
            </button>

            <button
              type="button"
              onClick={() => onOpenTab('billing')}
              className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-left cursor-pointer transition-colors"
            >
              <div className="text-[10px] font-bold text-emerald-700 uppercase">Last Bill / Tax Invoice</div>
              <div className="font-mono-num font-extrabold text-slate-900 text-sm truncate">
                {lastSavedNos.billNo || '—'}
              </div>
              <div className="text-[11px] text-slate-600 truncate">{lastSavedNos.billParty || 'No Bill saved yet'}</div>
            </button>

            <button
              type="button"
              onClick={() => onOpenTab('billing')}
              className="p-2.5 rounded-lg border border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 text-left cursor-pointer transition-colors"
            >
              <div className="text-[10px] font-bold text-amber-800 uppercase">Last Quotation No</div>
              <div className="font-mono-num font-extrabold text-slate-900 text-sm truncate">
                {lastSavedNos.quoteNo || '—'}
              </div>
              <div className="text-[11px] text-slate-600 truncate">{lastSavedNos.quoteParty || 'No Quote saved yet'}</div>
            </button>

            <button
              type="button"
              onClick={() => onOpenTab('billing')}
              className="p-2.5 rounded-lg border border-purple-200 bg-purple-50/70 hover:bg-purple-100/70 text-left cursor-pointer transition-colors"
            >
              <div className="text-[10px] font-bold text-purple-700 uppercase">Last 194C Declaration</div>
              <div className="font-mono-num font-extrabold text-slate-900 text-sm truncate">
                {lastSavedNos.declDate || '—'}
              </div>
              <div className="text-[11px] text-slate-600 truncate">{lastSavedNos.declParty || 'No 194C saved yet'}</div>
            </button>

            <button
              type="button"
              onClick={() => onOpenTab('podScanner')}
              className="p-2.5 rounded-lg border border-cyan-200 bg-cyan-50/70 hover:bg-cyan-100/70 text-left cursor-pointer transition-colors"
            >
              <div className="text-[10px] font-bold text-cyan-800 uppercase">Last POD / Voucher</div>
              <div className="font-mono-num font-extrabold text-slate-900 text-sm truncate">
                {lastSavedNos.podRef || '—'}
              </div>
              <div className="text-[11px] text-slate-600 truncate">{lastSavedNos.podPartyTruck || 'No POD/Voucher yet'}</div>
            </button>
          </div>
        )}

        {/* Essential Primary Actions Only (4 Clean Buttons) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs pt-1">
          <button
            type="button"
            onClick={() => onOpenTab('lr')}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-blue-300 bg-[#0D47A1] hover:bg-[#0A3882] text-white font-bold text-left transition-colors cursor-pointer"
          >
            <ClipboardList className="w-4 h-4 text-amber-300 shrink-0" />
            <span>New Consignment (LR/CN)</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenTab('billing')}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-emerald-300 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-left transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-amber-200 shrink-0" />
            <span>Tax Invoice &amp; Quote</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenTab('podScanner')}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-cyan-300 bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-left transition-colors cursor-pointer"
          >
            <Camera className="w-4 h-4 text-amber-200 shrink-0" />
            <span>POD &amp; Low-KB Scanner</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenTab('roleLedgers')}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-900 hover:bg-slate-800 text-white font-bold text-left transition-colors cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-amber-300 shrink-0" />
            <span>A–Z Role Tally Ledgers</span>
          </button>
        </div>
      </div>

      {/* Middle Split: Collapsible New Transaction + Truck Banner */}
      {txSectionOpen && (
      <div ref={txSectionRef} className="space-y-4 scroll-mt-20">
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
              <SearchableSelect
                ariaLabel="Transaction Type"
                value={txType}
                onChange={(val) => setTxType(val as 'Income' | 'Expense')}
                options={['Expense', 'Income']}
                className="flex-1 min-w-0"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Narration (Auto) :</label>
              <input
                type="text"
                value={narrationManual ? narration : autoGeneratedNarration}
                onChange={(e) => {
                  setNarrationManual(true);
                  setNarration(e.target.value);
                }}
                placeholder="100% Automatic Accounting Narration"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0">Expense / Account :</label>
              <EditableSearchSelect
                ariaLabel="Expense Head or Ledger Account"
                value={ledgerAccount}
                onChange={setLedgerAccount}
                options={ledgerHeadOptions}
                placeholder="Search Expense Head / Ledger A/c..."
                className="flex-1 min-w-0"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Payment Mode :</label>
              <SearchableSelect
                ariaLabel="Payment Mode"
                value={paymentMode}
                onChange={setPaymentMode}
                options={PAYMENT_MODE_OPTIONS}
                className="flex-1 min-w-0"
              />
            </div>

            <div className="flex items-start gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0 pt-1.5">Party Name :</label>
              <div className="flex-1 min-w-0">
                <RichEntityPicker<Party>
                  ariaLabel="Voucher Party Name"
                  value={partyName}
                  selectedId={selectedPartyId}
                  onChangeText={(nextText) => {
                    setPartyName(nextText);
                    const matches = parties.filter(
                      (p) => p.name.trim().toLowerCase() === nextText.trim().toLowerCase()
                    );
                    setSelectedPartyId(matches.length === 1 ? matches[0].id : '');
                  }}
                  onSelectEntity={(p) => {
                    setPartyName(p.name);
                    setSelectedPartyId(p.id);
                  }}
                  items={parties}
                  getId={(p) => p.id}
                  getValue={(p) => p.name}
                  getSearchText={(p) =>
                    `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.address || ''} ${p.phone || ''} ${p.partyType}`
                  }
                  renderTitle={(p) => p.name}
                  renderBadge={(p) => p.partyType}
                  renderDetails={(p) => formatPartyDetailsLine(p)}
                  placeholder="Search Party by Name, GSTIN, PAN, City or Mobile..."
                  required
                  quickPreview={(() => {
                    const clean = partyName.trim().toLowerCase();
                    if (!clean) return null;
                    const nameMatches = parties.filter(
                      (p) => p.name.trim().toLowerCase() === clean
                    );
                    const resolved =
                      (selectedPartyId ? parties.find((p) => p.id === selectedPartyId) : undefined) ||
                      (nameMatches.length === 1 ? nameMatches[0] : undefined) ||
                      nameMatches[0];
                    return (
                      <EntityQuickPreviewCard
                        kind="party"
                        party={resolved}
                        duplicateCount={nameMatches.length}
                        ambiguousSelected={nameMatches.length > 1 && !selectedPartyId}
                        compact
                      />
                    );
                  })()}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">UPI Ref ID :</label>
              <input
                type="text"
                value={upiRefId}
                onChange={(e) => setUpiRefId(e.target.value)}
                placeholder="e.g. 429811234567"
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-slate-700 font-medium shrink-0">UTR No. :</label>
              <input
                type="text"
                value={utrNo}
                onChange={(e) => setUtrNo(e.target.value.toUpperCase())}
                placeholder="e.g. PUNBH2611223344"
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-24 text-slate-700 font-medium shrink-0">Cheque No. :</label>
              <input
                type="text"
                value={chequeNo}
                onChange={(e) => setChequeNo(e.target.value)}
                placeholder="e.g. 004512"
                className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-600"
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

          {/* Multi-Bill Voucher Checkboxes (Unpaid / Partial Tax Invoices) */}
          {txType === 'Income' && partyUnpaidInvoices.length > 0 && (
            <div className="mx-4 mb-3 p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-extrabold text-blue-950">
                  Multi-Bill Settlement Checkboxes ({selectedInvoiceIds.length} Selected · {partyUnpaidInvoices.length} Pending)
                </span>
                {selectedInvoiceIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedInvoiceIds([])}
                    className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer"
                  >
                    Clear Bills
                  </button>
                )}
              </div>
              <div className="max-h-28 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {partyUnpaidInvoices.slice(0, 20).map((inv) => {
                  const checked = selectedInvoiceIds.includes(inv.id);
                  const due = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));
                  return (
                    <label
                      key={inv.id}
                      className={`flex items-center justify-between gap-2 px-2 py-1 rounded border cursor-pointer text-[11px] ${
                        checked
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBillCheckbox(inv)}
                        />
                        <span className="font-mono-num font-bold">{inv.invoiceNo}</span>
                        <span className="truncate text-[10px] opacity-75">{inv.partyName}</span>
                      </span>
                      <span className="font-mono-num font-bold text-rose-700 shrink-0">
                        Due ₹{formatINR(due)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {voucherMsg && (
            <div className="mx-4 mb-2 px-3 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-bold">
              {voucherMsg}
            </div>
          )}

          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-1.5 mt-auto">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-gradient-to-b from-[#1976D2] to-[#0D47A1] hover:from-[#1565C0] hover:to-[#0A367A] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : editingTxId ? 'Update Save' : 'Save'}</span>
            </button>
            <button
              type="button"
              onClick={handleRectifyVoucher}
              disabled={transactions.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Rectify</span>
            </button>
            <button
              type="button"
              onClick={() => void handlePrintTransactions()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-[#0D47A1] text-xs font-bold transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            {onOpenPodScanner && (
              <button
                type="button"
                onClick={onOpenPodScanner}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>Scan</span>
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildTransactionsPdf();
                downloadPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Low-KB PDF</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildTransactionsPdf();
                printPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-700" />
              <span>Manual Print</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildTransactionsPdf();
                const res = await sharePdfDirect({
                  pdf,
                  channel: 'whatsapp',
                  partyName: partyName || 'Accounts Register',
                  docNo: activeFy,
                  docLabel: 'Voucher Register',
                  company,
                });
                setVoucherMsg(res.message);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share</span>
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5 text-amber-600" />
              <span>Clear</span>
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

          <div className="relative z-10 p-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-blue-100">
              A. Bilty &amp; Lorry Sheet · B. Party Tax Invoice · D. GST &amp; KYC Vault
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenTab('allInOne')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-colors cursor-pointer whitespace-nowrap"
              >
                <ClipboardList className="w-3.5 h-3.5 text-slate-950" />
                A. Bilty &amp; Lorry Sheet
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('billing')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
                B. Party Tax Invoice
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('reports')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-white" />
                D. GST &amp; KYC Vault
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
            <div className="p-2.5 space-y-1.5 text-xs">
              <button
                type="button"
                onClick={() => onOpenTab('allInOne')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-slate-900 font-extrabold transition-colors cursor-pointer"
              >
                <ClipboardList className="w-4 h-4 text-amber-600 shrink-0" />
                <span>A. Bilty &amp; Lorry Master Sheet</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('billing')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-slate-900 font-bold transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                <span>B. Party Tax Invoice (Billing)</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('master')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>C. Masters &amp; Party Ledgers</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('reports')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <FileBarChart2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>D. GST Hub, ITR &amp; KYC Vault</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('bankImport')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-cyan-50 hover:border-cyan-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <Banknote className="w-4 h-4 text-cyan-700 shrink-0" />
                <span>Smart Bank Credit Reader</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('guide')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-purple-50 hover:border-purple-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-purple-600 shrink-0" />
                <span>Bilingual Operating Book</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenTab('backup')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-800 font-semibold transition-colors cursor-pointer"
              >
                <DatabaseBackup className="w-4 h-4 text-sky-600 shrink-0" />
                <span>Backup / Restore &amp; Clean</span>
              </button>
              {isMasterAdmin && (
                <button
                  type="button"
                  onClick={() => onOpenTab('settings')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-rose-50 hover:border-rose-300 text-slate-800 font-semibold transition-colors cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Admin Settings &amp; API Key</span>
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
      )}
    </div>
  );
};

export const DashboardHome = React.memo(DashboardHomeInner);
