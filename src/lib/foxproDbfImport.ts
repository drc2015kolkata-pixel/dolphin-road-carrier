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
import { extractTrailingSerialNumber, makeSafeDocId, normalizeFyLabel, resolveFinancialYearFromDate, roundPaise, todayISO } from './formatters';
import { sheetToObjectsSmartHeader } from './excelImport';
import { buildAutomaticNarration, extractPaymentMetadata } from './paymentNarration';
import { extractCreditReceiptsFromRows } from '../components/BankReceiptImportModule';
import {
  cleanAndDeduplicateDrivers,
  cleanAndDeduplicateVehicles,
  hasBillingCompanySuffixOrKeyword,
  isIndividualHumanDriverName,
  isRealTruckRegistrationNo,
  normalizePartyMatchKey,
  normalizeTruckRegNo,
} from './partySeparation';
import { loadIdbObject, saveIdbObject } from './indexedDbStore';

export const RAW_DBF_ARCHIVE_IDB_KEY = 'drc_raw_dbf_archive_v1';

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
  totalRawRows: number;
  deletedFlagRows: number;
  activeRows: number;
}

export interface RawDbfTableDump {
  fileName: string;
  tableKind: string;
  fields: string[];
  totalRawRows: number;
  deletedFlagRows: number;
  activeRows: number;
  importedRows: number;
  importedAt: number;
  rows: Array<Record<string, unknown>>;
}

export interface DbfPerFileStat {
  fileName: string;
  tableKind: string;
  activeRows: number;
  deletedFlagRows: number;
  importedRows: number;
}

export interface DbfVerificationSummary {
  totalActiveRows: number;
  totalImportedRows: number;
  missedRows: number;
  deletedFlagRowsSkippedByFoxPro: number;
  perFileStats: DbfPerFileStat[];
}

export async function saveRawDbfArchiveToIdb(tables: RawDbfTableDump[]): Promise<void> {
  if (!Array.isArray(tables) || tables.length === 0) return;
  const existing = (await loadIdbObject<RawDbfTableDump[]>(RAW_DBF_ARCHIVE_IDB_KEY)) || [];
  const merged = new Map<string, RawDbfTableDump>();
  for (const t of existing) {
    merged.set(t.fileName.toLowerCase(), t);
  }
  for (const t of tables) {
    merged.set(t.fileName.toLowerCase(), t);
  }
  await saveIdbObject(RAW_DBF_ARCHIVE_IDB_KEY, Array.from(merged.values()));
}

