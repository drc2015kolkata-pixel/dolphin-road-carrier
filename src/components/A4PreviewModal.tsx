import React, { useState } from 'react';
import { CheckCircle2, CloudUpload, Download, Printer, X } from 'lucide-react';
import { GeneratedPdfResult } from '../lib/pdfEngine';
import { DriveFolderName } from '../types/erp';

interface A4PreviewModalProps {
  pdf: GeneratedPdfResult | null;
  driveFolder: DriveFolderName;
  hasDriveToken: boolean;
  onClose: () => void;
  onSaveToDrive: (pdf: GeneratedPdfResult, folder: DriveFolderName) => Promise<void>;
  onConnectDrive: () => Promise<void>;
}

export const A4PreviewModal: React.FC<A4PreviewModalProps> = ({
  pdf,
  driveFolder,
  hasDriveToken,
  onClose,
  onSaveToDrive,
  onConnectDrive,
}) => {
  const [uploading, setUploading] = useState(false);
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
              {pdf.fileName} · Compressed Size: {pdf.sizeKB} KB · A4 Print Ready
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print A4
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Save PDF
            </button>
            {hasDriveToken ? (
              <button
                type="button"
                disabled={uploading}
                onClick={handleDriveUpload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                {uploading ? 'Uploading...' : `Drive: ${driveFolder}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnectDrive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                Connect Drive
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/20 text-white transition-colors"
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
