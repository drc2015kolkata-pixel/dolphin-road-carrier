import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  FileText,
  Mail,
  MessageCircle,
  Printer,
  RotateCw,
  X,
} from 'lucide-react';
import { GeneratedPdfResult } from '../lib/pdfEngine';
import { PdfOrientation } from '../lib/pdfBuilders';
import {
  buildEmailShareHref,
  buildWhatsAppShareHref,
  sendViaWhatsAppCloudApi,
  triggerExternalShareLink,
} from '../lib/shareUtils';
import { isLogisticsDriveFolder } from '../lib/driveBackup';
import { AnyDriveFolderName, BillCopyCount, CompanySettings, Party } from '../types/erp';

interface A4PreviewModalProps {
  pdf: GeneratedPdfResult | null;
  driveFolder: AnyDriveFolderName;
  hasDriveToken: boolean;
  parties?: Party[];
  company?: CompanySettings;
  onClose: () => void;
  onSaveToDrive: (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => Promise<void>;
  onConnectDrive: () => Promise<void>;
  onReplacePdf?: (nextPdf: GeneratedPdfResult) => void;
}

export const A4PreviewModal: React.FC<A4PreviewModalProps> = ({
  pdf,
  driveFolder,
  hasDriveToken,
  parties = [],
  company,
  onClose,
  onSaveToDrive,
  onConnectDrive,
  onReplacePdf,
}) => {
  const [uploading, setUploading] = useState(false);
  const [switchingOrientation, setSwitchingOrientation] = useState(false);
  const [switchingCopies, setSwitchingCopies] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [sharePhone, setSharePhone] = useState('');
  const [shareEmail, setShareEmail] = useState('');

  useEffect(() => {
    if (!pdf) return;
    const partyName = pdf.shareMeta?.partyName || '';
    const matchedParty = parties.find(
      (p) => p.name.trim().toLowerCase() === partyName.trim().toLowerCase()
    );
    setSharePhone(pdf.shareMeta?.phone || matchedParty?.phone || '');
    setShareEmail(pdf.shareMeta?.email || matchedParty?.email || '');
  }, [pdf, parties]);

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

  const handleCopyCountChange = async (nextCopies: BillCopyCount) => {
    if (!pdf.rebuildWithCopyCount || !onReplacePdf || pdf.copyCount === nextCopies) return;
    setSwitchingCopies(true);
    try {
      const rebuilt = await pdf.rebuildWithCopyCount(nextCopies);
      onReplacePdf(rebuilt);
    } finally {
      setSwitchingCopies(false);
    }
  };

  const handleDriveUpload = async () => {
    setUploading(true);
    setUploadMsg(null);
    try {
      await onSaveToDrive(pdf, driveFolder);
      const rootLabel = isLogisticsDriveFolder(driveFolder)
        ? 'DOLPHIN_LOGISTICS_DIVISION_BACKUP'
        : 'DOLPHIN_ROAD_CARRIERS_MASTER';
      setUploadMsg(`Saved to Google Drive / ${rootLabel} / ${driveFolder} (${pdf.sizeKB} KB)`);
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : 'Drive upload failed');
    } finally {
      setUploading(false);
    }
  };

  const companyReplyEmail = company?.email || 'drc.kolkata1@gmail.com';
  const shareText = [
    pdf.shareMeta?.summaryText || pdf.title,
    `Document File: ${pdf.fileName}`,
    company?.companyName ? `Sent by: ${company.companyName} (${company.phones}) | Email: ${companyReplyEmail}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const handleShareWhatsApp = async () => {
    if (company?.whatsappCloud?.enabled && sharePhone) {
      const apiRes = await sendViaWhatsAppCloudApi({
        company,
        toPhone: sharePhone,
        message: shareText,
      });
      if (apiRes.ok) {
        setUploadMsg(`Sent directly via WhatsApp Cloud API to ${sharePhone}.`);
        return;
      }
    }
    triggerExternalShareLink(buildWhatsAppShareHref({ phone: sharePhone, message: shareText }));
  };

  const handleShareEmail = () => {
    triggerExternalShareLink(
      buildEmailShareHref({
        email: shareEmail || companyReplyEmail,
        subject: `${pdf.title} — ${company?.companyName || 'Dolphin Road Carriers'}`,
        body: `${shareText}\n\nNote: Please find the attached PDF (${pdf.fileName}) downloaded from Dolphin Road Carriers ERP.\nReply To: ${companyReplyEmail}`,
      })
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-1.5 sm:p-3 md:p-6">
      <div className="w-full max-w-6xl h-[95vh] sm:h-[92vh] bg-white rounded-xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-5 py-3 bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold truncate">{pdf.title}</h3>
            <p className="text-[11px] sm:text-xs text-blue-100 truncate">
              {pdf.fileName} · {pdf.sizeKB} KB · A4{' '}
              {pdf.orientation === 'l' ? 'Landscape (297×210mm)' : 'Portrait (210×297mm)'} · 300-DPI Print PDF
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
            {pdf.rebuildWithCopyCount && onReplacePdf && (
              <select
                aria-label="Bill Copy Selector"
                disabled={switchingCopies}
                value={pdf.copyCount || 1}
                onChange={(e) => void handleCopyCountChange(Number(e.target.value) as BillCopyCount)}
                className="px-2.5 py-1.5 rounded-lg bg-white text-[#0D47A1] text-[11px] font-bold border border-blue-200 focus:outline-none cursor-pointer"
              >
                <option value={1}>1 Copy (Original)</option>
                <option value={2}>2 Copies (Original + Office)</option>
                <option value={3}>3 Copies (Orig + Transp + Office)</option>
                <option value={4}>4 Copies (All)</option>
              </select>
            )}

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
            <button
              type="button"
              onClick={() => void handleShareWhatsApp()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              title="Share on WhatsApp (wa.me or Cloud API)"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Share on WhatsApp
            </button>
            <button
              type="button"
              onClick={handleShareEmail}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              title="Send via Email"
            >
              <Mail className="w-3.5 h-3.5" />
              Send via Email
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

        {/* Optional Quick Recipient Strip for WhatsApp / Email */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-bold text-slate-700">Quick Share Recipient:</span>
          <input
            type="text"
            value={sharePhone}
            onChange={(e) => setSharePhone(e.target.value)}
            placeholder="WhatsApp Phone (e.g. 9062167077)"
            className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs w-48"
          />
          <input
            type="email"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            placeholder="Recipient Email"
            className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs w-56"
          />
          {pdf.shareMeta?.preferredChannel && (
            <span className="text-[11px] font-semibold text-blue-700">
              Party Prefers: {pdf.shareMeta.preferredChannel}
            </span>
          )}
        </div>

        {uploadMsg && (
          <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{uploadMsg}</span>
          </div>
        )}

        <div className="flex-1 bg-slate-200 p-2 sm:p-3">
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
