import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Calculator,
  Download,
  Eye,
  FileSpreadsheet,
  Lock,
  Mail,
  MessageSquare,
  PhoneCall,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import {
  BankReceiptRecord,
  CompanySettings,
  ConsignmentNote,
  Driver,
  DriveFolderName,
  Invoice,
  LorryHire,
  Party,
  TransactionRecord,
} from '../types/erp';
import { daysSinceDate, formatDateDDMMYYYY, formatINR, normalizeFyLabel, todayISO } from '../lib/formatters';
import {
  buildAutomaticNarration,
  extractPaymentMetadata,
  formatReferenceChain,
} from '../lib/paymentNarration';
import { upsertDocument } from '../lib/firestoreStore';
import {
  downloadPdfDirect,
  GeneratedPdfResult,
  generateFoxproStatementPDF,
  generateGstRegisterPDF,
  generateTableReportPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { FoxproStatementSpec } from '../lib/pdfBuilders';
import {
  PRIORITY_CORRIDOR_REGIONS,
  buildEmailShareHref,
  buildOverdueBillMessage,
  buildPartyLoadFollowUpMessage,
  buildWhatsAppShareHref,
  getInvoicePendingDays,
  triggerExternalShareLink,
} from '../lib/shareUtils';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { GstFilingHubModule } from './GstFilingHubModule';

interface ReportsMisModuleProps {
  ownerUid: string;
  activeFy: string;
  isMasterAdmin: boolean;
  readOnly?: boolean;
  invoices: Invoice[];
  lorryHires: LorryHire[];
  consignments: ConsignmentNote[];
  transactions: TransactionRecord[];
  bankReceipts?: BankReceiptRecord[];
  parties: Party[];
  drivers?: Driver[];
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
  | 'gstRegister'
  | 'gstFilingHub'
  | 'foxproStatements'
  | 'invoiceRegister'
  | 'purchaseRegister'
  | 'cnWise'
  | 'lorryWise'
  | 'aging'
  | 'partyFollowUp'
  | 'accountBook'
  | 'finalResults'
  | 'aiAdvisor';

type FoxproStatementKind =
  | 'party'
  | 'driver'
  | 'broker'
  | 'owner'
  | 'dailyTrip'
  | 'logisticsBill';

const ReportsMisModuleInner: React.FC<ReportsMisModuleProps> = ({
  activeFy,
  isMasterAdmin,
  readOnly = false,
  invoices,
  lorryHires,
  consignments,
  transactions,
  bankReceipts = [],
  parties,
  drivers = [],
  company,
  initialSubTab = 'gstRegister',
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [tab, setTab] = useState<ReportTab>(initialSubTab);
  const [corridorFilter, setCorridorFilter] = useState<string>('ALL');
  const [statementKind, setStatementKind] = useState<FoxproStatementKind>('party');
  const [statementFilter, setStatementFilter] = useState('');
  const [tripDateFilter, setTripDateFilter] = useState('');
  const [selectedPartyLedger, setSelectedPartyLedger] = useState<string>('ALL');
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
      const isAutoLorryBalanceTx =
        t.ledgerAccount === 'Lorry Hire Payable A/c' &&
        (Boolean(t.linkedCnNo) || /^LH-/i.test(t.txCode || ''));
      if (t.txType === 'Expense' && t.linkedCnNo && !isAutoLorryBalanceTx) {
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
    const invoiceNoSet = new Set(invoices.map((i) => i.invoiceNo));
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
    lorryHires.forEach((h) => {
      const ownerKey = (h.ownerName || '').trim();
      if (!ownerKey) return;
      const cur = map.get(ownerKey) || { party: ownerKey, debit: 0, credit: 0 };
      cur.credit += Number(h.hireAmount || 0);
      cur.debit += Number(h.advancePaid || 0) + (h.balancePaid ? Number(h.balancePayable || 0) : 0);
      map.set(ownerKey, cur);
    });
    transactions.forEach((tx) => {
      const isLinkedInvReceipt =
        tx.txType === 'Income' && Boolean(tx.linkedInvoiceNo && invoiceNoSet.has(tx.linkedInvoiceNo));
      const isAutoLorryBalanceTx =
        tx.txType === 'Expense' &&
        tx.ledgerAccount === 'Lorry Hire Payable A/c' &&
        (Boolean(tx.linkedCnNo) || /^LH-/i.test(tx.txCode || ''));
      if (isLinkedInvReceipt || isAutoLorryBalanceTx) return;
      const cur = map.get(tx.partyName) || { party: tx.partyName, debit: 0, credit: 0 };
      if (tx.txType === 'Income') cur.credit += Number(tx.amount || 0);
      else cur.debit += Number(tx.amount || 0);
      map.set(tx.partyName, cur);
    });
    return Array.from(map.values()).map((r) => ({
      ...r,
      netBalance: Math.round(Math.abs(r.debit - r.credit) * 100) / 100,
      side: r.debit >= r.credit ? ('Dr' as const) : ('Cr' as const),
    }));
  }, [parties, invoices, lorryHires, transactions, company.fyOpeningBalances, activeFy]);

  // Debounced search filters per tab
  const q = debouncedSearch.trim().toLowerCase();

  const filteredInvoices = useMemo(
    () =>
      q
        ? invoices.filter((i) =>
            `${i.invoiceNo} ${i.partyName} ${i.partyGstin || ''} ${i.status} ${i.branchCode || ''}`
              .toLowerCase()
              .includes(q)
          )
        : invoices,
    [invoices, q]
  );

  // G-S-T R-E-G-I-S-T-E-R Totals
  const gstRegisterTotals = useMemo(() => {
    return filteredInvoices.reduce(
      (acc, inv) => {
        const freight = Number(inv.freightCharges || 0);
        const extras =
          Number(inv.detentionCharges || 0) +
          Number(inv.unloadingCharges || 0) +
          Number(inv.stCharges || 0);
        const taxable = freight + extras;
        acc.freight += freight;
        acc.taxable += taxable;
        acc.sgst += Number(inv.sgstAmt || 0);
        acc.cgst += Number(inv.cgstAmt || 0);
        acc.igst += Number(inv.igstAmt || 0);
        acc.totGst += Number(inv.totalTax || 0);
        acc.grandTotal += Number(inv.grandTotal || 0);
        return acc;
      },
      { freight: 0, taxable: 0, sgst: 0, cgst: 0, igst: 0, totGst: 0, grandTotal: 0 }
    );
  }, [filteredInvoices]);

  const filteredHires = useMemo(
    () =>
      q
        ? lorryHires.filter((h) =>
            `${h.cnNo} ${h.truckNo} ${h.ownerName || ''} ${h.brokerName || ''} ${h.branchCode || ''}`
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

  // Next-Gen Party Ledger Dropdown Options & Detailed Chronological Entries
  const partyLedgerOptions = useMemo(() => {
    const names = new Set<string>();
    parties.forEach((p) => p.name && names.add(p.name.trim()));
    invoices.forEach((i) => i.partyName && names.add(i.partyName.trim()));
    transactions.forEach((t) => t.partyName && names.add(t.partyName.trim()));
    lorryHires.forEach((h) => h.ownerName && names.add(h.ownerName.trim()));
    bankReceipts.forEach((b) => b.partyName && names.add(b.partyName.trim()));
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [parties, invoices, transactions, lorryHires, bankReceipts]);

  const partyLedgerSummary = useMemo(() => {
    const fyOpenings = company.fyOpeningBalances?.[normalizeFyLabel(activeFy)] || {};
    const target = selectedPartyLedger !== 'ALL' ? selectedPartyLedger.trim().toLowerCase() : null;
    const matchParty = (name?: string) => !target || (name || '').trim().toLowerCase() === target;

    const entries: Array<{
      id: string;
      date: string;
      voucherNo: string;
      partyName: string;
      type: 'Opening' | 'Bill' | 'Receipt' | 'LorryHire' | 'Voucher';
      paymentMode: string;
      upiRefId: string;
      utrNo: string;
      chequeNo: string;
      referenceChain: string;
      narration: string;
      debit: number;
      credit: number;
      tdsAmount: number;
      runningBalance: number;
      balanceSide: 'Dr' | 'Cr';
    }> = [];

    // 1. Opening balances
    if (target) {
      const p = parties.find((x) => x.name.trim().toLowerCase() === target);
      if (p) {
        const cf = fyOpenings[p.name] || fyOpenings[p.id];
        const ob = cf ? Number(cf.amount || 0) : Number(p.openingBalance || 0);
        const bType = cf ? cf.balanceType : p.balanceType;
        if (ob > 0) {
          entries.push({
            id: `ob_${p.id}`,
            date: '',
            voucherNo: 'OPENING',
            partyName: p.name,
            type: 'Opening',
            paymentMode: '-',
            upiRefId: '',
            utrNo: '',
            chequeNo: '',
            referenceChain: 'Carried Forward Opening Balance',
            narration: `Opening Balance b/f (${normalizeFyLabel(activeFy)}) for ${p.name}`,
            debit: bType === 'Dr' ? ob : 0,
            credit: bType === 'Cr' ? ob : 0,
            tdsAmount: 0,
            runningBalance: 0,
            balanceSide: bType,
          });
        }
      }
    }

    // Track applied bank receipts & invoice-linked transactions so receipts aren't double-counted
    const receiptByInv = new Map<string, BankReceiptRecord[]>();
    bankReceipts
      .filter((r) => r.appliedToInvoice && matchParty(r.partyName))
      .forEach((r) => {
        if (r.matchedInvoiceNo) {
          const list = receiptByInv.get(r.matchedInvoiceNo) || [];
          list.push(r);
          receiptByInv.set(r.matchedInvoiceNo, list);
        }
      });

    const txByInv = new Map<string, TransactionRecord[]>();
    transactions
      .filter((t) => t.txType === 'Income' && t.linkedInvoiceNo && matchParty(t.partyName))
      .forEach((t) => {
        const list = txByInv.get(t.linkedInvoiceNo!) || [];
        list.push(t);
        txByInv.set(t.linkedInvoiceNo!, list);
      });

    let totalBilled = 0;
    let totalReceived = 0;
    let totalTds = 0;

    // 2. Invoices (Debit) & Invoice Receipts (Credit)
    invoices
      .filter((inv) => matchParty(inv.partyName))
      .forEach((inv) => {
        const billAmt = Number(inv.grandTotal || 0);
        totalBilled += billAmt;
        const cns = (inv.consignmentRows || []).map((c) => c.cnNo).filter(Boolean).slice(0, 3).join(', ');
        entries.push({
          id: `inv_${inv.id}`,
          date: inv.invoiceDate,
          voucherNo: inv.invoiceNo,
          partyName: inv.partyName,
          type: 'Bill',
          paymentMode: 'Credit Bill',
          upiRefId: '',
          utrNo: '',
          chequeNo: '',
          referenceChain: inv.invoiceNo,
          narration: buildAutomaticNarration({
            txType: 'Bill',
            partyName: inv.partyName,
            amount: billAmt,
            linkedInvoiceNo: inv.invoiceNo,
            linkedCnNo: cns || undefined,
          }),
          debit: billAmt,
          credit: 0,
          tdsAmount: 0,
          runningBalance: 0,
          balanceSide: 'Dr',
        });

        const matchedTxs = txByInv.get(inv.invoiceNo) || [];
        const matchedBrs = receiptByInv.get(inv.invoiceNo) || [];
        let coveredCredit = 0;

        if (matchedTxs.length > 0) {
          matchedTxs.forEach((tx, idx) => {
            const br = matchedBrs[idx];
            const netAmt = Number(tx.amount || 0);
            const tdsAmt = Number(tx.tdsAmount ?? br?.tdsAmount ?? 0);
            const meta = extractPaymentMetadata({
              description: tx.narration || br?.narration || '',
              referenceNo: tx.utrNo || tx.upiRefId || tx.chequeNo || tx.referenceNo || br?.referenceNo || '',
              rawMode: tx.paymentMode || br?.paymentMode,
            });
            const mode = tx.paymentMode || br?.paymentMode || meta.paymentMode;
            const upiRefId = tx.upiRefId || br?.upiRefId || meta.upiRefId || '';
            const utrNo = tx.utrNo || br?.utrNo || meta.utrNo || '';
            const chequeNo = tx.chequeNo || br?.chequeNo || meta.chequeNo || '';
            const chain = formatReferenceChain({
              upiRefId,
              utrNo,
              chequeNo,
              referenceNo: tx.referenceNo || br?.referenceNo,
            });
            const invSettled = Math.min(Number(inv.paidAmount || 0) - coveredCredit, netAmt + tdsAmt);
            coveredCredit += netAmt + tdsAmt;
            totalReceived += netAmt;
            totalTds += tdsAmt;
            entries.push({
              id: `tx_${tx.id}`,
              date: tx.txDate,
              voucherNo: tx.txCode || inv.invoiceNo,
              partyName: tx.partyName,
              type: 'Receipt',
              paymentMode: mode,
              upiRefId,
              utrNo,
              chequeNo,
              referenceChain: chain,
              narration:
                tx.narration ||
                buildAutomaticNarration({
                  txType: 'Income',
                  partyName: tx.partyName,
                  amount: netAmt,
                  tdsAmount: tdsAmt,
                  paymentMode: mode,
                  upiRefId,
                  utrNo,
                  chequeNo,
                  linkedInvoiceNo: inv.invoiceNo,
                }),
              debit: 0,
              credit: invSettled > 0 ? invSettled : netAmt + tdsAmt,
              tdsAmount: tdsAmt,
              runningBalance: 0,
              balanceSide: 'Cr',
            });
          });
        } else if (matchedBrs.length > 0) {
          matchedBrs.forEach((br) => {
            const netAmt = Number(br.creditAmount || 0);
            const tdsAmt = Number(br.tdsAmount || 0);
            const meta = extractPaymentMetadata({
              description: br.narration || br.description,
              referenceNo: br.referenceNo,
              rawMode: br.paymentMode,
            });
            const mode = br.paymentMode || meta.paymentMode;
            const upiRefId = br.upiRefId || meta.upiRefId || '';
            const utrNo = br.utrNo || meta.utrNo || '';
            const chequeNo = br.chequeNo || meta.chequeNo || '';
            coveredCredit += netAmt + tdsAmt;
            totalReceived += netAmt;
            totalTds += tdsAmt;
            entries.push({
              id: `br_${br.id}`,
              date: br.receiptDate,
              voucherNo: utrNo || upiRefId || chequeNo || br.referenceNo || inv.invoiceNo,
              partyName: inv.partyName,
              type: 'Receipt',
              paymentMode: mode,
              upiRefId,
              utrNo,
              chequeNo,
              referenceChain: formatReferenceChain({
                upiRefId,
                utrNo,
                chequeNo,
                referenceNo: br.referenceNo,
              }),
              narration: buildAutomaticNarration({
                txType: 'Income',
                partyName: inv.partyName,
                amount: netAmt,
                tdsAmount: tdsAmt,
                paymentMode: mode,
                upiRefId,
                utrNo,
                chequeNo,
                linkedInvoiceNo: inv.invoiceNo,
              }),
              debit: 0,
              credit: netAmt + tdsAmt,
              tdsAmount: tdsAmt,
              runningBalance: 0,
              balanceSide: 'Cr',
            });
          });
        }

        const remainderPaid = Math.max(0, Number(inv.paidAmount || 0) - coveredCredit);
        if (remainderPaid > 0.01) {
          totalReceived += remainderPaid;
          entries.push({
            id: `inv_paid_${inv.id}`,
            date: inv.invoiceDate,
            voucherNo: inv.invoiceNo,
            partyName: inv.partyName,
            type: 'Receipt',
            paymentMode: 'Bank Transfer',
            upiRefId: '',
            utrNo: '',
            chequeNo: '',
            referenceChain: `Against ${inv.invoiceNo}`,
            narration: buildAutomaticNarration({
              txType: 'Income',
              partyName: inv.partyName,
              amount: remainderPaid,
              paymentMode: 'Bank Transfer',
              linkedInvoiceNo: inv.invoiceNo,
            }),
            debit: 0,
            credit: remainderPaid,
            tdsAmount: 0,
            runningBalance: 0,
            balanceSide: 'Cr',
          });
        }
      });

    // 3. Unlinked / standalone transactions
    const invoiceNoSet = new Set(invoices.map((i) => i.invoiceNo));
    transactions
      .filter((tx) => matchParty(tx.partyName))
      .forEach((tx) => {
        const isLinkedInvReceipt =
          tx.txType === 'Income' && Boolean(tx.linkedInvoiceNo && invoiceNoSet.has(tx.linkedInvoiceNo));
        const isAutoLorryBalanceTx =
          tx.txType === 'Expense' &&
          tx.ledgerAccount === 'Lorry Hire Payable A/c' &&
          (Boolean(tx.linkedCnNo) || /^LH-/i.test(tx.txCode || ''));
        if (isLinkedInvReceipt || isAutoLorryBalanceTx) return;

        const amt = Number(tx.amount || 0);
        const tdsAmt = Number(tx.tdsAmount || 0);
        const meta = extractPaymentMetadata({
          description: tx.narration || '',
          referenceNo: tx.utrNo || tx.upiRefId || tx.chequeNo || tx.referenceNo || '',
          rawMode: tx.paymentMode,
        });
        const mode = tx.paymentMode || meta.paymentMode;
        const upiRefId = tx.upiRefId || meta.upiRefId || '';
        const utrNo = tx.utrNo || meta.utrNo || '';
        const chequeNo = tx.chequeNo || meta.chequeNo || '';
        if (tx.txType === 'Income') {
          totalReceived += amt;
          totalTds += tdsAmt;
        }
        entries.push({
          id: `vch_${tx.id}`,
          date: tx.txDate,
          voucherNo: tx.txCode || '-',
          partyName: tx.partyName,
          type: 'Voucher',
          paymentMode: mode,
          upiRefId,
          utrNo,
          chequeNo,
          referenceChain: formatReferenceChain({
            upiRefId,
            utrNo,
            chequeNo,
            referenceNo: tx.referenceNo,
          }),
          narration:
            tx.narration ||
            buildAutomaticNarration({
              txType: tx.txType,
              partyName: tx.partyName,
              amount: amt,
              tdsAmount: tdsAmt,
              paymentMode: mode,
              upiRefId,
              utrNo,
              chequeNo,
              linkedInvoiceNo: tx.linkedInvoiceNo,
              linkedCnNo: tx.linkedCnNo,
              ledgerAccount: tx.ledgerAccount,
            }),
          debit: tx.txType === 'Expense' ? amt : 0,
          credit: tx.txType === 'Income' ? amt : 0,
          tdsAmount: tdsAmt,
          runningBalance: 0,
          balanceSide: tx.txType === 'Expense' ? 'Dr' : 'Cr',
        });
      });

    // 4. Lorry Hire entries (when viewing a Truck Owner or ALL)
    lorryHires
      .filter((h) => matchParty(h.ownerName))
      .forEach((h) => {
        if (!h.ownerName) return;
        const paidTotal = Number(h.advancePaid || 0) + (h.balancePaid ? Number(h.balancePayable || 0) : 0);
        entries.push({
          id: `lh_${h.id}`,
          date: h.cnDate || '',
          voucherNo: h.cnNo,
          partyName: h.ownerName,
          type: 'LorryHire',
          paymentMode: h.paymentMode || 'NEFT',
          upiRefId: '',
          utrNo: h.paymentRef || '',
          chequeNo: '',
          referenceChain: formatReferenceChain({
            utrNo: h.paymentRef,
            referenceNo: h.truckNo,
          }),
          narration: buildAutomaticNarration({
            txType: 'LorryHire',
            partyName: h.ownerName,
            amount: Number(h.hireAmount || 0),
            paymentMode: h.paymentMode || 'NEFT',
            utrNo: h.paymentRef,
            linkedCnNo: h.cnNo,
          }),
          debit: paidTotal,
          credit: Number(h.hireAmount || 0),
          tdsAmount: 0,
          runningBalance: 0,
          balanceSide: 'Cr',
        });
      });

    entries.sort((a, b) => {
      if (a.type === 'Opening' && b.type !== 'Opening') return -1;
      if (b.type === 'Opening' && a.type !== 'Opening') return 1;
      return (a.date || '').localeCompare(b.date || '');
    });

    let signedBal = 0;
    const withRunning = entries.map((e) => {
      signedBal += e.debit - e.credit;
      return {
        ...e,
        runningBalance: Math.round(Math.abs(signedBal) * 100) / 100,
        balanceSide: (signedBal >= 0 ? 'Dr' : 'Cr') as 'Dr' | 'Cr',
      };
    });

    // When ALL parties are viewed, mirror accountBookRows totals if party opening balances exist
    const bookAgg = accountBookRows.reduce(
      (acc, r) => ({
        dr: acc.dr + r.debit,
        cr: acc.cr + r.credit,
      }),
      { dr: 0, cr: 0 }
    );
    const finalNet = target
      ? Math.round(Math.abs(signedBal) * 100) / 100
      : Math.round(Math.abs(bookAgg.dr - bookAgg.cr) * 100) / 100;
    const finalSide: 'Dr' | 'Cr' = target
      ? signedBal >= 0
        ? 'Dr'
        : 'Cr'
      : bookAgg.dr >= bookAgg.cr
      ? 'Dr'
      : 'Cr';

    return {
      entries: withRunning,
      totalBilled: Math.round(totalBilled * 100) / 100,
      totalReceived: Math.round(totalReceived * 100) / 100,
      totalTds: Math.round(totalTds * 100) / 100,
      netBalance: finalNet,
      netSide: finalSide,
    };
  }, [
    selectedPartyLedger,
    parties,
    invoices,
    transactions,
    bankReceipts,
    lorryHires,
    company.fyOpeningBalances,
    activeFy,
    accountBookRows,
  ]);

  // Build FoxPro Statement Specification dynamically for the 6 Statements
  const activeStatementSpec = useMemo<FoxproStatementSpec>(() => {
    const f = (statementFilter || search).trim().toLowerCase();

    if (statementKind === 'party') {
      const list = invoices.filter((inv) =>
        f ? `${inv.partyName} ${inv.invoiceNo} ${inv.partyGstin || ''}`.toLowerCase().includes(f) : true
      );
      const totBill = list.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
      const totPaid = list.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
      const totTds = bankReceipts
        .filter((r) =>
          f ? `${r.partyName || ''} ${r.matchedInvoiceNo || ''}`.toLowerCase().includes(f) : true
        )
        .reduce((s, r) => s + Number(r.tdsAmount || 0), 0);
      const totBal = Math.max(0, totBill - totPaid);
      return {
        title: 'P-A-R-T-Y   S-T-A-T-E-M-E-N-T   /   B-I-L-L   L-E-D-G-E-R',
        subtitle: `FY: ${activeFy} · Filter: ${statementFilter || 'All Parties'} · Bills: ${list.length}`,
        fileName: `Party_Statement_${todayISO()}.pdf`,
        orientation: 'l',
        summaryLines: [
          { label: 'Total Billed', value: `Rs. ${formatINR(totBill)}` },
          { label: 'Total Received', value: `Rs. ${formatINR(Math.max(0, totPaid - totTds))}` },
          { label: 'Total TDS Deducted', value: `Rs. ${formatINR(totTds)}` },
          { label: 'Net Balance Due', value: `Rs. ${formatINR(totBal)}` },
        ],
        columns: [
          { label: 'S.NO', widthPct: 6, align: 'center' },
          { label: 'BILL NO / DATE', widthPct: 16, align: 'left' },
          { label: 'PARTY NAME / AUTO NARRATION & REF', widthPct: 34, align: 'left' },
          { label: 'BILL AMOUNT', widthPct: 15, align: 'right' },
          { label: 'PAID + TDS', widthPct: 15, align: 'right' },
          { label: 'BALANCE DUE', widthPct: 14, align: 'right' },
        ],
        rows: list.map((inv, idx) => {
          const bal = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));
          const linkedTx = transactions.find((t) => t.linkedInvoiceNo === inv.invoiceNo);
          const linkedBr = bankReceipts.find((b) => b.matchedInvoiceNo === inv.invoiceNo);
          const refChain = linkedTx || linkedBr
            ? formatReferenceChain({
                upiRefId: linkedTx?.upiRefId || linkedBr?.upiRefId,
                utrNo: linkedTx?.utrNo || linkedBr?.utrNo,
                chequeNo: linkedTx?.chequeNo || linkedBr?.chequeNo,
                referenceNo: linkedTx?.referenceNo || linkedBr?.referenceNo,
              })
            : inv.partyGstin || (inv.billingCountry || 'India');
          return {
            line1: [
              String(idx + 1),
              inv.invoiceNo,
              inv.partyName,
              formatINR(inv.grandTotal),
              formatINR(inv.paidAmount),
              formatINR(bal),
            ],
            line2: [
              '',
              formatDateDDMMYYYY(inv.invoiceDate),
              refChain,
              `Tax: ${formatINR(inv.totalTax || 0)}`,
              linkedBr?.tdsAmount ? `TDS: ${formatINR(linkedBr.tdsAmount)} · ${inv.status}` : inv.status,
              inv.dueDate ? `Due ${formatDateDDMMYYYY(inv.dueDate)}` : '-',
            ],
          };
        }),
        totalsLabel: 'TOTAL IN RUPEES :',
        totalsLine1: ['', '', '', formatINR(totBill), formatINR(totPaid), formatINR(totBal)],
        totalAmountForWords: totBal > 0 ? totBal : totBill,
      };
    }

    if (statementKind === 'driver') {
      const driverTrips = consignments.filter((cn) =>
        f
          ? `${cn.driverName || ''} ${cn.driverDlNo || ''} ${cn.truckNo} ${cn.cnNo}`.toLowerCase().includes(f)
          : Boolean(cn.driverName || cn.driverDlNo)
      );
      const totFrt = driverTrips.reduce((s, c) => s + Number(c.totalFreight || 0), 0);
      const drvFallback = drivers.filter((d) =>
        f ? `${d.name} ${d.dlNo} ${d.phone || ''}`.toLowerCase().includes(f) : true
      );
      const useDriverTrips = driverTrips.length > 0;
      return {
        title: 'D-R-I-V-E-R   S-T-A-T-E-M-E-N-T   &   T-R-I-P   S-U-M-M-A-R-Y',
        subtitle: `FY: ${activeFy} · Driver: ${statementFilter || 'All Drivers'}`,
        fileName: `Driver_Statement_${todayISO()}.pdf`,
        orientation: 'l',
        columns: useDriverTrips
          ? [
              { label: 'S.NO', widthPct: 6, align: 'center' },
              { label: 'C/N NO / DATE', widthPct: 16, align: 'left' },
              { label: 'DRIVER NAME / D/L NO', widthPct: 26, align: 'left' },
              { label: 'TRUCK / ROUTE', widthPct: 30, align: 'left' },
              { label: 'WT (MT) / PKGS', widthPct: 11, align: 'right' },
              { label: 'FREIGHT (INR)', widthPct: 11, align: 'right' },
            ]
          : [
              { label: 'S.NO', widthPct: 7, align: 'center' },
              { label: 'DRIVER NAME / PHONE', widthPct: 28, align: 'left' },
              { label: 'D/L NO / EXPIRY', widthPct: 24, align: 'left' },
              { label: 'AADHAAR / PAN', widthPct: 20, align: 'left' },
              { label: 'BANK ACCOUNT / IFSC', widthPct: 21, align: 'left' },
            ],
        rows: useDriverTrips
          ? driverTrips.map((cn, idx) => ({
              line1: [
                String(idx + 1),
                cn.cnNo,
                cn.driverName || '-',
                cn.truckNo,
                `${Number(cn.nettWeight || 0).toFixed(2)} MT`,
                formatINR(cn.totalFreight),
              ],
              line2: [
                '',
                formatDateDDMMYYYY(cn.cnDate),
                `D/L: ${cn.driverDlNo || '-'}`,
                `${cn.fromCity} -> ${cn.toCity}`,
                cn.packages || '-',
                cn.ownerName || '',
              ],
            }))
          : drvFallback.map((d, idx) => ({
              line1: [
                String(idx + 1),
                d.name,
                d.dlNo,
                `UID: ${d.aadhaarNo || '-'}`,
                `${d.bankName || '-'} · ${d.bankAccountNo || '-'}`,
              ],
              line2: [
                '',
                d.phone || '-',
                `Exp: ${formatDateDDMMYYYY(d.dlExpiry)}`,
                `PAN: ${d.panNo || '-'}`,
                d.bankIfsc || '-',
              ],
            })),
        ...(useDriverTrips
          ? {
              totalsLabel: 'TOTAL IN RUPEES :',
              totalsLine1: ['', '', '', '', '', formatINR(totFrt)],
              totalAmountForWords: totFrt,
            }
          : {}),
      };
    }

    if (statementKind === 'broker') {
      const list = lorryHires.filter((h) => {
        const hasBroker = Boolean(h.brokerName) || (h.advances || []).some((a) => a.payeeType === 'Broker');
        if (!f) return hasBroker || lorryHires.length > 0;
        return `${h.brokerName || ''} ${h.cnNo} ${h.truckNo}`.toLowerCase().includes(f);
      });
      const sumHire = list.reduce((s, h) => s + Number(h.hireAmount || 0), 0);
      const sumAdv = list.reduce((s, h) => s + Number(h.advancePaid || 0), 0);
      const sumBal = list.reduce((s, h) => s + Number(h.balancePayable || 0), 0);
      return {
        title: 'B-R-O-K-E-R   S-T-A-T-E-M-E-N-T   &   H-I-R-E   L-E-D-G-E-R',
        subtitle: `FY: ${activeFy} · Broker: ${statementFilter || 'All Brokers'} · Trips: ${list.length}`,
        fileName: `Broker_Statement_${todayISO()}.pdf`,
        orientation: 'l',
        columns: [
          { label: 'S.NO', widthPct: 6, align: 'center' },
          { label: 'CN NO / DATE', widthPct: 15, align: 'left' },
          { label: 'BROKER / TRUCK NO', widthPct: 27, align: 'left' },
          { label: 'GROSS HIRE', widthPct: 14, align: 'right' },
          { label: 'ADVANCE + DED.', widthPct: 19, align: 'right' },
          { label: 'NET PAYABLE', widthPct: 19, align: 'right' },
        ],
        rows: list.map((h, idx) => {
          const tripDed =
            Number(h.loadingCharge || 0) +
            Number(h.unloadingCharge || 0) +
            Number(h.parkingCharge || 0) +
            Number(h.kataCharge || 0) +
            Number(h.shortageCharge || 0) +
            Number(h.damageCharge || 0);
          return {
            line1: [
              String(idx + 1),
              h.cnNo,
              h.brokerName || h.ownerName || '-',
              formatINR(h.hireAmount),
              formatINR(Number(h.advancePaid || 0) + tripDed),
              formatINR(h.balancePayable),
            ],
            line2: [
              '',
              formatDateDDMMYYYY(h.cnDate),
              `${h.truckNo} · ${h.fromCity || ''} -> ${h.toCity || ''}`,
              h.bookedPkgs ? `${h.bookedPkgs} Pkgs` : '-',
              `Adv:${formatINR(h.advancePaid)} | Ded:${formatINR(tripDed)}`,
              h.balancePaid ? 'PAID' : h.podReceived ? 'POD UNLOCKED' : 'POD LOCKED',
            ],
          };
        }),
        totalsLabel: 'TOTAL IN RUPEES :',
        totalsLine1: ['', '', '', formatINR(sumHire), formatINR(sumAdv), formatINR(sumBal)],
        totalAmountForWords: sumBal,
      };
    }

    if (statementKind === 'owner') {
      const list = lorryHires.filter((h) =>
        f ? `${h.ownerName || ''} ${h.truckNo} ${h.cnNo}`.toLowerCase().includes(f) : true
      );
      const sumHire = list.reduce((s, h) => s + Number(h.hireAmount || 0), 0);
      const sumAdv = list.reduce((s, h) => s + Number(h.advancePaid || 0), 0);
      const sumDed = list.reduce(
        (s, h) =>
          s +
          Number(h.loadingCharge || 0) +
          Number(h.unloadingCharge || 0) +
          Number(h.parkingCharge || 0) +
          Number(h.kataCharge || 0) +
          Number(h.shortageCharge || 0) +
          Number(h.damageCharge || 0),
        0
      );
      const sumBal = list.reduce((s, h) => s + Number(h.balancePayable || 0), 0);
      return {
        title: 'L-O-R-R-Y   O-W-N-E-R   S-T-A-T-E-M-E-N-T',
        subtitle: `FY: ${activeFy} · Owner: ${statementFilter || 'All Owners'} · Trips: ${list.length}`,
        fileName: `Owner_Statement_${todayISO()}.pdf`,
        orientation: 'l',
        columns: [
          { label: 'S.NO', widthPct: 6, align: 'center' },
          { label: 'CN NO / DATE', widthPct: 14, align: 'left' },
          { label: 'OWNER NAME / TRUCK', widthPct: 26, align: 'left' },
          { label: 'GROSS HIRE', widthPct: 13, align: 'right' },
          { label: 'ADVANCES PAID', widthPct: 13, align: 'right' },
          { label: 'TRIP DEDUCTIONS', widthPct: 14, align: 'right' },
          { label: 'NET PAYABLE', widthPct: 14, align: 'right' },
        ],
        rows: list.map((h, idx) => {
          const tripDed =
            Number(h.loadingCharge || 0) +
            Number(h.unloadingCharge || 0) +
            Number(h.parkingCharge || 0) +
            Number(h.kataCharge || 0) +
            Number(h.shortageCharge || 0) +
            Number(h.damageCharge || 0);
          return {
            line1: [
              String(idx + 1),
              h.cnNo,
              h.ownerName || '-',
              formatINR(h.hireAmount),
              formatINR(h.advancePaid),
              formatINR(tripDed),
              formatINR(h.balancePayable),
            ],
            line2: [
              '',
              formatDateDDMMYYYY(h.cnDate),
              `${h.truckNo} · ${h.fromCity || ''} -> ${h.toCity || ''}`,
              h.bookedPkgs ? `Bkd:${h.bookedPkgs} Del:${h.deliveredPkgs ?? h.bookedPkgs}` : '-',
              `${(h.advances || []).length || 1} Adv`,
              `Short/Dmg:${formatINR(Number(h.shortageCharge || 0) + Number(h.damageCharge || 0))}`,
              h.balancePaid ? 'PAID' : 'PENDING',
            ],
          };
        }),
        totalsLabel: 'TOTAL IN RUPEES :',
        totalsLine1: [
          '',
          '',
          '',
          formatINR(sumHire),
          formatINR(sumAdv),
          formatINR(sumDed),
          formatINR(sumBal),
        ],
        totalAmountForWords: sumBal,
      };
    }

    if (statementKind === 'dailyTrip') {
      const list = consignments.filter((cn) => {
        if (tripDateFilter && cn.cnDate !== tripDateFilter) return false;
        if (!f) return true;
        return `${cn.cnNo} ${cn.truckNo} ${cn.consignorName} ${cn.toCity}`.toLowerCase().includes(f);
      });
      const hireByCn = new Map<string, LorryHire>();
      lorryHires.forEach((h) => hireByCn.set(h.cnNo, h));
      const sumFreight = list.reduce((s, c) => s + Number(c.totalFreight || 0), 0);
      const sumHire = list.reduce((s, c) => s + Number(hireByCn.get(c.cnNo)?.hireAmount || 0), 0);
      return {
        title: 'D-A-I-L-Y   T-R-I-P   R-E-P-O-R-T',
        subtitle: `FY: ${activeFy} · Date: ${tripDateFilter ? formatDateDDMMYYYY(tripDateFilter) : 'All Dates'} · Trips: ${list.length}`,
        fileName: `Daily_Trip_Report_${tripDateFilter || todayISO()}.pdf`,
        orientation: 'l',
        columns: [
          { label: 'S.NO', widthPct: 6, align: 'center' },
          { label: 'CN NO / DATE', widthPct: 15, align: 'left' },
          { label: 'TRUCK / ROUTE', widthPct: 24, align: 'left' },
          { label: 'CONSIGNOR / CONSIGNEE', widthPct: 25, align: 'left' },
          { label: 'WT / PKGS', widthPct: 10, align: 'right' },
          { label: 'FREIGHT (INR)', widthPct: 10, align: 'right' },
          { label: 'LORRY HIRE', widthPct: 10, align: 'right' },
        ],
        rows: list.map((cn, idx) => {
          const hire = hireByCn.get(cn.cnNo);
          return {
            line1: [
              String(idx + 1),
              cn.cnNo,
              cn.truckNo,
              cn.consignorName,
              `${Number(cn.nettWeight || 0).toFixed(2)} MT`,
              formatINR(cn.totalFreight),
              formatINR(hire?.hireAmount || 0),
            ],
            line2: [
              '',
              formatDateDDMMYYYY(cn.cnDate),
              `${cn.fromCity} -> ${cn.toCity}`,
              `To: ${cn.consigneeName}`,
              cn.packages || '-',
              cn.billed ? 'BILLED' : 'UNBILLED',
              hire ? (hire.podReceived ? 'POD OK' : 'POD LOCK') : '-',
            ],
          };
        }),
        totalsLabel: 'TOTAL IN RUPEES :',
        totalsLine1: ['', '', '', '', '', formatINR(sumFreight), formatINR(sumHire)],
        totalAmountForWords: sumFreight,
      };
    }

    // logisticsBill
    const list = invoices.filter((inv) =>
      f ? `${inv.invoiceNo} ${inv.partyName} ${inv.partyGstin || ''}`.toLowerCase().includes(f) : true
    );
    const sumFreight = list.reduce((s, i) => s + Number(i.freightCharges || 0), 0);
    const sumTax = list.reduce((s, i) => s + Number(i.totalTax || 0), 0);
    const sumTotal = list.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const sumPaid = list.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
    return {
      title: 'L-O-G-I-S-T-I-C-S   B-I-L-L   R-E-G-I-S-T-E-R',
      subtitle: `FY: ${activeFy} · Total Bills: ${list.length}`,
      fileName: `Logistics_Bill_Register_${todayISO()}.pdf`,
      orientation: 'l',
      columns: [
        { label: 'S.NO', widthPct: 5, align: 'center' },
        { label: 'BILL NO / DATE', widthPct: 14, align: 'left' },
        { label: 'PARTY NAME / COUNTRY', widthPct: 27, align: 'left' },
        { label: 'CNs / VEHICLES', widthPct: 14, align: 'left' },
        { label: 'FREIGHT + EXT', widthPct: 13, align: 'right' },
        { label: 'GST & PAID BY', widthPct: 13, align: 'right' },
        { label: 'TOTAL / PAID', widthPct: 14, align: 'right' },
      ],
      rows: list.map((inv, idx) => {
        const extras =
          Number(inv.detentionCharges || 0) +
          Number(inv.unloadingCharges || 0) +
          Number(inv.stCharges || 0);
        const firstVeh = inv.consignmentRows?.[0]?.vehicle || '-';
        return {
          line1: [
            String(idx + 1),
            inv.invoiceNo,
            inv.partyName,
            `${inv.consignmentRows?.length || 0} CN(s)`,
            formatINR(Number(inv.freightCharges || 0) + extras),
            formatINR(inv.totalTax || 0),
            formatINR(inv.grandTotal),
          ],
          line2: [
            '',
            formatDateDDMMYYYY(inv.invoiceDate),
            inv.billingCountry && inv.billingCountry !== 'India'
              ? `${inv.billingCountry} (Export)`
              : inv.partyGstin || '-',
            firstVeh,
            extras > 0 ? `Ext: ${formatINR(extras)}` : '-',
            inv.gstPaidBy || (inv.reverseCharge ? 'Consignee' : 'Transporter'),
            `Paid: ${formatINR(inv.paidAmount)} (${inv.status})`,
          ],
        };
      }),
      totalsLabel: 'TOTAL IN RUPEES :',
      totalsLine1: ['', '', '', '', formatINR(sumFreight), formatINR(sumTax), formatINR(sumTotal)],
      totalsLine2: ['', '', '', '', '', '', `Paid: ${formatINR(sumPaid)}`],
      totalAmountForWords: sumTotal,
    };
  }, [
    statementKind,
    statementFilter,
    tripDateFilter,
    search,
    invoices,
    consignments,
    lorryHires,
    drivers,
    transactions,
    bankReceipts,
    activeFy,
  ]);

  // Final Results (P&L + Balance Sheet)
  const financials = useMemo(() => {
    const billedFreight = invoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const cashIncome = transactions
      .filter((t) => t.txType === 'Income')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalRevenue = Math.max(billedFreight, cashIncome);

    const lorryHireCost = lorryHires.reduce((s, h) => s + Number(h.hireAmount || 0), 0);
    const directExpenses = transactions
      .filter((t) => {
        if (t.txType !== 'Expense') return false;
        const isAutoLorryBalanceTx =
          t.ledgerAccount === 'Lorry Hire Payable A/c' &&
          (Boolean(t.linkedCnNo) || /^LH-/i.test(t.txCode || ''));
        return !isAutoLorryBalanceTx;
      })
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
    if (readOnly) return;
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
    if (readOnly) return;
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

  const buildCurrentPdf = async (): Promise<GeneratedPdfResult> => {
    if (tab === 'gstRegister') {
      return generateGstRegisterPDF({
        invoices: filteredInvoices,
        subtitle: `Financial Year: ${activeFy} · As of ${formatDateDDMMYYYY(todayISO())} · Total Bills: ${filteredInvoices.length}`,
        company,
        fileName: `GST_Register_${activeFy.replace(/\s+/g, '_')}_${todayISO()}.pdf`,
        orientation: 'l',
      });
    }
    if (tab === 'foxproStatements') {
      return generateFoxproStatementPDF(activeStatementSpec, company, 'l');
    }
    if (tab === 'invoiceRegister') {
      return generateTableReportPDF({
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
    }
    if (tab === 'purchaseRegister') {
      return generateTableReportPDF({
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
    }
    if (tab === 'cnWise') {
      return generateTableReportPDF({
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
    }
    if (tab === 'aging') {
      return generateTableReportPDF({
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
    }
    if (tab === 'accountBook' && selectedPartyLedger !== 'ALL') {
      const entries = partyLedgerSummary.entries;
      const totDr = entries.reduce((s, r) => s + r.debit, 0);
      const totCr = entries.reduce((s, r) => s + r.credit, 0);
      return generateFoxproStatementPDF(
        {
          title: 'N-E-X-T - G-E-N   P-A-R-T-Y   L-E-D-G-E-R   S-T-A-T-E-M-E-N-T',
          subtitle: `Party: ${selectedPartyLedger} · FY: ${activeFy} · As of ${formatDateDDMMYYYY(todayISO())}`,
          fileName: `Party_Ledger_${selectedPartyLedger.replace(/[^a-zA-Z0-9_-]/g, '_')}_${todayISO()}.pdf`,
          orientation: 'l',
          summaryLines: [
            { label: 'Total Billed', value: `Rs. ${formatINR(partyLedgerSummary.totalBilled)}` },
            { label: 'Total Received', value: `Rs. ${formatINR(partyLedgerSummary.totalReceived)}` },
            { label: 'Total TDS Deducted', value: `Rs. ${formatINR(partyLedgerSummary.totalTds)}` },
            {
              label: 'Net Balance',
              value: `Rs. ${formatINR(partyLedgerSummary.netBalance)} ${partyLedgerSummary.netSide}`,
            },
          ],
          columns: [
            { label: 'DATE / VOUCHER', widthPct: 13, align: 'left' },
            { label: 'PARTICULARS & AUTO NARRATION', widthPct: 36, align: 'left' },
            { label: 'MODE / UPI REF / UTR / CHEQUE', widthPct: 21, align: 'left' },
            { label: 'DEBIT (INR)', widthPct: 10, align: 'right' },
            { label: 'CREDIT (INR)', widthPct: 10, align: 'right' },
            { label: 'BALANCE', widthPct: 10, align: 'right' },
          ],
          rows: entries.map((e) => ({
            line1: [
              e.date ? formatDateDDMMYYYY(e.date) : 'OPENING',
              e.narration,
              e.referenceChain,
              e.debit > 0 ? formatINR(e.debit) : '-',
              e.credit > 0 ? formatINR(e.credit) : '-',
              `${formatINR(e.runningBalance)} ${e.balanceSide}`,
            ],
            line2: [
              e.voucherNo,
              `Type: ${e.type}${e.tdsAmount > 0 ? ` · Sec 194C TDS: Rs. ${formatINR(e.tdsAmount)}` : ''}`,
              [
                e.upiRefId ? `UPI:${e.upiRefId}` : '',
                e.utrNo ? `UTR:${e.utrNo}` : '',
                e.chequeNo ? `CHQ:${e.chequeNo}` : '',
              ]
                .filter(Boolean)
                .join(' | ') || e.paymentMode,
              '',
              e.tdsAmount > 0 ? `TDS ${formatINR(e.tdsAmount)}` : '',
              '',
            ],
          })),
          totalsLabel: 'CLOSING LEDGER TOTALS :',
          totalsLine1: [
            '',
            `TDS Deducted: Rs. ${formatINR(partyLedgerSummary.totalTds)}`,
            '',
            formatINR(totDr),
            formatINR(totCr),
            `${formatINR(partyLedgerSummary.netBalance)} ${partyLedgerSummary.netSide}`,
          ],
          totalAmountForWords: partyLedgerSummary.netBalance,
        },
        company,
        'l'
      );
    }

    return generateFoxproStatementPDF(
      {
        title: 'A-C-C-O-U-N-T   B-O-O-K   &   P-A-R-T-Y   L-E-D-G-E-R   S-U-M-M-A-R-Y',
        subtitle: `FY: ${activeFy} · As of ${formatDateDDMMYYYY(todayISO())} · Accounts: ${filteredAccountBook.length}`,
        fileName: `Account_Book_${todayISO()}.pdf`,
        orientation: 'l',
        summaryLines: [
          { label: 'Total Billed', value: `Rs. ${formatINR(partyLedgerSummary.totalBilled)}` },
          { label: 'Total Received', value: `Rs. ${formatINR(partyLedgerSummary.totalReceived)}` },
          { label: 'Total TDS Deducted', value: `Rs. ${formatINR(partyLedgerSummary.totalTds)}` },
          {
            label: 'Net Balance',
            value: `Rs. ${formatINR(partyLedgerSummary.netBalance)} ${partyLedgerSummary.netSide}`,
          },
        ],
        columns: [
          { label: 'S.NO', widthPct: 6, align: 'center' },
          { label: 'PARTY / ACCOUNT NAME', widthPct: 40, align: 'left' },
          { label: 'TOTAL DEBIT (INR)', widthPct: 18, align: 'right' },
          { label: 'TOTAL CREDIT (INR)', widthPct: 18, align: 'right' },
          { label: 'NET BALANCE', widthPct: 18, align: 'right' },
        ],
        rows: filteredAccountBook.map((r, idx) => ({
          line1: [
            String(idx + 1),
            r.party,
            formatINR(r.debit),
            formatINR(r.credit),
            `${formatINR(r.netBalance)} ${r.side}`,
          ],
        })),
        totalsLabel: 'TOTAL IN RUPEES :',
        totalsLine1: [
          '',
          '',
          formatINR(filteredAccountBook.reduce((s, r) => s + r.debit, 0)),
          formatINR(filteredAccountBook.reduce((s, r) => s + r.credit, 0)),
          `${formatINR(partyLedgerSummary.netBalance)} ${partyLedgerSummary.netSide}`,
        ],
        totalAmountForWords: partyLedgerSummary.netBalance,
      },
      company,
      'l'
    );
  };

  const handleReportPdfAction = async (mode: 'preview' | 'print' | 'download') => {
    const pdf = await buildCurrentPdf();
    if (mode === 'preview') onPreviewPdf(pdf, 'Reports_Ledgers');
    else if (mode === 'print') printPdfDirect(pdf);
    else downloadPdfDirect(pdf);
  };

  // Column definitions
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
      { key: 'owner', header: 'Owner / Broker', render: (h) => h.ownerName || h.brokerName || '-' },
      { key: 'hire', header: 'Hire (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (h) => formatINR(h.hireAmount) },
      { key: 'adv', header: 'Advance (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num', render: (h) => formatINR(h.advancePaid) },
      { key: 'bal', header: 'Net Payable (₹)', headerClassName: 'text-right', cellClassName: 'text-right font-mono-num font-bold', render: (h) => formatINR(h.balancePayable) },
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
      {
        key: 'ledger',
        header: 'Next-Gen Ledger',
        headerClassName: 'text-right',
        cellClassName: 'text-right whitespace-nowrap',
        render: (r) => (
          <button
            type="button"
            onClick={() => setSelectedPartyLedger(r.party)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-bold cursor-pointer"
          >
            <Eye className="w-3 h-3" />
            View Ledger
          </button>
        ),
      },
    ],
    []
  );

  const overdue15And30List = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status !== 'Paid' && getInvoicePendingDays(inv) >= 15)
        .map((inv) => {
          const days = getInvoicePendingDays(inv);
          const p = parties.find(
            (x) => x.name.trim().toLowerCase() === (inv.partyName || '').trim().toLowerCase()
          );
          return { inv, days, party: p };
        })
        .sort((a, b) => b.days - a.days),
    [invoices, parties]
  );

  const followUpParties = useMemo(() => {
    const baseParties = parties.filter(
      (p) => p.partyType === 'Customer' || p.partyType === 'Consignor' || p.partyType === 'Consignee'
    );
    return baseParties
      .map((p) => {
        const partyCns = consignments
          .filter(
            (cn) =>
              cn.billingPartyName?.toLowerCase() === p.name.toLowerCase() ||
              cn.consignorName?.toLowerCase() === p.name.toLowerCase()
          )
          .sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || ''));
        const lastCn = partyCns[0];
        const daysSinceLast = lastCn?.cnDate ? daysSinceDate(lastCn.cnDate) : 99;
        const routeText = `${p.address || ''} ${lastCn?.toState || ''} ${lastCn?.toCity || ''} ${lastCn?.fromCity || ''}`;
        return {
          party: p,
          lastCn,
          daysSinceLast,
          routeText,
          dueForFollowUp: daysSinceLast >= 3,
        };
      })
      .filter((row) => {
        if (corridorFilter !== 'ALL') {
          if (!row.routeText.toLowerCase().includes(corridorFilter.toLowerCase())) {
            return false;
          }
        }
        const q = debouncedSearch.trim().toLowerCase();
        if (q) {
          return `${row.party.name} ${row.routeText} ${row.party.phone || ''}`
            .toLowerCase()
            .includes(q);
        }
        return true;
      })
      .sort((a, b) => b.daysSinceLast - a.daysSinceLast);
  }, [parties, consignments, corridorFilter, debouncedSearch]);

  const tabs: Array<{ id: ReportTab; label: string; adminOnly?: boolean }> = [
    { id: 'gstRegister', label: 'G-S-T R-E-G-I-S-T-E-R' },
    { id: 'gstFilingHub', label: 'GST & RCM Filing Hub' },
    { id: 'foxproStatements', label: 'FoxPro Statements (6)' },
    { id: 'invoiceRegister', label: 'Invoice Register' },
    { id: 'purchaseRegister', label: 'Purchase / Lorry Hire' },
    { id: 'cnWise', label: 'CN-Wise P&L' },
    { id: 'lorryWise', label: 'Lorry-Wise P&L' },
    { id: 'aging', label: 'Payment Aging' },
    { id: 'partyFollowUp', label: '15/30d Alerts & Party Load' },
    { id: 'accountBook', label: 'Account Book' },
    { id: 'finalResults', label: 'Final Results (P&L / BS)', adminOnly: true },
    { id: 'aiAdvisor', label: 'AI MIS Advisor', adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => isMasterAdmin || !t.adminOnly);

  const isTableTab =
    tab !== 'finalResults' &&
    tab !== 'aiAdvisor' &&
    tab !== 'partyFollowUp' &&
    tab !== 'gstFilingHub';

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

        <div className="flex flex-wrap items-center gap-1.5">
          {isTableTab && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter current register..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {tab !== 'aiAdvisor' && tab !== 'gstFilingHub' && (
            <>
              <button
                type="button"
                onClick={() => void handleReportPdfAction('preview')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5" />
                Print Preview
              </button>
              <button
                type="button"
                onClick={() => void handleReportPdfAction('print')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Out
              </button>
              <button
                type="button"
                onClick={() => void handleReportPdfAction('download')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
            </>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          {statusMsg}
        </div>
      )}

      {/* TAB: FOXPRO-STYLE "G-S-T R-E-G-I-S-T-E-R" (TWO-LINE ROWS + TOTAL IN RUPEES) */}
      {tab === 'gstRegister' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold tracking-wider">
              <FileSpreadsheet className="w-4 h-4" />
              <span>G-S-T R-E-G-I-S-T-E-R ({filteredInvoices.length} Bills)</span>
            </div>
            <span className="text-xs text-blue-100">
              FoxPro Two-Line Format · Use Print Preview / Download PDF for Landscape A4
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse font-mono-num">
              <thead className="bg-slate-100 text-slate-800 border-b border-slate-300">
                <tr>
                  <th className="p-2 text-center">S.NO</th>
                  <th className="p-2 text-left">
                    <div>BILL NO</div>
                    <div className="text-[10px] text-slate-500">BL. DATE</div>
                  </th>
                  <th className="p-2 text-left">
                    <div>PARTY NAME</div>
                    <div className="text-[10px] text-slate-500">GSTIN / COUNTRY</div>
                  </th>
                  <th className="p-2 text-right">FREIGHT CHARGES</th>
                  <th className="p-2 text-right">TAXABLE VALUE</th>
                  <th className="p-2 text-right">
                    <div>SGST AMT</div>
                    <div className="text-[10px] text-slate-500">CGST AMT</div>
                  </th>
                  <th className="p-2 text-right">
                    <div>IGST AMT</div>
                    <div className="text-[10px] text-slate-500">TOT GST</div>
                  </th>
                  <th className="p-2 text-right">TOTAL AMOUNT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500 font-sans">
                      No invoices recorded in {activeFy}.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv, idx) => {
                    const freight = Number(inv.freightCharges || 0);
                    const extras =
                      Number(inv.detentionCharges || 0) +
                      Number(inv.unloadingCharges || 0) +
                      Number(inv.stCharges || 0);
                    const taxable = freight + extras;
                    return (
                      <tr key={inv.id} className="hover:bg-blue-50/40">
                        <td className="p-2 text-center font-bold text-slate-600">{idx + 1}</td>
                        <td className="p-2">
                          <div className="font-bold text-blue-800">{inv.invoiceNo}</div>
                          <div className="text-[10px] text-slate-500">{formatDateDDMMYYYY(inv.invoiceDate)}</div>
                        </td>
                        <td className="p-2 font-sans">
                          <div className="font-bold text-slate-900">{inv.partyName}</div>
                          <div className="text-[10px] font-mono-num text-slate-500">
                            {inv.billingCountry && inv.billingCountry !== 'India'
                              ? `${inv.billingCountry.toUpperCase()} (EXPORT 0%) · PAN: ${inv.partyPan || '-'}`
                              : `${inv.partyGstin || 'UNREGISTERED'} · ${inv.gstPaidBy || (inv.reverseCharge ? 'Consignee' : 'Transporter')}`}
                          </div>
                        </td>
                        <td className="p-2 text-right">{formatINR(freight)}</td>
                        <td className="p-2 text-right">{formatINR(taxable)}</td>
                        <td className="p-2 text-right">
                          <div>{formatINR(inv.sgstAmt || 0)}</div>
                          <div className="text-[10px] text-slate-500">{formatINR(inv.cgstAmt || 0)}</div>
                        </td>
                        <td className="p-2 text-right">
                          <div>{formatINR(inv.igstAmt || 0)}</div>
                          <div className="text-[10px] font-bold text-slate-700">{formatINR(inv.totalTax || 0)}</div>
                        </td>
                        <td className="p-2 text-right font-bold text-blue-900">
                          <div>{formatINR(inv.grandTotal)}</div>
                          <div className="text-[10px] font-normal text-slate-500">{inv.status}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-100 border-t-2 border-slate-400 font-bold text-slate-900">
                <tr>
                  <td colSpan={3} className="p-2.5 text-right text-blue-900">
                    TOTAL IN RUPEES :
                  </td>
                  <td className="p-2.5 text-right">{formatINR(gstRegisterTotals.freight)}</td>
                  <td className="p-2.5 text-right">{formatINR(gstRegisterTotals.taxable)}</td>
                  <td className="p-2.5 text-right">
                    <div>S: {formatINR(gstRegisterTotals.sgst)}</div>
                    <div className="text-[10px]">C: {formatINR(gstRegisterTotals.cgst)}</div>
                  </td>
                  <td className="p-2.5 text-right">
                    <div>I: {formatINR(gstRegisterTotals.igst)}</div>
                    <div className="text-[10px]">T: {formatINR(gstRegisterTotals.totGst)}</div>
                  </td>
                  <td className="p-2.5 text-right text-blue-900 text-sm">
                    ₹ {formatINR(gstRegisterTotals.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* TAB: GST & RCM REPORT & ONLINE FILING HUB */}
      {tab === 'gstFilingHub' && (
        <GstFilingHubModule
          invoices={invoices}
          consignments={consignments}
          company={company}
          activeFy={activeFy}
          onPreviewPdf={onPreviewPdf}
        />
      )}

      {/* TAB: FOXPRO STATEMENTS CENTER (PARTY, DRIVER, BROKER, OWNER, DAILY TRIP, LOGISTICS BILL) */}
      {tab === 'foxproStatements' && (
        <div className="space-y-3">
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ['party', 'Party Statement'],
                  ['driver', 'Driver Statement'],
                  ['broker', 'Broker Statement'],
                  ['owner', 'Owner Statement'],
                  ['dailyTrip', 'Daily Trip Report'],
                  ['logisticsBill', 'Logistics Bill Register'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatementKind(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    statementKind === id
                      ? 'bg-[#0D47A1] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={statementFilter}
                  onChange={(e) => setStatementFilter(e.target.value)}
                  placeholder={`Filter ${statementKind} statement (name, CN, truck, bill)...`}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                />
              </div>
              {statementKind === 'dailyTrip' && (
                <div className="flex items-center gap-1.5">
                  <label className="font-semibold text-slate-700">Trip Date:</label>
                  <input
                    type="date"
                    value={tripDateFilter}
                    onChange={(e) => setTripDateFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono-num"
                  />
                  {tripDateFilter && (
                    <button
                      type="button"
                      onClick={() => setTripDateFilter('')}
                      className="text-blue-700 font-semibold hover:underline cursor-pointer"
                    >
                      All Dates
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
              <span className="font-mono-num">{activeStatementSpec.title}</span>
              <span>{activeStatementSpec.subtitle}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse font-mono-num">
                <thead className="bg-slate-100 text-slate-800 border-b border-slate-300">
                  <tr>
                    {activeStatementSpec.columns.map((col, idx) => (
                      <th
                        key={idx}
                        className={`p-2 ${
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                        }`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activeStatementSpec.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={activeStatementSpec.columns.length}
                        className="p-8 text-center text-slate-500 font-sans"
                      >
                        No matching entries found for this statement.
                      </td>
                    </tr>
                  ) : (
                    activeStatementSpec.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-blue-50/40">
                        {activeStatementSpec.columns.map((col, cIdx) => (
                          <td
                            key={cIdx}
                            className={`p-2 ${
                              col.align === 'right'
                                ? 'text-right'
                                : col.align === 'center'
                                  ? 'text-center'
                                  : 'text-left'
                            }`}
                          >
                            <div className={cIdx === 0 || col.align === 'right' ? 'font-bold' : 'font-semibold'}>
                              {row.line1[cIdx] || '-'}
                            </div>
                            {row.line2?.[cIdx] && (
                              <div className="text-[10px] text-slate-500">{row.line2[cIdx]}</div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
                {activeStatementSpec.totalsLine1 && (
                  <tfoot className="bg-slate-100 border-t-2 border-slate-400 font-bold text-slate-900">
                    <tr>
                      {activeStatementSpec.columns.map((col, cIdx) => (
                        <td
                          key={cIdx}
                          className={`p-2.5 ${
                            col.align === 'right'
                              ? 'text-right'
                              : col.align === 'center'
                                ? 'text-center'
                                : 'text-left'
                          }`}
                        >
                          {cIdx === 1 && !activeStatementSpec.totalsLine1?.[1] ? (
                            <span className="text-blue-900">{activeStatementSpec.totalsLabel || 'TOTAL IN RUPEES :'}</span>
                          ) : (
                            activeStatementSpec.totalsLine1?.[cIdx] || ''
                          )}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
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
        <div className="space-y-3">
          {overdue15And30List.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>
                  {overdue15And30List.length} Unpaid Invoice(s) Reached 15d / 30d+ Alert Threshold
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTab('partyFollowUp')}
                className="px-3 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white font-bold cursor-pointer"
              >
                Open 15/30d Alert &amp; WhatsApp/Email Desk
              </button>
            </div>
          )}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredAging}
              columns={agingCols}
              getRowId={(a) => a.invoiceNo}
              defaultPageSize={50}
              emptyMessage="No outstanding invoices."
            />
          </div>
        </div>
      )}

      {tab === 'partyFollowUp' && (
        <div className="space-y-4">
          {/* 15 & 30-Day Due Payment Alerts (Manual User Trigger Only) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-red-700 to-amber-700 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                15-Day &amp; 30-Day Pending Bill Payment Alerts ({overdue15And30List.length})
              </span>
              <span className="text-[11px] text-amber-100">
                Manual 1-click WhatsApp or Email reminder — never sends automatically
              </span>
            </div>
            <div className="divide-y divide-slate-200">
              {overdue15And30List.length === 0 ? (
                <p className="p-5 text-center text-xs text-slate-500">
                  No pending bills have crossed 15 or 30 days.
                </p>
              ) : (
                overdue15And30List.map(({ inv, days, party }) => {
                  const balance = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));
                  const msg = buildOverdueBillMessage({
                    invoice: inv,
                    companyName: company.companyName,
                    pendingDays: days,
                  });
                  return (
                    <div
                      key={inv.id}
                      className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-slate-50"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono-num font-extrabold text-blue-900">
                            {inv.invoiceNo}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold text-white ${
                              days >= 30 ? 'bg-red-600' : 'bg-amber-600'
                            }`}
                          >
                            {days >= 30 ? `30d+ OVERDUE (${days}d)` : `15d+ ALERT (${days}d)`}
                          </span>
                        </div>
                        <p className="font-bold text-slate-900 mt-0.5">{inv.partyName}</p>
                        <p className="text-[11px] text-slate-600 font-mono-num">
                          Balance: ₹{formatINR(balance)} · Bill Date: {formatDateDDMMYYYY(inv.invoiceDate)} ·
                          Prefers: {party?.preferredChannel || 'WhatsApp Only'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            triggerExternalShareLink(
                              buildWhatsAppShareHref({ phone: party?.phone || '', message: msg })
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          WhatsApp Alert
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            triggerExternalShareLink(
                              buildEmailShareHref({
                                email: party?.email || '',
                                subject: `Payment Reminder: Bill ${inv.invoiceNo} (${days} Days)`,
                                body: msg,
                              })
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-bold cursor-pointer"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Email Alert
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3-4 Day User-Selected Priority Corridor Party Load Follow-Up */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-amber-300" />
                3–4 Day Party Load Inquiry &amp; Corridor Follow-Up ({followUpParties.length} parties)
              </span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search party, city, phone..."
                  className="pl-8 pr-3 py-1 rounded bg-white text-slate-900 text-xs w-52 focus:outline-none"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setCorridorFilter('ALL')}
                className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                  corridorFilter === 'ALL'
                    ? 'bg-[#0D47A1] text-white'
                    : 'bg-white border border-slate-300 text-slate-700'
                }`}
              >
                All Regions
              </button>
              {PRIORITY_CORRIDOR_REGIONS.map((region) => (
                <button
                  key={region}
                  type="button"
                  onClick={() => setCorridorFilter(region)}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                    corridorFilter === region
                      ? 'bg-[#0D47A1] text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-blue-50'
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>
            <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
              {followUpParties.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">
                  No parties match this corridor filter.
                </p>
              ) : (
                followUpParties.slice(0, 80).map(({ party, lastCn, daysSinceLast, dueForFollowUp }) => {
                  const regionLabel = corridorFilter !== 'ALL' ? corridorFilter : (lastCn?.toCity || party.address || 'All-India');
                  const followMsg = buildPartyLoadFollowUpMessage({
                    party,
                    companyName: company.companyName,
                    corridorHint: regionLabel,
                    phones: company.phones,
                  });
                  const pref = party.preferredChannel || 'WhatsApp Only';
                  return (
                    <div
                      key={party.id}
                      className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-slate-50"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">{party.name}</span>
                          {dueForFollowUp && (
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-extrabold">
                              {lastCn ? `${daysSinceLast}d since last load` : '3-4d Follow-Up Ready'}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                            Channel: {pref}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {party.phone ? `Tel: ${party.phone}` : 'No phone'} ·{' '}
                          {party.email ? party.email : 'No email'} ·{' '}
                          {lastCn ? `Last Dispatch: ${lastCn.cnNo} (${lastCn.fromCity} → ${lastCn.toCity})` : party.address || 'Registered Party'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(pref === 'WhatsApp Only' || pref === 'Both' || !party.email) && (
                          <button
                            type="button"
                            onClick={() =>
                              triggerExternalShareLink(
                                buildWhatsAppShareHref({ phone: party.phone || '', message: followMsg })
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            WhatsApp Load Check
                          </button>
                        )}
                        {(pref === 'Email Only' || pref === 'Both' || Boolean(party.email)) && (
                          <button
                            type="button"
                            onClick={() =>
                              triggerExternalShareLink(
                                buildEmailShareHref({
                                  email: party.email || '',
                                  subject: 'Vehicle Requirement Check — Dolphin Road Carriers',
                                  body: followMsg,
                                })
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white font-bold cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Email Load Check
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'accountBook' && (
        <div className="space-y-3">
          {/* Next-Gen Party Ledger Top Summary KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Total Billed
              </div>
              <div className="text-lg font-extrabold font-mono-num text-blue-900 mt-0.5">
                ₹ {formatINR(partyLedgerSummary.totalBilled)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Total Received
              </div>
              <div className="text-lg font-extrabold font-mono-num text-emerald-700 mt-0.5">
                ₹ {formatINR(partyLedgerSummary.totalReceived)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Total TDS Deducted
              </div>
              <div className="text-lg font-extrabold font-mono-num text-amber-700 mt-0.5">
                ₹ {formatINR(partyLedgerSummary.totalTds)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Net Balance ({partyLedgerSummary.netSide})
              </div>
              <div className="text-lg font-extrabold font-mono-num text-slate-900 mt-0.5">
                ₹ {formatINR(partyLedgerSummary.netBalance)} {partyLedgerSummary.netSide}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <label className="font-bold text-slate-800">Next-Gen Party Ledger:</label>
              <select
                aria-label="Select Party Ledger"
                value={selectedPartyLedger}
                onChange={(e) => setSelectedPartyLedger(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-slate-900 min-w-[240px]"
              >
                <option value="ALL">All Parties Account Summary ({filteredAccountBook.length})</option>
                {partyLedgerOptions.map((pName) => (
                  <option key={pName} value={pName}>
                    {pName}
                  </option>
                ))}
              </select>
              {selectedPartyLedger !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setSelectedPartyLedger('ALL')}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
                >
                  Back to All Parties
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={readOnly}
                onClick={handleRecalculateBalances}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Calculator className="w-3.5 h-3.5" />
                Recalculate Balances
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={handleAutoTransferBalances}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                FY Carry Forward
              </button>
            </div>
          </div>

          {selectedPartyLedger === 'ALL' ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <PaginatedDataTable
                data={filteredAccountBook}
                columns={accountBookCols}
                getRowId={(r) => r.party}
                defaultPageSize={50}
                emptyMessage="No ledger entries."
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
              <div className="bg-slate-800 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                <span>
                  Party Statement: {selectedPartyLedger} ({partyLedgerSummary.entries.length} entries)
                </span>
                <span className="font-mono-num">
                  Closing: ₹ {formatINR(partyLedgerSummary.netBalance)} {partyLedgerSummary.netSide}
                </span>
              </div>
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3">Date / Ref</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Automatic Accounting Narration</th>
                    <th className="py-2 px-3">Mode / UPI Ref / UTR / Cheque</th>
                    <th className="py-2 px-3 text-right">Debit (₹)</th>
                    <th className="py-2 px-3 text-right">Credit (₹)</th>
                    <th className="py-2 px-3 text-right">TDS (₹)</th>
                    <th className="py-2 px-3 text-right">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {partyLedgerSummary.entries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500">
                        No ledger transactions recorded for {selectedPartyLedger}.
                      </td>
                    </tr>
                  ) : (
                    partyLedgerSummary.entries.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono-num whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {e.date ? formatDateDDMMYYYY(e.date) : 'OPENING'}
                          </div>
                          <div className="text-[10px] text-blue-700 font-bold">{e.voucherNo}</div>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold">
                            {e.type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-800 max-w-md">{e.narration}</td>
                        <td className="py-2 px-3 font-mono-num text-[11px] text-slate-700">
                          <div className="font-bold text-slate-900">{e.paymentMode}</div>
                          <div className="text-[10px] text-slate-600">{e.referenceChain}</div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-semibold text-blue-900">
                          {e.debit > 0 ? formatINR(e.debit) : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-semibold text-emerald-700">
                          {e.credit > 0 ? formatINR(e.credit) : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-amber-700">
                          {e.tdsAmount > 0 ? formatINR(e.tdsAmount) : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-extrabold text-slate-900 whitespace-nowrap">
                          ₹ {formatINR(e.runningBalance)} {e.balanceSide}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
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

      {/* AI MIS Advisor */}
      {tab === 'aiAdvisor' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-[#0D47A1] to-[#6D28D9] text-white px-4 py-2.5 flex items-center gap-2 text-sm font-bold">
            <BrainCircuit className="w-4 h-4" />
            <span>AI MIS &amp; GST Compliance Advisor (High-Thinking Analysis)</span>
          </div>
          <form onSubmit={handleAskAI} className="p-4 space-y-3 text-xs">
            <p className="text-slate-600">
              Ask complex questions about overdue receivables, GST 5% RCM vs 12% FCM, Section 194C
              TDS compliance, or truck-wise profitability based on your live workspace figures.
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
