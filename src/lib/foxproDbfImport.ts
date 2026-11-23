import * as XLSX from 'xlsx';
import {
  BankReceiptRecord,
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
  TransactionRecord,
  Vehicle,
} from '../types/erp';
import { makeSafeDocId, normalizeFyLabel, resolveFinancialYearFromDate, roundPaise, todayISO } from './formatters';
import { sheetToObjectsSmartHeader } from './excelImport';
import { buildAutomaticNarration, extractPaymentMetadata } from './paymentNarration';
import { extractCreditReceiptsFromRows } from '../components/BankReceiptImportModule';
import { normalizePartyMatchKey } from './partySeparation';

export interface DbfFieldDescriptor {
  name: string;
  type: string;
  length: number;
  decimalCount: number;
}

export interface ParsedDbfTable {
  fileName: string;
  fields: DbfFieldDescriptor[];
  rows: Array<Record<string, unknown>>;
}

function decodeAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0) break;
    out += String.fromCharCode(b);
  }
  return out.trim();
}

function decodeCp1252Text(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0) continue;
    out += String.fromCharCode(b);
  }
  return out.trim();
}

function julianDayToIso(julian: number): string {
  if (!Number.isFinite(julian) || julian <= 0) return '';
  let a = julian + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  a -= Math.floor((146097 * b) / 4);
  const c = Math.floor((4 * a + 3) / 1461);
  a -= Math.floor((1461 * c) / 4);
  const m = Math.floor((5 * a + 2) / 153);
  const day = a - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + c - 4800 + Math.floor(m / 10);
  if (year < 1900 || year > 2100) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Pure-JavaScript binary FoxPro / dBase (.DBF) parser supporting Visual FoxPro (0x30/0x31/0x32)
 * and dBase III/IV/V (0x03/0x83/0x8B/0xF5). Runs 100% locally in browser with zero external deps.
 */
export function parseFoxProDbfBuffer(buffer: ArrayBuffer, fileName: string): ParsedDbfTable {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 32) {
    throw new Error(`Invalid DBF file "${fileName}": header too short.`);
  }
  const view = new DataView(buffer);
  const version = view.getUint8(0);
  const validVersions = new Set([0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0xcb, 0xf5]);
  if (!validVersions.has(version)) {
    throw new Error(`Unsupported DBF signature (0x${version.toString(16)}) in "${fileName}".`);
  }

  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength < 33 || recordLength <= 0) {
    throw new Error(`Corrupt DBF header geometry in "${fileName}".`);
  }

  const fields: DbfFieldDescriptor[] = [];
  let offset = 32;
  while (offset + 32 <= headerLength && offset + 1 <= bytes.length) {
    if (bytes[offset] === 0x0d) break;
    const rawName = decodeAscii(bytes.slice(offset, offset + 11));
    const type = String.fromCharCode(bytes[offset + 11]).toUpperCase();
    const length = bytes[offset + 16];
    const decimalCount = bytes[offset + 17];
    if (rawName && length > 0) {
      fields.push({ name: rawName, type, length, decimalCount });
    }
    offset += 32;
  }

  const rows: Array<Record<string, unknown>> = [];
  const maxRecords = Math.min(
    recordCount,
    Math.floor(Math.max(0, bytes.length - headerLength) / recordLength)
  );

  for (let r = 0; r < maxRecords; r += 1) {
    const recStart = headerLength + r * recordLength;
    if (recStart + recordLength > bytes.length) break;
    const deleteFlag = bytes[recStart];
    if (deleteFlag === 0x2a) continue; // Skip deleted FoxPro records

    const row: Record<string, unknown> = {};
    let fPos = recStart + 1;
    for (const field of fields) {
      const slice = bytes.slice(fPos, Math.min(bytes.length, fPos + field.length));
      fPos += field.length;

      if (field.name.toUpperCase() === '_NULLFLAGS') continue;

      let value: unknown = '';
      if (field.type === 'I' && slice.length >= 4) {
        value = new DataView(slice.buffer, slice.byteOffset, 4).getInt32(0, true);
      } else if (field.type === 'B' && slice.length >= 8) {
        value = new DataView(slice.buffer, slice.byteOffset, 8).getFloat64(0, true);
      } else if (field.type === 'Y' && slice.length >= 8) {
        const dv = new DataView(slice.buffer, slice.byteOffset, 8);
        const low = dv.getUint32(0, true);
        const high = dv.getInt32(4, true);
        value = (high * 4294967296 + low) / 10000;
      } else if (field.type === 'T' && slice.length >= 8) {
        const dv = new DataView(slice.buffer, slice.byteOffset, 8);
        const julian = dv.getInt32(0, true);
        value = julianDayToIso(julian);
      } else if (field.type === 'D') {
        const rawD = decodeCp1252Text(slice);
        if (/^\d{8}$/.test(rawD)) {
          value = `${rawD.slice(0, 4)}-${rawD.slice(4, 6)}-${rawD.slice(6, 8)}`;
        } else {
          value = rawD;
        }
      } else if (field.type === 'L') {
        const ch = decodeCp1252Text(slice).toUpperCase();
        value = ch === 'T' || ch === 'Y' || ch === '1';
      } else if (field.type === 'N' || field.type === 'F') {
        const numText = decodeCp1252Text(slice).replace(/,/g, '');
        const parsed = Number(numText);
        value = numText !== '' && Number.isFinite(parsed) ? parsed : 0;
      } else if (field.type === 'M') {
        value = ''; // Memo pointer requires .FPT; safe fallback
      } else {
        value = decodeCp1252Text(slice);
      }
      row[field.name] = value;
    }
    rows.push(row);
  }

  return { fileName, fields, rows };
}

function normKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickStr(row: Record<string, unknown>, keys: string[]): string {
  const entries = Object.entries(row);
  for (const k of keys) {
    const target = normKey(k);
    for (const [rk, rv] of entries) {
      if (normKey(rk) === target && rv !== undefined && rv !== null && String(rv).trim() !== '') {
        return String(rv).trim();
      }
    }
  }
  for (const k of keys) {
    const target = normKey(k);
    for (const [rk, rv] of entries) {
      if (normKey(rk).includes(target) && rv !== undefined && rv !== null && String(rv).trim() !== '') {
        return String(rv).trim();
      }
    }
  }
  return '';
}

function pickNum(row: Record<string, unknown>, keys: string[]): number {
  const raw = pickStr(row, keys);
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normOptionalDate(raw: string): string {
  const s = String(raw || '').trim();
  if (!s || /^(0000|1899|1900)[-\/]/.test(s) || /^[-–/\s]+$/.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const yr = Number(s.slice(0, 4));
    return yr >= 1990 && yr <= 2100 ? s : '';
  }
  if (/^\d{8}$/.test(s)) {
    const yr = Number(s.slice(0, 4));
    return yr >= 1990 && yr <= 2100 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
  }
  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yy = ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3];
    const yr = Number(yy);
    return yr >= 1990 && yr <= 2100 ? `${yy}-${mm}-${dd}` : '';
  }
  const dt = new Date(s);
  if (!Number.isFinite(dt.getTime())) return '';
  const yr = dt.getFullYear();
  return yr >= 1990 && yr <= 2100 ? dt.toISOString().slice(0, 10) : '';
}

function normDate(raw: string): string {
  return normOptionalDate(raw) || todayISO();
}

function composeDbfAddress(row: Record<string, unknown>): string {
  const parts = [
    pickStr(row, ['add1', 'address1', 'addr1', 'address', 'padd1', 'hadd1', 'oadd1', 'badd1']),
    pickStr(row, ['add2', 'address2', 'addr2', 'padd2', 'hadd2', 'oadd2', 'badd2']),
    pickStr(row, ['add3', 'address3', 'addr3', 'padd3', 'hadd3', 'oadd3', 'badd3']),
    pickStr(row, ['city', 'town', 'place', 'station', 'dist', 'district']),
    pickStr(row, ['state', 'stname', 'statename']),
    pickStr(row, ['pin', 'pincode', 'zip']),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  // Deduplicate adjacent identical segments (e.g. add2 === city)
  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) {
      unique.push(p);
    }
  }
  return unique.join(', ').slice(0, 380);
}

interface DbfEnrichMeta {
  code?: string;
  name?: string;
  address?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
}

function mergeEnrich(target: DbfEnrichMeta | undefined, incoming: DbfEnrichMeta): DbfEnrichMeta {
  if (!target) return { ...incoming };
  return {
    code: target.code || incoming.code,
    name: target.name || incoming.name,
    address: target.address || incoming.address,
    gstin: target.gstin || incoming.gstin,
    pan: target.pan || incoming.pan,
    phone: target.phone || incoming.phone,
    email: target.email || incoming.email,
    bankName: target.bankName || incoming.bankName,
    bankAccountNo: target.bankAccountNo || incoming.bankAccountNo,
    bankIfsc: target.bankIfsc || incoming.bankIfsc,
  };
}

function fileLeafName(pathOrName: string): string {
  const parts = String(pathOrName || '').split(/[\/\\]/);
  return (parts[parts.length - 1] || pathOrName).trim().toLowerCase();
}

function isHeadCustomerDbf(leaf: string): boolean {
  return /^(head|party|partymast|acct|acmast|cust|customer).*\.dbf$/i.test(leaf);
}

function isBrokerDbf(leaf: string): boolean {
  return /^(broker|brkrmast|brkr).*\.dbf$/i.test(leaf) || leaf.includes('brkrmast');
}

function isOwnerOrVehicleMasterDbf(leaf: string): boolean {
  return (
    /^(owner|ownmast|vhmain|vehmast|courvhl|lorry|truck).*\.dbf$/i.test(leaf) ||
    leaf.includes('courvhl') ||
    leaf.includes('vhmain') ||
    leaf.includes('ownmast')
  );
}

function isDriverDbf(leaf: string): boolean {
  return /^(driver|drvrmast|drvmast).*\.dbf$/i.test(leaf) || leaf.includes('drvrmast');
}

function isDesmastDbf(leaf: string): boolean {
  return /^(desmast|destmast|dest|station).*\.dbf$/i.test(leaf) || leaf.includes('desmast');
}

function isConsignmentDbf(leaf: string): boolean {
  return (
    /^(courtran|cnmast|bilty|lrmast).*\.dbf$/i.test(leaf) ||
    leaf.includes('courtran') ||
    leaf.includes('cnmast') ||
    leaf.includes('bilty')
  );
}

function isChallanDbf(leaf: string): boolean {
  return /^(challan|challant|lhire).*\.dbf$/i.test(leaf) || leaf.includes('challant');
}

function isInvoiceDbf(leaf: string): boolean {
  return /^(bilmast|billmast|inv|invoice|taxinv).*\.dbf$/i.test(leaf) || /^inv.*\.dbf$|^tax.*\.dbf$/i.test(leaf);
}

