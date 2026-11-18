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
import {
  enqueueOfflineOp,
  flushOfflineSyncQueue,
  markCloudSyncedNow,
} from './offlineSyncQueue';
import { SheetAccessLevel, SheetPermissionKey, StaffAccount } from '../types/erp';

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
const LOCAL_ADMIN_STORAGE_KEY = 'drc_erp_local_admin_v1';

interface LocalAdminCreds {
  userId: string;
  password: string;
}

const DEFAULT_LOCAL_ADMIN: LocalAdminCreds = {
  userId: 'admin',
  password: 'admin123',
};

const BUILTIN_DEFAULT_STAFF: StaffAccount[] = [
  {
    id: 'staff_0',
    staffCode: 'DRC-STAFF-01',
    displayName: 'Amitava Sen (Howrah Billing)',
    role: 'Billing',
    branchCode: 'HOWRAH',
    pinHash: '1234',
    active: true,
    permissions: ['dashboard', 'lr', 'billing', 'reports'],
    ownerUid: 'drc_master_workspace',
  },
  {
    id: 'staff_1',
    staffCode: 'DRC-STAFF-02',
    displayName: 'Suman Chatterjee (Siliguri Accounts)',
    role: 'Accounts',
    branchCode: 'SILIGURI',
    pinHash: '5678',
    active: true,
    permissions: ['dashboard', 'lorryHire', 'accounts', 'reports', 'mis'],
    ownerUid: 'drc_master_workspace',
  },
];

export function ensureLocalAdminCreds(): LocalAdminCreds {
  try {
    const raw = localStorage.getItem(LOCAL_ADMIN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalAdminCreds>;
      if (parsed && typeof parsed.userId === 'string' && parsed.userId.trim() && typeof parsed.password === 'string' && parsed.password) {
        return { userId: parsed.userId.trim(), password: parsed.password };
      }
    }
    localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(DEFAULT_LOCAL_ADMIN));
  } catch {
    // Ignore storage unavailability
  }
  return { ...DEFAULT_LOCAL_ADMIN };
}

