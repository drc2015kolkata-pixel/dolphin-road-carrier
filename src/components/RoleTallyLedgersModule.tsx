import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  FileText,
  Lock,
  Printer,
  Save,
  ScanLine,
  Share2,
  Truck,
  Users,
} from 'lucide-react';
import {
  BankReceiptRecord,
  CompanySettings,
  ConsignmentNote,
  Driver,
  Invoice,
  LorryHire,
  Party,
  StaffAccount,
  StaffCommissionEntry,
  TransactionRecord,
  TripExpenseRecord,
  Vehicle,
} from '../types/erp';
import {
  computeBrokerTripSheet,
  computeStaffDualLedgers,
  computeStaffMonthlySummary,
  computeTallyRoleLedger,
  buildRoleTripDirectory,
  LedgerQuickPeriod,
  LedgerRoleType,
  resolveQuickPeriodDates,
  RoleTripSummaryItem,
} from '../lib/tallyLedgerEngine';
import {
  formatDateDDMMYYYY,
  formatINR,
  normalizeFyLabel,
  roundPaise,
  todayISO,
} from '../lib/formatters';
import { saveSettingsDocument, upsertDocument } from '../lib/firestoreStore';
import {
  downloadPdfDirect,
  GeneratedPdfResult,
  generateTallyRoleLedgerPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import { DriveRoleCategory, uploadRoleOrganizedPdfToDrive } from '../lib/driveBackup';
import { RichEntityPicker } from './RichEntityPicker';
import { SearchableSelect } from './SearchableSelect';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { ExpiryAlertBadge } from './ExpiryAlertBadge';
import { TripProfitCalculatorPanel } from './TripProfitCalculatorPanel';

interface RoleTallyLedgersModuleProps {
  ownerUid: string;
  activeFy: string;
  company: CompanySettings;
  hasCustomSettings?: boolean;
  parties: Party[];
  vehicles: Vehicle[];
  drivers: Driver[];
  consignments: ConsignmentNote[];
  invoices: Invoice[];
  lorryHires: LorryHire[];
  transactions: TransactionRecord[];
  bankReceipts: BankReceiptRecord[];
  staffAccounts: StaffAccount[];
  staffCommissions: StaffCommissionEntry[];
  tripExpenses?: TripExpenseRecord[];
  hasDriveToken: boolean;
  driveAccessToken: string | null;
  connectedDriveEmail?: string | null;
  initialRole?: LedgerRoleType;
  initialAccountName?: string;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'Reports_Ledgers') => void;
  onOpenPodScanner: () => void;
  onRectifyVoucher?: (voucherType: string, voucherNo: string) => void;
  onRectifyLorryHire?: (hire: LorryHire) => void;
}

const ROLE_TABS: Array<{ id: LedgerRoleType; label: string; driveCat: DriveRoleCategory }> = [
  { id: 'party', label: '1. Party Account (Tally)', driveCat: 'PARTY' },
  { id: 'broker', label: '2. Broker & Trip Sheet', driveCat: 'BROKER' },
  { id: 'owner', label: '3. Lorry Owner & Trips', driveCat: 'OWNER' },
  { id: 'driver', label: '4. Driver & Trips', driveCat: 'DRIVER' },
  { id: 'vehicle', label: '5. Vehicle & Trips', driveCat: 'VEHICLES' },
  { id: 'staff', label: '6. Staff Dual-Ledger', driveCat: 'STAFF' },
];

