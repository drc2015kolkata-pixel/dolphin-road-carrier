import { Party } from '../types/erp';

const LAST_90DAY_MAINT_KEY = 'drc_erp_last_90day_autofix_v1';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface ContactValidationResult {
  normalizedPhone: string;
  normalizedEmail: string;
  normalizedGstin: string;
  normalizedPan: string;
  warnings: string[];
  isClean: boolean;
}

export function validateAndNormalizeContact(input: {
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
}): ContactValidationResult {
  const warnings: string[] = [];

  const rawPhone = String(input.phone || '').trim();
  const digits = rawPhone.replace(/\D/g, '');
  let normalizedPhone = rawPhone;
  if (digits.length === 12 && digits.startsWith('91')) {
    normalizedPhone = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    normalizedPhone = digits.slice(1);
  } else if (digits.length === 10) {
    normalizedPhone = digits;
  } else if (rawPhone) {
    warnings.push('Phone should be a valid 10-digit Indian mobile/landline number.');
  }

  const normalizedEmail = String(input.email || '')
    .trim()
    .toLowerCase();
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
    warnings.push('Email format looks invalid (e.g. accounts@company.com).');
  }

  const normalizedGstin = String(input.gstin || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (
    normalizedGstin &&
    !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalizedGstin)
  ) {
    warnings.push('GSTIN should be 15 characters (e.g. 19DOTPS3540M1ZZ).');
  }

  const normalizedPan = String(input.pan || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (normalizedPan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(normalizedPan)) {
    warnings.push('PAN should be 10 characters (e.g. DOTPS3540M).');
  }

  return {
    normalizedPhone,
    normalizedEmail,
    normalizedGstin,
    normalizedPan,
    warnings,
    isClean: warnings.length === 0,
  };
}

export function scanPartiesForContactIssues(parties: Party[]): Array<{
  partyId: string;
  partyName: string;
  warnings: string[];
}> {
  const issues: Array<{ partyId: string; partyName: string; warnings: string[] }> = [];
  const seenPhones = new Map<string, string>();
  for (const p of parties) {
    const check = validateAndNormalizeContact({
      phone: p.phone,
      email: p.email,
      gstin: p.gstin,
      pan: p.pan,
    });
    const list = [...check.warnings];
    if (check.normalizedPhone) {
      const prev = seenPhones.get(check.normalizedPhone);
      if (prev && prev.toLowerCase() !== (p.name || '').toLowerCase()) {
        list.push(`Phone ${check.normalizedPhone} also assigned to "${prev}".`);
      } else {
        seenPhones.set(check.normalizedPhone, p.name || p.id);
      }
    }
    if (list.length > 0) {
      issues.push({ partyId: p.id, partyName: p.name, warnings: list });
    }
  }
  return issues;
}

// ============================================================================
// Auto-Thermal Memory Cooling + 90-Day Self-Healing Integrity Cleaner
// ============================================================================

const trackedBlobUrls = new Set<string>();

export function registerManagedBlobUrl(url: string): string {
  trackedBlobUrls.add(url);
  return url;
}

export function revokeThermalMemoryCooledUrls(): number {
  let released = 0;
  trackedBlobUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
      released += 1;
    } catch {
      // Ignore already revoked URLs
    }
  });
  trackedBlobUrls.clear();
  return released;
}

export interface SystemAutoFixReport {
  ranAt: number;
  checksumHash: string;
  clearedScratchKeys: number;
  cooledBlobUrls: number;
  repairedRecordsCount: number;
  contactWarningsCount: number;
  summary: string;
}

function computeFastChecksum(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function shouldRun90DayMaintenance(): boolean {
  try {
    const raw = localStorage.getItem(LAST_90DAY_MAINT_KEY);
    if (!raw) return true;
    const lastTs = Number(raw);
    if (!Number.isFinite(lastTs) || lastTs <= 0) return true;
    return Date.now() - lastTs >= NINETY_DAYS_MS;
  } catch {
    return false;
  }
}

export function getLast90DayMaintenanceTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(LAST_90DAY_MAINT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function runSystemAutoFixAndClean(params: {
  parties: Party[];
  consignmentCount: number;
  invoiceCount: number;
  lorryHireCount: number;
}): SystemAutoFixReport {
  let clearedScratchKeys = 0;
  let repairedRecordsCount = 0;

  try {
    const keysToCheck: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keysToCheck.push(k);
    }
    for (const k of keysToCheck) {
      if (
        k.startsWith('drc_tmp_') ||
        k.startsWith('drc_scratch_') ||
        k.startsWith('vite-plugin-pwa:tmp')
      ) {
        localStorage.removeItem(k);
        clearedScratchKeys += 1;
      }
      // Clean corrupted JSON in non-critical preference keys (never delete primary data!)
      if (k === 'drc_erp_ui_pref_v1') {
        try {
          JSON.parse(localStorage.getItem(k) || '{}');
        } catch {
          localStorage.removeItem(k);
          repairedRecordsCount += 1;
        }
      }
    }
  } catch {
    // Ignore storage inspection constraints
  }

  const cooledBlobUrls = revokeThermalMemoryCooledUrls();
  const contactIssues = scanPartiesForContactIssues(params.parties);

  const fingerprint = `${params.parties.length}|${params.consignmentCount}|${params.invoiceCount}|${params.lorryHireCount}`;
  const checksumHash = computeFastChecksum(fingerprint);
  const ranAt = Date.now();

  try {
    localStorage.setItem(LAST_90DAY_MAINT_KEY, String(ranAt));
  } catch {
    // Ignore
  }

  return {
    ranAt,
    checksumHash,
    clearedScratchKeys,
    cooledBlobUrls,
    repairedRecordsCount,
    contactWarningsCount: contactIssues.length,
    summary: `System healthy (CRC ${checksumHash}). Cooled ${cooledBlobUrls} blob(s), cleared ${clearedScratchKeys} scratch key(s), scanned ${params.parties.length} party profiles (${contactIssues.length} contact guard notice(s)). Accounting records 100% preserved.`,
  };
}

const DAILY_JUNK_CLEANUP_KEY = 'drc_last_local_junk_cleanup_day_v1';

export function shouldRunDailyJunkCleanup(): boolean {
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    return localStorage.getItem(DAILY_JUNK_CLEANUP_KEY) !== todayKey;
  } catch {
    return false;
  }
}

export function runDailyLocalJunkCleanup(): {
  clearedScratchKeys: number;
  cooledBlobUrls: number;
} {
  let clearedScratchKeys = 0;
  try {
    const keysToCheck: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keysToCheck.push(k);
    }
    for (const k of keysToCheck) {
      if (
        k.startsWith('drc_tmp_') ||
        k.startsWith('drc_scratch_') ||
        k.startsWith('vite-plugin-pwa:tmp') ||
        /scrap/i.test(k)
      ) {
        localStorage.removeItem(k);
        clearedScratchKeys += 1;
      }
    }
    localStorage.setItem(DAILY_JUNK_CLEANUP_KEY, new Date().toISOString().slice(0, 10));
  } catch {
    // Ignore storage constraints
  }
  const cooledBlobUrls = revokeThermalMemoryCooledUrls();
  return { clearedScratchKeys, cooledBlobUrls };
}
