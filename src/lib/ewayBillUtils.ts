import { CompanySettings, ConsignmentNote, LorryHire } from '../types/erp';

export interface ParsedQrPayload {
  kind: 'drc_invoice' | 'drc_lr' | 'nic_ewb' | 'generic';
  raw: string;
  ewbNo?: string;
  ewbDate?: string;
  validUpto?: string;
  vehicleNo?: string;
  docNo?: string;
  docDate?: string;
  partyGstin?: string;
  amount?: string;
  summary: string;
}

export interface EwayBillExpiryState {
  status: 'expired' | 'expiringSoon' | 'valid' | 'unset';
  hoursLeft: number | null;
  label: string;
}

export interface Eway8HourAlarm {
  cnId: string;
  cnNo: string;
  ewbNo: string;
  truckNo: string;
  consignorName: string;
  validUpto: string;
  hoursLeft: number;
  severity: 'critical' | 'urgent';
  title: string;
  message: string;
}

function normalizeDdMmYyyyToIsoDateTime(str: string): { date: string; dateTimeLocal: string } {
  const clean = str.trim();
  // Match DD/MM/YYYY HH:MM[:SS] [AM/PM] or DD-MM-YYYY
  const m = clean.match(
    /(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i
  );
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    let hh = m[4] ? parseInt(m[4], 10) : 23;
    const min = m[5] ? m[5].padStart(2, '0') : '59';
    const ap = (m[6] || '').toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    const hhStr = String(hh).padStart(2, '0');
    return {
      date: `${yyyy}-${mm}-${dd}`,
      dateTimeLocal: `${yyyy}-${mm}-${dd}T${hhStr}:${min}`,
    };
  }
  const iso = clean.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (iso) {
    return {
      date: `${iso[1]}-${iso[2]}-${iso[3]}`,
      dateTimeLocal: `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] || '23'}:${iso[5] || '59'}`,
    };
  }
  return { date: '', dateTimeLocal: '' };
}

export function parseQrOrEwbPayload(rawInput: string): ParsedQrPayload {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return { kind: 'generic', raw: '', summary: 'Empty QR payload' };
  }

  // 1. Official DRC Verification QR: DRC|INV|... or DRC|LR|...
  if (raw.startsWith('DRC|')) {
    const parts = raw.split('|');
    const typ = (parts[1] || '').toUpperCase();
    if (typ === 'INV') {
      return {
        kind: 'drc_invoice',
        raw,
        docNo: parts[2] || '',
        docDate: parts[3] || '',
        amount: parts[4] || '',
        partyGstin: parts[5] || '',
        summary: `DRC Verified Tax Invoice ${parts[2] || ''} · Date ${parts[3] || ''} · Rs.${parts[4] || '0'}`,
      };
    }
    if (typ === 'LR') {
      return {
        kind: 'drc_lr',
        raw,
        docNo: parts[2] || '',
        docDate: parts[3] || '',
        vehicleNo: parts[4] || '',
        amount: parts[6] || '',
        summary: `DRC Verified CN/LR ${parts[2] || ''} · Truck ${parts[4] || ''} · Route ${parts[5] || ''}`,
      };
    }
  }

  // 2. JSON-formatted EWB QR (NIC / ERP export)
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const ewbNo = String(obj.ewbNo || obj.EwbNo || obj.ewayBillNo || '').trim();
      const rawDate = String(obj.ewbDate || obj.EwbDt || '').trim();
      const rawValid = String(obj.validUpto || obj.EwbValidTill || obj.validTill || '').trim();
      const veh = String(obj.vehicleNo || obj.vehNo || '').trim().toUpperCase();
      const d1 = rawDate ? normalizeDdMmYyyyToIsoDateTime(rawDate) : { date: '', dateTimeLocal: '' };
      const d2 = rawValid ? normalizeDdMmYyyyToIsoDateTime(rawValid) : { date: '', dateTimeLocal: '' };
      if (ewbNo || veh) {
        return {
          kind: 'nic_ewb',
          raw,
          ewbNo: ewbNo || undefined,
          ewbDate: d1.date || undefined,
          validUpto: d2.dateTimeLocal || undefined,
          vehicleNo: veh || undefined,
          docNo: obj.docNo ? String(obj.docNo) : undefined,
          summary: `NIC E-Way Bill ${ewbNo || '-'} ${veh ? `· Truck ${veh}` : ''} ${d2.dateTimeLocal ? `· Valid ${d2.dateTimeLocal.replace('T', ' ')}` : ''}`.trim(),
        };
      }
    } catch {
      // fall through
    }
  }

  // 3. NIC official slash/pipe QR: e.g. 123456789012/27AABCU9603R1ZM/18/11/2026 05:30:00 PM
  const slashParts = raw.split('/');
  if (slashParts.length >= 3 && /^\d{12}$/.test(slashParts[0].trim())) {
    const ewbNo = slashParts[0].trim();
    const gstin = slashParts[1]?.trim();
    const datePart = slashParts.slice(2).join('/');
    const parsedDt = normalizeDdMmYyyyToIsoDateTime(datePart);
    return {
      kind: 'nic_ewb',
      raw,
      ewbNo,
      partyGstin: gstin,
      ewbDate: parsedDt.date || undefined,
      summary: `NIC E-Way Bill ${ewbNo}${gstin ? ` · Gen By ${gstin}` : ''}${parsedDt.date ? ` · ${parsedDt.date}` : ''}`,
    };
  }

  // 4. Pipe / text key-value extraction
  const ewbMatch = raw.match(/\b(\d{12})\b/);
  const vehMatch = raw.match(/\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4})\b/i);
  const dateMatches = raw.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi) || [];
  if (ewbMatch) {
    const dt0 = dateMatches[0] ? normalizeDdMmYyyyToIsoDateTime(dateMatches[0]) : { date: '', dateTimeLocal: '' };
    const dt1 = dateMatches[1] ? normalizeDdMmYyyyToIsoDateTime(dateMatches[1]) : { date: '', dateTimeLocal: '' };
    return {
      kind: 'nic_ewb',
      raw,
      ewbNo: ewbMatch[1],
      ewbDate: dt0.date || undefined,
      validUpto: dt1.dateTimeLocal || undefined,
      vehicleNo: vehMatch ? vehMatch[1].replace(/\s+/g, '').toUpperCase() : undefined,
      summary: `E-Way Bill ${ewbMatch[1]}${vehMatch ? ` · Truck ${vehMatch[1].toUpperCase()}` : ''}`,
    };
  }

  return {
    kind: 'generic',
    raw,
    vehicleNo: vehMatch ? vehMatch[1].replace(/\s+/g, '').toUpperCase() : undefined,
    summary: `Scanned QR: ${raw.slice(0, 90)}`,
  };
}

