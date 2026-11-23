export const GST_SEARCH_PORTAL_URL = 'https://services.gst.gov.in/services/searchtp';

const GST_CHECK_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export interface GstinValidationResult {
  valid: boolean;
  isEmpty: boolean;
  normalized: string;
  stateCode?: string;
  stateName?: string;
  panPart?: string;
  expectedCheckChar?: string;
  actualCheckChar?: string;
  error?: string;
  portalUrl: string;
}

/**
 * Computes official Indian GSTIN 15th-character mod-36 Luhn-weighted check digit.
 */
export function computeGstinCheckDigit(first14: string): string | null {
  const clean = first14.toUpperCase();
  if (clean.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const codePoint = GST_CHECK_CHARSET.indexOf(clean[i]);
    if (codePoint < 0) return null;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = codePoint * factor;
    const hash = Math.floor(product / 36) + (product % 36);
    sum += hash;
  }
  const checkCodePoint = (36 - (sum % 36)) % 36;
  return GST_CHECK_CHARSET[checkCodePoint] || null;
}

/**
 * Validates Indian 15-character GSTIN format, valid State Code, PAN structure, and mod-36 Checksum.
 */
export function validateIndianGstin(raw: string | undefined | null): GstinValidationResult {
  const normalized = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');

  if (!normalized) {
    return {
      valid: true,
      isEmpty: true,
      normalized: '',
      portalUrl: GST_SEARCH_PORTAL_URL,
    };
  }

  if (normalized.length !== 15) {
    return {
      valid: false,
      isEmpty: false,
      normalized,
      error: `GSTIN must be 15 characters (currently ${normalized.length}).`,
      portalUrl: GST_SEARCH_PORTAL_URL,
    };
  }

  const gstFormatRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  if (!gstFormatRegex.test(normalized)) {
    return {
      valid: false,
      isEmpty: false,
      normalized,
      error:
        'Invalid GSTIN format. Expected 2-digit State + 10-char PAN + Entity + Z + Checksum (e.g. 19DOTPS3540M1ZZ).',
      portalUrl: GST_SEARCH_PORTAL_URL,
    };
  }

  const stateCode = normalized.slice(0, 2);
  const stateName = GST_STATE_NAMES[stateCode];
  if (!stateName) {
    return {
      valid: false,
      isEmpty: false,
      normalized,
      stateCode,
      error: `Unknown Indian GST State Code "${stateCode}".`,
      portalUrl: GST_SEARCH_PORTAL_URL,
    };
  }

  const expectedCheckChar = computeGstinCheckDigit(normalized.slice(0, 14));
  const actualCheckChar = normalized[14];
  if (!expectedCheckChar || expectedCheckChar !== actualCheckChar) {
    return {
      valid: false,
      isEmpty: false,
      normalized,
      stateCode,
      stateName,
      panPart: normalized.slice(2, 12),
      expectedCheckChar: expectedCheckChar || undefined,
      actualCheckChar,
      error: `Invalid GSTIN mathematical checksum! Expected check character "${expectedCheckChar || '?'}", got "${actualCheckChar}".`,
      portalUrl: GST_SEARCH_PORTAL_URL,
    };
  }

  return {
    valid: true,
    isEmpty: false,
    normalized,
    stateCode,
    stateName,
    panPart: normalized.slice(2, 12),
    expectedCheckChar,
    actualCheckChar,
    portalUrl: GST_SEARCH_PORTAL_URL,
  };
}

export type SafeUploadProfile =
  | 'image_only'
  | 'media_docs'
  | 'spreadsheet'
  | 'foxpro_batch'
  | 'json_backup';

const BLOCKED_DANGEROUS_EXTS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'ps1',
  'sh',
  'js',
  'mjs',
  'cjs',
  'vbs',
  'html',
  'htm',
  'svg',
  'php',
  'scr',
  'dll',
  'jar',
  'apk',
  'com',
  'pif',
]);

const PROFILE_ALLOWED_EXTS: Record<SafeUploadProfile, string[]> = {
  image_only: ['jpg', 'jpeg', 'png', 'webp'],
  media_docs: ['jpg', 'jpeg', 'png', 'pdf', 'webp'],
  spreadsheet: ['csv', 'xlsx', 'xls'],
  foxpro_batch: ['dbf', 'xlsx', 'xls', 'csv'],
  json_backup: ['json', 'gz'],
};

export function isBlockedDangerousFileName(fileName: string): boolean {
  const cleanName = String(fileName || '').trim().toLowerCase();
  if (!cleanName) return true;
  const parts = cleanName.split('.').filter(Boolean);
  if (parts.length <= 1) return true;
  // Block both trailing extension and embedded executable extensions (e.g. backup.json.exe)
  return parts.slice(1).some((segment) => BLOCKED_DANGEROUS_EXTS.has(segment));
}

export function validateSafeUploadFile(
  file: File | null | undefined,
  profile: SafeUploadProfile,
  maxSizeMb = 50
): { valid: boolean; reason?: string } {
  if (!file) {
    return { valid: false, reason: 'No file selected.' };
  }
  const cleanName = String(file.name || '').trim();
  const ext = cleanName.includes('.') ? cleanName.split('.').pop()?.toLowerCase() || '' : '';

  if (!ext || isBlockedDangerousFileName(cleanName)) {
    return {
      valid: false,
      reason: `Blocked unsafe file "${cleanName}". Executables and scripts (.exe, .bat, .vbs, .js, etc.) are strictly prohibited by DRC Security Policy.`,
    };
  }

  const allowed = PROFILE_ALLOWED_EXTS[profile];
  if (!allowed.includes(ext)) {
    return {
      valid: false,
      reason: `Unsupported file type ".${ext}" for "${cleanName}". Allowed: ${allowed.map((e) => `.${e}`).join(', ')}.`,
    };
  }

  if (file.size > maxSizeMb * 1024 * 1024) {
    return {
      valid: false,
      reason: `File "${cleanName}" exceeds the ${maxSizeMb} MB safety limit.`,
    };
  }

  return { valid: true };
}
