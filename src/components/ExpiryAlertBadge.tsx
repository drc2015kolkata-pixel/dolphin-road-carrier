import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Search,
  ShieldAlert,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import { ConsignmentNote, Driver, LorryHire, Vehicle } from '../types/erp';
import { evaluateExpiryAlerts, ExpiryAlertCategory, ExpiryAlertItem } from '../lib/expiryAlertEngine';

interface ExpiryAlertBadgeProps {
  vehicles?: Vehicle[];
  drivers?: Driver[];
  consignments?: ConsignmentNote[];
  lorryHires?: LorryHire[];
  filterTruckNo?: string;
  filterDriverName?: string;
  draftVehicle?: {
    truckNo?: string;
    driverName?: string;
    driverDlNo?: string;
    driverDlExpiry?: string;
    cnNo?: string;
    ewayBillNo?: string;
    ewayBillValidUpto?: string;
  };
  scopeLabel?: string;
  compact?: boolean;
  onOpenMasterVehicles?: () => void;
  onOpenMasterDrivers?: () => void;
  onOpenLrScreen?: () => void;
}

type ModalFilter = 'all' | 'expired' | 'expiringSoon' | ExpiryAlertCategory;

export const ExpiryAlertBadge: React.FC<ExpiryAlertBadgeProps> = ({
  vehicles = [],
  drivers = [],
  consignments = [],
  lorryHires = [],
  filterTruckNo,
  filterDriverName,
  draftVehicle,
  scopeLabel,
  compact = false,
  onOpenMasterVehicles,
  onOpenMasterDrivers,
  onOpenLrScreen,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<ModalFilter>('all');
  const [search, setSearch] = useState('');

  const summary = useMemo(
    () =>
      evaluateExpiryAlerts({
        vehicles,
        drivers,
        consignments,
        lorryHires,
        filterTruckNo,
        filterDriverName,
        draftVehicle,
      }),
    [vehicles, drivers, consignments, lorryHires, filterTruckNo, filterDriverName, draftVehicle]
  );

  // Also keep full-fleet summary ready if scoped badge has an "All Fleet" view button inside modal
  const fleetSummary = useMemo(() => {
    if (!filterTruckNo && !filterDriverName) return summary;
    return evaluateExpiryAlerts({
      vehicles,
      drivers,
      consignments,
      lorryHires,
      draftVehicle,
    });
  }, [vehicles, drivers, consignments, lorryHires, draftVehicle, filterTruckNo, filterDriverName, summary]);

  const [viewAllFleetInModal, setViewAllFleetInModal] = useState(false);
  const activeSummary = viewAllFleetInModal ? fleetSummary : summary;

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeSummary.items.filter((item) => {
      if (filterMode === 'expired' && item.severity !== 'expired') return false;
      if (filterMode === 'expiringSoon' && item.severity !== 'expiringSoon') return false;
      if (
        (filterMode === 'vehicle' || filterMode === 'driver' || filterMode === 'eway') &&
        item.category !== filterMode
      ) {
        return false;
      }
      if (!q) return true;
      return `${item.entityLabel} ${item.subLabel || ''} ${item.docType} ${item.docNumber || ''} ${item.statusLabel}`
        .toLowerCase()
        .includes(q);
    });
  }, [activeSummary.items, filterMode, search]);

  const hasExpired = summary.expiredCount > 0;
  const hasSoon = summary.expiringSoonCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setViewAllFleetInModal(false);
          setModalOpen(true);
        }}
        title="Open Vehicle Document (RC/Ins/Fit/Permit/PUC/Tax), Driver DL & E-Way Bill Expiry Alert Center"
        className={`inline-flex items-center gap-1.5 rounded-lg font-bold border transition-colors cursor-pointer whitespace-nowrap ${
          compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } ${
          hasExpired
            ? 'bg-red-50 hover:bg-red-100 text-red-800 border-red-300'
            : hasSoon
            ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
        }`}
      >
        {hasExpired ? (
          <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0" />
        ) : hasSoon ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        )}

        <span>{scopeLabel ? `${scopeLabel}: ` : 'Docs & EWB: '}</span>

        {summary.totalCount === 0 ? (
          <span>0 Expiry Alerts</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono-num">
            {summary.expiredCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-extrabold">
                {summary.expiredCount} Expired
              </span>
            )}
            {summary.expiringSoonCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-extrabold">
                {summary.expiringSoonCount} ≤7d
              </span>
            )}
          </span>
        )}
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-extrabold flex items-center gap-2">
                  <FileWarning className="w-4 h-4 text-amber-300 shrink-0" />
                  <span className="truncate">
                    Vehicle Document &amp; E-Way Bill Expiry Alert Center
                  </span>
                </h3>
                <p className="text-[11px] text-blue-100 truncate">
                  Tracks RC, Insurance, Fitness, National/State Permit, PUC, Road Tax, Driver DL &amp; Active E-Way Bill Valid Upto
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer shrink-0"
                aria-label="Close Expiry Alert Center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* KPI Summary + Scope Switch */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-100 text-red-900 border border-red-300 font-extrabold font-mono-num">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                  Red · Expired: {activeSummary.expiredCount}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 border border-amber-300 font-extrabold font-mono-num">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  Amber · ≤7 Days: {activeSummary.expiringSoonCount}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white text-slate-700 border border-slate-200 font-semibold font-mono-num">
                  E-Way Bills: {activeSummary.ewayAlertCount}
                </span>
              </div>

              {(filterTruckNo || filterDriverName) && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setViewAllFleetInModal(false)}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      !viewAllFleetInModal
                        ? 'bg-[#0D47A1] text-white'
                        : 'bg-white border border-slate-300 text-slate-700'
                    }`}
                  >
                    Current Truck / LR ({summary.totalCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewAllFleetInModal(true)}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      viewAllFleetInModal
                        ? 'bg-[#0D47A1] text-white'
                        : 'bg-white border border-slate-300 text-slate-700'
                    }`}
                  >
                    Full Fleet ({fleetSummary.totalCount})
                  </button>
                </div>
              )}
            </div>

            {/* Filters & Search */}
            <div className="p-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    ['all', `All (${activeSummary.totalCount})`],
                    ['expired', `Expired (${activeSummary.expiredCount})`],
                    ['expiringSoon', `≤7 Days (${activeSummary.expiringSoonCount})`],
                    ['vehicle', 'Vehicle Docs'],
                    ['driver', 'Driver DL'],
                    ['eway', 'E-Way Bills'],
                  ] as Array<[ModalFilter, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilterMode(id)}
                    className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-colors ${
                      filterMode === id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Truck, Driver, CN, Doc..."
                  className="pl-8 pr-3 py-1 rounded-lg border border-slate-300 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {filteredItems.length === 0 ? (
                <div className="p-10 text-center space-y-2 text-slate-600">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                  <p className="text-sm font-bold text-slate-900">
                    All Checked Documents &amp; Active E-Way Bills Are Clear
                  </p>
                  <p className="text-xs text-slate-500">
                    No expired documents or renewals due within the next 7 days.
                  </p>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-left">Vehicle / Driver / LR</th>
                      <th className="px-3 py-2 text-left">Document</th>
                      <th className="px-3 py-2 text-left">Expiry / Valid Upto</th>
                      <th className="px-3 py-2 text-left">Alert Status</th>
                      <th className="px-3 py-2 text-right">Quick Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item: ExpiryAlertItem) => (
                      <tr
                        key={item.id}
                        className={
                          item.severity === 'expired'
                            ? 'bg-red-50/45 hover:bg-red-50'
                            : 'bg-amber-50/35 hover:bg-amber-50'
                        }
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                            {item.category === 'vehicle' ? (
                              <Truck className="w-3.5 h-3.5 text-blue-700" />
                            ) : item.category === 'driver' ? (
                              <UserCheck className="w-3.5 h-3.5 text-teal-700" />
                            ) : (
                              <FileWarning className="w-3.5 h-3.5 text-amber-700" />
                            )}
                            {item.category === 'vehicle'
                              ? 'Vehicle'
                              : item.category === 'driver'
                              ? 'Driver'
                              : 'E-Way Bill'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-mono-num font-extrabold text-slate-900">
                            {item.entityLabel}
                          </div>
                          {item.subLabel && (
                            <div className="text-[10px] text-slate-500">{item.subLabel}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-bold text-slate-800">{item.docType}</div>
                          {item.docNumber && (
                            <div className="text-[10px] font-mono-num text-slate-500">
                              No: {item.docNumber}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono-num font-semibold text-slate-800 whitespace-nowrap">
                          {item.expiryDisplay}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-extrabold text-[11px] ${
                              item.severity === 'expired'
                                ? 'bg-red-600 text-white'
                                : 'bg-amber-400 text-slate-950'
                            }`}
                          >
                            {item.statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {item.category === 'vehicle' && onOpenMasterVehicles && (
                            <button
                              type="button"
                              onClick={() => {
                                setModalOpen(false);
                                onOpenMasterVehicles();
                              }}
                              className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-blue-800 font-bold hover:bg-blue-100 cursor-pointer"
                            >
                              Update Vehicle
                            </button>
                          )}
                          {item.category === 'driver' && onOpenMasterDrivers && (
                            <button
                              type="button"
                              onClick={() => {
                                setModalOpen(false);
                                onOpenMasterDrivers();
                              }}
                              className="px-2 py-1 rounded bg-teal-50 border border-teal-200 text-teal-800 font-bold hover:bg-teal-100 cursor-pointer"
                            >
                              Update DL
                            </button>
                          )}
                          {item.category === 'eway' && onOpenLrScreen && (
                            <button
                              type="button"
                              onClick={() => {
                                setModalOpen(false);
                                onOpenLrScreen();
                              }}
                              className="px-2 py-1 rounded bg-amber-50 border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 cursor-pointer"
                            >
                              Open LR / EWB
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
              <span>
                Note: E-Way Bills for consignments with POD Received or Unloading Date recorded are automatically excluded.
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-1 rounded-md bg-slate-900 text-white font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
