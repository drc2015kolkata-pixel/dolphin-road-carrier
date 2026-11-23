import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  CreditCard,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import {
  Driver,
  LogisticsDriver,
  LogisticsParty,
  LogisticsVehicle,
  Party,
  Vehicle,
} from '../types/erp';
import { resolveGstStateCode } from '../lib/partySeparation';

export type AnyPartyEntity = Party | LogisticsParty;
export type AnyVehicleEntity = Vehicle | LogisticsVehicle;
export type AnyDriverEntity = Driver | LogisticsDriver;

export function extractCityFromAddress(address?: string): string {
  const clean = String(address || '').trim();
  if (!clean) return '-';
  const parts = clean
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return '-';
  return parts[parts.length - 1];
}

export function formatPartyDetailsLine(p: AnyPartyEntity): string {
  const role = String(p.partyType || '').trim();
  const isBrokerOrOwner = role === 'Broker' || role === 'TruckOwner' || role === 'DeliveryAgent';
  if (isBrokerOrOwner) {
    const panText = p.pan ? `PAN: ${p.pan}` : 'PAN: -';
    const mobText = p.phone ? `Mob: ${p.phone}` : 'Mob: -';
    const cityText = `City: ${extractCityFromAddress(p.address)}`;
    return `${panText} | ${mobText} | ${cityText}`;
  }
  const gstText = p.gstin ? `GSTIN: ${p.gstin}` : 'GSTIN: Unregd';
  const addrText = p.address ? p.address : 'Address: -';
  const phoneText = p.phone ? `Ph: ${p.phone}` : 'Ph: -';
  return `${gstText} | ${addrText} | ${phoneText}`;
}

export function formatVehicleDetailsLine(v: AnyVehicleEntity): string {
  const owner = v.ownerName ? `Owner: ${v.ownerName}` : 'Owner: -';
  const vType = v.vehicleType ? `Type: ${v.vehicleType}` : 'Type: Goods Carrier';
  return `${owner} | ${vType}`;
}

export function formatDriverDetailsLine(d: AnyDriverEntity): string {
  const dl = d.dlNo ? `D/L: ${d.dlNo}` : 'D/L: -';
  const mob = d.phone ? `Mob: ${d.phone}` : 'Mob: -';
  return `${dl} | ${mob}`;
}

export interface RichEntityPickerProps<T> {
  ariaLabel?: string;
  value: string;
  selectedId?: string;
  onChangeText: (nextText: string) => void;
  onSelectEntity: (entity: T) => void;
  items: T[];
  getId: (item: T) => string;
  getValue: (item: T) => string;
  getSearchText: (item: T) => string;
  renderTitle: (item: T) => string;
  renderDetails: (item: T) => string;
  renderBadge?: (item: T) => string | undefined;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  uppercase?: boolean;
  maxResults?: number;
  className?: string;
  inputClassName?: string;
  emptyHint?: string;
  quickPreview?: React.ReactNode;
}

