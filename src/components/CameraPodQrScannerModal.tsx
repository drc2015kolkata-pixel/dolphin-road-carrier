import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, QrCode, RefreshCw, RotateCw, Upload, X, ScanLine } from 'lucide-react';
import { ParsedQrPayload, parseQrOrEwbPayload } from '../lib/ewayBillUtils';
import { autoRotateAndCompressImage, rotateDataUrlDegrees } from '../lib/ocrEngine';
import { validateSafeUploadFile } from '../lib/gstinValidator';
import { playAlertBeep } from '../lib/audioFeedback';

interface CameraPodQrScannerModalProps {
  open: boolean;
  mode: 'pod' | 'qr' | 'both';
  title?: string;
  onClose: () => void;
  onCapturePodImage?: (dataUrl: string, fileName: string) => void;
  onQrDecoded?: (parsed: ParsedQrPayload) => void;
}

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

function compressCanvasToPodDataUrl(canvas: HTMLCanvasElement, maxChars = 420000): string {
  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > maxChars && quality > 0.35) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > maxChars) {
    const down = document.createElement('canvas');
    const ratio = 0.72;
    down.width = Math.max(320, Math.round(canvas.width * ratio));
    down.height = Math.max(240, Math.round(canvas.height * ratio));
    const dctx = down.getContext('2d');
    if (dctx) {
      dctx.drawImage(canvas, 0, 0, down.width, down.height);
      dataUrl = down.toDataURL('image/jpeg', 0.65);
    }
  }
  return dataUrl.slice(0, 439500);
}

