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

export function isBillingCustomerOriginId(id: string | undefined | null): boolean {
  const s = String(id || '');
  return (
    s.startsWith('dbf_head_') ||
    s.startsWith('dbf_marparty_') ||
    s.startsWith('dbf_ledger_') ||
    s.startsWith('dbf_party_') ||
    s.startsWith('dbf_acct_')
  );
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

    // Never reclassify/exclude explicit HEAD / MARPARTY / LEDGER Sundry Debtors / PARTY / ACCT DBF customers or explicit 'Customer' role rows
    const isFromHeadDbf = isBillingCustomerOriginId(p.id);
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

    const isFromHeadDbf = isBillingCustomerOriginId(p.id);
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
 * Restores any HEAD / MARPARTY / LEDGER (Sundry Debtors) / PARTY / ACCT FoxPro customer records
 * (plus invoiced/consigned billing parties and optional freshly extracted DBF billing parties)
 * into unique Billing Customers ('Customer') while merging duplicates cleanly.
 */
export function restoreHeadPartiesToBillingCustomers(
  parties: Party[],
  consignments: ConsignmentNote[] = [],
  invoices: Invoice[] = [],
  extraBillingParties: Party[] = []
): {
  restoredParties: Party[];
  restoredCount: number;
  addedCount: number;
  duplicatePartyIds: string[];
  mergedParties: Party[];
} {
  const billedCustomerKeys = new Set<string>();
  for (const inv of invoices) {
    const k = normalizePartyMatchKey(inv.partyName);
    if (k) billedCustomerKeys.add(k);
  }
  for (const cn of consignments) {
    const k1 = normalizePartyMatchKey(cn.billingPartyName);
    const k2 = normalizePartyMatchKey(cn.consignorName);
    if (k1) billedCustomerKeys.add(k1);
    if (k2) billedCustomerKeys.add(k2);
  }

  const extraCustomerMap = new Map<string, Party>();
  for (const ep of extraBillingParties) {
    const k = normalizePartyMatchKey(ep.name);
    if (!k) continue;
    const prev = extraCustomerMap.get(k);
    extraCustomerMap.set(k, prev ? mergePartyFields(prev, ep) : ep);
  }

  const upsertedMap = new Map<string, Party>();
  const duplicateIds = new Set<string>();
  const canonicalCustomerByKey = new Map<string, Party>();
  let restoredCount = 0;
  let addedCount = 0;

  const pickPartyDedupKey = (p: Party): string => {
    const norm = normalizePartyMatchKey(p.name);
    const gst = String(p.gstin || '').trim().toUpperCase();
    return gst && gst.length >= 10 ? `${norm}::${gst}` : norm;
  };

  // Index existing Customer rows first
  for (const p of parties) {
    if (p.partyType === 'Customer') {
      const dKey = pickPartyDedupKey(p);
      const normOnly = normalizePartyMatchKey(p.name);
      if (dKey && !canonicalCustomerByKey.has(dKey)) {
        canonicalCustomerByKey.set(dKey, p);
      }
      if (normOnly && !canonicalCustomerByKey.has(normOnly)) {
        canonicalCustomerByKey.set(normOnly, p);
      }
    }
  }

  const workingList: Party[] = [];

  for (const p of parties) {
    const normName = normalizePartyMatchKey(p.name);
    const isExplicitBrokerOrOwnerId =
      p.id.startsWith('dbf_brk_') ||
      p.id.startsWith('brk_') ||
      p.id.startsWith('dbf_own_') ||
      p.id.startsWith('own_');

    const isDriverOriginId = p.id.startsWith('dbf_drv_');
    const isBillingOrigin = isBillingCustomerOriginId(p.id);
    const isBilledCustomer = Boolean(normName && billedCustomerKeys.has(normName));
    const matchingExtra = normName ? extraCustomerMap.get(normName) : undefined;

    if (isDriverOriginId || (isExplicitBrokerOrOwnerId && !matchingExtra && !isBillingOrigin)) {
      workingList.push(p);
      continue;
    }

    const shouldBeCustomer =
      p.partyType === 'Customer' ||
      isBillingOrigin ||
      isBilledCustomer ||
      (Boolean(matchingExtra) && !isExplicitBrokerOrOwnerId);

    if (shouldBeCustomer && normName) {
      let upgraded: Party =
        p.partyType !== 'Customer'
          ? {
              ...p,
              partyType: 'Customer',
              balanceType: p.balanceType || 'Dr',
            }
          : p;

      if (matchingExtra) {
        const enriched = mergePartyFields(upgraded, matchingExtra);
        if (
          enriched.address !== upgraded.address ||
          enriched.gstin !== upgraded.gstin ||
          enriched.pan !== upgraded.pan ||
          enriched.phone !== upgraded.phone ||
          enriched.email !== upgraded.email ||
          enriched.openingBalance !== upgraded.openingBalance ||
          enriched.city !== upgraded.city ||
          enriched.pinCode !== upgraded.pinCode ||
          enriched.partyCode !== upgraded.partyCode
        ) {
          upgraded = {
            ...enriched,
            city: upgraded.city || matchingExtra.city || '',
            pinCode: upgraded.pinCode || matchingExtra.pinCode || '',
            stateCode: upgraded.stateCode || matchingExtra.stateCode || '',
            stateName: upgraded.stateName || matchingExtra.stateName || '',
            partyCode: upgraded.partyCode || matchingExtra.partyCode || '',
          };
        }
      }

      const exactKey = pickPartyDedupKey(upgraded);
      const existingCanonical =
        canonicalCustomerByKey.get(exactKey) ||
        (!upgraded.gstin ? canonicalCustomerByKey.get(normName) : undefined);

      if (existingCanonical && existingCanonical.id !== upgraded.id) {
        const sameOrCompatibleGst =
          !existingCanonical.gstin ||
          !upgraded.gstin ||
          existingCanonical.gstin.trim().toUpperCase() === upgraded.gstin.trim().toUpperCase();
        if (sameOrCompatibleGst) {
          const mergedCanonical = mergePartyFields(existingCanonical, upgraded);
          canonicalCustomerByKey.set(exactKey, mergedCanonical);
          canonicalCustomerByKey.set(normName, mergedCanonical);
          upsertedMap.set(mergedCanonical.id, mergedCanonical);
          duplicateIds.add(upgraded.id);
          continue;
        }
      }

      canonicalCustomerByKey.set(exactKey, upgraded);
      if (!canonicalCustomerByKey.has(normName)) {
        canonicalCustomerByKey.set(normName, upgraded);
      }

      if (upgraded.partyType !== p.partyType || upgraded !== p) {
        upsertedMap.set(upgraded.id, upgraded);
        if (p.partyType !== 'Customer') restoredCount += 1;
      }
      workingList.push(upgraded);
      continue;
    }

    workingList.push(p);
  }

  // Add any newly extracted Billing Parties from HEAD / MARPARTY / LEDGER (Sundry Debtors)
  for (const ep of extraBillingParties) {
    const normName = normalizePartyMatchKey(ep.name);
    if (!normName) continue;
    const dKey = pickPartyDedupKey(ep);
    const existing =
      canonicalCustomerByKey.get(dKey) ||
      canonicalCustomerByKey.get(normName);

    if (existing) {
      const sameOrCompatibleGst =
        !existing.gstin ||
        !ep.gstin ||
        existing.gstin.trim().toUpperCase() === ep.gstin.trim().toUpperCase();
      if (sameOrCompatibleGst) {
        const merged = mergePartyFields(existing, ep);
        const enriched: Party = {
          ...merged,
          partyType: 'Customer',
          balanceType: merged.balanceType || 'Dr',
          city: existing.city || ep.city || '',
          pinCode: existing.pinCode || ep.pinCode || '',
          stateCode: existing.stateCode || ep.stateCode || '',
          stateName: existing.stateName || ep.stateName || '',
          partyCode: existing.partyCode || ep.partyCode || '',
        };
        const changed =
          existing.partyType !== 'Customer' ||
          enriched.address !== existing.address ||
          enriched.gstin !== existing.gstin ||
          enriched.pan !== existing.pan ||
          enriched.phone !== existing.phone ||
          enriched.email !== existing.email ||
          enriched.openingBalance !== existing.openingBalance ||
          enriched.city !== existing.city ||
          enriched.pinCode !== existing.pinCode ||
          enriched.partyCode !== existing.partyCode;
        if (changed) {
          if (existing.partyType !== 'Customer') restoredCount += 1;
          canonicalCustomerByKey.set(dKey, enriched);
          canonicalCustomerByKey.set(normName, enriched);
          upsertedMap.set(enriched.id, enriched);
        }
        continue;
      }
    }

    const newCustomer: Party = {
      ...ep,
      partyType: 'Customer',
      balanceType: ep.balanceType || 'Dr',
    };
    canonicalCustomerByKey.set(dKey, newCustomer);
    if (!canonicalCustomerByKey.has(normName)) {
      canonicalCustomerByKey.set(normName, newCustomer);
    }
    upsertedMap.set(newCustomer.id, newCustomer);
    workingList.push(newCustomer);
    addedCount += 1;
  }

  const finalMerged = workingList
    .filter((p) => !duplicateIds.has(p.id))
    .map((p) => upsertedMap.get(p.id) || p);

  return {
    restoredParties: Array.from(upsertedMap.values()),
    restoredCount: restoredCount + addedCount,
    addedCount,
    duplicatePartyIds: Array.from(duplicateIds),
    mergedParties: finalMerged,
  };
}

export interface DriverCleanupResult {
  cleanDrivers: Driver[];
  updatedDrivers: Driver[];
  removedDriverIds: string[];
  duplicateCount: number;
  misclassifiedCount: number;
}

const COMPANY_OR_NON_DRIVER_REGEX =
  /\b(pvt\.?\s*ltd|private\s*limited|p\.?\s*ltd|ltd\.?|limited|llp|inc\.?|corp\.?|corporation|enterprises?|industries|traders?|trading|associates?|agenc(?:y|ies)|emporium|syndicate|merchants?|suppliers?|distributors?|builders?|developers?|infra|infrastructure|projects?|logistics|cargo|carriers?|roadways|roadlines|transport|packers|movers|motors|automobiles?|steel|steels|iron|cement|tea|jute|textile|mills?|chemicals?|pharma|plastics?|polymers?|paper|packaging|exports?|imports?|overseas|india|commercial|co\.?|m\/s|&\s*(sons|co|bros|brothers)|broker|brkr|commission\s*agent|lorry\s*owner|truck\s*owner|sundry\s*debtor)\b|^m\/s\b|\(\s*(party|cust|customer|brk|broker|own|owner)\s*\)$/i;

function isValidRealDlNo(dlNo: string | undefined | null): boolean {
  const clean = String(dlNo || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!clean || clean.length < 7) return false;
  if (clean.startsWith('DLOLD') || clean.startsWith('UNSPECIFIED') || /^0+$/.test(clean)) {
    return false;
  }
  return /[A-Z]/.test(clean) && /\d{4,}/.test(clean);
}

function normDlKey(dlNo: string | undefined | null): string {
  return String(dlNo || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function scoreDriverRichness(d: Driver): number {
  let score = 0;
  if (isValidRealDlNo(d.dlNo)) score += 10;
  if (d.dlExpiry && d.dlExpiry.trim()) score += 4;
  if (d.phone && d.phone.trim()) score += 3;
  if (d.aadhaarNo && d.aadhaarNo.trim()) score += 2;
  if (d.panNo && d.panNo.trim()) score += 2;
  if (d.bankAccountNo && d.bankAccountNo.trim()) score += 2;
  if (d.address && d.address.trim()) score += 1;
  if (!String(d.id || '').startsWith('dbf_')) score += 2;
  return score;
}

function mergeDriverFields(primary: Driver, secondary: Driver): { merged: Driver; changed: boolean } {
  const betterDl =
    isValidRealDlNo(primary.dlNo)
      ? primary.dlNo
      : isValidRealDlNo(secondary.dlNo)
        ? secondary.dlNo
        : primary.dlNo || secondary.dlNo || '';
  const merged: Driver = {
    ...primary,
    dlNo: betterDl,
    dlExpiry: primary.dlExpiry || secondary.dlExpiry || '',
    phone: primary.phone || secondary.phone || '',
    address: primary.address || secondary.address || '',
    pinCode: primary.pinCode || secondary.pinCode || '',
    country: primary.country || secondary.country,
    aadhaarNo: primary.aadhaarNo || secondary.aadhaarNo || '',
    panNo: primary.panNo || secondary.panNo || '',
    bankName: primary.bankName || secondary.bankName || '',
    bankAccountNo: primary.bankAccountNo || secondary.bankAccountNo || '',
    bankIfsc: primary.bankIfsc || secondary.bankIfsc || '',
  };
  const changed =
    merged.dlNo !== primary.dlNo ||
    merged.dlExpiry !== (primary.dlExpiry || '') ||
    merged.phone !== (primary.phone || '') ||
    merged.address !== (primary.address || '') ||
    merged.pinCode !== (primary.pinCode || '') ||
    merged.aadhaarNo !== (primary.aadhaarNo || '') ||
    merged.panNo !== (primary.panNo || '') ||
    merged.bankName !== (primary.bankName || '') ||
    merged.bankAccountNo !== (primary.bankAccountNo || '') ||
    merged.bankIfsc !== (primary.bankIfsc || '');
  return { merged, changed };
}

/**
 * Removes duplicate Driver records (same normalized name or same valid DL No) and
 * misclassified non-driver entries (Companies, Billing Parties from HEAD/MARPARTY/Sundry Debtors,
 * Brokers, Lorry Owners, or blank/unspecified placeholder rows).
 */
export function cleanAndDeduplicateDrivers(params: {
  drivers: Driver[];
  parties?: Party[];
  invoices?: Invoice[];
  consignments?: ConsignmentNote[];
  lorryHires?: LorryHire[];
  extraBillingPartyNames?: string[];
}): DriverCleanupResult {
  const {
    drivers,
    parties = [],
    invoices = [],
    consignments = [],
    lorryHires = [],
    extraBillingPartyNames = [],
  } = params;

  const billingCustomerKeys = new Set<string>();
  const brokerOwnerKeys = new Set<string>();

  for (const p of parties) {
    const k = normalizePartyMatchKey(p.name);
    if (!k) continue;
    if (p.partyType === 'Broker' || p.partyType === 'TruckOwner') {
      brokerOwnerKeys.add(k);
    } else if (isBillingCustomerType(p.partyType) || isBillingCustomerOriginId(p.id)) {
      billingCustomerKeys.add(k);
    }
  }
  for (const inv of invoices) {
    const k = normalizePartyMatchKey(inv.partyName);
    if (k) billingCustomerKeys.add(k);
  }
  for (const cn of consignments) {
    const k1 = normalizePartyMatchKey(cn.billingPartyName);
    const k2 = normalizePartyMatchKey(cn.consignorName);
    if (k1) billingCustomerKeys.add(k1);
    if (k2) billingCustomerKeys.add(k2);
  }
  for (const name of extraBillingPartyNames) {
    const k = normalizePartyMatchKey(name);
    if (k) billingCustomerKeys.add(k);
  }
  for (const lh of lorryHires) {
    const bk = normalizePartyMatchKey(lh.brokerName);
    const ow = normalizePartyMatchKey(lh.ownerName);
    if (bk) brokerOwnerKeys.add(bk);
    if (ow) brokerOwnerKeys.add(ow);
  }

  const confirmedTripDriverKeys = new Set<string>();
  for (const cn of consignments) {
    const dk = normalizePartyMatchKey(cn.driverName);
    if (dk) confirmedTripDriverKeys.add(dk);
  }

  const removedIds = new Set<string>();
  let misclassifiedCount = 0;

  const validCandidates: Driver[] = [];
  for (const d of drivers) {
    const rawName = String(d.name || '').trim();
    const key = normalizePartyMatchKey(rawName);
    const idStr = String(d.id || '');
    const realDl = isValidRealDlNo(d.dlNo);

    const isBlankOrJunk =
      !key ||
      /^unspecified[-\s]*driver/i.test(rawName) ||
      /^dl[-\s]*old[-\s]*\d+$/i.test(rawName);
    const hasNonDriverOriginId =
      idStr.startsWith('dbf_head_') ||
      idStr.startsWith('dbf_marparty_') ||
      idStr.startsWith('dbf_ledger_') ||
      idStr.startsWith('dbf_party_') ||
      idStr.startsWith('dbf_acct_') ||
      idStr.startsWith('dbf_brk_') ||
      idStr.startsWith('dbf_own_');
    const isCompanyOrNonDriverName = COMPANY_OR_NON_DRIVER_REGEX.test(rawName);
    const isConfirmedTripDriver = confirmedTripDriverKeys.has(key);
    const isBillingPartyMisclassified =
      billingCustomerKeys.has(key) && (!realDl || idStr.startsWith('dbf_') || !isConfirmedTripDriver);
    const isBrokerOrOwnerMisclassified =
      (brokerOwnerKeys.has(key) || (idStr.startsWith('dbf_') && isKnownTransportBrokerName(rawName))) &&
      (!realDl || !isConfirmedTripDriver);

    if (
      isBlankOrJunk ||
      hasNonDriverOriginId ||
      isCompanyOrNonDriverName ||
      isBillingPartyMisclassified ||
      isBrokerOrOwnerMisclassified
    ) {
      removedIds.add(d.id);
      misclassifiedCount += 1;
      continue;
    }

    validCandidates.push(d);
  }

  // Sort richest records first so canonical entry keeps best DL / KYC details
  const sorted = [...validCandidates].sort((a, b) => scoreDriverRichness(b) - scoreDriverRichness(a));

  const byName = new Map<string, Driver>();
  const byDl = new Map<string, Driver>();
  const updatedMap = new Map<string, Driver>();
  let duplicateCount = 0;

  for (const d of sorted) {
    const nameKey = normalizePartyMatchKey(d.name);
    const dlKey = isValidRealDlNo(d.dlNo) ? normDlKey(d.dlNo) : '';

    const matchByName = nameKey ? byName.get(nameKey) : undefined;
    const matchByDl = dlKey ? byDl.get(dlKey) : undefined;
    const existing = matchByName || matchByDl;

    if (existing && existing.id !== d.id) {
      const { merged, changed } = mergeDriverFields(existing, d);
      if (changed) {
        updatedMap.set(merged.id, merged);
        byName.set(normalizePartyMatchKey(merged.name), merged);
        if (isValidRealDlNo(merged.dlNo)) {
          byDl.set(normDlKey(merged.dlNo), merged);
        }
      }
      removedIds.add(d.id);
      duplicateCount += 1;
      continue;
    }

    if (nameKey) byName.set(nameKey, d);
    if (dlKey) byDl.set(dlKey, d);
  }

  const cleanDrivers = validCandidates
    .filter((d) => !removedIds.has(d.id))
    .map((d) => updatedMap.get(d.id) || d);

  return {
    cleanDrivers,
    updatedDrivers: Array.from(updatedMap.values()),
    removedDriverIds: Array.from(removedIds),
    duplicateCount,
    misclassifiedCount,
  };
}


