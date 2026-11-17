import React, { useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  FileText,
  Printer,
  RotateCw,
  X,
} from 'lucide-react';
import { GeneratedPdfResult } from '../lib/pdfEngine';
import { PdfOrientation } from '../lib/pdfBuilders';
import { DriveFolderName } from '../types/erp';

interface A4PreviewModalProps {
  pdf: GeneratedPdfResult | null;
  driveFolder: DriveFolderName;
  hasDriveToken: boolean;
  onClose: () => void;
  onSaveToDrive: (pdf: GeneratedPdfResult, folder: DriveFolderName) => Promise<void>;
  onConnectDrive: () => Promise<void>;
  onReplacePdf?: (nextPdf: GeneratedPdfResult) => void;
}

export const A4PreviewModal: React.FC<A4PreviewModalProps> = ({
  pdf,
  driveFolder,
  hasDriveToken,
  onClose,
  onSaveToDrive,
  onConnectDrive,
  onReplacePdf,
}) => {
  const [uploading, setUploading] = useState(false);
  const [switchingOrientation, setSwitchingOrientation] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  if (!pdf) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = pdf.blobUrl;
    a.download = pdf.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePrint = () => {
    const iframe = document.getElementById('drc-a4-preview-frame') as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } else {
      handleDownload();
    }
  };

  const handleOrientationChange = async (next: PdfOrientation) => {
    if (!pdf.rebuildWithOrientation || !onReplacePdf || pdf.orientation === next) return;
    setSwitchingOrientation(true);
    try {
      const rebuilt = await pdf.rebuildWithOrientation(next);
      onReplacePdf(rebuilt);
    } finally {
      setSwitchingOrientation(false);
    }
  };

  const handleDriveUpload = async () => {
    setUploading(true);
    setUploadMsg(null);
    try {
      await onSaveToDrive(pdf, driveFolder);
      setUploadMsg(`Saved to Google Drive / ${driveFolder} (${pdf.sizeKB} KB)`);
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : 'Drive upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-3 md:p-6">
      <div className="w-full max-w-5xl h-[92vh] bg-white rounded-xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white">
          <div className="min-w-0">
            <h3 className="text-base font-bold truncate">{pdf.title}</h3>
            <p className="text-xs text-blue-100 truncate">
              {pdf.fileName} · {pdf.sizeKB} KB · A4{' '}
              {pdf.orientation === 'l' ? 'Landscape (297×210mm)' : 'Portrait (210×297mm)'} · Single Combined PDF
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Dynamic Portrait / Landscape Switcher */}
            {pdf.rebuildWithOrientation && onReplacePdf && (
              <div className="inline-flex items-center rounded-lg bg-white/15 p-0.5 text-[11px] font-bold">
                <button
                  type="button"
                  disabled={switchingOrientation}
                  onClick={() => handleOrientationChange('p')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    pdf.orientation === 'p'
                      ? 'bg-white text-[#0D47A1]'
                      : 'text-white hover:bg-white/15'
                  }`}
                  title="Switch to A4 Portrait"
                >
                  <FileText className="w-3 h-3" />
                  Portrait
                </button>
                <button
                  type="button"
                  disabled={switchingOrientation}
                  onClick={() => handleOrientationChange('l')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    pdf.orientation === 'l'
                      ? 'bg-white text-[#0D47A1]'
                      : 'text-white hover:bg-white/15'
                  }`}
                  title="Switch to A4 Landscape"
                >
                  <RotateCw className={`w-3 h-3 ${switchingOrientation ? 'animate-spin' : ''}`} />
                  Landscape
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print A4
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>
            {hasDriveToken ? (
              <button
                type="button"
                disabled={uploading}
                onClick={handleDriveUpload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                {uploading ? 'Uploading...' : `Drive: ${driveFolder}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnectDrive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                Connect Drive
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/20 text-white transition-colors cursor-pointer"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {uploadMsg && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{uploadMsg}</span>
          </div>
        )}

        <div className="flex-1 bg-slate-200 p-3">
          <iframe
            id="drc-a4-preview-frame"
            src={pdf.blobUrl}
            title={pdf.title}
            className="w-full h-full rounded-lg bg-white border border-slate-300"
          />
        </div>
      </div>
    </div>
  );
};
