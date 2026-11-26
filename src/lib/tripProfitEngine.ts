import {
  ConsignmentNote,
  Invoice,
  LorryHire,
  StaffCommissionEntry,
  TransactionRecord,
  TripExpenseRecord,
} from '../types/erp';
import { roundPaise, todayISO } from './formatters';

export interface ComputedTripProfitRow {
  id: string;
  savedRecordId?: string;
  isSaved: boolean;
  cnId?: string;
  cnNo: string;
  cnDate: string;
  truckNo: string;
  partyName: string;
  route: string;
  freightRevenue: number;
  lorryHire: number;
  dieselExpense: number;
  tollFastag: number;
  driverBhatta: number;
  brokerCommission: number;
  unloadingMisc: number;
  totalDeductions: number;
  netProfit: number;
  marginPct: number;
  remarks: string;
  branchCode?: string;
}

export interface ComputedVehicleProfitSummary {
  truckNo: string;
  tripCount: number;
  freightRevenue: number;
  lorryHire: number;
  dieselExpense: number;
  tollFastag: number;
  driverBhatta: number;
  brokerCommission: number;
  unloadingMisc: number;
  totalDeductions: number;
  netProfit: number;
  marginPct: number;
}

export interface TripProfitDataset {
  tripRows: ComputedTripProfitRow[];
  vehicleSummaries: ComputedVehicleProfitSummary[];
  totals: {
    tripCount: number;
    vehicleCount: number;
    freightRevenue: number;
    lorryHire: number;
    dieselExpense: number;
    tollFastag: number;
    driverBhatta: number;
    brokerCommission: number;
    unloadingMisc: number;
    totalDeductions: number;
    netProfit: number;
    marginPct: number;
  };
}

function normCn(s?: string): string {
  return String(s || '').trim().toUpperCase();
}

