import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  FolderOpen,
  Mail,
  MessageSquare,
  Printer,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ScanLine,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  BusinessMode,
  CompanySettings,
  ConsignmentNote,
  Invoice,
  LorryHire,
} from '../types/erp';
import { formatDateDDMMYYYY, makeSafeDocId, normalizeFyLabel, todayISO } from '../lib/formatters';
import { validateSafeUploadFile } from '../lib/gstinValidator';
import { autoRotateAndCompressImage, rotateDataUrlDegrees } from '../lib/ocrEngine';
import {
  downloadPdfDirect,
  GeneratedPdfResult,
  generatePodScanPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import { uploadRoleOrganizedPdfToDrive } from '../lib/driveBackup';
import { upsertDocument } from '../lib/firestoreStore';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { openCameraStreamWithFallback, stopMediaStream } from '../lib/cameraHelper';
import { RichEntityPicker } from './RichEntityPicker';
import { CameraPodQrScannerModal } from './CameraPodQrScannerModal';

interface UniversalPodScannerPageProps {
  ownerUid: string;
  activeFy: string;
  businessMode: BusinessMode;
  company: CompanySettings;
  lorryHires: LorryHire[];
  consignments: ConsignmentNote[];
  invoices?: Invoice[];
  hasDriveToken: boolean;
  driveAccessToken: string | null;
  connectedDriveEmail?: string | null;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'POD_Scans') => void;
}

