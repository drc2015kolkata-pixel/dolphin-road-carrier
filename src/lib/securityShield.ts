import { verifyAdminPin } from './selfHealing';

const SHIELD_UNLOCK_UNTIL_KEY = 'drc_screen_shield_unlock_until_v1';

export function isScreenShieldTemporarilyUnlocked(): boolean {
  try {
    const raw = sessionStorage.getItem(SHIELD_UNLOCK_UNTIL_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until) || until <= Date.now()) {
      sessionStorage.removeItem(SHIELD_UNLOCK_UNTIL_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function unlockScreenShieldTemporarily(
  pin: string,
  durationMs = 15 * 60 * 1000
): boolean {
  if (!verifyAdminPin(pin)) return false;
  try {
    sessionStorage.setItem(SHIELD_UNLOCK_UNTIL_KEY, String(Date.now() + durationMs));
  } catch {
    // Ignore sessionStorage restrictions
  }
  return true;
}

export function lockScreenShieldImmediately(): void {
  try {
    sessionStorage.removeItem(SHIELD_UNLOCK_UNTIL_KEY);
  } catch {
    // Ignore
  }
}

export interface ScreenCaptureShieldOptions {
  enabled: boolean;
  onViolation: (reason: string) => void;
}

/**
 * Installs multi-layer anti-screenshot, snipping-shortcut, copy/context-menu,
 * and screen-recording (getDisplayMedia) blockers across Windows, Tablet & Android.
 */
export function installScreenCaptureShield(opts: ScreenCaptureShieldOptions): () => void {
  if (!opts.enabled || typeof window === 'undefined') {
    return () => {};
  }

  let recentSuspiciousModifierAt = 0;

  const isEditableTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
  };

  const triggerViolation = (reason: string) => {
    if (isScreenShieldTemporarilyUnlocked()) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText('').catch(() => {});
      }
    } catch {
      // Ignore clipboard write restrictions
    }
    opts.onViolation(reason);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isScreenShieldTemporarilyUnlocked()) return;
    const keyUpper = String(e.key || '').toUpperCase();
    const codeUpper = String(e.code || '').toUpperCase();

    if (e.metaKey || (e.shiftKey && (e.ctrlKey || e.metaKey))) {
      recentSuspiciousModifierAt = Date.now();
    }

    // 1. PrintScreen key
    if (
      keyUpper === 'PRINTSCREEN' ||
      codeUpper === 'PRINTSCREEN' ||
      e.keyCode === 44
    ) {
      e.preventDefault();
      e.stopPropagation();
      triggerViolation('PrintScreen capture blocked by DRC Security Policy.');
      return;
    }

    // 2. Windows Snipping Tool (Win+Shift+S / Ctrl+Shift+S) or Mac screenshot (Cmd+Shift+3/4/5)
    if (
      ((e.metaKey || e.ctrlKey) && e.shiftKey && keyUpper === 'S') ||
      (e.metaKey && e.shiftKey && (keyUpper === '3' || keyUpper === '4' || keyUpper === '5'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      triggerViolation('Snipping Tool / OS Screenshot shortcut blocked by DRC Security Policy.');
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (isScreenShieldTemporarilyUnlocked()) return;
    const keyUpper = String(e.key || '').toUpperCase();
    const codeUpper = String(e.code || '').toUpperCase();
    if (keyUpper === 'PRINTSCREEN' || codeUpper === 'PRINTSCREEN' || e.keyCode === 44) {
      e.preventDefault();
      triggerViolation('PrintScreen capture blocked by DRC Security Policy.');
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    if (isScreenShieldTemporarilyUnlocked()) return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  };

  const handleCopy = (e: ClipboardEvent) => {
    if (isScreenShieldTemporarilyUnlocked()) return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    triggerViolation('Unauthorized screen text copy blocked by DRC Security Policy.');
  };

  const handleBlur = () => {
    if (isScreenShieldTemporarilyUnlocked()) return;
    if (Date.now() - recentSuspiciousModifierAt <= 2500) {
      recentSuspiciousModifierAt = 0;
      triggerViolation('Screen-snipping window capture attempt blocked by DRC Security Policy.');
    }
  };

  // Block screen recording / tab-sharing getDisplayMedia API
  let originalGetDisplayMedia:
    | ((constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>)
    | undefined;
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (md && typeof md.getDisplayMedia === 'function') {
    originalGetDisplayMedia = md.getDisplayMedia.bind(md);
    try {
      Object.defineProperty(md, 'getDisplayMedia', {
        configurable: true,
        value: async () => {
          if (!isScreenShieldTemporarilyUnlocked()) {
            triggerViolation('Screen recording / sharing (getDisplayMedia) blocked by DRC Security Policy.');
            throw new DOMException(
              'Screen recording is blocked by DRC Security Policy.',
              'NotAllowedError'
            );
          }
          return originalGetDisplayMedia ? originalGetDisplayMedia() : Promise.reject(new Error('Unavailable'));
        },
      });
    } catch {
      // Fallback if navigator.mediaDevices is non-configurable in restricted webview
    }
  }

  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('contextmenu', handleContextMenu, true);
  window.addEventListener('copy', handleCopy, true);
  window.addEventListener('blur', handleBlur, true);

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keyup', handleKeyUp, true);
    window.removeEventListener('contextmenu', handleContextMenu, true);
    window.removeEventListener('copy', handleCopy, true);
    window.removeEventListener('blur', handleBlur, true);
    if (md && originalGetDisplayMedia) {
      try {
        Object.defineProperty(md, 'getDisplayMedia', {
          configurable: true,
          value: originalGetDisplayMedia,
        });
      } catch {
        // Ignore cleanup
      }
    }
  };
}

/**
 * Layer 3 Security: Permanent Admin PIN No-Auto-Delete Shield when live company data exists.
 */
export function hasLiveCompanyData(counts: {
  parties: number;
  consignments: number;
  invoices: number;
  lorryHires: number;
  transactions: number;
}): boolean {
  return (
    counts.parties > 0 ||
    counts.consignments > 0 ||
    counts.invoices > 0 ||
    counts.lorryHires > 0 ||
    counts.transactions > 0
  );
}

export function guardDestructiveLiveDataAction(
  counts: {
    parties: number;
    consignments: number;
    invoices: number;
    lorryHires: number;
    transactions: number;
  },
  adminPin?: string
): { allowed: boolean; message: string } {
  const hasLive = hasLiveCompanyData(counts);
  if (!hasLive) {
    return { allowed: true, message: 'No live business records at risk.' };
  }
  if (!adminPin || !verifyAdminPin(adminPin)) {
    return {
      allowed: false,
      message:
        'No-Auto-Delete Shield Active: Live DRC accounting/bilty data exists. Valid Master Admin PIN is required.',
    };
  }
  return { allowed: true, message: 'Admin PIN verified.' };
}

export type PhoneAlarmPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPhoneAlarmPermissionState(): PhoneAlarmPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function dispatchBackgroundNotification(params: {
  title: string;
  body: string;
  tag: string;
  requireInteraction?: boolean;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(params.title, {
          body: params.body,
          tag: params.tag,
          icon: '/pwa-192x192.png',
          badge: '/favicon-32x32.png',
          requireInteraction: Boolean(params.requireInteraction),
          data: { url: '/' },
        });
        return true;
      }
    }
  } catch {
    // Fall through to standard Notification constructor
  }

  try {
    new Notification(params.title, {
      body: params.body,
      tag: params.tag,
      icon: '/pwa-192x192.png',
    });
    return true;
  } catch {
    return false;
  }
}

export async function requestPhoneAlarmPermission(): Promise<PhoneAlarmPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') {
    await dispatchBackgroundNotification({
      title: 'DRC Phone & Desktop Alarms Active',
      body: 'E-Way Bill 8h countdown, GST 7/8/15th & KYC expiry alarms are enabled.',
      tag: 'drc-alarm-test',
    });
    return 'granted';
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    await dispatchBackgroundNotification({
      title: 'DRC Phone & Desktop Alarms Enabled',
      body: 'Background alerts for EWB 8h-to-1h countdown & GST/KYC due dates are now active.',
      tag: 'drc-alarm-enabled',
    });
  }
  return result;
}

