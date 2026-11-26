import { Invoice } from '../types/erp';
import { formatINR, getFyShortCode, normalizeFyLabel, roundPaise, todayISO } from './formatters';

export interface AutoCreditDebitNoteDraft {
  needed: boolean;
  docKind: 'Credit Note' | 'Debit Note';
  noteNo: string;
  taxableDiff: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  totalTax: number;
  grandTotal: number;
  narrationText: string;
  payload: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;
}

export function buildAutoCreditDebitNoteForRectifiedInvoice(params: {
  previousInvoice: Invoice;
  revisedInvoice: Invoice;
  existingInvoicesCount: number;
  reason?: string;
  fy: string;
  branchCode: string;
  staffCode: string;
  ownerUid: string;
}): AutoCreditDebitNoteDraft | null {
  const { previousInvoice, revisedInvoice, existingInvoicesCount, reason, fy, branchCode, staffCode, ownerUid } =
    params;

  if (previousInvoice.docKind && previousInvoice.docKind !== 'Tax Invoice') {
    return null;
  }

  const prevGrand = roundPaise(Number(previousInvoice.grandTotal || 0));
  const revGrand = roundPaise(Number(revisedInvoice.grandTotal || 0));
  const grandDiffSigned = roundPaise(revGrand - prevGrand);

  if (Math.abs(grandDiffSigned) < 0.5) {
    return null;
  }

  const isCreditNote = grandDiffSigned < 0;
  const docKind: 'Credit Note' | 'Debit Note' = isCreditNote ? 'Credit Note' : 'Debit Note';

  const prevTax = roundPaise(Number(previousInvoice.totalTax || 0));
  const revTax = roundPaise(Number(revisedInvoice.totalTax || 0));
  const absGrandDiff = roundPaise(Math.abs(grandDiffSigned));
  const absTaxDiff = roundPaise(Math.abs(revTax - prevTax));
  const isRcmOrZero = Boolean(revisedInvoice.reverseCharge || Number(revisedInvoice.gstRate || 0) === 0);
  const taxableDiff = isRcmOrZero
    ? absGrandDiff
    : roundPaise(Math.max(0, absGrandDiff - absTaxDiff));

  const interstate = Boolean(revisedInvoice.interstate);
  const cgstAmt = interstate ? 0 : roundPaise(absTaxDiff / 2);
  const sgstAmt = interstate ? 0 : roundPaise(absTaxDiff - cgstAmt);
  const igstAmt = interstate ? absTaxDiff : 0;

  const branchPref =
    (revisedInvoice.billedAtBranch || revisedInvoice.branchCode || branchCode || 'KOL')
      .replace(/[^A-Z0-9]/gi, '')
      .slice(0, 3)
      .toUpperCase() || 'KOL';
  const seq = 101 + existingInvoicesCount;
  const fyShort = getFyShortCode(fy);
  const noteNo = `${isCreditNote ? 'CRN' : 'DRN'}/${branchPref}/${seq}/${fyShort}`;

  const cleanReason =
    (reason || '').trim() ||
    (isCreditNote
      ? 'Freight / weight / shortage reduction upon bill rectification'
      : 'Supplementary freight / detention / unloading charge adjustment');

  const cnRefs = (revisedInvoice.consignmentRows || [])
    .map((r) => r.cnNo)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');

  const narrationText = `Auto ${docKind} raised against ${previousInvoice.invoiceNo} (${revisedInvoice.partyName})${cnRefs ? ` for CN ${cnRefs}` : ''}: ${cleanReason}. Prev Bill ₹${formatINR(prevGrand)} -> Revised ₹${formatINR(revGrand)} (Net ${isCreditNote ? 'Cr' : 'Dr'} ₹${formatINR(absGrandDiff)}).`;

  const payload: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'> = {
    billId: String(seq),
    invoiceNo: noteNo,
    invoiceDate: todayISO(),
    dueDate: todayISO(),
    creditDays: 0,
    poWorkOrderNo: revisedInvoice.poWorkOrderNo || '',
    docKind,
    againstInvoiceId: previousInvoice.id,
    againstInvoiceNo: previousInvoice.invoiceNo,
    creditDebitReason: cleanReason,
    finalized: true,
    roundOffAmt: 0,
    narrationText,
    financialYear: normalizeFyLabel(fy),
    division: revisedInvoice.division || 'FTL',
    billedByCode: revisedInvoice.billedByCode || 'B',
    billedAtBranch: revisedInvoice.billedAtBranch || branchCode,
    partyName: revisedInvoice.partyName,
    partyAddress: revisedInvoice.partyAddress || '',
    partyGstin: revisedInvoice.partyGstin || '',
    partyStateCode: revisedInvoice.partyStateCode || '',
    partyStateName: revisedInvoice.partyStateName || '',
    partyPan: revisedInvoice.partyPan || '',
    billingCountry: revisedInvoice.billingCountry || 'India',
    sac: revisedInvoice.sac || '996791',
    reverseCharge: Boolean(revisedInvoice.reverseCharge),
    interstate,
    gstPaidBy: revisedInvoice.gstPaidBy || 'Consignee',
    gstRate: Number(revisedInvoice.gstRate || 0),
    cgstAmt,
    sgstAmt,
    igstAmt,
    totalTax: absTaxDiff,
    freightCharges: taxableDiff,
    insuranceCharge: 0,
    collCharge: 0,
    loadingCharge: 0,
    detentionCharges: 0,
    unloadingCharges: 0,
    surchargeAmt: 0,
    stCharges: 0,
    fumigationCharge: 0,
    extraCharge: 0,
    grossBillAmount: absGrandDiff,
    advanceReceived: 0,
    advanceMode: 'Journal',
    fullPaymentMode: 'Journal',
    grandTotal: absGrandDiff,
    manualTotalOverride: false,
    paidAmount: 0,
    status: 'Unpaid',
    remarks: cleanReason,
    billFootnote: `Adjusted against Tax Invoice ${previousInvoice.invoiceNo}`,
    additionalNotes: narrationText,
    copyCount: 1,
    selectedBankId: revisedInvoice.selectedBankId || '',
    consignmentRows: [
      {
        cnNo: revisedInvoice.consignmentRows?.[0]?.cnNo || previousInvoice.invoiceNo,
        cnDate: todayISO(),
        vehicle: revisedInvoice.consignmentRows?.[0]?.vehicle || '',
        from: revisedInvoice.consignmentRows?.[0]?.from || 'KOLKATA',
        to: revisedInvoice.consignmentRows?.[0]?.to || '',
        weight: 0,
        packages: '',
        rateType: 'Fixed',
        ratePerMt: taxableDiff,
        freight: taxableDiff,
        description: `${docKind.toUpperCase()} ADJ (${previousInvoice.invoiceNo}): ${cleanReason}`,
      },
    ],
    annexureLorries: [],
    branchCode: revisedInvoice.billedAtBranch || branchCode,
    createdByStaff: staffCode,
    ownerUid,
  };

  return {
    needed: true,
    docKind,
    noteNo,
    taxableDiff,
    cgstAmt,
    sgstAmt,
    igstAmt,
    totalTax: absTaxDiff,
    grandTotal: absGrandDiff,
    narrationText,
    payload,
  };
}
