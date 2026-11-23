import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileText,
  Mail,
  Plus,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  UserCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
  CompanySettings,
  ConsignmentNote,
  DEFAULT_COMPANY_SETTINGS,
  Driver,
  DriveFolderName,
  Invoice,
  LorryHire,
  Party,
  TransactionRecord,
  Vehicle,
} from '../types/erp';
import { daysUntilDate, formatDateDDMMYYYY, formatINR, makeSafeDocId, normalizeFyLabel, todayISO } from '../lib/formatters';
import { bulkUpsertDocuments, removeDocument, upsertDocument } from '../lib/firestoreStore';
import { scanPartiesForContactIssues, validateAndNormalizeContact } from '../lib/selfHealing';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { validateIndianGstin } from '../lib/gstinValidator';
import { GstinInputField } from './GstinInputField';
import {
  analyzeAndSeparateMisclassifiedParties,
  isBillingCustomerType,
} from '../lib/partySeparation';
import {
  downloadPdfDirect,
  GeneratedPdfResult,
  generateFoxproStatementPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { SearchableSelect } from './SearchableSelect';
import { EditableSearchSelect } from './EditableSearchSelect';
import {
  EntityQuickPreviewCard,
  extractCityFromAddress,
  formatDriverDetailsLine,
  formatPartyDetailsLine,
  formatVehicleDetailsLine,
  RichEntityPicker,
} from './RichEntityPicker';
import {
  VEHICLE_BODY_TYPE_OPTIONS,
  VEHICLE_COLOR_OPTIONS,
  VEHICLE_MAKE_OPTIONS,
} from '../lib/dropdownMasterStore';
import { SupportedCountry } from '../lib/postalPinLookup';
import { PinCountryInputs, useAutoPinLookup } from './CityPinCountryAutoFill';

export type MasterTabId = 'parties' | 'owners' | 'brokers' | 'vehicles' | 'drivers';

interface MasterModuleProps {
  ownerUid: string;
  readOnly?: boolean;
  activeFy?: string;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  invoices?: Invoice[];
  consignments?: ConsignmentNote[];
  lorryHires?: LorryHire[];
  transactions?: TransactionRecord[];
  company?: CompanySettings;
  initialTab?: MasterTabId;
  onPreviewPdf?: (pdf: GeneratedPdfResult, folder: DriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

const renderExpiryStatus = (dateStr?: string, label?: string) => {
  const days = daysUntilDate(dateStr);
  if (days === null) return <span className="text-slate-400">-</span>;
  if (days < 0) {
    return (
      <span className="text-red-700 font-bold inline-flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        {label ? `${label}: ` : ''}Expired ({formatDateDDMMYYYY(dateStr)})
      </span>
    );
  }
  if (days <= 15) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 font-extrabold">
        <AlertTriangle className="w-3 h-3 text-amber-700" />
        {label ? `${label}: ` : ''}15d Alert ({days}d)
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="text-amber-700 font-semibold">
        {label ? `${label}: ` : ''}Due in {days}d
      </span>
    );
  }
  return (
    <span className="text-emerald-700 inline-flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3" />
      {formatDateDDMMYYYY(dateStr)}
    </span>
  );
};

const MasterModuleInner: React.FC<MasterModuleProps> = ({
  ownerUid,
  readOnly = false,
  activeFy = 'FY 2026-27',
  parties,
  vehicles,
  drivers,
  invoices = [],
  consignments = [],
  lorryHires = [],
  transactions = [],
  company,
  initialTab = 'parties',
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [tab, setTab] = useState<MasterTabId>(initialTab);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [cleaningParties, setCleaningParties] = useState(false);

  const effectiveCompany: CompanySettings = useMemo(
    () =>
      company || {
        ...DEFAULT_COMPANY_SETTINGS,
        ownerUid,
      },
    [company, ownerUid]
  );

  // Top Picker selection states across all 5 tabs
  const [pickerPartyId, setPickerPartyId] = useState<string>('');
  const [pickerPartyText, setPickerPartyText] = useState<string>('');
  const [partyFilterMode, setPartyFilterMode] = useState<'customers' | 'all'>('customers');

  const [pickerOwnerId, setPickerOwnerId] = useState<string>('');
  const [pickerOwnerText, setPickerOwnerText] = useState<string>('');

  const [pickerBrokerId, setPickerBrokerId] = useState<string>('');
  const [pickerBrokerText, setPickerBrokerText] = useState<string>('');

  const [pickerVehicleId, setPickerVehicleId] = useState<string>('');
  const [pickerVehicleText, setPickerVehicleText] = useState<string>('');

  const [pickerDriverId, setPickerDriverId] = useState<string>('');
  const [pickerDriverText, setPickerDriverText] = useState<string>('');

  // General Party form + Inline Edit state
  const [editingPartyId, setEditingPartyId] = useState<string | null>(null);
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<Party['partyType']>('Customer');
  const [pAddr, setPAddr] = useState('');
  const [pPinCode, setPPinCode] = useState('');
  const [pCountry, setPCountry] = useState<SupportedCountry>('India');
  const [pGstin, setPGstin] = useState('');
  const [pPan, setPPan] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPreferredChannel, setPPreferredChannel] = useState<'WhatsApp Only' | 'Email Only' | 'Both'>('WhatsApp Only');
  const [pContactWarn, setPContactWarn] = useState<string | null>(null);
  const [pOpening, setPOpening] = useState('0');
  const [pBalType, setPBalType] = useState<'Dr' | 'Cr'>('Dr');

  const contactHealth = useMemo(() => scanPartiesForContactIssues(parties), [parties]);

  // Lorry Owner form + Inline Edit state
  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null);
  const [oName, setOName] = useState('');
  const [oPhone, setOPhone] = useState('');
  const [oAddr, setOAddr] = useState('');
  const [oPinCode, setOPinCode] = useState('');
  const [oCountry, setOCountry] = useState<SupportedCountry>('India');
  const [oAadhaar, setOAadhaar] = useState('');
  const [oPan, setOPan] = useState('');
  const [oGstin, setOGstin] = useState('');
  const [oBankName, setOBankName] = useState('');
  const [oBankAcc, setOBankAcc] = useState('');
  const [oBankIfsc, setOBankIfsc] = useState('');
  const [oOpening, setOOpening] = useState('0');

  // Broker form + Inline Edit state
  const [editingBrokerId, setEditingBrokerId] = useState<string | null>(null);
  const [bName, setBName] = useState('');
  const [bPhone, setBPhone] = useState('');
  const [bAddr, setBAddr] = useState('');
  const [bPinCode, setBPinCode] = useState('');
  const [bCountry, setBCountry] = useState<SupportedCountry>('India');
  const [bGstin, setBGstin] = useState('');
  const [bTradeLicense, setBTradeLicense] = useState('');
  const [bAadhaar, setBAadhaar] = useState('');
  const [bPan, setBPan] = useState('');
  const [bBankName, setBBankName] = useState('');
  const [bBankAcc, setBBankAcc] = useState('');
  const [bBankIfsc, setBBankIfsc] = useState('');
  const [bOpening, setBOpening] = useState('0');

  // Vehicle (Lorry Register) form + Inline Edit state
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [vTruck, setVTruck] = useState('');
  const [vMake, setVMake] = useState('');
  const [vBodyType, setVBodyType] = useState('');
  const [vColor, setVColor] = useState('');
  const [vType, setVType] = useState('22 FT Open Trailer');
  const [vOwner, setVOwner] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vEngine, setVEngine] = useState('');
  const [vChassis, setVChassis] = useState('');
  const [vFit, setVFit] = useState('');
  const [vIns, setVIns] = useState('');
  const [vPermit, setVPermit] = useState('');
  const [vRoadTax, setVRoadTax] = useState('');
  const [vPuc, setVPuc] = useState('');

  // Driver form + Inline Edit state
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [dName, setDName] = useState('');
  const [dDl, setDDl] = useState('');
  const [dExp, setDExp] = useState('');
  const [dPhone, setDPhone] = useState('');
  const [dAddr, setDAddr] = useState('');
  const [dPinCode, setDPinCode] = useState('');
  const [dCountry, setDCountry] = useState<SupportedCountry>('India');
  const [dAadhaar, setDAadhaar] = useState('');
  const [dPan, setDPan] = useState('');
  const [dBankName, setDBankName] = useState('');
  const [dBankAcc, setDBankAcc] = useState('');
  const [dBankIfsc, setDBankIfsc] = useState('');

  useAutoPinLookup(pAddr, pPinCode, pCountry, (pin, country) => {
    setPPinCode(pin);
    setPCountry(country);
  });
  useAutoPinLookup(oAddr, oPinCode, oCountry, (pin, country) => {
    setOPinCode(pin);
    setOCountry(country);
  });
  useAutoPinLookup(bAddr, bPinCode, bCountry, (pin, country) => {
    setBPinCode(pin);
    setBCountry(country);
  });
  useAutoPinLookup(dAddr, dPinCode, dCountry, (pin, country) => {
    setDPinCode(pin);
    setDCountry(country);
  });

  const ownersList = useMemo(
    () => parties.filter((p) => p.partyType === 'TruckOwner'),
    [parties]
  );

  const brokersList = useMemo(
    () => parties.filter((p) => p.partyType === 'Broker'),
    [parties]
  );

  const customerPartiesList = useMemo(
    () =>
      parties.filter(
        (p) =>
          isBillingCustomerType(p.partyType) &&
          !p.id.startsWith('dbf_brk_') &&
          !p.id.startsWith('brk_') &&
          !p.id.startsWith('dbf_own_') &&
          !p.id.startsWith('own_')
      ),
    [parties]
  );

  const partySeparationPreview = useMemo(
    () =>
      analyzeAndSeparateMisclassifiedParties({
        parties,
        drivers,
        lorryHires,
        invoices,
        consignments,
        extraOwnerNames: vehicles.map((v) => v.ownerName || '').filter(Boolean),
      }),
    [parties, drivers, lorryHires, invoices, consignments, vehicles]
  );

  const activePartyDirectory = useMemo(
    () => (partyFilterMode === 'customers' ? customerPartiesList : parties),
    [partyFilterMode, customerPartiesList, parties]
  );

  const filteredParties = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return activePartyDirectory;
    return activePartyDirectory.filter((p) =>
      `${p.name} ${p.partyType} ${p.gstin || ''} ${p.phone || ''} ${p.address || ''} ${p.tradeLicenseNo || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [activePartyDirectory, debouncedSearch]);

  const filteredOwners = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return ownersList;
    return ownersList.filter((o) =>
      `${o.name} ${o.phone || ''} ${o.pan || ''} ${o.aadhaarNo || ''} ${o.gstin || ''} ${o.bankAccountNo || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [ownersList, debouncedSearch]);

  const filteredBrokers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return brokersList;
    return brokersList.filter((b) =>
      `${b.name} ${b.phone || ''} ${b.gstin || ''} ${b.tradeLicenseNo || ''} ${b.pan || ''} ${b.aadhaarNo || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [brokersList, debouncedSearch]);

  const filteredVehicles = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      `${v.truckNo} ${v.ownerName} ${v.vehicleType || ''} ${v.ownerPhone || ''}`.toLowerCase().includes(q)
    );
  }, [vehicles, debouncedSearch]);

  const filteredDrivers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) =>
      `${d.name} ${d.dlNo} ${d.phone || ''} ${d.panNo || ''} ${d.aadhaarNo || ''}`.toLowerCase().includes(q)
    );
  }, [drivers, debouncedSearch]);

  const resetPartyForm = () => {
    setEditingPartyId(null);
    setPickerPartyId('');
    setPickerPartyText('');
    setPName('');
    setPType('Customer');
    setPAddr('');
    setPPinCode('');
    setPCountry('India');
    setPGstin('');
    setPPan('');
    setPPhone('');
    setPEmail('');
    setPPreferredChannel('WhatsApp Only');
    setPOpening('0');
    setPBalType('Dr');
    setPContactWarn(null);
  };

  const loadPartyForEdit = (p: Party) => {
    setEditingPartyId(p.id);
    setPickerPartyId(p.id);
    setPickerPartyText(p.name);
    setPName(p.name || '');
    setPType(p.partyType || 'Customer');
    setPAddr(p.address || '');
    setPPinCode(p.pinCode || '');
    setPCountry((p.country as SupportedCountry) || 'India');
    setPGstin(p.gstin || '');
    setPPan(p.pan || '');
    setPPhone(p.phone || '');
    setPEmail(p.email || '');
    setPPreferredChannel(
      (p.preferredChannel as 'WhatsApp Only' | 'Email Only' | 'Both') || 'WhatsApp Only'
    );
    setPOpening(String(p.openingBalance ?? 0));
    setPBalType(p.balanceType || 'Dr');
    setPContactWarn(null);
  };

  const resetOwnerForm = () => {
    setEditingOwnerId(null);
    setPickerOwnerId('');
    setPickerOwnerText('');
    setOName('');
    setOPhone('');
    setOAddr('');
    setOPinCode('');
    setOCountry('India');
    setOAadhaar('');
    setOPan('');
    setOGstin('');
    setOBankName('');
    setOBankAcc('');
    setOBankIfsc('');
    setOOpening('0');
  };

  const loadOwnerForEdit = (o: Party) => {
    setEditingOwnerId(o.id);
    setPickerOwnerId(o.id);
    setPickerOwnerText(o.name);
    setOName(o.name || '');
    setOPhone(o.phone || '');
    setOAddr(o.address || '');
    setOPinCode(o.pinCode || '');
    setOCountry((o.country as SupportedCountry) || 'India');
    setOAadhaar(o.aadhaarNo || '');
    setOPan(o.pan || '');
    setOGstin(o.gstin || '');
    setOBankName(o.bankName || '');
    setOBankAcc(o.bankAccountNo || '');
    setOBankIfsc(o.bankIfsc || '');
    setOOpening(String(o.openingBalance ?? 0));
  };

  const resetBrokerForm = () => {
    setEditingBrokerId(null);
    setPickerBrokerId('');
    setPickerBrokerText('');
    setBName('');
    setBPhone('');
    setBAddr('');
    setBPinCode('');
    setBCountry('India');
    setBGstin('');
    setBTradeLicense('');
    setBAadhaar('');
    setBPan('');
    setBBankName('');
    setBBankAcc('');
    setBBankIfsc('');
    setBOpening('0');
  };

  const loadBrokerForEdit = (b: Party) => {
    setEditingBrokerId(b.id);
    setPickerBrokerId(b.id);
    setPickerBrokerText(b.name);
    setBName(b.name || '');
    setBPhone(b.phone || '');
    setBAddr(b.address || '');
    setBPinCode(b.pinCode || '');
    setBCountry((b.country as SupportedCountry) || 'India');
    setBGstin(b.gstin || '');
    setBTradeLicense(b.tradeLicenseNo || '');
    setBAadhaar(b.aadhaarNo || '');
    setBPan(b.pan || '');
    setBBankName(b.bankName || '');
    setBBankAcc(b.bankAccountNo || '');
    setBBankIfsc(b.bankIfsc || '');
    setBOpening(String(b.openingBalance ?? 0));
  };

  const resetVehicleForm = () => {
    setEditingVehicleId(null);
    setPickerVehicleId('');
    setPickerVehicleText('');
    setVTruck('');
    setVMake('');
    setVBodyType('');
    setVColor('');
    setVType('22 FT Open Trailer');
    setVOwner('');
    setVPhone('');
    setVEngine('');
    setVChassis('');
    setVFit('');
    setVIns('');
    setVPermit('');
    setVRoadTax('');
    setVPuc('');
  };

  const loadVehicleForEdit = (v: Vehicle) => {
    setEditingVehicleId(v.id);
    setPickerVehicleId(v.id);
    setPickerVehicleText(v.truckNo);
    setVTruck(v.truckNo || '');
    setVMake(v.vehicleMake || '');
    setVBodyType(v.bodyType || '');
    setVColor(v.vehicleColor || '');
    setVType(v.vehicleType || v.bodyType || '22 FT Open Trailer');
    setVOwner(v.ownerName || '');
    setVPhone(v.ownerPhone || '');
    setVEngine(v.engineNo || '');
    setVChassis(v.chassisNo || '');
    setVFit(v.fitnessExpiry || '');
    setVIns(v.insuranceExpiry || '');
    setVPermit(v.permitExpiry || '');
    setVRoadTax(v.roadTaxExpiry || '');
    setVPuc(v.pucExpiry || '');
  };

  const resetDriverForm = () => {
    setEditingDriverId(null);
    setPickerDriverId('');
    setPickerDriverText('');
    setDName('');
    setDDl('');
    setDExp('');
    setDPhone('');
    setDAddr('');
    setDPinCode('');
    setDCountry('India');
    setDAadhaar('');
    setDPan('');
    setDBankName('');
    setDBankAcc('');
    setDBankIfsc('');
  };

  const loadDriverForEdit = (d: Driver) => {
    setEditingDriverId(d.id);
    setPickerDriverId(d.id);
    setPickerDriverText(d.name);
    setDName(d.name || '');
    setDDl(d.dlNo || '');
    setDExp(d.dlExpiry || '');
    setDPhone(d.phone || '');
    setDAddr(d.address || '');
    setDPinCode(d.pinCode || '');
    setDCountry((d.country as SupportedCountry) || 'India');
    setDAadhaar(d.aadhaarNo || '');
    setDPan(d.panNo || '');
    setDBankName(d.bankName || '');
    setDBankAcc(d.bankAccountNo || '');
    setDBankIfsc(d.bankIfsc || '');
  };

  const handleSeparatePartiesInline = async () => {
    setCleaningParties(true);
    setStatusMsg(null);
    try {
      const analysis = partySeparationPreview;
      if (analysis.updatedParties.length === 0 && analysis.duplicatePartyIds.length === 0) {
        setStatusMsg('All Brokers, Lorry Owners & Drivers are already cleanly separated from Billing Customers.');
        return;
      }
      if (analysis.updatedParties.length > 0) {
        await bulkUpsertDocuments(
          'parties',
          analysis.updatedParties as unknown as Array<Record<string, unknown>>
        );
      }
      for (const dupId of analysis.duplicatePartyIds) {
        await removeDocument('parties', dupId);
      }
      playVerifiedBeep();
      setStatusMsg(
        `Separated ${analysis.brokersSeparated} Broker(s), ${analysis.ownersSeparated} Owner(s), ${analysis.driversSeparated} Driver(s) out of Customers & Ledgers (${analysis.duplicatesMerged} merged).`
      );
    } finally {
      setCleaningParties(false);
    }
  };

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim() || readOnly) return;
    const guard = validateAndNormalizeContact({
      phone: pPhone,
      email: pEmail,
      gstin: pGstin,
      pan: pPan,
    });
    if (!guard.isClean) {
      playAlertBeep();
      setPContactWarn(guard.warnings.join(' · '));
      return;
    }
    setPContactWarn(null);
    const op = Number(pOpening) || 0;
    const targetId = editingPartyId || makeSafeDocId('party');
    const isNew = !editingPartyId;
    await upsertDocument(
      'parties',
      targetId,
      {
        name: pName.trim(),
        partyType: pType,
        address: pAddr.trim(),
        pinCode: pPinCode.trim(),
        country: pCountry,
        gstin: guard.normalizedGstin,
        pan: guard.normalizedPan,
        phone: guard.normalizedPhone,
        email: guard.normalizedEmail,
        preferredChannel: pPreferredChannel,
        openingBalance: op,
        currentBalance: op,
        balanceType: pBalType,
        ownerUid,
      },
      isNew
    );
    playVerifiedBeep();
    setStatusMsg(`${isNew ? 'Added' : 'Updated'} Party "${pName.trim()}" cleanly.`);
    resetPartyForm();
  };

  const handleSaveOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oName.trim() || readOnly) return;
    if (oGstin.trim()) {
      const gstCheck = validateIndianGstin(oGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        setStatusMsg(`Blocked Save: Lorry Owner GSTIN invalid — ${gstCheck.error}`);
        return;
      }
    }
    const op = Number(oOpening) || 0;
    const targetId = editingOwnerId || makeSafeDocId('own');
    const isNew = !editingOwnerId;
    await upsertDocument(
      'parties',
      targetId,
      {
        name: oName.trim(),
        partyType: 'TruckOwner',
        phone: oPhone.trim(),
        address: oAddr.trim(),
        pinCode: oPinCode.trim(),
        country: oCountry,
        aadhaarNo: oAadhaar.trim(),
        pan: oPan.trim().toUpperCase(),
        gstin: oGstin.trim().toUpperCase(),
        bankName: oBankName.trim(),
        bankAccountNo: oBankAcc.trim(),
        bankIfsc: oBankIfsc.trim().toUpperCase(),
        email: '',
        openingBalance: op,
        currentBalance: op,
        balanceType: 'Cr',
        ownerUid,
      },
      isNew
    );
    playVerifiedBeep();
    setStatusMsg(`${isNew ? 'Added' : 'Updated'} Lorry Owner "${oName.trim()}".`);
    resetOwnerForm();
  };

  const handleSaveBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bName.trim() || readOnly) return;
    if (bGstin.trim()) {
      const gstCheck = validateIndianGstin(bGstin);
      if (!gstCheck.valid) {
        playAlertBeep();
        setStatusMsg(`Blocked Save: Broker GSTIN invalid — ${gstCheck.error}`);
        return;
      }
    }
    const op = Number(bOpening) || 0;
    const targetId = editingBrokerId || makeSafeDocId('brk');
    const isNew = !editingBrokerId;
    await upsertDocument(
      'parties',
      targetId,
      {
        name: bName.trim(),
        partyType: 'Broker',
        phone: bPhone.trim(),
        address: bAddr.trim(),
        pinCode: bPinCode.trim(),
        country: bCountry,
        gstin: bGstin.trim().toUpperCase(),
        tradeLicenseNo: bTradeLicense.trim().toUpperCase(),
        aadhaarNo: bAadhaar.trim(),
        pan: bPan.trim().toUpperCase(),
        bankName: bBankName.trim(),
        bankAccountNo: bBankAcc.trim(),
        bankIfsc: bBankIfsc.trim().toUpperCase(),
        email: '',
        openingBalance: op,
        currentBalance: op,
        balanceType: 'Cr',
        ownerUid,
      },
      isNew
    );
    playVerifiedBeep();
    setStatusMsg(`${isNew ? 'Added' : 'Updated'} Broker "${bName.trim()}".`);
    resetBrokerForm();
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vTruck.trim() || !vOwner.trim() || readOnly) return;
    const targetId = editingVehicleId || makeSafeDocId('veh');
    const isNew = !editingVehicleId;
    await upsertDocument(
      'vehicles',
      targetId,
      {
        truckNo: vTruck.trim().toUpperCase(),
        vehicleMake: vMake.trim(),
        bodyType: vBodyType.trim(),
        vehicleColor: vColor.trim(),
        vehicleType: vType.trim() || vBodyType.trim(),
        ownerName: vOwner.trim(),
        ownerPhone: vPhone.trim(),
        engineNo: vEngine.trim(),
        chassisNo: vChassis.trim(),
        fitnessExpiry: vFit,
        insuranceExpiry: vIns,
        permitExpiry: vPermit,
        roadTaxExpiry: vRoadTax,
        pucExpiry: vPuc,
        ownerUid,
      },
      isNew
    );
    playVerifiedBeep();
    setStatusMsg(`${isNew ? 'Added' : 'Updated'} Vehicle "${vTruck.trim().toUpperCase()}".`);
    resetVehicleForm();
  };

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dName.trim() || !dDl.trim() || !dExp || readOnly) return;
    const targetId = editingDriverId || makeSafeDocId('drv');
    const isNew = !editingDriverId;
    await upsertDocument(
      'drivers',
      targetId,
      {
        name: dName.trim(),
        dlNo: dDl.trim().toUpperCase(),
        dlExpiry: dExp,
        phone: dPhone.trim(),
        address: dAddr.trim(),
        pinCode: dPinCode.trim(),
        country: dCountry,
        aadhaarNo: dAadhaar.trim(),
        panNo: dPan.trim().toUpperCase(),
        bankName: dBankName.trim(),
        bankAccountNo: dBankAcc.trim(),
        bankIfsc: dBankIfsc.trim().toUpperCase(),
        ownerUid,
      },
      isNew
    );
    playVerifiedBeep();
    setStatusMsg(`${isNew ? 'Added' : 'Updated'} Driver "${dName.trim()}".`);
    resetDriverForm();
  };

  // ---- PDF GENERATION FOR DRIVER / OWNER / BROKER / LORRY REGISTER SHEETS ----
  const buildSheetPdf = async (
    sheetKind: 'drivers' | 'owners' | 'brokers' | 'vehicles',
    singleProfileId?: string
  ): Promise<GeneratedPdfResult> => {
    if (sheetKind === 'drivers') {
      const list = singleProfileId
        ? filteredDrivers.filter((d) => d.id === singleProfileId)
        : filteredDrivers;
      const single = singleProfileId ? list[0] : undefined;
      return generateFoxproStatementPDF(
        {
          title: single
            ? 'D-R-I-V-E-R   P-R-O-F-I-L-E   /   K-Y-C   S-H-E-E-T'
            : 'D-R-I-V-E-R   R-E-G-I-S-T-E-R   S-H-E-E-T',
          subtitle: `As of ${formatDateDDMMYYYY(todayISO())} · Total Drivers: ${list.length}`,
          fileName: single
            ? `Driver_Profile_${single.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
            : `Driver_Register_${todayISO()}.pdf`,
          orientation: 'l',
          ...(single
            ? {
                summaryLines: [
                  { label: 'Driver Name', value: single.name },
                  { label: 'D/L Number', value: single.dlNo },
                  { label: 'D/L Expiry', value: formatDateDDMMYYYY(single.dlExpiry) },
                  { label: 'Phone', value: single.phone || '-' },
                  { label: 'Aadhaar No', value: single.aadhaarNo || '-' },
                  { label: 'PAN No', value: single.panNo || '-' },
                ],
              }
            : {}),
          columns: [
            { label: 'S.NO', widthPct: 6, align: 'center' },
            { label: 'DRIVER NAME / PHONE', widthPct: 24, align: 'left' },
            { label: 'D/L NO / EXPIRY', widthPct: 20, align: 'left' },
            { label: 'AADHAAR / PAN', widthPct: 20, align: 'left' },
            { label: 'BANK ACCOUNT / IFSC', widthPct: 30, align: 'left' },
          ],
          rows: list.map((d, idx) => ({
            line1: [
              String(idx + 1),
              d.name,
              d.dlNo,
              `UID: ${d.aadhaarNo || '-'}`,
              `${d.bankName || '-'} · A/c: ${d.bankAccountNo || '-'}`,
            ],
            line2: [
              '',
              `Ph: ${d.phone || '-'} · ${d.address || ''}`,
              `Exp: ${formatDateDDMMYYYY(d.dlExpiry)}`,
              `PAN: ${d.panNo || '-'}`,
              `IFSC: ${d.bankIfsc || '-'}`,
            ],
          })),
        },
        effectiveCompany,
        'l'
      );
    }

    if (sheetKind === 'owners') {
      const list = singleProfileId
        ? filteredOwners.filter((o) => o.id === singleProfileId)
        : filteredOwners;
      const single = singleProfileId ? list[0] : undefined;
      return generateFoxproStatementPDF(
        {
          title: single
            ? 'L-O-R-R-Y   O-W-N-E-R   P-R-O-F-I-L-E   S-H-E-E-T'
            : 'L-O-R-R-Y   O-W-N-E-R   R-E-G-I-S-T-E-R   S-H-E-E-T',
          subtitle: `As of ${formatDateDDMMYYYY(todayISO())} · Total Lorry Owners: ${list.length}`,
          fileName: single
            ? `Owner_Profile_${single.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
            : `Lorry_Owner_Register_${todayISO()}.pdf`,
          orientation: 'l',
          ...(single
            ? {
                summaryLines: [
                  { label: 'Owner Name', value: single.name },
                  { label: 'Phone', value: single.phone || '-' },
                  { label: 'GSTIN', value: single.gstin || '-' },
                  { label: 'Aadhaar No', value: single.aadhaarNo || '-' },
                  { label: 'PAN No', value: single.pan || '-' },
                  { label: 'Bank Account', value: `${single.bankName || '-'} · ${single.bankAccountNo || '-'}` },
                ],
              }
            : {}),
          columns: [
            { label: 'S.NO', widthPct: 6, align: 'center' },
            { label: 'OWNER NAME / PHONE', widthPct: 24, align: 'left' },
            { label: 'ADDRESS / GSTIN', widthPct: 24, align: 'left' },
            { label: 'AADHAAR / PAN', widthPct: 18, align: 'left' },
            { label: 'BANK ACCOUNT / IFSC', widthPct: 28, align: 'left' },
          ],
          rows: list.map((o, idx) => ({
            line1: [
              String(idx + 1),
              o.name,
              o.address || '-',
              `UID: ${o.aadhaarNo || '-'}`,
              `${o.bankName || '-'} · A/c: ${o.bankAccountNo || '-'}`,
            ],
            line2: [
              '',
              `Ph: ${o.phone || '-'}`,
              `GSTIN: ${o.gstin || '-'}`,
              `PAN: ${o.pan || '-'}`,
              `IFSC: ${o.bankIfsc || '-'}`,
            ],
          })),
        },
        effectiveCompany,
        'l'
      );
    }

    if (sheetKind === 'brokers') {
      const list = singleProfileId
        ? filteredBrokers.filter((b) => b.id === singleProfileId)
        : filteredBrokers;
      const single = singleProfileId ? list[0] : undefined;
      return generateFoxproStatementPDF(
        {
          title: single
            ? 'B-R-O-K-E-R   P-R-O-F-I-L-E   /   K-Y-C   S-H-E-E-T'
            : 'B-R-O-K-E-R   R-E-G-I-S-T-E-R   S-H-E-E-T',
          subtitle: `As of ${formatDateDDMMYYYY(todayISO())} · Total Brokers: ${list.length}`,
          fileName: single
            ? `Broker_Profile_${single.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
            : `Broker_Register_${todayISO()}.pdf`,
          orientation: 'l',
          ...(single
            ? {
                summaryLines: [
                  { label: 'Broker Name', value: single.name },
                  { label: 'Phone', value: single.phone || '-' },
                  { label: 'GST Number', value: single.gstin || '-' },
                  { label: 'Trade License', value: single.tradeLicenseNo || '-' },
                  { label: 'Aadhaar / PAN', value: `${single.aadhaarNo || '-'} / ${single.pan || '-'}` },
                  { label: 'Bank Account', value: `${single.bankName || '-'} · ${single.bankAccountNo || '-'} (${single.bankIfsc || '-'})` },
                ],
              }
            : {}),
          columns: [
            { label: 'S.NO', widthPct: 6, align: 'center' },
            { label: 'BROKER NAME / PHONE', widthPct: 22, align: 'left' },
            { label: 'GST NO / TRADE LICENSE', widthPct: 24, align: 'left' },
            { label: 'AADHAAR / PAN NO', widthPct: 20, align: 'left' },
            { label: 'BANK ACCOUNT / IFSC', widthPct: 28, align: 'left' },
          ],
          rows: list.map((b, idx) => ({
            line1: [
              String(idx + 1),
              b.name,
              `GST: ${b.gstin || '-'}`,
              `UID: ${b.aadhaarNo || '-'}`,
              `${b.bankName || '-'} · A/c: ${b.bankAccountNo || '-'}`,
            ],
            line2: [
              '',
              `Ph: ${b.phone || '-'} · ${b.address || ''}`,
              `TL: ${b.tradeLicenseNo || '-'}`,
              `PAN: ${b.pan || '-'}`,
              `IFSC: ${b.bankIfsc || '-'}`,
            ],
          })),
        },
        effectiveCompany,
        'l'
      );
    }

    // Lorry Register (Vehicles)
    const list = singleProfileId
      ? filteredVehicles.filter((v) => v.id === singleProfileId)
      : filteredVehicles;
    const single = singleProfileId ? list[0] : undefined;
    return generateFoxproStatementPDF(
      {
        title: single
          ? 'L-O-R-R-Y   P-R-O-F-I-L-E   S-H-E-E-T'
          : 'L-O-R-R-Y   R-E-G-I-S-T-E-R   S-H-E-E-T',
        subtitle: `As of ${formatDateDDMMYYYY(todayISO())} · Total Registered Lorries: ${list.length}`,
        fileName: single
          ? `Lorry_Profile_${single.truckNo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
          : `Lorry_Register_${todayISO()}.pdf`,
        orientation: 'l',
        ...(single
          ? {
              summaryLines: [
                { label: 'Truck No', value: single.truckNo },
                { label: 'Owner Name', value: single.ownerName },
                { label: 'Vehicle Type', value: single.vehicleType || '-' },
                { label: 'Owner Phone', value: single.ownerPhone || '-' },
                { label: 'Engine No', value: single.engineNo || '-' },
                { label: 'Chassis No', value: single.chassisNo || '-' },
              ],
            }
          : {}),
        columns: [
          { label: 'S.NO', widthPct: 6, align: 'center' },
          { label: 'TRUCK NO / TYPE', widthPct: 22, align: 'left' },
          { label: 'OWNER NAME / PHONE', widthPct: 24, align: 'left' },
          { label: 'ENGINE / CHASSIS NO', widthPct: 20, align: 'left' },
          { label: 'FITNESS / INS / PERMIT / TAX / PUC', widthPct: 28, align: 'left' },
        ],
        rows: list.map((v, idx) => ({
          line1: [
            String(idx + 1),
            `${v.truckNo}${v.vehicleMake ? ` (${v.vehicleMake})` : ''}`,
            v.ownerName,
            `Eng: ${v.engineNo || '-'}`,
            `Fit: ${formatDateDDMMYYYY(v.fitnessExpiry) || '-'} | Ins: ${formatDateDDMMYYYY(v.insuranceExpiry) || '-'}`,
          ],
          line2: [
            '',
            [v.bodyType || v.vehicleType || '-', v.vehicleColor || ''].filter(Boolean).join(' · '),
            `Ph: ${v.ownerPhone || '-'}`,
            `Chs: ${v.chassisNo || '-'}`,
            `Prm: ${formatDateDDMMYYYY(v.permitExpiry) || '-'} | Tax: ${formatDateDDMMYYYY(v.roadTaxExpiry) || '-'} | PUC: ${formatDateDDMMYYYY(v.pucExpiry) || '-'}`,
          ],
        })),
      },
      effectiveCompany,
      'l'
    );
  };

  const handleQuickSwitchPartyRole = async (
    party: Party,
    targetType: 'Customer' | 'Broker' | 'TruckOwner'
  ) => {
    if (readOnly || party.partyType === targetType) return;
    await upsertDocument(
      'parties',
      party.id,
      {
        partyType: targetType,
        balanceType: targetType === 'Customer' ? 'Dr' : 'Cr',
      },
      false
    );
    const label =
      targetType === 'Customer'
        ? 'Billing Customer'
        : targetType === 'Broker'
          ? 'Broker'
          : 'Lorry Owner';
    setStatusMsg(`Moved "${party.name}" to ${label}.`);
  };

  const selectedPartyObj = useMemo(
    () => parties.find((p) => p.id === pickerPartyId) || null,
    [parties, pickerPartyId]
  );

  const selectedPartyLedgerData = useMemo(() => {
    if (!selectedPartyObj) return null;
    const fyOpenings = effectiveCompany.fyOpeningBalances?.[normalizeFyLabel(activeFy)] || {};
    const targetKey = selectedPartyObj.name.trim().toLowerCase();
    const cf = fyOpenings[selectedPartyObj.name] || fyOpenings[selectedPartyObj.id];
    const obAmt = cf ? Number(cf.amount || 0) : Number(selectedPartyObj.openingBalance || 0);
    const obType = cf ? cf.balanceType : selectedPartyObj.balanceType || 'Dr';

    const rows: Array<{
      date: string;
      voucherNo: string;
      type: string;
      narration: string;
      debit: number;
      credit: number;
    }> = [];

    if (obAmt > 0) {
      rows.push({
        date: '',
        voucherNo: 'OPENING',
        type: 'Opening',
        narration: `Opening Balance (${activeFy})`,
        debit: obType === 'Dr' ? obAmt : 0,
        credit: obType === 'Cr' ? obAmt : 0,
      });
    }

    invoices
      .filter((inv) => (inv.partyName || '').trim().toLowerCase() === targetKey)
      .forEach((inv) => {
        const total = Number(inv.grandTotal || 0);
        const isCreditNote = inv.docKind === 'Credit Note';
        rows.push({
          date: inv.invoiceDate || '',
          voucherNo: inv.invoiceNo,
          type: inv.docKind || 'Tax Invoice',
          narration: `Bill ${inv.invoiceNo} · ${(inv.consignmentRows || []).map((r) => r.cnNo).filter(Boolean).join(', ') || 'Freight Billing'}`,
          debit: isCreditNote ? 0 : total,
          credit: isCreditNote ? total : 0,
        });
        if (Number(inv.paidAmount || 0) > 0) {
          rows.push({
            date: inv.invoiceDate || '',
            voucherNo: `RCPT-${inv.invoiceNo}`,
            type: 'Receipt',
            narration: `Payment received against ${inv.invoiceNo} (${inv.fullPaymentMode || inv.advanceMode || 'Bank'})`,
            debit: 0,
            credit: Number(inv.paidAmount || 0),
          });
        }
      });

    transactions
      .filter((tx) => (tx.partyName || '').trim().toLowerCase() === targetKey && !tx.linkedInvoiceNo)
      .forEach((tx) => {
        rows.push({
          date: tx.txDate || '',
          voucherNo: tx.txCode || '-',
          type:
            tx.ledgerAccount === 'Party Ledger Receivable (Dr)'
              ? 'Debit (TRN)'
              : tx.ledgerAccount === 'Party Ledger Receipt (Cr)'
                ? 'Credit (TRN)'
                : tx.txType,
          narration: tx.narration || tx.ledgerAccount || tx.txType,
          debit: tx.txType === 'Expense' ? Number(tx.amount || 0) : 0,
          credit: tx.txType === 'Income' ? Number(tx.amount || 0) : 0,
        });
      });

    lorryHires
      .filter(
        (lh) =>
          (lh.ownerName || '').trim().toLowerCase() === targetKey ||
          (lh.brokerName || '').trim().toLowerCase() === targetKey
      )
      .forEach((lh) => {
        rows.push({
          date: lh.cnDate || '',
          voucherNo: `CH-${lh.cnNo}`,
          type: 'Lorry Hire',
          narration: `Lorry ${lh.truckNo} (${lh.fromCity || '-'} -> ${lh.toCity || '-'})`,
          debit: Number(lh.advancePaid || 0) + (lh.balancePaid ? Number(lh.balancePayable || 0) : 0),
          credit: Number(lh.hireAmount || 0),
        });
      });

    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let runDr = 0;
    let runCr = 0;
    const enriched = rows.map((r) => {
      runDr += r.debit;
      runCr += r.credit;
      return {
        ...r,
        balance: Math.abs(runDr - runCr),
        side: runDr >= runCr ? ('Dr' as const) : ('Cr' as const),
      };
    });
    return {
      openingAmt: Math.round(obAmt * 100) / 100,
      openingSide: obType,
      rows: enriched,
      totalDr: Math.round(runDr * 100) / 100,
      totalCr: Math.round(runCr * 100) / 100,
      closing: Math.round(Math.abs(runDr - runCr) * 100) / 100,
      side: runDr >= runCr ? ('Dr' as const) : ('Cr' as const),
    };
  }, [selectedPartyObj, effectiveCompany.fyOpeningBalances, activeFy, invoices, transactions, lorryHires]);

  const handlePrintSelectedPartyLedger = async (action: 'preview' | 'print' | 'download') => {
    if (!selectedPartyObj || !selectedPartyLedgerData) return;
    const pdf = await generateFoxproStatementPDF(
      {
        title: `T-A-L-L-Y   P-A-R-T-Y   L-E-D-G-E-R   :   ${selectedPartyObj.name.toUpperCase()}`,
        subtitle: `${selectedPartyObj.partyType} · GSTIN: ${selectedPartyObj.gstin || 'Unregd'} · Ph: ${selectedPartyObj.phone || '-'} · FY: ${activeFy}`,
        fileName: `Party_Ledger_${selectedPartyObj.name.replace(/[^a-zA-Z0-9]/g, '_')}_${activeFy.replace(/\s+/g, '_')}.pdf`,
        orientation: 'l',
        summaryLines: [
          { label: 'Party Name', value: selectedPartyObj.name },
          { label: 'Total Debit (₹)', value: formatINR(selectedPartyLedgerData.totalDr) },
          { label: 'Total Credit (₹)', value: formatINR(selectedPartyLedgerData.totalCr) },
          {
            label: 'Closing Balance',
            value: `Rs. ${formatINR(selectedPartyLedgerData.closing)} ${selectedPartyLedgerData.side}`,
          },
        ],
        columns: [
          { label: 'DATE', widthPct: 12, align: 'left' },
          { label: 'VOUCHER NO / TYPE', widthPct: 18, align: 'left' },
          { label: 'PARTICULARS / NARRATION', widthPct: 34, align: 'left' },
          { label: 'DEBIT (DR)', widthPct: 12, align: 'right' },
          { label: 'CREDIT (CR)', widthPct: 12, align: 'right' },
          { label: 'BALANCE', widthPct: 12, align: 'right' },
        ],
        rows: selectedPartyLedgerData.rows.map((r) => ({
          line1: [
            r.date ? formatDateDDMMYYYY(r.date) : 'Opening',
            `${r.voucherNo} (${r.type})`,
            r.narration,
            r.debit > 0 ? formatINR(r.debit) : '-',
            r.credit > 0 ? formatINR(r.credit) : '-',
            `${formatINR(r.balance)} ${r.side}`,
          ],
        })),
        totalsLabel: 'CLOSING BALANCE :',
        totalsLine1: [
          '',
          '',
          '',
          formatINR(selectedPartyLedgerData.totalDr),
          formatINR(selectedPartyLedgerData.totalCr),
          `${formatINR(selectedPartyLedgerData.closing)} ${selectedPartyLedgerData.side}`,
        ],
        totalAmountForWords: selectedPartyLedgerData.closing,
      },
      effectiveCompany,
      'l'
    );
    if (action === 'preview' && onPreviewPdf) onPreviewPdf(pdf, 'Reports_Ledgers');
    else if (action === 'print') printPdfDirect(pdf);
    else downloadPdfDirect(pdf);
  };

  const handleSheetAction = async (
    sheetKind: 'drivers' | 'owners' | 'brokers' | 'vehicles',
    action: 'preview' | 'print' | 'download',
    singleProfileId?: string
  ) => {
    const pdf = await buildSheetPdf(sheetKind, singleProfileId);
    if (action === 'preview' && onPreviewPdf) {
      onPreviewPdf(pdf, 'Reports_Ledgers');
    } else if (action === 'print') {
      printPdfDirect(pdf);
    } else {
      downloadPdfDirect(pdf);
    }
  };

  const renderTopRightSheetButtons = (sheetKind: 'drivers' | 'owners' | 'brokers' | 'vehicles') => (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => void handleSheetAction(sheetKind, 'preview')}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
      >
        <Eye className="w-3.5 h-3.5" />
        Print Preview
      </button>
      <button
        type="button"
        onClick={() => void handleSheetAction(sheetKind, 'print')}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
      >
        <Printer className="w-3.5 h-3.5" />
        Print Out
      </button>
      <button
        type="button"
        onClick={() => void handleSheetAction(sheetKind, 'download')}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        Download PDF
      </button>
    </div>
  );

  const partyColumns = useMemo<Array<TableColumn<Party>>>(
    () => [
      { key: 'name', header: 'Party Name', cellClassName: 'font-semibold', render: (p) => p.name },
      { key: 'partyType', header: 'Type', render: (p) => p.partyType },
      { key: 'gstin', header: 'GSTIN', cellClassName: 'font-mono-num', render: (p) => p.gstin || '-' },
      { key: 'phone', header: 'Phone', cellClassName: 'font-mono-num', render: (p) => p.phone || '-' },
      {
        key: 'currentBalance',
        header: 'Current Balance (₹)',
        align: 'right',
        cellClassName: 'font-mono-num font-bold',
        render: (p) => `${formatINR(p.currentBalance)} ${p.balanceType}`,
      },
      {
        key: 'action',
        header: 'Action & Role Switch',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (p) =>
          readOnly ? (
            <span className="text-[10px] font-bold text-slate-400">View</span>
          ) : (
            <div className="inline-flex flex-wrap items-center justify-end gap-1">
              <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(p, 'Customer')}
                  disabled={p.partyType === 'Customer'}
                  title="Switch to Customer / Billing Party"
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    p.partyType === 'Customer'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 hover:bg-emerald-100'
                  }`}
                >
                  ⇄ Customer
                </button>
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(p, 'Broker')}
                  disabled={p.partyType === 'Broker'}
                  title="Switch to Broker"
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    p.partyType === 'Broker'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 hover:bg-indigo-100'
                  }`}
                >
                  Broker
                </button>
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(p, 'TruckOwner')}
                  disabled={p.partyType === 'TruckOwner'}
                  title="Switch to Lorry Owner"
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    p.partyType === 'TruckOwner'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-700 hover:bg-amber-100'
                  }`}
                >
                  Owner
                </button>
              </span>
              <button
                type="button"
                onClick={() => loadPartyForEdit(p)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold cursor-pointer"
                title="Edit Party"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
              <button
                type="button"
                onClick={() =>
                  onShowConfirm({
                    title: `Delete Party ${p.name}?`,
                    description: `Remove ${p.name} from Master Directory?`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                    onConfirm: () => removeDocument('parties', p.id),
                  })
                }
                className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onShowConfirm, readOnly]
  );

  const ownerColumns = useMemo<Array<TableColumn<Party>>>(
    () => [
      { key: 'name', header: 'Lorry Owner Name', cellClassName: 'font-bold text-blue-900', render: (o) => o.name },
      { key: 'phone', header: 'Phone', cellClassName: 'font-mono-num', render: (o) => o.phone || '-' },
      {
        key: 'kyc',
        header: 'Aadhaar / PAN / GSTIN',
        cellClassName: 'font-mono-num text-[11px]',
        render: (o) => (
          <div>
            <div>UID: {o.aadhaarNo || '-'}</div>
            <div className="text-slate-500">PAN: {o.pan || '-'} · GST: {o.gstin || '-'}</div>
          </div>
        ),
      },
      {
        key: 'bank',
        header: 'Bank Account',
        cellClassName: 'text-[11px]',
        render: (o) => (
          <div>
            <div className="font-semibold">{o.bankName || '-'}</div>
            <div className="font-mono-num text-slate-500">
              A/c: {o.bankAccountNo || '-'} · {o.bankIfsc || '-'}
            </div>
          </div>
        ),
      },
      {
        key: 'action',
        header: 'Profile & Role Switch',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (o) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1">
            {!readOnly && (
              <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(o, 'Customer')}
                  className="px-1.5 py-0.5 rounded text-slate-700 hover:bg-emerald-100 cursor-pointer"
                >
                  ⇄ Customer
                </button>
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(o, 'Broker')}
                  className="px-1.5 py-0.5 rounded text-slate-700 hover:bg-indigo-100 cursor-pointer"
                >
                  Broker
                </button>
                <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white">Owner</span>
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => loadOwnerForEdit(o)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold cursor-pointer"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSheetAction('owners', onPreviewPdf ? 'preview' : 'download', o.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-bold cursor-pointer"
            >
              <Printer className="w-3 h-3" />
              Profile PDF
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() =>
                  onShowConfirm({
                    title: `Delete Lorry Owner ${o.name}?`,
                    description: `Remove ${o.name} from Lorry Owner Master?`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                    onConfirm: () => removeDocument('parties', o.id),
                  })
                }
                className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onShowConfirm, onPreviewPdf, readOnly]
  );

  const brokerColumns = useMemo<Array<TableColumn<Party>>>(
    () => [
      { key: 'name', header: 'Broker Name', cellClassName: 'font-bold text-blue-900', render: (b) => b.name },
      { key: 'phone', header: 'Phone', cellClassName: 'font-mono-num', render: (b) => b.phone || '-' },
      {
        key: 'gstTrade',
        header: 'GST No & Trade License',
        cellClassName: 'font-mono-num text-[11px]',
        render: (b) => (
          <div>
            <div className="font-bold text-slate-800">GST: {b.gstin || '-'}</div>
            <div className="text-slate-600">Trade Lic: {b.tradeLicenseNo || '-'}</div>
          </div>
        ),
      },
      {
        key: 'kyc',
        header: 'Aadhaar & PAN',
        cellClassName: 'font-mono-num text-[11px]',
        render: (b) => (
          <div>
            <div>UID: {b.aadhaarNo || '-'}</div>
            <div className="text-slate-500">PAN: {b.pan || '-'}</div>
          </div>
        ),
      },
      {
        key: 'bank',
        header: 'Bank Account',
        cellClassName: 'text-[11px]',
        render: (b) => (
          <div>
            <div className="font-semibold">{b.bankName || '-'}</div>
            <div className="font-mono-num text-slate-500">
              A/c: {b.bankAccountNo || '-'} · {b.bankIfsc || '-'}
            </div>
          </div>
        ),
      },
      {
        key: 'action',
        header: 'Profile & Role Switch',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (b) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1">
            {!readOnly && (
              <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(b, 'Customer')}
                  className="px-1.5 py-0.5 rounded text-slate-700 hover:bg-emerald-100 cursor-pointer"
                >
                  ⇄ Customer
                </button>
                <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white">Broker</span>
                <button
                  type="button"
                  onClick={() => void handleQuickSwitchPartyRole(b, 'TruckOwner')}
                  className="px-1.5 py-0.5 rounded text-slate-700 hover:bg-amber-100 cursor-pointer"
                >
                  Owner
                </button>
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => loadBrokerForEdit(b)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold cursor-pointer"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSheetAction('brokers', onPreviewPdf ? 'preview' : 'download', b.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-bold cursor-pointer"
            >
              <Printer className="w-3 h-3" />
              Profile PDF
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() =>
                  onShowConfirm({
                    title: `Delete Broker ${b.name}?`,
                    description: `Remove ${b.name} from Broker Master?`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                    onConfirm: () => removeDocument('parties', b.id),
                  })
                }
                className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onShowConfirm, onPreviewPdf, readOnly]
  );

  const vehicleColumns = useMemo<Array<TableColumn<Vehicle>>>(
    () => [
      {
        key: 'truckNo',
        header: 'Truck No & Specs',
        render: (v) => (
          <div>
            <div className="font-mono-num font-bold text-blue-800">{v.truckNo}</div>
            {(v.vehicleMake || v.bodyType || v.vehicleColor) && (
              <div className="text-[11px] text-slate-600">
                {[v.vehicleMake, v.bodyType || v.vehicleType, v.vehicleColor].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        ),
      },
      { key: 'ownerName', header: 'Owner', render: (v) => v.ownerName },
      { key: 'fitness', header: 'Fitness', render: (v) => renderExpiryStatus(v.fitnessExpiry) },
      { key: 'insurance', header: 'Insurance', render: (v) => renderExpiryStatus(v.insuranceExpiry) },
      { key: 'permit', header: 'Permit', render: (v) => renderExpiryStatus(v.permitExpiry) },
      { key: 'roadTax', header: 'Road Tax', render: (v) => renderExpiryStatus(v.roadTaxExpiry) },
      { key: 'puc', header: 'PUC', render: (v) => renderExpiryStatus(v.pucExpiry) },
      {
        key: 'action',
        header: 'Profile & Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (v) => (
          <>
            {!readOnly && (
              <button
                type="button"
                onClick={() => loadVehicleForEdit(v)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold cursor-pointer"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSheetAction('vehicles', onPreviewPdf ? 'preview' : 'download', v.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-bold cursor-pointer"
            >
              <Printer className="w-3 h-3" />
              PDF
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() =>
                  onShowConfirm({
                    title: `Delete Vehicle ${v.truckNo}?`,
                    description: `Remove ${v.truckNo} from Fleet Master?`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                    onConfirm: () => removeDocument('vehicles', v.id),
                  })
                }
                className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onShowConfirm, onPreviewPdf, readOnly]
  );

  const driverColumns = useMemo<Array<TableColumn<Driver>>>(
    () => [
      { key: 'name', header: 'Driver Name', cellClassName: 'font-semibold', render: (d) => d.name },
      { key: 'dlNo', header: 'D/L Number', cellClassName: 'font-mono-num', render: (d) => d.dlNo },
      { key: 'dlStatus', header: 'D/L Status', render: (d) => renderExpiryStatus(d.dlExpiry) },
      {
        key: 'kyc',
        header: 'Aadhaar / PAN / Bank',
        cellClassName: 'font-mono-num text-[11px]',
        render: (d) => (
          <div>
            <div>UID: {d.aadhaarNo || '-'} · PAN: {d.panNo || '-'}</div>
            <div className="text-slate-500">{d.bankName || '-'} · A/c: {d.bankAccountNo || '-'}</div>
          </div>
        ),
      },
      { key: 'phone', header: 'Phone', cellClassName: 'font-mono-num', render: (d) => d.phone || '-' },
      {
        key: 'action',
        header: 'Profile & Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (d) => (
          <>
            {!readOnly && (
              <button
                type="button"
                onClick={() => loadDriverForEdit(d)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold cursor-pointer"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSheetAction('drivers', onPreviewPdf ? 'preview' : 'download', d.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-bold cursor-pointer"
            >
              <Printer className="w-3 h-3" />
              Profile PDF
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() =>
                  onShowConfirm({
                    title: `Delete Driver ${d.name}?`,
                    description: `Remove ${d.name} from Driver Master?`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                    onConfirm: () => removeDocument('drivers', d.id),
                  })
                }
                className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onShowConfirm, onPreviewPdf, readOnly]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('parties')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'parties' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            Parties &amp; Ledgers ({customerPartiesList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('owners')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'owners' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <UserCog className="w-4 h-4" />
            Lorry Owners ({ownersList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('brokers')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'brokers' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            Brokers ({brokersList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('vehicles')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'vehicles' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Truck className="w-4 h-4" />
            Lorry Register ({vehicles.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('drivers')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'drivers' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Drivers &amp; KYC ({drivers.length})
          </button>
        </div>

        <div className="flex items-center gap-1.5 pr-1">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter table..."
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {statusMsg}
          </span>
          <button type="button" onClick={() => setStatusMsg(null)} className="text-emerald-700 hover:text-emerald-950 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* PARTIES */}
      {tab === 'parties' && (
        <div className="space-y-4">
          {/* Top Full-Width Select Dropdown or Type to Search + Clean Brokers Control */}
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-blue-950 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-700" />
                <span>Select Party from Dropdown or Type to Search ({activePartyDirectory.length})</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPartyFilterMode((m) => (m === 'customers' ? 'all' : 'customers'))}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                    partyFilterMode === 'customers'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  {partyFilterMode === 'customers'
                    ? `Customers / Consignors (${customerPartiesList.length})`
                    : `All Categories (${parties.length})`}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    disabled={cleaningParties}
                    onClick={() => void handleSeparatePartiesInline()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-[11px] font-bold cursor-pointer disabled:opacity-60"
                  >
                    <Sparkles className="w-3 h-3" />
                    {cleaningParties
                      ? 'Cleaning...'
                      : `Clean / Separate Brokers${
                          partySeparationPreview.brokersSeparated + partySeparationPreview.ownersSeparated > 0
                            ? ` (${partySeparationPreview.brokersSeparated + partySeparationPreview.ownersSeparated})`
                            : ''
                        }`}
                  </button>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={resetPartyForm}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add New Party
                  </button>
                )}
              </div>
            </div>

            <RichEntityPicker<Party>
              ariaLabel="Select Party or Type to Search"
              value={pickerPartyText}
              selectedId={pickerPartyId}
              onChangeText={(txt) => {
                setPickerPartyText(txt);
                if (!txt) setPickerPartyId('');
              }}
              onSelectEntity={(party) => loadPartyForEdit(party)}
              items={activePartyDirectory}
              getId={(p) => p.id}
              getValue={(p) => p.name}
              getSearchText={(p) =>
                `${p.name} ${p.gstin || ''} ${p.pan || ''} ${p.phone || ''} ${p.address || ''}`
              }
              renderTitle={(p) => p.name}
              renderDetails={(p) => formatPartyDetailsLine(p)}
              renderBadge={(p) => p.partyType}
              placeholder="Click to browse full Customer list or type Name / GSTIN / City / Phone..."
              quickPreview={
                selectedPartyObj && (
                  <div className="space-y-2">
                    <EntityQuickPreviewCard kind="party" party={selectedPartyObj} />
                    {selectedPartyLedgerData && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-extrabold text-slate-900 flex flex-wrap items-center gap-2">
                            <FileText className="w-4 h-4 text-blue-700" />
                            <span>
                              Party Ledger ({activeFy}):{' '}
                              <span className="text-blue-800">{selectedPartyObj.name}</span>
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono-num text-[11px]">
                              Opening: ₹{formatINR(selectedPartyLedgerData.openingAmt)} {selectedPartyLedgerData.openingSide}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-mono-num text-[11px]">
                              Dr: ₹{formatINR(selectedPartyLedgerData.totalDr)}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono-num text-[11px]">
                              Cr: ₹{formatINR(selectedPartyLedgerData.totalCr)}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono-num text-[11px]">
                              Closing: ₹{formatINR(selectedPartyLedgerData.closing)} {selectedPartyLedgerData.side}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {onPreviewPdf && (
                              <button
                                type="button"
                                onClick={() => void handlePrintSelectedPartyLedger('preview')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
                              >
                                <Eye className="w-3 h-3" /> Preview Ledger
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handlePrintSelectedPartyLedger('print')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
                            >
                              <Printer className="w-3 h-3" /> Print Ledger
                            </button>
                            <button
                              type="button"
                              onClick={() => void handlePrintSelectedPartyLedger('download')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                            >
                              <Download className="w-3 h-3" /> Low-MB Ledger PDF
                            </button>
                          </div>
                        </div>
                        {selectedPartyLedgerData.rows.length > 0 && (
                          <div className="max-h-40 overflow-y-auto bg-white border border-slate-200 rounded">
                            <table className="w-full text-[11px] text-left border-collapse">
                              <thead className="bg-slate-100 text-slate-700 sticky top-0">
                                <tr>
                                  <th className="p-1.5">Date</th>
                                  <th className="p-1.5">Voucher</th>
                                  <th className="p-1.5">Particulars</th>
                                  <th className="p-1.5 text-right">Debit</th>
                                  <th className="p-1.5 text-right">Credit</th>
                                  <th className="p-1.5 text-right">Balance</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 font-mono-num">
                                {selectedPartyLedgerData.rows.map((r, i) => (
                                  <tr key={`${r.voucherNo}_${i}`}>
                                    <td className="p-1.5">{r.date ? formatDateDDMMYYYY(r.date) : 'OB'}</td>
                                    <td className="p-1.5 font-sans font-semibold">{r.voucherNo}</td>
                                    <td className="p-1.5 font-sans text-slate-600">{r.narration}</td>
                                    <td className="p-1.5 text-right">{r.debit > 0 ? formatINR(r.debit) : '-'}</td>
                                    <td className="p-1.5 text-right">{r.credit > 0 ? formatINR(r.credit) : '-'}</td>
                                    <td className="p-1.5 text-right font-bold">
                                      {formatINR(r.balance)} {r.side}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              }
            />
          </div>

          <form
            onSubmit={handleSaveParty}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
              <span>
                {editingPartyId ? `Edit Party: ${pName}` : 'Add Party / Customer / Consignor / Consignee'}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] bg-white/15 px-2.5 py-0.5 rounded">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                Auto-Stable Contact Guard: {Math.max(0, parties.length - contactHealth.length)} Verified · {contactHealth.length} Flagged
              </span>
            </div>
            {pContactWarn && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-300 text-xs font-bold text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{pContactWarn}</span>
              </div>
            )}
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Party Name *</label>
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Category</label>
                <SearchableSelect
                  ariaLabel="Party Category"
                  value={pType}
                  onChange={(val) => setPType(val as Party['partyType'])}
                  options={[
                    { value: 'Broker', label: 'Broker' },
                    { value: 'Consignee', label: 'Consignee' },
                    { value: 'Consignor', label: 'Consignor' },
                    { value: 'Customer', label: 'Customer (Billing)' },
                    { value: 'TruckOwner', label: 'Truck Owner' },
                    { value: 'Vendor', label: 'Vendor / Fuel' },
                  ]}
                  triggerClassName="!py-1.5"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">WhatsApp / Mobile No</label>
                <input
                  type="text"
                  value={pPhone}
                  onChange={(e) => {
                    setPPhone(e.target.value);
                    const g = validateAndNormalizeContact({
                      phone: e.target.value,
                      email: pEmail,
                      gstin: pGstin,
                      pan: pPan,
                    });
                    setPContactWarn(g.warnings.length > 0 ? g.warnings.join(' · ') : null);
                  }}
                  placeholder="10-digit WhatsApp mobile"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Party Email Address</label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="email"
                    value={pEmail}
                    onChange={(e) => {
                      setPEmail(e.target.value);
                      const g = validateAndNormalizeContact({
                        phone: pPhone,
                        email: e.target.value,
                        gstin: pGstin,
                        pan: pPan,
                      });
                      setPContactWarn(g.warnings.length > 0 ? g.warnings.join(' · ') : null);
                    }}
                    placeholder="accounts@party.com"
                    className="w-full pl-8 pr-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Follow-Up Channel</label>
                <SearchableSelect
                  ariaLabel="Preferred Follow-Up Channel"
                  value={pPreferredChannel}
                  onChange={(val) =>
                    setPPreferredChannel(val as 'WhatsApp Only' | 'Email Only' | 'Both')
                  }
                  options={[
                    { value: 'Both', label: 'Both (WhatsApp + Email)' },
                    { value: 'Email Only', label: 'Email Only' },
                    { value: 'WhatsApp Only', label: 'WhatsApp Only' },
                  ]}
                  triggerClassName="!py-1.5 !font-semibold"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address / City (Auto-fills PIN &amp; Country)</label>
                <input
                  type="text"
                  value={pAddr}
                  onChange={(e) => setPAddr(e.target.value)}
                  placeholder="e.g. Baranagar, Kolkata / Petrapole / Dhaka / Birgunj / Thimphu"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <PinCountryInputs
                  labelPrefix="Party"
                  pinCode={pPinCode}
                  country={pCountry}
                  onPinChange={setPPinCode}
                  onCountryChange={setPCountry}
                  compact
                />
              </div>
              <div>
                <GstinInputField
                  label="GSTIN"
                  value={pGstin}
                  onChange={setPGstin}
                  placeholder="15-char GSTIN (optional)"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  type="text"
                  value={pPan}
                  onChange={(e) => setPPan(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Opening Balance (₹)</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={pOpening}
                    onChange={(e) => setPOpening(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                  <div className="w-[74px] shrink-0">
                    <SearchableSelect
                      ariaLabel="Opening Balance Type"
                      value={pBalType}
                      onChange={(val) => setPBalType(val as 'Dr' | 'Cr')}
                      options={[
                        { value: 'Cr', label: 'Cr' },
                        { value: 'Dr', label: 'Dr' },
                      ]}
                      triggerClassName="!py-1.5"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              {editingPartyId && (
                <button
                  type="button"
                  onClick={resetPartyForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingPartyId ? 'Update Party' : 'Save Party'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredParties}
              columns={partyColumns}
              getRowId={(p) => p.id}
              defaultPageSize={50}
              emptyMessage="No parties matching search."
            />
          </div>
        </div>
      )}

      {/* LORRY OWNERS SHEET WITH TOP-RIGHT PRINT PREVIEW / PRINT OUT / DOWNLOAD PDF */}
      {tab === 'owners' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                <UserCog className="w-4 h-4 text-amber-700" />
                Select Lorry Owner from Dropdown or Type to Search ({ownersList.length})
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={resetOwnerForm}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add New Lorry Owner
                </button>
              )}
            </div>
            <RichEntityPicker<Party>
              ariaLabel="Select Lorry Owner or Type to Search"
              value={pickerOwnerText}
              selectedId={pickerOwnerId}
              onChangeText={(txt) => {
                setPickerOwnerText(txt);
                if (!txt) setPickerOwnerId('');
              }}
              onSelectEntity={(o) => loadOwnerForEdit(o)}
              items={ownersList}
              getId={(o) => o.id}
              getValue={(o) => o.name}
              getSearchText={(o) =>
                `${o.name} ${o.pan || ''} ${o.phone || ''} ${o.address || ''}`
              }
              renderTitle={(o) => o.name}
              renderDetails={(o) =>
                `PAN: ${o.pan || '-'} | Mob: ${o.phone || '-'} | City: ${extractCityFromAddress(o.address)}`
              }
              renderBadge={(o) => (o.bankAccountNo ? 'Bank KYC' : 'Owner')}
              placeholder="Click to browse Lorry Owners or type Name / PAN / Mobile / City..."
              quickPreview={
                pickerOwnerId ? (
                  <EntityQuickPreviewCard
                    kind="owner"
                    party={ownersList.find((x) => x.id === pickerOwnerId)}
                  />
                ) : null
              }
            />
          </div>

          <form
            onSubmit={handleSaveOwner}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                {editingOwnerId ? `Edit Lorry Owner: ${oName}` : `Lorry Owner Master & KYC Sheet (${filteredOwners.length})`}
              </span>
              {renderTopRightSheetButtons('owners')}
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Owner Name *</label>
                <input
                  type="text"
                  required
                  value={oName}
                  onChange={(e) => setOName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={oPhone}
                  onChange={(e) => setOPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address / City (Auto-fills PIN &amp; Country)</label>
                <input
                  type="text"
                  value={oAddr}
                  onChange={(e) => setOAddr(e.target.value)}
                  placeholder="City / Address (4-country PIN auto-fill)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <PinCountryInputs
                  labelPrefix="Owner"
                  pinCode={oPinCode}
                  country={oCountry}
                  onPinChange={setOPinCode}
                  onCountryChange={setOCountry}
                  compact
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Aadhaar Number</label>
                <input
                  type="text"
                  value={oAadhaar}
                  onChange={(e) => setOAadhaar(e.target.value)}
                  placeholder="12-digit Aadhaar"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  type="text"
                  value={oPan}
                  onChange={(e) => setOPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <GstinInputField
                  label="GST Number"
                  value={oGstin}
                  onChange={setOGstin}
                  placeholder="15-char GSTIN (optional)"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Opening Balance (₹ Cr)</label>
                <input
                  type="number"
                  value={oOpening}
                  onChange={(e) => setOOpening(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Name</label>
                <input
                  type="text"
                  value={oBankName}
                  onChange={(e) => setOBankName(e.target.value)}
                  placeholder="SBI / PNB / HDFC"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Account No</label>
                <input
                  type="text"
                  value={oBankAcc}
                  onChange={(e) => setOBankAcc(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">IFSC Code</label>
                <input
                  type="text"
                  value={oBankIfsc}
                  onChange={(e) => setOBankIfsc(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              {editingOwnerId && (
                <button
                  type="button"
                  onClick={resetOwnerForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingOwnerId ? 'Update Lorry Owner' : 'Save Lorry Owner'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredOwners}
              columns={ownerColumns}
              getRowId={(o) => o.id}
              defaultPageSize={50}
              emptyMessage="No lorry owners recorded yet."
            />
          </div>
        </div>
      )}

      {/* BROKERS SHEET (GST + TRADE LICENSE + AADHAAR + PAN + BANK ACCOUNT + TOP-RIGHT PRINT/PDF) */}
      {tab === 'brokers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-indigo-700" />
                Select Broker from Dropdown or Type to Search ({brokersList.length})
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={resetBrokerForm}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add New Broker
                </button>
              )}
            </div>
            <RichEntityPicker<Party>
              ariaLabel="Select Broker or Type to Search"
              value={pickerBrokerText}
              selectedId={pickerBrokerId}
              onChangeText={(txt) => {
                setPickerBrokerText(txt);
                if (!txt) setPickerBrokerId('');
              }}
              onSelectEntity={(b) => loadBrokerForEdit(b)}
              items={brokersList}
              getId={(b) => b.id}
              getValue={(b) => b.name}
              getSearchText={(b) =>
                `${b.name} ${b.pan || ''} ${b.gstin || ''} ${b.phone || ''} ${b.address || ''}`
              }
              renderTitle={(b) => b.name}
              renderDetails={(b) =>
                `PAN: ${b.pan || '-'} | Mob: ${b.phone || '-'} | City: ${extractCityFromAddress(b.address)}`
              }
              renderBadge={(b) => (b.tradeLicenseNo ? 'Licensed' : 'Broker')}
              placeholder="Click to browse Brokers or type Name / PAN / Mobile / City..."
              quickPreview={
                pickerBrokerId ? (
                  <EntityQuickPreviewCard
                    kind="broker"
                    party={brokersList.find((x) => x.id === pickerBrokerId)}
                  />
                ) : null
              }
            />
          </div>

          <form
            onSubmit={handleSaveBroker}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                {editingBrokerId
                  ? `Edit Broker: ${bName}`
                  : `Broker Master & KYC Sheet (GST + Trade License + Aadhaar + PAN + Bank) (${filteredBrokers.length})`}
              </span>
              {renderTopRightSheetButtons('brokers')}
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Broker Name *</label>
                <input
                  type="text"
                  required
                  value={bName}
                  onChange={(e) => setBName(e.target.value)}
                  placeholder="Shree Ganesh Roadways"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={bPhone}
                  onChange={(e) => setBPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address / City (Auto-fills PIN &amp; Country)</label>
                <input
                  type="text"
                  value={bAddr}
                  onChange={(e) => setBAddr(e.target.value)}
                  placeholder="City / Address (4-country PIN auto-fill)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <PinCountryInputs
                  labelPrefix="Broker"
                  pinCode={bPinCode}
                  country={bCountry}
                  onPinChange={setBPinCode}
                  onCountryChange={setBCountry}
                  compact
                />
              </div>
              <div>
                <GstinInputField
                  label="GST Number"
                  value={bGstin}
                  onChange={setBGstin}
                  placeholder="19XXXXX..."
                />
              </div>
              <div>
                <label className="block font-semibold text-blue-900 mb-1">Trade License Number</label>
                <input
                  type="text"
                  value={bTradeLicense}
                  onChange={(e) => setBTradeLicense(e.target.value.toUpperCase())}
                  placeholder="KMC/TL/..."
                  className="w-full px-2.5 py-1.5 rounded border border-blue-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Aadhaar Number</label>
                <input
                  type="text"
                  value={bAadhaar}
                  onChange={(e) => setBAadhaar(e.target.value)}
                  placeholder="12-digit Aadhaar"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  type="text"
                  value={bPan}
                  onChange={(e) => setBPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Name</label>
                <input
                  type="text"
                  value={bBankName}
                  onChange={(e) => setBBankName(e.target.value)}
                  placeholder="Bank Name"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Account No</label>
                <input
                  type="text"
                  value={bBankAcc}
                  onChange={(e) => setBBankAcc(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">IFSC Code</label>
                <input
                  type="text"
                  value={bBankIfsc}
                  onChange={(e) => setBBankIfsc(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Opening Balance (₹ Cr)</label>
                <input
                  type="number"
                  value={bOpening}
                  onChange={(e) => setBOpening(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              {editingBrokerId && (
                <button
                  type="button"
                  onClick={resetBrokerForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingBrokerId ? 'Update Broker' : 'Save Broker'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredBrokers}
              columns={brokerColumns}
              getRowId={(b) => b.id}
              defaultPageSize={50}
              emptyMessage="No brokers added yet."
            />
          </div>
        </div>
      )}

      {/* LORRY REGISTER (VEHICLES) WITH TOP-RIGHT PRINT PREVIEW / PRINT OUT / DOWNLOAD PDF */}
      {tab === 'vehicles' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-blue-950 flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-blue-700" />
                Select Lorry from Dropdown or Type to Search ({vehicles.length})
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={resetVehicleForm}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add New Lorry
                </button>
              )}
            </div>
            <RichEntityPicker<Vehicle>
              ariaLabel="Select Vehicle or Type to Search"
              value={pickerVehicleText}
              selectedId={pickerVehicleId}
              onChangeText={(txt) => {
                setPickerVehicleText(txt);
                if (!txt) setPickerVehicleId('');
              }}
              onSelectEntity={(v) => loadVehicleForEdit(v)}
              items={vehicles}
              getId={(v) => v.id}
              getValue={(v) => v.truckNo}
              getSearchText={(v) =>
                `${v.truckNo} ${v.ownerName} ${v.vehicleType || ''} ${v.vehicleMake || ''} ${v.ownerPhone || ''}`
              }
              renderTitle={(v) => v.truckNo}
              renderDetails={(v) => formatVehicleDetailsLine(v)}
              renderBadge={(v) => v.vehicleMake || v.vehicleType || 'Lorry'}
              placeholder="Click to browse Lorry Register or type Truck No. / Owner Name / Type..."
              quickPreview={
                pickerVehicleId ? (
                  <EntityQuickPreviewCard
                    kind="vehicle"
                    vehicle={vehicles.find((x) => x.id === pickerVehicleId)}
                  />
                ) : null
              }
            />
          </div>

          <form
            onSubmit={handleSaveVehicle}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                {editingVehicleId
                  ? `Edit Vehicle: ${vTruck}`
                  : `Lorry Register & Compliance Expiry (${filteredVehicles.length})`}
              </span>
              {renderTopRightSheetButtons('vehicles')}
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Truck No *</label>
                <input
                  type="text"
                  required
                  value={vTruck}
                  onChange={(e) => setVTruck(e.target.value)}
                  placeholder="WB23C6597"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Owner Name *</label>
                <input
                  type="text"
                  required
                  value={vOwner}
                  onChange={(e) => setVOwner(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Vehicle Make (OEM)</label>
                <EditableSearchSelect
                  value={vMake}
                  onChange={setVMake}
                  options={VEHICLE_MAKE_OPTIONS}
                  placeholder="Tata / Ashok Leyland / BharatBenz..."
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Body Type / Wheel</label>
                <EditableSearchSelect
                  value={vBodyType}
                  onChange={(val) => {
                    setVBodyType(val);
                    if (val) setVType(val);
                  }}
                  options={VEHICLE_BODY_TYPE_OPTIONS}
                  placeholder="Full Dala Body / Container / Trailer..."
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Vehicle Color</label>
                <EditableSearchSelect
                  value={vColor}
                  onChange={setVColor}
                  options={VEHICLE_COLOR_OPTIONS}
                  placeholder="Yellow-Black / Golden Yellow / White..."
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Capacity / Remarks Type</label>
                <input
                  type="text"
                  value={vType}
                  onChange={(e) => setVType(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Owner Phone</label>
                <input
                  type="text"
                  value={vPhone}
                  onChange={(e) => setVPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Engine No</label>
                <input
                  type="text"
                  value={vEngine}
                  onChange={(e) => setVEngine(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Chassis No</label>
                <input
                  type="text"
                  value={vChassis}
                  onChange={(e) => setVChassis(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fitness Expiry</label>
                <input
                  type="date"
                  value={vFit}
                  onChange={(e) => setVFit(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Insurance Expiry</label>
                <input
                  type="date"
                  value={vIns}
                  onChange={(e) => setVIns(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Permit Expiry</label>
                <input
                  type="date"
                  value={vPermit}
                  onChange={(e) => setVPermit(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Road Tax Expiry</label>
                <input
                  type="date"
                  value={vRoadTax}
                  onChange={(e) => setVRoadTax(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PUC Expiry</label>
                <input
                  type="date"
                  value={vPuc}
                  onChange={(e) => setVPuc(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              {editingVehicleId && (
                <button
                  type="button"
                  onClick={resetVehicleForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingVehicleId ? 'Update Vehicle' : 'Save Vehicle'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredVehicles}
              columns={vehicleColumns}
              getRowId={(v) => v.id}
              defaultPageSize={50}
              emptyMessage="No vehicles matching search."
            />
          </div>
        </div>
      )}

      {/* DRIVERS SHEET WITH TOP-RIGHT PRINT PREVIEW / PRINT OUT / DOWNLOAD PDF */}
      {tab === 'drivers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-teal-200 shadow-sm p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-teal-950 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-teal-700" />
                Select Driver from Dropdown or Type to Search ({drivers.length})
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={resetDriverForm}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add New Driver
                </button>
              )}
            </div>
            <RichEntityPicker<Driver>
              ariaLabel="Select Driver or Type to Search"
              value={pickerDriverText}
              selectedId={pickerDriverId}
              onChangeText={(txt) => {
                setPickerDriverText(txt);
                if (!txt) setPickerDriverId('');
              }}
              onSelectEntity={(d) => loadDriverForEdit(d)}
              items={drivers}
              getId={(d) => d.id}
              getValue={(d) => d.name}
              getSearchText={(d) =>
                `${d.name} ${d.dlNo} ${d.phone || ''} ${d.address || ''} ${d.panNo || ''}`
              }
              renderTitle={(d) => d.name}
              renderDetails={(d) => formatDriverDetailsLine(d)}
              renderBadge={(d) => (d.dlExpiry ? `Exp ${d.dlExpiry}` : 'Driver')}
              placeholder="Click to browse Drivers & KYC or type Driver Name / D/L No. / Mobile..."
              quickPreview={
                pickerDriverId ? (
                  <EntityQuickPreviewCard
                    kind="driver"
                    driver={drivers.find((x) => x.id === pickerDriverId)}
                  />
                ) : null
              }
            />
          </div>

          <form
            onSubmit={handleSaveDriver}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                {editingDriverId
                  ? `Edit Driver: ${dName}`
                  : `Driver Master, License Validity & KYC Sheet (${filteredDrivers.length})`}
              </span>
              {renderTopRightSheetButtons('drivers')}
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Driver Name *</label>
                <input
                  type="text"
                  required
                  value={dName}
                  onChange={(e) => setDName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">D/L Number *</label>
                <input
                  type="text"
                  required
                  value={dDl}
                  onChange={(e) => setDDl(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">D/L Expiry Date *</label>
                <input
                  type="date"
                  required
                  value={dExp}
                  onChange={(e) => setDExp(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={dPhone}
                  onChange={(e) => setDPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address / City (Auto-fills PIN &amp; Country)</label>
                <input
                  type="text"
                  value={dAddr}
                  onChange={(e) => setDAddr(e.target.value)}
                  placeholder="City / Address (4-country PIN auto-fill)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <PinCountryInputs
                  labelPrefix="Driver"
                  pinCode={dPinCode}
                  country={dCountry}
                  onPinChange={setDPinCode}
                  onCountryChange={setDCountry}
                  compact
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Aadhaar Number</label>
                <input
                  type="text"
                  value={dAadhaar}
                  onChange={(e) => setDAadhaar(e.target.value)}
                  placeholder="12-digit Aadhaar"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  type="text"
                  value={dPan}
                  onChange={(e) => setDPan(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Name</label>
                <input
                  type="text"
                  value={dBankName}
                  onChange={(e) => setDBankName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bank Account No</label>
                <input
                  type="text"
                  value={dBankAcc}
                  onChange={(e) => setDBankAcc(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">IFSC Code</label>
                <input
                  type="text"
                  value={dBankIfsc}
                  onChange={(e) => setDBankIfsc(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
                />
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              {editingDriverId && (
                <button
                  type="button"
                  onClick={resetDriverForm}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {editingDriverId ? 'Update Driver' : 'Save Driver'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <PaginatedDataTable
              data={filteredDrivers}
              columns={driverColumns}
              getRowId={(d) => d.id}
              defaultPageSize={50}
              emptyMessage="No drivers matching search."
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const MasterModule = React.memo(MasterModuleInner);
