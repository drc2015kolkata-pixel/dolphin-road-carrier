import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ClipboardList,
  Cloud,
  FileText,
  FolderOpen,
  IndianRupee,
  LayoutDashboard,
  Package,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import {
  AnyDriveFolderName,
  BUSINESS_MODE_META,
  CompanySettings,
  Driver,
  LogisticsDivisionCode,
  LogisticsDocket,
  LogisticsDriveFolderName,
  LogisticsDriver,
  LogisticsInvoice,
  LogisticsLedgerEntry,
  LogisticsManifest,
  LogisticsParty,
  LogisticsVehicle,
  LogisticsWorkspaceTabId,
  LorryHire,
  Party,
  StaffAccount,
  StaffCommissionEntry,
  Vehicle,
} from '../types/erp';
import { daysUntilDate, formatINR } from '../lib/formatters';
import { getEwayBillExpiryState } from '../lib/ewayBillUtils';
import { GeneratedPdfResult } from '../lib/pdfEngine';
import { LogisticsDocketManifestPanel } from './LogisticsDocketManifestPanel';
import { LogisticsBillingLedgerPanel } from './LogisticsBillingLedgerPanel';
import { LogisticsMastersDrivePanel } from './LogisticsMastersDrivePanel';
import { AllInOneEntrySheet } from './AllInOneEntrySheet';
import { PdfStoreVaultPanel } from './PdfStoreVaultPanel';

interface LogisticsWorkspaceProps {
  divisionMode?: LogisticsDivisionCode;
  activeTab?: LogisticsWorkspaceTabId;
  onActiveTabChange?: (tab: LogisticsWorkspaceTabId) => void;
  ownerUid: string;
  activeStaffCode: string;
  activeStaffName?: string;
  activeBranchCode: string;
  activeFy: string;
  isMasterAdmin?: boolean;
  dockets: LogisticsDocket[];
  manifests: LogisticsManifest[];
  parties: LogisticsParty[];
  vehicles: LogisticsVehicle[];
  drivers: LogisticsDriver[];
  invoices: LogisticsInvoice[];
  ledgers: LogisticsLedgerEntry[];
  ftlParties?: Party[];
  ftlVehicles?: Vehicle[];
  ftlDrivers?: Driver[];
  staffAccounts?: StaffAccount[];
  lorryHires?: LorryHire[];
  staffCommissions?: StaffCommissionEntry[];
  company: CompanySettings;
  connectedEmail: string | null;
  driveAccessToken: string | null;
  onConnectDrive: () => Promise<void>;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => void;
  onShowConfirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    onConfirm: () => Promise<void> | void;
  }) => void;
}

