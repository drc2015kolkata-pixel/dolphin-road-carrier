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

export function buildDirectDocumentShareText(params: {
  partyName?: string;
  docLabel: string;
  docNo: string;
}): string {
  const party = String(params.partyName || '').trim();
  const docLabel = String(params.docLabel || 'Document').trim();
  const docNo = String(params.docNo || '').trim();
  return [party ? `Party: ${party}` : '', `${docLabel}: ${docNo}`]
    .filter(Boolean)
    .join('\n');
}

export function buildWhatsAppShareHref(params: {
  phone?: string;
  message: string;
}): string {
  const phone = normalizeIndianWhatsAppPhone(params.phone);
  const encoded = encodeURIComponent(params.message);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function buildNativeWhatsAppProtocolHref(params: {
  phone?: string;
  message: string;
}): string {
  const phone = normalizeIndianWhatsAppPhone(params.phone);
  const encoded = encodeURIComponent(params.message);
  return phone ? `whatsapp://send?phone=${phone}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
}

export function buildEmailShareHref(params: {
  email?: string;
  subject: string;
  body: string;
}): string {
  const to = String(params.email || '').trim();
  const prefix = to ? `mailto:${encodeURIComponent(to)}` : 'mailto:';
  return `${prefix}?subject=${encodeURIComponent(params.subject)}&body=${encodeURIComponent(params.body)}`;
}

export function triggerExternalShareLink(href: string): void {
  const link = document.createElement('a');
  link.href = href;
  if (/^https?:/i.test(href)) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function buildBareWhatsAppProtocolHref(phone?: string): string {
  const normalized = normalizeIndianWhatsAppPhone(phone);
  return normalized ? `whatsapp://send?phone=${normalized}` : 'whatsapp://send';
}

export function buildBareEmailProtocolHref(email?: string): string {
  const to = String(email || '').trim();
  return to ? `mailto:${encodeURIComponent(to)}` : 'mailto:';
}

export function downloadPdfFileFromResult(pdf: { blobUrl: string; fileName: string }): void {
  const a = document.createElement('a');
  a.href = pdf.blobUrl;
  a.download = pdf.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * STRICT BINARY .PDF SHARE:
 * Never attaches text messages, subjects, bodies, or URLs.
 * Sends ONLY pure binary `.pdf` File(s) via native share sheet (or downloads + opens bare WhatsApp / Mail composer).
 */
export async function sharePdfDirect(params: {
  pdf: { blob: Blob; blobUrl?: string; fileName: string };
  channel: 'whatsapp' | 'email';
  phone?: string;
  email?: string;
  partyName?: string;
  docNo: string;
  docLabel: string;
  company?: CompanySettings;
}): Promise<{ method: 'web_share' | 'protocol'; cancelled?: boolean; message: string }> {
  const blobUrl = params.pdf.blobUrl || URL.createObjectURL(params.pdf.blob);
  const file = new File([params.pdf.blob], params.pdf.fileName, {
    type: 'application/pdf',
  });

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const canShareFiles =
        typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : false;
      if (canShareFiles) {
        await navigator.share({
          files: [file],
        });
        return {
          method: 'web_share',
          message: `Shared ${params.pdf.fileName} (pure binary PDF).`,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { method: 'web_share', cancelled: true, message: 'Share cancelled.' };
      }
    }
  }

  downloadPdfFileFromResult({ blobUrl, fileName: params.pdf.fileName });
  if (params.channel === 'whatsapp') {
    triggerExternalShareLink(buildBareWhatsAppProtocolHref(params.phone));
    return {
      method: 'protocol',
      message: `${params.pdf.fileName} downloaded & WhatsApp opened (pure binary PDF only).`,
    };
  }

  triggerExternalShareLink(
    buildBareEmailProtocolHref(params.email || params.company?.email || OFFICIAL_PARTY_EMAIL)
  );
  return {
    method: 'protocol',
    message: `${params.pdf.fileName} downloaded & Mail composer opened (pure binary PDF only).`,
  };
}

export async function sharePdfBatchDirect(params: {
  pdfs: Array<{ blob: Blob; fileName: string }>;
  channel: 'whatsapp' | 'email';
  phone?: string;
  email?: string;
  company?: CompanySettings;
}): Promise<{ method: 'web_share' | 'protocol'; cancelled?: boolean; message: string }> {
  if (!params.pdfs.length) {
    return { method: 'protocol', message: 'Select at least one PDF file to share.' };
  }
  const files = params.pdfs.map(
    (p) => new File([p.blob], p.fileName, { type: 'application/pdf' })
  );

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const canShareFiles =
        typeof navigator.canShare === 'function' ? navigator.canShare({ files }) : false;
      if (canShareFiles) {
        await navigator.share({ files });
        return {
          method: 'web_share',
          message: `Shared ${files.length} binary .pdf file(s).`,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { method: 'web_share', cancelled: true, message: 'Batch share cancelled.' };
      }
    }
  }

  for (const item of params.pdfs) {
    const url = URL.createObjectURL(item.blob);
    downloadPdfFileFromResult({ blobUrl: url, fileName: item.fileName });
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  if (params.channel === 'whatsapp') {
    triggerExternalShareLink(buildBareWhatsAppProtocolHref(params.phone));
    return {
      method: 'protocol',
      message: `${files.length} binary .pdf file(s) downloaded & WhatsApp opened.`,
    };
  }

  triggerExternalShareLink(
    buildBareEmailProtocolHref(params.email || params.company?.email || OFFICIAL_PARTY_EMAIL)
  );
  return {
    method: 'protocol',
    message: `${files.length} binary .pdf file(s) downloaded & Mail opened.`,
  };
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
