import { AnyDriveFolderName, BusinessMode, DriveFolderName, LogisticsDriveFolderName, PdfVaultFolder } from '../types/erp';
import { isAuthorizedBackupDriveEmail, MASTER_ADMIN_EMAIL } from './firebase';
import { isBlockedDangerousFileName } from './gstinValidator';

const ROOT_FOLDER_NAME = 'DOLPHIN_ROAD_CARRIERS_MASTER';
const LOGISTICS_ROOT_FOLDER_NAME = 'DOLPHIN_LOGISTICS_DIVISION_BACKUP';

export interface BackupIntegritySeal {
  algorithm: 'SHA-256';
  sha256: string;
  sealedAt: string;
  authorizedEmail: string;
  recordCount: number;
  schemaVersion: 'DRC_VAULT_SEAL_V1';
}

export function getDailySnapshotFileName(dateInput?: string | Date): string {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return `DRC_VAULT_SNAPSHOT_${dateInput.trim()}.json`;
  }
  const d = dateInput instanceof Date ? dateInput : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `DRC_VAULT_SNAPSHOT_${yyyy}-${mm}-${dd}.json`;
}

export function assertAuthorizedBackupAccount(connectedEmail?: string | null): void {
  if (connectedEmail !== undefined && connectedEmail !== null && String(connectedEmail).trim() !== '') {
    if (!isAuthorizedBackupDriveEmail(connectedEmail)) {
      throw new Error(
        `Drive Security Lock: Sync & Restore restricted strictly to ${MASTER_ADMIN_EMAIL} (current: ${connectedEmail}).`
      );
    }
  }
}

export function assertSafeDriveFileName(fileName: string): void {
  const clean = String(fileName || '').trim();
  if (!clean || isBlockedDangerousFileName(clean)) {
    throw new Error(
      `Security Blocker: Rejected unsafe filename "${clean}". Executables/scripts (.exe, .bat, .vbs, .js, etc.) are strictly blocked.`
    );
  }
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = obj[key];
      if (val !== undefined) {
        sorted[key] = canonicalizeValue(val);
      }
    }
    return sorted;
  }
  return value;
}

function sha256FallbackHex(ascii: string): string {
  const rightRotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  let padded = ascii + '\x80';
  while ((padded.length % 64) - 56) padded += '\x00';
  for (let i = 0; i < padded.length; i++) {
    const j = padded.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export async function computeSha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback to pure JS SHA-256 below
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return sha256FallbackHex(binary);
}

export function countBackupRecords(payload: Record<string, unknown>): number {
  let count = 0;
  for (const val of Object.values(payload)) {
    if (Array.isArray(val)) count += val.length;
  }
  return count;
}

function serializePayloadBodyWithoutIntegrity(payload: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...payload };
  delete copy.integrity;
  return JSON.stringify(canonicalizeValue(copy));
}

export async function sealBackupPayloadWithSha256(
  payload: Record<string, unknown>,
  authorizedEmail = MASTER_ADMIN_EMAIL
): Promise<{
  sealedPayload: Record<string, unknown>;
  sha256: string;
  recordCount: number;
  integrity: BackupIntegritySeal;
}> {
  const cleanBodyText = serializePayloadBodyWithoutIntegrity(payload);
  const sha256 = await computeSha256Hex(cleanBodyText);
  const recordCount = countBackupRecords(payload);
  const integrity: BackupIntegritySeal = {
    algorithm: 'SHA-256',
    sha256,
    sealedAt: new Date().toISOString(),
    authorizedEmail: authorizedEmail || MASTER_ADMIN_EMAIL,
    recordCount,
    schemaVersion: 'DRC_VAULT_SEAL_V1',
  };
  return {
    sealedPayload: {
      ...payload,
      integrity,
    },
    sha256,
    recordCount,
    integrity,
  };
}

export async function verifyBackupPayloadSha256(payload: Record<string, unknown>): Promise<{
  valid: boolean;
  hasSeal: boolean;
  expectedSha256?: string;
  actualSha256?: string;
  reason?: string;
}> {
  const rawIntegrity = payload?.integrity as Partial<BackupIntegritySeal> | undefined;
  if (!rawIntegrity || !rawIntegrity.sha256) {
    return {
      valid: true,
      hasSeal: false,
      reason: 'Legacy unsealed backup payload (no SHA-256 header present).',
    };
  }
  const expectedSha256 = String(rawIntegrity.sha256).trim().toLowerCase();
  const actualSha256 = await computeSha256Hex(serializePayloadBodyWithoutIntegrity(payload));
  if (expectedSha256 !== actualSha256) {
    return {
      valid: false,
      hasSeal: true,
      expectedSha256,
      actualSha256,
      reason: `SHA-256 integrity mismatch! Expected ${expectedSha256.slice(0, 12)}…, computed ${actualSha256.slice(0, 12)}…. Possible tampering or file corruption.`,
    };
  }
  return {
    valid: true,
    hasSeal: true,
    expectedSha256,
    actualSha256,
  };
}

