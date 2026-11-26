import {
  BankReceiptRecord,
  CompanySettings,
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
  StaffAccount,
  StaffCommissionEntry,
  TransactionRecord,
  Vehicle,
} from '../types/erp';
import { getDynamicFinancialYear, normalizeFyLabel, roundPaise, todayISO } from './formatters';

export type LedgerRoleType = 'party' | 'broker' | 'owner' | 'driver' | 'vehicle' | 'staff';

export type TallyVoucherType =
  | 'Opening Balance'
  | 'Sales'
  | 'Receipt'
  | 'Payment'
  | 'Journal'
  | 'Credit Note'
  | 'Debit Note';

export type LedgerQuickPeriod =
  | '1D'
  | '2D'
  | '10D'
  | '20D'
  | '1M'
  | '2M'
  | '3M'
  | '6M'
  | '1Y'
  | '10Y'
  | 'FY'
  | 'CUSTOM';

export interface TallyLedgerRow {
  id: string;
  date: string;
  particulars: string;
  narration: string;
  voucherType: TallyVoucherType;
  voucherNo: string;
  debit: number;
  credit: number;
  runningBalance: number;
  runningSide: 'Dr' | 'Cr';
}

export interface TallyLedgerStatement {
  role: LedgerRoleType;
  accountName: string;
  entityId?: string;
  accountAddress?: string;
  accountGstin?: string;
  accountStateCode?: string;
  accountPan?: string;
  fy: string;
  dateFrom: string;
  dateTo: string;
  openingAmount: number;
  openingSide: 'Dr' | 'Cr';
  openingDr: number;
  openingCr: number;
  rows: TallyLedgerRow[];
  totalDr: number;
  totalCr: number;
  closingBalance: number;
  closingSide: 'Dr' | 'Cr';
  auditDifference: number;
  auditBalanced: boolean;
  tripCount: number;
  totalGrossAmount: number;
  totalAdvanceOrPaid: number;
  totalTds: number;
}

export interface RoleTripSummaryItem {
  key: string;
  name: string;
  entityId?: string;
  tripCount: number;
  grossAmount: number;
  paidOrAdvance: number;
  tdsAmount: number;
  closingBalance: number;
  closingSide: 'Dr' | 'Cr';
  phone?: string;
  gstin?: string;
  subLabel?: string;
}

export interface StaffMonthlySummaryRow {
  monthKey: string;
  monthLabel: string;
  staffName: string;
  tripCount: number;
  commissionTotal: number;
  advanceTaken: number;
  paidAmount: number;
  netBalance: number;
  netSide: 'Dr' | 'Cr';
}

function normKey(v?: string | null): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesEntityName(a?: string | null, b?: string | null): boolean {
  const na = normKey(a);
  const nb = normKey(b);
  if (!na || !nb) return false;
  return na === nb;
}

function resolveOpeningBalance(
  company: CompanySettings,
  fy: string,
  accountName: string,
  entityId?: string,
  partyObj?: Party | null,
  defaultSide: 'Dr' | 'Cr' = 'Dr'
): { amount: number; side: 'Dr' | 'Cr' } {
  const normFy = normalizeFyLabel(fy);
  const fyOpenings = company.fyOpeningBalances?.[normFy] || {};
  const targetLower = normKey(accountName);

  const exactByKey =
    (entityId ? fyOpenings[entityId] : undefined) ||
    fyOpenings[accountName] ||
    Object.entries(fyOpenings).find(([k]) => normKey(k) === targetLower)?.[1];

  if (exactByKey) {
    return {
      amount: roundPaise(Math.max(0, Number(exactByKey.amount) || 0)),
      side: exactByKey.balanceType === 'Cr' ? 'Cr' : 'Dr',
    };
  }

  if (partyObj && Number(partyObj.openingBalance || 0) > 0) {
    return {
      amount: roundPaise(Math.abs(Number(partyObj.openingBalance) || 0)),
      side: partyObj.balanceType === 'Cr' ? 'Cr' : 'Dr',
    };
  }

  return { amount: 0, side: defaultSide };
}

