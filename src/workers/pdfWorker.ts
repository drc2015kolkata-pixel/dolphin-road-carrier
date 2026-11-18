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
    ctx.globalAlpha = 0.095;
    ctx.strokeStyle = '#1E40AF';
    ctx.fillStyle = '#60A5FA';
    ctx.lineWidth = 4;

    // Symmetrical 1:1 outer crest ring
    ctx.beginPath();
    ctx.arc(260, 260, 224, 0, Math.PI * 2);
    ctx.stroke();

    // Twin dolphins inside circular crest (1:1 aspect)
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
