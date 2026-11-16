import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  MASTER_ADMIN_EMAIL,
  OperationType,
} from './firebase';
import {
  loadAllCollectionsFromIdb,
  saveAllCollectionsToIdb,
  saveCollectionToIdb,
} from './indexedDbStore';
import { StaffAccount } from '../types/erp';

export type CounterSerialType = 'cn' | 'invoice' | 'quotation' | 'tx';

export interface CustomAuthSession {
  userId: string;
  displayName: string;
  role: string;
  isMasterAdmin: boolean;
  branchCode: string;
  workspaceUid: string;
  staffAccount: StaffAccount | null;
  loggedInAt: number;
}

const SESSION_STORAGE_KEY = 'drc_erp_auth_session_v1';
const CACHE_STORAGE_KEY = 'drc_erp_offline_cache_v1';

// ============================================================================
// Client Auth Session Persistence (Windows / Android / Preview Safe)
// ============================================================================

export function loadSavedErpSession(): CustomAuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomAuthSession;
    if (!parsed || !parsed.userId || !parsed.workspaceUid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveErpSession(session: CustomAuthSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota issues
  }
}

export function clearErpSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export async function loginWithCredentials(
  userId: string,
  password: string
): Promise<CustomAuthSession> {
  const res = await fetch('/api/erp/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    session?: CustomAuthSession;
    error?: string;
  };

  if (!res.ok || !json.session) {
    throw new Error(json.error || 'Login failed. Please check User ID and Password.');
  }

  saveErpSession(json.session);
  return json.session;
}

export async function getAuthLoginConfig(): Promise<{
  isDefaultAdmin: boolean;
  adminUserIdHint: string;
}> {
  try {
    const res = await fetch('/api/erp/auth/config', { cache: 'no-store' });
    if (!res.ok) return { isDefaultAdmin: true, adminUserIdHint: 'admin' };
    const json = (await res.json()) as { isDefaultAdmin?: boolean; adminUserIdHint?: string };
    return {
      isDefaultAdmin: json.isDefaultAdmin !== false,
      adminUserIdHint: json.adminUserIdHint || 'admin',
    };
  } catch {
    return { isDefaultAdmin: true, adminUserIdHint: 'admin' };
  }
}

export async function updateMasterAdminCredentials(params: {
  currentPassword: string;
  newUserId: string;
  newPassword: string;
}): Promise<CustomAuthSession> {
  const res = await fetch('/api/erp/auth/update-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    session?: CustomAuthSession;
    error?: string;
  };

  if (!res.ok || !json.session) {
    throw new Error(json.error || 'Failed to update Master Admin credentials.');
  }

  saveErpSession(json.session);
  return json.session;
}

// ============================================================================
// Real-Time SSE + Offline-Resilient Store Sync
// ============================================================================

type CollectionListener = (items: unknown[]) => void;

const collectionState = new Map<string, unknown[]>();
const collectionListeners = new Map<string, Set<CollectionListener>>();
let eventSource: EventSource | null = null;
let initialFetchPromise: Promise<void> | null = null;

let idbHydrationPromise: Promise<void> | null = null;
let serverLoaded = false;

function loadOfflineCache(): void {
  if (collectionState.size > 0) return;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown[]>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) {
        collectionState.set(k, v);
      }
    }
  } catch {
    // Ignore invalid cache
  }
}

function hydrateFromIndexedDb(): void {
  if (idbHydrationPromise) return;
  idbHydrationPromise = loadAllCollectionsFromIdb()
    .then((cached) => {
      if (serverLoaded) return;
      for (const [col, items] of Object.entries(cached)) {
        if (Array.isArray(items) && !collectionState.has(col)) {
          collectionState.set(col, items);
          const listeners = collectionListeners.get(col);
          if (listeners) {
            listeners.forEach((cb) => {
              try {
                cb(items);
              } catch {
                // Ignore listener error
              }
            });
          }
        }
      }
    })
    .catch(() => {
      // Ignore IndexedDB unavailability
    });
}

function saveOfflineCache(): void {
  try {
    const obj: Record<string, unknown[]> = {};
    for (const [k, v] of collectionState.entries()) {
      obj[k] = v;
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Quota exceeded on large datasets -> IndexedDB handles multi-MB persistence
  }
}

function notifyCollection(collectionName: string, items: unknown[]): void {
  collectionState.set(collectionName, items);
  saveOfflineCache();
  void saveCollectionToIdb(collectionName, items);
  const listeners = collectionListeners.get(collectionName);
  if (listeners) {
    listeners.forEach((cb) => {
      try {
        cb(items);
      } catch (err) {
        console.error(`Listener error on ${collectionName}:`, err);
      }
    });
  }
}

function applyFullState(state: Record<string, unknown>): void {
  const idbBatch: Record<string, unknown[]> = {};
  for (const [key, val] of Object.entries(state)) {
    if (Array.isArray(val)) {
      collectionState.set(key, val);
      idbBatch[key] = val;
      const listeners = collectionListeners.get(key);
      if (listeners) {
        listeners.forEach((cb) => {
          try {
            cb(val);
          } catch (err) {
            console.error(`Listener error on ${key}:`, err);
          }
        });
      }
    }
  }
  saveOfflineCache();
  void saveAllCollectionsToIdb(idbBatch);
}

async function ensureServerSyncStarted(): Promise<void> {
  loadOfflineCache();
  hydrateFromIndexedDb();

  if (!initialFetchPromise) {
    initialFetchPromise = fetch('/api/erp/state')
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { ok?: boolean; state?: Record<string, unknown> };
        if (json.state) {
          serverLoaded = true;
          applyFullState(json.state);
        }
      })
      .catch(() => {
        // Offline mode continues cleanly from cached IndexedDB/localStorage state
      });
  }

  if (typeof window !== 'undefined' && typeof EventSource !== 'undefined' && !eventSource) {
    try {
      eventSource = new EventSource('/api/erp/stream');
      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            collection?: string;
            items?: unknown[];
            state?: Record<string, unknown>;
          };
          if (msg.type === 'full' && msg.state) {
            applyFullState(msg.state);
          } else if (msg.type === 'collection' && msg.collection && Array.isArray(msg.items)) {
            notifyCollection(msg.collection, msg.items);
          }
        } catch {
          // Ignore malformed keepalive events
        }
      };
      eventSource.onerror = () => {
        // EventSource automatically reconnects in background
      };
    } catch {
      // Ignore if EventSource unavailable
    }
  }
}

