import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  GitBranch,
  Info,
  LayoutDashboard,
  Lock,
  LogOut,
  MapPin,
  Menu,
  PieChart,
  Radio,
  RefreshCw,
  ScanLine,
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
  BRANCH_OPTIONS,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  DEFAULT_COMPANY_SETTINGS,
  Driver,
  DriveFolderName,
  Invoice,
  LorryHire,
  Party,
  PermissionKey,
  Quotation,
  SheetTabId,
  StaffAccount,
  StaffPresence,
  TransactionRecord,
  Vehicle,
} from './types/erp';
import {
  getConnectedGmail,
  googleSignIn,
  initAuth,
  MASTER_ADMIN_EMAIL,
  testConnection,
} from './lib/firebase';
import {
  clearErpSession,
  CustomAuthSession,
  loadSavedErpSession,
  loginWithCredentials,
  resetAdminToDefaultAndLogin,
  subscribeCollection,
  upsertStaffPresence,
} from './lib/firestoreStore';
import {
  daysSinceDate,
  daysUntilDate,
  formatDateDDMMYYYY,
  formatINR,
  matchesSelectedFinancialYear,
  normalizeFyLabel,
  PRECREATED_FYS,
} from './lib/formatters';
import { uploadBlobToDriveFolder } from './lib/driveBackup';
import { GeneratedPdfResult } from './lib/pdfEngine';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import { DrcTriangleLogo } from './components/DrcTriangleLogo';
import { SignInScreen } from './components/SignInScreen';
import { ConfirmModal } from './components/ConfirmModal';
import { A4PreviewModal } from './components/A4PreviewModal';
import { DashboardHome } from './components/DashboardHome';
import { MasterModule, MasterTabId } from './components/MasterModule';
import { ConsignmentModule } from './components/ConsignmentModule';
import { BillingQuotesModule } from './components/BillingQuotesModule';
import { LorryHirePodModule } from './components/LorryHirePodModule';
import { ReportsMisModule, ReportTab } from './components/ReportsMisModule';
import { BackupSettingsModule } from './components/BackupSettingsModule';

type SidebarNavId = SheetTabId | 'transactions';

interface SheetTabDef {
  id: SheetTabId;
  label: string;
}

