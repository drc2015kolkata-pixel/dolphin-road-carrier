import { ConsignmentNote, Driver, LorryHire, Vehicle } from '../types/erp';
import { daysUntilDate, formatDateDDMMYYYY } from './formatters';
import { getEwayBillExpiryState } from './ewayBillUtils';

export type ExpiryAlertCategory = 'vehicle' | 'driver' | 'eway';
export type ExpiryAlertSeverity = 'expired' | 'expiringSoon';

export interface ExpiryAlertItem {
  id: string;
  category: ExpiryAlertCategory;
  severity: ExpiryAlertSeverity;
  entityLabel: string;
  subLabel?: string;
  docType: string;
  docNumber?: string;
  expiryDate: string;
  expiryDisplay: string;
  daysLeft: number | null;
  hoursLeft?: number | null;
  statusLabel: string;
  truckNo?: string;
  driverName?: string;
  cnNo?: string;
}

export interface ExpiryAlertSummary {
  items: ExpiryAlertItem[];
  expiredCount: number;
  expiringSoonCount: number;
  totalCount: number;
  vehicleExpiredCount: number;
  driverExpiredCount: number;
  ewayAlertCount: number;
}

function normTruck(s?: string): string {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normName(s?: string): string {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function classifyDateAlert(dateStr?: string): {
  severity: ExpiryAlertSeverity;
  daysLeft: number;
  statusLabel: string;
} | null {
  if (!dateStr || !String(dateStr).trim()) return null;
  const d = daysUntilDate(dateStr);
  if (d === null || d > 7) return null;
  if (d < 0) {
    const overdue = Math.abs(d);
    return {
      severity: 'expired',
      daysLeft: d,
      statusLabel: overdue === 1 ? 'Expired 1d ago' : `Expired ${overdue}d ago`,
    };
  }
  return {
    severity: 'expiringSoon',
    daysLeft: d,
    statusLabel: d === 0 ? 'Expires TODAY' : `Expires in ${d}d`,
  };
}

export interface EvaluateExpiryAlertsInput {
  vehicles?: Vehicle[];
  drivers?: Driver[];
  consignments?: ConsignmentNote[];
  lorryHires?: LorryHire[];
  filterTruckNo?: string;
  filterDriverName?: string;
  draftVehicle?: {
    truckNo?: string;
    driverName?: string;
    driverDlNo?: string;
    driverDlExpiry?: string;
    cnNo?: string;
    ewayBillNo?: string;
    ewayBillValidUpto?: string;
  };
}

export function evaluateExpiryAlerts(input: EvaluateExpiryAlertsInput): ExpiryAlertSummary {
  const {
    vehicles = [],
    drivers = [],
    consignments = [],
    lorryHires = [],
    filterTruckNo,
    filterDriverName,
    draftVehicle,
  } = input;

  const targetTruck = normTruck(filterTruckNo);
  const targetDriver = normName(filterDriverName);
  const items: ExpiryAlertItem[] = [];
  const seenKeys = new Set<string>();

  // Map POD/Unloaded CNs so delivered E-Way Bills do not raise false alarms
  const completedCnSet = new Set<string>();
  lorryHires.forEach((lh) => {
    const key = String(lh.cnNo || '').trim().toUpperCase();
    if (!key) return;
    if (lh.podReceived || Boolean((lh.unloadingDate || '').trim())) {
      completedCnSet.add(key);
    }
  });

  // 1. Vehicle Documents (RC, Insurance, Fitness, State Permit, National Permit, PUC, Road Tax)
  vehicles.forEach((v) => {
    const tNorm = normTruck(v.truckNo);
    if (targetTruck && tNorm !== targetTruck) return;

    const checks: Array<{ docType: string; date?: string }> = [
      { docType: 'RC', date: v.rcExpiry },
      { docType: 'Insurance', date: v.insuranceExpiry },
      { docType: 'Fitness', date: v.fitnessExpiry },
      { docType: 'State / Goods Permit', date: v.permitExpiry },
      { docType: 'National Permit', date: v.nationalPermitExpiry },
      { docType: 'Pollution / PUC', date: v.pucExpiry },
      { docType: 'Road Tax', date: v.roadTaxExpiry },
    ];

    checks.forEach(({ docType, date }) => {
      const res = classifyDateAlert(date);
      if (!res || !date) return;
      const dedup = `veh:${tNorm || v.id}:${docType}`;
      if (seenKeys.has(dedup)) return;
      seenKeys.add(dedup);
      items.push({
        id: `exp_${dedup}`,
        category: 'vehicle',
        severity: res.severity,
        entityLabel: v.truckNo || 'Vehicle',
        subLabel: v.ownerName ? `Owner: ${v.ownerName}` : undefined,
        docType,
        expiryDate: date,
        expiryDisplay: formatDateDDMMYYYY(date),
        daysLeft: res.daysLeft,
        statusLabel: res.statusLabel,
        truckNo: v.truckNo,
      });
    });
  });

  // 2. Driver Driving License (DL) from Master Drivers
  drivers.forEach((d) => {
    const dNorm = normName(d.name);
    if (targetDriver && dNorm !== targetDriver) return;
    if (targetTruck && !targetDriver) {
      // If strictly filtering by truck without driver filter, skip unrelated drivers unless matched by recent CN
      const drivenTruck = consignments.some(
        (cn) => normTruck(cn.truckNo) === targetTruck && normName(cn.driverName) === dNorm
      );
      if (!drivenTruck) return;
    }

    const res = classifyDateAlert(d.dlExpiry);
    if (!res || !d.dlExpiry) return;
    const dedup = `drv:${dNorm || d.id}:DL`;
    if (seenKeys.has(dedup)) return;
    seenKeys.add(dedup);
    items.push({
      id: `exp_${dedup}`,
      category: 'driver',
      severity: res.severity,
      entityLabel: d.name || 'Driver',
      subLabel: d.dlNo ? `DL: ${d.dlNo}` : undefined,
      docType: 'Driving License (DL)',
      docNumber: d.dlNo,
      expiryDate: d.dlExpiry,
      expiryDisplay: formatDateDDMMYYYY(d.dlExpiry),
      daysLeft: res.daysLeft,
      statusLabel: res.statusLabel,
      driverName: d.name,
    });
  });

  // 3. Driver DL from active Consignments (fallback if not in Drivers master) + Active E-Way Bill Valid Upto
  const pushEwayAlert = (opts: {
    cnNo: string;
    truckNo?: string;
    ewbNo?: string;
    validUpto?: string;
    partyName?: string;
    isExtra?: boolean;
  }) => {
    if (!opts.validUpto || !opts.validUpto.trim()) return;
    const st = getEwayBillExpiryState(opts.validUpto);
    const hrs = st.hoursLeft;
    const isExpired = st.status === 'expired' || (hrs !== null && hrs < 0);
    const isSoon =
      !isExpired &&
      (st.status === 'expiringSoon' || (hrs !== null && hrs >= 0 && hrs <= 168));
    if (!isExpired && !isSoon) return;
    const tNorm = normTruck(opts.truckNo);
    if (targetTruck && tNorm !== targetTruck) return;

    const dedup = `ewb:${opts.cnNo}:${opts.ewbNo || opts.validUpto}`;
    if (seenKeys.has(dedup)) return;
    seenKeys.add(dedup);

    let statusLabel = st.label;
    if (hrs !== null) {
      if (hrs < 0) {
        const absH = Math.abs(Math.round(hrs));
        statusLabel = absH >= 24 ? `EWB Expired ${Math.round(absH / 24)}d ago` : `EWB Expired ${absH}h ago`;
      } else if (hrs < 24) {
        statusLabel = `EWB Expiring in ${Math.max(0, Math.round(hrs))}h`;
      } else {
        const d = Math.floor(hrs / 24);
        statusLabel = d === 0 ? 'EWB Expires TODAY' : `EWB Expiring in ${d}d`;
      }
    }

    const timePart = opts.validUpto.includes('T') ? ` ${opts.validUpto.split('T')[1]?.slice(0, 5) || ''}` : '';
    const daysLeft = hrs !== null ? Math.floor(hrs / 24) : daysUntilDate(opts.validUpto);

    items.push({
      id: `exp_${dedup}`,
      category: 'eway',
      severity: isExpired ? 'expired' : 'expiringSoon',
      entityLabel: opts.cnNo || 'LR / CN',
      subLabel: [opts.truckNo, opts.partyName].filter(Boolean).join(' · ') || undefined,
      docType: opts.isExtra ? 'Extra E-Way Bill' : 'E-Way Bill',
      docNumber: opts.ewbNo || undefined,
      expiryDate: opts.validUpto,
      expiryDisplay: `${formatDateDDMMYYYY(opts.validUpto)}${timePart}`.trim(),
      daysLeft,
      hoursLeft: hrs,
      statusLabel,
      truckNo: opts.truckNo,
      cnNo: opts.cnNo,
    });
  };

  consignments.forEach((cn) => {
    const cnKey = String(cn.cnNo || '').trim().toUpperCase();
    const isCompleted = cnKey ? completedCnSet.has(cnKey) : false;

    // Driver DL typed on active CN
    if (cn.driverDlExpiry && (!targetDriver || normName(cn.driverName) === targetDriver)) {
      const tMatch = !targetTruck || normTruck(cn.truckNo) === targetTruck;
      if (tMatch) {
        const res = classifyDateAlert(cn.driverDlExpiry);
        const dKey = normName(cn.driverName) || cn.driverDlNo || cn.cnNo;
        const dedup = `drv:${dKey}:DL`;
        if (res && !seenKeys.has(dedup)) {
          seenKeys.add(dedup);
          items.push({
            id: `exp_${dedup}`,
            category: 'driver',
            severity: res.severity,
            entityLabel: cn.driverName || `Driver (${cn.truckNo || cn.cnNo})`,
            subLabel: cn.driverDlNo ? `DL: ${cn.driverDlNo} · CN ${cn.cnNo}` : `CN ${cn.cnNo}`,
            docType: 'Driving License (DL)',
            docNumber: cn.driverDlNo,
            expiryDate: cn.driverDlExpiry,
            expiryDisplay: formatDateDDMMYYYY(cn.driverDlExpiry),
            daysLeft: res.daysLeft,
            statusLabel: res.statusLabel,
            driverName: cn.driverName,
            truckNo: cn.truckNo,
            cnNo: cn.cnNo,
          });
        }
      }
    }

    if (isCompleted) return;

    pushEwayAlert({
      cnNo: cn.cnNo,
      truckNo: cn.truckNo,
      ewbNo: cn.ewayBillNo,
      validUpto: cn.ewayBillValidUpto,
      partyName: cn.billingPartyName || cn.consignorName,
    });

    (cn.extraEwayBills || []).forEach((ex) => {
      pushEwayAlert({
        cnNo: cn.cnNo,
        truckNo: cn.truckNo,
        ewbNo: ex.no,
        validUpto: ex.validUpto,
        partyName: cn.billingPartyName || cn.consignorName,
        isExtra: true,
      });
    });
  });

  // 4. Optional active LR/CN Draft inspection (for live Consignment form warnings)
  if (draftVehicle) {
    if (draftVehicle.driverDlExpiry) {
      const res = classifyDateAlert(draftVehicle.driverDlExpiry);
      const dKey = normName(draftVehicle.driverName) || draftVehicle.driverDlNo || 'draft';
      const dedup = `drv:${dKey}:DL`;
      if (res && !seenKeys.has(dedup)) {
        seenKeys.add(dedup);
        items.push({
          id: `exp_draft_dl_${dKey}`,
          category: 'driver',
          severity: res.severity,
          entityLabel: draftVehicle.driverName || 'Current Driver (Draft)',
          subLabel: draftVehicle.driverDlNo ? `DL: ${draftVehicle.driverDlNo}` : undefined,
          docType: 'Driving License (DL)',
          docNumber: draftVehicle.driverDlNo,
          expiryDate: draftVehicle.driverDlExpiry,
          expiryDisplay: formatDateDDMMYYYY(draftVehicle.driverDlExpiry),
          daysLeft: res.daysLeft,
          statusLabel: res.statusLabel,
          driverName: draftVehicle.driverName,
          truckNo: draftVehicle.truckNo,
        });
      }
    }
    if (draftVehicle.ewayBillValidUpto) {
      pushEwayAlert({
        cnNo: draftVehicle.cnNo || 'CURRENT-DRAFT',
        truckNo: draftVehicle.truckNo,
        ewbNo: draftVehicle.ewayBillNo,
        validUpto: draftVehicle.ewayBillValidUpto,
      });
    }
  }

  // Sort: Expired first, then soonest expiry
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'expired' ? -1 : 1;
    const da = a.hoursLeft ?? (a.daysLeft !== null ? a.daysLeft * 24 : 9999);
    const db = b.hoursLeft ?? (b.daysLeft !== null ? b.daysLeft * 24 : 9999);
    return da - db;
  });

  const expiredCount = items.filter((i) => i.severity === 'expired').length;
  const expiringSoonCount = items.filter((i) => i.severity === 'expiringSoon').length;
  const vehicleExpiredCount = items.filter(
    (i) => i.category === 'vehicle' && i.severity === 'expired'
  ).length;
  const driverExpiredCount = items.filter(
    (i) => i.category === 'driver' && i.severity === 'expired'
  ).length;
  const ewayAlertCount = items.filter((i) => i.category === 'eway').length;

  return {
    items,
    expiredCount,
    expiringSoonCount,
    totalCount: items.length,
    vehicleExpiredCount,
    driverExpiredCount,
    ewayAlertCount,
  };
}
