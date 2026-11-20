import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Download,
  Plus,
  Trash2,
  Truck,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  BRANCH_OPTIONS,
  LogisticsDocket,
  LogisticsDriver,
  LogisticsInvoice,
  LogisticsLedgerEntry,
  LogisticsManifest,
  LogisticsParty,
  LogisticsVehicle,
} from '../types/erp';
import { removeDocument, restoreLogisticsBackupBundle, upsertDocument } from '../lib/firestoreStore';
import { daysUntilDate, formatDateDDMMYYYY } from '../lib/formatters';
import {
  downloadLogisticsMasterBackupFromDrive,
  DriveFileSummary,
  listLogisticsDriveBackupFiles,
  uploadLogisticsMasterBackupToDrive,
} from '../lib/driveBackup';

interface LogisticsMastersDrivePanelProps {
  subView: 'masters' | 'backup';
  ownerUid: string;
  activeBranchCode: string;
  parties: LogisticsParty[];
  vehicles: LogisticsVehicle[];
  drivers: LogisticsDriver[];
  dockets: LogisticsDocket[];
  manifests: LogisticsManifest[];
  invoices: LogisticsInvoice[];
  ledgers: LogisticsLedgerEntry[];
  connectedEmail: string | null;
  driveAccessToken: string | null;
  onConnectDrive: () => Promise<void>;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

export const LogisticsMastersDrivePanel: React.FC<LogisticsMastersDrivePanelProps> = ({
  subView,
  ownerUid,
  activeBranchCode,
  parties,
  vehicles,
  drivers,
  dockets,
  manifests,
  invoices,
  ledgers,
  connectedEmail,
  driveAccessToken,
  onConnectDrive,
  onShowConfirm,
}) => {
  const branch = activeBranchCode && activeBranchCode !== 'ALL' ? activeBranchCode : 'KOL-HQ';
  const [masterTab, setMasterTab] = useState<'parties' | 'vehicles' | 'drivers'>('parties');

  // Party form
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<LogisticsParty['partyType']>('Customer');
  const [pGstin, setPGstin] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pAddress, setPAddress] = useState('');
  const [pEmail, setPEmail] = useState('');

