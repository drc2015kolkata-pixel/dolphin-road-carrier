import React, { useMemo, useState } from 'react';
import {
  BrainCircuit,
  Calculator,
  Lock,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import {
  CompanySettings,
  ConsignmentNote,
  DriveFolderName,
  Invoice,
  LorryHire,
  Party,
  TransactionRecord,
} from '../types/erp';
import { daysSinceDate, formatDateDDMMYYYY, formatINR, normalizeFyLabel, todayISO } from '../lib/formatters';
import { upsertDocument } from '../lib/firestoreStore';
import { GeneratedPdfResult, generateTableReportPDF } from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

interface ReportsMisModuleProps {
  ownerUid: string;
  activeFy: string;
  isMasterAdmin: boolean;
  invoices: Invoice[];
  lorryHires: LorryHire[];
  consignments: ConsignmentNote[];
  transactions: TransactionRecord[];
  parties: Party[];
  company: CompanySettings;
  initialSubTab?: ReportTab;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: DriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

export type ReportTab =
  | 'invoiceRegister'
  | 'purchaseRegister'
  | 'cnWise'
  | 'lorryWise'
  | 'aging'
  | 'accountBook'
  | 'finalResults'
  | 'aiAdvisor';

const ReportsMisModuleInner: React.FC<ReportsMisModuleProps> = ({
  activeFy,
  isMasterAdmin,
  invoices,
  lorryHires,
  consignments,
  transactions,
  parties,
  company,
  initialSubTab = 'invoiceRegister',
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [tab, setTab] = useState<ReportTab>(initialSubTab);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  // AI MIS Advisor
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);

  // CN-Wise Income/Expense
  const cnWiseRows = useMemo(() => {
    const hireByCn = new Map<string, LorryHire>();
    lorryHires.forEach((h) => hireByCn.set(h.cnNo, h));

    const expenseByCn = new Map<string, number>();
    transactions.forEach((t) => {
      if (t.txType === 'Expense' && t.linkedCnNo) {
        expenseByCn.set(t.linkedCnNo, (expenseByCn.get(t.linkedCnNo) || 0) + Number(t.amount || 0));
      }
    });

    return consignments.map((cn) => {
      const hire = hireByCn.get(cn.cnNo);
      const txExpenses = expenseByCn.get(cn.cnNo) || 0;
      const expense = Number(hire?.hireAmount || 0) + txExpenses;
      const income = Number(cn.totalFreight || 0);
      return {
        cnNo: cn.cnNo,
        cnDate: cn.cnDate,
        party: cn.consignorName,
        truckNo: cn.truckNo,
        route: `${cn.fromCity} → ${cn.toCity}`,
        income,
        expense,
        netMargin: income - expense,
        podStatus: hire ? (hire.podReceived ? 'POD Received' : 'POD Pending') : 'No Hire Entry',
      };
    });
  }, [consignments, lorryHires, transactions]);

  // Lorry-Wise Income/Expense
  const lorryWiseRows = useMemo(() => {
    const map = new Map<
      string,
      { truckNo: string; trips: number; freightIncome: number; hireExpense: number }
    >();
    consignments.forEach((cn) => {
      const k = cn.truckNo || 'UNKNOWN';
      const cur = map.get(k) || { truckNo: k, trips: 0, freightIncome: 0, hireExpense: 0 };
      cur.trips += 1;
      cur.freightIncome += Number(cn.totalFreight || 0);
      map.set(k, cur);
    });
    lorryHires.forEach((h) => {
      const k = h.truckNo || 'UNKNOWN';
      const cur = map.get(k) || { truckNo: k, trips: 0, freightIncome: 0, hireExpense: 0 };
      cur.hireExpense += Number(h.hireAmount || 0);
      map.set(k, cur);
    });
    return Array.from(map.values());
  }, [consignments, lorryHires]);

  // Party Payment Aging Report
  const agingRows = useMemo(() => {
    return invoices
      .filter((i) => i.status !== 'Paid')
      .map((i) => {
        const outstanding = Math.max(0, Number(i.grandTotal || 0) - Number(i.paidAmount || 0));
        const ageDays = daysSinceDate(i.invoiceDate);
        const bucket =
          ageDays <= 7
            ? '0–7 Days (Current)'
            : ageDays <= 30
            ? '8–30 Days'
            : ageDays <= 60
            ? '31–60 Days'
            : '60+ Days Critical';
        return {
          invoiceNo: i.invoiceNo,
          invoiceDate: i.invoiceDate,
          partyName: i.partyName,
          grandTotal: i.grandTotal,
          outstanding,
          ageDays,
          bucket,
        };
      })
      .sort((a, b) => b.ageDays - a.ageDays);
  }, [invoices]);

  // Account Book (Ledger Summary with Carried-Forward FY Opening Balances)
  const accountBookRows = useMemo(() => {
    const fyOpenings = company.fyOpeningBalances?.[normalizeFyLabel(activeFy)] || {};
    const map = new Map<string, { party: string; debit: number; credit: number }>();
    parties.forEach((p) => {
      const cf = fyOpenings[p.name] || fyOpenings[p.id];
      const ob = cf ? Number(cf.amount || 0) : Number(p.openingBalance || 0);
      const bType = cf ? cf.balanceType : p.balanceType;
      map.set(p.name, {
        party: p.name,
        debit: bType === 'Dr' ? ob : 0,
        credit: bType === 'Cr' ? ob : 0,
      });
    });
    invoices.forEach((inv) => {
      const cur = map.get(inv.partyName) || { party: inv.partyName, debit: 0, credit: 0 };
      cur.debit += Number(inv.grandTotal || 0);
      cur.credit += Number(inv.paidAmount || 0);
      map.set(inv.partyName, cur);
    });
    transactions.forEach((tx) => {
      const cur = map.get(tx.partyName) || { party: tx.partyName, debit: 0, credit: 0 };
      if (tx.txType === 'Income') cur.credit += Number(tx.amount || 0);
      else cur.debit += Number(tx.amount || 0);
      map.set(tx.partyName, cur);
    });
    return Array.from(map.values()).map((r) => ({
      ...r,
      netBalance: Math.abs(r.debit - r.credit),
      side: r.debit >= r.credit ? ('Dr' as const) : ('Cr' as const),
    }));
  }, [parties, invoices, transactions, company.fyOpeningBalances, activeFy]);

  // Debounced search filters per tab
  const q = debouncedSearch.trim().toLowerCase();

  const filteredInvoices = useMemo(
    () =>
      q
        ? invoices.filter((i) =>
            `${i.invoiceNo} ${i.partyName} ${i.status} ${i.branchCode || ''}`.toLowerCase().includes(q)
          )
        : invoices,
    [invoices, q]
  );

  const filteredHires = useMemo(
    () =>
      q
        ? lorryHires.filter((h) =>
            `${h.cnNo} ${h.truckNo} ${h.ownerName || ''} ${h.branchCode || ''}`
              .toLowerCase()
              .includes(q)
          )
        : lorryHires,
    [lorryHires, q]
  );

  const filteredCnWise = useMemo(
    () =>
      q
        ? cnWiseRows.filter((r) =>
            `${r.cnNo} ${r.party} ${r.truckNo} ${r.route}`.toLowerCase().includes(q)
          )
        : cnWiseRows,
    [cnWiseRows, q]
  );

  const filteredLorryWise = useMemo(
    () => (q ? lorryWiseRows.filter((l) => l.truckNo.toLowerCase().includes(q)) : lorryWiseRows),
    [lorryWiseRows, q]
  );

  const filteredAging = useMemo(
    () =>
      q
        ? agingRows.filter((a) =>
            `${a.invoiceNo} ${a.partyName} ${a.bucket}`.toLowerCase().includes(q)
          )
        : agingRows,
    [agingRows, q]
  );

  const filteredAccountBook = useMemo(
    () => (q ? accountBookRows.filter((r) => r.party.toLowerCase().includes(q)) : accountBookRows),
    [accountBookRows, q]
  );

  // Final Results (P&L + Balance Sheet)
  const financials = useMemo(() => {
    const billedFreight = invoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const cashIncome = transactions
      .filter((t) => t.txType === 'Income')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalRevenue = Math.max(billedFreight, cashIncome);

    const lorryHireCost = lorryHires.reduce((s, h) => s + Number(h.hireAmount || 0), 0);
    const directExpenses = transactions
      .filter((t) => t.txType === 'Expense')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalExpense = lorryHireCost + directExpenses;
    const netProfit = totalRevenue - totalExpense;

    const receivables = invoices.reduce(
      (s, i) => s + Math.max(0, Number(i.grandTotal || 0) - Number(i.paidAmount || 0)),
      0
    );
    const payables = lorryHires.reduce(
      (s, h) => s + (h.balancePaid ? 0 : Number(h.balancePayable || 0)),
      0
    );
    return { totalRevenue, lorryHireCost, directExpenses, totalExpense, netProfit, receivables, payables };
  }, [invoices, transactions, lorryHires]);

  const handleRecalculateBalances = async () => {
    let updated = 0;
    for (const p of parties) {
      const row = accountBookRows.find((r) => r.party === p.name);
      if (row) {
        await upsertDocument(
          'parties',
          p.id,
          {
            currentBalance: Number(row.netBalance.toFixed(2)),
            balanceType: row.side,
          },
          false
        );
        updated += 1;
      }
    }
    setStatusMsg(`Recalculated closing balances for ${updated} master parties.`);
  };

  const handleAutoTransferBalances = () => {
    onShowConfirm({
      title: 'Auto Transfer Closing Balances to Opening Balance?',
      description:
        'This carries forward every party’s current net closing balance into Opening Balance for the new Financial Year.',
      confirmLabel: 'Transfer Balances',
      onConfirm: async () => {
        for (const p of parties) {
          const row = accountBookRows.find((r) => r.party === p.name);
          const nextBal = row ? Number(row.netBalance.toFixed(2)) : p.currentBalance;
          const nextSide = row ? row.side : p.balanceType;
          await upsertDocument(
            'parties',
            p.id,
            {
              openingBalance: nextBal,
              currentBalance: nextBal,
              balanceType: nextSide,
            },
            false
          );
        }
        setStatusMsg('Year-end balances transferred cleanly to Opening Balances.');
      },
    });
  };

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiAnswer(null);
    try {
      const res = await fetch('/api/gemini/mis-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: aiQuery,
          summaryData: {
            financials,
            agingRows: agingRows.slice(0, 100),
            lorryWiseRows: lorryWiseRows.slice(0, 100),
            podLockedCount: lorryHires.filter((h) => !h.podReceived).length,
          },
        }),
      });
      const json = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to get MIS advice');
      setAiAnswer(json.answer || 'No response.');
    } catch (err) {
      setAiAnswer(err instanceof Error ? err.message : 'Error querying AI Advisor');
    } finally {
      setAiLoading(false);
    }
  };

  const exportCurrentReportPdf = async () => {
    if (tab === 'invoiceRegister') {
      const pdf = await generateTableReportPDF({
        title: 'Invoice Register',
        subtitle: `As of ${formatDateDDMMYYYY(todayISO())}`,
        headers: ['Invoice No', 'Date', 'Party Name', 'Freight', 'Total', 'Paid', 'Status'],
        rows: filteredInvoices.map((i) => [
          i.invoiceNo,
          formatDateDDMMYYYY(i.invoiceDate),
          i.partyName,
          formatINR(i.freightCharges),
          formatINR(i.grandTotal),
          formatINR(i.paidAmount),
          i.status,
        ]),
        company,
        fileName: `Invoice_Register_${todayISO()}.pdf`,
      });
      onPreviewPdf(pdf, 'Reports_Ledgers');
    } else if (tab === 'purchaseRegister') {
      const pdf = await generateTableReportPDF({
        title: 'Purchase / Lorry Hire Register',
        subtitle: `As of ${formatDateDDMMYYYY(todayISO())}`,
        headers: ['CN No', 'Truck No', 'Owner', 'Hire (Rs)', 'Advance', 'Balance', 'POD'],
        rows: filteredHires.map((h) => [
          h.cnNo,
          h.truckNo,
          h.ownerName || '-',
          formatINR(h.hireAmount),
          formatINR(h.advancePaid),
          formatINR(h.balancePayable),
          h.podReceived ? `Recd ${formatDateDDMMYYYY(h.podReceiveDate)}` : 'LOCKED',
        ]),
        company,
        fileName: `Lorry_Hire_Register_${todayISO()}.pdf`,
      });
      onPreviewPdf(pdf, 'Reports_Ledgers');
    } else if (tab === 'cnWise') {
      const pdf = await generateTableReportPDF({
        title: 'CN-Wise Income & Expense Report',
        subtitle: `As of ${formatDateDDMMYYYY(todayISO())}`,
        headers: ['CN No', 'Party', 'Truck', 'Route', 'Income', 'Expense', 'Net Margin'],
        rows: filteredCnWise.map((r) => [
          r.cnNo,
          r.party,
          r.truckNo,
          r.route,
          formatINR(r.income),
          formatINR(r.expense),
          formatINR(r.netMargin),
        ]),
        company,
        fileName: `CN_Wise_Profitability_${todayISO()}.pdf`,
      });
      onPreviewPdf(pdf, 'Reports_Ledgers');
    } else if (tab === 'aging') {
      const pdf = await generateTableReportPDF({
        title: 'Party Payment Aging Report',
        subtitle: `As of ${formatDateDDMMYYYY(todayISO())}`,
        headers: ['Invoice No', 'Date', 'Party', 'Total', 'Outstanding', 'Age (Days)', 'Bucket'],
        rows: filteredAging.map((a) => [
          a.invoiceNo,
          formatDateDDMMYYYY(a.invoiceDate),
          a.partyName,
          formatINR(a.grandTotal),
          formatINR(a.outstanding),
          String(a.ageDays),
          a.bucket,
        ]),
        company,
        fileName: `Party_Aging_Report_${todayISO()}.pdf`,
      });
      onPreviewPdf(pdf, 'Reports_Ledgers');
    } else {
      const pdf = await generateTableReportPDF({
        title: 'Account Book & Ledger Balances',
        subtitle: `As of ${formatDateDDMMYYYY(todayISO())}`,
        headers: ['Party / Account', 'Total Debit (Rs)', 'Total Credit (Rs)', 'Net Balance', 'Side'],
        rows: filteredAccountBook.map((r) => [
          r.party,
          formatINR(r.debit),
          formatINR(r.credit),
          formatINR(r.netBalance),
          r.side,
        ]),
        company,
        fileName: `Account_Book_${todayISO()}.pdf`,
      });
      onPreviewPdf(pdf, 'Reports_Ledgers');
    }
  };

  // Column definitions for the 6 PaginatedDataTables (50 rows/page)
  const invCols: TableColumn<Invoice>[] = useMemo(
    () => [
      { key: 'no', header: 'Invoice No', cellClassName: 'font-mono-num font-bold text-blue-800', render: (i) => i.invoiceNo },
      { key: 'date', header: 'Date', cellClassName: 'font-mono-num', render: (i) => formatDateDDMMYYYY(i.invoiceDate) },
      { key: 'party', header: 'Party Name', render: (i) => i.partyName },
      { key: 'freight', header: 'Freight (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (i) => formatINR(i.freightCharges) },
      {
        key: 'gst',
        header: 'GST (RCM/FCM)',
        headerClassName: 'text-right',
        cellClassName: 'text-right font-mono-num',
        render: (i) => `${formatINR(i.totalTax)} (${i.reverseCharge ? 'RCM' : 'FCM'})`,
      },
      { key: 'total', header: 'Grand Total (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num font-bold', render: (i) => formatINR(i.grandTotal) },
      { key: 'status', header: 'Status', cellClassName: 'font-semibold', render: (i) => i.status },
    ],
    []
  );

  const hireCols: TableColumn<LorryHire>[] = useMemo(
    () => [
      { key: 'cnNo', header: 'CN No', cellClassName: 'font-mono-num font-bold text-blue-800', render: (h) => h.cnNo },
      { key: 'truck', header: 'Truck No', cellClassName: 'font-mono-num', render: (h) => h.truckNo },
      { key: 'owner', header: 'Owner', render: (h) => h.ownerName || '-' },
      { key: 'hire', header: 'Hire (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (h) => formatINR(h.hireAmount) },
      { key: 'adv', header: 'Advance (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (h) => formatINR(h.advancePaid) },
      { key: 'bal', header: 'Balance (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num font-bold', render: (h) => formatINR(h.balancePayable) },
      { key: 'pod', header: 'POD Status', render: (h) => (h.podReceived ? 'Received' : 'Locked') },
    ],
    []
  );

  const cnWiseCols: TableColumn<(typeof cnWiseRows)[number]>[] = useMemo(
    () => [
      { key: 'cnNo', header: 'CN No', cellClassName: 'font-mono-num font-bold text-blue-800', render: (r) => r.cnNo },
      { key: 'party', header: 'Consignor', render: (r) => r.party },
      { key: 'truck', header: 'Truck', cellClassName: 'font-mono-num', render: (r) => r.truckNo },
      { key: 'route', header: 'Route', render: (r) => r.route },
      { key: 'inc', header: 'Freight Income (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num text-emerald-700 font-semibold', render: (r) => formatINR(r.income) },
      { key: 'exp', header: 'Hire + Expense (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num text-orange-700', render: (r) => formatINR(r.expense) },
      {
        key: 'net',
        header: 'Net Margin (₹)',
        headerClassName: 'text-right',
        cellClassName: 'text-right font-mono-num font-bold',
        render: (r) => (
          <span className={r.netMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}>
            {formatINR(r.netMargin)}
          </span>
        ),
      },
    ],
    []
  );

  const lorryWiseCols: TableColumn<(typeof lorryWiseRows)[number]>[] = useMemo(
    () => [
      { key: 'truck', header: 'Truck No', cellClassName: 'font-mono-num font-bold text-blue-800', render: (l) => l.truckNo },
      { key: 'trips', header: 'Trips', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (l) => l.trips },
      { key: 'rev', header: 'Freight Revenue (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num text-emerald-700', render: (l) => formatINR(l.freightIncome) },
      { key: 'cost', header: 'Lorry Hire Cost (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num text-orange-700', render: (l) => formatINR(l.hireExpense) },
      { key: 'net', header: 'Net Fleet Margin (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num font-bold', render: (l) => formatINR(l.freightIncome - l.hireExpense) },
    ],
    []
  );

  const agingCols: TableColumn<(typeof agingRows)[number]>[] = useMemo(
    () => [
      { key: 'no', header: 'Invoice No', cellClassName: 'font-mono-num font-bold text-blue-800', render: (a) => a.invoiceNo },
      { key: 'date', header: 'Bill Date', cellClassName: 'font-mono-num', render: (a) => formatDateDDMMYYYY(a.invoiceDate) },
      { key: 'party', header: 'Party Name', render: (a) => a.partyName },
      { key: 'out', header: 'Outstanding (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num font-bold text-red-700', render: (a) => formatINR(a.outstanding) },
      { key: 'age', header: 'Age (Days)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (a) => `${a.ageDays}d` },
      { key: 'bucket', header: 'Aging Bucket', cellClassName: 'font-semibold', render: (a) => a.bucket },
    ],
    []
  );

  const accountBookCols: TableColumn<(typeof accountBookRows)[number]>[] = useMemo(
    () => [
      { key: 'party', header: 'Account / Party Name', cellClassName: 'font-semibold', render: (r) => r.party },
      { key: 'dr', header: 'Total Debit (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (r) => formatINR(r.debit) },
      { key: 'cr', header: 'Total Credit (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (r) => formatINR(r.credit) },
      {
        key: 'bal',
        header: 'Closing Balance (₹)',
        headerClassName: 'text-right',
        cellClassName: 'text-right font-mono-num font-bold',
        render: (r) => `₹ ${formatINR(r.netBalance)} ${r.side}`,
      },
    ],
    []
  );

  const tabs: Array<{ id: ReportTab; label: string; adminOnly?: boolean }> = [
    { id: 'invoiceRegister', label: 'Invoice Register' },
    { id: 'purchaseRegister', label: 'Purchase / Lorry Hire' },
    { id: 'cnWise', label: 'CN-Wise P&L' },
    { id: 'lorryWise', label: 'Lorry-Wise P&L' },
    { id: 'aging', label: 'Payment Aging' },
    { id: 'accountBook', label: 'Account Book' },
    { id: 'finalResults', label: 'Final Results (P&L / BS)', adminOnly: true },
    { id: 'aiAdvisor', label: 'AI MIS Advisor', adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => isMasterAdmin || !t.adminOnly);

  const isTableTab =
    tab !== 'finalResults' && tab !== 'aiAdvisor';

  return (
    <div className="space-y-4">
      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                tab === t.id
                  ? 'bg-[#0D47A1] text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isTableTab && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter current register..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {tab !== 'aiAdvisor' && (
            <button
              type="button"
              onClick={exportCurrentReportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              PDF / Drive (Reports_Ledgers)
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          {statusMsg}
        </div>
      )}

      {tab === 'invoiceRegister' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <PaginatedDataTable
            data={filteredInvoices}
            columns={invCols}
            getRowId={(i) => i.id}
            defaultPageSize={50}
            emptyMessage="No invoices in register."
          />
        </div>
      )}

      {tab === 'purchaseRegister' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <PaginatedDataTable
            data={filteredHires}
            columns={hireCols}
            getRowId={(h) => h.id}
            defaultPageSize={50}
            emptyMessage="No lorry hire entries recorded."
          />
        </div>
      )}

      {tab === 'cnWise' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <PaginatedDataTable
            data={filteredCnWise}
            columns={cnWiseCols}
            getRowId={(r) => r.cnNo}
            defaultPageSize={50}
            emptyMessage="No CN-wise records found."
          />
        </div>
      )}

      {tab === 'lorryWise' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <PaginatedDataTable
            data={filteredLorryWise}
            columns={lorryWiseCols}
            getRowId={(l) => l.truckNo}
            defaultPageSize={50}
            emptyMessage="No truck-wise statistics yet."
          />
        </div>
      )}

      {tab === 'aging' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <PaginatedDataTable
            data={filteredAging}
            columns={agingCols}
            getRowId={(a) => a.invoiceNo}
            defaultPageSize={50}
            emptyMessage="No outstanding invoices."
          />
        </div>
      )}

      {tab === 'accountBook' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRecalculateBalances}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
            >
              <Calculator className="w-4 h-4" />
              Recalculate Party Balances
            </button>
            <button
              type="button"
              onClick={handleAutoTransferBalances}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Auto Transfer Balances (FY Carry Forward)
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredAccountBook}
              columns={accountBookCols}
              getRowId={(r) => r.party}
              defaultPageSize={50}
              emptyMessage="No ledger entries."
            />
          </div>
        </div>
      )}

      {/* Final Results (P&L / Balance Sheet) — Strictly Master Admin Only */}
      {tab === 'finalResults' && !isMasterAdmin && (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8 text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center justify-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            <span>Master Admin Restricted — Company Profit &amp; Loss</span>
          </h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            Company Profit &amp; Loss, Balance Sheet figures, and Bank Totals are strictly locked for Staff operators. Sign in as Master Admin to view confidential financial results.
          </p>
        </div>
      )}

      {tab === 'finalResults' && isMasterAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-[#0D47A1] text-white px-4 py-2.5 text-sm font-bold">
              Profit &amp; Loss Statement ({activeFy})
            </div>
            <div className="p-4 space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="font-medium text-slate-700">Gross Freight &amp; Billing Revenue</span>
                <span className="font-mono-num font-bold text-emerald-700">
                  ₹ {formatINR(financials.totalRevenue)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="font-medium text-slate-700">Lorry Hire Payable / Cost</span>
                <span className="font-mono-num text-orange-700">
                  ₹ {formatINR(financials.lorryHireCost)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="font-medium text-slate-700">Direct Fleet &amp; Operational Expenses</span>
                <span className="font-mono-num text-orange-700">
                  ₹ {formatINR(financials.directExpenses)}
                </span>
              </div>
              <div className="flex justify-between pt-2 text-sm font-extrabold">
                <span>Net Operating Profit</span>
                <span
                  className={`font-mono-num ${
                    financials.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  ₹ {formatINR(financials.netProfit)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2.5 text-sm font-bold">
              Balance Sheet Snapshot
            </div>
            <div className="p-4 space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="font-medium text-slate-700">Sundry Debtors (Unpaid Invoices)</span>
                <span className="font-mono-num font-bold text-blue-800">
                  ₹ {formatINR(financials.receivables)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="font-medium text-slate-700">Sundry Creditors (Locked/Pending Lorry Hire)</span>
                <span className="font-mono-num font-bold text-orange-700">
                  ₹ {formatINR(financials.payables)}
                </span>
              </div>
              <div className="flex justify-between pt-2 text-sm font-extrabold">
                <span>Net Working Position</span>
                <span className="font-mono-num text-slate-900">
                  ₹ {formatINR(financials.receivables - financials.payables + financials.netProfit)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI MIS Advisor (Gemini 4 Hydrogen High Thinking) */}
      {tab === 'aiAdvisor' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-[#0D47A1] to-[#6D28D9] text-white px-4 py-2.5 flex items-center gap-2 text-sm font-bold">
            <BrainCircuit className="w-4 h-4" />
            <span>AI MIS &amp; GST Compliance Advisor (High-Thinking Analysis)</span>
          </div>
          <form onSubmit={handleAskAI} className="p-4 space-y-3 text-xs">
            <p className="text-slate-600">
              Ask complex questions about overdue receivables, GST 5% RCM vs 12% FCM, Section 194C
              TDS compliance, or truck-wise profitability based on your live Firestore figures.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder="e.g. Which parties are overdue >7 days and what is our net margin after locked POD hires?"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="submit"
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                {aiLoading ? 'Analyzing...' : 'Analyze MIS'}
              </button>
            </div>
            {aiAnswer && (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 whitespace-pre-wrap leading-relaxed">
                {aiAnswer}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};

export const ReportsMisModule = React.memo(ReportsMisModuleInner);
