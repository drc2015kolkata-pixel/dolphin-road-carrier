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
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  upiId?: string;
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
  pinCode?: string;
  country?: 'India' | 'Bangladesh' | 'Nepal' | 'Bhutan' | string;
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
  vehicleMake?: string;
  bodyType?: string;
  vehicleColor?: string;
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
  pinCode?: string;
  country?: 'India' | 'Bangladesh' | 'Nepal' | 'Bhutan' | string;
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

export interface MultiWeightRow {
  label: string;
  actualWeightKg: number;
  grossWeightKg: number;
  chargedWeightKg: number;
}

export interface MultiGoodsItem {
  description: string;
  packages: number;
  packageMode: string;
  weightKg: number;
  hsnCode?: string;
}

export interface ExtraInsuranceItem {
  policyNo: string;
  policyDate?: string;
  amount: number;
}

export interface EwbExtensionLog {
  extNo: number;
  extendedDate: string;
  validUpto: string;
  reason?: string;
}

export interface PayInstallmentRow {
  slot: number;
  date: string;
  refNo: string;
  amount: number;
}

export interface BankApiConfig {
  enabled?: boolean;
  providerName?: string;
  apiKey?: string;
  clientId?: string;
  webhookSecret?: string;
}

export type KycDocType =
  | 'WB_TRADE_LICENSE'
  | 'WB_PTAX'
  | 'UDYAM_MSME'
  | 'PAN_CARD'
  | 'AADHAAR_CARD'
  | 'GST_CERTIFICATE'
  | 'VEHICLE_PAPERS'
  | 'OTHER';

export interface KycVaultItem {
  id: string;
  docType: KycDocType | string;
  label: string;
  docNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  portalUrl?: string;
  localStorageKey?: string;
  driveFileName?: string;
  updatedAt?: string;
}

export type ExtraWeightRow = MultiWeightRow;
export type MultiGoodsRow = MultiGoodsItem;
export type ExtraInsurancePolicy = ExtraInsuranceItem;