function extractRecordTs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (val && typeof val === 'object') {
    const obj = val as { seconds?: unknown; toMillis?: unknown };
    if (typeof obj.toMillis === 'function') return (obj.toMillis as () => number)();
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

function unionMergeArrayRecords(localArr: unknown[], remoteArr: unknown[]): unknown[] {
  const map = new Map<string, Record<string, unknown>>();
  const upsertItem = (raw: unknown, idx: number, source: 'remote' | 'local') => {
    if (!raw || typeof raw !== 'object') return;
    const rec = raw as Record<string, unknown>;
    const key =
      String(
        rec.id ||
          rec.cnNo ||
          rec.invoiceNo ||
          rec.challanNo ||
          rec.quotationNo ||
          rec.docketNo ||
          rec.manifestNo ||
          rec.name ||
          `${source}_${idx}`
      ).trim() || `${source}_${idx}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, rec);
      return;
    }
    const existingTs = extractRecordTs(existing.updatedAt) || extractRecordTs(existing.createdAt);
    const incomingTs = extractRecordTs(rec.updatedAt) || extractRecordTs(rec.createdAt);
    if (incomingTs >= existingTs) {
      map.set(key, { ...existing, ...rec });
    } else {
      map.set(key, { ...rec, ...existing });
    }
  };

  remoteArr.forEach((item, idx) => upsertItem(item, idx, 'remote'));
  localArr.forEach((item, idx) => upsertItem(item, idx, 'local'));
  return Array.from(map.values());
}

/**
 * Append-Only Union Merge (`local + Drive`): combines records from both local state and Drive
 * without ever deleting local or remote entries.
 */
export function unionMergeBackupBundles(
  localBundle: Record<string, unknown>,
  remoteBundle: Record<string, unknown> | null
): Record<string, unknown> {
  if (!remoteBundle || typeof remoteBundle !== 'object') {
    return { ...localBundle };
  }

  const keyGroups: Array<[string, string[]]> = [
    ['parties', ['parties']],
    ['vehicles', ['vehicles']],
    ['drivers', ['drivers']],
    ['consignments', ['consignments']],
    ['invoices', ['invoices']],
    ['quotations', ['quotations']],
    ['lorryHires', ['lorryHires', 'lorry_hires']],
    ['transactions', ['transactions']],
    ['declarations', ['declarations']],
    ['bankReceipts', ['bankReceipts', 'bank_receipts']],
    ['staffCommissions', ['staffCommissions', 'staff_commissions']],
    ['staffAccounts', ['staffAccounts', 'staff_accounts']],
    ['logisticsParties', ['logisticsParties', 'logistics_parties']],
    ['logisticsVehicles', ['logisticsVehicles', 'logistics_vehicles']],
    ['logisticsDrivers', ['logisticsDrivers', 'logistics_drivers']],
    ['logisticsDockets', ['logisticsDockets', 'logistics_dockets']],
    ['logisticsManifests', ['logisticsManifests', 'logistics_manifests']],
    ['logisticsInvoices', ['logisticsInvoices', 'logistics_invoices']],
    ['logisticsLedgers', ['logisticsLedgers', 'logistics_ledgers']],
  ];

  const extractGroupArray = (obj: Record<string, unknown>, aliases: string[]): unknown[] => {
    for (const k of aliases) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
    return [];
  };

  const merged: Record<string, unknown> = {
    ...remoteBundle,
    ...localBundle,
    mergedMode: 'APPEND_ONLY_UNION_LOCAL_PLUS_DRIVE',
    exportedAt: new Date().toISOString(),
  };

  const handledKeys = new Set<string>();
  for (const [primaryKey, aliases] of keyGroups) {
    aliases.forEach((k) => handledKeys.add(k));
    const localArr = extractGroupArray(localBundle, aliases);
    const remoteArr = extractGroupArray(remoteBundle, aliases);
    if (localArr.length > 0 || remoteArr.length > 0 || aliases.some((k) => k in localBundle || k in remoteBundle)) {
      merged[primaryKey] = unionMergeArrayRecords(localArr, remoteArr);
      for (const alias of aliases) {
        if (alias !== primaryKey && alias in merged) {
          delete merged[alias];
        }
      }
    }
  }

  for (const key of new Set([...Object.keys(remoteBundle), ...Object.keys(localBundle)])) {
    if (handledKeys.has(key) || key === 'integrity') continue;
    const localVal = localBundle[key];
    const remoteVal = remoteBundle[key];
    if (Array.isArray(localVal) || Array.isArray(remoteVal)) {
      merged[key] = unionMergeArrayRecords(
        Array.isArray(localVal) ? localVal : [],
        Array.isArray(remoteVal) ? remoteVal : []
      );
    }
  }

  if (remoteBundle.company && typeof remoteBundle.company === 'object') {
    const localCompany =
      localBundle.company && typeof localBundle.company === 'object'
        ? (localBundle.company as Record<string, unknown>)
        : {};
    merged.company = {
      ...(remoteBundle.company as Record<string, unknown>),
      ...localCompany,
    };
  }

  delete merged.integrity;
  return merged;
}

const FOLDER_LIST: DriveFolderName[] = [
  'LR Copy',
  'Bills_Invoices',
  'Quotations',
  'POD_Scans',
  'Declarations',
  'Reports_Ledgers',
  'Bank_Statements',
];

export const LOGISTICS_DRIVE_FOLDERS: LogisticsDriveFolderName[] = [
  'Docket_LR',
  'LineHaul_Manifests',
  'Logistics_Invoices_CN_DN',
  'Godown_POD_Scans',
  'Logistics_Ledgers',
];

const LOGISTICS_FOLDER_SET = new Set<string>(LOGISTICS_DRIVE_FOLDERS);

export function isLogisticsDriveFolder(folder: AnyDriveFolderName): folder is LogisticsDriveFolderName {
  return LOGISTICS_FOLDER_SET.has(folder);
}

export const PDF_VAULT_DRIVE_FOLDERS: PdfVaultFolder[] = [
  '1. LR_Copy_PDFs',
  '2. Tax_Invoice_PDFs',
  '3. Quotation_PDFs',
  '4. Declaration_PDFs',
  '5. POD_Scans_PDFs',
];

const PDF_VAULT_FOLDER_SET = new Set<string>(PDF_VAULT_DRIVE_FOLDERS);

export function isPdfVaultFolder(folder: AnyDriveFolderName): folder is PdfVaultFolder {
  return PDF_VAULT_FOLDER_SET.has(folder);
}

export const ESSENTIAL_DRIVE_MASTER_FILES = [
  'Master_Backup_DRC.json.gz',
  'Master_Backup_DRC.json',
  'DRC_Company_Parameters.json',
  'DRC_Parties_Master.json',
  'DRC_Consignments_Register.json',
  'DRC_Invoices_Register.json',
  'DRC_LorryHire_POD.json',
  'DRC_Staff_Commission_Ledger.json',
  'DRC_Bank_Receipts_TDS.json',
  'DRC_GST_RETURNS.pdf',
  'DRC_IT_RETURN_AUDIT.pdf',
  'DRC_TRADE_LICENSE_PTAX.pdf',
  'DRC_KYC_VAULT.pdf',
] as const;

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  folderName?: string;
}

async function compressCompactJsonGzip(payload: unknown): Promise<{
  bytes: Uint8Array;
  compressed: boolean;
  rawBytes: number;
  compressedBytes: number;
}> {
  const compactJson = JSON.stringify(payload);
  const rawBytesArr = new TextEncoder().encode(compactJson);
  const rawBytes = rawBytesArr.byteLength;

  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([rawBytesArr]).stream().pipeThrough(new CompressionStream('gzip'));
      const buf = await new Response(stream).arrayBuffer();
      const gzBytes = new Uint8Array(buf);
      return {
        bytes: gzBytes,
        compressed: true,
        rawBytes,
        compressedBytes: gzBytes.byteLength,
      };
    } catch {
      // Fallback to compact JSON if browser refuses gzip stream
    }
  }
  return {
    bytes: rawBytesArr,
    compressed: false,
    rawBytes,
    compressedBytes: rawBytes,
  };
}

async function decompressGzipOrJsonBuffer(buf: ArrayBuffer): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(buf);
  const isGzipMagic = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzipMagic && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text) as Record<string, unknown>;
  }
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as Record<string, unknown>;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

async function driveFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Google Drive API (${res.status}): ${errText}`);
  }
  return res;
}

