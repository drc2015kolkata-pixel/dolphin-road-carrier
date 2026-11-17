import {
  BillCopyCount,
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Invoice,
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
  cropRect?: { sx: number; sy: number; sw: number; sh: number }
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
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return undefined;
  }
}

function createFallbackTwinDolphinWatermarkDataUrl(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#1D4ED8';
    ctx.fillStyle = '#60A5FA';
    ctx.lineWidth = 5;

    ctx.beginPath();
    ctx.moveTo(110, 235);
    ctx.bezierCurveTo(100, 120, 175, 55, 248, 88);
    ctx.bezierCurveTo(212, 110, 180, 165, 172, 240);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(410, 235);
    ctx.bezierCurveTo(420, 120, 345, 55, 272, 88);
    ctx.bezierCurveTo(308, 110, 340, 165, 348, 240);
    ctx.closePath();
    ctx.fill();

    ctx.font = 'bold 58px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2563EB';
    ctx.fillText('D.R.C', 260, 198);
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('DOLPHIN ROAD CARRIER', 260, 224);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.65);
  } catch {
    return undefined;
  }
}

async function getAssets(company?: CompanySettings): Promise<PdfAssets> {
  if (!cachedLogoDataUrl) {
    cachedLogoDataUrl =
      (await loadImageToCompressedDataUrl(DRC_TRIANGLE_LOGO_URL, 260, 0.85)) ||
      (await loadImageToCompressedDataUrl(FALLBACK_LOGO_PNG, 260, 0.85));
  }
  if (!cachedDefaultStampDataUrl) {
    cachedDefaultStampDataUrl = await loadImageToCompressedDataUrl(DRC_STAMP_URL, 260, 0.78);
  }
  if (!cachedPanCropDataUrl) {
    cachedPanCropDataUrl = await loadImageToCompressedDataUrl(DRC_194C_REF_URL, 320, 0.75, {
      sx: 0.11,
      sy: 0.715,
      sw: 0.27,
      sh: 0.085,
    });
  }

  let stampDataUrl = cachedDefaultStampDataUrl;
  if (company?.customStampDataUrl) {
    const normalizedCustom = await loadImageToCompressedDataUrl(company.customStampDataUrl, 320, 0.82);
    if (normalizedCustom) {
      stampDataUrl = normalizedCustom;
    }
  }

  const watermarkDataUrl =
    typeof OffscreenCanvas !== 'undefined'
      ? undefined
      : createFallbackTwinDolphinWatermarkDataUrl();

  return {
    logoDataUrl: cachedLogoDataUrl,
    stampDataUrl,
    panCropDataUrl: cachedPanCropDataUrl,
    watermarkDataUrl,
  };
}

export interface GeneratedPdfResult {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  sizeKB: number;
  title: string;
  orientation: PdfOrientation;
  copyCount?: BillCopyCount;
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
    task.kind === 'foxproStatement'
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
  copyCount?: BillCopyCount
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  return runPdfTask({
    kind: 'invoice',
    invoice,
    company,
    includeAnnexure,
    orientation,
    copyCount: copyCount || invoice.copyCount || 1,
    assets: { ...assets },
  });
}

export async function generateLR3CopyPDF(
  cn: ConsignmentNote,
  company: CompanySettings,
  orientation: PdfOrientation = 'l'
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  return runPdfTask({
    kind: 'lr3copy',
    cn,
    company,
    orientation,
    assets: { ...assets },
  });
}

export async function generateQuotationPDF(
  quote: Quotation,
  company: CompanySettings,
  orientation: PdfOrientation = 'p'
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  return runPdfTask({
    kind: 'quotation',
    quote,
    company,
    orientation,
    assets: { ...assets },
  });
}

export async function generateDeclaration194CPDF(
  decl: Declaration194C,
  company: CompanySettings,
  orientation: PdfOrientation = 'p'
): Promise<GeneratedPdfResult> {
  const assets = await getAssets(company);
  return runPdfTask({
    kind: 'declaration194c',
    decl,
    company,
    orientation,
    assets: { ...assets },
  });
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
