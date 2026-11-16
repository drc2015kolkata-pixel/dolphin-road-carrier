import { createWorker } from 'tesseract.js';

export interface ScannedLRResult {
  cnNo?: string;
  cnDate?: string;
  consignorName?: string;
  consignorAddress?: string;
  consignorGstin?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  packages?: string;
  particulars?: string;
  nettWeight?: number;
  grossWeight?: number;
  totalFreight?: number;
  truckNo?: string;
  fromCity?: string;
  toCity?: string;
  ewayBillNo?: string;
  ewayBillDate?: string;
  taxInvNo?: string;
  taxInvDate?: string;
  valueOfGoods?: number;
  ownerName?: string;
  driverName?: string;
  driverDlNo?: string;
  confidenceNote?: string;
  rawTesseractText?: string;
}

export interface ScannedPODResult {
  signedDetected: boolean;
  podDate?: string;
  cnNo?: string;
  truckNo?: string;
  remarks?: string;
  rawTesseractText?: string;
}

let sharedCompressWorker: Worker | null = null;

function getCompressWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (!sharedCompressWorker) {
    try {
      sharedCompressWorker = new Worker(new URL('../workers/ocrWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return null;
    }
  }
  return sharedCompressWorker;
}

export async function compressImageFile(
  file: File,
  maxWidth = 1400,
  quality = 0.72
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  const worker = getCompressWorker();
  if (worker) {
    try {
      const workerResult = await new Promise<{
        dataUrl: string;
        base64: string;
        mimeType: string;
      }>((resolve, reject) => {
        const requestId = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const onMessage = (
          event: MessageEvent<{
            requestId: string;
            ok: boolean;
            dataUrl?: string;
            base64?: string;
            mimeType?: string;
            error?: string;
          }>
        ) => {
          if (event.data?.requestId !== requestId) return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          if (event.data.ok && event.data.dataUrl && event.data.base64) {
            resolve({
              dataUrl: event.data.dataUrl,
              base64: event.data.base64,
              mimeType: event.data.mimeType || 'image/jpeg',
            });
          } else {
            reject(new Error(event.data?.error || 'Compression worker failed'));
          }
        };
        const onError = (err: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          reject(new Error(err.message || 'Compression worker error'));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ requestId, file, maxWidth, quality });
      });
      return workerResult;
    } catch {
      // Fallback gracefully to HTMLCanvasElement if OffscreenCanvas throws
    }
  }

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = bitmapUrl;
    });

    const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable for image compression');
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1] || '';
    return { dataUrl, base64, mimeType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export async function runTesseractOCR(
  imageDataUrl: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  // Tesseract.js v7 spawns a background Web Worker internally when createWorker() is called
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    },
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(imageDataUrl);
    return text || '';
  } finally {
    await worker.terminate();
  }
}

function fallbackRegexParseLR(rawText: string): ScannedLRResult {
  const cnMatch = rawText.match(/(?:KOL|DRC|HOW|SIL)[-\/\s]*\d+[-\/\d]*/i);
  const truckMatch = rawText.match(/[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4}/i);
  const dateMatch = rawText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  const freightMatch = rawText.match(/(?:freight|total|rs\.?)\s*[:\-]?\s*(\d{3,7})/i);

  return {
    cnNo: cnMatch ? cnMatch[0].replace(/\s+/g, '') : '',
    truckNo: truckMatch ? truckMatch[0].replace(/\s+/g, '').toUpperCase() : '',
    cnDate: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '',
    totalFreight: freightMatch ? Number(freightMatch[1]) : 0,
    confidenceNote: 'Parsed locally via background Tesseract OCR worker.',
    rawTesseractText: rawText,
  };
}

export async function scanPhysicalLR(
  file: File,
  onStatus?: (msg: string) => void
): Promise<{ result: ScannedLRResult; compressedDataUrl: string }> {
  onStatus?.('Compressing LR scan in background worker...');
  const { dataUrl, base64, mimeType } = await compressImageFile(file, 1600, 0.78);

  let rawText = '';
  try {
    onStatus?.('Running background Tesseract OCR worker...');
    rawText = await runTesseractOCR(dataUrl, (pct) => {
      onStatus?.(`Background OCR scanning (${pct}%)...`);
    });
  } catch {
    rawText = '';
  }

  try {
    onStatus?.('Analyzing LR fields with AI High-Thinking Vision...');
    const resp = await fetch('/api/gemini/ocr-lr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType,
        tesseractText: rawText,
      }),
    });

    if (resp.ok) {
      const json = (await resp.json()) as { data?: ScannedLRResult };
      if (json.data) {
        return {
          result: { ...json.data, rawTesseractText: rawText },
          compressedDataUrl: dataUrl,
        };
      }
    }
  } catch {
    // Fall back to local Tesseract regex extraction if offline
  }

  return {
    result: fallbackRegexParseLR(rawText),
    compressedDataUrl: dataUrl,
  };
}

export async function scanPODDocument(
  file: File,
  onStatus?: (msg: string) => void
): Promise<{ result: ScannedPODResult; compressedDataUrl: string }> {
  onStatus?.('Compressing signed POD in background worker...');
  const { dataUrl, base64, mimeType } = await compressImageFile(file, 1100, 0.62);

  let rawText = '';
  try {
    onStatus?.('Scanning POD text in background OCR worker...');
    rawText = await runTesseractOCR(dataUrl);
  } catch {
    rawText = '';
  }

  try {
    onStatus?.('Verifying receiver signature & date...');
    const resp = await fetch('/api/gemini/ocr-pod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType,
        tesseractText: rawText,
      }),
    });

    if (resp.ok) {
      const json = (await resp.json()) as { data?: ScannedPODResult };
      if (json.data) {
        return {
          result: { ...json.data, rawTesseractText: rawText },
          compressedDataUrl: dataUrl,
        };
      }
    }
  } catch {
    // Offline fallback
  }

  const dateMatch = rawText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  return {
    result: {
      signedDetected: true,
      podDate: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '',
      remarks: 'Scanned locally (offline mode)',
      rawTesseractText: rawText,
    },
    compressedDataUrl: dataUrl,
  };
}