async function findOrCreateFolder(
  name: string,
  accessToken: string,
  parentId?: string
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const qParts = [
    `name = '${escaped}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
  ];
  if (parentId) {
    qParts.push(`'${parentId}' in parents`);
  }
  const q = encodeURIComponent(qParts.join(' and '));
  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
    accessToken
  );
  const searchJson = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (searchJson.files && searchJson.files.length > 0) {
    return searchJson.files[0].id;
  }

  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function ensureDriveBackupHierarchy(
  accessToken: string
): Promise<{ rootId: string; folders: Record<DriveFolderName, string> }> {
  const rootId = await findOrCreateFolder(ROOT_FOLDER_NAME, accessToken);
  const folders = {} as Record<DriveFolderName, string>;
  for (const folderName of FOLDER_LIST) {
    folders[folderName] = await findOrCreateFolder(folderName, accessToken, rootId);
  }
  return { rootId, folders };
}

async function findFileInFolder(
  fileName: string,
  folderId: string,
  accessToken: string
): Promise<string | null> {
  const escaped = fileName.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name = '${escaped}' and '${folderId}' in parents and trashed = false`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    accessToken
  );
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  return json.files && json.files.length > 0 ? json.files[0].id : null;
}

export async function uploadBlobToDriveFolder(params: {
  accessToken: string;
  folderName: DriveFolderName;
  fileName: string;
  blob: Blob;
  mimeType: string;
  overwriteIfExists?: boolean;
  connectedEmail?: string | null;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { accessToken, folderName, fileName, blob, mimeType, overwriteIfExists = true, connectedEmail } = params;
  assertAuthorizedBackupAccount(connectedEmail);
  assertSafeDriveFileName(fileName);
  const { folders } = await ensureDriveBackupHierarchy(accessToken);
  const folderId = folders[folderName];

  const existingId = overwriteIfExists
    ? await findFileInFolder(fileName, folderId, accessToken)
    : null;

  const boundary = 'drc_multipart_boundary_' + Date.now();
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [folderId] };

  const arrayBuffer = await blob.arrayBuffer();
  const base64Body = uint8ArrayToBase64(new Uint8Array(arrayBuffer));

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}