function normTruck(s?: string): string {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function calculateNetTripProfit(parts: {
  freightRevenue: number;
  lorryHire: number;
  dieselExpense: number;
  tollFastag: number;
  driverBhatta: number;
  brokerCommission: number;
  unloadingMisc: number;
}): { totalDeductions: number; netProfit: number; marginPct: number } {
  const rev = roundPaise(Number(parts.freightRevenue || 0));
  const totalDeductions = roundPaise(
    Number(parts.lorryHire || 0) +
      Number(parts.dieselExpense || 0) +
      Number(parts.tollFastag || 0) +
      Number(parts.driverBhatta || 0) +
      Number(parts.brokerCommission || 0) +
      Number(parts.unloadingMisc || 0)
  );
  const netProfit = roundPaise(rev - totalDeductions);
  const marginPct = rev > 0 ? roundPaise((netProfit / rev) * 100) : 0;
  return { totalDeductions, netProfit, marginPct };
}

export function buildTripProfitDataset(input: {
  consignments: ConsignmentNote[];
  lorryHires: LorryHire[];
  invoices?: Invoice[];
  transactions?: TransactionRecord[];
  staffCommissions?: StaffCommissionEntry[];
  tripExpenses?: TripExpenseRecord[];
  filterTruckNo?: string;
  dateFrom?: string;
  dateTo?: string;
}): TripProfitDataset {
  const {
    consignments,
    lorryHires,
    invoices = [],
    transactions = [],
    staffCommissions = [],
    tripExpenses = [],
    filterTruckNo,
    dateFrom,
    dateTo,
  } = input;

  const truckFilterNorm = normTruck(filterTruckNo);

  const hireByCn = new Map<string, LorryHire>();
  lorryHires.forEach((h) => {
    const k = normCn(h.cnNo);
    if (k && !hireByCn.has(k)) hireByCn.set(k, h);
  });

  const savedByCn = new Map<string, TripExpenseRecord>();
  tripExpenses.forEach((rec) => {
    const k = normCn(rec.cnNo);
    if (k) savedByCn.set(k, rec);
  });

  const invoiceFreightByCn = new Map<string, number>();
  invoices.forEach((inv) => {
    (inv.consignmentRows || []).forEach((row) => {
      const k = normCn(row.cnNo);
      if (!k) return;
      invoiceFreightByCn.set(k, roundPaise((invoiceFreightByCn.get(k) || 0) + Number(row.freight || 0)));
    });
  });

  const commByCn = new Map<string, number>();
  staffCommissions.forEach((sc) => {
    if (sc.entryType !== 'Commission') return;
    const k = normCn(sc.challanNo);
    if (!k) return;
    commByCn.set(k, roundPaise((commByCn.get(k) || 0) + Number(sc.amount || 0)));
  });

  // Auto-bucket linked expenses from Transactions (excluding auto Lorry Hire Payable ledger entries)
  const txBucketsByCn = new Map<
    string,
    { diesel: number; toll: number; bhatta: number; broker: number; misc: number }
  >();
  transactions.forEach((tx) => {
    if (tx.txType !== 'Expense') return;
    const isAutoLorryBalanceTx =
      tx.ledgerAccount === 'Lorry Hire Payable A/c' &&
      (Boolean(tx.linkedCnNo) || /^LH-/i.test(tx.txCode || ''));
    const isFoxproDr = tx.ledgerAccount === 'Party Ledger Receivable (Dr)';
    if (isAutoLorryBalanceTx || isFoxproDr) return;

    const k = normCn(tx.linkedCnNo);
    if (!k) return;
    const bucket = txBucketsByCn.get(k) || {
      diesel: 0,
      toll: 0,
      bhatta: 0,
      broker: 0,
      misc: 0,
    };
    const amt = Number(tx.amount || 0);
    const desc = `${tx.ledgerAccount || ''} ${tx.narration || ''} ${tx.partyName || ''}`.toLowerCase();
    if (/diesel|fuel|petrol|pump|cng/.test(desc)) {
      bucket.diesel = roundPaise(bucket.diesel + amt);
    } else if (/toll|fastag|border|checkpost|rto|entry/.test(desc)) {
      bucket.toll = roundPaise(bucket.toll + amt);
    } else if (/bhatta|driver|allowance|khoraki|food/.test(desc)) {
      bucket.bhatta = roundPaise(bucket.bhatta + amt);
    } else if (/broker|commission|dalali/.test(desc)) {
      bucket.broker = roundPaise(bucket.broker + amt);
    } else {
      bucket.misc = roundPaise(bucket.misc + amt);
    }
    txBucketsByCn.set(k, bucket);
  });

  const tripRows: ComputedTripProfitRow[] = [];
  const handledCnKeys = new Set<string>();

  const pushTrip = (base: {
    id: string;
    cnId?: string;
    cnNo: string;
    cnDate: string;
    truckNo: string;
    partyName: string;
    route: string;
    defaultFreight: number;
    defaultHire: number;
    defaultMisc: number;
    branchCode?: string;
  }) => {
    const cnKey = normCn(base.cnNo);
    if (cnKey) handledCnKeys.add(cnKey);

    const saved = cnKey ? savedByCn.get(cnKey) : undefined;
    const dt = saved?.cnDate || base.cnDate || todayISO();
    if (dateFrom && dt && dt < dateFrom) return;
    if (dateTo && dt && dt > dateTo) return;

    const truck = (saved?.truckNo || base.truckNo || '').trim().toUpperCase() || 'UNASSIGNED';
    if (truckFilterNorm && normTruck(truck) !== truckFilterNorm) return;

    const txB = cnKey ? txBucketsByCn.get(cnKey) : undefined;
    const scAmt = cnKey ? commByCn.get(cnKey) || 0 : 0;

    const freightRevenue = saved
      ? roundPaise(saved.freightRevenue)
      : roundPaise(base.defaultFreight);
    const lorryHire = saved ? roundPaise(saved.lorryHire) : roundPaise(base.defaultHire);
    const dieselExpense = saved
      ? roundPaise(saved.dieselExpense)
      : roundPaise(txB?.diesel || 0);
    const tollFastag = saved ? roundPaise(saved.tollFastag) : roundPaise(txB?.toll || 0);
    const driverBhatta = saved ? roundPaise(saved.driverBhatta) : roundPaise(txB?.bhatta || 0);
    const brokerCommission = saved
      ? roundPaise(saved.brokerCommission)
      : roundPaise((txB?.broker || 0) + scAmt);
    const unloadingMisc = saved
      ? roundPaise(saved.unloadingMisc)
      : roundPaise(base.defaultMisc + (txB?.misc || 0));

    const calc = calculateNetTripProfit({
      freightRevenue,
      lorryHire,
      dieselExpense,
      tollFastag,
      driverBhatta,
      brokerCommission,
      unloadingMisc,
    });

    tripRows.push({
      id: saved?.id || base.id,
      savedRecordId: saved?.id,
      isSaved: Boolean(saved),
      cnId: base.cnId || saved?.cnId,
      cnNo: base.cnNo,
      cnDate: dt,
      truckNo: truck,
      partyName: saved?.partyName || base.partyName,
      route: saved?.route || base.route,
      freightRevenue,
      lorryHire,
      dieselExpense,
      tollFastag,
      driverBhatta,
      brokerCommission,
      unloadingMisc,
      totalDeductions: calc.totalDeductions,
      netProfit: calc.netProfit,
      marginPct: calc.marginPct,
      remarks: saved?.remarks || '',
      branchCode: saved?.branchCode || base.branchCode,
    });
  };

  // 1. Seed from all Consignments
  consignments.forEach((cn) => {
    const k = normCn(cn.cnNo);
    const lh = k ? hireByCn.get(k) : undefined;
    const invFreight = k ? invoiceFreightByCn.get(k) || 0 : 0;
    const cnFreight = Number(cn.totalFreight || 0);
    const defaultFreight = cnFreight > 0 ? cnFreight : invFreight;
    const defaultHire = Number(lh?.hireAmount || 0);
    const lhMisc =
      Number(lh?.loadingCharge || 0) +
      Number(lh?.unloadingCharge || 0) +
      Number(lh?.parkingCharge || 0) +
      Number(lh?.kataCharge || 0);

    pushTrip({
      id: `trip_cn_${cn.id}`,
      cnId: cn.id,
      cnNo: cn.cnNo,
      cnDate: cn.cnDate || todayISO(),
      truckNo: cn.truckNo || lh?.truckNo || '',
      partyName: cn.billingPartyName || cn.consignorName || '-',
      route: `${cn.fromCity || '-'} → ${cn.toCity || '-'}`,
      defaultFreight,
      defaultHire,
      defaultMisc: lhMisc,
      branchCode: cn.branchCode,
    });
  });

  // 2. Include Lorry Hires that don't have a Consignment entry
  lorryHires.forEach((lh) => {
    const k = normCn(lh.cnNo);
    if (!k || handledCnKeys.has(k)) return;
    const invFreight = invoiceFreightByCn.get(k) || 0;
    const lhMisc =
      Number(lh.loadingCharge || 0) +
      Number(lh.unloadingCharge || 0) +
      Number(lh.parkingCharge || 0) +
      Number(lh.kataCharge || 0);

    pushTrip({
      id: `trip_lh_${lh.id}`,
      cnNo: lh.cnNo,
      cnDate: lh.cnDate || todayISO(),
      truckNo: lh.truckNo || '',
      partyName: lh.ownerName || lh.brokerName || '-',
      route: `${lh.fromCity || '-'} → ${lh.toCity || '-'}`,
      defaultFreight: invFreight,
      defaultHire: Number(lh.hireAmount || 0),
      defaultMisc: lhMisc,
      branchCode: lh.branchCode,
    });
  });

  // 3. Include any standalone saved TripExpenseRecord whose CN wasn't in consignments or hires
  tripExpenses.forEach((rec) => {
    const k = normCn(rec.cnNo);
    if (k && handledCnKeys.has(k)) return;
    pushTrip({
      id: rec.id,
      cnId: rec.cnId,
      cnNo: rec.cnNo,
      cnDate: rec.cnDate || todayISO(),
      truckNo: rec.truckNo || '',
      partyName: rec.partyName || '-',
      route: rec.route || '-',
      defaultFreight: Number(rec.freightRevenue || 0),
      defaultHire: Number(rec.lorryHire || 0),
      defaultMisc: Number(rec.unloadingMisc || 0),
      branchCode: rec.branchCode,
    });
  });

  tripRows.sort((a, b) => (b.cnDate || '').localeCompare(a.cnDate || '') || b.cnNo.localeCompare(a.cnNo));

  // Build per-vehicle rollups
  const vehicleMap = new Map<string, ComputedVehicleProfitSummary>();
  tripRows.forEach((r) => {
    const key = normTruck(r.truckNo) || 'UNASSIGNED';
    const cur = vehicleMap.get(key) || {
      truckNo: r.truckNo,
      tripCount: 0,
      freightRevenue: 0,
      lorryHire: 0,
      dieselExpense: 0,
      tollFastag: 0,
      driverBhatta: 0,
      brokerCommission: 0,
      unloadingMisc: 0,
      totalDeductions: 0,
      netProfit: 0,
      marginPct: 0,
    };
    cur.tripCount += 1;
    cur.freightRevenue = roundPaise(cur.freightRevenue + r.freightRevenue);
    cur.lorryHire = roundPaise(cur.lorryHire + r.lorryHire);
    cur.dieselExpense = roundPaise(cur.dieselExpense + r.dieselExpense);
    cur.tollFastag = roundPaise(cur.tollFastag + r.tollFastag);
    cur.driverBhatta = roundPaise(cur.driverBhatta + r.driverBhatta);
    cur.brokerCommission = roundPaise(cur.brokerCommission + r.brokerCommission);
    cur.unloadingMisc = roundPaise(cur.unloadingMisc + r.unloadingMisc);
    cur.totalDeductions = roundPaise(cur.totalDeductions + r.totalDeductions);
    cur.netProfit = roundPaise(cur.netProfit + r.netProfit);
    cur.marginPct =
      cur.freightRevenue > 0 ? roundPaise((cur.netProfit / cur.freightRevenue) * 100) : 0;
    vehicleMap.set(key, cur);
  });

  const vehicleSummaries = Array.from(vehicleMap.values()).sort(
    (a, b) => b.netProfit - a.netProfit || a.truckNo.localeCompare(b.truckNo)
  );

  const totRev = roundPaise(tripRows.reduce((s, r) => s + r.freightRevenue, 0));
  const totHire = roundPaise(tripRows.reduce((s, r) => s + r.lorryHire, 0));
  const totDiesel = roundPaise(tripRows.reduce((s, r) => s + r.dieselExpense, 0));
  const totToll = roundPaise(tripRows.reduce((s, r) => s + r.tollFastag, 0));
  const totBhatta = roundPaise(tripRows.reduce((s, r) => s + r.driverBhatta, 0));
  const totBroker = roundPaise(tripRows.reduce((s, r) => s + r.brokerCommission, 0));
  const totMisc = roundPaise(tripRows.reduce((s, r) => s + r.unloadingMisc, 0));
  const totDed = roundPaise(tripRows.reduce((s, r) => s + r.totalDeductions, 0));
  const totNet = roundPaise(totRev - totDed);

  return {
    tripRows,
    vehicleSummaries,
    totals: {
      tripCount: tripRows.length,
      vehicleCount: vehicleSummaries.length,
      freightRevenue: totRev,
      lorryHire: totHire,
      dieselExpense: totDiesel,
      tollFastag: totToll,
      driverBhatta: totBhatta,
      brokerCommission: totBroker,
      unloadingMisc: totMisc,
      totalDeductions: totDed,
      netProfit: totNet,
      marginPct: totRev > 0 ? roundPaise((totNet / totRev) * 100) : 0,
    },
  };
}