// ============================================================================
// PART B: MASTER ADMIN PIN + 2FA OTP LOCK + NEW-DEVICE SECURITY ALERT SHIELD
// ============================================================================

const VAULT_UNLOCK_UNTIL_KEY = 'drc_backup_vault_unlock_until_v1';
const TWO_FA_OTP_CHALLENGE_KEY = 'drc_2fa_otp_challenge_v1';
const DEVICE_ID_STORAGE_KEY = 'drc_device_id_v1';
const TRUSTED_DEVICES_STORAGE_KEY = 'drc_trusted_devices_v1';

export interface TwoFactorOtpChallenge {
  code: string;
  purpose: string;
  issuedAt: number;
  expiresAt: number;
}

export function isBackupVaultUnlocked(): boolean {
  try {
    const raw = sessionStorage.getItem(VAULT_UNLOCK_UNTIL_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until) || until <= Date.now()) {
      sessionStorage.removeItem(VAULT_UNLOCK_UNTIL_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function lockBackupVault(): void {
  try {
    sessionStorage.removeItem(VAULT_UNLOCK_UNTIL_KEY);
    sessionStorage.removeItem(TWO_FA_OTP_CHALLENGE_KEY);
  } catch {
    // Ignore storage unavailability
  }
}

function generateSixDigitOtp(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return String(arr[0] % 1000000).padStart(6, '0');
    }
  } catch {
    // Fallback
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function issueTwoFactorOtpChallenge(
  purpose = 'Backup Vault & Drive Security Unlock',
  ttlMs = 5 * 60 * 1000
): TwoFactorOtpChallenge {
  const now = Date.now();
  const challenge: TwoFactorOtpChallenge = {
    code: generateSixDigitOtp(),
    purpose,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  try {
    sessionStorage.setItem(TWO_FA_OTP_CHALLENGE_KEY, JSON.stringify(challenge));
  } catch {
    // Ignore sessionStorage unavailability
  }
  void dispatchBackgroundNotification({
    title: 'DRC 2FA Security OTP Challenge',
    body: `One-Time Security Code: ${challenge.code} (${purpose}) — Valid 5 mins.`,
    tag: 'drc-2fa-otp',
    requireInteraction: true,
  });
  return challenge;
}

export function getActiveTwoFactorOtpChallenge(): TwoFactorOtpChallenge | null {
  try {
    const raw = sessionStorage.getItem(TWO_FA_OTP_CHALLENGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TwoFactorOtpChallenge;
    if (!parsed?.code || !parsed?.expiresAt || parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(TWO_FA_OTP_CHALLENGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function verifyTwoFactorOtp(inputOtp: string): boolean {
  const clean = String(inputOtp || '').trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const active = getActiveTwoFactorOtpChallenge();
  if (!active) return false;
  return active.code === clean;
}

export function unlockBackupVaultWithPinAndOtp(params: {
  pin: string;
  otp: string;
  fallbackAdminPassword?: string;
  durationMs?: number;
}): { unlocked: boolean; error?: string } {
  if (!verifyAdminPin(params.pin, params.fallbackAdminPassword)) {
    return {
      unlocked: false,
      error: 'Invalid Master Admin PIN / Password.',
    };
  }
  if (!verifyTwoFactorOtp(params.otp)) {
    return {
      unlocked: false,
      error: 'Invalid or expired 6-digit 2FA OTP code. Check the active OTP badge or request a new code.',
    };
  }
  const durationMs = params.durationMs ?? 15 * 60 * 1000;
  try {
    sessionStorage.setItem(VAULT_UNLOCK_UNTIL_KEY, String(Date.now() + durationMs));
    sessionStorage.removeItem(TWO_FA_OTP_CHALLENGE_KEY);
  } catch {
    // Ignore
  }
  return { unlocked: true };
}

export interface TrustedDeviceRecord {
  deviceId: string;
  deviceLabel: string;
  platform: string;
  firstSeenAt: number;
  lastSeenAt: number;
  operatorLabel: string;
  email?: string;
  acknowledged: boolean;
}

export interface DeviceTrustCheckResult {
  deviceId: string;
  deviceLabel: string;
  isNewDevice: boolean;
  firstSeenAt: number;
  knownDeviceCount: number;
}

function getBrowserDeviceLabel(): { label: string; platform: string } {
  if (typeof navigator === 'undefined') {
    return { label: 'DRC Workstation', platform: 'Unknown' };
  }
  const ua = navigator.userAgent || '';
  const platform =
    /Android/i.test(ua)
      ? 'Android Device'
      : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS Device'
      : /CrOS/i.test(ua)
      ? 'Chromebook'
      : /Windows/i.test(ua)
      ? 'Windows PC'
      : /Mac/i.test(ua)
      ? 'macOS'
      : 'Browser Client';
  const browser =
    /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
      ? 'Firefox'
      : /Safari\//i.test(ua)
      ? 'Safari'
      : 'WebView';
  return { label: `${platform} (${browser})`, platform };
}

export function getOrCreateCurrentDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && existing.trim().length >= 8) return existing.trim();
    const freshId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `DRC-${crypto.randomUUID().slice(0, 12).toUpperCase()}`
        : `DRC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, freshId);
    return freshId;
  } catch {
    return 'DRC-EPHEMERAL-DEVICE';
  }
}

export function getTrustedDevices(): TrustedDeviceRecord[] {
  try {
    const raw = localStorage.getItem(TRUSTED_DEVICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrustedDeviceRecord[]) : [];
  } catch {
    return [];
  }
}

export function checkAndRegisterCurrentDevice(context: {
  operatorLabel: string;
  email?: string | null;
}): DeviceTrustCheckResult {
  const deviceId = getOrCreateCurrentDeviceId();
  const { label, platform } = getBrowserDeviceLabel();
  const now = Date.now();
  const devices = getTrustedDevices();
  const existingIdx = devices.findIndex((d) => d.deviceId === deviceId);

  if (existingIdx >= 0) {
    const existing = devices[existingIdx];
    const updated: TrustedDeviceRecord = {
      ...existing,
      deviceLabel: label,
      platform,
      lastSeenAt: now,
      operatorLabel: context.operatorLabel || existing.operatorLabel,
      email: context.email || existing.email,
    };
    devices[existingIdx] = updated;
    try {
      localStorage.setItem(TRUSTED_DEVICES_STORAGE_KEY, JSON.stringify(devices.slice(-20)));
    } catch {
      // Ignore
    }
    return {
      deviceId,
      deviceLabel: label,
      isNewDevice: !existing.acknowledged,
      firstSeenAt: existing.firstSeenAt,
      knownDeviceCount: devices.length,
    };
  }

  const freshRecord: TrustedDeviceRecord = {
    deviceId,
    deviceLabel: label,
    platform,
    firstSeenAt: now,
    lastSeenAt: now,
    operatorLabel: context.operatorLabel || 'Operator',
    email: context.email || undefined,
    acknowledged: false,
  };
  const nextList = [...devices, freshRecord].slice(-20);
  try {
    localStorage.setItem(TRUSTED_DEVICES_STORAGE_KEY, JSON.stringify(nextList));
  } catch {
    // Ignore
  }

  void dispatchBackgroundNotification({
    title: 'New-Device Security Alert — Dolphin Road Carriers',
    body: `Unrecognized device ${label} [${deviceId}] signed in (${context.operatorLabel}). Verify Admin PIN & 2FA OTP if unauthorized.`,
    tag: 'drc-new-device-alert',
    requireInteraction: true,
  });

  return {
    deviceId,
    deviceLabel: label,
    isNewDevice: true,
    firstSeenAt: now,
    knownDeviceCount: nextList.length,
  };
}

export function acknowledgeNewDeviceAlert(deviceId?: string): void {
  const targetId = deviceId || getOrCreateCurrentDeviceId();
  const devices = getTrustedDevices().map((d) =>
    d.deviceId === targetId ? { ...d, acknowledged: true, lastSeenAt: Date.now() } : d
  );
  try {
    localStorage.setItem(TRUSTED_DEVICES_STORAGE_KEY, JSON.stringify(devices));
  } catch {
    // Ignore
  }
}

export const MASTER_ADMIN_PROTECTED_EMAIL = 'drc.2015kolkata@gmail.com';
const MASTER_AUTHORIZED_DEVICES_KEY = 'drc_master_authorized_hardware_v1';

export interface AuthorizedHardwareDevice {
  deviceId: string;
  deviceLabel: string;
  platform: string;
  authorizedAt: number;
  authorizedEmail: string;
  operatorLabel: string;
}

export function getAuthorizedHardwareDevices(): AuthorizedHardwareDevice[] {
  try {
    const raw = localStorage.getItem(MASTER_AUTHORIZED_DEVICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuthorizedHardwareDevice[]) : [];
  } catch {
    return [];
  }
}

export function isCurrentDeviceAuthorizedForMasterEmail(email?: string | null): boolean {
  const normEmail = String(email || '').trim().toLowerCase();
  if (normEmail !== MASTER_ADMIN_PROTECTED_EMAIL) {
    return true; // Only lock Master Admin Gmail hardware; branch staff bypass smoothly
  }
  const currentId = getOrCreateCurrentDeviceId();
  const list = getAuthorizedHardwareDevices();
  // Bootstrap first-ever Master Admin workstation automatically; block any subsequent unrecognized device until PIN + 2FA OTP
  if (list.length === 0) {
    const { label, platform } = getBrowserDeviceLabel();
    const initial: AuthorizedHardwareDevice = {
      deviceId: currentId,
      deviceLabel: label,
      platform,
      authorizedAt: Date.now(),
      authorizedEmail: MASTER_ADMIN_PROTECTED_EMAIL,
      operatorLabel: 'Primary Master Workstation',
    };
    try {
      localStorage.setItem(MASTER_AUTHORIZED_DEVICES_KEY, JSON.stringify([initial]));
    } catch {
      // Ignore
    }
    return true;
  }
  return list.some((d) => d.deviceId === currentId);
}

export function authorizeCurrentDeviceWithPinAndOtp(params: {
  pin: string;
  otp: string;
  operatorLabel: string;
  fallbackAdminPassword?: string;
}): { authorized: boolean; error?: string } {
  const res = unlockBackupVaultWithPinAndOtp({
    pin: params.pin,
    otp: params.otp,
    fallbackAdminPassword: params.fallbackAdminPassword,
  });
  if (!res.unlocked) {
    return { authorized: false, error: res.error };
  }
  const currentId = getOrCreateCurrentDeviceId();
  const { label, platform } = getBrowserDeviceLabel();
  const list = getAuthorizedHardwareDevices().filter((d) => d.deviceId !== currentId);
  const next: AuthorizedHardwareDevice[] = [
    ...list,
    {
      deviceId: currentId,
      deviceLabel: label,
      platform,
      authorizedAt: Date.now(),
      authorizedEmail: MASTER_ADMIN_PROTECTED_EMAIL,
      operatorLabel: params.operatorLabel || 'Master Admin',
    },
  ];
  try {
    localStorage.setItem(MASTER_AUTHORIZED_DEVICES_KEY, JSON.stringify(next));
    acknowledgeNewDeviceAlert(currentId);
  } catch {
    // Ignore
  }
  return { authorized: true };
}

export function revokeAuthorizedHardwareDevice(deviceId: string): AuthorizedHardwareDevice[] {
  const next = getAuthorizedHardwareDevices().filter((d) => d.deviceId !== deviceId);
  try {
    localStorage.setItem(MASTER_AUTHORIZED_DEVICES_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}