export function getFyDateBounds(fy: string): { from: string; to: string } {
  const clean = normalizeFyLabel(fy);
  const m = clean.match(/(\d{4})-(\d{2})/);
  if (m) {
    const y1 = Number(m[1]);
    return { from: `${y1}-04-01`, to: `${y1 + 1}-03-31` };
  }
  const currentFy = getDynamicFinancialYear(todayISO());
  const cm = currentFy.match(/(\d{4})-(\d{2})/);
  if (cm) {
    const y1 = Number(cm[1]);
    return { from: `${y1}-04-01`, to: `${y1 + 1}-03-31` };
  }
  const now = new Date();
  const y = now.getFullYear();
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

export function resolveQuickPeriodDates(
  period: LedgerQuickPeriod,
  fy: string,
  customFrom?: string,
  customTo?: string
): { dateFrom: string; dateTo: string } {
  const fyBounds = getFyDateBounds(fy);
  if (period === 'FY') return { dateFrom: fyBounds.from, dateTo: fyBounds.to };
  if (period === 'CUSTOM') {
    return {
      dateFrom: customFrom || fyBounds.from,
      dateTo: customTo || fyBounds.to,
    };
  }
  const endDt = new Date(todayISO() + 'T00:00:00');
  const startDt = new Date(endDt);
  if (period === '1D') startDt.setDate(startDt.getDate() - 1);
  else if (period === '2D') startDt.setDate(startDt.getDate() - 2);
  else if (period === '10D') startDt.setDate(startDt.getDate() - 10);
  else if (period === '20D') startDt.setDate(startDt.getDate() - 20);
  else if (period === '1M') startDt.setMonth(startDt.getMonth() - 1);
  else if (period === '2M') startDt.setMonth(startDt.getMonth() - 2);
  else if (period === '3M') startDt.setMonth(startDt.getMonth() - 3);
  else if (period === '6M') startDt.setMonth(startDt.getMonth() - 6);
  else if (period === '1Y') startDt.setFullYear(startDt.getFullYear() - 1);
  else if (period === '10Y') startDt.setFullYear(startDt.getFullYear() - 10);

  return {
    dateFrom: startDt.toISOString().slice(0, 10),
    dateTo: endDt.toISOString().slice(0, 10),
  };
}

interface RawLedgerItem {
  id: string;
  date: string;
  particulars: string;
  narration: string;
  voucherType: TallyVoucherType;
  voucherNo: string;
  debit: number;
  credit: number;
  tds?: number;
}

export function computeTallyRoleLedger(params: {
  role: LedgerRoleType;
  accountName: string;
  entityId?: string;
  fy: string;
  dateFrom?: string;
  dateTo?: string;
  company: CompanySettings;
  parties: Party[];
  consignments: ConsignmentNote[];
  invoices: Invoice[];
  lorryHires: LorryHire[];
  transactions: TransactionRecord[];
  bankReceipts: BankReceiptRecord[];
  staffCommissions: StaffCommissionEntry[];
  vehicles?: Vehicle[];
  drivers?: Driver[];
}): TallyLedgerStatement {
  const {
    role,
    accountName,
    entityId,
    fy,
    company,
    parties,
    consignments,
    invoices,
    lorryHires,
    transactions,
    bankReceipts,
    staffCommissions,
  } = params;

  const bounds = getFyDateBounds(fy);
  const dateFrom = params.dateFrom || bounds.from;
  const dateTo = params.dateTo || bounds.to;

  const matchedParty =
    parties.find((p) => (entityId && p.id === entityId) || matchesEntityName(p.name, accountName)) ||
    null;
  const matchedVehicle =
    (params.vehicles || []).find(
      (v) => (entityId && v.id === entityId) || matchesEntityName(v.truckNo, accountName)
    ) || null;
  const matchedDriver =
    (params.drivers || []).find(
      (d) => (entityId && d.id === entityId) || matchesEntityName(d.name, accountName)
    ) || null;

  const accountAddress =
    matchedParty?.address ||
    matchedParty?.city ||
    matchedDriver?.address ||
    (matchedVehicle ? `Owner: ${matchedVehicle.ownerName}` : undefined);
  const accountGstin = matchedParty?.gstin || undefined;
  const accountStateCode =
    matchedParty?.stateCode || (matchedParty?.gstin ? matchedParty.gstin.slice(0, 2) : undefined);
  const accountPan = matchedParty?.pan || undefined;

  const defaultSide: 'Dr' | 'Cr' = role === 'party' ? 'Dr' : 'Cr';
  const baseOpening = resolveOpeningBalance(
    company,
    fy,
    accountName,
    entityId,
    matchedParty,
    defaultSide
  );

  const rawItems: RawLedgerItem[] = [];
  let tripCount = 0;
  let totalGrossAmount = 0;
  let totalAdvanceOrPaid = 0;
  let totalTds = 0;

  if (role === 'party') {
    const seenCnTrips = new Set<string>();
    consignments.forEach((cn) => {
      const targetParty = cn.billingPartyName || cn.consignorName;
      if (matchesEntityName(targetParty, accountName)) {
        seenCnTrips.add(cn.cnNo || cn.id);
      }
    });

    invoices.forEach((inv) => {
      if (!matchesEntityName(inv.partyName, accountName)) return;
      if (inv.finalized === false) return;
      const grand = roundPaise(Number(inv.grandTotal || 0));
      const kind = inv.docKind || 'Tax Invoice';
      if (kind === 'Credit Note') {
        rawItems.push({
          id: `inv_${inv.id}`,
          date: inv.invoiceDate || todayISO(),
          particulars: `Freight & GST Credit Note${inv.againstInvoiceNo ? ` (Ref: ${inv.againstInvoiceNo})` : ''}`,
          narration: inv.narrationText || inv.creditDebitReason || inv.remarks || `Credit Note ${inv.invoiceNo}`,
          voucherType: 'Credit Note',
          voucherNo: inv.invoiceNo,
          debit: 0,
          credit: grand,
        });
      } else {
        const vType: TallyVoucherType = kind === 'Debit Note' ? 'Debit Note' : 'Sales';
        rawItems.push({
          id: `inv_${inv.id}`,
          date: inv.invoiceDate || todayISO(),
          particulars:
            kind === 'Debit Note'
              ? `Supplementary Debit Note${inv.againstInvoiceNo ? ` (Ref: ${inv.againstInvoiceNo})` : ''}`
              : `Freight Sales Bill (${inv.consignmentRows?.length || 0} CN)`,
          narration: inv.narrationText || inv.creditDebitReason || inv.remarks || `Bill ${inv.invoiceNo}`,
          voucherType: vType,
          voucherNo: inv.invoiceNo,
          debit: grand,
          credit: 0,
        });
        totalGrossAmount = roundPaise(totalGrossAmount + grand);
      }

      const advAmt = roundPaise(Number(inv.advanceReceived || 0));
      const paidAmt = roundPaise(Number(inv.paidAmount || 0));
      if (paidAmt > 0 && !transactions.some((t) => t.linkedInvoiceNo === inv.invoiceNo)) {
        // Check if covered by bankReceipts
        const coveredByBr = bankReceipts.some(
          (br) => br.matchedInvoiceNo === inv.invoiceNo && br.appliedToInvoice
        );
        if (!coveredByBr) {
          rawItems.push({
            id: `inv_pay_${inv.id}`,
            date: inv.invoiceDate || todayISO(),
            particulars: `${inv.fullPaymentMode || inv.advanceMode || 'NEFT'} Bill Receipt (${inv.invoiceNo})`,
            narration: `Receipt recorded on ${inv.invoiceNo}`,
            voucherType: 'Receipt',
            voucherNo: `REC-${inv.invoiceNo}`,
            debit: 0,
            credit: paidAmt > 0 ? paidAmt : advAmt,
          });
          totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + paidAmt);
        }
      }
    });

    tripCount = Math.max(
      seenCnTrips.size,
      invoices.filter((i) => matchesEntityName(i.partyName, accountName)).length
    );

    bankReceipts.forEach((br) => {
      if (!matchesEntityName(br.partyName, accountName)) return;
      const cr = roundPaise(Number(br.creditAmount || 0));
      const tds = roundPaise(Number(br.tdsAmount || 0));
      if (cr > 0) {
        rawItems.push({
          id: `br_${br.id}`,
          date: br.receiptDate || todayISO(),
          particulars: `Bank Receipt (${br.bankAccountName || 'Bank'}) · ${br.paymentMode || 'NEFT'}`,
          narration: br.narration || br.description || `Ref: ${br.utrNo || br.referenceNo || '-'}`,
          voucherType: 'Receipt',
          voucherNo: br.utrNo || br.referenceNo || `BR-${br.id.slice(-5)}`,
          debit: 0,
          credit: cr,
        });
        totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + cr);
      }
      if (tds > 0) {
        rawItems.push({
          id: `br_tds_${br.id}`,
          date: br.receiptDate || todayISO(),
          particulars: `TDS u/s 194C Deducted (${br.tdsRatePct || 0}%)`,
          narration: `TDS credit on ${br.matchedInvoiceNo || br.referenceNo || br.partyName}`,
          voucherType: 'Journal',
          voucherNo: `TDS-${br.referenceNo || br.id.slice(-5)}`,
          debit: 0,
          credit: tds,
          tds,
        });
        totalTds = roundPaise(totalTds + tds);
      }
    });

    transactions.forEach((tx) => {
      if (!matchesEntityName(tx.partyName, accountName)) return;
      const amt = roundPaise(Number(tx.amount || 0));
      const tds = roundPaise(Number(tx.tdsAmount || 0));
      if (amt <= 0 && tds <= 0) return;
      const isReceipt = tx.txType === 'Income';
      rawItems.push({
        id: `tx_${tx.id}`,
        date: tx.txDate || todayISO(),
        particulars: `${tx.ledgerAccount || tx.txType} (${tx.paymentMode || 'Cash'})`,
        narration: tx.narration || tx.referenceNo || tx.txCode,
        voucherType: isReceipt ? 'Receipt' : 'Payment',
        voucherNo: tx.txCode || `VCH-${tx.id.slice(-5)}`,
        debit: isReceipt ? 0 : amt,
        credit: isReceipt ? amt : 0,
        tds,
      });
      if (isReceipt) totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
      if (tds > 0) {
        rawItems.push({
          id: `tx_tds_${tx.id}`,
          date: tx.txDate || todayISO(),
          particulars: 'TDS Deduction Journal',
          narration: `TDS on ${tx.txCode}`,
          voucherType: 'Journal',
          voucherNo: `TDS-${tx.txCode}`,
          debit: isReceipt ? 0 : tds,
          credit: isReceipt ? tds : 0,
        });
        totalTds = roundPaise(totalTds + tds);
      }
    });
  } else if (role === 'broker' || role === 'owner' || role === 'vehicle') {
    const matchedHires = lorryHires.filter((lh) => {
      if (role === 'broker') return matchesEntityName(lh.brokerName, accountName);
      if (role === 'owner') return matchesEntityName(lh.ownerName, accountName);
      return (
        String(lh.truckNo || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '') === accountName.trim().toUpperCase().replace(/\s+/g, '')
      );
    });

    const relatedCns = consignments.filter((cn) => {
      if (role === 'broker') return matchesEntityName(cn.brokerName, accountName);
      if (role === 'owner') return matchesEntityName(cn.ownerName, accountName);
      return (
        String(cn.truckNo || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '') === accountName.trim().toUpperCase().replace(/\s+/g, '')
      );
    });

    const lhCnSet = new Set(matchedHires.map((lh) => (lh.cnNo || '').trim().toUpperCase()));
    const extraCnCount = relatedCns.filter(
      (cn) => !lhCnSet.has((cn.cnNo || '').trim().toUpperCase())
    ).length;
    tripCount = matchedHires.length + extraCnCount;

    matchedHires.forEach((lh) => {
      const hireBase = roundPaise(
        Number(lh.hireAmount || 0) +
          Number(lh.loadingCharge || 0) +
          Number(lh.unloadingCharge || 0) +
          Number(lh.parkingCharge || 0) +
          Number(lh.kataCharge || 0) +
          Number(lh.detentionCharge || 0)
      );
      const deductions = roundPaise(
        Number(lh.shortageCharge || 0) + Number(lh.damageCharge || 0)
      );
      const tds = roundPaise(Number(lh.tdsAmount || lh.payTdsAmt || 0));

      rawItems.push({
        id: `lh_hire_${lh.id}`,
        date: lh.cnDate || todayISO(),
        particulars: `Lorry Hire Payable · ${lh.truckNo} (${lh.fromCity || ''} → ${lh.toCity || ''})`,
        narration: `CN ${lh.cnNo}${lh.ownerName ? ` · Owner: ${lh.ownerName}` : ''}${lh.brokerName ? ` · Broker: ${lh.brokerName}` : ''}`,
        voucherType: 'Journal',
        voucherNo: lh.receiptChallanNo || `LH-${lh.cnNo}`,
        debit: 0,
        credit: hireBase,
      });
      totalGrossAmount = roundPaise(totalGrossAmount + hireBase);

      if (deductions > 0) {
        rawItems.push({
          id: `lh_ded_${lh.id}`,
          date: lh.unloadingDate || lh.cnDate || todayISO(),
          particulars: `Shortage / Damage Recovery (${lh.cnNo})`,
          narration: `Shortage ₹${lh.shortageCharge || 0}, Damage ₹${lh.damageCharge || 0}`,
          voucherType: 'Debit Note',
          voucherNo: `SHD-${lh.cnNo}`,
          debit: deductions,
          credit: 0,
        });
      }

      if (tds > 0) {
        rawItems.push({
          id: `lh_tds_${lh.id}`,
          date: lh.cnDate || todayISO(),
          particulars: `TDS Deducted (${lh.tdsRatePct || 0}%)`,
          narration: `TDS against Lorry Hire ${lh.cnNo}`,
          voucherType: 'Journal',
          voucherNo: `TDS-${lh.cnNo}`,
          debit: tds,
          credit: 0,
          tds,
        });
        totalTds = roundPaise(totalTds + tds);
      }

      const multiAdvs = Array.isArray(lh.advances) ? lh.advances : [];
      if (multiAdvs.length > 0) {
        multiAdvs.forEach((adv, idx) => {
          const amt = roundPaise(Number(adv.amount || 0));
          if (amt <= 0) return;
          rawItems.push({
            id: `lh_adv_${lh.id}_${idx}`,
            date: adv.advanceDate || lh.cnDate || todayISO(),
            particulars: `Lorry Advance Paid (${adv.mode || 'Bank'}) · ${lh.truckNo}`,
            narration: `${adv.payeeType || 'Payee'}: ${adv.accountName || accountName}${adv.refNo ? ` · Ref: ${adv.refNo}` : ''}`,
            voucherType: 'Payment',
            voucherNo: adv.refNo || `ADV-${lh.cnNo}-${idx + 1}`,
            debit: amt,
            credit: 0,
          });
          totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
        });
      } else {
        const advTotal = roundPaise(
          Number(lh.advancePaid || 0) + Number(lh.extraAdvanceAmt || 0)
        );
        if (advTotal > 0) {
          rawItems.push({
            id: `lh_adv_flat_${lh.id}`,
            date: lh.advExDate || lh.cnDate || todayISO(),
            particulars: `Lorry Advance Paid · ${lh.truckNo}`,
            narration: `Advance paid against CN ${lh.cnNo}`,
            voucherType: 'Payment',
            voucherNo: `ADV-${lh.cnNo}`,
            debit: advTotal,
            credit: 0,
          });
          totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + advTotal);
        }
      }

      const balPaid = roundPaise(Number(lh.balancePaidAmt || 0));
      const installments = Array.isArray(lh.payInstallments) ? lh.payInstallments : [];
      if (installments.length > 0) {
        installments.forEach((inst, idx) => {
          const amt = roundPaise(Number(inst.amount || 0));
          if (amt <= 0) return;
          rawItems.push({
            id: `lh_inst_${lh.id}_${idx}`,
            date: inst.date || lh.balancePaidDate || lh.cnDate || todayISO(),
            particulars: `Balance Hire Paid (${lh.paymentMode || 'NEFT'})`,
            narration: `Installment #${inst.slot || idx + 1} · Ref: ${inst.refNo || '-'} (${lh.cnNo})`,
            voucherType: 'Payment',
            voucherNo: inst.refNo || `BAL-${lh.cnNo}-${idx + 1}`,
            debit: amt,
            credit: 0,
          });
          totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
        });
      } else if (lh.balancePaid || balPaid > 0) {
        const finalBalAmt = balPaid > 0 ? balPaid : roundPaise(Number(lh.balancePayable || 0));
        if (finalBalAmt > 0) {
          rawItems.push({
            id: `lh_bal_${lh.id}`,
            date: lh.balancePaidDate || lh.podReceiveDate || lh.cnDate || todayISO(),
            particulars: `Final Balance Settled (${lh.paymentMode || 'NEFT'})`,
            narration: `POD Settled for CN ${lh.cnNo}${lh.paymentRef ? ` · Ref: ${lh.paymentRef}` : ''}`,
            voucherType: 'Payment',
            voucherNo: lh.paymentRef || `FIN-${lh.cnNo}`,
            debit: finalBalAmt,
            credit: 0,
          });
          totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + finalBalAmt);
        }
      }
    });

    transactions.forEach((tx) => {
      if (!matchesEntityName(tx.partyName, accountName)) return;
      const amt = roundPaise(Number(tx.amount || 0));
      if (amt <= 0) return;
      const isReceipt = tx.txType === 'Income';
      rawItems.push({
        id: `tx_rel_${tx.id}`,
        date: tx.txDate || todayISO(),
        particulars: `${tx.ledgerAccount || tx.txType} (${tx.paymentMode})`,
        narration: tx.narration || tx.referenceNo || tx.txCode,
        voucherType: isReceipt ? 'Receipt' : 'Payment',
        voucherNo: tx.txCode || `VCH-${tx.id.slice(-5)}`,
        debit: isReceipt ? 0 : amt,
        credit: isReceipt ? amt : 0,
      });
      if (!isReceipt) totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
    });
  } else if (role === 'driver') {
    const matchedCns = consignments.filter((cn) => matchesEntityName(cn.driverName, accountName));
    tripCount = matchedCns.length;

    matchedCns.forEach((cn) => {
      const lh = lorryHires.find(
        (x) => (x.cnNo || '').trim().toUpperCase() === (cn.cnNo || '').trim().toUpperCase()
      );
      const driverAdvs = (lh?.advances || []).filter(
        (a) =>
          String(a.payeeType || '').toLowerCase().includes('driver') ||
          matchesEntityName(a.accountName, accountName)
      );
      if (driverAdvs.length > 0) {
        driverAdvs.forEach((adv, idx) => {
          const amt = roundPaise(Number(adv.amount || 0));
          if (amt <= 0) return;
          rawItems.push({
            id: `drv_adv_${cn.id}_${idx}`,
            date: adv.advanceDate || cn.cnDate || todayISO(),
            particulars: `Driver Trip Kharcha / Advance (${cn.truckNo})`,
            narration: `CN ${cn.cnNo} (${cn.fromCity} → ${cn.toCity}) · ${adv.mode || 'Cash'}`,
            voucherType: 'Payment',
            voucherNo: adv.refNo || `DRV-${cn.cnNo}`,
            debit: amt,
            credit: 0,
          });
          totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
        });
      } else {
        rawItems.push({
          id: `drv_trip_${cn.id}`,
          date: cn.cnDate || todayISO(),
          particulars: `Trip Assignment · ${cn.truckNo} (${cn.fromCity} → ${cn.toCity})`,
          narration: `CN ${cn.cnNo} · Consignor: ${cn.consignorName}`,
          voucherType: 'Journal',
          voucherNo: cn.cnNo,
          debit: 0,
          credit: 0,
        });
      }
      totalGrossAmount = roundPaise(totalGrossAmount + Number(cn.totalFreight || 0));
    });

    transactions.forEach((tx) => {
      if (!matchesEntityName(tx.partyName, accountName)) return;
      const amt = roundPaise(Number(tx.amount || 0));
      if (amt <= 0) return;
      const isIncome = tx.txType === 'Income';
      rawItems.push({
        id: `drv_tx_${tx.id}`,
        date: tx.txDate || todayISO(),
        particulars: `${tx.ledgerAccount} (${tx.paymentMode})`,
        narration: tx.narration || tx.referenceNo || tx.txCode,
        voucherType: isIncome ? 'Receipt' : 'Payment',
        voucherNo: tx.txCode || `VCH-${tx.id.slice(-5)}`,
        debit: isIncome ? 0 : amt,
        credit: isIncome ? amt : 0,
      });
      if (!isIncome) totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
    });
  } else if (role === 'staff') {
    const matchedEntries = staffCommissions.filter((sc) =>
      matchesEntityName(sc.staffName, accountName)
    );
    const challanTrips = new Set<string>();
    matchedEntries.forEach((sc) => {
      if (sc.challanNo) challanTrips.add(sc.challanNo);
      const amt = roundPaise(Number(sc.amount || 0));
      const misc = roundPaise(Number(sc.travellingAmt || 0) + Number(sc.miscAmt || 0));
      if (sc.entryType === 'Commission') {
        const commCredit = roundPaise(amt + misc);
        rawItems.push({
          id: `sc_${sc.id}`,
          date: sc.entryDate || todayISO(),
          particulars: `Booking Commission Earned (${sc.wheelType || 'Truck'}) · ${sc.truckNo || ''}`,
          narration: `Challan ${sc.challanNo || '-'} (${sc.remarks || 'Commission'})`,
          voucherType: 'Journal',
          voucherNo: sc.challanNo || `COM-${sc.id.slice(-5)}`,
          debit: 0,
          credit: commCredit,
        });
        totalGrossAmount = roundPaise(totalGrossAmount + commCredit);
      } else {
        rawItems.push({
          id: `sc_${sc.id}`,
          date: sc.entryDate || todayISO(),
          particulars: `${sc.entryType} (${sc.paymentMode || 'Cash'})`,
          narration: `Challan ${sc.challanNo || '-'} ${sc.remarks || ''}`.trim(),
          voucherType: 'Payment',
          voucherNo: sc.challanNo || `STF-${sc.id.slice(-5)}`,
          debit: amt,
          credit: 0,
        });
        totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
      }
    });
    tripCount = Math.max(
      challanTrips.size,
      matchedEntries.filter((x) => x.entryType === 'Commission').length
    );

    transactions.forEach((tx) => {
      if (!matchesEntityName(tx.partyName, accountName)) return;
      const amt = roundPaise(Number(tx.amount || 0));
      if (amt <= 0) return;
      const isReceipt = tx.txType === 'Income';
      rawItems.push({
        id: `stf_tx_${tx.id}`,
        date: tx.txDate || todayISO(),
        particulars: `${tx.ledgerAccount} (${tx.paymentMode})`,
        narration: tx.narration || tx.txCode,
        voucherType: isReceipt ? 'Receipt' : 'Payment',
        voucherNo: tx.txCode || `VCH-${tx.id.slice(-5)}`,
        debit: isReceipt ? 0 : amt,
        credit: isReceipt ? amt : 0,
      });
      if (!isReceipt) totalAdvanceOrPaid = roundPaise(totalAdvanceOrPaid + amt);
    });
  }

  // Sort chronologically
  rawItems.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.voucherNo.localeCompare(b.voucherNo));

  // Items strictly before dateFrom roll into effective period Opening Balance so Closing math is exact
  let periodOpeningSigned =
    baseOpening.side === 'Dr' ? roundPaise(baseOpening.amount) : roundPaise(-baseOpening.amount);

  const visibleRaw: RawLedgerItem[] = [];
  for (const item of rawItems) {
    if (dateFrom && item.date && item.date < dateFrom) {
      periodOpeningSigned = roundPaise(periodOpeningSigned + item.debit - item.credit);
    } else if (dateTo && item.date && item.date > dateTo) {
      continue;
    } else {
      visibleRaw.push(item);
    }
  }

  const openingSide: 'Dr' | 'Cr' = periodOpeningSigned >= 0 ? 'Dr' : 'Cr';
  const openingAmount = roundPaise(Math.abs(periodOpeningSigned));
  const openingDr = openingSide === 'Dr' ? openingAmount : 0;
  const openingCr = openingSide === 'Cr' ? openingAmount : 0;

  let runningSigned = periodOpeningSigned;
  let totalDr = 0;
  let totalCr = 0;
  const rows: TallyLedgerRow[] = [];

  for (const item of visibleRaw) {
    const dr = roundPaise(item.debit);
    const cr = roundPaise(item.credit);
    totalDr = roundPaise(totalDr + dr);
    totalCr = roundPaise(totalCr + cr);
    runningSigned = roundPaise(runningSigned + dr - cr);
    rows.push({
      id: item.id,
      date: item.date,
      particulars: item.particulars,
      narration: item.narration,
      voucherType: item.voucherType,
      voucherNo: item.voucherNo,
      debit: dr,
      credit: cr,
      runningBalance: roundPaise(Math.abs(runningSigned)),
      runningSide: runningSigned >= 0 ? 'Dr' : 'Cr',
    });
  }

  const closingBalance = roundPaise(Math.abs(runningSigned));
  const closingSide: 'Dr' | 'Cr' = runningSigned >= 0 ? 'Dr' : 'Cr';

  // Tally mathematical identity audit: OpeningSigned + TotalDr - TotalCr === ClosingSigned
  const expectedClosingSigned = roundPaise(periodOpeningSigned + totalDr - totalCr);
  const auditDifference = roundPaise(Math.abs(expectedClosingSigned - runningSigned));

  return {
    role,
    accountName,
    entityId,
    accountAddress,
    accountGstin,
    accountStateCode,
    accountPan,
    fy,
    dateFrom,
    dateTo,
    openingAmount,
    openingSide,
    openingDr,
    openingCr,
    rows,
    totalDr,
    totalCr,
    closingBalance,
    closingSide,
    auditDifference,
    auditBalanced: auditDifference === 0,
    tripCount,
    totalGrossAmount,
    totalAdvanceOrPaid,
    totalTds,
  };
}