export async function uploadMasterBackupToDrive(
  accessToken: string,
  backupPayload: unknown,
  connectedEmail?: string | null
): Promise<{
  id: string;
  name: string;
  webViewLink?: string;
  rawBytes: number;
  compressedBytes: number;
  compressed: boolean;
  sha256: string;
  recordCount: number;
}> {
  assertAuthorizedBackupAccount(connectedEmail);
  const { rootId } = await ensureDriveBackupHierarchy(accessToken);
  const payloadObj =
    backupPayload && typeof backupPayload === 'object'
      ? (backupPayload as Record<string, unknown>)
      : { data: backupPayload };
  const sealed = await sealBackupPayloadWithSha256(
    payloadObj,
    connectedEmail || MASTER_ADMIN_EMAIL
  );
  const pack = await compressCompactJsonGzip(sealed.sealedPayload);
  const fileName = pack.compressed ? 'Master_Backup_DRC.json.gz' : 'Master_Backup_DRC.json';
  const mimeType = pack.compressed ? 'application/gzip' : 'application/json';
  const existingId = await findFileInFolder(fileName, rootId, accessToken);

  const boundary = 'drc_master_backup_' + Date.now();
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [rootId] };

  const base64Body = uint8ArrayToBase64(pack.bytes);
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  const uploaded = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return {
    ...uploaded,
    rawBytes: pack.rawBytes,
    compressedBytes: pack.compressedBytes,
    compressed: pack.compressed,
    sha256: sealed.sha256,
    recordCount: sealed.recordCount,
  };
}

export async function listDriveBackupFiles(accessToken: string): Promise<DriveFileSummary[]> {
  const { rootId, folders } = await ensureDriveBackupHierarchy(accessToken);
  const allFiles: DriveFileSummary[] = [];

  const folderEntries: Array<[string, string]> = [
    ['Master Root', rootId],
    ...Object.entries(folders),
  ];

  for (const [label, folderId] of folderEntries) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=25`,
      accessToken
    );
    const json = (await res.json()) as { files?: DriveFileSummary[] };
    for (const f of json.files || []) {
      allFiles.push({ ...f, folderName: label });
    }
  }

  return allFiles;
}

export async function downloadMasterBackupFromDrive(
  accessToken: string,
  connectedEmail?: string | null
): Promise<Record<string, unknown> | null> {
  assertAuthorizedBackupAccount(connectedEmail);
  const { rootId } = await ensureDriveBackupHierarchy(accessToken);
  const gzId = await findFileInFolder('Master_Backup_DRC.json.gz', rootId, accessToken);
  const legacyId = gzId || (await findFileInFolder('Master_Backup_DRC.json', rootId, accessToken));
  if (!legacyId) return null;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${legacyId}?alt=media`,
    accessToken
  );
  const buf = await res.arrayBuffer();
  const parsed = await decompressGzipOrJsonBuffer(buf);
  const check = await verifyBackupPayloadSha256(parsed);
  if (check.hasSeal && !check.valid) {
    throw new Error(check.reason || 'Master Drive backup SHA-256 checksum verification failed.');
  }
  return parsed;
}