function isLedgerVoucherDbf(leaf: string): boolean {
  if (isConsignmentDbf(leaf)) return false;
  return /^(trn|trnmast|vouch|voucher|ledger|ledg|jour).*\.dbf$/i.test(leaf);
}

export interface AutoCollectedOldDataResult {
  processedFiles: string[];
  ignoredScrapFiles: string[];
  parties: Party[];
  brokersAddedCount: number;
  vehicles: Vehicle[];
  drivers: Driver[];
  consignments: ConsignmentNote[];
  invoices: Invoice[];
  lorryHires: LorryHire[];
  transactions: TransactionRecord[];
  bankReceipts: BankReceiptRecord[];
  destinations: string[];
  warnings: string[];
}

export async function autoCollectOldDataFiles(params: {
  files: FileList | File[];
  existingInvoices: Invoice[];
  activeFy: string;
  bankAccountName: string;
  ownerUid: string;
  branchCode: string;
  staffCode: string;
}): Promise<AutoCollectedOldDataResult> {
  const fileArr = Array.from(params.files || []);
  const result: AutoCollectedOldDataResult = {
    processedFiles: [],
    ignoredScrapFiles: [],
    parties: [],
    brokersAddedCount: 0,
    vehicles: [],
    drivers: [],
    consignments: [],
    invoices: [],
    lorryHires: [],
    transactions: [],
    bankReceipts: [],
    destinations: [],
    warnings: [],
  };

  const dbfTables: Array<{ baseName: string; leaf: string; table: ParsedDbfTable }> = [];
  const bankSpreadsheets: File[] = [];

  for (const file of fileArr) {
    const rawName = (file.name || '').trim();
    const baseName = rawName.toLowerCase();
    const leaf = fileLeafName(baseName);
    if (!baseName) continue;

    // STRICT EXCLUSION RULE: Ignore scrap*.dbf & non-data index/binary files
    if (/^scrap.*\.dbf$/i.test(leaf) || leaf.includes('scrap')) {
      result.ignoredScrapFiles.push(rawName);
      continue;
    }

    if (baseName.endsWith('.dbf')) {
      try {
        const buf = await file.arrayBuffer();
        const table = parseFoxProDbfBuffer(buf, rawName);
        dbfTables.push({ baseName, leaf, table });
        result.processedFiles.push(rawName);
      } catch (err) {
        result.warnings.push(
          `${rawName}: ${err instanceof Error ? err.message : 'Failed to read DBF file.'}`
        );
      }
      continue;
    }

    if (/\.(xlsx|xls|csv)$/i.test(baseName)) {
      bankSpreadsheets.push(file);
      result.processedFiles.push(rawName);
    }
  }

  // Cross-table enrichment maps by Code & normalized Name
  const headCodeToName = new Map<string, string>();
  const destCodeToName = new Map<string, string>();
  const enrichByCode = new Map<string, DbfEnrichMeta>();
  const enrichByName = new Map<string, DbfEnrichMeta>();

  const recordEnrichFromRow = (row: Record<string, unknown>, explicitName?: string) => {
    const code = pickStr(row, ['hcode', 'pcode', 'acode', 'bcode', 'ocode', 'code', 'headcd', 'brkrid', 'owncd', 'id']).toUpperCase();
    const name =
      explicitName ||
      pickStr(row, ['hname', 'pname', 'bname', 'oname', 'brkrname', 'ownname', 'ownername', 'partyname', 'acname', 'headname', 'name']);
    const meta: DbfEnrichMeta = {
      code,
      name,
      address: composeDbfAddress(row),
      gstin: pickStr(row, ['gstno', 'gstin', 'gst', 'tin']).toUpperCase(),
      pan: pickStr(row, ['panno', 'itpan', 'pan', 'panno1']).toUpperCase(),
      phone: pickStr(row, ['phone', 'mobile', 'mob', 'tel', 'phno', 'contact']),
      email: pickStr(row, ['email', 'mail']),
      bankName: pickStr(row, ['bankname', 'bank', 'bkname']),
      bankAccountNo: pickStr(row, ['bankac', 'acno', 'accno', 'accountno']),
      bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
    };
    if (code) {
      enrichByCode.set(code, mergeEnrich(enrichByCode.get(code), meta));
      if (name && !headCodeToName.has(code)) headCodeToName.set(code, name);
    }
    const nk = normalizePartyMatchKey(name);
    if (nk) {
      enrichByName.set(nk, mergeEnrich(enrichByName.get(nk), meta));
    }
    return { code, name, meta };
  };

  // Pre-scan all master tables to populate cross-merge enrichment indexes
  for (const { leaf, table } of dbfTables) {
    if (
      isHeadCustomerDbf(leaf) ||
      isBrokerDbf(leaf) ||
      isOwnerOrVehicleMasterDbf(leaf) ||
      isDriverDbf(leaf)
    ) {
      table.rows.forEach((row) => {
        recordEnrichFromRow(row);
      });
    }
  }

  // First pass: map HEAD/PARTY/ACCT (Customer), BROKER (Broker), OWNER/VHMAIN (TruckOwner + Vehicle), DRIVER, DESMAST
  const seenCustomerKeys = new Map<string, number>();
  const seenBrokerKeys = new Map<string, number>();
  const seenOwnerKeys = new Map<string, number>();
  const seenVehicleTrucks = new Set<string>();

  const applyEnrichmentToParty = (p: Party, code?: string): Party => {
    const byCode = code ? enrichByCode.get(code.toUpperCase()) : undefined;
    const byName = enrichByName.get(normalizePartyMatchKey(p.name));
    return {
      ...p,
      address: p.address || byCode?.address || byName?.address || '',
      gstin: p.gstin || byCode?.gstin || byName?.gstin || '',
      pan: p.pan || byCode?.pan || byName?.pan || '',
      phone: p.phone || byCode?.phone || byName?.phone || '',
      email: p.email || byCode?.email || byName?.email || '',
      bankName: p.bankName || byCode?.bankName || byName?.bankName || '',
      bankAccountNo: p.bankAccountNo || byCode?.bankAccountNo || byName?.bankAccountNo || '',
      bankIfsc: p.bankIfsc || byCode?.bankIfsc || byName?.bankIfsc || '',
    };
  };

  for (const { leaf, table } of dbfTables) {
    if (isHeadCustomerDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const name = pickStr(row, ['hname', 'pname', 'partyname', 'headname', 'acname', 'custname', 'name']);
        if (!name) return;
        const code = pickStr(row, ['hcode', 'pcode', 'acode', 'code', 'headcd', 'id']).toUpperCase();
        if (code) headCodeToName.set(code, name);

        const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'openbal', 'op_bal', 'balance'])));
        const dcRaw = pickStr(row, ['opdc', 'drcr', 'dc', 'baltype']).toUpperCase();

        // STRICT RULE: HEAD.DBF / PARTY.DBF / ACCT.DBF ALWAYS map to Customers / Billing Parties (never auto-moved to Brokers)
        const rawParty: Party = applyEnrichmentToParty(
          {
            id: makeSafeDocId(`dbf_head_${idx}`),
            name,
            partyType: 'Customer',
            address: composeDbfAddress(row),
            gstin: pickStr(row, ['gstno', 'gstin', 'gst', 'tin']).toUpperCase(),
            pan: pickStr(row, ['panno', 'itpan', 'pan']).toUpperCase(),
            phone: pickStr(row, ['phone', 'mobile', 'mob', 'tel', 'phno', 'contact']),
            email: pickStr(row, ['email', 'mail']),
            bankName: pickStr(row, ['bankname', 'bank', 'bkname']),
            bankAccountNo: pickStr(row, ['bankac', 'acno', 'accno', 'accountno']),
            bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
            openingBalance: opBal,
            currentBalance: opBal,
            balanceType: dcRaw.startsWith('C') ? 'Cr' : 'Dr',
            ownerUid: params.ownerUid,
          },
          code
        );

        const dedupKey = `${normalizePartyMatchKey(rawParty.name)}::${rawParty.gstin || code}`;
        const existingIdx = seenCustomerKeys.get(dedupKey);
        if (existingIdx !== undefined) {
          const prev = result.parties[existingIdx];
          result.parties[existingIdx] = {
            ...prev,
            address: prev.address || rawParty.address,
            gstin: prev.gstin || rawParty.gstin,
            pan: prev.pan || rawParty.pan,
            phone: prev.phone || rawParty.phone,
            email: prev.email || rawParty.email,
            bankName: prev.bankName || rawParty.bankName,
            bankAccountNo: prev.bankAccountNo || rawParty.bankAccountNo,
            bankIfsc: prev.bankIfsc || rawParty.bankIfsc,
            openingBalance: prev.openingBalance || rawParty.openingBalance,
            currentBalance: prev.currentBalance || rawParty.currentBalance,
          };
        } else {
          seenCustomerKeys.set(dedupKey, result.parties.length);
          result.parties.push(rawParty);
        }
      });
    } else if (isBrokerDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const name = pickStr(row, ['bname', 'brkrname', 'brkname', 'brokername', 'pname', 'name']);
        if (!name) return;
        const code = pickStr(row, ['bcode', 'brkrcd', 'code', 'id']).toUpperCase();
        if (code) headCodeToName.set(code, name);

        const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])));
        const rawBroker: Party = applyEnrichmentToParty(
          {
            id: makeSafeDocId(`dbf_brk_${idx}`),
            name,
            partyType: 'Broker',
            address: composeDbfAddress(row),
            gstin: pickStr(row, ['gstno', 'gstin', 'gst']).toUpperCase(),
            pan: pickStr(row, ['panno', 'itpan', 'pan']).toUpperCase(),
            phone: pickStr(row, ['phone', 'mobile', 'mob', 'tel', 'phno']),
            email: pickStr(row, ['email', 'mail']),
            bankName: pickStr(row, ['bankname', 'bank']),
            bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
            bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
            openingBalance: opBal,
            currentBalance: opBal,
            balanceType: 'Cr',
            ownerUid: params.ownerUid,
          },
          code
        );

        const dedupKey = normalizePartyMatchKey(rawBroker.name);
        if (!seenBrokerKeys.has(dedupKey)) {
          seenBrokerKeys.set(dedupKey, result.parties.length);
          result.parties.push(rawBroker);
          result.brokersAddedCount += 1;
        }
      });
    } else if (isOwnerOrVehicleMasterDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const truckNo = pickStr(row, ['vehno', 'lorryno', 'vhlno', 'truckno', 'regno'])
          .toUpperCase()
          .replace(/\s+/g, '');
        const ownerName = pickStr(row, ['oname', 'ownname', 'ownername', 'owner', 'pname', 'name']);
        const code = pickStr(row, ['ocode', 'owncd', 'code', 'id']).toUpperCase();

        if (truckNo && !seenVehicleTrucks.has(truckNo)) {
          seenVehicleTrucks.add(truckNo);
          const fitStr = pickStr(row, ['fitdt', 'fitexp', 'fitness']);
          const insStr = pickStr(row, ['insdt', 'insexp', 'insurance']);
          const prmStr = pickStr(row, ['prmdt', 'permit']);
          const taxStr = pickStr(row, ['taxdt', 'roadtax', 'taxexp']);
          const pucStr = pickStr(row, ['pucdt', 'puc']);
          result.vehicles.push({
            id: makeSafeDocId(`dbf_vhl_${idx}`),
            truckNo,
            vehicleType: pickStr(row, ['vhltype', 'vehtype', 'type', 'model', 'capacity']) || 'Goods Carrier',
            ownerName: ownerName || 'Market / Fleet Owner',
            ownerPhone: pickStr(row, ['phone', 'mobile', 'ownerph', 'tel']),
            engineNo: pickStr(row, ['engineno', 'engno', 'engine']),
            chassisNo: pickStr(row, ['chassisno', 'chasno', 'chasisno', 'chassis']),
            fitnessExpiry: fitStr ? normOptionalDate(fitStr) : '',
            insuranceExpiry: insStr ? normOptionalDate(insStr) : '',
            permitExpiry: prmStr ? normOptionalDate(prmStr) : '',
            roadTaxExpiry: taxStr ? normOptionalDate(taxStr) : '',
            pucExpiry: pucStr ? normOptionalDate(pucStr) : '',
            ownerUid: params.ownerUid,
          });
        }

        if (ownerName && !/^market\s*\/\s*fleet\s*owner$/i.test(ownerName)) {
          const ownKey = normalizePartyMatchKey(ownerName);
          if (!seenOwnerKeys.has(ownKey)) {
            seenOwnerKeys.set(ownKey, result.parties.length);
            const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])));
            result.parties.push(
              applyEnrichmentToParty(
                {
                  id: makeSafeDocId(`dbf_own_${idx}`),
                  name: ownerName,
                  partyType: 'TruckOwner',
                  address: composeDbfAddress(row),
                  gstin: pickStr(row, ['gstno', 'gstin']).toUpperCase(),
                  pan: pickStr(row, ['panno', 'itpan', 'pan']).toUpperCase(),
                  phone: pickStr(row, ['phone', 'mobile', 'ownerph', 'tel', 'phno']),
                  email: pickStr(row, ['email', 'mail']),
                  bankName: pickStr(row, ['bankname', 'bank']),
                  bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
                  bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
                  openingBalance: opBal,
                  currentBalance: opBal,
                  balanceType: 'Cr',
                  ownerUid: params.ownerUid,
                },
                code
              )
            );
          }
        }
      });
    } else if (isDesmastDbf(leaf)) {
      table.rows.forEach((row) => {
        const name = pickStr(row, ['desname', 'destname', 'destination', 'city', 'place', 'name']);
        const code = pickStr(row, ['descode', 'destcd', 'code', 'id']);
        if (name) {
          result.destinations.push(name);
          if (code) destCodeToName.set(code.toUpperCase(), name);
        }
      });
    } else if (isDriverDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const name = pickStr(row, ['drvrname', 'drvname', 'drivername', 'name']);
        if (!name) return;
        const dlNo = pickStr(row, ['dlno', 'licno', 'license', 'lic_no']) || `DL-OLD-${idx + 1}`;
        const rawDlExp = pickStr(row, ['dlexp', 'licexp', 'expiry', 'expdt', 'dlvalid']);
        // Leave dlExpiry blank '' when DBF has no expiry date so missing dates don't inflate D/L alerts
        const parsedDlExp = rawDlExp ? normOptionalDate(rawDlExp) : '';
        result.drivers.push({
          id: makeSafeDocId(`dbf_drv_${idx}`),
          name,
          dlNo,
          dlExpiry: parsedDlExp,
          phone: pickStr(row, ['phone', 'mobile', 'tel', 'phno']),
          address: composeDbfAddress(row),
          aadhaarNo: pickStr(row, ['aadhaar', 'uid', 'aadhar']),
          panNo: pickStr(row, ['panno', 'itpan', 'pan']).toUpperCase(),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
          ownerUid: params.ownerUid,
        });
      });
    }
  }

  // Second pass: Consignments (`courtran`/`cnmast`/`bilty`), Invoices (`bilmast`/`inv`/`tax`), Challans (`challan`/`challant`), Ledger (`trn`/`vouch`/`ledger`)
  for (const { leaf, table } of dbfTables) {
    if (isConsignmentDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'biltyno', 'grno', 'cno', 'docno']);
        const rawConsignorCode = pickStr(row, ['cnorcd', 'hcode', 'pcode', 'consignor', 'cnor', 'party']).toUpperCase();
        const consignorName =
          pickStr(row, ['cnorname', 'consignorname', 'consignor', 'partyname', 'pname', 'sname']) ||
          headCodeToName.get(rawConsignorCode) ||
          rawConsignorCode;
        if (!cnNo && !consignorName) return;

        const cnDate = normDate(pickStr(row, ['cndate', 'lrdate', 'bdate', 'date', 'dt']));
        const rawToCode = pickStr(row, ['descode', 'destcd', 'tocity', 'to', 'dest']).toUpperCase();
        const toCity =
          destCodeToName.get(rawToCode) ||
          pickStr(row, ['tocity', 'destname', 'destination', 'to', 'station']) ||
          rawToCode ||
          'DELIVERY';
        const totalFreight = roundPaise(pickNum(row, ['totfrt', 'freight', 'totalfreight', 'frtamt', 'amount']));
        const paidAmount = roundPaise(pickNum(row, ['paidamt', 'advance', 'paid']));
        const toPayAmount = roundPaise(pickNum(row, ['topayamt', 'topay']) || Math.max(0, totalFreight - paidAmount));
        const nettWeight = pickNum(row, ['nett', 'netwt', 'weight', 'wt']);
        const grossWeight = pickNum(row, ['gross', 'grosswt', 'wt']) || nettWeight;
        const taxInvNo = pickStr(row, ['invno', 'billno', 'taxinvno', 'pino']);
        const resolvedFy = resolveFinancialYearFromDate(cnDate) || normalizeFyLabel(params.activeFy);

        result.consignments.push({
          id: makeSafeDocId(`dbf_cn_${idx}`),
          cnNo: cnNo || `OLD-CN-${idx + 1}`,
          cnDate,
          financialYear: resolvedFy,
          deliveryOffice: toCity,
          billingPartyName: consignorName || 'Customer',
          consignorName: consignorName || 'Customer',
          consignorAddress: pickStr(row, ['cnoradd', 'consignoraddr', 'address']),
          consignorGstin: pickStr(row, ['cnorgst', 'gstno', 'gstin']).toUpperCase(),
          consigneeName:
            pickStr(row, ['cneename', 'consignee', 'cnee', 'rname']) || consignorName || 'Consignee',
          consigneeAddress: pickStr(row, ['cneeadd', 'consigneeaddr']),
          consigneeGstin: pickStr(row, ['cneegst']).toUpperCase(),
          packages: pickStr(row, ['pkgs', 'packages', 'qty', 'nopkg']) || '1',
          particulars: pickStr(row, ['item', 'particulars', 'goods', 'desc', 'descr']) || 'Goods Consignment',
          nettWeight,
          grossWeight,
          loadingCharge: roundPaise(pickNum(row, ['loading', 'ldchg', 'hamali'])),
          unloadingCharge: roundPaise(pickNum(row, ['unloading', 'ulchg'])),
          returnLorryCharge: roundPaise(pickNum(row, ['return', 'detention'])),
          sttCharge: roundPaise(pickNum(row, ['stt', 'stchg', 'sur'])),
          totalFreight,
          paidAmount,
          toPayAmount,
          taxInvNo,
          taxInvDate: taxInvNo ? cnDate : '',
          ewayBillNo: pickStr(row, ['eway', 'ewbno', 'ewaybill']),
          ewayBillDate: pickStr(row, ['eway']) ? cnDate : '',
          valueOfGoods: roundPaise(pickNum(row, ['valgoods', 'goodsval', 'invval', 'value'])),
          truckNo: pickStr(row, ['vehno', 'lorryno', 'vhlno', 'truckno']).toUpperCase().replace(/\s+/g, '') || '-',
          fromCity: pickStr(row, ['fromcity', 'from', 'origin']) || 'KOLKATA',
          toCity,
          driverName: pickStr(row, ['drvrname', 'driver', 'drvname']),
          driverDlNo: pickStr(row, ['dlno', 'drvdl']),
          gstPaidBy: pickStr(row, ['gstby', 'gstpaidby']) || 'Consignee',
          remarks: pickStr(row, ['remarks', 'remark', 'rem', 'note']),
          billed: Boolean(taxInvNo),
          branchCode: params.branchCode,
          createdByStaff: params.staffCode,
          ownerUid: params.ownerUid,
        });
      });
    } else if (isChallanDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'challanno', 'chlnno', 'docno']);
        const truckNo = pickStr(row, ['vehno', 'lorryno', 'vhlno', 'truckno']).toUpperCase().replace(/\s+/g, '');
        if (!cnNo && !truckNo) return;
        const cnDate = normDate(pickStr(row, ['chlndt', 'cndate', 'date', 'dt']));
        const hireAmount = roundPaise(pickNum(row, ['hireamt', 'lorryhire', 'hire', 'freight', 'amount']));
        const advancePaid = roundPaise(pickNum(row, ['advamt', 'advance', 'adv']));
        const loadingCharge = roundPaise(pickNum(row, ['loading', 'ldchg']));
        const unloadingCharge = roundPaise(pickNum(row, ['unloading', 'ulchg']));
        const balancePayable = roundPaise(
          pickNum(row, ['balamt', 'balance']) ||
            Math.max(0, hireAmount - advancePaid - loadingCharge - unloadingCharge)
        );
        const podDt = pickStr(row, ['poddt', 'poddate', 'recdt']);

        result.lorryHires.push({
          id: makeSafeDocId(`dbf_lh_${idx}`),
          cnNo: cnNo || `CHLN-${idx + 1}`,
          cnDate,
          financialYear: resolveFinancialYearFromDate(cnDate) || normalizeFyLabel(params.activeFy),
          truckNo: truckNo || '-',
          ownerName: pickStr(row, ['oname', 'owner', 'ownername', 'ownname', 'party']),
          brokerName: pickStr(row, ['bname', 'broker', 'brkrname', 'brokername']),
          fromCity: pickStr(row, ['fromcity', 'from', 'origin']) || 'KOLKATA',
          toCity: pickStr(row, ['tocity', 'to', 'dest', 'destination']) || 'DELIVERY',
          hireAmount,
          advancePaid,
          loadingCharge,
          unloadingCharge,
          balancePayable,
          podReceived: Boolean(podDt),
          podReceiveDate: podDt ? normOptionalDate(podDt) : '',
          balancePaid: balancePayable <= 0,
          branchCode: params.branchCode,
          createdByStaff: params.staffCode,
          ownerUid: params.ownerUid,
        });
      });
    } else if (isInvoiceDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const invoiceNo = pickStr(row, ['invno', 'billno', 'taxinvno', 'docno']);
        const rawPartyCode = pickStr(row, ['hcode', 'pcode', 'acode', 'partycd', 'custcd']).toUpperCase();
        const partyName =
          pickStr(row, ['partyname', 'pname', 'hname', 'custname', 'customer', 'name']) ||
          headCodeToName.get(rawPartyCode) ||
          rawPartyCode;
        if (!invoiceNo && !partyName) return;

        const invoiceDate = normDate(pickStr(row, ['invdate', 'billdate', 'bdate', 'date', 'dt']));
        const freightCharges = roundPaise(pickNum(row, ['freight', 'frtamt', 'taxable', 'basicamt', 'amount']));
        const detentionCharges = roundPaise(pickNum(row, ['detention', 'detamt']));
        const unloadingCharges = roundPaise(pickNum(row, ['unloading', 'ulamt']));
        const stCharges = roundPaise(pickNum(row, ['stt', 'stchg', 'otherchg']));
        const cgstAmt = roundPaise(pickNum(row, ['cgst', 'cgstamt']));
        const sgstAmt = roundPaise(pickNum(row, ['sgst', 'sgstamt']));
        const igstAmt = roundPaise(pickNum(row, ['igst', 'igstamt']));
        const totalTax = roundPaise(
          pickNum(row, ['tottax', 'gstamt', 'taxamt']) || cgstAmt + sgstAmt + igstAmt
        );
        const grandTotal = roundPaise(
          pickNum(row, ['grandtot', 'netamt', 'billamt', 'totamt', 'total']) ||
            freightCharges + detentionCharges + unloadingCharges + stCharges + totalTax
        );
        const paidAmount = roundPaise(pickNum(row, ['paidamt', 'recdamt', 'paid', 'received']));
        const gstRate =
          pickNum(row, ['gstrate', 'gstpct']) ||
          (totalTax > 0 && freightCharges > 0 ? Math.round((totalTax / freightCharges) * 100) : 5);
        const status: Invoice['status'] =
          paidAmount >= grandTotal && grandTotal > 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid';

        const linkedCnNo = pickStr(row, ['cnno', 'lrno', 'biltyno']);
        const matchingCn = result.consignments.find(
          (c) =>
            (linkedCnNo && c.cnNo.toLowerCase() === linkedCnNo.toLowerCase()) ||
            (invoiceNo && (c.taxInvNo || '').toLowerCase() === invoiceNo.toLowerCase())
        );

        const enrichParty =
          enrichByCode.get(rawPartyCode) ||
          enrichByName.get(normalizePartyMatchKey(partyName));

        result.invoices.push({
          id: makeSafeDocId(`dbf_inv_${idx}`),
          invoiceNo: invoiceNo || `OLD-INV-${idx + 1}`,
          invoiceDate,
          dueDate: invoiceDate,
          financialYear: resolveFinancialYearFromDate(invoiceDate) || normalizeFyLabel(params.activeFy),
          partyName: partyName || 'Customer',
          partyAddress: composeDbfAddress(row) || enrichParty?.address || '',
          partyGstin: pickStr(row, ['gstno', 'gstin', 'partygst', 'gst']).toUpperCase() || enrichParty?.gstin || '',
          partyPan: pickStr(row, ['panno', 'itpan', 'pan']).toUpperCase() || enrichParty?.pan || '',
          sac: '996791',
          reverseCharge: totalTax <= 0,
          gstRate,
          cgstAmt,
          sgstAmt,
          igstAmt,
          totalTax,
          freightCharges,
          detentionCharges,
          unloadingCharges,
          stCharges,
          grandTotal,
          paidAmount,
          status,
          remarks: pickStr(row, ['remarks', 'note', 'narration']),
          consignmentRows: matchingCn
            ? [
                {
                  cnNo: matchingCn.cnNo,
                  cnDate: matchingCn.cnDate,
                  vehicle: matchingCn.truckNo,
                  from: matchingCn.fromCity || 'KOLKATA',
                  to: matchingCn.toCity || 'DELIVERY',
                  weight: Number(matchingCn.nettWeight || matchingCn.grossWeight || 0),
                  packages: matchingCn.packages || '1',
                  rateType: 'Fixed',
                  ratePerMt: 0,
                  freight: freightCharges || matchingCn.totalFreight,
                  description: matchingCn.particulars || 'Freight Charges',
                },
              ]
            : [
                {
                  cnNo: linkedCnNo || '-',
                  cnDate: invoiceDate,
                  vehicle: pickStr(row, ['vehno', 'lorryno', 'vhlno', 'truckno']) || '-',
                  from: pickStr(row, ['fromcity', 'from']) || 'KOLKATA',
                  to: pickStr(row, ['tocity', 'route', 'to']) || 'All-India FTL',
                  weight: pickNum(row, ['weight', 'wt']),
                  packages: pickStr(row, ['pkgs', 'packages']) || '1',
                  rateType: 'Fixed',
                  ratePerMt: 0,
                  freight: freightCharges,
                  description: pickStr(row, ['particulars', 'goods']) || 'Road Freight Charges',
                },
              ],
          branchCode: params.branchCode,
          createdByStaff: params.staffCode,
          ownerUid: params.ownerUid,
        });
      });
    } else if (isLedgerVoucherDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const rawCode = pickStr(row, ['hcode', 'acode', 'pcode', 'bcode', 'ocode', 'partycd', 'code']).toUpperCase();
        const partyName =
          pickStr(row, ['partyname', 'hname', 'pname', 'acname', 'bname', 'oname', 'name']) ||
          headCodeToName.get(rawCode) ||
          rawCode;
        if (!partyName) return;

        const drAmt = roundPaise(Math.abs(pickNum(row, ['dramt', 'debit', 'dr'])));
        const crAmt = roundPaise(Math.abs(pickNum(row, ['cramt', 'credit', 'cr'])));
        const genericAmt = roundPaise(Math.abs(pickNum(row, ['amount', 'amt', 'vamt', 'netamt', 'total'])));
        const drcrFlag = pickStr(row, ['drcr', 'dc', 'trtype', 'vtype', 'type']).toUpperCase();

        const isDebit =
          drAmt > 0 && crAmt === 0
            ? true
            : crAmt > 0 && drAmt === 0
            ? false
            : drcrFlag.startsWith('D') || /bill|sale|inv|debit|\bdr\b/i.test(drcrFlag);

        const amount = roundPaise(isDebit ? drAmt || genericAmt : crAmt || genericAmt);
        if (amount <= 0) return;

        const txDate = normDate(pickStr(row, ['vdate', 'trndate', 'date', 'dt', 'docdt']));
        const vNo =
          pickStr(row, ['vno', 'vouchno', 'vchno', 'trno', 'docno', 'refno', 'billno']) ||
          `DBF-${idx + 1}`;
        const rawNarr = pickStr(row, ['narration', 'narr', 'particulars', 'desc', 'remarks', 'note']);
        const modeRaw = pickStr(row, ['mode', 'paymode', 'pmode', 'bank']);
        const refNo = pickStr(row, ['refno', 'utr', 'cheque', 'chqno', 'billno', 'cnno']);
        const resolvedFy = resolveFinancialYearFromDate(txDate) || normalizeFyLabel(params.activeFy);

        const meta = extractPaymentMetadata({
          description: rawNarr || modeRaw,
          referenceNo: refNo || vNo,
          rawMode: modeRaw,
        });

        result.transactions.push({
          id: makeSafeDocId(`dbf_trn_${idx}`),
          txCode: vNo.slice(0, 40),
          txDate,
          financialYear: resolvedFy,
          txType: isDebit ? 'Expense' : 'Income',
          ledgerAccount: isDebit ? 'Party Ledger Receivable (Dr)' : 'Party Ledger Receipt (Cr)',
          partyName: partyName.slice(0, 120),
          amount,
          narration: (rawNarr || `${isDebit ? 'Debit' : 'Credit'} Voucher ${vNo} (${resolvedFy})`).slice(0, 300),
          paymentMode: meta.paymentMode || 'Cash',
          referenceNo: refNo.slice(0, 60),
          upiRefId: meta.upiRefId || '',
          utrNo: meta.utrNo || '',
          chequeNo: meta.chequeNo || '',
          tdsAmount: roundPaise(pickNum(row, ['tds', 'tdsamt'])),
          linkedCnNo: pickStr(row, ['cnno', 'lrno']).slice(0, 40),
          linkedInvoiceNo: '',
          branchCode: params.branchCode,
          createdByStaff: params.staffCode,
          ownerUid: params.ownerUid,
        });
      });
    }
  }

  // Third pass: Bank PNB / Excel / CSV statements -> Credits + UPI Ref / UTR / Cheque + Auto 194C TDS
  const combinedInvoices = [...params.existingInvoices, ...result.invoices];
  for (const xlFile of bankSpreadsheets) {
    try {
      const buf = await xlFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) continue;
      const ws = wb.Sheets[firstSheet];
      const smartRows = sheetToObjectsSmartHeader(ws);
      const receipts = extractCreditReceiptsFromRows({
        rows: smartRows,
        invoices: combinedInvoices,
        activeFy: params.activeFy,
        bankAccountName: params.bankAccountName,
        sourceFileName: xlFile.name,
        branchCode: params.branchCode,
        staffCode: params.staffCode,
        ownerUid: params.ownerUid,
      }).map((r) => {
        const meta = extractPaymentMetadata({
          description: r.description,
          referenceNo: r.referenceNo,
          rawMode: r.paymentMode,
        });
        return {
          ...r,
          paymentMode: r.paymentMode || meta.paymentMode,
          upiRefId: r.upiRefId || meta.upiRefId,
          utrNo: r.utrNo || meta.utrNo,
          chequeNo: r.chequeNo || meta.chequeNo,
          narration:
            r.narration ||
            buildAutomaticNarration({
              txType: 'Income',
              partyName: r.partyName,
              amount: r.creditAmount,
              paymentMode: r.paymentMode || meta.paymentMode,
              upiRefId: r.upiRefId || meta.upiRefId,
              utrNo: r.utrNo || meta.utrNo,
              chequeNo: r.chequeNo || meta.chequeNo,
              referenceNo: r.referenceNo,
              linkedInvoiceNo: r.matchedInvoiceNo,
              bankAccountName: r.bankAccountName,
              tdsAmount: r.tdsAmount,
            }),
        };
      });
      result.bankReceipts.push(...receipts);
    } catch (err) {
      result.warnings.push(
        `${xlFile.name}: ${err instanceof Error ? err.message : 'Failed to parse Excel statement.'}`
      );
    }
  }

  // Final count sync: preserve exact role mapping without reclassifying HEAD customers into Brokers
  result.brokersAddedCount = result.parties.filter((p) => p.partyType === 'Broker').length;
  result.destinations = Array.from(new Set(result.destinations.filter(Boolean))).sort();
  return result;
}