export function subscribeCollection<T>(
  collectionName: string,
  ownerUid: string,
  userEmail: string | null | undefined,
  onData: (items: T[]) => void
) {
  ensureServerSyncStarted();

  let set = collectionListeners.get(collectionName);
  if (!set) {
    set = new Set();
    collectionListeners.set(collectionName, set);
  }

  const listener: CollectionListener = (items) => {
    onData(items as T[]);
  };
  set.add(listener);

  // Immediately push cached state if available
  const existing = collectionState.get(collectionName);
  if (existing) {
    onData(existing as T[]);
  }

  // Optional Firebase Firestore real-time mirror ONLY when Google account is verified
  let firestoreUnsub: (() => void) | null = null;
  if (auth.currentUser?.emailVerified) {
    try {
      const colRef = collection(db, collectionName);
      const q =
        userEmail === MASTER_ADMIN_EMAIL
          ? query(colRef)
          : query(colRef, where('ownerUid', '==', ownerUid));

      firestoreUnsub = onSnapshot(
        q,
        () => {
          // Primary multi-branch state is synchronized via /api/erp/stream
        },
        (error) => {
          console.warn(`Firestore optional sync (${collectionName}):`, error.message);
        }
      );
    } catch {
      // Ignore optional Firestore listener setup errors
    }
  }

  return () => {
    const activeSet = collectionListeners.get(collectionName);
    if (activeSet) {
      activeSet.delete(listener);
    }
    if (firestoreUnsub) {
      firestoreUnsub();
    }
  };
}

// ============================================================================
// CRUD & Atomic Operations (Server API + Optional Verified Firestore Mirror)
// ============================================================================

export async function upsertDocument(
  collectionName: string,
  id: string,
  payload: Record<string, unknown>,
  isNew: boolean
) {
  const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);

  const res = await fetch('/api/erp/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection: collectionName,
      id: safeId,
      payload,
      isNew,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    id?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Failed to save ${collectionName}/${safeId}`);
  }

  // Optional Firestore mirror if user connected verified Google account
  if (auth.currentUser?.emailVerified) {
    const ref = doc(db, collectionName, safeId);
    try {
      if (isNew) {
        await setDoc(ref, {
          ...payload,
          ownerUid: auth.currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      try {
        handleFirestoreError(
          error,
          isNew ? OperationType.CREATE : OperationType.UPDATE,
          `${collectionName}/${safeId}`
        );
      } catch {
        // Keep primary ERP save intact
      }
    }
  }

  return json.id || safeId;
}

export async function saveSettingsDocument(
  settingId: string,
  payload: Record<string, unknown>,
  exists: boolean
) {
  const safeId = settingId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);

  const res = await fetch('/api/erp/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settingId: safeId, payload }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || 'Failed to save company settings.');
  }

  if (auth.currentUser?.emailVerified) {
    const ref = doc(db, 'settings', safeId);
    try {
      if (!exists) {
        await setDoc(ref, {
          ...payload,
          ownerUid: auth.currentUser.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Optional cloud mirror
    }
  }
}

export async function removeDocument(collectionName: string, id: string) {
  const res = await fetch('/api/erp/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection: collectionName, id }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || `Failed to delete ${collectionName}/${id}`);
  }

  if (auth.currentUser?.emailVerified) {
    try {
      await deleteDoc(doc(db, collectionName, id));
    } catch {
      // Optional cloud mirror
    }
  }
}

/**
 * Atomic server-side serial counter for collision-free numbering across 50+ concurrent operators.
 */
export async function reserveNextSerialNumber(params: {
  type: CounterSerialType;
  fy: string;
  branchCode: string;
  staffCode: string;
  ownerUid: string;
}): Promise<{ formattedNo: string; seq: number }> {
  const res = await fetch('/api/erp/counter/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    formattedNo?: string;
    seq?: number;
    error?: string;
  };

  if (!res.ok || !json.formattedNo) {
    throw new Error(json.error || 'Failed to reserve next serial number.');
  }

  return { formattedNo: json.formattedNo, seq: json.seq || 1 };
}

export async function upsertStaffPresence(params: {
  ownerUid: string;
  staffCode: string;
  displayName: string;
  role: string;
  branchCode: string;
  activeModule: string;
  deviceType: string;
  status: 'online' | 'offline';
}): Promise<void> {
  try {
    await fetch('/api/erp/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Presence heartbeat failures shouldn't interrupt workflow
  }
}

export async function logBranchActivity(params: {
  action: string;
  module: string;
  docRefCode?: string;
  summary: string;
  staffCode: string;
  staffName?: string;
  branchCode: string;
  ownerUid: string;
}): Promise<void> {
  try {
    await fetch('/api/erp/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-blocking activity log
  }
}

export async function seedSampleDataset(ownerUid: string): Promise<void> {
  const res = await fetch('/api/erp/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerUid }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || 'Failed to load sample DRC dataset.');
  }
}

export async function restoreErpBackupBundle(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/erp/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || 'Failed to restore backup bundle.');
  }
}
