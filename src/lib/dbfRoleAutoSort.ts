import {
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
  Vehicle,
} from '../types/erp';
import {
  bulkRemoveDocuments,
  bulkUpsertDocuments,
} from './firestoreStore';
import {
  extractMasterRolesFromDbfTables,
  loadRawDbfArchiveFromIdb,
} from './foxproDbfImport';
import {
  cleanAndDeduplicateDrivers,
  cleanAndDeduplicateVehicles,
  hasBillingCompanySuffixOrKeyword,
  isBillingCustomerOriginId,
  isBillingCustomerType,
  isRealTruckRegistrationNo,
  normalizePartyMatchKey,
  normalizeTruckRegNo,
} from './partySeparation';

export interface DbfRoleAutoSortResult {
  archiveTablesCount: number;
  billingPartiesCount: number;
  brokersCount: number;
  ownersCount: number;
  driversCount: number;
  vehiclesCount: number;
  partiesUpsertedCount: number;
  partiesRemovedCount: number;
  driversRemovedCount: number;
  driversUpsertedCount: number;
  vehiclesPurgedCount: number;
  vehiclesUpsertedCount: number;
  tripsRepairedCount: number;
  marbillInvoicesAddedCount: number;
  totalChanges: number;
}

function mergeRichParty(primary: Party, secondary: Party): { merged: Party; changed: boolean } {
  const merged: Party = {
    ...primary,
    partyCode: primary.partyCode || secondary.partyCode || undefined,
    address: primary.address || secondary.address || '',
    city: primary.city || secondary.city || '',
    pinCode: primary.pinCode || secondary.pinCode || '',
    stateCode: primary.stateCode || secondary.stateCode || '',
    stateName: primary.stateName || secondary.stateName || '',
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
  const changed =
    (merged.partyCode || '') !== (primary.partyCode || '') ||
    (merged.address || '') !== (primary.address || '') ||
    (merged.city || '') !== (primary.city || '') ||
    (merged.pinCode || '') !== (primary.pinCode || '') ||
    (merged.stateCode || '') !== (primary.stateCode || '') ||
    (merged.stateName || '') !== (primary.stateName || '') ||
    (merged.gstin || '') !== (primary.gstin || '') ||
    (merged.pan || '') !== (primary.pan || '') ||
    (merged.phone || '') !== (primary.phone || '') ||
    (merged.email || '') !== (primary.email || '') ||
    (merged.bankName || '') !== (primary.bankName || '') ||
    (merged.bankAccountNo || '') !== (primary.bankAccountNo || '') ||
    (merged.bankIfsc || '') !== (primary.bankIfsc || '') ||
    (merged.openingBalance || 0) !== (primary.openingBalance || 0) ||
    (merged.currentBalance || 0) !== (primary.currentBalance || 0);
  return { merged, changed };
}

function scorePartyRichness(p: Party): number {
  let score = 0;
  if (p.gstin && p.gstin.trim().length >= 10) score += 8;
  if (p.pan && p.pan.trim().length >= 8) score += 5;
  if (p.address && p.address.trim()) score += 3;
  if (p.phone && p.phone.trim()) score += 2;
  if (p.email && p.email.trim()) score += 1;
  if (p.partyCode) score += 1;
  if (isBillingCustomerOriginId(p.id) || p.id.startsWith('dbf_brk_') || p.id.startsWith('dbf_own_')) score += 1;
  if (!p.id.startsWith('dbf_')) score += 2;
  return score;
}

function isUnspecifiedTruckText(val: string | undefined | null): boolean {
  const clean = String(val || '').trim();
  return /^UNSPECIFIED/i.test(clean);
}

/**
 * PART 1 — One-Click & One-Time Startup DBF Data Auto-Clean & Exact Role Re-Mapping:
 * 1. Billing Parties (HEAD / marparty.dbf / ledger.dbf SUNDRY DEBTORS / company keywords) -> Customer, deduplicated.
 * 2. Brokers (brkrmast.dbf only) -> Broker, never mixed with Lorry Owners.
 * 3. Lorry Owners (ownrmast.dbf only, excluding company suffixes) -> TruckOwner with PAN/Name/Mobile/Address.
 * 4. Drivers (courvhl.dbf / VHMAIN.dbf / courtran.dbf / drvrmast.dbf) -> Individual human names + DL/Mobile only.
 * 5. Vehicles & Trips (courvhl.dbf / VHMAIN.dbf / courtran.dbf / marbill.dbf) -> Real reg nos, purge UNSPECIFIED-TRUCK-*, link trips.
 */
export async function autoSortAllDbfDataToExactRoles(params: {
  ownerUid: string;
  activeFy: string;
  branchCode?: string;
  staffCode?: string;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  consignments: ConsignmentNote[];
  invoices: Invoice[];
  lorryHires: LorryHire[];
}): Promise<DbfRoleAutoSortResult> {
  const rawTables = await loadRawDbfArchiveFromIdb().catch(() => []);
  const extracted = extractMasterRolesFromDbfTables({
    tables: rawTables,
    ownerUid: params.ownerUid,
    activeFy: params.activeFy,
    branchCode: params.branchCode || 'KOL-HQ',
    staffCode: params.staffCode || 'ADMIN',
  });

  // Lookup maps from Raw DBF Archive
  const archivedBillingMap = new Map<string, Party>();
  for (const bp of extracted.billingParties) {
    const k = normalizePartyMatchKey(bp.name);
    if (k && !archivedBillingMap.has(k)) archivedBillingMap.set(k, bp);
  }
  const archivedBrokerMap = new Map<string, Party>();
  for (const br of extracted.brokers) {
    const k = normalizePartyMatchKey(br.name);
    if (k && !archivedBrokerMap.has(k)) archivedBrokerMap.set(k, br);
  }
  const archivedOwnerMap = new Map<string, Party>();
  for (const ow of extracted.lorryOwners) {
    const k = normalizePartyMatchKey(ow.name);
    if (k && !archivedOwnerMap.has(k)) archivedOwnerMap.set(k, ow);
  }

  // Confirmed Billing Parties from Invoices & Consignments
  const billedCustomerKeys = new Set<string>();
  for (const inv of params.invoices) {
    const k = normalizePartyMatchKey(inv.partyName);
    if (k) billedCustomerKeys.add(k);
  }
  for (const cn of params.consignments) {
    const k1 = normalizePartyMatchKey(cn.billingPartyName);
    const k2 = normalizePartyMatchKey(cn.consignorName);
    if (k1) billedCustomerKeys.add(k1);
    if (k2) billedCustomerKeys.add(k2);
  }

  // Confirmed Lorry Owner names referenced by live LorryHires
  const referencedOwnerKeys = new Set<string>();
  for (const lh of params.lorryHires) {
    const k = normalizePartyMatchKey(lh.ownerName);
    if (k) referencedOwnerKeys.add(k);
  }

  const inputPartyIds = new Set(params.parties.map((p) => p.id));
  const upsertedPartyMap = new Map<string, Party>();
  const removedPartyIds = new Set<string>();

  // Step 1: Reclassify existing parties strictly by exact rules
  const reclassifiedParties: Party[] = [];
  for (const p of params.parties) {
    const nk = normalizePartyMatchKey(p.name);
    if (!nk) {
      reclassifiedParties.push(p);
      continue;
    }

    // Keep explicit Vendors untouched unless they have company suffix -> Customer
    if (p.partyType === 'Vendor' && !hasBillingCompanySuffixOrKeyword(p.name)) {
      reclassifiedParties.push(p);
      continue;
    }

    const isSpuriousCourvhlOwner =
      (p.id.startsWith('dbf_own_courvhl') || p.id.startsWith('dbf_own_vhmain')) &&
      archivedOwnerMap.size > 0 &&
      !archivedOwnerMap.has(nk) &&
      !referencedOwnerKeys.has(nk) &&
      !billedCustomerKeys.has(nk) &&
      !archivedBillingMap.has(nk) &&
      !hasBillingCompanySuffixOrKeyword(p.name);

    if (isSpuriousCourvhlOwner) {
      removedPartyIds.add(p.id);
      continue;
    }

    const archivedCustomer = archivedBillingMap.get(nk);
    const archivedBroker = archivedBrokerMap.get(nk);
    const archivedOwner = archivedOwnerMap.get(nk);

    const isBilling =
      hasBillingCompanySuffixOrKeyword(p.name) ||
      isBillingCustomerOriginId(p.id) ||
      Boolean(archivedCustomer) ||
      billedCustomerKeys.has(nk);

    if (isBilling) {
      let next: Party =
        p.partyType !== 'Customer'
          ? {
              ...p,
              partyType: 'Customer',
              balanceType: p.balanceType || 'Dr',
            }
          : p;
      if (archivedCustomer) {
        const { merged, changed } = mergeRichParty(next, archivedCustomer);
        if (changed) next = merged;
      }
      if (next !== p) upsertedPartyMap.set(next.id, next);
      reclassifiedParties.push(next);
      continue;
    }

    const isStrictBroker =
      p.id.startsWith('dbf_brk_') ||
      Boolean(archivedBroker) ||
      (p.partyType === 'Broker' && !p.id.startsWith('dbf_own_') && !archivedOwner);

    if (isStrictBroker) {
      let next: Party =
        p.partyType !== 'Broker'
          ? {
              ...p,
              partyType: 'Broker',
              balanceType: p.balanceType || 'Cr',
            }
          : p;
      if (archivedBroker) {
        const { merged, changed } = mergeRichParty(next, archivedBroker);
        if (changed) next = merged;
      }
      if (next !== p) upsertedPartyMap.set(next.id, next);
      reclassifiedParties.push(next);
      continue;
    }

    const isStrictOwner =
      p.id.startsWith('dbf_own_') ||
      p.id.startsWith('own_') ||
      Boolean(archivedOwner) ||
      p.partyType === 'TruckOwner';

    if (isStrictOwner) {
      let next: Party =
        p.partyType !== 'TruckOwner'
          ? {
              ...p,
              partyType: 'TruckOwner',
              balanceType: p.balanceType || 'Cr',
            }
          : p;
      if (archivedOwner) {
        const { merged, changed } = mergeRichParty(next, archivedOwner);
        if (changed) next = merged;
      }
      if (next !== p) upsertedPartyMap.set(next.id, next);
      reclassifiedParties.push(next);
      continue;
    }

    reclassifiedParties.push(p);
  }

  // Step 2: Deduplicate per exact role + add missing DBF archive master parties
  const dedupRoleGroup = (
    rows: Party[],
    newAdditions: Party[],
    matchWithGstin: boolean
  ): Party[] => {
    const combined = [...rows, ...newAdditions];
    const sorted = [...combined].sort((a, b) => scorePartyRichness(b) - scorePartyRichness(a));
    const byName = new Map<string, Party>();
    const byNameGstin = new Map<string, Party>();
    const dropped = new Set<string>();

    for (const p of sorted) {
      const nk = normalizePartyMatchKey(p.name);
      if (!nk) continue;
      const gst = String(p.gstin || '').trim().toUpperCase();
      const exactKey = matchWithGstin && gst.length >= 10 ? `${nk}::${gst}` : '';

      const existing =
        (exactKey ? byNameGstin.get(exactKey) : undefined) ||
        (!exactKey ? byName.get(nk) : undefined) ||
        (exactKey && byName.get(nk) && (!byName.get(nk)!.gstin || byName.get(nk)!.gstin === gst)
          ? byName.get(nk)
          : undefined);

      if (existing && existing.id !== p.id) {
        const compatibleGst =
          !matchWithGstin ||
          !existing.gstin ||
          !p.gstin ||
          existing.gstin.trim().toUpperCase() === p.gstin.trim().toUpperCase();
        if (compatibleGst) {
          const { merged, changed } = mergeRichParty(existing, p);
          if (changed || !inputPartyIds.has(merged.id)) {
            upsertedPartyMap.set(merged.id, merged);
          }
          byName.set(nk, merged);
          const mGst = String(merged.gstin || '').trim().toUpperCase();
          if (matchWithGstin && mGst.length >= 10) {
            byNameGstin.set(`${nk}::${mGst}`, merged);
          }
          if (inputPartyIds.has(p.id)) {
            removedPartyIds.add(p.id);
          }
          dropped.add(p.id);
          continue;
        }
      }

      if (!inputPartyIds.has(p.id)) {
        upsertedPartyMap.set(p.id, p);
      }
      if (!byName.has(nk)) byName.set(nk, p);
      if (exactKey && !byNameGstin.has(exactKey)) byNameGstin.set(exactKey, p);
    }

    return combined.filter((p) => !dropped.has(p.id)).map((p) => upsertedPartyMap.get(p.id) || p);
  };

  const existingCustomers = reclassifiedParties.filter((p) => isBillingCustomerType(p.partyType));
  const existingBrokers = reclassifiedParties.filter((p) => p.partyType === 'Broker');
  const existingOwners = reclassifiedParties.filter((p) => p.partyType === 'TruckOwner');
  const existingVendors = reclassifiedParties.filter((p) => p.partyType === 'Vendor');

  const finalCustomers = dedupRoleGroup(existingCustomers, extracted.billingParties, true);
  const finalBrokers = dedupRoleGroup(existingBrokers, extracted.brokers, false);
  const finalOwners = dedupRoleGroup(existingOwners, extracted.lorryOwners, false);
  const finalAllParties = [...finalCustomers, ...finalBrokers, ...finalOwners, ...existingVendors];

  // Clean up any upserted entries that got marked removed during dedup
  for (const remId of removedPartyIds) {
    upsertedPartyMap.delete(remId);
  }
  const partiesToUpsert = Array.from(upsertedPartyMap.values());
  const partyIdsToDelete = Array.from(removedPartyIds).filter((id) => inputPartyIds.has(id));

  // Step 3: Drivers — combine live + DBF (courvhl / VHMAIN / courtran / drvrmast) -> individual humans only
  const inputDriverIds = new Set(params.drivers.map((d) => d.id));
  const combinedDriversMap = new Map<string, Driver>();
  for (const d of params.drivers) combinedDriversMap.set(d.id, d);
  for (const d of extracted.drivers) {
    if (!combinedDriversMap.has(d.id)) combinedDriversMap.set(d.id, d);
  }

  const driverCleanup = cleanAndDeduplicateDrivers({
    drivers: Array.from(combinedDriversMap.values()),
    parties: finalAllParties,
    invoices: params.invoices,
    consignments: params.consignments,
    lorryHires: params.lorryHires,
    extraBillingPartyNames: extracted.billingParties.map((p) => p.name),
  });

  const updatedDriverIds = new Set(driverCleanup.updatedDrivers.map((d) => d.id));
  const driversToUpsert = driverCleanup.cleanDrivers.filter(
    (d) => !inputDriverIds.has(d.id) || updatedDriverIds.has(d.id)
  );
  const driverIdsToDelete = driverCleanup.removedDriverIds.filter((id) => inputDriverIds.has(id));

  // Step 4: Vehicles — purge UNSPECIFIED-TRUCK-* + map real reg nos + deduplicate
  const inputVehicleIds = new Set(params.vehicles.map((v) => v.id));
  const combinedVehicleMap = new Map<string, Vehicle>();
  for (const v of params.vehicles) combinedVehicleMap.set(v.id, v);
  for (const v of extracted.vehicles) {
    if (!combinedVehicleMap.has(v.id)) combinedVehicleMap.set(v.id, v);
  }

  const vehicleCleanup = cleanAndDeduplicateVehicles(Array.from(combinedVehicleMap.values()));
  const updatedVehicleIds = new Set(vehicleCleanup.updatedVehicles.map((v) => v.id));
  const vehiclesToUpsert = vehicleCleanup.cleanVehicles.filter(
    (v) => !inputVehicleIds.has(v.id) || updatedVehicleIds.has(v.id)
  );
  const vehicleIdsToDelete = vehicleCleanup.removedVehicleIds.filter((id) => inputVehicleIds.has(id));

  // Step 5: Missing marbill.dbf Invoices + Repair UNSPECIFIED-TRUCK-* on Consignments, Invoices, Lorry Hires
  const existingInvIds = new Set(params.invoices.map((i) => i.id));
  const existingInvNos = new Set(
    params.invoices.map((i) => String(i.invoiceNo || '').trim().toLowerCase()).filter(Boolean)
  );

  const marbillInvoicesToAdd: Invoice[] = [];
  for (const inv of extracted.missingMarbillInvoices) {
    const noKey = String(inv.invoiceNo || '').trim().toLowerCase();
    if (!existingInvIds.has(inv.id) && (!noKey || !existingInvNos.has(noKey))) {
      marbillInvoicesToAdd.push(inv);
      if (noKey) existingInvNos.add(noKey);
    }
  }

  const consignmentsToUpdate: ConsignmentNote[] = [];
  for (const cn of params.consignments) {
    if (isRealTruckRegistrationNo(cn.truckNo) && !isUnspecifiedTruckText(cn.truckNo)) {
      continue;
    }
    const cnKey = String(cn.cnNo || '').trim().toLowerCase();
    const invKey = String(cn.taxInvNo || '').trim().toLowerCase();
    const mapped =
      (cnKey ? extracted.cnToTruckMap.get(cnKey) : undefined) ||
      (invKey ? extracted.invToTruckMap.get(invKey) : undefined);

    if (mapped) {
      consignmentsToUpdate.push({ ...cn, truckNo: normalizeTruckRegNo(mapped) });
    } else if (isUnspecifiedTruckText(cn.truckNo)) {
      consignmentsToUpdate.push({ ...cn, truckNo: '-' });
    }
  }

  const invoicesToUpdate: Invoice[] = [...marbillInvoicesToAdd];
  for (const inv of params.invoices) {
    const invKey = String(inv.invoiceNo || '').trim().toLowerCase();
    let rowChanged = false;
    const nextRows = (inv.consignmentRows || []).map((row) => {
      if (isRealTruckRegistrationNo(row.vehicle) && !isUnspecifiedTruckText(row.vehicle)) {
        return row;
      }
      const cnKey = String(row.cnNo || '').trim().toLowerCase();
      const mapped =
        (cnKey ? extracted.cnToTruckMap.get(cnKey) : undefined) ||
        (invKey ? extracted.invToTruckMap.get(invKey) : undefined);
      if (mapped) {
        rowChanged = true;
        return { ...row, vehicle: normalizeTruckRegNo(mapped) };
      }
      if (isUnspecifiedTruckText(row.vehicle)) {
        rowChanged = true;
        return { ...row, vehicle: '-' };
      }
      return row;
    });
    if (rowChanged) {
      invoicesToUpdate.push({ ...inv, consignmentRows: nextRows });
    }
  }

  const lorryHiresToUpdate: LorryHire[] = [];
  for (const lh of params.lorryHires) {
    if (isRealTruckRegistrationNo(lh.truckNo) && !isUnspecifiedTruckText(lh.truckNo)) {
      continue;
    }
    const cnKey = String(lh.cnNo || '').trim().toLowerCase();
    const mapped = cnKey ? extracted.cnToTruckMap.get(cnKey) : undefined;
    if (mapped) {
      lorryHiresToUpdate.push({ ...lh, truckNo: normalizeTruckRegNo(mapped) });
    } else if (isUnspecifiedTruckText(lh.truckNo)) {
      lorryHiresToUpdate.push({ ...lh, truckNo: '-' });
    }
  }

  // Persist changes in batches
  if (partiesToUpsert.length > 0) {
    await bulkUpsertDocuments('parties', partiesToUpsert as unknown as Array<Record<string, unknown>>);
  }
  if (partyIdsToDelete.length > 0) {
    await bulkRemoveDocuments('parties', partyIdsToDelete);
  }
  if (driversToUpsert.length > 0) {
    await bulkUpsertDocuments('drivers', driversToUpsert as unknown as Array<Record<string, unknown>>);
  }
  if (driverIdsToDelete.length > 0) {
    await bulkRemoveDocuments('drivers', driverIdsToDelete);
  }
  if (vehiclesToUpsert.length > 0) {
    await bulkUpsertDocuments('vehicles', vehiclesToUpsert as unknown as Array<Record<string, unknown>>);
  }
  if (vehicleIdsToDelete.length > 0) {
    await bulkRemoveDocuments('vehicles', vehicleIdsToDelete);
  }
  if (consignmentsToUpdate.length > 0) {
    await bulkUpsertDocuments(
      'consignments',
      consignmentsToUpdate as unknown as Array<Record<string, unknown>>
    );
  }
  if (invoicesToUpdate.length > 0) {
    await bulkUpsertDocuments('invoices', invoicesToUpdate as unknown as Array<Record<string, unknown>>);
  }
  if (lorryHiresToUpdate.length > 0) {
    await bulkUpsertDocuments(
      'lorry_hires',
      lorryHiresToUpdate as unknown as Array<Record<string, unknown>>
    );
  }

  const tripsRepairedCount =
    consignmentsToUpdate.length +
    (invoicesToUpdate.length - marbillInvoicesToAdd.length) +
    lorryHiresToUpdate.length;

  const totalChanges =
    partiesToUpsert.length +
    partyIdsToDelete.length +
    driversToUpsert.length +
    driverIdsToDelete.length +
    vehiclesToUpsert.length +
    vehicleIdsToDelete.length +
    consignmentsToUpdate.length +
    invoicesToUpdate.length +
    lorryHiresToUpdate.length;

  return {
    archiveTablesCount: rawTables.length,
    billingPartiesCount: finalCustomers.length,
    brokersCount: finalBrokers.length,
    ownersCount: finalOwners.length,
    driversCount: driverCleanup.cleanDrivers.length,
    vehiclesCount: vehicleCleanup.cleanVehicles.length,
    partiesUpsertedCount: partiesToUpsert.length,
    partiesRemovedCount: partyIdsToDelete.length,
    driversRemovedCount: driverIdsToDelete.length,
    driversUpsertedCount: driversToUpsert.length,
    vehiclesPurgedCount: vehicleIdsToDelete.length,
    vehiclesUpsertedCount: vehiclesToUpsert.length,
    tripsRepairedCount,
    marbillInvoicesAddedCount: marbillInvoicesToAdd.length,
    totalChanges,
  };
}