export const LogisticsWorkspace: React.FC<LogisticsWorkspaceProps> = ({
  divisionMode = 'LOGISTICS',
  activeTab: controlledTab,
  onActiveTabChange,
  ownerUid,
  activeStaffCode,
  activeStaffName = 'Operator',
  activeBranchCode,
  activeFy,
  isMasterAdmin = false,
  dockets,
  manifests,
  parties,
  vehicles,
  drivers,
  invoices,
  ledgers,
  ftlParties = [],
  ftlVehicles = [],
  ftlDrivers = [],
  staffAccounts = [],
  lorryHires = [],
  staffCommissions = [],
  company,
  connectedEmail,
  driveAccessToken,
  onConnectDrive,
  onPreviewPdf,
  onShowConfirm,
}) => {
  const [internalTab, setInternalTab] = useState<LogisticsWorkspaceTabId>('overview');
  const activeLogiTab = controlledTab ?? internalTab;

  const setActiveLogiTab = (next: LogisticsWorkspaceTabId) => {
    setInternalTab(next);
    onActiveTabChange?.(next);
  };

  useEffect(() => {
    setInternalTab('overview');
    onActiveTabChange?.('overview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionMode]);

  const divisionMeta = BUSINESS_MODE_META[divisionMode];

  const logiTabs: Array<{
    id: LogisticsWorkspaceTabId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = useMemo(
    () => [
      { id: 'overview', label: `${divisionMeta.shortLabel} Hub`, icon: LayoutDashboard },
      { id: 'allInOne', label: 'All-in-One Sheet', icon: ClipboardList },
      {
        id: 'docket',
        label: divisionMode === 'COURIER' ? 'Courier Docket / AWB' : 'Parcel Docket / LR',
        icon: Package,
      },
      { id: 'manifest', label: 'Line-Haul Manifest', icon: Truck },
      { id: 'godown', label: 'Branch Godown Stock', icon: Warehouse },
      { id: 'masters', label: `${divisionMeta.shortLabel} Masters`, icon: Users },
      { id: 'billing', label: 'Invoices / CN / DN', icon: FileText },
      { id: 'ledgers', label: `${divisionMeta.shortLabel} Ledgers`, icon: IndianRupee },
      { id: 'pdfVault', label: '5-Folder PDF Vault', icon: FolderOpen },
      { id: 'backup', label: 'Drive Backup & JSON', icon: Cloud },
    ],
    [divisionMeta.shortLabel, divisionMode]
  );

  const stats = useMemo(() => {
    const inGodownDockets = dockets.filter(
      (d) => d.stockStage === 'Origin Godown' || d.stockStage === 'Destination Godown'
    );
    const inGodownPkgs = inGodownDockets.reduce((s, d) => s + Number(d.packages || 0), 0);
    const activeManifests = manifests.filter((m) => m.status !== 'Unloaded').length;
    const unbilledTbb = dockets.filter((d) => !d.billed && d.payMode === 'TBB').length;
    const topayPendingAmt = dockets
      .filter((d) => d.payMode === 'To-Pay' && d.stockStage !== 'Delivered')
      .reduce((s, d) => s + Number(d.totalAmount || 0), 0);
    const vehAlerts = vehicles.filter((v) =>
      [v.fitnessExpiry, v.insuranceExpiry, v.permitExpiry, v.roadTaxExpiry, v.pucExpiry].some((dt) => {
        const d = daysUntilDate(dt);
        return d !== null && d <= 15;
      })
    ).length;
    const drvAlerts = drivers.filter((dr) => {
      const d = daysUntilDate(dr.dlExpiry);
      return d !== null && d <= 15;
    }).length;
    const ewbAlerts = dockets.filter((d) => {
      const st = getEwayBillExpiryState(d.ewayBillValidUpto);
      return st.status === 'expired' || st.status === 'expiringSoon';
    }).length;

    return {
      totalDockets: dockets.length,
      inGodownPkgs,
      activeManifests,
      unbilledTbb,
      topayPendingAmt,
      totalComplianceAlerts: vehAlerts + drvAlerts + ewbAlerts,
    };
  }, [dockets, manifests, vehicles, drivers]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden bg-[#F0FDFA]">
      {/* Isolated Division Sub-Navigation Header */}
      <div className="bg-gradient-to-r from-[#0F766E] via-[#0D9488] to-[#0B3B8C] text-white px-3 md:px-5 py-2 shadow-sm flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-2 min-w-0">
          <Boxes className="w-5 h-5 text-amber-300 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-extrabold tracking-wide leading-none truncate">
              {divisionMeta.title.toUpperCase()}
            </h2>
            <p className="text-[10px] text-teal-100 mt-0.5 truncate">
              100% Isolated {divisionMeta.shortLabel} Dockets, Manifests &amp; Ledgers · {activeFy}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {logiTabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeLogiTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveLogiTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                  selected
                    ? 'bg-amber-400 text-slate-950 shadow-sm'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Division Content */}
      <div className="flex-1 p-3 md:p-4 overflow-y-auto overflow-x-hidden space-y-4">
        {activeLogiTab !== 'overview' && (
          <div className="flex flex-wrap items-center justify-between gap-2 no-print">
            <button
              type="button"
              onClick={() => setActiveLogiTab('overview')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-teal-300 hover:bg-teal-50 text-[#0F766E] text-xs font-extrabold shadow-sm cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to {divisionMeta.shortLabel} Dashboard</span>
            </button>
            <span className="text-[11px] font-bold text-slate-500">
              Active Workspace: {divisionMeta.title} ({activeFy})
            </span>
          </div>
        )}

        {activeLogiTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="bg-white rounded-xl border border-teal-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Total Dockets</div>
                <div className="text-2xl font-extrabold font-mono-num text-[#0F766E] mt-0.5">
                  {stats.totalDockets}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-teal-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Godown Stock</div>
                <div className="text-2xl font-extrabold font-mono-num text-[#0D47A1] mt-0.5">
                  {stats.inGodownPkgs} <span className="text-xs font-bold">Pkgs</span>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-teal-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Line-Haul Active</div>
                <div className="text-2xl font-extrabold font-mono-num text-amber-700 mt-0.5">
                  {stats.activeManifests}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-teal-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Unbilled TBB</div>
                <div className="text-2xl font-extrabold font-mono-num text-indigo-700 mt-0.5">
                  {stats.unbilledTbb}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-teal-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500 uppercase">To-Pay COD Due</div>
                <div className="text-lg font-extrabold font-mono-num text-red-700 mt-1">
                  ₹{formatINR(stats.topayPendingAmt)}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-teal-200 p-3.5 shadow-sm">
                <div className="text-[11px] font-bold text-slate-500 uppercase">15d Alerts / EWB</div>
                <div className="text-2xl font-extrabold font-mono-num text-red-600 mt-0.5 flex items-center gap-1.5">
                  {stats.totalComplianceAlerts}
                  {stats.totalComplianceAlerts > 0 && <AlertTriangle className="w-4 h-4" />}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => setActiveLogiTab('allInOne')}
                className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 hover:border-amber-600 text-left shadow-sm cursor-pointer transition-all"
              >
                <ClipboardList className="w-6 h-6 text-amber-600 mb-2" />
                <div className="text-sm font-extrabold text-slate-900">
                  A. Bilty &amp; Lorry Master Sheet
                </div>
                <div className="text-xs text-slate-700 mt-0.5">
                  Unified Docket/LR + Lorry Hire + Broker + Staff Chart + Pay 1–12 Tracker
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveLogiTab('docket')}
                className="p-4 rounded-xl bg-white border-2 border-teal-200 hover:border-[#0F766E] text-left shadow-sm cursor-pointer transition-all"
              >
                <Package className="w-6 h-6 text-teal-600 mb-2" />
                <div className="text-sm font-extrabold text-slate-900">
                  {divisionMode === 'COURIER' ? 'Courier Docket / AWB' : 'Parcel Docket / LR'}
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Per Kg / Per Pkg booking, EWB QR scan &amp; Verify QR A4 Docket PDF
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveLogiTab('manifest')}
                className="p-4 rounded-xl bg-white border-2 border-blue-200 hover:border-[#0D47A1] text-left shadow-sm cursor-pointer transition-all"
              >
                <Truck className="w-6 h-6 text-blue-600 mb-2" />
                <div className="text-sm font-extrabold text-slate-900">Line-Haul Dispatch Manifest</div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Bundle hub dockets into tempo/truck challans &amp; mark Arrival Unload
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveLogiTab('godown')}
                className="p-4 rounded-xl bg-white border-2 border-purple-200 hover:border-purple-600 text-left shadow-sm cursor-pointer transition-all"
              >
                <Warehouse className="w-6 h-6 text-purple-600 mb-2" />
                <div className="text-sm font-extrabold text-slate-900">Branch Godown Stock &amp; POD</div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Live bay stock register, To-Pay COD gate-pass &amp; camera POD capture
                </div>
              </button>
              <button
                type="button"
                onClick={() => setActiveLogiTab('billing')}
                className="p-4 rounded-xl bg-white border-2 border-emerald-200 hover:border-emerald-700 text-left shadow-sm cursor-pointer transition-all"
              >
                <FileText className="w-6 h-6 text-emerald-600 mb-2" />
                <div className="text-sm font-extrabold text-slate-900">
                  B. {divisionMeta.shortLabel} Tax Invoice, CN &amp; DN
                </div>
                <div className="text-xs text-slate-600 mt-0.5">
                  Monthly TBB Tax Invoices, Credit Notes &amp; Debit Notes with Bank QR
                </div>
              </button>
            </div>
          </div>
        )}

        {activeLogiTab === 'allInOne' && (
          <AllInOneEntrySheet
            divisionMode={divisionMode}
            ownerUid={ownerUid}
            activeStaffCode={activeStaffCode}
            activeStaffName={activeStaffName}
            activeBranchCode={activeBranchCode}
            activeFy={activeFy}
            isMasterAdmin={isMasterAdmin}
            parties={ftlParties}
            vehicles={ftlVehicles}
            drivers={ftlDrivers}
            staffAccounts={staffAccounts}
            consignments={[]}
            lorryHires={lorryHires}
            staffCommissions={staffCommissions}
            invoices={[]}
            logisticsDockets={dockets}
            logisticsInvoices={invoices}
            logisticsParties={parties}
            logisticsVehicles={vehicles}
            logisticsDrivers={drivers}
            company={company}
            onPreviewPdf={(pdf: GeneratedPdfResult, folder: AnyDriveFolderName) =>
              onPreviewPdf(pdf, folder as LogisticsDriveFolderName)
            }
            onShowConfirm={onShowConfirm}
            onExitToDashboard={() => setActiveLogiTab('overview')}
          />
        )}

        {(activeLogiTab === 'docket' || activeLogiTab === 'manifest' || activeLogiTab === 'godown') && (
          <LogisticsDocketManifestPanel
            divisionMode={divisionMode}
            subView={activeLogiTab}
            ownerUid={ownerUid}
            activeStaffCode={activeStaffCode}
            activeBranchCode={activeBranchCode}
            activeFy={activeFy}
            dockets={dockets}
            manifests={manifests}
            parties={parties}
            vehicles={vehicles}
            drivers={drivers}
            company={company}
            driveAccessToken={driveAccessToken}
            onPreviewPdf={onPreviewPdf}
            onShowConfirm={onShowConfirm}
          />
        )}

        {(activeLogiTab === 'billing' || activeLogiTab === 'ledgers') && (
          <LogisticsBillingLedgerPanel
            divisionMode={divisionMode}
            subView={activeLogiTab}
            ownerUid={ownerUid}
            activeStaffCode={activeStaffCode}
            activeBranchCode={activeBranchCode}
            activeFy={activeFy}
            dockets={dockets}
            invoices={invoices}
            ledgers={ledgers}
            parties={parties}
            company={company}
            onPreviewPdf={onPreviewPdf}
            onShowConfirm={onShowConfirm}
          />
        )}

        {activeLogiTab === 'pdfVault' && (
          <PdfStoreVaultPanel
            company={company}
            parties={ftlParties}
            logisticsParties={parties}
            defaultDivision={divisionMode}
            driveAccessToken={driveAccessToken}
            connectedEmail={connectedEmail}
            onConnectDrive={onConnectDrive}
            onPreviewPdf={onPreviewPdf}
            titleSubtitle={`${divisionMeta.title} · 5 Segregated Date-Grouped Binary PDF Folders`}
          />
        )}

        {activeLogiTab === 'backup' && !isMasterAdmin ? (
          <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto font-extrabold">
              🔒
            </div>
            <h3 className="text-sm font-extrabold text-slate-900">
              Master Admin Security Lock — Backup &amp; Restore
            </h3>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Drive Backup, Daily Snapshot &amp; JSON Restore are strictly locked behind Master Admin PIN + 2FA OTP verification.
            </p>
          </div>
        ) : (
          (activeLogiTab === 'masters' || activeLogiTab === 'backup') && (
            <LogisticsMastersDrivePanel
              divisionMode={divisionMode}
              subView={activeLogiTab}
              ownerUid={ownerUid}
              activeBranchCode={activeBranchCode}
              parties={parties}
              vehicles={vehicles}
              drivers={drivers}
              dockets={dockets}
              manifests={manifests}
              invoices={invoices}
              ledgers={ledgers}
              connectedEmail={connectedEmail}
              driveAccessToken={driveAccessToken}
              onConnectDrive={onConnectDrive}
              onShowConfirm={onShowConfirm}
            />
          )
        )}
      </div>
    </div>
  );
};

