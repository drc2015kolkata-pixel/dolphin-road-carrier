import { CompanySettings, Invoice, Party } from '../types/erp';
import { OFFICIAL_PARTY_EMAIL } from './firebase';

export const PRIORITY_CORRIDOR_REGIONS = [
  'Assam',
  'Siliguri',
  'Cooch Behar',
  'Alipurduar',
  'Malda',
  'Raiganj',
  'Bihar',
  'Odisha',
  'Jharkhand',
  'Tamil Nadu',
  'Nepal',
  'Bangladesh',
  'Bhutan',
] as const;

export function normalizeIndianWhatsAppPhone(phone?: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function buildWhatsAppShareHref(params: {
  phone?: string;
  message: string;
}): string {
  const phone = normalizeIndianWhatsAppPhone(params.phone);
  const encoded = encodeURIComponent(params.message);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function buildEmailShareHref(params: {
  email?: string;
  subject: string;
  body: string;
}): string {
  const to = String(params.email || OFFICIAL_PARTY_EMAIL).trim() || OFFICIAL_PARTY_EMAIL;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    params.subject
  )}&body=${encodeURIComponent(params.body)}`;
}

export function triggerExternalShareLink(href: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function sendViaWhatsAppCloudApi(params: {
  company: CompanySettings;
  toPhone: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = params.company.whatsappCloud;
  if (!cfg?.enabled || !cfg.phoneNumberId || !cfg.accessToken) {
    return { ok: false, error: 'WhatsApp Cloud API is not configured in Settings.' };
  }
  const phone = normalizeIndianWhatsAppPhone(params.toPhone);
  if (!phone) {
    return { ok: false, error: 'Recipient WhatsApp phone number is missing.' };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: params.message },
        }),
      }
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      return { ok: false, error: `WhatsApp Cloud API (${res.status}): ${txt}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export function getInvoicePendingDays(inv: Invoice, todayIso?: string): number {
  const ref = inv.invoiceDate || '';
  if (!ref) return 0;
  const start = new Date(ref).getTime();
  const end = todayIso ? new Date(todayIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
}

export function buildOverdueBillMessage(params: {
  invoice: Invoice;
  companyName: string;
  pendingDays: number;
  bankDetails?: string;
}): string {
  const balance = Math.max(0, Number(params.invoice.grandTotal || 0) - Number(params.invoice.paidAmount || 0));
  return [
    `Dear ${params.invoice.partyName},`,
    `Payment Reminder (${params.pendingDays} Days Pending) from ${params.companyName}:`,
    `Bill No: ${params.invoice.invoiceNo} | Date: ${params.invoice.invoiceDate}`,
    `Total Bill: Rs. ${Number(params.invoice.grandTotal || 0).toLocaleString('en-IN')}`,
    `Pending Balance: Rs. ${balance.toLocaleString('en-IN')}`,
    params.bankDetails ? `Bank / UPI: ${params.bankDetails}` : '',
    `Kindly arrange payment at your earliest convenience. Thank you!`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildPartyLoadFollowUpMessage(params: {
  party: Party;
  companyName: string;
  corridorHint?: string;
  phones?: string;
}): string {
  const corridorText = params.corridorHint
    ? `along the ${params.corridorHint} corridor`
    : 'for North Bengal, Assam, Bihar, Odisha, Jharkhand, Tamil Nadu, Nepal, Bangladesh & Bhutan routes';
  return [
    `Namaste ${params.party.name},`,
    `Greetings from ${params.companyName}!`,
    `Checking in for any upcoming Truck / Trailer / Container load requirements ${corridorText}.`,
    `Daily assured placement with competitive freight & live tracking.`,
    params.phones ? `Call / WhatsApp Dispatch: ${params.phones}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
