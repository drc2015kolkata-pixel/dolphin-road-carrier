interface CompressRequest {
  requestId: string;
  file: Blob;
  maxWidth: number;
  quality: number;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

async function uint8ToBase64(bytes: Uint8Array): Promise<string> {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

workerScope.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { requestId, file, maxWidth, quality } = event.data;
  try {
    if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas not supported in worker');
    }

    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, maxWidth / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Offscreen 2D context unavailable');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      const compressedBlob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality,
      });
      const bytes = new Uint8Array(await compressedBlob.arrayBuffer());
      const base64 = await uint8ToBase64(bytes);
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      workerScope.postMessage({
        requestId,
        ok: true,
        dataUrl,
        base64,
        mimeType: 'image/jpeg',
      });
    } finally {
      bitmap.close();
    }
  } catch (err) {
    workerScope.postMessage({
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : 'OCR image compression worker failed',
    });
  }
};
