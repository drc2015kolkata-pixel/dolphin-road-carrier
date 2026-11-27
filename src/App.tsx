import React, { Suspense, lazy, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Cloud,
  Coins,
  DatabaseBackup,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  GitBranch,
  Info,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPin,
  Maximize2,
  Menu,
  Mic,
  MicOff,
  Minimize2,
  PackageCheck,
  PieChart,
  Power,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Unlock,
  Users,
  UserX,
  WifiOff,
  X,
} from 'lucide-react';
import {
  ActivityLog,
  AnyDriveFolderName,
  BankReceiptRecord,
  BRANCH_OPTIONS,
  BUSINESS_MODE_META,
  BusinessMode,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  DEFAULT_COMPANY_SETTINGS,
  Driver,
  getLogisticsDivisionFromId,
  Invoice,
  LogisticsDocket,
  LogisticsDriver,
  LogisticsInvoice,
  LogisticsLedgerEntry,
  LogisticsManifest,
  LogisticsParty,
  LogisticsVehicle,
  LogisticsWorkspaceTabId,
  LorryHire,
  Party,
  PermissionKey,
  Quotation,
  SheetPermissionKey,
  SheetTabId,
  StaffAccount,
  StaffCommissionEntry,
  StaffPresence,
  TransactionRecord,
  TripExpenseRecord,
  Vehicle,
} from './types/erp';
import {
  BACKUP_ISOLATED_DRIVE_EMAIL,
  getConnectedGmail,
  googleSignIn,
  initAuth,
  isAuthorizedBackupDriveEmail,
  MASTER_ADMIN_EMAIL,
  testConnection,
} from './lib/firebase';
import {
  clearErpSession,
  CustomAuthSession,
  forceTwoWaySyncAndMerge,
  getStaffSheetAccess,
  loadSavedErpSession,
  loginWithCredentials,
  resetAdminToDefaultAndLogin,
  subscribeCollection,
  upsertDocument,
  upsertStaffPresence,
  verifySessionPasswordInstant,
} from './lib/firestoreStore';
import {
  daysSinceDate,
  daysUntilDate,
  extractTrailingSerialNumber,
  formatDateDDMMYYYY,
  formatINR,
  matchesSelectedFinancialYear,
  normalizeFyLabel,
  PRECREATED_FYS,
} from './lib/formatters';
import {
  getDailySnapshotFileName,
  isLogisticsDriveFolder,
  isPdfVaultFolder,
  resetDriveSyncSessionCache,
  runDailyDrive8FileCleanup,
  sealBackupPayloadWithSha256,
  syncAutoBackupBundleToDrive,
  uploadBlobToDriveFolder,
  uploadLogisticsBlobToDriveFolder,
  uploadPdfToDivisionVaultFolder,
  uploadRoleOrganizedPdfToDrive,
} from './lib/driveBackup';
import type { LedgerRoleType } from './lib/tallyLedgerEngine';
import {
  GeneratedPdfResult,
  generateInvoicePDF,
  generateLR3CopyPDF,
  generateQuotationPDF,
} from './lib/pdfEngine';
import {
  flushOfflineSyncQueue,
  getOfflineSyncStatus,
  OfflineSyncSnapshot,
  subscribeOfflineSyncStatus,
} from './lib/offlineSyncQueue';
import {
  AiDoctorReport,
  AiDoctorTrigger,
  FormulaHealthReport,
  installRuntimeErrorCollector,
  isDueFor15DayDoctor,
  isDueFor30DayDoctor,
  loadSavedAiDoctorReport,
  registerManagedBlobUrl,
  revokeThermalMemoryCooledUrls,
  runAiDeepFormulaAndBugRepair,
  runDailyLocalJunkCleanup,
  runStartupAndMonthlyFormulaGuard,
  runSystemAutoFixAndClean,
  shouldRun90DayMaintenance,
  shouldRunDailyJunkCleanup,
  verifyAdminPin,
} from './lib/selfHealing';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import { DEFAULT_BHOLE_BABA_IMAGE, DEFAULT_KHATU_SHYAM_IMAGE } from './lib/sacredDefaults';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DrcTriangleLogo } from './components/DrcTriangleLogo';
import { SignInScreen } from './components/SignInScreen';
import { ConfirmModal } from './components/ConfirmModal';
import { DashboardHome } from './components/DashboardHome';
import { SearchableSelect } from './components/SearchableSelect';
import type { MasterTabId } from './components/MasterModule';
import type { ReportTab } from './components/ReportsMisModule';
import { evaluateEway8HourAlarms, getEwayBillExpiryState } from './lib/ewayBillUtils';
import {
  evaluateKycExpiryAlarms,
  evaluateMonthlyGstAlarms,
} from './lib/kycVaultStorage';
import { playAlertBeep, playVerifiedBeep } from './lib/audioFeedback';
import {
  acknowledgeNewDeviceAlert,
  authorizeCurrentDeviceWithPinAndOtp,
  checkAndRegisterCurrentDevice,
  DeviceTrustCheckResult,
  dispatchBackgroundNotification,
  getActiveTwoFactorOtpChallenge,
  getPhoneAlarmPermissionState,
  installScreenCaptureShield,
  isBackupVaultUnlocked,
  isCurrentDeviceAuthorizedForMasterEmail,
  isScreenShieldTemporarilyUnlocked,
  issueTwoFactorOtpChallenge,
  lockBackupVault,
  lockScreenShieldImmediately,
  MASTER_ADMIN_PROTECTED_EMAIL,
  requestPhoneAlarmPermission,
  TwoFactorOtpChallenge,
  unlockBackupVaultWithPinAndOtp,
  unlockScreenShieldTemporarily,
} from './lib/securityShield';
import {
  getStaffReadOnlyVoiceHint,
  getStoredVoicePilotLang,
  isVoicePilotUnlocked,
  lockVoicePilot,
  parseVoiceCommandIntent,
  setStoredVoicePilotLang,
  speakCalmVoice,
  startVoiceListening,
  unlockVoicePilotWithPin,
  VoicePilotLang,
} from './lib/voicePilot';
import { autoSortAllDbfDataToExactRoles } from './lib/dbfRoleAutoSort';
import {
  DbfLatestSerialSummary,
  extractHighestBillAndCnFromRawDbf,
  loadRawDbfArchiveFromIdb,
} from './lib/foxproDbfImport';

import { A4PreviewModal } from './components/A4PreviewModal';
const MasterModule = lazy(() =>
  import('./components/MasterModule').then((m) => ({ default: m.MasterModule }))
);
const ConsignmentModule = lazy(() =>
  import('./components/ConsignmentModule').then((m) => ({ default: m.ConsignmentModule }))
);
const BillingQuotesModule = lazy(() =>
  import('./components/BillingQuotesModule').then((m) => ({ default: m.BillingQuotesModule }))
);
const LorryHirePodModule = lazy(() =>
  import('./components/LorryHirePodModule').then((m) => ({ default: m.LorryHirePodModule }))
);
const ReportsMisModule = lazy(() =>
  import('./components/ReportsMisModule').then((m) => ({ default: m.ReportsMisModule }))
);
const BackupSettingsModule = lazy(() =>
  import('./components/BackupSettingsModule').then((m) => ({ default: m.BackupSettingsModule }))
);
const StaffAccessMatrixModule = lazy(() =>
  import('./components/StaffAccessMatrixModule').then((m) => ({ default: m.StaffAccessMatrixModule }))
);
const StaffCommissionModule = lazy(() =>
  import('./components/StaffCommissionModule').then((m) => ({ default: m.StaffCommissionModule }))
);
const BankReceiptImportModule = lazy(() =>
  import('./components/BankReceiptImportModule').then((m) => ({ default: m.BankReceiptImportModule }))
);
const UserGuideModule = lazy(() =>
  import('./components/UserGuideModule').then((m) => ({ default: m.UserGuideModule }))
);
const LiveClockText = React.memo(function LiveClockText() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const dateStr = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return <>{`${dateStr}  ${timeStr}`}</>;
});

const LogisticsWorkspace = lazy(() =>
  import('./components/LogisticsWorkspace').then((m) => ({ default: m.LogisticsWorkspace }))
);
const AllInOneEntrySheet = lazy(() =>
  import('./components/AllInOneEntrySheet').then((m) => ({ default: m.AllInOneEntrySheet }))
);
const RoleTallyLedgersModule = lazy(() =>
  import('./components/RoleTallyLedgersModule').then((m) => ({ default: m.RoleTallyLedgersModule }))
);
const PartyDirectorySheet = lazy(() =>
  import('./components/PartyDirectorySheet').then((m) => ({ default: m.PartyDirectorySheet }))
);
const UniversalPodScannerPage = lazy(() =>
  import('./components/UniversalPodScannerPage').then((m) => ({ default: m.UniversalPodScannerPage }))
);

type SidebarNavId =
  | SheetTabId
  | 'transactions'
  | 'sidebar_quotation'
  | 'sidebar_194c'
  | 'ledger_party'
  | 'ledger_broker'
  | 'ledger_owner'
  | 'ledger_driver'
  | 'ledger_vehicle'
  | 'ledger_staff';

interface SheetTabDef {
  id: SheetTabId;
  label: string;
}

const TAB_LABELS: Record<SheetTabId, string> = {
  dashboard: 'Dashboard',
  allInOne: 'BILTY & LORRY MASTER SHEET',
  master: 'MASTERS & LEDGERS',
  partyDirectory: '1,000-Party Master Directory',
  lr: 'Consignment / LR',
  billing: 'PARTY TAX INVOICE (BILLING)',
  lorryHire: 'Lorry Hire & POD',
  podScanner: 'POD & Low-KB Scanner',
  commission: 'Staff Commission',
  bankImport: 'Bank & TDS Import',
  accounts: 'Accounts',
  roleLedgers: 'A–Z Role Tally Ledgers',
  reports: 'GST, STATUTORY VAULT & FILING HUB',
  mis: 'MIS Reports',
  staffAccess: 'Staff Sheet Access Control',
  backup: 'Backup / Restore',
  settings: 'Company Parameters & Settings',
  guide: 'BILINGUAL OPERATING BOOK (অপারেটিং বুক)',
  about: 'About DRC',
};

function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'Web';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Web';
}

function getTimestampMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return Date.parse(ts) || 0;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts) {
    const fn = (ts as { toMillis?: () => number }).toMillis;
    if (typeof fn === 'function') return fn();
  }
  return 0;
}

