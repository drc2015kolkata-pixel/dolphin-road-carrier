import { formatINR } from './formatters';

export type NormalizedPaymentMode =
  | 'UPI'
  | 'NEFT'
  | 'RTGS'
  | 'Cheque'
  | 'Cash'
  | 'Advance'
  | 'Bank Transfer';

export interface ExtractedPaymentMetadata {
  paymentMode: NormalizedPaymentMode;
  upiRefId: string;
  utrNo: string;
  chequeNo: string;
  primaryReferenceNo: string;
}

/**
 * Extracts structured UPI Reference ID, UTR No., Cheque No., and Payment Mode
 * from raw PNB / bank narration text and instrument reference columns.
 */
export function extractPaymentMetadata(params: {
  description?: string;
  referenceNo?: string;
  rawMode?: string;
}): ExtractedPaymentMetadata {
  const desc = String(params.description || '').trim();
  const ref = String(params.referenceNo || '').trim();
  const modeHint = String(params.rawMode || '').trim();
  const combined = `${modeHint} ${desc} ${ref}`.trim();
  const upper = combined.toUpperCase();

  let upiRefId = '';
  let utrNo = '';
  let chequeNo = '';
  let paymentMode: NormalizedPaymentMode = 'Bank Transfer';

  // 1. Detect UPI / VPA / 12-digit RRN
  const upiMatch =
    combined.match(/\bUPI(?:AR|CR|DR|P2M|P2P)?[\/:\-\s]+([A-Z0-9._@-]{6,32})/i) ||
    combined.match(/\b([a-z0-9._-]+@[a-z]{2,20})\b/i);
  const upiDigitRrn = /\bUPI\b/i.test(upper)
    ? combined.match(/\b(\d{12})\b/)
    : null;

  if (upiMatch?.[1]) {
    upiRefId = upiMatch[1].trim();
  } else if (upiDigitRrn?.[1]) {
    upiRefId = upiDigitRrn[1];
  }

  // 2. Detect UTR No. (NEFT / RTGS / IMPS / PNB PUNB... codes)
  const utrMatch =
    combined.match(/\bUTR[:\s\-\/#]*([A-Z0-9]{10,24})/i) ||
    combined.match(/\b(?:NEFT|RTGS|IMPS)[\/:\-\s]+([A-Z0-9]{8,24})/i) ||
    combined.match(/\b(PUNB[A-Z0-9]{8,18}|HDFC[A-Z0-9]{8,18}|ICIC[A-Z0-9]{8,18}|SBIN[A-Z0-9]{8,18}|AXIS[A-Z0-9]{8,18})\b/i);
  if (utrMatch?.[1]) {
    utrNo = utrMatch[1].toUpperCase();
  } else if (!upiRefId && /^[A-Z0-9]{10,22}$/i.test(ref) && !/^\d{6}$/.test(ref)) {
    utrNo = ref.toUpperCase();
  }

  // 3. Detect Cheque No. (6 digits / CHQ / CLG)
  const chqMatch =
    combined.match(/\b(?:CHQ|CHEQUE|CLG|INST)[:\s\-\/#.]*(\d{5,8})\b/i) ||
    (/^\d{6}$/.test(ref) ? [ref, ref] : null);
  if (chqMatch?.[1]) {
    chequeNo = chqMatch[1];
  }

  // 4. Determine Payment Mode cleanly
  if (/\bUPI\b/i.test(upper) || Boolean(upiRefId)) {
    paymentMode = 'UPI';
  } else if (/\bRTGS\b/i.test(upper)) {
    paymentMode = 'RTGS';
  } else if (/\bNEFT\b|\bIMPS\b/i.test(upper)) {
    paymentMode = 'NEFT';
  } else if (/\bCHQ\b|\bCHEQUE\b|\bCLG\b/i.test(upper) || Boolean(chequeNo)) {
    paymentMode = 'Cheque';
  } else if (/\bADVANCE\b/i.test(upper)) {
    paymentMode = 'Advance';
  } else if (/\bCASH\b/i.test(upper)) {
    paymentMode = 'Cash';
  } else if (utrNo) {
    paymentMode = 'NEFT';
  }

  const primaryReferenceNo = upiRefId || utrNo || chequeNo || ref || '';
  return {
    paymentMode,
    upiRefId,
    utrNo,
    chequeNo,
    primaryReferenceNo,
  };
}

export function formatReferenceChain(params: {
  upiRefId?: string;
  utrNo?: string;
  chequeNo?: string;
  referenceNo?: string;
}): string {
  const parts: string[] = [];
  if (params.upiRefId?.trim()) parts.push(`UPI Ref: ${params.upiRefId.trim()}`);
  if (params.utrNo?.trim()) parts.push(`UTR No: ${params.utrNo.trim()}`);
  if (params.chequeNo?.trim()) parts.push(`Cheque No: ${params.chequeNo.trim()}`);
  if (parts.length === 0 && params.referenceNo?.trim()) {
    parts.push(`Ref: ${params.referenceNo.trim()}`);
  }
  return parts.join(' | ');
}

/**
 * Generates 100% automatic accounting narration requiring zero manual typing.
 */
export function buildAutomaticNarration(params: {
  txType: 'Income' | 'Expense' | 'Bill' | 'LorryHire';
  partyName: string;
  amount: number;
  txDate?: string;
  ledgerAccount?: string;
  paymentMode?: string;
  upiRefId?: string;
  utrNo?: string;
  chequeNo?: string;
  referenceNo?: string;
  linkedInvoiceNo?: string;
  linkedCnNo?: string;
  bankAccountName?: string;
  tdsAmount?: number;
}): string {
  const party = (params.partyName || 'Account Party').trim();
  const amtText = `Rs.${formatINR(Number(params.amount || 0))}`;
  const mode = (params.paymentMode || 'Bank Transfer').trim();
  const datePart = (() => {
    const raw = String(params.txDate || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? ` Dated ${m[3]}-${m[2]}-${m[1]}` : ` Dated ${raw}`;
  })();
  const refChain = formatReferenceChain({
    upiRefId: params.upiRefId,
    utrNo: params.utrNo,
    chequeNo: params.chequeNo,
    referenceNo: params.referenceNo,
  });
  const refPart = refChain ? ` (${refChain})` : '';
  const invPart = params.linkedInvoiceNo ? ` against Bill ${params.linkedInvoiceNo}` : '';
  const cnPart = params.linkedCnNo ? ` against CN ${params.linkedCnNo}` : '';
  const bankPart = params.bankAccountName ? ` in ${params.bankAccountName}` : '';
  const tdsPart =
    Number(params.tdsAmount || 0) > 0
      ? ` + Sec 194C TDS Rs.${formatINR(Number(params.tdsAmount || 0))}`
      : '';

  if (params.txType === 'Bill') {
    return `Being freight bill ${params.linkedInvoiceNo || ''} raised to ${party} for ${amtText}${cnPart}${datePart}.`.replace(/\s+/g, ' ').trim();
  }

  if (params.txType === 'LorryHire') {
    return `Being lorry hire paid to ${party} via ${mode}${refPart} for ${amtText}${cnPart}${datePart}.`.replace(/\s+/g, ' ').trim();
  }

  if (params.txType === 'Income') {
    return `Being amount ${amtText} received from ${party} via ${mode}${refPart}${invPart}${cnPart}${tdsPart}${bankPart}${datePart}.`
      .replace(/\s+/g, ' ')
      .trim();
  }

  const acct = params.ledgerAccount ? ` (${params.ledgerAccount})` : '';
  return `Being payment of ${amtText} made to ${party}${acct} via ${mode}${refPart}${invPart}${cnPart}${bankPart}${datePart}.`
    .replace(/\s+/g, ' ')
    .trim();
}
