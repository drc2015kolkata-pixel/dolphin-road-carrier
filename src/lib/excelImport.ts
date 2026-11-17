import * as XLSX from 'xlsx';
import {
  CompanySettings,
  ConsignmentNote,
  FyOpeningBalanceEntry,
  Invoice,
  LorryHire,
  Party,
  TransactionRecord,
} from '../types/erp';
import {
  makeSafeDocId,
  matchesSelectedFinancialYear,
  normalizeFyLabel,
  resolveFinancialYearFromDate,
  todayISO,
} from './formatters';

export type ImportEntityType =
  | 'parties'
  | 'vehicles'
  | 'consignments'
  | 'invoices'
  | 'transactions';

function normHeader(h: string): string {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getField(row: Record<string, unknown>, candidates: string[]): string {
  const entries = Object.entries(row);
  for (const cand of candidates) {
    const target = normHeader(cand);
    for (const [k, v] of entries) {
      if (normHeader(k) === target && v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
  }
  for (const cand of candidates) {
    const target = normHeader(cand);
    for (const [k, v] of entries) {
      if (normHeader(k).includes(target) && v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
  }
  return '';
}

function parseExcelDate(raw: string): string {
  if (!raw) return todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ddmmyyyy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // Excel numeric serial date
  const num = Number(raw);
  if (Number.isFinite(num) && num > 25000 && num < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + num * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return todayISO();
}

function parseNum(raw: string): number {
  const cleaned = String(raw || '').replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export async function parseExcelOrCsvFile(params: {
  file: File;
  entityType: ImportEntityType;
  targetFy: string;
  ownerUid: string;
  branchCode: string;
  staffCode: string;
}): Promise<{
  records: Array<Record<string, unknown>>;
  previewHeaders: string[];
  previewRows: string[][];
}> {
  const { file, entityType, targetFy, ownerUid, branchCode, staffCode } = params;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('The uploaded spreadsheet contains no sheets.');

  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (rawRows.length === 0) throw new Error('Spreadsheet is empty (0 rows found).');

  const previewHeaders = Object.keys(rawRows[0] || {}).slice(0, 6);
  const previewRows = rawRows.slice(0, 5).map((r) =>
    previewHeaders.map((h) => String(r[h] ?? '').slice(0, 28))
  );

  const normalizedFy = normalizeFyLabel(targetFy);
  const records: Array<Record<string, unknown>> = [];

  for (const row of rawRows) {
    if (entityType === 'parties') {
      const name = getField(row, ['Party Name', 'Name', 'Customer', 'Ledger', 'Account']);
      if (!name) continue;
      const opBal = parseNum(getField(row, ['Opening Balance', 'Opening', 'Balance', 'Amount']));
      const drCrRaw = getField(row, ['Dr/Cr', 'Balance Type', 'Type', 'Side']).toUpperCase();
      const balType: 'Dr' | 'Cr' = drCrRaw.startsWith('C') ? 'Cr' : 'Dr';
      const catRaw = getField(row, ['Category', 'Party Type', 'Group']);
      const partyType: Party['partyType'] =
        /truck|owner|broker/i.test(catRaw)
          ? 'TruckOwner'
          : /vendor|fuel|diesel/i.test(catRaw)
          ? 'Vendor'
          : /consignor/i.test(catRaw)
          ? 'Consignor'
          : /consignee/i.test(catRaw)
          ? 'Consignee'
          : 'Customer';

      records.push({
        id: makeSafeDocId('imp_party'),
        name,
        partyType,
        address: getField(row, ['Address', 'City']),
        gstin: getField(row, ['GSTIN', 'GST No', 'GST']).toUpperCase(),
        pan: getField(row, ['PAN', 'PAN No']).toUpperCase(),
        phone: getField(row, ['Phone', 'Mobile', 'Contact']),
        email: getField(row, ['Email', 'Mail']),
        openingBalance: opBal,
        currentBalance: opBal,
        balanceType: balType,
        ownerUid,
      });
    } else if (entityType === 'vehicles') {
      const truckNo = getField(row, ['Truck No', 'Vehicle No', 'Lorry No', 'Reg No']).toUpperCase().replace(/\s+/g, '');
      if (!truckNo) continue;
      records.push({
        id: makeSafeDocId('imp_veh'),
        truckNo,
        vehicleType: getField(row, ['Vehicle Type', 'Type', 'Model']) || 'Goods Carrier',
        ownerName: getField(row, ['Owner Name', 'Owner']) || 'Fleet Owner',
        ownerPhone: getField(row, ['Owner Phone', 'Phone', 'Mobile']),
        engineNo: getField(row, ['Engine No', 'Engine']),
        chassisNo: getField(row, ['Chassis No', 'Chassis']),
        fitnessExpiry: getField(row, ['Fitness Expiry', 'Fitness']) ? parseExcelDate(getField(row, ['Fitness Expiry', 'Fitness'])) : '',
        insuranceExpiry: getField(row, ['Insurance Expiry', 'Insurance']) ? parseExcelDate(getField(row, ['Insurance Expiry', 'Insurance'])) : '',
        permitExpiry: getField(row, ['Permit Expiry', 'Permit']) ? parseExcelDate(getField(row, ['Permit Expiry', 'Permit'])) : '',
        pucExpiry: getField(row, ['PUC Expiry', 'PUC']) ? parseExcelDate(getField(row, ['PUC Expiry', 'PUC'])) : '',
        ownerUid,
      });
    } else if (entityType === 'consignments') {
      const cnNo = getField(row, ['CN No', 'LR No', 'Bilty No', 'Consignment No']);
      const consignorName = getField(row, ['Consignor', 'Party Name', 'Sender', 'Customer']);
      if (!cnNo && !consignorName) continue;
      const cnDate = parseExcelDate(getField(row, ['CN Date', 'LR Date', 'Date']));
      const freight = parseNum(getField(row, ['Freight', 'Total Freight', 'Amount']));
      records.push({
        id: makeSafeDocId('imp_cn'),
        cnNo: cnNo || `IMP-${records.length + 1}`,
        cnDate,
        financialYear: getField(row, ['Financial Year', 'FY']) ? normalizeFyLabel(getField(row, ['Financial Year', 'FY'])) : normalizedFy || resolveFinancialYearFromDate(cnDate),
        deliveryOffice: getField(row, ['Delivery Office', 'To', 'Destination']),
        consignorName: consignorName || 'Customer',
        consigneeName: getField(row, ['Consignee', 'Receiver']) || consignorName || 'Consignee',
        packages: getField(row, ['Packages', 'Pkgs', 'Qty']) || '1',
        particulars: getField(row, ['Particulars', 'Description', 'Goods', 'Item']) || 'Goods Consignment',
        nettWeight: parseNum(getField(row, ['Nett Weight', 'Net Weight', 'Weight', 'MT'])),
        grossWeight: parseNum(getField(row, ['Gross Weight', 'Weight', 'MT'])),
        totalFreight: freight,
        paidAmount: 0,
        toPayAmount: freight,
        taxInvNo: getField(row, ['Tax Inv No', 'Invoice No', 'Challan No']),
        taxInvDate: cnDate,
        ewayBillNo: getField(row, ['E-Way Bill', 'EWB', 'Eway No']),
        ewayBillDate: cnDate,
        valueOfGoods: parseNum(getField(row, ['Value of Goods', 'Goods Value', 'Value'])),
        truckNo: getField(row, ['Truck No', 'Vehicle No', 'Lorry No']).toUpperCase().replace(/\s+/g, '') || '-',
        fromCity: getField(row, ['From', 'From City', 'Origin']) || 'KOLKATA',
        toCity: getField(row, ['To', 'To City', 'Destination']) || 'DELIVERY',
        remarks: getField(row, ['Remarks', 'Note']),
        billed: false,
        branchCode,
        createdByStaff: staffCode,
        ownerUid,
      });
    } else if (entityType === 'invoices') {
      const invoiceNo = getField(row, ['Invoice No', 'Bill No', 'Voucher No']);
      const partyName = getField(row, ['Party Name', 'Customer', 'Party']);
      if (!invoiceNo && !partyName) continue;
      const invoiceDate = parseExcelDate(getField(row, ['Invoice Date', 'Bill Date', 'Date']));
      const grandTotal = parseNum(getField(row, ['Grand Total', 'Total', 'Bill Amount', 'Amount']));
      const paidAmount = parseNum(getField(row, ['Paid Amount', 'Paid', 'Received']));
      const freightCharges = parseNum(getField(row, ['Freight Charges', 'Freight'])) || grandTotal;
      const gstRate = parseNum(getField(row, ['GST Rate', 'GST %'])) || 5;
      const statusRaw = getField(row, ['Status']);
      const status: Invoice['status'] =
        /paid/i.test(statusRaw) && !/unpaid|partial/i.test(statusRaw)
          ? 'Paid'
          : paidAmount >= grandTotal && grandTotal > 0
          ? 'Paid'
          : paidAmount > 0
          ? 'Partial'
          : 'Unpaid';

      records.push({
        id: makeSafeDocId('imp_inv'),
        invoiceNo: invoiceNo || `BILL-${records.length + 1}`,
        invoiceDate,
        dueDate: invoiceDate,
        financialYear: getField(row, ['Financial Year', 'FY']) ? normalizeFyLabel(getField(row, ['Financial Year', 'FY'])) : normalizedFy || resolveFinancialYearFromDate(invoiceDate),
        partyName: partyName || 'Customer',
        partyAddress: getField(row, ['Address', 'Party Address']),
        partyGstin: getField(row, ['GSTIN', 'Party GSTIN']).toUpperCase(),
        partyPan: getField(row, ['PAN']).toUpperCase(),
        sac: '996791',
        reverseCharge: true,
        gstRate,
        cgstAmt: Number(((freightCharges * gstRate) / 200).toFixed(2)),
        sgstAmt: Number(((freightCharges * gstRate) / 200).toFixed(2)),
        igstAmt: 0,
        totalTax: Number(((freightCharges * gstRate) / 100).toFixed(2)),
        freightCharges,
        detentionCharges: 0,
        unloadingCharges: 0,
        stCharges: 0,
        grandTotal,
        paidAmount,
        status,
        remarks: getField(row, ['Remarks', 'Note']),
        consignmentRows: [],
        branchCode,
        createdByStaff: staffCode,
        ownerUid,
      });
    } else if (entityType === 'transactions') {
      const partyName = getField(row, ['Party Name', 'Party', 'Account', 'Payee']);
      const amount = parseNum(getField(row, ['Amount', 'Debit', 'Credit', 'Value']));
      if (!partyName && amount <= 0) continue;
      const txDate = parseExcelDate(getField(row, ['Date', 'Tx Date', 'Voucher Date']));
      const typeRaw = getField(row, ['Type', 'Tx Type', 'Voucher Type']);
      const txType: TransactionRecord['txType'] = /exp|pay|dr/i.test(typeRaw) ? 'Expense' : 'Income';

      records.push({
        id: makeSafeDocId('imp_tx'),
        txCode: getField(row, ['Voucher No', 'Tx Code', 'Ref']) || `TRN-IMP-${records.length + 1}`,
        txDate,
        financialYear: getField(row, ['Financial Year', 'FY']) ? normalizeFyLabel(getField(row, ['Financial Year', 'FY'])) : normalizedFy || resolveFinancialYearFromDate(txDate),
        txType,
        ledgerAccount: getField(row, ['Ledger Account', 'Ledger', 'Account']) || (txType === 'Income' ? 'Customer A/c' : 'Transport Expense A/c'),
        partyName: partyName || 'Account Entry',
        amount,
        narration: getField(row, ['Narration', 'Remarks', 'Description']),
        paymentMode: getField(row, ['Payment Mode', 'Mode']) || 'Bank Transfer',
        referenceNo: getField(row, ['Reference No', 'Ref No', 'Cheque No']),
        branchCode,
        createdByStaff: staffCode,
        ownerUid,
      });
    }
  }

  if (records.length === 0) {
    throw new Error(`No valid ${entityType} rows could be matched. Download the sample template to verify column names.`);
  }

  return { records, previewHeaders, previewRows };
}

export function downloadSampleImportTemplate(entityType: ImportEntityType): void {
  const samples: Record<ImportEntityType, Array<Record<string, unknown>>> = {
    parties: [
      {
        'Party Name': 'EXAMPLE IRON STEELS P LTD',
        Category: 'Customer',
        GSTIN: '19AAACE1234F1Z5',
        PAN: 'AAACE1234F',
        Phone: '9830011223',
        Address: 'Howrah, Kolkata - 711101',
        'Opening Balance': 45000,
        'Dr/Cr': 'Dr',
      },
    ],
    vehicles: [
      {
        'Truck No': 'WB23C6597',
        'Owner Name': 'Dolphin Fleet Owners',
        'Vehicle Type': '22 FT Open Trailer',
        'Owner Phone': '9062167077',
        'Fitness Expiry': '2027-06-15',
        'Insurance Expiry': '2027-05-20',
        'Permit Expiry': '2027-08-01',
        'PUC Expiry': '2027-02-15',
      },
    ],
    consignments: [
      {
        'CN No': 'KOL-101/25-26',
        'CN Date': '2026-02-18',
        Consignor: 'BENGAL IRON CORPORATION',
        Consignee: 'SILIGURI STEELS LTD',
        'Truck No': 'WB51B0800',
        From: 'KOLKATA',
        To: 'SILIGURI',
        Packages: '250',
        Particulars: 'MS Steel Bars 16MT',
        Weight: 16,
        Freight: 38500,
        'Tax Inv No': 'BIC/25-26/901',
        'E-Way Bill': '871768055110',
        Remarks: 'Handle carefully, dry tarpaulin required',
      },
    ],
    invoices: [
      {
        'Invoice No': 'KOL/088/25-26',
        'Invoice Date': '2026-03-20',
        'Party Name': 'BENGAL IRON CORPORATION',
        GSTIN: '19AACFB7509H1ZG',
        'Freight Charges': 38500,
        'GST Rate': 5,
        'Grand Total': 38500,
        'Paid Amount': 18500,
        Status: 'Partial',
        Remarks: 'Historical FY 2025-26 balance bill',
      },
    ],
    transactions: [
      {
        'Voucher No': 'TRN-099',
        Date: '2026-03-25',
        Type: 'Income',
        'Ledger Account': 'Customer A/c',
        'Party Name': 'BENGAL IRON CORPORATION',
        Amount: 18500,
        'Payment Mode': 'NEFT',
        'Reference No': 'PNB-994120',
        Narration: 'Part payment against KOL/088/25-26',
      },
    ],
  };

  const ws = XLSX.utils.json_to_sheet(samples[entityType]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, entityType.toUpperCase());
  XLSX.writeFile(wb, `DRC_Sample_${entityType}_Template.xlsx`);
}

export interface ClosingBalanceRow {
  partyId: string;
  partyName: string;
  partyType: string;
  openingBalance: number;
  openingType: 'Dr' | 'Cr';
  fyDebits: number;
  fyCredits: number;
  closingBalance: number;
  closingType: 'Dr' | 'Cr';
}

export function computeFyClosingBalances(params: {
  sourceFy: string;
  parties: Party[];
  invoices: Invoice[];
  lorryHires: LorryHire[];
  transactions: TransactionRecord[];
  consignments: ConsignmentNote[];
  company: CompanySettings;
}): {
  rows: ClosingBalanceRow[];
  cashClosing: number;
  bankClosing: number;
  carryForwardMap: Record<string, FyOpeningBalanceEntry>;
} {
  const { sourceFy, parties, invoices, lorryHires, transactions, company } = params;
  const normSourceFy = normalizeFyLabel(sourceFy);
  const storedFyOpenings = company.fyOpeningBalances?.[normSourceFy] || {};

  const fyInvoices = invoices.filter((i) =>
    matchesSelectedFinancialYear(i.financialYear, i.invoiceDate, normSourceFy)
  );
  const fyHires = lorryHires.filter((h) =>
    matchesSelectedFinancialYear(h.financialYear, h.cnDate, normSourceFy)
  );
  const fyTx = transactions.filter((t) =>
    matchesSelectedFinancialYear(t.financialYear, t.txDate, normSourceFy)
  );

  const carryForwardMap: Record<string, FyOpeningBalanceEntry> = {};

  const rows: ClosingBalanceRow[] = parties.map((p) => {
    const customOpen = storedFyOpenings[p.name] || storedFyOpenings[p.id];
    const openingAmount = customOpen ? Number(customOpen.amount || 0) : Number(p.openingBalance || 0);
    const openingType: 'Dr' | 'Cr' = customOpen ? customOpen.balanceType : p.balanceType || 'Dr';
    const signedOpening = openingType === 'Dr' ? openingAmount : -openingAmount;

    const pKey = p.name.trim().toLowerCase();

    // Bills raised increase Party Receivable (Debit)
    const billDr = fyInvoices
      .filter((i) => i.partyName.trim().toLowerCase() === pKey)
      .reduce((s, i) => s + Number(i.grandTotal || 0), 0);

    // Cash/Bank Receipts from Party decrease Receivable (Credit); Expenses/Payments paid increase Debit
    const txCr = fyTx
      .filter((t) => t.partyName.trim().toLowerCase() === pKey && t.txType === 'Income')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const txDr = fyTx
      .filter((t) => t.partyName.trim().toLowerCase() === pKey && t.txType === 'Expense')
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    // Truck Owner Hire payable (Credit) & Advance/Balance paid (Debit)
    const hireCr = fyHires
      .filter((h) => (h.ownerName || '').trim().toLowerCase() === pKey)
      .reduce((s, h) => s + Number(h.hireAmount || 0), 0);
    const hireDr = fyHires
      .filter((h) => (h.ownerName || '').trim().toLowerCase() === pKey)
      .reduce(
        (s, h) => s + Number(h.advancePaid || 0) + (h.balancePaid ? Number(h.balancePayable || 0) : 0),
        0
      );

    const fyDebits = billDr + txDr + hireDr;
    const fyCredits = txCr + hireCr;
    const netSigned = signedOpening + fyDebits - fyCredits;
    const closingType: 'Dr' | 'Cr' = netSigned >= 0 ? 'Dr' : 'Cr';
    const closingBalance = Math.abs(Math.round(netSigned * 100) / 100);

    carryForwardMap[p.id] = { amount: closingBalance, balanceType: closingType };
    carryForwardMap[p.name] = { amount: closingBalance, balanceType: closingType };

    return {
      partyId: p.id,
      partyName: p.name,
      partyType: p.partyType,
      openingBalance: openingAmount,
      openingType,
      fyDebits,
      fyCredits,
      closingBalance,
      closingType,
    };
  });

  // Cash & Bank Closing Totals for Source FY
  let cashClosing = Number(storedFyOpenings['__CASH__']?.amount || 0);
  let bankClosing = Number(storedFyOpenings['__BANK__']?.amount || 0);

  fyTx.forEach((t) => {
    const isCash = t.paymentMode === 'Cash';
    const delta = t.txType === 'Income' ? Number(t.amount || 0) : -Number(t.amount || 0);
    if (isCash) cashClosing += delta;
    else bankClosing += delta;
  });

  carryForwardMap['__CASH__'] = {
    amount: Math.abs(Math.round(cashClosing * 100) / 100),
    balanceType: cashClosing >= 0 ? 'Dr' : 'Cr',
  };
  carryForwardMap['__BANK__'] = {
    amount: Math.abs(Math.round(bankClosing * 100) / 100),
    balanceType: bankClosing >= 0 ? 'Dr' : 'Cr',
  };

  return { rows, cashClosing, bankClosing, carryForwardMap };
}