export function buildRoleTripDirectory(params: {
  role: LedgerRoleType;
  fy: string;
  company: CompanySettings;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  consignments: ConsignmentNote[];
  invoices: Invoice[];
  lorryHires: LorryHire[];
  transactions: TransactionRecord[];
  bankReceipts: BankReceiptRecord[];
  staffAccounts: StaffAccount[];
  staffCommissions: StaffCommissionEntry[];
}): RoleTripSummaryItem[] {
  const { role, parties, vehicles, drivers, consignments, invoices, lorryHires, bankReceipts, staffAccounts, staffCommissions } =
    params;

  const candidates = new Map<
    string,
    { name: string; entityId?: string; phone?: string; gstin?: string; subLabel?: string }
  >();

  const registerName = (
    name?: string,
    entityId?: string,
    phone?: string,
    gstin?: string,
    subLabel?: string
  ) => {
    const clean = String(name || '').trim();
    const k = normKey(clean);
    if (!k) return;
    if (!candidates.has(k)) {
      candidates.set(k, { name: clean, entityId, phone, gstin, subLabel });
    } else {
      const prev = candidates.get(k)!;
      if (!prev.entityId && entityId) prev.entityId = entityId;
      if (!prev.phone && phone) prev.phone = phone;
      if (!prev.gstin && gstin) prev.gstin = gstin;
      if (!prev.subLabel && subLabel) prev.subLabel = subLabel;
    }
  };

  if (role === 'party') {
    parties
      .filter((p) => p.partyType !== 'Broker' && p.partyType !== 'TruckOwner')
      .forEach((p) =>
        registerName(p.name, p.id, p.phone, p.gstin, p.city || p.address || p.partyType)
      );
    invoices.forEach((inv) => registerName(inv.partyName, undefined, undefined, inv.partyGstin));
    consignments.forEach((cn) => registerName(cn.billingPartyName || cn.consignorName));
    bankReceipts.forEach((br) => registerName(br.partyName));
  } else if (role === 'broker') {
    parties
      .filter((p) => p.partyType === 'Broker')
      .forEach((b) => registerName(b.name, b.id, b.phone, b.gstin, b.tradeLicenseNo || b.pan));
    lorryHires.forEach((lh) => registerName(lh.brokerName));
    consignments.forEach((cn) => registerName(cn.brokerName));
  } else if (role === 'owner') {
    parties
      .filter((p) => p.partyType === 'TruckOwner')
      .forEach((o) => registerName(o.name, o.id, o.phone, o.gstin, o.pan || o.bankAccountNo));
    vehicles.forEach((v) => registerName(v.ownerName, undefined, v.ownerPhone));
    lorryHires.forEach((lh) => registerName(lh.ownerName));
    consignments.forEach((cn) => registerName(cn.ownerName));
  } else if (role === 'driver') {
    drivers.forEach((d) => registerName(d.name, d.id, d.phone, undefined, `D/L: ${d.dlNo}`));
    consignments.forEach((cn) =>
      registerName(cn.driverName, undefined, cn.driverMobile, undefined, cn.driverDlNo)
    );
  } else if (role === 'vehicle') {
    vehicles.forEach((v) =>
      registerName(
        v.truckNo.toUpperCase(),
        v.id,
        v.ownerPhone,
        undefined,
        `${v.ownerName}${v.vehicleType ? ` · ${v.vehicleType}` : ''}`
      )
    );
    lorryHires.forEach((lh) => registerName(lh.truckNo?.toUpperCase()));
    consignments.forEach((cn) => registerName(cn.truckNo?.toUpperCase()));
  } else if (role === 'staff') {
    staffAccounts.forEach((s) =>
      registerName(s.displayName, s.id, undefined, undefined, `${s.role} (${s.staffCode})`)
    );
    staffCommissions.forEach((sc) => registerName(sc.staffName, undefined, undefined, undefined, sc.wheelType));
  }

  const list: RoleTripSummaryItem[] = [];
  candidates.forEach((c, key) => {
    const ledger = computeTallyRoleLedger({
      role,
      accountName: c.name,
      entityId: c.entityId,
      fy: params.fy,
      company: params.company,
      parties: params.parties,
      consignments: params.consignments,
      invoices: params.invoices,
      lorryHires: params.lorryHires,
      transactions: params.transactions,
      bankReceipts: params.bankReceipts,
      staffCommissions: params.staffCommissions,
      vehicles: params.vehicles,
      drivers: params.drivers,
    });
    list.push({
      key,
      name: c.name,
      entityId: c.entityId,
      tripCount: ledger.tripCount,
      grossAmount: ledger.totalGrossAmount,
      paidOrAdvance: ledger.totalAdvanceOrPaid,
      tdsAmount: ledger.totalTds,
      closingBalance: ledger.closingBalance,
      closingSide: ledger.closingSide,
      phone: c.phone,
      gstin: c.gstin,
      subLabel: c.subLabel,
    });
  });

  return list.sort(
    (a, b) =>
      b.tripCount - a.tripCount ||
      b.closingBalance - a.closingBalance ||
      a.name.localeCompare(b.name)
  );
}

