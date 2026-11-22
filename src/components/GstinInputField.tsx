import React, { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { GST_SEARCH_PORTAL_URL, validateIndianGstin } from '../lib/gstinValidator';
import { playAlertBeep } from '../lib/audioFeedback';

interface GstinInputFieldProps {
  value: string;
  onChange: (nextUpper: string) => void;
  label?: React.ReactNode;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  required?: boolean;
  compact?: boolean;
  beepOnInvalid?: boolean;
}

export const GstinInputField: React.FC<GstinInputFieldProps> = ({
  value,
  onChange,
  label,
  placeholder = '19XXXXX... (15-Char GSTIN)',
  className = '',
  inputClassName = '',
  disabled = false,
  required = false,
  compact = false,
  beepOnInvalid = true,
}) => {
  const check = useMemo(() => validateIndianGstin(value), [value]);
  const lastBeepedValueRef = useRef<string>('');

  useEffect(() => {
    if (!beepOnInvalid) return;
    if (!check.isEmpty && !check.valid && check.normalized.length === 15) {
      if (lastBeepedValueRef.current !== check.normalized) {
        lastBeepedValueRef.current = check.normalized;
        playAlertBeep();
      }
    } else if (check.valid) {
      lastBeepedValueRef.current = '';
    }
  }, [check.isEmpty, check.valid, check.normalized, beepOnInvalid]);

  return (
    <div className={className}>
      {(label || true) && (
        <div className="flex items-center justify-between gap-1.5 mb-1">
          {label ? (
            <label className="block font-semibold text-slate-700 text-xs">{label}</label>
          ) : (
            <span />
          )}
          <a
            href={GST_SEARCH_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={-1}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-900 text-[10px] font-extrabold whitespace-nowrap"
            title="Verify GSTIN Taxpayer Status on Official GST Portal"
          >
            <span>🔍 Verify GST Online</span>
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        </div>
      )}

      <input
        type="text"
        maxLength={15}
        disabled={disabled}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/\s+/g, ''))}
        onBlur={() => {
          if (!check.isEmpty && !check.valid && beepOnInvalid) {
            playAlertBeep();
          }
        }}
        placeholder={placeholder}
        className={`w-full px-2.5 ${compact ? 'py-1 text-[11px]' : 'py-1.5'} rounded border font-mono-num uppercase focus:outline-none focus:ring-2 ${
          !check.isEmpty && !check.valid
            ? 'border-red-500 bg-red-50/70 text-red-900 focus:ring-red-400'
            : !check.isEmpty && check.valid
            ? 'border-emerald-500 bg-emerald-50/40 text-slate-900 focus:ring-emerald-400'
            : 'border-slate-300 bg-white text-slate-900 focus:ring-blue-500'
        } ${inputClassName}`}
      />

      {!check.isEmpty && check.valid && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-emerald-700">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>
            Valid Checksum · {check.stateCode} ({check.stateName})
          </span>
        </div>
      )}

      {!check.isEmpty && !check.valid && (
        <div className="mt-0.5 flex items-start gap-1 text-[10px] font-extrabold text-red-700">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{check.error}</span>
        </div>
      )}
    </div>
  );
};