function RichEntityPickerInner<T>({
  ariaLabel,
  value,
  selectedId,
  onChangeText,
  onSelectEntity,
  items,
  getId,
  getValue,
  getSearchText,
  renderTitle,
  renderDetails,
  renderBadge,
  placeholder = 'Type Name, GSTIN, PAN, Phone or click dropdown...',
  required = false,
  disabled = false,
  uppercase = false,
  maxResults = 60,
  className = '',
  inputClassName = '',
  emptyHint = 'No matching master record — typed value will be used directly',
  quickPreview,
}: RichEntityPickerProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [openedByToggle, setOpenedByToggle] = useState(false);
  const [menuQuery, setMenuQuery] = useState('');

  const renderTitleRef = useRef(renderTitle);
  renderTitleRef.current = renderTitle;
  const getSearchTextRef = useRef(getSearchText);
  getSearchTextRef.current = getSearchText;

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setOpenedByToggle(false);
        setMenuQuery('');
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const indexedItems = useMemo(() => {
    const mapped = items.map((item) => ({
      item,
      title: String(renderTitleRef.current(item) || ''),
      searchLower: String(getSearchTextRef.current(item) || '').toLowerCase(),
    }));
    mapped.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
    return mapped;
  }, [items]);

  const rawQuery = menuQuery.trim() ? menuQuery : openedByToggle ? '' : value;
  const deferredQuery = useDeferredValue(rawQuery);
  const effectiveQuery = items.length > 250 ? deferredQuery : rawQuery;

  const filtered = useMemo(() => {
    if (!open) return [];
    const tokens = effectiveQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return indexedItems.slice(0, maxResults).map((x) => x.item);
    }
    const matched: T[] = [];
    for (let i = 0; i < indexedItems.length; i += 1) {
      const entry = indexedItems[i];
      let ok = true;
      for (let t = 0; t < tokens.length; t += 1) {
        if (!entry.searchLower.includes(tokens[t])) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched.push(entry.item);
        if (matched.length >= maxResults) break;
      }
    }
    return matched;
  }, [open, indexedItems, effectiveQuery, maxResults]);

  const handlePick = (item: T) => {
    onSelectEntity(item);
    setOpen(false);
    setOpenedByToggle(false);
    setMenuQuery('');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          aria-label={ariaLabel}
          required={required}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onFocus={() => {
            if (!disabled) {
              setHighlightIdx(0);
              setOpen(true);
            }
          }}
          onChange={(e) => {
            const next = uppercase ? e.target.value.toUpperCase() : e.target.value;
            setOpenedByToggle(false);
            setHighlightIdx(0);
            setOpen(true);
            onChangeText(next);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHighlightIdx((i) => Math.min(Math.max(0, filtered.length - 1), i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && open && filtered[highlightIdx]) {
              e.preventDefault();
              handlePick(filtered[highlightIdx]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              setOpenedByToggle(false);
            }
          }}
          className={`w-full px-2.5 py-1.5 pr-12 rounded border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 ${
            uppercase ? 'uppercase' : ''
          } ${inputClassName}`}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                setOpenedByToggle(false);
                onChangeText('');
                setOpen(true);
              }}
              className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              title="Clear"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              setOpenedByToggle((prev) => (!open ? true : !prev));
              setOpen((prev) => !prev);
            }}
            className="p-0.5 text-slate-500 hover:text-blue-700 cursor-pointer disabled:opacity-40"
            title="Show all options"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-68 overflow-y-auto bg-white border border-blue-300 rounded-lg shadow-2xl z-50 divide-y divide-slate-100 text-xs">
          <div className="sticky top-0 z-10 p-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
            <input
              type="text"
              value={menuQuery}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setMenuQuery(e.target.value);
                setHighlightIdx(0);
              }}
              placeholder="Live filter A-Z by Name, GSTIN, PAN, Truck, DL..."
              className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-white text-[11px] focus:outline-none focus:border-blue-500"
            />
            {menuQuery && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuQuery('');
                }}
                className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500 italic">{emptyHint}</div>
          ) : (
            filtered.map((item, idx) => {
              const id = getId(item);
              const val = getValue(item);
              const isSelected = selectedId
                ? id === selectedId
                : val.trim().toLowerCase() === value.trim().toLowerCase() && val.trim() !== '';
              const highlighted = idx === highlightIdx;
              const badge = renderBadge ? renderBadge(item) : undefined;
              return (
                <button
                  key={id || `${val}_${idx}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePick(item);
                  }}
                  className={`w-full text-left px-2.5 py-2 flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                    highlighted
                      ? 'bg-blue-50 text-blue-950'
                      : isSelected
                        ? 'bg-emerald-50 text-emerald-950'
                        : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-slate-900 truncate">
                        {renderTitle(item)}
                      </span>
                      {badge && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-700">
                          {badge}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-600 font-mono-num mt-0.5 break-words">
                      {renderDetails(item)}
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />}
                </button>
              );
            })
          )}
        </div>
      )}

      {quickPreview}
    </div>
  );
}

export const RichEntityPicker = React.memo(RichEntityPickerInner) as typeof RichEntityPickerInner;

interface EntityQuickPreviewCardProps {
  kind: 'party' | 'broker' | 'owner' | 'vehicle' | 'driver';
  party?: AnyPartyEntity | null;
  vehicle?: AnyVehicleEntity | null;
  driver?: AnyDriverEntity | null;
  duplicateCount?: number;
  ambiguousSelected?: boolean;
  compact?: boolean;
}