export function computeStaffMonthlySummary(
  staffName: string,
  fy: string,
  staffCommissions: StaffCommissionEntry[]
): {
  monthlyRows: StaffMonthlySummaryRow[];
  yearlyCommission: number;
  yearlyAdvance: number;
  yearlyPaid: number;
  yearlyBalance: number;
  yearlySide: 'Dr' | 'Cr';
  totalTrips: number;
} {
  const normTarget = normKey(staffName);
  const { from, to } = getFyDateBounds(fy);
  const map = new Map<
    string,
    {
      trips: Set<string>;
      commission: number;
      advance: number;
      paid: number;
    }
  >();

  let yearlyCommission = 0;
  let yearlyAdvance = 0;
  let yearlyPaid = 0;
  const allTrips = new Set<string>();

  staffCommissions.forEach((sc) => {
    if (normTarget && normKey(sc.staffName) !== normTarget) return;
    const dt = sc.entryDate || todayISO();
    if (dt < from || dt > to) return;
    const monthKey = dt.slice(0, 7);
    const bucket = map.get(monthKey) || {
      trips: new Set<string>(),
      commission: 0,
      advance: 0,
      paid: 0,
    };
    if (sc.challanNo) {
      bucket.trips.add(sc.challanNo);
      allTrips.add(sc.challanNo);
    }
    const amt = roundPaise(Number(sc.amount || 0));
    const misc = roundPaise(Number(sc.travellingAmt || 0) + Number(sc.miscAmt || 0));
    if (sc.entryType === 'Commission') {
      const addAmt = roundPaise(amt + misc);
      bucket.commission = roundPaise(bucket.commission + addAmt);
      yearlyCommission = roundPaise(yearlyCommission + addAmt);
    } else if (sc.entryType === 'Advance Taken') {
      bucket.advance = roundPaise(bucket.advance + amt);
      yearlyAdvance = roundPaise(yearlyAdvance + amt);
    } else {
      bucket.paid = roundPaise(bucket.paid + amt);
      yearlyPaid = roundPaise(yearlyPaid + amt);
    }
    map.set(monthKey, bucket);
  });

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyRows: StaffMonthlySummaryRow[] = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthKey, b]) => {
      const [yr, mo] = monthKey.split('-');
      const mIdx = Math.max(0, Math.min(11, Number(mo) - 1));
      const netSigned = roundPaise(b.commission - b.advance - b.paid);
      return {
        monthKey,
        monthLabel: `${MONTH_NAMES[mIdx]} ${yr}`,
        staffName: staffName || 'All Staff',
        tripCount: b.trips.size,
        commissionTotal: b.commission,
        advanceTaken: b.advance,
        paidAmount: b.paid,
        netBalance: roundPaise(Math.abs(netSigned)),
        netSide: netSigned >= 0 ? 'Cr' : 'Dr',
      };
    });

  const yearlySigned = roundPaise(yearlyCommission - yearlyAdvance - yearlyPaid);
  return {
    monthlyRows,
    yearlyCommission,
    yearlyAdvance,
    yearlyPaid,
    yearlyBalance: roundPaise(Math.abs(yearlySigned)),
    yearlySide: yearlySigned >= 0 ? 'Cr' : 'Dr',
    totalTrips: allTrips.size,
  };
}

