import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import {
  BillCopyCount,
  CompanyBankAccount,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Invoice,
  LogisticsDocket,
  LogisticsInvoice,
  LogisticsManifest,
  Quotation,
  getLogisticsDivisionFromId,
} from '../types/erp';
import {
  amountToIndianWords,
  formatDateDDMMYYYY,
  formatDateHyphenDDMMYYYY,
  formatINR,
  getDynamicFinancialYear,
  sanitizeFileName,
  todayISO,
} from './formatters';
import type { TallyLedgerStatement } from './tallyLedgerEngine';

export type PdfOrientation = 'p' | 'l';

export interface PdfAssets {
  logoDataUrl?: string;
  stampDataUrl?: string;
  panCropDataUrl?: string;
  watermarkDataUrl?: string;
}

export interface FoxproColumnDef {
  label: string;
  widthPct: number;
  align?: 'left' | 'right' | 'center';
}

export interface FoxproRowDef {
  line1: string[];
  line2?: string[];
}

export interface FoxproStatementSpec {
  title: string;
  subtitle: string;
  fileName: string;
  summaryLines?: Array<{ label: string; value: string }>;
  columns: FoxproColumnDef[];
  rows: FoxproRowDef[];
  totalsLabel?: string;
  totalsLine1?: string[];
  totalsLine2?: string[];
  totalAmountForWords?: number;
  legalNotice?: string;
  orientation?: PdfOrientation;
}

const LEGAL_SHIELD_NOTICE =
  "Consignor/Party must arrange valid Transit/Material Insurance before dispatch. Goods carried strictly at Owner's Risk under Carriage by Road Act 2007 Sec 10 & 17; Force Majeure; MSMED Act 2006 max 45-day payment; Kolkata Jurisdiction.";

export type PdfTaskPayload =
  | {
      kind: 'invoice';
      invoice: Invoice;
      company: CompanySettings;
      includeAnnexure: boolean;
      orientation?: PdfOrientation;
      copyCount?: BillCopyCount;
      assets: PdfAssets;
    }
  | {
      kind: 'lr3copy';
      cn: ConsignmentNote;
      company: CompanySettings;
      orientation?: PdfOrientation;
      singleCopyOnly?: boolean;
      assets: PdfAssets;
    }
  | {
      kind: 'quotation';
      quote: Quotation;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'declaration194c';
      decl: Declaration194C;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'gstRegister';
      invoices: Invoice[];
      subtitle: string;
      company: CompanySettings;
      fileName: string;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'foxproStatement';
      spec: FoxproStatementSpec;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'tableReport';
      title: string;
      subtitle: string;
      headers: string[];
      rows: string[][];
      company: CompanySettings;
      fileName: string;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'logisticsDocket';
      docket: LogisticsDocket;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'logisticsManifest';
      manifest: LogisticsManifest;
      dockets: LogisticsDocket[];
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'logisticsInvoice';
      invoice: LogisticsInvoice;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'imagePages';
      pages: string[];
      title: string;
      fileName: string;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'podScan';
      imageDataUrl: string;
      truckNo: string;
      cnNo?: string;
      podDate: string;
      remarks?: string;
      partyName?: string;
      division?: string;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'entityKyc';
      role: 'Driver' | 'Broker' | 'Lorry Owner' | 'Vehicle';
      recordName: string;
      fields: Array<{ label: string; value: string }>;
      attachedImageDataUrl?: string;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'appBlueprint';
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    }
  | {
      kind: 'tallyLedger';
      statement: TallyLedgerStatement;
      company: CompanySettings;
      orientation?: PdfOrientation;
      assets: PdfAssets;
    };

const SAFE_MARGIN = 11; // >=10mm safe print margin for HP Ink Tank 315 A4

function drawCenteredWatermark(
  doc: jsPDF,
  assets: PdfAssets | undefined,
  text = 'DOLPHIN ROAD CARRIER'
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  if (assets?.watermarkDataUrl) {
    const size = Math.min(84, Math.min(pageWidth, pageHeight) * 0.42);
    try {
      doc.addImage(
        assets.watermarkDataUrl,
        getJsPdfImageFormat(assets.watermarkDataUrl),
        pageWidth / 2 - size / 2,
        pageHeight / 2 - size / 2,
        size,
        size,
        undefined,
        'FAST'
      );
      return;
    } catch {
      // Fallback to crisp centered text crest
    }
  }

  doc.saveGraphicsState();
  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('D.R.C', pageWidth / 2, pageHeight / 2 - 4, { align: 'center' });
  doc.setFontSize(13);
  doc.text(text, pageWidth / 2, pageHeight / 2 + 6, { align: 'center' });
  doc.restoreGraphicsState();
}

function resolveInvoiceBankAccount(
  company: CompanySettings,
  selectedBankId?: string
): CompanyBankAccount {
  const accounts = company.bankAccounts || [];
  const found =
    (selectedBankId ? accounts.find((b) => b.id === selectedBankId) : undefined) ||
    accounts.find((b) => b.isDefault) ||
    accounts[0];

  if (found) {
    return found;
  }
  return {
    id: 'primary',
    bankName: company.bankName || 'PUNJAB NATIONAL BANK',
    accountName: company.companyName || 'DOLPHIN ROAD CARRIER',
    accountNo: company.accountNo || '0672050014252',
    ifsc: company.ifsc || 'PUNB0008020',
    branch: company.bankBranch || 'JORASANKO, KOLKATA',
    upiId: company.upiId || 'dolphinroadcarrier@pnb',
    swift: company.swift || 'PUNBINBBXXX',
    isDefault: true,
  };
}

function drawVectorUpiQr(
  doc: jsPDF,
  upiUri: string,
  boxX: number,
  boxY: number,
  qrSizeMm = 18.5
) {
  try {
    const qr = QRCode.create(upiUri, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    if (count > 0) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.35);
      doc.rect(boxX - 1.2, boxY - 1.2, qrSizeMm + 2.4, qrSizeMm + 6.4, 'FD');

      const cell = qrSizeMm / count;
      doc.setFillColor(0, 0, 0);
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (qr.modules.get(r, c)) {
            doc.rect(boxX + c * cell, boxY + r * cell, cell + 0.04, cell + 0.04, 'F');
          }
        }
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(0, 0, 0);
      doc.text('BANK QR', boxX + qrSizeMm / 2, boxY + qrSizeMm + 3.8, { align: 'center' });
      return;
    }
  } catch {
    // Fallback box if QR encoding throws
  }
  doc.setDrawColor(0, 0, 0);
  doc.rect(boxX, boxY, qrSizeMm, qrSizeMm + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('BANK QR', boxX + qrSizeMm / 2, boxY + qrSizeMm / 2 + 2, { align: 'center' });
}

function drawVectorVerificationQr(
  doc: jsPDF,
  payload: string,
  boxX: number,
  boxY: number,
  qrSizeMm = 16,
  label = 'VERIFY QR'
) {
  try {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    if (count > 0) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.32);
      doc.rect(boxX - 1.1, boxY - 1.1, qrSizeMm + 2.2, qrSizeMm + 5.8, 'FD');

      const cell = qrSizeMm / count;
      doc.setFillColor(15, 23, 42);
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (qr.modules.get(r, c)) {
            doc.rect(boxX + c * cell, boxY + r * cell, cell + 0.04, cell + 0.04, 'F');
          }
        }
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.9);
      doc.setTextColor(15, 23, 42);
      doc.text(label, boxX + qrSizeMm / 2, boxY + qrSizeMm + 3.4, { align: 'center' });
      return;
    }
  } catch {
    // Fallback box if QR encoding throws
  }
  doc.setDrawColor(15, 23, 42);
  doc.rect(boxX, boxY, qrSizeMm, qrSizeMm + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text(label, boxX + qrSizeMm / 2, boxY + qrSizeMm / 2 + 2, { align: 'center' });
}

function getJsPdfImageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (/^data:image\/png/i.test(dataUrl)) return 'PNG';
  if (/^data:image\/webp/i.test(dataUrl)) return 'WEBP';
  return 'JPEG';
}

function drawTopLeftLogo(doc: jsPDF, assets: PdfAssets | undefined, x: number, y: number, w = 22, h = 22) {
  if (assets?.logoDataUrl) {
    try {
      doc.addImage(
        assets.logoDataUrl,
        getJsPdfImageFormat(assets.logoDataUrl),
        x,
        y,
        w,
        h,
        undefined,
        'FAST'
      );
      return;
    } catch {
      // Fallback to crisp vector Royal Blue Dolphin Ring logo below
    }
  }
  drawInvoiceCircularRoadLogo(doc, x, y, w, h);
}

/**
 * Printed Bilty (CN/LR) Logo:
 * Crisp Yellow-background Red/Blue Oval Truck "DRC" + "!! OM SAI RAM !!" badge
 */
function drawBiltyYellowTruckLogo(doc: jsPDF, x: number, y: number, w = 22, h = 20) {
  // Vibrant yellow plate
  doc.setFillColor(254, 240, 138);
  doc.setDrawColor(180, 28, 28);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  // Top "!! OM SAI RAM !!" micro strip
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.4);
  doc.setTextColor(180, 28, 28);
  doc.text('!! OM SAI RAM !!', x + w / 2, y + 3.2, { align: 'center' });

  // Red & blue oval truck emblem inside yellow box
  const cx = x + w / 2;
  const cy = y + h * 0.54;
  doc.setFillColor(220, 38, 38);
  doc.setDrawColor(13, 71, 161);
  doc.setLineWidth(0.5);
  doc.ellipse(cx, cy, w * 0.41, h * 0.25, 'FD');

  // Stylised cab & trailer silhouette bar
  doc.setFillColor(30, 58, 138);
  doc.rect(cx - w * 0.27, cy - 2.2, w * 0.36, 3.6, 'F');
  doc.setFillColor(255, 255, 255);
  doc.rect(cx + w * 0.10, cy - 1.5, w * 0.14, 2.9, 'F');

  // DRC lettering centered
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.text('DRC', cx - 1, cy + 0.9, { align: 'center' });

  // Wheels
  doc.setFillColor(15, 23, 42);
  doc.circle(cx - w * 0.16, cy + 2.1, 0.95, 'F');
  doc.circle(cx + w * 0.04, cy + 2.1, 0.95, 'F');
  doc.circle(cx + w * 0.18, cy + 2.1, 0.95, 'F');

  // Bottom subcaption
  doc.setTextColor(13, 71, 161);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.text('DOLPHIN CARRIER', x + w / 2, y + h - 1.5, { align: 'center' });
}

/**
 * Printed Tax Invoice / Bill Logo:
 * Crisp Blue-White Circular Road "D.R.C" emblem
 */
function drawInvoiceCircularRoadLogo(doc: jsPDF, x: number, y: number, w = 21, h = 21) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2 - 0.5;

  // Outer navy-blue circular seal
  doc.setFillColor(13, 71, 161);
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.5);
  doc.circle(cx, cy, r, 'FD');

  // Inner crisp white ring
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(147, 197, 253);
  doc.setLineWidth(0.35);
  doc.circle(cx, cy, r * 0.82, 'FD');

  // Upper sky-blue highway semicircle / arc band
  doc.setFillColor(29, 78, 216);
  doc.circle(cx, cy, r * 0.68, 'F');

  // Tapered white road perspective trapezoid from bottom edge toward center
  doc.setFillColor(255, 255, 255);
  doc.triangle(cx - r * 0.42, cy + r * 0.56, cx + r * 0.42, cy + r * 0.56, cx, cy - r * 0.05, 'F');

  // Center dashed highway stripe in blue
  doc.setDrawColor(13, 71, 161);
  doc.setLineWidth(0.45);
  doc.line(cx, cy + r * 0.16, cx, cy + r * 0.28);
  doc.line(cx, cy + r * 0.35, cx, cy + r * 0.49);

  // D.R.C bold mark in upper half
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text('D.R.C', cx, cy - r * 0.15, { align: 'center' });

  // Bottom curved banner text
  doc.setFillColor(13, 71, 161);
  doc.rect(cx - r * 0.72, cy + r * 0.54, r * 1.44, 2.8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(4.2);
  doc.text('ROAD CARRIER', cx, cy + r * 0.54 + 2.1, { align: 'center' });
}

function drawBottomRightStampAndSign(
  doc: jsPDF,
  assets: PdfAssets | undefined,
  rightEdgeX: number,
  topY: number,
  width = 30,
  height = 19
) {
  const boxX = rightEdgeX - width - 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('FOR DOLPHIN ROAD CARRIER', boxX + width / 2, topY - 1.5, { align: 'center' });
  let drewImage = false;
  if (assets?.stampDataUrl) {
    try {
      doc.addImage(
        assets.stampDataUrl,
        getJsPdfImageFormat(assets.stampDataUrl),
        boxX,
        topY,
        width,
        height,
        undefined,
        'FAST'
      );
      drewImage = true;
    } catch {
      drewImage = false;
    }
  }
  if (!drewImage) {
    doc.setDrawColor(29, 78, 216);
    doc.circle(boxX + width / 2, topY + height / 2, 8.5);
    doc.setFontSize(5.5);
    doc.text('DOLPHIN ROAD', boxX + width / 2, topY + height / 2 - 1, { align: 'center' });
    doc.text('CARRIER', boxX + width / 2, topY + height / 2 + 2, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text('Authorised Signatory', boxX + width / 2, topY + height + 3.8, { align: 'center' });
}

function stampAllPageNumbers(doc: jsPDF, footerNote?: string, marginX = SAFE_MARGIN, footerYOffset = 5.5) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    if (footerNote) {
      doc.setFont('helvetica', 'bolditalic');
      doc.text(footerNote, marginX, ph - footerYOffset);
      doc.setFont('helvetica', 'normal');
    }
    doc.text(`Page ${i} of ${totalPages}`, pw - marginX, ph - footerYOffset, { align: 'right' });
  }
}

