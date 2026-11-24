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
    const canvas = new OffscreenCanvas(520, 520);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.strokeStyle = '#1E40AF';
    ctx.fillStyle = '#3B82F6';
    ctx.lineWidth = 4;

    // Outer circular seal crest
    ctx.beginPath();
    ctx.arc(260, 260, 224, 0, Math.PI * 2);
    ctx.stroke();

    // Twin dolphins curving into a heart frame around D.R.C
    ctx.beginPath();
    ctx.moveTo(260, 412);
    ctx.bezierCurveTo(132, 336, 94, 214, 154, 148);
    ctx.bezierCurveTo(192, 108, 242, 128, 258, 174);
    ctx.bezierCurveTo(222, 166, 176, 198, 180, 268);
    ctx.bezierCurveTo(184, 326, 226, 372, 260, 412);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(260, 412);
    ctx.bezierCurveTo(388, 336, 426, 214, 366, 148);
    ctx.bezierCurveTo(328, 108, 278, 128, 262, 174);
    ctx.bezierCurveTo(298, 166, 344, 198, 340, 268);
    ctx.bezierCurveTo(336, 326, 294, 372, 260, 412);
    ctx.closePath();
    ctx.fill();

    ctx.font = '900 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1E3A8A';
    ctx.fillText('D.R.C', 260, 278);
    ctx.font = 'bold 19px Arial, sans-serif';
    ctx.fillText('DOLPHIN ROAD CARRIERS', 260, 314);
    ctx.restore();

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
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