export const CameraPodQrScannerModal: React.FC<CameraPodQrScannerModalProps> = ({
  open,
  mode,
  title,
  onClose,
  onCapturePodImage,
  onQrDecoded,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturedPreview, setCapturedPreview] = useState('');
  const [manualQrInput, setManualQrInput] = useState('');
  const [decodedResult, setDecodedResult] = useState<ParsedQrPayload | null>(null);
  const [qrSupported] = useState<boolean>(
    () => typeof window !== 'undefined' && 'BarcodeDetector' in window
  );

  const stopCamera = () => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleDecodedRaw = (raw: string) => {
    const parsed = parseQrOrEwbPayload(raw);
    setDecodedResult(parsed);
    if (onQrDecoded) {
      onQrDecoded(parsed);
    }
  };

  const startCamera = async () => {
    stopCamera();
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera API unavailable in this browser. Use Upload Photo or Paste QR string below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraActive(true);

      if ((mode === 'qr' || mode === 'both') && 'BarcodeDetector' in window) {
        const DetectorCtor = (window as unknown as { BarcodeDetector: new (opts?: { formats?: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
        const detector = new DetectorCtor({ formats: ['qr_code', 'code_128', 'code_39'] });
        scanTimerRef.current = window.setInterval(async () => {
          const vid = videoRef.current;
          if (!vid || vid.readyState < 2) return;
          try {
            const barcodes = await detector.detect(vid);
            const firstRaw = barcodes.find((b) => Boolean(b.rawValue))?.rawValue;
            if (firstRaw) {
              handleDecodedRaw(firstRaw);
              if (mode === 'qr') {
                stopCamera();
              }
            }
          } catch {
            // ignore transient frame decode failures
          }
        }, 450);
      }
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera permission blocked or unavailable (${err.message}). Use Photo Upload or Paste QR below.`
          : 'Camera permission blocked. Use Photo Upload or Paste QR below.'
      );
    }
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCapturedPreview('');
      setDecodedResult(null);
      setCameraError('');
      return;
    }
    void startCamera();
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  if (!open) return null;

  const handleSnapPodPhoto = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth <= 0) return;
    const maxW = 1200;
    const scale = Math.min(1, maxW / vid.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vid.videoWidth * scale);
    canvas.height = Math.round(vid.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    const compressed = compressCanvasToPodDataUrl(canvas);
    setCapturedPreview(compressed);
    stopCamera();
  };

  const handleImageFileSelected = async (file: File | undefined) => {
    if (!file) return;
    const uploadCheck = validateSafeUploadFile(file, 'image_only');
    if (!uploadCheck.valid) {
      playAlertBeep();
      setCameraError(uploadCheck.reason || 'Blocked unsupported image file.');
      return;
    }
    try {
      const normalized = await autoRotateAndCompressImage(file, 1200, 0.78);
      if (mode !== 'qr') {
        setCapturedPreview(normalized.dataUrl);
      }
      if ((mode === 'qr' || mode === 'both') && 'BarcodeDetector' in window) {
        const img = new Image();
        img.onload = async () => {
          try {
            const DetectorCtor = (window as unknown as { BarcodeDetector: new (opts?: { formats?: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
            const detector = new DetectorCtor({ formats: ['qr_code', 'code_128'] });
            const found = await detector.detect(img);
            if (found[0]?.rawValue) {
              handleDecodedRaw(found[0].rawValue);
            }
          } catch {
            // ignore
          }
        };
        img.src = normalized.dataUrl;
      }
    } catch {
      // ignore invalid image read
    }
  };

  const handleRotatePreview90 = async () => {
    if (!capturedPreview) return;
    const rotated = await rotateDataUrlDegrees(capturedPreview, 90, 0.8);
    setCapturedPreview(rotated.dataUrl);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'qr' ? <QrCode className="w-5 h-5 text-emerald-400" /> : <Camera className="w-5 h-5 text-blue-400" />}
            <div>
              <h3 className="text-sm font-extrabold tracking-wide">
                {title || (mode === 'qr' ? 'DRC E-Way Bill & Verification QR Scanner' : 'In-App Camera POD & QR Scanner')}
              </h3>
              <p className="text-[11px] text-slate-300">
                Auto-compressed to &lt;440KB JPEG for instant Firestore &amp; Google Drive storage
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-600 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[82vh] overflow-y-auto">
          {cameraError && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900">
              {cameraError}
            </div>
          )}

          {!capturedPreview ? (
            <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border border-slate-800">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {!cameraActive && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 font-semibold">
                  Starting camera...
                </div>
              )}
              {(mode === 'qr' || mode === 'both') && cameraActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-emerald-400/90 rounded-xl shadow-[0_0_0_999px_rgba(15,23,42,0.35)] flex items-end justify-center pb-2">
                    <span className="px-2 py-0.5 rounded bg-slate-900/80 text-[10px] font-bold text-emerald-300 flex items-center gap-1">
                      <ScanLine className="w-3 h-3" />
                      {qrSupported ? 'Aim QR Code inside box' : 'Snap or Paste QR below'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <img
                src={capturedPreview}
                alt="Captured POD Preview"
                className="w-full max-h-72 object-contain rounded-xl border border-slate-300 bg-slate-100"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedPreview('');
                      void startCamera();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retake Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRotatePreview90()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-900 text-xs font-bold cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    Rotate 90°
                  </button>
                </div>
                {onCapturePodImage && (
                  <button
                    type="button"
                    onClick={() => {
                      const fileName = `CAM_POD_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.jpg`;
                      onCapturePodImage(capturedPreview, fileName);
                      stopCamera();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer shadow"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Use This POD Photo
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {mode !== 'qr' && cameraActive && !capturedPreview && (
              <button
                type="button"
                onClick={handleSnapPodPhoto}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-extrabold cursor-pointer shadow"
              >
                <Camera className="w-4 h-4" />
                Capture Signed POD Photo
              </button>
            )}
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-bold cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              {mode === 'qr' ? 'Upload QR Image' : 'Upload POD / QR Image'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleImageFileSelected(e.target.files?.[0])}
              />
            </label>
            {!cameraActive && !capturedPreview && (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Camera
              </button>
            )}
          </div>

          {(mode === 'qr' || mode === 'both') && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-emerald-700" />
                Hardware QR Scanner / NIC E-Way Bill Payload Decoder
              </div>
              <div className="flex gap-2">
                <input
                  value={manualQrInput}
                  onChange={(e) => setManualQrInput(e.target.value)}
                  placeholder="Scan with USB QR reader or paste DRC|LR|... / EWB No / JSON QR string"
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                />
                <button
                  type="button"
                  onClick={() => handleDecodedRaw(manualQrInput)}
                  disabled={!manualQrInput.trim()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  Decode QR
                </button>
              </div>
              {decodedResult && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-950 space-y-1">
                  <div className="font-extrabold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    {decodedResult.summary}
                  </div>
                  <div className="text-[11px] font-mono-num text-emerald-800 break-all">
                    Raw: {decodedResult.raw.slice(0, 140)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