export interface StaffDualLedgerResult {
  staffName: string;
  advanceSalaryStatement: TallyLedgerStatement;
  commissionRows: Array<{
    id: string;
    date: string;
    challanNo: string;
    truckNo: string;
    wheelType: string;
    earned: number;
    paidSettled: number;
    balanceDue: number;
    remarks: string;
  }>;
  periodTotals: {
    m1: { earned: number; paid: number; balanceDue: number; trips: number };
    m6: { earned: number; paid: number; balanceDue: number; trips: number };
    y1: { earned: number; paid: number; balanceDue: number; trips: number };
  };
}

export function computeStaffDualLedgers(params: {
  staffName: string;
  entityId?: string;
  fy: string;
  dateFrom?: string;
  dateTo?: string;
  company: CompanySettings;
  staffCommissions: StaffCommissionEntry[];
  transactions: TransactionRecord[];
  staffAccounts?: StaffAccount[];
}): StaffDualLedgerResult {
  const { staffName, entityId, fy, company, staffCommissions, transactions, staffAccounts } = params;
  const bounds = getFyDateBounds(fy);
  const dateFrom = params.dateFrom || bounds.from;
  const dateTo = params.dateTo || bounds.to;
  const staffAcc = (staffAccounts || []).find(
    (s) => (entityId && s.id === entityId) || matchesEntityName(s.displayName, staffName)
  );

  // (a) Combined Advance & Salary Paid Ledger: Advance Given (Dr) vs Salary / Paid Settlement (Cr)
  const advRaw: RawLedgerItem[] = [];
  let totalGrossAdvance = 0;
  let totalPaidSettled = 0;

  staffCommissions
    .filter((sc) => matchesEntityName(sc.staffName, staffName) && sc.entryType !== 'Commission')
    .forEach((sc) => {
      const dt = sc.entryDate || todayISO();
      const amt = roundPaise(Number(sc.amount || 0));
      if (amt <= 0) return;
      const isAdvance = sc.entryType === 'Advance Taken';
      advRaw.push({
        id: sc.id,
        date: dt,
        particulars: isAdvance ? `Advance Given (${sc.paymentMode || 'Cash'})` : `Salary / Advance Settled (${sc.paymentMode || 'Bank'})`,
        narration: `${sc.challanNo ? `Ref ${sc.challanNo} · ` : ''}${sc.remarks || sc.entryType}`.trim(),
        voucherType: isAdvance ? 'Payment' : 'Receipt',
        voucherNo: sc.challanNo || `STF-${sc.id.slice(-5)}`,
        debit: isAdvance ? amt : 0,
        credit: isAdvance ? 0 : amt,
      });
    });

  transactions.forEach((tx) => {
    if (!matchesEntityName(tx.partyName, staffName)) return;
    const amt = roundPaise(Number(tx.amount || 0));
    if (amt <= 0) return;
    const isReceipt = tx.txType === 'Income';
    advRaw.push({
      id: `stf_tx_${tx.id}`,
      date: tx.txDate || todayISO(),
      particulars: `${tx.ledgerAccount} (${tx.paymentMode})`,
      narration: tx.narration || tx.txCode,
      voucherType: isReceipt ? 'Receipt' : 'Payment',
      voucherNo: tx.txCode || `VCH-${tx.id.slice(-5)}`,
      debit: isReceipt ? 0 : amt,
      credit: isReceipt ? amt : 0,
    });
  });

  advRaw.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.voucherNo.localeCompare(b.voucherNo));
  let openSigned = 0;
  const visibleAdv: RawLedgerItem[] = [];
  for (const item of advRaw) {
    if (dateFrom && item.date && item.date < dateFrom) {
      openSigned = roundPaise(openSigned + item.debit - item.credit);
    } else if (dateTo && item.date && item.date > dateTo) {
      continue;
    } else {
      visibleAdv.push(item);
    }
  }
  const openSide: 'Dr' | 'Cr' = openSigned >= 0 ? 'Dr' : 'Cr';
  const openAmt = roundPaise(Math.abs(openSigned));
  let runAdv = openSigned;
  let advDr = 0;
  let advCr = 0;
  const advRows: TallyLedgerRow[] = visibleAdv.map((it) => {
    advDr = roundPaise(advDr + it.debit);
    advCr = roundPaise(advCr + it.credit);
    totalGrossAdvance = roundPaise(totalGrossAdvance + it.debit);
    totalPaidSettled = roundPaise(totalPaidSettled + it.credit);
    runAdv = roundPaise(runAdv + it.debit - it.credit);
    return {
      ...it,
      runningBalance: roundPaise(Math.abs(runAdv)),
      runningSide: runAdv >= 0 ? 'Dr' : 'Cr',
    };
  });
  const advExpected = roundPaise(openSigned + advDr - advCr);
  const advDiff = roundPaise(Math.abs(advExpected - runAdv));

  const advanceSalaryStatement: TallyLedgerStatement = {
    role: 'staff',
    accountName: `${staffName} — Advance & Salary Paid`,
    entityId,
    accountAddress: staffAcc ? `${staffAcc.role} · Code ${staffAcc.staffCode}` : undefined,
    fy,
    dateFrom,
    dateTo,
    openingAmount: openAmt,
    openingSide: openSide,
    openingDr: openSide === 'Dr' ? openAmt : 0,
    openingCr: openSide === 'Cr' ? openAmt : 0,
    rows: advRows,
    totalDr: advDr,
    totalCr: advCr,
    closingBalance: roundPaise(Math.abs(runAdv)),
    closingSide: runAdv >= 0 ? 'Dr' : 'Cr',
    auditDifference: advDiff,
    auditBalanced: advDiff === 0,
    tripCount: advRows.length,
    totalGrossAmount: totalGrossAdvance,
    totalAdvanceOrPaid: totalPaidSettled,
    totalTds: 0,
  };

  // (b) Separate Staff Commission Ledger + 1M / 6M / 1Y Commission Totals
  const allStaffComm = staffCommissions
    .filter((sc) => matchesEntityName(sc.staffName, staffName) && (sc.entryType === 'Commission' || sc.entryType === 'Paid'))
    .sort((a, b) => (a.entryDate || '').localeCompare(b.entryDate || ''));

  let runningCommBal = 0;
  const commissionRows = allStaffComm
    .filter((sc) => (!dateFrom || (sc.entryDate || '') >= dateFrom) && (!dateTo || (sc.entryDate || '') <= dateTo))
    .map((sc) => {
      const earned =
        sc.entryType === 'Commission'
          ? roundPaise(Number(sc.amount || 0) + Number(sc.travellingAmt || 0) + Number(sc.miscAmt || 0))
          : 0;
      const paidSettled = sc.entryType === 'Paid' ? roundPaise(Number(sc.amount || 0)) : 0;
      runningCommBal = roundPaise(runningCommBal + earned - paidSettled);
      return {
        id: sc.id,
        date: sc.entryDate || todayISO(),
        challanNo: sc.challanNo || '-',
        truckNo: sc.truckNo || '-',
        wheelType: sc.wheelType || '-',
        earned,
        paidSettled,
        balanceDue: runningCommBal,
        remarks: sc.remarks || sc.entryType,
      };
    });

  const calcSpan = (months: number) => {
    const end = new Date(todayISO() + 'T00:00:00');
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    const sIso = start.toISOString().slice(0, 10);
    const eIso = end.toISOString().slice(0, 10);
    let earned = 0;
    let paid = 0;
    const trips = new Set<string>();
    allStaffComm.forEach((sc) => {
      const d = sc.entryDate || '';
      if (d < sIso || d > eIso) return;
      if (sc.entryType === 'Commission') {
        earned = roundPaise(earned + Number(sc.amount || 0) + Number(sc.travellingAmt || 0) + Number(sc.miscAmt || 0));
        if (sc.challanNo) trips.add(sc.challanNo);
      } else if (sc.entryType === 'Paid') {
        paid = roundPaise(paid + Number(sc.amount || 0));
      }
    });
    return { earned, paid, balanceDue: roundPaise(earned - paid), trips: trips.size };
  };

  return {
    staffName,
    advanceSalaryStatement,
    commissionRows,
    periodTotals: {
      m1: calcSpan(1),
      m6: calcSpan(6),
      y1: calcSpan(12),
    },
  };
}