export async function uploadBankStatementMirrorToDrive(params: {
  accessToken: string;
  financialYear: string;
  fileName: string;
  fileContent: Blob;
  mimeType: string;
  connectedEmail?: string | null;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  assertAuthorizedBackupAccount(params.connectedEmail);
  assertSafeDriveFileName(params.fileName);
  const { folders } = await ensureDriveBackupHierarchy(params.accessToken);
  const bankRootId = folders.Bank_Statements;
  const cleanFyFolder = `Bank_Statements_${params.financialYear.replace(/[^a-zA-Z0-9]+/g, '_')}`;
  const fyFolderId = await findOrCreateFolder(cleanFyFolder, params.accessToken, bankRootId);

  const existingId = await findFileInFolder(params.fileName, fyFolderId, params.accessToken);
  const boundary = 'drc_bank_stmt_' + Date.now();
  const metadata = existingId
    ? { name: params.fileName, mimeType: params.mimeType }
    : { name: params.fileName, mimeType: params.mimeType, parents: [fyFolderId] };

  const arrayBuffer = await params.fileContent.arrayBuffer();
  const base64Body = uint8ArrayToBase64(new Uint8Array(arrayBuffer));

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${params.mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, params.accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}

export async function runDailyDrive8FileCleanup(accessToken: string): Promise<{
  keptCount: number;
  trashedCount: number;
}> {
  const { rootId, folders } = await ensureDriveBackupHierarchy(accessToken);
  const q = encodeURIComponent(
    `'${rootId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`,
    accessToken
  );
  const json = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  const files = json.files || [];

  const essentialSet = new Set<string>(ESSENTIAL_DRIVE_MASTER_FILES);
  const seenEssentials = new Set<string>();
  const seenSnapshots = new Set<string>();
  const toKeep: Array<{ id: string; name: string }> = [];
  const toTrash: Array<{ id: string; name: string }> = [];

  for (const f of files) {
    const isDailySnapshot = /^DRC_VAULT_SNAPSHOT_\d{4}-\d{2}-\d{2}\.json$/i.test(f.name);
    if (isDailySnapshot && !seenSnapshots.has(f.name) && seenSnapshots.size < 30) {
      seenSnapshots.add(f.name);
      toKeep.push(f);
    } else if (essentialSet.has(f.name) && !seenEssentials.has(f.name)) {
      seenEssentials.add(f.name);
      toKeep.push(f);
    } else if (/tmp|temp|scratch|copy|duplicate|scrap/i.test(f.name) || toKeep.length >= 38) {
      toTrash.push(f);
    } else {
      toKeep.push(f);
    }
  }

  // Also scan all 7 subfolders for temp/scratch/copy/scrap junk so 15GB lasts 50+ years
  for (const folderId of Object.values(folders)) {
    try {
      const subQ = encodeURIComponent(
        `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
      );
      const subRes = await driveFetch(
        `https://www.googleapis.com/drive/v3/files?q=${subQ}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`,
        accessToken
      );
      const subJson = (await subRes.json()) as { files?: Array<{ id: string; name: string }> };
      const seenSubNames = new Set<string>();
      for (const sf of subJson.files || []) {
        if (/tmp|temp|scratch|copy|duplicate|scrap/i.test(sf.name) || seenSubNames.has(sf.name)) {
          toTrash.push(sf);
        } else {
          seenSubNames.add(sf.name);
          toKeep.push(sf);
        }
      }
    } catch {
      // Ignore individual subfolder scan errors
    }
  }

  for (const stale of toTrash) {
    try {
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${stale.id}`, accessToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    } catch {
      // Ignore individual cleanup failures
    }
  }

  return { keptCount: toKeep.length, trashedCount: toTrash.length };
}

// ============================================================================
// ISOLATED LOGISTICS DIVISION GOOGLE DRIVE BACKUP (DOLPHIN_LOGISTICS_DIVISION_BACKUP)
// ============================================================================

export async function ensureLogisticsDriveHierarchy(
  accessToken: string
): Promise<{ rootId: string; folders: Record<LogisticsDriveFolderName, string> }> {
  const rootId = await findOrCreateFolder(LOGISTICS_ROOT_FOLDER_NAME, accessToken);
  const folders = {} as Record<LogisticsDriveFolderName, string>;
  for (const folderName of LOGISTICS_DRIVE_FOLDERS) {
    folders[folderName] = await findOrCreateFolder(folderName, accessToken, rootId);
  }
  return { rootId, folders };
}

export async function uploadLogisticsBlobToDriveFolder(params: {
  accessToken: string;
  folderName: LogisticsDriveFolderName;
  fileName: string;
  blob: Blob;
  mimeType: string;
  overwriteIfExists?: boolean;
  connectedEmail?: string | null;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { accessToken, folderName, fileName, blob, mimeType, overwriteIfExists = true, connectedEmail } = params;
  assertAuthorizedBackupAccount(connectedEmail);
  assertSafeDriveFileName(fileName);
  const { folders } = await ensureLogisticsDriveHierarchy(accessToken);
  const folderId = folders[folderName];

  const existingId = overwriteIfExists
    ? await findFileInFolder(fileName, folderId, accessToken)
    : null;

  const boundary = 'drc_logi_multipart_' + Date.now();
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [folderId] };

  const arrayBuffer = await blob.arrayBuffer();
  const base64Body = uint8ArrayToBase64(new Uint8Array(arrayBuffer));

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}

export async function uploadLogisticsMasterBackupToDrive(
  accessToken: string,
  backupPayload: unknown,
  connectedEmail?: string | null
): Promise<{
  id: string;
  name: string;
  webViewLink?: string;
  rawBytes: number;
  compressedBytes: number;
  compressed: boolean;
  sha256: string;
}> {
  assertAuthorizedBackupAccount(connectedEmail);
  const { rootId } = await ensureLogisticsDriveHierarchy(accessToken);
  const payloadObj =
    backupPayload && typeof backupPayload === 'object'
      ? (backupPayload as Record<string, unknown>)
      : { data: backupPayload };
  const sealed = await sealBackupPayloadWithSha256(
    payloadObj,
    connectedEmail || MASTER_ADMIN_EMAIL
  );
  const pack = await compressCompactJsonGzip(sealed.sealedPayload);
  const fileName = pack.compressed ? 'Master_Backup_Logistics.json.gz' : 'Master_Backup_Logistics.json';
  const mimeType = pack.compressed ? 'application/gzip' : 'application/json';
  const existingId = await findFileInFolder(fileName, rootId, accessToken);

  const boundary = 'drc_logi_backup_' + Date.now();
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [rootId] };

  const base64Body = uint8ArrayToBase64(pack.bytes);
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });

  const uploaded = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return {
    ...uploaded,
    rawBytes: pack.rawBytes,
    compressedBytes: pack.compressedBytes,
    compressed: pack.compressed,
    sha256: sealed.sha256,
  };
}

export async function downloadLogisticsMasterBackupFromDrive(
  accessToken: string,
  connectedEmail?: string | null
): Promise<Record<string, unknown> | null> {
  assertAuthorizedBackupAccount(connectedEmail);
  const { rootId } = await ensureLogisticsDriveHierarchy(accessToken);
  const gzId = await findFileInFolder('Master_Backup_Logistics.json.gz', rootId, accessToken);
  const legacyId = gzId || (await findFileInFolder('Master_Backup_Logistics.json', rootId, accessToken));
  if (!legacyId) return null;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${legacyId}?alt=media`,
    accessToken
  );
  const buf = await res.arrayBuffer();
  const parsed = await decompressGzipOrJsonBuffer(buf);
  const check = await verifyBackupPayloadSha256(parsed);
  if (check.hasSeal && !check.valid) {
    throw new Error(check.reason || 'Logistics Drive backup SHA-256 verification failed.');
  }
  return parsed;
}

export async function listLogisticsDriveBackupFiles(accessToken: string): Promise<DriveFileSummary[]> {
  const { rootId, folders } = await ensureLogisticsDriveHierarchy(accessToken);
  const allFiles: DriveFileSummary[] = [];

  const folderEntries: Array<[string, string]> = [
    ['Logistics Backup Root', rootId],
    ...Object.entries(folders),
  ];

  for (const [label, folderId] of folderEntries) {
    const q = encodeURIComponent(
      `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
    );
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=25`,
      accessToken
    );
    const json = (await res.json()) as { files?: DriveFileSummary[] };
    for (const f of json.files || []) {
      allFiles.push({ ...f, folderName: label });
    }
  }

  return allFiles;
}

// ============================================================================
// ISOLATED APP-ONLY SANDBOX GOOGLE DRIVE BACKUP (5 CLEARLY NAMED JSON FILES)
// + INACTIVE DRC_APP_INSTALLER_VAULT FOLDER
// Uses strictly app-only `drive.file` OAuth scope (zero access to device photos/personal files)
// ============================================================================

export const INSTALLER_VAULT_FOLDER = 'DRC_APP_INSTALLER_VAULT';

export function formatDriveYearCode(fy: string): string {
  const clean = String(fy || 'FY 2026-27')
    .trim()
    .replace(/^FY\s*/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  return clean || '2026-27';
}

export interface IsolatedDriveFileNames {
  yearCode: string;
  ftl: string;
  logistics: string;
  ptl: string;
  courier: string;
  mastersVault: string;
  all: string[];
}

export function getIsolatedDriveFileNames(fy: string): IsolatedDriveFileNames {
  const yearCode = formatDriveYearCode(fy);
  const ftl = `DRC_FTL_BUSINESS_${yearCode}.json`;
  const logistics = `DRC_LOGISTICS_BUSINESS_${yearCode}.json`;
  const ptl = `DRC_PTL_BUSINESS_${yearCode}.json`;
  const courier = `DRC_COURIER_PARCEL_${yearCode}.json`;
  const mastersVault = 'DRC_MASTERS_AND_KYC_VAULT.json';
  return {
    yearCode,
    ftl,
    logistics,
    ptl,
    courier,
    mastersVault,
    all: [ftl, logistics, ptl, courier, mastersVault],
  };
}

export async function ensureInstallerVaultFolder(accessToken: string): Promise<string> {
  const rootId = await findOrCreateFolder(ROOT_FOLDER_NAME, accessToken);
  return findOrCreateFolder(INSTALLER_VAULT_FOLDER, accessToken, rootId);
}

async function uploadPlainJsonFileToFolder(
  accessToken: string,
  folderId: string,
  fileName: string,
  payload: unknown
): Promise<{ id: string; name: string; webViewLink?: string }> {
  assertSafeDriveFileName(fileName);
  const mimeType = 'application/json';
  const jsonText = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(jsonText);
  const existingId = await findFileInFolder(fileName, folderId, accessToken);
  const boundary = 'drc_iso_json_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [folderId] };

  const base64Body = uint8ArrayToBase64(bytes);
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}

export async function uploadIsolatedBusinessBackupsToDrive(params: {
  accessToken: string;
  activeFy: string;
  ftlPayload: Record<string, unknown>;
  logisticsPayload: Record<string, unknown>;
  ptlPayload: Record<string, unknown>;
  courierPayload: Record<string, unknown>;
  mastersVaultPayload: Record<string, unknown>;
  connectedEmail?: string | null;
}): Promise<{
  names: IsolatedDriveFileNames;
  uploadedFiles: Array<{ id: string; name: string; sha256: string }>;
  installerVaultFolderId: string;
}> {
  assertAuthorizedBackupAccount(params.connectedEmail);
  const { rootId } = await ensureDriveBackupHierarchy(params.accessToken);
  const installerVaultFolderId = await findOrCreateFolder(
    INSTALLER_VAULT_FOLDER,
    params.accessToken,
    rootId
  );
  const names = getIsolatedDriveFileNames(params.activeFy);

  const pairs: Array<[string, Record<string, unknown>]> = [
    [names.ftl, params.ftlPayload],
    [names.logistics, params.logisticsPayload],
    [names.ptl, params.ptlPayload],
    [names.courier, params.courierPayload],
    [names.mastersVault, params.mastersVaultPayload],
  ];

  const uploadedFiles: Array<{ id: string; name: string; sha256: string }> = [];
  for (const [fileName, payload] of pairs) {
    const sealed = await sealBackupPayloadWithSha256(
      {
        ...payload,
        backupSchema: 'DRC_ISOLATED_V1',
        sandboxScope: 'drive.file',
        exportedAt: new Date().toISOString(),
      },
      params.connectedEmail || MASTER_ADMIN_EMAIL
    );
    const res = await uploadPlainJsonFileToFolder(
      params.accessToken,
      rootId,
      fileName,
      sealed.sealedPayload
    );
    uploadedFiles.push({ id: res.id, name: res.name, sha256: sealed.sha256 });
  }

  return { names, uploadedFiles, installerVaultFolderId };
}

export async function downloadIsolatedBusinessFileFromDrive(
  accessToken: string,
  fileName: string,
  connectedEmail?: string | null
): Promise<Record<string, unknown> | null> {
  assertAuthorizedBackupAccount(connectedEmail);
  assertSafeDriveFileName(fileName);
  const { rootId } = await ensureDriveBackupHierarchy(accessToken);
  const fileId = await findFileInFolder(fileName, rootId, accessToken);
  if (!fileId) return null;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    accessToken
  );
  const buf = await res.arrayBuffer();
  const parsed = await decompressGzipOrJsonBuffer(buf);
  const check = await verifyBackupPayloadSha256(parsed);
  if (check.hasSeal && !check.valid) {
    throw new Error(check.reason || `Integrity verification failed for ${fileName}.`);
  }
  return parsed;
}

export async function uploadNamedPdfToDrive(params: {
  accessToken: string;
  folderName: 'Reports_Ledgers' | 'Declarations';
  fileName: string;
  blob: Blob;
  connectedEmail?: string | null;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  return uploadBlobToDriveFolder({
    accessToken: params.accessToken,
    folderName: params.folderName,
    fileName: params.fileName,
    blob: params.blob,
    mimeType: params.blob.type || 'application/pdf',
    overwriteIfExists: true,
    connectedEmail: params.connectedEmail,
  });
}

// ============================================================================
// GOOGLE DRIVE HIDDEN SANDBOX (appDataFolder) & APP BLUEPRINT PDF UPLOAD
// ============================================================================

async function findFileInAppDataFolder(
  fileName: string,
  accessToken: string
): Promise<string | null> {
  const escaped = fileName.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${escaped}' and trashed = false`);
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`,
    accessToken
  );
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  return json.files && json.files.length > 0 ? json.files[0].id : null;
}

export async function uploadBlobToAppDataFolder(params: {
  accessToken: string;
  fileName: string;
  blob: Blob;
  mimeType: string;
}): Promise<{ id: string; name: string }> {
  const { accessToken, fileName, blob, mimeType } = params;
  assertSafeDriveFileName(fileName);
  const existingId = await findFileInAppDataFolder(fileName, accessToken);
  const boundary = 'drc_appdata_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: ['appDataFolder'] };

  const arrayBuffer = await blob.arrayBuffer();
  const base64Body = uint8ArrayToBase64(new Uint8Array(arrayBuffer));

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  return (await res.json()) as { id: string; name: string };
}

export async function listAppDataBackupFiles(accessToken: string): Promise<DriveFileSummary[]> {
  try {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=30`,
      accessToken
    );
    const json = (await res.json()) as { files?: DriveFileSummary[] };
    return (json.files || []).map((f) => ({
      ...f,
      folderName: 'appDataFolder (Hidden Sandbox)',
    }));
  } catch {
    return [];
  }
}

export async function uploadAppDataJsonSnapshot(params: {
  accessToken: string;
  fileName: string;
  payload: unknown;
  connectedEmail?: string | null;
}): Promise<{ id: string; name: string }> {
  assertAuthorizedBackupAccount(params.connectedEmail);
  assertSafeDriveFileName(params.fileName);
  const jsonText = JSON.stringify(params.payload);
  const blob = new Blob([jsonText], { type: 'application/json' });
  return uploadBlobToAppDataFolder({
    accessToken: params.accessToken,
    fileName: params.fileName,
    blob,
    mimeType: 'application/json',
  });
}

export async function uploadBlueprintPdfToDrive(
  accessToken: string,
  blob: Blob
): Promise<{
  visibleFile: { id: string; name: string; webViewLink?: string };
  appDataFileId?: string;
}> {
  const fileName = 'DRC_APP_FORMAT_BLUEPRINT.pdf';
  const visibleFile = await uploadNamedPdfToDrive({
    accessToken,
    folderName: 'Reports_Ledgers',
    fileName,
    blob,
  });
  let appDataFileId: string | undefined;
  try {
    const hiddenRes = await uploadBlobToAppDataFolder({
      accessToken,
      fileName,
      blob,
      mimeType: 'application/pdf',
    });
    appDataFileId = hiddenRes.id;
  } catch {
    // Non-fatal if user granted drive.file prior to re-consenting drive.appdata
  }
  return { visibleFile, appDataFileId };
}

// ============================================================================
// PART B: DAILY VAULT SNAPSHOT (DRC_VAULT_SNAPSHOT_YYYY-MM-DD.json) + 3-SEC SYNC
// ============================================================================

let sessionRemoteDriveBundle: Record<string, unknown> | null = null;
let sessionRemoteDriveFetched = false;

export function resetDriveSyncSessionCache(): void {
  sessionRemoteDriveBundle = null;
  sessionRemoteDriveFetched = false;
}

export async function uploadDailyVaultSnapshotToDrive(params: {
  accessToken: string;
  payload: Record<string, unknown>;
  connectedEmail?: string | null;
  dateStr?: string;
}): Promise<{
  id: string;
  name: string;
  webViewLink?: string;
  sha256: string;
  recordCount: number;
  bytes: number;
}> {
  assertAuthorizedBackupAccount(params.connectedEmail);
  const fileName = getDailySnapshotFileName(params.dateStr);
  assertSafeDriveFileName(fileName);
  const { rootId } = await ensureDriveBackupHierarchy(params.accessToken);
  const sealed = await sealBackupPayloadWithSha256(
    {
      ...params.payload,
      snapshotType: 'DAILY_VAULT_SNAPSHOT',
      snapshotFile: fileName,
      exportedAt: new Date().toISOString(),
    },
    params.connectedEmail || MASTER_ADMIN_EMAIL
  );
  const uploaded = await uploadPlainJsonFileToFolder(
    params.accessToken,
    rootId,
    fileName,
    sealed.sealedPayload
  );
  const approxBytes = new TextEncoder().encode(JSON.stringify(sealed.sealedPayload)).byteLength;

  try {
    await uploadAppDataJsonSnapshot({
      accessToken: params.accessToken,
      fileName: 'DRC_VAULT_LATEST_SEAL.json',
      payload: {
        snapshotFile: fileName,
        integrity: sealed.integrity,
        authorizedEmail: MASTER_ADMIN_EMAIL,
      },
      connectedEmail: params.connectedEmail,
    });
  } catch {
    // Hidden appData mirror is optional if consent predates appdata scope
  }

  return {
    id: uploaded.id,
    name: uploaded.name || fileName,
    webViewLink: uploaded.webViewLink,
    sha256: sealed.sha256,
    recordCount: sealed.recordCount,
    bytes: approxBytes,
  };
}

export async function downloadDailyVaultSnapshotFromDrive(params: {
  accessToken: string;
  fileName?: string;
  connectedEmail?: string | null;
}): Promise<{ fileName: string; payload: Record<string, unknown> } | null> {
  assertAuthorizedBackupAccount(params.connectedEmail);
  const { rootId } = await ensureDriveBackupHierarchy(params.accessToken);
  let targetFileName = params.fileName || getDailySnapshotFileName();
  assertSafeDriveFileName(targetFileName);

  let fileId = await findFileInFolder(targetFileName, rootId, params.accessToken);
  if (!fileId && !params.fileName) {
    // Fallback to latest available DRC_VAULT_SNAPSHOT_*.json file in root folder
    const q = encodeURIComponent(
      `'${rootId}' in parents and name contains 'DRC_VAULT_SNAPSHOT_' and trashed = false`
    );
    const searchRes = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`,
      params.accessToken
    );
    const searchJson = (await searchRes.json()) as {
      files?: Array<{ id: string; name: string }>;
    };
    const match = (searchJson.files || []).find((f) =>
      /^DRC_VAULT_SNAPSHOT_\d{4}-\d{2}-\d{2}\.json$/i.test(f.name)
    );
    if (match) {
      fileId = match.id;
      targetFileName = match.name;
    }
  }
  if (!fileId) return null;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    params.accessToken
  );
  const buf = await res.arrayBuffer();
  const parsed = await decompressGzipOrJsonBuffer(buf);
  const check = await verifyBackupPayloadSha256(parsed);
  if (check.hasSeal && !check.valid) {
    throw new Error(check.reason || `SHA-256 verification failed for ${targetFileName}.`);
  }
  return { fileName: targetFileName, payload: parsed };
}

export async function syncAutoBackupBundleToDrive(params: {
  accessToken: string;
  connectedEmail?: string | null;
  localBundle: Record<string, unknown>;
  includeDailySnapshot?: boolean;
  forceRemotePull?: boolean;
}): Promise<{
  masterFileName: string;
  snapshotFileName?: string;
  sha256: string;
  recordCount: number;
  compressedBytes: number;
  mergedWithRemote: boolean;
  syncedAt: string;
}> {
  assertAuthorizedBackupAccount(params.connectedEmail);

  let mergedWithRemote = false;
  if (!sessionRemoteDriveFetched || params.forceRemotePull) {
    try {
      const existingRemote = await downloadMasterBackupFromDrive(
        params.accessToken,
        params.connectedEmail
      );
      sessionRemoteDriveBundle = existingRemote;
      sessionRemoteDriveFetched = true;
      if (existingRemote) mergedWithRemote = true;
    } catch {
      sessionRemoteDriveFetched = true;
    }
  } else if (sessionRemoteDriveBundle) {
    mergedWithRemote = true;
  }

  const unionMerged = unionMergeBackupBundles(params.localBundle, sessionRemoteDriveBundle);
  const masterUpload = await uploadMasterBackupToDrive(
    params.accessToken,
    unionMerged,
    params.connectedEmail
  );
  sessionRemoteDriveBundle = unionMerged;

  let snapshotFileName: string | undefined;
  if (params.includeDailySnapshot !== false) {
    const snap = await uploadDailyVaultSnapshotToDrive({
      accessToken: params.accessToken,
      payload: unionMerged,
      connectedEmail: params.connectedEmail,
    });
    snapshotFileName = snap.name;
  }

  return {
    masterFileName: masterUpload.name,
    snapshotFileName,
    sha256: masterUpload.sha256,
    recordCount: masterUpload.recordCount,
    compressedBytes: masterUpload.compressedBytes,
    mergedWithRemote,
    syncedAt: new Date().toISOString(),
  };
}

export async function uploadPdfToDivisionVaultFolder(params: {
  accessToken: string;
  division: BusinessMode;
  folderName: PdfVaultFolder;
  fileName: string;
  blob: Blob;
  overwriteIfExists?: boolean;
  connectedEmail?: string | null;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const {
    accessToken,
    division,
    folderName,
    fileName,
    blob,
    overwriteIfExists = true,
    connectedEmail,
  } = params;
  assertAuthorizedBackupAccount(connectedEmail);
  assertSafeDriveFileName(fileName);

  const rootId = await findOrCreateFolder(ROOT_FOLDER_NAME, accessToken);
  const divisionFolderId = await findOrCreateFolder(`${division}_PDF_VAULT`, accessToken, rootId);
  const targetFolderId = await findOrCreateFolder(folderName, accessToken, divisionFolderId);

  const existingId = overwriteIfExists
    ? await findFileInFolder(fileName, targetFolderId, accessToken)
    : null;

  const boundary = 'drc_vault_pdf_' + Date.now();
  const mimeType = 'application/pdf';
  const metadata = existingId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [targetFolderId] };

  const arrayBuffer = await blob.arrayBuffer();
  const base64Body = uint8ArrayToBase64(new Uint8Array(arrayBuffer));

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Body}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`;

  const res = await driveFetch(url, accessToken, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });

  return (await res.json()) as { id: string; name: string; webViewLink?: string };
}