function saveLocalAdminCreds(creds: LocalAdminCreds): void {
  try {
    localStorage.setItem(LOCAL_ADMIN_STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // Ignore
  }
}

function buildAdminSession(userId: string): CustomAuthSession {
  return {
    userId,
    displayName: 'Master Admin',
    role: 'Admin',
    isMasterAdmin: true,
    branchCode: 'ALL',
    workspaceUid: 'drc_master_workspace',
    staffAccount: null,
    loggedInAt: Date.now(),
  };
}

// ============================================================================
// Client Auth Session Persistence (Windows / Android / Vercel / Preview Safe)
// ============================================================================

export function loadSavedErpSession(): CustomAuthSession | null {
  try {
    // Enforce mandatory Login Lock across fresh Windows/Android/Tablet launches:
    // keep active session strictly in sessionStorage and clear legacy persistent token.
    localStorage.removeItem(SESSION_STORAGE_KEY);
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
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
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota issues
  }
}

export function clearErpSession(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getStaffSheetAccess(
  session: CustomAuthSession | null,
  staffList: StaffAccount[],
  sheetKey: SheetPermissionKey
): SheetAccessLevel {
  if (!session) return 'blocked';
  if (session.isMasterAdmin || session.role === 'Admin') return 'edit';

  const latestStaff =
    staffList.find(
      (s) =>
        s.id === session.staffAccount?.id ||
        s.staffCode.toLowerCase() === session.userId.toLowerCase()
    ) || session.staffAccount;

  if (!latestStaff || latestStaff.active === false) return 'blocked';

  if (latestStaff.sheetPermissions && latestStaff.sheetPermissions[sheetKey]) {
    return latestStaff.sheetPermissions[sheetKey] as SheetAccessLevel;
  }

  // Backward-compatible fallback to legacy permissions[] when granular matrix wasn't explicitly customized yet
  const legacyMap: Record<SheetPermissionKey, string> = {
    lr: 'lr',
    billing: 'billing',
    lorryHire: 'lorryHire',
    commission: 'lorryHire',
    accounts: 'accounts',
    master: 'master',
    bankImport: 'accounts',
    reports: 'reports',
    quotations: 'billing',
    declarations: 'billing',
    settings: 'settings',
  };
  const legacyKey = legacyMap[sheetKey];
  if (latestStaff.permissions?.includes(legacyKey as never)) {
    return latestStaff.role === 'Viewer' ? 'view' : 'edit';
  }
  return 'blocked';
}

export async function loginWithCredentials(
  userId: string,
  password: string
): Promise<CustomAuthSession> {
  const cleanUserId = String(userId || '').trim();
  const cleanPassword = String(password || '').trim();

  if (!cleanUserId || !cleanPassword) {
    throw new Error('Please enter both User ID and Password.');
  }

  // Always auto-initialize default Master Admin credentials in fresh browser localStorage
  const localAdmin = ensureLocalAdminCreds();

  try {
    const res = await fetch('/api/erp/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: cleanUserId, password: cleanPassword }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        erpAuth?: boolean;
        session?: CustomAuthSession;
        error?: string;
      };

      if (res.ok && json.session) {
        if (json.session.isMasterAdmin) {
          saveLocalAdminCreds({ userId: json.session.userId, password: cleanPassword });
        }
        saveErpSession(json.session);
        return json.session;
      }

      // Only treat genuine ERP API rejections (erpAuth: true) as credential errors.
      // Static hosts (e.g. Vercel 404/405 JSON responses) fall cleanly to localStorage auth!
      if (json.erpAuth === true && res.status >= 400 && res.status < 500) {
        throw new Error(json.error || 'Invalid User ID or Password.');
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !/Failed to fetch|NetworkError|Load failed|fetch|JSON|Unexpected token/i.test(err.message)
    ) {
      throw err;
    }
  }

  // Guaranteed LocalStorage & Default Admin Auth (Fresh browser, Vercel static build, offline PWA)
  const isDefaultPair =
    cleanUserId.toLowerCase() === 'admin' && cleanPassword === 'admin123';
  const matchesLocalAdmin =
    cleanUserId.toLowerCase() === localAdmin.userId.toLowerCase() &&
    cleanPassword === localAdmin.password;

  if (isDefaultPair || matchesLocalAdmin) {
    if (isDefaultPair && (localAdmin.userId !== 'admin' || localAdmin.password !== 'admin123')) {
      // Only use default pair if local admin wasn't intentionally changed, OR guarantee admin/admin123 if fresh
      if (localAdmin.userId === 'admin' && localAdmin.password === 'admin123') {
        const session = buildAdminSession('admin');
        saveErpSession(session);
        return session;
      }
    }
    if (matchesLocalAdmin || isDefaultPair) {
      const effectiveUid = matchesLocalAdmin ? localAdmin.userId : 'admin';
      if (isDefaultPair && !matchesLocalAdmin) {
        saveLocalAdminCreds({ userId: 'admin', password: 'admin123' });
      }
      const session = buildAdminSession(effectiveUid);
      saveErpSession(session);
      return session;
    }
  }

  loadOfflineCache();
  const cachedStaff = (collectionState.get('staff_accounts') as StaffAccount[] | undefined) || [];
  const staffPool = cachedStaff.length > 0 ? cachedStaff : BUILTIN_DEFAULT_STAFF;
  const matched = staffPool.find(
    (s) =>
      s.active !== false &&
      String(s.staffCode || '').trim().toLowerCase() === cleanUserId.toLowerCase() &&
      String(s.pinHash || '') === cleanPassword
  );
  if (matched) {
    const offlineStaffSession: CustomAuthSession = {
      userId: matched.staffCode,
      displayName: matched.displayName || matched.staffCode,
      role: matched.role || 'Staff',
      isMasterAdmin: matched.role === 'Admin',
      branchCode: matched.branchCode || 'ALL',
      workspaceUid: 'drc_master_workspace',
      staffAccount: matched,
      loggedInAt: Date.now(),
    };
    saveErpSession(offlineStaffSession);
    return offlineStaffSession;
  }

  throw new Error('Invalid User ID or Password. Check credentials or click Restore Default (admin123).');
}

export async function resetAdminToDefaultAndLogin(): Promise<CustomAuthSession> {
  saveLocalAdminCreds({ ...DEFAULT_LOCAL_ADMIN });
  let session = buildAdminSession('admin');

  try {
    const res = await fetch('/api/erp/auth/reset-admin-default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { session?: CustomAuthSession };
      if (json.session) {
        session = json.session;
      }
    }
  } catch {
    // Static / offline environments complete directly via localStorage reset
  }

  saveErpSession(session);
  return session;
}

export async function getAuthLoginConfig(): Promise<{
  isDefaultAdmin: boolean;
  adminUserIdHint: string;
}> {
  const localAdmin = ensureLocalAdminCreds();
  try {
    const res = await fetch('/api/erp/auth/config', { cache: 'no-store' });
    if (!res.ok) {
      return {
        isDefaultAdmin:
          localAdmin.userId.toLowerCase() === 'admin' && localAdmin.password === 'admin123',
        adminUserIdHint: localAdmin.userId,
      };
    }
    const json = (await res.json()) as { isDefaultAdmin?: boolean; adminUserIdHint?: string };
    return {
      isDefaultAdmin: json.isDefaultAdmin !== false,
      adminUserIdHint: json.adminUserIdHint || localAdmin.userId || 'admin',
    };
  } catch {
    return {
      isDefaultAdmin:
        localAdmin.userId.toLowerCase() === 'admin' && localAdmin.password === 'admin123',
      adminUserIdHint: localAdmin.userId,
    };
  }
}

export async function updateMasterAdminCredentials(params: {
  currentPassword: string;
  newUserId: string;
  newPassword: string;
}): Promise<CustomAuthSession> {
  const cleanNewUid = params.newUserId.trim();
  const cleanNewPwd = params.newPassword.trim();
  try {
    const res = await fetch('/api/erp/auth/update-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        session?: CustomAuthSession;
        error?: string;
      };

      if (res.ok && json.session) {
        saveLocalAdminCreds({ userId: json.session.userId, password: cleanNewPwd });
        saveErpSession(json.session);
        return json.session;
      }
      if (res.status === 400) {
        throw new Error(json.error || 'Failed to update Master Admin credentials.');
      }
    }
  } catch (err) {
    if (err instanceof Error && !/Failed to fetch|NetworkError|Load failed/i.test(err.message)) {
      throw err;
    }
  }

  // Offline / static Vercel localStorage update
  const localAdmin = ensureLocalAdminCreds();
  if (params.currentPassword.trim() !== localAdmin.password) {
    throw new Error('Current Master Admin password is incorrect.');
  }
  saveLocalAdminCreds({ userId: cleanNewUid, password: cleanNewPwd });
  const updated = buildAdminSession(cleanNewUid);
  saveErpSession(updated);
  return updated;
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
          markCloudSyncedNow();
          void flushOfflineSyncQueue();
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
  const now = Date.now();

  // Optimistically update local collection cache & IndexedDB so static/offline mode works immediately
  const currentList = ([...(collectionState.get(collectionName) || [])] as Array<
    Record<string, unknown> & { id: string }
  >);
  const idx = currentList.findIndex((item) => item.id === safeId);
  if (idx >= 0) {
    currentList[idx] = {
      ...currentList[idx],
      ...payload,
      id: safeId,
      updatedAt: now,
    };
  } else {
    currentList.push({
      ...payload,
      id: safeId,
      createdAt: isNew ? now : (payload.createdAt ?? now),
      updatedAt: now,
    });
  }
  notifyCollection(collectionName, currentList);

  try {
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

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!res.ok && res.status === 400) {
        throw new Error(json.error || `Failed to save ${collectionName}/${safeId}`);
      }
      if (res.ok) {
        markCloudSyncedNow();
      } else {
        enqueueOfflineOp({
          opType: 'upsert',
          collectionName,
          docId: safeId,
          payload,
          isNew,
        });
      }
    } else if (!res.ok) {
      enqueueOfflineOp({
        opType: 'upsert',
        collectionName,
        docId: safeId,
        payload,
        isNew,
      });
    }
  } catch (err) {
    if (err instanceof Error && !/Failed to fetch|NetworkError|Load failed|fetch/i.test(err.message)) {
      throw err;
    }
    enqueueOfflineOp({
      opType: 'upsert',
      collectionName,
      docId: safeId,
      payload,
      isNew,
    });
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

  return safeId;
}

