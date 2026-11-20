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

export type SheetAccessLevel = 'blocked' | 'view' | 'edit';

export type SheetPermissionKey =
  | 'lr'
  | 'billing'
  | 'lorryHire'
  | 'commission'
  | 'accounts'
  | 'master'
  | 'bankImport'
  | 'reports'
  | 'quotations'
  | 'declarations'
  | 'settings';

export const SHEET_PERMISSION_DEFINITIONS: Array<{
  key: SheetPermissionKey;
  label: string;
  shortLabel: string;
  mappedTab: SheetTabId;
}> = [
  { key: 'lr', label: 'CN / Bilty Entry & Register', shortLabel: 'CN / Bilty', mappedTab: 'lr' },
  { key: 'billing', label: 'Billing & Tax Invoice', shortLabel: 'Tax Invoice', mappedTab: 'billing' },
  { key: 'lorryHire', label: 'Lorry Hire & POD Reconciliation', shortLabel: 'Lorry Hire', mappedTab: 'lorryHire' },
  { key: 'commission', label: 'Staff Commission & Advance Ledger', shortLabel: 'Staff Comm.', mappedTab: 'commission' },
  { key: 'accounts', label: 'Party Ledger & Daybook', shortLabel: 'Party Ledger', mappedTab: 'accounts' },
  { key: 'master', label: 'Drivers, Lorry Owners, Brokers & Parties', shortLabel: 'Masters', mappedTab: 'master' },
  { key: 'bankImport', label: 'Bank Receipt & TDS Auto-Import', shortLabel: 'Bank Import', mappedTab: 'bankImport' },
  { key: 'reports', label: 'FoxPro GST Register & Statements', shortLabel: 'GST Register', mappedTab: 'reports' },
  { key: 'quotations', label: '10-Sec Rate Quotations', shortLabel: 'Quotation', mappedTab: 'billing' },
  { key: 'declarations', label: '194C Exemption Declarations', shortLabel: '194C Decl.', mappedTab: 'billing' },
  { key: 'settings', label: 'Master Parameters & Drive Backup', shortLabel: 'Settings', mappedTab: 'settings' },
];