export const RoleTallyLedgersModule: React.FC<RoleTallyLedgersModuleProps> = ({
  ownerUid,
  activeFy,
  company,
  hasCustomSettings = false,
  parties,
  vehicles,
  drivers,
  consignments,
  invoices,
  lorryHires,
  transactions,
  bankReceipts,
  staffAccounts,
  staffCommissions,
  tripExpenses = [],
  hasDriveToken,
  driveAccessToken,
  connectedDriveEmail,
  initialRole,
  initialAccountName,
  onPreviewPdf,
  onOpenPodScanner,
  onRectifyVoucher,
  onRectifyLorryHire,
}) => {
  const [activeRole, setActiveRole] = useState<LedgerRoleType>(initialRole || 'party');
  const [vehicleSubView, setVehicleSubView] = useState<'ledger' | 'tripProfit'>('ledger');
  const [selectedName, setSelectedName] = useState(initialAccountName || '');
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [quickPeriod, setQuickPeriod] = useState<LedgerQuickPeriod>('FY');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [openBalInput, setOpenBalInput] = useState('');
  const [openSideInput, setOpenSideInput] = useState<'Dr' | 'Cr'>('Dr');
  const [brokerScope, setBrokerScope] = useState<'single' | 'all'>('single');
  const [directorySortAlpha, setDirectorySortAlpha] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialRole) setActiveRole(initialRole);
    if (initialAccountName) setSelectedName(initialAccountName);
  }, [initialRole, initialAccountName]);

  const directory = useMemo<RoleTripSummaryItem[]>(() => {
    return buildRoleTripDirectory({
      role: activeRole,
      fy: activeFy,
      company,
      parties,
      vehicles,
      drivers,
      consignments,
      invoices,
      lorryHires,
      transactions,
      bankReceipts,
      staffAccounts,
      staffCommissions,
    });
  }, [
    activeRole,
    activeFy,
    company,
    parties,
    vehicles,
    drivers,
    consignments,
    invoices,
    lorryHires,
    transactions,
    bankReceipts,
    staffAccounts,
    staffCommissions,
  ]);

  // Keep a valid account selected automatically when switching roles
  useEffect(() => {
    if (directory.length === 0) {
      setSelectedName('');
      setSelectedEntityId('');
      return;
    }
    const found = directory.find(
      (d) => d.name.trim().toLowerCase() === selectedName.trim().toLowerCase()
    );
    if (found) {
      setSelectedEntityId(found.entityId || '');
    } else if (!selectedName.trim()) {
      setSelectedName(directory[0].name);
      setSelectedEntityId(directory[0].entityId || '');
    }
  }, [directory, selectedName]);

  const { dateFrom, dateTo } = useMemo(
    () => resolveQuickPeriodDates(quickPeriod, activeFy, customFrom, customTo),
    [quickPeriod, activeFy, customFrom, customTo]
  );

  const statement = useMemo(() => {
    if (!selectedName.trim()) return null;
    return computeTallyRoleLedger({
      role: activeRole,
      accountName: selectedName,
      entityId: selectedEntityId || undefined,
      fy: activeFy,
      dateFrom,
      dateTo,
      company,
      parties,
      consignments,
      invoices,
      lorryHires,
      transactions,
      bankReceipts,
      staffCommissions,
      vehicles,
      drivers,
    });
  }, [
    activeRole,
    selectedName,
    selectedEntityId,
    activeFy,
    dateFrom,
    dateTo,
    company,
    parties,
    consignments,
    invoices,
    lorryHires,
    transactions,
    bankReceipts,
    staffCommissions,
    vehicles,
    drivers,
  ]);

  const staffSummary = useMemo(() => {
    if (activeRole !== 'staff' || !selectedName.trim()) return null;
    return computeStaffMonthlySummary(selectedName, activeFy, staffCommissions);
  }, [activeRole, selectedName, activeFy, staffCommissions]);

  const staffDualLedger = useMemo(() => {
    if (activeRole !== 'staff' || !selectedName.trim()) return null;
    return computeStaffDualLedgers({
      staffName: selectedName,
      entityId: selectedEntityId || undefined,
      fy: activeFy,
      dateFrom,
      dateTo,
      company,
      staffCommissions,
      transactions,
      staffAccounts,
    });
  }, [activeRole, selectedName, selectedEntityId, activeFy, dateFrom, dateTo, company, staffCommissions, transactions, staffAccounts]);

  const brokerTripSheet = useMemo(() => {
    if (activeRole !== 'broker') return null;
    return computeBrokerTripSheet({
      brokerName: brokerScope === 'all' ? 'ALL' : selectedName,
      dateFrom,
      dateTo,
      lorryHires,
    });
  }, [activeRole, brokerScope, selectedName, dateFrom, dateTo, lorryHires]);

  const roleTripSheetRows = useMemo(() => {
    if (activeRole !== 'owner' && activeRole !== 'driver' && activeRole !== 'vehicle') {
      return [];
    }
    const targetNorm = selectedName.trim().toLowerCase().replace(/\s+/g, ' ');
    const truckNorm = selectedName.trim().toUpperCase().replace(/\s+/g, '');
    if (!targetNorm) return [];

    if (activeRole === 'driver') {
      return consignments
        .filter((cn) => {
          const dNorm = String(cn.driverName || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (dNorm !== targetNorm) return false;
          const dt = cn.cnDate || '';
          if (dateFrom && dt && dt < dateFrom) return false;
          if (dateTo && dt && dt > dateTo) return false;
          return true;
        })
        .map((cn) => {
          const lh = lorryHires.find(
            (x) => (x.cnNo || '').trim().toUpperCase() === (cn.cnNo || '').trim().toUpperCase()
          );
          return {
            id: cn.id,
            cnNo: cn.cnNo,
            date: cn.cnDate || todayISO(),
            truckNo: cn.truckNo || '-',
            partyOrOwner: cn.ownerName || cn.consignorName || '-',
            route: `${cn.fromCity || '-'} → ${cn.toCity || '-'}`,
            grossAmt: Number(lh?.hireAmount ?? cn.totalFreight ?? 0),
            advAmt: Number(lh?.advancePaid || 0) + Number(lh?.extraAdvanceAmt || 0),
            balAmt: Number(lh?.balancePayable || 0),
            podReceived: Boolean(lh?.podReceived),
            balancePaid: Boolean(lh?.balancePaid),
            hireRecord: lh,
          };
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.cnNo.localeCompare(a.cnNo));
    }

    const matchedHires = lorryHires.filter((lh) => {
      const dt = lh.cnDate || '';
      if (dateFrom && dt && dt < dateFrom) return false;
      if (dateTo && dt && dt > dateTo) return false;
      if (activeRole === 'owner') {
        return String(lh.ownerName || '').trim().toLowerCase().replace(/\s+/g, ' ') === targetNorm;
      }
      return String(lh.truckNo || '').trim().toUpperCase().replace(/\s+/g, '') === truckNorm;
    });

    const seenCn = new Set(matchedHires.map((lh) => (lh.cnNo || '').trim().toUpperCase()));
    const rows = matchedHires.map((lh) => ({
      id: lh.id,
      cnNo: lh.cnNo,
      date: lh.cnDate || todayISO(),
      truckNo: lh.truckNo || '-',
      partyOrOwner: activeRole === 'owner' ? lh.truckNo || '-' : lh.ownerName || lh.brokerName || '-',
      route: `${lh.fromCity || '-'} → ${lh.toCity || '-'}`,
      grossAmt: Number(lh.hireAmount || 0),
      advAmt: Number(lh.advancePaid || 0) + Number(lh.extraAdvanceAmt || 0),
      balAmt: Number(lh.balancePayable || 0),
      podReceived: Boolean(lh.podReceived),
      balancePaid: Boolean(lh.balancePaid),
      hireRecord: lh as LorryHire | undefined,
    }));

    consignments.forEach((cn) => {
      const cnKey = (cn.cnNo || '').trim().toUpperCase();
      if (seenCn.has(cnKey)) return;
      const dt = cn.cnDate || '';
      if (dateFrom && dt && dt < dateFrom) return;
      if (dateTo && dt && dt > dateTo) return;
      const matches =
        activeRole === 'owner'
          ? String(cn.ownerName || '').trim().toLowerCase().replace(/\s+/g, ' ') === targetNorm
          : String(cn.truckNo || '').trim().toUpperCase().replace(/\s+/g, '') === truckNorm;
      if (!matches) return;
      rows.push({
        id: `cn_${cn.id}`,
        cnNo: cn.cnNo,
        date: cn.cnDate || todayISO(),
        truckNo: cn.truckNo || '-',
        partyOrOwner: activeRole === 'owner' ? cn.truckNo || '-' : cn.ownerName || cn.billingPartyName || '-',
        route: `${cn.fromCity || '-'} → ${cn.toCity || '-'}`,
        grossAmt: Number(cn.totalFreight || 0),
        advAmt: 0,
        balAmt: Number(cn.totalFreight || 0),
        podReceived: false,
        balancePaid: false,
        hireRecord: undefined,
      });
    });

    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.cnNo.localeCompare(a.cnNo));
  }, [activeRole, selectedName, dateFrom, dateTo, lorryHires, consignments]);

  const sortedDirectory = useMemo(() => {
    const copy = [...directory];
    if (directorySortAlpha) {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
  }, [directory, directorySortAlpha]);

  const handleMarkBrokerTripPaid = async (hire: LorryHire) => {
    if (hire.balancePaid) return;
    setSaving(true);
    try {
      await upsertDocument(
        'lorry_hires',
        hire.id,
        {
          balancePaid: true,
          balancePaidAmt: hire.balancePayable,
          balancePaidDate: todayISO(),
          paymentMode: hire.paymentMode || 'Bank Transfer',
          ownerUid,
        },
        true
      );
      setStatusMsg(`Marked CN ${hire.cnNo} (${hire.truckNo}) as PAID & Auto-Locked!`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to settle broker trip.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!statement) return;
    setOpenBalInput(String(statement.openingAmount || 0));
    setOpenSideInput(statement.openingSide);
  }, [statement?.accountName, statement?.fy, statement?.openingAmount, statement?.openingSide]);

  const currentRoleDef = ROLE_TABS.find((r) => r.id === activeRole) || ROLE_TABS[0];

  const handleSaveOpeningBalance = async () => {
    if (!selectedName.trim()) return;
    setSaving(true);
    setStatusMsg('');
    try {
      const fyKey = normalizeFyLabel(activeFy);
      const existingMap = { ...(company.fyOpeningBalances || {}) };
      const existingFy = { ...(existingMap[fyKey] || {}) };
      const storeKey = selectedEntityId || selectedName.trim();
      existingFy[storeKey] = {
        amount: roundPaise(Math.max(0, Number(openBalInput || 0))),
        balanceType: openSideInput,
      };
      existingMap[fyKey] = existingFy;
      await saveSettingsDocument(
        'company',
        {
          fyOpeningBalances: existingMap,
          ownerUid,
        },
        Boolean(hasCustomSettings)
      );

      // Also sync Drive Year-Wise PDF if connected
      if (hasDriveToken && driveAccessToken && statement) {
        const pdf = await generateTallyRoleLedgerPDF(statement, company, 'p');
        const up = await uploadRoleOrganizedPdfToDrive({
          accessToken: driveAccessToken,
          fy: activeFy,
          rootFolderName: company.driveRootFolder,
          category: currentRoleDef.driveCat,
          entitySubFolder: selectedName.trim(),
          fileName: pdf.fileName,
          blob: pdf.blob,
          connectedEmail: connectedDriveEmail,
        });
        setStatusMsg(
          `Saved Opening Balance (${fyKey}) & synced Ledger PDF to Drive: ${up.folderPath}/${up.name}`
        );
      } else {
        setStatusMsg(`Saved FY Opening Balance for ${selectedName} (${fyKey}).`);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save opening balance.');
    } finally {
      setSaving(false);
    }
  };

  const generateStatementPdf = async (): Promise<GeneratedPdfResult | null> => {
    if (!statement) return null;
    const pdf = await generateTallyRoleLedgerPDF(statement, company, 'p');
    if (hasDriveToken && driveAccessToken) {
      void uploadRoleOrganizedPdfToDrive({
        accessToken: driveAccessToken,
        fy: activeFy,
        rootFolderName: company.driveRootFolder,
        category: currentRoleDef.driveCat,
        entitySubFolder: selectedName.trim(),
        fileName: pdf.fileName,
        blob: pdf.blob,
        connectedEmail: connectedDriveEmail,
      }).catch(() => undefined);
    }
    return pdf;
  };

  const ledgerColumns = useMemo<
    Array<TableColumn<NonNullable<typeof statement>['rows'][number]>>
  >(
    () => [
      {
        key: 'date',
        header: 'Date',
        cellClassName: 'font-mono-num text-xs whitespace-nowrap',
        render: (r) => formatDateDDMMYYYY(r.date),
      },
      {
        key: 'particulars',
        header: 'Particulars',
        render: (r) => (
          <div className="min-w-[210px] max-w-[330px]">
            <div className="font-bold text-xs text-slate-900">{r.particulars}</div>
            {r.narration && (
              <div className="text-[10px] text-slate-500 truncate">{r.narration}</div>
            )}
          </div>
        ),
      },
      {
        key: 'vtype',
        header: 'Vch Type',
        cellClassName: 'text-xs font-semibold whitespace-nowrap',
        render: (r) => r.voucherType,
      },
      {
        key: 'vno',
        header: 'Vch No.',
        cellClassName: 'font-mono-num text-xs font-bold whitespace-nowrap',
        render: (r) => r.voucherNo,
      },
      {
        key: 'dr',
        header: 'Debit (₹)',
        align: 'right',
        cellClassName: 'font-mono-num text-xs font-bold text-amber-800 whitespace-nowrap',
        render: (r) => (r.debit > 0 ? formatINR(r.debit) : '-'),
      },
      {
        key: 'cr',
        header: 'Credit (₹)',
        align: 'right',
        cellClassName: 'font-mono-num text-xs font-bold text-emerald-700 whitespace-nowrap',
        render: (r) => (r.credit > 0 ? formatINR(r.credit) : '-'),
      },
      ...(onRectifyVoucher
        ? [
            {
              key: 'edit',
              header: 'Rectify',
              align: 'right' as const,
              render: (r: NonNullable<typeof statement>['rows'][number]) =>
                r.voucherType === 'Sales' || r.voucherType === 'Credit Note' || r.voucherType === 'Debit Note' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRectifyVoucher(r.voucherType, r.voucherNo);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-bold hover:bg-amber-100 cursor-pointer"
                  >
                    <Edit3 className="w-2.5 h-2.5" />
                    Rectify
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400">—</span>
                ),
            },
          ]
        : []),
    ],
    [onRectifyVoucher]
  );

  return (
    <div className="space-y-4">
      {/* 6-Role Tally Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-700" />
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                Tally-Style Role Account Ledgers &amp; Name-Wise Trip Counters ({activeFy})
              </h2>
              <p className="text-[11px] text-slate-500">
                Separate Statement of Account for Billing Parties, Brokers, Lorry Owners, Drivers, Vehicles &amp; Monthly/Yearly Staff Ledgers
              </p>
            </div>
          </div>
          {statement && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${
                statement.auditBalanced
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-red-50 text-red-700 border-red-300'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {statement.auditBalanced
                ? 'Tally Math & Ledger Audit: 0 Difference'
                : `Audit Diff: ₹${formatINR(statement.auditDifference)}`}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ROLE_TABS.map((rt) => (
            <button
              key={rt.id}
              type="button"
              onClick={() => {
                setActiveRole(rt.id);
                setSelectedName('');
                setSelectedEntityId('');
                setStatusMsg('');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeRole === rt.id
                  ? 'bg-[#0D47A1] text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-blue-50 text-slate-800'
              }`}
            >
              {rt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: Name-Wise Directory (Left) + Full Tally Statement (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Directory Card */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between text-xs font-bold">
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-4 h-4 text-amber-300" />
              A–Z {currentRoleDef.label} ({sortedDirectory.length})
            </span>
            <button
              type="button"
              onClick={() => setDirectorySortAlpha((p) => !p)}
              className="text-[10px] px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-amber-200 cursor-pointer"
            >
              {directorySortAlpha ? 'Sort: A–Z' : 'Sort: Trips'}
            </button>
          </div>

          <div className="p-2.5 border-b border-slate-200">
            <RichEntityPicker<RoleTripSummaryItem>
              ariaLabel={`Search ${currentRoleDef.label}`}
              value={selectedName}
              selectedId={selectedEntityId}
              onChangeText={(txt) => {
                setSelectedName(txt);
                const m = sortedDirectory.find((d) => d.name.trim().toLowerCase() === txt.trim().toLowerCase());
                setSelectedEntityId(m?.entityId || '');
              }}
              onSelectEntity={(item) => {
                setSelectedName(item.name);
                setSelectedEntityId(item.entityId || '');
              }}
              items={sortedDirectory}
              getId={(i) => i.key}
              getValue={(i) => i.name}
              getSearchText={(i) => `${i.name} ${i.gstin || ''} ${i.phone || ''} ${i.subLabel || ''}`}
              renderTitle={(i) => i.name}
              renderBadge={(i) => `${i.tripCount} Trips`}
              renderDetails={(i) =>
                `Bal: ₹${formatINR(i.closingBalance)} ${i.closingSide}${i.phone ? ` · Ph: ${i.phone}` : ''}`
              }
              placeholder={`Search ${currentRoleDef.label} A-Z...`}
            />
          </div>

          <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-100">
            {sortedDirectory.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No accounts found for this role yet.
              </div>
            ) : (
              sortedDirectory.map((item) => {
                const active = item.name.trim().toLowerCase() === selectedName.trim().toLowerCase();
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setSelectedName(item.name);
                      setSelectedEntityId(item.entityId || '');
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                      active ? 'bg-blue-50 ring-1 ring-inset ring-blue-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">{item.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {item.subLabel || item.gstin || item.phone || 'Registered Account'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold">
                        <Truck className="w-2.5 h-2.5 text-blue-700" />
                        {item.tripCount}
                      </div>
                      <div
                        className={`font-mono-num text-[11px] font-extrabold mt-0.5 ${
                          item.closingSide === 'Dr' ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        ₹{formatINR(item.closingBalance)} {item.closingSide}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Tally Statement Card */}
        <div className="lg:col-span-8 space-y-3">
          {activeRole === 'vehicle' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setVehicleSubView('ledger')}
                  className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer transition-colors ${
                    vehicleSubView === 'ledger'
                      ? 'bg-[#0D47A1] text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Tally Statement &amp; Trip Sheet
                </button>
                <button
                  type="button"
                  onClick={() => setVehicleSubView('tripProfit')}
                  className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer transition-colors ${
                    vehicleSubView === 'tripProfit'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200'
                  }`}
                >
                  Trip Expense &amp; Net Profit
                </button>
              </div>
              <ExpiryAlertBadge
                vehicles={vehicles}
                drivers={drivers}
                consignments={consignments}
                lorryHires={lorryHires}
                filterTruckNo={selectedName.trim() || undefined}
                scopeLabel={selectedName.trim() || 'Vehicle Docs'}
                compact
              />
            </div>
          )}

          {activeRole === 'vehicle' && vehicleSubView === 'tripProfit' ? (
            <TripProfitCalculatorPanel
              ownerUid={ownerUid}
              activeFy={activeFy}
              company={company}
              consignments={consignments}
              lorryHires={lorryHires}
              invoices={invoices}
              transactions={transactions}
              staffCommissions={staffCommissions}
              tripExpenses={tripExpenses}
              vehicles={vehicles}
              selectedTruckNo={selectedName.trim() || undefined}
              onPreviewPdf={onPreviewPdf}
            />
          ) : (
          <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-blue-100 uppercase tracking-wider">
                  {currentRoleDef.label} · Statement of Account
                </div>
                <h3 className="text-base font-extrabold">
                  {selectedName || 'Select an Account'}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  disabled={saving || !selectedName.trim()}
                  onClick={() => void handleSaveOpeningBalance()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={!statement}
                  onClick={async () => {
                    const pdf = await generateStatementPdf();
                    if (pdf) onPreviewPdf(pdf, 'Reports_Ledgers');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white text-[#0D47A1] font-bold hover:bg-blue-50 cursor-pointer disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={onOpenPodScanner}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold cursor-pointer"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  Scan
                </button>
                <button
                  type="button"
                  disabled={!statement}
                  onClick={async () => {
                    const pdf = await generateStatementPdf();
                    if (pdf) downloadPdfDirect(pdf);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Low-KB PDF
                </button>
                <button
                  type="button"
                  disabled={!statement}
                  onClick={async () => {
                    const pdf = await generateStatementPdf();
                    if (pdf) printPdfDirect(pdf);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Manual Print
                </button>
                <button
                  type="button"
                  disabled={!statement}
                  onClick={async () => {
                    const pdf = await generateStatementPdf();
                    if (!pdf || !statement) return;
                    const res = await sharePdfDirect({
                      pdf,
                      channel: 'whatsapp',
                      partyName: statement.accountName,
                      docNo: `${statement.role.toUpperCase()}-${statement.fy}`,
                      docLabel: 'Tally Ledger Statement',
                      company,
                    });
                    setStatusMsg(res.message);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  Share
                </button>
                <button
                  type="button"
                  disabled={!statement}
                  onClick={() => {
                    const editableRow = statement?.rows.find(
                      (r) =>
                        r.voucherType === 'Sales' ||
                        r.voucherType === 'Credit Note' ||
                        r.voucherType === 'Debit Note'
                    );
                    if (editableRow && onRectifyVoucher) {
                      onRectifyVoucher(editableRow.voucherType, editableRow.voucherNo);
                    } else {
                      const el = document.getElementById('drc-ledger-opening-input');
                      el?.focus();
                      setStatusMsg(
                        'Edit FY Opening Balance below and click Save, or click Rectify on any invoice row.'
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-50 border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 cursor-pointer disabled:opacity-50"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Rectify / Edit
                </button>
              </div>
            </div>

            {/* Period Filters & Opening Balance Row */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500 mr-1" />
                {(['1D', '2D', '10D', '20D', '1M', '2M', '6M', '1Y', '10Y', 'FY', 'CUSTOM'] as LedgerQuickPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setQuickPeriod(p)}
                    className={`px-2 py-1 rounded font-bold cursor-pointer ${
                      quickPeriod === p
                        ? 'bg-blue-700 text-white'
                        : 'bg-white border border-slate-300 text-slate-700 hover:bg-blue-50'
                    }`}
                  >
                    {p}
                  </button>
                ))}
                {quickPeriod === 'CUSTOM' && (
                  <div className="flex items-center gap-1 ml-1">
                    <input
                      type="date"
                      value={customFrom || dateFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="px-2 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                    />
                    <span>to</span>
                    <input
                      type="date"
                      value={customTo || dateTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="px-2 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-700">FY Opening Bal:</span>
                <input
                  id="drc-ledger-opening-input"
                  type="number"
                  step="0.01"
                  value={openBalInput}
                  onChange={(e) => setOpenBalInput(e.target.value)}
                  className="w-24 px-2 py-1 rounded border border-slate-300 bg-white font-mono-num text-xs"
                />
                <div className="w-20">
                  <SearchableSelect
                    ariaLabel="Opening Balance Side"
                    value={openSideInput}
                    onChange={(v) => setOpenSideInput((v === 'Cr' ? 'Cr' : 'Dr'))}
                    sortAlphabetically={false}
                    options={[
                      { value: 'Dr', label: 'Dr' },
                      { value: 'Cr', label: 'Cr' },
                    ]}
                  />
                </div>
                {hasDriveToken && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    <CloudUpload className="w-3 h-3" />
                    FY Drive Sync
                  </span>
                )}
              </div>
            </div>

            {statusMsg && (
              <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-xs font-semibold">
                {statusMsg}
              </div>
            )}

            {/* Authentic Tally Statement Header Block */}
            {statement && (
              <div className="px-4 py-2.5 bg-slate-50/90 border-b border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="font-extrabold text-[#0D47A1]">
                    {company.companyName || 'DOLPHIN ROAD CARRIER'}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    {company.address || '30/1/29, Nobin Chandra Das Road, Kolkata - 700090'} | GSTIN:{' '}
                    {company.gstin || '19DOTPS3540M1ZZ'} | PAN: {company.pan || 'DOTPS3540M'}
                  </div>
                  <div className="mt-1 font-bold text-slate-900">
                    Ledger Account: {statement.accountName}
                    {statement.accountAddress ? ` · ${statement.accountAddress}` : ''}
                    {statement.accountGstin ? ` · GSTIN: ${statement.accountGstin}` : ''}
                    {statement.accountStateCode ? ` · State Code: ${statement.accountStateCode}` : ''}
                  </div>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <div className="text-[11px] font-bold text-slate-700">
                    Period: {formatDateDDMMYYYY(statement.dateFrom)} to {formatDateDDMMYYYY(statement.dateTo)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Total Trips / Vouchers: <strong className="font-mono-num text-slate-900">{statement.tripCount}</strong>
                  </div>
                </div>
              </div>
            )}

            <PaginatedDataTable
              data={statement?.rows || []}
              columns={ledgerColumns}
              getRowId={(r) => r.id}
              defaultPageSize={50}
              maxHeightClass="max-h-[420px]"
              stickyHeader
              emptyMessage="No ledger entries in this period. Entries update automatically from CN, Lorry Hire, Tax Invoice & Vouchers."
            />

            {/* Authentic Tally Totals Footer */}
            {statement && (
              <div className="bg-slate-100 border-t border-slate-300 px-4 py-3 text-xs space-y-1.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="flex items-center justify-between sm:block px-2.5 py-1.5 rounded bg-white border border-slate-200">
                    <span className="text-slate-600 font-semibold">Opening Balance ({statement.openingSide}):</span>
                    <span className="font-mono-num font-bold text-blue-900 sm:ml-2">
                      ₹ {formatINR(statement.openingAmount)} {statement.openingSide}
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:block px-2.5 py-1.5 rounded bg-white border border-slate-200">
                    <span className="text-slate-600 font-semibold">Current Total (Dr | Cr):</span>
                    <span className="font-mono-num font-bold text-slate-900 sm:ml-2">
                      ₹ {formatINR(statement.totalDr)} Dr | ₹ {formatINR(statement.totalCr)} Cr
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:block px-2.5 py-1.5 rounded bg-indigo-50 border border-indigo-300">
                    <span className="text-indigo-800 font-bold">Closing Balance ({statement.closingSide}):</span>
                    <span className="font-mono-num font-extrabold text-indigo-950 sm:ml-2">
                      ₹ {formatINR(statement.closingBalance)} {statement.closingSide}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Broker Day-Wise & Multi-Period Trip/Payment Sheet with PAID Auto-Lock */}
          {activeRole === 'broker' && brokerTripSheet && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-extrabold flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-amber-300" />
                    Broker Day-Wise &amp; Multi-Period Trip / Payment Sheet ({quickPeriod})
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Period: {formatDateDDMMYYYY(dateFrom)} to {formatDateDDMMYYYY(dateTo)} · {brokerTripSheet.totalTrips} Trips · {brokerTripSheet.paidLockedCount} PAID Auto-Locked
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBrokerScope('single')}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      brokerScope === 'single' ? 'bg-blue-600 text-white' : 'bg-white/15 text-slate-200 hover:bg-white/25'
                    }`}
                  >
                    Single Broker ({selectedName || 'Selected'})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrokerScope('all')}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      brokerScope === 'all' ? 'bg-amber-500 text-slate-950' : 'bg-white/15 text-slate-200 hover:bg-white/25'
                    }`}
                  >
                    All Brokers Master List
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-slate-50 border-b border-slate-200 text-xs">
                <div className="p-2 rounded bg-white border border-slate-200">
                  <div className="text-[10px] text-slate-500">Total Hire</div>
                  <div className="font-mono-num font-bold text-slate-900">₹ {formatINR(brokerTripSheet.totalHire)}</div>
                </div>
                <div className="p-2 rounded bg-white border border-slate-200">
                  <div className="text-[10px] text-slate-500">Advance Given</div>
                  <div className="font-mono-num font-bold text-amber-800">₹ {formatINR(brokerTripSheet.totalAdvance)}</div>
                </div>
                <div className="p-2 rounded bg-white border border-slate-200">
                  <div className="text-[10px] text-slate-500">TDS Deducted</div>
                  <div className="font-mono-num font-bold text-slate-700">₹ {formatINR(brokerTripSheet.totalTds)}</div>
                </div>
                <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
                  <div className="text-[10px] text-emerald-700 font-bold">Total Paid / Received</div>
                  <div className="font-mono-num font-extrabold text-emerald-900">₹ {formatINR(brokerTripSheet.totalPaidOut)}</div>
                </div>
                <div className="p-2 rounded bg-red-50 border border-red-200">
                  <div className="text-[10px] text-red-700">Pending Balance</div>
                  <div className="font-mono-num font-extrabold text-red-800">₹ {formatINR(brokerTripSheet.totalPendingBalance)}</div>
                </div>
              </div>

              {brokerTripSheet.dateWiseSummary.length > 0 && (
                <div className="border-b border-slate-200 bg-white">
                  <div className="px-3 py-1.5 bg-slate-100 text-[11px] font-extrabold text-slate-800 flex items-center justify-between">
                    <span>Date-by-Date Vehicle Count &amp; Payment Rollup ({brokerTripSheet.dateWiseSummary.length} Dates)</span>
                    <span className="font-mono-num text-emerald-800">
                      {brokerTripSheet.paidLockedCount} / {brokerTripSheet.totalTrips} Trips PAID Locked
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-[160px]">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-600 sticky top-0">
                        <tr>
                          <th className="px-2.5 py-1 text-left">Date</th>
                          <th className="px-2.5 py-1 text-center">Vehicle Count</th>
                          <th className="px-2.5 py-1 text-left">Trucks</th>
                          <th className="px-2.5 py-1 text-right">Hire ₹</th>
                          <th className="px-2.5 py-1 text-right">Paid ₹</th>
                          <th className="px-2.5 py-1 text-right">Due ₹</th>
                          <th className="px-2.5 py-1 text-center">Day Lock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {brokerTripSheet.dateWiseSummary.map((d) => (
                          <tr key={d.date} className={d.allPaidLocked ? 'bg-emerald-50/35' : ''}>
                            <td className="px-2.5 py-1 font-mono-num font-semibold text-slate-800">
                              {formatDateDDMMYYYY(d.date)}
                            </td>
                            <td className="px-2.5 py-1 text-center font-mono-num font-extrabold text-blue-800">
                              {d.vehicleCount} ({d.tripCount} Trip{d.tripCount > 1 ? 's' : ''})
                            </td>
                            <td className="px-2.5 py-1 font-mono-num text-slate-600 truncate max-w-[200px]">
                              {d.trucks.join(', ') || '-'}
                            </td>
                            <td className="px-2.5 py-1 text-right font-mono-num">₹ {formatINR(d.hireTotal)}</td>
                            <td className="px-2.5 py-1 text-right font-mono-num font-bold text-emerald-800">₹ {formatINR(d.paidTotal)}</td>
                            <td className="px-2.5 py-1 text-right font-mono-num font-bold text-red-700">₹ {formatINR(d.pendingTotal)}</td>
                            <td className="px-2.5 py-1 text-center">
                              {d.allPaidLocked ? (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-extrabold">
                                  <Lock className="w-2.5 h-2.5" />
                                  PAID
                                </span>
                              ) : (
                                <span className="text-[10px] text-amber-700 font-bold">OPEN</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto max-h-[360px]">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      <th className="px-2.5 py-2 text-left">CN No / Date</th>
                      <th className="px-2.5 py-2 text-left">Broker / Truck</th>
                      <th className="px-2.5 py-2 text-left">Route</th>
                      <th className="px-2.5 py-2 text-right">Hire ₹</th>
                      <th className="px-2.5 py-2 text-right">Adv ₹</th>
                      <th className="px-2.5 py-2 text-right">Balance ₹</th>
                      <th className="px-2.5 py-2 text-center">Status &amp; Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {brokerTripSheet.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                          No broker trips found for this period.
                        </td>
                      </tr>
                    ) : (
                      brokerTripSheet.rows.map((row) => (
                        <tr key={row.id} className={row.isPaidLocked ? 'bg-emerald-50/40' : 'hover:bg-slate-50'}>
                          <td className="px-2.5 py-2">
                            <div className="font-mono-num font-bold text-slate-900">{row.cnNo}</div>
                            <div className="text-[10px] text-slate-500 font-mono-num">{formatDateDDMMYYYY(row.date)}</div>
                          </td>
                          <td className="px-2.5 py-2">
                            <div className="font-bold text-slate-900">{row.brokerName}</div>
                            <div className="text-[10px] text-blue-700 font-mono-num font-semibold">{row.truckNo}</div>
                          </td>
                          <td className="px-2.5 py-2 text-slate-700">{row.route}</td>
                          <td className="px-2.5 py-2 text-right font-mono-num">₹ {formatINR(row.hireAmount)}</td>
                          <td className="px-2.5 py-2 text-right font-mono-num text-amber-800">₹ {formatINR(row.advancePaid)}</td>
                          <td className="px-2.5 py-2 text-right font-mono-num font-extrabold">₹ {formatINR(row.balancePayable)}</td>
                          <td className="px-2.5 py-2 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              {row.isPaidLocked ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-extrabold">
                                  <Lock className="w-2.5 h-2.5" />
                                  PAID LOCKED
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => void handleMarkBrokerTripPaid(row.hireRecord)}
                                  className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer"
                                >
                                  Mark Paid
                                </button>
                              )}
                              {onRectifyLorryHire && (
                                <button
                                  type="button"
                                  onClick={() => onRectifyLorryHire(row.hireRecord)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-bold hover:bg-amber-100 cursor-pointer"
                                >
                                  <Edit3 className="w-2.5 h-2.5" />
                                  Rectify
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Lorry Owner / Driver / Vehicle Trip & Movement Sheet */}
          {(activeRole === 'owner' || activeRole === 'driver' || activeRole === 'vehicle') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-extrabold flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-amber-300" />
                  <span>
                    {activeRole === 'owner'
                      ? 'Lorry Owner Trip Sheet'
                      : activeRole === 'driver'
                      ? 'Driver Trip & Movement Sheet'
                      : 'Vehicle / Truck Trip Sheet'}{' '}
                    — {selectedName || 'Selected'} ({roleTripSheetRows.length} Trips)
                  </span>
                </div>
                <span className="text-[11px] text-slate-300 font-mono-num">
                  Period: {formatDateDDMMYYYY(dateFrom)} to {formatDateDDMMYYYY(dateTo)}
                </span>
              </div>
              <div className="overflow-x-auto max-h-[340px]">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      <th className="px-2.5 py-2 text-left">CN No / Date</th>
                      <th className="px-2.5 py-2 text-left">
                        {activeRole === 'owner'
                          ? 'Truck No'
                          : activeRole === 'driver'
                          ? 'Truck / Owner'
                          : 'Owner / Party'}
                      </th>
                      <th className="px-2.5 py-2 text-left">Route</th>
                      <th className="px-2.5 py-2 text-right">Hire / Freight ₹</th>
                      <th className="px-2.5 py-2 text-right">Advance ₹</th>
                      <th className="px-2.5 py-2 text-right">Balance ₹</th>
                      <th className="px-2.5 py-2 text-center">POD &amp; Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {roleTripSheetRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                          No trips recorded for {selectedName || 'this account'} in this period.
                        </td>
                      </tr>
                    ) : (
                      roleTripSheetRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-2.5 py-2">
                            <div className="font-mono-num font-bold text-slate-900">{row.cnNo}</div>
                            <div className="text-[10px] text-slate-500 font-mono-num">
                              {formatDateDDMMYYYY(row.date)}
                            </div>
                          </td>
                          <td className="px-2.5 py-2">
                            <div className="font-bold text-slate-900">{row.partyOrOwner}</div>
                            {activeRole === 'driver' && (
                              <div className="text-[10px] text-blue-700 font-mono-num font-semibold">
                                {row.truckNo}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-2 text-slate-700">{row.route}</td>
                          <td className="px-2.5 py-2 text-right font-mono-num">
                            ₹ {formatINR(row.grossAmt)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono-num text-amber-800">
                            ₹ {formatINR(row.advAmt)}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono-num font-extrabold">
                            ₹ {formatINR(row.balAmt)}
                          </td>
                          <td className="px-2.5 py-2 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  row.balancePaid
                                    ? 'bg-emerald-100 text-emerald-900'
                                    : row.podReceived
                                    ? 'bg-blue-100 text-blue-900'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {row.balancePaid ? 'PAID' : row.podReceived ? 'POD OK' : 'IN TRANSIT'}
                              </span>
                              {row.hireRecord && onRectifyLorryHire && (
                                <button
                                  type="button"
                                  onClick={() => onRectifyLorryHire(row.hireRecord!)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-bold hover:bg-amber-100 cursor-pointer"
                                >
                                  <Edit3 className="w-2.5 h-2.5" />
                                  Rectify
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Staff Dual-Ledger System (a) Advance & Salary Paid Ledger + (b) Separate Staff Commission Ledger (1M/6M/1Y) */}
          {activeRole === 'staff' && staffDualLedger && (
            <div className="space-y-3">
              {/* 1M / 6M / 1Y Commission Cards & Auto-Save to FY_XXXX-XX/STAFF/[Staff_Name]/ */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-800 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-300" />
                    (b) Separate Staff Commission Ledger (1M / 6M / 1Y) — {selectedName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        const pdf = await generateTallyRoleLedgerPDF(staffDualLedger.advanceSalaryStatement, company, 'p');
                        if (hasDriveToken && driveAccessToken) {
                          const up = await uploadRoleOrganizedPdfToDrive({
                            accessToken: driveAccessToken,
                            fy: activeFy,
                            rootFolderName: company.driveRootFolder,
                            category: 'STAFF',
                            entitySubFolder: selectedName.trim(),
                            fileName: pdf.fileName,
                            blob: pdf.blob,
                            connectedEmail: connectedDriveEmail,
                          });
                          setStatusMsg(`Saved Staff Dual-Ledger PDF (${pdf.sizeKB} KB) to ${up.folderPath}`);
                        }
                        onPreviewPdf(pdf, 'Reports_Ledgers');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold cursor-pointer"
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                      Save Low-KB PDF to STAFF/{selectedName || 'Staff'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 bg-slate-50 border-b border-slate-200 text-xs">
                  {(
                    [
                      ['Monthly (1M)', staffDualLedger.periodTotals.m1],
                      ['Half-Yearly (6M)', staffDualLedger.periodTotals.m6],
                      ['Yearly (1Y)', staffDualLedger.periodTotals.y1],
                    ] as const
                  ).map(([title, stat]) => (
                    <div key={title} className="p-2.5 rounded-lg bg-white border border-slate-200">
                      <div className="font-extrabold text-slate-900">{title} · {stat.trips} Trips</div>
                      <div className="mt-1 flex justify-between text-[11px]">
                        <span className="text-slate-500">Commission Earned:</span>
                        <span className="font-mono-num font-bold text-emerald-700">₹ {formatINR(stat.earned)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-500">Paid / Settled:</span>
                        <span className="font-mono-num font-bold text-blue-700">₹ {formatINR(stat.paid)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] pt-1 mt-1 border-t border-slate-100">
                        <span className="font-bold text-slate-700">Balance Due:</span>
                        <span className="font-mono-num font-extrabold text-indigo-900">₹ {formatINR(stat.balanceDue)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto max-h-[260px]">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Challan / Truck</th>
                        <th className="px-3 py-2 text-left">Wheel Type</th>
                        <th className="px-3 py-2 text-right">Earned ₹</th>
                        <th className="px-3 py-2 text-right">Paid ₹</th>
                        <th className="px-3 py-2 text-right">Balance Due ₹</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {staffDualLedger.commissionRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 text-center text-slate-500">
                            No staff commission entries in selected period.
                          </td>
                        </tr>
                      ) : (
                        staffDualLedger.commissionRows.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono-num">{formatDateDDMMYYYY(c.date)}</td>
                            <td className="px-3 py-1.5">
                              <span className="font-bold text-slate-900">{c.challanNo}</span>{' '}
                              <span className="text-[11px] text-slate-500 font-mono-num">{c.truckNo}</span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">{c.wheelType}</td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-emerald-700 font-bold">
                              {c.earned > 0 ? `₹ ${formatINR(c.earned)}` : '-'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-blue-700 font-bold">
                              {c.paidSettled > 0 ? `₹ ${formatINR(c.paidSettled)}` : '-'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num font-extrabold">
                              ₹ {formatINR(c.balanceDue)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* (a) Combined Advance & Salary Paid Ledger */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-indigo-900 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                  <span>(a) Combined Advance &amp; Salary Paid Ledger — {selectedName}</span>
                  <span className="font-mono-num text-amber-300">
                    Closing: ₹ {formatINR(staffDualLedger.advanceSalaryStatement.closingBalance)} {staffDualLedger.advanceSalaryStatement.closingSide}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[240px]">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Particulars</th>
                        <th className="px-3 py-2 text-left">Vch No</th>
                        <th className="px-3 py-2 text-right">Advance Given (Dr ₹)</th>
                        <th className="px-3 py-2 text-right">Salary / Settled (Cr ₹)</th>
                        <th className="px-3 py-2 text-right">Running Bal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {staffDualLedger.advanceSalaryStatement.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 text-center text-slate-500">
                            No Advance Given or Salary Paid entries in this period.
                          </td>
                        </tr>
                      ) : (
                        staffDualLedger.advanceSalaryStatement.rows.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono-num">{formatDateDDMMYYYY(r.date)}</td>
                            <td className="px-3 py-1.5 font-semibold text-slate-900">{r.particulars}</td>
                            <td className="px-3 py-1.5 font-mono-num">{r.voucherNo}</td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-amber-800 font-bold">
                              {r.debit > 0 ? `₹ ${formatINR(r.debit)}` : '-'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-emerald-700 font-bold">
                              {r.credit > 0 ? `₹ ${formatINR(r.credit)}` : '-'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num font-extrabold">
                              ₹ {formatINR(r.runningBalance)} {r.runningSide}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {staffSummary && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="bg-slate-700 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                    <span>Month-by-Month FY Rollup ({activeFy})</span>
                    <span className="font-mono-num text-emerald-300">
                      FY Net: ₹ {formatINR(staffSummary.yearlyBalance)} {staffSummary.yearlySide} · {staffSummary.totalTrips} Trips
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="px-3 py-2 text-left">Month</th>
                          <th className="px-3 py-2 text-right">Trips</th>
                          <th className="px-3 py-2 text-right">Commission Earned</th>
                          <th className="px-3 py-2 text-right">Advance Taken</th>
                          <th className="px-3 py-2 text-right">Paid / Settled</th>
                          <th className="px-3 py-2 text-right">Net Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {staffSummary.monthlyRows.map((m) => (
                          <tr key={m.monthKey} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-bold text-slate-900">{m.monthLabel}</td>
                            <td className="px-3 py-1.5 text-right font-mono-num">{m.tripCount}</td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-emerald-700 font-semibold">
                              ₹ {formatINR(m.commissionTotal)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-amber-700">
                              ₹ {formatINR(m.advanceTaken)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num text-blue-700">
                              ₹ {formatINR(m.paidAmount)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono-num font-extrabold">
                              ₹ {formatINR(m.netBalance)} {m.netSide}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
};
