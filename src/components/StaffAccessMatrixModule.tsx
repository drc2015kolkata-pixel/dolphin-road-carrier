import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  logBranchActivity,
  upsertDocument,
} from '../lib/firestoreStore';
import {
  SHEET_PERMISSION_DEFINITIONS,
  SheetAccessLevel,
  SheetPermissionKey,
  StaffAccount,
} from '../types/erp';
import { SearchableSelect } from './SearchableSelect';

interface StaffAccessMatrixModuleProps {
  staffAccounts: StaffAccount[];
  ownerUid: string;
  currentStaffCode: string;
  currentBranchCode: string;
}

const ACCESS_OPTIONS: Array<{
  value: SheetAccessLevel;
  label: string;
  badgeClass: string;
}> = [
  {
    value: 'blocked',
    label: 'Blocked (No Access)',
    badgeClass: 'bg-red-100 text-red-800 border-red-300',
  },
  {
    value: 'view',
    label: 'View Only',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  {
    value: 'edit',
    label: 'View & Edit',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
];

export const StaffAccessMatrixModule: React.FC<StaffAccessMatrixModuleProps> = ({
  staffAccounts,
  ownerUid,
  currentStaffCode,
  currentBranchCode,
}) => {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return staffAccounts;
    return staffAccounts.filter((s) =>
      `${s.displayName} ${s.staffCode} ${s.role} ${s.branchCode || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [staffAccounts, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedStaff = useMemo(
    () => filteredStaff.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredStaff, safePage]
  );

  const resolveCurrentLevel = (
    staff: StaffAccount,
    key: SheetPermissionKey
  ): SheetAccessLevel => {
    if (staff.role === 'Admin') return 'edit';
    if (staff.sheetPermissions && staff.sheetPermissions[key]) {
      return staff.sheetPermissions[key] as SheetAccessLevel;
    }
    const legacyMap: Record<SheetPermissionKey, string> = {
      lr: 'lr',
      billing: 'billing',
      lorryHire: 'lorryHire',
      commission: 'lorryHire',
      accounts: 'accounts',
      master: 'master',
      bankImport: 'accounts',
      reports: 'reports',
      quotations: 'billing',
      declarations: 'billing',
      settings: 'settings',
    };
    if (staff.permissions?.includes(legacyMap[key] as never)) {
      return staff.role === 'Viewer' ? 'view' : 'edit';
    }
    return 'blocked';
  };

  const handlePermissionChange = async (
    staff: StaffAccount,
    sheetKey: SheetPermissionKey,
    nextLevel: SheetAccessLevel
  ) => {
    setSavingId(`${staff.id}_${sheetKey}`);
    setStatusMsg(null);
    try {
      const nextSheetPermissions: Partial<Record<SheetPermissionKey, SheetAccessLevel>> = {
        ...(staff.sheetPermissions || {}),
      };
      for (const def of SHEET_PERMISSION_DEFINITIONS) {
        if (!nextSheetPermissions[def.key]) {
          nextSheetPermissions[def.key] = resolveCurrentLevel(staff, def.key);
        }
      }
      nextSheetPermissions[sheetKey] = nextLevel;

      await upsertDocument(
        'staff_accounts',
        staff.id,
        {
          ...staff,
          sheetPermissions: nextSheetPermissions,
          ownerUid,
        },
        false
      );

      await logBranchActivity({
        action: 'UPDATE_ACCESS_MATRIX',
        module: 'STAFF_ACCESS_CONTROL',
        docRefCode: staff.staffCode,
        summary: `Set ${staff.displayName} access on "${sheetKey}" to ${nextLevel.toUpperCase()}`,
        staffCode: currentStaffCode,
        branchCode: currentBranchCode,
        ownerUid,
      });

      setStatusMsg(
        `Updated ${staff.displayName} (${staff.staffCode}) — ${sheetKey.toUpperCase()} is now ${nextLevel.toUpperCase()}.`
      );
    } finally {
      setSavingId(null);
    }
  };

  const applyPresetToStaff = async (
    staff: StaffAccount,
    preset: 'all-edit' | 'all-view' | 'all-blocked'
  ) => {
    setSavingId(staff.id);
    setStatusMsg(null);
    const level: SheetAccessLevel =
      preset === 'all-edit' ? 'edit' : preset === 'all-view' ? 'view' : 'blocked';
    const nextSheetPermissions: Partial<Record<SheetPermissionKey, SheetAccessLevel>> = {};
    for (const def of SHEET_PERMISSION_DEFINITIONS) {
      nextSheetPermissions[def.key] = level;
    }
    try {
      await upsertDocument(
        'staff_accounts',
        staff.id,
        {
          ...staff,
          sheetPermissions: nextSheetPermissions,
          ownerUid,
        },
        false
      );
      setStatusMsg(
        `Applied "${level.toUpperCase()}" across all sheets for ${staff.displayName}.`
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border-2 border-indigo-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 text-white flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                Staff Sheet Access Control Matrix ({staffAccounts.length} Accounts)
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Control exactly which sheets each staff member can View &amp; Edit, View Only, or is Blocked from opening. Changes apply instantly.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded border bg-emerald-50 text-emerald-800 border-emerald-300">
              <UserCheck className="w-3.5 h-3.5" /> View &amp; Edit
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded border bg-amber-50 text-amber-800 border-amber-300">
              <Eye className="w-3.5 h-3.5" /> View Only
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded border bg-red-50 text-red-800 border-red-300">
              <Lock className="w-3.5 h-3.5" /> Blocked
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search 100+ staff by Name, Staff Code, Role, Branch..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {filteredStaff.length > pageSize && (
            <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
              <span>
                Page {safePage} / {totalPages} ({filteredStaff.length} staff)
              </span>
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                aria-label="Previous staff page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                aria-label="Next staff page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {statusMsg && (
          <div className="mt-3 px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}
      </div>

      {staffAccounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-600">
          No staff IDs configured yet. Create branch staff logins in Settings &rarr; Staff IDs &amp; Roles first.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-3 font-bold sticky left-0 bg-slate-900 z-10 min-w-[210px] border-r border-slate-700">
                  Staff Member / Branch
                </th>
                {SHEET_PERMISSION_DEFINITIONS.map((def) => (
                  <th key={def.key} className="p-2.5 font-bold text-center min-w-[125px] border-r border-slate-700">
                    {def.shortLabel}
                  </th>
                ))}
                <th className="p-2.5 font-bold text-center min-w-[160px]">Quick Presets</th>
              </tr>
            </thead>
            <tbody>
              {pagedStaff.map((staff) => {
                const isAdminRole = staff.role === 'Admin';
                return (
                  <tr
                    key={staff.id}
                    className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <td className="p-3 sticky left-0 bg-white z-10 border-r border-slate-200">
                      <div className="font-bold text-slate-900">{staff.displayName}</div>
                      <div className="text-[11px] text-slate-600 font-mono-num mt-0.5">
                        {staff.staffCode} · {staff.role} · {staff.branchCode || 'ALL'}
                        {staff.active === false && (
                          <span className="ml-1.5 text-red-700 font-bold">(INACTIVE)</span>
                        )}
                      </div>
                    </td>

                    {SHEET_PERMISSION_DEFINITIONS.map((def) => {
                      const cur = resolveCurrentLevel(staff, def.key);
                      const matchedOpt =
                        ACCESS_OPTIONS.find((o) => o.value === cur) || ACCESS_OPTIONS[0];
                      return (
                        <td
                          key={def.key}
                          className="p-2 text-center border-r border-slate-100"
                        >
                          {isAdminRole ? (
                            <span className="inline-block px-2 py-1 rounded border bg-emerald-100 text-emerald-900 border-emerald-300 font-bold text-[11px]">
                              Admin Full Access
                            </span>
                          ) : (
                            <SearchableSelect
                              ariaLabel={`${staff.displayName} ${def.label} access`}
                              value={cur}
                              disabled={savingId === `${staff.id}_${def.key}`}
                              sortAlphabetically={false}
                              onChange={(val) =>
                                void handlePermissionChange(
                                  staff,
                                  def.key,
                                  val as SheetAccessLevel
                                )
                              }
                              options={ACCESS_OPTIONS.map((opt) => ({
                                value: opt.value,
                                label: opt.label,
                              }))}
                              buttonClassName={`!py-1 !text-[11px] !font-bold ${matchedOpt.badgeClass}`}
                            />
                          )}
                        </td>
                      );
                    })}

                    <td className="p-2 text-center">
                      {!isAdminRole && (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            disabled={savingId === staff.id}
                            onClick={() => void applyPresetToStaff(staff, 'all-edit')}
                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            All Edit
                          </button>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={savingId === staff.id}
                              onClick={() => void applyPresetToStaff(staff, 'all-view')}
                              className="flex-1 px-1.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold cursor-pointer"
                            >
                              All View
                            </button>
                            <button
                              type="button"
                              disabled={savingId === staff.id}
                              onClick={() => void applyPresetToStaff(staff, 'all-blocked')}
                              className="flex-1 px-1.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold cursor-pointer"
                            >
                              Block All
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