export interface ConsignmentNote {
  id: string;
  cnNo: string;
  cnDate: string;
  financialYear?: string;
  division?: 'FTL' | 'LOGISTICS' | 'PTL' | 'COURIER' | string;
  branchShort?: string;
  lastCnNo?: string;
  refCnNo?: string;
  transportMode?: 'Road' | 'Rail' | 'Air' | string;
  bookingBasis?: 'Party' | 'Franchise' | 'Cash' | string;
  payBasis?: 'TBB' | 'Paid' | 'To-Pay' | string;
  billedAtBranch?: string;
  hasVehicleNo?: boolean;
  deliveryOffice?: string;
  stockTransfer?: boolean;
  billingPartyName?: string;
  billToPartyFlag?: boolean;
  creditDays?: number;
  consignorName: string;
  consignorAddress?: string;
  consignorPinCode?: string;
  consignorCountry?: string;
  consignorGstin?: string;
  consignorHsn?: string;
  consigneeName: string;
  consigneeAddress?: string;
  consigneePinCode?: string;
  consigneeCountry?: string;
  consigneeGstin?: string;
  consigneeHsn?: string;
  deliverAt?: string;
  deliverAtPinCode?: string;
  deliverAtCountry?: string;
  isChallanAttached?: boolean;
  packages?: string;
  packageMode?: string;
  particulars?: string;
  multiGoodsItems?: MultiGoodsItem[];
  rateMode?: string;
  ratePerUnit?: number;
  nettWeight?: number;
  grossWeight?: number;
  chargedWeight?: number;
  multiWeights?: MultiWeightRow[];
  loadingCharge?: number;
  unloadingCharge?: number;
  returnLorryCharge?: number;
  sttCharge?: number;
  otherCharge?: number;
  totalFreight: number;
  showFreightOnPrint?: boolean;
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
  ewayPlace?: string;
  ewayPinCode?: string;
  ewbExtensions?: EwbExtensionLog[];
  extraTaxInvoices?: ExtraTaxInvoice[];
  extraEwayBills?: ExtraEwayBill[];
  extraVehicles?: string[];
  valueOfGoods?: number;
  truckNo: string;
  fromState?: string;
  fromDistrict?: string;
  fromCity: string;
  fromPinCode?: string;
  fromCountry?: string;
  toState?: string;
  toDistrict?: string;
  toCity: string;
  toPinCode?: string;
  toCountry?: string;
  engineNo?: string;
  chassisNo?: string;
  ownerName?: string;
  brokerName?: string;
  driverName?: string;
  driverDlNo?: string;
  driverDlExpiry?: string;
  driverMobile?: string;
  deliveryModeCode?: 'P' | 'G' | 'D' | string;
  gstPaidBy?: string;
  gstPaidByCode?: 'R' | 'E' | 'T' | string;
  riskTakenBy?: 'O' | 'C' | 'I' | string;
  insuranceStatus?: string;
  insuranceCo?: string;
  insurancePolicyNo?: string;
  insurancePolicyDate?: string;
  insuranceAmount?: number;
  extraInsurances?: ExtraInsuranceItem[];
  multiInsurances?: ExtraInsuranceItem[];
  billAdjustmentDetails?: string;
  addlDetailsEnabled?: boolean;
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
  billId?: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate?: string;
  financialYear?: string;
  division?: 'FTL' | 'LOGISTICS' | 'PTL' | 'COURIER' | string;
  billedByCode?: 'B' | 'P' | string;
  billedAtBranch?: string;
  poWorkOrderNo?: string;
  creditDays?: number;
  docKind?: 'Tax Invoice' | 'Credit Note' | 'Debit Note' | string;
  againstInvoiceId?: string;
  againstInvoiceNo?: string;
  finalized?: boolean;
  narrationText?: string;
  roundOffAmt?: number;
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
  insuranceCharge?: number;
  collCharge?: number;
  loadingCharge?: number;
  detentionCharges?: number;
  unloadingCharges?: number;
  surchargeAmt?: number;
  stCharges?: number;
  fumigationCharge?: number;
  extraCharge?: number;
  grossBillAmount?: number;
  advanceReceived?: number;
  advanceMode?: string;
  fullPaymentMode?: string;
  grandTotal: number;
  manualTotalOverride?: boolean;
  paidAmount: number;
  status: 'Unpaid' | 'Partial' | 'Paid';
  remarks?: string;
  billFootnote?: string;
  additionalNotes?: string;
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
  division?: 'FTL' | 'LOGISTICS' | 'PTL' | 'COURIER' | string;
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
  destinationPinCode?: string;
  destinationCountry?: string;
  advancePay?: string;
  entryPoint?: string;
  entryPointPinCode?: string;
  entryPointCountry?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LorryAdvanceRow {
  payeeType: 'Lorry Owner' | 'Broker' | 'Driver' | string;
  accountName: string;
  holderName?: string;
  bankAccountNo?: string;
  upiId?: string;
  refNo?: string;
  advanceDate: string;
  mode: string;
  amount: number;
}

export interface LorryHire {
  id: string;
  cnNo: string;
  cnDate?: string;
  financialYear?: string;
  division?: 'FTL' | 'LOGISTICS' | 'PTL' | 'COURIER' | string;
  truckNo: string;
  ownerName?: string;
  brokerName?: string;
  fromCity?: string;
  fromPinCode?: string;
  fromCountry?: string;
  toCity?: string;
  toPinCode?: string;
  toCountry?: string;
  weightMt?: number;
  ratePerUnit?: number;
  rateMode?: string;
  bookedPkgs?: number;
  deliveredPkgs?: number;
  shortageDamagePkgs?: number;
  hasMultiAdvance?: boolean;
  advances?: LorryAdvanceRow[];
  hireAmount: number;
  advancePaid: number;
  extraAdvanceAmt?: number;
  loadingCharge?: number;
  unloadingCharge?: number;
  parkingCharge?: number;
  kataCharge?: number;
  detentionCharge?: number;
  detentionDays?: number;
  detentionFromDate?: string;
  detentionToDate?: string;
  unloadingDate?: string;
  shortageCharge?: number;
  damageCharge?: number;
  tdsRatePct?: number;
  tdsAmount?: number;
  receiptChallanNo?: string;
  receiptChallanDate?: string;
  balancePayable: number;
  balancePaidAmt?: number;
  payInstallments?: PayInstallmentRow[];
  paymentDueAmt?: number;
  advExDate?: string;
  payTdsAmt?: number;
  podReceived: boolean;
  podReceiveDate?: string;
  podImageDataUrl?: string;
  podFileName?: string;
  podRemarks?: string;
  balancePaid: boolean;
  balancePaidDate?: string;
  paymentMode?: string;
  paymentRef?: string;
  remarks?: string;
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
  division?: 'FTL' | 'LOGISTICS' | 'PTL' | 'COURIER' | string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  financialYear: string;
  declarationDate: string;
  place: string;
  placePinCode?: string;
  placeCountry?: string;
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

export interface StaffMultiAdvanceLog {
  date: string;
  account: string;
  amount: number;
  mode?: string;
}

export interface StaffMultiPaidReturnLog {
  date: string;
  amount: number;
  mode?: string;
  refNo?: string;
}

export interface StaffMultiBalanceDateLog {
  date: string;
  balanceAmt: number;
  note?: string;
}

export interface StaffCommissionEntry {
  id: string;
  entryDate: string;
  financialYear?: string;
  division?: 'FTL' | 'LOGISTICS' | 'PTL' | 'COURIER' | string;
  staffName: string;
  staffBankAccount?: string;
  staffUpiId?: string;
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
  challanAmt?: number;
  travellingAmt?: number;
  miscAmt?: number;
  amount: number;
  paymentMode?: string;
  advanceDate?: string;
  monthlyPaidDate?: string;
  settledZeroFlag?: boolean;
  remarks?: string;
  multiAdvances?: StaffMultiAdvanceLog[];
  multiPaidReturns?: StaffMultiPaidReturnLog[];
  multiBalanceDates?: StaffMultiBalanceDateLog[];
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
  bankApiConfig?: BankApiConfig;
  kycVault?: KycVaultItem[];
  kycVaultPinEnabled?: boolean;
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
  | 'allInOne'
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

export type LogisticsDivisionCode = 'LOGISTICS' | 'PTL' | 'COURIER';

export type BusinessMode = 'FTL' | LogisticsDivisionCode;

export const BUSINESS_MODE_META: Record<
  BusinessMode,
  {
    code: BusinessMode;
    shortLabel: string;
    fullName: string;
    title: string;
    subtitle: string;
    docPrefix: string;
    idPrefix: string;
    driveTag: string;
    driveFilePrefix: string;
  }
> = {
  FTL: {
    code: 'FTL',
    shortLabel: 'FTL',
    fullName: 'FTL Business (Full Truck Load)',
    title: 'FTL Business (Full Truck Load)',
    subtitle: 'Full-Truck Consignments, 4-Copy LR, Tax Invoices, Lorry Hire & Financial Books',
    docPrefix: 'KOL',
    idPrefix: '',
    driveTag: 'DRC_FTL_BUSINESS',
    driveFilePrefix: 'DRC_FTL_BUSINESS',
  },
  LOGISTICS: {
    code: 'LOGISTICS',
    shortLabel: 'LOGISTICS',
    fullName: 'Logistics Division',
    title: 'Logistics Division',
    subtitle: 'Integrated Express Line-Haul, Hub Manifests, Godown Stock & Logistics Ledgers',
    docPrefix: 'LOG',
    idPrefix: '',
    driveTag: 'DRC_LOGISTICS_BUSINESS',
    driveFilePrefix: 'DRC_LOGISTICS_BUSINESS',
  },
  PTL: {
    code: 'PTL',
    shortLabel: 'PTL',
    fullName: 'PTL Business (Part Truck Load)',
    title: 'PTL Business (Part Truck Load)',
    subtitle: 'Part-Load Consolidation, Weight/Pkg Rates, Hub Transfers & PTL Billing',
    docPrefix: 'PTL',
    idPrefix: 'ptl_',
    driveTag: 'DRC_PTL_BUSINESS',
    driveFilePrefix: 'DRC_PTL_BUSINESS',
  },
  COURIER: {
    code: 'COURIER',
    shortLabel: 'COURIER',
    fullName: 'Courier & Express Parcel',
    title: 'Courier & Express Parcel',
    subtitle: 'Air/Surface Parcel Dockets, Door-to-Door Pods, COD Cash & Courier Ledgers',
    docPrefix: 'COUR',
    idPrefix: 'cour_',
    driveTag: 'DRC_COURIER_PARCEL',
    driveFilePrefix: 'DRC_COURIER_PARCEL',
  },
};

export function getLogisticsDivisionFromId(id?: string): LogisticsDivisionCode {
  const s = String(id || '');
  if (s.startsWith('ptl_')) return 'PTL';
  if (s.startsWith('cour_')) return 'COURIER';
  return 'LOGISTICS';
}

export function makeDivisionDocId(
  division: BusinessMode,
  basePrefix: string,
  suffix?: string
): string {
  const divPrefix = BUSINESS_MODE_META[division]?.idPrefix || '';
  const tail = suffix || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const raw = `${divPrefix}${basePrefix}_${tail}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return raw;
}

export type LogisticsWorkspaceTabId =
  | 'overview'
  | 'allInOne'
  | 'docket'
  | 'manifest'
  | 'godown'
  | 'masters'
  | 'billing'
  | 'ledgers'
  | 'pdfVault'
  | 'backup';

export type DriveFolderName =
  | 'LR Copy'
  | 'Bills_Invoices'
  | 'Quotations'
  | 'POD_Scans'
  | 'Declarations'
  | 'Reports_Ledgers'
  | 'Bank_Statements';

export type PdfVaultFolder =
  | '1. LR_Copy_PDFs'
  | '2. Tax_Invoice_PDFs'
  | '3. Quotation_PDFs'
  | '4. Declaration_PDFs'
  | '5. POD_Scans_PDFs';

export type LogisticsDriveFolderName =
  | 'Docket_LR'
  | 'LineHaul_Manifests'
  | 'Logistics_Invoices_CN_DN'
  | 'Godown_POD_Scans'
  | 'Logistics_Ledgers';

export type AnyDriveFolderName = DriveFolderName | LogisticsDriveFolderName | PdfVaultFolder;

export interface LogisticsParty {
  id: string;
  name: string;
  partyType: 'Customer' | 'Consignor' | 'Consignee' | 'Broker' | 'DeliveryAgent' | 'Vendor';
  address?: string;
  pinCode?: string;
  country?: 'India' | 'Bangladesh' | 'Nepal' | 'Bhutan' | string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  branchCode?: string;
  openingBalance: number;
  currentBalance: number;
  balanceType: 'Dr' | 'Cr';
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LogisticsVehicle {
  id: string;
  truckNo: string;
  vehicleType?: string;
  vehicleMake?: string;
  bodyType?: string;
  vehicleColor?: string;
  ownerName: string;
  ownerPhone?: string;
  fitnessExpiry?: string;
  insuranceExpiry?: string;
  permitExpiry?: string;
  roadTaxExpiry?: string;
  pucExpiry?: string;
  branchCode?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LogisticsDriver {
  id: string;
  name: string;
  dlNo: string;
  dlExpiry: string;
  phone?: string;
  address?: string;
  pinCode?: string;
  country?: 'India' | 'Bangladesh' | 'Nepal' | 'Bhutan' | string;
  branchCode?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type LogisticsStockStage =
  | 'Origin Godown'
  | 'Manifested / In Transit'
  | 'Destination Godown'
  | 'Out for Delivery'
  | 'Delivered';

export interface LogisticsDocket {
  id: string;
  division?: LogisticsDivisionCode | string;
  docketNo: string;
  docketDate: string;
  financialYear?: string;
  billedAtBranch?: string;
  originBranch: string;
  originPinCode?: string;
  originCountry?: string;
  destBranch: string;
  destPinCode?: string;
  destCountry?: string;
  deliveryMode: 'Door Delivery' | 'Godown Delivery';
  payMode: 'Paid' | 'To-Pay' | 'TBB';
  consignorName: string;
  consignorAddress?: string;
  consignorPinCode?: string;
  consignorCountry?: string;
  consignorGstin?: string;
  consigneeName: string;
  consigneeAddress?: string;
  consigneePinCode?: string;
  consigneeCountry?: string;
  consigneeGstin?: string;
  billingPartyName?: string;
  packages: number;
  packingType?: string;
  goodsDesc: string;
  actualWeightKg: number;
  chargedWeightKg: number;
  rateBasis: 'Per Kg' | 'Per Package' | 'Fixed';
  ratePerUnit: number;
  baseFreight: number;
  fovCharge?: number;
  docketCharge?: number;
  hamaliCharge?: number;
  doorCharge?: number;
  gstRate: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  reverseCharge?: boolean;
  totalAmount: number;
  ewayBillNo?: string;
  ewayBillValidUpto?: string;
  ewayPlace?: string;
  ewayPinCode?: string;
  valueOfGoods?: number;
  stockStage: LogisticsStockStage;
  godownRack?: string;
  godownBranch?: string;
  manifestId?: string;
  manifestNo?: string;
  invoiceId?: string;
  billed: boolean;
  podImageDataUrl?: string;
  podDate?: string;
  remarks?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LogisticsManifest {
  id: string;
  division?: LogisticsDivisionCode | string;
  manifestNo: string;
  manifestDate: string;
  financialYear?: string;
  fromBranch: string;
  toBranch: string;
  truckNo: string;
  driverName: string;
  driverPhone?: string;
  brokerName?: string;
  docketIds: string[];
  docketNos: string[];
  totalPkgs: number;
  totalWeightKg: number;
  totalTopayAmount: number;
  hireAmount: number;
  advancePaid: number;
  balancePayable: number;
  status: 'Dispatched' | 'In Transit' | 'Arrived' | 'Unloaded';
  arrivalDate?: string;
  remarks?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LogisticsInvoiceDocketRow {
  docketNo: string;
  docketDate: string;
  originBranch: string;
  destBranch: string;
  packages: number;
  weightKg: number;
  goodsDesc: string;
  freightAmt: number;
}

export interface LogisticsInvoice {
  id: string;
  division?: LogisticsDivisionCode | string;
  docType: 'Tax Invoice' | 'Credit Note' | 'Debit Note';
  docNo: string;
  docDate: string;
  financialYear?: string;
  linkedDocNo?: string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  partyPan?: string;
  sac?: string;
  reverseCharge?: boolean;
  interstate?: boolean;
  gstRate: number;
  taxableAmount: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  grandTotal: number;
  paidAmount: number;
  status: 'Unpaid' | 'Partial' | 'Paid';
  docketRows: LogisticsInvoiceDocketRow[];
  selectedBankId?: string;
  remarks?: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LogisticsLedgerEntry {
  id: string;
  voucherNo: string;
  voucherDate: string;
  financialYear?: string;
  voucherType: 'Receipt' | 'Payment' | 'COD Cash' | 'Adjustment';
  partyName: string;
  amount: number;
  tdsAmount?: number;
  paymentMode: string;
  upiRefId?: string;
  utrNo?: string;
  chequeNo?: string;
  linkedDocNo?: string;
  narration: string;
  branchCode?: string;
  createdByStaff?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

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
