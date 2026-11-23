import {
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
} from '../types/erp';
import { ALL_INDIA_STATES_DISTRICTS } from './dropdownMasterStore';

export interface GstStateCodeInfo {
  code: string;
  name: string;
  label: string;
}

export function normalizePartyMatchKey(name: string | undefined | null): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isBillingCustomerType(partyType: Party['partyType'] | string | undefined): boolean {
  const norm = String(partyType || '').trim().toLowerCase();
  return norm === 'customer' || norm === 'consignor' || norm === 'consignee';
}

export function isBrokerOrNonCustomerType(partyType: Party['partyType'] | string | undefined): boolean {
  const norm = String(partyType || '').trim().toLowerCase();
  return norm === 'broker' || norm === 'truckowner' || norm === 'vendor';
}

/**
 * Curated directory of 66+ known transport / lorry brokers (FoxPro BRKRMAST & Kolkata/Howrah/Dankuni/Durgapur belt)
 * so broker accounts like Jamal, Mahadev, Biplab etc. stay cleanly isolated inside Broker Master.
 */
export const KNOWN_TRANSPORT_BROKER_NAMES: string[] = [
  'jamal', 'jamaluddin', 'sk jamal', 'md jamal',
  'mahadev', 'mahadev transport', 'mahadev roadlines', 'mahadeo',
  'biplab', 'biplab das', 'biplab transport',
  'babul', 'babulal', 'ashok', 'ashok transport', 'arup', 'arup transport',
  'bablu', 'bablu transport', 'badal', 'badal transport', 'balram',
  'bhagirath', 'bhaskar', 'bhola', 'bholanath', 'bikas', 'bikash',
  'bimal', 'binod', 'biswajit', 'chandan', 'chiranjit', 'debashis',
  'deepak', 'dilip', 'dinesh', 'dulal', 'gopal', 'gouranga',
  'govind', 'haradhan', 'harihar', 'harish', 'hiralal', 'indrajit',
  'ismail', 'jadav', 'jagadish', 'jayanta', 'jitendra', 'jogen',
  'kajal', 'kalidas', 'kamal', 'kanai', 'kartik', 'kashi',
  'keshav', 'khokan', 'kiran', 'kishore', 'krishna', 'laxman',
  'madan', 'mahendra', 'manas', 'manik', 'manoj', 'mantu',
  'milan', 'mithun', 'mohan', 'mukesh', 'naba', 'narayan',
  'naresh', 'nemai', 'netai', 'nikhil', 'niranjan', 'nirmal',
  'nitai', 'pankaj', 'paresh', 'partha', 'prabir', 'pradip',
  'prakash', 'pramod', 'pranab', 'prasad', 'prashanta', 'pratap',
  'premlal', 'prosenjit', 'rabindra', 'radheshyam', 'raja', 'rajendra',
  'rajesh', 'raju', 'rakesh', 'ramesh', 'ramprasad', 'ranjit',
  'ratan', 'robin', 'rohit', 'sachin', 'sadek', 'sagar',
  'salim', 'samir', 'sanat', 'sanjay', 'sanjib', 'sankar',
  'santosh', 'saroj', 'satish', 'shambhu', 'shankar', 'shyam',
  'sibu', 'siraj', 'sisir', 'sk babu', 'sk raju', 'sk salim',
  'sohan', 'somnath', 'subal', 'subhas', 'subir', 'subrata',
  'sudeb', 'sudhir', 'sujit', 'sukanta', 'sukumar', 'suman',
  'sumit', 'sunil', 'supriya', 'suraj', 'suresh', 'swapan',
  'tapan', 'tarun', 'trilochan', 'uday', 'ujjal', 'umesh',
  'uttam', 'vikram', 'vinod', 'washim',
];

const KNOWN_BROKER_SET = new Set(KNOWN_TRANSPORT_BROKER_NAMES);

