import { KycDocType, KycVaultItem } from '../types/erp';

const DB_NAME = 'drc_kyc_vault_db';
const STORE_NAME = 'kyc_files';
const DB_VERSION = 1;

export interface StoredKycFile {
  key: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  sizeKB: number;
  updatedAt: string;
}

export interface MonthlyGstAlarm {
  id: string;
  returnType: 'GSTR-1' | 'GSTR-3B';
  dueDay: number;
  daysLeft: number;
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  message: string;
}

export interface KycExpiryAlarm {
  id: string;
  docType: string;
  label: string;
  docNumber?: string;
  expiryDate: string;
  daysRemaining: number;
  tier: 'expired' | '2-day' | '5-day' | '10-day';
  title: string;
  message: string;
}

export const STATUTORY_DOC_PRESETS: Array<{
  docType: KycDocType;
  label: string;
  portalLabel: string;
  portalUrl: string;
}> = [
  {
    docType: 'WB_TRADE_LICENSE',
    label: 'WB Trade License (Municipality / KMC / Silpasathi)',
    portalLabel: 'WB e-District / Silpasathi Portal',
    portalUrl: 'https://silpasathi.wb.gov.in/',
  },
  {
    docType: 'WB_PTAX',
    label: 'WB Professional Tax (P-Tax Enrolment / RC)',
    portalLabel: 'WB Commercial Tax P-Tax Portal',
    portalUrl: 'https://wbcomtax.gov.in/',
  },
  {
    docType: 'UDYAM_MSME',
    label: 'Udyam Registration Certificate (MSME)',
    portalLabel: 'Official Udyam Download Portal',
    portalUrl: 'https://udyamregistration.gov.in/Udyam_Verify.aspx',
  },
  {
    docType: 'GST_CERTIFICATE',
    label: 'GST Registration Certificate (REG-06)',
    portalLabel: 'GST Common Portal',
    portalUrl: 'https://www.gst.gov.in/',
  },
  {
    docType: 'PAN_CARD',
    label: 'Proprietor / Firm PAN Card',
    portalLabel: 'Income Tax e-Filing Portal',
    portalUrl: 'https://www.incometax.gov.in/',
  },
  {
    docType: 'AADHAAR_CARD',
    label: 'Proprietor / Authorised Aadhaar Card',
    portalLabel: 'UIDAI MyAadhaar Portal',
    portalUrl: 'https://myaadhaar.uidai.gov.in/',
  },
  {
    docType: 'VEHICLE_PAPERS',
    label: 'Owned Vehicle RC / Fitness / Insurance / Permit Pack',
    portalLabel: 'Parivahan Vahan Sewa',
    portalUrl: 'https://parivahan.gov.in/',
  },
];

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open KYC Vault IndexedDB'));
  });
}

export async function saveKycPdfLocal(file: StoredKycFile): Promise<void> {
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(file);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    try {
      localStorage.setItem(`drc_kyc_fallback_${file.key}`, JSON.stringify(file));
    } catch {
      // Ignore quota exceeded fallback
    }
  }
}

export async function getKycPdfLocal(key: string): Promise<StoredKycFile | null> {
  if (!key) return null;
  try {
    const db = await openVaultDb();
    const record = await new Promise<StoredKycFile | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as StoredKycFile) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (record) return record;
  } catch {
    // Try localStorage fallback
  }
  try {
    const raw = localStorage.getItem(`drc_kyc_fallback_${key}`);
    return raw ? (JSON.parse(raw) as StoredKycFile) : null;
  } catch {
    return null;
  }
}

export async function deleteKycPdfLocal(key: string): Promise<void> {
  if (!key) return;
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore IDB error
  }
  try {
    localStorage.removeItem(`drc_kyc_fallback_${key}`);
  } catch {
    // Ignore storage error
  }
}

/**
 * Compresses an uploaded image scan cleanly for low-KB offline + Drive storage,
 * or keeps PDF data URL compactly when already a PDF.
 */
export async function compressComplianceFileToDataUrl(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  sizeKB: number;
}> {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read PDF file'));
      reader.readAsDataURL(file);
    });
    return {
      dataUrl,
      mimeType: file.type || 'application/pdf',
      sizeKB: Math.max(1, Math.round(file.size / 1024)),
    };
  }

  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = rawUrl;
    });
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
    const w = Math.max(1, Math.round((img.width || maxDim) * scale));
    const h = Math.max(1, Math.round((img.height || maxDim) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.68);
      const approxKB = Math.max(1, Math.round((compressed.length * 3) / 4 / 1024));
      return {
        dataUrl: compressed,
        mimeType: 'image/jpeg',
        sizeKB: approxKB,
      };
    }
  } catch {
    // Fallback to raw image data URL
  }
  return {
    dataUrl: rawUrl,
    mimeType: file.type || 'image/jpeg',
    sizeKB: Math.max(1, Math.round(file.size / 1024)),
  };
}