export function getEwayBillExpiryState(validUpto?: string): EwayBillExpiryState {
  if (!validUpto || !validUpto.trim()) {
    return { status: 'unset', hoursLeft: null, label: 'No Validity Set' };
  }
  const normalized = validUpto.trim().length === 10 ? `${validUpto.trim()}T23:59:59` : validUpto.trim();
  const target = new Date(normalized);
  if (Number.isNaN(target.getTime())) {
    return { status: 'unset', hoursLeft: null, label: 'Invalid Date' };
  }
  const diffHours = (target.getTime() - Date.now()) / (1000 * 60 * 60);
  const roundedHours = Math.round(diffHours * 10) / 10;
  if (diffHours < 0) {
    return {
      status: 'expired',
      hoursLeft: roundedHours,
      label: `EWB EXPIRED (${Math.abs(Math.round(diffHours))}h ago)`,
    };
  }
  if (diffHours <= 24) {
    return {
      status: 'expiringSoon',
      hoursLeft: roundedHours,
      label: `Expiring in ${Math.max(1, Math.round(diffHours))}h`,
    };
  }
  const daysLeft = Math.floor(diffHours / 24);
  return {
    status: 'valid',
    hoursLeft: roundedHours,
    label: `Valid (${daysLeft}d ${Math.round(diffHours % 24)}h left)`,
  };
}

/**
 * Evaluates active 8-hour to 1-hour E-Way Bill countdown alarms.
 * Automatically stops once Unloading Date (or Delivered POD) is recorded for the LR.
 */
export function evaluateEway8HourAlarms(
  consignments: ConsignmentNote[],
  lorryHires: LorryHire[]
): Eway8HourAlarm[] {
  const lhByCnNo = new Map<string, LorryHire[]>();
  for (const lh of lorryHires || []) {
    const key = String(lh.cnNo || '').trim().toUpperCase();
    if (!key) continue;
    const list = lhByCnNo.get(key) || [];
    list.push(lh);
    lhByCnNo.set(key, list);
  }

  const alarms: Eway8HourAlarm[] = [];
  for (const cn of consignments || []) {
    const key = String(cn.cnNo || '').trim().toUpperCase();
    const linkedHires = key ? lhByCnNo.get(key) || [] : [];
    const hasUnloadingRecorded =
      linkedHires.some((lh) => Boolean(lh.unloadingDate && lh.unloadingDate.trim())) ||
      linkedHires.some((lh) => Boolean(lh.podReceived));

    if (hasUnloadingRecorded) continue;

    const ewbCandidates: Array<{ ewbNo: string; validUpto?: string }> = [
      ...(cn.ewayBillValidUpto
        ? [{ ewbNo: cn.ewayBillNo || cn.cnNo, validUpto: cn.ewayBillValidUpto }]
        : []),
      ...(cn.extraEwayBills || []).map((e) => ({
        ewbNo: e.no || cn.ewayBillNo || cn.cnNo,
        validUpto: e.validUpto,
      })),
    ];

    for (const item of ewbCandidates) {
      const st = getEwayBillExpiryState(item.validUpto);
      if (st.hoursLeft === null) continue;
      if (st.hoursLeft <= 8) {
        const isCritical = st.hoursLeft <= 1;
        const hrsText =
          st.hoursLeft <= 0
            ? `EXPIRED ${Math.abs(st.hoursLeft).toFixed(1)}h ago`
            : `${st.hoursLeft.toFixed(1)}h remaining`;
        alarms.push({
          cnId: cn.id,
          cnNo: cn.cnNo,
          ewbNo: item.ewbNo,
          truckNo: cn.truckNo || 'Unassigned',
          consignorName: cn.consignorName || '-',
          validUpto: item.validUpto || '',
          hoursLeft: st.hoursLeft,
          severity: isCritical ? 'critical' : 'urgent',
          title: isCritical
            ? `CRITICAL E-WAY BILL EXPIRY (<=1h): ${item.ewbNo}`
            : `E-WAY BILL COUNTDOWN (<=8h): ${item.ewbNo}`,
          message: `CN ${cn.cnNo} · EWB ${item.ewbNo} (${cn.truckNo || 'Truck'}): ${hrsText} — Extend EWB or enter Unloading Date!`,
        });
      }
    }
  }

  return alarms.sort((a, b) => a.hoursLeft - b.hoursLeft);
}

