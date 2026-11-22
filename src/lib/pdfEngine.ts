import {
  BillCopyCount,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Invoice,
  LogisticsDocket,
  LogisticsInvoice,
  LogisticsManifest,
  Quotation,
} from '../types/erp';
import {
  buildPdfArrayBuffer,
  FoxproStatementSpec,
  PdfAssets,
  PdfOrientation,
  PdfTaskPayload,
} from './pdfBuilders';

const DRC_TRIANGLE_LOGO_URL = '/drc-triangle-logo.svg';
const FALLBACK_LOGO_PNG = '/pwa-192x192.png';
const DRC_STAMP_URL = '/assets/aistudio/WhatsApp_Image_2026-11-16_at_11.55.22_PM__2__3293db0a.jpeg';
const DRC_194C_REF_URL = '/assets/aistudio/WhatsApp_Image_2026-11-16_at_11.55.22_PM_8065282f.jpeg';

let cachedLogoDataUrl: string | undefined;
let cachedDefaultStampDataUrl: string | undefined;
let cachedPanCropDataUrl: string | undefined;
let sharedPdfWorker: Worker | null = null;

async function loadImageToCompressedDataUrl(
  url: string,
  maxWidth: number,
  quality: number,
  cropRect?: { sx: number; sy: number; sw: number; sh: number },
  preferPng = false
): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });

    const sx = cropRect ? Math.round(img.width * cropRect.sx) : 0;
    const sy = cropRect ? Math.round(img.height * cropRect.sy) : 0;
    const sw = cropRect ? Math.round(img.width * cropRect.sw) : img.width;
    const sh = cropRect ? Math.round(img.height * cropRect.sh) : img.height;

    const scale = Math.min(1, maxWidth / Math.max(sw || maxWidth, sh || maxWidth));
    const dw = Math.max(1, Math.round((sw || maxWidth) * scale));
    const dh = Math.max(1, Math.round((sh || maxWidth) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(img, sx, sy, sw || dw, sh || dh, 0, 0, dw, dh);
    return preferPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
  } catch {
    return undefined;
  }
}

function createFallbackTwinDolphinWatermarkDataUrl(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 520;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalAlpha = 0.095;
    ctx.strokeStyle = '#1E40AF';
    ctx.fillStyle = '#60A5FA';
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.arc(260, 260, 224, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(116, 295);
    ctx.bezierCurveTo(106, 180, 178, 118, 248, 150);
    ctx.bezierCurveTo(212, 172, 182, 225, 174, 300);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(404, 295);
    ctx.bezierCurveTo(414, 180, 342, 118, 272, 150);
    ctx.bezierCurveTo(308, 172, 338, 225, 346, 300);
    ctx.closePath();
    ctx.fill();

    ctx.font = '900 58px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1E3A8A';
    ctx.fillText('D.R.C', 260, 338);
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.fillText('DOLPHIN ROAD CARRIERS', 260, 370);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return undefined;
  }
}

async function getAssets(company?: CompanySettings): Promise<PdfAssets> {
  if (!cachedLogoDataUrl) {
    cachedLogoDataUrl =
      (await loadImageToCompressedDataUrl(DRC_TRIANGLE_LOGO_URL, 640, 1.0, undefined, true)) ||
      (await loadImageToCompressedDataUrl(FALLBACK_LOGO_PNG, 512, 1.0, undefined, true));
  }
  if (!cachedDefaultStampDataUrl) {
    cachedDefaultStampDataUrl = await loadImageToCompressedDataUrl(DRC_STAMP_URL, 540, 0.94);
  }
  if (!cachedPanCropDataUrl) {
    cachedPanCropDataUrl = await loadImageToCompressedDataUrl(
      DRC_194C_REF_URL,
      640,
      0.92,
      {
        sx: 0.11,
        sy: 0.715,
        sw: 0.27,
        sh: 0.085,
      }
    );
  }

  let stampDataUrl = cachedDefaultStampDataUrl;
  if (company?.customStampDataUrl) {
    const normalizedCustom = await loadImageToCompressedDataUrl(company.customStampDataUrl, 540, 0.94);
    if (normalizedCustom) {
      stampDataUrl = normalizedCustom;
    }
  }

  let panCropDataUrl = cachedPanCropDataUrl;
  if (company?.panCardPhotoDataUrl) {
    const normalizedPan = await loadImageToCompressedDataUrl(company.panCardPhotoDataUrl, 640, 0.94);
    if (normalizedPan) {
      panCropDataUrl = normalizedPan;
    }
  }

  const watermarkDataUrl =
    typeof OffscreenCanvas !== 'undefined'
      ? undefined
      : createFallbackTwinDolphinWatermarkDataUrl();

  return {
    logoDataUrl: cachedLogoDataUrl,
    stampDataUrl,
    panCropDataUrl,
    watermarkDataUrl,
  };
}

