import React, { useMemo, useState } from 'react';
import {
  Building2,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  Printer,
  ScanLine,
  Search,
  Share2,
  Users,
} from 'lucide-react';
import { CompanySettings, Party } from '../types/erp';
import { formatDateDDMMYYYY, formatINR, sanitizeFileName, todayISO } from '../lib/formatters';
import { GST_STATE_CODE_OPTIONS, inferGstStateCodeAndName } from '../lib/gstinValidator';
import {
  downloadPdfDirect,
  generateTableReportPDF,
  GeneratedPdfResult,
  printPdfDirect,
} from '../lib/pdfEngine';
import { sharePdfDirect } from '../lib/shareUtils';
import { useDebouncedValue } from '../hooks/useDebounce';
import { PaginatedDataTable, TableColumn } from './PaginatedDataTable';
import { SearchableSelect } from './SearchableSelect';

interface PartyDirectorySheetProps {
  parties: Party[];
  company: CompanySettings;
  activeFy: string;
  onEditParty: (party: Party) => void;
  onOpenPartyLedger: (partyName: string, partyId: string) => void;
  onOpenPodScanner?: () => void;
  onPreviewPdf: (pdf: GeneratedPdfResult, folder: 'Reports_Ledgers') => void;
}

export const PartyDirectorySheet: React.FC<PartyDirectorySheetProps> = ({
  parties,
  company,
  activeFy,
  onEditParty,
  onOpenPartyLedger,
  onOpenPodScanner,
  onPreviewPdf,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [includeBrokersOwners, setIncludeBrokersOwners] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 180);

  const directoryRows = useMemo(() => {
    const base = parties.filter((p) => {
      if (includeBrokersOwners) return true;
      return p.partyType !== 'Broker' && p.partyType !== 'TruckOwner';
    });

    const enriched = base.map((p, idx) => {
      const inferred = inferGstStateCodeAndName({
        gstin: p.gstin,
        stateCode: p.stateCode,
        state: p.stateName,
        city: p.city,
        address: p.address,
        country: p.country,
      });
      const stateCode = p.stateCode || inferred.code || '19';
      const stateName = p.stateName || inferred.name || 'West Bengal';
      const fyOpening = company.fyOpeningBalances?.[activeFy]?.[p.id] ||
        company.fyOpeningBalances?.[activeFy]?.[p.name];
      const openAmt = fyOpening ? Number(fyOpening.amount || 0) : Number(p.openingBalance || 0);
      const openSide = fyOpening ? fyOpening.balanceType : p.balanceType || 'Dr';

      return {
        ...p,
        serialNo: idx + 1,
        resolvedCode: p.partyCode || `DRC-P-${String(idx + 1).padStart(4, '0')}`,
        resolvedCity:
          p.city ||
          String(p.address || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(-1)[0] ||
          '-',
        resolvedStateCode: stateCode,
        resolvedStateName: stateName,
        resolvedOpenAmt: openAmt,
        resolvedOpenSide: openSide,
        searchText: `${p.partyCode || ''} ${p.name} ${p.address || ''} ${p.city || ''} ${p.pinCode || ''} ${stateCode} ${stateName} ${p.gstin || ''} ${p.pan || ''} ${p.phone || ''} ${p.email || ''} ${p.contactPerson || ''}`.toLowerCase(),
      };
    });

    const tokens = debouncedSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return enriched.filter((row) => {
      if (stateFilter !== 'ALL' && row.resolvedStateCode !== stateFilter) return false;
      if (tokens.length > 0 && !tokens.every((t) => row.searchText.includes(t))) return false;
      return true;
    });
  }, [parties, includeBrokersOwners, company.fyOpeningBalances, activeFy, debouncedSearch, stateFilter]);

  const buildDirectoryPdf = async () => {
    return generateTableReportPDF({
      title: `Billing Party Master Directory (${directoryRows.length} Parties)`,
      subtitle: `${activeFy} · Printed ${formatDateDDMMYYYY(todayISO())}`,
      headers: [
        'S.No',
        'Code',
        'Party Name',
        'City / St',
        'PIN',
        'GSTIN',
        'PAN',
        'Phone',
        'Open Bal',
      ],
      rows: directoryRows.slice(0, 1200).map((r, i) => [
        String(i + 1),
        r.resolvedCode,
        r.name.slice(0, 28),
        `${r.resolvedCity.slice(0, 14)} (${r.resolvedStateCode})`,
        r.pinCode || '-',
        r.gstin || '-',
        r.pan || '-',
        r.phone || '-',
        `${formatINR(r.resolvedOpenAmt)} ${r.resolvedOpenSide}`,
      ]),
      company,
      fileName: `DRC_Billing_Party_Directory_${sanitizeFileName(activeFy)}.pdf`,
      orientation: 'l',
    });
  };

  const handleExportCsv = () => {
    const header = [
      'S.No',
      'Code',
      'Party Type',
      'Party Name',
      'Full Address',
      'City',
      'GST State Code',
      'GST State Name',
      'PIN Code',
      'GSTIN',
      'PAN',
      'Phone',
      'Email',
      'Contact Person',
      'Opening Balance',
      'Dr/Cr',
    ];
    const escapeCsv = (val: string | number | undefined) =>
      `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines = [
      header.map(escapeCsv).join(','),
      ...directoryRows.map((r, i) =>
        [
          i + 1,
          r.resolvedCode,
          r.partyType,
          r.name,
          r.address || '',
          r.resolvedCity,
          r.resolvedStateCode,
          r.resolvedStateName,
          r.pinCode || '',
          r.gstin || '',
          r.pan || '',
          r.phone || '',
          r.email || '',
          r.contactPerson || '',
          r.resolvedOpenAmt.toFixed(2),
          r.resolvedOpenSide,
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DRC_Billing_Party_Directory_${sanitizeFileName(activeFy)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const columns = useMemo<Array<TableColumn<(typeof directoryRows)[number]>>>(
    () => [
      {
        key: 'sno',
        header: 'S.No',
        cellClassName: 'font-mono-num text-xs whitespace-nowrap',
        render: (_r, idx) => idx + 1,
      },
      {
        key: 'code',
        header: 'Code',
        cellClassName: 'font-mono-num text-xs font-bold whitespace-nowrap',
        render: (r) => r.resolvedCode,
      },
      {
        key: 'name',
        header: 'Billing Party Name & Address',
        render: (r, _i, selected) => (
          <div className="min-w-[200px] max-w-[280px]">
            <div className={`font-bold text-xs ${selected ? 'text-white' : 'text-slate-900'}`}>
              {r.name}
            </div>
            <div className={`text-[10px] truncate ${selected ? 'text-blue-100' : 'text-slate-500'}`}>
              {r.address || '-'}
            </div>
          </div>
        ),
      },
      {
        key: 'city',
        header: 'City & GST State',
        cellClassName: 'text-xs whitespace-nowrap',
        render: (r) => (
          <div>
            <div className="font-semibold">{r.resolvedCity}</div>
            <div className="text-[10px] opacity-80">
              [{r.resolvedStateCode}] {r.resolvedStateName}
            </div>
          </div>
        ),
      },
      {
        key: 'pin',
        header: 'PIN Code',
        cellClassName: 'font-mono-num text-xs whitespace-nowrap',
        render: (r) => r.pinCode || '-',
      },
      {
        key: 'gst',
        header: 'GSTIN / PAN',
        cellClassName: 'font-mono-num text-[11px] whitespace-nowrap',
        render: (r) => (
          <div>
            <div className="font-bold">{r.gstin || 'Unregd'}</div>
            <div className="text-[10px] opacity-80">PAN: {r.pan || '-'}</div>
          </div>
        ),
      },
      {
        key: 'contact',
        header: 'Phone / Email / Contact',
        cellClassName: 'text-[11px]',
        render: (r) => (
          <div className="max-w-[190px]">
            <div className="font-mono-num font-semibold">{r.phone || '-'}</div>
            <div className="text-[10px] truncate opacity-80">{r.email || '-'}</div>
            {r.contactPerson && (
              <div className="text-[10px] truncate opacity-80">Attn: {r.contactPerson}</div>
            )}
          </div>
        ),
      },
      {
        key: 'opbal',
        header: 'Opening Bal',
        align: 'right',
        cellClassName: 'font-mono-num text-xs font-bold whitespace-nowrap',
        render: (r) => `₹ ${formatINR(r.resolvedOpenAmt)} ${r.resolvedOpenSide}`,
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        cellClassName: 'whitespace-nowrap',
        render: (r, _i, selected) => (
          <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onOpenPartyLedger(r.name, r.id)}
              className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer ${
                selected
                  ? 'bg-white text-blue-900'
                  : 'bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200'
              }`}
              title="Open Party Tally Ledger"
            >
              Ledger
            </button>
            <button
              type="button"
              onClick={() => onEditParty(r)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold cursor-pointer ${
                selected
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-300'
              }`}
              title="Rectify / Edit Party Master"
            >
              <Edit3 className="w-3 h-3" />
              Rectify
            </button>
          </div>
        ),
      },
    ],
    [onEditParty, onOpenPartyLedger]
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-[#0D47A1] to-[#1565C0] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-amber-300 shrink-0" />
            <div>
              <h2 className="text-sm sm:text-base font-extrabold">
                Total Billing Party Master Directory Sheet (1 – 1,000+ Parties)
              </h2>
              <p className="text-[11px] text-blue-100">
                Complete Customer Register: Code, Address, City, GST State Code (01–38), PIN, GSTIN, PAN, Phone, Email &amp; Opening Balance
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              disabled={directoryRows.length === 0}
              onClick={() => {
                const target =
                  (selectedId ? directoryRows.find((r) => r.id === selectedId) : undefined) ||
                  directoryRows[0];
                if (target) onEditParty(target);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-100 text-amber-950 font-bold hover:bg-amber-200 cursor-pointer disabled:opacity-50"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Rectify
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildDirectoryPdf();
                onPreviewPdf(pdf, 'Reports_Ledgers');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white text-[#0D47A1] font-bold hover:bg-blue-50 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            {onOpenPodScanner && (
              <button
                type="button"
                onClick={onOpenPodScanner}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold cursor-pointer"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Scan
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildDirectoryPdf();
                downloadPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Low-KB PDF
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildDirectoryPdf();
                printPdfDirect(pdf);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Manual Print
            </button>
            <button
              type="button"
              onClick={async () => {
                const pdf = await buildDirectoryPdf();
                await sharePdfDirect({
                  pdf,
                  channel: 'whatsapp',
                  partyName: 'Billing Party Directory',
                  docNo: activeFy,
                  docLabel: '1000-Party Master Directory',
                  company,
                });
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-bold cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Excel CSV
            </button>
          </div>
        </div>

        <div className="p-3.5 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-center text-xs">
          <div className="md:col-span-5 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Party Name, Code, GSTIN, PAN, City, PIN or Mobile (case-insensitive)..."
              className="w-full pl-8 pr-3 py-1.5 rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="md:col-span-4">
            <SearchableSelect
              ariaLabel="Filter by Indian GST State Code"
              value={stateFilter}
              onChange={setStateFilter}
              sortAlphabetically={false}
              options={[
                { value: 'ALL', label: 'All Indian States & Export (01–38 / 97)', pinFirst: true },
                ...GST_STATE_CODE_OPTIONS.map((s) => ({
                  value: s.code,
                  label: s.label,
                })),
              ]}
            />
          </div>

          <div className="md:col-span-3 flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeBrokersOwners}
                onChange={(e) => setIncludeBrokersOwners(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Include Brokers/Owners</span>
            </label>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-100 text-blue-900 font-bold whitespace-nowrap">
              <Users className="w-3.5 h-3.5" />
              {directoryRows.length}
            </span>
          </div>
        </div>

        <PaginatedDataTable
          data={directoryRows}
          columns={columns}
          getRowId={(r) => r.id}
          defaultPageSize={50}
          selectedRowId={selectedId}
          onRowClick={(r) => setSelectedId(r.id)}
          maxHeightClass="max-h-[600px]"
          stickyHeader
          emptyMessage="No Billing Parties matched your search/state filter."
        />
      </div>
    </div>
  );
};