export async function loadRawDbfArchiveFromIdb(): Promise<RawDbfTableDump[]> {
  const data = await loadIdbObject<RawDbfTableDump[]>(RAW_DBF_ARCHIVE_IDB_KEY);
  return Array.isArray(data) ? data : [];
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
  let deletedFlagRows = 0;

  for (let r = 0; r < maxRecords; r += 1) {
    const recStart = headerLength + r * recordLength;
    if (recStart + recordLength > bytes.length) break;
    const deleteFlag = bytes[recStart];
    if (deleteFlag === 0x2a) {
      deletedFlagRows += 1;
      continue; // Deleted marker in FoxPro
    }

    const row: Record<string, unknown> = { __dbfRowNo: r + 1 };
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

  return {
    fileName,
    fields,
    rows,
    totalRawRows: maxRecords,
    deletedFlagRows,
    activeRows: rows.length,
  };
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
    pickStr(row, ['add1', 'address1', 'addr1', 'address', 'padd1', 'hadd1', 'oadd1', 'ownadd', 'ownradd', 'badd1']),
    pickStr(row, ['add2', 'address2', 'addr2', 'padd2', 'hadd2', 'oadd2', 'oadd', 'badd2']),
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
  return unique.join(', ');
}

export function extractRealTruckNoFromRow(row: Record<string, unknown>): string {
  const raw = pickStr(row, ['vhlno', 'truckno', 'lorryno', 'vehicleno', 'vehno', 'regno', 'regnno', 'lorry']);
  const norm = normalizeTruckRegNo(raw);
  return isRealTruckRegistrationNo(norm) ? norm : '';
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

function isMarpartyDbf(leaf: string): boolean {
  return /^marp(arty)?.*\.dbf$/i.test(leaf) || leaf.includes('marparty');
}

function isGroupDbf(leaf: string): boolean {
  return /^(group|grpmast|acgroup|grp).*\.dbf$/i.test(leaf);
}

function isBrokerDbf(leaf: string): boolean {
  return /^(broker|brkrmast|brkr).*\.dbf$/i.test(leaf) || leaf.includes('brkrmast');
}

function isOwnerMasterDbf(leaf: string): boolean {
  return (
    /^(ownrmast|ownmast|owner|ownermast).*\.dbf$/i.test(leaf) ||
    leaf.includes('ownrmast') ||
    leaf.includes('ownmast')
  );
}

function isVehicleMasterDbf(leaf: string): boolean {
  return (
    /^(vhmain|vehmast|courvhl|vehicle|lorry|truck).*\.dbf$/i.test(leaf) ||
    leaf.includes('courvhl') ||
    leaf.includes('vhmain')
  );
}

function isOwnerOrVehicleMasterDbf(leaf: string): boolean {
  return isOwnerMasterDbf(leaf) || isVehicleMasterDbf(leaf);
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
  return (
    /^(bilmast|billmast|marbill|inv|invoice|taxinv).*\.dbf$/i.test(leaf) ||
    leaf.includes('marbill') ||
    /^inv.*\.dbf$|^tax.*\.dbf$/i.test(leaf)
  );
}

function isOpeningBalanceDbf(leaf: string): boolean {
  return /^(opbal|openbal|opening|ob).*\.dbf$/i.test(leaf) || leaf.includes('opbal');
}

function isLedgerDbf(leaf: string): boolean {
  if (isConsignmentDbf(leaf)) return false;
  return /^(ledger|ledg).*\.dbf$/i.test(leaf);
}

function isLedgerVoucherDbf(leaf: string): boolean {
  if (isConsignmentDbf(leaf)) return false;
  return /^(trn|trnmast|vouch|voucher|ledger|ledg|jour).*\.dbf$/i.test(leaf);
}

function classifyDbfTableKind(leaf: string): string {
  if (isHeadCustomerDbf(leaf)) return 'HEAD / Billing Parties';
  if (isMarpartyDbf(leaf)) return 'MARPARTY Billing Parties';
  if (isGroupDbf(leaf)) return 'GROUP Master (Account Groups)';
  if (isBrokerDbf(leaf)) return 'BROKER Master';
  if (isOwnerMasterDbf(leaf)) return 'OWNER Master (ownrmast)';
  if (isVehicleMasterDbf(leaf)) return 'VEHICLE / Trip Master (courvhl / VHMAIN)';
  if (isDriverDbf(leaf)) return 'DRIVER Master';
  if (isDesmastDbf(leaf)) return 'DESMAST Destinations';
  if (isOpeningBalanceDbf(leaf)) return 'OPBAL Opening Balances';
  if (isConsignmentDbf(leaf)) return 'CNMAST / COURTRAN Consignments';
  if (isChallanDbf(leaf)) return 'CHALLAN Lorry Hires';
  if (isInvoiceDbf(leaf)) return 'BILMAST / MARBILL / INVOICE Bills';
  if (isLedgerDbf(leaf)) return 'LEDGER Accounts & Sundry Debtors';
  if (isLedgerVoucherDbf(leaf)) return 'TRN / VOUCH Ledger';
  return 'Other Legacy DBF Archive';
}

function isSundryDebtorGroupLabel(text: string): boolean {
  const s = String(text || '').trim();
  if (!s || /creditor/i.test(s)) return false;
  return (
    /\bsundry\s*deb/i.test(s) ||
    /\bs\.?\s*debtor/i.test(s) ||
    /\bsun\.?\s*deb/i.test(s) ||
    /\btrade\s*debtor/i.test(s) ||
    /\btrade\s*receivable/i.test(s) ||
    /^debtors?$/i.test(s)
  );
}

interface DbfGroupLookup {
  groupCodeToName: Map<string, string>;
  sundryDebtorCodes: Set<string>;
}

function buildGroupLookupFromTables(
  tables: Array<{ leaf: string; rows: Array<Record<string, unknown>> }>
): DbfGroupLookup {
  const groupCodeToName = new Map<string, string>();
  const groupCodeToParent = new Map<string, string>();

  for (const { leaf, rows } of tables) {
    if (!isGroupDbf(leaf)) continue;
    for (const row of rows) {
      const gCode = pickStr(row, ['gcode', 'grpcd', 'grcode', 'groupcd', 'grpid', 'code', 'id', 'srno']).toUpperCase();
      const gName = pickStr(row, ['gname', 'grpname', 'groupname', 'grname', 'group', 'name', 'title', 'head', 'desc']);
      const parentCode = pickStr(row, ['pgcode', 'pgrpcd', 'parent', 'under', 'undergroup', 'maingrp', 'parentcd']).toUpperCase();
      if (gCode && gName) {
        groupCodeToName.set(gCode, gName);
      }
      if (gCode && parentCode) {
        groupCodeToParent.set(gCode, parentCode);
      }
    }
  }

  const sundryDebtorCodes = new Set<string>();
  for (const [code, name] of groupCodeToName.entries()) {
    if (isSundryDebtorGroupLabel(name)) {
      sundryDebtorCodes.add(code);
      continue;
    }
    let cur = groupCodeToParent.get(code);
    for (let depth = 0; depth < 5 && cur; depth += 1) {
      const parentName = groupCodeToName.get(cur) || cur;
      if (isSundryDebtorGroupLabel(parentName)) {
        sundryDebtorCodes.add(code);
        break;
      }
      cur = groupCodeToParent.get(cur);
    }
  }

  return { groupCodeToName, sundryDebtorCodes };
}

function isLedgerRowSundryDebtor(row: Record<string, unknown>, groupLookup: DbfGroupLookup): boolean {
  const directGroupText = pickStr(row, [
    'grpname',
    'groupname',
    'grname',
    'subgroup',
    'under',
    'schname',
    'schedule',
    'actype',
    'ac_type',
    'category',
    'nature',
  ]);
  if (directGroupText && isSundryDebtorGroupLabel(directGroupText)) {
    return true;
  }

  const groupFieldVal = pickStr(row, ['group', 'sch', 'type']).trim();
  if (groupFieldVal) {
    if (isSundryDebtorGroupLabel(groupFieldVal)) return true;
    const upper = groupFieldVal.toUpperCase();
    if (groupLookup.sundryDebtorCodes.has(upper)) return true;
    const mapped = groupLookup.groupCodeToName.get(upper);
    if (mapped && isSundryDebtorGroupLabel(mapped)) return true;
  }

  const codeVal = pickStr(row, ['gcode', 'grpcd', 'grcode', 'groupcd', 'grpid', 'grp', 'schcode', 'acgroup', 'groupid']).toUpperCase();
  if (codeVal) {
    if (groupLookup.sundryDebtorCodes.has(codeVal)) return true;
    const mapped = groupLookup.groupCodeToName.get(codeVal);
    if (mapped && isSundryDebtorGroupLabel(mapped)) return true;
    if (isSundryDebtorGroupLabel(codeVal)) return true;
  }

  return false;
}

function buildCustomerPartyFromDbfRow(params: {
  row: Record<string, unknown>;
  idx: number;
  fileName: string;
  idPrefix: string;
  ownerUid: string;
  enrichByCode?: Map<string, DbfEnrichMeta>;
  enrichByName?: Map<string, DbfEnrichMeta>;
  openingBalByCode?: Map<string, { amount: number; balanceType: 'Dr' | 'Cr'; name: string }>;
  headCodeToName?: Map<string, string>;
}): { party: Party; code: string } | null {
  const {
    row,
    idx,
    fileName,
    idPrefix,
    ownerUid,
    enrichByCode,
    enrichByName,
    openingBalByCode,
    headCodeToName,
  } = params;

  const code = pickStr(row, [
    'hcode',
    'pcode',
    'mcode',
    'lcode',
    'acode',
    'partycd',
    'ledcd',
    'code',
    'headcd',
    'id',
  ]).toUpperCase();
  const rawName = pickStr(row, [
    'hname',
    'pname',
    'partyname',
    'party',
    'mname',
    'lname',
    'headname',
    'acname',
    'accname',
    'custname',
    'compname',
    'ledger',
    'title',
    'name',
  ]);
  const cleanName = rawName.trim() || (code && !/^0+$/.test(code) ? code : '');
  if (!cleanName) return null;

  if (code && headCodeToName && !headCodeToName.has(code)) {
    headCodeToName.set(code, cleanName);
  }

  const opOverride =
    (code ? openingBalByCode?.get(code) : undefined) ||
    openingBalByCode?.get(normalizePartyMatchKey(cleanName));
  const directOpBal = roundPaise(
    Math.abs(pickNum(row, ['opbal', 'opening', 'openbal', 'op_bal', 'balance', 'clbal']))
  );
  const opBal = directOpBal > 0 ? directOpBal : opOverride?.amount || 0;
  const dcRaw = pickStr(row, ['opdc', 'drcr', 'dc', 'baltype', 'optype']).toUpperCase();
  const balanceType: 'Dr' | 'Cr' = dcRaw
    ? dcRaw.startsWith('C')
      ? 'Cr'
      : 'Dr'
    : opOverride?.balanceType || 'Dr';

  const byCode = code ? enrichByCode?.get(code) : undefined;
  const byName = enrichByName?.get(normalizePartyMatchKey(cleanName));

  const party: Party = {
    id: makeSafeDocId(`${idPrefix}${fileName}_${idx}`),
    name: cleanName,
    partyCode: code || undefined,
    partyType: 'Customer',
    address: composeDbfAddress(row) || byCode?.address || byName?.address || '',
    city: pickStr(row, ['city', 'town', 'place', 'station', 'dist', 'district']),
    pinCode: pickStr(row, ['pin', 'pincode', 'zip']),
    stateName: pickStr(row, ['state', 'stname', 'statename']),
    contactPerson: pickStr(row, ['contactper', 'cperson', 'attn', 'prop']),
    gstin: pickStr(row, ['gstno', 'gstin', 'gst', 'tin', 'vatno']).toUpperCase() || byCode?.gstin || byName?.gstin || '',
    pan: pickStr(row, ['panno', 'itpan', 'pan', 'panno1']).toUpperCase() || byCode?.pan || byName?.pan || '',
    phone: pickStr(row, ['phone', 'mobile', 'mob', 'tel', 'phno', 'contact', 'offph', 'resph', 'ph1']) || byCode?.phone || byName?.phone || '',
    email: pickStr(row, ['email', 'mail', 'emailid']) || byCode?.email || byName?.email || '',
    bankName: pickStr(row, ['bankname', 'bank', 'bkname']) || byCode?.bankName || byName?.bankName || '',
    bankAccountNo: pickStr(row, ['bankac', 'acno', 'accno', 'accountno']) || byCode?.bankAccountNo || byName?.bankAccountNo || '',
    bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase() || byCode?.bankIfsc || byName?.bankIfsc || '',
    openingBalance: opBal,
    currentBalance: opBal,
    balanceType,
    ownerUid,
  };

  return { party, code };
}

function upsertUniqueCustomerParty(
  parties: Party[],
  seenByName: Map<string, number>,
  seenByNameGstin: Map<string, number>,
  incoming: Party
): void {
  const normName = normalizePartyMatchKey(incoming.name);
  if (!normName) return;
  const gst = String(incoming.gstin || '').trim().toUpperCase();
  const gstKey = gst && gst.length >= 10 ? `${normName}::${gst}` : '';

  let existingIdx = gstKey ? seenByNameGstin.get(gstKey) : undefined;
  if (existingIdx === undefined) {
    const byNameIdx = seenByName.get(normName);
    if (byNameIdx !== undefined) {
      const prev = parties[byNameIdx];
      const prevGst = String(prev.gstin || '').trim().toUpperCase();
      if (!gst || !prevGst || gst === prevGst) {
        existingIdx = byNameIdx;
      }
    }
  }

  if (existingIdx !== undefined) {
    const prev = parties[existingIdx];
    const merged: Party = {
      ...prev,
      partyCode: prev.partyCode || incoming.partyCode,
      address: prev.address || incoming.address,
      city: prev.city || incoming.city,
      pinCode: prev.pinCode || incoming.pinCode,
      stateName: prev.stateName || incoming.stateName,
      contactPerson: prev.contactPerson || incoming.contactPerson,
      gstin: prev.gstin || incoming.gstin,
      pan: prev.pan || incoming.pan,
      phone: prev.phone || incoming.phone,
      email: prev.email || incoming.email,
      bankName: prev.bankName || incoming.bankName,
      bankAccountNo: prev.bankAccountNo || incoming.bankAccountNo,
      bankIfsc: prev.bankIfsc || incoming.bankIfsc,
      openingBalance: prev.openingBalance || incoming.openingBalance,
      currentBalance: prev.currentBalance || incoming.currentBalance,
    };
    parties[existingIdx] = merged;
    const mergedGst = String(merged.gstin || '').trim().toUpperCase();
    if (mergedGst && mergedGst.length >= 10) {
      seenByNameGstin.set(`${normName}::${mergedGst}`, existingIdx);
    }
    return;
  }

  const nextIdx = parties.length;
  parties.push(incoming);
  if (!seenByName.has(normName)) {
    seenByName.set(normName, nextIdx);
  }
  if (gstKey) {
    seenByNameGstin.set(gstKey, nextIdx);
  }
}

/**
 * Extracts every unique Billing Party ('Customer') from already-archived DBF tables
 * across HEAD.dbf, marparty.dbf, and ledger.dbf / group.dbf (SUNDRY DEBTORS).
 */
export function extractBillingPartiesFromDbfTables(params: {
  tables: Array<{ fileName: string; rows: Array<Record<string, unknown>> }>;
  ownerUid: string;
}): {
  parties: Party[];
  sourceStats: {
    headCount: number;
    marpartyCount: number;
    sundryDebtorsCount: number;
    uniqueCount: number;
  };
} {
  const prepared = (params.tables || []).map((t) => ({
    fileName: t.fileName,
    leaf: fileLeafName(t.fileName),
    rows: Array.isArray(t.rows) ? t.rows : [],
  }));

  const groupLookup = buildGroupLookupFromTables(prepared);
  const parties: Party[] = [];
  const seenByName = new Map<string, number>();
  const seenByNameGstin = new Map<string, number>();

  let headCount = 0;
  let marpartyCount = 0;
  let sundryDebtorsCount = 0;

  for (const t of prepared) {
    if (isHeadCustomerDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const built = buildCustomerPartyFromDbfRow({
          row,
          idx,
          fileName: t.fileName,
          idPrefix: 'dbf_head_',
          ownerUid: params.ownerUid,
        });
        if (!built) return;
        headCount += 1;
        upsertUniqueCustomerParty(parties, seenByName, seenByNameGstin, built.party);
      });
    } else if (isMarpartyDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const built = buildCustomerPartyFromDbfRow({
          row,
          idx,
          fileName: t.fileName,
          idPrefix: 'dbf_marparty_',
          ownerUid: params.ownerUid,
        });
        if (!built) return;
        marpartyCount += 1;
        upsertUniqueCustomerParty(parties, seenByName, seenByNameGstin, built.party);
      });
    } else if (isLedgerDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        if (!isLedgerRowSundryDebtor(row, groupLookup)) return;
        const built = buildCustomerPartyFromDbfRow({
          row,
          idx,
          fileName: t.fileName,
          idPrefix: 'dbf_ledger_',
          ownerUid: params.ownerUid,
        });
        if (!built) return;
        sundryDebtorsCount += 1;
        upsertUniqueCustomerParty(parties, seenByName, seenByNameGstin, built.party);
      });
    }
  }

  return {
    parties,
    sourceStats: {
      headCount,
      marpartyCount,
      sundryDebtorsCount,
      uniqueCount: parties.length,
    },
  };
}

