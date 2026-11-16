import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  MonitorDown,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  BRANCH_OPTIONS,
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
  uploadMasterBackupToDrive,
} from '../lib/driveBackup';
import {
  CustomAuthSession,
  removeDocument,
  restoreErpBackupBundle,
  saveSettingsDocument,
  updateMasterAdminCredentials,
  upsertDocument,
} from '../lib/firestoreStore';
import {
  checkForUpdatesNow,
  getVersionStatus,
  subscribeVersionStatus,
  VersionStatusInfo,
} from '../lib/versionSync';
import { makeSafeDocId, todayISO } from '../lib/formatters';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

interface BackupSettingsModuleProps {
  mode: 'backup' | 'settings';
  ownerUid: string;
  isMasterAdmin: boolean;
  adminUserId: string;
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
  onShowConfirm,
}) => {
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

  const handleListDriveFiles = async () => {
    if (!driveAccessToken) {
      onSwitchGmail();
      return;
    }
    setBusyDrive(true);
    try {
      const files = await listDriveBackupFiles(driveAccessToken);
      setDriveFiles(files);
      setDriveStatus(`Synced ${files.length} files across 6 Google Drive folders.`);
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
        currentFy: compState.currentFy,
        ownerUid,
      },
      hasCustomSettings
    );
    setDriveStatus('Company & Bank Settings saved to Firestore.');
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
                  Dedicated Google Drive Folder Structure (inside Dolphin_Road_Carrier_Backup)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  {[
                    'LR Copy',
                    'Bills_Invoices',
                    'Quotations',
                    'POD_Scans',
                    'Declarations',
                    'Reports_Ledgers',
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

      {mode === 'settings' && (
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
                <label className="block font-semibold text-slate-700 mb-1">Current Financial Year</label>
                <input
                  type="text"
                  value={compState.currentFy}
                  onChange={(e) => setCompState({ ...compState, currentFy: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
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
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Save Company Settings
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const BackupSettingsModule = React.memo(BackupSettingsModuleInner);