async function applySharpDocEnhance(
  dataUrl: string,
  mode: 'color' | 'bw'
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.filter =
    mode === 'bw'
      ? 'grayscale(100%) contrast(165%) brightness(108%)'
      : 'contrast(124%) brightness(104%) saturate(112%)';
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export const UniversalPodScannerPage: React.FC<UniversalPodScannerPageProps> = ({
  ownerUid,
  activeFy,
  businessMode,
  company,
  lorryHires,
  consignments,
  invoices = [],
  hasDriveToken,
  driveAccessToken,
  connectedDriveEmail,
  onPreviewPdf,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerWatchTimerRef = useRef<number | null>(null);
  const seenFilesRef = useRef<Set<string>>(new Set());

  const [selectedHireId, setSelectedHireId] = useState('');
  const [hireSearchText, setHireSearchText] = useState('');
  const [lookupMode, setLookupMode] = useState<'cn' | 'truckDate' | 'invEwb'>('cn');
  const [lookupCnInput, setLookupCnInput] = useState('');
  const [lookupTruckInput, setLookupTruckInput] = useState('');
  const [lookupDateInput, setLookupDateInput] = useState('');
  const [lookupInvEwbInput, setLookupInvEwbInput] = useState('');
  const [showSavedList, setShowSavedList] = useState(false);
  const [camStudioOpen, setCamStudioOpen] = useState(false);

  const [cnNo, setCnNo] = useState('');
  const [truckNo, setTruckNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [podDate, setPodDate] = useState(todayISO());
  const [remarks, setRemarks] = useState('POD Received & Verified (Signed Copy)');

  const [podImageUrl, setPodImageUrl] = useState('');
  const [originalImageUrl, setOriginalImageUrl] = useState('');
  const [generatedPdf, setGeneratedPdf] = useState<GeneratedPdfResult | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerFolderWatching, setScannerFolderWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Order unsettled hires first so pending PODs appear at the top
  const sortedHires = useMemo(() => {
    return [...lorryHires].sort((a, b) => {
      if (Boolean(a.podReceived) !== Boolean(b.podReceived)) {
        return a.podReceived ? 1 : -1;
      }
      return (b.cnDate || '').localeCompare(a.cnDate || '');
    });
  }, [lorryHires]);

  const selectedHire = useMemo(
    () => sortedHires.find((lh) => lh.id === selectedHireId) || null,
    [sortedHires, selectedHireId]
  );

  const savedPodHires = useMemo(
    () =>
      lorryHires
        .filter((lh) => Boolean(lh.podReceived))
        .sort((a, b) => (b.podReceiveDate || b.cnDate || '').localeCompare(a.podReceiveDate || a.cnDate || '')),
    [lorryHires]
  );

  const stopCamera = () => {
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (scannerWatchTimerRef.current !== null) {
        window.clearInterval(scannerWatchTimerRef.current);
      }
    };
  }, []);

  // Support Ctrl+V direct paste of scanner image from Windows/Android clipboard
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find((it) => it.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;
      const check = validateSafeUploadFile(file, 'image_only');
      if (!check.valid) return;
      const res = await autoRotateAndCompressImage(file, 1440, 0.85);
      setOriginalImageUrl(res.dataUrl);
      setPodImageUrl(res.dataUrl);
      setStatusMsg('Captured pasted POD scan image from clipboard.');
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleClearPodForm = () => {
    stopCamera();
    setSelectedHireId('');
    setHireSearchText('');
    setLookupCnInput('');
    setLookupTruckInput('');
    setLookupDateInput('');
    setLookupInvEwbInput('');
    setCnNo('');
    setTruckNo('');
    setPartyName('');
    setPodDate(todayISO());
    setRemarks('POD Received & Verified (Signed Copy)');
    setPodImageUrl('');
    setOriginalImageUrl('');
    setGeneratedPdf(null);
    setStatusMsg('');
  };

  const handleSelectHire = (lh: LorryHire) => {
    setSelectedHireId(lh.id);
    setHireSearchText(`${lh.cnNo} · ${lh.truckNo}`);
    setCnNo(lh.cnNo || '');
    setTruckNo(lh.truckNo || '');
    const matchingCn = consignments.find(
      (c) => (c.cnNo || '').trim().toUpperCase() === (lh.cnNo || '').trim().toUpperCase()
    );
    setPartyName(matchingCn?.billingPartyName || matchingCn?.consignorName || lh.ownerName || '');
    setPodDate(lh.podReceiveDate || todayISO());
    if (lh.podScanDataUrl || lh.podImageDataUrl) {
      const existingImg = lh.podScanDataUrl || lh.podImageDataUrl || '';
      setOriginalImageUrl(existingImg);
      setPodImageUrl(existingImg);
    } else {
      setOriginalImageUrl('');
      setPodImageUrl('');
    }
    setGeneratedPdf(null);
    if (lh.podRemarks) setRemarks(lh.podRemarks);
  };

  const handleMatchTripForPod = () => {
    let matchedHire: LorryHire | undefined;
    let matchedCn: ConsignmentNote | undefined;
    let matchedInvoice: Invoice | undefined;

    if (lookupMode === 'cn') {
      const q = lookupCnInput.trim().toUpperCase();
      if (!q) {
        setStatusMsg('Enter CN No to search and match.');
        return;
      }
      matchedHire = lorryHires.find((lh) => (lh.cnNo || '').trim().toUpperCase() === q) ||
        lorryHires.find((lh) => (lh.cnNo || '').trim().toUpperCase().includes(q));
      matchedCn = consignments.find((c) => (c.cnNo || '').trim().toUpperCase() === q) ||
        consignments.find((c) => (c.cnNo || '').trim().toUpperCase().includes(q));
    } else if (lookupMode === 'truckDate') {
      const tq = lookupTruckInput.trim().toUpperCase().replace(/\s+/g, '');
      const dq = lookupDateInput.trim();
      if (!tq) {
        setStatusMsg('Enter Truck No (and optional Date) to match.');
        return;
      }
      matchedHire =
        lorryHires.find(
          (lh) =>
            (lh.truckNo || '').toUpperCase().replace(/\s+/g, '').includes(tq) &&
            (!dq || lh.cnDate === dq)
        ) ||
        lorryHires.find((lh) => (lh.truckNo || '').toUpperCase().replace(/\s+/g, '').includes(tq));
      matchedCn =
        consignments.find(
          (c) =>
            (c.truckNo || '').toUpperCase().replace(/\s+/g, '').includes(tq) &&
            (!dq || c.cnDate === dq)
        ) ||
        consignments.find((c) => (c.truckNo || '').toUpperCase().replace(/\s+/g, '').includes(tq));
    } else {
      const q = lookupInvEwbInput.trim().toUpperCase();
      if (!q) {
        setStatusMsg('Enter Party Invoice No or E-Way Bill No to match.');
        return;
      }
      matchedCn = consignments.find((c) => {
        const invHit =
          (c.partyInvoiceNo || '').toUpperCase() === q ||
          (c.partyInvoiceNo || '').toUpperCase().includes(q) ||
          (c.extraTaxInvoices || []).some((ti) => (ti.no || '').toUpperCase().includes(q));
        const ewbHit =
          (c.ewayBillNo || '').toUpperCase() === q ||
          (c.ewayBillNo || '').toUpperCase().includes(q) ||
          (c.extraEwayBills || []).some((ew) => (ew.no || '').toUpperCase().includes(q));
        return invHit || ewbHit;
      });
      if (!matchedCn) {
        matchedInvoice = invoices.find(
          (inv) =>
            (inv.invoiceNo || '').toUpperCase() === q ||
            (inv.invoiceNo || '').toUpperCase().includes(q)
        );
        const firstRowCn = matchedInvoice?.consignmentRows?.[0]?.cnNo;
        if (firstRowCn) {
          matchedCn = consignments.find(
            (c) => (c.cnNo || '').trim().toUpperCase() === firstRowCn.trim().toUpperCase()
          );
        }
      }
      if (matchedCn) {
        matchedHire = lorryHires.find(
          (lh) => (lh.cnNo || '').trim().toUpperCase() === (matchedCn?.cnNo || '').trim().toUpperCase()
        );
      } else if (matchedInvoice?.consignmentRows?.[0]?.cnNo) {
        const targetCnNo = matchedInvoice.consignmentRows[0].cnNo.trim().toUpperCase();
        matchedHire = lorryHires.find((lh) => (lh.cnNo || '').trim().toUpperCase() === targetCnNo);
      }
    }

    if (matchedHire) {
      handleSelectHire(matchedHire);
      playVerifiedBeep();
      setStatusMsg(
        `Matched Lorry Hire CN ${matchedHire.cnNo} (${matchedHire.truckNo}) · Ready for POD capture & save.`
      );
      return;
    }

    if (matchedCn) {
      setSelectedHireId('');
      setHireSearchText(`${matchedCn.cnNo} · ${matchedCn.truckNo || ''}`);
      setCnNo(matchedCn.cnNo || '');
      setTruckNo(matchedCn.truckNo || '');
      setPartyName(matchedCn.billingPartyName || matchedCn.consignorName || '');
      setPodDate(todayISO());
      playVerifiedBeep();
      setStatusMsg(
        `Matched Consignment CN ${matchedCn.cnNo} (${matchedCn.truckNo || 'No Truck'}) — saving POD will auto-link & create its Lorry Hire POD record.`
      );
      return;
    }

    if (matchedInvoice) {
      const firstRow = matchedInvoice.consignmentRows?.[0];
      setSelectedHireId('');
      setCnNo(firstRow?.cnNo || matchedInvoice.invoiceNo);
      setTruckNo(firstRow?.vehicle || '');
      setPartyName(matchedInvoice.partyName || '');
      playVerifiedBeep();
      setStatusMsg(
        `Matched Party Bill ${matchedInvoice.invoiceNo} (${matchedInvoice.partyName}) — ready to save POD.`
      );
      return;
    }

    playAlertBeep();
    setStatusMsg('No matching CN, Truck + Date, Party Invoice, or E-Way Bill found.');
  };

  const handleStartCamera = async () => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMsg('Camera API unavailable here. Use File Upload, Ctrl+V Paste, or USB Scanner Watch.');
      return;
    }
    try {
      const { stream, modeUsed } = await openCameraStreamWithFallback();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraActive(true);
      setStatusMsg(
        `${modeUsed === 'rear' ? 'Rear Camera' : modeUsed === 'front' ? 'Front Webcam' : 'USB / System Camera'} active — align signed POD page clearly and click Capture.`
      );
    } catch {
      setStatusMsg('Camera access denied or unavailable. Please upload scan file or use USB Scanner folder.');
    }
  };

  const handleSnapCamera = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth <= 0) return;
    const scale = Math.min(1, 1440 / vid.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vid.videoWidth * scale);
    canvas.height = Math.round(vid.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.85);
    setOriginalImageUrl(url);
    setPodImageUrl(url);
    stopCamera();
    setStatusMsg('Captured POD photo cleanly. Adjust contrast or generate Low-KB PDF.');
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    const check = validateSafeUploadFile(file, 'image_only');
    if (!check.valid) {
      playAlertBeep();
      setStatusMsg(check.reason || 'Unsupported file format.');
      return;
    }
    const res = await autoRotateAndCompressImage(file, 1440, 0.86);
    setOriginalImageUrl(res.dataUrl);
    setPodImageUrl(res.dataUrl);
    setGeneratedPdf(null);
    setStatusMsg(`Loaded ${file.name} (${Math.round(file.size / 1024)} KB source).`);
  };

  const handleWatchUsbScannerFolder = async () => {
    const win = window as unknown as {
      showDirectoryPicker?: () => Promise<{
        values: () => AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }>;
      }>;
    };
    if (!win.showDirectoryPicker) {
      setStatusMsg('USB Scanner folder auto-watch requires Chrome / Edge desktop browser.');
      return;
    }
    try {
      const dirHandle = await win.showDirectoryPicker();
      if (scannerWatchTimerRef.current !== null) {
        window.clearInterval(scannerWatchTimerRef.current);
      }
      setScannerFolderWatching(true);
      setStatusMsg('USB Scanner auto-watch active! Scan a page on HP / Canon / Epson scanner.');
      const poll = async () => {
        try {
          for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && /\.(jpe?g|png|webp)$/i.test(entry.name) && entry.getFile) {
              if (!seenFilesRef.current.has(entry.name)) {
                seenFilesRef.current.add(entry.name);
                const f = await entry.getFile();
                await handleFileUpload(f);
              }
            }
          }
        } catch {
          // ignore transient lock while scanner writes file
        }
      };
      void poll();
      scannerWatchTimerRef.current = window.setInterval(() => void poll(), 2000);
    } catch {
      setScannerFolderWatching(false);
    }
  };

  const handleBuildLowKbPdf = async (): Promise<GeneratedPdfResult | null> => {
    if (!podImageUrl) {
      setStatusMsg('Please capture or upload a POD image first.');
      return null;
    }
    setBusy(true);
    try {
      const pdf = await generatePodScanPDF({
        imageDataUrl: podImageUrl,
        truckNo: truckNo || 'TRUCK',
        cnNo: cnNo || 'NOCN',
        podDate,
        remarks,
        partyName,
        division: businessMode,
        company,
        orientation: 'p',
      });
      setGeneratedPdf(pdf);
      setStatusMsg(
        `Generated crystal-clear Low-KB PDF: ${pdf.fileName} (${pdf.sizeKB} KB — target 100–350 KB).`
      );
      return pdf;
    } finally {
      setBusy(false);
    }
  };

  const handleSavePod = async () => {
    const pdf = generatedPdf || (await handleBuildLowKbPdf());
    if (!pdf) return;
    setBusy(true);
    try {
      const compressedImg = podImageUrl.slice(0, 420000);
      const matchedCnObj = consignments.find(
        (c) => (c.cnNo || '').trim().toUpperCase() === cnNo.trim().toUpperCase()
      );
      const targetHire =
        selectedHire ||
        lorryHires.find(
          (lh) =>
            cnNo.trim() && (lh.cnNo || '').trim().toUpperCase() === cnNo.trim().toUpperCase()
        ) ||
        null;

      let savedTargetMsg = '';
      if (targetHire) {
        await upsertDocument(
          'lorry_hires',
          targetHire.id,
          {
            podReceived: true,
            podReceiveDate: podDate,
            podFileName: pdf.fileName,
            podImageDataUrl: compressedImg,
            podScanFileName: pdf.fileName,
            podScanDataUrl: compressedImg,
            podRemarks: remarks,
            ownerUid,
          },
          false
        );
        savedTargetMsg = `POD saved & linked to CN ${targetHire.cnNo}`;
      } else if (cnNo.trim() || truckNo.trim()) {
        const newHireId = makeSafeDocId('lh_pod');
        await upsertDocument(
          'lorry_hires',
          newHireId,
          {
            cnNo: (cnNo.trim() || `POD-${todayISO()}`).slice(0, 40),
            cnDate: matchedCnObj?.cnDate || podDate,
            financialYear: normalizeFyLabel(activeFy),
            division: businessMode,
            truckNo: (truckNo.trim() || matchedCnObj?.truckNo || 'TRUCK').toUpperCase().slice(0, 24),
            ownerName: matchedCnObj?.ownerName || '',
            brokerName: matchedCnObj?.brokerName || '',
            fromCity: matchedCnObj?.fromCity || '',
            toCity: matchedCnObj?.toCity || '',
            hireAmount: Number(matchedCnObj?.lorryHire || 0),
            advancePaid: Number(matchedCnObj?.advancePaid || 0),
            balancePayable: Math.max(
              0,
              Number(matchedCnObj?.lorryHire || 0) - Number(matchedCnObj?.advancePaid || 0)
            ),
            podReceived: true,
            podReceiveDate: podDate,
            podFileName: pdf.fileName,
            podImageDataUrl: compressedImg,
            podScanFileName: pdf.fileName,
            podScanDataUrl: compressedImg,
            podRemarks: remarks,
            paid: false,
            ownerUid,
          },
          true
        );
        setSelectedHireId(newHireId);
        savedTargetMsg = `POD saved & linked to new Lorry Hire record (${cnNo || truckNo})`;
      }

      if (hasDriveToken && driveAccessToken) {
        const up = await uploadRoleOrganizedPdfToDrive({
          accessToken: driveAccessToken,
          fy: activeFy,
          rootFolderName: company.driveRootFolder,
          category: 'POD',
          fileName: pdf.fileName,
          blob: pdf.blob,
          connectedEmail: connectedDriveEmail,
        });
        setStatusMsg(
          `${savedTargetMsg || 'Saved POD'} & uploaded to Drive (${up.folderPath}/${up.name} · ${pdf.sizeKB} KB${
            up.cleanedScratchCount > 0 ? ` · Cleaned ${up.cleanedScratchCount} scratch file(s)` : ''
          }).`
        );
      } else {
        setStatusMsg(
          savedTargetMsg
            ? `${savedTargetMsg} (${pdf.fileName} · ${pdf.sizeKB} KB).`
            : `Low-KB POD PDF ready: ${pdf.fileName} (${pdf.sizeKB} KB).`
        );
      }
      playVerifiedBeep();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save POD.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <ScanLine className="w-5 h-5 text-amber-300 shrink-0" />
            <div>
              <h2 className="text-sm sm:text-base font-extrabold">
                Universal Low-KB POD Scanner &amp; Year-Wise Drive Archiver ({activeFy}/POD)
              </h2>
              <p className="text-[11px] text-blue-100">
                Strict filename POD_[CNNo]_[TruckNo]_[DD-MM-YYYY].pdf · Auto-compressed 100 KB–350 KB · Camera / USB Scanner / Paste
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={handleClearPodForm}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-bold cursor-pointer border border-white/25"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear / Skip
            </button>
            <button
              type="button"
              onClick={() => setShowSavedList((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Saved List / Rectify ({savedPodHires.length})
            </button>
            <button
              type="button"
              disabled={busy || !podImageUrl}
              onClick={async () => {
                const pdf = generatedPdf || (await handleBuildLowKbPdf());
                if (pdf) onPreviewPdf(pdf, 'POD_Scans');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white text-[#0D47A1] font-bold hover:bg-blue-50 cursor-pointer disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              type="button"
              disabled={busy || !podImageUrl}
              onClick={async () => {
                const pdf = generatedPdf || (await handleBuildLowKbPdf());
                if (pdf) downloadPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Low-KB PDF
            </button>
            <button
              type="button"
              disabled={busy || !podImageUrl}
              onClick={async () => {
                const pdf = generatedPdf || (await handleBuildLowKbPdf());
                if (pdf) printPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              Manual Print
            </button>
            <button
              type="button"
              onClick={() => setCamStudioOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              Interactive Scan Studio
            </button>
            <button
              type="button"
              disabled={busy || !podImageUrl}
              onClick={async () => {
                const pdf = generatedPdf || (await handleBuildLowKbPdf());
                if (!pdf) return;
                const res = await sharePdfDirect({
                  pdf,
                  channel: 'whatsapp',
                  partyName,
                  docNo: cnNo || truckNo || 'POD',
                  docLabel: 'Signed POD Copy',
                  company,
                });
                setStatusMsg(res.message);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-bold cursor-pointer disabled:opacity-50"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              WhatsApp PDF
            </button>
            <button
              type="button"
              disabled={busy || !podImageUrl}
              onClick={async () => {
                const pdf = generatedPdf || (await handleBuildLowKbPdf());
                if (!pdf) return;
                const res = await sharePdfDirect({
                  pdf,
                  channel: 'email',
                  partyName,
                  docNo: cnNo || truckNo || 'POD',
                  docLabel: 'Signed POD Copy',
                  company,
                });
                setStatusMsg(res.message);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5" />
              Email PDF
            </button>
            <button
              type="button"
              disabled={busy || !podImageUrl}
              onClick={() => void handleSavePod()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-900 hover:bg-blue-950 text-white font-extrabold cursor-pointer disabled:opacity-50 border border-blue-400"
            >
              <Save className="w-3.5 h-3.5" />
              Save POD
            </button>
          </div>
        </div>

        {showSavedList && (
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-extrabold text-amber-950">
                Saved POD Copies ({savedPodHires.length}) — Click any record to load &amp; rectify
              </span>
              <button
                type="button"
                onClick={() => setShowSavedList(false)}
                className="text-xs font-bold text-amber-900 hover:underline cursor-pointer"
              >
                Close List
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
              {savedPodHires.slice(0, 24).map((lh) => (
                <button
                  key={lh.id}
                  type="button"
                  onClick={() => {
                    handleSelectHire(lh);
                    setShowSavedList(false);
                  }}
                  className="text-left p-2 rounded-lg bg-white border border-amber-300 hover:bg-amber-100/70 text-xs cursor-pointer"
                >
                  <div className="font-mono-num font-bold text-[#0D47A1]">
                    {lh.cnNo} · {lh.truckNo}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    POD Date: {formatDateDDMMYYYY(lh.podReceiveDate)} · {lh.podFileName || 'POD Saved'}
                  </div>
                </button>
              ))}
              {savedPodHires.length === 0 && (
                <div className="text-xs text-slate-500 col-span-full">No saved POD records yet.</div>
              )}
            </div>
          </div>
        )}

        <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
          {/* Left Form & Capture Controls */}
          <div className="lg:col-span-5 space-y-3">
            <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 space-y-2">
              <div className="font-bold text-[#0D47A1] flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Smart Match Trip by CN No, Truck No + Date, or Party Invoice / E-Way Bill
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'cn', label: 'CN No' },
                  { id: 'truckDate', label: 'Truck No + Date' },
                  { id: 'invEwb', label: 'Party Inv / E-Way Bill' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setLookupMode(m.id as 'cn' | 'truckDate' | 'invEwb')}
                    className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer ${
                      lookupMode === m.id
                        ? 'bg-[#0D47A1] text-white'
                        : 'bg-white text-slate-700 border border-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {lookupMode === 'cn' && (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={lookupCnInput}
                    onChange={(e) => setLookupCnInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleMatchTripForPod();
                      }
                    }}
                    placeholder="Enter CN / Bilty No..."
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={handleMatchTripForPod}
                    className="px-3 py-1.5 rounded bg-[#0D47A1] hover:bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    Find &amp; Load
                  </button>
                </div>
              )}
              {lookupMode === 'truckDate' && (
                <div className="flex flex-wrap gap-1.5">
                  <input
                    type="text"
                    value={lookupTruckInput}
                    onChange={(e) => setLookupTruckInput(e.target.value.toUpperCase())}
                    placeholder="Truck No (WB23...)"
                    className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num uppercase"
                  />
                  <input
                    type="date"
                    value={lookupDateInput}
                    onChange={(e) => setLookupDateInput(e.target.value)}
                    className="px-2 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={handleMatchTripForPod}
                    className="px-3 py-1.5 rounded bg-[#0D47A1] hover:bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    Find
                  </button>
                </div>
              )}
              {lookupMode === 'invEwb' && (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={lookupInvEwbInput}
                    onChange={(e) => setLookupInvEwbInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleMatchTripForPod();
                      }
                    }}
                    placeholder="Party Invoice No or 12-digit E-Way Bill..."
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={handleMatchTripForPod}
                    className="px-3 py-1.5 rounded bg-[#0D47A1] hover:bg-blue-900 text-white font-bold cursor-pointer"
                  >
                    Match
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                1. Link to Lorry Hire / CN No (Unsettled Shown First)
              </label>
              <RichEntityPicker<LorryHire>
                ariaLabel="Select Lorry Hire for POD"
                value={hireSearchText}
                selectedId={selectedHireId}
                onChangeText={setHireSearchText}
                onSelectEntity={handleSelectHire}
                items={sortedHires}
                getId={(lh) => lh.id}
                getValue={(lh) => `${lh.cnNo} · ${lh.truckNo}`}
                getSearchText={(lh) =>
                  `${lh.cnNo} ${lh.truckNo} ${lh.ownerName || ''} ${lh.brokerName || ''} ${lh.toCity || ''}`
                }
                renderTitle={(lh) => `${lh.cnNo} · ${lh.truckNo}`}
                renderBadge={(lh) => (lh.podReceived ? 'POD Saved' : 'Pending POD')}
                renderDetails={(lh) =>
                  `${lh.fromCity || ''} → ${lh.toCity || ''} | Date: ${formatDateDDMMYYYY(lh.cnDate)}`
                }
                placeholder="Search CN No, Truck No, Owner or Broker..."
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">C/N No :</label>
                <input
                  type="text"
                  value={cnNo}
                  onChange={(e) => setCnNo(e.target.value)}
                  placeholder="CN-101"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Truck No :</label>
                <input
                  type="text"
                  value={truckNo}
                  onChange={(e) => setTruckNo(e.target.value.toUpperCase())}
                  placeholder="WB23C6597"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">POD Date :</label>
                <input
                  type="date"
                  value={podDate}
                  onChange={(e) => setPodDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party Name :</label>
                <input
                  type="text"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="Billing Party / Consignee"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">POD Remarks :</label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-bold text-slate-800">2. Capture POD Image (Camera / Upload / USB Scanner)</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void (cameraActive ? handleSnapCamera() : handleStartCamera())}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {cameraActive ? 'Capture Photo' : 'Rear Camera'}
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-blue-700" />
                  Upload Scan
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      void handleFileUpload(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleWatchUsbScannerFolder()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-bold cursor-pointer ${
                    scannerFolderWatching
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {scannerFolderWatching ? 'USB Scanner Watching' : 'USB Scanner Folder'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Tip: Press <kbd className="px-1 bg-white border rounded">Ctrl+V</kbd> anytime to paste a scanned POD directly.
              </p>
            </div>

            {statusMsg && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                <span>{statusMsg}</span>
              </div>
            )}
          </div>

          {/* Right Live Preview & Enhancement Studio */}
          <div className="lg:col-span-7 flex flex-col bg-slate-100 rounded-xl border border-slate-300 overflow-hidden min-h-[380px]">
            <div className="px-3 py-2 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">
                {generatedPdf
                  ? `${generatedPdf.fileName} (${generatedPdf.sizeKB} KB)`
                  : 'POD Scan Preview Canvas'}
              </span>
              {podImageUrl && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const rot = await rotateDataUrlDegrees(podImageUrl, 90);
                      setPodImageUrl(rot.dataUrl);
                      setGeneratedPdf(null);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-semibold cursor-pointer"
                  >
                    <RotateCw className="w-3 h-3" />
                    Rotate 90°
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const enhanced = await applySharpDocEnhance(podImageUrl, 'color');
                      setPodImageUrl(enhanced);
                      setGeneratedPdf(null);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-700 text-[11px] font-semibold cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    Magic Color
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const enhanced = await applySharpDocEnhance(podImageUrl, 'bw');
                      setPodImageUrl(enhanced);
                      setGeneratedPdf(null);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-[11px] font-semibold cursor-pointer"
                  >
                    <Edit3 className="w-3 h-3" />
                    B&amp;W Sharp
                  </button>
                  {originalImageUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setPodImageUrl(originalImageUrl);
                        setGeneratedPdf(null);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-semibold cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleBuildLowKbPdf()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-extrabold cursor-pointer"
                  >
                    <CloudUpload className="w-3 h-3" />
                    Generate 100–350 KB PDF
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
              {cameraActive ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="max-h-[380px] rounded-lg border border-slate-400 bg-black"
                />
              ) : podImageUrl ? (
                <img
                  src={podImageUrl}
                  alt="Scanned POD"
                  className="max-h-[380px] rounded-lg shadow border border-slate-300 bg-white object-contain"
                />
              ) : (
                <div className="text-center text-slate-500 space-y-2 py-12">
                  <ScanLine className="w-10 h-10 mx-auto text-slate-400" />
                  <p className="font-semibold">No POD scan loaded yet</p>
                  <p className="text-[11px]">
                    Click Rear Camera, Upload Scan, USB Scanner Folder, or press Ctrl+V to paste.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <CameraPodQrScannerModal
        open={camStudioOpen}
        mode="both"
        title="Interactive POD & E-Way Bill Scan Studio"
        onClose={() => setCamStudioOpen(false)}
        onCapturePodImage={(dataUrl) => {
          setOriginalImageUrl(dataUrl);
          setPodImageUrl(dataUrl);
          setGeneratedPdf(null);
          setStatusMsg('Captured POD scan via Interactive Scan Studio.');
        }}
        onQrDecoded={(parsed) => {
          if (parsed.ewbNo) {
            setLookupMode('invEwb');
            setLookupInvEwbInput(parsed.ewbNo);
          }
          if (parsed.cnNo) {
            setCnNo(parsed.cnNo);
          }
          setStatusMsg(`QR Decoded${parsed.ewbNo ? ` · EWB: ${parsed.ewbNo}` : ''}${parsed.cnNo ? ` · CN: ${parsed.cnNo}` : ''}`);
        }}
      />
    </div>
  );
};
