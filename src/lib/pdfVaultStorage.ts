import { BusinessMode, PdfVaultFolder } from '../types/erp';
import { todayISO } from './formatters';

export const PDF_VAULT_FOLDERS: readonly PdfVaultFolder[] = [
  '1. LR_Copy_PDFs',
  '2. Tax_Invoice_PDFs',
  '3. Quotation_PDFs',
  '4. Declaration_PDFs',
  '5. POD_Scans_PDFs',
] as const;

export const PDF_VAULT_FOLDER_META: Record<
  PdfVaultFolder,
  {
    label: string;
    shortLabel: string;
    patternHint: string;
  }
> = {
  '1. LR_Copy_PDFs': {
    label: '1. LR Copy PDFs',
    shortLabel: 'LR Copy PDFs',
    patternHint: '[ConsigneeName]_[LRNo]_[DD-MM-YYYY].pdf',
  },
  '2. Tax_Invoice_PDFs': {
    label: '2. Tax Invoice PDFs',
    shortLabel: 'Tax Invoice PDFs',
    patternHint: '[PartyName]_[BillNo]_[DD-MM-YYYY].pdf',
  },
  '3. Quotation_PDFs': {
    label: '3. Quotation PDFs',
    shortLabel: 'Quotation PDFs',
    patternHint: '[PartyName]_Quotation_[DD-MM-YYYY].pdf',
  },
  '4. Declaration_PDFs': {
    label: '4. Declaration PDFs',
    shortLabel: 'Declaration PDFs',
    patternHint: '[PartyName]_Declaration_[DD-MM-YYYY].pdf',
  },
  '5. POD_Scans_PDFs': {
    label: '5. POD Scans PDFs',
    shortLabel: 'POD Scans PDFs',
    patternHint: 'POD_[TruckNo]_[DD-MM-YYYY].pdf',
  },
};

export interface PdfVaultMetadata {
  id: string;
  folder: PdfVaultFolder;
  division: BusinessMode;
  fileName: string;
  createdDate: string; // YYYY-MM-DD (used for Date Grouping: Today vs previous dates)
  createdAtIso: string;
  sizeKB: number;
  docNo?: string;
  partyName?: string;
  truckNo?: string;
  phone?: string;
  email?: string;
  driveSynced?: boolean;
  driveFileId?: string;
  driveWebViewLink?: string;
}

interface StoredVaultRecord extends PdfVaultMetadata {
  blob: Blob;
}

const DB_NAME = 'drc_pdf_vault_v1';
const DB_VERSION = 1;
const STORE_NAME = 'pdfs';

function dispatchVaultUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('drc-pdf-vault-updated'));
  }
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('folder', 'folder', { unique: false });
        store.createIndex('createdDate', 'createdDate', { unique: false });
        store.createIndex('division', 'division', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open PDF vault DB'));
  });
}

export function buildVaultEntryId(
  folder: PdfVaultFolder,
  division: BusinessMode,
  fileName: string
): string {
  const safeName = fileName.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
  return `${folder}__${division}__${safeName}`;
}

export async function savePdfToVault(params: {
  folder: PdfVaultFolder;
  division: BusinessMode;
  fileName: string;
  blob: Blob;
  docNo?: string;
  partyName?: string;
  truckNo?: string;
  phone?: string;
  email?: string;
  createdDate?: string;
}): Promise<PdfVaultMetadata | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openVaultDb();
    const id = buildVaultEntryId(params.folder, params.division, params.fileName);
    const createdDate =
      params.createdDate && /^\d{4}-\d{2}-\d{2}$/.test(params.createdDate)
        ? params.createdDate
        : todayISO();
    const createdAtIso = new Date().toISOString();
    const sizeKB = Math.max(1, Math.round(params.blob.size / 1024));

    const record: StoredVaultRecord = {
      id,
      folder: params.folder,
      division: params.division,
      fileName: params.fileName,
      createdDate,
      createdAtIso,
      sizeKB,
      docNo: params.docNo,
      partyName: params.partyName,
      truckNo: params.truckNo,
      phone: params.phone,
      email: params.email,
      driveSynced: false,
      blob: params.blob,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getExistingReq = store.get(id);
      getExistingReq.onsuccess = () => {
        const prev = getExistingReq.result as StoredVaultRecord | undefined;
        store.put({
          ...record,
          // Keep contact info if re-saved from preview without explicit phone/email
          phone: record.phone || prev?.phone,
          email: record.email || prev?.email,
        });
      };
      getExistingReq.onerror = () => {
        store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('PDF vault save failed'));
    });

    dispatchVaultUpdated();
    const { blob: _omitBlob, ...meta } = record;
    return meta;
  } catch {
    return null;
  }
}

export async function listVaultPdfs(filters?: {
  folder?: PdfVaultFolder;
  division?: BusinessMode | 'ALL';
}): Promise<PdfVaultMetadata[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openVaultDb();
    const all = await new Promise<StoredVaultRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as StoredVaultRecord[]) || []);
      req.onerror = () => reject(req.error);
    });

    return all
      .filter((item) => {
        if (filters?.folder && item.folder !== filters.folder) return false;
        if (filters?.division && filters.division !== 'ALL' && item.division !== filters.division) {
          return false;
        }
        return true;
      })
      .map(({ blob: _omitBlob, ...meta }) => meta)
      .sort((a, b) => (b.createdAtIso || '').localeCompare(a.createdAtIso || ''));
  } catch {
    return [];
  }
}

export async function getVaultPdfEntry(
  id: string
): Promise<{ meta: PdfVaultMetadata; blob: Blob } | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openVaultDb();
    const rec = await new Promise<StoredVaultRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as StoredVaultRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!rec || !rec.blob) return null;
    const { blob, ...meta } = rec;
    return { meta, blob };
  } catch {
    return null;
  }
}

export async function markVaultPdfDriveSynced(
  id: string,
  driveInfo: { fileId?: string; webViewLink?: string }
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result as StoredVaultRecord | undefined;
        if (rec) {
          store.put({
            ...rec,
            driveSynced: true,
            driveFileId: driveInfo.fileId || rec.driveFileId,
            driveWebViewLink: driveInfo.webViewLink || rec.driveWebViewLink,
          });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dispatchVaultUpdated();
  } catch {
    // Non-blocking
  }
}

export async function deleteVaultPdf(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dispatchVaultUpdated();
  } catch {
    // Non-blocking
  }
}
