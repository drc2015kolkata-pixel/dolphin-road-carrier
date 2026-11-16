import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Save,
  Search,
  Trash2,
  Truck,
  UserCheck,
  Users,
} from 'lucide-react';
import { Driver, Party, Vehicle } from '../types/erp';
import { daysUntilDate, formatDateDDMMYYYY, formatINR, makeSafeDocId } from '../lib/formatters';
import { removeDocument, upsertDocument } from '../lib/firestoreStore';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';

interface MasterModuleProps {
  ownerUid: string;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  initialTab?: 'parties' | 'vehicles' | 'drivers';
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
  parties,
  vehicles,
  drivers,
  initialTab = 'parties',
  onShowConfirm,
}) => {
  const [tab, setTab] = useState<'parties' | 'vehicles' | 'drivers'>(initialTab);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  // Party form
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<Party['partyType']>('Customer');
  const [pAddr, setPAddr] = useState('');
  const [pGstin, setPGstin] = useState('');
  const [pPan, setPPan] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pOpening, setPOpening] = useState('0');
  const [pBalType, setPBalType] = useState<'Dr' | 'Cr'>('Dr');

  // Vehicle form
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

  // Driver form
  const [dName, setDName] = useState('');
  const [dDl, setDDl] = useState('');
  const [dExp, setDExp] = useState('');
  const [dPhone, setDPhone] = useState('');
  const [dAddr, setDAddr] = useState('');

  const filteredParties = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) =>
      `${p.name} ${p.partyType} ${p.gstin || ''} ${p.phone || ''}`.toLowerCase().includes(q)
    );
  }, [parties, debouncedSearch]);

  const filteredVehicles = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      `${v.truckNo} ${v.ownerName} ${v.vehicleType || ''}`.toLowerCase().includes(q)
    );
  }, [vehicles, debouncedSearch]);

  const filteredDrivers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) =>
      `${d.name} ${d.dlNo} ${d.phone || ''}`.toLowerCase().includes(q)
    );
  }, [drivers, debouncedSearch]);

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim()) return;
    const op = Number(pOpening) || 0;
    await upsertDocument(
      'parties',
      makeSafeDocId('party'),
      {
        name: pName.trim(),
        partyType: pType,
        address: pAddr.trim(),
        gstin: pGstin.trim().toUpperCase(),
        pan: pPan.trim().toUpperCase(),
        phone: pPhone.trim(),
        email: '',
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
    setPOpening('0');
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vTruck.trim() || !vOwner.trim()) return;
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
    if (!dName.trim() || !dDl.trim() || !dExp) return;
    await upsertDocument(
      'drivers',
      makeSafeDocId('drv'),
      {
        name: dName.trim(),
        dlNo: dDl.trim().toUpperCase(),
        dlExpiry: dExp,
        phone: dPhone.trim(),
        address: dAddr.trim(),
        ownerUid,
      },
      true
    );
    setDName('');
    setDDl('');
    setDExp('');
    setDPhone('');
    setDAddr('');
  };

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
        render: (p) => (
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
    [onShowConfirm]
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
        header: 'Action',
        align: 'right',
        render: (v) => (
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
        ),
      },
    ],
    [onShowConfirm]
  );

  const driverColumns = useMemo<Array<TableColumn<Driver>>>(
    () => [
      { key: 'name', header: 'Driver Name', cellClassName: 'font-semibold', render: (d) => d.name },
      { key: 'dlNo', header: 'D/L Number', cellClassName: 'font-mono-num', render: (d) => d.dlNo },
      { key: 'dlStatus', header: 'D/L Status', render: (d) => renderExpiryStatus(d.dlExpiry) },
      { key: 'phone', header: 'Phone', cellClassName: 'font-mono-num', render: (d) => d.phone || '-' },
      {
        key: 'action',
        header: 'Action',
        align: 'right',
        render: (d) => (
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
        ),
      },
    ],
    [onShowConfirm]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('parties')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'parties' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            Parties &amp; Ledgers ({parties.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('vehicles')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'vehicles' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Truck className="w-4 h-4" />
            Vehicles &amp; Fitness ({vehicles.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('drivers')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'drivers' ? 'bg-[#0D47A1] text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Drivers &amp; Licenses ({drivers.length})
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
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 text-sm font-bold">
              Add Party / Customer / Truck Owner
            </div>
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
                  <option value="TruckOwner">Truck Owner / Broker</option>
                  <option value="Vendor">Vendor / Fuel</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={pPhone}
                  onChange={(e) => setPPhone(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
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
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
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

      {/* VEHICLES */}
      {tab === 'vehicles' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveVehicle}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 text-sm font-bold">
              Add Vehicle &amp; Compliance Expiry Dates (Triggers Top Header Failed Vehicle Alerts)
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
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
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

      {/* DRIVERS */}
      {tab === 'drivers' && (
        <div className="space-y-4">
          <form
            onSubmit={handleSaveDriver}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1976D2] text-white px-4 py-2.5 text-sm font-bold">
              Add Driver &amp; License Validity (Triggers Top Header Failed License Alerts)
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
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold cursor-pointer"
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