export const EntityQuickPreviewCard: React.FC<EntityQuickPreviewCardProps> = ({
  kind,
  party,
  vehicle,
  driver,
  duplicateCount = 0,
  ambiguousSelected = false,
  compact = false,
}) => {
  if (kind === 'party' || kind === 'broker' || kind === 'owner') {
    if (!party) return null;
    const isBroker = kind === 'broker' || party.partyType === 'Broker';
    const isOwner = kind === 'owner' || party.partyType === 'TruckOwner';
    const stInfo = resolveGstStateCode(party.gstin, party.address);
    const toneClass = isBroker
      ? 'bg-indigo-50/80 border-indigo-200 text-indigo-950'
      : isOwner
        ? 'bg-amber-50/80 border-amber-200 text-amber-950'
        : 'bg-emerald-50/80 border-emerald-200 text-emerald-950';
    const badgeClass = isBroker
      ? 'bg-indigo-700 text-white'
      : isOwner
        ? 'bg-amber-700 text-white'
        : 'bg-emerald-700 text-white';

    return (
      <div className={`mt-1.5 rounded-lg border px-2.5 py-2 text-[11px] ${toneClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
          <span className="font-extrabold inline-flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            <span>Selected Entity Preview: {party.name}</span>
          </span>
          <div className="flex items-center gap-1">
            {duplicateCount > 1 && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  ambiguousSelected ? 'bg-red-600 text-white' : 'bg-blue-700 text-white'
                }`}
              >
                {ambiguousSelected
                  ? `${duplicateCount} matching names — pick from dropdown to lock ID`
                  : `Verified Match (${duplicateCount} same-name records)`}
              </span>
            )}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeClass}`}>
              {party.partyType}
            </span>
          </div>
        </div>
        <div className={`grid grid-cols-1 ${compact ? '' : 'sm:grid-cols-2'} gap-x-3 gap-y-1 text-[11px]`}>
          <div className="inline-flex items-start gap-1">
            <MapPin className="w-3 h-3 mt-0.5 shrink-0 opacity-75" />
            <span>
              <strong>Address:</strong> {party.address || 'Not recorded'}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 font-mono-num">
            <ShieldCheck className="w-3 h-3 shrink-0 opacity-75" />
            <span>
              <strong>GSTIN:</strong> {party.gstin || 'Unregistered'}
              {stInfo.code ? ` (${stInfo.code} - ${stInfo.name})` : ''}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 font-mono-num">
            <CreditCard className="w-3 h-3 shrink-0 opacity-75" />
            <span>
              <strong>PAN:</strong> {party.pan || 'Not recorded'}
              {'tradeLicenseNo' in party && party.tradeLicenseNo
                ? ` · Lic: ${party.tradeLicenseNo}`
                : ''}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 font-mono-num">
            <Phone className="w-3 h-3 shrink-0 opacity-75" />
            <span>
              <strong>Phone:</strong> {party.phone || 'Not recorded'}
              {party.email ? ` · ${party.email}` : ''}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'vehicle') {
    if (!vehicle) return null;
    return (
      <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50/80 text-blue-950 px-2.5 py-2 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
          <span className="font-extrabold inline-flex items-center gap-1 font-mono-num">
            <Truck className="w-3.5 h-3.5 shrink-0" />
            <span>Selected Vehicle Preview: {vehicle.truckNo}</span>
          </span>
          <span className="px-1.5 py-0.5 rounded bg-blue-700 text-white text-[10px] font-bold">
            {vehicle.vehicleType || 'Goods Carrier'}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          <div>
            <strong>Owner:</strong> {vehicle.ownerName || 'Not recorded'}
          </div>
          <div className="font-mono-num">
            <strong>Owner Phone:</strong> {vehicle.ownerPhone || 'Not recorded'}
          </div>
          {'engineNo' in vehicle && (vehicle.engineNo || vehicle.chassisNo) && (
            <div className="font-mono-num sm:col-span-2">
              <strong>RC Engine/Chassis:</strong> {vehicle.engineNo || '-'} /{' '}
              {vehicle.chassisNo || '-'}
            </div>
          )}
          {(vehicle.fitnessExpiry || vehicle.insuranceExpiry || vehicle.permitExpiry) && (
            <div className="font-mono-num sm:col-span-2 text-[10px] text-slate-700">
              {vehicle.fitnessExpiry ? `Fit: ${vehicle.fitnessExpiry} ` : ''}
              {vehicle.insuranceExpiry ? `· Ins: ${vehicle.insuranceExpiry} ` : ''}
              {vehicle.permitExpiry ? `· Permit: ${vehicle.permitExpiry}` : ''}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (kind === 'driver') {
    if (!driver) return null;
    return (
      <div className="mt-1.5 rounded-lg border border-teal-200 bg-teal-50/80 text-teal-950 px-2.5 py-2 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
          <span className="font-extrabold inline-flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Selected Driver Preview: {driver.name}</span>
          </span>
          {duplicateCount > 1 && (
            <span className="px-1.5 py-0.5 rounded bg-teal-700 text-white text-[10px] font-bold">
              {duplicateCount} drivers share this name
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          <div className="font-mono-num">
            <strong>D/L No:</strong> {driver.dlNo || '-'}
            {driver.dlExpiry ? ` (Exp: ${driver.dlExpiry})` : ''}
          </div>
          <div className="font-mono-num">
            <strong>Mobile:</strong> {driver.phone || 'Not recorded'}
          </div>
          {driver.address && (
            <div className="sm:col-span-2">
              <strong>Address:</strong> {driver.address}
            </div>
          )}
          {'panNo' in driver && (driver.panNo || driver.aadhaarNo) && (
            <div className="font-mono-num sm:col-span-2 text-[10px]">
              {driver.panNo ? `PAN: ${driver.panNo} ` : ''}
              {driver.aadhaarNo ? `· Aadhaar: ${driver.aadhaarNo}` : ''}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
