import React, { useEffect } from 'react';
import {
  COUNTRY_PIN_DIGIT_LENGTH,
  lookupExactPinAndCountry,
  resolvePinSync,
  SupportedCountry,
  validatePinForCountry,
} from '../lib/postalPinLookup';

export const SUPPORTED_POSTAL_COUNTRIES: SupportedCountry[] = [
  'India',
  'Bangladesh',
  'Nepal',
  'Bhutan',
];

/**
 * Reusable debounced auto-fill hook for any City/Place/Destination/Address field.
 * Runs synchronous offline hub lookup immediately and falls back to live Postal API after 450ms.
 */
export function useAutoPinLookup(
  placeOrAddress: string,
  currentPin: string,
  currentCountry: SupportedCountry | string | undefined,
  onResolved: (pinCode: string, country: SupportedCountry) => void,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    const raw = String(placeOrAddress || '').trim();
    if (raw.length < 3) return;

    const hint = SUPPORTED_POSTAL_COUNTRIES.includes(currentCountry as SupportedCountry)
      ? (currentCountry as SupportedCountry)
      : undefined;

    const syncHit = resolvePinSync(raw, hint);
    if (syncHit && validatePinForCountry(syncHit.pinCode, syncHit.country)) {
      if (syncHit.pinCode !== currentPin || syncHit.country !== currentCountry) {
        onResolved(syncHit.pinCode, syncHit.country);
      }
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const apiHit = await lookupExactPinAndCountry(raw, hint);
      if (cancelled || !apiHit) return;
      if (validatePinForCountry(apiHit.pinCode, apiHit.country)) {
        onResolved(apiHit.pinCode, apiHit.country);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placeOrAddress, enabled]);
}

interface PinCountryInputsProps {
  labelPrefix?: string;
  pinCode: string;
  country: SupportedCountry;
  onPinChange: (pin: string) => void;
  onCountryChange: (country: SupportedCountry) => void;
  compact?: boolean;
  disabled?: boolean;
}

export const PinCountryInputs: React.FC<PinCountryInputsProps> = ({
  labelPrefix = '',
  pinCode,
  country,
  onPinChange,
  onCountryChange,
  compact = false,
  disabled = false,
}) => {
  const expectedDigits = COUNTRY_PIN_DIGIT_LENGTH[country] || 6;
  const isValid = !pinCode || validatePinForCountry(pinCode, country);

  return (
    <div className="grid grid-cols-2 gap-1.5 mt-1">
      <div>
        <label
          className={`block font-bold text-slate-600 mb-0.5 ${
            compact ? 'text-[10px]' : 'text-[11px]'
          }`}
        >
          {labelPrefix ? `${labelPrefix} ` : ''}PIN / Postal ({expectedDigits}d)
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          disabled={disabled}
          value={pinCode}
          onChange={(e) => onPinChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder={`${expectedDigits}-digit PIN`}
          className={`w-full px-2 py-1 rounded border font-mono-num font-bold text-xs ${
            isValid
              ? 'border-emerald-400 bg-emerald-50/40 text-emerald-950'
              : 'border-amber-400 bg-amber-50 text-amber-900'
          }`}
        />
      </div>
      <div>
        <label
          className={`block font-bold text-slate-600 mb-0.5 ${
            compact ? 'text-[10px]' : 'text-[11px]'
          }`}
        >
          Country
        </label>
        <select
          disabled={disabled}
          value={country}
          onChange={(e) => onCountryChange(e.target.value as SupportedCountry)}
          className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs font-bold text-slate-800"
        >
          <option value="India">India (6d)</option>
          <option value="Bangladesh">Bangladesh (4d)</option>
          <option value="Nepal">Nepal (5d)</option>
          <option value="Bhutan">Bhutan (5d)</option>
        </select>
      </div>
    </div>
  );
};
