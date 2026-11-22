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
