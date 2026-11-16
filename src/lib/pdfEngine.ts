import {
  CompanySettings,
  ConsignmentNote,
  Declaration194C,
  Invoice,
  Quotation,
} from '../types/erp';
import { buildPdfArrayBuffer, PdfAssets, PdfTaskPayload } from './pdfBuilders';

const DRC_LOGO_URL = '/assets/aistudio/WhatsApp_Image_2026-11-16_at_11.55.23_PM_8d220064.jpeg';
const DRC_STAMP_URL = '/assets/aistudio/WhatsApp_Image_2026-11-16_at_11.55.22_PM__2__3293db0a.jpeg';
const DRC_194C_REF_URL = '/assets/aistudio/WhatsApp_Image_2026-11-16_at_11.55.22_PM_8065282f.jpeg';

let cachedAssets: PdfAssets | null = null;
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

    const scale = Math.min(1, maxWidth / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
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

async function getAssets(): Promise<PdfAssets> {
  if (cachedAssets) return cachedAssets;
  const [logoDataUrl, stampDataUrl, panCropDataUrl] = await Promise.all([
    loadImageToCompressedDataUrl(DRC_LOGO_URL, 220, 0.72),
    loadImageToCompressedDataUrl(DRC_STAMP_URL, 260, 0.75),
    loadImageToCompressedDataUrl(DRC_194C_REF_URL, 320, 0.75, {
      sx: 0.11,
      sy: 0.715,
      sw: 0.27,
      sh: 0.085,
    }),
  ]);
  const watermarkDataUrl =
    typeof OffscreenCanvas !== 'undefined'
      ? undefined // Rendered off-main-thread inside pdfWorker.ts!
      : createFallbackTwinDolphinWatermarkDataUrl();
  cachedAssets = { logoDataUrl, stampDataUrl, panCropDataUrl, watermarkDataUrl };
  return cachedAssets;
}

export interface GeneratedPdfResult {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  sizeKB: number;
  title: string;
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
      return {
        blob,
        blobUrl,
        fileName: result.fileName,
        sizeKB,
        title: result.title,
      };
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
  return { blob, blobUrl, fileName, sizeKB, title };
}

export async function generateInvoicePDF(
  invoice: Invoice,
  company: CompanySettings,
  includeAnnexure = true
): Promise<GeneratedPdfResult> {
  const assets = await getAssets();
  return runPdfTask({
    kind: 'invoice',
    invoice,
    company,
    includeAnnexure,
    assets: { ...assets },
  });
}

export async function generateLR3CopyPDF(
  cn: ConsignmentNote,
  company: CompanySettings
): Promise<GeneratedPdfResult> {
  const assets = await getAssets();
  return runPdfTask({
    kind: 'lr3copy',
    cn,
    company,
    assets: { ...assets },
  });
}

export async function generateQuotationPDF(
  quote: Quotation,
  company: CompanySettings
): Promise<GeneratedPdfResult> {
  const assets = await getAssets();
  return runPdfTask({
    kind: 'quotation',
    quote,
    company,
    assets: { ...assets },
  });
}

export async function generateDeclaration194CPDF(
  decl: Declaration194C,
  company: CompanySettings
): Promise<GeneratedPdfResult> {
  const assets = await getAssets();
  return runPdfTask({
    kind: 'declaration194c',
    decl,
    company,
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
}): Promise<GeneratedPdfResult> {
  const assets = await getAssets();
  return runPdfTask({
    kind: 'tableReport',
    ...params,
    assets: { ...assets },
  });
}
