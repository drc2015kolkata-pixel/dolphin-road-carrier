import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  CloudUpload,
  FileSpreadsheet,
  Landmark,
  MessageSquareText,
  Printer,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { uploadBankStatementMirrorToDrive } from '../lib/driveBackup';
import { sheetToObjectsSmartHeader } from '../lib/excelImport';
import {
  bulkUpsertDocuments,
  logBranchActivity,
  removeDocument,
  upsertDocument,
} from '../lib/firestoreStore';
import { formatDateDDMMYYYY, formatINR, makeSafeDocId, todayISO } from '../lib/formatters';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { validateSafeUploadFile } from '../lib/gstinValidator';
import {
  buildAutomaticNarration,
  extractPaymentMetadata,
  formatReferenceChain,
} from '../lib/paymentNarration';
import { GeneratedPdfResult, generateFoxproStatementPDF } from '../lib/pdfEngine';
import { BankReceiptRecord, CompanySettings, Invoice } from '../types/erp';
import { ConfirmModal } from './ConfirmModal';
import { SearchableSelect } from './SearchableSelect';
import { PAYMENT_MODE_OPTIONS } from '../lib/dropdownMasterStore';

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
    const rawRefCol = String(
      findVal([/chq/, /cheque/, /utr/, /upi/, /ref/, /instrument/]) || ''
    ).trim();
    const rawModeCol = String(findVal([/mode/, /channel/]) || '').trim();
    const explicitUpi = String(findVal([/upi\s*ref/, /upi\s*id/]) || '').trim();
    const explicitUtr = String(findVal([/\butr\b/]) || '').trim();
    const explicitCheque = String(findVal([/chq/, /cheque/]) || '').trim();

    const meta = extractPaymentMetadata({
      description,
      referenceNo: rawRefCol,
      rawMode: rawModeCol,
    });
    const upiRefId = explicitUpi || meta.upiRefId;
    const utrNo = explicitUtr || meta.utrNo;
    const chequeNo = explicitCheque || meta.chequeNo;
    const referenceNo = meta.primaryReferenceNo || rawRefCol || `UTR-${idx + 1}`;

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

    const resolvedPartyName =
      matchedInv?.partyName ||
      rawPartyHint ||
      (description.split(/[\/\-]/)[0] || 'Unmatched Party').trim().slice(0, 50);

    const narration = buildAutomaticNarration({
      txType: 'Income',
      partyName: resolvedPartyName,
      amount: creditAmt,
      paymentMode: meta.paymentMode,
      upiRefId,
      utrNo,
      chequeNo,
      referenceNo,
      linkedInvoiceNo: matchedInv?.invoiceNo,
      bankAccountName: params.bankAccountName,
      tdsAmount,
    });

    results.push({
      id: `brec_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      financialYear: params.activeFy,
      receiptDate,
      bankAccountName: params.bankAccountName,
      partyName: resolvedPartyName,
      paymentMode: meta.paymentMode,
      referenceNo,
      upiRefId,
      utrNo,
      chequeNo,
      narration,
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

const MONTH_ABBR: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

export interface ParsedSmsCreditDraft {
  receiptDate: string;
  creditAmount: number;
  partyName: string;
  paymentMode: string;
  utrNo: string;
  upiRefId: string;
  chequeNo: string;
  matchedInvoiceId: string;
  tdsAmount: number;
  looksLikeDebit: boolean;
}

export function parseBankCreditAlertText(
  rawText: string,
  invoices: Invoice[],
  activeFy: string
): ParsedSmsCreditDraft {
  const text = String(rawText || '').trim();
  const looksLikeDebit =
    /\b(debited|withdrawn|paid\s+to|dr\b|spent)\b/i.test(text) &&
    !/\b(credited|received|deposited|cr\b)\b/i.test(text);

  // Extract 2-decimal paise amount (e.g. INR 1,01,150.50 | Rs. 45000.00 | ₹25,400.75)
  let creditAmount = 0;
  const amtMatches = [
    ...text.matchAll(
      /(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|(?:credited\s*(?:with|by|for)?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?))/gi
    ),
  ];
  for (const m of amtMatches) {
    const rawNum = (m[1] || m[2] || '').replace(/,/g, '');
    const n = Math.round(Number(rawNum) * 100) / 100;
    if (Number.isFinite(n) && n > 0) {
      creditAmount = n;
      break;
    }
  }

  // Extract Date
  let receiptDate = todayISO();
  const isoHit = text.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  const dmyHit = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  const dMonHit = text.match(/\b(\d{1,2})[\s\-]([A-Za-z]{3})[\s\-]?(\d{2,4})\b/);
  if (isoHit) {
    receiptDate = `${isoHit[1]}-${isoHit[2].padStart(2, '0')}-${isoHit[3].padStart(2, '0')}`;
  } else if (dmyHit) {
    const y = dmyHit[3].length === 2 ? `20${dmyHit[3]}` : dmyHit[3];
    receiptDate = `${y}-${dmyHit[2].padStart(2, '0')}-${dmyHit[1].padStart(2, '0')}`;
  } else if (dMonHit) {
    const mon = MONTH_ABBR[dMonHit[2].toLowerCase()];
    if (mon) {
      const y = dMonHit[3].length === 2 ? `20${dMonHit[3]}` : dMonHit[3];
      receiptDate = `${y}-${mon}-${dMonHit[1].padStart(2, '0')}`;
    }
  }

  const meta = extractPaymentMetadata({ description: text, referenceNo: text });
  const utrMatch = text.match(/(?:UTR(?:\s*No\.?)?|Ref(?:\s*No\.?)?|IMPS\s*Ref)[:\s#-]*([A-Z0-9]{6,26})/i);
  const utrNo = meta.utrNo || (utrMatch ? utrMatch[1].toUpperCase() : '');

  // Extract Party hint after "from" / "by"
  let partyHint = '';
  const fromMatch = text.match(
    /(?:received\s+from|credited\s+by|from|by\s+party)\s+([A-Za-z0-9 &.,()\/-]{3,50}?)(?=\s+(?:via|on|ref|utr|upi|imps|neft|rtgs|info|a\/c|bal|avail|$))/i
  );
  if (fromMatch && fromMatch[1]) {
    partyHint = fromMatch[1].replace(/[.,\s]+$/, '').trim();
  }

  const fyInvoices = invoices.filter(
    (inv) => !inv.financialYear || inv.financialYear === activeFy
  );
  const searchPool = [
    ...fyInvoices.filter((inv) => inv.status !== 'Paid'),
    ...fyInvoices.filter((inv) => inv.status === 'Paid'),
  ];
  const lowered = `${partyHint} ${text}`.toLowerCase();
  let matchedInv: Invoice | undefined;
  for (const inv of searchPool) {
    const invNoClean = (inv.invoiceNo || '').toLowerCase();
    const tokens = (inv.partyName || '')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    const pending = Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));
    if (invNoClean && lowered.includes(invNoClean)) {
      matchedInv = inv;
      break;
    }
    if (tokens.some((tok) => lowered.includes(tok))) {
      matchedInv = inv;
      break;
    }
    if (creditAmount > 0 && pending > 0 && Math.abs(pending - creditAmount) <= pending * 0.025) {
      matchedInv = inv;
      break;
    }
  }

  let tdsAmount = 0;
  if (matchedInv && creditAmount > 0) {
    const pending = Math.max(
      0,
      Number(matchedInv.grandTotal || 0) - Number(matchedInv.paidAmount || 0)
    );
    if (pending > creditAmount) {
      const diff = Math.round((pending - creditAmount) * 100) / 100;
      const pct = (diff / Math.max(1, pending)) * 100;
      if (pct >= 0.8 && pct <= 2.3) {
        tdsAmount = diff;
      }
    }
  }

  return {
    receiptDate,
    creditAmount,
    partyName: matchedInv?.partyName || partyHint || '',
    paymentMode: meta.paymentMode || 'NEFT',
    utrNo,
    upiRefId: meta.upiRefId || '',
    chequeNo: meta.chequeNo || '',
    matchedInvoiceId: matchedInv?.id || '',
    tdsAmount,
    looksLikeDebit,
  };
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

  // Smart Bank Credit Reader (SMS / Email Alert Auto-Parser)
  const [smsAlertText, setSmsAlertText] = useState('');
  const [smsDraft, setSmsDraft] = useState<ParsedSmsCreditDraft | null>(null);
  const [smsWarn, setSmsWarn] = useState<string | null>(null);
  const [savingSms, setSavingSms] = useState(false);

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

  const bankKpis = useMemo(() => {
    const totalBilled = fyInvoices.reduce((s, inv) => s + Number(inv.grandTotal || 0), 0);
    const totalReceived = fyReceipts.reduce((s, r) => s + Number(r.creditAmount || 0), 0);
    const totalTds = fyReceipts.reduce((s, r) => s + Number(r.tdsAmount || 0), 0);
    const netBalance = Math.max(0, totalBilled - totalReceived - totalTds);
    return { totalBilled, totalReceived, totalTds, netBalance };
  }, [fyInvoices, fyReceipts]);

  const handleFileUpload = async (file: File) => {
    if (readOnly) return;
    const uploadCheck = validateSafeUploadFile(file, 'spreadsheet');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setStatusMsg(uploadCheck.reason || 'Blocked unsupported spreadsheet file.');
      return;
    }
    setImporting(true);
    setStatusMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('Uploaded file has no worksheets.');
      const ws = wb.Sheets[firstSheet];
      const smartRows = sheetToObjectsSmartHeader(ws);
      const rows =
        smartRows.length > 0
          ? smartRows
          : XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
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

      playVerifiedBeep();
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

  const handleParseSmsAlert = () => {
    setSmsWarn(null);
    if (!smsAlertText.trim()) {
      setSmsWarn('Paste a Bank Credit SMS or Email alert first.');
      return;
    }
    const parsed = parseBankCreditAlertText(smsAlertText, fyInvoices, activeFy);
    if (parsed.looksLikeDebit) {
      setSmsWarn('Warning: This alert appears to be a DEBIT / Withdrawal notification. Only Customer Credit alerts should create Receipt Vouchers.');
    }
    if (parsed.creditAmount <= 0) {
      setSmsWarn('Could not detect a valid numeric credit amount. Enter the Amount manually in the preview below.');
    }
    setSmsDraft(parsed);
  };

  const handleCreateSmsReceiptVoucher = async () => {
    if (readOnly || !smsDraft) return;
    if (smsDraft.creditAmount <= 0) {
      setSmsWarn('Net Received Amount must be greater than Rs. 0.00.');
      return;
    }
    if (!smsDraft.partyName.trim()) {
      setSmsWarn('Enter or select a Customer / Party Name before creating Receipt Voucher.');
      return;
    }

    setSavingSms(true);
    setSmsWarn(null);
    try {
      const matchedInv = smsDraft.matchedInvoiceId
        ? fyInvoices.find((i) => i.id === smsDraft.matchedInvoiceId)
        : undefined;
      const partyName = matchedInv?.partyName || smsDraft.partyName.trim();
      const refPrimary =
        smsDraft.utrNo || smsDraft.upiRefId || smsDraft.chequeNo || `SMS-${Date.now().toString().slice(-6)}`;
      const tdsAmt = Math.round(Math.max(0, Number(smsDraft.tdsAmount || 0)) * 100) / 100;
      const netAmt = Math.round(Number(smsDraft.creditAmount || 0) * 100) / 100;
      const grossSettled = Math.round((netAmt + tdsAmt) * 100) / 100;

      let nextStatus: Invoice['status'] | undefined;
      let balanceRemaining = 0;

      if (matchedInv) {
        const nextPaid = Math.min(
          Number(matchedInv.grandTotal || 0),
          Math.round((Number(matchedInv.paidAmount || 0) + grossSettled) * 100) / 100
        );
        nextStatus = nextPaid >= Number(matchedInv.grandTotal || 0) - 1 ? 'Paid' : 'Partial';
        balanceRemaining = Math.max(0, Math.round((Number(matchedInv.grandTotal || 0) - nextPaid) * 100) / 100);
        await upsertDocument(
          'invoices',
          matchedInv.id,
          {
            ...matchedInv,
            paidAmount: nextPaid,
            status: nextStatus,
          },
          false
        );
      }

      const autoNarration = buildAutomaticNarration({
        txType: 'Income',
        partyName,
        amount: netAmt,
        paymentMode: smsDraft.paymentMode || 'NEFT',
        upiRefId: smsDraft.upiRefId,
        utrNo: smsDraft.utrNo,
        chequeNo: smsDraft.chequeNo,
        referenceNo: refPrimary,
        linkedInvoiceNo: matchedInv?.invoiceNo,
        bankAccountName: selectedBank,
        tdsAmount: tdsAmt,
      });

      const txId = makeSafeDocId('tx_sms');
      await upsertDocument(
        'transactions',
        txId,
        {
          id: txId,
          txCode: `SMS-${refPrimary}`,
          txDate: smsDraft.receiptDate || todayISO(),
          financialYear: activeFy,
          txType: 'Income',
          ledgerAccount: selectedBank,
          partyName,
          amount: netAmt,
          narration: autoNarration,
          paymentMode: smsDraft.paymentMode || 'NEFT',
          referenceNo: refPrimary,
          upiRefId: smsDraft.upiRefId || '',
          utrNo: smsDraft.utrNo || '',
          chequeNo: smsDraft.chequeNo || '',
          tdsAmount: tdsAmt,
          ...(matchedInv ? { linkedInvoiceNo: matchedInv.invoiceNo } : {}),
          branchCode: currentBranchCode,
          createdByStaff: currentStaffCode,
          ownerUid,
        },
        true
      );

      const recId = makeSafeDocId('brec_sms');
      await upsertDocument(
        'bank_receipts',
        recId,
        {
          id: recId,
          financialYear: activeFy,
          receiptDate: smsDraft.receiptDate || todayISO(),
          bankAccountName: selectedBank,
          partyName,
          paymentMode: smsDraft.paymentMode || 'NEFT',
          referenceNo: refPrimary,
          upiRefId: smsDraft.upiRefId || '',
          utrNo: smsDraft.utrNo || '',
          chequeNo: smsDraft.chequeNo || '',
          narration: autoNarration,
          description: smsAlertText.trim().slice(0, 240),
          creditAmount: netAmt,
          tdsRatePct: matchedInv && netAmt + tdsAmt > 0 ? Math.round((tdsAmt / (netAmt + tdsAmt)) * 1000) / 10 : 0,
          tdsAmount: tdsAmt,
          grossSettled,
          ...(matchedInv ? { matchedInvoiceId: matchedInv.id, matchedInvoiceNo: matchedInv.invoiceNo } : {}),
          billAmount: matchedInv ? Number(matchedInv.grandTotal || 0) : netAmt,
          balanceRemaining,
          appliedToInvoice: Boolean(matchedInv),
          sourceFileName: 'Smart_SMS_Email_Reader',
          branchCode: currentBranchCode,
          createdByStaff: currentStaffCode,
          ownerUid,
        },
        true
      );

      await logBranchActivity({
        action: 'CREATE_SMS_BANK_RECEIPT',
        module: 'BANK_IMPORT',
        docRefCode: refPrimary,
        summary: `Auto-created Receipt Voucher Rs. ${formatINR(netAmt)} from ${partyName} (${smsDraft.paymentMode})${
          matchedInv ? ` against ${matchedInv.invoiceNo} -> ${nextStatus}` : ''
        }`,
        staffCode: currentStaffCode,
        branchCode: currentBranchCode,
        ownerUid,
      });

      playVerifiedBeep();
      setStatusMsg(
        `Receipt Voucher Created & Party Ledger Updated: Rs. ${formatINR(netAmt)}${
          tdsAmt > 0 ? ` + TDS Rs. ${formatINR(tdsAmt)}` : ''
        } from ${partyName}${matchedInv ? ` (Invoice ${matchedInv.invoiceNo}: ${nextStatus})` : ''}.`
      );
      setSmsAlertText('');
      setSmsDraft(null);
    } finally {
      setSavingSms(false);
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
    next.referenceNo =
      next.upiRefId || next.utrNo || next.chequeNo || next.referenceNo || '';
    if (!('narration' in patch)) {
      next.narration = buildAutomaticNarration({
        txType: 'Income',
        partyName: next.partyName,
        amount: next.creditAmount,
        paymentMode: next.paymentMode || 'Bank Transfer',
        upiRefId: next.upiRefId,
        utrNo: next.utrNo,
        chequeNo: next.chequeNo,
        referenceNo: next.referenceNo,
        linkedInvoiceNo: next.matchedInvoiceNo,
        bankAccountName: next.bankAccountName,
        tdsAmount: next.tdsAmount,
      });
    }

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

    const txMode = rec.paymentMode || 'NEFT';
    const refPrimary = rec.upiRefId || rec.utrNo || rec.chequeNo || rec.referenceNo || '';
    const autoNarration =
      rec.narration ||
      buildAutomaticNarration({
        txType: 'Income',
        partyName: inv.partyName,
        amount: rec.creditAmount,
        paymentMode: txMode,
        upiRefId: rec.upiRefId,
        utrNo: rec.utrNo,
        chequeNo: rec.chequeNo,
        referenceNo: refPrimary,
        linkedInvoiceNo: inv.invoiceNo,
        bankAccountName: rec.bankAccountName,
        tdsAmount: rec.tdsAmount,
      });

    const txId = `tx_bank_${Date.now()}`;
    await upsertDocument(
      'transactions',
      txId,
      {
        id: txId,
        txCode: `BNK-${refPrimary || rec.id.slice(-4)}`,
        txDate: rec.receiptDate,
        financialYear: activeFy,
        txType: 'Income',
        ledgerAccount: rec.bankAccountName,
        partyName: inv.partyName,
        amount: rec.creditAmount,
        narration: autoNarration,
        paymentMode: txMode,
        referenceNo: refPrimary,
        upiRefId: rec.upiRefId || '',
        utrNo: rec.utrNo || '',
        chequeNo: rec.chequeNo || '',
        tdsAmount: rec.tdsAmount || 0,
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
        narration: autoNarration,
        appliedToInvoice: true,
        balanceRemaining: Math.max(0, Number(inv.grandTotal || 0) - nextPaid),
      },
      false
    );

    playVerifiedBeep();
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
        summaryLines: [
          { label: 'Total Billed', value: `Rs. ${formatINR(bankKpis.totalBilled)}` },
          { label: 'Total Received', value: `Rs. ${formatINR(bankKpis.totalReceived)}` },
          { label: 'Total TDS Deducted', value: `Rs. ${formatINR(bankKpis.totalTds)}` },
          { label: 'Net Balance', value: `Rs. ${formatINR(bankKpis.netBalance)}` },
        ],
        columns: [
          { label: 'DATE', widthPct: 10 },
          { label: 'PARTY NAME / NARRATION', widthPct: 28 },
          { label: 'MODE / UPI / UTR / CHQ', widthPct: 20 },
          { label: 'BILL NO', widthPct: 12 },
          { label: 'NET RECEIVED', widthPct: 10, align: 'right' },
          { label: 'AUTO TDS', widthPct: 10, align: 'right' },
          { label: 'BALANCE', widthPct: 10, align: 'right' },
        ],
        rows: fyReceipts.map((r) => {
          const refChain = formatReferenceChain({
            upiRefId: r.upiRefId,
            utrNo: r.utrNo,
            chequeNo: r.chequeNo,
            referenceNo: r.referenceNo,
          });
          return {
            line1: [
              formatDateDDMMYYYY(r.receiptDate),
              r.partyName,
              `${r.paymentMode || 'Bank Transfer'} ${r.upiRefId || r.utrNo || r.chequeNo || r.referenceNo}`,
              r.matchedInvoiceNo || 'Unmatched',
              formatINR(r.creditAmount),
              formatINR(r.tdsAmount),
              formatINR(r.balanceRemaining || 0),
            ],
            line2: [
              '',
              r.narration || buildAutomaticNarration({
                txType: 'Income',
                partyName: r.partyName,
                amount: r.creditAmount,
                paymentMode: r.paymentMode,
                upiRefId: r.upiRefId,
                utrNo: r.utrNo,
                chequeNo: r.chequeNo,
                referenceNo: r.referenceNo,
                linkedInvoiceNo: r.matchedInvoiceNo,
                tdsAmount: r.tdsAmount,
              }),
              refChain || '-',
              r.bankAccountName || '',
              '',
              '',
              '',
            ],
          };
        }),
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
      {/* Top 4 KPI Summary Badges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-3.5">
          <p className="text-[11px] font-bold uppercase text-blue-700">Total Billed ({activeFy})</p>
          <p className="text-lg font-extrabold font-mono-num text-slate-900 mt-0.5">
            ₹ {formatINR(bankKpis.totalBilled)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-3.5">
          <p className="text-[11px] font-bold uppercase text-emerald-700">Total Received (Net)</p>
          <p className="text-lg font-extrabold font-mono-num text-emerald-800 mt-0.5">
            ₹ {formatINR(bankKpis.totalReceived)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-3.5">
          <p className="text-[11px] font-bold uppercase text-amber-800">Total TDS Deducted</p>
          <p className="text-lg font-extrabold font-mono-num text-amber-900 mt-0.5">
            ₹ {formatINR(bankKpis.totalTds)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-rose-200 shadow-sm p-3.5">
          <p className="text-[11px] font-bold uppercase text-rose-700">Net Balance Receivable</p>
          <p className="text-lg font-extrabold font-mono-num text-rose-900 mt-0.5">
            ₹ {formatINR(bankKpis.netBalance)}
          </p>
        </div>
      </div>

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
                Upload .xlsx / .csv bank statement. Extracts Payment Mode, UPI Ref ID, UTR No., Cheque No., auto-writes accounting narration &amp; detects 194C TDS.
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

        {/* SMART BANK CREDIT SMS / EMAIL ALERT READER */}
        {!readOnly && (
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-blue-950">
                <MessageSquareText className="w-4 h-4 text-blue-700" />
                <span>Smart Bank Credit Reader (Paste Bank SMS / Email Credit Alert &rarr; Auto-Receipt)</span>
              </div>
              <span className="text-[11px] font-semibold text-blue-700">
                Auto-extracts Date, ₹ Amount (paise), Party Name, NEFT/RTGS/IMPS/UPI &amp; UTR No.
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <textarea
                rows={2}
                value={smsAlertText}
                onChange={(e) => setSmsAlertText(e.target.value)}
                placeholder='Paste Bank SMS/Email e.g.: "Ac X4252 credited with INR 1,01,150.50 on 15-11-2026 by NEFT UTR PUNBR52026111500912345 from TATA STEEL LTD against Inv KOL-0042."'
                className="flex-1 px-3 py-2 rounded-lg border border-blue-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                onClick={handleParseSmsAlert}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-xs font-extrabold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                Extract Credit Alert
              </button>
            </div>

            {smsWarn && (
              <div className="px-3 py-1.5 rounded bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-bold">
                {smsWarn}
              </div>
            )}

            {smsDraft && (
              <div className="p-3 rounded-lg bg-white border border-emerald-300 space-y-2.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Credit Date</label>
                    <input
                      type="date"
                      value={smsDraft.receiptDate}
                      onChange={(e) => setSmsDraft({ ...smsDraft, receiptDate: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Party / Customer Name *</label>
                    <input
                      type="text"
                      value={smsDraft.partyName}
                      onChange={(e) => setSmsDraft({ ...smsDraft, partyName: e.target.value })}
                      placeholder="Customer / Payer Name"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Payment Mode</label>
                    <SearchableSelect
                      ariaLabel="SMS Receipt Mode"
                      value={smsDraft.paymentMode}
                      onChange={(val) => setSmsDraft({ ...smsDraft, paymentMode: val })}
                      options={PAYMENT_MODE_OPTIONS}
                      triggerClassName="!py-1.5 !font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">UTR / Ref No.</label>
                    <input
                      type="text"
                      value={smsDraft.utrNo || smsDraft.upiRefId || smsDraft.chequeNo}
                      onChange={(e) => setSmsDraft({ ...smsDraft, utrNo: e.target.value.toUpperCase() })}
                      placeholder="UTR / UPI Ref"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-emerald-800 mb-1">Credit Amount (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={smsDraft.creditAmount}
                      onChange={(e) =>
                        setSmsDraft({ ...smsDraft, creditAmount: Math.max(0, Number(e.target.value || 0)) })
                      }
                      className="w-full px-2 py-1.5 rounded border border-emerald-400 font-mono-num font-extrabold text-emerald-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Match Unpaid / Partial Tax Invoice (Optional)
                    </label>
                    <SearchableSelect
                      ariaLabel="Match Tax Invoice"
                      value={smsDraft.matchedInvoiceId}
                      onChange={(invId) => {
                        const hit = fyInvoices.find((i) => i.id === invId);
                        setSmsDraft({
                          ...smsDraft,
                          matchedInvoiceId: invId,
                          partyName: hit?.partyName || smsDraft.partyName,
                        });
                      }}
                      options={[
                        { value: '', label: '-- Direct Advance / On-Account Receipt (No Bill) --', pinFirst: true },
                        ...fyInvoices.map((inv) => ({
                          value: inv.id,
                          label: `${inv.invoiceNo} | ${inv.partyName} (Due ₹${formatINR(
                            Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0))
                          )})`,
                        })),
                      ]}
                      triggerClassName="!py-1.5 !font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-amber-800 mb-1">194C TDS Deducted (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={smsDraft.tdsAmount}
                      onChange={(e) =>
                        setSmsDraft({ ...smsDraft, tdsAmount: Math.max(0, Number(e.target.value || 0)) })
                      }
                      className="w-full px-2 py-1.5 rounded border border-amber-300 font-mono-num font-bold text-amber-900"
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSmsDraft(null)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      disabled={savingSms}
                      onClick={() => void handleCreateSmsReceiptVoucher()}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer disabled:opacity-60"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {savingSms ? 'Posting...' : 'Auto-Create Receipt Voucher & Update Ledger'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!readOnly && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 items-center">
            <div className="md:col-span-4">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Target Company Bank Account
              </label>
              <SearchableSelect
                ariaLabel="Target Company Bank Account"
                value={selectedBank}
                onChange={setSelectedBank}
                options={bankNames.map((n) => ({ value: n, label: n }))}
                triggerClassName="!py-2 !font-bold"
                searchPlaceholder="Search bank account..."
              />
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
                <th className="p-2.5">Party Name &amp; Auto-Narration</th>
                <th className="p-2.5">Payment Mode</th>
                <th className="p-2.5">UPI Ref / UTR No. / Cheque No.</th>
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
                  <td colSpan={10} className="p-6 text-center text-slate-500">
                    No Credit receipts imported for {activeFy}. Upload a bank Excel/CSV above.
                  </td>
                </tr>
              ) : (
                fyReceipts.map((rec) => {
                  const autoNarrationText =
                    rec.narration ||
                    buildAutomaticNarration({
                      txType: 'Income',
                      partyName: rec.partyName,
                      amount: rec.creditAmount,
                      paymentMode: rec.paymentMode || 'Bank Transfer',
                      upiRefId: rec.upiRefId,
                      utrNo: rec.utrNo,
                      chequeNo: rec.chequeNo,
                      referenceNo: rec.referenceNo,
                      linkedInvoiceNo: rec.matchedInvoiceNo,
                      bankAccountName: rec.bankAccountName,
                      tdsAmount: rec.tdsAmount,
                    });
                  return (
                    <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                      <td className="p-2 font-mono-num whitespace-nowrap">
                        {formatDateDDMMYYYY(rec.receiptDate)}
                      </td>
                      <td className="p-2 min-w-[210px] space-y-1">
                        <input
                          type="text"
                          disabled={readOnly}
                          value={rec.partyName}
                          onChange={(e) =>
                            void handleUpdateReceiptField(rec, { partyName: e.target.value })
                          }
                          className="w-full px-2 py-1 rounded border border-slate-200 bg-white text-xs font-bold"
                        />
                        <p className="text-[10px] text-slate-600 leading-snug">
                          {autoNarrationText}
                        </p>
                      </td>
                      <td className="p-2 min-w-[115px]">
                        <SearchableSelect
                          ariaLabel="Payment Mode"
                          disabled={readOnly || rec.appliedToInvoice}
                          value={rec.paymentMode || 'NEFT'}
                          onChange={(val) =>
                            void handleUpdateReceiptField(rec, { paymentMode: val })
                          }
                          options={PAYMENT_MODE_OPTIONS}
                          triggerClassName="!py-1 !font-bold"
                        />
                      </td>
                      <td className="p-2 min-w-[185px] space-y-1">
                        <input
                          type="text"
                          disabled={readOnly}
                          value={rec.upiRefId || ''}
                          onChange={(e) =>
                            void handleUpdateReceiptField(rec, { upiRefId: e.target.value })
                          }
                          placeholder="UPI Ref ID"
                          className="w-full px-2 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-mono-num"
                        />
                        <input
                          type="text"
                          disabled={readOnly}
                          value={rec.utrNo || ''}
                          onChange={(e) =>
                            void handleUpdateReceiptField(rec, { utrNo: e.target.value })
                          }
                          placeholder="UTR No."
                          className="w-full px-2 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-mono-num"
                        />
                        <input
                          type="text"
                          disabled={readOnly}
                          value={rec.chequeNo || ''}
                          onChange={(e) =>
                            void handleUpdateReceiptField(rec, { chequeNo: e.target.value })
                          }
                          placeholder="Cheque No."
                          className="w-full px-2 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-mono-num"
                        />
                      </td>
                      <td className="p-2 min-w-[165px]">
                        <SearchableSelect
                          ariaLabel="Matched Invoice"
                          disabled={readOnly || rec.appliedToInvoice}
                          value={rec.matchedInvoiceId || ''}
                          onChange={(val) =>
                            void handleUpdateReceiptField(rec, {
                              matchedInvoiceId: val || undefined,
                            })
                          }
                          options={[
                            { value: '', label: '-- Select Bill --', pinFirst: true },
                            ...fyInvoices.map((inv) => ({
                              value: inv.id,
                              label: `${inv.invoiceNo} (${inv.partyName.slice(0, 18)})`,
                            })),
                          ]}
                          triggerClassName="!py-1 !font-semibold"
                          searchPlaceholder="Search invoice / party..."
                        />
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
                  );
                })
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
