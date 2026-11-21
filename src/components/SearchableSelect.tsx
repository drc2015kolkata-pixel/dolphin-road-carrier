import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export type SearchableSelectOption =
  | string
  | {
      value: string;
      label: string;
      hint?: string;
      pinFirst?: boolean;
    };

interface NormalizedOption {
  value: string;
  label: string;
  hint?: string;
  pinFirst?: boolean;
}

interface SearchableSelectProps {
  value: string;
  onChange: (nextValue: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  triggerClassName?: string;
  menuClassName?: string;
  sortAlphabetically?: boolean;
  pinEmptyOptionFirst?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '-- Select --',
  searchPlaceholder = 'Type to search A-Z...',
  ariaLabel,
  disabled = false,
  className = '',
  buttonClassName = '',
  triggerClassName = '',
  menuClassName = '',
  sortAlphabetically = true,
  pinEmptyOptionFirst = true,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const normalized = useMemo<NormalizedOption[]>(() => {
    const mapped = options.map((opt) =>
      typeof opt === 'string'
        ? { value: opt, label: opt }
        : { value: opt.value, label: opt.label, hint: opt.hint, pinFirst: opt.pinFirst }
    );
    if (!sortAlphabetically) return mapped;

    const pinned: NormalizedOption[] = [];
    const rest: NormalizedOption[] = [];
    for (const item of mapped) {
      if (item.pinFirst || (pinEmptyOptionFirst && (item.value === '' || item.value === 'ALL'))) {
        pinned.push(item);
      } else {
        rest.push(item);
      }
    }
    rest.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })
    );
    return [...pinned, ...rest];
  }, [options, sortAlphabetically, pinEmptyOptionFirst]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.hint && opt.hint.toLowerCase().includes(q))
    );
  }, [normalized, query]);

  const selectedLabel = useMemo(() => {
    const found = normalized.find((opt) => opt.value === value);
    if (found) return found.label;
    return value || placeholder;
  }, [normalized, value, placeholder]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 20);
    }
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-left text-xs font-semibold text-slate-900 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer ${buttonClassName} ${triggerClassName}`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && !disabled && (
        <div
          className={`absolute left-0 right-0 min-w-[210px] mt-1 z-50 rounded-lg border border-slate-300 bg-white shadow-xl overflow-hidden ${menuClassName}`}
        >
          <div className="p-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                } else if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  onChange(filtered[0].value);
                  setOpen(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="flex-1 min-w-0 bg-white px-2 py-1 rounded border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-center text-[11px] text-slate-500">
                No match found for "{query}".
              </div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={`${opt.value}__${opt.label}`}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-900 font-bold'
                        : 'text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">
                      {opt.label}
                      {opt.hint && (
                        <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                          ({opt.hint})
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-700 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
