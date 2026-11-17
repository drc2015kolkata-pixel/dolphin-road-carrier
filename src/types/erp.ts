export type PermissionKey =
  | 'dashboard'
  | 'master'
  | 'lr'
  | 'billing'
  | 'lorryHire'
  | 'accounts'
  | 'reports'
  | 'mis'
  | 'backup'
  | 'settings';

export type StaffRole = 'Admin' | 'Manager' | 'Billing' | 'Accounts' | 'Dispatch' | 'Viewer';

export const BRANCH_OPTIONS = [
  'ALL',
  'KOL-HQ',
  'HOWRAH',
  'DANKUNI',
  'SILIGURI',
  'DURGAPUR',
  'ASANSOL',
  'HALDIA',
  'KHARAGPUR',
] as const;

export type BranchCode = (typeof BRANCH_OPTIONS)[number] | string;

export interface StaffAccount {
  id: string;
  staffCode: string;
  displayName: string;
  role: StaffRole;
  branchCode?: string;
  pinHash: string;
  active: boolean;
  permissions: PermissionKey[];
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Party {
  id: string;
  name: string;
  partyType: 'Customer' | 'Consignor' | 'Consignee' | 'TruckOwner' | 'Vendor';
  address?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  openingBalance: number;
  currentBalance: number;
  balanceType: 'Dr' | 'Cr';
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Vehicle {
  id: string;
  truckNo: string;
  vehicleType?: string;
  ownerName: string;
  ownerPhone?: string;
  engineNo?: string;
  chassisNo?: string;
  fitnessExpiry?: string;
  insuranceExpiry?: string;
  permitExpiry?: string;
  pucExpiry?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Driver {
  id: string;
  name: string;
  dlNo: string;
  dlExpiry: string;
  phone?: string;
  address?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExtraEwayBill {
  no: string;
  date: string;
}

export interface ExtraTaxInvoice {
  no: string;
  date: string;
  value?: number;
}

export interface ConsignmentNote {
  id: string;
  cnNo: string;
  cnDate: string;
  financialYear?: string;
  deliveryOffice?: string;
  consignorName: string;
  consignorAddress?: string;
  consignorGstin?: string;
  consigneeName: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  packages?: string;
  particulars?: string;
  nettWeight?: number;
  grossWeight?: number;
  loadingCharge?: number;
  unloadingCharge?: number;
  returnLorryCharge?: number;
  sttCharge?: number;
  totalFreight: number;
  paidAmount?: number;
  toPayAmount?: number;
  taxInvNo?: string;
  taxInvDate?: string;
  ewayBillNo?: string;
  ewayBillDate?: string;
  extraTaxInvoices?: ExtraTaxInvoice[];
  extraEwayBills?: ExtraEwayBill[];
  extraVehicles?: string[];
  valueOfGoods?: number;
  truckNo: string;
  fromCity: string;
  toCity: string;
  engineNo?: string;
  chassisNo?: string;
  ownerName?: string;
  driverName?: string;
  driverDlNo?: string;
  gstPaidBy?: string;
  insuranceStatus?: string;
  remarks?: string;
  scannedLrDataUrl?: string;
  billed: boolean;
  invoiceId?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InvoiceConsignmentRow {
  cnNo: string;
  cnDate: string;
  vehicle: string;
  from: string;
  to: string;
  weight: number;
  ratePerMt: number;
  freight: number;
  description: string;
}

export interface InvoiceAnnexureLorry {
  cnNo: string;
  lorryNumbers: string;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate?: string;
  financialYear?: string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  partyPan?: string;
  sac?: string;
  reverseCharge?: boolean;
  gstRate?: number;
  cgstAmt?: number;
  sgstAmt?: number;
  igstAmt?: number;
  totalTax?: number;
  freightCharges?: number;
  detentionCharges?: number;
  unloadingCharges?: number;
  stCharges?: number;
  grandTotal: number;
  paidAmount: number;
  status: 'Unpaid' | 'Partial' | 'Paid';
  remarks?: string;
  consignmentRows: InvoiceConsignmentRow[];
  annexureLorries?: InvoiceAnnexureLorry[];
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Quotation {
  id: string;
  quotationNo: string;
  quotationDate: string;
  financialYear?: string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  subject?: string;
  validityText?: string;
  vehicleType: string;
  freight: number;
  loadingCharge?: string;
  unloadingCharge?: string;
  parkingCharge?: string;
  detentionCharge?: string;
  tonGuarantee?: string;
  destination: string;
  advancePay?: string;
  entryPoint?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LorryHire {
  id: string;
  cnNo: string;
  cnDate?: string;
  financialYear?: string;
  truckNo: string;
  ownerName?: string;
  fromCity?: string;
  toCity?: string;
  hireAmount: number;
  advancePaid: number;
  balancePayable: number;
  podReceived: boolean;
  podReceiveDate?: string;
  podImageDataUrl?: string;
  podFileName?: string;
  balancePaid: boolean;
  balancePaidDate?: string;
  paymentMode?: string;
  paymentRef?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TransactionRecord {
  id: string;
  txCode: string;
  txDate: string;
  financialYear?: string;
  txType: 'Income' | 'Expense';
  ledgerAccount: string;
  partyName: string;
  amount: number;
  narration?: string;
  paymentMode: string;
  referenceNo?: string;
  linkedCnNo?: string;
  linkedInvoiceNo?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Declaration194C {
  id: string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  financialYear: string;
  declarationDate: string;
  place: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CounterRecord {
  id: string;
  seq: number;
  prefix: string;
  fy: string;
  branchCode?: string;
  lastUpdatedBy?: string;
  ownerUid: string;
  updatedAt?: unknown;
}

export interface StaffPresence {
  id: string;
  staffCode: string;
  displayName: string;
  role: string;
  branchCode: string;
  activeModule?: string;
  deviceType?: string;
  status: 'online' | 'offline';
  ownerUid: string;
  lastSeenAt?: unknown;
}

export interface ActivityLog {
  id: string;
  action: string;
  module: string;
  docRefCode?: string;
  summary: string;
  staffCode: string;
  staffName?: string;
  branchCode: string;
  ownerUid: string;
  createdAt?: unknown;
}

export interface FyOpeningBalanceEntry {
  amount: number;
  balanceType: 'Dr' | 'Cr';
}

export interface CompanySettings {
  id?: string;
  companyName: string;
  tagline: string;
  address: string;
  pan: string;
  gstin: string;
  msme: string;
  hsn: string;
  phones: string;
  email: string;
  bankName: string;
  bankBranch: string;
  accountNo: string;
  ifsc: string;
  swift: string;
  currentFy: string;
  availableFys?: string[];
  fyOpeningBalances?: Record<string, Record<string, FyOpeningBalanceEntry>>;
  customStampDataUrl?: string;
  autoLockMinutes?: number;
  lockSourceInspection?: boolean;
  ownerUid: string;
  updatedAt?: unknown;
}

export type SheetTabId =
  | 'dashboard'
  | 'master'
  | 'lr'
  | 'billing'
  | 'lorryHire'
  | 'accounts'
  | 'reports'
  | 'mis'
  | 'backup'
  | 'settings'
  | 'about';

export type DriveFolderName =
  | 'LR Copy'
  | 'Bills_Invoices'
  | 'Quotations'
  | 'POD_Scans'
  | 'Declarations'
  | 'Reports_Ledgers';

export const DEFAULT_COMPANY_SETTINGS: Omit<CompanySettings, 'ownerUid' | 'updatedAt'> = {
  companyName: 'DOLPHIN ROAD CARRIER',
  tagline: 'Fast • Safe • Reliable',
  address: '30/1/29, Nobin Chandra Das Road, Nawapara, Kolkata - 700090',
  pan: 'DOTPS3540M',
  gstin: '19DOTPS3540M1ZZ',
  msme: 'UDYAM-WB-14-0024412',
  hsn: '996791',
  phones: '9062167077, 9674115666',
  email: 'drc.kolkata1@gmail.com',
  bankName: 'PUNJAB NATIONAL BANK',
  bankBranch: 'JORASANKO, KOLKATA',
  accountNo: '0672050014252',
  ifsc: 'PUNB0008020',
  swift: 'PUNBINBBXXX',
  currentFy: 'FY 2026-27',
  availableFys: ['FY 2025-26', 'FY 2026-27'],
  fyOpeningBalances: {},
  autoLockMinutes: 5,
  lockSourceInspection: true,
};

export const SCHEMA_LIMITS = {
  maxConsignmentRows: 100,
  maxAnnexureLorries: 100,
  maxPodImageChars: 440000,
  maxStaffName: 100,
  maxPartyName: 180,
  maxNarration: 300,
};
