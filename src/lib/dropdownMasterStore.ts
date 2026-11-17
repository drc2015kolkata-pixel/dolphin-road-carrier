import {
  ALL_INDIA_NON_LIQUID_GOODS,
  ALL_INDIA_STATES_DISTRICTS,
  DEFAULT_CREDIT_DAY_PRESETS,
  DEFAULT_DELIVERY_PLACES,
  DEFAULT_PACKAGE_MODES,
  DEFAULT_RATE_MODES,
  mergeDropdownOptions,
} from '../data/allIndiaMasterData';
import { CompanySettings, DropdownMasterConfig } from '../types/erp';
import { saveSettingsDocument } from './firestoreStore';

export type DropdownCategoryKey =
  | 'goodsTypes'
  | 'packageModes'
  | 'rateModes'
  | 'deliveryPlaces'
  | 'states';

const CATEGORY_DEFAULTS: Record<DropdownCategoryKey, string[]> = {
  goodsTypes: ALL_INDIA_NON_LIQUID_GOODS,
  packageModes: DEFAULT_PACKAGE_MODES,
  rateModes: DEFAULT_RATE_MODES,
  deliveryPlaces: DEFAULT_DELIVERY_PLACES,
  states: ALL_INDIA_STATES_DISTRICTS.map((s) => s.label),
};

export function getEffectiveDropdownList(
  company: CompanySettings,
  category: DropdownCategoryKey
): string[] {
  const custom = company.dropdownMaster?.[category];
  if (Array.isArray(custom)) {
    return custom;
  }
  return [...CATEGORY_DEFAULTS[category]];
}

export function getEffectiveDistrictsForState(
  company: CompanySettings,
  stateLabel: string
): string[] {
  const trimmed = String(stateLabel || '').trim();
  const matchedRegion =
    ALL_INDIA_STATES_DISTRICTS.find(
      (s) =>
        s.label.toLowerCase() === trimmed.toLowerCase() ||
        s.name.toLowerCase() === trimmed.toLowerCase() ||
        s.code.toLowerCase() === trimmed.toLowerCase()
    ) ||
    (trimmed.length >= 3
      ? ALL_INDIA_STATES_DISTRICTS.find(
          (s) =>
            s.label.toLowerCase().includes(trimmed.toLowerCase()) ||
            trimmed.toLowerCase().includes(s.name.split('(')[0].trim().toLowerCase())
        )
      : undefined);
  const customMap = company.dropdownMaster?.districtsByState || {};
  const customExact =
    (trimmed && Array.isArray(customMap[trimmed]) && customMap[trimmed]) ||
    (matchedRegion?.label && Array.isArray(customMap[matchedRegion.label]) && customMap[matchedRegion.label]);
  if (customExact) {
    return customExact;
  }
  return matchedRegion
    ? [...matchedRegion.districts]
    : ALL_INDIA_STATES_DISTRICTS.flatMap((s) => s.districts).slice(0, 60);
}

export function getEffectiveCreditDayPresets(company: CompanySettings): number[] {
  const custom = company.dropdownMaster?.creditDayPresets;
  const combined = Array.from(
    new Set([...DEFAULT_CREDIT_DAY_PRESETS, ...(custom || [])].filter((n) => n > 0))
  ).sort((a, b) => a - b);
  return combined.length > 0 ? combined : DEFAULT_CREDIT_DAY_PRESETS;
}

async function persistDropdownMaster(
  ownerUid: string,
  company: CompanySettings,
  nextMaster: DropdownMasterConfig
): Promise<void> {
  const payload: CompanySettings = {
    ...company,
    ownerUid: company.ownerUid || ownerUid,
    dropdownMaster: nextMaster,
  };
  await saveSettingsDocument(
    'company',
    payload as unknown as Record<string, unknown>,
    Boolean(company.ownerUid)
  );
}

export async function addDropdownItem(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey,
  newValue: string
): Promise<void> {
  const clean = newValue.trim();
  if (!clean) return;
  const current = getEffectiveDropdownList(company, category);
  const updated = mergeDropdownOptions(current, [clean]);
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    [category]: updated,
  });
}

export async function editDropdownItem(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey,
  oldValue: string,
  newValue: string
): Promise<void> {
  const clean = newValue.trim();
  if (!clean) return;
  const current = getEffectiveDropdownList(company, category);
  const updated = current.map((item) => (item === oldValue ? clean : item));
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    [category]: updated,
  });
}

export async function deleteDropdownItem(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey,
  targetValue: string
): Promise<void> {
  const current = getEffectiveDropdownList(company, category);
  const updated = current.filter((item) => item !== targetValue);
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    [category]: updated,
  });
}

export async function upsertDistrictItem(
  ownerUid: string,
  company: CompanySettings,
  stateLabel: string,
  action: { type: 'add'; value: string } | { type: 'edit'; oldValue: string; newValue: string } | { type: 'delete'; value: string }
): Promise<void> {
  const key = stateLabel.trim() || 'General';
  const current = getEffectiveDistrictsForState(company, key);
  let nextList = current;
  if (action.type === 'add') {
    const clean = action.value.trim();
    if (!clean) return;
    nextList = mergeDropdownOptions(current, [clean]);
  } else if (action.type === 'edit') {
    const clean = action.newValue.trim();
    if (!clean) return;
    nextList = current.map((d) => (d === action.oldValue ? clean : d));
  } else if (action.type === 'delete') {
    nextList = current.filter((d) => d !== action.value);
  }
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    districtsByState: {
      ...(company.dropdownMaster?.districtsByState || {}),
      [key]: nextList,
    },
  });
}

export async function resetDropdownCategory(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey
): Promise<void> {
  const next = { ...(company.dropdownMaster || {}) };
  delete next[category];
  await persistDropdownMaster(ownerUid, company, next);
}

export async function updateCreditDayPresets(
  ownerUid: string,
  company: CompanySettings,
  presets: number[]
): Promise<void> {
  const clean = Array.from(new Set(presets.map((n) => Math.round(Number(n))).filter((n) => n > 0 && n <= 365))).sort(
    (a, b) => a - b
  );
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    creditDayPresets: clean,
  });
}

