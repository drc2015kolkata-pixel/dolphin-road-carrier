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

export function downloadPdfFileFromResult(pdf: { blobUrl: string; fileName: string }): void {
  const a = document.createElement('a');
  a.href = pdf.blobUrl;
  a.download = pdf.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function sharePdfDirect(params: {
  pdf: { blob: Blob; blobUrl: string; fileName: string };
  channel: 'whatsapp' | 'email';
  phone?: string;
  email?: string;
  partyName?: string;
  docNo: string;
  docLabel: string;
  company?: CompanySettings;
}): Promise<{ method: 'web_share' | 'cloud_api' | 'protocol'; cancelled?: boolean; message: string }> {
  const party = String(params.partyName || '').trim();
  const docLabel = String(params.docLabel || 'Document').trim();
  const docNo = String(params.docNo || params.pdf.fileName.replace(/\.pdf$/i, '')).trim();
  const shareText = buildDirectDocumentShareText({ partyName: party, docLabel, docNo });

  if (params.channel === 'whatsapp' && params.company?.whatsappCloud?.enabled && params.phone) {
    const apiRes = await sendViaWhatsAppCloudApi({
      company: params.company,
      toPhone: params.phone,
      message: shareText,
    });
    if (apiRes.ok) {
      downloadPdfFileFromResult(params.pdf);
      return {
        method: 'cloud_api',
        message: `Sent via WhatsApp Cloud API to ${params.phone} & downloaded ${params.pdf.fileName}.`,
      };
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const pdfFile = new File([params.pdf.blob], params.pdf.fileName, {
        type: 'application/pdf',
      });
      const canShareFiles =
        typeof navigator.canShare === 'function' ? navigator.canShare({ files: [pdfFile] }) : false;
      if (canShareFiles) {
        await navigator.share({
          title: `${docLabel} ${docNo}`,
          text: shareText,
          files: [pdfFile],
        });
        return {
          method: 'web_share',
          message: `${docLabel} ${docNo} PDF attached & shared.`,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { method: 'web_share', cancelled: true, message: 'Share cancelled.' };
      }
      // Fall through cleanly to direct PDF download + native protocol link
    }
  }

  downloadPdfFileFromResult(params.pdf);
  if (params.channel === 'whatsapp') {
    triggerExternalShareLink(
      buildNativeWhatsAppProtocolHref({ phone: params.phone, message: shareText })
    );
    return {
      method: 'protocol',
      message: `${params.pdf.fileName} downloaded & WhatsApp opened (${party || docNo}).`,
    };
  }

  triggerExternalShareLink(
    buildEmailShareHref({
      email: params.email || params.company?.email || OFFICIAL_PARTY_EMAIL,
      subject: `${docLabel} ${docNo}${party ? ` - ${party}` : ''}`,
      body: shareText,
    })
  );
  return {
    method: 'protocol',
    message: `${params.pdf.fileName} downloaded & Email composer opened (${party || docNo}).`,
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
