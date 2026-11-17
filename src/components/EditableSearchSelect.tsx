import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Edit2, Plus, Trash2, X } from 'lucide-react';

interface YesNoSelectProps {
  value: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  id?: string;
  className?: string;
}

export const YesNoSelect: React.FC<YesNoSelectProps> = ({
  value,
  onChange,
  ariaLabel,
  id,
  className = '',
}) => {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value ? 'Yes' : 'No'}
      onChange={(e) => onChange(e.target.value === 'Yes')}
      onKeyDown={(e) => {
        const k = e.key.toLowerCase();
        if (k === 'y') {
          e.preventDefault();
          onChange(true);
        } else if (k === 'n') {
          e.preventDefault();
          onChange(false);
        }
      }}
      title="Press Y for Yes or N for No"
      className={`px-2 py-1 rounded border text-xs font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        value
          ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
          : 'border-slate-300 bg-white text-slate-700'
      } ${className}`}
    >
      <option value="No">No</option>
      <option value="Yes">Yes</option>
    </select>
  );
};

interface EditableSearchSelectProps {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  uppercase?: boolean;
  maxResults?: number;
  allowFreeInput?: boolean;
  emptyOptionHint?: string;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  onAddOption?: (newVal: string) => void | Promise<void>;
  onEditOption?: (oldVal: string, newVal: string) => void | Promise<void>;
  onDeleteOption?: (val: string) => void | Promise<void>;
}

export const EditableSearchSelect: React.FC<EditableSearchSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Type to search or select...',
  required = false,
  disabled = false,
  uppercase = false,
  maxResults = 80,
  allowFreeInput = true,
  emptyOptionHint = 'No matching options found',
  className = '',
  inputClassName = '',
  ariaLabel,
  onAddOption,
  onEditOption,
  onDeleteOption,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [managerOpen, setManagerOpen] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setManagerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // If query equals current exact value while dropdown opened by button, show full list first with current highlighted
    const list = !q || q === value.trim().toLowerCase()
      ? options
      : options.filter((opt) => opt.toLowerCase().includes(q));
    return list.slice(0, maxResults);
  }, [options, query, value, maxResults]);

  const commitValue = (nextRaw: string) => {
    const next = uppercase ? nextRaw.toUpperCase() : nextRaw;
    setQuery(next);
    onChange(next);
    setOpen(false);
  };

  const handleAdd = async () => {
    const clean = (uppercase ? newItemText.toUpperCase() : newItemText).trim();
    if (!clean || !onAddOption) return;
    await onAddOption(clean);
    commitValue(clean);
    setNewItemText('');
    setManagerOpen(false);
  };

  const handleSaveEdit = async () => {
    if (!editingTarget || !onEditOption) return;
    const clean = (uppercase ? editingDraft.toUpperCase() : editingDraft).trim();
    if (!clean) return;
    await onEditOption(editingTarget, clean);
    if (value === editingTarget) {
      commitValue(clean);
    }
    setEditingTarget(null);
    setEditingDraft('');
  };

  const canManage = Boolean(onAddOption || onEditOption || onDeleteOption);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-stretch gap-1">
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            aria-label={ariaLabel}
            required={required}
            disabled={disabled}
            value={query}
            placeholder={placeholder}
            onFocus={() => {
              if (!disabled) {
                setHighlightIdx(0);
                setOpen(true);
              }
            }}
            onChange={(e) => {
              const raw = uppercase ? e.target.value.toUpperCase() : e.target.value;
              setQuery(raw);
              setOpen(true);
              setHighlightIdx(0);
              if (allowFreeInput) {
                onChange(raw);
              } else if (raw === '') {
                onChange('');
              }
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && open && filtered[highlightIdx]) {
                e.preventDefault();
                commitValue(filtered[highlightIdx]);
              } else if (e.key === 'Escape') {
                setOpen(false);
                setManagerOpen(false);
              }
            }}
            className={`w-full px-2.5 py-1.5 pr-11 rounded border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 ${
              uppercase ? 'uppercase' : ''
            } ${inputClassName}`}
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {query && !disabled && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setQuery('');
                  onChange('');
                  setOpen(true);
                }}
                className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                title="Clear"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                setOpen((v) => !v);
                setManagerOpen(false);
              }}
              className="p-0.5 text-slate-500 hover:text-blue-700 cursor-pointer disabled:opacity-40"
              title="Toggle dropdown list"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {canManage && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setManagerOpen((v) => !v);
              setOpen(false);
              setNewItemText(query && !options.includes(query) ? query : '');
              setEditingTarget(null);
            }}
            className={`px-2 py-1 rounded border text-[11px] font-bold flex items-center gap-0.5 cursor-pointer shrink-0 ${
              managerOpen
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-slate-50 hover:bg-blue-50 text-blue-800'
            }`}
            title="Add, Edit, or Delete dropdown items"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        )}
      </div>

      {/* Searchable Suggestions Menu */}
      {open && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl z-40 divide-y divide-slate-100 text-xs">
          {filtered.length === 0 ? (
            <div className="p-2.5 text-slate-500 space-y-1.5">
              <p>{emptyOptionHint}</p>
              {onAddOption && query.trim() && (
                <button
                  type="button"
                  onClick={async () => {
                    const clean = (uppercase ? query.toUpperCase() : query).trim();
                    await onAddOption(clean);
                    commitValue(clean);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add &ldquo;{query.trim()}&rdquo; to Dropdown
                </button>
              )}
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const selected = opt.toLowerCase() === value.trim().toLowerCase();
              const highlighted = idx === highlightIdx;
              return (
                <div
                  key={`${opt}_${idx}`}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer ${
                    highlighted
                      ? 'bg-blue-50 text-blue-900'
                      : selected
                      ? 'bg-emerald-50 text-emerald-900 font-semibold'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitValue(opt);
                  }}
                >
                  <span className="truncate flex-1">{opt}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Inline + Add / Edit / Delete Manager */}
      {managerOpen && canManage && !disabled && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-blue-300 rounded-lg shadow-2xl z-50 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1">
            <span className="font-bold text-blue-900">Quick Add / Edit / Delete</span>
            <button
              type="button"
              onClick={() => setManagerOpen(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {onAddOption && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAdd();
                  }
                }}
                placeholder="Add new option..."
                className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => void handleAdd()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shrink-0"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          )}

          {(onEditOption || onDeleteOption) && options.length > 0 && (
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded">
              {options
                .filter((opt) =>
                  !newItemText.trim()
                    ? true
                    : opt.toLowerCase().includes(newItemText.trim().toLowerCase())
                )
                .slice(0, 40)
                .map((opt) => (
                  <div key={opt} className="flex items-center justify-between gap-1.5 px-2 py-1 hover:bg-slate-50">
                    {editingTarget === opt ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          type="text"
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-blue-400 text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit()}
                          className="px-2 py-0.5 rounded bg-blue-700 text-white text-[10px] font-bold cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            commitValue(opt);
                            setManagerOpen(false);
                          }}
                          className="text-left truncate flex-1 text-[11px] text-slate-800 hover:text-blue-700 cursor-pointer"
                        >
                          {opt}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {onEditOption && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTarget(opt);
                                setEditingDraft(opt);
                              }}
                              className="p-0.5 text-slate-500 hover:text-blue-700 cursor-pointer"
                              title="Edit option"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          )}
                          {onDeleteOption && (
                            <button
                              type="button"
                              onClick={() => void onDeleteOption(opt)}
                              className="p-0.5 text-slate-500 hover:text-red-600 cursor-pointer"
                              title="Delete option"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
