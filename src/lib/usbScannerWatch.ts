/**
 * Universal USB Flatbed / Sheetfed Scanner Folder Auto-Watcher & 300-DPI Image Enhancer
 * Supports HP, Canon, Epson, Brother, and any TWAIN/WIA/ICA scanner outputting JPG/PNG/PDF
 * to a PC/Tablet/OTG scanned-documents folder via File System Access API (showDirectoryPicker).
 */

export type ScannerFilterMode = 'magic_color' | 'bw_sharp';

export interface ScannedFolderFileEvent {
  file: File;
  fileName: string;
  lastModified: number;
  scannerBrandHint: string;
}

export interface UsbScannerWatcherHandle {
  folderName: string;
  stop: () => void;
}

export function isFileSystemDirectorySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

function detectScannerBrandFromName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes('hp') || lower.includes('scanjet')) return 'HP ScanJet / Smart';
  if (lower.includes('canon') || lower.includes('img_')) return 'Canon Scan';
  if (lower.includes('epson') || lower.includes('eps')) return 'Epson Scan';
  if (lower.includes('brother') || lower.includes('brscan')) return 'Brother iPrint&Scan';
  return 'Universal USB Scanner';
}

export async function connectUsbScannerFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      'Direct folder auto-watch requires Chrome / Edge Desktop or Android Chrome with File System Access enabled. Use File/Camera Pick as fallback.'
    );
  }
  return picker({ mode: 'read', id: 'drc-usb-scanner-watch' });
}

const SUPPORTED_SCAN_EXT = /\.(jpe?g|png|webp|bmp|pdf)$/i;

export async function startUsbScannerFolderWatcher(
  dirHandle: FileSystemDirectoryHandle,
  onNewScanFile: (evt: ScannedFolderFileEvent) => Promise<void> | void,
  intervalMs = 1000
): Promise<UsbScannerWatcherHandle> {
  const seenFiles = new Map<string, number>();
  let stopped = false;
  let scanning = false;

  // Baseline existing files so only newly dropped scans trigger auto-capture
  try {
    const iterable = dirHandle as unknown as {
      values: () => AsyncIterableIterator<FileSystemHandle>;
    };
    for await (const entry of iterable.values()) {
      if (entry.kind === 'file' && SUPPORTED_SCAN_EXT.test(entry.name)) {
        const f = await (entry as FileSystemFileHandle).getFile();
        seenFiles.set(entry.name, f.lastModified);
      }
    }
  } catch {
    // Continue polling even if baseline scan throws transiently
  }

  const pollOnce = async () => {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const iterable = dirHandle as unknown as {
        values: () => AsyncIterableIterator<FileSystemHandle>;
      };
      for await (const entry of iterable.values()) {
        if (stopped) break;
        if (entry.kind !== 'file' || !SUPPORTED_SCAN_EXT.test(entry.name)) continue;
        // Skip temporary/incomplete scanner spool files
        if (entry.name.startsWith('~') || entry.name.endsWith('.tmp') || entry.name.endsWith('.part')) {
          continue;
        }
        const file = await (entry as FileSystemFileHandle).getFile();
        if (file.size <= 0) continue;
        const prevMod = seenFiles.get(entry.name);
        if (prevMod === undefined || file.lastModified > prevMod) {
          seenFiles.set(entry.name, file.lastModified);
          await onNewScanFile({
            file,
            fileName: file.name,
            lastModified: file.lastModified,
            scannerBrandHint: detectScannerBrandFromName(file.name),
          });
        }
      }
    } catch {
      // Folder permission lost or transient OS lock; next interval retries cleanly
    } finally {
      scanning = false;
    }
  };

  const timerId = window.setInterval(() => {
    void pollOnce();
  }, Math.max(750, intervalMs));

  return {
    folderName: dirHandle.name || 'USB Scanner Folder',
    stop: () => {
      stopped = true;
      window.clearInterval(timerId);
    },
  };
}

/**
 * Applies CamScanner-style 300-DPI Auto-Crop (whitespace/dark-scanner-bed trim) +
 * Magic Color (background whitening + crisp ink boost) OR B&W Sharp (adaptive document scan).
 */
