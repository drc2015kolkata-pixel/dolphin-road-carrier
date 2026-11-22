import * as XLSX from 'xlsx';
import {
  BankReceiptRecord,
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
  Vehicle,
} from '../types/erp';
import { makeSafeDocId, normalizeFyLabel, resolveFinancialYearFromDate, todayISO } from './formatters';
import { sheetToObjectsSmartHeader } from './excelImport';
import { buildAutomaticNarration, extractPaymentMetadata } from './paymentNarration';
import { extractCreditReceiptsFromRows } from '../components/BankReceiptImportModule';
import { analyzeAndSeparateMisclassifiedParties, isKnownTransportBrokerName } from './partySeparation';

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

function normDate(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yy = ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3];
    return `${yy}-${mm}-${dd}`;
  }
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : todayISO();
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
    bankReceipts: [],
    destinations: [],
    warnings: [],
  };

  const dbfTables: Array<{ baseName: string; table: ParsedDbfTable }> = [];
  const bankSpreadsheets: File[] = [];

  for (const file of fileArr) {
    const rawName = (file.name || '').trim();
    const baseName = rawName.toLowerCase();
    if (!baseName) continue;

    // STRICT EXCLUSION RULE: Ignore scrap*.dbf & non-data index/binary files
    if (/^scrap.*\.dbf$/i.test(baseName) || baseName.includes('scrap')) {
      result.ignoredScrapFiles.push(rawName);
      continue;
    }

    if (baseName.endsWith('.dbf')) {
      try {
        const buf = await file.arrayBuffer();
        const table = parseFoxProDbfBuffer(buf, rawName);
        dbfTables.push({ baseName, table });
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

  // First pass: map HEAD / desmast / drvrmast / brkrmast / courvhl
  const headCodeToName = new Map<string, string>();
  const destCodeToName = new Map<string, string>();

  for (const { baseName, table } of dbfTables) {
    if (/(^|\/)head\.dbf$/i.test(baseName) || baseName === 'head.dbf') {
      table.rows.forEach((row, idx) => {
        const name = pickStr(row, ['hname', 'name', 'headname', 'acname', 'partyname', 'pname']);
        if (!name) return;
        const code = pickStr(row, ['hcode', 'code', 'acode', 'headcd', 'id']);
        if (code) headCodeToName.set(code.toUpperCase(), name);

        const opBal = Math.abs(pickNum(row, ['opbal', 'opening', 'openbal', 'op_bal', 'balance']));
        const dcRaw = pickStr(row, ['opdc', 'drcr', 'dc', 'baltype']).toUpperCase();
        const groupRaw = pickStr(row, [
          'group',
          'grp',
          'grpname',
          'groupname',
          'acgroup',
          'acgrp',
          'grpcd',
          'category',
          'type',
          'sch',
          'schedule',
          'headtype',
        ]);
        const combinedGroupAndName = `${groupRaw} ${name}`;
        const rawGstin = pickStr(row, ['gstin', 'gstno', 'gst', 'tin']).toUpperCase();
        const partyType: Party['partyType'] =
          /broker|\bbrk\b|commission\s*agent|dalal/i.test(combinedGroupAndName) ||
          (!rawGstin && isKnownTransportBrokerName(name))
            ? 'Broker'
            : /lorry\s*owner|truck\s*owner|vehicle\s*owner|owner|\bvhl\b/i.test(groupRaw)
            ? 'TruckOwner'
            : /vendor|fuel|diesel|pump|tyre/i.test(groupRaw)
            ? 'Vendor'
            : /consignor/i.test(groupRaw)
            ? 'Consignor'
            : /consignee/i.test(groupRaw)
            ? 'Consignee'
            : 'Customer';

        result.parties.push({
          id: makeSafeDocId(`dbf_head_${idx}`),
          name,
          partyType,
          address: [
            pickStr(row, ['add1', 'address', 'addr1']),
            pickStr(row, ['add2', 'addr2', 'city']),
            pickStr(row, ['city', 'place', 'state']),
          ]
            .filter(Boolean)
            .join(', '),
          gstin: pickStr(row, ['gstin', 'gstno', 'gst', 'tin']).toUpperCase(),
          pan: pickStr(row, ['pan', 'panno']).toUpperCase(),
          phone: pickStr(row, ['phone', 'mobile', 'tel', 'phno', 'contact']),
          email: pickStr(row, ['email', 'mail']),
          openingBalance: opBal,
          currentBalance: opBal,
          balanceType: dcRaw.startsWith('C') ? 'Cr' : 'Dr',
          ownerUid: params.ownerUid,
        });
      });
    } else if (/desmast\.dbf$/i.test(baseName) || baseName.includes('desmast')) {
      table.rows.forEach((row) => {
        const name = pickStr(row, ['desname', 'destname', 'destination', 'city', 'place', 'name']);
        const code = pickStr(row, ['descode', 'destcd', 'code', 'id']);
        if (name) {
          result.destinations.push(name);
          if (code) destCodeToName.set(code.toUpperCase(), name);
        }
      });
    } else if (/drvrmast\.dbf$/i.test(baseName) || baseName.includes('drvrmast')) {
      table.rows.forEach((row, idx) => {
        const name = pickStr(row, ['drvrname', 'drvname', 'drivername', 'name']);
        if (!name) return;
        const dlNo = pickStr(row, ['dlno', 'licno', 'license', 'lic_no']) || `DL-OLD-${idx + 1}`;
        result.drivers.push({
          id: makeSafeDocId(`dbf_drv_${idx}`),
          name,
          dlNo,
          dlExpiry: normDate(pickStr(row, ['dlexp', 'licexp', 'expiry', 'expdt'])),
          phone: pickStr(row, ['phone', 'mobile', 'tel', 'phno']),
          address: pickStr(row, ['address', 'add1', 'addr']),
          aadhaarNo: pickStr(row, ['aadhaar', 'uid', 'aadhar']),
          panNo: pickStr(row, ['pan', 'panno']).toUpperCase(),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc']).toUpperCase(),
          ownerUid: params.ownerUid,
        });
      });
    } else if (/brkrmast\.dbf$/i.test(baseName) || baseName.includes('brkrmast')) {
      table.rows.forEach((row, idx) => {
        const name = pickStr(row, ['brkrname', 'brkname', 'brokername', 'name']);
        if (!name) return;
        result.brokersAddedCount += 1;
        result.parties.push({
          id: makeSafeDocId(`dbf_brk_${idx}`),
          name,
          partyType: 'Broker',
          address: [pickStr(row, ['add1', 'address']), pickStr(row, ['add2', 'city'])].filter(Boolean).join(', '),
          gstin: pickStr(row, ['gstin', 'gstno']).toUpperCase(),
          pan: pickStr(row, ['pan', 'panno']).toUpperCase(),
          phone: pickStr(row, ['phone', 'mobile', 'tel', 'phno']),
          email: pickStr(row, ['email', 'mail']),
          bankName: pickStr(row, ['bankname', 'bank']),
          bankAccountNo: pickStr(row, ['bankac', 'acno', 'accountno']),
          bankIfsc: pickStr(row, ['ifsc']).toUpperCase(),
          openingBalance: Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])),
          currentBalance: Math.abs(pickNum(row, ['opbal', 'opening', 'balance'])),
          balanceType: 'Cr',
          ownerUid: params.ownerUid,
        });
      });
    } else if (/courvhl\.dbf$/i.test(baseName) || baseName.includes('courvhl')) {
      table.rows.forEach((row, idx) => {
        const truckNo = pickStr(row, ['vhlno', 'truckno', 'lorryno', 'vehno', 'regno'])
          .toUpperCase()
          .replace(/\s+/g, '');
        if (!truckNo) return;
        result.vehicles.push({
          id: makeSafeDocId(`dbf_vhl_${idx}`),
          truckNo,
          vehicleType: pickStr(row, ['vhltype', 'type', 'model', 'capacity']) || 'Goods Carrier',
          ownerName: pickStr(row, ['owner', 'ownername', 'ownname']) || 'Market / Fleet Owner',
          ownerPhone: pickStr(row, ['phone', 'mobile', 'ownerph', 'tel']),
          engineNo: pickStr(row, ['engineno', 'engno', 'engine']),
          chassisNo: pickStr(row, ['chassisno', 'chasno', 'chasisno', 'chassis']),
          fitnessExpiry: pickStr(row, ['fitdt', 'fitexp', 'fitness']) ? normDate(pickStr(row, ['fitdt', 'fitexp', 'fitness'])) : '',
          insuranceExpiry: pickStr(row, ['insdt', 'insexp', 'insurance']) ? normDate(pickStr(row, ['insdt', 'insexp', 'insurance'])) : '',
          permitExpiry: pickStr(row, ['prmdt', 'permit']) ? normDate(pickStr(row, ['prmdt', 'permit'])) : '',
          pucExpiry: pickStr(row, ['pucdt', 'puc']) ? normDate(pickStr(row, ['pucdt', 'puc'])) : '',
          ownerUid: params.ownerUid,
        });
      });
    }
  }

  // Second pass: Consignments (`courtran.dbf` / `bilty*.dbf`), Invoices (`*inv*.dbf` / `tax*.dbf`), Challans (`challant.dbf`)
  for (const { baseName, table } of dbfTables) {
    if (/(^|\/)(courtran|bilty.*)\.dbf$/i.test(baseName) || baseName.includes('courtran') || baseName.includes('bilty')) {
      table.rows.forEach((row, idx) => {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'biltyno', 'grno', 'cno', 'docno']);
        const rawConsignorCode = pickStr(row, ['cnorcd', 'consignor', 'cnor', 'party', 'hcode']).toUpperCase();
        const consignorName =
          pickStr(row, ['cnorname', 'consignorname', 'consignor', 'partyname', 'sname']) ||
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
        const totalFreight = pickNum(row, ['totfrt', 'freight', 'totalfreight', 'frtamt', 'amount']);
        const paidAmount = pickNum(row, ['paidamt', 'advance', 'paid']);
        const toPayAmount = pickNum(row, ['topayamt', 'topay']) || Math.max(0, totalFreight - paidAmount);
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
          consignorGstin: pickStr(row, ['cnorgst', 'gstin']).toUpperCase(),
          consigneeName:
            pickStr(row, ['cneename', 'consignee', 'cnee', 'rname']) || consignorName || 'Consignee',
          consigneeAddress: pickStr(row, ['cneeadd', 'consigneeaddr']),
          consigneeGstin: pickStr(row, ['cneegst']).toUpperCase(),
          packages: pickStr(row, ['pkgs', 'packages', 'qty', 'nopkg']) || '1',
          particulars: pickStr(row, ['item', 'particulars', 'goods', 'desc', 'descr']) || 'Goods Consignment',
          nettWeight,
          grossWeight,
          loadingCharge: pickNum(row, ['loading', 'ldchg', 'hamali']),
          unloadingCharge: pickNum(row, ['unloading', 'ulchg']),
          returnLorryCharge: pickNum(row, ['return', 'detention']),
          sttCharge: pickNum(row, ['stt', 'stchg', 'sur']),
          totalFreight,
          paidAmount,
          toPayAmount,
          taxInvNo,
          taxInvDate: taxInvNo ? cnDate : '',
          ewayBillNo: pickStr(row, ['eway', 'ewbno', 'ewaybill']),
          ewayBillDate: pickStr(row, ['eway']) ? cnDate : '',
          valueOfGoods: pickNum(row, ['valgoods', 'goodsval', 'invval', 'value']),
          truckNo: pickStr(row, ['vhlno', 'truckno', 'lorryno', 'vehno']).toUpperCase().replace(/\s+/g, '') || '-',
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
    } else if (/challant\.dbf$/i.test(baseName) || baseName.includes('challant')) {
      table.rows.forEach((row, idx) => {
        const cnNo = pickStr(row, ['cnno', 'lrno', 'challanno', 'chlnno', 'docno']);
        const truckNo = pickStr(row, ['vhlno', 'truckno', 'lorryno', 'vehno']).toUpperCase().replace(/\s+/g, '');
        if (!cnNo && !truckNo) return;
        const cnDate = normDate(pickStr(row, ['chlndt', 'cndate', 'date', 'dt']));
        const hireAmount = pickNum(row, ['hireamt', 'lorryhire', 'hire', 'freight', 'amount']);
        const advancePaid = pickNum(row, ['advamt', 'advance', 'adv']);
        const loadingCharge = pickNum(row, ['loading', 'ldchg']);
        const unloadingCharge = pickNum(row, ['unloading', 'ulchg']);
        const balancePayable =
          pickNum(row, ['balamt', 'balance']) ||
          Math.max(0, hireAmount - advancePaid - loadingCharge - unloadingCharge);
        const podDt = pickStr(row, ['poddt', 'poddate', 'recdt']);

        result.lorryHires.push({
          id: makeSafeDocId(`dbf_lh_${idx}`),
          cnNo: cnNo || `CHLN-${idx + 1}`,
          cnDate,
          financialYear: resolveFinancialYearFromDate(cnDate) || normalizeFyLabel(params.activeFy),
          truckNo: truckNo || '-',
          ownerName: pickStr(row, ['owner', 'ownername', 'ownname', 'party']),
          brokerName: pickStr(row, ['broker', 'brkrname', 'brokername']),
          fromCity: pickStr(row, ['fromcity', 'from', 'origin']) || 'KOLKATA',
          toCity: pickStr(row, ['tocity', 'to', 'dest', 'destination']) || 'DELIVERY',
          hireAmount,
          advancePaid,
          loadingCharge,
          unloadingCharge,
          balancePayable,
          podReceived: Boolean(podDt),
          podReceiveDate: podDt ? normDate(podDt) : '',
          balancePaid: balancePayable <= 0,
          branchCode: params.branchCode,
          createdByStaff: params.staffCode,
          ownerUid: params.ownerUid,
        });
      });
    } else if (/inv.*\.dbf$|tax.*\.dbf$/i.test(baseName)) {
      table.rows.forEach((row, idx) => {
        const invoiceNo = pickStr(row, ['invno', 'billno', 'taxinvno', 'docno']);
        const rawPartyCode = pickStr(row, ['hcode', 'partycd', 'custcd']).toUpperCase();
        const partyName =
          pickStr(row, ['partyname', 'pname', 'custname', 'customer', 'name']) ||
          headCodeToName.get(rawPartyCode) ||
          rawPartyCode;
        if (!invoiceNo && !partyName) return;

        const invoiceDate = normDate(pickStr(row, ['invdate', 'billdate', 'bdate', 'date', 'dt']));
        const freightCharges = pickNum(row, ['freight', 'frtamt', 'taxable', 'basicamt', 'amount']);
        const detentionCharges = pickNum(row, ['detention', 'detamt']);
        const unloadingCharges = pickNum(row, ['unloading', 'ulamt']);
        const stCharges = pickNum(row, ['stt', 'stchg', 'otherchg']);
        const cgstAmt = pickNum(row, ['cgst', 'cgstamt']);
        const sgstAmt = pickNum(row, ['sgst', 'sgstamt']);
        const igstAmt = pickNum(row, ['igst', 'igstamt']);
        const totalTax =
          pickNum(row, ['tottax', 'gstamt', 'taxamt']) || cgstAmt + sgstAmt + igstAmt;
        const grandTotal =
          pickNum(row, ['grandtot', 'netamt', 'billamt', 'totamt', 'total']) ||
          freightCharges + detentionCharges + unloadingCharges + stCharges + totalTax;
        const paidAmount = pickNum(row, ['paidamt', 'recdamt', 'paid', 'received']);
        const gstRate = pickNum(row, ['gstrate', 'gstpct']) || (totalTax > 0 && freightCharges > 0 ? Math.round((totalTax / freightCharges) * 100) : 5);
        const status: Invoice['status'] =
          paidAmount >= grandTotal && grandTotal > 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid';

        const linkedCnNo = pickStr(row, ['cnno', 'lrno', 'biltyno']);
        const matchingCn = result.consignments.find(
          (c) =>
            (linkedCnNo && c.cnNo.toLowerCase() === linkedCnNo.toLowerCase()) ||
            (invoiceNo && (c.taxInvNo || '').toLowerCase() === invoiceNo.toLowerCase())
        );

        result.invoices.push({
          id: makeSafeDocId(`dbf_inv_${idx}`),
          invoiceNo: invoiceNo || `OLD-INV-${idx + 1}`,
          invoiceDate,
          dueDate: invoiceDate,
          financialYear: resolveFinancialYearFromDate(invoiceDate) || normalizeFyLabel(params.activeFy),
          partyName: partyName || 'Customer',
          partyAddress: pickStr(row, ['address', 'add1', 'partyadd']),
          partyGstin: pickStr(row, ['gstin', 'partygst', 'gst']).toUpperCase(),
          partyPan: pickStr(row, ['pan']).toUpperCase(),
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
                  vehicle: pickStr(row, ['vhlno', 'truckno']) || '-',
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

  // Cross-reference FoxPro masters & transactions so Brokers, Vehicle Owners, and Drivers never leak into Customer Billing Parties
  const extraBrokerNames = [
    ...result.parties.filter((p) => p.partyType === 'Broker').map((p) => p.name),
    ...result.lorryHires.map((lh) => lh.brokerName || ''),
  ].filter(Boolean);
  const extraOwnerNames = [
    ...result.vehicles.map((v) => v.ownerName || ''),
    ...result.lorryHires.map((lh) => lh.ownerName || ''),
  ].filter(Boolean);
  const extraDriverNames = result.drivers.map((d) => d.name).filter(Boolean);
  const extraCustomerNames = [
    ...result.invoices.map((inv) => inv.partyName),
    ...result.consignments.map((cn) => cn.billingPartyName || cn.consignorName),
  ].filter(Boolean);

  const separated = analyzeAndSeparateMisclassifiedParties({
    parties: result.parties,
    drivers: result.drivers,
    lorryHires: result.lorryHires,
    invoices: result.invoices,
    consignments: result.consignments,
    extraBrokerNames,
    extraOwnerNames,
    extraDriverNames,
    extraCustomerNames,
  });
  result.parties = separated.cleanParties;
  result.brokersAddedCount = result.parties.filter((p) => p.partyType === 'Broker').length;

  result.destinations = Array.from(new Set(result.destinations.filter(Boolean))).sort();
  return result;
}