export function isKnownTransportBrokerName(name: string | undefined | null): boolean {
  const key = normalizePartyMatchKey(name);
  if (!key) return false;
  if (KNOWN_BROKER_SET.has(key)) return true;
  if (/\b(broker|brkr|commission\s*agent|lorry\s*broker|truck\s*broker|booking\s*agent|dalal)\b|\(\s*(brk|broker)\s*\)$/i.test(key)) {
    return true;
  }
  const stripped = key.replace(/\b(mr|shri|md|sk|late|c\/o|transport|roadlines|carrier|carriers|enterprise|traders|broker|brk)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (stripped && KNOWN_BROKER_SET.has(stripped)) {
    // Only match single-word personal broker names if there are no company suffixes like pvt ltd, industries, steel, cement, mills
    if (!/\b(pvt|ltd|limited|llp|inc|industries|steel|cement|mills|infra|projects|exports|imports|india|corp|corporation|co\.?)\b/i.test(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves Indian GST 2-digit State Code from GSTIN first, then falls back to State/District matching in Address.
 */
export function resolveGstStateCode(
  gstin?: string,
  address?: string,
  billingCountry?: string
): GstStateCodeInfo {
  if (billingCountry && billingCountry !== 'India') {
    return {
      code: '99',
      name: billingCountry,
      label: `99 - International (${billingCountry})`,
    };
  }

  const cleanGst = String(gstin || '').trim().toUpperCase();
  const codeMatch = cleanGst.match(/^(\d{2})/);
  if (codeMatch) {
    const code = codeMatch[1];
    const matched = ALL_INDIA_STATES_DISTRICTS.find((s) => s.code === code);
    if (matched) {
      return { code: matched.code, name: matched.name, label: matched.label };
    }
    return { code, name: `State (${code})`, label: `${code} - State` };
  }

  const addrLower = String(address || '').trim().toLowerCase();
  if (addrLower) {
    for (const group of ALL_INDIA_STATES_DISTRICTS) {
      if (group.code === '99') continue;
      if (addrLower.includes(group.name.toLowerCase())) {
        return { code: group.code, name: group.name, label: group.label };
      }
    }
    for (const group of ALL_INDIA_STATES_DISTRICTS) {
      if (group.code === '99') continue;
      const hit = group.districts.some((dist) => {
        const core = dist.split('(')[0].trim().toLowerCase();
        return core.length >= 4 && addrLower.includes(core);
      });
      if (hit) {
        return { code: group.code, name: group.name, label: group.label };
      }
    }
    if (/\bw\.?b\.?\b/i.test(address || '')) {
      return { code: '19', name: 'West Bengal', label: '19 - West Bengal' };
    }
  }

  return { code: '', name: '', label: '' };
}

/**
 * Strictly returns ONLY Customer / Billing Parties for Tax Invoice "Bill To Party *" selection.
 * Excludes Brokers, Vehicle Owners (TruckOwner), Vendors, Drivers, and duplicate Broker/Owner records.
 */
export function filterBillingCustomerParties(params: {
  parties: Party[];
  drivers?: Driver[];
  lorryHires?: LorryHire[];
  invoices?: Invoice[];
  consignments?: ConsignmentNote[];
}): Party[] {
  const { parties, drivers = [], lorryHires = [], invoices = [], consignments = [] } = params;

  const knownInvoiceOrCnCustomers = new Set<string>();
  for (const inv of invoices) {
    const k = normalizePartyMatchKey(inv.partyName);
    if (k) knownInvoiceOrCnCustomers.add(k);
  }
  for (const cn of consignments) {
    const k1 = normalizePartyMatchKey(cn.billingPartyName);
    const k2 = normalizePartyMatchKey(cn.consignorName);
    if (k1) knownInvoiceOrCnCustomers.add(k1);
    if (k2) knownInvoiceOrCnCustomers.add(k2);
  }

  const knownBrokerKeys = new Set<string>();
  const knownOwnerKeys = new Set<string>();
  for (const p of parties) {
    const k = normalizePartyMatchKey(p.name);
    if (!k) continue;
    if (p.partyType === 'Broker' || p.id.startsWith('dbf_brk_') || p.id.startsWith('brk_')) {
      knownBrokerKeys.add(k);
    }
    if (p.partyType === 'TruckOwner' || p.id.startsWith('dbf_own_') || p.id.startsWith('own_')) {
      knownOwnerKeys.add(k);
    }
  }
  for (const lh of lorryHires) {
    const bk = normalizePartyMatchKey(lh.brokerName);
    const ow = normalizePartyMatchKey(lh.ownerName);
    if (bk) knownBrokerKeys.add(bk);
    if (ow) knownOwnerKeys.add(ow);
  }

  const knownDriverKeys = new Set<string>();
  for (const d of drivers) {
    const dk = normalizePartyMatchKey(d.name);
    if (dk) knownDriverKeys.add(dk);
  }

  const BROKER_NAME_REGEX =
    /\b(broker|brkr|commission\s*agent|lorry\s*broker|truck\s*broker|booking\s*agent|dalal)\b|\(\s*(brk|broker)\s*\)$/i;

  const deduped = new Map<string, Party>();

  for (const p of parties) {
    if (!isBillingCustomerType(p.partyType)) continue;
    if (
      p.id.startsWith('dbf_brk_') ||
      p.id.startsWith('brk_') ||
      p.id.startsWith('dbf_own_') ||
      p.id.startsWith('own_') ||
      p.id.startsWith('dbf_drv_')
    ) {
      continue;
    }

    const key = normalizePartyMatchKey(p.name);
    if (!key) continue;

    // Never reclassify/exclude explicit HEAD / PARTY / ACCT DBF customers or explicit 'Customer' role rows
    const isFromHeadDbf =
      p.id.startsWith('dbf_head_') ||
      p.id.startsWith('dbf_party_') ||
      p.id.startsWith('dbf_acct_');
    const isProtectedCustomer =
      isFromHeadDbf || p.partyType === 'Customer' || knownInvoiceOrCnCustomers.has(key);
    const hasGstin = Boolean(p.gstin && p.gstin.trim().length >= 10);

    if (!isProtectedCustomer) {
      if (knownBrokerKeys.has(key)) continue;
      if (BROKER_NAME_REGEX.test(p.name)) continue;
      if (!hasGstin && isKnownTransportBrokerName(p.name)) continue;
      if (!hasGstin && knownDriverKeys.has(key)) continue;
      if (!hasGstin && knownOwnerKeys.has(key)) continue;
    }

    const compositeKey = `${key}::${(p.gstin || '').trim().toUpperCase()}::${normalizePartyMatchKey(p.phone)}::${normalizePartyMatchKey(p.address)}`;
    const existing = deduped.get(compositeKey);
    if (!existing) {
      deduped.set(compositeKey, p);
    } else {
      const existingScore =
        (existing.gstin ? 4 : 0) +
        (existing.address ? 2 : 0) +
        (existing.partyType === 'Customer' ? 1 : 0);
      const nextScore =
        (p.gstin ? 4 : 0) + (p.address ? 2 : 0) + (p.partyType === 'Customer' ? 1 : 0);
      if (nextScore > existingScore) {
        deduped.set(compositeKey, p);
      }
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface PartySeparationResult {
  cleanParties: Party[];
  updatedParties: Party[];
  duplicatePartyIds: string[];
  brokersSeparated: number;
  ownersSeparated: number;
  driversSeparated: number;
  duplicatesMerged: number;
}

function mergePartyFields(primary: Party, secondary: Party): Party {
  return {
    ...primary,
    address: primary.address || secondary.address || '',
    gstin: primary.gstin || secondary.gstin || '',
    pan: primary.pan || secondary.pan || '',
    phone: primary.phone || secondary.phone || '',
    email: primary.email || secondary.email || '',
    aadhaarNo: primary.aadhaarNo || secondary.aadhaarNo || '',
    tradeLicenseNo: primary.tradeLicenseNo || secondary.tradeLicenseNo || '',
    bankName: primary.bankName || secondary.bankName || '',
    bankAccountNo: primary.bankAccountNo || secondary.bankAccountNo || '',
    bankIfsc: primary.bankIfsc || secondary.bankIfsc || '',
    openingBalance: primary.openingBalance || secondary.openingBalance || 0,
    currentBalance: primary.currentBalance || secondary.currentBalance || 0,
  };
}

/**
 * Separates Brokers, Vehicle Owners, and Driver ledgers out of Customer/Billing Parties
 * and merges/deduplicates overlapping FoxPro HEAD.dbf vs brkrmast.dbf records.
 */
export function analyzeAndSeparateMisclassifiedParties(params: {
  parties: Party[];
  drivers?: Driver[];
  lorryHires?: LorryHire[];
  invoices?: Invoice[];
  consignments?: ConsignmentNote[];
  extraBrokerNames?: string[];
  extraOwnerNames?: string[];
  extraDriverNames?: string[];
  extraCustomerNames?: string[];
}): PartySeparationResult {
  const {
    parties,
    drivers = [],
    lorryHires = [],
    invoices = [],
    consignments = [],
    extraBrokerNames = [],
    extraOwnerNames = [],
    extraDriverNames = [],
    extraCustomerNames = [],
  } = params;

  const protectedCustomerKeys = new Set<string>();
  for (const inv of invoices) {
    const k = normalizePartyMatchKey(inv.partyName);
    if (k) protectedCustomerKeys.add(k);
  }
  for (const cn of consignments) {
    const k1 = normalizePartyMatchKey(cn.billingPartyName);
    const k2 = normalizePartyMatchKey(cn.consignorName);
    const k3 = normalizePartyMatchKey(cn.consigneeName);
    if (k1) protectedCustomerKeys.add(k1);
    if (k2) protectedCustomerKeys.add(k2);
    if (k3) protectedCustomerKeys.add(k3);
  }
  for (const cname of extraCustomerNames) {
    const k = normalizePartyMatchKey(cname);
    if (k) protectedCustomerKeys.add(k);
  }

  const brokerKeys = new Set<string>();
  const ownerKeys = new Set<string>();
  const driverKeys = new Set<string>();

  for (const p of parties) {
    const k = normalizePartyMatchKey(p.name);
    if (!k) continue;
    if (p.partyType === 'Broker' || p.id.startsWith('dbf_brk_') || p.id.startsWith('brk_')) {
      brokerKeys.add(k);
    } else if (
      p.partyType === 'TruckOwner' ||
      p.id.startsWith('dbf_own_') ||
      p.id.startsWith('own_')
    ) {
      ownerKeys.add(k);
    }
  }

  for (const lh of lorryHires) {
    const bk = normalizePartyMatchKey(lh.brokerName);
    const ow = normalizePartyMatchKey(lh.ownerName);
    if (bk) brokerKeys.add(bk);
    if (ow) ownerKeys.add(ow);
  }

  for (const bName of extraBrokerNames) {
    const k = normalizePartyMatchKey(bName);
    if (k) brokerKeys.add(k);
  }
  for (const oName of extraOwnerNames) {
    const k = normalizePartyMatchKey(oName);
    if (k) ownerKeys.add(k);
  }
  for (const d of drivers) {
    const k = normalizePartyMatchKey(d.name);
    if (k) driverKeys.add(k);
  }
  for (const dName of extraDriverNames) {
    const k = normalizePartyMatchKey(dName);
    if (k) driverKeys.add(k);
  }

  const BROKER_NAME_REGEX =
    /\b(broker|brkr|commission\s*agent|lorry\s*broker|truck\s*broker|booking\s*agent|dalal)\b|\(\s*(brk|broker)\s*\)$/i;
  const OWNER_NAME_REGEX =
    /\b(lorry\s*owner|truck\s*owner|fleet\s*owner|vehicle\s*owner)\b|\(\s*(own|owner)\s*\)$/i;
  const DRIVER_NAME_REGEX = /\b(driver|drvr)\b|\(\s*(drv|driver)\s*\)$/i;

  const updatedMap = new Map<string, Party>();
  const duplicateIds = new Set<string>();
  let brokersSeparated = 0;
  let ownersSeparated = 0;
  let driversSeparated = 0;
  let duplicatesMerged = 0;

  // Keep track of canonical Broker and TruckOwner rows by normalized name
  const canonicalBrokers = new Map<string, Party>();
  const canonicalOwners = new Map<string, Party>();

  for (const p of parties) {
    const key = normalizePartyMatchKey(p.name);
    if (!key) continue;
    if (p.partyType === 'Broker' && !canonicalBrokers.has(key)) {
      canonicalBrokers.set(key, p);
    } else if (p.partyType === 'TruckOwner' && !canonicalOwners.has(key)) {
      canonicalOwners.set(key, p);
    }
  }

  const workingList: Party[] = [];

  for (const p of parties) {
    const key = normalizePartyMatchKey(p.name);
    if (!key) {
      workingList.push(p);
      continue;
    }

    // Never touch already-Vendor rows
    if (p.partyType === 'Vendor') {
      workingList.push(p);
      continue;
    }

    const isFromHeadDbf =
      p.id.startsWith('dbf_head_') ||
      p.id.startsWith('dbf_party_') ||
      p.id.startsWith('dbf_acct_');
    const isCustomerTagged = isBillingCustomerType(p.partyType);
    const hasGstin = Boolean(p.gstin && p.gstin.trim().length >= 10);
    const isProtected = isFromHeadDbf || protectedCustomerKeys.has(key);

    // 1. Check Broker classification (Never reclassify HEAD/PARTY/ACCT customers to Broker)
    const shouldBeBroker =
      !isFromHeadDbf &&
      (p.id.startsWith('dbf_brk_') ||
        p.id.startsWith('brk_') ||
        (isCustomerTagged && !isProtected && BROKER_NAME_REGEX.test(p.name)) ||
        (isCustomerTagged && !isProtected && !hasGstin && brokerKeys.has(key)));

    if (shouldBeBroker) {
      const existingBroker = canonicalBrokers.get(key);
      if (existingBroker && existingBroker.id !== p.id) {
        const merged = mergePartyFields(existingBroker, p);
        canonicalBrokers.set(key, merged);
        updatedMap.set(merged.id, merged);
        duplicateIds.add(p.id);
        duplicatesMerged += 1;
        if (isCustomerTagged) brokersSeparated += 1;
        continue;
      }

      if (p.partyType !== 'Broker') {
        const reclassified: Party = {
          ...p,
          partyType: 'Broker',
          balanceType: p.balanceType || 'Cr',
        };
        canonicalBrokers.set(key, reclassified);
        updatedMap.set(reclassified.id, reclassified);
        brokersSeparated += 1;
        workingList.push(reclassified);
        continue;
      }

      workingList.push(p);
      continue;
    }

    // 2. Check Vehicle Owner classification (Never reclassify HEAD/PARTY/ACCT customers to TruckOwner)
    const shouldBeOwner =
      !isFromHeadDbf &&
      (p.id.startsWith('dbf_own_') ||
        p.id.startsWith('own_') ||
        (isCustomerTagged &&
          !isProtected &&
          !hasGstin &&
          (ownerKeys.has(key) || OWNER_NAME_REGEX.test(p.name))));

    if (shouldBeOwner) {
      const existingOwner = canonicalOwners.get(key);
      if (existingOwner && existingOwner.id !== p.id) {
        const merged = mergePartyFields(existingOwner, p);
        canonicalOwners.set(key, merged);
        updatedMap.set(merged.id, merged);
        duplicateIds.add(p.id);
        duplicatesMerged += 1;
        if (isCustomerTagged) ownersSeparated += 1;
        continue;
      }

      if (p.partyType !== 'TruckOwner') {
        const reclassified: Party = {
          ...p,
          partyType: 'TruckOwner',
          balanceType: p.balanceType || 'Cr',
        };
        canonicalOwners.set(key, reclassified);
        updatedMap.set(reclassified.id, reclassified);
        ownersSeparated += 1;
        workingList.push(reclassified);
        continue;
      }

      workingList.push(p);
      continue;
    }

    // 3. Check Driver-named ledger accidentally tagged as Customer (without HEAD source, GSTIN or Customer Invoices)
    const isDriverLedger =
      !isFromHeadDbf &&
      isCustomerTagged &&
      !isProtected &&
      !hasGstin &&
      (driverKeys.has(key) || DRIVER_NAME_REGEX.test(p.name));

    if (isDriverLedger) {
      const reclassified: Party = {
        ...p,
        partyType: 'Vendor',
      };
      updatedMap.set(reclassified.id, reclassified);
      driversSeparated += 1;
      workingList.push(reclassified);
      continue;
    }

    workingList.push(p);
  }

  const finalCleanParties = workingList.map((p) => updatedMap.get(p.id) || p);

  return {
    cleanParties: finalCleanParties,
    updatedParties: Array.from(updatedMap.values()),
    duplicatePartyIds: Array.from(duplicateIds),
    brokersSeparated,
    ownersSeparated,
    driversSeparated,
    duplicatesMerged,
  };
}

/**
 * Restores any HEAD / PARTY / ACCT FoxPro customer records that were mistakenly moved
 * into Broker / TruckOwner / Vendor back to Billing Customers ('Customer').
 */
export function restoreHeadPartiesToBillingCustomers(parties: Party[]): {
  restoredParties: Party[];
  restoredCount: number;
} {
  const restoredParties: Party[] = [];
  for (const p of parties) {
    const isHeadOrigin =
      p.id.startsWith('dbf_head_') ||
      p.id.startsWith('dbf_party_') ||
      p.id.startsWith('dbf_acct_');
    if (isHeadOrigin && p.partyType !== 'Customer') {
      restoredParties.push({
        ...p,
        partyType: 'Customer',
        balanceType: p.balanceType || 'Dr',
      });
    }
  }
  return {
    restoredParties,
    restoredCount: restoredParties.length,
  };
}
