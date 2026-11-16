import { buildPdfArrayBuffer, PdfTaskPayload } from '../lib/pdfBuilders';

interface WorkerRequest {
  requestId: string;
  task: PdfTaskPayload;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

let cachedWatermarkDataUrl: string | undefined;

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

async function renderTwinDolphinWatermarkOffscreen(): Promise<string | undefined> {
  if (cachedWatermarkDataUrl) return cachedWatermarkDataUrl;
  if (typeof OffscreenCanvas === 'undefined') return undefined;

  try {
    const canvas = new OffscreenCanvas(520, 320);
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

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
    cachedWatermarkDataUrl = await blobToDataUrl(blob);
    return cachedWatermarkDataUrl;
  } catch {
    return undefined;
  }
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { requestId, task } = event.data;
  try {
    if (!task.assets.watermarkDataUrl) {
      task.assets.watermarkDataUrl = await renderTwinDolphinWatermarkOffscreen();
    }
    const { buffer, fileName, title } = buildPdfArrayBuffer(task);
    workerScope.postMessage(
      { requestId, ok: true, buffer, fileName, title },
      [buffer]
    );
  } catch (err) {
    workerScope.postMessage({
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : 'PDF worker failure',
    });
  }
};
