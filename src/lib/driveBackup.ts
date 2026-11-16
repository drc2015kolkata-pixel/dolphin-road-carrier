import { DriveFolderName } from '../types/erp';

const ROOT_FOLDER_NAME = 'Dolphin_Road_Carrier_Backup';
const FOLDER_LIST: DriveFolderName[] = [
  'LR Copy',
  'Bills_Invoices',
  'Quotations',
  'POD_Scans',
  'Declarations',
  'Reports_Ledgers',
];

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  folderName?: string;
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
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { accessToken, folderName, fileName, blob, mimeType, overwriteIfExists = true } = params;
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
  const base64Body = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );

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
  backupPayload: unknown
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { rootId } = await ensureDriveBackupHierarchy(accessToken);
  const fileName = 'Master_Backup_DRC.json';
  const existingId = await findFileInFolder(fileName, rootId, accessToken);

  const boundary = 'drc_master_backup_' + Date.now();
  const metadata = existingId
    ? { name: fileName, mimeType: 'application/json' }
    : { name: fileName, mimeType: 'application/json', parents: [rootId] };

  const jsonContent = JSON.stringify(backupPayload, null, 2);
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${jsonContent}\r\n` +
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

export async function downloadMasterBackupFromDrive(accessToken: string): Promise<Record<string, unknown> | null> {
  const { rootId } = await ensureDriveBackupHierarchy(accessToken);
  const fileId = await findFileInFolder('Master_Backup_DRC.json', rootId, accessToken);
  if (!fileId) return null;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    accessToken
  );
  return (await res.json()) as Record<string, unknown>;
}
