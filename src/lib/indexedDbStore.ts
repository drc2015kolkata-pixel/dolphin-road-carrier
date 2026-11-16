/**
 * IndexedDB Persistent Offline Mirror for Dolphin Road Carriers ERP
 * Provides multi-MB offline storage for 50,000+ consignments, invoices, ledgers & POD metadata
 * across Windows PC and Android devices with graceful fallback if IndexedDB is restricted.
 */

const IDB_NAME = 'drc_erp_indexeddb_v1';
const IDB_VERSION = 1;
const STORE_NAME = 'collections';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openErpDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export async function loadAllCollectionsFromIdb(): Promise<Record<string, unknown[]>> {
  const db = await openErpDb();
  if (!db) return {};

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const result: Record<string, unknown[]> = {};
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && Array.isArray(cursor.value)) {
            result[cursor.key] = cursor.value;
          }
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      cursorReq.onerror = () => resolve(result);
    } catch {
      resolve({});
    }
  });
}

export async function saveCollectionToIdb(collectionName: string, items: unknown[]): Promise<void> {
  const db = await openErpDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(items, collectionName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function saveAllCollectionsToIdb(state: Record<string, unknown[]>): Promise<void> {
  const db = await openErpDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const [k, v] of Object.entries(state)) {
        if (Array.isArray(v)) {
          store.put(v, k);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