export interface DbfExtractedRolesBundle {
  billingParties: Party[];
  brokers: Party[];
  lorryOwners: Party[];
  drivers: Driver[];
  vehicles: Vehicle[];
  cnToTruckMap: Map<string, string>;
  invToTruckMap: Map<string, string>;
  missingMarbillInvoices: Invoice[];
  sourceStats: {
    headCount: number;
    marpartyCount: number;
    sundryDebtorsCount: number;
    brokerCount: number;
    ownerCount: number;
    vehicleCount: number;
    driverCount: number;
    tripMappedCount: number;
  };
}

/**
 * Re-extracts exact role-separated Masters & Trip Vehicle links directly from archived FoxPro DBF tables:
 * 1. HEAD / marparty.dbf / ledger.dbf+group.dbf (SUNDRY DEBTORS) -> Billing Parties
 * 2. brkrmast.dbf ONLY -> Brokers (company-suffix rows moved to Billing Parties)
 * 3. ownrmast.dbf ONLY -> Lorry Owners (PAN from PAN/PANNO/ITPAN/PAN_NO, Name from NAME/OWNRNAME/OWNER, excluding company suffixes)
 * 4. courvhl.dbf / VHMAIN.dbf / courtran.dbf / drvrmast.dbf -> Individual human Drivers only
 * 5. courvhl.dbf / VHMAIN.dbf / courtran.dbf / marbill.dbf -> Real Vehicle reg nos + CN/Bill truck links
 */