export interface StaffAccount {
  id: string;
  staffCode: string;
  displayName: string;
  role: StaffRole;
  branchCode?: string;
  pinHash: string;
  active: boolean;
  permissions: PermissionKey[];
  sheetPermissions?: Partial<Record<SheetPermissionKey, SheetAccessLevel>>;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Party {
  id: string;
  name: string;
  partyType: 'Customer' | 'Consignor' | 'Consignee' | 'TruckOwner' | 'Broker' | 'Vendor';
  address?: string;
  gstin?: string;
  pan?: string;
  aadhaarNo?: string;
  tradeLicenseNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  phone?: string;
  email?: string;
  preferredChannel?: 'WhatsApp Only' | 'Email Only' | 'Both' | string;
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
  roadTaxExpiry?: string;
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
  aadhaarNo?: string;
  panNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExtraEwayBill {
  no: string;
  date: string;
  validUpto?: string;
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
  division?: 'FTL' | 'LOGISTICS' | string;
  deliveryOffice?: string;
  stockTransfer?: boolean;
  billingPartyName?: string;
  creditDays?: number;
  consignorName: string;
  consignorAddress?: string;
  consignorGstin?: string;
  consigneeName: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  packages?: string;
  packageMode?: string;
  particulars?: string;
  rateMode?: string;
  ratePerUnit?: number;
  nettWeight?: number;
  grossWeight?: number;
  loadingCharge?: number;
  unloadingCharge?: number;
  returnLorryCharge?: number;
  sttCharge?: number;
  totalFreight: number;
  paidAmount?: number;
  toPayAmount?: number;
  hasTaxInvoice?: boolean;
  hasMultiEwayBill?: boolean;
  hasMultiVehicle?: boolean;
  taxInvNo?: string;
  taxInvDate?: string;
  ewayBillNo?: string;
  ewayBillDate?: string;
  ewayBillValidUpto?: string;
  extraTaxInvoices?: ExtraTaxInvoice[];
  extraEwayBills?: ExtraEwayBill[];
  extraVehicles?: string[];
  valueOfGoods?: number;
  truckNo: string;
  fromState?: string;
  fromDistrict?: string;
  fromCity: string;
  toState?: string;
  toDistrict?: string;
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
  packages?: string;
  rateType?: 'Fixed' | 'Per Ton' | string;
  ratePerMt: number;
  freight: number;
  description: string;
}

export interface InvoiceAnnexureLorry {
  cnNo: string;
  lorryNumbers: string;
}

export type BillCopyCount = 1 | 2 | 3 | 4;

export interface Invoice {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate?: string;
  financialYear?: string;
  division?: 'FTL' | 'LOGISTICS' | string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  partyPan?: string;
  billingCountry?: 'India' | 'Nepal' | 'Bangladesh' | 'Bhutan' | string;
  sac?: string;
  reverseCharge?: boolean;
  interstate?: boolean;
  gstPaidBy?: 'Consignee' | 'Consignor' | 'Transporter' | 'Others' | string;
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
  copyCount?: BillCopyCount;
  consignmentRows: InvoiceConsignmentRow[];
  annexureLorries?: InvoiceAnnexureLorry[];
  selectedBankId?: string;
  branchOfficeId?: string;
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
  division?: 'FTL' | 'LOGISTICS' | string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  partyPhone?: string;
  partyEmail?: string;
  guarantorName?: string;
  guarantorPhone?: string;
  acceptanceEmailOnly?: boolean;
  goodsType?: string;
  rateMode?: 'Fixed' | 'Per Ton' | string;
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

export interface LorryAdvanceRow {
  payeeType: 'Lorry Owner' | 'Broker' | string;
  accountName: string;
  advanceDate: string;
  mode: string;
  amount: number;
}

export interface LorryHire {
  id: string;
  cnNo: string;
  cnDate?: string;
  financialYear?: string;
  division?: 'FTL' | 'LOGISTICS' | string;
  truckNo: string;
  ownerName?: string;
  brokerName?: string;
  fromCity?: string;
  toCity?: string;
  bookedPkgs?: number;
  deliveredPkgs?: number;
  shortageDamagePkgs?: number;
  hasMultiAdvance?: boolean;
  advances?: LorryAdvanceRow[];
  hireAmount: number;
  advancePaid: number;
  loadingCharge?: number;
  unloadingCharge?: number;
  parkingCharge?: number;
  kataCharge?: number;
  shortageCharge?: number;
  damageCharge?: number;
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
  upiRefId?: string;
  utrNo?: string;
  chequeNo?: string;
  tdsAmount?: number;
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

export interface StaffCommissionEntry {
  id: string;
  entryDate: string;
  financialYear?: string;
  staffName: string;
  challanNo: string;
  truckNo?: string;
  wheelType:
    | '4-Wheeler'
    | '6-Wheeler'
    | '10-Wheeler'
    | '12-Wheeler'
    | '14-Wheeler'
    | '16-Wheeler'
    | '18-Wheeler'
    | '22-Wheeler Trailer'
    | string;
  entryType: 'Commission' | 'Advance Taken' | 'Paid';
  commissionRate?: number;
  amount: number;
  paymentMode?: string;
  remarks?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BankReceiptRecord {
  id: string;
  financialYear: string;
  receiptDate: string;
  bankAccountName: string;
  partyName: string;
  paymentMode?: string;
  referenceNo: string;
  upiRefId?: string;
  utrNo?: string;
  chequeNo?: string;
  narration?: string;
  description: string;
  creditAmount: number;
  tdsRatePct: number;
  tdsAmount: number;
  grossSettled: number;
  matchedInvoiceId?: string;
  matchedInvoiceNo?: string;
  billAmount?: number;
  balanceRemaining?: number;
  appliedToInvoice: boolean;
  sourceFileName?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CompanyBankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNo: string;
  ifsc: string;
  branch: string;
  upiId?: string;
  swift?: string;
  isDefault?: boolean;
}

export interface CompanyBranchOffice {
  id: string;
  branchName: string;
  branchCode: string;
  address: string;
  phone?: string;
  gstin?: string;
}

export interface DropdownMasterConfig {
  goodsTypes?: string[];
  packageModes?: string[];
  rateModes?: string[];
  deliveryPlaces?: string[];
  states?: string[];
  districtsByState?: Record<string, string[]>;
  creditDayPresets?: number[];
  wheelCommissionRates?: Record<string, number>;
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
  upiId?: string;
  bankAccounts?: CompanyBankAccount[];
  branches?: CompanyBranchOffice[];
  whatsappCloud?: {
    enabled?: boolean;
    phoneNumberId?: string;
    accessToken?: string;
    templateName?: string;
  };
  currentFy: string;
  availableFys?: string[];
  fyOpeningBalances?: Record<string, Record<string, FyOpeningBalanceEntry>>;
  dropdownMaster?: DropdownMasterConfig;
  customStampDataUrl?: string;
  panCardPhotoDataUrl?: string;
  bholeBabaPhotoDataUrl?: string;
  khatuShyamPhotoDataUrl?: string;
  autoLockMinutes?: number;
  lockSourceInspection?: boolean;
  last90DayAutoFixAt?: number;
  ownerUid: string;
  updatedAt?: unknown;
}

export type SheetTabId =
  | 'dashboard'
  | 'master'
  | 'lr'
  | 'billing'
  | 'lorryHire'
  | 'commission'
  | 'bankImport'
  | 'accounts'
  | 'reports'
  | 'mis'
  | 'backup'
  | 'staffAccess'
  | 'settings'
  | 'guide'
  | 'about';

export type DriveFolderName =
  | 'LR Copy'
  | 'Bills_Invoices'
  | 'Quotations'
  | 'POD_Scans'
  | 'Declarations'
  | 'Reports_Ledgers'
  | 'Bank_Statements';

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
  maxConsignmentRows: 5000,
  maxAnnexureLorries: 5000,
  maxPodImageChars: 440000,
  maxStaffName: 100,
  maxPartyName: 180,
  maxNarration: 300,
};
