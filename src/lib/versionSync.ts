import { registerSW } from 'virtual:pwa-register';

export interface VersionStatusInfo {
  appVersion: string;
  buildTime: string;
  serverVersion: string | null;
  serverBootAt: string | null;
  swActive: boolean;
  updateAvailable: boolean;
  lastCheckedAt: number | null;
  checking: boolean;
  message: string;
}

export const CLIENT_APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0.0';
export const CLIENT_BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString();

const RELOAD_GUARD_KEY = 'drc_erp_sw_reloaded_build';

let swRegistration: ServiceWorkerRegistration | null = null;
let initialized = false;
let reloadScheduled = false;

let status: VersionStatusInfo = {
  appVersion: CLIENT_APP_VERSION,
  buildTime: CLIENT_BUILD_TIME,
  serverVersion: null,
  serverBootAt: null,
  swActive: false,
  updateAvailable: false,
  lastCheckedAt: null,
  checking: false,
  message: 'Auto-Update Engine Ready (registerType: autoUpdate)',
};

const listeners = new Set<(info: VersionStatusInfo) => void>();

function emit(): void {
  const snapshot = { ...status };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  });
}

function triggerSingleShotReload(reasonKey: string): void {
  if (reloadScheduled || typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === reasonKey) {
      return;
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, reasonKey);
  } catch {
    // Proceed cleanly even if sessionStorage is restricted
  }
  reloadScheduled = true;
  window.location.reload();
}

export function subscribeVersionStatus(listener: (info: VersionStatusInfo) => void): () => void {
  listeners.add(listener);
  listener({ ...status });
  return () => {
    listeners.delete(listener);
  };
}

export function getVersionStatus(): VersionStatusInfo {
  return { ...status };
}

export async function checkForUpdatesNow(autoReloadIfUpdated = true): Promise<VersionStatusInfo> {
  status = { ...status, checking: true, message: 'Checking server & Service Worker for updates...' };
  emit();

  try {
    // 1. Trigger browser Service Worker check (silently activates via skipWaiting + clientsClaim)
    if (swRegistration) {
      await swRegistration.update().catch(() => {});
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      if (reg) {
        swRegistration = reg;
        await reg.update().catch(() => {});
      }
    }

    // 2. Check /api/version with cache-busting no-store request
    const res = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as {
        version?: string;
        buildTime?: string;
        serverBootAt?: string;
      };
      const serverVersion = data.version || CLIENT_APP_VERSION;
      const serverBuild = data.buildTime || '';
      const hasNewVersion =
        serverVersion !== CLIENT_APP_VERSION ||
        (Boolean(serverBuild) &&
          serverBuild !== 'dev' &&
          serverBuild !== CLIENT_BUILD_TIME);

      status = {
        ...status,
        checking: false,
        lastCheckedAt: Date.now(),
        serverVersion,
        serverBootAt: data.serverBootAt || null,
        swActive: Boolean(swRegistration?.active || navigator.serviceWorker?.controller),
        updateAvailable: hasNewVersion || Boolean(swRegistration?.waiting),
        message: hasNewVersion
          ? `New build ${serverVersion} detected — upgrading silently now...`
          : `Running latest DRC ERP v${CLIENT_APP_VERSION} (Auto-Sync Verified).`,
      };
      emit();

      if (hasNewVersion && autoReloadIfUpdated) {
        if ('caches' in window) {
          const cacheKeys = await caches.keys().catch(() => []);
          await Promise.all(cacheKeys.map((k) => caches.delete(k).catch(() => false)));
        }
        triggerSingleShotReload(`${serverVersion}_${serverBuild}`);
      }
    } else {
      status = {
        ...status,
        checking: false,
        lastCheckedAt: Date.now(),
        message: `Running DRC ERP v${CLIENT_APP_VERSION} (Offline-Resilient Cache Active).`,
      };
      emit();
    }
  } catch {
    status = {
      ...status,
      checking: false,
      lastCheckedAt: Date.now(),
      message: `Offline mode — continuing smoothly on DRC ERP v${CLIENT_APP_VERSION}.`,
    };
    emit();
  }

  return getVersionStatus();
}

export function initVersionSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      status = {
        ...status,
        swActive: true,
        updateAvailable: false,
        message: `Silently upgraded to DRC ERP v${CLIENT_APP_VERSION}.`,
      };
      emit();
    });

    registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        swRegistration = registration;
        status = {
          ...status,
          swActive: Boolean(registration.active || navigator.serviceWorker.controller),
          message: `PWA Auto-Update active (v${CLIENT_APP_VERSION})`,
        };
        emit();

        // Check silently for updates on startup & every 15 minutes
        void registration.update().catch(() => {});
        window.setInterval(() => {
          void registration.update().catch(() => {});
        }, 15 * 60 * 1000);
      },
      onOfflineReady() {
        status = {
          ...status,
          swActive: true,
          message: `Offline cache & IndexedDB ready (v${CLIENT_APP_VERSION})`,
        };
        emit();
      },
      onNeedRefresh() {
        status = {
          ...status,
          updateAvailable: true,
          message: 'Downloading silent background upgrade...',
        };
        emit();
        // Because workbox skipWaiting & clientsClaim are true, trigger clean update check
        void checkForUpdatesNow(true);
      },
      onRegisterError() {
        // Silently degrade if SW disabled in preview sandbox; app continues working normally
      },
    });
  }

  // Also check server version non-blockingly on startup
  void checkForUpdatesNow(false);
}