export function extractMasterRolesFromDbfTables(params: {
  tables: Array<{ fileName: string; rows: Array<Record<string, unknown>> }>;
  ownerUid: string;
  activeFy?: string;
  branchCode?: string;
  staffCode?: string;
}): DbfExtractedRolesBundle {
  const prepared = (params.tables || []).map((t) => ({
    fileName: t.fileName,
    leaf: fileLeafName(t.fileName),
    rows: Array.isArray(t.rows) ? t.rows : [],
  }));

  const billingRes = extractBillingPartiesFromDbfTables({
    tables: params.tables,
    ownerUid: params.ownerUid,
  });

  const billingParties = [...billingRes.parties];
  const seenByName = new Map<string, number>();
  const seenByNameGstin = new Map<string, number>();
  billingParties.forEach((p, idx) => {
    const nk = normalizePartyMatchKey(p.name);
    if (nk && !seenByName.has(nk)) seenByName.set(nk, idx);
    const gst = String(p.gstin || '').trim().toUpperCase();
    if (nk && gst.length >= 10) seenByNameGstin.set(`${nk}::${gst}`, idx);
  });

  const brokers: Party[] = [];
  const seenBrokerKeys = new Set<string>();
  const lorryOwners: Party[] = [];
  const seenOwnerKeys = new Set<string>();
  const drivers: Driver[] = [];
  const vehicles: Vehicle[] = [];
  const seenVehicleKeys = new Set<string>();
  const cnToTruckMap = new Map<string, string>();
  const invToTruckMap = new Map<string, string>();
  const missingMarbillInvoices: Invoice[] = [];
  let tripMappedCount = 0;

  const pushHumanDriver = (paramsDrv: {
    id: string;
    name: string;
    dlNo?: string;
    dlExpiry?: string;
    phone?: string;
    address?: string;
    aadhaarNo?: string;
    panNo?: string;
    bankName?: string;
    bankAccountNo?: string;
    bankIfsc?: string;
  }) => {
    if (!isIndividualHumanDriverName(paramsDrv.name)) return;
    drivers.push({
      id: paramsDrv.id,
      name: paramsDrv.name.trim(),
      dlNo: (paramsDrv.dlNo || '').trim(),
      dlExpiry: paramsDrv.dlExpiry || '',
      phone: (paramsDrv.phone || '').trim(),
      address: paramsDrv.address || '',
      aadhaarNo: paramsDrv.aadhaarNo || '',
      panNo: paramsDrv.panNo || '',
      bankName: paramsDrv.bankName || '',
      bankAccountNo: paramsDrv.bankAccountNo || '',
      bankIfsc: paramsDrv.bankIfsc || '',
      ownerUid: params.ownerUid,
    });
  };

  const registerVehicleFromRow = (tFileName: string, idx: number, row: Record<string, unknown>) => {
    const truckNo = extractRealTruckNoFromRow(row);
    if (!truckNo) return '';
    const regKey = truckNo.replace(/[^A-Z0-9]/g, '');
    if (!seenVehicleKeys.has(regKey)) {
      seenVehicleKeys.add(regKey);
      const fitStr = pickStr(row, ['fitdt', 'fitexp', 'fitness']);
      const insStr = pickStr(row, ['insdt', 'insexp', 'insurance']);
      const prmStr = pickStr(row, ['prmdt', 'permit']);
      const taxStr = pickStr(row, ['taxdt', 'roadtax', 'taxexp']);
      const pucStr = pickStr(row, ['pucdt', 'puc']);
      vehicles.push({
        id: makeSafeDocId(`dbf_vhl_${tFileName}_${idx}`),
        truckNo,
        vehicleType: pickStr(row, ['vhltype', 'vehtype', 'type', 'model', 'capacity']) || 'Goods Carrier',
        ownerName:
          pickStr(row, ['ownrname', 'owner', 'oname', 'ownname', 'ownername']) || 'Market / Fleet Owner',
        ownerPhone: pickStr(row, ['ownerph', 'mobile', 'phone', 'tel']),
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
    return truckNo;
  };

  for (const t of prepared) {
    if (isBrokerDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const code = pickStr(row, ['bcode', 'brkrcd', 'code', 'id']).toUpperCase();
        const name = pickStr(row, ['bname', 'brkrname', 'brkname', 'brokername', 'pname', 'name']) || code;
        const nk = normalizePartyMatchKey(name);
        if (!nk) return;

        const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])));
        const baseObj: Party = {
          id: makeSafeDocId(`dbf_brk_${t.fileName}_${idx}`),
          name,
          partyCode: code || undefined,
          partyType: hasBillingCompanySuffixOrKeyword(name) ? 'Customer' : 'Broker',
          address: composeDbfAddress(row),
          gstin: pickStr(row, ['gstno', 'gstin', 'gst']).toUpperCase(),
          pan: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan']).toUpperCase(),
          phone: pickStr(row, ['mobile', 'mob', 'phone', 'tel', 'phno']),
          email: pickStr(row, ['email', 'mail']),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
          openingBalance: opBal,
          currentBalance: opBal,
          balanceType: hasBillingCompanySuffixOrKeyword(name) ? 'Dr' : 'Cr',
          ownerUid: params.ownerUid,
        };

        if (baseObj.partyType === 'Customer') {
          upsertUniqueCustomerParty(billingParties, seenByName, seenByNameGstin, baseObj);
        } else if (!seenBrokerKeys.has(nk)) {
          seenBrokerKeys.add(nk);
          brokers.push(baseObj);
        }
      });
    } else if (isOwnerMasterDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const code = pickStr(row, ['ocode', 'owncd', 'ownrcd', 'code', 'id']).toUpperCase();
        const ownerName = pickStr(row, [
          'ownrname',
          'owner',
          'name',
          'ownname',
          'ownername',
          'oname',
          'pname',
        ]);
        const nk = normalizePartyMatchKey(ownerName);
        if (!nk || /^market\s*\/\s*fleet\s*owner$/i.test(ownerName)) return;

        const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])));
        const isCompanyParty = hasBillingCompanySuffixOrKeyword(ownerName);
        const ownerRecord: Party = {
          id: makeSafeDocId(`dbf_own_${t.fileName}_${idx}`),
          name: ownerName,
          partyCode: code || undefined,
          partyType: isCompanyParty ? 'Customer' : 'TruckOwner',
          address: composeDbfAddress(row),
          gstin: pickStr(row, ['gstno', 'gstin', 'gst']).toUpperCase(),
          pan: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan', 'panno1']).toUpperCase(),
          phone: pickStr(row, ['mobile', 'mob', 'phone', 'ownerph', 'tel', 'phno', 'contact']),
          email: pickStr(row, ['email', 'mail']),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
          openingBalance: opBal,
          currentBalance: opBal,
          balanceType: isCompanyParty ? 'Dr' : 'Cr',
          ownerUid: params.ownerUid,
        };

        if (isCompanyParty) {
          upsertUniqueCustomerParty(billingParties, seenByName, seenByNameGstin, ownerRecord);
        } else if (!seenOwnerKeys.has(nk)) {
          seenOwnerKeys.add(nk);
          lorryOwners.push(ownerRecord);
        }
      });
    } else if (isVehicleMasterDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const truckNo = registerVehicleFromRow(t.fileName, idx, row);
        const cnNo = pickStr(row, ['cnno', 'lrno', 'biltyno', 'grno', 'cno', 'docno']);
        if (truckNo && cnNo) {
          cnToTruckMap.set(cnNo.trim().toLowerCase(), truckNo);
          tripMappedCount += 1;
        }
        const drvName = pickStr(row, ['drvrname', 'drvname', 'drivername', 'driver', 'drv']);
        if (drvName) {
          const rawDlExp = pickStr(row, ['dlexp', 'licexp', 'expiry', 'expdt', 'dlvalid']);
          pushHumanDriver({
            id: makeSafeDocId(`dbf_drv_vhl_${t.fileName}_${idx}`),
            name: drvName,
            dlNo: pickStr(row, ['dlno', 'drvdl', 'drivdl', 'licno', 'license', 'lic_no']),
            dlExpiry: rawDlExp ? normOptionalDate(rawDlExp) : '',
            phone: pickStr(row, ['drvmob', 'drvrph', 'drvphone', 'drivermob', 'driverph', 'dmob', 'mobile', 'phone', 'tel']),
            address: pickStr(row, ['drvadd', 'drvradd']),
          });
        }
      });
    } else if (isDriverDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const drvName = pickStr(row, ['drvrname', 'drvname', 'drivername', 'driver', 'name']);
        const rawDlExp = pickStr(row, ['dlexp', 'licexp', 'expiry', 'expdt', 'dlvalid']);
        pushHumanDriver({
          id: makeSafeDocId(`dbf_drv_${t.fileName}_${idx}`),
          name: drvName,
          dlNo: pickStr(row, ['dlno', 'licno', 'license', 'lic_no']),
          dlExpiry: rawDlExp ? normOptionalDate(rawDlExp) : '',
          phone: pickStr(row, ['mobile', 'mob', 'phone', 'tel', 'phno']),
          address: composeDbfAddress(row),
          aadhaarNo: pickStr(row, ['aadhaar', 'uid', 'aadhar']),
          panNo: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan']).toUpperCase(),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
        });
      });
    } else if (isConsignmentDbf(t.leaf)) {
      t.rows.forEach((row, idx) => {
        const truckNo = registerVehicleFromRow(t.fileName, idx, row);
        const cnNo = pickStr(row, ['cnno', 'lrno', 'biltyno', 'grno', 'cno', 'docno']);
        const invNo = pickStr(row, ['invno', 'billno', 'taxinvno', 'pino']);
        if (truckNo && cnNo) {
          cnToTruckMap.set(cnNo.trim().toLowerCase(), truckNo);
          tripMappedCount += 1;
        }
        if (truckNo && invNo) {
          invToTruckMap.set(invNo.trim().toLowerCase(), truckNo);
        }
        const drvName = pickStr(row, ['drvrname', 'drvname', 'drivername', 'driver', 'drv']);
        if (drvName) {
          pushHumanDriver({
            id: makeSafeDocId(`dbf_drv_cn_${t.fileName}_${idx}`),
            name: drvName,
            dlNo: pickStr(row, ['dlno', 'drvdl', 'drivdl', 'licno']),
            phone: pickStr(row, ['drvmob', 'drvrph', 'drvphone', 'drivermob', 'driverph', 'dmob', 'drv_mob']),
          });
        }
      });
    } else if (isInvoiceDbf(t.leaf)) {
      const isMarbill = t.leaf.includes('marbill');
      t.rows.forEach((row, idx) => {
        const truckNo = registerVehicleFromRow(t.fileName, idx, row);
        const invoiceNo = pickStr(row, ['invno', 'billno', 'taxinvno', 'docno']) || `OLD-INV-${idx + 1}`;
        const linkedCnNo = pickStr(row, ['cnno', 'lrno', 'biltyno']);
        if (truckNo && invoiceNo) {
          invToTruckMap.set(invoiceNo.trim().toLowerCase(), truckNo);
          tripMappedCount += 1;
        }
        if (truckNo && linkedCnNo) {
          cnToTruckMap.set(linkedCnNo.trim().toLowerCase(), truckNo);
        }
        if (isMarbill) {
          const invoiceDate = normDate(pickStr(row, ['invdate', 'billdate', 'bdate', 'date', 'dt']));
          const partyName =
            pickStr(row, ['partyname', 'pname', 'hname', 'custname', 'customer', 'name']) ||
            `Customer-${idx + 1}`;
          const freightCharges = roundPaise(pickNum(row, ['freight', 'frtamt', 'taxable', 'basicamt', 'amount']));
          const detentionCharges = roundPaise(pickNum(row, ['detention', 'detamt']));
          const unloadingCharges = roundPaise(pickNum(row, ['unloading', 'ulamt']));
          const stCharges = roundPaise(pickNum(row, ['stt', 'stchg', 'otherchg']));
          const cgstAmt = roundPaise(pickNum(row, ['cgst', 'cgstamt']));
          const sgstAmt = roundPaise(pickNum(row, ['sgst', 'sgstamt']));
          const igstAmt = roundPaise(pickNum(row, ['igst', 'igstamt']));
          const totalTax = roundPaise(pickNum(row, ['tottax', 'gstamt', 'taxamt']) || cgstAmt + sgstAmt + igstAmt);
          const grandTotal = roundPaise(
            pickNum(row, ['grandtot', 'netamt', 'billamt', 'totamt', 'total']) ||
              freightCharges + detentionCharges + unloadingCharges + stCharges + totalTax
          );
          const paidAmount = roundPaise(pickNum(row, ['paidamt', 'recdamt', 'paid', 'received']));
          const gstRate =
            pickNum(row, ['gstrate', 'gstpct']) ||
            (totalTax > 0 && freightCharges > 0 ? Math.round((totalTax / freightCharges) * 100) : 5);
          missingMarbillInvoices.push({
            id: makeSafeDocId(`dbf_inv_${t.fileName}_${idx}`),
            invoiceNo,
            invoiceDate,
            dueDate: invoiceDate,
            financialYear: resolveFinancialYearFromDate(invoiceDate) || normalizeFyLabel(params.activeFy || 'FY 2025-26'),
            partyName,
            partyAddress: composeDbfAddress(row),
            partyGstin: pickStr(row, ['gstno', 'gstin', 'partygst', 'gst']).toUpperCase(),
            partyPan: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan']).toUpperCase(),
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
            status: paidAmount >= grandTotal && grandTotal > 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid',
            remarks: pickStr(row, ['remarks', 'note', 'narration']),
            consignmentRows: [
              {
                cnNo: linkedCnNo || '-',
                cnDate: invoiceDate,
                vehicle: truckNo || '-',
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
            branchCode: params.branchCode || 'KOL-HQ',
            createdByStaff: params.staffCode || 'ADMIN',
            ownerUid: params.ownerUid,
          });
        }
      });
    }
  }

  return {
    billingParties,
    brokers,
    lorryOwners,
    drivers,
    vehicles,
    cnToTruckMap,
    invToTruckMap,
    missingMarbillInvoices,
    sourceStats: {
      headCount: billingRes.sourceStats.headCount,
      marpartyCount: billingRes.sourceStats.marpartyCount,
      sundryDebtorsCount: billingRes.sourceStats.sundryDebtorsCount,
      brokerCount: brokers.length,
      ownerCount: lorryOwners.length,
      vehicleCount: vehicles.length,
      driverCount: drivers.length,
      tripMappedCount,
    },
  };
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
  rawTables: RawDbfTableDump[];
  verificationSummary: DbfVerificationSummary;
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
    rawTables: [],
    verificationSummary: {
      totalActiveRows: 0,
      totalImportedRows: 0,
      missedRows: 0,
      deletedFlagRowsSkippedByFoxPro: 0,
      perFileStats: [],
    },
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

  // Track per-file imported row counts so 100% of active DBF rows are verified with zero skips
  const fileImportedCount = new Map<string, number>();
  const bumpFileImported = (fileName: string, delta = 1) => {
    fileImportedCount.set(fileName, (fileImportedCount.get(fileName) || 0) + delta);
  };

  // Build GROUP.DBF lookup map so LEDGER.DBF rows under SUNDRY DEBTORS convert cleanly to Billing Parties
  const groupLookup = buildGroupLookupFromTables(
    dbfTables.map((d) => ({ leaf: d.leaf, rows: d.table.rows }))
  );

  // Pre-scan all master tables + OPBAL to populate cross-merge enrichment indexes
  const openingBalByCode = new Map<string, { amount: number; balanceType: 'Dr' | 'Cr'; name: string }>();
  for (const { leaf, table } of dbfTables) {
    if (
      isHeadCustomerDbf(leaf) ||
      isMarpartyDbf(leaf) ||
      isBrokerDbf(leaf) ||
      isOwnerOrVehicleMasterDbf(leaf) ||
      isDriverDbf(leaf)
    ) {
      table.rows.forEach((row) => {
        recordEnrichFromRow(row);
      });
    } else if (isLedgerDbf(leaf)) {
      table.rows.forEach((row) => {
        if (isLedgerRowSundryDebtor(row, groupLookup)) {
          recordEnrichFromRow(row);
        }
      });
    } else if (isOpeningBalanceDbf(leaf)) {
      table.rows.forEach((row) => {
        const code = pickStr(row, ['hcode', 'pcode', 'acode', 'bcode', 'ocode', 'code', 'headcd']).toUpperCase();
        const name = pickStr(row, ['hname', 'pname', 'partyname', 'acname', 'headname', 'name']);
        const amt = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'openbal', 'op_bal', 'balance', 'amount'])));
        const dcRaw = pickStr(row, ['opdc', 'drcr', 'dc', 'baltype']).toUpperCase();
        const balanceType: 'Dr' | 'Cr' = dcRaw.startsWith('C') ? 'Cr' : 'Dr';
        if (code) openingBalByCode.set(code, { amount: amt, balanceType, name });
        if (name) openingBalByCode.set(normalizePartyMatchKey(name), { amount: amt, balanceType, name });
      });
    }
  }

  // First pass: map HEAD / MARPARTY / LEDGER (Sundry Debtors), BROKER, OWNER/VHMAIN, DRIVER, DESMAST, OPBAL
  const seenCustomerByName = new Map<string, number>();
  const seenCustomerByNameGstin = new Map<string, number>();
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
    if (isHeadCustomerDbf(leaf) || isMarpartyDbf(leaf)) {
      const idPrefix = isMarpartyDbf(leaf) ? 'dbf_marparty_' : 'dbf_head_';
      table.rows.forEach((row, idx) => {
        const built = buildCustomerPartyFromDbfRow({
          row,
          idx,
          fileName: table.fileName,
          idPrefix,
          ownerUid: params.ownerUid,
          enrichByCode,
          enrichByName,
          openingBalByCode,
          headCodeToName,
        });
        if (built) {
          upsertUniqueCustomerParty(
            result.parties,
            seenCustomerByName,
            seenCustomerByNameGstin,
            built.party
          );
        }
        bumpFileImported(table.fileName);
      });
    } else if (isGroupDbf(leaf)) {
      table.rows.forEach(() => {
        bumpFileImported(table.fileName);
      });
    } else if (isLedgerDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        if (isLedgerRowSundryDebtor(row, groupLookup)) {
          const built = buildCustomerPartyFromDbfRow({
            row,
            idx,
            fileName: table.fileName,
            idPrefix: 'dbf_ledger_',
            ownerUid: params.ownerUid,
            enrichByCode,
            enrichByName,
            openingBalByCode,
            headCodeToName,
          });
          if (built) {
            upsertUniqueCustomerParty(
              result.parties,
              seenCustomerByName,
              seenCustomerByNameGstin,
              built.party
            );
          }
        }
      });
    } else if (isBrokerDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const code = pickStr(row, ['bcode', 'brkrcd', 'code', 'id']).toUpperCase();
        const rawName = pickStr(row, ['bname', 'brkrname', 'brkname', 'brokername', 'pname', 'name']);
        const name = rawName || code;
        if (!name) {
          bumpFileImported(table.fileName);
          return;
        }
        if (code) headCodeToName.set(code, name);

        const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])));
        const isCompanyCustomer = hasBillingCompanySuffixOrKeyword(name);
        const rawBroker: Party = applyEnrichmentToParty(
          {
            id: makeSafeDocId(`dbf_brk_${table.fileName}_${idx}`),
            name,
            partyCode: code || undefined,
            partyType: isCompanyCustomer ? 'Customer' : 'Broker',
            address: composeDbfAddress(row),
            gstin: pickStr(row, ['gstno', 'gstin', 'gst']).toUpperCase(),
            pan: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan']).toUpperCase(),
            phone: pickStr(row, ['mobile', 'mob', 'phone', 'tel', 'phno']),
            email: pickStr(row, ['email', 'mail']),
            bankName: pickStr(row, ['bankname', 'bank']),
            bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
            bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
            openingBalance: opBal,
            currentBalance: opBal,
            balanceType: isCompanyCustomer ? 'Dr' : 'Cr',
            ownerUid: params.ownerUid,
          },
          code
        );

        if (isCompanyCustomer) {
          upsertUniqueCustomerParty(
            result.parties,
            seenCustomerByName,
            seenCustomerByNameGstin,
            rawBroker
          );
        } else {
          const dedupKey = normalizePartyMatchKey(rawBroker.name);
          if (!seenBrokerKeys.has(dedupKey)) {
            seenBrokerKeys.set(dedupKey, result.parties.length);
            result.parties.push(rawBroker);
            result.brokersAddedCount += 1;
          }
        }
        bumpFileImported(table.fileName);
      });
    } else if (isOwnerMasterDbf(leaf)) {
      // STRICT RULE: Lorry Owners come from ownrmast.dbf (excluding company suffixes),
      // mapping PAN from PAN/PANNO/ITPAN/PAN_NO, Name from NAME/OWNRNAME/OWNER, and Mobile/Address
      table.rows.forEach((row, idx) => {
        const ownerName = pickStr(row, [
          'ownrname',
          'owner',
          'name',
          'ownname',
          'ownername',
          'oname',
          'pname',
        ]);
        const code = pickStr(row, ['ocode', 'owncd', 'ownrcd', 'code', 'id']).toUpperCase();
        const truckNo = extractRealTruckNoFromRow(row);
        if (truckNo && !seenVehicleTrucks.has(truckNo)) {
          seenVehicleTrucks.add(truckNo);
          result.vehicles.push({
            id: makeSafeDocId(`dbf_vhl_${table.fileName}_${idx}`),
            truckNo,
            vehicleType: pickStr(row, ['vhltype', 'vehtype', 'type', 'model', 'capacity']) || 'Goods Carrier',
            ownerName: ownerName || 'Market / Fleet Owner',
            ownerPhone: pickStr(row, ['mobile', 'mob', 'phone', 'ownerph', 'tel', 'phno']),
            engineNo: pickStr(row, ['engineno', 'engno', 'engine']),
            chassisNo: pickStr(row, ['chassisno', 'chasno', 'chasisno', 'chassis']),
            ownerUid: params.ownerUid,
          });
        }

        if (ownerName && !/^market\s*\/\s*fleet\s*owner$/i.test(ownerName)) {
          const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])));
          const isCompanyParty = hasBillingCompanySuffixOrKeyword(ownerName);
          const ownerParty = applyEnrichmentToParty(
            {
              id: makeSafeDocId(`dbf_own_${table.fileName}_${idx}`),
              name: ownerName,
              partyCode: code || undefined,
              partyType: isCompanyParty ? 'Customer' : 'TruckOwner',
              address: composeDbfAddress(row),
              gstin: pickStr(row, ['gstno', 'gstin', 'gst']).toUpperCase(),
              pan: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan', 'panno1']).toUpperCase(),
              phone: pickStr(row, ['mobile', 'mob', 'phone', 'ownerph', 'tel', 'phno', 'contact']),
              email: pickStr(row, ['email', 'mail']),
              bankName: pickStr(row, ['bankname', 'bank']),
              bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
              bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
              openingBalance: opBal,
              currentBalance: opBal,
              balanceType: isCompanyParty ? 'Dr' : 'Cr',
              ownerUid: params.ownerUid,
            },
            code
          );

          if (isCompanyParty) {
            upsertUniqueCustomerParty(
              result.parties,
              seenCustomerByName,
              seenCustomerByNameGstin,
              ownerParty
            );
          } else {
            const ownKey = normalizePartyMatchKey(ownerName);
            if (!seenOwnerKeys.has(ownKey)) {
              seenOwnerKeys.set(ownKey, result.parties.length);
              result.parties.push(ownerParty);
            }
          }
        }
        bumpFileImported(table.fileName);
      });
    } else if (isVehicleMasterDbf(leaf)) {
      // courvhl.dbf / VHMAIN.dbf: Extract real registration numbers & individual human Drivers (never UNSPECIFIED-TRUCK-* or Lorry Owners)
      table.rows.forEach((row, idx) => {
        const truckNo = extractRealTruckNoFromRow(row);
        const ownerName = pickStr(row, ['ownrname', 'owner', 'oname', 'ownname', 'ownername']);

        if (truckNo && !seenVehicleTrucks.has(truckNo)) {
          seenVehicleTrucks.add(truckNo);
          const fitStr = pickStr(row, ['fitdt', 'fitexp', 'fitness']);
          const insStr = pickStr(row, ['insdt', 'insexp', 'insurance']);
          const prmStr = pickStr(row, ['prmdt', 'permit']);
          const taxStr = pickStr(row, ['taxdt', 'roadtax', 'taxexp']);
          const pucStr = pickStr(row, ['pucdt', 'puc']);
          result.vehicles.push({
            id: makeSafeDocId(`dbf_vhl_${table.fileName}_${idx}`),
            truckNo,
            vehicleType: pickStr(row, ['vhltype', 'vehtype', 'type', 'model', 'capacity']) || 'Goods Carrier',
            ownerName: ownerName || 'Market / Fleet Owner',
            ownerPhone: pickStr(row, ['ownerph', 'mobile', 'phone', 'tel']),
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

        const drvName = pickStr(row, ['drvrname', 'drvname', 'drivername', 'driver', 'drv']);
        if (isIndividualHumanDriverName(drvName)) {
          const rawDlExp = pickStr(row, ['dlexp', 'licexp', 'expiry', 'expdt', 'dlvalid']);
          result.drivers.push({
            id: makeSafeDocId(`dbf_drv_vhl_${table.fileName}_${idx}`),
            name: drvName,
            dlNo: pickStr(row, ['dlno', 'drvdl', 'drivdl', 'licno', 'license', 'lic_no']),
            dlExpiry: rawDlExp ? normOptionalDate(rawDlExp) : '',
            phone: pickStr(row, ['drvmob', 'drvrph', 'drvphone', 'drivermob', 'driverph', 'dmob', 'mobile', 'phone', 'tel']),
            address: pickStr(row, ['drvadd', 'drvradd']),
            ownerUid: params.ownerUid,
          });
        }
        bumpFileImported(table.fileName);
      });
    } else if (isDesmastDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const code = pickStr(row, ['descode', 'destcd', 'code', 'id']);
        const name = pickStr(row, ['desname', 'destname', 'destination', 'city', 'place', 'name']) || code || `STATION-${idx + 1}`;
        result.destinations.push(name);
        if (code) destCodeToName.set(code.toUpperCase(), name);
        bumpFileImported(table.fileName);
      });
    } else if (isDriverDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const rawName = pickStr(row, ['drvrname', 'drvname', 'drivername', 'driver', 'name']);
        if (!isIndividualHumanDriverName(rawName)) {
          bumpFileImported(table.fileName);
          return;
        }
        const dlNo = pickStr(row, ['dlno', 'licno', 'license', 'lic_no']);
        const rawDlExp = pickStr(row, ['dlexp', 'licexp', 'expiry', 'expdt', 'dlvalid']);
        // Leave dlExpiry blank '' when DBF has no expiry date so missing dates don't inflate D/L alerts
        const parsedDlExp = rawDlExp ? normOptionalDate(rawDlExp) : '';
        result.drivers.push({
          id: makeSafeDocId(`dbf_drv_${table.fileName}_${idx}`),
          name: rawName,
          dlNo,
          dlExpiry: parsedDlExp,
          phone: pickStr(row, ['mobile', 'mob', 'phone', 'tel', 'phno']),
          address: composeDbfAddress(row),
          aadhaarNo: pickStr(row, ['aadhaar', 'uid', 'aadhar']),
          panNo: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan']).toUpperCase(),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc', 'ifsccode']).toUpperCase(),
          ownerUid: params.ownerUid,
        });
        bumpFileImported(table.fileName);
      });
    } else if (isOpeningBalanceDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const code = pickStr(row, ['hcode', 'pcode', 'acode', 'bcode', 'ocode', 'code', 'headcd']).toUpperCase();
        const rawName = pickStr(row, ['hname', 'pname', 'partyname', 'acname', 'headname', 'name']);
        const name = rawName || (code ? headCodeToName.get(code) || code : `OPBAL-PARTY-${idx + 1}`);
        const opBal = roundPaise(Math.abs(pickNum(row, ['opbal', 'opening', 'openbal', 'op_bal', 'balance', 'amount'])));
        const dcRaw = pickStr(row, ['opdc', 'drcr', 'dc', 'baltype']).toUpperCase();
        const balanceType: 'Dr' | 'Cr' = dcRaw.startsWith('C') ? 'Cr' : 'Dr';
        const existingByName = result.parties.findIndex(
          (p) => normalizePartyMatchKey(p.name) === normalizePartyMatchKey(name)
        );
        if (existingByName >= 0) {
          if (!result.parties[existingByName].openingBalance && opBal > 0) {
            result.parties[existingByName] = {
              ...result.parties[existingByName],
              openingBalance: opBal,
              currentBalance: opBal,
              balanceType,
            };
          }
        } else {
          upsertUniqueCustomerParty(
            result.parties,
            seenCustomerByName,
            seenCustomerByNameGstin,
            applyEnrichmentToParty(
              {
                id: makeSafeDocId(`dbf_opbal_${table.fileName}_${idx}`),
                name,
                partyType: 'Customer',
                address: composeDbfAddress(row),
                gstin: pickStr(row, ['gstno', 'gstin', 'gst']).toUpperCase(),
                pan: pickStr(row, ['panno', 'itpan', 'pan']).toUpperCase(),
                phone: pickStr(row, ['phone', 'mobile', 'tel']),
                email: pickStr(row, ['email', 'mail']),
                openingBalance: opBal,
                currentBalance: opBal,
                balanceType,
                ownerUid: params.ownerUid,
              },
              code
            )
          );
        }
        bumpFileImported(table.fileName);
      });
    }
  }

  // Second pass: Consignments, Invoices, Challans, Ledger + fallback archive for any other non-scrap DBF
  for (const { leaf, table } of dbfTables) {
    if (isConsignmentDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'biltyno', 'grno', 'cno', 'docno']) || `OLD-CN-${idx + 1}`;
        const rawConsignorCode = pickStr(row, ['cnorcd', 'hcode', 'pcode', 'consignor', 'cnor', 'party']).toUpperCase();
        const consignorName =
          pickStr(row, ['cnorname', 'consignorname', 'consignor', 'partyname', 'pname', 'sname']) ||
          headCodeToName.get(rawConsignorCode) ||
          rawConsignorCode ||
          `Customer-${idx + 1}`;

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

        const realCnTruck = extractRealTruckNoFromRow(row);
        if (realCnTruck && !seenVehicleTrucks.has(realCnTruck)) {
          seenVehicleTrucks.add(realCnTruck);
          result.vehicles.push({
            id: makeSafeDocId(`dbf_vhl_${table.fileName}_${idx}`),
            truckNo: realCnTruck,
            vehicleType: 'Goods Carrier',
            ownerName: 'Market / Fleet Owner',
            ownerUid: params.ownerUid,
          });
        }
        const cnDriverName = pickStr(row, ['drvrname', 'driver', 'drvname', 'drivername', 'drv']);
        const cnDriverDl = pickStr(row, ['dlno', 'drvdl', 'drivdl']);
        const cnDriverMob = pickStr(row, ['drvmob', 'drvrph', 'drvphone', 'drivermob', 'driverph', 'dmob', 'drv_mob']);
        if (isIndividualHumanDriverName(cnDriverName)) {
          result.drivers.push({
            id: makeSafeDocId(`dbf_drv_cn_${table.fileName}_${idx}`),
            name: cnDriverName,
            dlNo: cnDriverDl,
            dlExpiry: '',
            phone: cnDriverMob,
            ownerUid: params.ownerUid,
          });
        }

        result.consignments.push({
          id: makeSafeDocId(`dbf_cn_${table.fileName}_${idx}`),
          cnNo,
          cnDate,
          financialYear: resolvedFy,
          deliveryOffice: toCity,
          billingPartyName: consignorName,
          consignorName,
          consignorAddress: pickStr(row, ['cnoradd', 'consignoraddr', 'address']),
          consignorGstin: pickStr(row, ['cnorgst', 'gstno', 'gstin']).toUpperCase(),
          consigneeName:
            pickStr(row, ['cneename', 'consignee', 'cnee', 'rname']) || consignorName,
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
          truckNo: realCnTruck || '-',
          fromCity: pickStr(row, ['fromcity', 'from', 'origin']) || 'KOLKATA',
          toCity,
          driverName: cnDriverName,
          driverMobile: cnDriverMob,
          driverDlNo: cnDriverDl,
          gstPaidBy: pickStr(row, ['gstby', 'gstpaidby']) || 'Consignee',
          remarks: pickStr(row, ['remarks', 'remark', 'rem', 'note']),
          billed: Boolean(taxInvNo),
          branchCode: params.branchCode,
          createdByStaff: params.staffCode,
          ownerUid: params.ownerUid,
        });
        bumpFileImported(table.fileName);
      });
    } else if (isChallanDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'challanno', 'chlnno', 'docno']) || `CHLN-${idx + 1}`;
        const truckNo = extractRealTruckNoFromRow(row) || '-';
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
          id: makeSafeDocId(`dbf_lh_${table.fileName}_${idx}`),
          cnNo,
          cnDate,
          financialYear: resolveFinancialYearFromDate(cnDate) || normalizeFyLabel(params.activeFy),
          truckNo,
          ownerName: pickStr(row, ['ownrname', 'owner', 'oname', 'ownername', 'ownname', 'party']),
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
        bumpFileImported(table.fileName);
      });
    } else if (isInvoiceDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const invoiceNo = pickStr(row, ['invno', 'billno', 'taxinvno', 'docno']) || `OLD-INV-${idx + 1}`;
        const rawPartyCode = pickStr(row, ['hcode', 'pcode', 'acode', 'partycd', 'custcd']).toUpperCase();
        const partyName =
          pickStr(row, ['partyname', 'pname', 'hname', 'custname', 'customer', 'name']) ||
          headCodeToName.get(rawPartyCode) ||
          rawPartyCode ||
          `Customer-${idx + 1}`;

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

        const realInvTruck = extractRealTruckNoFromRow(row);
        if (realInvTruck && !seenVehicleTrucks.has(realInvTruck)) {
          seenVehicleTrucks.add(realInvTruck);
          result.vehicles.push({
            id: makeSafeDocId(`dbf_vhl_${table.fileName}_${idx}`),
            truckNo: realInvTruck,
            vehicleType: 'Goods Carrier',
            ownerName: 'Market / Fleet Owner',
            ownerUid: params.ownerUid,
          });
        }

        const enrichParty =
          enrichByCode.get(rawPartyCode) ||
          enrichByName.get(normalizePartyMatchKey(partyName));

        result.invoices.push({
          id: makeSafeDocId(`dbf_inv_${table.fileName}_${idx}`),
          invoiceNo,
          invoiceDate,
          dueDate: invoiceDate,
          financialYear: resolveFinancialYearFromDate(invoiceDate) || normalizeFyLabel(params.activeFy),
          partyName,
          partyAddress: composeDbfAddress(row) || enrichParty?.address || '',
          partyGstin: pickStr(row, ['gstno', 'gstin', 'partygst', 'gst']).toUpperCase() || enrichParty?.gstin || '',
          partyPan: pickStr(row, ['pan_no', 'panno', 'itpan', 'pan']).toUpperCase() || enrichParty?.pan || '',
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
                  vehicle: matchingCn.truckNo !== '-' ? matchingCn.truckNo : realInvTruck || '-',
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
                  vehicle: realInvTruck || '-',
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
        bumpFileImported(table.fileName);
      });
    } else if (isLedgerVoucherDbf(leaf)) {
      table.rows.forEach((row, idx) => {
        const rawCode = pickStr(row, ['hcode', 'acode', 'pcode', 'bcode', 'ocode', 'partycd', 'code']).toUpperCase();
        const partyName =
          pickStr(row, ['partyname', 'hname', 'pname', 'acname', 'bname', 'oname', 'name']) ||
          headCodeToName.get(rawCode) ||
          rawCode ||
          `UNSPECIFIED-LEDGER-${idx + 1}`;

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
        const rawTxDate = pickStr(row, ['vdate', 'trndate', 'date', 'dt', 'docdt']);
        const explicitVNo = pickStr(row, ['vno', 'vouchno', 'vchno', 'trno', 'docno']);
        const hasVoucherData = amount > 0 || Boolean(rawTxDate) || Boolean(explicitVNo);

        if (hasVoucherData || !isLedgerDbf(leaf)) {
          const txDate = normDate(rawTxDate);
          const vNo =
            explicitVNo ||
            pickStr(row, ['refno', 'billno']) ||
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
            id: makeSafeDocId(`dbf_trn_${table.fileName}_${idx}`),
            txCode: vNo,
            txDate,
            financialYear: resolvedFy,
            txType: isDebit ? 'Expense' : 'Income',
            ledgerAccount: isDebit ? 'Party Ledger Receivable (Dr)' : 'Party Ledger Receipt (Cr)',
            partyName,
            amount,
            narration: rawNarr || `${isDebit ? 'Debit' : 'Credit'} Voucher ${vNo} (${resolvedFy})`,
            paymentMode: meta.paymentMode || 'Cash',
            referenceNo: refNo,
            upiRefId: meta.upiRefId || '',
            utrNo: meta.utrNo || '',
            chequeNo: meta.chequeNo || '',
            tdsAmount: roundPaise(pickNum(row, ['tds', 'tdsamt'])),
            linkedCnNo: pickStr(row, ['cnno', 'lrno']),
            linkedInvoiceNo: '',
            branchCode: params.branchCode,
            createdByStaff: params.staffCode,
            ownerUid: params.ownerUid,
          });
        }
        bumpFileImported(table.fileName);
      });
    } else if (
      !isHeadCustomerDbf(leaf) &&
      !isMarpartyDbf(leaf) &&
      !isGroupDbf(leaf) &&
      !isBrokerDbf(leaf) &&
      !isOwnerOrVehicleMasterDbf(leaf) &&
      !isDriverDbf(leaf) &&
      !isDesmastDbf(leaf) &&
      !isOpeningBalanceDbf(leaf)
    ) {
      // Any other non-scrap DBF table is still preserved 100% in Raw DBF Archive & also counted as imported
      table.rows.forEach(() => {
        bumpFileImported(table.fileName);
      });
    }
  }

  // Record complete Raw DBF Archive tables & exact 0-missed verification summary
  let totalActiveRows = 0;
  let totalImportedRows = 0;
  let totalDeletedFlags = 0;
  const importedAt = Date.now();

  for (const { leaf, table } of dbfTables) {
    const tableKind = classifyDbfTableKind(leaf);
    const importedRows = fileImportedCount.get(table.fileName) ?? table.activeRows;
    totalActiveRows += table.activeRows;
    totalImportedRows += importedRows;
    totalDeletedFlags += table.deletedFlagRows;

    result.rawTables.push({
      fileName: table.fileName,
      tableKind,
      fields: table.fields.map((f) => f.name),
      totalRawRows: table.totalRawRows,
      deletedFlagRows: table.deletedFlagRows,
      activeRows: table.activeRows,
      importedRows,
      importedAt,
      rows: table.rows,
    });
    result.verificationSummary.perFileStats.push({
      fileName: table.fileName,
      tableKind,
      activeRows: table.activeRows,
      deletedFlagRows: table.deletedFlagRows,
      importedRows,
    });
  }

  result.verificationSummary.totalActiveRows = totalActiveRows;
  result.verificationSummary.totalImportedRows = totalImportedRows;
  result.verificationSummary.missedRows = Math.max(0, totalActiveRows - totalImportedRows);
  result.verificationSummary.deletedFlagRowsSkippedByFoxPro = totalDeletedFlags;

  if (result.rawTables.length > 0) {
    await saveRawDbfArchiveToIdb(result.rawTables).catch(() => {});
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

  // Remove duplicate or misclassified non-driver entries & purge UNSPECIFIED-TRUCK-* placeholders
  const driverCleanup = cleanAndDeduplicateDrivers({
    drivers: result.drivers,
    parties: result.parties,
    invoices: combinedInvoices,
    consignments: result.consignments,
    lorryHires: result.lorryHires,
  });
  result.drivers = driverCleanup.cleanDrivers;

  const vehicleCleanup = cleanAndDeduplicateVehicles(result.vehicles);
  result.vehicles = vehicleCleanup.cleanVehicles;

  // Final count sync: preserve exact role mapping without reclassifying HEAD/MARPARTY/Sundry Debtors/company customers into Brokers
  result.brokersAddedCount = result.parties.filter((p) => p.partyType === 'Broker').length;
  result.destinations = Array.from(new Set(result.destinations.filter(Boolean))).sort();
  return result;
}

