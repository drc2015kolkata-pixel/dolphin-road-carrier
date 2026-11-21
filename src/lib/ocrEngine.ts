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
  packageMode?: string;
  particulars?: string;
  goodsRemarks?: string;
  nettWeight?: number;
  grossWeight?: number;
  chargedWeight?: number;
  totalFreight?: number;
  rateType?: string;
  fixedOrWeightRate?: number;
  gstPaidByCode?: 'R' | 'E' | 'T' | '';
  stockTransfer?: boolean;
  truckNo?: string;
  vehicleNo?: string;
  fromCity?: string;
  toCity?: string;
  ewayBillNo?: string;
  ewayBillDate?: string;
  ewayBillValidUpto?: string;
  extraEwayBills?: Array<{ no: string; date?: string; validUpto?: string }>;
  taxInvNo?: string;
  taxInvDate?: string;
  extraTaxInvoices?: Array<{ no: string; date?: string; amount?: number }>;
  valueOfGoods?: number;
  ownerName?: string;
  driverName?: string;
  driverDlNo?: string;
  isCrossBorder?: boolean;
  destinationCountry?: string;
  highlightTotalFreight?: boolean;
  missingOrUnclearFields?: string[];
  rotatedDataUrl?: string;
  appliedRotationDeg?: number;
  confidenceNote?: string;
  rawTesseractText?: string;
}

export interface ScannedPODResult {
  signedDetected: boolean;
  podDate?: string;
  cnNo?: string;
  truckNo?: string;
  shortageBreakageLeakageDetected?: boolean;
  shortageBreakageReason?: string;
  podRemarks?: string;
  remarks?: string;
  missingOrUnclearFields?: string[];
  rotatedDataUrl?: string;
  appliedRotationDeg?: number;
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

export async function readExifOrientation(file: File): Promise<number> {
  try {
    const buffer = await file.slice(0, 65536).arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) {
      return 1;
    }
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        if (offset + 8 >= view.byteLength) return 1;
        // 'Exif\0\0'
        if (view.getUint32(offset + 2, false) !== 0x45786966) {
          return 1;
        }
        const tiffStart = offset + 8;
        const littleEndian = view.getUint16(tiffStart, false) === 0x4949;
        const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
        const dirStart = tiffStart + ifdOffset;
        if (dirStart + 2 >= view.byteLength) return 1;
        const tags = view.getUint16(dirStart, littleEndian);
        for (let i = 0; i < tags; i++) {
          const entryOffset = dirStart + 2 + i * 12;
          if (entryOffset + 12 > view.byteLength) break;
          if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
            return view.getUint16(entryOffset + 8, littleEndian) || 1;
          }
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      const segLength = view.getUint16(offset, false);
      if (segLength < 2) break;
      offset += segLength;
    }
  } catch {
    return 1;
  }
  return 1;
}

