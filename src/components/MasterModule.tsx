import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Download,
  Eye,
  Mail,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import {
  CompanySettings,
  DEFAULT_COMPANY_SETTINGS,
  Driver,
  DriveFolderName,
  Party,
  Vehicle,
} from '../types/erp';
import { daysUntilDate, formatDateDDMMYYYY, formatINR, makeSafeDocId, todayISO } from '../lib/formatters';
import { removeDocument, upsertDocument } from '../lib/firestoreStore';
import { scanPartiesForContactIssues, validateAndNormalizeContact } from '../lib/selfHealing';
import {
  downloadPdfDirect,
  GeneratedPdfResult,
  generateFoxproStatementPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

export type MasterTabId = 'parties' | 'owners' | 'brokers' | 'vehicles' | 'drivers';

interface MasterModuleProps {
  ownerUid: string;
  readOnly?: boolean;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
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
  parties,
  vehicles,
  drivers,
  company,
  initialTab = 'parties',
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [tab, setTab] = useState<MasterTabId>(initialTab);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  const effectiveCompany: CompanySettings = useMemo(
    () =>
      company || {
        ...DEFAULT_COMPANY_SETTINGS,
        ownerUid,
      },
    [company, ownerUid]
  );

  // General Party form
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<Party['partyType']>('Customer');
  const [pAddr, setPAddr] = useState('');
  const [pGstin, setPGstin] = useState('');
  const [pPan, setPPan] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPreferredChannel, setPPreferredChannel] = useState<'WhatsApp Only' | 'Email Only' | 'Both'>('WhatsApp Only');
  const [pContactWarn, setPContactWarn] = useState<string | null>(null);
  const [pOpening, setPOpening] = useState('0');
  const [pBalType, setPBalType] = useState<'Dr' | 'Cr'>('Dr');

  const contactHealth = useMemo(() => scanPartiesForContactIssues(parties), [parties]);

  // Lorry Owner form (stored in parties as TruckOwner with full KYC)
  const [oName, setOName] = useState('');
  const [oPhone, setOPhone] = useState('');
  const [oAddr, setOAddr] = useState('');
  const [oAadhaar, setOAadhaar] = useState('');
  const [oPan, setOPan] = useState('');
  const [oGstin, setOGstin] = useState('');
  const [oBankName, setOBankName] = useState('');
  const [oBankAcc, setOBankAcc] = useState('');
  const [oBankIfsc, setOBankIfsc] = useState('');
  const [oOpening, setOOpening] = useState('0');

  // Broker form (stored in parties as Broker with GST + Trade License + Aadhaar + PAN + Bank Account)
  const [bName, setBName] = useState('');
  const [bPhone, setBPhone] = useState('');
  const [bAddr, setBAddr] = useState('');
  const [bGstin, setBGstin] = useState('');
  const [bTradeLicense, setBTradeLicense] = useState('');
  const [bAadhaar, setBAadhaar] = useState('');
  const [bPan, setBPan] = useState('');
  const [bBankName, setBBankName] = useState('');
  const [bBankAcc, setBBankAcc] = useState('');
  const [bBankIfsc, setBBankIfsc] = useState('');
  const [bOpening, setBOpening] = useState('0');

  // Vehicle (Lorry Register) form
  const [vTruck, setVTruck] = useState('');
  const [vType, setVType] = useState('22 FT Open Trailer');
  const [vOwner, setVOwner] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vEngine, setVEngine] = useState('');
  const [vChassis, setVChassis] = useState('');
  const [vFit, setVFit] = useState('');
  const [vIns, setVIns] = useState('');
  const [vPermit, setVPermit] = useState('');
  const [vPuc, setVPuc] = useState('');

  // Driver form (with Aadhaar, PAN & Bank Account KYC)
  const [dName, setDName] = useState('');
  const [dDl, setDDl] = useState('');
  const [dExp, setDExp] = useState('');
  const [dPhone, setDPhone] = useState('');
  const [dAddr, setDAddr] = useState('');
  const [dAadhaar, setDAadhaar] = useState('');
  const [dPan, setDPan] = useState('');
  const [dBankName, setDBankName] = useState('');
  const [dBankAcc, setDBankAcc] = useState('');
  const [dBankIfsc, setDBankIfsc] = useState('');

  const ownersList = useMemo(
    () => parties.filter((p) => p.partyType === 'TruckOwner'),
    [parties]
  );

  const brokersList = useMemo(
    () => parties.filter((p) => p.partyType === 'Broker'),
    [parties]
  );

  const filteredParties = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) =>
      `${p.name} ${p.partyType} ${p.gstin || ''} ${p.phone || ''} ${p.tradeLicenseNo || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [parties, debouncedSearch]);

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
      setPContactWarn(guard.warnings.join(' · '));
      return;
    }
    setPContactWarn(null);
    const op = Number(pOpening) || 0;
    await upsertDocument(
      'parties',
      makeSafeDocId('party'),
      {
        name: pName.trim(),
        partyType: pType,
        address: pAddr.trim(),
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
      true
    );
    setPName('');
    setPAddr('');
    setPGstin('');
    setPPan('');
    setPPhone('');
    setPEmail('');
    setPOpening('0');
  };

  const handleSaveOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oName.trim() || readOnly) return;
    const op = Number(oOpening) || 0;
    await upsertDocument(
      'parties',
      makeSafeDocId('own'),
      {
        name: oName.trim(),
        partyType: 'TruckOwner',
        phone: oPhone.trim(),
        address: oAddr.trim(),
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
      true
    );
    setOName('');
    setOPhone('');
    setOAddr('');
    setOAadhaar('');
    setOPan('');
    setOGstin('');
    setOBankName('');
    setOBankAcc('');
    setOBankIfsc('');
    setOOpening('0');
  };

  const handleSaveBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bName.trim() || readOnly) return;
    const op = Number(bOpening) || 0;
    await upsertDocument(
      'parties',
      makeSafeDocId('brk'),
      {
        name: bName.trim(),
        partyType: 'Broker',
        phone: bPhone.trim(),
        address: bAddr.trim(),
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
      true
    );
    setBName('');
    setBPhone('');
    setBAddr('');
    setBGstin('');
    setBTradeLicense('');
    setBAadhaar('');
    setBPan('');
    setBBankName('');
    setBBankAcc('');
    setBBankIfsc('');
    setBOpening('0');
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vTruck.trim() || !vOwner.trim() || readOnly) return;
    await upsertDocument(
      'vehicles',
      makeSafeDocId('veh'),
      {
        truckNo: vTruck.trim().toUpperCase(),
        vehicleType: vType.trim(),
        ownerName: vOwner.trim(),
        ownerPhone: vPhone.trim(),
        engineNo: vEngine.trim(),
        chassisNo: vChassis.trim(),
        fitnessExpiry: vFit,
        insuranceExpiry: vIns,
        permitExpiry: vPermit,
        pucExpiry: vPuc,
        ownerUid,
      },
      true
    );
    setVTruck('');
    setVOwner('');
    setVPhone('');
    setVEngine('');
    setVChassis('');
  };

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dName.trim() || !dDl.trim() || !dExp || readOnly) return;
    await upsertDocument(
      'drivers',
      makeSafeDocId('drv'),
      {
        name: dName.trim(),
        dlNo: dDl.trim().toUpperCase(),
        dlExpiry: dExp,
        phone: dPhone.trim(),
        address: dAddr.trim(),
        aadhaarNo: dAadhaar.trim(),
        panNo: dPan.trim().toUpperCase(),
        bankName: dBankName.trim(),
        bankAccountNo: dBankAcc.trim(),
        bankIfsc: dBankIfsc.trim().toUpperCase(),
        ownerUid,
      },
      true
    );
    setDName('');
    setDDl('');
    setDExp('');
    setDPhone('');
    setDAddr('');
    setDAadhaar('');
    setDPan('');
    setDBankName('');
    setDBankAcc('');
    setDBankIfsc('');
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
          { label: 'ENGINE / CHASSIS NO', widthPct: 22, align: 'left' },
          { label: 'FITNESS / INS / PERMIT / PUC', widthPct: 26, align: 'left' },
        ],
        rows: list.map((v, idx) => ({
          line1: [
            String(idx + 1),
            v.truckNo,
            v.ownerName,
            `Eng: ${v.engineNo || '-'}`,
            `Fit: ${formatDateDDMMYYYY(v.fitnessExpiry) || '-'} | Ins: ${formatDateDDMMYYYY(v.insuranceExpiry) || '-'}`,
          ],
          line2: [
            '',
            v.vehicleType || '-',
            `Ph: ${v.ownerPhone || '-'}`,
            `Chs: ${v.chassisNo || '-'}`,
            `Prm: ${formatDateDDMMYYYY(v.permitExpiry) || '-'} | PUC: ${formatDateDDMMYYYY(v.pucExpiry) || '-'}`,
          ],
        })),
      },
      effectiveCompany,
      'l'
    );
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
        header: 'Action',
        align: 'right',
        render: (p) =>
          readOnly ? (
            <span className="text-[10px] font-bold text-slate-400">View</span>
          ) : (
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
          ),
      },
    ],
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
        header: 'Profile & Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (o) => (
          <>
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
          </>
        ),
      },
    ],
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
        header: 'Profile & Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (b) => (
          <>
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
          </>
        ),
      },
    ],
    [onShowConfirm, onPreviewPdf, readOnly]
  );

  const vehicleColumns = useMemo<Array<TableColumn<Vehicle>>>(
    () => [
      { key: 'truckNo', header: 'Truck No', cellClassName: 'font-mono-num font-bold text-blue-800', render: (v) => v.truckNo },
      { key: 'ownerName', header: 'Owner', render: (v) => v.ownerName },
      { key: 'fitness', header: 'Fitness', render: (v) => renderExpiryStatus(v.fitnessExpiry) },
      { key: 'insurance', header: 'Insurance', render: (v) => renderExpiryStatus(v.insuranceExpiry) },
      { key: 'permit', header: 'Permit', render: (v) => renderExpiryStatus(v.permitExpiry) },
      { key: 'puc', header: 'PUC', render: (v) => renderExpiryStatus(v.pucExpiry) },
      {
        key: 'action',
        header: 'Profile & Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap space-x-1',
        render: (v) => (
          <>
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
            Parties &amp; Ledgers ({parties.length})
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
            placeholder="Instant search..."
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* PARTIES */}
      {tab === 'parties' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveParty}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
              <span>Add Party / Customer / Consignor / Consignee</span>
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
                <select
                  value={pType}
                  onChange={(e) => setPType(e.target.value as Party['partyType'])}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                >
                  <option value="Customer">Customer (Billing)</option>
                  <option value="Consignor">Consignor</option>
                  <option value="Consignee">Consignee</option>
                  <option value="TruckOwner">Truck Owner</option>
                  <option value="Broker">Broker</option>
                  <option value="Vendor">Vendor / Fuel</option>
                </select>
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
                <select
                  aria-label="Preferred Follow-Up Channel"
                  value={pPreferredChannel}
                  onChange={(e) =>
                    setPPreferredChannel(e.target.value as 'WhatsApp Only' | 'Email Only' | 'Both')
                  }
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="WhatsApp Only">WhatsApp Only</option>
                  <option value="Email Only">Email Only</option>
                  <option value="Both">Both (WhatsApp + Email)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address (Region / State / Export Country)</label>
                <input
                  type="text"
                  value={pAddr}
                  onChange={(e) => setPAddr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">GSTIN</label>
                <input
                  type="text"
                  value={pGstin}
                  onChange={(e) => setPGstin(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
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
                  <select
                    value={pBalType}
                    onChange={(e) => setPBalType(e.target.value as 'Dr' | 'Cr')}
                    className="px-2 py-1.5 rounded border border-slate-300"
                  >
                    <option value="Dr">Dr</option>
                    <option value="Cr">Cr</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Party
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
          <form
            onSubmit={handleSaveOwner}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                Lorry Owner Master &amp; KYC Sheet ({filteredOwners.length})
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
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={oAddr}
                  onChange={(e) => setOAddr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
                <label className="block font-semibold text-slate-700 mb-1">GST Number</label>
                <input
                  type="text"
                  value={oGstin}
                  onChange={(e) => setOGstin(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
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
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Lorry Owner
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
          <form
            onSubmit={handleSaveBroker}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                Broker Master &amp; KYC Sheet (GST + Trade License + Aadhaar + PAN + Bank) ({filteredBrokers.length})
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
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={bAddr}
                  onChange={(e) => setBAddr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-blue-900 mb-1">GST Number</label>
                <input
                  type="text"
                  value={bGstin}
                  onChange={(e) => setBGstin(e.target.value.toUpperCase())}
                  placeholder="19XXXXX..."
                  className="w-full px-2.5 py-1.5 rounded border border-blue-300 font-mono-num uppercase"
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
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Broker
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
          <form
            onSubmit={handleSaveVehicle}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                Lorry Register &amp; Compliance Expiry ({filteredVehicles.length})
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
                <label className="block font-semibold text-slate-700 mb-1">Vehicle Type</label>
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
                <label className="block font-semibold text-slate-700 mb-1">PUC Expiry</label>
                <input
                  type="date"
                  value={vPuc}
                  onChange={(e) => setVPuc(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Vehicle
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
          <form
            onSubmit={handleSaveDriver}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold">
                Driver Master, License Validity &amp; KYC Sheet ({filteredDrivers.length})
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
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={dAddr}
                  onChange={(e) => setDAddr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
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
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={readOnly}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Driver
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