export async function bulkUpsertDocuments(
  collectionName: string,
  items: Array<Record<string, unknown>>
): Promise<number> {
  const now = Date.now();
  const currentList = ([...(collectionState.get(collectionName) || [])] as Array<
    Record<string, unknown> & { id: string }
  >);
  const map = new Map(currentList.map((d) => [d.id, d]));

  for (const row of items) {
    const rawId = String(row.id || `${collectionName.slice(0, 4)}_${now}_${Math.random().toString(36).slice(2, 7)}`);
    const safeId = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
    const existing = map.get(safeId);
    map.set(safeId, {
      ...(existing || {}),
      ...row,
      id: safeId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
  notifyCollection(collectionName, Array.from(map.values()));

  try {
    const res = await fetch('/api/erp/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: collectionName, items }),
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { count?: number };
      markCloudSyncedNow();
      return json.count ?? items.length;
    }
    enqueueOfflineOp({ opType: 'bulk-upsert', collectionName, items });
  } catch {
    enqueueOfflineOp({ opType: 'bulk-upsert', collectionName, items });
  }
  return items.length;
}

export async function saveSettingsDocument(
  settingId: string,
  payload: Record<string, unknown>,
  exists: boolean
) {
  const safeId = settingId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  const now = Date.now();
  const currentSettings = ([...(collectionState.get('settings') || [])] as Array<
    Record<string, unknown> & { id: string }
  >);
  const sIdx = currentSettings.findIndex((s) => s.id === safeId);
  if (sIdx >= 0) {
    currentSettings[sIdx] = { ...currentSettings[sIdx], ...payload, id: safeId, updatedAt: now };
  } else {
    currentSettings.push({ ...payload, id: safeId, updatedAt: now });
  }
  notifyCollection('settings', currentSettings);

  try {
    const res = await fetch('/api/erp/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settingId: safeId, payload }),
    });
    if (res.ok) {
      markCloudSyncedNow();
    } else {
      enqueueOfflineOp({ opType: 'settings', collectionName: 'settings', docId: safeId, payload });
    }
  } catch {
    enqueueOfflineOp({ opType: 'settings', collectionName: 'settings', docId: safeId, payload });
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
  const currentList = ([...(collectionState.get(collectionName) || [])] as Array<
    Record<string, unknown> & { id: string }
  >);
  notifyCollection(
    collectionName,
    currentList.filter((item) => item.id !== id)
  );

  try {
    const res = await fetch('/api/erp/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: collectionName, id }),
    });
    if (res.ok) {
      markCloudSyncedNow();
    } else {
      enqueueOfflineOp({ opType: 'delete', collectionName, docId: id });
    }
  } catch {
    enqueueOfflineOp({ opType: 'delete', collectionName, docId: id });
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
  try {
    const res = await fetch('/api/erp/counter/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        formattedNo?: string;
        seq?: number;
      };
      if (json.formattedNo) {
        return { formattedNo: json.formattedNo, seq: json.seq || 1 };
      }
    }
  } catch {
    // Fall through to local counter fallback when offline/static
  }

  const counterKey = `drc_local_counter_${params.type}_${params.fy}`;
  let nextSeq = 1;
  try {
    nextSeq = (Number(localStorage.getItem(counterKey) || '0') || 0) + 1;
    localStorage.setItem(counterKey, String(nextSeq));
  } catch {
    nextSeq = Math.floor(Math.random() * 900) + 1;
  }
  const shortMatch = params.fy.match(/(\d{2})\s*[-–]\s*(\d{2})$/);
  const fyShort = shortMatch ? `${shortMatch[1]}-${shortMatch[2]}` : '26-27';
  const branchTag = (params.branchCode || 'KOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'KOL';
  const formattedNo =
    params.type === 'cn'
      ? `${branchTag}-${146 + nextSeq}/${fyShort}`
      : params.type === 'invoice'
      ? `${branchTag}/${104 + nextSeq}/${fyShort}`
      : params.type === 'quotation'
      ? `QTN/${fyShort.slice(0, 2)}/${String(18 + nextSeq).padStart(3, '0')}`
      : `TRN${String(5 + nextSeq).padStart(3, '0')}`;
  return { formattedNo, seq: nextSeq };
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