export async function applyScanner300DpiAutoCropAndFilter(
  fileOrDataUrl: File | string,
  mode: ScannerFilterMode = 'magic_color',
  maxTargetWidth = 2400
): Promise<{ dataUrl: string; base64: string; mimeType: string; width: number; height: number }> {
  let srcUrl = '';
  let revokeNeeded = false;
  if (typeof fileOrDataUrl === 'string') {
    srcUrl = fileOrDataUrl;
  } else {
    srcUrl = URL.createObjectURL(fileOrDataUrl);
    revokeNeeded = true;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = srcUrl;
    });

    const scale = Math.min(1, maxTargetWidth / Math.max(img.width, img.height));
    const rawW = Math.max(1, Math.round(img.width * scale));
    const rawH = Math.max(1, Math.round(img.height * scale));

    const workCanvas = document.createElement('canvas');
    workCanvas.width = rawW;
    workCanvas.height = rawH;
    const wCtx = workCanvas.getContext('2d', { willReadFrequently: true });
    if (!wCtx) throw new Error('Canvas 2D context unavailable');

    wCtx.fillStyle = '#ffffff';
    wCtx.fillRect(0, 0, rawW, rawH);
    wCtx.drawImage(img, 0, 0, rawW, rawH);

    // 1. Auto-Crop Scanner Margin Detection (detect bright paper area or ink-bounded margins)
    const imgData = wCtx.getImageData(0, 0, rawW, rawH);
    const data = imgData.data;

    let minX = rawW;
    let minY = rawH;
    let maxX = 0;
    let maxY = 0;

    // Sample every 2px for crisp speed while capturing exact edges
    for (let y = 0; y < rawH; y += 2) {
      for (let x = 0; x < rawW; x += 2) {
        const idx = (y * rawW + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Ink / non-blank-margin pixel (avoid pure flatbed lid white >247 or deep black scanner edge <18)
        if (lum >= 22 && lum <= 240) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const padX = Math.round(rawW * 0.012);
    const padY = Math.round(rawH * 0.012);
    const cropValid = maxX - minX > rawW * 0.25 && maxY - minY > rawH * 0.25;
    const sx = cropValid ? Math.max(0, minX - padX) : 0;
    const sy = cropValid ? Math.max(0, minY - padY) : 0;
    const sw = cropValid ? Math.min(rawW - sx, maxX - minX + padX * 2) : rawW;
    const sh = cropValid ? Math.min(rawH - sy, maxY - minY + padY * 2) : rawH;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = sw;
    outCanvas.height = sh;
    const oCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    if (!oCtx) throw new Error('Output Canvas context unavailable');

    oCtx.drawImage(workCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const outData = oCtx.getImageData(0, 0, sw, sh);
    const px = outData.data;

    // 2. Apply Magic Color or B&W Sharp document filter
    if (mode === 'bw_sharp') {
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        // Clean paper whitening + sharp ink contrast
        const v = lum > 175 ? 255 : lum < 85 ? Math.max(0, lum * 0.45) : Math.min(255, Math.max(0, (lum - 85) * 2.8));
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
      }
    } else {
      // Magic Color: Lift paper brightness while preserving & sharpening blue/black ink & red stamps
      for (let i = 0; i < px.length; i += 4) {
        let r = px[i];
        let g = px[i + 1];
        let b = px[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

        if (lum > 188 && sat < 0.18) {
          r = 255;
          g = 255;
          b = 255;
        } else {
          r = Math.min(255, Math.max(0, (r - 128) * 1.24 + 132));
          g = Math.min(255, Math.max(0, (g - 128) * 1.24 + 132));
          b = Math.min(255, Math.max(0, (b - 128) * 1.24 + 132));
        }
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
    }

    oCtx.putImageData(outData, 0, 0);
    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.9);
    return {
      dataUrl,
      base64: dataUrl.split(',')[1] || '',
      mimeType: 'image/jpeg',
      width: sw,
      height: sh,
    };
  } finally {
    if (revokeNeeded) {
      URL.revokeObjectURL(srcUrl);
    }
  }
}
