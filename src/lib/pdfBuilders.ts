import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import {
  BillCopyCount,
  CompanyBankAccount,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Invoice,
  Quotation,
} from '../types/erp';
import {
  amountToIndianWords,
  formatDateDDMMYYYY,
  formatINR,
  getDynamicFinancialYear,
  sanitizeFileName,
} from './formatters';

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
  orientation?: PdfOrientation;
}

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
      // Fallback to crisp vector triangle logo below
    }
  }
  // Vector triangular DRC fallback inside worker if raster asset unavailable
  doc.setFillColor(13, 71, 161);
  doc.triangle(x + w / 2, y + 1, x + 1, y + h - 1, x + w - 1, y + h - 1, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('DRC', x + w / 2, y + h - 4, { align: 'center' });
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
    return buildLR3CopyDoc(task.cn, task.company, task.assets, task.orientation || 'l');
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

    // TOP-LEFT Triangular DRC Logo inside 8mm outer border
    drawTopLeftLogo(doc, assets, M + 2.5, M + 2.5, 21, 21);

    // TOP-RIGHT Copy Label Badge inside outer border
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    const badgeW = 48;
    const badgeX = M + cw - badgeW - 2.5;
    const badgeY = M + 2.5;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(30, 64, 175);
    doc.setLineWidth(0.35);
    doc.rect(badgeX, badgeY, badgeW, 5.5, 'FD');
    doc.setTextColor(13, 71, 161);
    doc.text(copyLabel, badgeX + badgeW / 2, badgeY + 3.9, { align: 'center' });

    doc.setTextColor(15, 76, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.text(String(company.companyName || 'DOLPHIN ROAD CARRIER'), M + 26, M + 7);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(String(company.address || ''), M + 26, M + 11.2);
    doc.text(`PAN: ${company.pan}   |   GSTIN: ${company.gstin}`, M + 26, M + 15.2);
    doc.text(`PH: ${company.phones}   |   MSME: ${company.msme}   |   SAC/HSN: ${invoice.sac || company.hsn}`, M + 26, M + 19.2);

    doc.setTextColor(180, 35, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(
      isContPage
        ? 'T A X   I N V O I C E   ( C O N T I N U A T I O N )'
        : isCrossBorderExempt
        ? 'B I L L   O F   S U P P L Y   ( E X P O R T   /   G S T   E X E M P T )'
        : 'T A X   I N V O I C E   /   B I L L   O F   S U P P L Y',
      pw / 2,
      M + 26.5,
      { align: 'center' }
    );

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
      ['INVOICE NO', invoice.invoiceNo],
      ['DATE', formatDateDDMMYYYY(invoice.invoiceDate)],
      ['DUE / FY', `${formatDateDDMMYYYY(invoice.dueDate) || '-'} / ${invoice.financialYear || company.currentFy}`],
      ['COUNTRY', billingCountry.toUpperCase()],
      ['SAC / CODE', `${invoice.sac || company.hsn || '996791'} / ${isCrossBorderExempt ? 'EXPORT 0%' : (invoice.interstate ? 'IGST' : 'CGST+SGST')}`],
    ];
    metas.forEach(([k, v], i) => {
      const my = M + 33.5 + i * 4.6;
      doc.setFont('helvetica', 'bold');
      doc.text(k, metaX, my);
      doc.text(':', colonX, my);
      doc.setFont('helvetica', 'normal');
      doc.text(String(v || '-').slice(0, 30), valX, my);
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
    const SUMMARY_BLOCK_HEIGHT = 118;
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

    const charges = [
      ['FREIGHT CHARGES', invoice.freightCharges || 0],
      ['DETENTION CHARGES', invoice.detentionCharges || 0],
      ['UNLOADING CHARGES', invoice.unloadingCharges || 0],
      ['ST CHARGES', invoice.stCharges || 0],
    ] as const;

    let cy = boxTop + 11;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.7);
    charges.forEach(([label, val]) => {
      if (Number(val) > 0 || label === 'FREIGHT CHARGES') {
        doc.text(label, descColStart + 4, cy);
        doc.text(Number(val).toFixed(2), M + cw - 3, cy, { align: 'right' });
        cy += 5.5;
      }
    });

    doc.line(descColStart, boxTop + 42, M + cw, boxTop + 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('GRAND TOTAL :', descColStart + 4, boxTop + 49.5);
    doc.text(formatINR(invoice.grandTotal || 0), M + cw - 3, boxTop + 49.5, { align: 'right' });

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
    doc.setFontSize(7.4);
    doc.text(`Bank   : ${selectedBank.bankName}`, M + 2, bankBoxY + 5);
    doc.text(
      `Branch : ${selectedBank.branch}${selectedBank.swift ? ` (SWIFT: ${selectedBank.swift})` : ''}`,
      M + 2,
      bankBoxY + 9.8
    );
    doc.text(`A/c No : ${selectedBank.accountNo}`, M + 2, bankBoxY + 14.6);
    doc.text(`IFSC   : ${selectedBank.ifsc}   |   A/c Name: ${selectedBank.accountName}`, M + 2, bankBoxY + 19.4);
    if (selectedBank.upiId) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.text(`UPI ID : ${selectedBank.upiId}`, M + 2, bankBoxY + 24.2);
    }

    // Scannable Vector UPI BANK QR right beside Bank Details
    const qrBoxX = M + cw - 68;
    drawVectorUpiQr(doc, upiUri, qrBoxX, bankBoxY + 2.2, 18);

    // BOTTOM-RIGHT Company Stamp & Signature on FINAL PAGE of each copy
    drawBottomRightStampAndSign(doc, assets, M + cw, bankBoxY + 5, 29, 16.5);

    const remBoxY = bankBoxY + 27;
    doc.rect(M, remBoxY, cw, 15.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text('REMARKS & TERMS :', M + 2, remBoxY + 4.5);
    doc.setFont('helvetica', 'normal');
    const remLines = doc.splitTextToSize(
      `${invoice.remarks || '-'} | Payment Terms: 100% within 7 days (18% p.a. thereafter). Pay via A/C Payee NEFT/RTGS.`,
      cw - 4
    );
    doc.text(remLines.slice(0, 2), M + 2, remBoxY + 9);

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

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(invoice.partyName)}_${sanitizeFileName(invoice.invoiceNo)}_${copyCount}Copy.pdf`,
    title: `Tax Invoice - ${invoice.invoiceNo} (${copyCount} ${copyCount === 1 ? 'Copy' : 'Copies'})`,
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
  orientation: PdfOrientation = 'l'
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
    ...(cn.ewayBillNo ? [{ no: cn.ewayBillNo, date: cn.ewayBillDate || '' }] : []),
    ...(cn.extraEwayBills || []).filter((x) => String(x?.no || '').trim()),
  ];

  const hasOverflowSchedule =
    allVehicles.length > 4 || allInvoices.length > 3 || allEwbs.length > 3;

  const originText = [cn.fromCity, cn.fromDistrict, cn.fromState].filter(Boolean).join(', ');
  const destText = [cn.toCity, cn.toDistrict, cn.toState].filter(Boolean).join(', ');

  copies.forEach((copyLabel, idx) => {
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
    doc.text(
      cn.stockTransfer ? '!! OM SAI RAM !!   [STOCK TRANSFER]' : '!! OM SAI RAM !!',
      x0 + cw / 2,
      y0 + 4.5,
      { align: 'center' }
    );
    doc.text(`Subhajit Saha · Mob: ${company.phones}`, x0 + cw - 3, y0 + 4.5, { align: 'right' });

    // TOP-LEFT Triangular DRC Dolphin Logo
    drawTopLeftLogo(doc, assets, x0 + 3, y0 + 7.5, 20, 20);

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
    doc.text(`C/N No   : ${cn.cnNo}`, x0 + 2.5, row1Y + 5);
    doc.text(`C/N Date : ${formatDateDDMMYYYY(cn.cnDate)}`, x0 + 2.5, row1Y + 9.8);
    doc.setFontSize(7.2);
    doc.text(`FY: ${cn.financialYear || company.currentFy}  |  Credit: ${cn.creditDays || 15} Days`, x0 + 2.5, row1Y + 14.6);
    doc.text(`Del. Office: ${(cn.deliveryOffice || cn.toCity || '').slice(0, 25)}`, x0 + 2.5, row1Y + 19.6);

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
    doc.text(`TAX INV. No : ${invSummary.slice(0, 34)}`, x0 + b1W + b2W + 2.5, row1Y + 5);
    doc.text(`STOCK TRF   : ${cn.stockTransfer ? 'YES' : 'NO'}   |   INV DT: ${formatDateDDMMYYYY(cn.taxInvDate) || '-'}`, x0 + b1W + b2W + 2.5, row1Y + 9.8);
    doc.text(`E-WAY BILL  : ${ewbSummary.slice(0, 34)}`, x0 + b1W + b2W + 2.5, row1Y + 14.6);
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

    // Goods & Freight Table
    const tblY = row2Y + 26;
    const tblH = orientation === 'l' ? 47 : 65;
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
    doc.text(cn.packages || '-', (x0 + c1) / 2, tblY + 16, { align: 'center' });
    if (cn.packageMode) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(cn.packageMode.slice(0, 16), (x0 + c1) / 2, tblY + 22, { align: 'center' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    const partLines = doc.splitTextToSize(cn.particulars || '-', c2 - c1 - 5);
    doc.text(partLines.slice(0, 5), c1 + 2.5, tblY + 13.5);
    if (cn.rateMode) {
      doc.setFontSize(7);
      doc.setTextColor(30, 64, 175);
      doc.text(
        `Basis: ${cn.rateMode}${cn.ratePerUnit ? ` (@ Rs.${formatINR(cn.ratePerUnit)})` : ''}`,
        c1 + 2.5,
        tblY + tblH - 3.5
      );
      doc.setTextColor(15, 23, 42);
    }

    doc.setFontSize(7.6);
    doc.text(`Nett : ${Number(cn.nettWeight || 0).toFixed(3)}`, c2 + 2, tblY + 14);
    doc.text(`Gross: ${Number(cn.grossWeight || 0).toFixed(3)}`, c2 + 2, tblY + 21);

    doc.setFontSize(7.2);
    doc.text(`Loading : ${formatINR(cn.loadingCharge || 0)}`, c3 + 2, tblY + 13);
    doc.text(`Unload  : ${formatINR(cn.unloadingCharge || 0)}`, c3 + 2, tblY + 18.5);
    doc.text(`Return  : ${formatINR(cn.returnLorryCharge || 0)}`, c3 + 2, tblY + 24);
    doc.text(`S.TT    : ${formatINR(cn.sttCharge || 0)}`, c3 + 2, tblY + 29.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(`Total: Rs.${formatINR(cn.totalFreight)}`, c4 + 2, tblY + 13.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Paid : Rs.${formatINR(cn.paidAmount || 0)}`, c4 + 2, tblY + 20);
    doc.text(`ToPay: Rs.${formatINR(cn.toPayAmount || 0)}`, c4 + 2, tblY + 26.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.9);
    doc.setTextColor(13, 71, 161);
    doc.text(`GST Paid By: ${(cn.gstPaidBy || 'Consignee').slice(0, 12)}`, c4 + 2, tblY + 34);
    doc.setTextColor(15, 23, 42);

    // EXTRA-LARGE WIDE REMARKS BOX inside LR
    const remY = tblY + tblH;
    const remH = orientation === 'l' ? 27 : 40;
    doc.rect(x0, remY, cw, remH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('REMARKS / SPECIAL INSTRUCTIONS :', x0 + 2.5, remY + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const largeRemarksText = [
      cn.remarks || '',
      allVehicles.length > 1 ? `All Vehicles: ${allVehicles.join(', ')}` : '',
      allEwbs.length > 1 ? `E-Way Bills: ${allEwbs.map((e) => e.no).join(', ')}` : '',
      allInvoices.length > 1 ? `Tax Invoices: ${allInvoices.map((i) => i.no).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    const lrRemLines = doc.splitTextToSize(largeRemarksText || '-', cw - 6);
    doc.text(lrRemLines.slice(0, orientation === 'l' ? 4 : 6), x0 + 2.5, remY + 10);

    // Copy Footer + Checkboxes + BOTTOM-RIGHT Stamp
    const footY = remY + remH + 2.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.text(
      'Conditions: Sender declares packages contain declared lawful goods only. Subject to Kolkata Jurisdiction. Transporter not liable for leakage/breakage.',
      x0 + 2.5,
      footY + 2
    );

    if (orientation === 'l') {
      let cx = x0 + 2.5;
      const cbSpacing = 54;
      copies.forEach((lbl) => {
        const checked = lbl === copyLabel;
        doc.setDrawColor(15, 23, 42);
        doc.rect(cx, footY + 6.5, 3.4, 3.4);
        if (checked) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.text('X', cx + 0.7, footY + 9.4);
        }
        doc.setFont('helvetica', checked ? 'bold' : 'normal');
        doc.setFontSize(6.8);
        doc.text(lbl, cx + 4.5, footY + 9.4);
        cx += cbSpacing;
      });
    } else {
      copies.forEach((lbl, cIdx) => {
        const col = cIdx % 2;
        const row = Math.floor(cIdx / 2);
        const cx = x0 + 2.5 + col * 60;
        const cy = footY + 6 + row * 5.2;
        const checked = lbl === copyLabel;
        doc.setDrawColor(15, 23, 42);
        doc.rect(cx, cy, 3.2, 3.2);
        if (checked) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.text('X', cx + 0.6, cy + 2.7);
        }
        doc.setFont('helvetica', checked ? 'bold' : 'normal');
        doc.setFontSize(6.5);
        doc.text(lbl, cx + 4.2, cy + 2.7);
      });
    }

    // Company Stamp BOTTOM-RIGHT corner
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
        sy = SAFE_MARGIN + 14;
      }
      doc.text(
        `${i + 1}. E-Way Bill No: ${ewbRow.no}   |   Date: ${formatDateDDMMYYYY(ewbRow.date) || '-'}`,
        SAFE_MARGIN + 3,
        sy
      );
      sy += 5.5;
    });

    drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN, ph - 36, 28, 17);
  }

  stampAllPageNumbers(doc, `Bilty / LR ${cn.cnNo} — Dolphin Road Carrier`);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `LR_${sanitizeFileName(cn.cnNo)}_4Copies.pdf`,
    title: `Consignment Note (4 Copies) - ${cn.cnNo}`,
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

  const rows: Array<[string, string]> = [
    ['Vehicle Type', quote.vehicleType || '-'],
    ...(quote.goodsType ? [['Goods Type', quote.goodsType] as [string, string]] : []),
    ['Freight', `Rs. ${formatINR(quote.freight || 0)}${quote.rateMode ? ` (${quote.rateMode})` : ''}`],
    ['Loading Charges', quote.loadingCharge || 'NO Extra Charges'],
    ['Unloading Charges', quote.unloadingCharge || 'YES Extra Charges'],
    ['Parking', quote.parkingCharge || 'YES Extra Charges'],
    ['Detention', quote.detentionCharge || 'YES Extra Charges'],
    ['Ton Guarantee', quote.tonGuarantee || '09 TON Loading Capacity'],
    ['Destination', quote.destination || '-'],
    ['Advance Pay', quote.advancePay || 'No Advance Before Lorry Loading'],
    ['Entry Point', quote.entryPoint || 'As Applicable'],
  ];

  let ty = SAFE_MARGIN + 78;
  const labelW = cw * 0.28;
  const valW = cw - labelW;
  const rowH = orientation === 'l' ? 5.5 : 6.4;
  doc.setLineWidth(0.3);

  rows.forEach(([k, v]) => {
    doc.rect(SAFE_MARGIN, ty, labelW, rowH);
    doc.rect(SAFE_MARGIN + labelW, ty, valW, rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text(String(k ?? ''), SAFE_MARGIN + 2.5, ty + rowH - 2.1);
    doc.setFont('helvetica', 'normal');
    doc.text(String(v ?? '-'), SAFE_MARGIN + labelW + 3, ty + rowH - 2.1);
    ty += rowH;
  });

  ty += 4;
  if (ty + 48 > ph - 12) {
    doc.addPage();
    ty = SAFE_MARGIN + 10;
  }

  const qBank = resolveInvoiceBankAccount(company);
  doc.rect(SAFE_MARGIN, ty, cw * 0.52, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text('Bank Details', SAFE_MARGIN + 2.5, ty + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(`A/C Name   : ${company.companyName}`, SAFE_MARGIN + 2.5, ty + 11);
  doc.text(`Bank Name  : ${qBank.bankName}`, SAFE_MARGIN + 2.5, ty + 16);
  doc.text(`A/C No     : ${qBank.accountNo}`, SAFE_MARGIN + 2.5, ty + 21);
  doc.text(`IFSC Code  : ${qBank.ifsc} (${qBank.branch})`, SAFE_MARGIN + 2.5, ty + 26);

  // BOTTOM-RIGHT Company Stamp & Signature
  drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN, ty + 5, 29, 18);

  const ny = ty + 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  const notices = [
    'Notice: (Leakage, Damage, Breakage & Shortage Not Transporter Risk) Lorry Owner Risk.',
    'Vehicle Border Pass & Detention beyond free time (Rs.1000/day) borne separately.',
    'Payment Terms: Balance within 7 days of lorry unloading (No Discount / No Adjustment).',
  ];
  notices.forEach((line, idx) => {
    if (ny + idx * 5 < ph - 10) {
      doc.text(line, SAFE_MARGIN, ny + idx * 5);
    }
  });

  stampAllPageNumbers(doc);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `Quotation_${sanitizeFileName(quote.partyName)}_${sanitizeFileName(quote.quotationNo)}.pdf`,
    title: `Rate Quotation - ${quote.quotationNo}`,
    orientation,
  };
}

// ============================================================================
// 4. SECTION 194C DECLARATION
//    EXACT REQUIREMENT #5:
//    Display ONLY the Triangular DRC Logo at the TOP-LEFT corner,
//    STRICTLY NO Company Stamp or Signature at the bottom!
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

  // TOP-LEFT Triangular DRC Logo ONLY
  drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 24, 24);

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(company.companyName || 'DOLPHIN ROAD CARRIER', SAFE_MARGIN + 28, SAFE_MARGIN + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(company.address || '', SAFE_MARGIN + 28, SAFE_MARGIN + 13.5);
  doc.text(`E-mail:- ${company.email || ''}   |   Mob: ${company.phones || ''}`, SAFE_MARGIN + 28, SAFE_MARGIN + 18.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DECLARATION UNDER SECTION 194 C FOR NON DEDUCTION OF TAX ON 01/04/2017', pw / 2, SAFE_MARGIN + 34, {
    align: 'center',
  });

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
    `I, Proprietor of M/S ${company.companyName} (Hereinafter "The Contractor") do hereby make the following declaration as required under Sub-section (6) of Section 194C of the Income Tax Act 1961 for receiving payments from the payer without deduction of tax at source :-`,
    cw - 4
  );
  doc.text(intro, SAFE_MARGIN + 2, SAFE_MARGIN + 84);

  const clauses = [
    '1. That we are authorized to make this declaration in the capacity of proprietor.',
    '2. That the contractor is engaged by the payer for hiring of goods carriage for its business.',
    '3. That the contractor does not own more than ten goods carriages (as defined in section 194C(6) of the Income-Tax Act 1961) as on date.',
    `4. That if the number of goods carriages owned by the contractor exceeds ten at any time during the financial year ${fy}, the contractor shall forthwith intimate the payer in writing.`,
    '5. That the Income-Tax Permanent Account Number (PAN) of Contractor is furnished below along with this declaration.',
  ];

  let cy = SAFE_MARGIN + 100;
  clauses.forEach((c) => {
    const wrapped = doc.splitTextToSize(c, cw - 8);
    doc.text(wrapped, SAFE_MARGIN + 4, cy);
    cy += wrapped.length * 4.8 + 2.2;
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
  doc.text(`Date  : ${formatDateDDMMYYYY(decl.declarationDate)}`, SAFE_MARGIN + 2, footerY + 6);

  if (assets.panCropDataUrl) {
    doc.addImage(
      assets.panCropDataUrl,
      getJsPdfImageFormat(assets.panCropDataUrl),
      SAFE_MARGIN + 2,
      footerY + 11,
      56,
      34,
      undefined,
      'FAST'
    );
  } else {
    doc.rect(SAFE_MARGIN + 2, footerY + 11, 56, 34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('INCOME TAX DEPARTMENT - INDIA', SAFE_MARGIN + 5, footerY + 18);
    doc.text('SUBHAJIT SAHA', SAFE_MARGIN + 5, footerY + 25);
    doc.text(`PAN: ${company.pan}`, SAFE_MARGIN + 5, footerY + 32);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('DECLARANT DETAILS', pw - SAFE_MARGIN - 30, footerY, { align: 'center' });
  doc.text('SUBHAJIT SAHA (Proprietor)', pw - SAFE_MARGIN - 30, footerY + 6, { align: 'center' });
  doc.text(`PAN NO : ${company.pan}`, pw - SAFE_MARGIN - 30, footerY + 12, { align: 'center' });
  // STRICT RULE #5: No stamp or digital signature image at the bottom of Section 194C Declaration.

  stampAllPageNumbers(doc);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `194C_Declaration_${sanitizeFileName(decl.partyName || 'Party')}_${sanitizeFileName(fy)}.pdf`,
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
    }
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