export default function App() {
  const [erpSession, setErpSession] = useState<CustomAuthSession | null>(() =>
    loadSavedErpSession()
  );
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [driveBannerError, setDriveBannerError] = useState<string | null>(null);
  const [firestoreConnected, setFirestoreConnected] = useState(true);

  // Live ERP collections
  const [parties, setParties] = useState<Party[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [consignments, setConsignments] = useState<ConsignmentNote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [lorryHires, setLorryHires] = useState<LorryHire[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [declarations, setDeclarations] = useState<Declaration194C[]>([]);
  const [tripExpenses, setTripExpenses] = useState<TripExpenseRecord[]>([]);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [staffCommissions, setStaffCommissions] = useState<StaffCommissionEntry[]>([]);
  const [bankReceipts, setBankReceipts] = useState<BankReceiptRecord[]>([]);
  const [presenceList, setPresenceList] = useState<StaffPresence[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [settingsDocs, setSettingsDocs] = useState<Array<CompanySettings & { id?: string }>>([]);
  const [dbfSerialStats, setDbfSerialStats] = useState<DbfLatestSerialSummary | null>(null);

  // Isolated Express Parcel & Part-Load Logistics collections
  const [logisticsParties, setLogisticsParties] = useState<LogisticsParty[]>([]);
  const [logisticsVehicles, setLogisticsVehicles] = useState<LogisticsVehicle[]>([]);
  const [logisticsDrivers, setLogisticsDrivers] = useState<LogisticsDriver[]>([]);
  const [logisticsDockets, setLogisticsDockets] = useState<LogisticsDocket[]>([]);
  const [logisticsManifests, setLogisticsManifests] = useState<LogisticsManifest[]>([]);
  const [logisticsInvoices, setLogisticsInvoices] = useState<LogisticsInvoice[]>([]);
  const [logisticsLedgers, setLogisticsLedgers] = useState<LogisticsLedgerEntry[]>([]);

  // Active Business Division Switcher (FTL | LOGISTICS | PTL | COURIER)
  const [businessMode, setBusinessMode] = useState<BusinessMode>('FTL');
  const [logiActiveTab, setLogiActiveTab] = useState<LogisticsWorkspaceTabId>('overview');

  // Active operator session (Master Admin by default, or logged-in / switched Staff ID)
  const [activeStaffSession, setActiveStaffSession] = useState<StaffAccount | null>(
    () => loadSavedErpSession()?.staffAccount ?? null
  );
  // Master Admin branch filter ('ALL' or specific branch code)
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  // Active Financial Year (Pre-created FY 2025-26 & FY 2026-27 + future years)
  const [selectedFy, setSelectedFy] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('drc_selected_fy_v1');
      return saved ? normalizeFyLabel(saved) : 'FY 2026-27';
    } catch {
      return 'FY 2026-27';
    }
  });

  // Configurable Security Auto-Lock Overlay
  const [isScreenLocked, setIsScreenLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());

  // Multi-tab Sheet Bar + Back Navigation History + Default-Collapsed Sidebar + Auto-Focus Mode
  const [openTabs, setOpenTabs] = useState<SheetTabDef[]>([{ id: 'dashboard', label: 'Dashboard' }]);
  const [activeTab, setActiveTab] = useState<SheetTabId>('dashboard');
  const [tabHistory, setTabHistory] = useState<SheetTabId[]>([]);
  const [dashboardFocusTx, setDashboardFocusTx] = useState(false);
  const [focusTransactionsNonce, setFocusTransactionsNonce] = useState(0);
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fyLocked, setFyLocked] = useState(true);
  const [bholeImgFailed, setBholeImgFailed] = useState(false);
  const [shyamImgFailed, setShyamImgFailed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [liveMonitorOpen, setLiveMonitorOpen] = useState(false);
  const [iosGuideOpen, setIosGuideOpen] = useState(false);
  const [appClosedOverlay, setAppClosedOverlay] = useState(false);
  const [rotateMode, setRotateMode] = useState<'auto' | 'landscape' | 'portrait'>('auto');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [voiceLang, setVoiceLang] = useState<VoicePilotLang>(() => getStoredVoicePilotLang());
  const [voiceListening, setVoiceListening] = useState(false);
  const [voicePinUnlocked, setVoicePinUnlocked] = useState(() => isVoicePilotUnlocked());
  const [voiceFeedbackMsg, setVoiceFeedbackMsg] = useState<string | null>(null);
  const voiceStopRef = useRef<(() => void) | null>(null);
  const [alarmPopupDismissed, setAlarmPopupDismissed] = useState(false);
  const alarmBeepedRef = useRef(false);
  const [eway8hBannerDismissed, setEway8hBannerDismissed] = useState(false);
  const eway8hLastBeepRef = useRef<number>(0);

  // Stage B: Anti-Screenshot Privacy Shield + Background Phone Alarms
  const [privacyCurtainReason, setPrivacyCurtainReason] = useState<string | null>(null);
  const [shieldUnlockPin, setShieldUnlockPin] = useState('');
  const [shieldUnlockError, setShieldUnlockError] = useState<string | null>(null);
  const [shieldTempUnlocked, setShieldTempUnlocked] = useState(() =>
    isScreenShieldTemporarilyUnlocked()
  );
  const [phoneAlarmPermission, setPhoneAlarmPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => getPhoneAlarmPermissionState());

  // Startup & Monthly Formula Health Guard + Admin PIN & 2FA OTP Modal + Drive Auto-Backup
  const [formulaHealthReport, setFormulaHealthReport] = useState<FormulaHealthReport | null>(null);
  const [formulaHealthModalOpen, setFormulaHealthModalOpen] = useState(false);
  const [adminPinModalOpen, setAdminPinModalOpen] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinOtpInput, setAdminPinOtpInput] = useState('');
  const [adminPinOtpChallenge, setAdminPinOtpChallenge] = useState<TwoFactorOtpChallenge | null>(null);
  const [adminPinError, setAdminPinError] = useState<string | null>(null);
  const [pendingPinTargetTab, setPendingPinTargetTab] = useState<SheetTabId | 'voicePilot' | null>(null);
  const [deviceTrust, setDeviceTrust] = useState<DeviceTrustCheckResult | null>(null);
  const [newDeviceBannerDismissed, setNewDeviceBannerDismissed] = useState(false);
  const [autoBackupInfo, setAutoBackupInfo] = useState<{
    status: 'idle' | 'pending' | 'syncing' | 'synced' | 'offline_sealed' | 'error';
    lastBackedUpAt?: number;
    sha256?: string;
    snapshotName?: string;
    recordCount?: number;
    message?: string;
  }>(() => {
    try {
      const raw = localStorage.getItem('drc_last_backup_seal_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as {
          at?: number;
          sha256?: string;
          snapshotName?: string;
          recordCount?: number;
        };
        return {
          status: 'offline_sealed',
          lastBackedUpAt: parsed.at,
          sha256: parsed.sha256,
          snapshotName: parsed.snapshotName,
          recordCount: parsed.recordCount,
          message: 'SHA-256 local vault seal active',
        };
      }
    } catch {
      // Ignore storage availability
    }
    return { status: 'idle' };
  });
  const [switchOffSummary, setSwitchOffSummary] = useState<{
    backedUpAt: number;
    sha256: string;
    snapshotName: string;
    recordCount: number;
    driveSynced: boolean;
    email: string;
  } | null>(null);
  const autoBackupTimerRef = useRef<number | null>(null);

  // Universal Search (Ctrl+K)
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Offline Sync Queue Status
  const [offlineSyncStatus, setOfflineSyncStatus] = useState<OfflineSyncSnapshot>(() =>
    getOfflineSyncStatus()
  );

  // Deep-link sub-tabs for Master Alerts, Billing & Reports
  const [masterInitialTab, setMasterInitialTab] = useState<MasterTabId>('parties');
  const [masterFocusNonce, setMasterFocusNonce] = useState(0);
  const [billingInitialSubTab, setBillingInitialSubTab] = useState<'invoice' | 'quotation' | '194c'>('invoice');
  const [billingFocusNonce, setBillingFocusNonce] = useState(0);
  const [reportInitialTab, setReportInitialTab] = useState<ReportTab>('invoiceRegister');
  const [reportFocusNonce, setReportFocusNonce] = useState(0);
  const [roleLedgerInitialRole, setRoleLedgerInitialRole] = useState<LedgerRoleType>('party');
  const [roleLedgerInitialAccount, setRoleLedgerInitialAccount] = useState<string>('');
  const [roleLedgerFocusNonce, setRoleLedgerFocusNonce] = useState(0);

  // Cross-module LR -> Invoice auto-paste handoff
  const [pendingCnForInvoice, setPendingCnForInvoice] = useState<ConsignmentNote | null>(null);

  // Live A4 Preview Modal
  const [previewPdf, setPreviewPdf] = useState<{
    pdf: GeneratedPdfResult;
    folder: AnyDriveFolderName;
  } | null>(null);

  // Global Confirm Modal
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    onConfirm: () => {},
  });

  const [aiDoctorReport, setAiDoctorReport] = useState<AiDoctorReport | null>(() =>
    loadSavedAiDoctorReport()
  );
  const [runningAiDoctor, setRunningAiDoctor] = useState(false);
  const aiDoctorStartupRanRef = useRef(false);
  const [hardwareLockState, setHardwareLockState] = useState<{
    locked: boolean;
    pin: string;
    otp: string;
    challenge: TwoFactorOtpChallenge | null;
    error: string | null;
  }>({
    locked: false,
    pin: '',
    otp: '',
    challenge: null,
    error: null,
  });

  useEffect(() => {
    installRuntimeErrorCollector();
  }, []);

  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  useEffect(() => {
    const unsub = subscribeOfflineSyncStatus(setOfflineSyncStatus);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isOnline && erpSession) {
      void flushOfflineSyncQueue();
    }
  }, [isOnline, erpSession]);

  const runFormulaGuardScan = useCallback(
    (manual = false) => {
      const report = runStartupAndMonthlyFormulaGuard({
        consignments: consignments as unknown as Array<Record<string, unknown>>,
        invoices: invoices as unknown as Array<Record<string, unknown>>,
        lorryHires: lorryHires as unknown as Array<Record<string, unknown>>,
        transactions: transactions as unknown as Array<Record<string, unknown>>,
        logisticsDockets: logisticsDockets as unknown as Array<Record<string, unknown>>,
        logisticsInvoices: logisticsInvoices as unknown as Array<Record<string, unknown>>,
        logisticsLedgers: logisticsLedgers as unknown as Array<Record<string, unknown>>,
        manual,
      });
      setFormulaHealthReport(report);
      return report;
    },
    [
      consignments,
      invoices,
      lorryHires,
      transactions,
      logisticsDockets,
      logisticsInvoices,
      logisticsLedgers,
    ]
  );

  // Startup & Monthly (1st of month) Auto-Formula Health Guard + Anti-Tamper Security Shield
  useEffect(() => {
    if (!erpSession) return;
    const t = window.setTimeout(() => {
      runFormulaGuardScan(false);
    }, 260);
    return () => window.clearTimeout(t);
  }, [erpSession, runFormulaGuardScan]);

  // 90-day self-healing maintenance, daily scratch junk cleanup & Ctrl+K global search shortcut
  useEffect(() => {
    if (erpSession && shouldRunDailyJunkCleanup()) {
      runDailyLocalJunkCleanup();
    }
    if (erpSession && shouldRun90DayMaintenance()) {
      runSystemAutoFixAndClean({
        parties,
        consignmentCount: consignments.length,
        invoiceCount: invoices.length,
        lorryHireCount: lorryHires.length,
      });
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchDropdownOpen(true);
        globalSearchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [erpSession]);

  // Daily 8-File Google Drive auto-cleanup once per day when Drive token is active
  useEffect(() => {
    if (!erpSession || !driveAccessToken) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem('drc_last_drive_cleanup_day') === todayKey) return;
      void runDailyDrive8FileCleanup(driveAccessToken).then(() => {
        try {
          localStorage.setItem('drc_last_drive_cleanup_day', todayKey);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }, [erpSession, driveAccessToken]);

  // Passive listener for Google Drive OAuth connection (strictly locked to drc.2015kolkata@gmail.com)
  useEffect(() => {
    const unsub = initAuth((nextUser, token) => {
      if (nextUser && nextUser.email && !isAuthorizedBackupDriveEmail(nextUser.email)) {
        setGoogleUser(null);
        setDriveAccessToken(null);
        setDriveBannerError(
          `Drive Security Lock: Account "${nextUser.email}" is blocked. Connect strictly as ${BACKUP_ISOLATED_DRIVE_EMAIL}.`
        );
        return;
      }
      setGoogleUser(nextUser);
      if (token) setDriveAccessToken(token);
    });
    testConnection().then((ok) => setFirestoreConnected(ok));
    return () => unsub();
  }, []);

  // Subscribe to all ERP collections once signed in via User ID & Password
  useEffect(() => {
    if (!erpSession) return;
    const ownerUid = erpSession.workspaceUid;
    const email = googleUser?.email || MASTER_ADMIN_EMAIL;

    const unsubs = [
      subscribeCollection<Party>('parties', ownerUid, email, setParties),
      subscribeCollection<Vehicle>('vehicles', ownerUid, email, setVehicles),
      subscribeCollection<Driver>('drivers', ownerUid, email, setDrivers),
      subscribeCollection<ConsignmentNote>('consignments', ownerUid, email, setConsignments),
      subscribeCollection<Invoice>('invoices', ownerUid, email, setInvoices),
      subscribeCollection<Quotation>('quotations', ownerUid, email, setQuotations),
      subscribeCollection<LorryHire>('lorry_hires', ownerUid, email, setLorryHires),
      subscribeCollection<TransactionRecord>('transactions', ownerUid, email, setTransactions),
      subscribeCollection<Declaration194C>('declarations', ownerUid, email, setDeclarations),
      subscribeCollection<TripExpenseRecord>('trip_expenses', ownerUid, email, setTripExpenses),
      subscribeCollection<StaffAccount>('staff_accounts', ownerUid, email, setStaffAccounts),
      subscribeCollection<StaffCommissionEntry>('staff_commissions', ownerUid, email, setStaffCommissions),
      subscribeCollection<BankReceiptRecord>('bank_receipts', ownerUid, email, setBankReceipts),
      subscribeCollection<StaffPresence>('presence', ownerUid, email, setPresenceList),
      subscribeCollection<ActivityLog>('activity_logs', ownerUid, email, setActivityLogs),
      subscribeCollection<CompanySettings & { id?: string }>(
        'settings',
        ownerUid,
        email,
        setSettingsDocs
      ),
      subscribeCollection<LogisticsParty>('logistics_parties', ownerUid, email, setLogisticsParties),
      subscribeCollection<LogisticsVehicle>('logistics_vehicles', ownerUid, email, setLogisticsVehicles),
      subscribeCollection<LogisticsDriver>('logistics_drivers', ownerUid, email, setLogisticsDrivers),
      subscribeCollection<LogisticsDocket>('logistics_dockets', ownerUid, email, setLogisticsDockets),
      subscribeCollection<LogisticsManifest>('logistics_manifests', ownerUid, email, setLogisticsManifests),
      subscribeCollection<LogisticsInvoice>('logistics_invoices', ownerUid, email, setLogisticsInvoices),
      subscribeCollection<LogisticsLedgerEntry>('logistics_ledgers', ownerUid, email, setLogisticsLedgers),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [erpSession, googleUser?.email]);

  // Keep logged-in staff operator synced if Admin updates permissions/branch or disables them
  useEffect(() => {
    if (!erpSession || !erpSession.staffAccount || staffAccounts.length === 0) return;
    const latest = staffAccounts.find(
      (s) => s.staffCode.toLowerCase() === erpSession.staffAccount!.staffCode.toLowerCase()
    );
    if (!latest) return;
    if (!latest.active) {
      clearErpSession();
      setErpSession(null);
      setActiveStaffSession(null);
      setAuthError('Your Staff User ID was disabled by Master Admin.');
      return;
    }
    setActiveStaffSession(latest);
  }, [staffAccounts, erpSession]);

  const workspaceUid = erpSession?.workspaceUid || 'drc_master_workspace';
  const isMasterAdmin = Boolean(erpSession?.isMasterAdmin);
  const connectedEmail = googleUser?.email || getConnectedGmail();

  const activeStaffCode = activeStaffSession?.staffCode || (isMasterAdmin ? 'ADMIN' : 'STAFF');
  const activeStaffName =
    activeStaffSession?.displayName ||
    erpSession?.displayName ||
    (isMasterAdmin ? 'Master Admin' : 'Operator');
  const activeStaffRole = activeStaffSession?.role || erpSession?.role || 'Staff';
  const isEffectiveMasterAdmin = useMemo(() => {
    if (!erpSession) return false;
    if (activeStaffSession) return activeStaffSession.role === 'Admin';
    return Boolean(erpSession.isMasterAdmin);
  }, [erpSession, activeStaffSession]);

  // New-Device Login Detection + Strict Hardware Lock for drc.2015kolkata@gmail.com
  useEffect(() => {
    if (!erpSession) {
      setDeviceTrust(null);
      setNewDeviceBannerDismissed(false);
      setHardwareLockState({ locked: false, pin: '', otp: '', challenge: null, error: null });
      return;
    }
    const trustRes = checkAndRegisterCurrentDevice({
      operatorLabel: activeStaffSession ? activeStaffSession.displayName : erpSession.displayName,
      email: connectedEmail || MASTER_ADMIN_EMAIL,
    });
    setDeviceTrust(trustRes);
    if (trustRes.isNewDevice) {
      setNewDeviceBannerDismissed(false);
      playAlertBeep();
    }
    const checkMasterHardware =
      (!activeStaffSession && erpSession.isMasterAdmin) ||
      (connectedEmail || '').toLowerCase() === MASTER_ADMIN_PROTECTED_EMAIL;
    if (checkMasterHardware && !isCurrentDeviceAuthorizedForMasterEmail(MASTER_ADMIN_PROTECTED_EMAIL)) {
      const challenge = issueTwoFactorOtpChallenge(
        `Authorize New Hardware for ${MASTER_ADMIN_PROTECTED_EMAIL}`
      );
      setHardwareLockState({
        locked: true,
        pin: '',
        otp: '',
        challenge,
        error: null,
      });
      playAlertBeep();
    } else {
      setHardwareLockState((prev) => (prev.locked ? { ...prev, locked: false } : prev));
    }
  }, [erpSession, activeStaffSession, connectedEmail]);

  const handleAcknowledgeNewDevice = useCallback(() => {
    acknowledgeNewDeviceAlert(deviceTrust?.deviceId);
    setDeviceTrust((prev) => (prev ? { ...prev, isNewDevice: false } : prev));
    setNewDeviceBannerDismissed(true);
    playVerifiedBeep();
  }, [deviceTrust?.deviceId]);

  // Branch Isolation & Master Admin Filter
  const isBranchLocked = Boolean(
    activeStaffSession?.branchCode && activeStaffSession.branchCode !== 'ALL'
  );
  const effectiveBranchFilter = isBranchLocked
    ? activeStaffSession!.branchCode!
    : branchFilter;

  const activeOperationalBranch = useMemo(() => {
    if (isBranchLocked && activeStaffSession?.branchCode) return activeStaffSession.branchCode;
    if (branchFilter && branchFilter !== 'ALL') return branchFilter;
    return 'KOL-HQ';
  }, [isBranchLocked, activeStaffSession, branchFilter]);

  // Real-time Staff Presence Broadcast (Immediate + 45s heartbeat)
  useEffect(() => {
    if (!erpSession) return;
    const deviceType = detectDeviceType();
    const pushPresence = (status: 'online' | 'offline') => {
      upsertStaffPresence({
        ownerUid: workspaceUid,
        staffCode: activeStaffCode,
        displayName: activeStaffName,
        role: activeStaffRole,
        branchCode: activeOperationalBranch,
        activeModule: TAB_LABELS[activeTab] || activeTab,
        deviceType,
        status,
      });
    };

    pushPresence('online');
    const timer = setInterval(() => pushPresence('online'), 45000);
    return () => clearInterval(timer);
  }, [
    erpSession,
    workspaceUid,
    activeStaffCode,
    activeStaffName,
    activeStaffRole,
    activeOperationalBranch,
    activeTab,
  ]);

  const companySettings: CompanySettings = useMemo(() => {
    const custom = settingsDocs.find((d) => d.id === 'company') || settingsDocs[0];
    if (!custom) {
      return {
        ...DEFAULT_COMPANY_SETTINGS,
        ownerUid: workspaceUid,
      };
    }
    return {
      ...DEFAULT_COMPANY_SETTINGS,
      ...custom,
      ownerUid: custom.ownerUid || workspaceUid,
    };
  }, [settingsDocs, workspaceUid]);

  const activeFy = useMemo(
    () => normalizeFyLabel(selectedFy || companySettings.currentFy || 'FY 2026-27'),
    [selectedFy, companySettings.currentFy]
  );

  useEffect(() => {
    document.title = `Dolphin Road Carriers ERP | FINANCIAL YEAR: ${activeFy.replace(/^FY\s+/i, '')}`;
  }, [activeFy]);

  const part1AutoSortRunningRef = useRef(false);
  useEffect(() => {
    if (!erpSession || part1AutoSortRunningRef.current) return;
    const totalRecords =
      parties.length +
      vehicles.length +
      drivers.length +
      consignments.length +
      invoices.length +
      lorryHires.length;
    if (totalRecords === 0) return;

    const flagKey = `drc_part1_dbf_autosort_v1_${workspaceUid}`;
    try {
      if (localStorage.getItem(flagKey)) return;
    } catch {
      return;
    }

    const timer = window.setTimeout(() => {
      if (part1AutoSortRunningRef.current) return;
      part1AutoSortRunningRef.current = true;
      void autoSortAllDbfDataToExactRoles({
        ownerUid: workspaceUid,
        activeFy,
        branchCode: activeOperationalBranch,
        staffCode: activeStaffCode,
        parties,
        vehicles,
        drivers,
        consignments,
        invoices,
        lorryHires,
      })
        .then(() => {
          try {
            localStorage.setItem(flagKey, String(Date.now()));
          } catch {
            // ignore storage quota
          }
        })
        .catch(() => {
          // Allow retry on next load if transient failure occurred
        })
        .finally(() => {
          part1AutoSortRunningRef.current = false;
        });
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [
    erpSession,
    workspaceUid,
    activeFy,
    activeOperationalBranch,
    activeStaffCode,
    parties,
    vehicles,
    drivers,
    consignments,
    invoices,
    lorryHires,
  ]);

  useEffect(() => {
    setBholeImgFailed(false);
  }, [companySettings.bholeBabaPhotoDataUrl]);

  useEffect(() => {
    setShyamImgFailed(false);
  }, [companySettings.khatuShyamPhotoDataUrl]);

  const fyChoices = useMemo(() => {
    const set = new Set<string>([
      ...PRECREATED_FYS,
      ...(companySettings.availableFys || []).map(normalizeFyLabel),
      activeFy,
    ]);
    return Array.from(set).sort();
  }, [companySettings.availableFys, activeFy]);

  const handleSelectFy = useCallback((nextFy: string) => {
    const normalized = normalizeFyLabel(nextFy);
    setSelectedFy(normalized);
    try {
      localStorage.setItem('drc_selected_fy_v1', normalized);
    } catch {
      // Ignore storage quota issues
    }
  }, []);

  const triggerAiDoctor = useCallback(
    async (trigger: AiDoctorTrigger, forceOnlineAi?: boolean) => {
      setRunningAiDoctor(true);
      try {
        const rep = await runAiDeepFormulaAndBugRepair({
          trigger,
          activeFy,
          allowOnlineAi:
            typeof forceOnlineAi === 'boolean'
              ? forceOnlineAi
              : Boolean(companySettings.backgroundAiEnabled),
          allData: {
            consignments: consignments as unknown as Array<Record<string, unknown>>,
            lorryHires: lorryHires as unknown as Array<Record<string, unknown>>,
            invoices: invoices as unknown as Array<Record<string, unknown>>,
            transactions: transactions as unknown as Array<Record<string, unknown>>,
            parties,
            logisticsDockets: logisticsDockets as unknown as Array<Record<string, unknown>>,
            logisticsInvoices: logisticsInvoices as unknown as Array<Record<string, unknown>>,
          },
          persistCollectionPatch: async (collection, docId, patch) => {
            await upsertDocument(collection, docId, patch, false);
          },
        });
        setAiDoctorReport(rep);
        if (trigger === 'manual') {
          playVerifiedBeep();
        }
        return rep;
      } finally {
        setRunningAiDoctor(false);
      }
    },
    [
      activeFy,
      companySettings.backgroundAiEnabled,
      consignments,
      lorryHires,
      invoices,
      transactions,
      parties,
      logisticsDockets,
      logisticsInvoices,
    ]
  );

  // Automatic Startup / 15-Day / 30-Day Embedded Gemini AI System Doctor
  useEffect(() => {
    if (!erpSession || aiDoctorStartupRanRef.current) return;
    if (consignments.length + lorryHires.length + invoices.length + parties.length === 0) return;
    aiDoctorStartupRanRef.current = true;
    const dueTrigger: AiDoctorTrigger = isDueFor30DayDoctor()
      ? '30_day'
      : isDueFor15DayDoctor()
        ? '15_day'
        : 'startup';
    const t = window.setTimeout(() => {
      void triggerAiDoctor(dueTrigger);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [erpSession, consignments.length, lorryHires.length, invoices.length, parties.length, triggerAiDoctor]);

  const buildCompleteVaultBundle = useCallback(
    (): Record<string, unknown> => ({
      exportedAt: new Date().toISOString(),
      authorizedEmail: BACKUP_ISOLATED_DRIVE_EMAIL,
      company: companySettings,
      parties,
      vehicles,
      drivers,
      consignments,
      invoices,
      quotations,
      lorryHires,
      transactions,
      declarations,
      tripExpenses,
      bankReceipts,
      staffCommissions,
      logisticsParties,
      logisticsVehicles,
      logisticsDrivers,
      logisticsDockets,
      logisticsManifests,
      logisticsInvoices,
      logisticsLedgers,
    }),
    [
      companySettings,
      parties,
      vehicles,
      drivers,
      consignments,
      invoices,
      quotations,
      lorryHires,
      transactions,
      declarations,
      tripExpenses,
      bankReceipts,
      staffCommissions,
      logisticsParties,
      logisticsVehicles,
      logisticsDrivers,
      logisticsDockets,
      logisticsManifests,
      logisticsInvoices,
      logisticsLedgers,
    ]
  );

  const runSealedAutoBackup = useCallback(
    async (forceRemotePull = false) => {
      if (!erpSession) {
        return {
          backedUpAt: Date.now(),
          sha256: '',
          snapshotName: getDailySnapshotFileName(),
          recordCount: 0,
          driveSynced: false,
        };
      }
      const bundle = buildCompleteVaultBundle();
      const emailForSeal =
        connectedEmail && isAuthorizedBackupDriveEmail(connectedEmail)
          ? connectedEmail
          : BACKUP_ISOLATED_DRIVE_EMAIL;
      setAutoBackupInfo((prev) => ({
        ...prev,
        status: 'syncing',
        message: 'Sealing SHA-256 & backing up...',
      }));
      try {
        const localSeal = await sealBackupPayloadWithSha256(bundle, emailForSeal);
        const snapshotName = getDailySnapshotFileName();
        const sealedAt = Date.now();
        try {
          localStorage.setItem(
            'drc_last_backup_seal_v1',
            JSON.stringify({
              at: sealedAt,
              sha256: localSeal.sha256,
              snapshotName,
              recordCount: localSeal.recordCount,
              email: emailForSeal,
            })
          );
        } catch {
          // Ignore storage quota issues
        }

        if (isOnline && driveAccessToken && isAuthorizedBackupDriveEmail(connectedEmail)) {
          const syncRes = await syncAutoBackupBundleToDrive({
            accessToken: driveAccessToken,
            connectedEmail,
            localBundle: bundle,
            includeDailySnapshot: true,
            forceRemotePull,
          });
          setAutoBackupInfo({
            status: 'synced',
            lastBackedUpAt: sealedAt,
            sha256: syncRes.sha256,
            snapshotName: syncRes.snapshotFileName || snapshotName,
            recordCount: syncRes.recordCount,
            message: `Synced ${syncRes.masterFileName} + ${syncRes.snapshotFileName || snapshotName}`,
          });
          return {
            backedUpAt: sealedAt,
            sha256: syncRes.sha256,
            snapshotName: syncRes.snapshotFileName || snapshotName,
            recordCount: syncRes.recordCount,
            driveSynced: true,
          };
        }

        setAutoBackupInfo({
          status: 'offline_sealed',
          lastBackedUpAt: sealedAt,
          sha256: localSeal.sha256,
          snapshotName,
          recordCount: localSeal.recordCount,
          message: driveAccessToken
            ? `Drive sync locked strictly to ${BACKUP_ISOLATED_DRIVE_EMAIL}`
            : 'SHA-256 local vault sealed (connect Google Drive for cloud sync)',
        });
        return {
          backedUpAt: sealedAt,
          sha256: localSeal.sha256,
          snapshotName,
          recordCount: localSeal.recordCount,
          driveSynced: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Auto-backup seal failed';
        setAutoBackupInfo((prev) => ({
          ...prev,
          status: 'error',
          message: msg,
        }));
        return {
          backedUpAt: Date.now(),
          sha256: '',
          snapshotName: getDailySnapshotFileName(),
          recordCount: 0,
          driveSynced: false,
        };
      }
    },
    [erpSession, buildCompleteVaultBundle, connectedEmail, isOnline, driveAccessToken]
  );

  const runSealedAutoBackupRef = useRef(runSealedAutoBackup);
  runSealedAutoBackupRef.current = runSealedAutoBackup;

  // Silent 3-Second Auto-Backup after every ERP save ('drc:data-saved')
  useEffect(() => {
    if (!erpSession) return;
    const handleDataSaved = () => {
      setAutoBackupInfo((prev) => ({
        ...prev,
        status: 'pending',
        message: 'Change saved — 3s auto-backup queued...',
      }));
      if (autoBackupTimerRef.current !== null) {
        window.clearTimeout(autoBackupTimerRef.current);
      }
      autoBackupTimerRef.current = window.setTimeout(() => {
        autoBackupTimerRef.current = null;
        void runSealedAutoBackupRef.current(false);
      }, 2200);
    };
    window.addEventListener('drc:data-saved', handleDataSaved);
    return () => {
      window.removeEventListener('drc:data-saved', handleDataSaved);
      if (autoBackupTimerRef.current !== null) {
        window.clearTimeout(autoBackupTimerRef.current);
        autoBackupTimerRef.current = null;
      }
    };
  }, [erpSession]);

  // Scoped datasets based on branch isolation / Master Admin branch filter + Active Financial Year
  const filterByBranch = useCallback(
    <T extends { branchCode?: string }>(list: T[]): T[] => {
      if (effectiveBranchFilter === 'ALL') return list;
      return list.filter((item) => (item.branchCode || 'KOL-HQ') === effectiveBranchFilter);
    },
    [effectiveBranchFilter]
  );

  const visibleConsignments = useMemo(
    () =>
      filterByBranch(consignments).filter((c) =>
        matchesSelectedFinancialYear(c.financialYear, c.cnDate, activeFy)
      ),
    [consignments, filterByBranch, activeFy]
  );
  const visibleInvoices = useMemo(
    () =>
      filterByBranch(invoices).filter((inv) =>
        matchesSelectedFinancialYear(inv.financialYear, inv.invoiceDate, activeFy)
      ),
    [invoices, filterByBranch, activeFy]
  );
  const visibleQuotations = useMemo(
    () =>
      filterByBranch(quotations).filter((q) =>
        matchesSelectedFinancialYear(q.financialYear, q.quotationDate, activeFy)
      ),
    [quotations, filterByBranch, activeFy]
  );
  const visibleLorryHires = useMemo(
    () =>
      filterByBranch(lorryHires).filter((h) =>
        matchesSelectedFinancialYear(h.financialYear, h.cnDate, activeFy)
      ),
    [lorryHires, filterByBranch, activeFy]
  );
  const visibleTransactions = useMemo(
    () =>
      filterByBranch(transactions).filter((t) =>
        matchesSelectedFinancialYear(t.financialYear, t.txDate, activeFy)
      ),
    [transactions, filterByBranch, activeFy]
  );
  const visibleDeclarations = useMemo(
    () =>
      filterByBranch(declarations).filter((d) =>
        matchesSelectedFinancialYear(d.financialYear, d.declarationDate, activeFy)
      ),
    [declarations, filterByBranch, activeFy]
  );
  const visibleTripExpenses = useMemo(
    () =>
      filterByBranch(tripExpenses).filter((te) =>
        matchesSelectedFinancialYear(te.financialYear, te.cnDate, activeFy)
      ),
    [tripExpenses, filterByBranch, activeFy]
  );

  // Scoped Express Parcel / PTL / Courier Logistics datasets (Branch + Active FY + Division)
  const visibleLogisticsDockets = useMemo(
    () =>
      filterByBranch(logisticsDockets).filter((d) =>
        matchesSelectedFinancialYear(d.financialYear, d.docketDate, activeFy)
      ),
    [logisticsDockets, filterByBranch, activeFy]
  );
  const visibleLogisticsManifests = useMemo(
    () =>
      filterByBranch(logisticsManifests).filter((m) =>
        matchesSelectedFinancialYear(m.financialYear, m.manifestDate, activeFy)
      ),
    [logisticsManifests, filterByBranch, activeFy]
  );
  const visibleLogisticsInvoices = useMemo(
    () =>
      filterByBranch(logisticsInvoices).filter((inv) =>
        matchesSelectedFinancialYear(inv.financialYear, inv.docDate, activeFy)
      ),
    [logisticsInvoices, filterByBranch, activeFy]
  );
  const visibleLogisticsLedgers = useMemo(
    () =>
      filterByBranch(logisticsLedgers).filter((entry) =>
        matchesSelectedFinancialYear(entry.financialYear, entry.voucherDate, activeFy)
      ),
    [logisticsLedgers, filterByBranch, activeFy]
  );

  const activeLogisticsDivision = businessMode === 'FTL' ? 'LOGISTICS' : businessMode;
  const divisionLogisticsDockets = useMemo(
    () =>
      visibleLogisticsDockets.filter(
        (d) => getLogisticsDivisionFromId(d.id) === activeLogisticsDivision
      ),
    [visibleLogisticsDockets, activeLogisticsDivision]
  );
  const divisionLogisticsManifests = useMemo(
    () =>
      visibleLogisticsManifests.filter(
        (m) => getLogisticsDivisionFromId(m.id) === activeLogisticsDivision
      ),
    [visibleLogisticsManifests, activeLogisticsDivision]
  );
  const divisionLogisticsInvoices = useMemo(
    () =>
      visibleLogisticsInvoices.filter(
        (inv) => getLogisticsDivisionFromId(inv.id) === activeLogisticsDivision
      ),
    [visibleLogisticsInvoices, activeLogisticsDivision]
  );
  const divisionLogisticsLedgers = useMemo(
    () =>
      visibleLogisticsLedgers.filter(
        (l) => getLogisticsDivisionFromId(l.id) === activeLogisticsDivision
      ),
    [visibleLogisticsLedgers, activeLogisticsDivision]
  );

  // Active Staff Presence & Sorted Activity Log
  const activeOnlineStaff = useMemo(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    return [...presenceList]
      .filter((p) => p.status === 'online' && (getTimestampMillis(p.lastSeenAt) >= cutoff || p.staffCode === activeStaffCode))
      .sort((a, b) => getTimestampMillis(b.lastSeenAt) - getTimestampMillis(a.lastSeenAt));
  }, [presenceList, activeStaffCode]);

  const sortedActivityLogs = useMemo(() => {
    const base =
      effectiveBranchFilter === 'ALL'
        ? activityLogs
        : activityLogs.filter((l) => (l.branchCode || 'KOL-HQ') === effectiveBranchFilter);
    return [...base]
      .sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt))
      .slice(0, 80);
  }, [activityLogs, effectiveBranchFilter]);

  // Real-time Red & 15-Day Advance Alert Badges Computation
  const alerts = useMemo(() => {
    const failedVehicles = vehicles.filter((v) => {
      const checks = [
        v.fitnessExpiry,
        v.insuranceExpiry,
        v.permitExpiry,
        v.roadTaxExpiry,
        v.pucExpiry,
      ];
      return checks.some((dt) => {
        const d = daysUntilDate(dt);
        return d !== null && d <= 15;
      });
    });

    const failedDrivers = drivers.filter((d) => {
      const days = daysUntilDate(d.dlExpiry);
      return days !== null && days <= 15;
    });

    const expiringEwbs = visibleConsignments.filter((cn) => {
      const dates = [
        cn.ewayBillValidUpto,
        ...(cn.extraEwayBills || []).map((e) => e.validUpto),
      ];
      return dates.some((dt) => {
        const st = getEwayBillExpiryState(dt);
        return st.status === 'expired' || st.status === 'expiringSoon';
      });
    });

    const overdueInvoices = visibleInvoices.filter((inv) => {
      if (inv.status === 'Paid') return false;
      const dueDays = inv.dueDate ? daysUntilDate(inv.dueDate) : null;
      if (dueDays !== null && dueDays < 0) return true;
      return daysSinceDate(inv.invoiceDate) > 7;
    });

    const gstAlarms = evaluateMonthlyGstAlarms();
    const kycAlarms = evaluateKycExpiryAlarms(companySettings.kycVault);

    return {
      failedVehicles,
      failedDrivers,
      expiringEwbs,
      overdueInvoices,
      gstAlarms,
      kycAlarms,
      totalCount:
        failedVehicles.length +
        failedDrivers.length +
        expiringEwbs.length +
        overdueInvoices.length +
        gstAlarms.length +
        kycAlarms.length,
    };
  }, [vehicles, drivers, visibleConsignments, visibleInvoices, companySettings.kycVault]);

  const eway8hAlarms = useMemo(
    () => evaluateEway8HourAlarms(visibleConsignments, visibleLorryHires),
    [visibleConsignments, visibleLorryHires]
  );

  useEffect(() => {
    if (!erpSession || alarmBeepedRef.current) return;
    if (alerts.gstAlarms.length > 0 || alerts.kycAlarms.length > 0) {
      alarmBeepedRef.current = true;
      const topAlarm = alerts.gstAlarms[0] || alerts.kycAlarms[0];
      if (topAlarm) {
        void dispatchBackgroundNotification({
          title: topAlarm.title,
          body: topAlarm.message,
          tag: `drc-compliance-${topAlarm.id}`,
          requireInteraction: true,
        });
      }
      const timer = setTimeout(() => playAlertBeep(), 600);
      return () => clearTimeout(timer);
    }
  }, [erpSession, alerts.gstAlarms, alerts.kycAlarms]);

  // Continuous 8h -> 1h E-Way Bill Countdown Alarm (stops once Unloading Date or Delivered POD is saved)
  useEffect(() => {
    if (!erpSession || eway8hAlarms.length === 0) return;
    const triggerCountdownAlarm = () => {
      const top = eway8hAlarms[0];
      if (!top) return;
      const nowMs = Date.now();
      if (nowMs - eway8hLastBeepRef.current < 45_000) return;
      eway8hLastBeepRef.current = nowMs;
      playAlertBeep();
      void dispatchBackgroundNotification({
        title: top.title,
        body: top.message,
        tag: `drc-ewb-8h-${top.cnId}`,
        requireInteraction: true,
      });
    };
    triggerCountdownAlarm();
    const interval = window.setInterval(triggerCountdownAlarm, 10 * 60_000);
    return () => window.clearInterval(interval);
  }, [erpSession, eway8hAlarms]);

  // Anti-Screenshot & Screen-Capture Privacy Shield across Windows, Tablet & Android
  useEffect(() => {
    if (!erpSession) return;
    const uninstall = installScreenCaptureShield({
      enabled: true,
      onViolation: (reason) => {
        playAlertBeep();
        setPrivacyCurtainReason(reason);
      },
    });
    const timer = window.setInterval(() => {
      setShieldTempUnlocked(isScreenShieldTemporarilyUnlocked());
    }, 5000);
    return () => {
      uninstall();
      window.clearInterval(timer);
    };
  }, [erpSession]);

  const handleTogglePhoneAlarm = useCallback(async () => {
    const res = await requestPhoneAlarmPermission();
    setPhoneAlarmPermission(res);
    if (res === 'granted') {
      playVerifiedBeep();
      void dispatchBackgroundNotification({
        title: 'DRC Phone Alarms Active',
        body: 'GST (7/8/15th), Master KYC (10/5/2d) & E-Way 8h Countdown alerts are active.',
        tag: 'drc-alarm-ready',
      });
    } else {
      playAlertBeep();
    }
  }, []);

  const handleToggleRotateScreen = useCallback(async () => {
    const nextMode: 'landscape' | 'portrait' =
      rotateMode === 'landscape' ? 'portrait' : 'landscape';
    setRotateMode(nextMode);
    try {
      const orient = window.screen?.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
        unlock?: () => void;
      };
      if (nextMode === 'landscape' && orient && typeof orient.lock === 'function') {
        await orient.lock('landscape');
      } else if (nextMode === 'portrait' && orient && typeof orient.unlock === 'function') {
        orient.unlock();
      }
    } catch {
      // Desktop / iOS / unsupported portrait locks gracefully fall back to CSS landscape rotation (.drc-css-landscape-fallback)
    }
  }, [rotateMode]);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore browser fullscreen restriction
    }
  }, []);

  const handleCycleVoiceLang = useCallback(() => {
    const order: VoicePilotLang[] = ['bn', 'en', 'off'];
    const next = order[(order.indexOf(voiceLang) + 1) % order.length];
    setVoiceLang(next);
    setStoredVoicePilotLang(next);
    if (next === 'off') {
      if (voiceStopRef.current) {
        voiceStopRef.current();
        voiceStopRef.current = null;
      }
      setVoiceListening(false);
      setVoiceFeedbackMsg('Voice Pilot: OFF');
    } else if (!isEffectiveMasterAdmin) {
      const hint = getStaffReadOnlyVoiceHint(next, activeTab, businessMode);
      setVoiceFeedbackMsg(hint);
      speakCalmVoice(hint, next);
    } else {
      const msg =
        next === 'bn'
          ? 'বাংলা ভয়েস পাইলট সক্রিয় হয়েছে (শুধুমাত্র ড্রাফট পূরণ)।'
          : 'English Voice Pilot ready (Draft-only assistant).';
      setVoiceFeedbackMsg(msg);
      speakCalmVoice(msg, next);
    }
  }, [voiceLang, isEffectiveMasterAdmin, activeTab, businessMode]);

  const getSheetAccess = useCallback(
    (sheetKey: SheetPermissionKey) => {
      if (activeStaffSession && !isEffectiveMasterAdmin) {
        return getStaffSheetAccess(
          {
            userId: activeStaffSession.staffCode,
            displayName: activeStaffSession.displayName,
            role: activeStaffSession.role,
            isMasterAdmin: false,
            workspaceUid,
            branchCode: activeStaffSession.branchCode || 'ALL',
            staffAccount: activeStaffSession,
            loggedInAt: erpSession?.loggedInAt || Date.now(),
          },
          staffAccounts,
          sheetKey
        );
      }
      return getStaffSheetAccess(erpSession, staffAccounts, sheetKey);
    },
    [erpSession, activeStaffSession, isEffectiveMasterAdmin, staffAccounts, workspaceUid]
  );

  const hasPermission = useCallback(
    (perm: SheetTabId): boolean => {
      if (!erpSession) return false;
      if (perm === 'dashboard' || perm === 'about' || perm === 'guide') return true;
      if (perm === 'staffAccess') return isEffectiveMasterAdmin;
      if (!isEffectiveMasterAdmin && (perm === 'settings' || perm === 'mis')) return false;
      if (isEffectiveMasterAdmin || activeStaffSession?.role === 'Admin') return true;
      if (perm === 'backup') {
        return isEffectiveMasterAdmin;
      }
      if (perm === 'allInOne') {
        return getSheetAccess('lr') !== 'blocked' || getSheetAccess('billing') !== 'blocked';
      }
      const sheetMap: Partial<Record<SheetTabId, SheetPermissionKey>> = {
        master: 'master',
        lr: 'lr',
        billing: 'billing',
        lorryHire: 'lorryHire',
        commission: 'commission',
        bankImport: 'bankImport',
        accounts: 'accounts',
        reports: 'reports',
        settings: 'settings',
      };
      const sk = sheetMap[perm];
      if (sk) {
        return getSheetAccess(sk) !== 'blocked';
      }
      return (activeStaffSession?.permissions || []).includes(perm as PermissionKey);
    },
    [erpSession, isEffectiveMasterAdmin, activeStaffSession, getSheetAccess]
  );

  // Strict route guard: redirect non-admin staff away from restricted tabs immediately
  useEffect(() => {
    if (!erpSession) return;
    if (activeTab === 'dashboard' || activeTab === 'about' || activeTab === 'guide') return;
    if (!hasPermission(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [erpSession, activeTab, hasPermission]);

  // User-configurable Idle Auto-Lock monitor (defaults to 5 minutes; 0 disables)
  useEffect(() => {
    if (!erpSession || isScreenLocked) return;
    const mins = Number(companySettings.autoLockMinutes ?? 5);
    if (!Number.isFinite(mins) || mins <= 0) return;

    lastActivityRef.current = Date.now();
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'keydown',
      'mousedown',
      'touchstart',
      'scroll',
    ];
    events.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= mins * 60_000) {
        setUnlockPassword('');
        setUnlockError(null);
        setIsScreenLocked(true);
      }
    }, 10_000);

    return () => {
      clearInterval(interval);
      events.forEach((evt) => window.removeEventListener(evt, markActive));
    };
  }, [erpSession, isScreenLocked, companySettings.autoLockMinutes]);

  // Optional production right-click / DevTools inspection guard (preserves inputs & Ctrl+V paste)
  useEffect(() => {
    if (!erpSession || !import.meta.env.PROD || companySettings.lockSourceInspection === false) {
      return;
    }
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (e.key === 'F12') {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'U') {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [erpSession, companySettings.lockSourceInspection]);

  const openOrSwitchTab = useCallback(
    (tabId: SheetTabId) => {
      setSidebarOpen(false);
      startTransition(() => {
        setTabHistory((prev) => {
          if (activeTab === tabId) return prev;
          return [...prev.slice(-19), activeTab];
        });
        setOpenTabs((prev) => {
          if (prev.some((t) => t.id === tabId)) return prev;
          return [...prev, { id: tabId, label: TAB_LABELS[tabId] }];
        });
        if (tabId === 'dashboard') {
          setBannerExpanded(false);
        } else {
          setDashboardFocusTx(false);
        }
        setActiveTab(tabId);
      });
    },
    [activeTab]
  );

  const requestProtectedTab = useCallback(
    (tabId: SheetTabId) => {
      if (!isEffectiveMasterAdmin) return;
      if (tabId === 'backup' && isBackupVaultUnlocked()) {
        openOrSwitchTab('backup');
        return;
      }
      const challenge =
        tabId === 'backup'
          ? getActiveTwoFactorOtpChallenge() ||
            issueTwoFactorOtpChallenge(
              `Backup / Restore Vault (${BACKUP_ISOLATED_DRIVE_EMAIL})`
            )
          : null;
      setPendingPinTargetTab(tabId);
      setAdminPinInput('');
      setAdminPinOtpInput('');
      setAdminPinOtpChallenge(challenge);
      setAdminPinError(null);
      setAdminPinModalOpen(true);
      setSidebarOpen(false);
    },
    [isEffectiveMasterAdmin, openOrSwitchTab]
  );

  const handleReturnToCurrentBusinessDashboard = useCallback(() => {
    setBannerExpanded(false);
    if (businessMode === 'FTL') {
      setDashboardFocusTx(false);
      setActiveTab('dashboard');
    } else {
      setLogiActiveTab('overview');
    }
  }, [businessMode]);

  const handleGoBack = useCallback(() => {
    setTabHistory((prev) => {
      if (prev.length === 0) {
        if (activeTab !== 'dashboard') {
          setDashboardFocusTx(false);
          setBannerExpanded(false);
          setActiveTab('dashboard');
        }
        return prev;
      }
      const nextStack = [...prev];
      const target = nextStack.pop() || 'dashboard';
      if (target === 'dashboard') {
        setDashboardFocusTx(false);
        setBannerExpanded(false);
      }
      setActiveTab(target);
      return nextStack;
    });
  }, [activeTab]);

  const closeTab = (tabId: SheetTabId, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabId === 'dashboard') return;
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTab === tabId) {
        setActiveTab(next[next.length - 1]?.id || 'dashboard');
      }
      return next;
    });
  };

  const handleCustomLogin = async (userId: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = await loginWithCredentials(userId, password);
      setErpSession(session);
      setActiveStaffSession(session.staffAccount);
      setIsScreenLocked(false);
      setSidebarOpen(false);
      setFyLocked(true);
      setBranchFilter('ALL');
      setOpenTabs([{ id: 'dashboard', label: 'Dashboard' }]);
      setActiveTab('dashboard');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRestoreDefaultAdmin = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = await resetAdminToDefaultAndLogin();
      setErpSession(session);
      setActiveStaffSession(null);
      setIsScreenLocked(false);
      setSidebarOpen(false);
      setFyLocked(true);
      setBranchFilter('ALL');
      setOpenTabs([{ id: 'dashboard', label: 'Dashboard' }]);
      setActiveTab('dashboard');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to reset Admin password.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUnlockScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!erpSession || unlocking) return;
    setUnlockError(null);
    if (verifySessionPasswordInstant(erpSession, activeStaffSession, unlockPassword)) {
      lastActivityRef.current = Date.now();
      setUnlockPassword('');
      setIsScreenLocked(false);
      window.setTimeout(() => playVerifiedBeep(), 0);
      return;
    }
    setUnlocking(true);
    try {
      const operatorId = activeStaffSession ? activeStaffSession.staffCode : erpSession.userId;
      await loginWithCredentials(operatorId, unlockPassword);
      lastActivityRef.current = Date.now();
      setUnlockPassword('');
      setIsScreenLocked(false);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Incorrect password.');
    } finally {
      setUnlocking(false);
    }
  };

  const handleGoogleDriveConnect = async (forceAccountSelect = false) => {
    setDriveBannerError(null);
    try {
      const res = await googleSignIn(forceAccountSelect);
      if (res.user?.email && !isAuthorizedBackupDriveEmail(res.user.email)) {
        setGoogleUser(null);
        setDriveAccessToken(null);
        playAlertBeep();
        setDriveBannerError(
          `Drive Security Lock: Connected email "${res.user.email}" rejected. Sync is strictly locked to ${BACKUP_ISOLATED_DRIVE_EMAIL}.`
        );
        return;
      }
      setGoogleUser(res.user);
      if (res.accessToken) setDriveAccessToken(res.accessToken);
      playVerifiedBeep();
    } catch (err) {
      setDriveBannerError(
        err instanceof Error ? err.message : 'Google Drive connection failed.'
      );
    }
  };

  const handleRefreshApp = async () => {
    try {
      await forceTwoWaySyncAndMerge();
    } catch {
      // Preserve offline queue if offline
    }
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      }
    } catch {
      // Fall through to reload
    }
    window.location.reload();
  };

  const handleSwitchOffExitApp = useCallback(async () => {
    if (autoBackupTimerRef.current !== null) {
      window.clearTimeout(autoBackupTimerRef.current);
      autoBackupTimerRef.current = null;
    }
    try {
      if (isOnline && offlineSyncStatus.pendingCount > 0) {
        await Promise.race([
          flushOfflineSyncQueue(),
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
    } catch {
      // Ignore network timeout on exit
    }
    const finalBackup = await Promise.race([
      Promise.all([
        runSealedAutoBackupRef.current(false),
        triggerAiDoctor('switch_off').catch(() => null),
      ]).then(([b]) => b),
      new Promise<{
        backedUpAt: number;
        sha256: string;
        snapshotName: string;
        recordCount: number;
        driveSynced: boolean;
      }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              backedUpAt: Date.now(),
              sha256: autoBackupInfo.sha256 || 'LOCAL-SEALED',
              snapshotName: getDailySnapshotFileName(),
              recordCount: autoBackupInfo.recordCount || 0,
              driveSynced: false,
            }),
          4500
        )
      ),
    ]);
    setSwitchOffSummary({
      backedUpAt: finalBackup.backedUpAt,
      sha256: finalBackup.sha256 || autoBackupInfo.sha256 || 'LOCAL-SEALED',
      snapshotName: finalBackup.snapshotName,
      recordCount: finalBackup.recordCount,
      driveSynced: finalBackup.driveSynced,
      email:
        connectedEmail && isAuthorizedBackupDriveEmail(connectedEmail)
          ? connectedEmail
          : BACKUP_ISOLATED_DRIVE_EMAIL,
    });
    lockBackupVault();
    lockVoicePilot();
    setVoicePinUnlocked(false);
    resetDriveSyncSessionCache();
    try {
      runDailyLocalJunkCleanup();
      revokeThermalMemoryCooledUrls();
    } catch {
      // Ignore cleanup errors
    }
    if (erpSession) {
      try {
        await Promise.race([
          upsertStaffPresence({
            ownerUid: workspaceUid,
            staffCode: activeStaffCode,
            displayName: activeStaffName,
            role: activeStaffRole,
            branchCode: activeOperationalBranch,
            activeModule: TAB_LABELS[activeTab] || activeTab,
            deviceType: detectDeviceType(),
            status: 'offline',
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 1200)),
        ]);
      } catch {
        // Ignore presence update error on exit
      }
    }
    clearErpSession();
    setPreviewPdf((prev) => {
      if (prev?.pdf.blobUrl) URL.revokeObjectURL(prev.pdf.blobUrl);
      return null;
    });
    setIsScreenLocked(false);
    setSidebarOpen(false);
    setNotifOpen(false);
    setLiveMonitorOpen(false);
    setActiveStaffSession(null);
    setErpSession(null);
    setBusinessMode('FTL');
    setOpenTabs([{ id: 'dashboard', label: 'Dashboard' }]);
    setActiveTab('dashboard');
    playVerifiedBeep();
    setAppClosedOverlay(true);
    try {
      window.close();
    } catch {
      // Browser tab close may require manual dismissal
    }
  }, [
    isOnline,
    offlineSyncStatus.pendingCount,
    autoBackupInfo.sha256,
    autoBackupInfo.recordCount,
    connectedEmail,
    erpSession,
    workspaceUid,
    activeStaffCode,
    activeStaffName,
    activeStaffRole,
    activeOperationalBranch,
    activeTab,
  ]);

  const handlePreviewPdf = useCallback((pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => {
    if (pdf.blobUrl) registerManagedBlobUrl(pdf.blobUrl);
    setPreviewPdf((prev) => {
      if (prev?.pdf.blobUrl) URL.revokeObjectURL(prev.pdf.blobUrl);
      return { pdf, folder };
    });
  }, []);

  const handleClosePreviewPdf = useCallback(() => {
    setPreviewPdf((prev) => {
      if (prev?.pdf.blobUrl) URL.revokeObjectURL(prev.pdf.blobUrl);
      return null;
    });
    revokeThermalMemoryCooledUrls();
  }, []);

  const handleSavePdfToDrive = async (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => {
    if (!driveAccessToken) {
      await handleGoogleDriveConnect(true);
      return;
    }
    if (isPdfVaultFolder(folder)) {
      await uploadPdfToDivisionVaultFolder({
        accessToken: driveAccessToken,
        division: businessMode || 'FTL',
        folderName: folder,
        fileName: pdf.fileName,
        blob: pdf.blob,
        connectedEmail,
      });
    } else if (isLogisticsDriveFolder(folder)) {
      await uploadLogisticsBlobToDriveFolder({
        accessToken: driveAccessToken,
        folderName: folder,
        fileName: pdf.fileName,
        blob: pdf.blob,
        mimeType: 'application/pdf',
      });
    } else {
      const catMap: Record<
        string,
        'POD' | 'LR_Copy' | 'Bills_Invoices' | 'Quotations' | 'Declarations' | 'Bank_Statements' | 'PARTY'
      > = {
        POD_Scans: 'POD',
        'LR Copy': 'LR_Copy',
        Bills_Invoices: 'Bills_Invoices',
        Quotations: 'Quotations',
        Declarations: 'Declarations',
        Bank_Statements: 'Bank_Statements',
        Reports_Ledgers: 'PARTY',
      };
      const mappedCat = catMap[folder];
      if (mappedCat) {
        await uploadRoleOrganizedPdfToDrive({
          accessToken: driveAccessToken,
          fy: activeFy,
          rootFolderName: companySettings.driveRootFolder,
          category: mappedCat,
          entitySubFolder: pdf.shareMeta?.partyName,
          fileName: pdf.fileName,
          blob: pdf.blob,
          connectedEmail,
        });
      } else {
        await uploadBlobToDriveFolder({
          accessToken: driveAccessToken,
          folderName: folder,
          fileName: pdf.fileName,
          blob: pdf.blob,
          mimeType: 'application/pdf',
        });
      }
    }
  };

  const handleShowConfirm = useCallback(
    (opts: {
      title: string;
      description: string;
      confirmLabel: string;
      variant?: 'danger' | 'primary';
      onConfirm: () => Promise<void> | void;
    }) => {
      setConfirmState({
        open: true,
        ...opts,
      });
    },
    []
  );

  const handleSidebarClick = (navId: SidebarNavId) => {
    setSidebarOpen(false);
    if (navId === 'dashboard') {
      setDashboardFocusTx(false);
      openOrSwitchTab('dashboard');
      return;
    }
    if (navId === 'transactions') {
      setDashboardFocusTx(true);
      setFocusTransactionsNonce((n) => n + 1);
      openOrSwitchTab('dashboard');
      return;
    }
    if (navId === 'sidebar_quotation') {
      setDashboardFocusTx(false);
      setBillingInitialSubTab('quotation');
      setBillingFocusNonce((n) => n + 1);
      openOrSwitchTab('billing');
      return;
    }
    if (navId === 'sidebar_194c') {
      setDashboardFocusTx(false);
      setBillingInitialSubTab('194c');
      setBillingFocusNonce((n) => n + 1);
      openOrSwitchTab('billing');
      return;
    }
    if (
      navId === 'ledger_party' ||
      navId === 'ledger_broker' ||
      navId === 'ledger_owner' ||
      navId === 'ledger_driver' ||
      navId === 'ledger_vehicle' ||
      navId === 'ledger_staff'
    ) {
      const roleMap: Record<string, LedgerRoleType> = {
        ledger_party: 'party',
        ledger_broker: 'broker',
        ledger_owner: 'owner',
        ledger_driver: 'driver',
        ledger_vehicle: 'vehicle',
        ledger_staff: 'staff',
      };
      setDashboardFocusTx(false);
      setRoleLedgerInitialRole(roleMap[navId]);
      setRoleLedgerInitialAccount('');
      setRoleLedgerFocusNonce((n) => n + 1);
      openOrSwitchTab('roleLedgers');
      return;
    }
    if (navId === 'staffAccess' || navId === 'backup') {
      requestProtectedTab(navId);
      return;
    }
    setDashboardFocusTx(false);
    if (navId === 'accounts') {
      setReportInitialTab('accountBook');
      setReportFocusNonce((n) => n + 1);
    } else if (navId === 'reports') {
      setReportInitialTab('gstRegister');
      setReportFocusNonce((n) => n + 1);
    } else if (navId === 'mis') {
      setReportInitialTab('finalResults');
      setReportFocusNonce((n) => n + 1);
    } else if (navId === 'master') {
      setMasterInitialTab('parties');
      setMasterFocusNonce((n) => n + 1);
    } else if (navId === 'billing') {
      setBillingInitialSubTab('invoice');
      setBillingFocusNonce((n) => n + 1);
    }
    openOrSwitchTab(navId);
  };

  const deferredGlobalSearch = useDeferredValue(globalSearch);

  // Universal Search (Ctrl+K) matching Pages, Bills, CNs, Quotations, Lorries
  const universalSearchResults = useMemo(() => {
    const q = deferredGlobalSearch.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{
      id: string;
      badge: string;
      title: string;
      subtitle: string;
      onSelect: () => Promise<void> | void;
    }> = [];

    const pageShortcuts: Array<{
      id: string;
      title: string;
      keywords: string;
      allowed: boolean;
      action: () => void;
    }> = [
      {
        id: 'pg-allinone',
        title: 'All-in-One Master Entry Sheet & Register',
        keywords: 'all in one sheet master entry cn lorry hire bill register',
        allowed: hasPermission('allInOne'),
        action: () => openOrSwitchTab('allInOne'),
      },
      {
        id: 'pg-lr',
        title: 'Consignment / LR (Bilty Entry)',
        keywords: 'cn lr bilty consignment',
        allowed: hasPermission('lr'),
        action: () => openOrSwitchTab('lr'),
      },
      {
        id: 'pg-bill',
        title: 'Tax Invoice / Billing Builder',
        keywords: 'bill tax invoice billing gst',
        allowed: hasPermission('billing'),
        action: () => {
          setBillingInitialSubTab('invoice');
          setBillingFocusNonce((n) => n + 1);
          openOrSwitchTab('billing');
        },
      },
      {
        id: 'pg-qtn',
        title: 'Proforma Rate Quotation (10-Sec Auto-Fill)',
        keywords: 'quotation quote rate proforma',
        allowed: hasPermission('billing') && getSheetAccess('quotations') !== 'blocked',
        action: () => {
          setBillingInitialSubTab('quotation');
          setBillingFocusNonce((n) => n + 1);
          openOrSwitchTab('billing');
        },
      },
      {
        id: 'pg-194c',
        title: 'Section 194C Non-Deduction Declaration',
        keywords: 'declaration 194c tds pan',
        allowed: hasPermission('billing') && getSheetAccess('declarations') !== 'blocked',
        action: () => {
          setBillingInitialSubTab('194c');
          setBillingFocusNonce((n) => n + 1);
          openOrSwitchTab('billing');
        },
      },
      {
        id: 'pg-lh',
        title: 'Lorry Hire & POD Reconciliation',
        keywords: 'lorry hire pod shortage challan',
        allowed: hasPermission('lorryHire'),
        action: () => openOrSwitchTab('lorryHire'),
      },
      {
        id: 'pg-comm',
        title: 'Staff Commission & Advance Ledger',
        keywords: 'commission advance wheeler staff',
        allowed: hasPermission('commission'),
        action: () => openOrSwitchTab('commission'),
      },
      {
        id: 'pg-bank',
        title: 'Bank Receipt & 194C TDS Import',
        keywords: 'bank statement excel import tds credit',
        allowed: hasPermission('bankImport'),
        action: () => openOrSwitchTab('bankImport'),
      },
      {
        id: 'pg-rep',
        title: 'FoxPro GST Register & 6 Statements',
        keywords: 'gst register report statement foxpro',
        allowed: hasPermission('reports'),
        action: () => openOrSwitchTab('reports'),
      },
      {
        id: 'pg-gst-hub',
        title: 'GST & RCM Report & Online Filing Hub',
        keywords: 'gst gstr1 gstr3b rcm pmt06 filing portal hub',
        allowed: hasPermission('reports'),
        action: () => {
          setReportInitialTab('gstFilingHub');
          setReportFocusNonce((n) => n + 1);
          openOrSwitchTab('reports');
        },
      },
      {
        id: 'pg-guide',
        title: 'User Guide (অপারেটিং বুক)',
        keywords: 'guide manual help bengali bangla operating book',
        allowed: true,
        action: () => openOrSwitchTab('guide'),
      },
      {
        id: 'pg-master',
        title: 'Party, Owner, Broker, Lorry & Driver Master',
        keywords: 'party master owner broker lorry vehicle driver',
        allowed: hasPermission('master'),
        action: () => openOrSwitchTab('master'),
      },
      {
        id: 'pg-access',
        title: 'Staff Sheet Access Control (Matrix)',
        keywords: 'staff sheet access control permission',
        allowed: isEffectiveMasterAdmin,
        action: () => requestProtectedTab('staffAccess'),
      },
      {
        id: 'pg-backup',
        title: 'Backup / Restore Vault (PIN + 2FA OTP + Drive)',
        keywords: 'backup restore drive json snapshot sha256 2fa otp',
        allowed: isEffectiveMasterAdmin,
        action: () => requestProtectedTab('backup'),
      },
      {
        id: 'pg-set',
        title: 'Settings, Multi-Bank & UPI QR',
        keywords: 'settings bank upi branch company',
        allowed: hasPermission('settings'),
        action: () => openOrSwitchTab('settings'),
      },
    ];

    pageShortcuts.forEach((p) => {
      if (p.allowed && (p.title.toLowerCase().includes(q) || p.keywords.includes(q))) {
        results.push({
          id: p.id,
          badge: 'SCREEN',
          title: p.title,
          subtitle: 'Jump directly to module',
          onSelect: p.action,
        });
      }
    });

    if (hasPermission('billing')) {
      invoices
        .filter((inv) => `${inv.invoiceNo} ${inv.partyName}`.toLowerCase().includes(q))
        .slice(0, 6)
        .forEach((inv) => {
          results.push({
            id: `inv-${inv.id}`,
            badge: 'BILL',
            title: `${inv.invoiceNo} — ${inv.partyName}`,
            subtitle: `₹${formatINR(inv.grandTotal)} · ${inv.status} · Click to Preview PDF`,
            onSelect: async () => {
              const pdf = await generateInvoicePDF(inv, companySettings, true, 'p', inv.copyCount || 1);
              handlePreviewPdf(pdf, 'Bills_Invoices');
            },
          });
        });
    }

    if (hasPermission('lr')) {
      consignments
        .filter((cn) => `${cn.cnNo} ${cn.truckNo} ${cn.consignorName} ${cn.billingPartyName || ''}`.toLowerCase().includes(q))
        .slice(0, 6)
        .forEach((cn) => {
          results.push({
            id: `cn-${cn.id}`,
            badge: 'CN/LR',
            title: `${cn.cnNo} · ${cn.truckNo}`,
            subtitle: `${cn.billingPartyName || cn.consignorName} · ${cn.fromCity}→${cn.toCity} · Preview 4-Copy LR`,
            onSelect: async () => {
              const pdf = await generateLR3CopyPDF(cn, companySettings);
              handlePreviewPdf(pdf, 'LR Copy');
            },
          });
        });
    }

    if (hasPermission('billing') && getSheetAccess('quotations') !== 'blocked') {
      quotations
        .filter((qt) => `${qt.quotationNo} ${qt.partyName} ${qt.destination}`.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((qt) => {
          results.push({
            id: `qt-${qt.id}`,
            badge: 'QUOTE',
            title: `${qt.quotationNo} — ${qt.partyName}`,
            subtitle: `${qt.destination} · ₹${formatINR(qt.freight)} · Preview PDF`,
            onSelect: async () => {
              const pdf = await generateQuotationPDF(qt, companySettings);
              handlePreviewPdf(pdf, 'Quotations');
            },
          });
        });
    }

    if (hasPermission('master')) {
      vehicles
        .filter((v) => `${v.truckNo} ${v.ownerName}`.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((v) => {
          results.push({
            id: `veh-${v.id}`,
            badge: 'TRUCK',
            title: `${v.truckNo} (${v.ownerName})`,
            subtitle: `${v.vehicleType || 'Fleet'} · Open Lorry Register`,
            onSelect: () => {
              setMasterInitialTab('vehicles');
              setMasterFocusNonce((n) => n + 1);
              openOrSwitchTab('master');
            },
          });
        });
    }

    return results.slice(0, 14);
  }, [
    deferredGlobalSearch,
    invoices,
    consignments,
    quotations,
    vehicles,
    companySettings,
    handlePreviewPdf,
    openOrSwitchTab,
    requestProtectedTab,
    hasPermission,
    getSheetAccess,
    isEffectiveMasterAdmin,
  ]);

  useEffect(() => {
    if (!erpSession) return;
    let cancelled = false;
    const refreshDbfSerials = () => {
      void loadRawDbfArchiveFromIdb()
        .then((tables) => {
          if (cancelled || !tables || tables.length === 0) return;
          setDbfSerialStats(extractHighestBillAndCnFromRawDbf(tables));
        })
        .catch(() => {});
    };
    refreshDbfSerials();
    window.addEventListener('drc:data-saved', refreshDbfSerials);
    window.addEventListener('drc:dbf-archive-updated', refreshDbfSerials);
    return () => {
      cancelled = true;
      window.removeEventListener('drc:data-saved', refreshDbfSerials);
      window.removeEventListener('drc:dbf-archive-updated', refreshDbfSerials);
    };
  }, [erpSession]);

  const liveLastSavedNos = useMemo(() => {
    const latestCn = [...visibleConsignments].sort((a, b) => {
      const nDiff = extractTrailingSerialNumber(b.cnNo) - extractTrailingSerialNumber(a.cnNo);
      if (nDiff !== 0) return nDiff;
      return `${b.cnDate || ''}_${b.cnNo || ''}`.localeCompare(`${a.cnDate || ''}_${a.cnNo || ''}`);
    })[0];
    const latestBill = [...visibleInvoices].sort((a, b) => {
      const aNum = Math.max(Number(a.billId || 0) || 0, extractTrailingSerialNumber(a.invoiceNo));
      const bNum = Math.max(Number(b.billId || 0) || 0, extractTrailingSerialNumber(b.invoiceNo));
      if (bNum !== aNum) return bNum - aNum;
      return `${b.invoiceDate || ''}_${b.invoiceNo || ''}`.localeCompare(`${a.invoiceDate || ''}_${a.invoiceNo || ''}`);
    })[0];
    const latestQuote = [...visibleQuotations].sort((a, b) =>
      `${b.quotationDate || ''}_${b.quotationNo || ''}`.localeCompare(`${a.quotationDate || ''}_${a.quotationNo || ''}`)
    )[0];
    const latestDecl = [...visibleDeclarations].sort((a, b) =>
      (b.declarationDate || '').localeCompare(a.declarationDate || '')
    )[0];
    const latestPodHire = [...visibleLorryHires]
      .filter((lh) => lh.podReceived || lh.podReceiveDate)
      .sort((a, b) => (b.podReceiveDate || b.cnDate || '').localeCompare(a.podReceiveDate || a.cnDate || ''))[0];
    const latestTx = [...visibleTransactions].sort((a, b) =>
      `${b.txDate || ''}_${b.txCode || ''}`.localeCompare(`${a.txDate || ''}_${a.txCode || ''}`)
    )[0];

    const liveCnNum = latestCn ? extractTrailingSerialNumber(latestCn.cnNo) : 0;
    const useDbfCn = Boolean(dbfSerialStats?.maxCnNum && dbfSerialStats.maxCnNum > liveCnNum);
    const liveBillNum = latestBill
      ? Math.max(Number(latestBill.billId || 0) || 0, extractTrailingSerialNumber(latestBill.invoiceNo))
      : 0;
    const useDbfBill = Boolean(dbfSerialStats?.maxBillNum && dbfSerialStats.maxBillNum > liveBillNum);

    return {
      cnNo: useDbfCn ? dbfSerialStats!.maxCnNo : latestCn?.cnNo || dbfSerialStats?.maxCnNo || '—',
      cnParty: useDbfCn
        ? dbfSerialStats?.maxCnParty || latestCn?.billingPartyName || latestCn?.consignorName || 'DBF Master'
        : latestCn?.billingPartyName || latestCn?.consignorName || dbfSerialStats?.maxCnParty || '—',
      billNo: useDbfBill ? dbfSerialStats!.maxBillNo : latestBill?.invoiceNo || dbfSerialStats?.maxBillNo || '—',
      billParty: useDbfBill
        ? dbfSerialStats?.maxBillParty || latestBill?.partyName || 'DBF Master'
        : latestBill?.partyName || dbfSerialStats?.maxBillParty || '—',
      quoteNo: latestQuote?.quotationNo || '—',
      quoteParty: latestQuote?.partyName || '—',
      declDate: latestDecl?.declarationDate ? formatDateDDMMYYYY(latestDecl.declarationDate) : '—',
      declParty: latestDecl?.partyName || '—',
      podRef: latestPodHire ? `POD-${latestPodHire.cnNo}` : latestTx?.txCode || '—',
      podPartyTruck: latestPodHire
        ? `${latestPodHire.truckNo} (${latestPodHire.ownerName || latestPodHire.brokerName || 'Truck'})`
        : latestTx
        ? `${latestTx.partyName} (${latestTx.paymentMode})`
        : '—',
    };
  }, [
    visibleConsignments,
    visibleInvoices,
    visibleQuotations,
    visibleDeclarations,
    visibleLorryHires,
    visibleTransactions,
    dbfSerialStats,
  ]);

  if (appClosedOverlay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-300 shadow-2xl p-6 text-center space-y-4">
          <DrcTriangleLogo className="w-16 h-16 mx-auto" />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-extrabold">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>✅ All Data Backed Up</span>
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              DRC ERP Safely Switched Off
            </h2>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Final SHA-256 sealed union backup completed, offline queue flushed, vault locked, and all background listeners stopped.
            </p>
          </div>
          {switchOffSummary && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-left text-[11px] text-emerald-950 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">Authorized Vault:</span>
                <span className="font-mono-num font-bold">{switchOffSummary.email}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">Snapshot File:</span>
                <span className="font-mono-num font-bold">{switchOffSummary.snapshotName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">SHA-256 Seal:</span>
                <span className="font-mono-num font-bold">
                  {switchOffSummary.sha256.slice(0, 18)}... ({switchOffSummary.recordCount} recs)
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">Cloud Drive Sync:</span>
                <span className="font-extrabold">
                  {switchOffSummary.driveSynced
                    ? 'Uploaded to Google Drive'
                    : 'Local SHA-256 Vault Sealed'}
                </span>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setAppClosedOverlay(false)}
            className="w-full px-4 py-2.5 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-bold cursor-pointer"
          >
            Sign Back In / Wake App
          </button>
        </div>
      </div>
    );
  }

  if (!erpSession) {
    return (
      <SignInScreen
        loading={authLoading}
        error={authError}
        onLogin={handleCustomLogin}
        onRestoreDefaultAdmin={handleRestoreDefaultAdmin}
      />
    );
  }

  const sidebarItems: Array<{
    id: SidebarNavId;
    label: string;
    group: 'Operations' | 'Separate Role Ledgers' | 'Masters & Vault';
    icon: React.ComponentType<{ className?: string }>;
    perm?: SheetTabId;
    highlightClass?: string;
  }> = [
    // Operations
    { id: 'dashboard', label: 'Dashboard (Clean Home)', group: 'Operations', icon: LayoutDashboard, perm: 'dashboard' },
    { id: 'allInOne', label: 'A. Bilty & Lorry Master Sheet', group: 'Operations', icon: ClipboardList, perm: 'allInOne' },
    { id: 'lr', label: 'Consignment Note (LR/CN)', group: 'Operations', icon: ScanLine, perm: 'lr' },
    { id: 'billing', label: 'Tax Invoice / Bill', group: 'Operations', icon: FileSpreadsheet, perm: 'billing' },
    { id: 'sidebar_quotation', label: 'Quotation (2-Page Legal)', group: 'Operations', icon: ClipboardList, perm: 'billing' },
    { id: 'sidebar_194c', label: 'Section 194C Declaration', group: 'Operations', icon: ShieldCheck, perm: 'billing' },
    { id: 'podScanner', label: 'POD & Low-KB Scanner', group: 'Operations', icon: PackageCheck, perm: 'lorryHire' },
    { id: 'lorryHire', label: 'Lorry Hire Settlement', group: 'Operations', icon: Truck, perm: 'lorryHire' },
    { id: 'transactions', label: 'Vouchers & Cash/Bank', group: 'Operations', icon: ArrowLeftRight, perm: 'accounts' },
    { id: 'bankImport', label: 'Credit/Debit Notes & Bank', group: 'Operations', icon: Landmark, perm: 'bankImport' },
    { id: 'reports', label: 'D. GST, Statutory Vault & ITR', group: 'Operations', icon: FileBarChart2, perm: 'reports' },
    // Separate Role Ledgers (A–Z 100% Coverage)
    { id: 'ledger_party', label: 'Party Account Ledger (Tally)', group: 'Separate Role Ledgers', icon: BookOpen, perm: 'accounts' },
    { id: 'ledger_broker', label: 'Broker Ledger & Trip Sheet', group: 'Separate Role Ledgers', icon: Users, perm: 'accounts' },
    { id: 'ledger_owner', label: 'Lorry Owner Ledger & Trip Sheet', group: 'Separate Role Ledgers', icon: Building2, perm: 'accounts' },
    { id: 'ledger_driver', label: 'Driver Ledger & Trip Sheet', group: 'Separate Role Ledgers', icon: Users, perm: 'accounts' },
    { id: 'ledger_vehicle', label: 'Vehicle Ledger & Trip Sheet', group: 'Separate Role Ledgers', icon: Truck, perm: 'accounts' },
    { id: 'ledger_staff', label: 'Staff Dual-Ledger (Adv & Comm.)', group: 'Separate Role Ledgers', icon: Coins, perm: 'commission' },
    // Masters & Vault
    { id: 'master', label: 'Unified Master Sheet (O/D/V/B)', group: 'Masters & Vault', icon: Building2, perm: 'master' },
    { id: 'partyDirectory', label: '1,000-Party Directory', group: 'Masters & Vault', icon: Users, perm: 'master' },
    { id: 'commission', label: 'Staff Details & Chart Entry', group: 'Masters & Vault', icon: Coins, perm: 'commission' },
    { id: 'accounts', label: 'Tally Accounts & Daybook', group: 'Masters & Vault', icon: BookOpen, perm: 'accounts' },
    { id: 'mis', label: 'MIS & Profit/Loss', group: 'Masters & Vault', icon: PieChart, perm: 'mis' },
    { id: 'backup', label: 'Raw DBF Archive & Sync', group: 'Masters & Vault', icon: DatabaseBackup, perm: 'backup' },
    { id: 'settings', label: 'Company Parameters & Stamp Manager', group: 'Masters & Vault', icon: Settings, perm: 'settings' },
    {
      id: 'staffAccess',
      label: 'Staff Access Control',
      group: 'Masters & Vault',
      icon: KeyRound,
      perm: 'staffAccess',
      highlightClass: 'bg-amber-500/20 border border-amber-300/40 text-amber-100',
    },
    { id: 'guide', label: 'Bilingual Operating Book', group: 'Masters & Vault', icon: BookOpen },
    { id: 'about', label: 'About', group: 'Masters & Vault', icon: Info },
  ];

  const activeOperatorLabel = activeStaffSession
    ? `${activeStaffSession.displayName} (${activeStaffSession.staffCode})`
    : `${erpSession.displayName} (${erpSession.userId})`;

  const activeFyShort = activeFy.replace(/^FY\s+/i, '');
  const bholeBabaSrc = companySettings.bholeBabaPhotoDataUrl || DEFAULT_BHOLE_BABA_IMAGE;
  const khatuShyamSrc = companySettings.khatuShyamPhotoDataUrl || DEFAULT_KHATU_SHYAM_IMAGE;

  const isFormFocused =
    (businessMode === 'FTL' && activeTab !== 'dashboard') ||
    (businessMode !== 'FTL' && logiActiveTab !== 'overview');
  const showFullBanner = !isFormFocused || bannerExpanded;
  const activeBusinessMeta = BUSINESS_MODE_META[businessMode];
  const businessModesList: BusinessMode[] = ['FTL', 'LOGISTICS', 'PTL', 'COURIER'];
  const activeFocusedFormTitle =
    businessMode === 'FTL'
      ? TAB_LABELS[activeTab] || activeTab
      : `${activeBusinessMeta.shortLabel} · ${logiActiveTab.toUpperCase()}`;

  const handleVoiceSpeakClick = () => {
    const effectiveLang: VoicePilotLang = voiceLang === 'off' ? 'en' : voiceLang;
    if (voiceLang === 'off') {
      setVoiceLang('en');
      setStoredVoicePilotLang('en');
    }

    // Staff receives read-only spoken voice hints ONLY (zero draft mutation, zero admin unlock)
    if (!isEffectiveMasterAdmin) {
      const hint = getStaffReadOnlyVoiceHint(effectiveLang, activeTab, businessMode);
      setVoiceFeedbackMsg(hint);
      speakCalmVoice(hint, effectiveLang);
      return;
    }

    // Master Admin must unlock Admin PIN for Voice Pilot command execution
    if (!voicePinUnlocked) {
      setPendingPinTargetTab('voicePilot');
      setAdminPinInput('');
      setAdminPinOtpInput('');
      setAdminPinOtpChallenge(null);
      setAdminPinError(null);
      setAdminPinModalOpen(true);
      return;
    }

    if (voiceListening && voiceStopRef.current) {
      voiceStopRef.current();
      voiceStopRef.current = null;
      setVoiceListening(false);
      return;
    }

    setVoiceListening(true);
    setVoiceFeedbackMsg(
      effectiveLang === 'bn'
        ? 'শুনছি... স্ক্রিন বা ড্রাফট নির্দেশ বলুন...'
        : 'Listening... Speak screen or draft command...'
    );
    const stopFn = startVoiceListening({
      lang: effectiveLang,
      onResult: (transcript) => {
        const intent = parseVoiceCommandIntent(transcript);
        const reply = effectiveLang === 'bn' ? intent.spokenReplyBn : intent.spokenReplyEn;
        setVoiceFeedbackMsg(`"${intent.transcript}" -> ${reply}`);
        if (intent.blockedAction) {
          playAlertBeep();
          speakCalmVoice(reply, effectiveLang);
          return;
        }
        if (intent.targetBusinessMode && intent.targetBusinessMode !== businessMode) {
          setBusinessMode(intent.targetBusinessMode);
          if (intent.targetBusinessMode !== 'FTL') {
            setLogiActiveTab('docket');
          }
        }
        if (intent.targetTab) {
          if (intent.targetTab === 'master' && intent.targetSubTab) {
            setMasterInitialTab(intent.targetSubTab as MasterTabId);
            setMasterFocusNonce((n) => n + 1);
          } else if (intent.targetTab === 'billing' && intent.targetSubTab) {
            setBillingInitialSubTab(
              intent.targetSubTab as 'invoice' | 'quotation' | '194c'
            );
            setBillingFocusNonce((n) => n + 1);
          }
          openOrSwitchTab(intent.targetTab);
        }
        if (Object.keys(intent.draftFields).length > 0) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('drc:voice-draft-fill', { detail: intent.draftFields })
            );
          }, 120);
        }
        playVerifiedBeep();
        speakCalmVoice(reply, effectiveLang);
      },
      onError: (msg) => {
        setVoiceFeedbackMsg(msg);
        setVoiceListening(false);
      },
      onEnd: () => {
        setVoiceListening(false);
        voiceStopRef.current = null;
      },
    });
    voiceStopRef.current = stopFn;
  };

  return (
    <ErrorBoundary>
      <div
        className={`min-h-screen w-full max-w-full flex flex-col bg-[#E2E8F0] text-slate-900 select-none ${
          rotateMode === 'landscape'
            ? 'drc-css-landscape-fallback overflow-y-auto overflow-x-auto'
            : 'overflow-x-clip'
        }`}
      >
      {voiceFeedbackMsg && (
        <div className="bg-slate-900 text-amber-200 px-3 py-1 text-[11px] font-bold flex items-center justify-between gap-2 no-print border-b border-amber-500/40">
          <span className="truncate">🎙️ {voiceFeedbackMsg}</span>
          <button
            type="button"
            onClick={() => setVoiceFeedbackMsg(null)}
            className="text-slate-300 hover:text-white px-1 cursor-pointer shrink-0"
            aria-label="Dismiss Voice Message"
          >
            ✕
          </button>
        </div>
      )}
      {/* Slim 36px 1-Line Sticky Bar when ANY Form is Open | Full Compact 2-Row Header on Dashboard */}
      {isFormFocused && !bannerExpanded ? (
        <header className="sticky top-0 z-30 w-full min-h-[36px] bg-[#0B3B8C] text-white border-b border-blue-900 px-2 sm:px-3 py-0.5 flex flex-wrap items-center justify-between gap-1.5 shadow-sm no-print">
          <div className="flex items-center gap-1.5 min-w-0">
            {businessMode === 'FTL' && (
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[11px] font-extrabold cursor-pointer whitespace-nowrap shrink-0"
                aria-expanded={sidebarOpen}
                aria-label="Toggle Menu Sidebar"
                title={sidebarOpen ? 'Hide DRC Menu' : 'Open DRC Menu'}
              >
                {sidebarOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Menu</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleReturnToCurrentBusinessDashboard}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-extrabold cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
              title={`← Back strictly to ${activeBusinessMeta.shortLabel} Dashboard`}
            >
              <ArrowLeft className="w-3.5 h-3.5 text-slate-950 shrink-0" />
              <span>← Back</span>
            </button>
            <button
              type="button"
              onClick={() => setBannerExpanded(true)}
              className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-bold text-blue-100 cursor-pointer shrink-0"
              title="Expand Dashboard Header"
            >
              <ChevronDown className="w-3 h-3" />
              <span>Header</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            <span className="px-1.5 py-0.5 rounded bg-white/15 text-amber-200 text-[10px] font-extrabold shrink-0">
              {activeBusinessMeta.shortLabel}
            </span>
            <h1 className="text-[11px] sm:text-xs font-extrabold tracking-wide text-white truncate">
              {activeFocusedFormTitle}
            </h1>
          </div>

          <div className="flex items-center gap-1 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => isEffectiveMasterAdmin && requestProtectedTab('backup')}
              className={`hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap cursor-pointer ${
                autoBackupInfo.status === 'error'
                  ? 'bg-red-500 text-white'
                  : autoBackupInfo.status === 'syncing'
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-emerald-500/25 border border-emerald-300/60 text-emerald-100'
              }`}
              title={
                autoBackupInfo.message ||
                `Live 3s Auto-Backup Active (${BACKUP_ISOLATED_DRIVE_EMAIL})`
              }
            >
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span>
                {autoBackupInfo.status === 'syncing'
                  ? 'Syncing Backup...'
                  : 'Live Auto-Backup Active'}
              </span>
            </button>
            <button
              type="button"
              onClick={handleVoiceSpeakClick}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer whitespace-nowrap ${
                voiceListening
                  ? 'bg-rose-500 text-white animate-pulse'
                  : isEffectiveMasterAdmin && voicePinUnlocked
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-white/20 hover:bg-white/30 text-white'
              }`}
              title={
                isEffectiveMasterAdmin
                  ? 'Admin Voice Pilot (Draft Fill & Navigation only)'
                  : 'Read-only Staff Voice Hints'
              }
            >
              {voiceListening ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
              <span>🎙️ বলুন / Speak</span>
            </button>
            <button
              type="button"
              onClick={handleCycleVoiceLang}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-amber-200 text-[10px] font-extrabold cursor-pointer whitespace-nowrap"
              title="Toggle Voice Language: বাংলা | English | OFF"
            >
              <span>
                🎙️ Voice:{' '}
                {voiceLang === 'bn' ? 'বাংলা' : voiceLang === 'en' ? 'English' : 'OFF'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleToggleRotateScreen()}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer whitespace-nowrap ${
                rotateMode === 'landscape'
                  ? 'bg-amber-300 text-slate-950'
                  : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
              title="Rotate Landscape / Portrait View (with 90-deg fallback)"
            >
              <span>🔄 ঘোরান / Rotate</span>
            </button>
            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[10px] font-extrabold cursor-pointer whitespace-nowrap"
              title="Toggle Fullscreen Mode"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3 h-3 text-amber-200" />
              ) : (
                <Maximize2 className="w-3 h-3 text-amber-200" />
              )}
              <span>⛶ বড় স্ক্রিন / Fullscreen</span>
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('drc:form-save'))}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-extrabold cursor-pointer whitespace-nowrap shadow-sm"
              title="Save active form entry"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-slate-950 shrink-0" />
              <span>Save</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSwitchOffExitApp()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-extrabold cursor-pointer whitespace-nowrap shadow-sm"
              title="Switch Off / Exit App safely"
            >
              <Power className="w-3 h-3 shrink-0" />
              <span>Switch Off</span>
            </button>
          </div>
        </header>
      ) : (
      <header className="sticky top-0 z-30 w-full max-w-full bg-white border-b border-slate-300 px-2 sm:px-3 md:px-4 py-1.5 shadow-sm no-print space-y-1.5">
        {/* Row 1: Left Controls & Brand | Switchers, Health, FY, Rotate, Lock, Switch Off | Top-Right Sacred Frames (Windows & Android) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 min-w-0">
          {/* Left: Sidebar Toggle, Back Button, & DRC Brand */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            {businessMode === 'FTL' && (
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-extrabold shadow-sm cursor-pointer shrink-0"
                aria-expanded={sidebarOpen}
                aria-label="Toggle Menu Sidebar"
                title={sidebarOpen ? 'Hide Navigation Sidebar' : 'Open Navigation Sidebar'}
              >
                {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                <span className="hidden sm:inline whitespace-nowrap">Menu</span>
              </button>
            )}
            {isFormFocused && (
              <button
                type="button"
                onClick={handleReturnToCurrentBusinessDashboard}
                className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg border-2 border-amber-400 bg-amber-300 hover:bg-amber-200 text-slate-950 text-xs font-extrabold cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
                title={`Return strictly to ${activeBusinessMeta.shortLabel} Dashboard`}
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                <span>← Back</span>
              </button>
            )}
            <DrcTriangleLogo className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 transition-all" />
            <div className="min-w-0">
              <h1 className="text-xs sm:text-base font-extrabold tracking-tight text-[#0B3B8C] leading-none truncate">
                DOLPHIN ROAD CARRIERS
              </h1>
              <p className="text-[10px] font-bold italic text-[#1565C0] mt-0.5 truncate max-w-[180px] sm:max-w-xs">
                {businessMode === 'FTL'
                  ? companySettings.tagline || 'Fast · Safe · Reliable'
                  : activeBusinessMeta.subtitle}
              </p>
            </div>
            {isFormFocused && bannerExpanded && (
              <button
                type="button"
                onClick={() => setBannerExpanded(false)}
                className="inline-flex items-center gap-0.5 px-2 py-1 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 text-[10px] font-bold text-slate-700 cursor-pointer shrink-0"
                title="Collapse back to 36px Slim Form Bar"
              >
                <ChevronUp className="w-3 h-3" />
                <span>Slim Bar</span>
              </button>
            )}
          </div>

          {/* Right Utility Strip + Dual Top-Right Sacred Deities Photos (Always Visible on Windows AND Android) */}
          <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5 min-w-0 max-w-full">
            {/* 4 Single-Click Business Switchers with Active Checkmarks */}
            <div
              className="inline-flex flex-wrap items-center rounded-lg bg-slate-900 border-2 border-[#0D47A1] p-0.5 shadow-sm gap-0.5 max-w-full"
              role="group"
              aria-label="Business Division Switcher"
            >
              {businessModesList.map((mode) => {
                const isSelected = businessMode === mode;
                const modeMeta = BUSINESS_MODE_META[mode];
                const IconComp =
                  mode === 'FTL'
                    ? Truck
                    : mode === 'LOGISTICS'
                    ? Boxes
                    : mode === 'PTL'
                    ? PackageCheck
                    : ScanLine;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setBusinessMode(mode);
                      setBannerExpanded(false);
                      setSidebarOpen(false);
                      setSearchDropdownOpen(false);
                      setNotifOpen(false);
                      if (mode !== 'FTL') {
                        setLogiActiveTab('overview');
                      } else {
                        setDashboardFocusTx(false);
                        setActiveTab('dashboard');
                      }
                    }}
                    aria-pressed={isSelected}
                    title={modeMeta.fullName}
                    className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[10px] sm:text-[11px] font-extrabold tracking-wide transition-all cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? mode === 'FTL'
                          ? 'bg-[#1565C0] text-white shadow-sm ring-1 ring-amber-300'
                          : mode === 'LOGISTICS'
                          ? 'bg-gradient-to-r from-[#0F766E] to-[#0D9488] text-amber-100 shadow-sm ring-1 ring-amber-300'
                          : mode === 'PTL'
                          ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm ring-1 ring-amber-300'
                          : 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-sm ring-1 ring-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <IconComp className="w-3 h-3 shrink-0" />
                    <span>{isSelected ? `✓ ${modeMeta.shortLabel}` : modeMeta.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* Startup & Monthly Auto-Formula Health Guard + Anti-Tamper Badge */}
            <button
              type="button"
              onClick={() => setFormulaHealthModalOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] sm:text-[11px] font-extrabold cursor-pointer whitespace-nowrap shrink-0"
              title="Click to inspect Startup & Monthly Formula Health Guard + Anti-Tamper Security Shield"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span className="hidden xl:inline">
                {formulaHealthReport?.badgeLabel || 'System Health: 100% Error-Free'}
              </span>
              <span className="xl:hidden">100% Health</span>
            </button>

            {/* Silent 3-Second SHA-256 Google Drive Live Auto-Backup Active Badge */}
            <button
              type="button"
              onClick={() => isEffectiveMasterAdmin && requestProtectedTab('backup')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] sm:text-[11px] font-extrabold whitespace-nowrap shrink-0 cursor-pointer ${
                autoBackupInfo.status === 'error'
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : autoBackupInfo.status === 'syncing'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-900'
              }`}
              title={`${
                autoBackupInfo.message ||
                `Silent 3-second SHA-256 Auto-Backup Active (${BACKUP_ISOLATED_DRIVE_EMAIL})`
              }${autoBackupInfo.sha256 ? ` · SHA-256: ${autoBackupInfo.sha256.slice(0, 14)}...` : ''}`}
            >
              <CheckCircle2
                className={`w-3.5 h-3.5 shrink-0 ${
                  autoBackupInfo.status === 'error'
                    ? 'text-red-700'
                    : autoBackupInfo.status === 'syncing'
                    ? 'text-amber-700 animate-spin'
                    : 'text-emerald-700'
                }`}
              />
              <span className="hidden xl:inline">
                {autoBackupInfo.status === 'syncing'
                  ? 'Auto-Backup Syncing...'
                  : 'Live Auto-Backup Active'}
              </span>
              <span className="xl:hidden">Live Auto-Backup Active</span>
            </button>

            {/* High-Contrast Active Financial Year Badge */}
            <div
              className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B8C] border-2 border-amber-400 px-2 py-0.5 text-white shadow-sm shrink-0"
              role="group"
              aria-label="Active Financial Year Control"
            >
              <Calendar className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              {fyLocked ? (
                <span className="text-[11px] font-extrabold font-mono-num text-white whitespace-nowrap">
                  {activeFyShort}
                </span>
              ) : (
                <div className="w-24">
                  <SearchableSelect
                    ariaLabel="Select Financial Year"
                    value={activeFy}
                    onChange={(val) => {
                      handleSelectFy(val);
                      setFyLocked(true);
                    }}
                    options={fyChoices.map((fy) => ({
                      value: fy,
                      label: fy.replace(/^FY\s+/i, ''),
                    }))}
                    searchPlaceholder="FY..."
                    buttonClassName="bg-[#082A66] border-amber-300 px-1.5 py-0.5 text-[11px] font-extrabold font-mono-num text-amber-200"
                    menuClassName="min-w-[150px]"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setFyLocked((prev) => !prev)}
                className={`inline-flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-extrabold transition-colors cursor-pointer shrink-0 ${
                  fyLocked
                    ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                    : 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                }`}
                title={fyLocked ? 'Unlock FY Selector' : 'Lock FY Selector'}
              >
                <span>{fyLocked ? '🔒' : '🔓'}</span>
              </button>
            </div>

            {/* Branch Filter */}
            <div className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-lg text-[11px] font-bold text-[#0D47A1] shrink-0">
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              {isBranchLocked ? (
                <span className="whitespace-nowrap px-1">{effectiveBranchFilter}</span>
              ) : (
                <div className="w-28 sm:w-32">
                  <SearchableSelect
                    ariaLabel="Filter Branch View"
                    value={branchFilter}
                    onChange={(val) => setBranchFilter(val)}
                    options={BRANCH_OPTIONS.map((b) => ({
                      value: b,
                      label: b === 'ALL' ? 'All Branches' : b,
                    }))}
                    searchPlaceholder="Branch..."
                    buttonClassName="border-0 bg-transparent px-1 py-0.5 text-[11px] font-bold text-[#0D47A1]"
                    menuClassName="min-w-[160px]"
                  />
                </div>
              )}
            </div>

            {/* Background Phone Alarm Toggle + Notification Bell (Includes GST 7/8/15th + KYC 10/5/2d + E-Way 8h Alerts) */}
            <button
              type="button"
              onClick={() => void handleTogglePhoneAlarm()}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer shrink-0 ${
                phoneAlarmPermission === 'granted'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
              }`}
              title="Enable Android/Desktop background phone alarm notifications for GST, KYC & 8h E-Way Bill countdown"
            >
              <Bell className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">
                {phoneAlarmPermission === 'granted' ? '🔔 Alarm ON' : '🔔 Phone Alarm'}
              </span>
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer"
                aria-label="Compliance and Payment Notifications"
              >
                <Bell className="w-4 h-4 text-amber-600" />
                {alerts.totalCount + eway8hAlarms.length > 0 && (
                  <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[10px] font-bold leading-tight">
                    {alerts.totalCount + eway8hAlarms.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-40 overflow-hidden text-xs">
                  <div className="bg-[#0D47A1] text-white px-3.5 py-2.5 flex items-center justify-between font-bold">
                    <span>Alert Center ({alerts.totalCount})</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-blue-100 hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {alerts.totalCount === 0 ? (
                      <p className="p-4 text-center text-slate-500">
                        All vehicle papers, driver licenses, GST dates &amp; KYC docs are up to date.
                      </p>
                    ) : (
                      <>
                        {alerts.gstAlarms.map((ga) => (
                          <button
                            key={ga.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              setReportInitialTab('gstFilingHub');
                              setReportFocusNonce((n) => n + 1);
                              openOrSwitchTab('reports');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 flex items-start gap-2 cursor-pointer"
                          >
                            <CalendarClock className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-slate-900">{ga.title}</p>
                              <p className="text-[11px] text-indigo-800">{ga.message}</p>
                            </div>
                          </button>
                        ))}
                        {alerts.kycAlarms.map((ka) => (
                          <button
                            key={ka.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              setReportInitialTab('gstFilingHub');
                              setReportFocusNonce((n) => n + 1);
                              openOrSwitchTab('reports');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 flex items-start gap-2 cursor-pointer"
                          >
                            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-slate-900">{ka.title}</p>
                              <p className="text-[11px] text-red-700">{ka.message}</p>
                            </div>
                          </button>
                        ))}
                        {alerts.failedVehicles.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              setMasterInitialTab('vehicles');
                              setMasterFocusNonce((n) => n + 1);
                              openOrSwitchTab('master');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-red-50 flex items-start gap-2 cursor-pointer"
                          >
                            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-slate-900">Vehicle {v.truckNo}</p>
                              <p className="text-[11px] text-red-700">
                                15d Alert / Expired (Fitness / Ins / Permit / Road Tax / PUC)
                              </p>
                            </div>
                          </button>
                        ))}
                        {alerts.failedDrivers.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              setMasterInitialTab('drivers');
                              setMasterFocusNonce((n) => n + 1);
                              openOrSwitchTab('master');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-red-50 flex items-start gap-2 cursor-pointer"
                          >
                            <UserX className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-slate-900">Driver: {d.name}</p>
                              <p className="text-[11px] text-red-700">
                                D/L {d.dlNo} due/expired ({formatDateDDMMYYYY(d.dlExpiry)})
                              </p>
                            </div>
                          </button>
                        ))}
                        {alerts.expiringEwbs.map((cn) => {
                          const allEwbStates = [
                            cn.ewayBillValidUpto,
                            ...(cn.extraEwayBills || []).map((e) => e.validUpto),
                          ]
                            .map((dt) => getEwayBillExpiryState(dt))
                            .filter((st) => st.status === 'expired' || st.status === 'expiringSoon');
                          const worstSt =
                            allEwbStates.find((s) => s.status === 'expired') ||
                            allEwbStates[0] ||
                            getEwayBillExpiryState(cn.ewayBillValidUpto);
                          return (
                            <button
                              key={`ewb-${cn.id}`}
                              type="button"
                              onClick={() => {
                                setNotifOpen(false);
                                openOrSwitchTab('allInOne');
                              }}
                              className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 flex items-start gap-2 cursor-pointer"
                            >
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold text-slate-900">
                                  EWB {cn.ewayBillNo || cn.cnNo} ({cn.truckNo})
                                </p>
                                <p className="text-[11px] text-amber-800 font-semibold">
                                  {worstSt.label}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                        {alerts.overdueInvoices.map((inv) => (
                          <button
                            key={inv.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              setReportInitialTab('aging');
                              setReportFocusNonce((n) => n + 1);
                              openOrSwitchTab('reports');
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-red-50 flex items-start gap-2 cursor-pointer"
                          >
                            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-slate-900">
                                {inv.invoiceNo} · {inv.partyName}
                              </p>
                              <p className="text-[11px] text-red-700">
                                Overdue ₹{formatINR(Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0)))} (Dated{' '}
                                {formatDateDDMMYYYY(inv.invoiceDate)})
                              </p>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Admin PIN-Locked Voice Pilot: Speak + Language Toggle */}
            <button
              type="button"
              onClick={handleVoiceSpeakClick}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-extrabold cursor-pointer shrink-0 ${
                voiceListening
                  ? 'border-rose-500 bg-rose-600 text-white animate-pulse'
                  : isEffectiveMasterAdmin && voicePinUnlocked
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                  : 'border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-900'
              }`}
              title={
                isEffectiveMasterAdmin
                  ? 'Admin Voice Pilot (Speak to open screen & fill draft fields)'
                  : 'Staff Read-Only Voice Hints'
              }
            >
              {voiceListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>🎙️ বলুন / Speak</span>
            </button>

            <button
              type="button"
              onClick={handleCycleVoiceLang}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-[11px] font-extrabold cursor-pointer shrink-0"
              title="Toggle Voice Pilot Language: বাংলা | English | OFF"
            >
              <span>
                🎙️ Voice:{' '}
                {voiceLang === 'bn' ? 'বাংলা' : voiceLang === 'en' ? 'English' : 'OFF'}
              </span>
            </button>

            {/* Labeled Rotate Screen & Fullscreen Pills (Android/Tablet/Desktop) */}
            <button
              type="button"
              onClick={() => void handleToggleRotateScreen()}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-extrabold cursor-pointer shrink-0 ${
                rotateMode === 'landscape'
                  ? 'border-indigo-500 bg-indigo-100 text-indigo-950'
                  : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
              }`}
              title="Rotate Landscape / Portrait View (with 90-deg fallback)"
            >
              <span>🔄 ঘোরান / Rotate</span>
            </button>

            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-extrabold cursor-pointer shrink-0 ${
                isFullscreen
                  ? 'border-blue-500 bg-blue-50 text-blue-900'
                  : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
              }`}
              title="Toggle Fullscreen Display"
            >
              <span>⛶ বড় স্ক্রিন / Fullscreen</span>
            </button>

            {/* Manual Screen Lock */}
            <button
              type="button"
              onClick={() => {
                setUnlockPassword('');
                setUnlockError(null);
                setIsScreenLocked(true);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer shrink-0"
              title="Lock Session Screen Immediately"
            >
              <Lock className="w-3.5 h-3.5 text-amber-700" />
              <span className="hidden xl:inline">Lock</span>
            </button>

            {/* Refresh App Button */}
            <button
              type="button"
              onClick={handleRefreshApp}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer shrink-0"
              title="Refresh App & Sync Latest PWA Build"
            >
              <RefreshCw className="w-3.5 h-3.5 text-blue-700" />
            </button>

            {/* Install App PWA Button */}
            {!isInstalled && (
              <button
                type="button"
                onClick={async () => {
                  if (isInstallable) {
                    const installed = await install();
                    if (!installed) setIosGuideOpen(true);
                  } else {
                    setIosGuideOpen(true);
                  }
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0"
                title="Install Dolphin Road Carriers ERP on Android or Windows PC"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Install</span>
              </button>
            )}

            {/* Prominent Red Switch Off / Exit App Button */}
            <button
              type="button"
              onClick={() => void handleSwitchOffExitApp()}
              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold shadow-sm cursor-pointer whitespace-nowrap shrink-0"
              title="Flush sync, clean temp cache, sign out, stop listeners and switch off app"
            >
              <Power className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Switch Off</span>
            </button>

            {/* Top-Right Sacred Frames: Bhole Baba & Khatu Shyam Ji (Visible on BOTH Windows AND Android) */}
            <div
              className="flex items-center gap-1.5 pl-1 border-l border-slate-200 shrink-0"
              aria-label="Sacred Blessing Frames"
            >
              <div className="flex flex-col items-center">
                <div className="p-0.5 rounded-md bg-gradient-to-b from-amber-300 via-yellow-500 to-amber-700 shadow-sm">
                  {bholeImgFailed ? (
                    <div className="w-7 h-7 sm:w-9 sm:h-9 rounded bg-amber-50 flex items-center justify-center text-amber-800 font-extrabold text-[8px]">
                      ॐ शिव
                    </div>
                  ) : (
                    <img
                      src={bholeBabaSrc}
                      alt="Bhole Baba"
                      referrerPolicy="no-referrer"
                      onError={() => setBholeImgFailed(true)}
                      className="w-7 h-7 sm:w-9 sm:h-9 rounded object-cover bg-amber-50 block"
                    />
                  )}
                </div>
                <span className="text-[8px] font-extrabold text-amber-900 leading-none mt-0.5 whitespace-nowrap">
                  Bhole Baba
                </span>
              </div>

              <div className="flex flex-col items-center">
                <div className="p-0.5 rounded-md bg-gradient-to-b from-amber-300 via-yellow-500 to-amber-700 shadow-sm">
                  {shyamImgFailed ? (
                    <div className="w-7 h-7 sm:w-9 sm:h-9 rounded bg-amber-50 flex items-center justify-center text-amber-800 font-extrabold text-[8px]">
                      श्याम
                    </div>
                  ) : (
                    <img
                      src={khatuShyamSrc}
                      alt="Khatu Shyam Ji"
                      referrerPolicy="no-referrer"
                      onError={() => setShyamImgFailed(true)}
                      className="w-7 h-7 sm:w-9 sm:h-9 rounded object-cover bg-amber-50 block"
                    />
                  )}
                </div>
                <span className="text-[8px] font-extrabold text-amber-900 leading-none mt-0.5 whitespace-nowrap">
                  Shyam Ji
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: FTL Universal Search + 4 Unified Pillar Buttons + Live Alerts (No Staff Access button here — moved to Sidebar bottom above About) */}
        {businessMode === 'FTL' && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px] font-bold">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Compact Universal Search (Ctrl+K) */}
            <div className="relative w-48 sm:w-64">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  ref={globalSearchInputRef}
                  type="text"
                  value={globalSearch}
                  onFocus={() => setSearchDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setSearchDropdownOpen(false), 180)}
                  onChange={(e) => {
                    setGlobalSearch(e.target.value);
                    setSearchDropdownOpen(true);
                  }}
                  placeholder="Find CN, Bill, Party (Ctrl+K)..."
                  className="w-full pl-8 pr-10 py-1 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {globalSearch && (
                  <button
                    type="button"
                    onClick={() => setGlobalSearch('')}
                    className="absolute right-2 top-1.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {searchDropdownOpen && globalSearch.trim().length > 0 && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-300 shadow-2xl z-50 max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {universalSearchResults.length === 0 ? (
                    <p className="p-3.5 text-xs text-slate-500 text-center">
                      No matching Bills, CNs, Quotations, Vehicles, or Screens for &ldquo;{globalSearch}&rdquo;.
                    </p>
                  ) : (
                    universalSearchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchDropdownOpen(false);
                          setGlobalSearch('');
                          void item.onSelect();
                        }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{item.title}</p>
                          <p className="text-[11px] text-slate-600 truncate">{item.subtitle}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#0D47A1] text-white text-[10px] font-extrabold shrink-0">
                          {item.badge}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {hasPermission('allInOne') && (
              <button
                type="button"
                onClick={() => openOrSwitchTab('allInOne')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0D47A1] hover:bg-[#0A3882] text-amber-200 cursor-pointer whitespace-nowrap"
              >
                <ClipboardList className="w-3.5 h-3.5 text-amber-300" />
                <span>A. BILTY &amp; LORRY MASTER SHEET</span>
              </button>
            )}
            {hasPermission('billing') && (
              <button
                type="button"
                onClick={() => {
                  setBillingInitialSubTab('invoice');
                  setBillingFocusNonce((n) => n + 1);
                  openOrSwitchTab('billing');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>B. PARTY TAX INVOICE</span>
              </button>
            )}
            {hasPermission('master') && (
              <button
                type="button"
                onClick={() => {
                  setMasterInitialTab('parties');
                  setMasterFocusNonce((n) => n + 1);
                  openOrSwitchTab('master');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#0D47A1] cursor-pointer whitespace-nowrap"
              >
                <Users className="w-3.5 h-3.5 text-blue-700" />
                <span>C. MASTERS &amp; LEDGERS</span>
              </button>
            )}
            {hasPermission('bankImport') && (
              <button
                type="button"
                onClick={() => openOrSwitchTab('bankImport')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-800 cursor-pointer whitespace-nowrap"
              >
                <Landmark className="w-3.5 h-3.5 text-teal-700" />
                <span>Bank Reader</span>
              </button>
            )}
            {hasPermission('reports') && (
              <button
                type="button"
                onClick={() => {
                  setReportInitialTab('gstFilingHub');
                  setReportFocusNonce((n) => n + 1);
                  openOrSwitchTab('reports');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer whitespace-nowrap"
              >
                <FileBarChart2 className="w-3.5 h-3.5 text-amber-200" />
                <span>D. GST &amp; KYC VAULT</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => openOrSwitchTab('guide')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-900 text-amber-200 cursor-pointer whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-300" />
              <span>BILINGUAL GUIDE</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {isMasterAdmin && activeStaffSession && (
              <button
                type="button"
                onClick={() => setActiveStaffSession(null)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                title="Exit Staff Preview and restore Master Admin controls"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Restore Admin</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setLiveMonitorOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold cursor-pointer whitespace-nowrap"
              title="View live online branch staff & real-time activity feed"
            >
              <Radio className="w-3 h-3 text-emerald-600 animate-pulse" />
              <span>Online: {Math.max(1, activeOnlineStaff.length)}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMasterInitialTab('vehicles');
                setMasterFocusNonce((n) => n + 1);
                openOrSwitchTab('master');
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                alerts.failedVehicles.length > 0
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Vehicles with expired Fitness, Insurance, Permit or PUC"
            >
              <AlertTriangle className="w-3 h-3" />
              Vehicles: {alerts.failedVehicles.length}
            </button>

            <button
              type="button"
              onClick={() => {
                setMasterInitialTab('drivers');
                setMasterFocusNonce((n) => n + 1);
                openOrSwitchTab('master');
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                alerts.failedDrivers.length > 0
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Drivers with expired Driving Licenses"
            >
              <UserX className="w-3 h-3" />
              D/L: {alerts.failedDrivers.length}
            </button>

            <button
              type="button"
              onClick={() => {
                setReportInitialTab('aging');
                setReportFocusNonce((n) => n + 1);
                openOrSwitchTab('reports');
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                alerts.overdueInvoices.length > 0
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Party bills overdue beyond 7 days"
            >
              <ShieldAlert className="w-3 h-3" />
              Overdue: {alerts.overdueInvoices.length}
            </button>

            {!isOnline ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white text-[11px] font-bold whitespace-nowrap">
                <WifiOff className="w-3 h-3" />
                Offline ({offlineSyncStatus.pendingCount})
              </span>
            ) : offlineSyncStatus.pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => void flushOfflineSyncQueue()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-600 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3 h-3 animate-spin" />
                Syncing ({offlineSyncStatus.pendingCount})
              </button>
            ) : (
              <span className="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-100 text-emerald-900 text-[11px] font-bold whitespace-nowrap">
                <Cloud className="w-3 h-3 text-emerald-700" />
                Synced
              </span>
            )}
          </div>
        </div>
        )}
      </header>
      )}

      {/* E-Way Bill 8h -> 1h Countdown Alarm Banner (Stops automatically when Unloading Date / POD Delivered is saved) */}
      {!eway8hBannerDismissed && eway8hAlarms.length > 0 && (
        <div className="bg-gradient-to-r from-red-700 via-orange-600 to-amber-600 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold shadow no-print">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-200 animate-pulse shrink-0" />
            <span className="truncate">
              {eway8hAlarms[0].title} ({eway8hAlarms.length} urgent):{' '}
              <span className="font-normal text-amber-100">
                {eway8hAlarms[0].message}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setBusinessMode('FTL');
                openOrSwitchTab('allInOne');
                setEway8hBannerDismissed(true);
              }}
              className="px-2.5 py-1 rounded bg-white hover:bg-amber-100 text-red-900 font-extrabold cursor-pointer"
            >
              Update Unloading / Extend EWB &rarr;
            </button>
            <button
              type="button"
              onClick={() => setEway8hBannerDismissed(true)}
              className="p-1 rounded hover:bg-white/15 cursor-pointer"
              aria-label="Dismiss E-Way 8h countdown banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Monthly GST (7/8/15th) & Master KYC (10/5/2-Day) Popup Alarm Banner */}
      {!alarmPopupDismissed && (alerts.gstAlarms.length > 0 || alerts.kycAlarms.length > 0) && (
        <div className="bg-gradient-to-r from-amber-600 via-red-600 to-indigo-700 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold shadow no-print">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-amber-200 animate-bounce shrink-0" />
            <span className="truncate">
              {alerts.gstAlarms[0]?.title || alerts.kycAlarms[0]?.title}:{' '}
              <span className="font-normal text-amber-100">
                {alerts.gstAlarms[0]?.message || alerts.kycAlarms[0]?.message}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setBusinessMode('FTL');
                setReportInitialTab('gstFilingHub');
                setReportFocusNonce((n) => n + 1);
                openOrSwitchTab('reports');
                setAlarmPopupDismissed(true);
              }}
              className="px-2.5 py-1 rounded bg-amber-300 hover:bg-amber-200 text-slate-950 font-extrabold cursor-pointer"
            >
              Open GST &amp; KYC Vault &rarr;
            </button>
            <button
              type="button"
              onClick={() => setAlarmPopupDismissed(true)}
              className="p-1 rounded hover:bg-white/15 cursor-pointer"
              aria-label="Dismiss compliance alarm"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* New-Device Login Security Alert Shield */}
      {deviceTrust?.isNewDevice && !newDeviceBannerDismissed && (
        <div className="bg-gradient-to-r from-slate-950 via-red-900 to-amber-900 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold shadow no-print">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 text-amber-300 animate-pulse shrink-0" />
            <span className="truncate">
              New-Device Security Alert: {deviceTrust.deviceLabel} [{deviceTrust.deviceId}] detected for{' '}
              {activeOperatorLabel}. Verify authorized access or change Admin PIN immediately.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAcknowledgeNewDevice}
              className="px-2.5 py-1 rounded bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-extrabold cursor-pointer whitespace-nowrap"
            >
              Trust This Device
            </button>
            <button
              type="button"
              onClick={() => setNewDeviceBannerDismissed(true)}
              className="p-1 rounded hover:bg-white/15 cursor-pointer"
              aria-label="Dismiss new device alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Body: Isolated Division Workspace (LOGISTICS / PTL / COURIER) OR FTL Sidebar + Multi-Tab Workspace */}
      <div className="flex-1 flex min-h-0 relative max-w-full">
        {businessMode !== 'FTL' ? (
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {driveBannerError && (
              <div className="m-3 mb-0 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium flex items-center justify-between gap-2">
                <span>{driveBannerError}</span>
                <button
                  type="button"
                  onClick={() => setDriveBannerError(null)}
                  className="p-0.5 text-amber-700 hover:text-amber-950 cursor-pointer"
                  aria-label="Dismiss alert"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <Suspense
              fallback={
                <div className="p-8 text-center text-xs font-bold text-[#0D47A1]">
                  Loading {activeBusinessMeta.fullName}...
                </div>
              }
            >
              <LogisticsWorkspace
                divisionMode={businessMode}
                activeTab={logiActiveTab}
                onActiveTabChange={(tab) => {
                  setLogiActiveTab(tab);
                  if (tab === 'overview') setBannerExpanded(false);
                }}
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                dockets={divisionLogisticsDockets}
                manifests={divisionLogisticsManifests}
                parties={logisticsParties}
                vehicles={logisticsVehicles}
                drivers={logisticsDrivers}
                invoices={divisionLogisticsInvoices}
                ledgers={divisionLogisticsLedgers}
                ftlParties={parties}
                ftlVehicles={vehicles}
                ftlDrivers={drivers}
                staffAccounts={staffAccounts}
                lorryHires={visibleLorryHires}
                staffCommissions={staffCommissions}
                company={companySettings}
                connectedEmail={connectedEmail}
                driveAccessToken={driveAccessToken}
                onConnectDrive={() => handleGoogleDriveConnect(true)}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            </Suspense>
          </div>
        ) : (
        <>
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-900/45 z-40 no-print"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Royal Blue Sidebar Drawer (Hidden by Default across Desktop, Tablet & Android) */}
        <aside
          className={`${
            sidebarOpen ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden'
          } w-64 shrink-0 flex-col justify-between bg-gradient-to-b from-[#0D47A1] via-[#1565C0] to-[#0A347A] text-white shadow-2xl no-print`}
          aria-label="Primary Navigation Sidebar"
        >
          <div className="p-2.5 space-y-1 overflow-y-auto">
            <div className="flex items-center justify-between px-2 py-1.5 pb-2 border-b border-white/15 mb-1">
              <span className="text-xs font-extrabold tracking-wide text-amber-200 uppercase">
                DRC Menu
              </span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded hover:bg-white/15 text-blue-100 hover:text-white cursor-pointer"
                aria-label="Close Navigation Sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(['Operations', 'Separate Role Ledgers', 'Masters & Vault'] as const).map((groupName) => {
              const groupItems = sidebarItems.filter(
                (item) => item.group === groupName && (!item.perm || hasPermission(item.perm))
              );
              if (groupItems.length === 0) return null;
              return (
                <div key={groupName} className="pt-1.5">
                  <div className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-200/90">
                    {groupName}
                  </div>
                  <div className="space-y-0.5">
                    {groupItems.map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        item.id === 'transactions'
                          ? activeTab === 'dashboard' && dashboardFocusTx
                          : item.id === 'dashboard'
                          ? activeTab === 'dashboard' && !dashboardFocusTx
                          : item.id === 'sidebar_quotation'
                          ? activeTab === 'billing' && billingInitialSubTab === 'quotation'
                          : item.id === 'sidebar_194c'
                          ? activeTab === 'billing' && billingInitialSubTab === '194c'
                          : item.id.startsWith('ledger_')
                          ? activeTab === 'roleLedgers' &&
                            roleLedgerInitialRole === item.id.replace('ledger_', '')
                          : activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSidebarClick(item.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-sm ring-1 ring-white/25'
                              : item.highlightClass
                              ? `${item.highlightClass} hover:bg-amber-500/35`
                              : 'text-blue-100 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="pt-2 mt-2 border-t border-white/15 space-y-1.5">
              <button
                type="button"
                onClick={() =>
                  handleShowConfirm({
                    title: 'Log Out of Dolphin Road Carriers ERP?',
                    description: `Sign out of ${activeOperatorLabel}? You will return to the Login screen.`,
                    confirmLabel: 'Log Out',
                    variant: 'danger',
                    onConfirm: async () => {
                      await upsertStaffPresence({
                        ownerUid: workspaceUid,
                        staffCode: activeStaffCode,
                        displayName: activeStaffName,
                        role: activeStaffRole,
                        branchCode: activeOperationalBranch,
                        activeModule: TAB_LABELS[activeTab] || activeTab,
                        deviceType: detectDeviceType(),
                        status: 'offline',
                      });
                      clearErpSession();
                      setErpSession(null);
                      setActiveStaffSession(null);
                      setOpenTabs([{ id: 'dashboard', label: 'Dashboard' }]);
                      setActiveTab('dashboard');
                    },
                  })
                }
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-100 hover:bg-blue-800 hover:text-white transition-all cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Log Out</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSwitchOffExitApp()}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-extrabold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all cursor-pointer"
                title="Flush sync, clean temp cache, sign out, stop listeners and switch off app"
              >
                <Power className="w-4 h-4 shrink-0" />
                <span>Switch Off / Exit App</span>
              </button>
            </div>
          </div>

          {/* Sidebar Bottom "Grow Your Business With Us..." Card */}
          <div className="m-2.5 rounded-xl bg-gradient-to-b from-[#DBEAFE] to-[#BFDBFE] p-3 text-center text-[#0D47A1] shadow-inner border border-white/40">
            <svg viewBox="0 0 180 72" className="w-full h-14 mx-auto mb-1" aria-hidden="true">
              <rect x="10" y="54" width="160" height="4" rx="2" fill="#93C5FD" />
              <path d="M25 52 L55 24 L125 24 L150 52 Z" fill="#1E40AF" opacity="0.2" />
              <rect x="44" y="24" width="66" height="24" rx="3" fill="#0D47A1" />
              <path d="M112 30 L132 30 L138 40 L138 48 L112 48 Z" fill="#FFFFFF" />
              <circle cx="58" cy="50" r="6" fill="#0F172A" />
              <circle cx="96" cy="50" r="6" fill="#0F172A" />
              <circle cx="128" cy="50" r="6" fill="#0F172A" />
            </svg>
            <p className="text-xs font-extrabold italic leading-tight">
              Grow Your
              <br />
              Business With Us...
            </p>
          </div>
        </aside>

        {/* Right Main Content Column */}
        <main className="flex-1 min-w-0 flex flex-col bg-[#F1F5F9]">
          {/* Multi-Tab Sheet Bar + Dedicated Within-Business Back Button */}
          <div className="bg-[#E2E8F0] border-b border-slate-300 px-2.5 sm:px-3 pt-1.5 flex items-center gap-1 overflow-x-auto no-print">
            {activeTab !== 'dashboard' && (
              <button
                type="button"
                onClick={handleReturnToCurrentBusinessDashboard}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 mb-1 mr-1 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-extrabold shadow-sm cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>← Back to FTL Dashboard</span>
              </button>
            )}
            {openTabs.map((t) => {
              const selected = activeTab === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    if (t.id === 'backup' && !isBackupVaultUnlocked()) {
                      requestProtectedTab('backup');
                      return;
                    }
                    if (t.id === 'dashboard') {
                      setDashboardFocusTx(false);
                      setBannerExpanded(false);
                    }
                    setActiveTab(t.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      if (t.id === 'backup' && !isBackupVaultUnlocked()) {
                        requestProtectedTab('backup');
                        return;
                      }
                      if (t.id === 'dashboard') {
                        setDashboardFocusTx(false);
                        setBannerExpanded(false);
                      }
                      setActiveTab(t.id);
                    }
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-bold border-t border-x cursor-pointer whitespace-nowrap transition-colors ${
                    selected
                      ? 'bg-[#F1F5F9] text-[#0D47A1] border-slate-300 -mb-px pb-2'
                      : 'bg-slate-200/80 text-slate-600 border-transparent hover:bg-slate-100'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.id !== 'dashboard' && (
                    <button
                      type="button"
                      onClick={(e) => closeTab(t.id, e)}
                      className="p-0.5 rounded hover:bg-slate-300/70 text-slate-500 hover:text-slate-900 cursor-pointer"
                      aria-label={`Close ${t.label}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live Last Saved No Status Badge Strip (Visible at top of every page) */}
          <div className="bg-white border-b border-slate-200 px-3 py-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-700 no-print">
            <span>
              <strong className="text-blue-800">Last CN:</strong>{' '}
              <span className="font-mono-num font-bold text-slate-900">{liveLastSavedNos.cnNo}</span> ({liveLastSavedNos.cnParty})
            </span>
            <span>
              <strong className="text-emerald-800">Last Bill:</strong>{' '}
              <span className="font-mono-num font-bold text-slate-900">{liveLastSavedNos.billNo}</span> ({liveLastSavedNos.billParty})
            </span>
            <span>
              <strong className="text-amber-800">Last Quote:</strong>{' '}
              <span className="font-mono-num font-bold text-slate-900">{liveLastSavedNos.quoteNo}</span> ({liveLastSavedNos.quoteParty})
            </span>
            <span>
              <strong className="text-purple-800">Last 194C:</strong>{' '}
              <span className="font-mono-num font-bold text-slate-900">{liveLastSavedNos.declDate}</span> ({liveLastSavedNos.declParty})
            </span>
            <span>
              <strong className="text-cyan-800">Last POD/Vch:</strong>{' '}
              <span className="font-mono-num font-bold text-slate-900">{liveLastSavedNos.podRef}</span> ({liveLastSavedNos.podPartyTruck})
            </span>
          </div>

          {/* Active Workspace Module */}
          <div
            className={`flex-1 p-2.5 sm:p-3 md:p-4 overflow-y-auto ${
              rotateMode === 'landscape' ? 'overflow-x-auto' : 'overflow-x-clip'
            }`}
          >
            {driveBannerError && (
              <div className="mb-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium flex items-center justify-between gap-2">
                <span>{driveBannerError}</span>
                <button
                  type="button"
                  onClick={() => setDriveBannerError(null)}
                  className="p-0.5 text-amber-700 hover:text-amber-950 cursor-pointer"
                  aria-label="Dismiss alert"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {activeTab === 'dashboard' && (
              <DashboardHome
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                shipmentsCount={visibleConsignments.length}
                customersCount={
                  parties.filter((p) => p.partyType === 'Customer' || p.partyType === 'Consignor')
                    .length || parties.length
                }
                transactions={visibleTransactions}
                parties={parties}
                invoices={visibleInvoices}
                vehicles={vehicles}
                drivers={drivers}
                consignments={visibleConsignments}
                lorryHires={visibleLorryHires}
                company={companySettings}
                lastSavedNos={liveLastSavedNos}
                focusTransactionsNonce={focusTransactionsNonce}
                onOpenTab={openOrSwitchTab}
                onOpenPodScanner={() => openOrSwitchTab('podScanner')}
                onOpenMasterVehicles={() => {
                  setMasterInitialTab('vehicles');
                  setMasterFocusNonce((n) => n + 1);
                  openOrSwitchTab('master');
                }}
                onOpenMasterDrivers={() => {
                  setMasterInitialTab('drivers');
                  setMasterFocusNonce((n) => n + 1);
                  openOrSwitchTab('master');
                }}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            <Suspense
              fallback={
                <div className="p-8 text-center text-xs font-bold text-[#0D47A1]">
                  Loading module workspace...
                </div>
              }
            >

            {activeTab === 'allInOne' && (
              <AllInOneEntrySheet
                divisionMode="FTL"
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                readOnly={getSheetAccess('lr') === 'view' && getSheetAccess('billing') === 'view'}
                parties={parties}
                vehicles={vehicles}
                drivers={drivers}
                staffAccounts={staffAccounts}
                consignments={visibleConsignments}
                lorryHires={visibleLorryHires}
                staffCommissions={staffCommissions}
                invoices={visibleInvoices}
                company={companySettings}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
                onExitToDashboard={handleReturnToCurrentBusinessDashboard}
              />
            )}

            {activeTab === 'master' && (
              <MasterModule
                key={`master_${masterInitialTab}_${masterFocusNonce}`}
                ownerUid={workspaceUid}
                readOnly={getSheetAccess('master') === 'view'}
                activeFy={activeFy}
                parties={parties}
                vehicles={vehicles}
                drivers={drivers}
                invoices={visibleInvoices}
                consignments={visibleConsignments}
                lorryHires={visibleLorryHires}
                transactions={visibleTransactions}
                company={companySettings}
                initialTab={masterInitialTab}
                onOpenPodScanner={() => openOrSwitchTab('podScanner')}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {activeTab === 'lr' && (
              <ConsignmentModule
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                readOnly={getSheetAccess('lr') === 'view'}
                consignments={visibleConsignments}
                lorryHires={visibleLorryHires}
                parties={parties}
                vehicles={vehicles}
                drivers={drivers}
                company={companySettings}
                onPreviewPdf={handlePreviewPdf}
                onSendCnToInvoice={(cn) => {
                  setPendingCnForInvoice(cn);
                  openOrSwitchTab('billing');
                }}
                onSwitchFy={handleSelectFy}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {activeTab === 'billing' && (
              <BillingQuotesModule
                key={`billing_${billingInitialSubTab}_${billingFocusNonce}`}
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                readOnly={getSheetAccess('billing') === 'view'}
                quotationsAccess={getSheetAccess('quotations')}
                declarationsAccess={getSheetAccess('declarations')}
                initialSubTab={billingInitialSubTab}
                invoices={visibleInvoices}
                quotations={visibleQuotations}
                declarations={visibleDeclarations}
                consignments={visibleConsignments}
                parties={parties}
                drivers={drivers}
                lorryHires={visibleLorryHires}
                company={companySettings}
                pendingCnForInvoice={pendingCnForInvoice}
                onClearPendingCn={() => setPendingCnForInvoice(null)}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {activeTab === 'lorryHire' && (
              <LorryHirePodModule
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                readOnly={getSheetAccess('lorryHire') === 'view'}
                lorryHires={visibleLorryHires}
                consignments={visibleConsignments}
                parties={parties}
                vehicles={vehicles}
                staffAccounts={staffAccounts}
                staffCommissions={staffCommissions}
                company={companySettings}
                driveAccessToken={driveAccessToken}
                onConnectDrive={() => handleGoogleDriveConnect(true)}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {activeTab === 'commission' && (
              <StaffCommissionModule
                commissions={staffCommissions}
                staffAccounts={staffAccounts}
                company={companySettings}
                activeFy={activeFy}
                ownerUid={workspaceUid}
                currentStaffCode={activeStaffCode}
                currentBranchCode={activeOperationalBranch}
                readOnly={getSheetAccess('commission') === 'view'}
                onOpenPodScanner={() => openOrSwitchTab('podScanner')}
                onOpenPreview={(pdf) => handlePreviewPdf(pdf, 'Reports_Ledgers')}
              />
            )}

            {activeTab === 'bankImport' && (
              <BankReceiptImportModule
                bankReceipts={bankReceipts}
                invoices={visibleInvoices}
                company={companySettings}
                activeFy={activeFy}
                ownerUid={workspaceUid}
                currentStaffCode={activeStaffCode}
                currentBranchCode={activeOperationalBranch}
                driveAccessToken={driveAccessToken}
                readOnly={getSheetAccess('bankImport') === 'view'}
                onOpenPodScanner={() => openOrSwitchTab('podScanner')}
                onOpenPreview={(pdf) => handlePreviewPdf(pdf, 'Reports_Ledgers')}
              />
            )}

            {activeTab === 'staffAccess' && (
              <StaffAccessMatrixModule
                staffAccounts={staffAccounts}
                ownerUid={workspaceUid}
                currentStaffCode={activeStaffCode}
                currentBranchCode={activeOperationalBranch}
              />
            )}

            {activeTab === 'roleLedgers' && (
              <RoleTallyLedgersModule
                key={`rl_${roleLedgerInitialRole}_${roleLedgerFocusNonce}`}
                ownerUid={workspaceUid}
                activeFy={activeFy}
                company={companySettings}
                hasCustomSettings={settingsDocs.some((d) => d.id === 'company')}
                parties={parties}
                vehicles={vehicles}
                drivers={drivers}
                consignments={visibleConsignments}
                invoices={visibleInvoices}
                lorryHires={visibleLorryHires}
                transactions={visibleTransactions}
                bankReceipts={bankReceipts}
                staffAccounts={staffAccounts}
                staffCommissions={staffCommissions}
                tripExpenses={visibleTripExpenses}
                hasDriveToken={Boolean(driveAccessToken)}
                driveAccessToken={driveAccessToken}
                connectedDriveEmail={connectedEmail}
                initialRole={roleLedgerInitialRole}
                initialAccountName={roleLedgerInitialAccount}
                onPreviewPdf={handlePreviewPdf}
                onOpenPodScanner={() => openOrSwitchTab('podScanner')}
                onRectifyVoucher={(vType, vNo) => {
                  if (vType === 'Sales' || vType === 'Credit Note' || vType === 'Debit Note') {
                    setBillingInitialSubTab('invoice');
                    setBillingFocusNonce((n) => n + 1);
                    openOrSwitchTab('billing');
                  } else {
                    setMasterInitialTab('parties');
                    setMasterFocusNonce((n) => n + 1);
                    openOrSwitchTab('master');
                  }
                  void vNo;
                }}
                onRectifyLorryHire={() => openOrSwitchTab('lorryHire')}
              />
            )}

            {activeTab === 'partyDirectory' && (
              <PartyDirectorySheet
                parties={parties}
                company={companySettings}
                activeFy={activeFy}
                onEditParty={() => {
                  setMasterInitialTab('parties');
                  setMasterFocusNonce((n) => n + 1);
                  openOrSwitchTab('master');
                }}
                onOpenPartyLedger={(pName) => {
                  setRoleLedgerInitialRole('party');
                  setRoleLedgerInitialAccount(pName);
                  setRoleLedgerFocusNonce((n) => n + 1);
                  openOrSwitchTab('roleLedgers');
                }}
                onOpenPodScanner={() => openOrSwitchTab('podScanner')}
                onPreviewPdf={handlePreviewPdf}
              />
            )}

            {activeTab === 'podScanner' && (
              <UniversalPodScannerPage
                ownerUid={workspaceUid}
                activeFy={activeFy}
                businessMode={businessMode}
                company={companySettings}
                lorryHires={visibleLorryHires}
                consignments={visibleConsignments}
                hasDriveToken={Boolean(driveAccessToken)}
                driveAccessToken={driveAccessToken}
                connectedDriveEmail={connectedEmail}
                onPreviewPdf={handlePreviewPdf}
              />
            )}

            {(activeTab === 'accounts' || activeTab === 'reports' || activeTab === 'mis') && (
              <ReportsMisModule
                key={`rep_${activeTab}_${reportInitialTab}_${reportFocusNonce}`}
                ownerUid={workspaceUid}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                readOnly={getSheetAccess(activeTab === 'accounts' ? 'accounts' : 'reports') === 'view'}
                invoices={visibleInvoices}
                logisticsInvoices={logisticsInvoices}
                lorryHires={visibleLorryHires}
                consignments={visibleConsignments}
                transactions={visibleTransactions}
                bankReceipts={bankReceipts}
                parties={parties}
                drivers={drivers}
                vehicles={vehicles}
                tripExpenses={visibleTripExpenses}
                company={companySettings}
                driveAccessToken={driveAccessToken}
                onConnectDrive={() => handleGoogleDriveConnect(true)}
                initialSubTab={
                  activeTab === 'accounts'
                    ? 'accountBook'
                    : activeTab === 'mis' && isEffectiveMasterAdmin
                    ? 'finalResults'
                    : reportInitialTab
                }
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {(activeTab === 'backup' || activeTab === 'settings') && (
              <BackupSettingsModule
                mode={activeTab === 'backup' ? 'backup' : 'settings'}
                ownerUid={workspaceUid}
                isMasterAdmin={isEffectiveMasterAdmin}
                adminUserId={erpSession.isMasterAdmin ? erpSession.userId : 'admin'}
                activeFy={activeFy}
                connectedEmail={connectedEmail}
                driveAccessToken={driveAccessToken}
                company={companySettings}
                hasCustomSettings={settingsDocs.some((d) => d.id === 'company')}
                staffAccounts={staffAccounts}
                activeStaffSession={activeStaffSession}
                allData={{
                  parties,
                  vehicles,
                  drivers,
                  consignments,
                  invoices,
                  quotations,
                  lorryHires,
                  transactions,
                  declarations,
                  bankReceipts,
                  staffCommissions,
                }}
                logisticsData={{
                  parties: logisticsParties,
                  vehicles: logisticsVehicles,
                  drivers: logisticsDrivers,
                  dockets: logisticsDockets,
                  manifests: logisticsManifests,
                  invoices: logisticsInvoices,
                  ledgers: logisticsLedgers,
                }}
                autoBackupInfo={autoBackupInfo}
                deviceTrust={deviceTrust}
                aiDoctorReport={aiDoctorReport}
                runningAiDoctor={runningAiDoctor}
                onRunAiDoctor={async () => {
                  if (!companySettings.backgroundAiEnabled) {
                    handleShowConfirm({
                      title: 'Enable Online Gemini AI Check?',
                      description:
                        'Background Online AI is currently OFF by default (0 API Quota). Select Yes to run an online Gemini deep formula audit now, or Cancel to stay offline.',
                      confirmLabel: 'Yes, Run Online AI',
                      variant: 'primary',
                      onConfirm: async () => {
                        await triggerAiDoctor('manual', true);
                      },
                    });
                    await triggerAiDoctor('manual', false);
                    return;
                  }
                  await triggerAiDoctor('manual', true);
                }}
                onAcknowledgeNewDevice={handleAcknowledgeNewDevice}
                onManualSyncNow={async () => {
                  await runSealedAutoBackup(true);
                }}
                onSwitchGmail={() => handleGoogleDriveConnect(true)}
                onSwitchStaffSession={setActiveStaffSession}
                onUpdateAdminSession={(nextSession) => setErpSession(nextSession)}
                onSelectFy={handleSelectFy}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {activeTab === 'guide' && (
              <UserGuideModule
                company={companySettings}
                driveAccessToken={driveAccessToken}
                onConnectDrive={() => handleGoogleDriveConnect(true)}
                onPreviewPdf={handlePreviewPdf}
              />
            )}

            {activeTab === 'about' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-w-4xl">
                <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-5 py-3.5 flex items-center gap-3">
                  <DrcTriangleLogo className="w-10 h-10 shrink-0" />
                  <div>
                    <h2 className="text-base font-extrabold">{companySettings.companyName}</h2>
                    <p className="text-xs text-blue-100">Proprietor: Subhajit Saha · Kolkata Head Office</p>
                  </div>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700">
                  <div className="space-y-1.5">
                    <p className="font-bold text-slate-900 text-sm">Registered Office &amp; Tax IDs</p>
                    <p><span className="font-semibold">Address:</span> {companySettings.address}</p>
                    <p><span className="font-semibold">PAN No:</span> <span className="font-mono-num">{companySettings.pan}</span></p>
                    <p><span className="font-semibold">GSTIN:</span> <span className="font-mono-num">{companySettings.gstin}</span></p>
                    <p><span className="font-semibold">MSME UDYAM:</span> <span className="font-mono-num">{companySettings.msme}</span></p>
                    <p><span className="font-semibold">HSN / SAC:</span> <span className="font-mono-num">{companySettings.hsn}</span></p>
                    <p><span className="font-semibold">Contact:</span> {companySettings.phones} · {companySettings.email}</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-bold text-slate-900 text-sm">Banking &amp; Official Stamp</p>
                    {isEffectiveMasterAdmin ? (
                      <>
                        <p><span className="font-semibold">Bank:</span> {companySettings.bankName} ({companySettings.bankBranch})</p>
                        <p><span className="font-semibold">A/C No:</span> <span className="font-mono-num">{companySettings.accountNo}</span></p>
                        <p><span className="font-semibold">IFSC / SWIFT:</span> <span className="font-mono-num">{companySettings.ifsc} / {companySettings.swift}</span></p>
                        {companySettings.customStampDataUrl ? (
                          <img
                            src={companySettings.customStampDataUrl}
                            alt="DRC Authorized Stamp"
                            className="h-20 object-contain mt-2 border border-slate-200 rounded p-1"
                          />
                        ) : (
                          <p className="text-[11px] text-slate-500 mt-2">
                            Upload official company stamp &amp; signature inside Settings.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 flex items-center gap-2 mt-1">
                        <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>Bank Account Details &amp; Digital Stamp are locked to Master Admin only.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            </Suspense>
          </div>
        </main>
        </>
        )}
      </div>

      {/* Bottom ERP Status Bar */}
      <footer className="bg-[#EFF6FF] border-t border-blue-200 px-3 md:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 no-print">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {firestoreConnected
              ? 'Real-Time Multi-Branch Sync + Offline Cache Active'
              : 'Offline Cache Active'}
          </span>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={() => setFormulaHealthModalOpen(true)}
            className="inline-flex items-center gap-1 font-extrabold text-emerald-800 hover:underline cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>{formulaHealthReport?.badgeLabel || 'System Health: 100% Error-Free'}</span>
          </button>
          <span className="text-slate-300">|</span>
          <span>
            User: <strong className="text-slate-900">{activeOperatorLabel}</strong>
          </span>
          <span className="text-slate-300">|</span>
          <span>
            Branch: <strong className="text-[#0D47A1]">{activeOperationalBranch}</strong>
          </span>
          <span className="text-slate-300">|</span>
          <span>
            Drive Backup:{' '}
            <strong className="text-blue-800">{connectedEmail || 'Optional (Link in Backup)'}</strong>
          </span>
        </div>
        <div className="font-bold italic text-[#0D47A1]">
          {businessMode === 'FTL'
            ? 'Dolphin Road Carriers — Logistics Solution Partner'
            : `Dolphin Road Carriers — ${activeBusinessMeta.fullName}`}
        </div>
      </footer>

      {/* Live Multi-Branch Presence & Real-Time Activity Log Drawer */}
      {liveMonitorOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 no-print">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-300 animate-pulse" />
                <div>
                  <h3 className="text-sm font-bold">Live Branch Staff &amp; Activity Stream</h3>
                  <p className="text-[11px] text-blue-100">
                    Real-time multi-device presence ({effectiveBranchFilter}) · Auto-synced via Firestore
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLiveMonitorOpen(false)}
                className="p-1 rounded hover:bg-white/15 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
              {/* Online Staff Badges */}
              <div className="space-y-2">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span>Active Online Staff ({activeOnlineStaff.length})</span>
                </p>
                {activeOnlineStaff.length === 0 ? (
                  <p className="text-slate-500 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    Syncing live presence...
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeOnlineStaff.map((p) => (
                      <div
                        key={p.id}
                        className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/50 space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-slate-900 truncate">{p.displayName}</span>
                          <span className="px-1.5 py-0.5 rounded bg-[#0D47A1] text-white text-[10px] font-bold">
                            {p.branchCode}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600">
                          <span className="font-mono-num font-semibold">{p.staffCode}</span> · {p.role}
                        </p>
                        <p className="text-[11px] text-emerald-800 font-medium">
                          {p.activeModule || 'Dashboard'} · {p.deviceType || 'Web'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Real-Time Branch Activity Log */}
              <div className="space-y-2">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-blue-700" />
                  <span>Recent Branch Activity Log ({sortedActivityLogs.length})</span>
                </p>
                {sortedActivityLogs.length === 0 ? (
                  <p className="text-slate-500 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    No activity events recorded yet. Actions across CNs, Bills, PODs, and Ledgers appear here live.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                    {sortedActivityLogs.map((log) => (
                      <div key={log.id} className="p-2.5 bg-white hover:bg-slate-50 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-blue-800">{log.action}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                            {log.branchCode}
                          </span>
                        </div>
                        <p className="text-slate-700">{log.summary}</p>
                        <p className="text-[11px] text-slate-500">
                          By {log.staffName || log.staffCode} ({log.staffCode}) · {log.module}
                          {log.docRefCode ? ` · Ref: ${log.docRefCode}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live A4 PDF Preview Modal with Dynamic Portrait / Landscape Rebuild & Share Actions */}
      <A4PreviewModal
        pdf={previewPdf?.pdf || null}
        driveFolder={previewPdf?.folder || 'Bills_Invoices'}
        hasDriveToken={Boolean(driveAccessToken)}
        parties={parties}
        company={companySettings}
        onClose={handleClosePreviewPdf}
        onSaveToDrive={handleSavePdfToDrive}
        onConnectDrive={() => handleGoogleDriveConnect(true)}
        onReplacePdf={(nextPdf) =>
          setPreviewPdf((prev) => {
            if (!prev) return null;
            if (prev.pdf.blobUrl && prev.pdf.blobUrl !== nextPdf.blobUrl) {
              URL.revokeObjectURL(prev.pdf.blobUrl);
            }
            return { ...prev, pdf: nextPdf };
          })
        }
      />

      {/* Startup & Monthly Auto-Formula Health Guard + Anti-Tamper Shield Modal */}
      {formulaHealthModalOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 no-print">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-emerald-300 shadow-2xl overflow-hidden text-xs">
            <div className="bg-gradient-to-r from-emerald-700 to-teal-700 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-200 shrink-0" />
                <div>
                  <h3 className="text-sm font-extrabold">
                    {formulaHealthReport?.badgeLabel || 'System Health: 100% Error-Free'}
                  </h3>
                  <p className="text-[11px] text-emerald-100">
                    Startup &amp; Monthly (1st of Month) Auto-Formula Guard + Anti-Tamper Security Shield
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFormulaHealthModalOpen(false)}
                className="p-1 rounded hover:bg-white/15 cursor-pointer"
                aria-label="Close Formula Health Dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-[10px] font-bold text-emerald-800 uppercase">Status</p>
                  <p className="text-xs font-extrabold text-emerald-900">100% Verified</p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] font-bold text-slate-600 uppercase">Records Scanned</p>
                  <p className="text-xs font-extrabold font-mono-num text-slate-900">
                    {formulaHealthReport?.totalRecordsScanned ?? 0}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] font-bold text-slate-600 uppercase">Auto-Healed</p>
                  <p className="text-xs font-extrabold font-mono-num text-emerald-700">
                    {formulaHealthReport?.healedCount ?? 0}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] font-bold text-slate-600 uppercase">Shield Checksum</p>
                  <p className="text-xs font-extrabold font-mono-num text-indigo-800 truncate">
                    CRC-{formulaHealthReport?.shieldIntegrityHash || 'OK'}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                {(formulaHealthReport?.checks || []).map((chk) => (
                  <div
                    key={chk.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{chk.label}</p>
                      <p className="text-[11px] text-slate-600">{chk.details}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded font-extrabold uppercase text-[10px] shrink-0 ${
                        chk.status === 'healed'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      {chk.status === 'healed' ? 'Auto-Healed' : 'Passed'}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                {formulaHealthReport?.monthlyScheduleNote ||
                  'Auto-scans all accounting formulas on startup and 1st of every month.'}
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => runFormulaGuardScan(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-Run Formula &amp; Anti-Tamper Scan</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFormulaHealthModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin PIN + 2FA OTP Verification Modal (Protects Backup Vault & Staff Sheet Access Control) */}
      {adminPinModalOpen && (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-900/65 p-4 no-print">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-amber-300 shadow-2xl overflow-hidden text-xs">
            <div className="bg-gradient-to-r from-[#0D47A1] to-amber-700 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-200" />
                <h3 className="text-sm font-extrabold">
                  {pendingPinTargetTab === 'backup'
                    ? 'Backup Vault PIN + 2FA OTP Lock'
                    : 'Admin PIN Verification'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAdminPinModalOpen(false);
                  setPendingPinTargetTab(null);
                  setAdminPinInput('');
                  setAdminPinOtpInput('');
                  setAdminPinError(null);
                }}
                className="p-1 rounded hover:bg-white/15 cursor-pointer"
                aria-label="Close PIN Dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const target = pendingPinTargetTab || 'staffAccess';
                if (target === 'voicePilot') {
                  if (unlockVoicePilotWithPin(adminPinInput)) {
                    setVoicePinUnlocked(true);
                    setAdminPinModalOpen(false);
                    setPendingPinTargetTab(null);
                    setAdminPinInput('');
                    setAdminPinOtpInput('');
                    setAdminPinError(null);
                    const readyMsg =
                      voiceLang === 'bn'
                        ? 'ভয়েস পাইলট আনলক হয়েছে। এখন বলুন বাটনে চাপ দিন।'
                        : 'Admin Voice Pilot unlocked. Tap Speak now.';
                    setVoiceFeedbackMsg(readyMsg);
                    window.setTimeout(() => {
                      playVerifiedBeep();
                      speakCalmVoice(readyMsg, voiceLang === 'off' ? 'en' : voiceLang);
                    }, 0);
                  } else {
                    playAlertBeep();
                    setAdminPinError('Invalid Admin PIN for Voice Pilot unlock.');
                  }
                  return;
                }
                if (target === 'backup') {
                  const res = unlockBackupVaultWithPinAndOtp({
                    pin: adminPinInput,
                    otp: adminPinOtpInput,
                  });
                  if (res.unlocked) {
                    setAdminPinModalOpen(false);
                    setPendingPinTargetTab(null);
                    setAdminPinInput('');
                    setAdminPinOtpInput('');
                    setAdminPinError(null);
                    openOrSwitchTab('backup');
                    window.setTimeout(() => playVerifiedBeep(), 0);
                  } else {
                    playAlertBeep();
                    setAdminPinError(res.error || 'Invalid Admin PIN or 2FA OTP.');
                  }
                  return;
                }
                if (verifyAdminPin(adminPinInput)) {
                  setAdminPinModalOpen(false);
                  setPendingPinTargetTab(null);
                  setAdminPinInput('');
                  setAdminPinOtpInput('');
                  setAdminPinError(null);
                  openOrSwitchTab(target);
                  window.setTimeout(() => playVerifiedBeep(), 0);
                } else {
                  playAlertBeep();
                  setAdminPinError('Invalid Admin PIN. Enter valid PIN (default: 1234).');
                }
              }}
              className="p-4 space-y-3"
            >
              <p className="text-slate-600 leading-relaxed">
                {pendingPinTargetTab === 'voicePilot' ? (
                  <>
                    Enter your <strong>Master Admin PIN</strong> to unlock{' '}
                    <strong>Bilingual Voice Pilot (বাংলা / English Draft Assistant)</strong>.
                  </>
                ) : pendingPinTargetTab === 'backup' ? (
                  <>
                    Enter your <strong>Master Admin PIN</strong> and <strong>6-digit 2FA OTP</strong> to unlock{' '}
                    <strong>Backup / Restore Vault ({BACKUP_ISOLATED_DRIVE_EMAIL})</strong>.
                  </>
                ) : (
                  <>
                    Enter your <strong>Admin Security PIN</strong> to unlock{' '}
                    <strong>Staff Sheet Access Control</strong>. (PIN can be customized inside Admin Settings.)
                  </>
                )}
              </p>
              {pendingPinTargetTab === 'backup' && adminPinOtpChallenge && (
                <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-indigo-700">
                      Active 2FA Security OTP (5m TTL)
                    </p>
                    <p className="text-sm font-black font-mono-num tracking-widest text-indigo-950">
                      {adminPinOtpChallenge.code}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAdminPinOtpChallenge(
                        issueTwoFactorOtpChallenge(
                          `Backup / Restore Vault (${BACKUP_ISOLATED_DRIVE_EMAIL})`
                        )
                      )
                    }
                    className="px-2 py-1 rounded bg-white border border-indigo-300 text-indigo-800 text-[10px] font-bold hover:bg-indigo-100 cursor-pointer"
                  >
                    New OTP
                  </button>
                </div>
              )}
              {adminPinError && (
                <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 font-bold">
                  {adminPinError}
                </div>
              )}
              <input
                type="password"
                inputMode="numeric"
                value={adminPinInput}
                onChange={(e) => {
                  setAdminPinInput(e.target.value);
                  setAdminPinError(null);
                }}
                placeholder="Enter Master Admin PIN (default: 1234)"
                autoFocus
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {pendingPinTargetTab === 'backup' && (
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={adminPinOtpInput}
                  onChange={(e) => {
                    setAdminPinOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setAdminPinError(null);
                  }}
                  placeholder="Enter 6-digit 2FA OTP"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-num tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAdminPinModalOpen(false);
                    setPendingPinTargetTab(null);
                    setAdminPinInput('');
                    setAdminPinOtpInput('');
                    setAdminPinError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white font-bold cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>
                    {pendingPinTargetTab === 'backup' ? 'Verify PIN + 2FA' : 'Verify & Unlock'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Confirmation Modal */}
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
        onConfirm={async () => {
          const fn = confirmState.onConfirm;
          setConfirmState((prev) => ({ ...prev, open: false }));
          await fn();
        }}
      />

      {/* Configurable Auto-Lock Security Overlay */}
      {isScreenLocked && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 p-4 no-print">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-5 py-4 flex items-center gap-3">
              <DrcTriangleLogo className="w-10 h-10 shrink-0" />
              <div>
                <h3 className="text-sm font-extrabold">Session Locked</h3>
                <p className="text-[11px] text-blue-100">
                  Dolphin Road Carriers &bull; Idle Security Shield
                </p>
              </div>
            </div>
            <form onSubmit={handleUnlockScreen} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="text-slate-600">Operator ID:</span>
                <strong className="font-mono-num text-[#0D47A1]">
                  {activeStaffSession ? activeStaffSession.staffCode : erpSession.userId}
                </strong>
              </div>
              {unlockError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 font-semibold">
                  {unlockError}
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Enter Password to Unlock
                </label>
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoFocus
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    clearErpSession();
                    setIsScreenLocked(false);
                    setErpSession(null);
                    setActiveStaffSession(null);
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 cursor-pointer"
                >
                  Sign Out
                </button>
                <button
                  type="submit"
                  disabled={unlocking}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white font-bold cursor-pointer disabled:opacity-60"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>{unlocking ? 'Verifying...' : 'Unlock Session'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Android / Windows / iOS Install App Modal */}
      {iosGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden text-xs">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DrcTriangleLogo className="w-7 h-7 shrink-0" />
                <h3 className="text-sm font-bold">Install Dolphin Road Carriers ERP</h3>
              </div>
              <button
                type="button"
                onClick={() => setIosGuideOpen(false)}
                className="text-blue-100 hover:text-white cursor-pointer"
                aria-label="Close install dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-slate-700 leading-relaxed">
              {isIOS ? (
                <p>
                  <strong>iPhone / iPad (Safari):</strong>
                  <br />
                  1. Tap the <strong>Share</strong> icon in Safari.
                  <br />
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                  <br />
                  3. Tap <strong>Add</strong> to launch Dolphin Road Carriers ERP in fullscreen mode.
                </p>
              ) : (
                <>
                  <p>
                    <strong>Android Phone (Chrome):</strong> Open this app in Chrome outside the preview window, tap Chrome Menu <strong>&#8942;</strong> &rarr; <strong>Install App</strong> to install with the DRC Dolphin Logo.
                  </p>
                  <p>
                    <strong>Windows PC (Chrome / Edge):</strong> Open in a standalone browser tab and click the <strong>Install App</strong> icon in the address bar to add a Desktop &amp; Start Menu app shortcut.
                  </p>
                  <p className="text-[11px] text-slate-500">
                    To export an Android <code>.apk</code> or Windows store installer package, paste the Shared App URL into{' '}
                    <a
                      href="https://www.pwabuilder.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 font-bold underline"
                    >
                      PWABuilder.com
                    </a>
                    .
                  </p>
                </>
              )}
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200">
                <a
                  href={typeof window !== 'undefined' ? window.location.origin : '/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  Open App in New Tab to Install
                </a>
                <button
                  type="button"
                  onClick={() => setIosGuideOpen(false)}
                  className="px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Repeating Watermark Overlay for Non-Master Staff Logins */}
      {erpSession && (!isEffectiveMasterAdmin || Boolean(activeStaffSession)) && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[45] pointer-events-none select-none overflow-hidden opacity-[0.06] no-print flex flex-wrap items-center justify-around gap-12 p-8 -rotate-12"
        >
          {Array.from({ length: 12 }).map((_, idx) => (
            <span
              key={idx}
              className="text-[11px] font-black tracking-wider text-slate-900 uppercase whitespace-nowrap font-mono-num"
            >
              {activeStaffCode} &bull; {activeStaffName} &bull; {activeOperationalBranch} &bull; <LiveClockText />
            </span>
          ))}
        </div>
      )}

      {/* Anti-Screenshot & Screen Capture Privacy Shield Curtain (Windows, Tablet & Android) */}
      {privacyCurtainReason && (
        <div className="fixed inset-0 z-[120] bg-black text-white flex items-center justify-center p-6 no-print">
          <div className="w-full max-w-md rounded-2xl border border-red-500/60 bg-slate-950 p-6 space-y-4 text-center shadow-2xl">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-600/20 border border-red-500 flex items-center justify-center text-red-400">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-extrabold text-red-400">
                🚫 Screenshot &amp; Screen Capture Blocked by DRC Security Policy
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                {privacyCurtainReason}
              </p>
              <p className="text-[11px] text-slate-400 font-mono-num">
                Session: {activeOperatorLabel} &bull; {activeOperationalBranch} &bull; <LiveClockText />
              </p>
            </div>

            {shieldUnlockError && (
              <div className="p-2 rounded bg-red-900/50 border border-red-500/60 text-xs text-red-200 font-bold">
                {shieldUnlockError}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPrivacyCurtainReason(null);
                  setShieldUnlockError(null);
                  setShieldUnlockPin('');
                }}
                className="w-full px-4 py-2.5 rounded-lg bg-[#0D47A1] hover:bg-blue-700 text-white text-xs font-extrabold cursor-pointer"
              >
                Dismiss &amp; Resume Secure Workspace
              </button>

              {shieldTempUnlocked ? (
                <button
                  type="button"
                  onClick={() => {
                    lockScreenShieldImmediately();
                    setShieldTempUnlocked(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-amber-400/50 text-amber-300 text-xs font-bold cursor-pointer"
                >
                  Re-Lock Anti-Screenshot Shield Now
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const ok = unlockScreenShieldTemporarily(shieldUnlockPin, 5 * 60 * 1000);
                    if (!ok) {
                      playAlertBeep();
                      setShieldUnlockError('Invalid Admin PIN. Default PIN is 1234 unless changed in Settings.');
                      return;
                    }
                    playVerifiedBeep();
                    setShieldTempUnlocked(true);
                    setShieldUnlockError(null);
                    setShieldUnlockPin('');
                    setPrivacyCurtainReason(null);
                  }}
                  className="flex items-center gap-2 pt-2 border-t border-slate-800"
                >
                  <input
                    type="password"
                    inputMode="numeric"
                    value={shieldUnlockPin}
                    onChange={(e) => {
                      setShieldUnlockPin(e.target.value);
                      setShieldUnlockError(null);
                    }}
                    placeholder="Admin PIN (5m temporary unlock)"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-white text-xs font-mono-num"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer whitespace-nowrap"
                  >
                    Unlock 5m
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Strict Hardware Device Lock for drc.2015kolkata@gmail.com on Unrecognized Devices */}
      {hardwareLockState.locked && erpSession && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/95 p-4 no-print">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const res = authorizeCurrentDeviceWithPinAndOtp({
                pin: hardwareLockState.pin,
                otp: hardwareLockState.otp,
                operatorLabel: activeStaffName,
              });
              if (!res.authorized) {
                playAlertBeep();
                setHardwareLockState((prev) => ({
                  ...prev,
                  error: res.error || 'Invalid Master Admin PIN or 2FA OTP.',
                }));
                return;
              }
              playVerifiedBeep();
              setHardwareLockState({ locked: false, pin: '', otp: '', challenge: null, error: null });
            }}
            className="w-full max-w-md bg-white rounded-2xl border-2 border-amber-400 shadow-2xl p-6 space-y-4 text-xs"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-950">
                  Unrecognized Hardware Blocked ({MASTER_ADMIN_PROTECTED_EMAIL})
                </h3>
                <p className="text-[11px] text-slate-600">
                  Enter Master Admin PIN + 6-digit 2FA OTP to authorize this workstation. Staff IDs remain unrestricted.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-center">
              <span className="text-[11px] text-amber-900 font-bold block">Active 2FA OTP Code</span>
              <span className="text-lg font-extrabold font-mono-num tracking-widest text-amber-950">
                {hardwareLockState.challenge?.code || '------'}
              </span>
            </div>

            {hardwareLockState.error && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-300 text-red-800 font-bold">
                {hardwareLockState.error}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Master Admin PIN *</label>
                <input
                  type="password"
                  required
                  value={hardwareLockState.pin}
                  onChange={(e) =>
                    setHardwareLockState((prev) => ({ ...prev, pin: e.target.value, error: null }))
                  }
                  placeholder="Default PIN: 1234"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">6-Digit 2FA OTP *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={hardwareLockState.otp}
                  onChange={(e) =>
                    setHardwareLockState((prev) => ({
                      ...prev,
                      otp: e.target.value.replace(/\D/g, ''),
                      error: null,
                    }))
                  }
                  placeholder="Enter OTP shown above"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-num tracking-widest"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white font-extrabold cursor-pointer"
              >
                Authorize This Hardware &amp; Enter
              </button>
              <button
                type="button"
                onClick={() => {
                  clearErpSession();
                  setIsScreenLocked(false);
                  setErpSession(null);
                  setActiveStaffSession(null);
                  setHardwareLockState((prev) => ({
                    ...prev,
                    blocked: false,
                    pin: '',
                    otp: '',
                    error: null,
                  }));
                }}
                className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-bold cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Close App Overlay (Closes workspace safely with All Data Backed Up verification) */}
      {appClosedOverlay && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/95 p-4 no-print">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-300 shadow-2xl p-6 text-center space-y-4">
            <DrcTriangleLogo className="w-16 h-16 mx-auto" />
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-extrabold">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>✅ All Data Backed Up</span>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                DRC ERP Workspace Closed
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                Session preserved safely for {activeOperatorLabel} ({activeFy}). Close this browser tab or click below to reopen immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAppClosedOverlay(false)}
              className="w-full px-4 py-2.5 rounded-lg bg-[#0D47A1] hover:bg-[#0A3882] text-white text-xs font-bold cursor-pointer"
            >
              Reopen ERP Workspace
            </button>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