export interface PdfShareMeta {
  partyName?: string;
  phone?: string;
  email?: string;
  preferredChannel?: string;
  docNo?: string;
  summaryText?: string;
}

export interface GeneratedPdfResult {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  sizeKB: number;
  title: string;
  orientation: PdfOrientation;
  copyCount?: BillCopyCount;
  shareMeta?: PdfShareMeta;
  rebuildWithOrientation?: (nextOrientation: PdfOrientation) => Promise<GeneratedPdfResult>;
  rebuildWithCopyCount?: (nextCopyCount: BillCopyCount) => Promise<GeneratedPdfResult>;
}

function getPdfWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!sharedPdfWorker) {
    try {
      sharedPdfWorker = new Worker(new URL('../workers/pdfWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return null;
    }
  }
  return sharedPdfWorker;
}

async function runPdfTask(task: PdfTaskPayload): Promise<GeneratedPdfResult> {
  const worker = getPdfWorker();
  const chosenOrientation: PdfOrientation =
    task.orientation ||
    (task.kind === 'lr3copy' ||
    task.kind === 'tableReport' ||
    task.kind === 'gstRegister' ||
    task.kind === 'foxproStatement' ||
    task.kind === 'logisticsDocket' ||
    task.kind === 'logisticsManifest'
      ? 'l'
      : 'p');
  const chosenCopyCount: BillCopyCount | undefined =
    task.kind === 'invoice' ? task.copyCount || task.invoice.copyCount || 1 : undefined;

  const attachRebuild = (base: Omit<GeneratedPdfResult, 'rebuildWithOrientation' | 'rebuildWithCopyCount'>): GeneratedPdfResult => ({
    ...base,
    copyCount: chosenCopyCount,
    rebuildWithOrientation: async (nextOrientation: PdfOrientation) => {
      return runPdfTask({
        ...task,
        orientation: nextOrientation,
        assets: { ...task.assets },
      });
    },
    ...(task.kind === 'invoice'
      ? {
          rebuildWithCopyCount: async (nextCopyCount: BillCopyCount) => {
            return runPdfTask({
              ...task,
              copyCount: nextCopyCount,
              assets: { ...task.assets },
            });
          },
        }
      : {}),
  });

  if (worker) {
    try {
      const result = await new Promise<{ buffer: ArrayBuffer; fileName: string; title: string }>(
        (resolve, reject) => {
          const requestId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const onMessage = (
            event: MessageEvent<{
              requestId: string;
              ok: boolean;
              buffer?: ArrayBuffer;
              fileName?: string;
              title?: string;
              error?: string;
            }>
          ) => {
            if (event.data?.requestId !== requestId) return;
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            if (event.data.ok && event.data.buffer && event.data.fileName && event.data.title) {
              resolve({
                buffer: event.data.buffer,
                fileName: event.data.fileName,
                title: event.data.title,
              });
            } else {
              reject(new Error(event.data?.error || 'PDF worker error'));
            }
          };
          const onError = (err: ErrorEvent) => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            reject(new Error(err.message || 'Worker execution failed'));
          };

          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          worker.postMessage({ requestId, task });
        }
      );

      const blob = new Blob([result.buffer], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const sizeKB = Math.max(1, Math.round(blob.size / 1024));
      return attachRebuild({
        blob,
        blobUrl,
        fileName: result.fileName,
        sizeKB,
        title: result.title,
        orientation: chosenOrientation,
      });
    } catch {
      // Fallback to main thread cleanly if worker is blocked
    }
  }

  if (!task.assets.watermarkDataUrl) {
    task.assets.watermarkDataUrl = createFallbackTwinDolphinWatermarkDataUrl();
  }
  const { buffer, fileName, title } = buildPdfArrayBuffer(task);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  const sizeKB = Math.max(1, Math.round(blob.size / 1024));
  return attachRebuild({
    blob,
    blobUrl,
    fileName,
    sizeKB,
    title,
    orientation: chosenOrientation,
  });
}

export async function generateInvoicePDF(
  invoice: Invoice,
  company: CompanySettings,
  includeAnnexure = true,
  orientation: PdfOrientation = 'p',
  copyCount?: BillCopyCount,
  shareMeta?: PdfShareMeta
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'invoice',
    invoice,
    company,
    includeAnnexure,
    orientation,
    copyCount: copyCount || invoice.copyCount || 1,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: shareMeta || {
      partyName: invoice.partyName,
      docNo: invoice.invoiceNo,
      summaryText: `Tax Invoice ${invoice.invoiceNo} | Date: ${invoice.invoiceDate} | Party: ${invoice.partyName} | Grand Total: Rs. ${Number(invoice.grandTotal || 0).toLocaleString('en-IN')}`,
    },
  };
}

