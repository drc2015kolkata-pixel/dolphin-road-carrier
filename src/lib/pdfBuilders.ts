import { jsPDF } from 'jspdf';
import {
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

export type PdfTaskPayload =
  | {
      kind: 'invoice';
      invoice: Invoice;
      company: CompanySettings;
      includeAnnexure: boolean;
      orientation?: PdfOrientation;
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

function drawDiagonalWatermark(doc: jsPDF, text = 'DOLPHIN ROAD CARRIER') {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  doc.setTextColor(218, 227, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  doc.text(text, pageWidth / 2, pageHeight / 2 + 24, {
    align: 'center',
    angle: 35,
  });
  doc.restoreGraphicsState();
}

function getJsPdfImageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (/^data:image\/png/i.test(dataUrl)) return 'PNG';
  if (/^data:image\/webp/i.test(dataUrl)) return 'WEBP';
  return 'JPEG';
}

function drawTopLeftLogo(doc: jsPDF, assets: PdfAssets, x: number, y: number, w = 22, h = 22) {
  if (assets.logoDataUrl) {
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
  assets: PdfAssets,
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
  if (assets.stampDataUrl) {
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

function stampAllPageNumbers(doc: jsPDF, footerNote?: string) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    if (footerNote) {
      doc.setFont('helvetica', 'bolditalic');
      doc.text(footerNote, SAFE_MARGIN, ph - 5.5);
      doc.setFont('helvetica', 'normal');
    }
    doc.text(`Page ${i} of ${totalPages}`, pw - SAFE_MARGIN, ph - 5.5, { align: 'right' });
  }
}

export function buildPdfArrayBuffer(task: PdfTaskPayload): {
  buffer: ArrayBuffer;
  fileName: string;
  title: string;
  orientation: PdfOrientation;
} {
  if (task.kind === 'invoice') {
    return buildInvoiceDoc(
      task.invoice,
      task.company,
      task.includeAnnexure,
      task.assets,
      task.orientation || 'p'
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
  return buildTableReportDoc(task);
}

// ============================================================================
// 1. TAX INVOICE / BILL OF SUPPLY (Default A4 Portrait, Supports Landscape)
//    Logo TOP-LEFT · Company Stamp BOTTOM-RIGHT (Final Page) · Combined Multi-Page
// ============================================================================

function buildInvoiceDoc(
  invoice: Invoice,
  company: CompanySettings,
  includeAnnexure: boolean,
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
  const rows = invoice.consignmentRows || [];

  const drawHeader = (isContPage: boolean) => {
    if (assets.watermarkDataUrl) {
      doc.addImage(assets.watermarkDataUrl, 'JPEG', pw / 2 - 55, ph / 2 - 35, 110, 68, undefined, 'FAST');
    } else {
      drawDiagonalWatermark(doc);
    }

    // TOP-LEFT Triangular DRC Logo
    drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 22, 22);

    doc.setTextColor(15, 76, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(company.companyName, SAFE_MARGIN + 26, SAFE_MARGIN + 5);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(company.address, SAFE_MARGIN + 26, SAFE_MARGIN + 9.5);
    doc.text(`PAN - ${company.pan}   |   GSTIN - ${company.gstin}`, SAFE_MARGIN + 26, SAFE_MARGIN + 13.5);
    doc.text(`PH Nos. ${company.phones}   |   MSME/${company.msme}   HSN: ${company.hsn}`, SAFE_MARGIN + 26, SAFE_MARGIN + 17.5);

    doc.setTextColor(180, 35, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(
      isContPage
        ? 'T A X   I N V O I C E   ( C O N T I N U A T I O N )'
        : 'T A X   I N V O I C E   /   B I L L   O F   S U P P L Y',
      pw / 2,
      SAFE_MARGIN + 26,
      { align: 'center' }
    );

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.45);
    doc.line(SAFE_MARGIN, SAFE_MARGIN + 28.5, pw - SAFE_MARGIN, SAFE_MARGIN + 28.5);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('BILL TO,', SAFE_MARGIN + 1.5, SAFE_MARGIN + 33);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.partyName.toUpperCase(), SAFE_MARGIN + 1.5, SAFE_MARGIN + 37.5);
    const addrLines = doc.splitTextToSize((invoice.partyAddress || '').toUpperCase(), cw * 0.48);
    doc.text(addrLines.slice(0, 2), SAFE_MARGIN + 1.5, SAFE_MARGIN + 41.8);
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN : ${invoice.partyGstin || '-'}    PAN : ${invoice.partyPan || '-'}`, SAFE_MARGIN + 1.5, SAFE_MARGIN + 52);

    const metaX = SAFE_MARGIN + cw * 0.56;
    const colonX = metaX + 24;
    const valX = metaX + 27;
    doc.setFontSize(8.2);
    const metas = [
      ['INVOICE NO', invoice.invoiceNo],
      ['DATE', formatDateDDMMYYYY(invoice.invoiceDate)],
      ['SAC / FY', `${invoice.sac || company.hsn || '996791'} / ${invoice.financialYear || company.currentFy}`],
      ['GST NO', company.gstin],
      ['PAN NO', company.pan],
    ];
    metas.forEach(([k, v], i) => {
      const my = SAFE_MARGIN + 33 + i * 4.7;
      doc.setFont('helvetica', 'bold');
      doc.text(k, metaX, my);
      doc.text(':', colonX, my);
      doc.setFont('helvetica', 'normal');
      doc.text(String(v || '-'), valX, my);
    });

    doc.line(SAFE_MARGIN, SAFE_MARGIN + 54.5, pw - SAFE_MARGIN, SAFE_MARGIN + 54.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Consignment Details', pw / 2, SAFE_MARGIN + 58.5, { align: 'center' });

    return SAFE_MARGIN + 61;
  };

  const drawTableHeader = (startY: number) => {
    const x0 = SAFE_MARGIN;
    doc.setFillColor(241, 245, 249);
    doc.rect(x0, startY, cw, 6.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);
    const c = (pct: number) => x0 + cw * pct;
    doc.text('#', c(0.01), startY + 4.3);
    doc.text('CN. NO', c(0.045), startY + 4.3);
    doc.text('DATE', c(0.16), startY + 4.3);
    doc.text('VEHICLE', c(0.265), startY + 4.3);
    doc.text('FROM', c(0.38), startY + 4.3);
    doc.text('TO', c(0.495), startY + 4.3);
    doc.text('WT(MT)', c(0.65), startY + 4.3, { align: 'right' });
    doc.text('RATE', c(0.75), startY + 4.3, { align: 'right' });
    doc.text('FREIGHT', c(0.86), startY + 4.3, { align: 'right' });
    doc.text('DESCRIPTION', c(0.875), startY + 4.3);
    return startY + 6.2;
  };

  let curY = drawHeader(false);
  curY = drawTableHeader(curY);
  const rowH = 6.2;
  const maxContentY = ph - 22;

  rows.forEach((row, idx) => {
    if (curY + rowH > maxContentY) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.text('Continued on next page...', pw - SAFE_MARGIN, ph - 12, { align: 'right' });
      doc.addPage();
      curY = drawHeader(true);
      curY = drawTableHeader(curY);
    }
    const x0 = SAFE_MARGIN;
    const c = (pct: number) => x0 + cw * pct;
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x0, curY, cw, rowH, 'F');
    }
    doc.setDrawColor(203, 213, 225);
    doc.line(x0, curY + rowH, x0 + cw, curY + rowH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.9);
    doc.setTextColor(15, 23, 42);
    const ty = curY + 4.3;
    doc.text(`${idx + 1}.`, c(0.01), ty);
    doc.text((row.cnNo || '').slice(0, 15), c(0.045), ty);
    doc.text(formatDateDDMMYYYY(row.cnDate), c(0.16), ty);
    doc.text((row.vehicle || '').slice(0, 13), c(0.265), ty);
    doc.text((row.from || '').slice(0, 13), c(0.38), ty);
    doc.text((row.to || '').slice(0, 13), c(0.495), ty);
    doc.text(Number(row.weight || 0).toFixed(3), c(0.65), ty, { align: 'right' });
    doc.text(formatINR(row.ratePerMt || 0), c(0.75), ty, { align: 'right' });
    doc.text(formatINR(row.freight || 0), c(0.86), ty, { align: 'right' });
    doc.text((row.description || '').slice(0, orientation === 'l' ? 28 : 16), c(0.875), ty);
    curY += rowH;
  });

  // Final Totals + Bank + Bottom-Right Stamp (NEVER split summary box across pages!)
  const SUMMARY_BLOCK_HEIGHT = 126;
  if (curY + SUMMARY_BLOCK_HEIGHT > ph - 12) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.text('Totals & Stamp on next page...', pw - SAFE_MARGIN, ph - 12, { align: 'right' });
    doc.addPage();
    curY = drawHeader(true);
  }

  const boxTop = curY + 5;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(15, 23, 42);
  doc.text('FREIGHT & TAX DETAILS', pw / 2, boxTop - 1.2, { align: 'center' });

  const taxColW = cw * 0.4;
  const amtColW = cw * 0.19;
  const descColStart = SAFE_MARGIN + taxColW;
  const amtColStart = SAFE_MARGIN + cw - amtColW;

  doc.rect(SAFE_MARGIN, boxTop, cw, 56);
  doc.line(descColStart, boxTop, descColStart, boxTop + 56);
  doc.line(amtColStart, boxTop, amtColStart, boxTop + 56);
  doc.line(SAFE_MARGIN, boxTop + 6, SAFE_MARGIN + cw, boxTop + 6);

  doc.setFontSize(7.4);
  doc.text('TAX CALCULATION', SAFE_MARGIN + taxColW / 2, boxTop + 4.2, { align: 'center' });
  doc.text('PARTICULARS', descColStart + (amtColStart - descColStart) / 2, boxTop + 4.2, { align: 'center' });
  doc.text('AMOUNT (INR)', amtColStart + amtColW / 2, boxTop + 4.2, { align: 'center' });

  let ty = boxTop + 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.text(`Reverse Charge : ${invoice.reverseCharge ? 'Yes' : 'No'}`, SAFE_MARGIN + 2, ty);
  doc.setFont('helvetica', 'bold');
  doc.text(`GST % : ${Number(invoice.gstRate ?? 5).toFixed(2)}%`, SAFE_MARGIN + 2, ty + 5);
  doc.text(`CGST  : ${formatINR(invoice.cgstAmt || 0)}`, SAFE_MARGIN + 2, ty + 10);
  doc.text(`SGST  : ${formatINR(invoice.sgstAmt || 0)}`, SAFE_MARGIN + 2, ty + 15);
  doc.text(`IGST  : ${formatINR(invoice.igstAmt || 0)}`, SAFE_MARGIN + 2, ty + 20);
  doc.text(`TOTAL TAX : ${formatINR(invoice.totalTax || 0)}`, SAFE_MARGIN + 2, ty + 25);
  doc.setFontSize(6.7);
  doc.setFont('helvetica', 'normal');
  const taxWords = doc.splitTextToSize(amountToIndianWords(invoice.totalTax || 0), taxColW - 4);
  doc.text(taxWords.slice(0, 2), SAFE_MARGIN + 2, ty + 30);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `GST Paid By: ${invoice.reverseCharge ? invoice.partyName.toUpperCase() : company.companyName}`,
    SAFE_MARGIN + 2,
    ty + 40
  );

  const charges = [
    ['FREIGHT CHARGES', invoice.freightCharges || 0],
    ['DETENTION CHARGES', invoice.detentionCharges || 0],
    ['UNLOADING CHARGES', invoice.unloadingCharges || 0],
    ['ST CHARGES', invoice.stCharges || 0],
  ] as const;

  let cy = boxTop + 11.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  charges.forEach(([label, val]) => {
    if (Number(val) > 0 || label === 'FREIGHT CHARGES') {
      doc.text(label, descColStart + 4, cy);
      doc.text(Number(val).toFixed(2), SAFE_MARGIN + cw - 3, cy, { align: 'right' });
      cy += 5.5;
    }
  });

  doc.line(descColStart, boxTop + 44, SAFE_MARGIN + cw, boxTop + 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('GRAND TOTAL :', descColStart + 4, boxTop + 51);
  doc.text(formatINR(invoice.grandTotal || 0), SAFE_MARGIN + cw - 3, boxTop + 51, { align: 'right' });

  const wordsBarY = boxTop + 56;
  doc.rect(SAFE_MARGIN, wordsBarY, cw, 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.text(amountToIndianWords(invoice.grandTotal || 0), SAFE_MARGIN + 2, wordsBarY + 4.8);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL : Rs. ${formatINR(invoice.grandTotal || 0)}`, SAFE_MARGIN + cw - 2, wordsBarY + 4.8, {
    align: 'right',
  });

  const bankBoxY = wordsBarY + 7;
  doc.rect(SAFE_MARGIN, bankBoxY, cw, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text(`Bank   : ${company.bankName}`, SAFE_MARGIN + 2, bankBoxY + 5);
  doc.text(`Branch : ${company.bankBranch} (SWIFT: ${company.swift})`, SAFE_MARGIN + 2, bankBoxY + 9.8);
  doc.text(`A/c No : ${company.accountNo}`, SAFE_MARGIN + 2, bankBoxY + 14.6);
  doc.text(`IFSC   : ${company.ifsc}`, SAFE_MARGIN + 2, bankBoxY + 19.4);

  // BOTTOM-RIGHT Company Stamp & Signature on FINAL PAGE
  drawBottomRightStampAndSign(doc, assets, SAFE_MARGIN + cw, bankBoxY + 5.5, 29, 17);

  const remBoxY = bankBoxY + 28;
  doc.rect(SAFE_MARGIN, remBoxY, cw, 16);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text('REMARKS & TERMS :', SAFE_MARGIN + 2, remBoxY + 4.5);
  doc.setFont('helvetica', 'normal');
  const remLines = doc.splitTextToSize(
    `${invoice.remarks || '-'} | Payment Terms: 100% within 7 days (18% p.a. thereafter). Pay via A/C Payee NEFT/RTGS.`,
    cw - 4
  );
  doc.text(remLines.slice(0, 2), SAFE_MARGIN + 2, remBoxY + 9);

  // ANNEXURE inside same single combined PDF
  const annexRows =
    invoice.annexureLorries && invoice.annexureLorries.length > 0
      ? invoice.annexureLorries
      : rows.map((r) => ({ cnNo: r.cnNo, lorryNumbers: r.vehicle }));

  if (includeAnnexure && annexRows.length > 0) {
    const ANN_PER_PAGE = orientation === 'l' ? 16 : 24;
    const annPages = Math.ceil(annexRows.length / ANN_PER_PAGE);
    for (let ap = 0; ap < annPages; ap++) {
      doc.addPage();
      drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 20, 20);
      doc.setTextColor(15, 76, 129);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(`${company.companyName} — INVOICE ANNEXURE`, SAFE_MARGIN + 24, SAFE_MARGIN + 7);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        `Invoice: ${invoice.invoiceNo}  |  Party: ${invoice.partyName}  |  Date: ${formatDateDDMMYYYY(invoice.invoiceDate)}`,
        SAFE_MARGIN + 24,
        SAFE_MARGIN + 13
      );
      doc.line(SAFE_MARGIN, SAFE_MARGIN + 22, pw - SAFE_MARGIN, SAFE_MARGIN + 22);

      let ay = SAFE_MARGIN + 28;
      doc.setFillColor(241, 245, 249);
      doc.rect(SAFE_MARGIN, ay, cw, 6.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('CONSIGNMENT NO', SAFE_MARGIN + 4, ay + 4.5);
      doc.text('LORRY NUMBERS', SAFE_MARGIN + 65, ay + 4.5);
      ay += 9;

      const slice = annexRows.slice(ap * ANN_PER_PAGE, (ap + 1) * ANN_PER_PAGE);
      doc.setFont('helvetica', 'normal');
      slice.forEach((item) => {
        doc.text(String(item.cnNo || '-'), SAFE_MARGIN + 4, ay);
        doc.text(String(item.lorryNumbers || '-'), SAFE_MARGIN + 65, ay);
        ay += 6.2;
      });

      if (ap === annPages - 1) {
        drawBottomRightStampAndSign(doc, assets, pw - SAFE_MARGIN, ph - 38, 28, 17);
      }
    }
  }

  stampAllPageNumbers(doc, 'THIS IS A SYSTEM GENERATED PRINT AUTHORISED BY DOLPHIN ROAD CARRIER.');

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(invoice.partyName)}_${sanitizeFileName(invoice.invoiceNo)}.pdf`,
    title: `Tax Invoice - ${invoice.invoiceNo}`,
    orientation,
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

  const copies = ['CONSIGNEE COPY', 'LORRY COPY', 'TRANSPORTER COPY'] as const;

  const allVehicles = [
    cn.truckNo,
    ...(cn.extraVehicles || []).map((v) => v.trim()).filter(Boolean),
  ].filter(Boolean);
  const allInvoices = [
    ...(cn.taxInvNo ? [{ no: cn.taxInvNo, date: cn.taxInvDate || '', value: cn.valueOfGoods }] : []),
    ...(cn.extraTaxInvoices || []).filter((x) => x.no.trim()),
  ];
  const allEwbs = [
    ...(cn.ewayBillNo ? [{ no: cn.ewayBillNo, date: cn.ewayBillDate || '' }] : []),
    ...(cn.extraEwayBills || []).filter((x) => x.no.trim()),
  ];

  const hasOverflowSchedule =
    allVehicles.length > 2 || allInvoices.length > 2 || allEwbs.length > 2;

  copies.forEach((copyLabel, idx) => {
    if (idx > 0) doc.addPage();
    drawDiagonalWatermark(doc, 'DOLPHIN ROAD CARRIER');

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
    doc.text('!! OM SAI RAM !!', x0 + cw / 2, y0 + 4.5, { align: 'center' });
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

    const row1Y = y0 + 29;
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.35);

    const b1W = cw * 0.27;
    const b2W = cw * 0.34;
    const b3W = cw - b1W - b2W;

    doc.rect(x0, row1Y, b1W, 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text(`C/N No   : ${cn.cnNo}`, x0 + 2.5, row1Y + 5.5);
    doc.text(`C/N Date : ${formatDateDDMMYYYY(cn.cnDate)}`, x0 + 2.5, row1Y + 11);
    doc.setFontSize(7.4);
    doc.text(`FY: ${cn.financialYear || company.currentFy}`, x0 + 2.5, row1Y + 15.5);
    doc.text(`Delivery Office: ${(cn.deliveryOffice || cn.toCity || '').slice(0, 22)}`, x0 + 2.5, row1Y + 19.5);

    doc.rect(x0 + b1W, row1Y, b2W, 22);
    doc.setFont('helvetica', 'bold');
    doc.text('INSURANCE & VALUE', x0 + b1W + b2W / 2, row1Y + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const insLines = doc.splitTextToSize(
      cn.insuranceStatus || 'The Customer has not insured the consignment',
      b2W - 5
    );
    doc.text(insLines.slice(0, 2), x0 + b1W + 2.5, row1Y + 10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Value of Goods Rs.: ${formatINR(cn.valueOfGoods || 0)}`, x0 + b1W + 2.5, row1Y + 19.5);

    doc.rect(x0 + b1W + b2W, row1Y, b3W, 22);
    doc.setFontSize(7.4);
    const invSummary = allInvoices.length > 0
      ? allInvoices.slice(0, 2).map((x) => x.no).join(', ') + (allInvoices.length > 2 ? ` (+${allInvoices.length - 2} more)` : '')
      : '-';
    const ewbSummary = allEwbs.length > 0
      ? allEwbs.slice(0, 2).map((x) => x.no).join(', ') + (allEwbs.length > 2 ? ` (+${allEwbs.length - 2} more)` : '')
      : '-';
    doc.text(`TAX INV. No : ${invSummary.slice(0, 34)}`, x0 + b1W + b2W + 2.5, row1Y + 5.5);
    doc.text(`INV. DATE   : ${formatDateDDMMYYYY(cn.taxInvDate) || '-'}`, x0 + b1W + b2W + 2.5, row1Y + 10.5);
    doc.text(`E-WAY BILL  : ${ewbSummary.slice(0, 34)}`, x0 + b1W + b2W + 2.5, row1Y + 15.5);
    doc.text(`ROUTE       : ${cn.fromCity} -> ${cn.toCity}`, x0 + b1W + b2W + 2.5, row1Y + 20);

    // Parties + Vehicles Box
    const row2Y = row1Y + 22;
    const leftPartyW = cw * 0.61;
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
    doc.setFontSize(7.8);
    const vehSummary = allVehicles.join(', ');
    doc.text(`TRUCK NO(S)   : ${vehSummary.slice(0, 28)}`, x0 + leftPartyW + 2.5, row2Y + 5.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.1);
    doc.text(`Owner's Name  : ${cn.ownerName || '-'}`, x0 + leftPartyW + 2.5, row2Y + 10);
    doc.text(`Driver's Name : ${cn.driverName || '-'}`, x0 + leftPartyW + 2.5, row2Y + 14.5);
    doc.text(`Driver D/L No : ${cn.driverDlNo || '-'}`, x0 + leftPartyW + 2.5, row2Y + 19);
    doc.text(`Engine/Chassis: ${cn.engineNo || '-'} / ${cn.chassisNo || '-'}`, x0 + leftPartyW + 2.5, row2Y + 23.5);

    // Goods & Freight Table
    const tblY = row2Y + 26;
    const tblH = orientation === 'l' ? 48 : 66;
    doc.rect(x0, tblY, cw, tblH);
    const c1 = x0 + cw * 0.11;
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
    doc.text('Pkgs', (x0 + c1) / 2, tblY + 5, { align: 'center' });
    doc.text('PARTICULARS (SAID TO CONTAIN)', (c1 + c2) / 2, tblY + 5, { align: 'center' });
    doc.text('WEIGHT (MT)', (c2 + c3) / 2, tblY + 5, { align: 'center' });
    doc.text('CHARGES', (c3 + c4) / 2, tblY + 5, { align: 'center' });
    doc.text('FREIGHT', (c4 + x0 + cw) / 2, tblY + 5, { align: 'center' });

    doc.setFontSize(10);
    doc.text(cn.packages || '-', (x0 + c1) / 2, tblY + 18, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    const partLines = doc.splitTextToSize(cn.particulars || '-', c2 - c1 - 5);
    doc.text(partLines.slice(0, 6), c1 + 2.5, tblY + 13.5);

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
    doc.text(`GST: ${cn.gstPaidBy || 'Consignee'}`, c4 + 2, tblY + 34);

    // EXTRA-LARGE WIDE REMARKS BOX inside LR
    const remY = tblY + tblH;
    const remH = orientation === 'l' ? 28 : 42;
    doc.rect(x0, remY, cw, remH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('REMARKS / SPECIAL INSTRUCTIONS :', x0 + 2.5, remY + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const largeRemarksText = [
      cn.remarks || '',
      hasOverflowSchedule
        ? `Attached Multi-Items: Vehicles(${allVehicles.length}), Tax Invoices(${allInvoices.length}), E-Way Bills(${allEwbs.length}) — see attached schedule sheet.`
        : '',
    ]
      .filter(Boolean)
      .join(' | ');
    const lrRemLines = doc.splitTextToSize(largeRemarksText || '-', cw - 6);
    doc.text(lrRemLines.slice(0, orientation === 'l' ? 4 : 6), x0 + 2.5, remY + 10);

    // Copy Footer + Checkboxes + BOTTOM-RIGHT Stamp
    const footY = remY + remH + 3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text(
      'Conditions: Sender declares packages contain declared lawful goods only. Transporter is not liable for leakage/breakage/overload.',
      x0 + 2.5,
      footY + 2
    );

    const checkboxItems = [
      'CONSIGNER COPY',
      'CONSIGNEE COPY',
      'LORRY COPY',
      'TRANSPORTER COPY',
    ] as const;

    let cx = x0 + 2.5;
    const cbSpacing = orientation === 'l' ? 42 : 34;
    checkboxItems.forEach((lbl) => {
      const checked = lbl === copyLabel;
      doc.setDrawColor(15, 23, 42);
      doc.rect(cx, footY + 7, 3.6, 3.6);
      if (checked) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text('X', cx + 0.8, footY + 10);
      }
      doc.setFont('helvetica', checked ? 'bold' : 'normal');
      doc.setFontSize(7);
      doc.text(lbl, cx + 4.8, footY + 10);
      cx += cbSpacing;
    });

    // Company Stamp BOTTOM-RIGHT corner
    drawBottomRightStampAndSign(doc, assets, x0 + cw - 2, y0 + ch - 23, 27, 16);
  });

  // Continuation Schedule Page inside the SAME Single Combined PDF if multiple Vehicles / Invoices / EWBs
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
    fileName: `LR_${sanitizeFileName(cn.cnNo)}_3Copies.pdf`,
    title: `Consignment Note (3 Copies) - ${cn.cnNo}`,
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

  drawDiagonalWatermark(doc, 'D.R.C QUOTATION');

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
  doc.text(`M/S ${company.companyName}`, SAFE_MARGIN, SAFE_MARGIN + 31);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.text(company.address, SAFE_MARGIN, SAFE_MARGIN + 36);
  doc.text(`GSTIN: ${company.gstin}`, SAFE_MARGIN, SAFE_MARGIN + 40.5);

  doc.text(`M: ${company.phones}`, pw - SAFE_MARGIN, SAFE_MARGIN + 31, { align: 'right' });
  doc.text(`Date: ${formatDateDDMMYYYY(quote.quotationDate)}`, pw - SAFE_MARGIN, SAFE_MARGIN + 36, { align: 'right' });
  doc.text(`Ref No: ${quote.quotationNo}`, pw - SAFE_MARGIN, SAFE_MARGIN + 40.5, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Subject: ${quote.subject || 'To Vehicles Freight Rate Quotation'}`, pw / 2, SAFE_MARGIN + 48, {
    align: 'center',
  });
  doc.line(SAFE_MARGIN, SAFE_MARGIN + 51, pw - SAFE_MARGIN, SAFE_MARGIN + 51);

  doc.text('Quotation For:', SAFE_MARGIN, SAFE_MARGIN + 57);
  doc.text(`M/S ${quote.partyName}`, SAFE_MARGIN, SAFE_MARGIN + 62);
  doc.setFont('helvetica', 'normal');
  doc.text(quote.partyAddress || '-', SAFE_MARGIN, SAFE_MARGIN + 67);
  doc.setFont('helvetica', 'bold');
  doc.text(`GSTIN: ${quote.partyGstin || '-'}`, SAFE_MARGIN, SAFE_MARGIN + 73);

  doc.text('Quotation Validity:', pw - SAFE_MARGIN, SAFE_MARGIN + 57, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(quote.validityText || '7 Days', pw - SAFE_MARGIN, SAFE_MARGIN + 62, { align: 'right' });

  const rows: Array<[string, string]> = [
    ['Vehicle Type', quote.vehicleType],
    ['Freight', `Rs. ${formatINR(quote.freight)}`],
    ['Loading Charges', quote.loadingCharge || 'NO Extra Charges'],
    ['Unloading Charges', quote.unloadingCharge || 'YES Extra Charges'],
    ['Parking', quote.parkingCharge || 'YES Extra Charges'],
    ['Detention', quote.detentionCharge || 'YES Extra Charges'],
    ['Ton Guarantee', quote.tonGuarantee || '09 TON Loading Capacity'],
    ['Destination', quote.destination],
    ['Advance Pay', quote.advancePay || 'No Advance Before Lorry Loading'],
    ['Entry Point', quote.entryPoint || 'As Applicable'],
  ];

  let ty = SAFE_MARGIN + 80;
  const labelW = cw * 0.28;
  const valW = cw - labelW;
  const rowH = orientation === 'l' ? 5.8 : 7;
  doc.setLineWidth(0.3);

  rows.forEach(([k, v]) => {
    doc.rect(SAFE_MARGIN, ty, labelW, rowH);
    doc.rect(SAFE_MARGIN + labelW, ty, valW, rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text(k, SAFE_MARGIN + 2.5, ty + rowH - 2.1);
    doc.setFont('helvetica', 'normal');
    doc.text(v, SAFE_MARGIN + labelW + 3, ty + rowH - 2.1);
    ty += rowH;
  });

  ty += 4;
  if (ty + 48 > ph - 12) {
    doc.addPage();
    ty = SAFE_MARGIN + 10;
  }

  doc.rect(SAFE_MARGIN, ty, cw * 0.52, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text('Bank Details', SAFE_MARGIN + 2.5, ty + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(`A/C Name   : ${company.companyName}`, SAFE_MARGIN + 2.5, ty + 11);
  doc.text(`Bank Name  : ${company.bankName}`, SAFE_MARGIN + 2.5, ty + 16);
  doc.text(`A/C No     : ${company.accountNo}`, SAFE_MARGIN + 2.5, ty + 21);
  doc.text(`IFSC Code  : ${company.ifsc} (${company.bankBranch})`, SAFE_MARGIN + 2.5, ty + 26);

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

  drawDiagonalWatermark(doc, 'Dolphin Road Carrier');

  // TOP-LEFT Triangular DRC Logo ONLY
  drawTopLeftLogo(doc, assets, SAFE_MARGIN, SAFE_MARGIN, 24, 24);

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(company.companyName, SAFE_MARGIN + 28, SAFE_MARGIN + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(company.address, SAFE_MARGIN + 28, SAFE_MARGIN + 13.5);
  doc.text(`E-mail:- ${company.email}   |   Mob: ${company.phones}`, SAFE_MARGIN + 28, SAFE_MARGIN + 18.5);

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
    drawDiagonalWatermark(doc, 'DOLPHIN ROAD CARRIER');

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