const TAB_LABELS: Record<SheetTabId, string> = {
  dashboard: 'Dashboard',
  master: 'Master',
  lr: 'Consignment / LR',
  billing: 'Billing & Quotes',
  lorryHire: 'Lorry Hire & POD',
  accounts: 'Accounts',
  reports: 'Reports',
  mis: 'MIS Reports',
  backup: 'Backup / Restore',
  settings: 'Settings',
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
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [presenceList, setPresenceList] = useState<StaffPresence[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [settingsDocs, setSettingsDocs] = useState<Array<CompanySettings & { id?: string }>>([]);

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

  // Multi-tab Sheet Bar + Sidebar UI
  const [openTabs, setOpenTabs] = useState<SheetTabDef[]>([{ id: 'dashboard', label: 'Dashboard' }]);
  const [activeTab, setActiveTab] = useState<SheetTabId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [liveMonitorOpen, setLiveMonitorOpen] = useState(false);
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  // Deep-link sub-tabs for Master Alerts and Reports
  const [masterInitialTab, setMasterInitialTab] = useState<MasterTabId>('parties');
  const [masterFocusNonce, setMasterFocusNonce] = useState(0);
  const [reportInitialTab, setReportInitialTab] = useState<ReportTab>('invoiceRegister');
  const [reportFocusNonce, setReportFocusNonce] = useState(0);

  // Cross-module LR -> Invoice auto-paste handoff
  const [pendingCnForInvoice, setPendingCnForInvoice] = useState<ConsignmentNote | null>(null);

  // Live A4 Preview Modal
  const [previewPdf, setPreviewPdf] = useState<{
    pdf: GeneratedPdfResult;
    folder: DriveFolderName;
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

  // Live Date/Time Clock
  const [now, setNow] = useState(() => new Date());
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Passive listener for optional Google Drive OAuth connection
  useEffect(() => {
    const unsub = initAuth((nextUser, token) => {
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
      subscribeCollection<StaffAccount>('staff_accounts', ownerUid, email, setStaffAccounts),
      subscribeCollection<StaffPresence>('presence', ownerUid, email, setPresenceList),
      subscribeCollection<ActivityLog>('activity_logs', ownerUid, email, setActivityLogs),
      subscribeCollection<CompanySettings & { id?: string }>(
        'settings',
        ownerUid,
        email,
        setSettingsDocs
      ),
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

  // Real-time Red Alert Badges Computation
  const alerts = useMemo(() => {
    const failedVehicles = vehicles.filter((v) => {
      const checks = [v.fitnessExpiry, v.insuranceExpiry, v.permitExpiry, v.pucExpiry];
      return checks.some((dt) => {
        const d = daysUntilDate(dt);
        return d !== null && d < 0;
      });
    });

    const failedDrivers = drivers.filter((d) => {
      const days = daysUntilDate(d.dlExpiry);
      return days !== null && days < 0;
    });

    const overdueInvoices = visibleInvoices.filter((inv) => {
      if (inv.status === 'Paid') return false;
      const dueDays = inv.dueDate ? daysUntilDate(inv.dueDate) : null;
      if (dueDays !== null && dueDays < 0) return true;
      return daysSinceDate(inv.invoiceDate) > 7;
    });

    return {
      failedVehicles,
      failedDrivers,
      overdueInvoices,
      totalCount: failedVehicles.length + failedDrivers.length + overdueInvoices.length,
    };
  }, [vehicles, drivers, visibleInvoices]);

  const hasPermission = useCallback(
    (perm: PermissionKey): boolean => {
      if (!erpSession) return false;
      if (!isEffectiveMasterAdmin && (perm === 'settings' || perm === 'mis')) return false;
      if (!activeStaffSession) return isEffectiveMasterAdmin;
      if (activeStaffSession.role === 'Admin') return true;
      return (activeStaffSession.permissions || []).includes(perm);
    },
    [erpSession, isEffectiveMasterAdmin, activeStaffSession]
  );

  // Strict route guard: redirect non-admin staff away from restricted tabs immediately
  useEffect(() => {
    if (!erpSession) return;
    if (activeTab === 'dashboard' || activeTab === 'about') return;
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

  const openOrSwitchTab = useCallback((tabId: SheetTabId) => {
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [...prev, { id: tabId, label: TAB_LABELS[tabId] }];
    });
    setActiveTab(tabId);
    setMobileMenuOpen(false);
  }, []);

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
    setUnlocking(true);
    setUnlockError(null);
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
      setGoogleUser(res.user);
      if (res.accessToken) setDriveAccessToken(res.accessToken);
    } catch (err) {
      setDriveBannerError(
        err instanceof Error ? err.message : 'Google Drive connection failed.'
      );
    }
  };

  const handleRefreshApp = async () => {
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

  const handlePreviewPdf = useCallback((pdf: GeneratedPdfResult, folder: DriveFolderName) => {
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
  }, []);

  const handleSavePdfToDrive = async (pdf: GeneratedPdfResult, folder: DriveFolderName) => {
    if (!driveAccessToken) {
      await handleGoogleDriveConnect(true);
      return;
    }
    await uploadBlobToDriveFolder({
      accessToken: driveAccessToken,
      folderName: folder,
      fileName: pdf.fileName,
      blob: pdf.blob,
      mimeType: 'application/pdf',
    });
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
    if (navId === 'transactions') {
      openOrSwitchTab('dashboard');
      return;
    }
    if (navId === 'accounts') {
      setReportInitialTab('accountBook');
      setReportFocusNonce((n) => n + 1);
    } else if (navId === 'reports') {
      setReportInitialTab('invoiceRegister');
      setReportFocusNonce((n) => n + 1);
    } else if (navId === 'mis') {
      setReportInitialTab('finalResults');
      setReportFocusNonce((n) => n + 1);
    } else if (navId === 'master') {
      setMasterInitialTab('parties');
      setMasterFocusNonce((n) => n + 1);
    }
    openOrSwitchTab(navId);
  };

  const formattedClock = useMemo(() => {
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
    return `${dateStr}  ${timeStr}`;
  }, [now]);

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
    icon: React.ComponentType<{ className?: string }>;
    perm?: PermissionKey;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' },
    { id: 'master', label: 'Master', icon: Building2, perm: 'master' },
    { id: 'lr', label: 'Consignment / LR', icon: ScanLine, perm: 'lr' },
    { id: 'billing', label: 'Billing & Quotes', icon: FileSpreadsheet, perm: 'billing' },
    { id: 'lorryHire', label: 'Lorry Hire & POD', icon: Truck, perm: 'lorryHire' },
    { id: 'accounts', label: 'Accounts', icon: BookOpen, perm: 'accounts' },
    { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight, perm: 'accounts' },
    { id: 'reports', label: 'Reports', icon: FileBarChart2, perm: 'reports' },
    { id: 'mis', label: 'MIS Reports', icon: PieChart, perm: 'mis' },
    { id: 'settings', label: 'Settings', icon: Settings, perm: 'settings' },
    { id: 'backup', label: 'Backup / Restore', icon: DatabaseBackup, perm: 'backup' },
    { id: 'about', label: 'About', icon: Info },
  ];

  const activeOperatorLabel = activeStaffSession
    ? `${activeStaffSession.displayName} (${activeStaffSession.staffCode})`
    : `${erpSession.displayName} (${erpSession.userId})`;

  return (
    <div className="min-h-screen flex flex-col bg-[#E2E8F0] text-slate-900 select-none">
      {/* Desktop ERP Top Window Title Strip */}
      <div className="bg-[#EFF6FF] border-b border-blue-200 px-3 py-1 flex items-center justify-between text-[11px] text-slate-700 font-medium no-print">
        <div className="flex items-center gap-2 truncate">
          <Truck className="w-3.5 h-3.5 text-[#0D47A1] shrink-0" />
          <span className="truncate">
            Cargo And Logistics Administration System — {companySettings.companyName}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isOnline && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white font-bold">
              <WifiOff className="w-3 h-3" />
              Offline Mode (IndexedDB Sync Pending)
            </span>
          )}
          <span className="hidden sm:inline text-slate-500">
            PAN: {companySettings.pan} · GSTIN: {companySettings.gstin}
          </span>
        </div>
      </div>

      {/* Main White/Blue Header Matching Reference Dashboard */}
      <header className="bg-white border-b border-slate-200 px-3 md:px-5 py-2.5 shadow-sm no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Brand Block */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
              aria-label="Toggle navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <DrcTriangleLogo className="w-11 h-11 shrink-0 drop-shadow-sm" />
            <div>
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-[#0B3B8C] leading-none">
                DOLPHIN ROAD CARRIERS
              </h1>
              <p className="text-xs md:text-sm font-bold italic text-[#1565C0] mt-0.5">
                Fast &bull; Safe &bull; Reliable
              </p>
            </div>
          </div>

          {/* Right Utility Strip */}
          <div className="flex flex-wrap items-center gap-2 md:gap-2.5">
            {/* Location & Clock */}
            <div className="hidden 2xl:flex items-center gap-3 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
              <span className="inline-flex items-center gap-1 text-[#0D47A1]">
                <MapPin className="w-3.5 h-3.5" />
                Kolkata - India
              </span>
              <span className="text-slate-300">|</span>
              <span className="inline-flex items-center gap-1 font-mono-num">
                <CalendarClock className="w-3.5 h-3.5 text-[#1565C0]" />
                {formattedClock}
              </span>
            </div>

            {/* Financial Year Dropdown Selector */}
            <div className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg text-[11px] font-bold text-indigo-900">
              <Calendar className="w-3.5 h-3.5 text-indigo-700" />
              <select
                value={activeFy}
                onChange={(e) => handleSelectFy(e.target.value)}
                className="bg-transparent font-bold text-indigo-900 focus:outline-none cursor-pointer"
                aria-label="Select Financial Year"
              >
                {fyChoices.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Isolation / Master Filter Control */}
            <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg text-[11px] font-bold text-[#0D47A1]">
              <GitBranch className="w-3.5 h-3.5" />
              {isBranchLocked ? (
                <span>Branch: {effectiveBranchFilter}</span>
              ) : (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="bg-transparent font-bold text-[#0D47A1] focus:outline-none cursor-pointer"
                  aria-label="Filter Branch View"
                >
                  {BRANCH_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b === 'ALL' ? 'All Branches (50+)' : `Branch: ${b}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Exit Staff Preview back to Master Admin */}
            {isMasterAdmin && activeStaffSession && (
              <button
                type="button"
                onClick={() => setActiveStaffSession(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                title="Exit Staff Preview and restore Master Admin controls"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Restore Admin</span>
              </button>
            )}

            {/* Live Concurrent Staff & Activity Log Badge */}
            <button
              type="button"
              onClick={() => setLiveMonitorOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold cursor-pointer whitespace-nowrap"
              title="View live online branch staff & real-time activity feed"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span>Online: {Math.max(1, activeOnlineStaff.length)}</span>
            </button>

            {/* Red Alert Badges */}
            <button
              type="button"
              onClick={() => {
                setMasterInitialTab('vehicles');
                setMasterFocusNonce((n) => n + 1);
                openOrSwitchTab('master');
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                alerts.failedVehicles.length > 0
                  ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Vehicles with expired Fitness, Insurance, Permit or PUC"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Failed Vehicles: {alerts.failedVehicles.length}
            </button>

            <button
              type="button"
              onClick={() => {
                setMasterInitialTab('drivers');
                setMasterFocusNonce((n) => n + 1);
                openOrSwitchTab('master');
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                alerts.failedDrivers.length > 0
                  ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Drivers with expired Driving Licenses"
            >
              <UserX className="w-3.5 h-3.5" />
              Failed Driver Licenses: {alerts.failedDrivers.length}
            </button>

            <button
              type="button"
              onClick={() => {
                setReportInitialTab('aging');
                setReportFocusNonce((n) => n + 1);
                openOrSwitchTab('reports');
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                alerts.overdueInvoices.length > 0
                  ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Party bills overdue beyond 7 days"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Overdue Payments: {alerts.overdueInvoices.length}
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer"
                aria-label="Compliance and Payment Notifications"
              >
                <Bell className="w-4 h-4" />
                {alerts.totalCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[10px] font-bold leading-tight">
                    {alerts.totalCount}
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
                        All vehicle papers, driver licenses &amp; collections are up to date.
                      </p>
                    ) : (
                      <>
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
                                Expired document (Fitness / Insurance / Permit / PUC)
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
                                D/L {d.dlNo} expired ({formatDateDDMMYYYY(d.dlExpiry)})
                              </p>
                            </div>
                          </button>
                        ))}
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
                                Overdue ₹{formatINR(inv.grandTotal - inv.paidAmount)} (Dated{' '}
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

            {/* Manual Instant Screen Lock Button */}
            <button
              type="button"
              onClick={() => {
                setUnlockPassword('');
                setUnlockError(null);
                setIsScreenLocked(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
              title="Lock Session Screen Immediately"
            >
              <Lock className="w-3.5 h-3.5 text-amber-700" />
              <span className="hidden sm:inline">Lock</span>
            </button>

            {/* Refresh App Button */}
            <button
              type="button"
              onClick={handleRefreshApp}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
              title="Refresh App & Sync Latest PWA Build"
            >
              <RefreshCw className="w-3.5 h-3.5 text-blue-700" />
              <span className="hidden sm:inline">Refresh</span>
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
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                title="Install Dolphin Road Carriers ERP on Android or Windows PC"
              >
                <Download className="w-3.5 h-3.5" />
                Install App
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Body: Left Royal Blue Sidebar + Multi-Tab Workspace */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Royal Blue Sidebar */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 flex' : 'hidden lg:flex'
          } w-56 shrink-0 flex-col justify-between bg-gradient-to-b from-[#0D47A1] via-[#1565C0] to-[#0A347A] text-white shadow-lg no-print`}
        >
          <div className="p-2.5 space-y-1 overflow-y-auto">
            {mobileMenuOpen && (
              <div className="flex justify-end pb-1 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-blue-100 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {sidebarItems
              .filter((item) => !item.perm || hasPermission(item.perm))
              .map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.id === 'transactions'
                    ? activeTab === 'dashboard'
                    : activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSidebarClick(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white shadow-sm ring-1 ring-white/25'
                        : 'text-blue-100 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}

            <button
              type="button"
              onClick={() =>
                handleShowConfirm({
                  title: 'Sign Out of Dolphin Road Carriers ERP?',
                  description: `Sign out of ${activeOperatorLabel}? Unsaved form drafts will be cleared.`,
                  confirmLabel: 'Sign Out',
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
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-100 hover:bg-red-600/80 hover:text-white transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Exit</span>
            </button>
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
          {/* Multi-Tab Sheet Bar */}
          <div className="bg-[#E2E8F0] border-b border-slate-300 px-3 pt-1.5 flex items-center gap-1 overflow-x-auto no-print">
            {openTabs.map((t) => {
              const selected = activeTab === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setActiveTab(t.id);
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

          {/* Active Workspace Module */}
          <div className="flex-1 p-3 md:p-4 overflow-y-auto">
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
                company={companySettings}
                onOpenTab={openOrSwitchTab}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {activeTab === 'master' && (
              <MasterModule
                key={`master_${masterInitialTab}_${masterFocusNonce}`}
                ownerUid={workspaceUid}
                parties={parties}
                vehicles={vehicles}
                drivers={drivers}
                company={companySettings}
                initialTab={masterInitialTab}
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
                consignments={visibleConsignments}
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
                ownerUid={workspaceUid}
                activeStaffCode={activeStaffCode}
                activeStaffName={activeStaffName}
                activeBranchCode={activeOperationalBranch}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                invoices={visibleInvoices}
                quotations={visibleQuotations}
                declarations={visibleDeclarations}
                consignments={visibleConsignments}
                parties={parties}
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
                lorryHires={visibleLorryHires}
                consignments={visibleConsignments}
                parties={parties}
                company={companySettings}
                driveAccessToken={driveAccessToken}
                onConnectDrive={() => handleGoogleDriveConnect(true)}
                onPreviewPdf={handlePreviewPdf}
                onShowConfirm={handleShowConfirm}
              />
            )}

            {(activeTab === 'accounts' || activeTab === 'reports' || activeTab === 'mis') && (
              <ReportsMisModule
                key={`rep_${activeTab}_${reportInitialTab}_${reportFocusNonce}`}
                ownerUid={workspaceUid}
                activeFy={activeFy}
                isMasterAdmin={isEffectiveMasterAdmin}
                invoices={visibleInvoices}
                lorryHires={visibleLorryHires}
                consignments={visibleConsignments}
                transactions={visibleTransactions}
                parties={parties}
                drivers={drivers}
                company={companySettings}
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
                }}
                onSwitchGmail={() => handleGoogleDriveConnect(true)}
                onSwitchStaffSession={setActiveStaffSession}
                onUpdateAdminSession={(nextSession) => setErpSession(nextSession)}
                onSelectFy={handleSelectFy}
                onShowConfirm={handleShowConfirm}
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
          </div>
        </main>
      </div>

      {/* Bottom ERP Status Bar */}
      <footer className="bg-[#EFF6FF] border-t border-blue-200 px-3 md:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {firestoreConnected
              ? 'Real-Time Multi-Branch Sync + Offline Cache Active'
              : 'Offline Cache Active'}
          </span>
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
          Dolphin Road Carriers — Logistics Solution Partner
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

      {/* Live A4 PDF Preview Modal with Dynamic Portrait / Landscape Rebuild */}
      <A4PreviewModal
        pdf={previewPdf?.pdf || null}
        driveFolder={previewPdf?.folder || 'Bills_Invoices'}
        hasDriveToken={Boolean(driveAccessToken)}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4 no-print">
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
    </div>
  );
}