export async function generateLR3CopyPDF(
  cn: ConsignmentNote,
  company: CompanySettings,
  orientation: PdfOrientation = 'l',
  shareMeta?: PdfShareMeta
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'lr3copy',
    cn,
    company,
    orientation,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: shareMeta || {
      partyName: cn.billingPartyName || cn.consignorName,
      docNo: cn.cnNo,
      summaryText: `Consignment Note (LR) ${cn.cnNo} | Date: ${cn.cnDate} | ${cn.fromCity} -> ${cn.toCity} | Truck: ${cn.truckNo} | Freight: ${cn.showFreightOnPrint === false ? 'As Agreed' : `Rs. ${Number(cn.totalFreight || 0).toLocaleString('en-IN')}`}`,
    },
  };
}

export async function generateQuotationPDF(
  quote: Quotation,
  company: CompanySettings,
  orientation: PdfOrientation = 'p',
  shareMeta?: PdfShareMeta
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'quotation',
    quote,
    company,
    orientation,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: shareMeta || {
      partyName: quote.partyName,
      phone: quote.partyPhone,
      email: quote.partyEmail,
      docNo: quote.quotationNo,
      summaryText: `Rate Quotation ${quote.quotationNo} | Party: ${quote.partyName} | Route: ${quote.destination} | Vehicle: ${quote.vehicleType} | Freight: Rs. ${Number(quote.freight || 0).toLocaleString('en-IN')}`,
    },
  };
}

export async function generateDeclaration194CPDF(
  decl: Declaration194C,
  company: CompanySettings,
  orientation: PdfOrientation = 'p',
  shareMeta?: PdfShareMeta
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'declaration194c',
    decl,
    company,
    orientation,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: shareMeta || {
      partyName: decl.partyName,
      docNo: `194C-${decl.financialYear}`,
      summaryText: `Section 194C TDS Exemption Declaration (${decl.financialYear}) for ${decl.partyName} — ${company.companyName} (PAN: ${company.pan})`,
    },
  };
}

export async function generateTableReportPDF(params: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  company: CompanySettings;
  fileName: string;
  orientation?: PdfOrientation;
}): Promise<GeneratedPdfResult> {
  const assets = await getAssets(params.company);
  return runPdfTask({
    kind: 'tableReport',
    ...params,
    orientation: params.orientation || 'l',
    assets: { ...assets },
  });
}

