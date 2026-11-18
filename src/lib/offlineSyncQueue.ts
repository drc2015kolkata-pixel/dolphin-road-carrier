export type OfflineOpType = 'upsert' | 'bulk-upsert' | 'delete' | 'settings';

export interface OfflineQueuedOp {
  id: string;
  opType: OfflineOpType;
  collectionName: string;
  docId?: string;
  payload?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  isNew?: boolean;
  createdAt: number;
  attempts: number;
}

export interface OfflineSyncSnapshot {
  online: boolean;
  pendingCount: number;
  flushing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
}

const QUEUE_STORAGE_KEY = 'drc_erp_offline_sync_queue_v1';
const LAST_SYNC_STORAGE_KEY = 'drc_erp_last_sync_ts_v1';

type SyncListener = (snapshot: OfflineSyncSnapshot) => void;
const listeners = new Set<SyncListener>();

let isFlushing = false;
let lastError: string | null = null;
let listenersBound = false;

function readQueue(): OfflineQueuedOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineQueuedOp[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: OfflineQueuedOp[]): void {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-300)));
    }
  } catch {
    // Ignore storage quota issues
  }
}

function readLastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLastSyncedAt(ts: number): void {
  try {
    localStorage.setItem(LAST_SYNC_STORAGE_KEY, String(ts));
  } catch {
    // Ignore
  }
}

export function getOfflineSyncStatus(): OfflineSyncSnapshot {
  const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const queue = readQueue();
  return {
    online,
    pendingCount: queue.length,
    flushing: isFlushing,
    lastSyncedAt: readLastSyncedAt(),
    lastError,
  };
}

function emitStatus(): void {
  const snap = getOfflineSyncStatus();
  listeners.forEach((cb) => {
    try {
      cb(snap);
    } catch {
      // Ignore subscriber error
    }
  });
}

export function markCloudSyncedNow(): void {
  writeLastSyncedAt(Date.now());
  lastError = null;
  emitStatus();
}

export function enqueueOfflineOp(
  op: Omit<OfflineQueuedOp, 'id' | 'createdAt' | 'attempts'>
): void {
  const queue = readQueue();
  // Deduplicate same upsert/delete on identical docId
  const filtered = queue.filter((existing) => {
    if (!op.docId) return true;
    return !(
      existing.collectionName === op.collectionName &&
      existing.docId === op.docId &&
      existing.opType === op.opType
    );
  });
  filtered.push({
    ...op,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    attempts: 0,
  });
  writeQueue(filtered);
  emitStatus();
}

export async function flushOfflineSyncQueue(): Promise<{
  flushed: number;
  remaining: number;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    emitStatus();
    return { flushed: 0, remaining: readQueue().length };
  }
  if (isFlushing) {
    return { flushed: 0, remaining: readQueue().length };
  }
  const queue = readQueue();
  if (queue.length === 0) {
    emitStatus();
    return { flushed: 0, remaining: 0 };
  }

  isFlushing = true;
  lastError = null;
  emitStatus();

  let flushed = 0;
  const remaining: OfflineQueuedOp[] = [];

  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    try {
      let res: Response;
      if (item.opType === 'upsert') {
        res = await fetch('/api/erp/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: item.collectionName,
            id: item.docId,
            payload: item.payload || {},
            isNew: Boolean(item.isNew),
          }),
        });
      } else if (item.opType === 'bulk-upsert') {
        res = await fetch('/api/erp/bulk-upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: item.collectionName,
            items: item.items || [],
          }),
        });
      } else if (item.opType === 'delete') {
        res = await fetch('/api/erp/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: item.collectionName,
            id: item.docId,
          }),
        });
      } else {
        res = await fetch('/api/erp/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settingId: item.docId || 'company',
            payload: item.payload || {},
          }),
        });
      }

      if (!res.ok && res.status >= 500) {
        throw new Error(`Server unavailable (${res.status})`);
      }
      flushed += 1;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Sync pending';
      remaining.push({ ...item, attempts: item.attempts + 1 });
      for (let j = i + 1; j < queue.length; j += 1) {
        remaining.push(queue[j]);
      }
      break;
    }
  }

  writeQueue(remaining);
  if (remaining.length === 0 && flushed > 0) {
    writeLastSyncedAt(Date.now());
  }
  isFlushing = false;
  emitStatus();
  return { flushed, remaining: remaining.length };
}

export function subscribeOfflineSyncStatus(cb: SyncListener): () => void {
  if (typeof window !== 'undefined' && !listenersBound) {
    listenersBound = true;
    window.addEventListener('online', () => {
      emitStatus();
      void flushOfflineSyncQueue();
    });
    window.addEventListener('offline', () => {
      emitStatus();
    });
  }

  listeners.add(cb);
  cb(getOfflineSyncStatus());
  return () => {
    listeners.delete(cb);
  };
}
