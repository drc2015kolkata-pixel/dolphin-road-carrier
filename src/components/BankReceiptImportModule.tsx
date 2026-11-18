import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  CloudUpload,
  FileSpreadsheet,
  Landmark,
  Printer,
  Trash2,
  Upload,
} from 'lucide-react';
import { uploadBankStatementMirrorToDrive } from '../lib/driveBackup';
import {
  bulkUpsertDocuments,
  logBranchActivity,
  removeDocument,
  upsertDocument,
} from '../lib/firestoreStore';
import { formatDateDDMMYYYY, formatINR } from '../lib/formatters';
import { GeneratedPdfResult, generateFoxproStatementPDF } from '../lib/pdfEngine';
import { BankReceiptRecord, CompanySettings, Invoice } from '../types/erp';
import { ConfirmModal } from './ConfirmModal';

interface BankReceiptImportModuleProps {
  bankReceipts: BankReceiptRecord[];
  invoices: Invoice[];
  company: CompanySettings;
  activeFy: string;
  ownerUid: string;
  currentStaffCode: string;
  currentBranchCode: string;
  driveAccessToken: string | null;
  readOnly?: boolean;
  onOpenPreview: (pdf: GeneratedPdfResult) => void;
}

function parseNumericAmount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const cleaned = String(raw || '')
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')
    .trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.abs(num) : 0;
}

