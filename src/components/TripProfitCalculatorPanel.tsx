import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Download,
  Edit3,
  Eye,
  Printer,
  RotateCcw,
  Save,
  Search,
  Share2,
  Truck,
} from 'lucide-react';
import {
  CompanySettings,
  ConsignmentNote,
  Invoice,
  LorryHire,
  StaffCommissionEntry,
  TransactionRecord,
  TripExpenseRecord,
  Vehicle,
} from '../types/erp';
import {
  formatDateDDMMYYYY,
  formatINR,
  makeSafeDocId,
  normalizeFyLabel,
  roundPaise,
  todayISO,
} from '../lib/formatters';
import {
  buildTripProfitDataset,
  calculateNetTripProfit,
  ComputedTripProfitRow,
} from '../lib/tripProfitEngine';
import { upsertDocument } from '../lib/firestoreStore';
import {
  downloadPdfDirect,
  GeneratedPdfResult,
  generateFoxproStatementPDF,
  printPdfDirect,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import { RichEntityPicker } from './RichEntityPicker';

interface TripProfitCalculatorPanelProps {
  ownerUid: string;
  activeFy: string;
  company: CompanySettings;
  consignments: ConsignmentNote[];
  lorryHires: LorryHire[];
  invoices?: Invoice[];
  transactions?: TransactionRecord[];
  staffCommissions?: StaffCommissionEntry[];
  tripExpenses: TripExpenseRecord[];
  vehicles?: Vehicle[];
  selectedTruckNo?: string;
  readOnly?: boolean;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'Reports_Ledgers') => void;
}