export function buildPdfArrayBuffer(task: PdfTaskPayload): {
  buffer: ArrayBuffer;
  fileName: string;
  title: string;
  orientation: PdfOrientation;
  copyCount?: BillCopyCount;
} {
  if (task.kind === 'invoice') {
    const resolvedCopies: BillCopyCount = task.copyCount || task.invoice.copyCount || 1;
    return buildInvoiceDoc(
      task.invoice,
      task.company,
      task.includeAnnexure,
      task.assets,
      task.orientation || 'p',
      resolvedCopies
    );
  }
  if (task.kind === 'lr3copy') {
    return buildLR3CopyDoc(
      task.cn,
      task.company,
      task.assets,
      task.orientation || 'l',
      task.singleCopyOnly !== false
    );
  }
  if (task.kind === 'quotation') {
    return buildQuotationDoc(task.quote, task.company, task.assets, task.orientation || 'p');
  }
  if (task.kind === 'declaration194c') {
    return buildDeclaration194CDoc(
      task.decl,
      task.company,
      task.assets,
      task.orientation || 'p'
    );
  }
  if (task.kind === 'gstRegister') {
    return buildGstRegisterDoc(
      task.invoices,
      task.subtitle,
      task.company,
      task.fileName,
      task.assets,
      task.orientation || 'l'
    );
  }
  if (task.kind === 'foxproStatement') {
    return buildFoxproStatementDoc(
      task.spec,
      task.company,
      task.assets,
      task.orientation || task.spec.orientation || 'l'
    );
  }
  if (task.kind === 'logisticsDocket') {
    return buildLogisticsDocketDoc(task.docket, task.company, task.assets, task.orientation || 'l');
  }
  if (task.kind === 'logisticsManifest') {
    return buildLogisticsManifestDoc(
      task.manifest,
      task.dockets,
      task.company,
      task.assets,
      task.orientation || 'l'
    );
  }
  if (task.kind === 'logisticsInvoice') {
    return buildLogisticsInvoiceDoc(task.invoice, task.company, task.assets, task.orientation || 'p');
  }
  if (task.kind === 'podScan') {
    return buildPodScanDoc(task);
  }
  if (task.kind === 'entityKyc') {
    return buildEntityKycDoc(task);
  }
  if (task.kind === 'appBlueprint') {
    return buildAppFormatBlueprintDoc(task.company, task.assets, task.orientation || 'p');
  }
  if (task.kind === 'tallyLedger') {
    return buildTallyLedgerDoc(task.statement, task.company, task.assets, task.orientation || 'p');
  }
  if (task.kind === 'imagePages') {
    const doc = new jsPDF({
      orientation: (task.orientation || 'p') === 'l' ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    (task.pages || []).forEach((imgUrl, idx) => {
      if (idx > 0) doc.addPage();
      try {
        doc.addImage(imgUrl, getJsPdfImageFormat(imgUrl), 4, 4, pw - 8, ph - 8, undefined, 'FAST');
      } catch {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${task.title} (Page ${idx + 1})`, 15, 20);
      }
    });
    return {
      buffer: doc.output('arraybuffer'),
      fileName: task.fileName || 'DRC_Operating_Book_Bilingual.pdf',
      title: task.title || 'Dolphin Road Carriers Bilingual Operating Book',
      orientation: task.orientation || 'p',
    };
  }
  return buildTableReportDoc(task);
}

// ============================================================================
// 1. TAX INVOICE / BILL OF SUPPLY (Symmetrical Full-Bleed A4 · Equal 8mm Margin)
//    Crisp Full Outer Border Box · Unlimited Rows · 1 to 4 Copies Combined PDF
// ============================================================================

const BILL_MARGIN = 8; // Equal 8mm margins on all 4 sides of A4 (210mm x 297mm)

function getBillCopyLabels(copyCount: BillCopyCount): string[] {
  if (copyCount === 1) return ['ORIGINAL FOR RECIPIENT'];
  if (copyCount === 2) return ['ORIGINAL FOR RECIPIENT', 'TRIPLICATE / OFFICE COPY'];
  if (copyCount === 3) {
    return ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE / OFFICE COPY'];
  }
  return [
    'ORIGINAL FOR RECIPIENT',
    'DUPLICATE FOR TRANSPORTER',
    'TRIPLICATE / OFFICE COPY',
    'EXTRA COPY',
  ];
}

function buildInvoiceDoc(
  invoice: Invoice,
  company: CompanySettings,
  includeAnnexure: boolean,
  assets: PdfAssets,
  orientation: PdfOrientation = 'p',
  copyCount: BillCopyCount = 1
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const M = BILL_MARGIN;
  const cw = pw - M * 2;
  const ch = ph - M * 2;
  const rows = invoice.consignmentRows || [];
  const copyLabels = getBillCopyLabels(copyCount);
  const billingCountry = (invoice.billingCountry || 'India').trim();
  const isCrossBorderExempt = /^(Nepal|Bangladesh|Bhutan)$/i.test(billingCountry);
  const gstPaidByLabel = invoice.gstPaidBy || (invoice.reverseCharge ? 'Consignee' : 'Transporter');

  const drawOuterBorder = () => {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.55);
    doc.rect(M, M, cw, ch);
  };

  const drawHeader = (isContPage: boolean, copyLabel: string) => {
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');

    drawOuterBorder();

    // TOP-LEFT Royal Blue Dolphin Ring + D.R.C Logo inside 8mm outer border
    drawTopLeftLogo(doc, assets, M + 2.5, M + 2.5, 21, 21);

    // TOP-RIGHT HEADER VERIFY QR (Strictly in top-right header corner, never side-by-side with UPI QR)
    const verifyPayload = `DRC|INV|${invoice.invoiceNo || ''}|${invoice.invoiceDate || ''}|${Number(invoice.grandTotal || 0).toFixed(2)}|${invoice.partyGstin || invoice.partyPan || 'NA'}|${company.gstin || ''}`;
    drawVectorVerificationQr(doc, verifyPayload, M + cw - 17, M + 2.8, 14.2, 'VERIFY QR');

    // Copy Label Badge placed cleanly left of Header Verify QR
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.0);
    const badgeW = 44;
    const badgeX = M + cw - badgeW - 21;
    const badgeY = M + 2.5;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(30, 64, 175);
    doc.setLineWidth(0.35);
    doc.rect(badgeX, badgeY, badgeW, 5.5, 'FD');
    doc.setTextColor(13, 71, 161);
    doc.text(copyLabel, badgeX + badgeW / 2, badgeY + 3.9, { align: 'center' });

    const headerTextMaxW = cw - 26 - 68;
    const invDivTag =
      invoice.division && invoice.division !== 'FTL'
        ? ` (${String(invoice.division).toUpperCase()} DIVISION)`
        : '';
    doc.setTextColor(15, 76, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.2);
    doc.text(`${String(company.companyName || 'DOLPHIN ROAD CARRIER')}${invDivTag}`, M + 26, M + 7);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.0);
    const addrWrapHdr = doc.splitTextToSize(String(company.address || ''), headerTextMaxW);
    doc.text(addrWrapHdr.slice(0, 1), M + 26, M + 11.2);
    doc.text(`PAN: ${company.pan}   |   GSTIN: ${company.gstin}`, M + 26, M + 15.2);
    doc.text(`PH: ${company.phones}   |   MSME: ${company.msme}   |   SAC: ${invoice.sac || company.hsn}`, M + 26, M + 19.2);

    const docKindLabel = (invoice.docKind || 'Tax Invoice').toUpperCase();
    const spacedHeading =
      docKindLabel === 'CREDIT NOTE'
        ? 'G S T   C R E D I T   N O T E'
        : docKindLabel === 'DEBIT NOTE'
        ? 'G S T   D E B I T   N O T E'
        : isContPage
        ? 'T A X   I N V O I C E   ( C O N T I N U A T I O N )'
        : isCrossBorderExempt
        ? 'B I L L   O F   S U P P L Y   ( E X P O R T   /   G S T   E X E M P T )'
        : 'T A X   I N V O I C E   /   B I L L   O F   S U P P L Y';

    doc.setTextColor(docKindLabel === 'CREDIT NOTE' ? 180 : 180, 35, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(spacedHeading, pw / 2, M + 26.5, { align: 'center' });

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.4);
    doc.line(M, M + 29, M + cw, M + 29);

    // Split BILL TO and INVOICE META cleanly inside border
    const splitX = M + cw * 0.56;
    doc.line(splitX, M + 29, splitX, M + 55.5);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text('BILL TO,', M + 2.5, M + 33.5);
    doc.text(String(invoice.partyName || '-').toUpperCase(), M + 2.5, M + 38);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const addrLines = doc.splitTextToSize(String(invoice.partyAddress || '-').toUpperCase(), cw * 0.53);
    doc.text(addrLines.slice(0, 2), M + 2.5, M + 42.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.text(
      isCrossBorderExempt
        ? `COUNTRY: ${billingCountry.toUpperCase()}   |   PAN: ${invoice.partyPan || 'REQUIRED'}`
        : `GSTIN: ${invoice.partyGstin || '-'}   |   PAN: ${invoice.partyPan || '-'}`,
      M + 2.5,
      M + 52.8
    );

    const metaX = splitX + 2.5;
    const colonX = metaX + 23;
    const valX = metaX + 25.5;
    doc.setFontSize(7.8);
    const metas = [
      ['INVOICE NO', invoice.againstInvoiceNo ? `${invoice.invoiceNo} (Ref: ${invoice.againstInvoiceNo})` : invoice.invoiceNo],
      ['DATE', formatDateDDMMYYYY(invoice.invoiceDate)],
      ['DUE / CREDIT', `${formatDateDDMMYYYY(invoice.dueDate) || '-'} (${invoice.creditDays || 15}d) · ${invoice.financialYear || company.currentFy}`],
      ['PO / BRANCH', `${invoice.poWorkOrderNo || '-'} | ${invoice.billedAtBranch || invoice.branchCode || 'KOLKATA'}`],
      ['SAC / CODE', `${invoice.sac || company.hsn || '996791'} / ${isCrossBorderExempt ? 'EXPORT 0%' : (invoice.interstate ? 'IGST' : 'CGST+SGST')}`],
    ];
    metas.forEach(([k, v], i) => {
      const my = M + 33.5 + i * 4.6;
      doc.setFont('helvetica', 'bold');
      doc.text(k, metaX, my);
      doc.text(':', colonX, my);
      doc.setFont('helvetica', 'normal');
      doc.text(String(v || '-').slice(0, 34), valX, my);
    });

    doc.line(M, M + 55.5, M + cw, M + 55.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('CONSIGNMENT & VEHICLE DETAILS', pw / 2, M + 59.5, { align: 'center' });

    return M + 61.5;
  };

  // Symmetrical 7-Column Full-Bleed Table Grid summing to 100% of cw:
  // S.No (6%) | CN/LR No. & Date (21%) | Vehicle No. (15%) | Route (From -> To) (22%) | Weight (MT & Pkgs) (13%) | Rate Type (11%) | Freight (12%)
  const colEdges = [0, 0.06, 0.27, 0.42, 0.64, 0.77, 0.88, 1.0];
  const colX = (idx: number) => M + cw * colEdges[idx];

  const drawTableHeader = (startY: number) => {
    const hdrH = 7;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);
    doc.rect(M, startY, cw, hdrH, 'FD');
    for (let i = 1; i < colEdges.length - 1; i++) {
      doc.line(colX(i), startY, colX(i), startY + hdrH);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.9);
    doc.setTextColor(15, 23, 42);
    doc.text('S.No', (colX(0) + colX(1)) / 2, startY + 4.7, { align: 'center' });
    doc.text('CN / LR NO. & DATE', colX(1) + 1.5, startY + 4.7);
    doc.text('VEHICLE NO.', colX(2) + 1.5, startY + 4.7);
    doc.text('ROUTE (FROM -> TO)', colX(3) + 1.5, startY + 4.7);
    doc.text('WT (MT & PKGS)', colX(5) - 1.5, startY + 4.7, { align: 'right' });
    doc.text('RATE TYPE', colX(5) + 1.5, startY + 4.7);
    doc.text('FREIGHT (INR)', colX(7) - 1.5, startY + 4.7, { align: 'right' });
    return startY + hdrH;
  };

  copyLabels.forEach((copyLabel, copyIdx) => {
    if (copyIdx > 0) doc.addPage();

    let curY = drawHeader(false, copyLabel);
    curY = drawTableHeader(curY);
    const rowH = 6.5;
    const maxContentY = ph - M - 10;

    rows.forEach((row, idx) => {
      if (curY + rowH > maxContentY) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.2);
        doc.text('Continued on next page...', M + cw - 2, ph - M - 3, { align: 'right' });
        doc.addPage();
        curY = drawHeader(true, copyLabel);
        curY = drawTableHeader(curY);
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(M, curY, cw, rowH, 'F');
      }
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.25);
      doc.line(M, curY + rowH, M + cw, curY + rowH);
      for (let i = 1; i < colEdges.length - 1; i++) {
        doc.line(colX(i), curY, colX(i), curY + rowH);
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.9);
      doc.setTextColor(15, 23, 42);
      const ty = curY + 4.5;

      const cnAndDate = `${String(row.cnNo || '-').slice(0, 14)} (${formatDateDDMMYYYY(row.cnDate)})`;
      const routeText = `${String(row.from || '-').slice(0, 12)} -> ${String(row.to || '-').slice(0, 12)}`;
      const wtVal = Number(row.weight || 0).toFixed(2);
      const wtPkgText = row.packages ? `${wtVal}MT/${String(row.packages).slice(0, 7)}` : `${wtVal} MT`;
      const isPerTon = /ton|mt/i.test(String(row.rateType || ''));
      const rateLabel = isPerTon
        ? `Per Ton ${row.ratePerMt ? formatINR(row.ratePerMt) : ''}`.trim()
        : 'Fixed';

      doc.text(`${idx + 1}`, (colX(0) + colX(1)) / 2, ty, { align: 'center' });
      doc.text(cnAndDate.slice(0, 28), colX(1) + 1.5, ty);
      doc.setFont('helvetica', 'bold');
      doc.text(String(row.vehicle || '-').slice(0, 15), colX(2) + 1.5, ty);
      doc.setFont('helvetica', 'normal');
      doc.text(routeText.slice(0, 30), colX(3) + 1.5, ty);
      doc.text(wtPkgText.slice(0, 17), colX(5) - 1.5, ty, { align: 'right' });
      doc.text(rateLabel.slice(0, 14), colX(5) + 1.5, ty);
      doc.setFont('helvetica', 'bold');
      doc.text(formatINR(row.freight || 0), colX(7) - 1.5, ty, { align: 'right' });
      curY += rowH;
    });

    // Final Totals + Tax + Bank + Bottom-Right Stamp (NEVER split summary box across pages)
    const SUMMARY_BLOCK_HEIGHT = 122;
    if (curY + SUMMARY_BLOCK_HEIGHT > ph - M - 4) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.2);
      doc.text('Totals & Stamp on next page...', M + cw - 2, ph - M - 3, { align: 'right' });
      doc.addPage();
      curY = drawHeader(true, copyLabel);
    }

    const boxTop = curY + 5;
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('FREIGHT & GST TAX SUMMARY', pw / 2, boxTop - 1.2, { align: 'center' });

    const taxColW = cw * 0.42;
    const amtColW = cw * 0.2;
    const descColStart = M + taxColW;
    const amtColStart = M + cw - amtColW;

    doc.rect(M, boxTop, cw, 54);
    doc.line(descColStart, boxTop, descColStart, boxTop + 54);
    doc.line(amtColStart, boxTop, amtColStart, boxTop + 54);
    doc.line(M, boxTop + 6, M + cw, boxTop + 6);

    doc.setFontSize(7.3);
    doc.text('GST CALCULATION & LIABILITY', M + taxColW / 2, boxTop + 4.2, { align: 'center' });
    doc.text('PARTICULARS', descColStart + (amtColStart - descColStart) / 2, boxTop + 4.2, { align: 'center' });
    doc.text('AMOUNT (INR)', amtColStart + amtColW / 2, boxTop + 4.2, { align: 'center' });

    const taxY = boxTop + 10.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const gstSlab = isCrossBorderExempt ? 0 : Number(invoice.gstRate ?? 5);
    const halfSlabStr = (gstSlab / 2).toFixed(1);
    const fullSlabStr = gstSlab.toFixed(1);
    if (isCrossBorderExempt) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 35, 35);
      doc.text(`EXPORT TO ${billingCountry.toUpperCase()} : GST EXEMPT (0%)`, M + 2, taxY);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'normal');
      doc.text('GSTIN Not Required · PAN Mandatory', M + 2, taxY + 5);
    } else {
      doc.text(`Reverse Charge (RCM) : ${invoice.reverseCharge ? 'Yes' : 'No'}`, M + 2, taxY);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `GST Slab : ${fullSlabStr}% (${invoice.interstate || (invoice.igstAmt || 0) > 0 ? 'IGST Interstate' : `CGST ${halfSlabStr}% + SGST ${halfSlabStr}%`})`,
        M + 2,
        taxY + 5
      );
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`CGST (${halfSlabStr}%) : ${formatINR(invoice.cgstAmt || 0)}`, M + 2, taxY + 10.5);
    doc.text(`SGST (${halfSlabStr}%) : ${formatINR(invoice.sgstAmt || 0)}`, M + 2, taxY + 15.5);
    doc.text(`IGST (${fullSlabStr}%) : ${formatINR(invoice.igstAmt || 0)}`, M + 2, taxY + 20.5);
    doc.text(`TOTAL GST   : ${formatINR(invoice.totalTax || 0)}`, M + 2, taxY + 25.5);
    doc.setFontSize(6.6);
    doc.setFont('helvetica', 'normal');
    const taxWords = doc.splitTextToSize(amountToIndianWords(invoice.totalTax || 0), taxColW - 4);
    doc.text(taxWords.slice(0, 2), M + 2, taxY + 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(13, 71, 161);
    doc.text(`GST Paid By : ${gstPaidByLabel}`, M + 2, taxY + 39);
    doc.setTextColor(15, 23, 42);

    const allCharges = [
      ['FREIGHT CHARGES', invoice.freightCharges || 0],
      ['INSURANCE CHARGES', invoice.insuranceCharge || 0],
      ['COLL CHARGES', invoice.collCharge || 0],
      ['LOADING CHARGES', invoice.loadingCharge || 0],
      ['UNLOADING CHARGES', invoice.unloadingCharges || 0],
      ['SURCHARGE', invoice.surchargeAmt || 0],
      ['DETENTION CHARGES', invoice.detentionCharges || 0],
      ['ST CHARGES', invoice.stCharges || 0],
      ['FUMIGATION CHARGES', invoice.fumigationCharge || 0],
      ['EXTRA CHARGES', invoice.extraCharge || 0],
      ...(Math.abs(Number(invoice.roundOffAmt || 0)) >= 0.005
        ? ([['ROUND OFF (+/-)', invoice.roundOffAmt || 0]] as const)
        : []),
    ] as const;

    const visibleCharges = allCharges.filter(
      ([label, val]) => Math.abs(Number(val)) > 0 || label === 'FREIGHT CHARGES'
    );
    const stepY = Math.min(5.2, 28 / Math.max(1, visibleCharges.length));
    let cy = boxTop + 9.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(visibleCharges.length > 5 ? 6.8 : 7.6);
    visibleCharges.forEach(([label, val]) => {
      doc.text(label, descColStart + 4, cy);
      const formatted =
        label === 'ROUND OFF (+/-)' && Number(val) < 0
          ? `-${formatINR(Math.abs(Number(val)))}`
          : formatINR(val);
      doc.text(formatted, M + cw - 3, cy, { align: 'right' });
      cy += stepY;
    });

    doc.line(descColStart, boxTop + 40, M + cw, boxTop + 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.text('GRAND TOTAL :', descColStart + 4, boxTop + 46.5);
    doc.text(formatINR(invoice.grandTotal || 0), M + cw - 3, boxTop + 46.5, { align: 'right' });
    if (Number(invoice.advanceReceived || 0) > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      const netDue = Math.max(0, (invoice.grandTotal || 0) - Number(invoice.advanceReceived || 0));
      doc.text(
        `Adv Recd (${invoice.advanceMode || 'NEFT'}): Rs.${formatINR(invoice.advanceReceived)} | Net Due: Rs.${formatINR(netDue)}`,
        descColStart + 4,
        boxTop + 51.5
      );
    }

    const wordsBarY = boxTop + 54;
    doc.rect(M, wordsBarY, cw, 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.text(amountToIndianWords(invoice.grandTotal || 0), M + 2, wordsBarY + 4.8);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL : Rs. ${formatINR(invoice.grandTotal || 0)}`, M + cw - 2, wordsBarY + 4.8, {
      align: 'right',
    });

    const bankBoxY = wordsBarY + 7;
    const selectedBank = resolveInvoiceBankAccount(company, invoice.selectedBankId);
    const upiPayAddress =
      selectedBank.upiId ||
      company.upiId ||
      `${(selectedBank.accountNo || '0672050014252').replace(/\s+/g, '')}@${(selectedBank.ifsc || 'PUNB0008020').slice(0, 4).toLowerCase()}.ifsc.npci`;
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiPayAddress)}&pn=${encodeURIComponent(
      selectedBank.accountName || company.companyName || 'DOLPHIN ROAD CARRIER'
    )}&am=${Number(invoice.grandTotal || 0).toFixed(2)}&tn=${encodeURIComponent(
      `Bill ${invoice.invoiceNo || ''}`
    )}&cu=INR`;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);
    doc.rect(M, bankBoxY, cw, 27);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text(`Bank   : ${String(selectedBank.bankName || '').slice(0, 42)}`, M + 2, bankBoxY + 5);
    doc.text(
      `Branch : ${String(selectedBank.branch || '').slice(0, 26)}${selectedBank.swift ? ` (SWIFT: ${selectedBank.swift})` : ''}`,
      M + 2,
      bankBoxY + 9.8
    );
    doc.text(`A/c No : ${selectedBank.accountNo}`, M + 2, bankBoxY + 14.6);
    doc.text(
      `IFSC   : ${selectedBank.ifsc}  |  A/c: ${String(selectedBank.accountName || '').slice(0, 22)}`,
      M + 2,
      bankBoxY + 19.4
    );
    if (selectedBank.upiId) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.text(`UPI ID : ${String(selectedBank.upiId).slice(0, 44)}`, M + 2, bankBoxY + 24.2);
    }

    // Scannable Vector UPI BANK QR exclusively beside Bank Details & Grand Total (Verify QR is strictly in top-right header)
    const qrBoxX = M + cw - 58;
    drawVectorUpiQr(doc, upiUri, qrBoxX, bankBoxY + 2.2, 18);

    // BOTTOM-RIGHT Company Stamp & Signature on FINAL PAGE of each copy
    drawBottomRightStampAndSign(doc, assets, M + cw, bankBoxY + 5, 29, 16.5);

    const remBoxY = bankBoxY + 27;
    doc.rect(M, remBoxY, cw, 18.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    doc.text('REMARKS, PAYMENT TERMS & STATUTORY LEGAL SHIELD :', M + 2, remBoxY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    const combinedRem = [
      invoice.creditDebitReason ? `Reason: ${invoice.creditDebitReason}` : '',
      invoice.narrationText || '',
      invoice.remarks || '',
      invoice.additionalNotes || '',
      invoice.billFootnote ||
        'Payment Terms: 100% within credit period (18% p.a. thereafter). Pay via A/C Payee NEFT/RTGS.',
      `Notice: ${LEGAL_SHIELD_NOTICE}`,
    ]
      .filter(Boolean)
      .join(' | ');
    const remLines = doc.splitTextToSize(combinedRem, cw - 4);
    doc.text(remLines.slice(0, 3), M + 2, remBoxY + 8.5);

    // ANNEXURE inside same single combined PDF
    const annexRows =
      invoice.annexureLorries && invoice.annexureLorries.length > 0
        ? invoice.annexureLorries
        : rows.map((r) => ({ cnNo: r.cnNo, lorryNumbers: r.vehicle }));

    if (includeAnnexure && annexRows.length > 0) {
      const ANN_PER_PAGE = orientation === 'l' ? 18 : 28;
      const annPages = Math.ceil(annexRows.length / ANN_PER_PAGE);
      for (let ap = 0; ap < annPages; ap++) {
        doc.addPage();
        drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
        drawOuterBorder();
        drawTopLeftLogo(doc, assets, M + 2.5, M + 2.5, 19, 19);
        doc.setTextColor(15, 76, 129);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12.5);
        doc.text(`${company.companyName} — INVOICE ANNEXURE`, M + 25, M + 8);
        doc.setFontSize(7.2);
        doc.text(copyLabel, M + cw - 3, M + 7, { align: 'right' });
        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(
          `Invoice: ${invoice.invoiceNo}  |  Party: ${invoice.partyName}  |  Date: ${formatDateDDMMYYYY(invoice.invoiceDate)}`,
          M + 25,
          M + 14
        );
        doc.line(M, M + 23, M + cw, M + 23);

        let ay = M + 28;
        doc.setFillColor(241, 245, 249);
        doc.rect(M + 2, ay, cw - 4, 6.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('CONSIGNMENT NO', M + 5, ay + 4.5);
        doc.text('LORRY NUMBERS', M + 68, ay + 4.5);
        ay += 9;

        const slice = annexRows.slice(ap * ANN_PER_PAGE, (ap + 1) * ANN_PER_PAGE);
        doc.setFont('helvetica', 'normal');
        slice.forEach((item) => {
          doc.text(String(item.cnNo || '-'), M + 5, ay);
          doc.text(String(item.lorryNumbers || '-'), M + 68, ay);
          ay += 6.2;
        });

        if (ap === annPages - 1) {
          drawBottomRightStampAndSign(doc, assets, M + cw, ph - M - 30, 28, 17);
        }
      }
    }
  });

  stampAllPageNumbers(doc, 'THIS IS A SYSTEM GENERATED PRINT AUTHORISED BY DOLPHIN ROAD CARRIER.', M, 3.8);

  const billDateTag = formatDateHyphenDDMMYYYY(invoice.invoiceDate || todayISO());
  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(invoice.partyName || 'Party')}_${sanitizeFileName(invoice.invoiceNo || 'Bill')}_${billDateTag}.pdf`,
    title: `${invoice.docKind || 'Tax Invoice'} - ${invoice.invoiceNo} (${copyCount} ${copyCount === 1 ? 'Copy' : 'Copies'})`,
    orientation,
    copyCount,
  };
}

// ============================================================================
// 2. BILTY / CONSIGNMENT NOTE 3-COPY ENGINE
//    Default A4 LANDSCAPE · Supports Portrait Toggle · Large Remarks Box
//    Multi-Vehicle / Multi-EWB / Multi-Tax-Inv Overflow Continuation Pages
//    Logo TOP-LEFT · Company Stamp BOTTOM-RIGHT
// ============================================================================

function buildLR3CopyDoc(
  cn: ConsignmentNote,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'l',
  singleCopyOnly = true
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - SAFE_MARGIN * 2;
  const ch = ph - SAFE_MARGIN * 2 - 4;

  const copies = [
    'CONSIGNOR COPY',
    'CONSIGNEE COPY',
    'DRIVER / LORRY COPY',
    'OFFICE / EXTRA COPY',
  ] as const;
  const copiesToRender = singleCopyOnly ? ([copies[0]] as const) : copies;

  const allVehicles = [
    cn.truckNo,
    ...(cn.extraVehicles || []).map((v) => String(v || '').trim()).filter(Boolean),
  ].filter(Boolean);
  const allInvoices = [
    ...(cn.hasTaxInvoice !== false && cn.taxInvNo
      ? [{ no: cn.taxInvNo, date: cn.taxInvDate || '', value: cn.valueOfGoods }]
      : []),
    ...(cn.hasTaxInvoice !== false
      ? (cn.extraTaxInvoices || []).filter((x) => String(x?.no || '').trim())
      : []),
  ];
  const allEwbs = [
    ...(cn.ewayBillNo
      ? [{ no: cn.ewayBillNo, date: cn.ewayBillDate || '', validUpto: cn.ewayBillValidUpto || '' }]
      : []),
    ...(cn.extraEwayBills || []).filter((x) => String(x?.no || '').trim()),
  ];

  const hasOverflowSchedule =
    !singleCopyOnly && (allVehicles.length > 4 || allInvoices.length > 3 || allEwbs.length > 3);

  const originText = [cn.fromCity, cn.fromDistrict, cn.fromState].filter(Boolean).join(', ');
  const destText = [cn.toCity, cn.toDistrict, cn.toState].filter(Boolean).join(', ');

  copiesToRender.forEach((copyLabel, idx) => {
    if (idx > 0) doc.addPage();
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');

    const x0 = SAFE_MARGIN;
    const y0 = SAFE_MARGIN;

    doc.setDrawColor(140, 24, 24);
    doc.setLineWidth(0.55);
    doc.rect(x0, y0, cw, ch);

    // Top Jurisdiction Strip
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text(`GSTIN : ${company.gstin}   |   PAN : ${company.pan}`, x0 + 3, y0 + 4.5);
    const divBadge =
      cn.division && cn.division !== 'FTL'
        ? `   [${String(cn.division).toUpperCase()} DIVISION]`
        : '';
    doc.text(
      `${cn.stockTransfer ? '!! OM SAI RAM !!   [STOCK TRANSFER]' : '!! OM SAI RAM !!'}${divBadge}`,
      x0 + cw / 2,
      y0 + 4.5,
      { align: 'center' }
    );
    doc.text(`Subhajit Saha · Mob: ${company.phones}`, x0 + cw - 3, y0 + 4.5, { align: 'right' });

    // TOP-LEFT Royal Blue Dolphin Ring + D.R.C Logo (identical across all 4 divisions)
    drawTopLeftLogo(doc, assets, x0 + 3, y0 + 7.5, 21, 21);

    doc.setTextColor(175, 25, 25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(orientation === 'l' ? 20 : 15);
    doc.text(company.companyName, x0 + cw / 2 + 6, y0 + 14.5, { align: 'center' });
    doc.setFontSize(8.5);
    doc.text('FASTEST AND BETTER DELIVERY', x0 + cw / 2 + 6, y0 + 19, { align: 'center' });
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`${company.address}   E-mail: ${company.email}`, x0 + cw / 2 + 6, y0 + 23.5, {
      align: 'center',
    });

    const row1Y = y0 + 28.5;
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.35);

    const b1W = cw * 0.28;
    const b2W = cw * 0.33;
    const b3W = cw - b1W - b2W;

    doc.rect(x0, row1Y, b1W, 23);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text(
      `C/N No   : ${cn.branchShort ? `[${cn.branchShort}] ` : ''}${cn.cnNo}${cn.refCnNo ? ` (Ref:${cn.refCnNo})` : ''}`,
      x0 + 2.5,
      row1Y + 5
    );
    doc.text(`C/N Date : ${formatDateDDMMYYYY(cn.cnDate)} (${cn.transportMode || 'Road'})`, x0 + 2.5, row1Y + 9.8);
    doc.setFontSize(7);
    doc.text(`Billed At: ${(cn.billedAtBranch || cn.branchCode || 'KOLKATA').slice(0, 14)} | Cr: ${cn.creditDays || 15}d`, x0 + 2.5, row1Y + 14.6);
    doc.text(`Deliver At: ${(cn.deliverAt || cn.deliveryOffice || cn.toCity || '').slice(0, 24)}`, x0 + 2.5, row1Y + 19.6);

    doc.rect(x0 + b1W, row1Y, b2W, 23);
    doc.setFont('helvetica', 'bold');
    doc.text('INSURANCE, BILLING & VALUE', x0 + b1W + b2W / 2, row1Y + 4.8, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const insLines = doc.splitTextToSize(
      cn.insuranceStatus || 'The Customer has not insured the consignment',
      b2W - 5
    );
    doc.text(insLines.slice(0, 1), x0 + b1W + 2.5, row1Y + 9.5);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Bill To: ${(cn.billingPartyName || cn.consignorName || '-').slice(0, 34)}`,
      x0 + b1W + 2.5,
      row1Y + 14.5
    );
    doc.text(`Value of Goods Rs.: ${formatINR(cn.valueOfGoods || 0)}`, x0 + b1W + 2.5, row1Y + 19.8);

    doc.rect(x0 + b1W + b2W, row1Y, b3W, 23);
    doc.setFontSize(7.2);
    const invSummary =
      cn.hasTaxInvoice === false
        ? 'No (Unattached)'
        : allInvoices.length > 0
        ? allInvoices.map((x) => x.no).join(', ')
        : '-';
    const ewbSummary = allEwbs.length > 0 ? allEwbs.map((x) => x.no).join(', ') : '-';
    const ewbValidShort = cn.ewayBillValidUpto
      ? ` (Valid: ${cn.ewayBillValidUpto.replace('T', ' ').slice(0, 16)})`
      : '';
    doc.text(`TAX INV. No : ${invSummary.slice(0, 34)}`, x0 + b1W + b2W + 2.5, row1Y + 5);
    doc.text(`STOCK TRF   : ${cn.stockTransfer ? 'YES' : 'NO'}   |   INV DT: ${formatDateDDMMYYYY(cn.taxInvDate) || '-'}`, x0 + b1W + b2W + 2.5, row1Y + 9.8);
    doc.text(`E-WAY BILL  : ${(ewbSummary + ewbValidShort).slice(0, 36)}`, x0 + b1W + b2W + 2.5, row1Y + 14.6);
    doc.text(
      `ROUTE : ${(originText || cn.fromCity).slice(0, 18)} -> ${(destText || cn.toCity).slice(0, 18)}`,
      x0 + b1W + b2W + 2.5,
      row1Y + 19.6
    );

    // Parties + Vehicles Box
    const row2Y = row1Y + 23;
    const leftPartyW = cw * 0.6;
    const rightVehW = cw - leftPartyW;

    doc.rect(x0, row2Y, leftPartyW, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(`Consignor : ${cn.consignorName}`, x0 + 2.5, row2Y + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.text(
      `${(cn.consignorAddress || '-').slice(0, 62)} | GSTIN: ${cn.consignorGstin || '-'}`,
      x0 + 2.5,
      row2Y + 9.8
    );
    doc.line(x0, row2Y + 13, x0 + leftPartyW, row2Y + 13);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(`Consignee : ${cn.consigneeName}`, x0 + 2.5, row2Y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.text(
      `${(cn.consigneeAddress || '-').slice(0, 62)} | GSTIN: ${cn.consigneeGstin || '-'}`,
      x0 + 2.5,
      row2Y + 22.8
    );

    doc.rect(x0 + leftPartyW, row2Y, rightVehW, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    const vehSummary = allVehicles.join(', ');
    doc.text(`TRUCK NO(S)   : ${vehSummary.slice(0, 32)}`, x0 + leftPartyW + 2.5, row2Y + 5.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.text(`Owner's Name  : ${cn.ownerName || '-'}`, x0 + leftPartyW + 2.5, row2Y + 10);
    doc.text(`Driver's Name : ${cn.driverName || '-'}`, x0 + leftPartyW + 2.5, row2Y + 14.5);
    doc.text(`Driver D/L No : ${cn.driverDlNo || '-'}`, x0 + leftPartyW + 2.5, row2Y + 19);
    doc.text(`Engine/Chassis: ${cn.engineNo || '-'} / ${cn.chassisNo || '-'}`, x0 + leftPartyW + 2.5, row2Y + 23.5);

    // Goods & Freight Table (Compacted to fit cleanly on 1 single A4 Landscape page per copy)
    const tblY = row2Y + 26;
    const tblH = orientation === 'l' ? 44 : 62;
    doc.rect(x0, tblY, cw, tblH);
    const c1 = x0 + cw * 0.13;
    const c2 = x0 + cw * 0.56;
    const c3 = x0 + cw * 0.69;
    const c4 = x0 + cw * 0.84;
    doc.line(c1, tblY, c1, tblY + tblH);
    doc.line(c2, tblY, c2, tblY + tblH);
    doc.line(c3, tblY, c3, tblY + tblH);
    doc.line(c4, tblY, c4, tblY + tblH);
    doc.line(x0, tblY + 7.5, x0 + cw, tblY + 7.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('Pkgs / Mode', (x0 + c1) / 2, tblY + 5, { align: 'center' });
    doc.text('PARTICULARS (SAID TO CONTAIN)', (c1 + c2) / 2, tblY + 5, { align: 'center' });
    doc.text('WEIGHT (MT)', (c2 + c3) / 2, tblY + 5, { align: 'center' });
    doc.text('CHARGES', (c3 + c4) / 2, tblY + 5, { align: 'center' });
    doc.text('FREIGHT', (c4 + x0 + cw) / 2, tblY + 5, { align: 'center' });

    doc.setFontSize(9.5);
    doc.text(cn.packages || '-', (x0 + c1) / 2, tblY + 15.5, { align: 'center' });
    if (cn.packageMode) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(cn.packageMode.slice(0, 16), (x0 + c1) / 2, tblY + 21.5, { align: 'center' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    const partLines = doc.splitTextToSize(cn.particulars || '-', c2 - c1 - 5);
    doc.text(partLines.slice(0, 4), c1 + 2.5, tblY + 13);
    const delTypeLabel =
      cn.deliveryType ||
      (cn.deliveryModeCode === 'P'
        ? 'Party Delivery'
        : cn.deliveryModeCode === 'G'
        ? 'Godown Delivery'
        : 'Door Delivery');
    const freightModeLabel =
      cn.freightMode ||
      (cn.payBasis === 'TBB' ? 'To Be Billed' : cn.payBasis || 'To Pay');
    const gstPaidLabel =
      cn.gstPaidBy ||
      (cn.gstPaidByCode === 'E'
        ? 'Consignee'
        : cn.gstPaidByCode === 'T'
        ? 'GTA / Transporter'
        : 'Consignor');
    doc.setFontSize(6.8);
    doc.setTextColor(30, 64, 175);
    doc.text(
      `Basis: ${cn.rateMode || 'Fixed'}${cn.ratePerUnit ? ` (@ Rs.${formatINR(cn.ratePerUnit)})` : ''} | ${delTypeLabel}`,
      c1 + 2.5,
      tblY + tblH - 3.2
    );
    doc.setTextColor(15, 23, 42);

    doc.setFontSize(7.6);
    doc.text(`Nett : ${Number(cn.nettWeight || 0).toFixed(3)}`, c2 + 2, tblY + 13.5);
    doc.text(`Gross: ${Number(cn.grossWeight || 0).toFixed(3)}`, c2 + 2, tblY + 20);

    doc.setFontSize(7);
    doc.text(`Loading : ${formatINR(cn.loadingCharge || 0)}`, c3 + 2, tblY + 12);
    doc.text(`Unload  : ${formatINR(cn.unloadingCharge || 0)}`, c3 + 2, tblY + 16.8);
    doc.text(`Return  : ${formatINR(cn.returnLorryCharge || 0)}`, c3 + 2, tblY + 21.6);
    doc.text(`S.TT    : ${formatINR(cn.sttCharge || 0)}`, c3 + 2, tblY + 26.4);
    if (Number(cn.otherCharge || 0) > 0) {
      doc.text(`Others  : ${formatINR(cn.otherCharge || 0)}`, c3 + 2, tblY + 31.2);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    const hideFreight = cn.showFreightOnPrint === false;
    doc.text(hideFreight ? 'Total: As Agreed' : `Total: Rs.${formatINR(cn.totalFreight)}`, c4 + 2, tblY + 12.5);
    doc.setFont('helvetica', 'normal');
    doc.text(hideFreight ? 'Paid : As Agreed' : `Paid : Rs.${formatINR(cn.paidAmount || 0)}`, c4 + 2, tblY + 18);
    doc.text(hideFreight ? 'ToPay: As Agreed' : `ToPay: Rs.${formatINR(cn.toPayAmount || 0)}`, c4 + 2, tblY + 23.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(13, 71, 161);
    doc.text(`Mode: ${freightModeLabel}`, c4 + 2, tblY + 29.5);
    doc.text(`GST : ${gstPaidLabel}`, c4 + 2, tblY + 34.5);
    doc.setTextColor(15, 23, 42);

    // EXTRA-LARGE WIDE REMARKS BOX inside LR
    const remY = tblY + tblH;
    const remH = orientation === 'l' ? 25 : 38;
    doc.rect(x0, remY, cw, remH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('REMARKS / SPECIAL INSTRUCTIONS :', x0 + 2.5, remY + 4.8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    const extraGoodsSummary =
      cn.multiGoodsItems && cn.multiGoodsItems.length > 0
        ? `Items: ${cn.multiGoodsItems.map((g) => `${g.description}(${g.packages} ${g.packageMode})`).join(', ')}`
        : '';
    const largeRemarksText = [
      !hideFreight ? `Freight Words: ${amountToIndianWords(cn.totalFreight)}` : '',
      cn.remarks || '',
      extraGoodsSummary,
      allVehicles.length > 1 ? `All Vehicles: ${allVehicles.join(', ')}` : '',
      allEwbs.length > 1 ? `E-Way Bills: ${allEwbs.map((e) => e.no).join(', ')}` : '',
      allInvoices.length > 1 ? `Tax Invoices: ${allInvoices.map((i) => i.no).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    const lrRemLines = doc.splitTextToSize(largeRemarksText || '-', cw - 6);
    doc.text(lrRemLines.slice(0, orientation === 'l' ? 4 : 6), x0 + 2.5, remY + 9.5);

    // Copy Footer + Legal Notice + Checkboxes + BOTTOM-RIGHT Stamp
    const footY = remY + remH + 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.9);
    doc.setTextColor(15, 23, 42);
    const legalWrap = doc.splitTextToSize(`Notice: ${LEGAL_SHIELD_NOTICE}`, cw - 64);
    doc.text(legalWrap.slice(0, 2), x0 + 2.5, footY + 1.8);

    const cbY = footY + 7.8;
    if (orientation === 'l') {
      let cx = x0 + 2.5;
      const cbSpacing = 52;
      copies.forEach((lbl) => {
        const checked = lbl === copyLabel;
        doc.setDrawColor(15, 23, 42);
        doc.rect(cx, cbY, 3.4, 3.4);
        if (checked) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.text('X', cx + 0.7, cbY + 2.8);
        }
        doc.setFont('helvetica', checked ? 'bold' : 'normal');
        doc.setFontSize(6.6);
        doc.text(lbl, cx + 4.5, cbY + 2.8);
        cx += cbSpacing;
      });
    } else {
      copies.forEach((lbl, cIdx) => {
        const col = cIdx % 2;
        const row = Math.floor(cIdx / 2);
        const cx = x0 + 2.5 + col * 58;
        const cy = cbY + row * 4.8;
        const checked = lbl === copyLabel;
        doc.setDrawColor(15, 23, 42);
        doc.rect(cx, cy, 3.2, 3.2);
        if (checked) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.text('X', cx + 0.6, cy + 2.6);
        }
        doc.setFont('helvetica', checked ? 'bold' : 'normal');
        doc.setFontSize(6.3);
        doc.text(lbl, cx + 4.2, cy + 2.6);
      });
    }

    // Scannable DRC LR Verification QR + Company Stamp BOTTOM-RIGHT corner
    const lrVerifyPayload = `DRC|LR|${cn.cnNo || ''}|${cn.cnDate || ''}|${cn.truckNo || ''}|${cn.fromCity || ''}->${cn.toCity || ''}|${Number(cn.totalFreight || 0).toFixed(2)}|${company.gstin || ''}`;
    drawVectorVerificationQr(
      doc,
      lrVerifyPayload,
      x0 + cw - 55,
      y0 + ch - 23.5,
      orientation === 'l' ? 14 : 13,
      'VERIFY QR'
    );
    drawBottomRightStampAndSign(doc, assets, x0 + cw - 2, y0 + ch - 24, 27, 15.5);

    // EXACT BOTTOM-CENTER FOOTER BORDER LABEL IN BOLD UPPERCASE
    const pillW = 62;
    const pillH = 6;
    const pillX = x0 + cw / 2 - pillW / 2;
    const pillY = y0 + ch - pillH / 2;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(140, 24, 24);
    doc.setLineWidth(0.45);
    doc.rect(pillX, pillY, pillW, pillH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(140, 24, 24);
    doc.text(copyLabel, x0 + cw / 2, pillY + 4.3, { align: 'center' });
    doc.setTextColor(15, 23, 42);
  });

  // Continuation Schedule Page ONLY if extensive multi-item schedule (>4 vehicles / >3 invoices / >3 EWBs)
  if (hasOverflowSchedule) {
    doc.addPage();
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
    drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 20, 20);
    doc.setTextColor(15, 76, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(`${company.companyName} — ATTACHED LR MULTI-SCHEDULE`, SAFE_MARGIN + 24, SAFE_MARGIN + 7);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(
      `C/N No: ${cn.cnNo}  |  Date: ${formatDateDDMMYYYY(cn.cnDate)}  |  Consignor: ${cn.consignorName}`,
      SAFE_MARGIN + 24,
      SAFE_MARGIN + 13
    );
    doc.line(SAFE_MARGIN, SAFE_MARGIN + 22, pw - SAFE_MARGIN, SAFE_MARGIN + 22);

    let sy = SAFE_MARGIN + 29;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`1. All Assigned Vehicles (${allVehicles.length}):`, SAFE_MARGIN, sy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const vWrap = doc.splitTextToSize(allVehicles.join(', '), cw);
    doc.text(vWrap, SAFE_MARGIN, sy + 5.5);
    sy += 9 + vWrap.length * 4.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`2. All Tax Invoices / Challans (${allInvoices.length}):`, SAFE_MARGIN, sy);
    sy += 5.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    allInvoices.forEach((invRow, i) => {
      if (sy > ph - 36) {
        doc.addPage();
        drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
        sy = SAFE_MARGIN + 14;
      }
      doc.text(
        `${i + 1}. Invoice/Challan: ${invRow.no}   |   Date: ${formatDateDDMMYYYY(invRow.date) || '-'}   |   Value: Rs. ${formatINR(invRow.value || 0)}`,
        SAFE_MARGIN + 3,
        sy
      );
      sy += 5.5;
    });

    sy += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`3. All E-Way Bills (${allEwbs.length}):`, SAFE_MARGIN, sy);
    sy += 5.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    allEwbs.forEach((ewbRow, i) => {
      if (sy > ph - 36) {
        doc.addPage();
        drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
        sy = SAFE_MARGIN + 14;
      }
      doc.text(
        `${i + 1}. E-Way Bill No: ${ewbRow.no}   |   Date: ${formatDateDDMMYYYY(ewbRow.date) || '-'}${ewbRow.validUpto ? `   |   Valid Upto: ${ewbRow.validUpto.replace('T', ' ')}` : ''}`,
        SAFE_MARGIN + 3,
        sy
      );
      sy += 5.5;
    });

    drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN, ph - 36, 28, 17);
  }

  stampAllPageNumbers(doc, `Bilty / LR ${cn.cnNo} — Dolphin Road Carrier`);

  const lrDateTag = formatDateHyphenDDMMYYYY(cn.cnDate || todayISO());
  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(cn.consigneeName || cn.billingPartyName || 'Consignee')}_${sanitizeFileName(cn.cnNo || 'LR')}_${lrDateTag}.pdf`,
    title: singleCopyOnly ? `Consignment Note (LR Copy) - ${cn.cnNo}` : `Consignment Note (4 Copies) - ${cn.cnNo}`,
    orientation,
  };
}

// ============================================================================
// 3. RATE QUOTATION (Default A4 Portrait, Supports Landscape)
//    Logo TOP-LEFT · Company Stamp BOTTOM-RIGHT
// ============================================================================

function buildQuotationDoc(
  quote: Quotation,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'p'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - SAFE_MARGIN * 2;

  drawCenteredWatermark(doc, assets, 'D.R.C QUOTATION');

  // TOP-LEFT Triangular DRC Logo
  drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 23, 23);

  doc.setFont('times', 'italic');
  doc.setFontSize(12);
  doc.setTextColor(120, 113, 60);
  doc.text('Proforma Invoice', pw / 2, SAFE_MARGIN + 5, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('Rate Of Quotation', pw / 2, SAFE_MARGIN + 11.5, { align: 'center' });

  doc.setFontSize(8);
  doc.text('SUPPLY OF TRANSPORT SERVICES · ORIGINAL / OFFICE COPY', pw / 2, SAFE_MARGIN + 16.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(`Mail: ${company.email}`, pw / 2, SAFE_MARGIN + 21, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(`M/S ${company.companyName || 'DOLPHIN ROAD CARRIER'}`, SAFE_MARGIN, SAFE_MARGIN + 31);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.text(String(company.address || ''), SAFE_MARGIN, SAFE_MARGIN + 36);
  doc.text(`GSTIN: ${company.gstin || ''}`, SAFE_MARGIN, SAFE_MARGIN + 40.5);

  doc.text(`M: ${company.phones || ''}`, pw - SAFE_MARGIN, SAFE_MARGIN + 31, { align: 'right' });
  doc.text(`Date: ${formatDateDDMMYYYY(quote.quotationDate)}`, pw - SAFE_MARGIN, SAFE_MARGIN + 36, { align: 'right' });
  doc.text(`Ref No: ${quote.quotationNo || '-'}`, pw - SAFE_MARGIN, SAFE_MARGIN + 40.5, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Subject: ${quote.subject || 'To Vehicles Freight Rate Quotation'}`, pw / 2, SAFE_MARGIN + 48, {
    align: 'center',
  });
  doc.line(SAFE_MARGIN, SAFE_MARGIN + 51, pw - SAFE_MARGIN, SAFE_MARGIN + 51);

  doc.text('Quotation For:', SAFE_MARGIN, SAFE_MARGIN + 57);
  doc.text(`M/S ${quote.partyName || 'PARTY'}`, SAFE_MARGIN, SAFE_MARGIN + 62);
  doc.setFont('helvetica', 'normal');
  doc.text(quote.partyAddress || '-', SAFE_MARGIN, SAFE_MARGIN + 67);
  doc.setFont('helvetica', 'bold');
  doc.text(`GSTIN: ${quote.partyGstin || '-'}`, SAFE_MARGIN, SAFE_MARGIN + 73);

  doc.text('Quotation Validity:', pw - SAFE_MARGIN, SAFE_MARGIN + 57, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(quote.validityText || '7 Days', pw - SAFE_MARGIN, SAFE_MARGIN + 62, { align: 'right' });

  const routeRows =
    quote.routeRates && quote.routeRates.length > 0
      ? quote.routeRates
      : [
          {
            slNo: 1,
            origin: quote.entryPoint || 'Kolkata',
            destination: quote.destination || '-',
            vehicleType: quote.vehicleType || '-',
            loadCapacity: quote.tonGuarantee || '09 TON',
            freightRate: Number(quote.freight || 0),
            detentionExtra: quote.detentionCharge || 'Rs. 1000/Day after free hrs',
            remarks: quote.advancePay || 'No Advance Before Loading',
          },
        ];

  let ty = SAFE_MARGIN + 77;
  // Dynamic Multi-Row Route & Vehicle Rate Schedule
  doc.setFillColor(13, 71, 161);
  doc.rect(SAFE_MARGIN, ty, cw, 6.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.1);
  doc.setTextColor(255, 255, 255);
  const rcCols = [0, 0.06, 0.31, 0.48, 0.61, 0.74, 0.88, 1.0];
  const rcX = (i: number) => SAFE_MARGIN + cw * rcCols[i];
  doc.text('SL', rcX(0) + 1.5, ty + 4.3);
  doc.text('ORIGIN -> DESTINATION', rcX(1) + 1.5, ty + 4.3);
  doc.text('VEHICLE TYPE', rcX(2) + 1.5, ty + 4.3);
  doc.text('CAPACITY', rcX(3) + 1.5, ty + 4.3);
  doc.text('FREIGHT (Rs)', rcX(5) - 1.5, ty + 4.3, { align: 'right' });
  doc.text('DETENTION/EXT', rcX(5) + 1.5, ty + 4.3);
  doc.text('REMARKS', rcX(6) + 1.5, ty + 4.3);
  ty += 6.2;

  doc.setTextColor(15, 23, 42);
  const rRowH = 5.6;
  routeRows.forEach((rr, idx) => {
    if (ty + rRowH > ph - 26) {
      doc.addPage();
      drawCenteredWatermark(doc, assets, 'D.R.C QUOTATION');
      ty = SAFE_MARGIN + 10;
    }
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.25);
    doc.rect(SAFE_MARGIN, ty, cw, rRowH);
    for (let ci = 1; ci < rcCols.length - 1; ci++) {
      doc.line(rcX(ci), ty, rcX(ci), ty + rRowH);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(String(rr.slNo || idx + 1), rcX(0) + 1.5, ty + 3.9);
    doc.setFont('helvetica', 'normal');
    doc.text(`${(rr.origin || '-').slice(0, 16)} -> ${(rr.destination || '-').slice(0, 16)}`, rcX(1) + 1.5, ty + 3.9);
    doc.text(String(rr.vehicleType || '-').slice(0, 18), rcX(2) + 1.5, ty + 3.9);
    doc.text(String(rr.loadCapacity || '-').slice(0, 14), rcX(3) + 1.5, ty + 3.9);
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${formatINR(Number(rr.freightRate || 0))}`, rcX(5) - 1.5, ty + 3.9, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(String(rr.detentionExtra || '-').slice(0, 15), rcX(5) + 1.5, ty + 3.9);
    doc.text(String(rr.remarks || '-').slice(0, 14), rcX(6) + 1.5, ty + 3.9);
    ty += rRowH;
  });
  ty += 2.5;

  const qSubtotal =
    routeRows.reduce((s, r) => s + (Number(r.freightRate) || 0), 0) ||
    Number(quote.freight || 0);
  const qGstPct = Number(quote.gstRate ?? 5);
  const qRcm = quote.reverseCharge ?? true;
  const qIsIgst = Boolean(quote.interstate);
  const qTotalTax =
    quote.totalTax !== undefined
      ? Number(quote.totalTax || 0)
      : Math.round(((qSubtotal * qGstPct) / 100) * 100) / 100;
  const qCgst =
    quote.cgstAmt !== undefined
      ? Number(quote.cgstAmt || 0)
      : qIsIgst
        ? 0
        : Math.round((qTotalTax / 2) * 100) / 100;
  const qSgst =
    quote.sgstAmt !== undefined
      ? Number(quote.sgstAmt || 0)
      : qIsIgst
        ? 0
        : Math.round((qTotalTax - qCgst) * 100) / 100;
  const qGrandTotal =
    quote.grandTotal !== undefined
      ? Number(quote.grandTotal || 0)
      : Math.round((qRcm ? qSubtotal : qSubtotal + qTotalTax) * 100) / 100;
  const qGstSummaryText =
    qGstPct <= 0
      ? '0% GST (Exempt)'
      : qRcm
        ? `GTA ${qGstPct}% under RCM (Payable by Recipient; Tax Ref: Rs. ${formatINR(qTotalTax)})`
        : qIsIgst
          ? `IGST @ ${qGstPct}% = Rs. ${formatINR(qTotalTax)}`
          : `CGST ${(qGstPct / 2).toFixed(1)}% (Rs. ${formatINR(qCgst)}) + SGST ${(qGstPct / 2).toFixed(1)}% (Rs. ${formatINR(qSgst)})`;

  const rows: Array<[string, string]> = [
    ...(quote.division && quote.division !== 'FTL'
      ? [['Division', `${String(quote.division).toUpperCase()} DIVISION`] as [string, string]]
      : []),
    ...(quote.goodsType ? [['Goods Type', quote.goodsType] as [string, string]] : []),
    ['Rate Mode & Subtotal', `${quote.rateMode || 'Fixed'}  |  Freight Subtotal: Rs. ${formatINR(qSubtotal)}`],
    ['GST / Tax Treatment', qGstSummaryText],
    ['Total Quoted Amount', `Rs. ${formatINR(qGrandTotal)}`],
    ['Amount in Words', amountToIndianWords(qGrandTotal)],
    ['Loading / Unloading', `${quote.loadingCharge || 'NO Extra'}  |  Unload: ${quote.unloadingCharge || 'YES Extra'}`],
    ['Parking / Detention', `${quote.parkingCharge || 'YES Extra'}  |  Detention: ${quote.detentionCharge || 'YES Extra'}`],
    ['Advance Policy', quote.advancePay || 'No Advance Before Lorry Loading'],
    [
      'Payment Guarantor',
      quote.guarantorName
        ? `${quote.guarantorName}${quote.guarantorPhone ? ` (Mob: ${quote.guarantorPhone})` : ''}`
        : 'As per Agreed Party Signatory',
    ],
  ];

  const labelW = cw * 0.26;
  const valW = cw - labelW;
  const rowH = orientation === 'l' ? 4.8 : 5.2;
  doc.setLineWidth(0.3);

  rows.forEach(([k, v]) => {
    if (ty + rowH > ph - 18) {
      doc.addPage();
      drawCenteredWatermark(doc, assets, 'D.R.C QUOTATION');
      ty = SAFE_MARGIN + 10;
    }
    doc.rect(SAFE_MARGIN, ty, labelW, rowH);
    doc.rect(SAFE_MARGIN + labelW, ty, valW, rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.text(String(k ?? ''), SAFE_MARGIN + 2.5, ty + rowH - 1.6);
    doc.setFont('helvetica', k === 'Total Quoted Amount' ? 'bold' : 'normal');
    const valStr = String(v ?? '-');
    doc.setFontSize(valStr.length > 82 ? 6.6 : 7.5);
    doc.text(valStr, SAFE_MARGIN + labelW + 3, ty + rowH - 1.6);
    ty += rowH;
  });

  ty += 3;
  if (ty + 74 > ph - 10) {
    doc.addPage();
    drawCenteredWatermark(doc, assets, 'D.R.C QUOTATION');
    ty = SAFE_MARGIN + 10;
  }

  const qBank = resolveInvoiceBankAccount(company);
  doc.rect(SAFE_MARGIN, ty, cw * 0.52, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Bank Details', SAFE_MARGIN + 2.5, ty + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.text(`A/C Name   : ${company.companyName}`, SAFE_MARGIN + 2.5, ty + 10.2);
  doc.text(`Bank Name  : ${qBank.bankName}`, SAFE_MARGIN + 2.5, ty + 15);
  doc.text(`A/C No     : ${qBank.accountNo}`, SAFE_MARGIN + 2.5, ty + 19.8);
  doc.text(`IFSC Code  : ${qBank.ifsc} (${qBank.branch})`, SAFE_MARGIN + 2.5, ty + 24.4);

  // BOTTOM-RIGHT Company Stamp & Signature
  drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN, ty + 4.5, 29, 17);

  // Strict Email-Only Official Quotation Acceptance Box
  const accY = ty + 29;
  const accH = 34;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.rect(SAFE_MARGIN, accY, cw, accH);
  doc.setFillColor(241, 245, 249);
  doc.rect(SAFE_MARGIN, accY, cw, 6.2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.1);
  doc.setTextColor(15, 76, 129);
  doc.text(
    'OFFICIAL QUOTATION ACCEPTANCE FORM (RETURN ACCEPTED ONLY VIA OFFICIAL EMAIL)',
    pw / 2,
    accY + 4.3,
    { align: 'center' }
  );

  doc.setFontSize(7.4);
  doc.setTextColor(180, 25, 25);
  doc.text(
    `STRICT RULE: Signed & stamped acceptance must be emailed ONLY to ${company.email || 'drc.kolkata1@gmail.com'} — Acceptance via WhatsApp / SMS is NOT valid.`,
    SAFE_MARGIN + 2.5,
    accY + 11.2
  );

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.text('Payment Responsible / Guarantor :', SAFE_MARGIN + 2.5, accY + 17.5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    quote.guarantorName
      ? `${quote.guarantorName}${quote.guarantorPhone ? `   |   Mob: ${quote.guarantorPhone}` : ''}`
      : '________________________________________________',
    SAFE_MARGIN + 2.5,
    accY + 22.5
  );
  doc.text('Acceptance Date : ____ / ____ / 20____', SAFE_MARGIN + 2.5, accY + 29.5);

  const stampBoxW = cw * 0.36;
  const stampBoxX = SAFE_MARGIN + cw - stampBoxW - 2.5;
  doc.setDrawColor(100, 116, 139);
  doc.rect(stampBoxX, accY + 13.5, stampBoxW, 18.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('Customer Stamp & Signature (Signatory)', stampBoxX + stampBoxW / 2, accY + 30.2, {
    align: 'center',
  });

  const ny = accY + accH + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.9);
  doc.setTextColor(15, 23, 42);
  const legalLines = doc.splitTextToSize(`Notice: ${LEGAL_SHIELD_NOTICE}`, cw);
  const customTermLines = company.quotationCustomTerms
    ? doc.splitTextToSize(company.quotationCustomTerms, cw)
    : [];
  const notices = [
    ...legalLines,
    ...customTermLines,
    'Detention beyond free time (Rs.1000/day) & Border Pass borne separately. Balance within agreed credit period (max 45d MSMED).',
  ];
  notices.forEach((line, idx) => {
    if (ny + idx * 4 < ph - 8) {
      doc.text(line, SAFE_MARGIN, ny + idx * 4);
    }
  });

  // PAGE 2: IRREVOCABLE PAYMENT GUARANTEE & LEGAL UNDERTAKING BOND (with dual Stamp & Signature boxes)
  doc.addPage();
  drawCenteredWatermark(doc, assets, 'LEGAL UNDERTAKING BOND');
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.55);
  doc.rect(SAFE_MARGIN, SAFE_MARGIN, cw, ph - SAFE_MARGIN * 2);

  drawTopLeftLogo(doc, assets, SAFE_MARGIN + 3, SAFE_MARGIN + 3, 20, 20);

  doc.setFillColor(13, 71, 161);
  doc.rect(SAFE_MARGIN + 26, SAFE_MARGIN + 3.5, cw - 29, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(255, 255, 255);
  doc.text('IRREVOCABLE PAYMENT GUARANTEE & LEGAL UNDERTAKING BOND', SAFE_MARGIN + 26 + (cw - 29) / 2, SAFE_MARGIN + 10, {
    align: 'center',
  });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `Ref Quotation No: ${quote.quotationNo || '-'}   |   Date: ${formatDateDDMMYYYY(quote.quotationDate)}   |   Carrier GSTIN: ${company.gstin}`,
    SAFE_MARGIN + 26,
    SAFE_MARGIN + 18.5
  );
  doc.text(
    `Carrier: ${company.companyName || 'DOLPHIN ROAD CARRIER'}   |   Official Email: ${company.email || 'drc.kolkata1@gmail.com'}`,
    SAFE_MARGIN + 26,
    SAFE_MARGIN + 23
  );
  doc.line(SAFE_MARGIN, SAFE_MARGIN + 26.5, pw - SAFE_MARGIN, SAFE_MARGIN + 26.5);

  let by = SAFE_MARGIN + 33;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.text(`EXECUTED BY CONSIGNOR / BILLING PARTY / PAYMENT GUARANTOR:`, SAFE_MARGIN + 4, by);
  by += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.text(`M/S: ${quote.partyName || 'PARTY'}   |   GSTIN: ${quote.partyGstin || '-'}`, SAFE_MARGIN + 4, by);
  by += 5;
  doc.text(`Address: ${quote.partyAddress || '-'}`, SAFE_MARGIN + 4, by);
  by += 5;
  doc.text(
    `Authorised Payment Guarantor: ${quote.guarantorName || 'Authorised Signatory'}${quote.guarantorPhone ? ` (Mob: ${quote.guarantorPhone})` : ''}   |   Route: ${quote.destination || '-'}   |   Agreed Freight: Rs. ${formatINR(quote.freight || 0)}`,
    SAFE_MARGIN + 4,
    by
  );

  by += 8;
  const bondClauses: Array<[string, string]> = [
    [
      '1. IRREVOCABLE & UNCONDITIONAL PAYMENT GUARANTEE:',
      'The Undersigned Party and Payment Guarantor jointly and severally undertake an irrevocable, unconditional obligation to pay 100% of freight, loading/unloading, detention, green tax/toll, and GST invoices strictly without deduction, set-off, counterclaim, or withholding.',
    ],
    [
      '2. MSMED ACT 2006 & MAX 45-DAY STATUTORY CREDIT LIMIT:',
      'Payment must be cleared within the agreed credit period and strictly not exceeding 45 days as mandated under the MSMED Act 2006 (Sec 15 & 16). Delayed payments attract compound interest at 18% p.a. (or 3x RBI Bank Rate) without further demand.',
    ],
    [
      '3. OWNER RISK & MANDATORY TRANSIT INSURANCE (CARRIAGE BY ROAD ACT 2007 SEC 10 & 17):',
      "Consignor/Party must arrange valid Transit/Material Insurance before dispatch. Goods are carried strictly at Owner's Risk under the Carriage by Road Act 2007 Sec 10 & Sec 17. Carrier is not liable for leakage, breakage, wet damage, pilferage, accident, or inherent vice.",
    ],
    [
      '4. FORCE MAJEURE & OFFICIAL EMAIL ACCEPTANCE LOCK:',
      `Carrier is exempt from Force Majeure delays (strikes, floods, riots, border/RTO blockades, highway closures). Any rate revision or acceptance is valid ONLY via official email (${company.email || 'drc.kolkata1@gmail.com'}).`,
    ],
    [
      '5. KOLKATA EXCLUSIVE JURISDICTION:',
      'All disputes, recovery proceedings, cheque dishonour (NI Act Sec 138), and arbitration arising out of this Undertaking Bond and connected Consignment Notes / Invoices are subject strictly to the exclusive jurisdiction of Courts at Kolkata, West Bengal.',
    ],
  ];

  bondClauses.forEach(([heading, body]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(13, 71, 161);
    doc.text(heading, SAFE_MARGIN + 4, by);
    by += 4.3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.7);
    doc.setTextColor(15, 23, 42);
    const wrapped = doc.splitTextToSize(body, cw - 8);
    doc.text(wrapped, SAFE_MARGIN + 4, by);
    by += wrapped.length * 3.9 + 3.2;
  });

  // Dual Signature & Stamp Boxes at bottom of Page 2
  const sigBoxY = Math.max(by + 4, ph - SAFE_MARGIN - 42);
  const sigBoxH = 34;
  const sigBoxW = (cw - 14) / 2;
  const leftSigX = SAFE_MARGIN + 4;
  const rightSigX = SAFE_MARGIN + cw - 4 - sigBoxW;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.rect(leftSigX, sigBoxY, sigBoxW, sigBoxH);
  doc.setFillColor(248, 250, 252);
  doc.rect(leftSigX, sigBoxY, sigBoxW, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(15, 23, 42);
  doc.text('AUTHORIZED PARTY / GUARANTOR SIGN & STAMP', leftSigX + sigBoxW / 2, sigBoxY + 4.2, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`M/S: ${String(quote.partyName || '').slice(0, 32)}`, leftSigX + 2.5, sigBoxY + 11);
  doc.text(`Guarantor: ${String(quote.guarantorName || '____________________').slice(0, 26)}`, leftSigX + 2.5, sigBoxY + 16);
  doc.text('Date & Place: _______________________', leftSigX + 2.5, sigBoxY + 28);
  doc.setFont('helvetica', 'bold');
  doc.text('Signatory Signature & Company Seal / Stamp', leftSigX + sigBoxW / 2, sigBoxY + 32.2, {
    align: 'center',
  });

  doc.rect(rightSigX, sigBoxY, sigBoxW, sigBoxH);
  doc.setFillColor(241, 245, 249);
  doc.rect(rightSigX, sigBoxY, sigBoxW, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(13, 71, 161);
  doc.text(`FOR ${(company.companyName || 'DOLPHIN ROAD CARRIER').slice(0, 28)}`, rightSigX + sigBoxW / 2, sigBoxY + 4.2, {
    align: 'center',
  });
  drawBottomRightStampAndSign(doc, assets, rightSigX + sigBoxW - 3, sigBoxY + 8, 28, 16);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(7);
  doc.text('Authorised Signatory & Carrier Stamp', rightSigX + sigBoxW / 2, sigBoxY + 32.2, {
    align: 'center',
  });

  stampAllPageNumbers(doc);

  const quoteDateTag = formatDateHyphenDDMMYYYY(quote.quotationDate || todayISO());
  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(quote.partyName || 'Party')}_Quotation_${quoteDateTag}.pdf`,
    title: `Rate Quotation - ${quote.quotationNo}`,
    orientation,
  };
}

// ============================================================================
// 4. SECTION 194C DECLARATION
//    TOP-LEFT Royal Blue Dolphin Ring + D.R.C Logo
//    Bottom-Left: Place/Date + Embedded Proprietor PAN Card Image
//    Bottom-Right: Declarant Details (Subhajit Saha Proprietor) + Round Seal & Signature
// ============================================================================

function buildDeclaration194CDoc(
  decl: Declaration194C,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'p'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const pw = doc.internal.pageSize.getWidth();
  const cw = pw - SAFE_MARGIN * 2;
  const fy = decl.financialYear || getDynamicFinancialYear(decl.declarationDate);

  drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');

  // TOP-LEFT Royal Blue Dolphin Ring + D.R.C Logo
  drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 23, 23);

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  const divLabel =
    decl.division && decl.division !== 'FTL'
      ? ` (${String(decl.division).toUpperCase()} DIVISION)`
      : '';
  doc.text(`${company.companyName || 'DOLPHIN ROAD CARRIER'}${divLabel}`, SAFE_MARGIN + 27, SAFE_MARGIN + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(company.address || '', SAFE_MARGIN + 27, SAFE_MARGIN + 13.5);
  doc.text(`E-mail:- ${company.email || ''}   |   Mob: ${company.phones || ''}`, SAFE_MARGIN + 27, SAFE_MARGIN + 18.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DECLARATION UNDER SECTION 194C(6) & SECTION 194C(7) OF THE INCOME-TAX ACT, 1961', pw / 2, SAFE_MARGIN + 32, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.3);
  doc.text(
    `Carrier PAN: ${company.pan || 'DOTPS3540M'}   |   Carrier GSTIN: ${company.gstin || '19DOTPS3540M1ZZ'}   |   Financial Year: ${fy}`,
    pw / 2,
    SAFE_MARGIN + 37,
    { align: 'center' }
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('To,', SAFE_MARGIN, SAFE_MARGIN + 43);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(10.5);
  doc.text((decl.partyName || 'PARTY').toUpperCase(), SAFE_MARGIN + 2, SAFE_MARGIN + 49);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const addrLines = doc.splitTextToSize(decl.partyAddress || '-', cw * 0.8);
  doc.text(addrLines.slice(0, 2), SAFE_MARGIN + 2, SAFE_MARGIN + 54);
  doc.text(`GSTIN :- ${decl.partyGstin || '-'}`, SAFE_MARGIN + 2, SAFE_MARGIN + 64);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('DECLARATION', pw / 2, SAFE_MARGIN + 75, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const intro = doc.splitTextToSize(
    `I, Subhajit Saha, Proprietor of M/S ${company.companyName} (Carrier PAN: ${company.pan || 'DOTPS3540M'}, GSTIN: ${company.gstin || '19DOTPS3540M1ZZ'}) do hereby make this statutory declaration under Sub-section (6) & Sub-section (7) of Section 194C of the Income Tax Act 1961 for receiving payments from the payer without deduction of tax at source :-`,
    cw - 4
  );
  doc.text(intro, SAFE_MARGIN + 2, SAFE_MARGIN + 84);

  const clauses = [
    '1. That we are authorized to make this declaration in the capacity of proprietor.',
    '2. That the contractor is engaged by the payer for plying, hiring or leasing of goods carriages for its business.',
    '3. That the contractor does not own more than ten goods carriages (as specified under Section 194C(6) & Section 194C(7) of the Income-Tax Act 1961) as on date.',
    `4. That if the number of goods carriages owned by the contractor exceeds ten at any time during the financial year ${fy}, the contractor shall forthwith intimate the payer in writing.`,
    `5. That the Income-Tax PAN (${company.pan || 'DOTPS3540M'}) & GSTIN (${company.gstin || '19DOTPS3540M1ZZ'}) of Contractor are furnished below along with this declaration.`,
    ...(company.declarationCustomTerms ? [`6. ${company.declarationCustomTerms}`] : []),
  ];

  let cy = SAFE_MARGIN + 100;
  clauses.forEach((c) => {
    const wrapped = doc.splitTextToSize(c, cw - 8);
    doc.text(wrapped, SAFE_MARGIN + 4, cy);
    cy += wrapped.length * 4.7 + 2.0;
  });

  doc.setFont('helvetica', 'bold');
  doc.text('VERIFICATION', pw / 2, cy + 4, { align: 'center' });
  doc.line(pw / 2 - 14, cy + 5, pw / 2 + 14, cy + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  const verif = doc.splitTextToSize(
    'I THE ABOVE NAMED DECLARANT DO HEREBY VERIFY THAT THE CONTENTS OF PARAGRAPHS ONE TO FIVE ABOVE ARE TRUE OF MY OWN KNOWLEDGE AND BELIEF AND NO PART OF IT IS FALSE AND NOTHING MATERIAL HAS BEEN CONCEALED IN IT.',
    cw - 4
  );
  doc.text(verif, SAFE_MARGIN + 2, cy + 12);

  const footerY = cy + 28;
  doc.setFontSize(9.2);
  doc.text(`Place : ${decl.place || 'Kolkata'}`, SAFE_MARGIN + 2, footerY);
  doc.text(`Date  : ${formatDateDDMMYYYY(decl.declarationDate)}`, SAFE_MARGIN + 2, footerY + 5.5);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Enclosed: Proprietor PAN Card Copy (u/s 194C(6))', SAFE_MARGIN + 2, footerY + 11.5);
  doc.setTextColor(15, 23, 42);

  // Embedded Proprietor PAN Card Image on the bottom-left below Place/Date
  const panBoxX = SAFE_MARGIN + 2;
  const panBoxY = footerY + 15;
  if (assets.panCropDataUrl) {
    doc.addImage(
      assets.panCropDataUrl,
      getJsPdfImageFormat(assets.panCropDataUrl),
      panBoxX,
      panBoxY,
      58,
      35,
      undefined,
      'FAST'
    );
  } else {
    doc.rect(panBoxX, panBoxY, 58, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('INCOME TAX DEPARTMENT - INDIA', panBoxX + 3, panBoxY + 9);
    doc.text('SUBHAJIT SAHA', panBoxX + 3, panBoxY + 16);
    doc.text(`PAN: ${company.pan}`, panBoxX + 3, panBoxY + 23);
  }

  // Bottom-Right Declarant Details + Proprietor Signature & Round Seal
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('DECLARANT DETAILS', pw - SAFE_MARGIN - 32, footerY, { align: 'center' });
  doc.text('SUBHAJIT SAHA (Proprietor)', pw - SAFE_MARGIN - 32, footerY + 5.5, { align: 'center' });
  doc.text(`PAN NO : ${company.pan}`, pw - SAFE_MARGIN - 32, footerY + 11, { align: 'center' });
  drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN - 2, footerY + 18, 34, 21);

  stampAllPageNumbers(doc);

  const declDateTag = formatDateHyphenDDMMYYYY(decl.declarationDate || todayISO());
  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(decl.partyName || 'Party')}_Declaration_${declDateTag}.pdf`,
    title: `Section 194C Declaration - ${decl.partyName || 'Party'}`,
    orientation,
  };
}

// ============================================================================
// 5. MULTI-PAGE TABLE REPORTS (Supports Both Portrait & Landscape)
// ============================================================================

function buildTableReportDoc(params: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  company: CompanySettings;
  fileName: string;
  orientation?: PdfOrientation;
  assets: PdfAssets;
}) {
  const { title, subtitle, headers, rows, company, fileName, assets } = params;
  const orientation: PdfOrientation = params.orientation || 'l';
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - SAFE_MARGIN * 2;
  const ROWS_PER_PAGE = orientation === 'l' ? 21 : 32;
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) doc.addPage();
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');

    drawTopLeftLogo(doc, assets, SAFE_MARGIN, 8, 15, 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(13, 71, 161);
    doc.text(company.companyName, SAFE_MARGIN + 19, 13.5);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(`${title} — ${subtitle}`, SAFE_MARGIN + 19, 19.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Page ${p + 1} of ${totalPages}`, pw - SAFE_MARGIN, 13.5, { align: 'right' });

    const colWidth = cw / Math.max(1, headers.length);
    let y = 27;
    doc.setFillColor(13, 71, 161);
    doc.rect(SAFE_MARGIN, y, cw, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    headers.forEach((h, i) => {
      doc.text(h.slice(0, 22), SAFE_MARGIN + 2 + i * colWidth, y + 4.8);
    });

    y += 10.5;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);

    const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    slice.forEach((row, rIdx) => {
      if (rIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(SAFE_MARGIN, y - 4, cw, 6, 'F');
      }
      row.forEach((cell, cIdx) => {
        doc.text(String(cell ?? '').slice(0, 28), SAFE_MARGIN + 2 + cIdx * colWidth, y);
      });
      y += 6.2;
    });

    if (p === totalPages - 1 && y + 26 < ph - 10) {
      drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN, ph - 32, 26, 15);
    }
  }

  stampAllPageNumbers(doc);

  return {
    buffer: doc.output('arraybuffer'),
    fileName,
    title,
    orientation,
  };
}

// ============================================================================
// 6. FOXPRO-STYLE "G-S-T R-E-G-I-S-T-E-R" (Two-Line Rows + TOTAL IN RUPEES)
// ============================================================================

function buildGstRegisterDoc(
  invoices: Invoice[],
  subtitle: string,
  company: CompanySettings,
  fileName: string,
  assets: PdfAssets,
  orientation: PdfOrientation = 'l'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const M = BILL_MARGIN; // Equal 8mm borders
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;
  const ch = ph - M * 2;

  // 8 Columns totaling 100% width:
  // S.NO (5%) | BILL NO / BL. DATE (14%) | PARTY NAME / GSTIN (26%) | FREIGHT CHARGES (11%) |
  // TAXABLE VALUE (11%) | SGST AMT / CGST AMT (11%) | IGST AMT / TOT GST (11%) | TOTAL AMOUNT (11%)
  const colEdges = [0, 0.05, 0.19, 0.45, 0.56, 0.67, 0.78, 0.89, 1.0];
  const colX = (i: number) => M + cw * colEdges[i];

  const drawHeader = () => {
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(M, M, cw, ch);

    drawTopLeftLogo(doc, assets, M + 2.5, M + 2, 16, 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(13, 71, 161);
    doc.text(company.companyName || 'DOLPHIN ROAD CARRIER', pw / 2, M + 7, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text(`${company.address}   |   GSTIN: ${company.gstin}   |   PAN: ${company.pan}`, pw / 2, M + 11.5, {
      align: 'center',
    });

    doc.setFont('courier', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('G-S-T   R-E-G-I-S-T-E-R', pw / 2, M + 17.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(subtitle, pw / 2, M + 21.8, { align: 'center' });

    const hdrY = M + 24;
    const hdrH = 8.5;
    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.rect(M, hdrY, cw, hdrH, 'FD');
    for (let i = 1; i < colEdges.length - 1; i++) {
      doc.line(colX(i), hdrY, colX(i), hdrY + hdrH);
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(6.9);
    doc.setTextColor(15, 23, 42);
    doc.text('S.NO', (colX(0) + colX(1)) / 2, hdrY + 5.2, { align: 'center' });

    doc.text('BILL NO', colX(1) + 1.5, hdrY + 3.6);
    doc.text('BL. DATE', colX(1) + 1.5, hdrY + 7.2);

    doc.text('PARTY NAME', colX(2) + 1.5, hdrY + 3.6);
    doc.text('GSTIN / COUNTRY', colX(2) + 1.5, hdrY + 7.2);

    doc.text('FREIGHT', colX(4) - 1.5, hdrY + 3.6, { align: 'right' });
    doc.text('CHARGES', colX(4) - 1.5, hdrY + 7.2, { align: 'right' });

    doc.text('TAXABLE', colX(5) - 1.5, hdrY + 3.6, { align: 'right' });
    doc.text('VALUE', colX(5) - 1.5, hdrY + 7.2, { align: 'right' });

    doc.text('SGST AMT', colX(6) - 1.5, hdrY + 3.6, { align: 'right' });
    doc.text('CGST AMT', colX(6) - 1.5, hdrY + 7.2, { align: 'right' });

    doc.text('IGST AMT', colX(7) - 1.5, hdrY + 3.6, { align: 'right' });
    doc.text('TOT GST', colX(7) - 1.5, hdrY + 7.2, { align: 'right' });

    doc.text('TOTAL', colX(8) - 1.5, hdrY + 3.6, { align: 'right' });
    doc.text('AMOUNT', colX(8) - 1.5, hdrY + 7.2, { align: 'right' });

    return hdrY + hdrH;
  };

  let curY = drawHeader();
  const rowH = 9.5;
  const maxY = ph - M - 24;

  let sumFreight = 0;
  let sumTaxable = 0;
  let sumSgst = 0;
  let sumCgst = 0;
  let sumIgst = 0;
  let sumTotGst = 0;
  let sumTotalAmt = 0;

  invoices.forEach((inv, idx) => {
    if (curY + rowH > maxY) {
      doc.addPage();
      curY = drawHeader();
    }

    const freight = Number(inv.freightCharges || 0);
    const extras =
      Number(inv.detentionCharges || 0) +
      Number(inv.unloadingCharges || 0) +
      Number(inv.stCharges || 0);
    const taxable = freight + extras;
    const sgst = Number(inv.sgstAmt || 0);
    const cgst = Number(inv.cgstAmt || 0);
    const igst = Number(inv.igstAmt || 0);
    const totGst = Number(inv.totalTax || 0);
    const grandTotal = Number(inv.grandTotal || 0);

    sumFreight += freight;
    sumTaxable += taxable;
    sumSgst += sgst;
    sumCgst += cgst;
    sumIgst += igst;
    sumTotGst += totGst;
    sumTotalAmt += grandTotal;

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, curY, cw, rowH, 'F');
    }

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.line(M, curY + rowH, M + cw, curY + rowH);
    for (let i = 1; i < colEdges.length - 1; i++) {
      doc.line(colX(i), curY, colX(i), curY + rowH);
    }

    const y1 = curY + 3.9;
    const y2 = curY + 7.9;
    doc.setTextColor(15, 23, 42);

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.2);
    doc.text(`${idx + 1}`, (colX(0) + colX(1)) / 2, y1 + 1.5, { align: 'center' });

    doc.text(String(inv.invoiceNo || '-').slice(0, 20), colX(1) + 1.5, y1);
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.8);
    doc.text(formatDateDDMMYYYY(inv.invoiceDate) || '-', colX(1) + 1.5, y2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    doc.text(String(inv.partyName || '-').slice(0, 38), colX(2) + 1.5, y1);
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.7);
    const gstIdLine =
      inv.billingCountry && inv.billingCountry !== 'India'
        ? `${inv.billingCountry.toUpperCase()} (EXPORT 0%) PAN:${inv.partyPan || '-'}`
        : `${inv.partyGstin || 'UNREGISTERED'} | ${inv.gstPaidBy || (inv.reverseCharge ? 'Consignee' : 'Transporter')}`;
    doc.text(gstIdLine.slice(0, 40), colX(2) + 1.5, y2);

    doc.setFont('courier', 'normal');
    doc.setFontSize(7.2);
    doc.text(formatINR(freight), colX(4) - 1.5, y1, { align: 'right' });
    if (extras > 0) {
      doc.setFontSize(6.4);
      doc.text(`+${formatINR(extras)}`, colX(4) - 1.5, y2, { align: 'right' });
    }

    doc.setFontSize(7.2);
    doc.text(formatINR(taxable), colX(5) - 1.5, y1, { align: 'right' });
    doc.setFontSize(6.4);
    doc.text(`${Number(inv.gstRate ?? 5)}%`, colX(5) - 1.5, y2, { align: 'right' });

    doc.setFontSize(7.1);
    doc.text(formatINR(sgst), colX(6) - 1.5, y1, { align: 'right' });
    doc.text(formatINR(cgst), colX(6) - 1.5, y2, { align: 'right' });

    doc.text(formatINR(igst), colX(7) - 1.5, y1, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.text(formatINR(totGst), colX(7) - 1.5, y2, { align: 'right' });

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.4);
    doc.text(formatINR(grandTotal), colX(8) - 1.5, y1, { align: 'right' });
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    doc.text(String(inv.status || 'Unpaid').toUpperCase(), colX(8) - 1.5, y2, { align: 'right' });

    curY += rowH;
  });

  // Grand Total Footer: "TOTAL IN RUPEES :"
  if (curY + 26 > ph - M - 4) {
    doc.addPage();
    curY = drawHeader();
  }

  const totH = 11.5;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.rect(M, curY, cw, totH, 'FD');
  for (let i = 3; i < colEdges.length - 1; i++) {
    doc.line(colX(i), curY, colX(i), curY + totH);
  }

  doc.setFont('courier', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(13, 71, 161);
  doc.text('TOTAL IN RUPEES :', colX(3) - 3, curY + 7, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(7.2);
  doc.text(formatINR(sumFreight), colX(4) - 1.5, curY + 5, { align: 'right' });
  doc.text(formatINR(sumTaxable), colX(5) - 1.5, curY + 5, { align: 'right' });

  doc.text(`S:${formatINR(sumSgst)}`, colX(6) - 1.5, curY + 4.2, { align: 'right' });
  doc.text(`C:${formatINR(sumCgst)}`, colX(6) - 1.5, curY + 9.0, { align: 'right' });

  doc.text(`I:${formatINR(sumIgst)}`, colX(7) - 1.5, curY + 4.2, { align: 'right' });
  doc.text(`T:${formatINR(sumTotGst)}`, colX(7) - 1.5, curY + 9.0, { align: 'right' });

  doc.setFontSize(7.8);
  doc.text(formatINR(sumTotalAmt), colX(8) - 1.5, curY + 6.8, { align: 'right' });

  const wordsY = curY + totH + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text(amountToIndianWords(sumTotalAmt), M + 2, wordsY);

  if (wordsY + 18 < ph - M) {
    drawBottomRightStampAndSign(doc, assets, M + cw - 2, wordsY + 1, 25, 14);
  }

  stampAllPageNumbers(doc, `G-S-T R-E-G-I-S-T-E-R — ${company.companyName}`, M, 3.8);

  return {
    buffer: doc.output('arraybuffer'),
    fileName,
    title: 'G-S-T R-E-G-I-S-T-E-R',
    orientation,
  };
}

// ============================================================================
// 7. FOXPRO-STYLE STATEMENTS & MASTER REGISTER / PROFILE SHEETS
// ============================================================================

function buildFoxproStatementDoc(
  spec: FoxproStatementSpec,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'l'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const M = BILL_MARGIN;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;
  const ch = ph - M * 2;

  const totalPct = spec.columns.reduce((s, c) => s + c.widthPct, 0) || 100;
  const edges: number[] = [0];
  let acc = 0;
  spec.columns.forEach((c) => {
    acc += c.widthPct / totalPct;
    edges.push(acc);
  });
  const colX = (i: number) => M + cw * edges[i];

  const drawHeader = () => {
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(M, M, cw, ch);

    drawTopLeftLogo(doc, assets, M + 2.5, M + 2, 16, 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(13, 71, 161);
    doc.text(company.companyName || 'DOLPHIN ROAD CARRIER', pw / 2, M + 6.8, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.setTextColor(30, 41, 59);
    doc.text(`${company.address}   |   PH: ${company.phones}   |   GSTIN: ${company.gstin}`, pw / 2, M + 11.2, {
      align: 'center',
    });

    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(spec.title, pw / 2, M + 16.8, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.text(spec.subtitle, pw / 2, M + 21, { align: 'center' });

    let yTop = M + 23;

    if (spec.summaryLines && spec.summaryLines.length > 0) {
      const colsPerRow = orientation === 'l' ? 3 : 2;
      const boxRows = Math.ceil(spec.summaryLines.length / colsPerRow);
      const boxH = boxRows * 5.2 + 3;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.3);
      doc.rect(M, yTop, cw, boxH, 'FD');

      const cellW = cw / colsPerRow;
      spec.summaryLines.forEach((item, idx) => {
        const r = Math.floor(idx / colsPerRow);
        const c = idx % colsPerRow;
        const bx = M + c * cellW + 2.5;
        const by = yTop + 4.4 + r * 5.2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.9);
        doc.text(`${item.label}:`, bx, by);
        doc.setFont('helvetica', 'normal');
        doc.text(String(item.value || '-').slice(0, 38), bx + 25, by);
      });
      yTop += boxH + 1.5;
    }

    const hdrH = 7.5;
    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.rect(M, yTop, cw, hdrH, 'FD');
    for (let i = 1; i < edges.length - 1; i++) {
      doc.line(colX(i), yTop, colX(i), yTop + hdrH);
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(6.9);
    doc.setTextColor(15, 23, 42);
    spec.columns.forEach((col, i) => {
      const align = col.align || 'left';
      const tx =
        align === 'right'
          ? colX(i + 1) - 1.5
          : align === 'center'
          ? (colX(i) + colX(i + 1)) / 2
          : colX(i) + 1.5;
      doc.text(col.label, tx, yTop + 5, { align });
    });

    return yTop + hdrH;
  };

  let curY = drawHeader();
  const maxY = ph - M - 24;

  if (spec.rows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.text('No matching records for the selected criteria.', pw / 2, curY + 12, { align: 'center' });
    curY += 18;
  }

  spec.rows.forEach((row, idx) => {
    const hasLine2 = Boolean(row.line2 && row.line2.some((v) => v && v.trim() !== ''));
    const rowH = hasLine2 ? 9.2 : 6.2;

    if (curY + rowH > maxY) {
      doc.addPage();
      curY = drawHeader();
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, curY, cw, rowH, 'F');
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(M, curY + rowH, M + cw, curY + rowH);
    for (let i = 1; i < edges.length - 1; i++) {
      doc.line(colX(i), curY, colX(i), curY + rowH);
    }

    spec.columns.forEach((col, cIdx) => {
      const align = col.align || 'left';
      const tx =
        align === 'right'
          ? colX(cIdx + 1) - 1.5
          : align === 'center'
          ? (colX(cIdx) + colX(cIdx + 1)) / 2
          : colX(cIdx) + 1.5;

      const maxChars = Math.max(8, Math.floor(((edges[cIdx + 1] - edges[cIdx]) * cw) / 1.55));
      doc.setFont('helvetica', cIdx === 0 || align === 'right' ? 'bold' : 'normal');
      doc.setFontSize(7.0);
      doc.setTextColor(15, 23, 42);
      doc.text(String(row.line1[cIdx] ?? '').slice(0, maxChars), tx, curY + 4.1, { align });

      if (hasLine2 && row.line2?.[cIdx]) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(71, 85, 105);
        doc.text(String(row.line2[cIdx]).slice(0, maxChars), tx, curY + 7.9, { align });
      }
    });

    curY += rowH;
  });

  if (spec.totalsLine1 && spec.totalsLine1.length > 0) {
    const hasTot2 = Boolean(spec.totalsLine2 && spec.totalsLine2.some(Boolean));
    const totH = hasTot2 ? 10.5 : 8;
    if (curY + totH + 18 > ph - M) {
      doc.addPage();
      curY = drawHeader();
    }

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.45);
    doc.rect(M, curY, cw, totH, 'FD');
    for (let i = 1; i < edges.length - 1; i++) {
      doc.line(colX(i), curY, colX(i), curY + totH);
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(13, 71, 161);
    if (spec.totalsLabel) {
      doc.text(spec.totalsLabel, M + 2, curY + 5.2);
    }
    doc.setTextColor(15, 23, 42);
    spec.columns.forEach((col, cIdx) => {
      const val1 = spec.totalsLine1?.[cIdx];
      if (!val1) return;
      const align = col.align || 'left';
      const tx =
        align === 'right'
          ? colX(cIdx + 1) - 1.5
          : align === 'center'
          ? (colX(cIdx) + colX(cIdx + 1)) / 2
          : colX(cIdx) + 1.5;
      doc.text(val1, tx, curY + (hasTot2 ? 4.3 : 5.3), { align });
      if (hasTot2 && spec.totalsLine2?.[cIdx]) {
        doc.setFontSize(6.6);
        doc.text(spec.totalsLine2[cIdx], tx, curY + 8.6, { align });
        doc.setFontSize(7.4);
      }
    });

    curY += totH + 4.5;
    if (typeof spec.totalAmountForWords === 'number') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.3);
      doc.text(amountToIndianWords(spec.totalAmountForWords), M + 2, curY);
      curY += 5;
    }
  }

  if (spec.legalNotice) {
    const noticeW = cw - 36;
    const noticeLines = doc.splitTextToSize(spec.legalNotice, noticeW - 4);
    const noticeH = Math.max(10, noticeLines.length * 3.8 + 4.5);
    if (curY + noticeH + 4 > ph - M) {
      doc.addPage();
      curY = drawHeader();
    }
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(185, 28, 28);
    doc.setLineWidth(0.35);
    doc.rect(M + 2, curY, noticeW - 2, noticeH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.9);
    doc.setTextColor(153, 27, 27);
    doc.text(noticeLines, M + 4, curY + 4.5);
    doc.setTextColor(15, 23, 42);
  }

  if (curY + 20 < ph - M) {
    drawBottomRightStampAndSign(doc, assets, M + cw - 2, Math.max(curY + 2, ph - M - 22), 24, 14);
  }

  stampAllPageNumbers(doc, `${spec.title} — ${company.companyName}`, M, 3.8);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: spec.fileName,
    title: spec.title,
    orientation,
  };
}

// ============================================================================
// 8. LOGISTICS DIVISION PDF GENERATORS (PARCEL DOCKET, LINE-HAUL MANIFEST, INVOICE/CN/DN)
// ============================================================================

function logisticsDocketToConsignmentNote(
  docket: LogisticsDocket,
  company: CompanySettings
): ConsignmentNote {
  const div = docket.division || getLogisticsDivisionFromId(docket.id);
  const taxAmt =
    Number(docket.cgstAmt || 0) + Number(docket.sgstAmt || 0) + Number(docket.igstAmt || 0);
  const deliverNote =
    docket.deliveryMode === 'Door Delivery'
      ? `${docket.destBranch} (Door Delivery)`
      : `${docket.destBranch} (Godown Delivery)`;
  return {
    id: docket.id,
    cnNo: docket.docketNo,
    cnDate: docket.docketDate,
    financialYear: docket.financialYear,
    division: div,
    billedAtBranch: docket.billedAtBranch || docket.originBranch,
    deliveryOffice: docket.destBranch,
    deliverAt: deliverNote,
    billingPartyName: docket.billingPartyName || docket.consignorName,
    consignorName: docket.consignorName,
    consignorAddress: docket.consignorAddress,
    consignorPinCode: docket.consignorPinCode,
    consignorCountry: docket.consignorCountry,
    consignorGstin: docket.consignorGstin,
    consigneeName: docket.consigneeName,
    consigneeAddress: docket.consigneeAddress,
    consigneePinCode: docket.consigneePinCode,
    consigneeCountry: docket.consigneeCountry,
    consigneeGstin: docket.consigneeGstin,
    packages: String(docket.packages ?? ''),
    packageMode: docket.packingType || 'Cartons/Pkg',
    particulars: docket.goodsDesc,
    rateMode: docket.rateBasis,
    ratePerUnit: docket.ratePerUnit,
    nettWeight: docket.actualWeightKg,
    grossWeight: docket.actualWeightKg,
    chargedWeight: docket.chargedWeightKg,
    loadingCharge: docket.hamaliCharge || 0,
    unloadingCharge: docket.doorCharge || 0,
    sttCharge: docket.docketCharge || 0,
    otherCharge: (docket.fovCharge || 0) + taxAmt,
    totalFreight: docket.totalAmount,
    showFreightOnPrint: true,
    paidAmount: docket.payMode === 'Paid' ? docket.totalAmount : 0,
    toPayAmount: docket.payMode === 'To-Pay' ? docket.totalAmount : 0,
    payBasis: docket.payMode,
    ewayBillNo: docket.ewayBillNo,
    ewayBillValidUpto: docket.ewayBillValidUpto,
    ewayPlace: docket.ewayPlace,
    ewayPinCode: docket.ewayPinCode,
    valueOfGoods: docket.valueOfGoods,
    truckNo: docket.manifestNo || 'HUB-DISPATCH',
    fromCity: docket.originBranch,
    fromPinCode: docket.originPinCode,
    fromCountry: docket.originCountry,
    toCity: docket.destBranch,
    toPinCode: docket.destPinCode,
    toCountry: docket.destCountry,
    deliveryModeCode: docket.deliveryMode === 'Door Delivery' ? 'D' : 'G',
    gstPaidBy: docket.reverseCharge ? 'Consignee' : 'Transporter',
    remarks: [
      docket.stockStage ? `Stage: ${docket.stockStage}` : '',
      docket.godownRack ? `Rack: ${docket.godownRack}` : '',
      docket.remarks || '',
    ]
      .filter(Boolean)
      .join(' | '),
    billed: docket.billed,
    branchCode: docket.branchCode || docket.originBranch || company.companyName,
    ownerUid: docket.ownerUid,
  };
}

function buildLogisticsDocketDoc(
  docket: LogisticsDocket,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'l'
) {
  return buildLR3CopyDoc(
    logisticsDocketToConsignmentNote(docket, company),
    company,
    assets,
    orientation
  );
}

function buildLogisticsManifestDoc(
  manifest: LogisticsManifest,
  dockets: LogisticsDocket[],
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'l'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const M = BILL_MARGIN;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;
  const ch = ph - M * 2;

  const drawManifestHeader = () => {
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.rect(M, M, cw, ch);
    drawTopLeftLogo(doc, assets, M + 2.5, M + 2, 16, 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(13, 71, 161);
    doc.text(`${company.companyName} — LINE-HAUL DISPATCH MANIFEST`, pw / 2, M + 7.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `Manifest No: ${manifest.manifestNo}   |   Date: ${formatDateDDMMYYYY(manifest.manifestDate)}   |   Route: ${manifest.fromBranch} -> ${manifest.toBranch}`,
      pw / 2,
      M + 12.5,
      { align: 'center' }
    );
    doc.text(
      `Truck: ${manifest.truckNo}   |   Driver: ${manifest.driverName || '-'} (${manifest.driverPhone || '-'})   |   Broker: ${manifest.brokerName || 'Direct'}   |   Status: ${manifest.status}`,
      pw / 2,
      M + 17,
      { align: 'center' }
    );

    const qrData = `DRC|MANIFEST|${manifest.manifestNo}|${manifest.manifestDate}|${manifest.fromBranch}->${manifest.toBranch}|TRUCK:${manifest.truckNo}|DOCKETS:${manifest.docketIds.length}`;
    drawVectorVerificationQr(doc, qrData, pw - M - 18, M + 2, 15, 'VERIFY QR');

    const hdrY = M + 23;
    const hdrH = 7.5;
    const colEdges = [0, 0.06, 0.21, 0.44, 0.67, 0.76, 0.85, 0.93, 1.0];
    const colX = (i: number) => M + cw * colEdges[i];

    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.rect(M, hdrY, cw, hdrH, 'FD');
    for (let i = 1; i < colEdges.length - 1; i++) {
      doc.line(colX(i), hdrY, colX(i), hdrY + hdrH);
    }

    const hdrs = ['S.NO', 'DOCKET / DATE', 'CONSIGNOR', 'CONSIGNEE / DEST', 'PKGS', 'WT (KG)', 'MODE', 'TO-PAY / AMT'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);
    hdrs.forEach((h, i) => {
      doc.text(h, colX(i) + 1.5, hdrY + 5);
    });

    return { curY: hdrY + hdrH, colEdges, colX };
  };

  const linkedSet = new Set(manifest.docketIds);
  const manifestDockets = dockets.filter((d) => linkedSet.has(d.id) || manifest.docketNos.includes(d.docketNo));
  let { curY, colEdges, colX } = drawManifestHeader();
  const maxY = ph - M - 30;
  const rowH = 7.8;

  manifestDockets.forEach((d, idx) => {
    if (curY + rowH > maxY) {
      doc.addPage();
      ({ curY, colEdges, colX } = drawManifestHeader());
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, curY, cw, rowH, 'F');
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(M, curY + rowH, M + cw, curY + rowH);
    for (let i = 1; i < colEdges.length - 1; i++) {
      doc.line(colX(i), curY, colX(i), curY + rowH);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.setTextColor(15, 23, 42);
    doc.text(`${idx + 1}`, colX(0) + 2, curY + 5.1);
    doc.setFont('helvetica', 'bold');
    doc.text(`${d.docketNo}`, colX(1) + 1.5, curY + 3.8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    doc.text(formatDateDDMMYYYY(d.docketDate), colX(1) + 1.5, curY + 6.9);
    doc.setFontSize(7.0);
    doc.text(String(d.consignorName || '-').slice(0, 30), colX(2) + 1.5, curY + 5.1);
    doc.text(`${String(d.consigneeName || '-').slice(0, 22)} (${d.destBranch})`, colX(3) + 1.5, curY + 5.1);
    doc.text(`${d.packages}`, colX(5) - 2, curY + 5.1, { align: 'right' });
    doc.text(`${Number(d.chargedWeightKg || 0).toFixed(1)}`, colX(6) - 2, curY + 5.1, { align: 'right' });
    doc.text(d.payMode, colX(6) + 1.5, curY + 5.1);
    doc.text(
      d.payMode === 'To-Pay' ? formatINR(d.totalAmount) : formatINR(d.totalAmount),
      colX(8) - 1.5,
      curY + 5.1,
      { align: 'right' }
    );
    curY += rowH;
  });

  if (curY + 28 > ph - M) {
    doc.addPage();
    ({ curY, colEdges, colX } = drawManifestHeader());
  }

  curY += 3;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(15, 23, 42);
  doc.rect(M, curY, cw * 0.65, 20, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.text(
    `Totals: ${manifestDockets.length} Dockets  |  ${manifest.totalPkgs} Packages  |  ${Number(manifest.totalWeightKg || 0).toFixed(1)} Kg  |  To-Pay Collection: Rs. ${formatINR(manifest.totalTopayAmount)}`,
    M + 3,
    curY + 7
  );
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Lorry Hire: Rs. ${formatINR(manifest.hireAmount)}   |   Advance Paid: Rs. ${formatINR(manifest.advancePaid)}   |   Balance Payable: Rs. ${formatINR(manifest.balancePayable)}`,
    M + 3,
    curY + 14.5
  );

  drawBottomRightStampAndSign(doc, assets, pw - M - 2, curY + 1, 25, 14);
  stampAllPageNumbers(doc, `LINE-HAUL MANIFEST — ${manifest.manifestNo}`, M, 3.8);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `Logistics_Manifest_${sanitizeFileName(manifest.manifestNo)}.pdf`,
    title: `Line-Haul Manifest - ${manifest.manifestNo}`,
    orientation,
  };
}

function logisticsInvoiceToInvoice(
  invoice: LogisticsInvoice,
  company: CompanySettings
): Invoice {
  const div = invoice.division || getLogisticsDivisionFromId(invoice.id);
  const totalTax =
    Number(invoice.cgstAmt || 0) + Number(invoice.sgstAmt || 0) + Number(invoice.igstAmt || 0);
  return {
    id: invoice.id,
    billId: invoice.docNo,
    invoiceNo: invoice.docNo,
    invoiceDate: invoice.docDate,
    financialYear: invoice.financialYear,
    division: div,
    docKind: invoice.docType,
    againstInvoiceNo: invoice.linkedDocNo,
    finalized: true,
    partyName: invoice.partyName,
    partyAddress: invoice.partyAddress,
    partyGstin: invoice.partyGstin,
    partyPan: invoice.partyPan,
    billingCountry: 'India',
    sac: invoice.sac || company.hsn || '996791',
    reverseCharge: Boolean(invoice.reverseCharge),
    interstate: Boolean(invoice.interstate),
    gstPaidBy: invoice.reverseCharge ? 'Consignee' : 'Transporter',
    gstRate: invoice.gstRate,
    cgstAmt: invoice.cgstAmt,
    sgstAmt: invoice.sgstAmt,
    igstAmt: invoice.igstAmt,
    totalTax,
    freightCharges: invoice.taxableAmount,
    grossBillAmount: invoice.grandTotal,
    grandTotal: invoice.grandTotal,
    paidAmount: invoice.paidAmount,
    status: invoice.status,
    remarks: invoice.remarks,
    selectedBankId: invoice.selectedBankId,
    branchCode: invoice.branchCode,
    copyCount: 1,
    consignmentRows: (invoice.docketRows || []).map((r) => ({
      cnNo: r.docketNo,
      cnDate: r.docketDate,
      vehicle: '-',
      from: r.originBranch,
      to: r.destBranch,
      weight: r.weightKg,
      packages: String(r.packages ?? ''),
      rateType: 'Fixed',
      ratePerMt: 0,
      freight: r.freightAmt,
      description: r.goodsDesc,
    })),
    ownerUid: invoice.ownerUid,
  };
}

function buildLogisticsInvoiceDoc(
  invoice: LogisticsInvoice,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'p'
) {
  return buildInvoiceDoc(
    logisticsInvoiceToInvoice(invoice, company),
    company,
    true,
    assets,
    orientation,
    1
  );
}

function buildPodScanDoc(params: {
  imageDataUrl: string;
  truckNo: string;
  cnNo?: string;
  podDate: string;
  remarks?: string;
  partyName?: string;
  division?: string;
  company: CompanySettings;
  orientation?: PdfOrientation;
  assets: PdfAssets;
}) {
  const orientation: PdfOrientation = params.orientation || 'p';
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const M = BILL_MARGIN;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;
  const ch = ph - M * 2;

  drawCenteredWatermark(doc, params.assets, params.company.companyName || 'DOLPHIN ROAD CARRIER');
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.55);
  doc.rect(M, M, cw, ch);

  drawTopLeftLogo(doc, params.assets, M + 2.5, M + 2.5, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(13, 71, 161);
  const divLabel =
    params.division && params.division !== 'FTL'
      ? ` (${String(params.division).toUpperCase()} DIVISION)`
      : '';
  doc.text(`${params.company.companyName || 'DOLPHIN ROAD CARRIER'}${divLabel}`, M + 25, M + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text(params.company.address || '', M + 25, M + 13);
  doc.text(`GSTIN: ${params.company.gstin}   |   PH: ${params.company.phones}`, M + 25, M + 17.5);

  doc.setFillColor(13, 71, 161);
  doc.rect(M, M + 24, cw, 7.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(
    `PROOF OF DELIVERY (POD) SCAN — VEHICLE: ${(params.truckNo || 'N/A').toUpperCase()}`,
    pw / 2,
    M + 29,
    { align: 'center' }
  );

  const metaY = M + 33.5;
  doc.setTextColor(15, 23, 42);
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  doc.rect(M, metaY, cw, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text(`Truck / Lorry No: ${params.truckNo || '-'}`, M + 3, metaY + 5);
  doc.text(`C/N / LR No: ${params.cnNo || '-'}`, M + cw * 0.38, metaY + 5);
  doc.text(`POD Date: ${formatDateDDMMYYYY(params.podDate)}`, M + cw - 3, metaY + 5, {
    align: 'right',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(`Party: ${params.partyName || '-'}`, M + 3, metaY + 10.5);
  doc.text(`Remarks: ${String(params.remarks || 'Signed & Delivered').slice(0, 62)}`, M + cw * 0.38, metaY + 10.5);

  const imgBoxY = metaY + 16.5;
  const imgBoxH = ph - M - 30 - imgBoxY;
  const imgBoxW = cw - 6;
  doc.setDrawColor(203, 213, 225);
  doc.rect(M + 3, imgBoxY, imgBoxW, imgBoxH);

  if (params.imageDataUrl) {
    try {
      doc.addImage(
        params.imageDataUrl,
        getJsPdfImageFormat(params.imageDataUrl),
        M + 5,
        imgBoxY + 2,
        imgBoxW - 4,
        imgBoxH - 4,
        undefined,
        'FAST'
      );
    } catch {
      doc.setFont('helvetica', 'italic');
      doc.text('POD Image Attachment Embedded', pw / 2, imgBoxY + imgBoxH / 2, { align: 'center' });
    }
  }

  drawBottomRightStampAndSign(doc, params.assets, pw - M - 2, ph - M - 24, 28, 17);
  stampAllPageNumbers(doc, `POD_${sanitizeFileName(params.truckNo || 'Truck')} — ${params.company.companyName}`, M, 3.8);

  const podDateTag = formatDateHyphenDDMMYYYY(params.podDate || todayISO());
  const cnTag = sanitizeFileName(params.cnNo || 'NOCN');
  const truckTag = sanitizeFileName(params.truckNo || 'Truck');
  return {
    buffer: doc.output('arraybuffer'),
    fileName: `POD_${cnTag}_${truckTag}_${podDateTag}.pdf`,
    title: `POD Scan - ${params.cnNo || params.truckNo || 'Truck'}`,
    orientation,
  };
}

function buildEntityKycDoc(params: {
  role: 'Driver' | 'Broker' | 'Lorry Owner' | 'Vehicle';
  recordName: string;
  fields: Array<{ label: string; value: string }>;
  attachedImageDataUrl?: string;
  company: CompanySettings;
  orientation?: PdfOrientation;
  assets: PdfAssets;
}) {
  const orientation: PdfOrientation = params.orientation || 'p';
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const M = BILL_MARGIN;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;
  const ch = ph - M * 2;

  drawCenteredWatermark(doc, params.assets, params.company.companyName || 'DOLPHIN ROAD CARRIER');
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.55);
  doc.rect(M, M, cw, ch);

  drawTopLeftLogo(doc, params.assets, M + 2.5, M + 2.5, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(13, 71, 161);
  doc.text(params.company.companyName || 'DOLPHIN ROAD CARRIER', M + 25, M + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text(params.company.address || '', M + 25, M + 13);
  doc.text(
    `GSTIN: ${params.company.gstin || '19DOTPS3540M1ZZ'}   |   PAN: ${params.company.pan || 'DOTPS3540M'}   |   PH: ${params.company.phones}`,
    M + 25,
    M + 17.5
  );

  doc.setFillColor(13, 71, 161);
  doc.rect(M, M + 24, cw, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text(
    `${params.role.toUpperCase()} KYC & COMPLIANCE PROFILE — ${(params.recordName || 'RECORD').toUpperCase()}`,
    pw / 2,
    M + 29.5,
    { align: 'center' }
  );

  let y = M + 36;
  const rowH = 8.2;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);

  const colW = cw / 2;
  const rows = params.fields || [];
  for (let i = 0; i < rows.length; i += 2) {
    if (y + rowH > ph - M - 36) {
      doc.addPage();
      drawCenteredWatermark(doc, params.assets, params.company.companyName || 'DOLPHIN ROAD CARRIER');
      doc.setDrawColor(15, 23, 42);
      doc.rect(M, M, cw, ch);
      y = M + 10;
    }
    const left = rows[i];
    const right = rows[i + 1];

    doc.setFillColor(i % 4 === 0 ? 248 : 255, 250, 252);
    doc.rect(M, y, colW, rowH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(left.label, M + 3, y + 3.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(String(left.value || '-').slice(0, 48), M + 3, y + 6.9);

    if (right) {
      doc.setFillColor(i % 4 === 0 ? 248 : 255, 250, 252);
      doc.rect(M + colW, y, colW, rowH, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text(right.label, M + colW + 3, y + 3.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      doc.text(String(right.value || '-').slice(0, 48), M + colW + 3, y + 6.9);
    }
    y += rowH;
  }

  if (params.attachedImageDataUrl && y + 48 < ph - M - 26) {
    const imgBoxW = Math.min(cw - 12, 115);
    const imgBoxH = Math.min(58, ph - M - 30 - y);
    doc.setDrawColor(148, 163, 184);
    doc.rect(M + 6, y + 3, imgBoxW, imgBoxH);
    try {
      doc.addImage(
        params.attachedImageDataUrl,
        getJsPdfImageFormat(params.attachedImageDataUrl),
        M + 8,
        y + 4.5,
        imgBoxW - 4,
        imgBoxH - 3,
        undefined,
        'FAST'
      );
    } catch {
      // Ignore invalid attached thumbnail
    }
  }

  drawBottomRightStampAndSign(doc, params.assets, pw - M - 2, ph - M - 24, 28, 17);
  const roleTag = sanitizeFileName(params.role.replace(/\s+/g, '_'));
  const nameTag = sanitizeFileName(params.recordName || 'Record');
  const fileName = `${nameTag}_${roleTag}_KYC.pdf`;
  stampAllPageNumbers(doc, `${fileName} — Verified on ${formatDateDDMMYYYY(todayISO())}`, M, 3.8);

  return {
    buffer: doc.output('arraybuffer'),
    fileName,
    title: `${params.role} KYC Profile — ${params.recordName}`,
    orientation,
  };
}

function buildAppFormatBlueprintDoc(
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'p'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const M = SAFE_MARGIN;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;

  const drawPageChrome = (pageTitle: string, pageTag: string) => {
    doc.setFillColor(13, 71, 161);
    doc.rect(M, M, cw, 16, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text(company.companyName || 'DOLPHIN ROAD CARRIER', M + 3.5, M + 6.5);
    doc.setFontSize(8.2);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `DRC APP ARCHITECTURE & DISASTER-RECOVERY BLUEPRINT  |  ${pageTag}`,
      M + 3.5,
      M + 12.2
    );

    doc.setFillColor(241, 245, 249);
    doc.rect(M, M + 16, cw, 7.5, 'F');
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.rect(M, M, cw, 23.5);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(pageTitle, M + 3, M + 21.2);
  };

  const drawSectionBox = (
    y: number,
    heading: string,
    bullets: string[],
    accentRgb: [number, number, number] = [13, 71, 161]
  ): number => {
    const lineHeight = 4.2;
    const textWidth = cw - 8;
    const wrappedBlocks = bullets.map((b) => doc.splitTextToSize(b, textWidth) as string[]);
    const totalLines = wrappedBlocks.reduce((acc, lines) => acc + lines.length, 0);
    const boxH = 8.5 + totalLines * lineHeight + Math.max(0, bullets.length - 1) * 1.1;

    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(M, y, cw, 6.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(heading, M + 3, y + 4.3);

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.rect(M, y, cw, boxH);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    let cy = y + 10.2;
    wrappedBlocks.forEach((lines) => {
      lines.forEach((ln) => {
        doc.text(ln, M + 3.5, cy);
        cy += lineHeight;
      });
      cy += 1.1;
    });
    return y + boxH + 3.5;
  };

  // ---------------- PAGE 1: TECH STACK, EMAILS, DRIVE SANDBOX & 4 DIVISIONS ----------------
  drawPageChrome('PAGE 1 OF 3 — TECH STACK, CLOUD SYNC, EMAIL LOCK & 4-BUSINESS ARCHITECTURE', 'PAGE 1/3');
  let y = M + 27;

  y = drawSectionBox(
    y,
    '1. CORE TECH STACK, HOSTING & CROSS-PLATFORM PWA RUNTIME',
    [
      '• Frontend Engine: React 19 + TypeScript + Tailwind CSS v4 + Vite 6 + Workbox PWA (sw.js + sw-notifications.js).',
      '• Cross-Device Support: Single installable codebase runs cleanly on Windows PC (Desktop/Chrome/Edge), Android Tablets, and Android Phones (auto-rotate + offline IndexedDB multi-MB cache).',
      '• Real-Time 2-Way Sync: Express JSON/SSE live stream (/api/erp/state, /api/erp/stream) + timestamped 2-way conflict merge + offlineSyncQueue + optional Firestore real-time mirror.',
      '• Production Origin Guard: Allowlisted Vercel & Firebase domains (dolphin-road-carrier.vercel.app) with instant silent version check (version.json).',
    ],
    [13, 71, 161]
  );

  y = drawSectionBox(
    y,
    '2. OFFICIAL COMMUNICATION EMAIL vs ISOLATED DRIVE BACKUP SANDBOX',
    [
      `• Official Party & Statutory Email: drc.kolkata1@gmail.com (printed on Tax Invoices, LRs, 194C Declarations & Quotation email-only acceptance clause).`,
      `• Isolated Google Drive App Sandbox: Target backup account drc.2015kolkata@gmail.com uses strictly app-scoped OAuth permissions (drive.file + drive.appdata) — ZERO access to personal photos or unrelated files.`,
      '• Visible Drive Root (DOLPHIN_ROAD_CARRIERS_MASTER): Stores 5 cleanly separated JSON files (DRC_FTL_BUSINESS_<FY>, DRC_LOGISTICS_BUSINESS_<FY>, DRC_PTL_BUSINESS_<FY>, DRC_COURIER_PARCEL_<FY>, DRC_MASTERS_AND_KYC_VAULT), DRC_APP_INSTALLER_VAULT, plus Compliance PDFs.',
      '• Hidden App Sandbox (appDataFolder): Mirrors DRC_APP_FORMAT_BLUEPRINT.pdf & recovery snapshots securely inside Google Drive hidden app space.',
    ],
    [15, 118, 110]
  );

  y = drawSectionBox(
    y,
    '3. 4-BUSINESS DIVISION ISOLATION & UNIFIED WORKFLOW',
    [
      '• Switcher Buttons: [ FTL ] Full Truck Load  |  [ LOGISTICS ] Express Line-Haul  |  [ PTL ] Part-Truck Load  |  [ COURIER ] Parcel Express.',
      '• Unified 4-Pillar Workspace: (A) Bilty & Lorry Master Sheet (CN/LR + Lorry Hire + PAY 1-12 + Staff), (B) Party Tax Invoice (FoxPro BILL ENTRY + Quotations + 194C), (C) Masters & Tally Ledgers + Bank Credit Reader, (D) GST Filing Hub, KYC Vault & Bilingual Operating Book.',
      `• Company Identity: ${company.companyName} | GSTIN: ${company.gstin || '19DOTPS3540M1ZZ'} | PAN: ${company.pan || 'DOTPS3540M'} | Branch Network: HQ Kolkata + 50+ All-India Branches.`,
    ],
    [30, 64, 175]
  );

  // ---------------- PAGE 2: DATABASE SCHEMAS, FOXPRO RULES & FORMULAS ----------------
  doc.addPage();
  drawPageChrome('PAGE 2 OF 3 — DATABASE SCHEMAS, FOXPRO .DBF MAPPING & STATUTORY FORMULAS', 'PAGE 2/3');
  y = M + 27;

  y = drawSectionBox(
    y,
    '4. DATABASE COLLECTIONS & MASTER REGISTERS',
    [
      '• FTL & Core Ledgers: parties (Customer / Consignor / Consignee / Broker / TruckOwner), vehicles (RC/Fitness/Ins/Permit/PUC), drivers (DL + Expiry), consignments (CN/LR), invoices (Tax Bill/CDNR), quotations, lorry_hires (PAY 1-12 & POD Lock), transactions, declarations (194C), bank_receipts, staff_accounts, staff_commissions.',
      '• Logistics / PTL / Courier Isolation: Separate logistics_parties, logistics_vehicles, logistics_drivers, logistics_dockets, logistics_manifests, logistics_invoices, logistics_ledgers scoped by division ID prefix.',
      '• Duplicate-Safe Pickers: Every Party, Broker, Owner, Vehicle & Driver picker renders full KYC details (GSTIN / PAN / City / Phone / DL / Vehicle Type) + instant Entity Quick-Preview Card.',
    ],
    [13, 71, 161]
  );

  y = drawSectionBox(
    y,
    '5. FOXPRO (.DBF) AUTO-COLLECTOR & PARTY HYGIENE RULES',
    [
      '• Mapped Tables: HEAD / CUST*.DBF -> Customer Master | BRKRMAST -> Brokers | OWNER* / OWNMAST* -> Lorry Owners | VEHMAST* / COURVHL / LORRY* -> Lorry Register | DRVRMAST -> Drivers | DESMAST -> Destinations | COURTRAN / CHALLANT -> Bilty, Invoices & Challans.',
      '• Strict Exclusions: scrap*.dbf and temporary junk files are automatically ignored; Cleanup tool separates Brokers/Owners/Drivers out of Billing Party Customer pickers.',
      '• Classic Shortcuts & Print Controls: Keyboard-friendly Bilts/Bill Entry + Credit/Debit Note adjustment + Strict Print/Finalize Lock on finalized GST bills.',
    ],
    [180, 83, 9]
  );

  y = drawSectionBox(
    y,
    '6. VERIFIED ACCOUNTING, GST & STATUTORY FORMULAS',
    [
      '• Indian GSTIN Mod-36 Checksum: Every 15-char GSTIN is mathematically verified (2-digit State + 10-char PAN + Entity + Z + weighted mod-36 check digit) with direct GST Portal online search link.',
      '• GST GTA Rules: 5% RCM (Tax payable by Consignee/Consignor), 12% Forward Charge (CGST 6% + SGST 6% intra-state WB 19, or IGST 12% inter-state), 0% Export Exempt (Nepal / Bangladesh / Bhutan, PAN mandatory).',
      '• TDS u/s 194C & Banking: Tracks 1%/2% TDS deductions cleanly; Smart Bank Credit Reader parses SMS/Email alerts & PNB/Excel statements with exact Indian paise precision (e.g. 1,01,150.50).',
      '• 2-Day Free Detention: Calculates detention charges strictly beyond 2 free unloading days; POD balance payment stays locked until POD scan + delivery verification are saved.',
    ],
    [5, 150, 105]
  );

  // ---------------- PAGE 3: SECURITY SHIELD, ALARMS & RECOVERY STEPS ----------------
  doc.addPage();
  drawPageChrome('PAGE 3 OF 3 — 5-LAYER SECURITY SHIELD, BACKGROUND ALARMS & RECOVERY GUIDE', 'PAGE 3/3');
  y = M + 27;

  y = drawSectionBox(
    y,
    '7. ANTI-SCREENSHOT PRIVACY SHIELD & 5-LAYER SECURITY ARCHITECTURE',
    [
      '• Anti-Screenshot Curtain: Blocks PrintScreen, Win+Shift+S / Cmd+Shift+S, unauthorized Copy/Right-Click, and getDisplayMedia screen recording with immediate black Privacy Curtain + alert beep (Admin PIN unlock available for audits).',
      '• Dynamic Staff Watermark: Non-admin staff logins display subtle Staff Code + Name + Branch + Live Timestamp watermark overlay across sensitive financial ledgers.',
      '• 5-Layer Shield: (1) Allowlisted HTTPS/OAuth Origin Lock, (2) Strict Safe File Upload Allowlist (.jpg/.png/.pdf/.xlsx/.csv/.dbf only — blocks scripts/executables), (3) Permanent Admin-PIN No-Auto-Delete Shield when live data exists, (4) Silent Auto-Update polling, (5) Daily & 90-Day Self-Healing Formula & Junk Cache Cleaner.',
    ],
    [185, 28, 28]
  );

  y = drawSectionBox(
    y,
    '8. CONTINUOUS E-WAY BILL 8H COUNTDOWN & BACKGROUND PHONE ALARMS',
    [
      '• Continuous 8h-to-1h EWB Alarm: Monitors every active CN with E-Way Bill validity <= 8 hours; fires persistent alert banner, beep & PWA background notification until Unloading Date or Delivered POD is recorded.',
      '• Monthly GST & KYC Alarms: Alerts from 7th/8th (GSTR-1 due 11th) & 15th (GSTR-3B due 20th) + 10/5/2-day pre-expiry reminders for Vehicle Fitness, Insurance, Permit, Road Tax, PUC, WB Trade License & P-Tax.',
      '• Phone Alarm Control: Click [Phone Alarm] in top header to grant Android/Windows tray notification permissions handled by sw-notifications.js.',
    ],
    [67, 56, 202]
  );

  y = drawSectionBox(
    y,
    '9. STEP-BY-STEP DISASTER RECOVERY & FUTURE REBUILD PROTOCOL',
    [
      '• Step 1 (Device Reset / New PC or Android): Open https://dolphin-road-carrier.vercel.app in Chrome/Edge and tap Install App for instant PWA icon & offline database.',
      '• Step 2 (Connect Backup Sandbox): Open C. Settings -> Backup / Restore -> Switch Gmail to drc.2015kolkata@gmail.com (locked by Master Admin PIN + 2FA OTP).',
      '• Step 3 (Restore All 4 Businesses): Click "Restore from Google Drive" (Master_Backup_DRC.json.gz) or restore each isolated division file individually (FTL, LOGISTICS, PTL, COURIER, MASTERS_AND_KYC_VAULT).',
      '• Step 4 (Verify Health & GST): Click Header "100% Health" badge -> Run Formula Guard scan; open Tax Invoice & GSTR-1/3B Hub to confirm FY closing balances match 100%.',
    ],
    [15, 23, 42]
  );

  drawBottomRightStampAndSign(doc, assets, pw - M - 2, ph - M - 22, 24, 13);
  stampAllPageNumbers(doc, 'DRC_APP_FORMAT_BLUEPRINT.pdf — Confidential Architecture & Recovery Blueprint', M, 3.8);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: 'DRC_APP_FORMAT_BLUEPRINT.pdf',
    title: 'DRC App Format Blueprint (2-3 Page Low-KB Guide)',
    orientation,
  };
}

// ============================================================================
// 11. TALLY-STYLE ROLE LEDGER STATEMENT (PARTY / BROKER / OWNER / DRIVER / VEHICLE / STAFF)
// ============================================================================

function buildTallyLedgerDoc(
  statement: TallyLedgerStatement,
  company: CompanySettings,
  assets: PdfAssets,
  orientation: PdfOrientation = 'p'
) {
  const doc = new jsPDF({
    orientation: orientation === 'l' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const M = BILL_MARGIN;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const cw = pw - M * 2;
  const ch = ph - M * 2;

  const roleLabels: Record<string, string> = {
    party: 'PARTY ACCOUNT LEDGER',
    broker: 'BROKER LEDGER',
    owner: 'LORRY OWNER LEDGER',
    driver: 'DRIVER LEDGER',
    vehicle: 'VEHICLE / TRUCK LEDGER',
    staff: 'STAFF ACCOUNT LEDGER',
  };
  const roleLabel = roleLabels[statement.role] || statement.role.toUpperCase();

  // Exact 6 Tally ERP/Prime Columns: Date | Particulars | Vch Type | Vch No. | Debit (Rs) | Credit (Rs)
  const colEdges = [0, 0.115, 0.515, 0.655, 0.77, 0.885, 1.0];
  const colX = (i: number) => M + cw * colEdges[i];

  const drawHeader = () => {
    drawCenteredWatermark(doc, assets, company.companyName || 'DOLPHIN ROAD CARRIER');
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.rect(M, M, cw, ch);

    drawTopLeftLogo(doc, assets, M + 2.5, M + 2, 16, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(13, 71, 161);
    doc.text(company.companyName || 'DOLPHIN ROAD CARRIER', pw / 2, M + 6.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `${company.address || '30/1/29, Nobin Chandra Das Road, Kolkata - 700090'} | GSTIN: ${company.gstin || '19DOTPS3540M1ZZ'} | PAN: ${company.pan || 'DOTPS3540M'}`,
      pw / 2,
      M + 11.2,
      { align: 'center' }
    );
    doc.text(`Ledger Statement (${roleLabel})   |   FY: ${statement.fy}`, pw / 2, M + 15.2, {
      align: 'center',
    });

    doc.setFillColor(241, 245, 249);
    doc.rect(M, M + 17.5, cw, 12.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Ledger Account: ${statement.accountName}`, M + 2.5, M + 22.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    const metaLine = [
      statement.accountAddress ? `Addr: ${statement.accountAddress.slice(0, 42)}` : '',
      statement.accountGstin ? `GSTIN: ${statement.accountGstin}` : '',
      statement.accountStateCode ? `State Code: ${statement.accountStateCode}` : '',
      `Period: ${formatDateDDMMYYYY(statement.dateFrom)} to ${formatDateDDMMYYYY(statement.dateTo)}`,
    ]
      .filter(Boolean)
      .join('   |   ');
    doc.text(metaLine, M + 2.5, M + 27.3);

    const hdrY = M + 31;
    const hdrH = 7.2;
    doc.setFillColor(15, 23, 42);
    doc.rect(M, hdrY, cw, hdrH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text('Date', colX(0) + 1.5, hdrY + 4.8);
    doc.text('Particulars (Narration & Bill/LR/Truck Ref)', colX(1) + 1.5, hdrY + 4.8);
    doc.text('Vch Type', colX(2) + 1.5, hdrY + 4.8);
    doc.text('Vch No.', colX(3) + 1.5, hdrY + 4.8);
    doc.text('Debit (Rs)', colX(5) - 1.5, hdrY + 4.8, { align: 'right' });
    doc.text('Credit (Rs)', colX(6) - 1.5, hdrY + 4.8, { align: 'right' });

    return hdrY + hdrH;
  };

  let curY = drawHeader();
  const maxY = ph - M - 34;
  const rowH = 8.2;

  // Opening balance row
  doc.setFillColor(239, 246, 255);
  doc.rect(M, curY, cw, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.1);
  doc.setTextColor(30, 58, 138);
  doc.text(formatDateDDMMYYYY(statement.dateFrom), colX(0) + 1.5, curY + 4.6);
  doc.text(`Opening Balance (${statement.openingSide})`, colX(1) + 1.5, curY + 4.6);
  doc.text('Opening', colX(2) + 1.5, curY + 4.6);
  doc.text('OPEN', colX(3) + 1.5, curY + 4.6);
  doc.text(statement.openingDr > 0 ? formatINR(statement.openingDr) : '-', colX(5) - 1.5, curY + 4.6, { align: 'right' });
  doc.text(statement.openingCr > 0 ? formatINR(statement.openingCr) : '-', colX(6) - 1.5, curY + 4.6, { align: 'right' });
  curY += 6.8;

  statement.rows.forEach((r, idx) => {
    if (curY + rowH > maxY) {
      doc.addPage();
      curY = drawHeader();
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, curY, cw, rowH, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(M, curY + rowH, M + cw, curY + rowH);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.9);
    doc.text(formatDateDDMMYYYY(r.date), colX(0) + 1.5, curY + 4);
    doc.setFont('helvetica', 'bold');
    doc.text(String(r.particulars || '-').slice(0, 44), colX(1) + 1.5, curY + 3.6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6);
    doc.setTextColor(71, 85, 105);
    doc.text(String(r.narration || '').slice(0, 48), colX(1) + 1.5, curY + 6.9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    doc.setTextColor(15, 23, 42);
    doc.text(r.voucherType, colX(2) + 1.5, curY + 4.4);
    doc.text(String(r.voucherNo || '-').slice(0, 16), colX(3) + 1.5, curY + 4.4);
    doc.text(r.debit > 0 ? formatINR(r.debit) : '-', colX(5) - 1.5, curY + 4.4, { align: 'right' });
    doc.text(r.credit > 0 ? formatINR(r.credit) : '-', colX(6) - 1.5, curY + 4.4, { align: 'right' });
    curY += rowH;
  });

  if (curY + 32 > ph - M) {
    doc.addPage();
    curY = drawHeader();
  }

  // Authentic Tally Totals Footer: Opening Balance (Dr/Cr), Current Total (Dr | Cr), Closing Balance (Dr/Cr)
  doc.setFillColor(241, 245, 249);
  doc.rect(M, curY, cw, 19.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(15, 23, 42);

  doc.text('Opening Balance :', colX(1) + 1.5, curY + 4.5);
  doc.text(statement.openingDr > 0 ? formatINR(statement.openingDr) : '-', colX(5) - 1.5, curY + 4.5, { align: 'right' });
  doc.text(statement.openingCr > 0 ? formatINR(statement.openingCr) : '-', colX(6) - 1.5, curY + 4.5, { align: 'right' });

  doc.text('Current Total (Total Debit | Total Credit) :', colX(1) + 1.5, curY + 9.5);
  doc.text(formatINR(statement.totalDr), colX(5) - 1.5, curY + 9.5, { align: 'right' });
  doc.text(formatINR(statement.totalCr), colX(6) - 1.5, curY + 9.5, { align: 'right' });

  doc.line(M, curY + 11.5, M + cw, curY + 11.5);
  doc.setTextColor(statement.closingSide === 'Dr' ? 180 : 5, statement.closingSide === 'Dr' ? 83 : 120, 9);
  doc.text(`Closing Balance (${statement.closingSide}) :`, colX(1) + 1.5, curY + 16.5);
  doc.text(
    statement.closingSide === 'Dr' ? `${formatINR(statement.closingBalance)} Dr` : '-',
    colX(5) - 1.5,
    curY + 16.5,
    { align: 'right' }
  );
  doc.text(
    statement.closingSide === 'Cr' ? `${formatINR(statement.closingBalance)} Cr` : '-',
    colX(6) - 1.5,
    curY + 16.5,
    { align: 'right' }
  );

  doc.setTextColor(5, 120, 80);
  doc.setFontSize(7);
  doc.text(
    `Tally Math & Ledger Audit: ${statement.auditBalanced ? '0 Difference (100% Tallied)' : `Diff Rs.${formatINR(statement.auditDifference)}`}`,
    M + 2.5,
    curY + 23.5
  );

  drawBottomRightStampAndSign(doc, assets, pw - M - 2, ph - M - 22, 25, 14.5);
  const safeName = sanitizeFileName(statement.accountName || 'Account');
  const fileName = `DRC_Ledger_${statement.role.toUpperCase()}_${safeName}_${sanitizeFileName(statement.fy)}.pdf`;
  stampAllPageNumbers(doc, `${fileName} — Dolphin Road Carrier Tally Statement`, M, 3.8);

  return {
    buffer: doc.output('arraybuffer'),
    fileName,
    title: `Tally Ledger — ${statement.accountName} (${statement.fy})`,
    orientation,
  };
}


