export function formatINR(value: number | undefined | null, decimals = 2): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatINRCompact(value: number | undefined | null): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  });
}

export function formatDateDDMMYYYY(isoDate: string | undefined): string {
  if (!isoDate) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoDate)) return isoDate;
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const PRECREATED_FYS = ['FY 2025-26', 'FY 2026-27'] as const;

export function normalizeFyLabel(raw?: string): string {
  if (!raw) return 'FY 2026-27';
  const s = String(raw).trim().toUpperCase();
  const fullMatch = s.match(/(\d{4})\s*[-–\/]\s*(\d{2,4})/);
  if (fullMatch) {
    const start = Number(fullMatch[1]);
    const endShort = fullMatch[2].slice(-2);
    return `FY ${start}-${endShort}`;
  }
  const shortMatch = s.match(/(\d{2})\s*[-–\/]\s*(\d{2})/);
  if (shortMatch) {
    return `FY 20${shortMatch[1]}-${shortMatch[2]}`;
  }
  return s.startsWith('FY ') ? s : `FY ${s}`;
}

export function getDynamicFinancialYear(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(d.getTime())) return 'FY 2026-27';
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `FY ${startYear}-${endShort}`;
}

export function resolveFinancialYearFromDate(dateStr?: string): string {
  return getDynamicFinancialYear(dateStr);
}

export function getFyShortCode(fy: string): string {
  const norm = normalizeFyLabel(fy);
  const m = norm.match(/(\d{4})-(\d{2})/);
  if (m) return `${m[1].slice(-2)}-${m[2]}`;
  return '26-27';
}

export function matchesSelectedFinancialYear(
  explicitFy: string | undefined,
  dateStr: string | undefined,
  activeFy: string
): boolean {
  const target = normalizeFyLabel(activeFy);
  if (explicitFy && explicitFy.trim()) {
    return normalizeFyLabel(explicitFy) === target;
  }
  if (!dateStr) return true;
  return resolveFinancialYearFromDate(dateStr) === target;
}

export function daysUntilDate(dateStr?: string): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysSinceDate(dateStr?: string): number {
  if (!dateStr) return 0;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now.getTime() - target.getTime()) / (1000 * 60 * 60 * 24)));
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n] || '';
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return `${TENS[ten]}${one ? ' ' + ONES[one] : ''}`.trim();
}

function integerToIndianWords(num: number): string {
  if (num === 0) return 'Zero';
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = Math.floor((num % 1000) / 100);
  const rest = num % 100;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsToWords(lakh)} Lakhs`);
  if (thousand > 0) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rest > 0) parts.push(twoDigitsToWords(rest));
  return parts.join(' ').trim();
}

export function amountToIndianWords(amount: number): string {
  const safe = Math.max(0, Number(amount) || 0);
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);

  let result = `Rupees ${integerToIndianWords(rupees)}`;
  if (paise > 0) {
    result += ` AND ${twoDigitsToWords(paise)} Paise`;
  }
  return `${result} Only`;
}

export function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function makeSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
}
