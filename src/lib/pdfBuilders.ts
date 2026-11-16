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
      assets: PdfAssets;
    }
  | {
      kind: 'lr3copy';
      cn: ConsignmentNote;
      company: CompanySettings;
      assets: PdfAssets;
    }
  | {
      kind: 'quotation';
      quote: Quotation;
      company: CompanySettings;
      assets: PdfAssets;
    }
  | {
      kind: 'declaration194c';
      decl: Declaration194C;
      company: CompanySettings;
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
      assets: PdfAssets;
    };

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

function drawRoundStampAndSign(
  doc: jsPDF,
  assets: PdfAssets,
  x: number,
  y: number,
  width = 30,
  height = 22
) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('FOR DOLPHIN ROAD CARRIER', x + width / 2, y - 2, { align: 'center' });
  if (assets.stampDataUrl) {
    doc.addImage(assets.stampDataUrl, 'JPEG', x, y, width, height, undefined, 'FAST');
  } else {
    doc.setDrawColor(29, 78, 216);
    doc.circle(x + width / 2, y + height / 2, 10);
    doc.setFontSize(6);
    doc.text('DOLPHIN ROAD CARRIER', x + width / 2, y + height / 2, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Authorised Signatory', x + width / 2, y + height + 4, { align: 'center' });
}

export function buildPdfArrayBuffer(task: PdfTaskPayload): {
  buffer: ArrayBuffer;
  fileName: string;
  title: string;
} {
  if (task.kind === 'invoice') {
    return buildInvoiceDoc(task.invoice, task.company, task.includeAnnexure, task.assets);
  }
  if (task.kind === 'lr3copy') {
    return buildLR3CopyDoc(task.cn, task.company, task.assets);
  }
  if (task.kind === 'quotation') {
    return buildQuotationDoc(task.quote, task.company, task.assets);
  }
  if (task.kind === 'declaration194c') {
    return buildDeclaration194CDoc(task.decl, task.company, task.assets);
  }
  return buildTableReportDoc(task);
}

function buildInvoiceDoc(
  invoice: Invoice,
  company: CompanySettings,
  includeAnnexure: boolean,
  assets: PdfAssets
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const rows = invoice.consignmentRows || [];
  const ROWS_PER_PAGE = 9;
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  const drawInvoiceHeader = (pageIndex: number) => {
    if (assets.logoDataUrl) {
      doc.addImage(assets.logoDataUrl, 'JPEG', 12, 10, 26, 20, undefined, 'FAST');
    }
    doc.setTextColor(15, 76, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(company.companyName, 108, 14, { align: 'center' });

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(company.address, 42, 19);
    doc.text(`KOLKATA - 700090    PAN - ${company.pan}`, 42, 23);
    doc.text(`GSTIN - ${company.gstin}`, 42, 27);
    doc.text(`PH Nos. ${company.phones}`, 42, 31);
    doc.text(`MSME/${company.msme}   HSN: ${company.hsn}`, 42, 35);

    doc.setTextColor(180, 35, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('T A X   I N V O I C E   /   B I L L   O F   S U P P L Y', 112, 40, { align: 'center' });

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.line(10, 42.5, 200, 42.5);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('BILL TO,', 12, 47);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.partyName.toUpperCase(), 12, 52);
    const addrLines = doc.splitTextToSize((invoice.partyAddress || '').toUpperCase(), 92);
    doc.text(addrLines, 12, 56.5);

    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN : ${invoice.partyGstin || '-'}`, 12, 68);
    doc.text(`PAN   : ${invoice.partyPan || '-'}`, 68, 68);

    doc.setFontSize(8.5);
    const metaX = 122;
    const valX = 152;
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE NO', metaX, 47);
    doc.text(':', 148, 47);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.invoiceNo, valX, 47);

    doc.setFont('helvetica', 'bold');
    doc.text('DATE', metaX, 52);
    doc.text(':', 148, 52);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDateDDMMYYYY(invoice.invoiceDate), valX, 52);

    doc.setFont('helvetica', 'bold');
    doc.text('SAC', metaX, 57);
    doc.text(':', 148, 57);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.sac || company.hsn || '996791', valX, 57);

    doc.setFont('helvetica', 'bold');
    doc.text('GST NO', metaX, 62);
    doc.text(':', 148, 62);
    doc.setFont('helvetica', 'normal');
    doc.text(company.gstin, valX, 62);

    doc.setFont('helvetica', 'bold');
    doc.text('PAN NO', metaX, 67);
    doc.text(':', 148, 67);
    doc.setFont('helvetica', 'normal');
    doc.text(company.pan, valX, 67);

    if (totalPages > 1) {
      doc.setFontSize(7.5);
      doc.text(`Page ${pageIndex + 1} of ${totalPages}`, 198, 40, { align: 'right' });
    }

    doc.line(10, 70.5, 200, 70.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Consignment Details', 105, 74.5, { align: 'center' });
  };

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) doc.addPage();
    if (assets.watermarkDataUrl) {
      doc.addImage(assets.watermarkDataUrl, 'JPEG', 38, 118, 134, 82, undefined, 'FAST');
    } else {
      drawDiagonalWatermark(doc);
    }

    drawInvoiceHeader(p);

    const startY = 77;
    doc.setLineWidth(0.3);
    doc.line(10, startY, 200, startY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('#', 11.5, startY + 4);
    doc.text('CN. NO', 17, startY + 4);
    doc.text('C.N.DATE', 38, startY + 4);
    doc.text('VEHICLE', 57, startY + 4);
    doc.text('FROM', 78, startY + 4);
    doc.text('TO', 99, startY + 4);
    doc.text('Weight', 124, startY + 4);
    doc.text('Rate/MT', 140, startY + 4);
    doc.text('FREIGHT', 157, startY + 4);
    doc.text('DESCRIPTION', 176, startY + 4);
    doc.line(10, startY + 6, 200, startY + 6);

    const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    let y = startY + 10.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);

    slice.forEach((row, idx) => {
      const globalIdx = p * ROWS_PER_PAGE + idx + 1;
      doc.text(String(globalIdx) + '.', 11.5, y);
      doc.text((row.cnNo || '').slice(0, 14), 17, y);
      doc.text(formatDateDDMMYYYY(row.cnDate), 38, y);
      doc.text((row.vehicle || '').slice(0, 12), 57, y);
      doc.text((row.from || '').slice(0, 12), 78, y);
      doc.text((row.to || '').slice(0, 13), 99, y);
      doc.text(Number(row.weight || 0).toFixed(3), 135, y, { align: 'right' });
      doc.text(formatINR(row.ratePerMt || 0), 153, y, { align: 'right' });
      doc.text(formatINR(row.freight || 0), 173, y, { align: 'right' });
      doc.text((row.description || '').slice(0, 15), 176, y);
      y += 6.2;
    });

    const tableEndY = Math.max(y + 2, 134);
    doc.setLineWidth(0.4);
    doc.line(10, tableEndY, 200, tableEndY);

    if (p < totalPages - 1) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.text('Continued on next page...', 195, tableEndY + 6, { align: 'right' });
      continue;
    }

    const boxTop = tableEndY + 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('FREIGHT DETAILS', 105, boxTop - 1, { align: 'center' });

    doc.setLineWidth(0.35);
    doc.rect(10, boxTop, 190, 68);
    doc.line(82, boxTop, 82, boxTop + 68);
    doc.line(10, boxTop + 6, 200, boxTop + 6);
    doc.line(166, boxTop, 166, boxTop + 68);

    doc.setFontSize(7.5);
    doc.text('TAX CALCULATION DETAILS', 46, boxTop + 4.2, { align: 'center' });
    doc.text('DESCRIPTION', 124, boxTop + 4.2, { align: 'center' });
    doc.text('AMOUNT', 183, boxTop + 4.2, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const ty = boxTop + 11;
    doc.text(`Subjected to Reverse Charge : ${invoice.reverseCharge ? 'Yes' : 'No'}`, 12, ty);
    doc.setFont('helvetica', 'bold');
    doc.text('GST %    :', 12, ty + 5);
    doc.text(`${Number(invoice.gstRate ?? 5).toFixed(2)}%`, 46, ty + 5);
    doc.text('CGST Amt :', 12, ty + 10);
    doc.text(formatINR(invoice.cgstAmt || 0), 56, ty + 10, { align: 'right' });
    doc.text('SGST Amt :', 12, ty + 15);
    doc.text(formatINR(invoice.sgstAmt || 0), 56, ty + 15, { align: 'right' });
    doc.text('IGST Amt :', 12, ty + 20);
    doc.text(formatINR(invoice.igstAmt || 0), 56, ty + 20, { align: 'right' });
    doc.text('TOTAL    :', 12, ty + 25);
    doc.text(formatINR(invoice.totalTax || 0), 56, ty + 25, { align: 'right' });

    doc.setFontSize(6.8);
    const taxWords = doc.splitTextToSize(amountToIndianWords(invoice.totalTax || 0), 68);
    doc.text(taxWords, 12, ty + 30);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('GST paid by:', 12, ty + 41);
    doc.text(invoice.reverseCharge ? invoice.partyName.toUpperCase() : company.companyName, 12, ty + 45.5);

    const fy = boxTop + 11;
    const charges = [
      ['FREIGHT CHARGES', invoice.freightCharges || 0],
      ['DETENTION CHARGES', invoice.detentionCharges || 0],
      ['UNLOADING CHARGES', invoice.unloadingCharges || 0],
      ['ST CHARGES', invoice.stCharges || 0],
    ] as const;

    let cy = fy;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    charges.forEach(([label, val]) => {
      if (Number(val) > 0 || label === 'FREIGHT CHARGES') {
        doc.text(label, 108, cy);
        doc.text(Number(val).toFixed(2), 196, cy, { align: 'right' });
        cy += 5.2;
      }
    });

    doc.line(166, boxTop + 44, 200, boxTop + 44);
    doc.setFont('helvetica', 'bold');
    doc.text('GRAND TOTAL:', 142, boxTop + 49);
    doc.text(Number(invoice.grandTotal || 0).toFixed(2), 196, boxTop + 49, { align: 'right' });

    const wordsBarY = boxTop + 68;
    doc.rect(10, wordsBarY, 190, 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(amountToIndianWords(invoice.grandTotal || 0), 12, wordsBarY + 4.8);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL :   ${formatINR(invoice.grandTotal || 0)}`, 197, wordsBarY + 4.8, { align: 'right' });

    const bankBoxY = wordsBarY + 7;
    doc.rect(10, bankBoxY, 190, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(`Bank   :  ${company.bankName}`, 12, bankBoxY + 5);
    doc.text(`Branch :  ${company.bankBranch}`, 12, bankBoxY + 9.5);
    doc.text(`          SWIFT CODE- ${company.swift}`, 12, bankBoxY + 14);
    doc.text(`A/c No :  ${company.accountNo}`, 12, bankBoxY + 18.5);
    doc.text(`IFSC   :  ${company.ifsc}`, 12, bankBoxY + 23);

    drawRoundStampAndSign(doc, assets, 152, bankBoxY + 5, 28, 17);

    const remBoxY = bankBoxY + 26;
    doc.rect(10, remBoxY, 190, 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('REMARKS :', 12, remBoxY + 5);
    doc.setFont('helvetica', 'normal');
    const remLines = doc.splitTextToSize(invoice.remarks || '-', 180);
    doc.text(remLines, 12, remBoxY + 9.5);

    const termsY = remBoxY + 22;
    doc.rect(10, termsY, 190, 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.text('If the bill is not paid within 7 days interest will be charged @18% per annum.', 12, termsY + 4.5);
    doc.text('Payment Terms : 100% payment after delivery. No DISCOUNT. No ADJUSTMENT.', 12, termsY + 8.8);
    doc.text('Please pay by A/C Payee cheque, NEFT, RTGS.', 12, termsY + 12.8);

    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(7.5);
    doc.text('THIS IS A SYSTEM GENERATED PRINT AUTHORISED BY DOLPHIN ROAD CARRIER.', 105, 287, {
      align: 'center',
    });
  }

  if (includeAnnexure && (invoice.annexureLorries?.length || rows.length > 0)) {
    doc.addPage();
    if (assets.watermarkDataUrl) {
      doc.addImage(assets.watermarkDataUrl, 'JPEG', 38, 118, 134, 82, undefined, 'FAST');
    } else {
      drawDiagonalWatermark(doc);
    }

    if (assets.logoDataUrl) {
      doc.addImage(assets.logoDataUrl, 'JPEG', 12, 10, 26, 20, undefined, 'FAST');
    }
    doc.setTextColor(15, 76, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(company.companyName, 108, 14, { align: 'center' });
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`${company.address} | PAN: ${company.pan} | GSTIN: ${company.gstin}`, 42, 21);
    doc.text(`PH Nos. ${company.phones} | MSME/${company.msme} HSN: ${company.hsn}`, 42, 26);

    doc.setTextColor(180, 35, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('I-N-V-O-I-C-E   A-N-N-E-X-U-R-E   D-E-T-A-I-L-S', 112, 35, { align: 'center' });

    doc.setDrawColor(15, 23, 42);
    doc.line(10, 38, 200, 38);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.text('BILL TO,', 12, 43);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.partyName.toUpperCase(), 12, 48);
    doc.text((invoice.partyAddress || '').toUpperCase(), 12, 53);
    doc.text(`GSTIN: ${invoice.partyGstin || '-'}   PAN: ${invoice.partyPan || '-'}`, 12, 62);

    doc.setFont('helvetica', 'bold');
    doc.text(`INVOICE NO : ${invoice.invoiceNo}`, 130, 43);
    doc.text(`DATE       : ${formatDateDDMMYYYY(invoice.invoiceDate)}`, 130, 48);
    doc.text(`GST NO     : ${company.gstin}`, 130, 53);
    doc.text(`PAN NO     : ${company.pan}`, 130, 58);

    doc.line(10, 66, 200, 66);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('ADDITIONAL LORRY DETAILS', 105, 71, { align: 'center' });

    doc.rect(10, 74, 190, 175);
    doc.setFontSize(8);
    doc.text('CONSIGNMENT NOTES', 18, 82);
    doc.text('LORRY NUMBERS', 82, 82);

    const annexRows =
      invoice.annexureLorries && invoice.annexureLorries.length > 0
        ? invoice.annexureLorries
        : rows.map((r) => ({ cnNo: r.cnNo, lorryNumbers: r.vehicle }));

    let ay = 89;
    doc.setFont('helvetica', 'normal');
    annexRows.slice(0, 22).forEach((item) => {
      doc.text(item.cnNo, 18, ay);
      doc.text(item.lorryNumbers, 82, ay);
      ay += 6.5;
    });

    doc.line(10, 220, 200, 220);
    drawRoundStampAndSign(doc, assets, 154, 227, 28, 17);

    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(7.5);
    doc.text('THIS IS A SYSTEM GENERATED PRINT AUTHORISED BY DOLPHIN ROAD CARRIER.', 105, 287, {
      align: 'center',
    });
  }

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `${sanitizeFileName(invoice.partyName)}_${sanitizeFileName(invoice.invoiceNo)}.pdf`,
    title: `Tax Invoice - ${invoice.invoiceNo}`,
  };
}

function buildLR3CopyDoc(cn: ConsignmentNote, company: CompanySettings, assets: PdfAssets) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const copies = ['CONSIGNEE COPY', 'LORRY COPY', 'TRANSPORTER COPY'] as const;

  copies.forEach((copyLabel, idx) => {
    if (idx > 0) doc.addPage();
    drawDiagonalWatermark(doc, 'DOLPHIN ROAD CARRIER');

    doc.setDrawColor(140, 24, 24);
    doc.setLineWidth(0.6);
    doc.rect(10, 10, 277, 190);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`GSTIN : ${company.gstin}`, 14, 15);
    doc.text(`PAN   : ${company.pan}`, 14, 19);

    doc.text('!! OM SAI RAM !!', 148.5, 14.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text("Subject to Kolkata Jurisdiction | Goods Receipt at Owner's Risk", 148.5, 18.5, {
      align: 'center',
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Subhajit Saha', 282, 15, { align: 'right' });
    doc.text(`Mob.: ${company.phones}`, 282, 19, { align: 'right' });

    if (assets.logoDataUrl) {
      doc.addImage(assets.logoDataUrl, 'JPEG', 14, 22, 24, 18, undefined, 'FAST');
    }

    doc.setTextColor(175, 25, 25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text(company.companyName, 148.5, 29, { align: 'center' });
    doc.setFontSize(9.5);
    doc.text('FASTEST AND BETTER DELIVERY', 148.5, 34, { align: 'center' });
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${company.address}   E-mail: ${company.email}`, 148.5, 39, { align: 'center' });

    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.4);
    doc.line(10, 42, 287, 42);

    doc.rect(10, 42, 75, 24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(`C/N No   : ${cn.cnNo}`, 13, 48);
    doc.text(`C/N Date : ${formatDateDDMMYYYY(cn.cnDate)}`, 13, 54);
    doc.setFontSize(7.5);
    doc.text(`Delivery Office: ${cn.deliveryOffice || cn.toCity}`, 13, 61);

    doc.rect(85, 42, 95, 24);
    doc.setFont('helvetica', 'bold');
    doc.text('INSURANCE', 132.5, 47, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(cn.insuranceStatus || 'The Customer has not insured the consignment', 88, 53);
    doc.text(`Value of Goods Rs.: ${formatINR(cn.valueOfGoods || 0)}`, 88, 61);

    doc.rect(180, 42, 107, 24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(`TAX INV. No : ${cn.taxInvNo || '-'}`, 183, 48);
    doc.text(`TAX INV. DT : ${formatDateDDMMYYYY(cn.taxInvDate) || '-'}`, 183, 53.5);
    doc.text(`E-WAY BILL  : ${cn.ewayBillNo || '-'} (${formatDateDDMMYYYY(cn.ewayBillDate) || '-'})`, 183, 59);
    doc.text(`FROM: ${cn.fromCity}   TO: ${cn.toCity}`, 183, 64);

    doc.rect(10, 66, 170, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`Consignor's Name & Address : ${cn.consignorName}`, 13, 72);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`${cn.consignorAddress || '-'} | GSTIN: ${cn.consignorGstin || '-'}`, 13, 76.5);
    doc.line(10, 80, 180, 80);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`Consignee's Name & Address : ${cn.consigneeName}`, 13, 85.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`${cn.consigneeAddress || '-'} | GSTIN: ${cn.consigneeGstin || '-'}`, 13, 90);

    doc.rect(180, 66, 107, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`TRUCK NO.     : ${cn.truckNo}`, 183, 72);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Owner's Name  : ${cn.ownerName || '-'}`, 183, 77);
    doc.text(`Driver's Name : ${cn.driverName || '-'}`, 183, 82);
    doc.text(`Driver D/L No : ${cn.driverDlNo || '-'}`, 183, 87);
    doc.text(`Engine/Chassis: ${cn.engineNo || '-'} / ${cn.chassisNo || '-'}`, 183, 92);

    doc.rect(10, 94, 277, 68);
    doc.line(42, 94, 42, 162);
    doc.line(156, 94, 156, 162);
    doc.line(192, 94, 192, 162);
    doc.line(232, 94, 232, 162);
    doc.line(10, 102, 287, 102);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('No. of Pkgs', 26, 99, { align: 'center' });
    doc.text('PARTICULARS (SAID TO CONTAIN)', 99, 99, { align: 'center' });
    doc.text('WEIGHT (MT)', 174, 99, { align: 'center' });
    doc.text('CHARGES BREAKUP', 212, 99, { align: 'center' });
    doc.text('FREIGHT & BILLING', 259.5, 99, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(cn.packages || '-', 26, 118, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const partLines = doc.splitTextToSize(cn.particulars || '-', 108);
    doc.text(partLines, 46, 112);

    doc.setFontSize(8.5);
    doc.text(`Nett  : ${Number(cn.nettWeight || 0).toFixed(3)}`, 160, 112);
    doc.text(`Gross : ${Number(cn.grossWeight || 0).toFixed(3)}`, 160, 122);

    doc.setFontSize(7.8);
    doc.text(`Loading Ch.   : ${formatINR(cn.loadingCharge || 0)}`, 195, 110);
    doc.text(`Unloading Ch. : ${formatINR(cn.unloadingCharge || 0)}`, 195, 117);
    doc.text(`Return Lorry  : ${formatINR(cn.returnLorryCharge || 0)}`, 195, 124);
    doc.text(`S.TT Charge   : ${formatINR(cn.sttCharge || 0)}`, 195, 131);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(`Total Freight : Rs. ${formatINR(cn.totalFreight)}`, 236, 112);
    doc.setFont('helvetica', 'normal');
    doc.text(`Paid          : Rs. ${formatINR(cn.paidAmount || 0)}`, 236, 120);
    doc.text(`To Pay        : Rs. ${formatINR(cn.toPayAmount || 0)}`, 236, 128);
    doc.setFont('helvetica', 'bold');
    doc.text(`GST Paid By   : ${cn.gstPaidBy || 'Consignee'}`, 236, 140);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.text(
      'Conditions: We the sender of goods declared that the above said packages contain nothing else but declared goods. Sender is responsible for overload & illegal goods.',
      14,
      168
    );

    const checkboxItems = [
      'CONSIGNER COPY',
      'CONSIGNEE COPY',
      'LORRY COPY',
      'TRANSPORTER COPY',
    ] as const;

    let cx = 14;
    checkboxItems.forEach((lbl) => {
      const checked = lbl === copyLabel;
      doc.setDrawColor(15, 23, 42);
      doc.rect(cx, 175, 4, 4);
      if (checked) {
        doc.setFont('helvetica', 'bold');
        doc.text('X', cx + 1, 178.2);
      }
      doc.setFont('helvetica', checked ? 'bold' : 'normal');
      doc.setFontSize(8);
      doc.text(lbl, cx + 6, 178.3);
      cx += 44;
    });

    drawRoundStampAndSign(doc, assets, 240, 170, 28, 17);
  });

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `LR_${sanitizeFileName(cn.cnNo)}_3Copies.pdf`,
    title: `Consignment Note (3 Copies) - ${cn.cnNo}`,
  };
}

function buildQuotationDoc(quote: Quotation, company: CompanySettings, assets: PdfAssets) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  drawDiagonalWatermark(doc, 'D.R.C QUOTATION');

  if (assets.logoDataUrl) {
    doc.addImage(assets.logoDataUrl, 'JPEG', 16, 14, 30, 24, undefined, 'FAST');
  }

  doc.setFont('times', 'italic');
  doc.setFontSize(13);
  doc.setTextColor(120, 113, 60);
  doc.text('Proforma Invoice', 110, 18, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('Rate Of Quotation', 110, 25, { align: 'center' });

  doc.setFontSize(8);
  doc.text('SUPPLY OF TRANSPORT SERVICES', 110, 30, { align: 'center' });
  doc.text('ORIGINAL / OFFICE COPY', 110, 34, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(`Mail: ${company.email}`, 110, 38, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('M/S', 14, 46);
  doc.text(company.companyName, 14, 52);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(company.address, 14, 57);
  doc.text(`GST IN: ${company.gstin}`, 14, 62);

  doc.text(`M: ${company.phones}`, 152, 52);
  doc.text(`Date: ${formatDateDDMMYYYY(quote.quotationDate)}`, 152, 62);
  doc.text(`Ref No: ${quote.quotationNo}`, 152, 67);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Subject: ${quote.subject || 'To Vehicles Freight Rate Quotation'}`, 105, 73, {
    align: 'center',
  });

  doc.line(14, 76, 196, 76);

  doc.text('Quotation For:', 14, 83);
  doc.text(`M/S ${quote.partyName}`, 14, 89);
  doc.setFont('helvetica', 'normal');
  doc.text(quote.partyAddress || '-', 14, 94);
  doc.setFont('helvetica', 'bold');
  doc.text(`GST IN: ${quote.partyGstin || '-'}`, 14, 102);

  doc.text('Quotation Validity After Lorry Unloading:', 132, 83);
  doc.setFont('helvetica', 'normal');
  doc.text(quote.validityText || '7 Days', 132, 89);

  doc.text('Dear Sir,', 14, 110);

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

  let ty = 114;
  doc.setLineWidth(0.3);
  rows.forEach(([k, v]) => {
    doc.rect(14, ty, 45, 7);
    doc.rect(59, ty, 137, 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(k, 16, ty + 4.8);
    doc.setFont('helvetica', 'normal');
    doc.text(v, 62, ty + 4.8);
    ty += 7;
  });

  ty += 3;
  doc.rect(14, ty, 90, 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Bank Details', 16, ty + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`A/C Name   : ${company.companyName}`, 16, ty + 11.5);
  doc.text(`Bank Name  : ${company.bankName}`, 16, ty + 17);
  doc.text(`A/C No     : ${company.accountNo}`, 16, ty + 22.5);
  doc.text(`IFSC Code  : ${company.ifsc} (${company.bankBranch})`, 16, ty + 28);

  drawRoundStampAndSign(doc, assets, 152, ty + 6, 30, 19);

  const ny = ty + 38;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const notices = [
    'Notice:- (Leakage, Damage, Breakage, & Shortage Not Transporter Risk) Lorry Owner Risk.',
    'Vehicle Border Pass And Other Costs Will Not Be Borne By The Transporter.',
    'Detention Charges:- Not Include Lorry Freight, Per Day Rs-1000/- (4 Wheels) / As Per Lorry.',
    'Payment Of Terms:- Balance Payment Must Be Done Within (7) Seven Days Of Unloading Lorry (No Balance & No Discount).',
  ];
  notices.forEach((line, idx) => {
    doc.text(line, 14, ny + idx * 5.5);
  });

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `Quotation_${sanitizeFileName(quote.partyName)}_${sanitizeFileName(quote.quotationNo)}.pdf`,
    title: `Rate Quotation - ${quote.quotationNo}`,
  };
}

function buildDeclaration194CDoc(
  decl: Declaration194C,
  company: CompanySettings,
  assets: PdfAssets
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const fy = decl.financialYear || getDynamicFinancialYear(decl.declarationDate);

  drawDiagonalWatermark(doc, 'Dolphin Road Carrier');

  if (assets.logoDataUrl) {
    doc.addImage(assets.logoDataUrl, 'JPEG', 14, 14, 26, 22, undefined, 'FAST');
  }
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(company.companyName, 44, 21);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('30/1/29 N.C DAS ROAD', 44, 26);
  doc.text('KOLKATA-700090', 44, 30);
  doc.text(`E-mail:- ${company.email}`, 44, 34);
  doc.text(`M-${company.phones}`, 44, 38);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DECLARATION UNDER SECTION 194 C FOR NON DEDUCTION OF TAX ON 01/04/2017', 105, 49, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('To,', 14, 57);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(10.5);
  doc.text(decl.partyName.toUpperCase(), 16, 63);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const addrLines = doc.splitTextToSize(decl.partyAddress || '-', 140);
  doc.text(addrLines, 16, 68);
  doc.text(`GST IN :- ${decl.partyGstin || '-'}`, 16, 78);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('DECLARATION', 105, 92, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.8);
  const intro = doc.splitTextToSize(
    `I Proprietor of M/S ${company.companyName} (Hereinafter "The Contractor") do hereby make the following declaration as required Sub - section (6) of section 194C of the Income Tax Act 1961 for receiving payments from the payer without deduction of tax at source :-`,
    176
  );
  doc.text(intro, 17, 102);

  const clauses = [
    '1. That we are authorized to make this declaration in the capacity of proprietor.',
    '2. That the contractor is engaged by the payer for hiring of goods carriage for its business.',
    '3. That the contractor does not own more than ten goods carriage (as defined in section 194C(6) of the Income - Tax Act 1961) as on date.',
    `4. That if the number of goods carriages owned by the contractor exceeds ten at any time during the previous year ${fy}, the contractor shall forthwith, in writing intimate the payer of this fact.`,
    '5. That the Income - Tax Permanent Account Number (PAN) of Contractor. A photocopy of the same is furnished to the payer along with the declaration.',
  ];

  let cy = 119;
  clauses.forEach((c) => {
    const wrapped = doc.splitTextToSize(c, 174);
    doc.text(wrapped, 19, cy);
    cy += wrapped.length * 5.2 + 2.5;
  });

  doc.setFont('helvetica', 'bold');
  doc.text('VERIFICATION', 105, cy + 4, { align: 'center' });
  doc.line(91, cy + 5, 119, cy + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const verif = doc.splitTextToSize(
    'I THE ABOVE NAMED DECLARANT DO HEREBY VERIFY THAT THE CONTENTS OF PARAGRAPHS ONE TO FIVE ABOVE ARE TRUE OF MY OWN KNOWLEDGE AND BELIEF AND NO PART OF IT IS FALSE AND NOTHING MATERIAL HAS BEEN CONCEALED IN IT.',
    176
  );
  doc.text(verif, 17, cy + 12);

  const footerY = cy + 32;
  doc.setFontSize(9.5);
  doc.text(`Place : ${decl.place || 'Kolkata'}`, 17, footerY);
  doc.text(`Date :- ${formatDateDDMMYYYY(decl.declarationDate)}`, 17, footerY + 6);

  if (assets.panCropDataUrl) {
    doc.addImage(assets.panCropDataUrl, 'JPEG', 17, footerY + 12, 58, 36, undefined, 'FAST');
  } else {
    doc.rect(17, footerY + 12, 58, 36);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('INCOME TAX DEPARTMENT - INDIA', 20, footerY + 18);
    doc.text('SUBHAJIT SAHA', 20, footerY + 25);
    doc.text(`PAN: ${company.pan}`, 20, footerY + 32);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('DECLARANT (SIGN WITH SEAL)', 160, footerY, { align: 'center' });
  doc.text('SUBHAJIT SAHA', 160, footerY + 5.5, { align: 'center' });
  doc.text(`PAN NO- ${company.pan}`, 160, footerY + 11, { align: 'center' });

  drawRoundStampAndSign(doc, assets, 145, footerY + 21, 32, 20);

  return {
    buffer: doc.output('arraybuffer'),
    fileName: `194C_Declaration_${sanitizeFileName(decl.partyName)}_${sanitizeFileName(fy)}.pdf`,
    title: `Section 194C Declaration - ${decl.partyName}`,
  };
}

function buildTableReportDoc(params: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  company: CompanySettings;
  fileName: string;
  assets: PdfAssets;
}) {
  const { title, subtitle, headers, rows, company, fileName, assets } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });

  const ROWS_PER_PAGE = 22;
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) doc.addPage();
    drawDiagonalWatermark(doc, 'DOLPHIN ROAD CARRIER');

    if (assets.logoDataUrl) {
      doc.addImage(assets.logoDataUrl, 'JPEG', 12, 8, 18, 14, undefined, 'FAST');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(13, 71, 161);
    doc.text(company.companyName, 34, 14);
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`${title} — ${subtitle}`, 34, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Page ${p + 1} of ${totalPages}`, 284, 14, { align: 'right' });

    const colWidth = 272 / Math.max(1, headers.length);
    let y = 28;
    doc.setFillColor(13, 71, 161);
    doc.rect(12, y, 272, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    headers.forEach((h, i) => {
      doc.text(h.slice(0, 22), 14 + i * colWidth, y + 4.8);
    });

    y += 10;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);

    const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    slice.forEach((row, rIdx) => {
      if (rIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(12, y - 4, 272, 6, 'F');
      }
      row.forEach((cell, cIdx) => {
        doc.text(String(cell ?? '').slice(0, 28), 14 + cIdx * colWidth, y);
      });
      y += 6.2;
    });
  }

  return {
    buffer: doc.output('arraybuffer'),
    fileName,
    title,
  };
}