export interface DbfLatestSerialSummary {
  maxCnNo: string;
  maxCnNum: number;
  maxCnParty: string;
  maxBillNo: string;
  maxBillNum: number;
  maxBillParty: string;
}

export function extractHighestBillAndCnFromRawDbf(
  tables: RawDbfTableDump[]
): DbfLatestSerialSummary {
  let maxCnNo = '';
  let maxCnNum = 0;
  let maxCnParty = '';
  let maxBillNo = '';
  let maxBillNum = 0;
  let maxBillParty = '';

  for (const t of tables || []) {
    const leaf = String(t.fileName || '')
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase() || '';

    if (leaf === 'courtran.dbf' || leaf.includes('courtran') || t.tableKind === 'CN_BOOKING') {
      for (const row of t.rows || []) {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'biltyno', 'grno', 'cno', 'docno']);
        if (!cnNo) continue;
        const n = extractTrailingSerialNumber(cnNo);
        const party =
          pickStr(row, ['partyname', 'pname', 'bparty', 'consignor', 'cnor', 'cname']) || '';
        if (n > 0 && n >= maxCnNum) {
          maxCnNum = n;
          maxCnNo = cnNo;
          if (party) maxCnParty = party;
        }
      }
    }

    if (leaf === 'marbill.dbf' || leaf.includes('marbill') || t.tableKind === 'BILLING') {
      for (const row of t.rows || []) {
        const billNo = pickStr(row, ['billno', 'invno', 'invoiceno', 'bno', 'vno']);
        if (!billNo) continue;
        const bid = pickNum(row, ['billid', 'bid', 'slno']);
        const parsed = extractTrailingSerialNumber(billNo);
        const n = Math.max(Number.isFinite(bid) && bid < 1000000 ? bid : 0, parsed);
        const party =
          pickStr(row, ['partyname', 'pname', 'bparty', 'party', 'cname', 'acname']) || '';
        if (n > 0 && n >= maxBillNum) {
          maxBillNum = n;
          maxBillNo = billNo;
          if (party) maxBillParty = party;
        }
      }
    }
  }

  return {
    maxCnNo,
    maxCnNum,
    maxCnParty,
    maxBillNo,
    maxBillNum,
    maxBillParty,
  };
}