function normalizeStatementDate(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddmmyyyy) {
    const d = ddmmyyyy[1].padStart(2, '0');
    const m = ddmmyyyy[2].padStart(2, '0');
    const y = ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3];
    return `${y}-${m}-${d}`;
  }
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export function extractCreditReceiptsFromRows(params: {
  rows: Array<Record<string, unknown>>;
  invoices: Invoice[];
  activeFy: string;
  bankAccountName: string;
  sourceFileName: string;
  branchCode: string;
  staffCode: string;
  ownerUid: string;
}): BankReceiptRecord[] {
  const results: BankReceiptRecord[] = [];
  const fyInvoices = params.invoices.filter(
    (inv) => !inv.financialYear || inv.financialYear === params.activeFy
  );

  params.rows.forEach((row, idx) => {
    const entries = Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v] as const);
    const findVal = (patterns: RegExp[]): unknown => {
      for (const p of patterns) {
        const hit = entries.find(([k]) => p.test(k));
        if (hit && hit[1] !== undefined && hit[1] !== null && String(hit[1]).trim() !== '') {
          return hit[1];
        }
      }
      return undefined;
    };

    const debitAmt = parseNumericAmount(
      findVal([/debit/, /withdrawal/, /dr\s*amt/, /\bdr\b/])
    );
    let creditAmt = parseNumericAmount(
      findVal([/credit/, /deposit/, /cr\s*amt/, /\bcr\b/, /receipt/])
    );

    const drCrFlag = String(findVal([/type/, /dr\/cr/, /cr\/dr/]) || '').trim().toUpperCase();
    const genericAmt = parseNumericAmount(findVal([/amount/, /amt/]));

    if (creditAmt <= 0 && genericAmt > 0 && /^(CR|CREDIT|C)$/.test(drCrFlag)) {
      creditAmt = genericAmt;
    }

    // STRICT BANK RECEIPT RULE: Skip all Debit / Expense / Withdrawal rows completely
    if (creditAmt <= 0 || (debitAmt > 0 && creditAmt === 0) || /^(DR|DEBIT|D)$/.test(drCrFlag)) {
      return;
    }

    const description = String(
      findVal([/narration/, /particulars/, /description/, /remarks/, /details/]) || ''
    ).trim();
    const referenceNo = String(
      findVal([/chq/, /cheque/, /utr/, /ref/, /instrument/]) || ''
    ).trim();
    const rawPartyHint = String(findVal([/party/, /payer/, /customer/]) || '').trim();
    const receiptDate = normalizeStatementDate(
      findVal([/date/, /txn\s*date/, /value\s*date/])
    );

    const combinedText = `${rawPartyHint} ${description} ${referenceNo}`.toLowerCase();

    // Auto-match Invoice by Party Name / Invoice No / Reference / Unpaid Amount (prioritize unpaid/partial bills)
    const prioritizedInvoices = [
      ...fyInvoices.filter((inv) => inv.status !== 'Paid'),
      ...fyInvoices.filter((inv) => inv.status === 'Paid'),
    ];
    let matchedInv: Invoice | undefined;
    for (const inv of prioritizedInvoices) {
      const invNoClean = (inv.invoiceNo || '').toLowerCase();
      const partyTokens = (inv.partyName || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4);
      const pending = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));

      if (invNoClean && combinedText.includes(invNoClean)) {
        matchedInv = inv;
        break;
      }
      if (partyTokens.some((tok) => combinedText.includes(tok))) {
        matchedInv = inv;
        break;
      }
      if (pending > 0 && Math.abs(pending - creditAmt) <= pending * 0.025) {
        matchedInv = inv;
        break;
      }
    }

    // Auto 194C TDS Detection: if matched bill unpaid ~ creditAmt + 1% or 2% TDS
    let tdsRatePct = 0;
    let tdsAmount = 0;
    let billAmount = matchedInv ? Number(matchedInv.grandTotal || 0) : creditAmt;
    if (matchedInv) {
      const pending = Math.max(0, Number(matchedInv.grandTotal || 0) - Number(matchedInv.paidAmount || 0));
      if (pending > creditAmt) {
        const diff = Math.round(pending - creditAmt);
        const pct = Math.round((diff / Math.max(1, pending)) * 1000) / 10;
        if (pct >= 0.8 && pct <= 2.3) {
          tdsRatePct = pct;
          tdsAmount = diff;
        }
      }
    }
    const grossSettled = creditAmt + tdsAmount;
    const balanceRemaining = matchedInv
      ? Math.max(0, Number(matchedInv.grandTotal || 0) - Number(matchedInv.paidAmount || 0) - grossSettled)
      : 0;

    results.push({
      id: `brec_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      financialYear: params.activeFy,
      receiptDate,
      bankAccountName: params.bankAccountName,
      partyName:
        matchedInv?.partyName ||
        rawPartyHint ||
        (description.split(/[\/\-]/)[0] || 'Unmatched Party').trim().slice(0, 50),
      referenceNo: referenceNo || `UTR-${idx + 1}`,
      description,
      creditAmount: creditAmt,
      tdsRatePct,
      tdsAmount,
      grossSettled,
      matchedInvoiceId: matchedInv?.id,
      matchedInvoiceNo: matchedInv?.invoiceNo,
      billAmount,
      balanceRemaining,
      appliedToInvoice: false,
      sourceFileName: params.sourceFileName,
      branchCode: params.branchCode,
      createdByStaff: params.staffCode,
      ownerUid: params.ownerUid,
    });
  });

  return results;
}

export const BankReceiptImportModule: React.FC<BankReceiptImportModuleProps> = ({
  bankReceipts,
  invoices,
  company,
  activeFy,
  ownerUid,
  currentStaffCode,
  currentBranchCode,
  driveAccessToken,
  readOnly = false,
  onOpenPreview,
}) => {
  const bankNames = useMemo(() => {
    const list = (company.bankAccounts || []).map(
      (b) => `${b.bankName || 'Bank'} (${(b.accountNo || '').slice(-4)})`
    );
    return list.length > 0
      ? list
      : [`${company.bankName || 'Bank'} (${(company.accountNo || '').slice(-4)})`];
  }, [company]);

  const [selectedBank, setSelectedBank] = useState(bankNames[0]);
  useEffect(() => {
    if (bankNames.length > 0 && !bankNames.includes(selectedBank)) {
      setSelectedBank(bankNames[0]);
    }
  }, [bankNames, selectedBank]);
  const [mirrorDrive, setMirrorDrive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BankReceiptRecord | null>(null);

  const fyReceipts = useMemo(
    () =>
      bankReceipts
        .filter((r) => r.financialYear === activeFy)
        .sort((a, b) => (b.receiptDate || '').localeCompare(a.receiptDate || '')),
    [bankReceipts, activeFy]
  );

  const fyInvoices = useMemo(
    () => invoices.filter((i) => !i.financialYear || i.financialYear === activeFy),
    [invoices, activeFy]
  );

  const handleFileUpload = async (file: File) => {
    if (readOnly) return;
    setImporting(true);
    setStatusMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('Uploaded file has no worksheets.');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
        defval: '',
      });

      const parsed = extractCreditReceiptsFromRows({
        rows,
        invoices,
        activeFy,
        bankAccountName: selectedBank,
        sourceFileName: file.name,
        branchCode: currentBranchCode,
        staffCode: currentStaffCode,
        ownerUid,
      });

      if (parsed.length === 0) {
        setStatusMsg(
          'Parsed file cleanly: 0 Credit party receipts found (all Debit/Expense rows were skipped).'
        );
        return;
      }

      await bulkUpsertDocuments('bank_receipts', parsed as unknown as Array<Record<string, unknown>>);

      if (mirrorDrive && driveAccessToken) {
        await uploadBankStatementMirrorToDrive({
          accessToken: driveAccessToken,
          financialYear: activeFy,
          fileName: file.name,
          fileContent: file,
          mimeType: file.type || 'application/octet-stream',
        });
      }

      await logBranchActivity({
        action: 'IMPORT_BANK_RECEIPTS',
        module: 'BANK_IMPORT',
        docRefCode: file.name,
        summary: `Imported ${parsed.length} Credit receipts for ${activeFy} (Debits skipped)`,
        staffCode: currentStaffCode,
        branchCode: currentBranchCode,
        ownerUid,
      });

      setStatusMsg(
        `Imported ${parsed.length} Credit party receipt(s) for ${activeFy}. All Debit/Withdrawal rows were strictly skipped.${
          mirrorDrive && driveAccessToken ? ' Also mirrored to Drive Bank_Statements folder.' : ''
        }`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to parse bank statement file.');
    } finally {
      setImporting(false);
    }
  };

  const handleUpdateReceiptField = async (
    rec: BankReceiptRecord,
    patch: Partial<BankReceiptRecord>
  ) => {
    if (readOnly) return;
    const next: BankReceiptRecord = { ...rec, ...patch };
    const matchedInv = next.matchedInvoiceId
      ? invoices.find((i) => i.id === next.matchedInvoiceId)
      : undefined;
    next.matchedInvoiceNo = matchedInv?.invoiceNo || next.matchedInvoiceNo;
    next.billAmount = matchedInv ? Number(matchedInv.grandTotal || 0) : next.creditAmount;
    next.grossSettled = Number(next.creditAmount || 0) + Number(next.tdsAmount || 0);
    next.balanceRemaining = matchedInv
      ? Math.max(
          0,
          Number(matchedInv.grandTotal || 0) -
            Number(matchedInv.paidAmount || 0) -
            next.grossSettled
        )
      : 0;

    await upsertDocument('bank_receipts', rec.id, next as unknown as Record<string, unknown>, false);
  };

  const handleApplyToInvoice = async (rec: BankReceiptRecord) => {
    if (readOnly || !rec.matchedInvoiceId || rec.appliedToInvoice) return;
    const inv = invoices.find((i) => i.id === rec.matchedInvoiceId);
    if (!inv) return;

    const totalApplied = Number(rec.creditAmount || 0) + Number(rec.tdsAmount || 0);
    const nextPaid = Math.min(
      Number(inv.grandTotal || 0),
      Math.round((Number(inv.paidAmount || 0) + totalApplied) * 100) / 100
    );
    const nextStatus: Invoice['status'] =
      nextPaid >= Number(inv.grandTotal || 0) - 1 ? 'Paid' : 'Partial';

    await upsertDocument(
      'invoices',
      inv.id,
      {
        ...inv,
        paidAmount: nextPaid,
        status: nextStatus,
      },
      false
    );

    const txId = `tx_bank_${Date.now()}`;
    await upsertDocument(
      'transactions',
      txId,
      {
        id: txId,
        txCode: `BNK-${rec.referenceNo || rec.id.slice(-4)}`,
        txDate: rec.receiptDate,
        financialYear: activeFy,
        txType: 'Income',
        ledgerAccount: rec.bankAccountName,
        partyName: inv.partyName,
        amount: rec.creditAmount,
        narration: `Bank Receipt (${rec.referenceNo})${
          rec.tdsAmount > 0 ? ` + TDS Rs.${rec.tdsAmount}` : ''
        } against ${inv.invoiceNo}`,
        paymentMode: 'NEFT/RTGS/UPI',
        referenceNo: rec.referenceNo,
        linkedInvoiceNo: inv.invoiceNo,
        branchCode: currentBranchCode,
        createdByStaff: currentStaffCode,
        ownerUid,
      },
      true
    );

    await upsertDocument(
      'bank_receipts',
      rec.id,
      {
        ...rec,
        appliedToInvoice: true,
        balanceRemaining: Math.max(0, Number(inv.grandTotal || 0) - nextPaid),
      },
      false
    );

    setStatusMsg(
      `Applied Rs. ${formatINR(rec.creditAmount)} + TDS Rs. ${formatINR(
        rec.tdsAmount
      )} to Invoice ${inv.invoiceNo} (${nextStatus}).`
    );
  };

  const handlePrintSummary = async () => {
    const sumCredit = fyReceipts.reduce((s, r) => s + Number(r.creditAmount || 0), 0);
    const sumTds = fyReceipts.reduce((s, r) => s + Number(r.tdsAmount || 0), 0);
    const sumGross = fyReceipts.reduce((s, r) => s + Number(r.grossSettled || 0), 0);

    const pdf = await generateFoxproStatementPDF(
      {
        title: 'BANK RECEIPT & 194C TDS RECONCILIATION',
        subtitle: `Financial Year: ${activeFy}   |   Party Credits Only (Debits Excluded)`,
        fileName: `Bank_Receipts_TDS_${activeFy.replace(/\s+/g, '_')}.pdf`,
        orientation: 'l',
        columns: [
          { label: 'DATE', widthPct: 10 },
          { label: 'PARTY NAME', widthPct: 24 },
          { label: 'REF / UTR', widthPct: 15 },
          { label: 'BILL NO', widthPct: 14 },
          { label: 'NET RECEIVED', widthPct: 13, align: 'right' },
          { label: 'AUTO TDS', widthPct: 11, align: 'right' },
          { label: 'BALANCE', widthPct: 13, align: 'right' },
        ],
        rows: fyReceipts.map((r) => ({
          line1: [
            formatDateDDMMYYYY(r.receiptDate),
            r.partyName,
            r.referenceNo,
            r.matchedInvoiceNo || 'Unmatched',
            formatINR(r.creditAmount),
            formatINR(r.tdsAmount),
            formatINR(r.balanceRemaining || 0),
          ],
        })),
        totalsLabel: 'TOTAL CREDITS :',
        totalsLine1: ['', '', '', '', formatINR(sumCredit), formatINR(sumTds), formatINR(sumGross)],
        totalAmountForWords: sumGross,
      },
      company
    );
    onOpenPreview(pdf);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Party-Only Bank Receipt &amp; TDS Auto-Import ({activeFy})
              </h2>
              <p className="text-xs text-slate-600">
                Upload .xlsx / .csv bank statement. Debit/Withdrawal rows are strictly ignored. Auto-matches pending bills &amp; detects 194C TDS.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handlePrintSummary()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF / Share Statement
          </button>
        </div>

        {!readOnly && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 items-center">
            <div className="md:col-span-4">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Target Company Bank Account
              </label>
              <select
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
              >
                {bankNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4 flex items-center gap-2 pt-4 md:pt-5">
              <input
                id="drc-drive-stmt-mirror"
                type="checkbox"
                checked={mirrorDrive}
                onChange={(e) => setMirrorDrive(e.target.checked)}
                className="w-4 h-4 accent-blue-700"
              />
              <label htmlFor="drc-drive-stmt-mirror" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <CloudUpload className="w-3.5 h-3.5 text-blue-700" />
                Save Statement to Drive ({activeFy})
              </label>
            </div>

            <div className="md:col-span-4 flex justify-end pt-2 md:pt-4">
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-sm">
                <Upload className="w-4 h-4" />
                {importing ? 'Parsing Receipts...' : 'Upload Bank Statement (.xlsx / .csv)'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={importing}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileUpload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        )}

        {statusMsg && (
          <div className="px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}
      </div>

      {/* Inline Editable Reconciliation Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            Matched &amp; Editable Party Credit Receipts ({fyReceipts.length})
          </span>
          <span className="text-[11px] font-bold text-slate-500">
            Strictly FY-isolated: {activeFy}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2.5">Date</th>
                <th className="p-2.5">Party Name</th>
                <th className="p-2.5">Cheque / UTR</th>
                <th className="p-2.5">Matched Invoice</th>
                <th className="p-2.5 text-right">Bill Amt</th>
                <th className="p-2.5 text-right">Net Received</th>
                <th className="p-2.5 text-right">Auto TDS (Rs.)</th>
                <th className="p-2.5 text-right">Balance</th>
                <th className="p-2.5 text-center">Reconcile</th>
              </tr>
            </thead>
            <tbody>
              {fyReceipts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-500">
                    No Credit receipts imported for {activeFy}. Upload a bank Excel/CSV above.
                  </td>
                </tr>
              ) : (
                fyReceipts.map((rec) => (
                  <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-mono-num whitespace-nowrap">
                      {formatDateDDMMYYYY(rec.receiptDate)}
                    </td>
                    <td className="p-2 min-w-[160px]">
                      <input
                        type="text"
                        disabled={readOnly}
                        value={rec.partyName}
                        onChange={(e) =>
                          void handleUpdateReceiptField(rec, { partyName: e.target.value })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-200 bg-white text-xs font-bold"
                      />
                    </td>
                    <td className="p-2 min-w-[115px]">
                      <input
                        type="text"
                        disabled={readOnly}
                        value={rec.referenceNo}
                        onChange={(e) =>
                          void handleUpdateReceiptField(rec, { referenceNo: e.target.value })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-200 bg-white text-xs font-mono-num"
                      />
                    </td>
                    <td className="p-2 min-w-[165px]">
                      <select
                        disabled={readOnly || rec.appliedToInvoice}
                        value={rec.matchedInvoiceId || ''}
                        onChange={(e) =>
                          void handleUpdateReceiptField(rec, {
                            matchedInvoiceId: e.target.value || undefined,
                          })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-200 bg-white text-xs font-semibold"
                      >
                        <option value="">-- Select Bill --</option>
                        {fyInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNo} ({inv.partyName.slice(0, 18)})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-right font-mono-num">
                      {formatINR(rec.billAmount || 0)}
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        disabled={readOnly || rec.appliedToInvoice}
                        value={rec.creditAmount}
                        onChange={(e) =>
                          void handleUpdateReceiptField(rec, {
                            creditAmount: Math.max(0, Number(e.target.value || 0)),
                          })
                        }
                        className="w-24 px-2 py-1 rounded border border-slate-200 bg-white text-right font-mono-num font-bold text-emerald-800"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        disabled={readOnly || rec.appliedToInvoice}
                        value={rec.tdsAmount}
                        onChange={(e) =>
                          void handleUpdateReceiptField(rec, {
                            tdsAmount: Math.max(0, Number(e.target.value || 0)),
                          })
                        }
                        className="w-20 px-2 py-1 rounded border border-slate-200 bg-white text-right font-mono-num font-bold text-amber-800"
                      />
                    </td>
                    <td className="p-2 text-right font-mono-num font-bold">
                      {formatINR(rec.balanceRemaining || 0)}
                    </td>
                    <td className="p-2 text-center whitespace-nowrap">
                      {rec.appliedToInvoice ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 text-emerald-900 text-[11px] font-bold">
                          <CheckCircle2 className="w-3 h-3" /> Posted
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          {!readOnly && (
                            <button
                              type="button"
                              disabled={!rec.matchedInvoiceId}
                              onClick={() => void handleApplyToInvoice(rec)}
                              className="px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-[11px] font-bold cursor-pointer"
                            >
                              Apply
                            </button>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(rec)}
                              className="p-1 rounded text-red-600 hover:bg-red-50 cursor-pointer"
                              title="Delete Row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Bank Receipt Row?"
        description={`Remove receipt "${deleteTarget?.referenceNo || ''}" (Rs. ${formatINR(
          deleteTarget?.creditAmount || 0
        )}) from imported reconciliation list?`}
        variant="danger"
        confirmLabel="Delete Row"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await removeDocument('bank_receipts', deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
};