/**
 * Evaluates monthly statutory GST alarms:
 * - GSTR-1 (due 11th): Beep & popup alarms starting 7th & 8th through 11th
 * - GSTR-3B (due 20th): Beep & popup alarms starting 15th through 20th
 */
export function evaluateMonthlyGstAlarms(today: Date = new Date()): MonthlyGstAlarm[] {
  const day = today.getDate();
  const monthLabel = today.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const alarms: MonthlyGstAlarm[] = [];

  if (day >= 7 && day <= 11) {
    const daysLeft = 11 - day;
    alarms.push({
      id: `gstr1-${today.getFullYear()}-${today.getMonth() + 1}-${day}`,
      returnType: 'GSTR-1',
      dueDay: 11,
      daysLeft,
      severity: day >= 10 ? 'urgent' : day >= 8 ? 'warning' : 'info',
      title: `GSTR-1 Filing Reminder (${monthLabel})`,
      message:
        daysLeft === 0
          ? 'DUE TODAY (11th): File Monthly GSTR-1 B2B/B2C Tax Invoices & Credit Notes!'
          : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (11th of month). Export GSTR-1 JSON/Excel & DRC_GST_RETURNS.pdf now.`,
    });
  }

  if (day >= 15 && day <= 20) {
    const daysLeft = 20 - day;
    alarms.push({
      id: `gstr3b-${today.getFullYear()}-${today.getMonth() + 1}-${day}`,
      returnType: 'GSTR-3B',
      dueDay: 20,
      daysLeft,
      severity: day >= 19 ? 'urgent' : day >= 17 ? 'warning' : 'info',
      title: `GSTR-3B & Challan Reminder (${monthLabel})`,
      message:
        daysLeft === 0
          ? 'DUE TODAY (20th): File Monthly GSTR-3B & Pay Net GST Liability after Purchase ITC!'
          : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (20th of month). Review GSTR-3B RCM/FCM & Purchase ITC in GST Hub.`,
    });
  }

  return alarms;
}

/**
 * Evaluates Master KYC / Trade License / P-Tax / Vehicle Paper expiry alarms:
 * Triggers alerts at <= 10 days, <= 5 days, <= 2 days, or already expired.
 */
export function evaluateKycExpiryAlarms(
  kycVault: KycVaultItem[] | undefined,
  today: Date = new Date()
): KycExpiryAlarm[] {
  if (!Array.isArray(kycVault) || kycVault.length === 0) return [];

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const alarms: KycExpiryAlarm[] = [];

  for (const item of kycVault) {
    const expStr = String(item.expiryDate || '').trim();
    if (!expStr) continue;
    const parsed = new Date(expStr);
    if (!Number.isFinite(parsed.getTime())) continue;
    const expMidnight = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
    const daysRemaining = Math.round((expMidnight - todayMidnight) / msPerDay);

    if (daysRemaining <= 10) {
      const tier: KycExpiryAlarm['tier'] =
        daysRemaining < 0
          ? 'expired'
          : daysRemaining <= 2
          ? '2-day'
          : daysRemaining <= 5
          ? '5-day'
          : '10-day';
      alarms.push({
        id: item.id,
        docType: item.docType,
        label: item.label,
        docNumber: item.docNumber,
        expiryDate: expStr,
        daysRemaining,
        tier,
        title:
          daysRemaining < 0
            ? `EXPIRED: ${item.label}`
            : `Renew Soon (${daysRemaining}d left): ${item.label}`,
        message:
          daysRemaining < 0
            ? `${item.label}${item.docNumber ? ` (${item.docNumber})` : ''} expired ${Math.abs(daysRemaining)} day(s) ago on ${expStr}.`
            : daysRemaining === 0
            ? `${item.label}${item.docNumber ? ` (${item.docNumber})` : ''} expires TODAY (${expStr}).`
            : `${item.label}${item.docNumber ? ` (${item.docNumber})` : ''} expires in ${daysRemaining} day(s) on ${expStr}.`,
      });
    }
  }

  return alarms.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