export const TripProfitCalculatorPanel: React.FC<TripProfitCalculatorPanelProps> = ({
  ownerUid,
  activeFy,
  company,
  consignments,
  lorryHires,
  invoices = [],
  transactions = [],
  staffCommissions = [],
  tripExpenses,
  selectedTruckNo,
  readOnly = false,
  onPreviewPdf,
}) => {
  const [scopeSelectedTruckOnly, setScopeSelectedTruckOnly] = useState<boolean>(
    Boolean(selectedTruckNo && selectedTruckNo.trim())
  );
  const [viewMode, setViewMode] = useState<'trips' | 'vehicles'>('trips');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // Editable Trip Expense Form State
  const [editingRowId, setEditingRowId] = useState<string>('');
  const [cnNoInput, setCnNoInput] = useState('');
  const [cnDateInput, setCnDateInput] = useState(todayISO());
  const [truckNoInput, setTruckNoInput] = useState(selectedTruckNo || '');
  const [partyNameInput, setPartyNameInput] = useState('');
  const [routeInput, setRouteInput] = useState('');
  const [freightInput, setFreightInput] = useState('0');
  const [lorryHireInput, setLorryHireInput] = useState('0');
  const [dieselInput, setDieselInput] = useState('0');
  const [tollInput, setTollInput] = useState('0');
  const [bhattaInput, setBhattaInput] = useState('0');
  const [brokerCommInput, setBrokerCommInput] = useState('0');
  const [miscInput, setMiscInput] = useState('0');
  const [remarksInput, setRemarksInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTruckNo && selectedTruckNo.trim()) {
      setScopeSelectedTruckOnly(true);
    } else {
      setScopeSelectedTruckOnly(false);
    }
  }, [selectedTruckNo]);

  const dataset = useMemo(
    () =>
      buildTripProfitDataset({
        consignments,
        lorryHires,
        invoices,
        transactions,
        staffCommissions,
        tripExpenses,
        filterTruckNo:
          scopeSelectedTruckOnly && selectedTruckNo ? selectedTruckNo : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
    [
      consignments,
      lorryHires,
      invoices,
      transactions,
      staffCommissions,
      tripExpenses,
      scopeSelectedTruckOnly,
      selectedTruckNo,
      dateFrom,
      dateTo,
    ]
  );

  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dataset.tripRows;
    return dataset.tripRows.filter((r) =>
      `${r.cnNo} ${r.truckNo} ${r.partyName} ${r.route} ${r.remarks}`
        .toLowerCase()
        .includes(q)
    );
  }, [dataset.tripRows, search]);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dataset.vehicleSummaries;
    return dataset.vehicleSummaries.filter((v) =>
      v.truckNo.toLowerCase().includes(q)
    );
  }, [dataset.vehicleSummaries, search]);

  const loadRowIntoForm = (row: ComputedTripProfitRow) => {
    setEditingRowId(row.savedRecordId || row.id);
    setCnNoInput(row.cnNo);
    setCnDateInput(row.cnDate || todayISO());
    setTruckNoInput(row.truckNo);
    setPartyNameInput(row.partyName || '');
    setRouteInput(row.route || '');
    setFreightInput(String(row.freightRevenue));
    setLorryHireInput(String(row.lorryHire));
    setDieselInput(String(row.dieselExpense));
    setTollInput(String(row.tollFastag));
    setBhattaInput(String(row.driverBhatta));
    setBrokerCommInput(String(row.brokerCommission));
    setMiscInput(String(row.unloadingMisc));
    setRemarksInput(row.remarks || '');
    setStatusMsg(`Loaded Trip ${row.cnNo} (${row.truckNo}) into calculator — edit deductions and click Save.`);
  };

  // Auto-seed the first visible trip into the form if form has no CN selected
  useEffect(() => {
    if (!cnNoInput && dataset.tripRows.length > 0) {
      const first = dataset.tripRows[0];
      setEditingRowId(first.savedRecordId || first.id);
      setCnNoInput(first.cnNo);
      setCnDateInput(first.cnDate || todayISO());
      setTruckNoInput(first.truckNo);
      setPartyNameInput(first.partyName || '');
      setRouteInput(first.route || '');
      setFreightInput(String(first.freightRevenue));
      setLorryHireInput(String(first.lorryHire));
      setDieselInput(String(first.dieselExpense));
      setTollInput(String(first.tollFastag));
      setBhattaInput(String(first.driverBhatta));
      setBrokerCommInput(String(first.brokerCommission));
      setMiscInput(String(first.unloadingMisc));
      setRemarksInput(first.remarks || '');
    }
  }, [dataset.tripRows, cnNoInput]);

  const resetForm = () => {
    setEditingRowId('');
    setCnNoInput('');
    setCnDateInput(todayISO());
    setTruckNoInput(selectedTruckNo || '');
    setPartyNameInput('');
    setRouteInput('');
    setFreightInput('0');
    setLorryHireInput('0');
    setDieselInput('0');
    setTollInput('0');
    setBhattaInput('0');
    setBrokerCommInput('0');
    setMiscInput('0');
    setRemarksInput('');
    setStatusMsg(null);
  };

  const liveCalc = useMemo(
    () =>
      calculateNetTripProfit({
        freightRevenue: Number(freightInput || 0),
        lorryHire: Number(lorryHireInput || 0),
        dieselExpense: Number(dieselInput || 0),
        tollFastag: Number(tollInput || 0),
        driverBhatta: Number(bhattaInput || 0),
        brokerCommission: Number(brokerCommInput || 0),
        unloadingMisc: Number(miscInput || 0),
      }),
    [
      freightInput,
      lorryHireInput,
      dieselInput,
      tollInput,
      bhattaInput,
      brokerCommInput,
      miscInput,
    ]
  );

  const handleSaveTripExpense = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (readOnly) return;
    if (!cnNoInput.trim()) {
      setStatusMsg('Please select or enter a CN / Trip No before saving.');
      return;
    }

    setSaving(true);
    setStatusMsg(null);
    try {
      const cleanCn = cnNoInput.trim().toUpperCase();
      const existing = tripExpenses.find(
        (x) => String(x.cnNo || '').trim().toUpperCase() === cleanCn
      );
      const docId =
        existing?.id ||
        (editingRowId && !editingRowId.startsWith('trip_') ? editingRowId : '') ||
        makeSafeDocId('texp');

      const matchedCn = consignments.find(
        (c) => String(c.cnNo || '').trim().toUpperCase() === cleanCn
      );

      await upsertDocument(
        'trip_expenses',
        docId,
        {
          cnId: matchedCn?.id || existing?.cnId || '',
          cnNo: cleanCn,
          cnDate: cnDateInput || todayISO(),
          financialYear: normalizeFyLabel(activeFy),
          truckNo: truckNoInput.trim().toUpperCase() || 'UNASSIGNED',
          partyName: partyNameInput.trim(),
          route: routeInput.trim(),
          freightRevenue: roundPaise(Number(freightInput || 0)),
          lorryHire: roundPaise(Number(lorryHireInput || 0)),
          dieselExpense: roundPaise(Number(dieselInput || 0)),
          tollFastag: roundPaise(Number(tollInput || 0)),
          driverBhatta: roundPaise(Number(bhattaInput || 0)),
          brokerCommission: roundPaise(Number(brokerCommInput || 0)),
          unloadingMisc: roundPaise(Number(miscInput || 0)),
          totalDeductions: liveCalc.totalDeductions,
          netProfit: liveCalc.netProfit,
          remarks: remarksInput.trim().slice(0, 200),
          branchCode: matchedCn?.branchCode || 'KOL-HQ',
          ownerUid,
        },
        !existing
      );

      setEditingRowId(docId);
      setStatusMsg(
        `Saved Trip Expense & Net Profit for CN ${cleanCn}: Net Profit ₹ ${formatINR(liveCalc.netProfit)} (${liveCalc.marginPct}%).`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to save trip expense.');
    } finally {
      setSaving(false);
    }
  };

  const buildProfitPdf = async (): Promise<GeneratedPdfResult> => {
    const scopeTitle =
      scopeSelectedTruckOnly && selectedTruckNo
        ? `Truck: ${selectedTruckNo}`
        : `All Fleet (${dataset.totals.vehicleCount} Vehicles)`;

    if (viewMode === 'vehicles') {
      return generateFoxproStatementPDF(
        {
          title: 'V-E-H-I-C-L-E - W-I-S-E   T-R-I-P   E-X-P-E-N-S-E   &   N-E-T   P-R-O-F-I-T',
          subtitle: `${scopeTitle} · FY: ${activeFy} · As of ${formatDateDDMMYYYY(todayISO())}`,
          fileName: `Vehicle_Net_Profit_${todayISO()}.pdf`,
          orientation: 'l',
          summaryLines: [
            { label: 'Total Freight Revenue', value: `Rs. ${formatINR(dataset.totals.freightRevenue)}` },
            { label: 'Total Deductions', value: `Rs. ${formatINR(dataset.totals.totalDeductions)}` },
            { label: 'Net Profit', value: `Rs. ${formatINR(dataset.totals.netProfit)}` },
            { label: 'Net Margin', value: `${dataset.totals.marginPct}%` },
          ],
          columns: [
            { label: 'TRUCK NO', widthPct: 14, align: 'left' },
            { label: 'TRIPS', widthPct: 6, align: 'center' },
            { label: 'FREIGHT REV', widthPct: 12, align: 'right' },
            { label: 'LORRY HIRE', widthPct: 12, align: 'right' },
            { label: 'DIESEL', widthPct: 10, align: 'right' },
            { label: 'TOLL/FASTAG', widthPct: 10, align: 'right' },
            { label: 'BHATTA', widthPct: 10, align: 'right' },
            { label: 'BROKER/MISC', widthPct: 12, align: 'right' },
            { label: 'NET PROFIT', widthPct: 14, align: 'right' },
          ],
          rows: filteredVehicles.map((v) => ({
            line1: [
              v.truckNo,
              String(v.tripCount),
              formatINR(v.freightRevenue),
              formatINR(v.lorryHire),
              formatINR(v.dieselExpense),
              formatINR(v.tollFastag),
              formatINR(v.driverBhatta),
              formatINR(roundPaise(v.brokerCommission + v.unloadingMisc)),
              `${formatINR(v.netProfit)} (${v.marginPct}%)`,
            ],
          })),
          totalsLabel: 'FLEET TOTALS :',
          totalsLine1: [
            `${filteredVehicles.length} Trucks`,
            String(dataset.totals.tripCount),
            formatINR(dataset.totals.freightRevenue),
            formatINR(dataset.totals.lorryHire),
            formatINR(dataset.totals.dieselExpense),
            formatINR(dataset.totals.tollFastag),
            formatINR(dataset.totals.driverBhatta),
            formatINR(roundPaise(dataset.totals.brokerCommission + dataset.totals.unloadingMisc)),
            formatINR(dataset.totals.netProfit),
          ],
          totalAmountForWords: Math.max(0, dataset.totals.netProfit),
        },
        company,
        'l'
      );
    }

    return generateFoxproStatementPDF(
      {
        title: 'T-R-I-P - W-I-S-E   E-X-P-E-N-S-E   &   N-E-T   P-R-O-F-I-T   S-H-E-E-T',
        subtitle: `${scopeTitle} · FY: ${activeFy} · As of ${formatDateDDMMYYYY(todayISO())}`,
        fileName: `Trip_Net_Profit_${(selectedTruckNo || 'Fleet').replace(/[^a-zA-Z0-9_-]/g, '_')}_${todayISO()}.pdf`,
        orientation: 'l',
        summaryLines: [
          { label: 'Freight Revenue', value: `Rs. ${formatINR(dataset.totals.freightRevenue)}` },
          { label: 'Lorry Hire + Expenses', value: `Rs. ${formatINR(dataset.totals.totalDeductions)}` },
          { label: 'Net Trip Profit', value: `Rs. ${formatINR(dataset.totals.netProfit)}` },
          { label: 'Net Margin %', value: `${dataset.totals.marginPct}%` },
        ],
        columns: [
          { label: 'CN NO / DATE', widthPct: 14, align: 'left' },
          { label: 'TRUCK / PARTY', widthPct: 18, align: 'left' },
          { label: 'FREIGHT REV', widthPct: 11, align: 'right' },
          { label: 'LORRY HIRE', widthPct: 11, align: 'right' },
          { label: 'DIESEL', widthPct: 9, align: 'right' },
          { label: 'TOLL', widthPct: 8, align: 'right' },
          { label: 'BHATTA', widthPct: 8, align: 'right' },
          { label: 'BROKER/MISC', widthPct: 10, align: 'right' },
          { label: 'NET PROFIT', widthPct: 11, align: 'right' },
        ],
        rows: filteredTrips.map((r) => ({
          line1: [
            r.cnNo,
            r.truckNo,
            formatINR(r.freightRevenue),
            formatINR(r.lorryHire),
            formatINR(r.dieselExpense),
            formatINR(r.tollFastag),
            formatINR(r.driverBhatta),
            formatINR(roundPaise(r.brokerCommission + r.unloadingMisc)),
            formatINR(r.netProfit),
          ],
          line2: [
            formatDateDDMMYYYY(r.cnDate),
            `${r.partyName} · ${r.route}`,
            '',
            '',
            '',
            '',
            '',
            `Brok: ${formatINR(r.brokerCommission)} | Misc: ${formatINR(r.unloadingMisc)}`,
            `${r.marginPct}%`,
          ],
        })),
        totalsLabel: 'NET PROFIT TOTALS :',
        totalsLine1: [
          `${filteredTrips.length} Trips`,
          '',
          formatINR(dataset.totals.freightRevenue),
          formatINR(dataset.totals.lorryHire),
          formatINR(dataset.totals.dieselExpense),
          formatINR(dataset.totals.tollFastag),
          formatINR(dataset.totals.driverBhatta),
          formatINR(roundPaise(dataset.totals.brokerCommission + dataset.totals.unloadingMisc)),
          formatINR(dataset.totals.netProfit),
        ],
        totalAmountForWords: Math.max(0, dataset.totals.netProfit),
      },
      company,
      'l'
    );
  };

  return (
    <div className="space-y-3">
      {/* Top KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="p-3 rounded-xl bg-white border border-blue-200 shadow-sm">
          <div className="text-[11px] font-bold text-blue-700 uppercase">
            Total Freight Revenue ({dataset.totals.tripCount} Trips)
          </div>
          <div className="font-mono-num text-lg font-extrabold text-slate-900 mt-0.5">
            ₹ {formatINR(dataset.totals.freightRevenue)}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-orange-200 shadow-sm">
          <div className="text-[11px] font-bold text-orange-700 uppercase">
            Lorry Hire Cost
          </div>
          <div className="font-mono-num text-lg font-extrabold text-orange-900 mt-0.5">
            ₹ {formatINR(dataset.totals.lorryHire)}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-amber-200 shadow-sm">
          <div className="text-[11px] font-bold text-amber-800 uppercase">
            Diesel + Toll + Bhatta + Broker + Misc
          </div>
          <div className="font-mono-num text-lg font-extrabold text-amber-950 mt-0.5">
            ₹{' '}
            {formatINR(
              roundPaise(dataset.totals.totalDeductions - dataset.totals.lorryHire)
            )}
          </div>
          <div className="text-[10px] text-slate-500 font-mono-num truncate">
            Diesel ₹{formatINR(dataset.totals.dieselExpense)} · Toll ₹{formatINR(dataset.totals.tollFastag)} · Brok ₹{formatINR(dataset.totals.brokerCommission)}
          </div>
        </div>

        <div
          className={`p-3 rounded-xl border shadow-sm ${
            dataset.totals.netProfit >= 0
              ? 'bg-emerald-50 border-emerald-300'
              : 'bg-red-50 border-red-300'
          }`}
        >
          <div
            className={`text-[11px] font-bold uppercase ${
              dataset.totals.netProfit >= 0 ? 'text-emerald-800' : 'text-red-800'
            }`}
          >
            Net Profit ({dataset.totals.marginPct}% Margin)
          </div>
          <div
            className={`font-mono-num text-lg font-extrabold mt-0.5 ${
              dataset.totals.netProfit >= 0 ? 'text-emerald-950' : 'text-red-900'
            }`}
          >
            ₹ {formatINR(dataset.totals.netProfit)}
          </div>
        </div>
      </div>

      {/* Trip Expense & Net Profit Calculator Form + 6-Button Bar */}
      <form
        onSubmit={handleSaveTripExpense}
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
      >
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-extrabold">
            <Calculator className="w-4 h-4 text-amber-300" />
            <span>
              Trip Expense &amp; Net Profit Calculator{' '}
              {scopeSelectedTruckOnly && selectedTruckNo ? `(${selectedTruckNo})` : '(All Fleet)'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="submit"
              disabled={saving || readOnly}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
            <button
              type="button"
              disabled={filteredTrips.length === 0}
              onClick={() => {
                const target =
                  filteredTrips.find((r) => r.cnNo === cnNoInput) || filteredTrips[0];
                if (target) loadRowIntoForm(target);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold cursor-pointer disabled:opacity-50"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Rectify</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildProfitPdf();
                onPreviewPdf(pdf, 'Reports_Ledgers');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white text-[#0D47A1] hover:bg-blue-50 font-bold cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildProfitPdf();
                downloadPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Low-KB PDF</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildProfitPdf();
                printPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Manual Print</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildProfitPdf();
                const res = await sharePdfDirect({
                  pdf,
                  channel: 'whatsapp',
                  partyName:
                    scopeSelectedTruckOnly && selectedTruckNo
                      ? selectedTruckNo
                      : company.companyName,
                  docNo: cnNoInput || activeFy,
                  docLabel: 'Trip Expense & Net Profit Sheet',
                  company,
                });
                setStatusMsg(res.message);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-bold cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share</span>
            </button>
          </div>
        </div>

        <div className="p-3.5 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              Select CN / Trip to Calculate or Rectify *
            </label>
            <RichEntityPicker<ComputedTripProfitRow>
              ariaLabel="Select Trip CN No"
              value={cnNoInput}
              selectedId={editingRowId}
              onChangeText={(txt) => setCnNoInput(txt.toUpperCase())}
              onSelectEntity={(row) => loadRowIntoForm(row)}
              items={dataset.tripRows}
              getId={(r) => r.id}
              getValue={(r) => r.cnNo}
              getSearchText={(r) => `${r.cnNo} ${r.truckNo} ${r.partyName} ${r.route}`}
              renderTitle={(r) => `${r.cnNo} · ${r.truckNo}`}
              renderBadge={(r) => (r.isSaved ? 'Saved' : 'Auto')}
              renderDetails={(r) =>
                `${r.partyName} (${r.route}) · Net ₹${formatINR(r.netProfit)}`
              }
              placeholder="Search CN No, Truck No, Party or Route..."
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Truck No</label>
            <input
              type="text"
              value={truckNoInput}
              onChange={(e) => setTruckNoInput(e.target.value.toUpperCase())}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num uppercase"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Trip Date</label>
            <input
              type="date"
              value={cnDateInput}
              onChange={(e) => setCnDateInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-blue-900 mb-1">
              (+) Total Freight Revenue (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={freightInput}
              onChange={(e) => setFreightInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-blue-300 bg-blue-50/40 font-mono-num font-bold"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              (−) Lorry Hire (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={lorryHireInput}
              onChange={(e) => setLorryHireInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              (−) Diesel / Fuel (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={dieselInput}
              onChange={(e) => setDieselInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              (−) Toll / Fastag (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={tollInput}
              onChange={(e) => setTollInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              (−) Driver Allowance / Bhatta (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={bhattaInput}
              onChange={(e) => setBhattaInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              (−) Broker Commission (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={brokerCommInput}
              onChange={(e) => setBrokerCommInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              (−) Unloading / Misc Expenses (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={miscInput}
              onChange={(e) => setMiscInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono-num"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Remarks / Pump Ref</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                placeholder="Diesel pump / Toll receipt..."
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded border border-slate-300"
              />
              <button
                type="button"
                onClick={resetForm}
                title="Clear Form"
                className="p-1.5 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Formula Live Result Strip */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-600">
            Formula: <strong>Freight</strong> (₹{formatINR(Number(freightInput || 0))}) −{' '}
            <strong>All Deductions</strong> (₹{formatINR(liveCalc.totalDeductions)})
          </div>
          <div
            className={`font-mono-num font-extrabold px-3 py-1 rounded-lg border ${
              liveCalc.netProfit >= 0
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                : 'bg-red-50 text-red-800 border-red-300'
            }`}
          >
            Net Trip Profit: ₹ {formatINR(liveCalc.netProfit)} ({liveCalc.marginPct}%)
          </div>
        </div>

        {statusMsg && (
          <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-200 text-emerald-900 text-xs font-semibold">
            {statusMsg}
          </div>
        )}
      </form>

      {/* Filter Toolbar & View Mode Switcher */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode('trips')}
              className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                viewMode === 'trips'
                  ? 'bg-[#0D47A1] text-white'
                  : 'bg-white border border-slate-300 text-slate-700'
              }`}
            >
              Per-Trip Breakdown ({filteredTrips.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('vehicles')}
              className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                viewMode === 'vehicles'
                  ? 'bg-[#0D47A1] text-white'
                  : 'bg-white border border-slate-300 text-slate-700'
              }`}
            >
              Per-Vehicle Summary ({filteredVehicles.length})
            </button>

            {selectedTruckNo && (
              <button
                type="button"
                onClick={() => setScopeSelectedTruckOnly((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold cursor-pointer border ${
                  scopeSelectedTruckOnly
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                <Truck className="w-3.5 h-3.5" />
                {scopeSelectedTruckOnly ? `Truck: ${selectedTruckNo}` : 'Showing All Fleet'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
              aria-label="Filter From Date"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1 rounded border border-slate-300 bg-white font-mono-num text-[11px]"
              aria-label="Filter To Date"
            />
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search CN, Truck, Party..."
                className="pl-8 pr-3 py-1 rounded-lg border border-slate-300 bg-white text-xs w-44"
              />
            </div>
          </div>
        </div>

        {/* Breakdown Tables */}
        {viewMode === 'trips' ? (
          <div className="overflow-x-auto max-h-[380px]">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 sticky top-0">
                <tr>
                  <th className="px-2.5 py-2 text-left">CN No / Date</th>
                  <th className="px-2.5 py-2 text-left">Truck / Route</th>
                  <th className="px-2.5 py-2 text-right">Freight ₹</th>
                  <th className="px-2.5 py-2 text-right">Hire ₹</th>
                  <th className="px-2.5 py-2 text-right">Diesel ₹</th>
                  <th className="px-2.5 py-2 text-right">Toll ₹</th>
                  <th className="px-2.5 py-2 text-right">Bhatta ₹</th>
                  <th className="px-2.5 py-2 text-right">Broker ₹</th>
                  <th className="px-2.5 py-2 text-right">Misc ₹</th>
                  <th className="px-2.5 py-2 text-right">Net Profit ₹</th>
                  <th className="px-2.5 py-2 text-center">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTrips.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                      No trips found for this filter.
                    </td>
                  </tr>
                ) : (
                  filteredTrips.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        cnNoInput === row.cnNo
                          ? 'bg-blue-50/70'
                          : 'hover:bg-slate-50'
                      }
                    >
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <div className="font-mono-num font-bold text-slate-900">
                          {row.cnNo}
                          {row.isSaved && (
                            <span className="ml-1.5 px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                              SAVED
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono-num">
                          {formatDateDDMMYYYY(row.cnDate)}
                        </div>
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="font-mono-num font-bold text-blue-800">{row.truckNo}</div>
                        <div className="text-[10px] text-slate-600 truncate max-w-[180px]">
                          {row.partyName} · {row.route}
                        </div>
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num font-bold text-slate-900">
                        {formatINR(row.freightRevenue)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num text-orange-800">
                        {formatINR(row.lorryHire)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num">
                        {formatINR(row.dieselExpense)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num">
                        {formatINR(row.tollFastag)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num">
                        {formatINR(row.driverBhatta)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num">
                        {formatINR(row.brokerCommission)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-num">
                        {formatINR(row.unloadingMisc)}
                      </td>
                      <td
                        className={`px-2.5 py-2 text-right font-mono-num font-extrabold whitespace-nowrap ${
                          row.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        <div>₹ {formatINR(row.netProfit)}</div>
                        <div className="text-[10px] font-normal">{row.marginPct}%</div>
                      </td>
                      <td className="px-2.5 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => loadRowIntoForm(row)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-bold hover:bg-amber-100 cursor-pointer"
                        >
                          <Edit3 className="w-2.5 h-2.5" />
                          Rectify
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[380px]">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Truck No</th>
                  <th className="px-3 py-2 text-center">Trips</th>
                  <th className="px-3 py-2 text-right">Freight Rev ₹</th>
                  <th className="px-3 py-2 text-right">Lorry Hire ₹</th>
                  <th className="px-3 py-2 text-right">Diesel ₹</th>
                  <th className="px-3 py-2 text-right">Toll ₹</th>
                  <th className="px-3 py-2 text-right">Bhatta ₹</th>
                  <th className="px-3 py-2 text-right">Broker ₹</th>
                  <th className="px-3 py-2 text-right">Misc ₹</th>
                  <th className="px-3 py-2 text-right">Net Profit ₹</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      No vehicle trip data found.
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((v) => (
                    <tr key={v.truckNo} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono-num font-extrabold text-blue-900">
                        {v.truckNo}
                      </td>
                      <td className="px-3 py-2 text-center font-mono-num font-bold">
                        {v.tripCount}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num font-bold">
                        {formatINR(v.freightRevenue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num text-orange-800">
                        {formatINR(v.lorryHire)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {formatINR(v.dieselExpense)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {formatINR(v.tollFastag)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {formatINR(v.driverBhatta)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {formatINR(v.brokerCommission)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {formatINR(v.unloadingMisc)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono-num font-extrabold ${
                          v.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        ₹ {formatINR(v.netProfit)} ({v.marginPct}%)
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
