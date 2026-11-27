import React, { useState } from 'react';
import {
  Camera,
  Download,
  Edit3,
  Eye,
  Mail,
  MessageSquare,
  Printer,
  RotateCcw,
  Save,
} from 'lucide-react';

interface UniversalActionBarProps {
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  saveType?: 'button' | 'submit';
  onSavedListRectify?: () => void;
  rectifyLabel?: string;
  onPreview?: () => void;
  onDownloadPdf?: () => void;
  onPrint?: () => void;
  onScanStudio?: () => void;
  onShareWhatsApp?: () => void;
  onShareEmail?: () => void;
  onClearSkip?: () => void;
  clearLabel?: string;
  compact?: boolean;
  darkSurface?: boolean;
  className?: string;
}

export const UniversalActionBar: React.FC<UniversalActionBarProps> = ({
  onSave,
  saveLabel = 'Save',
  saveDisabled = false,
  saveType = 'button',
  onSavedListRectify,
  rectifyLabel = 'Saved List / Rectify',
  onPreview,
  onDownloadPdf,
  onPrint,
  onScanStudio,
  onShareWhatsApp,
  onShareEmail,
  onClearSkip,
  clearLabel = 'Clear / Skip',
  compact = false,
  darkSurface = false,
  className = '',
}) => {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const runAction = (key: string, fn?: () => void) => {
    if (!fn) return;
    setBusyAction(key);
    try {
      fn();
    } finally {
      window.setTimeout(() => setBusyAction(null), 180);
    }
  };

  const pad = compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {onClearSkip && (
        <button
          type="button"
          onClick={() => runAction('clear', onClearSkip)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} ${
            darkSurface
              ? 'bg-white/15 hover:bg-white/25 text-white border border-white/25'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {clearLabel}
        </button>
      )}
      {onSavedListRectify && (
        <button
          type="button"
          onClick={() => runAction('rectify', onSavedListRectify)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          {rectifyLabel}
        </button>
      )}
      {onPreview && (
        <button
          type="button"
          onClick={() => runAction('preview', onPreview)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} ${
            darkSurface
              ? 'bg-white hover:bg-blue-50 text-[#0D47A1]'
              : 'bg-blue-50 hover:bg-blue-100 text-[#0D47A1] border border-blue-200'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          Preview
        </button>
      )}
      {onDownloadPdf && (
        <button
          type="button"
          onClick={() => runAction('pdf', onDownloadPdf)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} bg-emerald-600 hover:bg-emerald-700 text-white`}
        >
          <Download className="w-3.5 h-3.5" />
          Low-KB PDF (100-350 KB)
        </button>
      )}
      {onPrint && (
        <button
          type="button"
          onClick={() => runAction('print', onPrint)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} ${
            darkSurface
              ? 'bg-white/15 hover:bg-white/25 text-white border border-white/25'
              : 'bg-slate-700 hover:bg-slate-800 text-white'
          }`}
        >
          <Printer className="w-3.5 h-3.5" />
          Manual Print
        </button>
      )}
      {onScanStudio && (
        <button
          type="button"
          onClick={() => runAction('scan', onScanStudio)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} bg-amber-400 hover:bg-amber-300 text-slate-950`}
        >
          <Camera className="w-3.5 h-3.5" />
          Interactive Scan Studio
        </button>
      )}
      {onShareWhatsApp && (
        <button
          type="button"
          onClick={() => runAction('wa', onShareWhatsApp)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} bg-green-600 hover:bg-green-700 text-white`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          WhatsApp PDF
        </button>
      )}
      {onShareEmail && (
        <button
          type="button"
          onClick={() => runAction('email', onShareEmail)}
          className={`inline-flex items-center gap-1 rounded-md font-bold cursor-pointer ${pad} bg-indigo-600 hover:bg-indigo-700 text-white`}
        >
          <Mail className="w-3.5 h-3.5" />
          Email PDF
        </button>
      )}
      {onSave && (
        <button
          type={saveType}
          disabled={saveDisabled || busyAction === 'save'}
          onClick={saveType === 'button' ? () => runAction('save', onSave) : undefined}
          className={`inline-flex items-center gap-1 rounded-md font-extrabold cursor-pointer disabled:opacity-50 ${pad} bg-blue-700 hover:bg-blue-800 text-white shadow-sm`}
        >
          <Save className="w-3.5 h-3.5" />
          {saveLabel}
        </button>
      )}
    </div>
  );
};
