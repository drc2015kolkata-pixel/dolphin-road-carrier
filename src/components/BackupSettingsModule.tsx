import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderArchive,
  FolderOpen,
  ImagePlus,
  KeyRound,
  Landmark,
  ListChecks,
  Lock,
  MonitorDown,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import {
  AnyDriveFolderName,
  BankReceiptRecord,
  BRANCH_OPTIONS,
  CompanyBankAccount,
  CompanyBranchOffice,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Driver,
  Invoice,
  LogisticsDocket,
  LogisticsDriver,
  LogisticsInvoice,
  LogisticsLedgerEntry,
  LogisticsManifest,
  LogisticsParty,
  LogisticsVehicle,
  LorryHire,
  Party,
  PermissionKey,
  Quotation,
  StaffAccount,
  StaffCommissionEntry,
  StaffRole,
  TransactionRecord,
  Vehicle,
  getLogisticsDivisionFromId,
} from '../types/erp';
import {
  downloadIsolatedBusinessFileFromDrive,
  downloadMasterBackupFromDrive,
  DriveFileSummary,
  getIsolatedDriveFileNames,
  INSTALLER_VAULT_FOLDER,
  listAppDataBackupFiles,
  listDriveBackupFiles,
  runDailyDrive8FileCleanup,
  uploadAppDataJsonSnapshot,
  uploadBlueprintPdfToDrive,
  uploadIsolatedBusinessBackupsToDrive,
  uploadMasterBackupToDrive,
} from '../lib/driveBackup';
import {
  BACKUP_ISOLATED_DRIVE_EMAIL,
  DRIVE_APPDATA_SCOPE,
  getOAuthDomainStatus,
  OFFICIAL_PARTY_EMAIL,
  VERCEL_APP_DOMAIN,
} from '../lib/firebase';
import {
  AutoCollectedOldDataResult,
  autoCollectOldDataFiles,
} from '../lib/foxproDbfImport';
import { analyzeAndSeparateMisclassifiedParties } from '../lib/partySeparation';
import {
  getLast90DayMaintenanceTimestamp,
  getStoredAdminPin,
  runSystemAutoFixAndClean,
  saveAdminPin,
  verifyAdminPin,
} from '../lib/selfHealing';
import {
  bulkUpsertDocuments,
  CustomAuthSession,
  forceTwoWaySyncAndMerge,
  removeDocument,
  restoreErpBackupBundle,
  restoreLogisticsBackupBundle,
  saveSettingsDocument,
  updateMasterAdminCredentials,
  upsertDocument,
} from '../lib/firestoreStore';
import { hasLiveCompanyData } from '../lib/securityShield';
import { validateIndianGstin, validateSafeUploadFile } from '../lib/gstinValidator';
import {
  downloadPdfDirect,
  generateAppFormatBlueprintPDF,
  GeneratedPdfResult,
} from '../lib/pdfEngine';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { GstinInputField } from './GstinInputField';
import {
  computeFyClosingBalances,
  downloadSampleImportTemplate,
  ImportEntityType,
  parseExcelOrCsvFile,
} from '../lib/excelImport';
import {
  checkForUpdatesNow,
  getVersionStatus,
  subscribeVersionStatus,
  VersionStatusInfo,
} from '../lib/versionSync';
import {
  addDropdownItem,
  deleteDropdownItem,
  DropdownCategoryKey,
  editDropdownItem,
  getEffectiveCreditDayPresets,
  getEffectiveDistrictsForState,
  getEffectiveDropdownList,
  resetDropdownCategory,
  updateCreditDayPresets,
  upsertDistrictItem,
} from '../lib/dropdownMasterStore';
import { formatINR, makeSafeDocId, normalizeFyLabel, PRECREATED_FYS, todayISO } from '../lib/formatters';
import { DEFAULT_BHOLE_BABA_IMAGE, DEFAULT_KHATU_SHYAM_IMAGE } from '../lib/sacredDefaults';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { SearchableSelect } from './SearchableSelect';

interface BackupSettingsModuleProps {
  mode: 'backup' | 'settings';
  ownerUid: string;
  isMasterAdmin: boolean;
  adminUserId: string;
  activeFy: string;
  connectedEmail: string | null;
  driveAccessToken: string | null;
  company: CompanySettings;
  hasCustomSettings: boolean;
  staffAccounts: StaffAccount[];
  activeStaffSession: StaffAccount | null;
  allData: {
    parties: Party[];
    vehicles: Vehicle[];
    drivers: Driver[];
    consignments: ConsignmentNote[];
    invoices: Invoice[];
    quotations: Quotation[];
    lorryHires: LorryHire[];
    transactions: TransactionRecord[];
    declarations: Declaration194C[];
    bankReceipts?: BankReceiptRecord[];
    staffCommissions?: StaffCommissionEntry[];
  };
  logisticsData?: {
    parties: LogisticsParty[];
    vehicles: LogisticsVehicle[];
    drivers: LogisticsDriver[];
    dockets: LogisticsDocket[];
    manifests: LogisticsManifest[];
    invoices: LogisticsInvoice[];
    ledgers: LogisticsLedgerEntry[];
  };
  onSwitchGmail: () => Promise<void>;
  onSwitchStaffSession: (staff: StaffAccount | null) => void;
  onUpdateAdminSession: (session: CustomAuthSession) => void;
  onSelectFy: (fy: string) => void;
  onPreviewPdf?: (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const ALL_PERMISSIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'master', label: 'Master' },
  { key: 'lr', label: 'LR / CN' },
  { key: 'billing', label: 'Billing & 194C' },
  { key: 'lorryHire', label: 'Lorry Hire / POD' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'reports', label: 'Reports' },
  { key: 'mis', label: 'MIS' },
  { key: 'backup', label: 'Drive Backup' },
  { key: 'settings', label: 'Settings' },
];