export async function generateGstRegisterPDF(params: {
  invoices: Invoice[];
  subtitle: string;
  company: CompanySettings;
  fileName?: string;
  orientation?: PdfOrientation;
}): Promise<GeneratedPdfResult> {
  const assets = await getAssets(params.company);
  return runPdfTask({
    kind: 'gstRegister',
    invoices: params.invoices,
    subtitle: params.subtitle,
    company: params.company,
    fileName: params.fileName || `GST_Register_${new Date().toISOString().slice(0, 10)}.pdf`,
    orientation: params.orientation || 'l',
    assets: { ...assets },
  });
}

export async function generateFoxproStatementPDF(
  spec: FoxproStatementSpec,
  company: CompanySettings,
  orientation?: PdfOrientation
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  return runPdfTask({
    kind: 'foxproStatement',
    spec,
    company,
    orientation: orientation || spec.orientation || 'l',
    assets: { ...assets },
  });
}

export async function generateAppFormatBlueprintPDF(
  company: CompanySettings,
  orientation: PdfOrientation = 'p'
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  return runPdfTask({
    kind: 'appBlueprint',
    company,
    orientation,
    assets: { ...assets },
  });
}

export async function generateLogisticsDocketPDF(
  docket: LogisticsDocket,
  company: CompanySettings,
  orientation: PdfOrientation = 'l',
  shareMeta?: PdfShareMeta
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'logisticsDocket',
    docket,
    company,
    orientation,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: shareMeta || {
      partyName: docket.billingPartyName || docket.consignorName,
      docNo: docket.docketNo,
      summaryText: `Logistics Parcel Docket ${docket.docketNo} | ${docket.originBranch} -> ${docket.destBranch} | ${docket.packages} Pkgs (${docket.chargedWeightKg} Kg) | ${docket.payMode}: Rs. ${Number(docket.totalAmount || 0).toLocaleString('en-IN')}`,
    },
  };
}

export async function generateLogisticsManifestPDF(
  manifest: LogisticsManifest,
  dockets: LogisticsDocket[],
  company: CompanySettings,
  orientation: PdfOrientation = 'l'
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'logisticsManifest',
    manifest,
    dockets,
    company,
    orientation,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: {
      docNo: manifest.manifestNo,
      summaryText: `Line-Haul Manifest ${manifest.manifestNo} | ${manifest.fromBranch} -> ${manifest.toBranch} | Truck: ${manifest.truckNo} | Dockets: ${manifest.docketIds.length}`,
    },
  };
}

export async function generateLogisticsInvoicePDF(
  invoice: LogisticsInvoice,
  company: CompanySettings,
  orientation: PdfOrientation = 'p',
  shareMeta?: PdfShareMeta
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  const res = await runPdfTask({
    kind: 'logisticsInvoice',
    invoice,
    company,
    orientation,
    assets: { ...assets },
  });
  return {
    ...res,
    shareMeta: shareMeta || {
      partyName: invoice.partyName,
      docNo: invoice.docNo,
      summaryText: `Logistics ${invoice.docType} ${invoice.docNo} | Party: ${invoice.partyName} | Total: Rs. ${Number(invoice.grandTotal || 0).toLocaleString('en-IN')}`,
    },
  };
}

export function downloadPdfDirect(pdf: GeneratedPdfResult): void {
  const a = document.createElement('a');
  a.href = pdf.blobUrl;
  a.download = pdf.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function printPdfDirect(pdf: GeneratedPdfResult): void {
  const existing = document.getElementById('drc-silent-print-iframe') as HTMLIFrameElement | null;
  if (existing) {
    existing.remove();
  }
  const iframe = document.createElement('iframe');
  iframe.id = 'drc-silent-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = pdf.blobUrl;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      downloadPdfDirect(pdf);
    }
  };
  document.body.appendChild(iframe);
}

export interface OperatingBookPdfPart {
  partTitle: string;
  subtitle: string;
  items: Array<{
    numEn: string;
    en: string;
    numBn: string;
    bn: string;
  }>;
}