  // Vehicle form
  const [vTruckNo, setVTruckNo] = useState('');
  const [vType, setVType] = useState('14FT Closed Container');
  const [vOwner, setVOwner] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vFit, setVFit] = useState('');
  const [vIns, setVIns] = useState('');
  const [vPermit, setVPermit] = useState('');
  const [vTax, setVTax] = useState('');
  const [vPuc, setVPuc] = useState('');

  // Driver form
  const [dName, setDName] = useState('');
  const [dDlNo, setDDlNo] = useState('');
  const [dDlExp, setDDlExp] = useState('');
  const [dPhone, setDPhone] = useState('');
  const [dAddr, setDAddr] = useState('');

  // Drive backup state
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileSummary[]>([]);

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim()) return;
    const id = `lpty_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await upsertDocument(
      'logistics_parties',
      id,
      {
        name: pName.trim(),
        partyType: pType,
        gstin: pGstin.trim().toUpperCase(),
        phone: pPhone.trim(),
        address: pAddress.trim(),
        email: pEmail.trim(),
        branchCode: branch,
        openingBalance: 0,
        currentBalance: 0,
        balanceType: 'Dr',
        ownerUid,
      },
      true
    );
    setPName('');
    setPGstin('');
    setPPhone('');
    setPAddress('');
    setPEmail('');
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vTruckNo.trim() || !vOwner.trim()) return;
    const id = `lveh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await upsertDocument(
      'logistics_vehicles',
      id,
      {
        truckNo: vTruckNo.trim().toUpperCase(),
        vehicleType: vType.trim(),
        ownerName: vOwner.trim(),
        ownerPhone: vPhone.trim(),
        fitnessExpiry: vFit,
        insuranceExpiry: vIns,
        permitExpiry: vPermit,
        roadTaxExpiry: vTax,
        pucExpiry: vPuc,
        branchCode: branch,
        ownerUid,
      },
      true
    );
    setVTruckNo('');
    setVOwner('');
    setVPhone('');
  };

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dName.trim() || !dDlNo.trim()) return;
    const id = `ldrv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await upsertDocument(
      'logistics_drivers',
      id,
      {
        name: dName.trim(),
        dlNo: dDlNo.trim().toUpperCase(),
        dlExpiry: dDlExp,
        phone: dPhone.trim(),
        address: dAddr.trim(),
        branchCode: branch,
        ownerUid,
      },
      true
    );
    setDName('');
    setDDlNo('');
    setDDlExp('');
    setDPhone('');
    setDAddr('');
  };

  const buildLogisticsBundle = () => ({
    division: 'LOGISTICS_DIVISION',
    exportedAt: new Date().toISOString(),
    logistics_parties: parties,
    logistics_vehicles: vehicles,
    logistics_drivers: drivers,
    logistics_dockets: dockets,
    logistics_manifests: manifests,
    logistics_invoices: invoices,
    logistics_ledgers: ledgers,
  });

  const handleDriveBackupNow = async () => {
    if (!driveAccessToken) {
      await onConnectDrive();
      return;
    }
    setDriveBusy(true);
    setDriveStatus(null);
    try {
      const res = await uploadLogisticsMasterBackupToDrive(driveAccessToken, buildLogisticsBundle());
      const files = await listLogisticsDriveBackupFiles(driveAccessToken);
      setDriveFiles(files);
      setDriveStatus(
        `Backed up to Google Drive / DOLPHIN_LOGISTICS_DIVISION_BACKUP / ${res.name} (${Math.max(1, Math.round(res.compressedBytes / 1024))} KB)`
      );
    } catch (err) {
      setDriveStatus(err instanceof Error ? err.message : 'Logistics Drive backup failed.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDriveRestoreNow = async () => {
    if (!driveAccessToken) {
      await onConnectDrive();
      return;
    }
    setDriveBusy(true);
    setDriveStatus(null);
    try {
      const payload = await downloadLogisticsMasterBackupFromDrive(driveAccessToken);
      if (!payload) {
        setDriveStatus('No Logistics backup file found inside DOLPHIN_LOGISTICS_DIVISION_BACKUP.');
        return;
      }
      await restoreLogisticsBackupBundle(payload);
      setDriveStatus('Logistics Division data restored cleanly from DOLPHIN_LOGISTICS_DIVISION_BACKUP.');
    } catch (err) {
      setDriveStatus(err instanceof Error ? err.message : 'Logistics Drive restore failed.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleLocalJsonExport = () => {
    const blob = new Blob([JSON.stringify(buildLogisticsBundle(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DRC_Logistics_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleLocalJsonImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      await restoreLogisticsBackupBundle(parsed);
      setDriveStatus(`Imported Logistics backup file "${file.name}" successfully.`);
    } catch (err) {
      setDriveStatus(err instanceof Error ? err.message : 'Invalid Logistics JSON backup file.');
    }
  };

  return (
    <div className="space-y-4">
      {subView === 'masters' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'parties', label: `Parties & Brokers (${parties.length})`, icon: Users },
              { id: 'vehicles', label: `Line-Haul Vehicles (${vehicles.length})`, icon: Truck },
              { id: 'drivers', label: `Drivers (${drivers.length})`, icon: UserCheck },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMasterTab(t.id as 'parties' | 'vehicles' | 'drivers')}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-extrabold cursor-pointer ${
                    masterTab === t.id
                      ? 'bg-[#0F766E] text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {masterTab === 'parties' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <form
                onSubmit={handleSaveParty}
                className="xl:col-span-4 bg-white rounded-xl border border-slate-200 p-4 space-y-2.5 text-xs shadow-sm"
              >
                <h4 className="font-extrabold text-slate-900">Add Logistics Party / Broker</h4>
                <input
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Party / Company / Broker Name*"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-semibold"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={pType}
                    onChange={(e) => setPType(e.target.value as LogisticsParty['partyType'])}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 font-bold"
                  >
                    <option value="Customer">Customer (TBB)</option>
                    <option value="Consignor">Consignor</option>
                    <option value="Consignee">Consignee</option>
                    <option value="Broker">Broker</option>
                    <option value="DeliveryAgent">Delivery Agent</option>
                    <option value="Vendor">Vendor</option>
                  </select>
                  <input
                    value={pPhone}
                    onChange={(e) => setPPhone(e.target.value)}
                    placeholder="Phone / Mobile"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <input
                  value={pGstin}
                  onChange={(e) => setPGstin(e.target.value)}
                  placeholder="GSTIN (optional)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
                <input
                  value={pEmail}
                  onChange={(e) => setPEmail(e.target.value)}
                  placeholder="Email ID (optional)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <input
                  value={pAddress}
                  onChange={(e) => setPAddress(e.target.value)}
                  placeholder="Address / City"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-[#0F766E] hover:bg-[#0D9488] text-white font-extrabold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save Logistics Party</span>
                </button>
              </form>

              <div className="xl:col-span-8 bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Phone &amp; Email</th>
                      <th className="px-3 py-2 text-left">GSTIN</th>
                      <th className="px-3 py-2 text-right">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parties.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-bold text-slate-900">{p.name}</td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 text-[10px] font-bold">
                            {p.partyType}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono-num text-[11px]">
                          {p.phone || '-'} {p.email ? `· ${p.email}` : ''}
                        </td>
                        <td className="px-3 py-2 font-mono-num text-[11px]">{p.gstin || 'URD'}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              onShowConfirm({
                                title: `Delete ${p.name}?`,
                                description: 'Removes party from isolated Logistics Masters.',
                                confirmLabel: 'Delete',
                                variant: 'danger',
                                onConfirm: () => removeDocument('logistics_parties', p.id),
                              })
                            }
                            className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {masterTab === 'vehicles' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <form
                onSubmit={handleSaveVehicle}
                className="xl:col-span-4 bg-white rounded-xl border border-slate-200 p-4 space-y-2.5 text-xs shadow-sm"
              >
                <h4 className="font-extrabold text-slate-900">Add Logistics Fleet / Pickup Vehicle</h4>
                <input
                  required
                  value={vTruckNo}
                  onChange={(e) => setVTruckNo(e.target.value.toUpperCase())}
                  placeholder="Vehicle Reg No (e.g. WB23C6597)*"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num font-bold"
                />
                <input
                  value={vType}
                  onChange={(e) => setVType(e.target.value)}
                  placeholder="Vehicle Type (14FT / 17FT / 407)"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    value={vOwner}
                    onChange={(e) => setVOwner(e.target.value)}
                    placeholder="Owner Name*"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                  <input
                    value={vPhone}
                    onChange={(e) => setVPhone(e.target.value)}
                    placeholder="Owner Phone"
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Fitness Expiry</label>
                    <input type="date" value={vFit} onChange={(e) => setVFit(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Insurance Expiry</label>
                    <input type="date" value={vIns} onChange={(e) => setVIns(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Permit Expiry</label>
                    <input type="date" value={vPermit} onChange={(e) => setVPermit(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Road Tax Expiry</label>
                    <input type="date" value={vTax} onChange={(e) => setVTax(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">PUC Expiry</label>
                    <input type="date" value={vPuc} onChange={(e) => setVPuc(e.target.value)} className="w-full px-2 py-1 rounded border border-slate-300" />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2 rounded-lg bg-[#0F766E] hover:bg-[#0D9488] text-white font-extrabold cursor-pointer"
                >
                  Save Logistics Vehicle
                </button>
              </form>

              <div className="xl:col-span-8 bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Truck No</th>
                      <th className="px-3 py-2 text-left">Owner / Phone</th>
                      <th className="px-3 py-2 text-left">Compliance (15d Alert)</th>
                      <th className="px-3 py-2 text-right">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vehicles.map((v) => {
                      const hasAlert = [v.fitnessExpiry, v.insuranceExpiry, v.permitExpiry, v.roadTaxExpiry, v.pucExpiry].some(
                        (dt) => {
                          const d = daysUntilDate(dt);
                          return d !== null && d <= 15;
                        }
                      );
                      return (
                        <tr key={v.id} className={hasAlert ? 'bg-red-50/60' : ''}>
                          <td className="px-3 py-2 font-mono-num font-extrabold text-[#0F766E]">
                            {v.truckNo}
                            <div className="text-[11px] font-normal text-slate-500">{v.vehicleType}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold">{v.ownerName}</div>
                            <div className="text-[11px] text-slate-500">{v.ownerPhone || '-'}</div>
                          </td>
                          <td className="px-3 py-2 text-[11px]">
                            {hasAlert ? (
                              <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                                <AlertTriangle className="w-3.5 h-3.5" /> Due / Expired within 15 days
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Papers Valid
                              </span>
                            )}
                            <div className="text-slate-500 mt-0.5">
                              Fit:{formatDateDDMMYYYY(v.fitnessExpiry)} | Ins:{formatDateDDMMYYYY(v.insuranceExpiry)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeDocument('logistics_vehicles', v.id)}
                              className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {masterTab === 'drivers' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <form
                onSubmit={handleSaveDriver}
                className="xl:col-span-4 bg-white rounded-xl border border-slate-200 p-4 space-y-2.5 text-xs shadow-sm"
              >
                <h4 className="font-extrabold text-slate-900">Add Logistics Driver</h4>
                <input
                  required
                  value={dName}
                  onChange={(e) => setDName(e.target.value)}
                  placeholder="Driver Name*"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-semibold"
                />
                <input
                  required
                  value={dDlNo}
                  onChange={(e) => setDDlNo(e.target.value.toUpperCase())}
                  placeholder="Driving License No*"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
                <div>
                  <label className="text-[10px] font-bold text-slate-500">D/L Expiry Date*</label>
                  <input
                    type="date"
                    required
                    value={dDlExp}
                    onChange={(e) => setDDlExp(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <input
                  value={dPhone}
                  onChange={(e) => setDPhone(e.target.value)}
                  placeholder="Mobile No"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
                />
                <input
                  value={dAddr}
                  onChange={(e) => setDAddr(e.target.value)}
                  placeholder="Address"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                />
                <button
                  type="submit"
                  className="w-full py-2 rounded-lg bg-[#0F766E] hover:bg-[#0D9488] text-white font-extrabold cursor-pointer"
                >
                  Save Logistics Driver
                </button>
              </form>

              <div className="xl:col-span-8 bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Driver Name</th>
                      <th className="px-3 py-2 text-left">D/L No &amp; Expiry</th>
                      <th className="px-3 py-2 text-left">Phone</th>
                      <th className="px-3 py-2 text-right">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drivers.map((dr) => {
                      const days = daysUntilDate(dr.dlExpiry);
                      const isAlert = days !== null && days <= 15;
                      return (
                        <tr key={dr.id} className={isAlert ? 'bg-red-50/60' : ''}>
                          <td className="px-3 py-2 font-bold text-slate-900">{dr.name}</td>
                          <td className="px-3 py-2 font-mono-num">
                            <div>{dr.dlNo}</div>
                            <div className={`text-[11px] font-bold ${isAlert ? 'text-red-700' : 'text-emerald-700'}`}>
                              Exp: {formatDateDDMMYYYY(dr.dlExpiry)} {isAlert ? '(15d Alert!)' : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono-num">{dr.phone || '-'}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeDocument('logistics_drivers', dr.id)}
                              className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {subView === 'backup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-[#0F766E]">
              <Cloud className="w-5 h-5" />
              <div>
                <h3 className="text-sm font-extrabold">
                  Separate Logistics Google Drive Folder Backup
                </h3>
                <p className="text-[11px] text-slate-500">
                  Folder: <strong className="font-mono-num">DOLPHIN_LOGISTICS_DIVISION_BACKUP</strong> (100% isolated from FTL folder)
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
              <span>
                Connected Gmail: <strong>{connectedEmail || 'Not connected yet'}</strong>
              </span>
              <button
                type="button"
                onClick={() => void onConnectDrive()}
                className="px-3 py-1 rounded bg-[#0D47A1] hover:bg-[#0B3B8C] text-white font-bold cursor-pointer"
              >
                {connectedEmail ? 'Switch Gmail' : 'Link Google Drive'}
              </button>
            </div>

            {driveStatus && (
              <div className="p-2.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 font-semibold">
                {driveStatus}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={driveBusy}
                onClick={() => void handleDriveBackupNow()}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[#0F766E] hover:bg-[#0D9488] text-white font-extrabold cursor-pointer disabled:opacity-50"
              >
                <CloudUpload className="w-4 h-4" />
                <span>{driveBusy ? 'Working...' : 'Backup Logistics to Drive'}</span>
              </button>
              <button
                type="button"
                disabled={driveBusy}
                onClick={() => void handleDriveRestoreNow()}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-extrabold cursor-pointer disabled:opacity-50"
              >
                <CloudDownload className="w-4 h-4" />
                <span>Restore from Drive Folder</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleLocalJsonExport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Logistics JSON</span>
              </button>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-bold cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Import Logistics JSON</span>
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => void handleLocalJsonImport(e.target.files?.[0])}
                />
              </label>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2 text-xs">
            <h4 className="font-extrabold text-slate-900">
              Drive Folder Contents (DOLPHIN_LOGISTICS_DIVISION_BACKUP)
            </h4>
            <p className="text-[11px] text-slate-500">
              Subfolders: Docket_LR, LineHaul_Manifests, Logistics_Invoices_CN_DN, Godown_POD_Scans, Logistics_Ledgers · Active Hub Branches: {BRANCH_OPTIONS.length - 1}
            </p>
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {driveFiles.length === 0 ? (
                <p className="p-4 text-center text-slate-500">
                  Run Backup Logistics to Drive to view live cloud archive files here.
                </p>
              ) : (
                driveFiles.map((f) => (
                  <div key={f.id} className="px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-800">{f.name}</div>
                      <div className="text-[10px] text-slate-500">{f.folderName}</div>
                    </div>
                    <span className="font-mono-num text-[11px] text-slate-600">
                      {f.size ? `${Math.max(1, Math.round(Number(f.size) / 1024))} KB` : 'File'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