const BackupSettingsModuleInner: React.FC<BackupSettingsModuleProps> = ({
  mode,
  ownerUid,
  isMasterAdmin,
  adminUserId,
  activeFy,
  connectedEmail,
  driveAccessToken,
  company,
  hasCustomSettings,
  staffAccounts,
  activeStaffSession,
  allData,
  logisticsData,
  onSwitchGmail,
  onSwitchStaffSession,
  onUpdateAdminSession,
  onSelectFy,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const stampInputRef = useRef<HTMLInputElement | null>(null);
  const panCardInputRef = useRef<HTMLInputElement | null>(null);
  const bholeBabaInputRef = useRef<HTMLInputElement | null>(null);
  const khatuShyamInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const autoCollectFolderRef = useRef<HTMLInputElement | null>(null);
  const autoCollectFilesRef = useRef<HTMLInputElement | null>(null);

  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFileSummary[]>([]);
  const [busyDrive, setBusyDrive] = useState(false);

  // One-Click FoxPro (.DBF) & Bank PNB Excel Auto-Collector State
  const [autoCollectResult, setAutoCollectResult] = useState<AutoCollectedOldDataResult | null>(null);
  const [autoCollecting, setAutoCollecting] = useState(false);
  const [autoCollectImporting, setAutoCollectImporting] = useState(false);
  const [cleaningParties, setCleaningParties] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const oauthDomain = useMemo(() => getOAuthDomainStatus(), []);

  const partySeparationPreview = useMemo(
    () =>
      analyzeAndSeparateMisclassifiedParties({
        parties: allData.parties,
        drivers: allData.drivers,
        lorryHires: allData.lorryHires,
        invoices: allData.invoices,
        consignments: allData.consignments,
        extraOwnerNames: allData.vehicles.map((v) => v.ownerName || '').filter(Boolean),
      }),
    [
      allData.parties,
      allData.drivers,
      allData.lorryHires,
      allData.invoices,
      allData.consignments,
      allData.vehicles,
    ]
  );

  // Master Admin ID & Password Management
  const [adminCurrentPwd, setAdminCurrentPwd] = useState('');
  const [adminNewId, setAdminNewId] = useState(adminUserId || 'admin');
  const [adminNewPwd, setAdminNewPwd] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  // Admin PIN for 2-Second Drive Email Switch & Protected Settings
  const [drivePinModalOpen, setDrivePinModalOpen] = useState(false);
  const [drivePinInput, setDrivePinInput] = useState('');
  const [drivePinError, setDrivePinError] = useState<string | null>(null);
  const [newAdminPinInput, setNewAdminPinInput] = useState(() => getStoredAdminPin());
  const isolatedDriveNames = useMemo(() => getIsolatedDriveFileNames(activeFy), [activeFy]);

  // Live Version Sync State
  const [versionInfo, setVersionInfo] = useState<VersionStatusInfo>(() => getVersionStatus());

  // Staff creation form (50+ concurrent branch staff logins)
  const [staffCode, setStaffCode] = useState(`DRC-STF-${String(staffAccounts.length + 1).padStart(2, '0')}`);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<StaffRole>('Billing');
  const [staffBranch, setStaffBranch] = useState<string>('KOL-HQ');
  const [staffPin, setStaffPin] = useState('1234');
  const [staffBankName, setStaffBankName] = useState('');
  const [staffBankAcc, setStaffBankAcc] = useState('');
  const [staffBankIfsc, setStaffBankIfsc] = useState('');
  const [staffUpi, setStaffUpi] = useState('');
  const [staffPerms, setStaffPerms] = useState<PermissionKey[]>([
    'dashboard',
    'lr',
    'billing',
    'reports',
  ]);
  const [staffSearch, setStaffSearch] = useState('');
  const debouncedStaffSearch = useDebouncedValue(staffSearch, 200);
  const [revealedStaffIds, setRevealedStaffIds] = useState<Record<string, boolean>>({});
  const [editingPwdId, setEditingPwdId] = useState<string | null>(null);
  const [editingPwdValue, setEditingPwdValue] = useState('');

  const [loginCode, setLoginCode] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginMsg, setLoginMsg] = useState<string | null>(null);

  // Company Settings Form
  const [compState, setCompState] = useState<CompanySettings>(company);
  const [newFyInput, setNewFyInput] = useState('FY 2027-28');

  // Smart Bulk Data Import State (Excel / CSV)
  const [importEntity, setImportEntity] = useState<ImportEntityType>('consignments');
  const [importTargetFy, setImportTargetFy] = useState<string>(activeFy || 'FY 2025-26');
  const [parsedImport, setParsedImport] = useState<{
    records: Array<Record<string, unknown>>;
    previewHeaders: string[];
    previewRows: string[][];
    fileName: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);

  // Closing-to-Opening Balance Carry Forward State
  const [carrySourceFy, setCarrySourceFy] = useState('FY 2025-26');
  const [carryTargetFy, setCarryTargetFy] = useState('FY 2026-27');

  // Dropdown Master Management State
  type MasterTabKey = DropdownCategoryKey | 'districts' | 'creditDays';
  const [ddTab, setDdTab] = useState<MasterTabKey>('goodsTypes');
  const [ddSearch, setDdSearch] = useState('');
  const [ddNewItem, setDdNewItem] = useState('');
  const [ddSelectedState, setDdSelectedState] = useState('19 - West Bengal');
  const [ddEditingItem, setDdEditingItem] = useState<string | null>(null);
  const [ddEditingText, setDdEditingText] = useState('');
  const [ddNewCreditDay, setDdNewCreditDay] = useState('45');

  const fyChoices = useMemo(() => {
    const set = new Set<string>([...PRECREATED_FYS, ...(compState.availableFys || []), activeFy]);
    return Array.from(set).sort();
  }, [compState.availableFys, activeFy]);

  useEffect(() => {
    setCompState(company);
  }, [company]);

  useEffect(() => {
    setAdminNewId(adminUserId || 'admin');
  }, [adminUserId]);

  useEffect(() => {
    return subscribeVersionStatus(setVersionInfo);
  }, []);

  const filteredStaff = useMemo(() => {
    const q = debouncedStaffSearch.trim().toLowerCase();
    if (!q) return staffAccounts;
    return staffAccounts.filter((s) =>
      `${s.staffCode} ${s.displayName} ${s.role} ${s.branchCode || 'ALL'}`.toLowerCase().includes(q)
    );
  }, [staffAccounts, debouncedStaffSearch]);

  const handleBackupToDrive = () => {
    if (!driveAccessToken) {
      onSwitchGmail();
      return;
    }
    onShowConfirm({
      title: 'Upload Compact GZIP Backup to Google Drive?',
      description: `This will create/overwrite compressed Master_Backup_DRC.json.gz inside DOLPHIN_ROAD_CARRIERS_MASTER on ${connectedEmail || 'your Google Drive'} (50-Year 15GB Storage Optimizer).`,
      confirmLabel: 'Backup Compact GZIP to Drive',
      onConfirm: async () => {
        setBusyDrive(true);
        setDriveError(null);
        try {
          const res = await uploadMasterBackupToDrive(driveAccessToken, {
            exportedAt: new Date().toISOString(),
            company: compState,
            ...allData,
          });
          const rawKb = Math.max(1, Math.round(res.rawBytes / 1024));
          const compKb = Math.max(1, Math.round(res.compressedBytes / 1024));
          const pctSaved = res.rawBytes > 0 ? Math.max(0, Math.round((1 - res.compressedBytes / res.rawBytes) * 100)) : 0;
          setDriveStatus(
            `Backed up ${res.name} (${compKb} KB vs ${rawKb} KB raw · ${pctSaved}% saved for 50-year Drive space · File ID: ${res.id})`
          );
          const files = await listDriveBackupFiles(driveAccessToken);
          setDriveFiles(files);
        } catch (err) {
          setDriveError(err instanceof Error ? err.message : 'Drive backup failed');
        } finally {
          setBusyDrive(false);
        }
      },
    });
  };

  const handleUploadIsolated5Files = async () => {
    if (!driveAccessToken) {
      await onSwitchGmail();
      return;
    }
    setBusyDrive(true);
    setDriveError(null);
    try {
      const fyNorm = normalizeFyLabel(activeFy);
      const matchFy = (recFy?: string) => !recFy || normalizeFyLabel(recFy) === fyNorm;

      const ftlPayload = {
        division: 'FTL',
        financialYear: fyNorm,
        consignments: allData.consignments.filter((c) => matchFy(c.financialYear)),
        invoices: allData.invoices.filter((i) => matchFy(i.financialYear)),
        quotations: allData.quotations,
        lorryHires: allData.lorryHires.filter((l) => matchFy(l.financialYear)),
        transactions: allData.transactions.filter((t) => matchFy(t.financialYear)),
        bankReceipts: (allData.bankReceipts || []).filter((b) => matchFy(b.financialYear)),
        staffCommissions: (allData.staffCommissions || []).filter((s) => matchFy(s.financialYear)),
      };

      const logi = logisticsData || {
        parties: [],
        vehicles: [],
        drivers: [],
        dockets: [],
        manifests: [],
        invoices: [],
        ledgers: [],
      };
      const buildDivisionPayload = (div: 'LOGISTICS' | 'PTL' | 'COURIER') => ({
        division: div,
        financialYear: fyNorm,
        logistics_dockets: logi.dockets.filter(
          (d) => getLogisticsDivisionFromId(d.id) === div && matchFy(d.financialYear)
        ),
        logistics_manifests: logi.manifests.filter(
          (m) => getLogisticsDivisionFromId(m.id) === div && matchFy(m.financialYear)
        ),
        logistics_invoices: logi.invoices.filter(
          (i) => getLogisticsDivisionFromId(i.id) === div && matchFy(i.financialYear)
        ),
        logistics_ledgers: logi.ledgers.filter(
          (l) => getLogisticsDivisionFromId(l.id) === div && matchFy(l.financialYear)
        ),
      });

      const mastersVaultPayload = {
        company: compState,
        parties: allData.parties,
        vehicles: allData.vehicles,
        drivers: allData.drivers,
        declarations: allData.declarations,
        staff_accounts: staffAccounts,
        logistics_parties: logi.parties,
        logistics_vehicles: logi.vehicles,
        logistics_drivers: logi.drivers,
      };

      const res = await uploadIsolatedBusinessBackupsToDrive({
        accessToken: driveAccessToken,
        activeFy: fyNorm,
        ftlPayload,
        logisticsPayload: buildDivisionPayload('LOGISTICS'),
        ptlPayload: buildDivisionPayload('PTL'),
        courierPayload: buildDivisionPayload('COURIER'),
        mastersVaultPayload,
      });

      setDriveStatus(
        `App-Only Sandbox Drive Backup Complete: Uploaded ${res.uploadedFiles.length} isolated JSON files (${res.names.all.join(', ')}) + ensured inactive "${INSTALLER_VAULT_FOLDER}" folder.`
      );
      const files = await listDriveBackupFiles(driveAccessToken);
      setDriveFiles(files);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Isolated 5-file Drive backup failed');
    } finally {
      setBusyDrive(false);
    }
  };

  const handleRestoreIsolatedFile = async (fileName: string) => {
    if (!driveAccessToken) {
      await onSwitchGmail();
      return;
    }
    setBusyDrive(true);
    setDriveError(null);
    try {
      const payload = await downloadIsolatedBusinessFileFromDrive(driveAccessToken, fileName);
      if (!payload) {
        setDriveError(`"${fileName}" was not found in your App Sandbox Drive folder yet. Upload first.`);
        return;
      }
      if (fileName === isolatedDriveNames.ftl) {
        await restoreErpBackupBundle(payload);
      } else if (fileName === isolatedDriveNames.mastersVault) {
        await restoreErpBackupBundle(payload);
        await restoreLogisticsBackupBundle(payload);
      } else {
        await restoreLogisticsBackupBundle(payload);
      }
      setDriveStatus(`Restored isolated business data from "${fileName}" cleanly.`);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : `Restore of ${fileName} failed.`);
    } finally {
      setBusyDrive(false);
    }
  };

  const handleVerifyDrivePinAndSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyAdminPin(drivePinInput)) {
      setDrivePinError('Invalid Admin Security PIN. Default PIN is 1234 unless changed below.');
      return;
    }
    setDrivePinError(null);
    setDrivePinModalOpen(false);
    setDrivePinInput('');
    await onSwitchGmail();
  };

  const handleSaveNewAdminPin = () => {
    const clean = newAdminPinInput.trim();
    if (clean.length < 4) {
      setDriveError('Admin Security PIN must be at least 4 characters.');
      return;
    }
    saveAdminPin(clean);
    setDriveError(null);
    setDriveStatus('Admin Security PIN updated cleanly in local device security vault.');
  };

  const handleAutoCollectSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const rawFiles = Array.from(fileList);
    // Security allowlist check on FoxPro / Spreadsheet files; flag any dangerous executables/scripts
    for (const f of rawFiles) {
      if (/\.(exe|bat|cmd|sh|msi|vbs|ps1|js|mjs|ts|html|htm|svg|php)$/i.test(f.name)) {
        const chk = validateSafeUploadFile(f, 'foxpro_batch');
        playAlertBeep();
        setDriveError(chk.reason || `Blocked unsafe file "${f.name}" by DRC Security Policy.`);
        return;
      }
    }
    const safeFiles = rawFiles.filter((f) => validateSafeUploadFile(f, 'foxpro_batch').valid);
    setAutoCollecting(true);
    setDriveError(null);
    setDriveStatus(null);
    try {
      const res = await autoCollectOldDataFiles({
        files: safeFiles,
        activeFy,
        bankAccountName: compState.bankName || 'PUNJAB NATIONAL BANK',
        ownerUid,
        branchCode: 'KOL-HQ',
        staffCode: adminUserId || 'ADMIN',
        existingInvoices: allData.invoices,
      });
      setAutoCollectResult(res);
      if (res.processedFiles.length === 0) {
        setDriveError('No .DBF or Bank PNB Excel (.xlsx/.xls/.csv) files found in the selected folder/files.');
      } else {
        setDriveStatus(
          `Auto-Collect scanned ${res.processedFiles.length} data file(s) & skipped ${res.ignoredScrapFiles.length} scrap file(s): Ready to import ${res.parties.length} Parties, ${res.consignments.length} CN/Bilty, ${res.invoices.length} Bills, ${res.lorryHires.length} Challans, ${res.bankReceipts.length} PNB Bank Receipts.`
        );
      }
    } catch (err) {
      setAutoCollectResult(null);
      setDriveError(err instanceof Error ? err.message : 'Auto-Collect scan failed.');
    } finally {
      setAutoCollecting(false);
    }
  };

  const handleConfirmAutoCollectImport = async () => {
    if (!autoCollectResult) return;
    setAutoCollectImporting(true);
    setDriveError(null);
    try {
      let totalImported = 0;
      if (autoCollectResult.parties.length > 0) {
        totalImported += await bulkUpsertDocuments('parties', autoCollectResult.parties as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.vehicles.length > 0) {
        totalImported += await bulkUpsertDocuments('vehicles', autoCollectResult.vehicles as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.drivers.length > 0) {
        totalImported += await bulkUpsertDocuments('drivers', autoCollectResult.drivers as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.consignments.length > 0) {
        totalImported += await bulkUpsertDocuments('consignments', autoCollectResult.consignments as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.invoices.length > 0) {
        totalImported += await bulkUpsertDocuments('invoices', autoCollectResult.invoices as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.lorryHires.length > 0) {
        totalImported += await bulkUpsertDocuments('lorry_hires', autoCollectResult.lorryHires as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.bankReceipts.length > 0) {
        totalImported += await bulkUpsertDocuments('bank_receipts', autoCollectResult.bankReceipts as unknown as Array<Record<string, unknown>>);
      }
      if (autoCollectResult.destinations.length > 0) {
        const mergedPlaces = Array.from(
          new Set([
            ...(compState.dropdownMaster?.deliveryPlaces || []),
            ...autoCollectResult.destinations,
          ])
        );
        const nextComp: CompanySettings = {
          ...compState,
          dropdownMaster: {
            ...(compState.dropdownMaster || {}),
            deliveryPlaces: mergedPlaces,
          },
        };
        setCompState(nextComp);
        await saveSettingsDocument('company', { ...nextComp, ownerUid }, hasCustomSettings);
      }
      setDriveStatus(
        `One-Click Auto-Collect Complete: Imported ${totalImported} legacy FoxPro/PNB record(s) + ${autoCollectResult.destinations.length} Destination(s) into Firestore & Local Cache (${autoCollectResult.ignoredScrapFiles.length} scrap file(s) excluded).`
      );
      setAutoCollectResult(null);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Auto-Collect import failed.');
    } finally {
      setAutoCollectImporting(false);
    }
  };

  const handleSeparateBrokersFromCustomers = async () => {
    setCleaningParties(true);
    setDriveError(null);
    try {
      const analysis = analyzeAndSeparateMisclassifiedParties({
        parties: allData.parties,
        drivers: allData.drivers,
        lorryHires: allData.lorryHires,
        invoices: allData.invoices,
        consignments: allData.consignments,
        extraOwnerNames: allData.vehicles.map((v) => v.ownerName || '').filter(Boolean),
      });

      if (analysis.updatedParties.length === 0 && analysis.duplicatePartyIds.length === 0) {
        const customerCount = allData.parties.filter(
          (p) => p.partyType === 'Customer' || p.partyType === 'Consignor' || p.partyType === 'Consignee'
        ).length;
        setDriveStatus(
          `Verified Customer Master (${customerCount} Customers): All Brokers, Vehicle Owners & Drivers are already cleanly separated from Billing Parties.`
        );
        return;
      }

      if (analysis.updatedParties.length > 0) {
        await bulkUpsertDocuments(
          'parties',
          analysis.updatedParties as unknown as Array<Record<string, unknown>>
        );
      }
      for (const dupId of analysis.duplicatePartyIds) {
        await removeDocument('parties', dupId);
      }

      setDriveStatus(
        `Clean / Separate Complete: Moved ${analysis.brokersSeparated} Broker(s), ${analysis.ownersSeparated} Vehicle Owner(s), and ${analysis.driversSeparated} Driver Ledger(s) out of Billing Customers (${analysis.duplicatesMerged} duplicate rows merged). Tax Invoice "Bill To Party *" now shows strictly Customer / Billing Parties.`
      );
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed to separate brokers from billing parties.');
    } finally {
      setCleaningParties(false);
    }
  };

  const handleCopyVercelDomain = async () => {
    try {
      await navigator.clipboard.writeText(VERCEL_APP_DOMAIN);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleRunDailyDriveCleanup = async () => {
    if (!driveAccessToken) {
      onSwitchGmail();
      return;
    }
    setBusyDrive(true);
    setDriveError(null);
    try {
      const res = await runDailyDrive8FileCleanup(driveAccessToken);
      setDriveStatus(
        `Google Drive 8-File & Subfolder Cleanup Complete: ${res.trashedCount} redundant/temp/scrap files pruned, ${res.keptCount} essential master files preserved inside DOLPHIN_ROAD_CARRIERS_MASTER.`
      );
      const files = await listDriveBackupFiles(driveAccessToken);
      setDriveFiles(files);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Drive cleanup failed');
    } finally {
      setBusyDrive(false);
    }
  };

  const handleListDriveFiles = async () => {
    if (!driveAccessToken) {
      onSwitchGmail();
      return;
    }
    setBusyDrive(true);
    try {
      const files = await listDriveBackupFiles(driveAccessToken);
      setDriveFiles(files);
      setDriveStatus(`Synced ${files.length} files across DOLPHIN_ROAD_CARRIERS_MASTER folders.`);
    } catch (err) {
      setDriveStatus(err instanceof Error ? err.message : 'Failed to list Drive files');
    } finally {
      setBusyDrive(false);
    }
  };

  const handleRestoreFromDrive = () => {
    if (!driveAccessToken) {
      onSwitchGmail();
      return;
    }
    onShowConfirm({
      title: 'Restore Records from Google Drive Master_Backup_DRC.json?',
      description:
        'This downloads Master_Backup_DRC.json from your connected Google Drive and re-imports missing records into Firestore.',
      confirmLabel: 'Restore Backup',
      variant: 'danger',
      onConfirm: async () => {
        setBusyDrive(true);
        setDriveError(null);
        try {
          const payload = await downloadMasterBackupFromDrive(driveAccessToken);
          if (!payload) {
            setDriveStatus('No Master_Backup_DRC.json found in Drive yet.');
            return;
          }
          await restoreErpBackupBundle(payload);
          const partiesList = (payload.parties as Party[]) || [];
          setDriveStatus(`Restored full ERP backup snapshot cleanly (${partiesList.length} party records synced).`);
        } catch (err) {
          setDriveError(err instanceof Error ? err.message : 'Restore failed');
        } finally {
          setBusyDrive(false);
        }
      },
    });
  };

  const handleDownloadLocalJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            company: compState,
            ...allData,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Master_Backup_DRC_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setDriveError(null);
    const cleanCode = staffCode.trim().toUpperCase();
    const cleanName = staffName.trim();
    const cleanPwd = staffPin.trim();
    if (!cleanCode || !cleanName || cleanPwd.length < 4) {
      setDriveError('Please enter Staff User ID, Full Name, and Password (at least 4 characters).');
      return;
    }
    if (cleanCode === 'ADMIN') {
      setDriveError('User ID "admin" is reserved for Master Admin.');
      return;
    }
    if (staffAccounts.some((s) => s.staffCode.toLowerCase() === cleanCode.toLowerCase())) {
      setDriveError(`Staff User ID "${cleanCode}" already exists. Choose a unique User ID.`);
      return;
    }

    await upsertDocument(
      'staff_accounts',
      makeSafeDocId('staff'),
      {
        staffCode: cleanCode,
        displayName: cleanName,
        role: staffRole,
        branchCode: staffBranch,
        pinHash: cleanPwd,
        active: true,
        permissions: staffPerms,
        bankName: staffBankName.trim(),
        bankAccountNo: staffBankAcc.trim(),
        bankIfsc: staffBankIfsc.trim().toUpperCase(),
        upiId: staffUpi.trim(),
        ownerUid,
      },
      true
    );
    setStaffName('');
    setStaffBankName('');
    setStaffBankAcc('');
    setStaffBankIfsc('');
    setStaffUpi('');
    setStaffCode(`DRC-STF-${String(staffAccounts.length + 2).padStart(2, '0')}`);
    setDriveStatus(
      `Created Staff User ID ${cleanCode} (Branch: ${staffBranch}) — ready to sign in on Windows & Android.`
    );
  };

  const handleStaffOperatorLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const match = staffAccounts.find(
      (s) =>
        s.active &&
        s.staffCode.toLowerCase() === loginCode.trim().toLowerCase() &&
        s.pinHash === loginPin.trim()
    );
    if (!match) {
      setLoginMsg('Invalid User ID, Password, or account is disabled.');
      return;
    }
    onSwitchStaffSession(match);
    setLoginMsg(
      `Switched active operator to ${match.displayName} (${match.role} · ${match.branchCode || 'ALL'}).`
    );
    setLoginCode('');
    setLoginPin('');
  };

  const handleSaveCompanySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setDriveError(null);
    if (compState.gstin.trim()) {
      const gstChk = validateIndianGstin(compState.gstin);
      if (!gstChk.valid) {
        playAlertBeep();
        setDriveError(`Company GSTIN Invalid: ${gstChk.error}`);
        return;
      }
    }
    for (const br of compState.branches || []) {
      if (br.gstin && br.gstin.trim()) {
        const brChk = validateIndianGstin(br.gstin);
        if (!brChk.valid) {
          playAlertBeep();
          setDriveError(`Branch ${br.branchCode || br.branchName} GSTIN Invalid: ${brChk.error}`);
          return;
        }
      }
    }
    const mergedFys = Array.from(
      new Set([...PRECREATED_FYS, ...(compState.availableFys || []), normalizeFyLabel(compState.currentFy)])
    );
    const cleanBankApi =
      compState.bankApiConfig &&
      (compState.bankApiConfig.enabled ||
        compState.bankApiConfig.providerName ||
        compState.bankApiConfig.apiKey ||
        compState.bankApiConfig.clientId)
        ? {
            enabled: Boolean(compState.bankApiConfig.enabled),
            providerName: compState.bankApiConfig.providerName || '',
            apiKey: compState.bankApiConfig.apiKey || '',
            clientId: compState.bankApiConfig.clientId || '',
            webhookSecret: compState.bankApiConfig.webhookSecret || '',
          }
        : undefined;

    await saveSettingsDocument(
      'company',
      {
        companyName: compState.companyName,
        tagline: compState.tagline,
        address: compState.address,
        pan: compState.pan,
        gstin: compState.gstin,
        msme: compState.msme,
        hsn: compState.hsn,
        phones: compState.phones,
        email: compState.email,
        bankName: compState.bankName,
        bankBranch: compState.bankBranch,
        accountNo: compState.accountNo,
        ifsc: compState.ifsc,
        swift: compState.swift,
        upiId: compState.upiId || '',
        bankAccounts: compState.bankAccounts || [],
        branches: compState.branches || [],
        ...(compState.whatsappCloud ? { whatsappCloud: compState.whatsappCloud } : {}),
        ...(cleanBankApi ? { bankApiConfig: cleanBankApi } : {}),
        ...(Array.isArray(compState.kycVault) ? { kycVault: compState.kycVault } : {}),
        ...(compState.kycVaultPinEnabled !== undefined
          ? { kycVaultPinEnabled: Boolean(compState.kycVaultPinEnabled) }
          : {}),
        ...(compState.last90DayAutoFixAt ? { last90DayAutoFixAt: compState.last90DayAutoFixAt } : {}),
        currentFy: normalizeFyLabel(compState.currentFy),
        availableFys: mergedFys,
        fyOpeningBalances: compState.fyOpeningBalances || {},
        customStampDataUrl: compState.customStampDataUrl || '',
        panCardPhotoDataUrl: compState.panCardPhotoDataUrl || '',
        bholeBabaPhotoDataUrl: compState.bholeBabaPhotoDataUrl || '',
        khatuShyamPhotoDataUrl: compState.khatuShyamPhotoDataUrl || '',
        autoLockMinutes: Number(compState.autoLockMinutes ?? 5),
        lockSourceInspection: compState.lockSourceInspection !== false,
        ...(compState.dropdownMaster ? { dropdownMaster: compState.dropdownMaster } : {}),
        ownerUid,
      },
      hasCustomSettings
    );
    setDriveStatus('Company, Multi-Bank Accounts, Bank API, UPI QR, Branches, Stamp & Security Settings saved cleanly.');
  };

  const handleAddBankAccount = () => {
    const newBank: CompanyBankAccount = {
      id: makeSafeDocId('bank'),
      bankName: compState.bankName || 'Punjab National Bank',
      accountName: `Bank Account ${(compState.bankAccounts?.length || 0) + 1}`,
      accountNo: '',
      ifsc: '',
      branch: compState.bankBranch || 'Kolkata',
      upiId: compState.upiId || '',
      swift: '',
      isDefault: (compState.bankAccounts?.length || 0) === 0,
    };
    setCompState((prev) => ({
      ...prev,
      bankAccounts: [...(prev.bankAccounts || []), newBank],
    }));
  };

  const handleAddBranchOffice = () => {
    const newBranch: CompanyBranchOffice = {
      id: makeSafeDocId('br'),
      branchCode: `BR-${String((compState.branches?.length || 0) + 1).padStart(2, '0')}`,
      branchName: 'New Branch Office',
      address: '',
      phone: '',
      gstin: '',
    };
    setCompState((prev) => ({
      ...prev,
      branches: [...(prev.branches || []), newBranch],
    }));
  };

  const handleRunManualAutoFix = () => {
    const summary = runSystemAutoFixAndClean({
      parties: allData.parties,
      consignmentCount: allData.consignments.length,
      invoiceCount: allData.invoices.length,
      lorryHireCount: allData.lorryHires.length,
    });
    setCompState((prev) => ({ ...prev, last90DayAutoFixAt: summary.ranAt }));
    setDriveStatus(
      `90-Day Auto-Fix & Thermal Memory Cooling Complete (${summary.checksumHash}): Cleared ${summary.cooledBlobUrls} blob cache handle(s) and ${summary.clearedScratchKeys} temp keys. 100% accounting data intact.`
    );
  };

  const handleUploadStamp = (file: File | undefined) => {
    if (!file) return;
    const uploadCheck = validateSafeUploadFile(file, 'image_only');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setDriveError(uploadCheck.reason || 'Unsupported Stamp image blocked by DRC Security.');
      return;
    }
    setDriveError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 320;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(40, Math.round(img.width * scale));
        const h = Math.max(40, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const pngDataUrl = canvas.toDataURL('image/png');
        setCompState((prev) => ({ ...prev, customStampDataUrl: pngDataUrl }));
        setDriveStatus('Company Stamp & Digital Signature loaded — click "Save Company Settings" to apply across all Bills, Bilty (LR) & Quotations.');
      };
      img.onerror = () => setDriveError('Could not read the selected Stamp image file.');
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleUploadPanCard = (file: File | undefined) => {
    if (!file) return;
    const uploadCheck = validateSafeUploadFile(file, 'image_only');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setDriveError(uploadCheck.reason || 'Unsupported PAN Card image blocked by DRC Security.');
      return;
    }
    setDriveError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 680;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(120, Math.round(img.width * scale));
        const h = Math.max(80, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.86;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 435000 && quality > 0.35) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        setCompState((prev) => ({ ...prev, panCardPhotoDataUrl: dataUrl.slice(0, 439500) }));
        setDriveStatus('Proprietor PAN Card photo loaded — click "Save Company Settings" to embed on right side of all Section 194C Declarations.');
      };
      img.onerror = () => setDriveError('Could not read the selected PAN Card image file.');
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSacredPhoto = (
    field: 'bholeBabaPhotoDataUrl' | 'khatuShyamPhotoDataUrl',
    deityLabel: string,
    file: File | undefined
  ) => {
    if (!file) return;
    const uploadCheck = validateSafeUploadFile(file, 'image_only');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setDriveError(uploadCheck.reason || `Unsupported ${deityLabel} image blocked by DRC Security.`);
      return;
    }
    setDriveError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(48, Math.round(img.width * scale));
        const h = Math.max(48, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const nextComp = {
          ...compState,
          [field]: jpgDataUrl,
          availableFys: fyChoices,
          ownerUid,
        };
        setCompState(nextComp);
        await saveSettingsDocument('company', nextComp as Record<string, unknown>, hasCustomSettings);
        setDriveStatus(`Updated ${deityLabel} header portrait cleanly and saved to Settings.`);
      };
      img.onerror = () => setDriveError(`Could not read the selected ${deityLabel} image file.`);
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleResetSacredPhoto = async (
    field: 'bholeBabaPhotoDataUrl' | 'khatuShyamPhotoDataUrl',
    deityLabel: string
  ) => {
    const nextComp = {
      ...compState,
      [field]: '',
      availableFys: fyChoices,
      ownerUid,
    };
    setCompState(nextComp);
    await saveSettingsDocument('company', nextComp as Record<string, unknown>, hasCustomSettings);
    setDriveStatus(`Restored default sacred artwork for ${deityLabel}.`);
  };

  const handleAddFutureFy = async () => {
    const clean = normalizeFyLabel(newFyInput);
    if (!clean) return;
    const nextFys = Array.from(new Set([...fyChoices, clean]));
    setCompState((prev) => ({ ...prev, availableFys: nextFys }));
    await saveSettingsDocument(
      'company',
      {
        ...compState,
        availableFys: nextFys,
        ownerUid,
      },
      hasCustomSettings
    );
    onSelectFy(clean);
    setDriveStatus(`Created and switched to ${clean}.`);
  };

  const handleExcelFileSelected = async (file: File | undefined) => {
    if (!file) return;
    const uploadCheck = validateSafeUploadFile(file, 'spreadsheet');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setDriveError(uploadCheck.reason || 'Unsupported file type blocked. Upload .xlsx, .xls, or .csv only.');
      return;
    }
    setDriveError(null);
    setDriveStatus(null);
    try {
      const res = await parseExcelOrCsvFile({
        file,
        entityType: importEntity,
        targetFy: importTargetFy,
        ownerUid,
        branchCode: 'KOL-HQ',
        staffCode: adminUserId || 'ADMIN',
      });
      setParsedImport({ ...res, fileName: file.name });
    } catch (err) {
      setParsedImport(null);
      setDriveError(err instanceof Error ? err.message : 'Failed to parse Excel / CSV file.');
    }
  };

  const handleConfirmBulkImport = async () => {
    if (!parsedImport || parsedImport.records.length === 0) return;
    setImporting(true);
    setDriveError(null);
    try {
      const count = await bulkUpsertDocuments(importEntity, parsedImport.records);
      setDriveStatus(
        `Successfully imported ${count} ${importEntity} records into ${importTargetFy} from "${parsedImport.fileName}".`
      );
      setParsedImport(null);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Bulk import failed.');
    } finally {
      setImporting(false);
    }
  };

  const closingPreview = useMemo(
    () =>
      computeFyClosingBalances({
        sourceFy: carrySourceFy,
        parties: allData.parties,
        invoices: allData.invoices,
        lorryHires: allData.lorryHires,
        transactions: allData.transactions,
        consignments: allData.consignments,
        company: compState,
      }),
    [carrySourceFy, allData, compState]
  );

  const handleCarryForwardBalances = () => {
    const normTarget = normalizeFyLabel(carryTargetFy);
    onShowConfirm({
      title: `Carry Forward ${carrySourceFy} → ${normTarget}?`,
      description: `Copies computed closing balances for ${closingPreview.rows.length} parties, Cash (₹${formatINR(closingPreview.cashClosing)}), and PNB Bank (₹${formatINR(closingPreview.bankClosing)}) from ${carrySourceFy} into ${normTarget} Opening Balances.`,
      confirmLabel: `Carry Forward to ${normTarget}`,
      onConfirm: async () => {
        const nextOpenings = {
          ...(compState.fyOpeningBalances || {}),
          [normTarget]: closingPreview.carryForwardMap,
        };
        setCompState((prev) => ({ ...prev, fyOpeningBalances: nextOpenings }));
        await saveSettingsDocument(
          'company',
          {
            ...compState,
            fyOpeningBalances: nextOpenings,
            availableFys: fyChoices,
            ownerUid,
          },
          hasCustomSettings
        );
        setDriveStatus(
          `Carried forward ${closingPreview.rows.length} party, Cash & Bank closing balances from ${carrySourceFy} into ${normTarget} Opening Balances.`
        );
      },
    });
  };

  const handleUpdateMasterAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDriveError(null);
    setDriveStatus(null);
    setAdminSaving(true);
    try {
      const updatedSession = await updateMasterAdminCredentials({
        currentPassword: adminCurrentPwd,
        newUserId: adminNewId,
        newPassword: adminNewPwd,
      });
      onUpdateAdminSession(updatedSession);
      setAdminCurrentPwd('');
      setAdminNewPwd('');
      setDriveStatus(
        `Master Admin credentials updated cleanly! New User ID: ${updatedSession.userId}.`
      );
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Failed to update Master Admin credentials.'
      );
    } finally {
      setAdminSaving(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setDriveError(null);
    const info = await checkForUpdatesNow(true);
    setDriveStatus(info.message);
  };

  const effectiveStates = useMemo(
    () => getEffectiveDropdownList(compState, 'states'),
    [compState]
  );

  const activeDropdownItems = useMemo(() => {
    if (ddTab === 'creditDays') return [];
    const raw =
      ddTab === 'districts'
        ? getEffectiveDistrictsForState(compState, ddSelectedState)
        : getEffectiveDropdownList(compState, ddTab);
    const q = ddSearch.trim().toLowerCase();
    return q ? raw.filter((item) => item.toLowerCase().includes(q)) : raw;
  }, [compState, ddTab, ddSelectedState, ddSearch]);

  const activeCreditPresets = useMemo(
    () => getEffectiveCreditDayPresets(compState),
    [compState]
  );

  const handleDdAddItem = async () => {
    const val = ddNewItem.trim();
    if (!val) return;
    if (ddTab === 'districts') {
      await upsertDistrictItem(ownerUid, compState, ddSelectedState, { type: 'add', value: val });
    } else if (ddTab !== 'creditDays') {
      await addDropdownItem(ownerUid, compState, ddTab, val);
    }
    setDdNewItem('');
    setDriveStatus(`Added "${val}" to Dropdown Master (synced live for all branches).`);
  };

  const handleDdSaveEdit = async (oldVal: string) => {
    const clean = ddEditingText.trim();
    if (!clean) return;
    if (ddTab === 'districts') {
      await upsertDistrictItem(ownerUid, compState, ddSelectedState, {
        type: 'edit',
        oldValue: oldVal,
        newValue: clean,
      });
    } else if (ddTab !== 'creditDays') {
      await editDropdownItem(ownerUid, compState, ddTab, oldVal, clean);
    }
    setDdEditingItem(null);
    setDdEditingText('');
    setDriveStatus(`Updated "${oldVal}" → "${clean}".`);
  };

  const handleDdDeleteItem = async (targetVal: string) => {
    if (ddTab === 'districts') {
      await upsertDistrictItem(ownerUid, compState, ddSelectedState, {
        type: 'delete',
        value: targetVal,
      });
    } else if (ddTab !== 'creditDays') {
      await deleteDropdownItem(ownerUid, compState, ddTab, targetVal);
    }
    setDriveStatus(`Removed "${targetVal}" from Dropdown Master.`);
  };

  const handleDdResetCategory = () => {
    if (ddTab === 'creditDays' || ddTab === 'districts') return;
    onShowConfirm({
      title: 'Reset Dropdown List to All-India Defaults?',
      description: 'Restores the official built-in All-India entries for this category across all branches.',
      confirmLabel: 'Reset Defaults',
      onConfirm: async () => {
        await resetDropdownCategory(ownerUid, compState, ddTab);
        setDriveStatus('Restored built-in All-India defaults.');
      },
    });
  };

  const handleAddCreditPreset = async () => {
    const num = Math.round(Number(ddNewCreditDay));
    if (!Number.isFinite(num) || num <= 0 || num > 365) return;
    await updateCreditDayPresets(ownerUid, compState, [...activeCreditPresets, num]);
    setDdNewCreditDay('');
    setDriveStatus(`Added ${num} Days Credit preset.`);
  };

  const handleRemoveCreditPreset = async (days: number) => {
    const next = activeCreditPresets.filter((d) => d !== days);
    await updateCreditDayPresets(ownerUid, compState, next.length > 0 ? next : [10, 15, 20, 30]);
    setDriveStatus(`Removed ${days} Days preset.`);
  };

  const staffColumns: TableColumn<StaffAccount>[] = useMemo(
    () => [
      {
        key: 'staffCode',
        header: 'User ID',
        cellClassName: 'font-mono-num font-bold text-blue-800 whitespace-nowrap',
        render: (s) => s.staffCode,
      },
      {
        key: 'displayName',
        header: 'Name & Bank / UPI',
        cellClassName: 'font-medium',
        render: (s) => (
          <div>
            <div className="font-bold text-slate-900">{s.displayName}</div>
            {(s.bankAccountNo || s.upiId) && (
              <div className="text-[10px] font-mono-num text-slate-500">
                {s.bankAccountNo ? `${s.bankName || 'Bank'} A/c ${s.bankAccountNo}` : ''}
                {s.upiId ? ` · UPI: ${s.upiId}` : ''}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'branchCode',
        header: 'Branch',
        render: (s) => (
          <div className="min-w-[115px]">
            <SearchableSelect
              ariaLabel={`Branch for ${s.staffCode}`}
              value={s.branchCode || 'ALL'}
              onChange={(val) => upsertDocument('staff_accounts', s.id, { branchCode: val }, false)}
              options={BRANCH_OPTIONS.map((b) => ({ value: b, label: b }))}
              triggerClassName="!py-1 !text-[11px] !font-semibold"
              searchPlaceholder="Search branch..."
            />
          </div>
        ),
      },
      { key: 'role', header: 'Role', render: (s) => s.role },
      {
        key: 'pinHash',
        header: 'Password',
        cellClassName: 'whitespace-nowrap',
        render: (s) => {
          const isEditing = editingPwdId === s.id;
          const isRevealed = Boolean(revealedStaffIds[s.id]);
          if (isEditing) {
            return (
              <div className="inline-flex items-center gap-1">
                <input
                  type="text"
                  value={editingPwdValue}
                  onChange={(e) => setEditingPwdValue(e.target.value)}
                  className="w-24 px-1.5 py-0.5 rounded border border-blue-400 text-[11px] font-mono-num"
                  placeholder="New pwd"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (editingPwdValue.trim().length < 4) return;
                    await upsertDocument(
                      'staff_accounts',
                      s.id,
                      { pinHash: editingPwdValue.trim() },
                      false
                    );
                    setEditingPwdId(null);
                    setEditingPwdValue('');
                    setDriveStatus(`Updated password for ${s.staffCode}.`);
                  }}
                  className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold cursor-pointer"
                >
                  Save
                </button>
              </div>
            );
          }
          return (
            <div className="inline-flex items-center gap-1.5 font-mono-num text-[11px]">
              <span>{isRevealed ? s.pinHash : '••••'}</span>
              <button
                type="button"
                onClick={() =>
                  setRevealedStaffIds((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                }
                className="p-0.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                title={isRevealed ? 'Hide password' : 'Show password'}
              >
                {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingPwdId(s.id);
                  setEditingPwdValue(s.pinHash || '');
                }}
                className="p-0.5 text-blue-700 hover:text-blue-900 cursor-pointer"
                title="Change password"
              >
                <KeyRound className="w-3 h-3" />
              </button>
            </div>
          );
        },
      },
      {
        key: 'permissions',
        header: 'Permissions',
        cellClassName: 'text-[11px] text-slate-600 max-w-xs truncate',
        render: (s) => (s.permissions || []).join(', '),
      },
      {
        key: 'active',
        header: 'Status',
        render: (s) => (
          <button
            type="button"
            onClick={() => upsertDocument('staff_accounts', s.id, { active: !s.active }, false)}
            className={`font-bold cursor-pointer ${
              s.active ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {s.active ? 'Active' : 'Disabled'}
          </button>
        ),
      },
      {
        key: 'actions',
        header: 'Action',
        headerClassName: 'text-right',
        cellClassName: 'text-right space-x-1 whitespace-nowrap',
        render: (s) => (
          <>
            {s.active && (
              <button
                type="button"
                onClick={() => onSwitchStaffSession(s)}
                className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-semibold cursor-pointer"
              >
                Use ID
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onShowConfirm({
                  title: `Delete Staff Account ${s.staffCode}?`,
                  description: `Revoke access for ${s.displayName}?`,
                  confirmLabel: 'Delete',
                  variant: 'danger',
                  onConfirm: () => removeDocument('staff_accounts', s.id),
                })
              }
              className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        ),
      },
    ],
    [onShowConfirm, onSwitchStaffSession, editingPwdId, editingPwdValue, revealedStaffIds]
  );

  return (
    <div className="space-y-4">
      {driveStatus && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{driveStatus}</span>
        </div>
      )}
      {driveError && (
        <div className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{driveError}</span>
        </div>
      )}

      {mode === 'backup' && (
        <div className="space-y-4">
          {/* One-Click Auto-Collect FoxPro (.DBF) & Bank PNB Excel Importer (Excluding Scrap) */}
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0F3D7A] to-[#1D4ED8] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FolderArchive className="w-5 h-5 text-amber-300 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold">
                    One-Click Auto-Collect FoxPro (.DBF) &amp; Bank PNB Excel Importer
                  </h3>
                  <p className="text-[11px] text-blue-100">
                    Maps HEAD, brkrmast, desmast, courvhl, drvrmast, courtran, Tax Inv, challant &amp; PNB Bank Excel (UPI/UTR/Cheque + 194C TDS) — strictly excludes scrap*.dbf
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={autoCollectFolderRef}
                  type="file"
                  multiple
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                  className="hidden"
                  onChange={(e) => {
                    void handleAutoCollectSelected(e.target.files);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={autoCollectFilesRef}
                  type="file"
                  multiple
                  accept=".dbf,.xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    void handleAutoCollectSelected(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={autoCollecting || autoCollectImporting}
                  onClick={() => autoCollectFolderRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <FolderArchive className="w-4 h-4" />
                  {autoCollecting ? 'Scanning...' : 'Auto-Collect Old Data (Select data Folder / Bank PNB Excel)'}
                </button>
                <button
                  type="button"
                  disabled={autoCollecting || autoCollectImporting}
                  onClick={() => autoCollectFilesRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Select Multiple .DBF / Excel Files
                </button>
              </div>
            </div>

            {/* One-Click Cleanup Bar for Already-Imported FoxPro / Party Master Records */}
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-700">
                <Users className="w-4 h-4 text-blue-700 shrink-0" />
                <span className="font-bold text-slate-900">Party Master Hygiene:</span>
                <span>
                  Customers:{' '}
                  <strong className="text-emerald-700 font-mono-num">
                    {
                      allData.parties.filter(
                        (p) =>
                          p.partyType === 'Customer' ||
                          p.partyType === 'Consignor' ||
                          p.partyType === 'Consignee'
                      ).length
                    }
                  </strong>
                  {' · '}Brokers:{' '}
                  <strong className="text-indigo-700 font-mono-num">
                    {allData.parties.filter((p) => p.partyType === 'Broker').length}
                  </strong>
                  {' · '}Vehicle Owners:{' '}
                  <strong className="text-amber-700 font-mono-num">
                    {allData.parties.filter((p) => p.partyType === 'TruckOwner').length}
                  </strong>
                </span>
                {partySeparationPreview.brokersSeparated +
                  partySeparationPreview.ownersSeparated +
                  partySeparationPreview.driversSeparated +
                  partySeparationPreview.duplicatesMerged >
                  0 && (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[11px]">
                    {partySeparationPreview.brokersSeparated +
                      partySeparationPreview.ownersSeparated +
                      partySeparationPreview.driversSeparated +
                      partySeparationPreview.duplicatesMerged}{' '}
                    misclassified FoxPro / Broker record(s) found
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={cleaningParties}
                onClick={handleSeparateBrokersFromCustomers}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {cleaningParties
                  ? 'Separating...'
                  : 'Clean / Separate Brokers from Billing Parties'}
              </button>
            </div>

            {autoCollectResult && (
              <div className="p-4 space-y-3 bg-blue-50/40 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">
                    Scan Preview ({autoCollectResult.processedFiles.length} data file(s) parsed for {activeFy})
                  </span>
                  {autoCollectResult.ignoredScrapFiles.length > 0 && (
                    <span className="px-2.5 py-1 rounded bg-red-100 text-red-800 font-bold text-[11px]">
                      Excluded Scrap: {autoCollectResult.ignoredScrapFiles.join(', ')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2">
                  {[
                    { label: 'Parties (HEAD)', val: autoCollectResult.parties.length },
                    { label: 'Brokers', val: autoCollectResult.brokersAddedCount },
                    { label: 'Destinations', val: autoCollectResult.destinations.length },
                    { label: 'Vehicles', val: autoCollectResult.vehicles.length },
                    { label: 'Drivers', val: autoCollectResult.drivers.length },
                    { label: 'CN / Bilty', val: autoCollectResult.consignments.length },
                    { label: 'Tax Invoices', val: autoCollectResult.invoices.length },
                    { label: 'Challans', val: autoCollectResult.lorryHires.length },
                    { label: 'PNB Receipts+TDS', val: autoCollectResult.bankReceipts.length },
                  ].map((box) => (
                    <div
                      key={box.label}
                      className="p-2 rounded-lg bg-white border border-slate-200 text-center"
                    >
                      <div className="text-[10px] font-semibold text-slate-500">{box.label}</div>
                      <div className="text-base font-extrabold font-mono-num text-blue-900">
                        {box.val}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-[11px] text-slate-600">
                  Parsed files:{' '}
                  <span className="font-mono-num text-slate-800">
                    {autoCollectResult.processedFiles.join(', ')}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={autoCollectImporting}
                    onClick={handleConfirmAutoCollectImport}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {autoCollectImporting ? 'Importing to ERP...' : 'Confirm & Import All Old Data'}
                  </button>
                  <button
                    type="button"
                    disabled={autoCollectImporting}
                    onClick={() => setAutoCollectResult(null)}
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel Preview
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Google Drive Cloud Backup &amp; Account Switcher (GZIP Compact)</h3>
                <p className="text-xs text-blue-100">
                  Connected Gmail: <span className="font-bold">{connectedEmail || 'Not Connected'}</span> ·{' '}
                  {driveAccessToken ? 'Drive OAuth Active' : 'Click Switch / Connect Gmail to grant Drive token'}
                </p>
              </div>
              <button
                type="button"
                onClick={onSwitchGmail}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white text-[#0D47A1] hover:bg-blue-50 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Switch / Add New Gmail ID
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="text-slate-700">
                  <span className="font-bold text-slate-900">OAuth Origin Status:</span>{' '}
                  Host <span className="font-mono-num font-bold text-blue-800">{oauthDomain.hostname}</span> · Target Production:{' '}
                  <span className="font-mono-num font-bold text-emerald-700">{VERCEL_APP_DOMAIN}</span>{' '}
                  ({oauthDomain.isAllowlistedHost ? 'Allowlist-Compatible' : 'Add to Firebase Authorized Domains'})
                </div>
                <button
                  type="button"
                  onClick={handleCopyVercelDomain}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-slate-100 font-bold text-slate-800 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  {copiedDomain ? 'Copied!' : 'Copy dolphin-road-carrier.vercel.app'}
                </button>
              </div>

              <div>
                <p className="font-bold text-slate-800 mb-2">
                  Dedicated Google Drive Folder Structure (inside DOLPHIN_ROAD_CARRIERS_MASTER · Keeps only 8 Essential Master Files Daily &amp; Cleans Subfolders)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                  {[
                    'LR Copy',
                    'Bills_Invoices',
                    'Quotations',
                    'POD_Scans',
                    'Declarations',
                    'Reports_Ledgers',
                    'Bank_Statements',
                  ].map((folder) => (
                    <div
                      key={folder}
                      className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-2 font-semibold text-slate-800"
                    >
                      <FolderOpen className="w-4 h-4 text-blue-700 shrink-0" />
                      <span className="truncate">{folder}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={busyDrive}
                  onClick={handleBackupToDrive}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer disabled:opacity-60"
                >
                  <CloudUpload className="w-4 h-4" />
                  Backup Compact Master_Backup_DRC.json.gz to Drive
                </button>
                <button
                  type="button"
                  disabled={busyDrive}
                  onClick={handleRestoreFromDrive}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-60"
                >
                  <CloudDownload className="w-4 h-4" />
                  Restore from Google Drive
                </button>
                <button
                  type="button"
                  disabled={busyDrive}
                  onClick={handleRunDailyDriveCleanup}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4" />
                  Run Daily 8-File Drive Cleanup
                </button>
                <button
                  type="button"
                  disabled={busyDrive}
                  onClick={handleListDriveFiles}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh Drive Files
                </button>
                <button
                  type="button"
                  onClick={handleDownloadLocalJson}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-semibold cursor-pointer"
                >
                  Export Local JSON
                </button>
              </div>

              {/* Isolated 5-File Business Backup & App Sandbox Vault */}
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-emerald-950 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-700" />
                      <span>
                        App-Only Sandbox Google Drive Vault (5 Isolated Business Files · {activeFy})
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-900 mt-0.5">
                      Strictly uses <code className="font-mono-num">drive.file</code> scope (zero access to device photos or personal Drive files). Includes inactive folder <strong className="font-mono-num">{INSTALLER_VAULT_FOLDER}</strong>.
                    </p>
                  </div>
                    <button
                      type="button"
                      disabled={busyDrive}
                      onClick={() => void handleUploadIsolated5Files()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      <CloudUpload className="w-4 h-4" />
                      Upload All 5 Isolated Drive Files
                    </button>
                  </div>

                  {/* Stage B: Email Lock, Hidden AppData Sandbox, No-Auto-Delete Shield, 2-Way Sync & 3-Page Blueprint PDF */}
                  <div className="p-3 rounded-lg bg-white border border-emerald-200 space-y-2.5 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="font-extrabold text-slate-900">
                          Isolated App Backup Drive:{' '}
                          <span className="font-mono-num text-blue-800">{BACKUP_ISOLATED_DRIVE_EMAIL}</span>{' '}
                          <span className="text-slate-400">|</span>{' '}
                          Official Party Email:{' '}
                          <span className="font-mono-num text-emerald-800">{OFFICIAL_PARTY_EMAIL}</span>
                        </div>
                        <div className="text-slate-600">
                          App-Only Scope: <code className="font-mono-num">drive.file</code> +{' '}
                          <code className="font-mono-num">{DRIVE_APPDATA_SCOPE}</code> ·{' '}
                          <strong className="text-emerald-700">
                            No-Auto-Delete Shield:{' '}
                            {hasLiveCompanyData({
                              parties: allData.parties.length,
                              consignments: allData.consignments.length,
                              invoices: allData.invoices.length,
                              lorryHires: allData.lorryHires.length,
                              transactions: allData.transactions.length,
                            })
                              ? 'LIVE COMPANY DATA PROTECTED'
                              : 'ACTIVE'}
                          </strong>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyDrive}
                          onClick={async () => {
                            setBusyDrive(true);
                            setDriveError(null);
                            try {
                              const syncRes = await forceTwoWaySyncAndMerge();
                              let appDataMsg = '';
                              if (driveAccessToken) {
                                await uploadAppDataJsonSnapshot({
                                  accessToken: driveAccessToken,
                                  fileName: 'DRC_AppData_State_Snapshot.json',
                                  payload: {
                                    syncedAt: new Date().toISOString(),
                                    fy: activeFy,
                                    counts: {
                                      parties: allData.parties.length,
                                      consignments: allData.consignments.length,
                                      invoices: allData.invoices.length,
                                      lorryHires: allData.lorryHires.length,
                                    },
                                  },
                                });
                                const hiddenList = await listAppDataBackupFiles(driveAccessToken);
                                appDataMsg = ` + synced hidden appDataFolder (${hiddenList.length} sandbox file(s)).`;
                              }
                              playVerifiedBeep();
                              setDriveStatus(
                                `2-Way Timestamp Sync Complete: Flushed ${syncRes.flushedQueue} offline write(s), merged ${syncRes.mergedCollections} collection(s), pushed ${syncRes.pushedLocalRecords} newer local edit(s)${appDataMsg}`
                              );
                            } catch (err) {
                              playAlertBeep();
                              setDriveError(err instanceof Error ? err.message : '2-Way Sync failed.');
                            } finally {
                              setBusyDrive(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-800 hover:bg-blue-900 text-white font-extrabold cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Force 2-Way Sync &amp; Merge
                        </button>
                        <button
                          type="button"
                          disabled={busyDrive}
                          onClick={async () => {
                            setBusyDrive(true);
                            setDriveError(null);
                            try {
                              const pdf = await generateAppFormatBlueprintPDF(compState, 'p');
                              if (onPreviewPdf) {
                                onPreviewPdf(pdf, 'Reports_Ledgers');
                              } else {
                                downloadPdfDirect(pdf);
                              }
                              if (driveAccessToken) {
                                await uploadBlueprintPdfToDrive(driveAccessToken, pdf.blob);
                                setDriveStatus(
                                  `3-Page DRC_APP_FORMAT_BLUEPRINT.pdf (${pdf.sizeKB} KB) uploaded to Reports_Ledgers & appDataFolder (${BACKUP_ISOLATED_DRIVE_EMAIL}).`
                                );
                              } else {
                                setDriveStatus(`Generated 3-Page DRC_APP_FORMAT_BLUEPRINT.pdf (${pdf.sizeKB} KB).`);
                              }
                              playVerifiedBeep();
                            } catch (err) {
                              playAlertBeep();
                              setDriveError(err instanceof Error ? err.message : 'Blueprint PDF failed.');
                            } finally {
                              setBusyDrive(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold cursor-pointer disabled:opacity-60"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          3-Page App Blueprint PDF &amp; Drive Sync
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[
                      { name: isolatedDriveNames.ftl, desc: 'FTL Business Data (LRs, Bills, Hire, Vouchers)' },
                      { name: isolatedDriveNames.logistics, desc: 'Logistics Business Data (Dockets, Manifests, Bills)' },
                      { name: isolatedDriveNames.ptl, desc: 'PTL Part-Load Data (Isolated)' },
                      { name: isolatedDriveNames.courier, desc: 'Courier & Parcel Data (Isolated)' },
                      { name: isolatedDriveNames.mastersVault, desc: 'All Masters, Parties, Fleet, Drivers & KYC Vault' },
                    ].map((item) => (
                      <div
                        key={item.name}
                        className="p-2.5 rounded-lg bg-white border border-emerald-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono-num font-bold text-slate-900 truncate">
                            {item.name}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
                        </div>
                        <button
                          type="button"
                          disabled={busyDrive}
                          onClick={() => void handleRestoreIsolatedFile(item.name)}
                          className="shrink-0 px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                    <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200 flex items-center gap-2">
                      <FolderArchive className="w-4 h-4 text-slate-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-mono-num font-bold text-slate-700 truncate">
                          {INSTALLER_VAULT_FOLDER}
                        </div>
                        <div className="text-[10px] text-slate-500">Inactive Installer Vault Folder</div>
                      </div>
                    </div>
                  </div>
                </div>
            </div>
          </div>

          {driveFiles.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
              <div className="bg-slate-800 text-white px-4 py-2 text-xs font-bold">
                Files in Google Drive ({driveFiles.length})
              </div>
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3">Folder</th>
                    <th className="py-2 px-3">File Name</th>
                    <th className="py-2 px-3">Size</th>
                    <th className="py-2 px-3">Modified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {driveFiles.map((f) => (
                    <tr key={f.id}>
                      <td className="py-2 px-3 font-semibold text-blue-800">{f.folderName}</td>
                      <td className="py-2 px-3 font-mono-num">{f.name}</td>
                      <td className="py-2 px-3 font-mono-num">
                        {f.size ? `${Math.max(1, Math.round(Number(f.size) / 1024))} KB` : '-'}
                      </td>
                      <td className="py-2 px-3 font-mono-num">
                        {f.modifiedTime ? f.modifiedTime.slice(0, 10) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mode === 'settings' && !isMasterAdmin && (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8 text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-extrabold text-slate-900">Master Admin Access Only</h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            System Settings, User Management, Stamp Upload, Security Auto-Lock, Bulk Import, and
            Bank Details are strictly restricted to Master Admin.
          </p>
        </div>
      )}

      {mode === 'settings' && isMasterAdmin && (
        <div className="space-y-4">
          {/* App Updates & 25-Year Durability Version Sync Engine */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <RefreshCw className={`w-4 h-4 text-emerald-400 ${versionInfo.checking ? 'animate-spin' : ''}`} />
                <span>App Updates, Silent Auto-Update &amp; Offline Durability Engine</span>
              </div>
              <span className="text-[11px] font-mono-num text-emerald-300 font-semibold">
                v{versionInfo.appVersion}
              </span>
            </div>
            <div className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="space-y-1">
                <p className="font-bold text-slate-900">
                  Live Version Sync Status: <span className="text-emerald-700">{versionInfo.message}</span>
                </p>
                <p className="text-slate-600">
                  PWA Service Worker (sw.js): <strong>autoUpdate (skipWaiting + clientsClaim + 15s Poll)</strong> &bull; Local
                  Storage: <strong>IndexedDB Multi-MB Mirror</strong> &bull; Server Sync: <strong>SSE Real-Time</strong>
                </p>
                {versionInfo.lastCheckedAt && (
                  <p className="text-[11px] text-slate-500 font-mono-num">
                    Last Checked: {new Date(versionInfo.lastCheckedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={versionInfo.checking}
                onClick={handleCheckForUpdates}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${versionInfo.checking ? 'animate-spin' : ''}`} />
                <span>{versionInfo.checking ? 'Checking...' : 'Check for Updates'}</span>
              </button>
            </div>
          </div>

          {/* Android APK & Windows EXE Installer Packaging Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Smartphone className="w-4 h-4 text-emerald-300" />
                <span>Android (.apk) &amp; Windows (.exe) App Installers</span>
              </div>
              <span className="text-[11px] text-blue-100 font-semibold">
                Official DRC Icon &amp; Silent Auto-Update Enabled
              </span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-700" />
                  <span>1. Instant Install on 50+ Android Phones &amp; Windows PCs</span>
                </p>
                <p className="text-slate-600 leading-relaxed">
                  <strong>Android (Chrome):</strong> Open the Shared App URL &rarr; tap{' '}
                  <strong>Install App</strong> (or Chrome Menu &#8942; &rarr; <strong>Install App</strong>) to
                  install with the DRC Dolphin Icon.
                  <br />
                  <strong>Windows PC (Chrome/Edge):</strong> Click <strong>Install App</strong> in the
                  top header to create a Desktop &amp; Start Menu shortcut running in standalone mode.
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <MonitorDown className="w-4 h-4 text-blue-700" />
                  <span>2. Generate Signed .APK &amp; Windows .EXE Package</span>
                </p>
                <p className="text-slate-600 leading-relaxed">
                  Because binary APK/EXE compilers require Android SDK / Windows NSIS outside the web
                  cloud sandbox, paste your live Shared App URL into{' '}
                  <a
                    href="https://www.pwabuilder.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 font-bold underline"
                  >
                    PWABuilder.com
                  </a>{' '}
                  to download signed Android <code className="font-mono-num">.apk</code> &amp; Windows
                  installer files automatically.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const url =
                        typeof window !== 'undefined' ? window.location.origin : '';
                      if (url && navigator.clipboard) {
                        navigator.clipboard.writeText(url);
                        setDriveStatus(`Copied App URL (${url}) — paste into PWABuilder.com to export .APK / Windows installer.`);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                  >
                    Copy App URL for PWABuilder
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2-Second Change Backup Email & Google Drive + Admin PIN Vault */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-800 to-teal-800 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <RefreshCw className="w-4 h-4 text-amber-300" />
                <span>Google Drive Backup Email &amp; Admin Security PIN Vault</span>
              </div>
              <span className="text-[11px] text-emerald-100">
                App-Only Sandbox (<code className="font-mono-num">drive.file</code>)
              </span>
            </div>
            <div className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="space-y-1">
                <p className="font-bold text-slate-900">
                  Active Backup Email:{' '}
                  <span className="text-blue-800 font-mono-num">
                    {connectedEmail || 'Not Connected'}
                  </span>
                </p>
                <p className="text-slate-600">
                  Switch Google Drive account in 2 seconds with Admin PIN verification. Only DRC sandbox backups are touched.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-700">Admin PIN:</span>
                  <input
                    type="password"
                    value={newAdminPinInput}
                    onChange={(e) => setNewAdminPinInput(e.target.value)}
                    className="w-20 px-2 py-1 rounded border border-slate-300 text-xs font-mono-num bg-white"
                    placeholder="1234"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNewAdminPin}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold cursor-pointer"
                  >
                    Save PIN
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDrivePinError(null);
                    setDrivePinInput('');
                    setDrivePinModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white font-extrabold cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Change Backup Email &amp; Google Drive
                </button>
              </div>
            </div>

            {drivePinModalOpen && (
              <form
                onSubmit={(e) => void handleVerifyDrivePinAndSwitch(e)}
                className="mx-4 mb-4 p-3.5 rounded-lg bg-amber-50 border border-amber-300 flex flex-wrap items-end justify-between gap-3 text-xs"
              >
                <div className="space-y-1 flex-1 min-w-[210px]">
                  <div className="font-extrabold text-amber-950 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-800" />
                    <span>Enter Admin Security PIN to Switch Google Drive Email</span>
                  </div>
                  <p className="text-[11px] text-amber-900">
                    Default Admin PIN is <strong className="font-mono-num">1234</strong> (unless customized above).
                  </p>
                  {drivePinError && (
                    <p className="text-[11px] font-bold text-red-700">{drivePinError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    autoFocus
                    required
                    value={drivePinInput}
                    onChange={(e) => setDrivePinInput(e.target.value)}
                    placeholder="Enter Admin PIN"
                    className="w-36 px-2.5 py-1.5 rounded border border-amber-400 bg-white font-mono-num"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                  >
                    Verify &amp; Switch Email
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrivePinModalOpen(false);
                      setDrivePinError(null);
                    }}
                    className="px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Master Admin Credentials Management (User Management) */}
          {isMasterAdmin && !activeStaffSession && (
            <form
              onSubmit={handleUpdateMasterAdmin}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="bg-gradient-to-r from-[#1E3A8A] to-[#0D47A1] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <KeyRound className="w-4 h-4 text-amber-300" />
                  <span>User Management · Master Admin User ID &amp; Password</span>
                </div>
                <span className="text-xs text-blue-100">
                  Active Admin ID: <strong className="font-mono-num text-white">{adminUserId}</strong>
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs items-end">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Current Admin Password
                  </label>
                  <input
                    type="password"
                    required
                    value={adminCurrentPwd}
                    onChange={(e) => setAdminCurrentPwd(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    New Master Admin User ID
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={adminNewId}
                    onChange={(e) => setAdminNewId(e.target.value)}
                    placeholder="admin"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    New Master Admin Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={adminNewPwd}
                    onChange={(e) => setAdminNewPwd(e.target.value)}
                    placeholder="Min 4 characters"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={adminSaving}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-60 h-[34px]"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{adminSaving ? 'Updating...' : 'Update Admin Credentials'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Staff Operator Session Switcher (50+ Branch Staff Logins) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  User Management · 1 Master Admin + 50+ Branch Staff Logins ({staffAccounts.length} Staff IDs)
                </span>
              </div>
              <div className="text-xs text-blue-100">
                Current Session:{' '}
                <span className="font-bold text-white">
                  {activeStaffSession
                    ? `${activeStaffSession.displayName} (${activeStaffSession.staffCode} · ${
                        activeStaffSession.branchCode || 'ALL'
                      })`
                    : isMasterAdmin
                    ? `Master Admin (${adminUserId} · All Branches)`
                    : 'Operator'}
                </span>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
              {/* Switch Operator Login */}
              <form
                onSubmit={handleStaffOperatorLogin}
                className="lg:col-span-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5"
              >
                <p className="font-bold text-slate-900">Quick Staff User ID Switcher</p>
                <input
                  type="text"
                  required
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="Staff User ID (e.g. DRC-STAFF-01)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                />
                <input
                  type="password"
                  required
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  placeholder="Password"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                  >
                    Switch to Staff ID
                  </button>
                  {activeStaffSession && isMasterAdmin && (
                    <button
                      type="button"
                      onClick={() => onSwitchStaffSession(null)}
                      className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 font-semibold cursor-pointer"
                    >
                      Restore Master Admin
                    </button>
                  )}
                </div>
                {loginMsg && <p className="text-[11px] font-semibold text-blue-800">{loginMsg}</p>}
              </form>

              {/* Create Unlimited Branch Staff User IDs & Passwords */}
              <form
                onSubmit={handleCreateStaff}
                className="lg:col-span-8 p-3.5 rounded-lg border border-slate-200 space-y-3"
              >
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-blue-700" />
                  <span>Create New Staff User ID &amp; Password (50+ Windows / Android Logins)</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                      Staff User ID
                    </label>
                    <input
                      type="text"
                      required
                      value={staffCode}
                      onChange={(e) => setStaffCode(e.target.value)}
                      placeholder="DRC-STF-03"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                      Staff Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      placeholder="Staff Full Name"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                      Assigned Branch
                    </label>
                    <SearchableSelect
                      ariaLabel="Assigned Branch"
                      value={staffBranch}
                      onChange={setStaffBranch}
                      options={BRANCH_OPTIONS.map((b) => ({
                        value: b,
                        label: `Branch: ${b}`,
                      }))}
                      triggerClassName="!py-1.5 !font-semibold"
                      searchPlaceholder="Search branch..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                      Role
                    </label>
                    <SearchableSelect
                      ariaLabel="Staff Role"
                      value={staffRole}
                      onChange={(val) => setStaffRole(val as StaffRole)}
                      options={['Accounts', 'Billing', 'Dispatch', 'Manager', 'Viewer']}
                      triggerClassName="!py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                      Login Password
                    </label>
                    <input
                      type="text"
                      required
                      minLength={4}
                      value={staffPin}
                      onChange={(e) => setStaffPin(e.target.value)}
                      placeholder="Password (4+ chars)"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={staffBankName}
                    onChange={(e) => setStaffBankName(e.target.value)}
                    placeholder="Staff Bank Name (Optional)"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                  <input
                    type="text"
                    value={staffBankAcc}
                    onChange={(e) => setStaffBankAcc(e.target.value)}
                    placeholder="Staff Bank A/C No (Auto-Fetch)"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                  <input
                    type="text"
                    value={staffBankIfsc}
                    onChange={(e) => setStaffBankIfsc(e.target.value.toUpperCase())}
                    placeholder="IFSC Code"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                  />
                  <input
                    type="text"
                    value={staffUpi}
                    onChange={(e) => setStaffUpi(e.target.value)}
                    placeholder="Staff UPI ID (e.g. name@upi)"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  {ALL_PERMISSIONS.map((perm) => (
                    <label key={perm.key} className="inline-flex items-center gap-1 font-medium">
                      <input
                        type="checkbox"
                        checked={staffPerms.includes(perm.key)}
                        onChange={(e) => {
                          setStaffPerms((prev) =>
                            e.target.checked
                              ? [...prev, perm.key]
                              : prev.filter((k) => k !== perm.key)
                          );
                        }}
                      />
                      {perm.label}
                    </label>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Create Staff User ID &amp; Password
                  </button>
                </div>
              </form>
            </div>

            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">
                Registered Staff IDs ({filteredStaff.length})
              </span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                  placeholder="Search Staff ID, name, branch..."
                  className="pl-8 pr-3 py-1 rounded border border-slate-300 bg-white text-xs w-56 focus:outline-none"
                />
              </div>
            </div>

            <PaginatedDataTable
              data={filteredStaff}
              columns={staffColumns}
              getRowId={(s) => s.id}
              defaultPageSize={50}
              emptyMessage="No staff accounts created yet."
            />
          </div>

          {/* Company & Bank Details Settings */}
          <form
            onSubmit={handleSaveCompanySettings}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-slate-800 text-white px-4 py-2.5 text-sm font-bold">
              Company Profile, Tax &amp; PNB Bank Configuration
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={compState.companyName}
                  onChange={(e) => setCompState({ ...compState, companyName: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  type="text"
                  value={compState.pan}
                  onChange={(e) => setCompState({ ...compState, pan: e.target.value.toUpperCase() })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <GstinInputField
                  label="Company GSTIN (15-Char Checksum)"
                  value={compState.gstin}
                  onChange={(val) => setCompState({ ...compState, gstin: val })}
                  compact
                  placeholder="19DOTPS3540M1ZZ"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Office Address</label>
                <input
                  type="text"
                  value={compState.address}
                  onChange={(e) => setCompState({ ...compState, address: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Active Default FY</label>
                <SearchableSelect
                  ariaLabel="Active Default FY"
                  value={compState.currentFy}
                  onChange={(val) => setCompState({ ...compState, currentFy: val })}
                  options={fyChoices}
                  triggerClassName="!py-1.5 !font-mono-num"
                  searchPlaceholder="Search FY..."
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Name</label>
                <input
                  type="text"
                  value={compState.bankName}
                  onChange={(e) => setCompState({ ...compState, bankName: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Account No</label>
                <input
                  type="text"
                  value={compState.accountNo}
                  onChange={(e) => setCompState({ ...compState, accountNo: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">IFSC &amp; SWIFT</label>
                <input
                  type="text"
                  value={`${compState.ifsc} / ${compState.swift}`}
                  onChange={(e) => {
                    const [ifsc, swift] = e.target.value.split('/').map((x) => x.trim());
                    setCompState({ ...compState, ifsc: ifsc || '', swift: swift || '' });
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>

              {/* Security & Idle Auto-Lock Timer + Future FY */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Auto-Lock Screen Timer (Idle Timeout)
                </label>
                <SearchableSelect
                  ariaLabel="Auto-Lock Screen Timer"
                  value={String(compState.autoLockMinutes ?? 5)}
                  onChange={(val) =>
                    setCompState({ ...compState, autoLockMinutes: Number(val) })
                  }
                  options={[
                    { value: '1', label: '1 Minute' },
                    { value: '2', label: '2 Minutes' },
                    { value: '5', label: '5 Minutes (Recommended Default)' },
                    { value: '10', label: '10 Minutes' },
                    { value: '15', label: '15 Minutes' },
                    { value: '0', label: 'Off (Disable Auto-Lock)' },
                  ]}
                  triggerClassName="!py-1.5 !font-semibold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Add Future Financial Year</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFyInput}
                    onChange={(e) => setNewFyInput(e.target.value)}
                    placeholder="FY 2027-28"
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={handleAddFutureFy}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add FY
                  </button>
                </div>
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={compState.lockSourceInspection !== false}
                    onChange={(e) =>
                      setCompState({ ...compState, lockSourceInspection: e.target.checked })
                    }
                  />
                  Protect Production Screen (Block Inspect / Right-Click outside inputs)
                </label>
              </div>

              {/* Multi-Bank Accounts (Unlimited 6+), Branch Offices, UPI QR & WhatsApp Cloud API */}
              <div className="md:col-span-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Landmark className="w-4 h-4 text-blue-700" />
                    <span>Company Bank Accounts &amp; UPI QR Codes ({(compState.bankAccounts || []).length} configured — Unlimited)</span>
                  </p>
                  <button
                    type="button"
                    onClick={handleAddBankAccount}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-[#0D47A1] hover:bg-[#0A3882] text-white font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Bank Account
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Primary Default UPI ID (for Tax Invoice BANK QR)</label>
                    <input
                      type="text"
                      value={compState.upiId || ''}
                      onChange={(e) => setCompState({ ...compState, upiId: e.target.value })}
                      placeholder="dolphinroadcarriers@pnb"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">WhatsApp Cloud Phone ID (Optional)</label>
                      <input
                        type="text"
                        value={compState.whatsappCloud?.phoneNumberId || ''}
                        onChange={(e) =>
                          setCompState({
                            ...compState,
                            whatsappCloud: {
                              ...(compState.whatsappCloud || { accessToken: '' }),
                              phoneNumberId: e.target.value,
                            },
                          })
                        }
                        placeholder="Optional Meta Phone ID"
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">WhatsApp Cloud Token</label>
                      <input
                        type="password"
                        value={compState.whatsappCloud?.accessToken || ''}
                        onChange={(e) =>
                          setCompState({
                            ...compState,
                            whatsappCloud: {
                              ...(compState.whatsappCloud || { phoneNumberId: '' }),
                              accessToken: e.target.value,
                            },
                          })
                        }
                        placeholder="Bearer Token"
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Optional Future Bank Connected API Key Box */}
                <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-blue-950">
                      Bank Connected API Key (Optional Auto-Feed Integration)
                    </span>
                    <label className="inline-flex items-center gap-1.5 font-semibold text-blue-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(compState.bankApiConfig?.enabled)}
                        onChange={(e) =>
                          setCompState({
                            ...compState,
                            bankApiConfig: {
                              ...(compState.bankApiConfig || {}),
                              enabled: e.target.checked,
                            },
                          })
                        }
                      />
                      Enable Bank API Webhook
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={compState.bankApiConfig?.providerName || ''}
                      onChange={(e) =>
                        setCompState({
                          ...compState,
                          bankApiConfig: {
                            ...(compState.bankApiConfig || {}),
                            providerName: e.target.value,
                          },
                        })
                      }
                      placeholder="Provider (PNB Corporate / Setu AA / HDFC)"
                      className="px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                    />
                    <input
                      type="text"
                      value={compState.bankApiConfig?.clientId || ''}
                      onChange={(e) =>
                        setCompState({
                          ...compState,
                          bankApiConfig: {
                            ...(compState.bankApiConfig || {}),
                            clientId: e.target.value,
                          },
                        })
                      }
                      placeholder="Client ID / Merchant ID"
                      className="px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                    />
                    <input
                      type="password"
                      value={compState.bankApiConfig?.apiKey || ''}
                      onChange={(e) =>
                        setCompState({
                          ...compState,
                          bankApiConfig: {
                            ...(compState.bankApiConfig || {}),
                            apiKey: e.target.value,
                          },
                        })
                      }
                      placeholder="Bank Connected API Key"
                      className="px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                    />
                    <input
                      type="password"
                      value={compState.bankApiConfig?.webhookSecret || ''}
                      onChange={(e) =>
                        setCompState({
                          ...compState,
                          bankApiConfig: {
                            ...(compState.bankApiConfig || {}),
                            webhookSecret: e.target.value,
                          },
                        })
                      }
                      placeholder="Webhook Signing Secret"
                      className="px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                    />
                  </div>
                </div>
                {(compState.bankAccounts || []).map((bank, idx) => (
                  <div key={bank.id} className="p-2.5 rounded-lg bg-white border border-slate-200 grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
                    <input
                      type="text"
                      value={bank.accountName}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          bankAccounts: (prev.bankAccounts || []).map((b, i) =>
                            i === idx ? { ...b, accountName: e.target.value } : b
                          ),
                        }))
                      }
                      placeholder="Account Name (e.g. PNB Main)"
                      className="px-2 py-1 rounded border border-slate-300 font-semibold"
                    />
                    <input
                      type="text"
                      value={bank.bankName}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          bankAccounts: (prev.bankAccounts || []).map((b, i) =>
                            i === idx ? { ...b, bankName: e.target.value } : b
                          ),
                        }))
                      }
                      placeholder="Bank Name"
                      className="px-2 py-1 rounded border border-slate-300"
                    />
                    <input
                      type="text"
                      value={bank.accountNo}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          bankAccounts: (prev.bankAccounts || []).map((b, i) =>
                            i === idx ? { ...b, accountNo: e.target.value } : b
                          ),
                        }))
                      }
                      placeholder="A/C Number"
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <input
                      type="text"
                      value={bank.ifsc}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          bankAccounts: (prev.bankAccounts || []).map((b, i) =>
                            i === idx ? { ...b, ifsc: e.target.value.toUpperCase() } : b
                          ),
                        }))
                      }
                      placeholder="IFSC Code"
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <input
                      type="text"
                      value={bank.upiId || ''}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          bankAccounts: (prev.bankAccounts || []).map((b, i) =>
                            i === idx ? { ...b, upiId: e.target.value } : b
                          ),
                        }))
                      }
                      placeholder="UPI ID for QR"
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setCompState((prev) => ({
                            ...prev,
                            bankAccounts: (prev.bankAccounts || []).map((b, i) => ({
                              ...b,
                              isDefault: i === idx,
                            })),
                          }))
                        }
                        className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer ${
                          bank.isDefault
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {bank.isDefault ? 'Default' : 'Set Default'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCompState((prev) => ({
                            ...prev,
                            bankAccounts: (prev.bankAccounts || []).filter((_, i) => i !== idx),
                          }))
                        }
                        className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        title="Remove bank"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-indigo-700" />
                    <span>Branch Office Parameters ({(compState.branches || []).length} configured)</span>
                  </p>
                  <button
                    type="button"
                    onClick={handleAddBranchOffice}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-indigo-700 hover:bg-indigo-800 text-white font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Branch Office
                  </button>
                </div>
                {(compState.branches || []).map((br, idx) => (
                  <div key={br.id} className="p-2 rounded bg-white border border-slate-200 grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
                    <input
                      type="text"
                      value={br.branchCode}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          branches: (prev.branches || []).map((x, i) =>
                            i === idx ? { ...x, branchCode: e.target.value.toUpperCase() } : x
                          ),
                        }))
                      }
                      placeholder="Code (KOL-HQ)"
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num font-bold"
                    />
                    <input
                      type="text"
                      value={br.branchName}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          branches: (prev.branches || []).map((x, i) =>
                            i === idx ? { ...x, branchName: e.target.value } : x
                          ),
                        }))
                      }
                      placeholder="Branch Office Name"
                      className="px-2 py-1 rounded border border-slate-300"
                    />
                    <GstinInputField
                      label="Branch GSTIN"
                      value={br.gstin || ''}
                      onChange={(val) =>
                        setCompState((prev) => ({
                          ...prev,
                          branches: (prev.branches || []).map((x, i) =>
                            i === idx ? { ...x, gstin: val } : x
                          ),
                        }))
                      }
                      compact
                      placeholder="Branch GSTIN (Optional)"
                    />
                    <input
                      type="text"
                      value={br.address}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          branches: (prev.branches || []).map((x, i) =>
                            i === idx ? { ...x, address: e.target.value } : x
                          ),
                        }))
                      }
                      placeholder="Branch Address"
                      className="px-2 py-1 rounded border border-slate-300"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={br.phone}
                        onChange={(e) =>
                          setCompState((prev) => ({
                            ...prev,
                            branches: (prev.branches || []).map((x, i) =>
                              i === idx ? { ...x, phone: e.target.value } : x
                            ),
                          }))
                        }
                        placeholder="Phone"
                        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-300 font-mono-num"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCompState((prev) => ({
                            ...prev,
                            branches: (prev.branches || []).filter((_, i) => i !== idx),
                          }))
                        }
                        className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        title="Remove branch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Company Stamp & Digital Signature Upload */}
              <div className="md:col-span-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ImagePlus className="w-4 h-4 text-blue-700" />
                    <span>Company Stamp &amp; Digital Signature (Bottom-Right of Bill, LR &amp; Quotation)</span>
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Section 194C Declarations strictly display only the Top-Left Triangular DRC Logo with NO stamp/signature at bottom.
                  </p>
                  <input
                    ref={stampInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      handleUploadStamp(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => stampInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload Custom Stamp / Signature
                    </button>
                    {compState.customStampDataUrl && (
                      <button
                        type="button"
                        onClick={() => setCompState({ ...compState, customStampDataUrl: '' })}
                        className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                      >
                        Reset to Official Stamp
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <img
                    src={
                      compState.customStampDataUrl ||
                      '/assets/aistudio/WhatsApp_Image_2026-11-16_at_11.55.22_PM__2__3293db0a.jpeg'
                    }
                    alt="Active Stamp Preview"
                    className="h-20 w-24 object-contain rounded border border-slate-300 bg-white p-1"
                  />
                </div>
              </div>

              {/* Proprietor PAN Card Photo Upload (Right Side of 194C Declaration) */}
              <div className="md:col-span-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ImagePlus className="w-4 h-4 text-emerald-700" />
                    <span>Proprietor PAN Card Photo (Auto-Attached on RIGHT of Sec 194C Declaration)</span>
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Optional override for Subhajit Saha PAN card image (compressed &lt;440KB). Uses built-in PAN scan if left empty.
                  </p>
                  <input
                    ref={panCardInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      handleUploadPanCard(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => panCardInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload PAN Card Photo
                    </button>
                    {compState.panCardPhotoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setCompState({ ...compState, panCardPhotoDataUrl: '' })}
                        className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                      >
                        Reset Default PAN Scan
                      </button>
                    )}
                  </div>
                </div>
                {compState.panCardPhotoDataUrl && (
                  <img
                    src={compState.panCardPhotoDataUrl}
                    alt="Proprietor PAN Preview"
                    className="h-20 w-32 object-contain rounded border border-slate-300 bg-white p-1"
                  />
                )}
              </div>

              {/* Optional Sacred Dashboard Header Photos (Bhole Baba & Khatu Shyam Ji) */}
              <div className="md:col-span-3 p-3.5 rounded-lg bg-amber-50/60 border border-amber-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>Dashboard Top-Center Sacred Blessing Photos (Bhole Baba &amp; Khatu Shyam Ji — Optional Custom Upload)</span>
                  </p>
                  <span className="text-[11px] font-semibold text-amber-900">
                    Shown side-by-side at top-center immediately after login
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Bhole Baba Slot */}
                  <div className="p-3 rounded-lg bg-white border border-amber-200 flex items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      <p className="font-bold text-slate-900">1. Bhole Baba (Lord Shiva — Blessing Hand)</p>
                      <input
                        ref={bholeBabaInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          handleUploadSacredPhoto('bholeBabaPhotoDataUrl', 'Bhole Baba', e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => bholeBabaInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload Custom Photo
                        </button>
                        {compState.bholeBabaPhotoDataUrl && (
                          <button
                            type="button"
                            onClick={() => void handleResetSacredPhoto('bholeBabaPhotoDataUrl', 'Bhole Baba')}
                            className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                          >
                            Reset Default
                          </button>
                        )}
                      </div>
                    </div>
                    <img
                      src={compState.bholeBabaPhotoDataUrl || DEFAULT_BHOLE_BABA_IMAGE}
                      alt="Bhole Baba Header Preview"
                      referrerPolicy="no-referrer"
                      className="h-16 w-16 object-cover rounded-lg border-2 border-amber-400 bg-amber-50 shrink-0"
                    />
                  </div>

                  {/* Khatu Shyam Ji Slot */}
                  <div className="p-3 rounded-lg bg-white border border-amber-200 flex items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      <p className="font-bold text-slate-900">2. Khatu Shyam Ji (Blessing Hand)</p>
                      <input
                        ref={khatuShyamInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          handleUploadSacredPhoto('khatuShyamPhotoDataUrl', 'Khatu Shyam Ji', e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => khatuShyamInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload Custom Photo
                        </button>
                        {compState.khatuShyamPhotoDataUrl && (
                          <button
                            type="button"
                            onClick={() => void handleResetSacredPhoto('khatuShyamPhotoDataUrl', 'Khatu Shyam Ji')}
                            className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                          >
                            Reset Default
                          </button>
                        )}
                      </div>
                    </div>
                    <img
                      src={compState.khatuShyamPhotoDataUrl || DEFAULT_KHATU_SHYAM_IMAGE}
                      alt="Khatu Shyam Ji Header Preview"
                      referrerPolicy="no-referrer"
                      className="h-16 w-16 object-cover rounded-lg border-2 border-amber-400 bg-amber-50 shrink-0"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-600">
                <Wrench className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  90-Day Auto-Fix &amp; Thermal Cooling:{' '}
                  <strong>
                    {getLast90DayMaintenanceTimestamp()
                      ? new Date(getLast90DayMaintenanceTimestamp()!).toLocaleDateString('en-IN')
                      : 'Ready'}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={handleRunManualAutoFix}
                  className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                >
                  Run System Auto-Fix &amp; Clean Now
                </button>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Save Company, Security, Banks &amp; Stamp Settings
              </button>
            </div>
          </form>

          {/* Dropdown Master (All-India Non-Liquid Goods, States/GST Codes, Districts, Modes & Credit Days) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <ListChecks className="w-4 h-4 text-amber-300" />
                <span>Dropdown Master (All-India Non-Liquid Goods, States, Districts &amp; Modes)</span>
              </div>
              <span className="text-[11px] text-blue-100">
                Live synced across all 50+ branches · Add, Edit, or Delete any option
              </span>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2.5">
                {[
                  { key: 'goodsTypes', label: 'Non-Liquid Goods' },
                  { key: 'states', label: 'States / Countries (GST)' },
                  { key: 'districts', label: 'Districts (by State)' },
                  { key: 'packageModes', label: 'Package Modes' },
                  { key: 'rateModes', label: 'Rate Modes' },
                  { key: 'deliveryPlaces', label: 'Delivery Places' },
                  { key: 'creditDays', label: 'Credit Day Presets' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setDdTab(tab.key as MasterTabKey);
                      setDdSearch('');
                      setDdEditingItem(null);
                    }}
                    className={`px-3 py-1.5 rounded-md font-bold cursor-pointer transition-colors ${
                      ddTab === tab.key
                        ? 'bg-[#0D47A1] text-white shadow-sm'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {ddTab === 'creditDays' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Add Credit Day Preset (Days)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={ddNewCreditDay}
                        onChange={(e) => setDdNewCreditDay(e.target.value)}
                        placeholder="e.g. 45"
                        className="w-32 px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCreditPreset}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Preset
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeCreditPresets.map((d) => (
                      <div
                        key={d}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-bold text-slate-800"
                      >
                        <span className="font-mono-num">{d} Days</span>
                        {activeCreditPresets.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCreditPreset(d)}
                            className="text-slate-400 hover:text-red-600 cursor-pointer"
                            title={`Remove ${d} Days`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    {ddTab === 'districts' && (
                      <div className="min-w-[210px]">
                        <label className="block font-semibold text-slate-700 mb-1">
                          Select State / UT / Country
                        </label>
                        <SearchableSelect
                          ariaLabel="Select State / UT / Country"
                          value={ddSelectedState}
                          onChange={setDdSelectedState}
                          options={effectiveStates}
                          triggerClassName="!py-1.5 !font-semibold"
                          searchPlaceholder="Search state A-Z..."
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-[200px]">
                      <label className="block font-semibold text-slate-700 mb-1">
                        Add New Entry
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={ddNewItem}
                          onChange={(e) => setDdNewItem(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleDdAddItem();
                            }
                          }}
                          placeholder="Type new option name & click Add..."
                          className="flex-1 px-2.5 py-1.5 rounded border border-slate-300"
                        />
                        <button
                          type="button"
                          onClick={handleDdAddItem}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Option
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        value={ddSearch}
                        onChange={(e) => setDdSearch(e.target.value)}
                        placeholder={`Filter ${activeDropdownItems.length} items...`}
                        className="pl-8 pr-3 py-1.5 rounded border border-slate-300 bg-white w-48"
                      />
                    </div>
                    {ddTab !== 'districts' && (
                      <button
                        type="button"
                        onClick={handleDdResetCategory}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
                      </button>
                    )}
                  </div>

                  <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {activeDropdownItems.length === 0 ? (
                      <div className="p-4 text-center text-slate-400">
                        No options match your search filter.
                      </div>
                    ) : (
                      activeDropdownItems.map((item) => {
                        const isEditing = ddEditingItem === item;
                        return (
                          <div
                            key={item}
                            className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-slate-50"
                          >
                            {isEditing ? (
                              <div className="flex-1 flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={ddEditingText}
                                  onChange={(e) => setDdEditingText(e.target.value)}
                                  className="flex-1 px-2 py-1 rounded border border-blue-400 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDdSaveEdit(item)}
                                  className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDdEditingItem(null);
                                    setDdEditingText('');
                                  }}
                                  className="px-2 py-1 rounded border border-slate-300 text-[11px] font-semibold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="font-medium text-slate-800 truncate">{item}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDdEditingItem(item);
                                      setDdEditingText(item);
                                    }}
                                    className="p-1 rounded text-blue-700 hover:bg-blue-50 cursor-pointer"
                                    title="Edit option"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDdDeleteItem(item)}
                                    className="p-1 rounded text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                    title="Delete option"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Smart Bulk Data Import (Excel / CSV) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-800 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FileSpreadsheet className="w-4 h-4" />
                <span>Smart Bulk Historical Data Import (.xlsx / .xls / .csv)</span>
              </div>
              <span className="text-[11px] text-emerald-100">
                Import FY 2025-26 or FY 2026-27 Parties, Trucks, LRs, Bills &amp; Ledgers
              </span>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[205px]">
                  <label className="block font-semibold text-slate-700 mb-1">Record Type</label>
                  <SearchableSelect
                    ariaLabel="Import Record Type"
                    value={importEntity}
                    onChange={(val) => {
                      setImportEntity(val as ImportEntityType);
                      setParsedImport(null);
                    }}
                    options={[
                      { value: 'consignments', label: 'Consignments / LRs' },
                      { value: 'transactions', label: 'Ledgers / Vouchers' },
                      { value: 'parties', label: 'Party / Customer Master' },
                      { value: 'invoices', label: 'Tax Invoices / Bills' },
                      { value: 'vehicles', label: 'Vehicle Fleet Master' },
                    ]}
                    triggerClassName="!py-1.5 !font-semibold"
                  />
                </div>
                <div className="min-w-[140px]">
                  <label className="block font-semibold text-slate-700 mb-1">Target Financial Year</label>
                  <SearchableSelect
                    ariaLabel="Import Target Financial Year"
                    value={importTargetFy}
                    onChange={setImportTargetFy}
                    options={fyChoices}
                    triggerClassName="!py-1.5 !font-mono-num !font-bold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => downloadSampleImportTemplate(importEntity)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Sample Template (.xlsx)
                </button>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    handleExcelFileSelected(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => excelInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Select Excel / CSV File
                </button>
              </div>

              {parsedImport && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      Ready to import {parsedImport.records.length} rows from "{parsedImport.fileName}" into{' '}
                      <span className="text-emerald-700">{importTargetFy}</span>
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setParsedImport(null)}
                        className="px-3 py-1 rounded border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={importing}
                        onClick={handleConfirmBulkImport}
                        className="px-4 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-60"
                      >
                        {importing ? 'Importing...' : `Import ${parsedImport.records.length} Records`}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded bg-white">
                    <table className="w-full text-[11px] text-left border-collapse">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          {parsedImport.previewHeaders.map((h) => (
                            <th key={h} className="px-2 py-1 border-b border-slate-200">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedImport.previewRows.map((row, idx) => (
                          <tr key={idx}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1 font-mono-num">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Closing-to-Opening Balance Carry Forward Engine */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1E3A8A] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <ArrowRightLeft className="w-4 h-4 text-amber-300" />
                <span>Closing-to-Opening Balance Carry Forward ({carrySourceFy} &rarr; {carryTargetFy})</span>
              </div>
              <span className="text-[11px] text-blue-100">
                Cash Closing: ₹{formatINR(closingPreview.cashClosing)} · PNB Bank Closing: ₹{formatINR(closingPreview.bankClosing)}
              </span>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[140px]">
                    <label className="block font-semibold text-slate-700 mb-1">From Source FY</label>
                    <SearchableSelect
                      ariaLabel="From Source FY"
                      value={carrySourceFy}
                      onChange={setCarrySourceFy}
                      options={fyChoices}
                      triggerClassName="!py-1.5 !font-mono-num !font-bold"
                    />
                  </div>
                  <div className="min-w-[180px]">
                    <label className="block font-semibold text-slate-700 mb-1">To Target FY (Opening Balance)</label>
                    <SearchableSelect
                      ariaLabel="To Target FY"
                      value={carryTargetFy}
                      onChange={setCarryTargetFy}
                      options={fyChoices}
                      triggerClassName="!py-1.5 !font-mono-num !font-bold"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCarryForwardBalances}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold cursor-pointer"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  Carry Forward Closing Balances to {carryTargetFy} Opening Balances
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      <th className="py-1.5 px-3">Account / Party Name</th>
                      <th className="py-1.5 px-3">Category</th>
                      <th className="py-1.5 px-3 text-right">Opening ({carrySourceFy})</th>
                      <th className="py-1.5 px-3 text-right">Debits</th>
                      <th className="py-1.5 px-3 text-right">Credits</th>
                      <th className="py-1.5 px-3 text-right">Closing ({carrySourceFy})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {closingPreview.rows.map((r) => (
                      <tr key={r.partyId}>
                        <td className="py-1.5 px-3 font-semibold">{r.partyName}</td>
                        <td className="py-1.5 px-3 text-slate-500">{r.partyType}</td>
                        <td className="py-1.5 px-3 text-right font-mono-num">
                          ₹{formatINR(r.openingBalance)} {r.openingType}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono-num">₹{formatINR(r.fyDebits)}</td>
                        <td className="py-1.5 px-3 text-right font-mono-num">₹{formatINR(r.fyCredits)}</td>
                        <td className="py-1.5 px-3 text-right font-mono-num font-bold text-blue-800">
                          ₹{formatINR(r.closingBalance)} {r.closingType}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const BackupSettingsModule = React.memo(BackupSettingsModuleInner);