/**
 * Generates an A4 Portrait Low-KB Bilingual Operating Book PDF (English + বাংলা)
 * using HTML5 Canvas UTF-8 system font rasterization so Bengali typography prints crisply on all OS.
 */
export async function generateOperatingBookPDF(params: {
  bookTitle: string;
  company: CompanySettings;
  parts: OperatingBookPdfPart[];
  fileName?: string;
}): Promise<GeneratedPdfResult> {
  const pageW = 1120;
  const pageH = 1584; // A4 Portrait ratio (~1:1.414)
  const padX = 56;
  const maxTextW = pageW - padX * 2;
  const bottomLimit = pageH - 64;

  const pages: string[] = [];
  let canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = pageH;
  let ctx = canvas.getContext('2d')!;
  let y = 0;

  const initPage = (pageNum: number) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, pageW - 48, pageH - 48);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 20px "Noto Sans", "Segoe UI", Arial, sans-serif';
    ctx.fillText(params.company.companyName || 'DOLPHIN ROAD CARRIER', padX, 62);
    ctx.fillStyle = '#1d4ed8';
    ctx.font = 'bold 14px "Noto Sans", Arial, sans-serif';
    ctx.fillText(params.bookTitle, padX, 86);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(`Page ${pageNum}`, pageW - padX - 60, 62);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, 98);
    ctx.lineTo(pageW - padX, 98);
    ctx.stroke();
    y = 124;
  };

  const pushPageAndReset = () => {
    pages.push(canvas.toDataURL('image/jpeg', 0.78));
    canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    ctx = canvas.getContext('2d')!;
    initPage(pages.length + 1);
  };

  const wrapLines = (text: string, font: string, maxW: number): string[] => {
    ctx.font = font;
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const test = current ? `${current} ${w}` : w;
      if (ctx.measureText(test).width > maxW && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  initPage(1);

  for (const part of params.parts) {
    if (y + 90 > bottomLimit) {
      pushPageAndReset();
    }
    // Bold part header bar
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(padX, y, maxTextW, 46);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padX, y, maxTextW, 46);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 18px "Noto Sans", "Segoe UI", Arial, sans-serif';
    ctx.fillText(part.partTitle, padX + 14, y + 22);
    ctx.fillStyle = '#475569';
    ctx.font = '12px "Noto Sans", "Noto Sans Bengali", "Nirmala UI", sans-serif';
    ctx.fillText(part.subtitle, padX + 14, y + 39);
    y += 62;

    for (const item of part.items) {
      const enFont = 'bold 14px "Segoe UI", Arial, sans-serif';
      const bnFont = '14px "Noto Sans Bengali", "Nirmala UI", "Vrinda", Arial, sans-serif';
      const enLines = wrapLines(`${item.numEn} ${item.en}`, enFont, maxTextW - 12);
      const bnLines = wrapLines(`${item.numBn} ${item.bn}`, bnFont, maxTextW - 12);
      const neededH = enLines.length * 20 + bnLines.length * 21 + 16;

      if (y + neededH > bottomLimit) {
        pushPageAndReset();
      }

      ctx.fillStyle = '#0f172a';
      ctx.font = enFont;
      for (const ln of enLines) {
        ctx.fillText(ln, padX + 4, y);
        y += 20;
      }

      ctx.fillStyle = '#065f46';
      ctx.font = bnFont;
      for (const ln of bnLines) {
        ctx.fillText(ln, padX + 4, y);
        y += 21;
      }

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, y - 6);
      ctx.lineTo(pageW - padX, y - 6);
      ctx.stroke();
      y += 10;
    }
    y += 10;
  }

  pages.push(canvas.toDataURL('image/jpeg', 0.78));

  const assets = await getAssets(params.company);
  return runPdfTask({
    kind: 'imagePages',
    pages,
    title: params.bookTitle,
    fileName: params.fileName || 'DRC_Operating_Book_Bilingual.pdf',
    company: params.company,
    orientation: 'p',
    assets: { ...assets },
  });
}