function exifToDegrees(orientation: number): number {
  switch (orientation) {
    case 3:
    case 4:
      return 180;
    case 5:
    case 6:
      return 90;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

export async function rotateDataUrlDegrees(
  dataUrl: string,
  degrees: number,
  quality = 0.8
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  const normDeg = ((degrees % 360) + 360) % 360;
  if (normDeg === 0) {
    return {
      dataUrl,
      base64: dataUrl.split(',')[1] || '',
      mimeType: 'image/jpeg',
    };
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const swap = normDeg === 90 || normDeg === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? img.height : img.width;
  canvas.height = swap ? img.width : img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      dataUrl,
      base64: dataUrl.split(',')[1] || '',
      mimeType: 'image/jpeg',
    };
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((normDeg * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  const rotated = canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl: rotated,
    base64: rotated.split(',')[1] || '',
    mimeType: 'image/jpeg',
  };
}

export async function autoRotateAndCompressImage(
  file: File,
  maxWidth = 1500,
  quality = 0.78
): Promise<{ dataUrl: string; base64: string; mimeType: string; appliedRotationDeg: number }> {
  const exifOrientation = await readExifOrientation(file);
  const exifDeg = exifToDegrees(exifOrientation);

  // If EXIF says rotation is needed, handle in-canvas explicitly so camera photos normalize upright
  if (exifOrientation !== 1) {
    const bitmapUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = bitmapUrl;
      });
      const swap = exifOrientation >= 5 && exifOrientation <= 8;
      const rawW = swap ? img.height : img.width;
      const rawH = swap ? img.width : img.height;
      const scale = Math.min(1, maxWidth / Math.max(rawW, rawH));
      const width = Math.max(1, Math.round(rawW * scale));
      const height = Math.max(1, Math.round(rawH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      switch (exifOrientation) {
        case 2:
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
          break;
        case 3:
          ctx.translate(width, height);
          ctx.rotate(Math.PI);
          break;
        case 4:
          ctx.translate(0, height);
          ctx.scale(1, -1);
          break;
        case 5:
          ctx.rotate(0.5 * Math.PI);
          ctx.scale(1, -1);
          break;
        case 6:
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(0, -width);
          break;
        case 7:
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(height, -width);
          ctx.scale(-1, 1);
          break;
        case 8:
          ctx.rotate(-0.5 * Math.PI);
          ctx.translate(-height, 0);
          break;
        default:
          break;
      }

      const drawW = swap ? height : width;
      const drawH = swap ? width : height;
      ctx.drawImage(img, 0, 0, drawW, drawH);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      return {
        dataUrl,
        base64: dataUrl.split(',')[1] || '',
        mimeType: 'image/jpeg',
        appliedRotationDeg: exifDeg,
      };
    } finally {
      URL.revokeObjectURL(bitmapUrl);
    }
  }

  const base = await compressImageFile(file, maxWidth, quality);
  return { ...base, appliedRotationDeg: 0 };
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
      // Fallback gracefully to HTMLCanvasElement
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

function detectCrossBorderFromText(text: string): { isCrossBorder: boolean; country: string } {
  const upper = text.toUpperCase();
  if (/(PETRAPOLE|BENAPOLE|BANGAON|HILLI|GHOJADANGA|DHAKA|CHITTAGONG|KHULNA|BANGLADESH)/.test(upper)) {
    return { isCrossBorder: true, country: 'Bangladesh' };
  }
  if (/(RAXAUL|BIRGUNJ|JOGBANI|SONAULI|PANITANKI|KATHMANDU|BIRATNAGAR|NEPAL)/.test(upper)) {
    return { isCrossBorder: true, country: 'Nepal' };
  }
  if (/(JAIGAON|PHUENTSHOLING|THIMPHU|BHUTAN)/.test(upper)) {
    return { isCrossBorder: true, country: 'Bhutan' };
  }
  return { isCrossBorder: false, country: 'India' };
}

function fallbackRegexParseLR(rawText: string): ScannedLRResult {
  const cnMatch = rawText.match(/(?:KOL|DRC|HOW|SIL)[-\/\s]*\d+[-\/\d]*/i);
  const truckMatch = rawText.match(/[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4}/i);
  const dateMatch = rawText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  const freightMatch = rawText.match(/(?:freight|total\s*freight|total|rs\.?)\s*[:\-]?\s*(\d{3,7})/i);
  const ewbMatches = Array.from(new Set(rawText.match(/\b\d{12}\b/g) || []));
  const invMatch = rawText.match(/(?:inv(?:oice)?\.?\s*(?:no)?\s*[:\-#]?)\s*([A-Z0-9\/\-]{3,20})/i);
  const pkgMatch = rawText.match(/(\d{1,5})\s*(?:NOS|BOX|BOXES|BAG|BAGS|PKG|PACKAGES|PCS|PIECES|ROLLS|DRUMS|BUNDLES)/i);
  const weightMatch = rawText.match(/(?:wt|weight|qty)\s*[:\-]?\s*(\d{1,6}(?:\.\d{1,3})?)/i);

  const upper = rawText.toUpperCase();
  const gstPaidByCode: 'R' | 'E' | 'T' | '' = /CONSIGNEE\s*[\[\(✓✔X]/i.test(upper)
    ? 'E'
    : /CONSIGNOR\s*[\[\(✓✔X]/i.test(upper)
      ? 'R'
      : /TRANSPORTER\s*[\[\(✓✔X]/i.test(upper)
        ? 'T'
        : '';
  const stockTransfer = /STOCK\s*TRANSFER/i.test(upper);
  const border = detectCrossBorderFromText(rawText);
  const totalFreight = freightMatch ? Number(freightMatch[1]) : 0;
  const truckNo = truckMatch ? truckMatch[0].replace(/\s+/g, '').toUpperCase() : '';

  const missingOrUnclearFields: string[] = [];
  if (!cnMatch?.[0]) missingOrUnclearFields.push('CN/LR No.');
  if (!truckNo) missingOrUnclearFields.push('Vehicle No.');
  if (!border.isCrossBorder && !totalFreight) missingOrUnclearFields.push('Total Freight');

  return {
    cnNo: cnMatch ? cnMatch[0].replace(/\s+/g, '') : '',
    truckNo,
    vehicleNo: truckNo,
    cnDate: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '',
    packages: pkgMatch ? pkgMatch[1] : '',
    packageMode: pkgMatch ? pkgMatch[0].replace(pkgMatch[1], '').trim().toUpperCase() : '',
    grossWeight: weightMatch ? Number(weightMatch[1]) : undefined,
    totalFreight,
    ewayBillNo: ewbMatches[0] || '',
    extraEwayBills: ewbMatches.slice(1).map((no) => ({ no })),
    taxInvNo: invMatch?.[1] || '',
    gstPaidByCode,
    stockTransfer,
    isCrossBorder: border.isCrossBorder,
    destinationCountry: border.country,
    highlightTotalFreight: !border.isCrossBorder && (!totalFreight || totalFreight <= 0),
    missingOrUnclearFields,
    confidenceNote: 'Parsed locally via Auto-Rotated Tesseract OCR worker.',
    rawTesseractText: rawText,
  };
}

function enrichScannedLR(raw: ScannedLRResult, rotatedDataUrl: string, appliedRotationDeg: number, rawText: string): ScannedLRResult {
  const truck = (raw.vehicleNo || raw.truckNo || '').replace(/\s+/g, '').toUpperCase();
  const combinedText = `${rawText}\n${raw.fromCity || ''}\n${raw.toCity || ''}\n${raw.consigneeAddress || ''}\n${raw.goodsRemarks || ''}`;
  const border = detectCrossBorderFromText(combinedText);
  const isCrossBorder = Boolean(raw.isCrossBorder || border.isCrossBorder);
  const totalFreightNum = Number(raw.totalFreight || 0);
  const highlightTotalFreight = !isCrossBorder && totalFreightNum <= 0;

  const missing = new Set<string>(Array.isArray(raw.missingOrUnclearFields) ? raw.missingOrUnclearFields : []);
  if (!truck) missing.add('Vehicle No.');
  if (!raw.packages) missing.add('Packages');
  if (highlightTotalFreight) missing.add('Total Freight (Domestic — Please Enter Freight)');

  return {
    ...raw,
    truckNo: truck,
    vehicleNo: truck,
    isCrossBorder,
    destinationCountry: raw.destinationCountry || border.country,
    highlightTotalFreight,
    missingOrUnclearFields: Array.from(missing),
    rotatedDataUrl,
    appliedRotationDeg,
    rawTesseractText: rawText,
  };
}

export async function scanPhysicalLR(
  file: File,
  onStatus?: (msg: string) => void
): Promise<{ result: ScannedLRResult; compressedDataUrl: string }> {
  onStatus?.('Auto-rotating & normalizing scan orientation...');
  let { dataUrl, base64, mimeType, appliedRotationDeg } = await autoRotateAndCompressImage(file, 1600, 0.78);

  let rawText = '';
  try {
    onStatus?.('Running background Tesseract OCR worker...');
    rawText = await runTesseractOCR(dataUrl, (pct) => {
      onStatus?.(`Background OCR scanning (${pct}%)...`);
    });

    // Smart auto-rotate fallback: if initial text yield is very sparse (< 22 alnum chars), probe 90° and 180°
    const alnumLen = (rawText.match(/[A-Za-z0-9]/g) || []).length;
    if (alnumLen < 22) {
      for (const deg of [90, 270, 180]) {
        onStatus?.(`Detecting sideways/inverted text (testing ${deg}°)...`);
        const candidate = await rotateDataUrlDegrees(dataUrl, deg, 0.78);
        const candText = await runTesseractOCR(candidate.dataUrl);
        const candLen = (candText.match(/[A-Za-z0-9]/g) || []).length;
        if (candLen > Math.max(alnumLen + 15, 28)) {
          dataUrl = candidate.dataUrl;
          base64 = candidate.base64;
          mimeType = candidate.mimeType;
          rawText = candText;
          appliedRotationDeg = (appliedRotationDeg + deg) % 360;
          break;
        }
      }
    }
  } catch {
    rawText = '';
  }

  try {
    onStatus?.('Analyzing handwritten & printed LR fields with AI High-Thinking Vision...');
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
          result: enrichScannedLR(json.data, dataUrl, appliedRotationDeg, rawText),
          compressedDataUrl: dataUrl,
        };
      }
    }
  } catch {
    // Fall back to local Tesseract regex extraction if offline
  }

  const fallback = fallbackRegexParseLR(rawText);
  fallback.rotatedDataUrl = dataUrl;
  fallback.appliedRotationDeg = appliedRotationDeg;
  return {
    result: fallback,
    compressedDataUrl: dataUrl,
  };
}

function detectPODShortageKeywords(text: string): { detected: boolean; reason: string } {
  const match = text.match(/(shortage|short\s*recv|short\s*qty|breakage|broken|damaged|leakage|leaked|wet\s*cargo|seal\s*broken)[^\n]*/i);
  if (match) {
    return { detected: true, reason: match[0].trim() };
  }
  return { detected: false, reason: '' };
}

export async function scanPODDocument(
  file: File,
  onStatus?: (msg: string) => void
): Promise<{ result: ScannedPODResult; compressedDataUrl: string }> {
  onStatus?.('Auto-rotating & compressing signed POD scan...');
  let { dataUrl, base64, mimeType, appliedRotationDeg } = await autoRotateAndCompressImage(file, 1200, 0.68);

  let rawText = '';
  try {
    onStatus?.('Scanning POD date, stamp & handwritten notes...');
    rawText = await runTesseractOCR(dataUrl);
    const alnumLen = (rawText.match(/[A-Za-z0-9]/g) || []).length;
    if (alnumLen < 18) {
      for (const deg of [90, 270, 180]) {
        const candidate = await rotateDataUrlDegrees(dataUrl, deg, 0.68);
        const candText = await runTesseractOCR(candidate.dataUrl);
        const candLen = (candText.match(/[A-Za-z0-9]/g) || []).length;
        if (candLen > Math.max(alnumLen + 12, 22)) {
          dataUrl = candidate.dataUrl;
          base64 = candidate.base64;
          mimeType = candidate.mimeType;
          rawText = candText;
          appliedRotationDeg = (appliedRotationDeg + deg) % 360;
          break;
        }
      }
    }
  } catch {
    rawText = '';
  }

  try {
    onStatus?.('Verifying receiver signature, challan date & shortage/breakage notes...');
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
        const shortageCheck = detectPODShortageKeywords(`${json.data.remarks || ''} ${json.data.podRemarks || ''} ${rawText}`);
        const detected = Boolean(json.data.shortageBreakageLeakageDetected || shortageCheck.detected);
        const reason = json.data.shortageBreakageReason || shortageCheck.reason || '';
        const podRemarks =
          json.data.podRemarks ||
          json.data.remarks ||
          (detected ? `ALERT: ${reason}` : 'Clean POD received with signature/stamp.');
        return {
          result: {
            ...json.data,
            shortageBreakageLeakageDetected: detected,
            shortageBreakageReason: reason,
            podRemarks,
            remarks: podRemarks,
            rotatedDataUrl: dataUrl,
            appliedRotationDeg,
            rawTesseractText: rawText,
          },
          compressedDataUrl: dataUrl,
        };
      }
    }
  } catch {
    // Offline fallback
  }

  const dateMatch = rawText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  const shortageCheck = detectPODShortageKeywords(rawText);
  return {
    result: {
      signedDetected: true,
      podDate: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '',
      shortageBreakageLeakageDetected: shortageCheck.detected,
      shortageBreakageReason: shortageCheck.reason,
      podRemarks: shortageCheck.detected
        ? `ALERT: ${shortageCheck.reason}`
        : 'Scanned locally (offline mode)',
      remarks: shortageCheck.detected
        ? `ALERT: ${shortageCheck.reason}`
        : 'Scanned locally (offline mode)',
      missingOrUnclearFields: !dateMatch ? ['Received Challan Date'] : [],
      rotatedDataUrl: dataUrl,
      appliedRotationDeg,
      rawTesseractText: rawText,
    },
    compressedDataUrl: dataUrl,
  };
}
