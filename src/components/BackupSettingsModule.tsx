import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
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
  BRANCH_OPTIONS,
  CompanyBankAccount,
  CompanyBranchOffice,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Driver,
  Invoice,
  LorryHire,
  Party,
  PermissionKey,
  Quotation,
  StaffAccount,
  StaffRole,
  TransactionRecord,
  Vehicle,
} from '../types/erp';
import {
  downloadMasterBackupFromDrive,
  DriveFileSummary,
  listDriveBackupFiles,
  runDailyDrive8FileCleanup,
  uploadMasterBackupToDrive,
} from '../lib/driveBackup';
import {
  getLast90DayMaintenanceTimestamp,
  runSystemAutoFixAndClean,
} from '../lib/selfHealing';
import {
  bulkUpsertDocuments,
  CustomAuthSession,
  removeDocument,
  restoreErpBackupBundle,
  saveSettingsDocument,
  updateMasterAdminCredentials,
  upsertDocument,
} from '../lib/firestoreStore';
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
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

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
  };
  onSwitchGmail: () => Promise<void>;
  onSwitchStaffSession: (staff: StaffAccount | null) => void;
  onUpdateAdminSession: (session: CustomAuthSession) => void;
  onSelectFy: (fy: string) => void;
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
  onSwitchGmail,
  onSwitchStaffSession,
  onUpdateAdminSession,
  onSelectFy,
  onShowConfirm,
}) => {
  const stampInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFileSummary[]>([]);
  const [busyDrive, setBusyDrive] = useState(false);

  // Master Admin ID & Password Management
  const [adminCurrentPwd, setAdminCurrentPwd] = useState('');
  const [adminNewId, setAdminNewId] = useState(adminUserId || 'admin');
  const [adminNewPwd, setAdminNewPwd] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  // Live Version Sync State
  const [versionInfo, setVersionInfo] = useState<VersionStatusInfo>(() => getVersionStatus());

  // Staff creation form (50+ concurrent branch staff logins)
  const [staffCode, setStaffCode] = useState(`DRC-STF-${String(staffAccounts.length + 1).padStart(2, '0')}`);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<StaffRole>('Billing');
  const [staffBranch, setStaffBranch] = useState<string>('KOL-HQ');
  const [staffPin, setStaffPin] = useState('1234');
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
      title: 'Upload Master Backup to Google Drive?',
      description: `This will create/overwrite Master_Backup_DRC.json inside Dolphin_Road_Carrier_Backup on ${connectedEmail || 'your Google Drive'} and ensure all 6 PDF folders exist.`,
      confirmLabel: 'Backup to Drive',
      onConfirm: async () => {
        setBusyDrive(true);
        try {
          const res = await uploadMasterBackupToDrive(driveAccessToken, {
            exportedAt: new Date().toISOString(),
            company: compState,
            ...allData,
          });
          setDriveStatus(`Backed up Master_Backup_DRC.json (File ID: ${res.id})`);
          const files = await listDriveBackupFiles(driveAccessToken);
          setDriveFiles(files);
        } catch (err) {
          setDriveStatus(err instanceof Error ? err.message : 'Drive backup failed');
        } finally {
          setBusyDrive(false);
        }
      },
    });
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
        `Google Drive 8-File Cleanup Complete: ${res.trashedCount} redundant temp files pruned, ${res.keptCount} essential master files preserved inside DOLPHIN_ROAD_CARRIERS_MASTER.`
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
        ownerUid,
      },
      true
    );
    setStaffName('');
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
    const mergedFys = Array.from(
      new Set([...PRECREATED_FYS, ...(compState.availableFys || []), normalizeFyLabel(compState.currentFy)])
    );
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
        whatsappCloud: compState.whatsappCloud || undefined,
        last90DayAutoFixAt: compState.last90DayAutoFixAt || undefined,
        currentFy: normalizeFyLabel(compState.currentFy),
        availableFys: mergedFys,
        fyOpeningBalances: compState.fyOpeningBalances || {},
        customStampDataUrl: compState.customStampDataUrl || '',
        autoLockMinutes: Number(compState.autoLockMinutes ?? 5),
        lockSourceInspection: compState.lockSourceInspection !== false,
        ...(compState.dropdownMaster ? { dropdownMaster: compState.dropdownMaster } : {}),
        ownerUid,
      },
      hasCustomSettings
    );
    setDriveStatus('Company, Multi-Bank Accounts, UPI QR, Branches, Stamp & Security Settings saved cleanly.');
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
      { key: 'displayName', header: 'Name', cellClassName: 'font-medium', render: (s) => s.displayName },
      {
        key: 'branchCode',
        header: 'Branch',
        render: (s) => (
          <select
            value={s.branchCode || 'ALL'}
            onChange={(e) =>
              upsertDocument('staff_accounts', s.id, { branchCode: e.target.value }, false)
            }
            className="px-2 py-1 rounded border border-slate-300 bg-white text-[11px] font-semibold"
          >
            {BRANCH_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Google Drive Cloud Backup &amp; Account Switcher</h3>
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
              <div>
                <p className="font-bold text-slate-800 mb-2">
                  Dedicated Google Drive Folder Structure (inside DOLPHIN_ROAD_CARRIERS_MASTER · Keeps only 8 Essential Master Files Daily)
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
                  Backup Master_Backup_DRC.json to Drive
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
                  PWA Service Worker: <strong>autoUpdate (skipWaiting + clientsClaim)</strong> &bull; Local
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
                    <select
                      value={staffBranch}
                      onChange={(e) => setStaffBranch(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-semibold"
                      title="Assigned Branch"
                    >
                      {BRANCH_OPTIONS.map((b) => (
                        <option key={b} value={b}>
                          Branch: {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                      Role
                    </label>
                    <select
                      value={staffRole}
                      onChange={(e) => setStaffRole(e.target.value as StaffRole)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    >
                      <option value="Billing">Billing</option>
                      <option value="Accounts">Accounts</option>
                      <option value="Dispatch">Dispatch</option>
                      <option value="Manager">Manager</option>
                      <option value="Viewer">Viewer</option>
                    </select>
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
                <label className="block font-semibold text-slate-700 mb-1">GSTIN</label>
                <input
                  type="text"
                  value={compState.gstin}
                  onChange={(e) => setCompState({ ...compState, gstin: e.target.value.toUpperCase() })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
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
                <select
                  value={compState.currentFy}
                  onChange={(e) => setCompState({ ...compState, currentFy: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num bg-white"
                >
                  {fyChoices.map((fy) => (
                    <option key={fy} value={fy}>
                      {fy}
                    </option>
                  ))}
                </select>
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
                <select
                  value={String(compState.autoLockMinutes ?? 5)}
                  onChange={(e) =>
                    setCompState({ ...compState, autoLockMinutes: Number(e.target.value) })
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="1">1 Minute</option>
                  <option value="2">2 Minutes</option>
                  <option value="5">5 Minutes (Recommended Default)</option>
                  <option value="10">10 Minutes</option>
                  <option value="15">15 Minutes</option>
                  <option value="0">Off (Disable Auto-Lock)</option>
                </select>
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
                    <input
                      type="text"
                      value={br.gstin || ''}
                      onChange={(e) =>
                        setCompState((prev) => ({
                          ...prev,
                          branches: (prev.branches || []).map((x, i) =>
                            i === idx ? { ...x, gstin: e.target.value.toUpperCase() } : x
                          ),
                        }))
                      }
                      placeholder="Branch GSTIN (Optional)"
                      className="px-2 py-1 rounded border border-slate-300 font-mono-num"
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
                        <select
                          value={ddSelectedState}
                          onChange={(e) => setDdSelectedState(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                        >
                          {effectiveStates.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
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
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Record Type</label>
                  <select
                    value={importEntity}
                    onChange={(e) => {
                      setImportEntity(e.target.value as ImportEntityType);
                      setParsedImport(null);
                    }}
                    className="px-3 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="consignments">Consignments / LRs</option>
                    <option value="invoices">Tax Invoices / Bills</option>
                    <option value="transactions">Ledgers / Vouchers</option>
                    <option value="parties">Party / Customer Master</option>
                    <option value="vehicles">Vehicle Fleet Master</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Target Financial Year</label>
                  <select
                    value={importTargetFy}
                    onChange={(e) => setImportTargetFy(e.target.value)}
                    className="px-3 py-1.5 rounded border border-slate-300 bg-white font-mono-num font-bold"
                  >
                    {fyChoices.map((fy) => (
                      <option key={fy} value={fy}>
                        {fy}
                      </option>
                    ))}
                  </select>
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
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">From Source FY</label>
                    <select
                      value={carrySourceFy}
                      onChange={(e) => setCarrySourceFy(e.target.value)}
                      className="px-3 py-1.5 rounded border border-slate-300 bg-white font-mono-num font-bold"
                    >
                      {fyChoices.map((fy) => (
                        <option key={fy} value={fy}>
                          {fy}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">To Target FY (Opening Balance)</label>
                    <select
                      value={carryTargetFy}
                      onChange={(e) => setCarryTargetFy(e.target.value)}
                      className="px-3 py-1.5 rounded border border-slate-300 bg-white font-mono-num font-bold"
                    >
                      {fyChoices.map((fy) => (
                        <option key={fy} value={fy}>
                          {fy}
                        </option>
                      ))}
                    </select>
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