const STATE_GST_CODES: Record<string, number> = {
  'JAMMU AND KASHMIR': 1,
  'HIMACHAL PRADESH': 2,
  PUNJAB: 3,
  CHANDIGARH: 4,
  UTTARAKHAND: 5,
  HARYANA: 6,
  DELHI: 7,
  RAJASTHAN: 8,
  'UTTAR PRADESH': 9,
  BIHAR: 10,
  SIKKIM: 11,
  'ARUNACHAL PRADESH': 12,
  NAGALAND: 13,
  MANIPUR: 14,
  MIZORAM: 15,
  TRIPURA: 16,
  MEGHALAYA: 17,
  ASSAM: 18,
  'WEST BENGAL': 19,
  JHARKHAND: 20,
  ODISHA: 21,
  CHHATTISGARH: 22,
  'MADHYA PRADESH': 23,
  GUJARAT: 24,
  MAHARASHTRA: 27,
  KARNATAKA: 29,
  GOA: 30,
  KERALA: 32,
  'TAMIL NADU': 33,
  TELANGANA: 36,
  'ANDHRA PRADESH': 37,
};

function resolveStateCode(stateName?: string, fallbackGstin?: string): number {
  const clean = String(stateName || '').trim().toUpperCase();
  if (clean && STATE_GST_CODES[clean]) return STATE_GST_CODES[clean];
  const gstPrefix = Number(String(fallbackGstin || '').slice(0, 2));
  if (gstPrefix >= 1 && gstPrefix <= 38) return gstPrefix;
  return 19; // West Bengal default
}

export function buildNicPartBJson(
  cn: Pick<
    ConsignmentNote,
    | 'cnNo'
    | 'cnDate'
    | 'truckNo'
    | 'extraVehicles'
    | 'fromCity'
    | 'fromState'
    | 'ewayBillNo'
    | 'extraEwayBills'
    | 'division'
  >,
  company: Pick<CompanySettings, 'gstin' | 'companyName'>,
  reasonCode: '1' | '2' | '3' | '4' = '2',
  reasonRem = 'Transhipment / Vehicle Assigned via DRC ERP'
) {
  const ewbs = [
    ...(cn.ewayBillNo ? [cn.ewayBillNo.trim()] : []),
    ...(cn.extraEwayBills || []).map((e) => String(e.no || '').trim()).filter(Boolean),
  ];
  const vehicles = [
    cn.truckNo.trim().toUpperCase(),
    ...(cn.extraVehicles || []).map((v) => String(v || '').trim().toUpperCase()).filter(Boolean),
  ].filter(Boolean);

  const [y, m, d] = (cn.cnDate || '').split('-');
  const transDocDate = y && m && d ? `${d}/${m}/${y}` : '';
  const fromState = resolveStateCode(cn.fromState, company.gstin);

  return {
    portalFormat: 'NIC-EWB-PART-B-UPDATE-V1.03',
    generatedBy: company.companyName || 'DOLPHIN ROAD CARRIER',
    userGstin: company.gstin || '19DOTPS3540M1ZZ',
    division: cn.division || 'FTL',
    ewbUpdates: (ewbs.length > 0 ? ewbs : ['PENDING_EWB_NO']).map((ewbNo) => ({
      ewbNo,
      vehicleNo: vehicles[0] || '',
      fromPlace: (cn.fromCity || 'KOLKATA').toUpperCase(),
      fromState,
      reasonCode,
      reasonRem,
      transDocNo: cn.cnNo,
      transDocDate,
      transMode: '1',
      vehicleType: 'R',
      ...(vehicles.length > 1 ? { multiVehicleList: vehicles } : {}),
    })),
  };
}

export function downloadNicPartBJson(
  cn: ConsignmentNote | Parameters<typeof buildNicPartBJson>[0],
  company: CompanySettings
): void {
  const payload = buildNicPartBJson(cn, company);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EWB_PartB_${(cn.cnNo || 'LR').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