export interface BrokerTripSheetRow {
  id: string;
  cnNo: string;
  date: string;
  brokerName: string;
  truckNo: string;
  route: string;
  hireAmount: number;
  advancePaid: number;
  detentionExtra: number;
  tdsAmount: number;
  balancePayable: number;
  podReceived: boolean;
  balancePaid: boolean;
  isPaidLocked: boolean;
  paymentMode?: string;
  paymentRef?: string;
  balancePaidDate?: string;
  hireRecord: LorryHire;
}

export interface BrokerDateVehicleSummary {
  date: string;
  vehicleCount: number;
  trucks: string[];
  tripCount: number;
  hireTotal: number;
  paidTotal: number;
  pendingTotal: number;
  allPaidLocked: boolean;
}

export function computeBrokerTripSheet(params: {
  brokerName: string | 'ALL';
  dateFrom?: string;
  dateTo?: string;
  lorryHires: LorryHire[];
}): {
  rows: BrokerTripSheetRow[];
  dateWiseSummary: BrokerDateVehicleSummary[];
  totalTrips: number;
  totalHire: number;
  totalAdvance: number;
  totalTds: number;
  totalNetPayable: number;
  totalPaidOut: number;
  totalPendingBalance: number;
  paidLockedCount: number;
} {
  const { brokerName, dateFrom, dateTo, lorryHires } = params;
  const isAll = !brokerName || brokerName === 'ALL';

  const rows: BrokerTripSheetRow[] = [];
  const dateMap = new Map<
    string,
    {
      trucks: Set<string>;
      tripCount: number;
      hireTotal: number;
      paidTotal: number;
      pendingTotal: number;
      unlockedCount: number;
    }
  >();
  let totalHire = 0;
  let totalAdvance = 0;
  let totalTds = 0;
  let totalNetPayable = 0;
  let totalPaidOut = 0;
  let totalPendingBalance = 0;
  let paidLockedCount = 0;

  lorryHires.forEach((lh) => {
    const bName = String(lh.brokerName || '').trim();
    if (!bName) return;
    if (!isAll && !matchesEntityName(bName, brokerName)) return;
    const dt = lh.cnDate || todayISO();
    if (dateFrom && dt < dateFrom) return;
    if (dateTo && dt > dateTo) return;

    const hireAmount = roundPaise(Number(lh.hireAmount || 0));
    const advancePaid = roundPaise(Number(lh.advancePaid || 0) + Number(lh.extraAdvanceAmt || 0));
    const detentionExtra = roundPaise(
      Number(lh.detentionCharge || 0) +
        Number(lh.loadingCharge || 0) +
        Number(lh.unloadingCharge || 0) +
        Number(lh.parkingCharge || 0) +
        Number(lh.kataCharge || 0)
    );
    const tdsAmount = roundPaise(Number(lh.tdsAmount || 0));
    const deductions = roundPaise(Number(lh.shortageCharge || 0) + Number(lh.damageCharge || 0));
    const computedBal = roundPaise(
      Math.max(0, hireAmount + detentionExtra - advancePaid - tdsAmount - deductions)
    );
    const balancePayable = lh.balancePayable != null ? roundPaise(Number(lh.balancePayable)) : computedBal;
    const paidSettled = roundPaise(Number(lh.balancePaidAmt || 0));
    const isPaidLocked = Boolean(lh.balancePaid || (balancePayable <= 0 && hireAmount > 0));

    totalHire = roundPaise(totalHire + hireAmount);
    totalAdvance = roundPaise(totalAdvance + advancePaid);
    totalTds = roundPaise(totalTds + tdsAmount);
    totalNetPayable = roundPaise(totalNetPayable + balancePayable);
    const rowPaidOut = isPaidLocked
      ? paidSettled > 0
        ? paidSettled
        : balancePayable
      : paidSettled;
    const rowPending = isPaidLocked ? 0 : Math.max(0, roundPaise(balancePayable - paidSettled));
    if (isPaidLocked) {
      paidLockedCount += 1;
      totalPaidOut = roundPaise(totalPaidOut + rowPaidOut);
    } else {
      totalPaidOut = roundPaise(totalPaidOut + rowPaidOut);
      totalPendingBalance = roundPaise(totalPendingBalance + rowPending);
    }

    const bucket = dateMap.get(dt) || {
      trucks: new Set<string>(),
      tripCount: 0,
      hireTotal: 0,
      paidTotal: 0,
      pendingTotal: 0,
      unlockedCount: 0,
    };
    const normTruck = String(lh.truckNo || '').trim().toUpperCase();
    if (normTruck && normTruck !== '-') bucket.trucks.add(normTruck);
    bucket.tripCount += 1;
    bucket.hireTotal = roundPaise(bucket.hireTotal + hireAmount);
    bucket.paidTotal = roundPaise(bucket.paidTotal + advancePaid + rowPaidOut);
    bucket.pendingTotal = roundPaise(bucket.pendingTotal + rowPending);
    if (!isPaidLocked) bucket.unlockedCount += 1;
    dateMap.set(dt, bucket);

    rows.push({
      id: lh.id,
      cnNo: lh.cnNo,
      date: dt,
      brokerName: bName,
      truckNo: lh.truckNo || '-',
      route: `${lh.fromCity || '-'} → ${lh.toCity || '-'}`,
      hireAmount,
      advancePaid,
      detentionExtra,
      tdsAmount,
      balancePayable,
      podReceived: Boolean(lh.podReceived),
      balancePaid: Boolean(lh.balancePaid),
      isPaidLocked,
      paymentMode: lh.paymentMode,
      paymentRef: lh.paymentRef,
      balancePaidDate: lh.balancePaidDate,
      hireRecord: lh,
    });
  });

  rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.cnNo.localeCompare(a.cnNo));
  const dateWiseSummary: BrokerDateVehicleSummary[] = Array.from(dateMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, b]) => {
      const trucks = Array.from(b.trucks).sort();
      return {
        date,
        vehicleCount: trucks.length > 0 ? trucks.length : b.tripCount,
        trucks,
        tripCount: b.tripCount,
        hireTotal: b.hireTotal,
        paidTotal: b.paidTotal,
        pendingTotal: b.pendingTotal,
        allPaidLocked: b.unlockedCount === 0 && b.tripCount > 0,
      };
    });

  return {
    rows,
    dateWiseSummary,
    totalTrips: rows.length,
    totalHire,
    totalAdvance,
    totalTds,
    totalNetPayable,
    totalPaidOut,
    totalPendingBalance,
    paidLockedCount,
  };
}

