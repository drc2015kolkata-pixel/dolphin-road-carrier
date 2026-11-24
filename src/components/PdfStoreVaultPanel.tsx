import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Mail,
  MessageSquare,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AnyDriveFolderName,
  BusinessMode,
  CompanySettings,
  LogisticsParty,
  Party,
  PdfVaultFolder,
} from '../types/erp';
import { formatDateHyphenDDMMYYYY, todayISO } from '../lib/formatters';
import {
  deleteVaultPdf,
  getVaultPdfEntry,
  listVaultPdfs,
  markVaultPdfDriveSynced,
  PDF_VAULT_FOLDER_META,
  PDF_VAULT_FOLDERS,
  PdfVaultMetadata,
  savePdfToVault,
} from '../lib/pdfVaultStorage';
import { uploadPdfToDivisionVaultFolder } from '../lib/driveBackup';
import { GeneratedPdfResult } from '../lib/pdfEngine';
import { downloadPdfFileFromResult, sharePdfBatchDirect, sharePdfDirect } from '../lib/shareUtils';
import { validateSafeUploadFile } from '../lib/gstinValidator';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';
import { OFFICIAL_PARTY_EMAIL } from '../lib/firebase';

interface PdfStoreVaultPanelProps {
  company: CompanySettings;
  parties?: Party[];
  logisticsParties?: LogisticsParty[];
  defaultDivision?: BusinessMode | 'ALL';
  driveAccessToken?: string | null;
  connectedEmail?: string | null;
  onConnectDrive?: () => Promise<void>;
  onPreviewPdf?: (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => void;
  titleSubtitle?: string;
}

const DIVISION_TABS: Array<{ id: BusinessMode | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All 4 Divisions' },
  { id: 'FTL', label: 'FTL' },
  { id: 'LOGISTICS', label: 'Logistics' },
  { id: 'PTL', label: 'PTL' },
  { id: 'COURIER', label: 'Courier' },
];

export const PdfStoreVaultPanel: React.FC<PdfStoreVaultPanelProps> = ({
  company,
  parties = [],
  logisticsParties = [],
  defaultDivision = 'ALL',
  driveAccessToken,
  connectedEmail,
  onConnectDrive,
  onPreviewPdf,
  titleSubtitle,
}) => {
  const [divisionFilter, setDivisionFilter] = useState<BusinessMode | 'ALL'>(defaultDivision);
  const [activeFolder, setActiveFolder] = useState<PdfVaultFolder>('1. LR_Copy_PDFs');
  const [allEntries, setAllEntries] = useState<PdfVaultMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDivisionFilter(defaultDivision);
  }, [defaultDivision]);

  const loadVaultEntries = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listVaultPdfs();
      setAllEntries(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVaultEntries();
    const handleUpdated = () => {
      void loadVaultEntries();
    };
    window.addEventListener('drc-pdf-vault-updated', handleUpdated);
    return () => {
      window.removeEventListener('drc-pdf-vault-updated', handleUpdated);
    };
  }, [loadVaultEntries]);

  const folderCounts = useMemo(() => {
    const counts: Record<PdfVaultFolder, number> = {
      '1. LR_Copy_PDFs': 0,
      '2. Tax_Invoice_PDFs': 0,
      '3. Quotation_PDFs': 0,
      '4. Declaration_PDFs': 0,
      '5. POD_Scans_PDFs': 0,
    };
    for (const item of allEntries) {
      if (divisionFilter !== 'ALL' && item.division !== divisionFilter) continue;
      if (counts[item.folder] !== undefined) {
        counts[item.folder] += 1;
      }
    }
    return counts;
  }, [allEntries, divisionFilter]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allEntries.filter((item) => {
      if (item.folder !== activeFolder) return false;
      if (divisionFilter !== 'ALL' && item.division !== divisionFilter) return false;
      if (!q) return true;
      return `${item.fileName} ${item.partyName || ''} ${item.docNo || ''} ${item.truckNo || ''} ${item.division}`
        .toLowerCase()
        .includes(q);
    });
  }, [allEntries, activeFolder, divisionFilter, searchQuery]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, PdfVaultMetadata[]>();
    for (const item of filteredEntries) {
      const key = item.createdDate || todayISO();
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredEntries]);

  const resolveRecipientContact = useCallback(
    (entry?: PdfVaultMetadata) => {
      const manualPhone = recipientPhone.trim();
      const manualEmail = recipientEmail.trim();
      if (!entry) {
        return {
          phone: manualPhone,
          email: manualEmail || company.email || OFFICIAL_PARTY_EMAIL,
        };
      }
      const cleanName = (entry.partyName || '').trim().toLowerCase();
      const ftlMatch = cleanName
        ? parties.find((p) => p.name.trim().toLowerCase() === cleanName)
        : undefined;
      const logiMatch = cleanName
        ? logisticsParties.find((p) => p.name.trim().toLowerCase() === cleanName)
        : undefined;
      return {
        phone: manualPhone || entry.phone || ftlMatch?.phone || logiMatch?.phone || '',
        email:
          manualEmail ||
          entry.email ||
          ftlMatch?.email ||
          logiMatch?.email ||
          company.email ||
          OFFICIAL_PARTY_EMAIL,
      };
    },
    [recipientPhone, recipientEmail, parties, logisticsParties, company.email]
  );

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectDateBatch = (items: PdfVaultMetadata[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((i) => next.has(i.id));
      if (allSelected) {
        items.forEach((i) => next.delete(i.id));
      } else {
        items.forEach((i) => next.add(i.id));
      }
      return next;
    });
  };

  const toggleDateCollapse = (dateKey: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const handlePreviewEntry = async (meta: PdfVaultMetadata) => {
    setErrorMessage(null);
    const loaded = await getVaultPdfEntry(meta.id);
    if (!loaded) {
      setErrorMessage(`Could not load binary PDF "${meta.fileName}" from local vault.`);
      return;
    }
    const blobUrl = URL.createObjectURL(loaded.blob);
    const contact = resolveRecipientContact(meta);
    if (onPreviewPdf) {
      const result: GeneratedPdfResult = {
        blob: loaded.blob,
        blobUrl,
        fileName: meta.fileName,
        title: `${PDF_VAULT_FOLDER_META[meta.folder].label} — ${meta.fileName}`,
        sizeKB: meta.sizeKB,
        orientation: 'p',
        shareMeta: {
          partyName: meta.partyName,
          docNo: meta.docNo || meta.truckNo || meta.fileName,
          phone: contact.phone,
          email: contact.email,
        },
      };
      onPreviewPdf(result, meta.folder);
    } else {
      downloadPdfFileFromResult({ blobUrl, fileName: meta.fileName });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    }
  };

  const handleDownloadEntry = async (meta: PdfVaultMetadata) => {
    setErrorMessage(null);
    const loaded = await getVaultPdfEntry(meta.id);
    if (!loaded) {
      setErrorMessage(`Could not load "${meta.fileName}" from vault.`);
      return;
    }
    const blobUrl = URL.createObjectURL(loaded.blob);
    downloadPdfFileFromResult({ blobUrl, fileName: meta.fileName });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    setStatusMessage(`Downloaded pure binary PDF: ${meta.fileName}`);
  };

  const handleShareSingle = async (meta: PdfVaultMetadata, channel: 'whatsapp' | 'email') => {
    setErrorMessage(null);
    const loaded = await getVaultPdfEntry(meta.id);
    if (!loaded) {
      setErrorMessage(`Could not load "${meta.fileName}" from vault.`);
      return;
    }
    const contact = resolveRecipientContact(meta);
    const res = await sharePdfDirect({
      pdf: { blob: loaded.blob, fileName: meta.fileName },
      channel,
      phone: contact.phone,
      email: contact.email,
      partyName: meta.partyName,
      docNo: meta.docNo || meta.truckNo || meta.fileName,
      docLabel: PDF_VAULT_FOLDER_META[meta.folder].shortLabel,
      company,
    });
    if (!res.cancelled) {
      setStatusMessage(res.message);
      playVerifiedBeep();
    }
  };

  const handleShareSelectedBatch = async (channel: 'whatsapp' | 'email') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusyAction(true);
    setErrorMessage(null);
    try {
      const loadedItems: Array<{ meta: PdfVaultMetadata; blob: Blob }> = [];
      for (const id of ids) {
        const entry = await getVaultPdfEntry(id);
        if (entry) loadedItems.push(entry);
      }
      if (loadedItems.length === 0) {
        setErrorMessage('No readable PDF binaries found for the current selection.');
        return;
      }
      const contact = resolveRecipientContact(loadedItems[0].meta);
      const res = await sharePdfBatchDirect({
        pdfs: loadedItems.map((item) => ({ blob: item.blob, fileName: item.meta.fileName })),
        channel,
        phone: contact.phone,
        email: contact.email,
        company,
      });
      if (!res.cancelled) {
        setStatusMessage(res.message);
        playVerifiedBeep();
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleUploadSingleToDrive = async (meta: PdfVaultMetadata) => {
    setErrorMessage(null);
    if (!driveAccessToken) {
      if (onConnectDrive) await onConnectDrive();
      return;
    }
    setBusyAction(true);
    try {
      const loaded = await getVaultPdfEntry(meta.id);
      if (!loaded) {
        setErrorMessage(`Could not load "${meta.fileName}" from vault.`);
        return;
      }
      const uploaded = await uploadPdfToDivisionVaultFolder({
        accessToken: driveAccessToken,
        division: meta.division,
        folderName: meta.folder,
        fileName: meta.fileName,
        blob: loaded.blob,
        connectedEmail,
      });
      await markVaultPdfDriveSynced(meta.id, {
        fileId: uploaded.id,
        webViewLink: uploaded.webViewLink,
      });
      setStatusMessage(
        `Synced ${meta.fileName} -> Google Drive / DOLPHIN_ROAD_CARRIERS_MASTER / ${meta.division}_PDF_VAULT / ${meta.folder}`
      );
      playVerifiedBeep();
    } catch (err) {
      playAlertBeep();
      setErrorMessage(err instanceof Error ? err.message : 'Drive sync failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSyncSelectedToDrive = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!driveAccessToken) {
      if (onConnectDrive) await onConnectDrive();
      return;
    }
    setBusyAction(true);
    setErrorMessage(null);
    try {
      let syncedCount = 0;
      for (const id of ids) {
        const entry = await getVaultPdfEntry(id);
        if (!entry) continue;
        const uploaded = await uploadPdfToDivisionVaultFolder({
          accessToken: driveAccessToken,
          division: entry.meta.division,
          folderName: entry.meta.folder,
          fileName: entry.meta.fileName,
          blob: entry.blob,
          connectedEmail,
        });
        await markVaultPdfDriveSynced(id, {
          fileId: uploaded.id,
          webViewLink: uploaded.webViewLink,
        });
        syncedCount += 1;
      }
      setStatusMessage(`Synced ${syncedCount} binary PDF(s) to segregated Google Drive Vault folders.`);
      playVerifiedBeep();
    } catch (err) {
      playAlertBeep();
      setErrorMessage(err instanceof Error ? err.message : 'Batch Drive sync failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteEntry = async (meta: PdfVaultMetadata) => {
    await deleteVaultPdf(meta.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(meta.id);
      return next;
    });
    setStatusMessage(`Removed "${meta.fileName}" from local PDF Vault.`);
  };

  const handleManualPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const safeCheck = validateSafeUploadFile(file, 'media_docs');
    if (!safeCheck.valid) {
      playAlertBeep();
      setErrorMessage(safeCheck.reason || 'Unsafe file blocked.');
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      playAlertBeep();
      setErrorMessage('Only pure .pdf files can be archived into the 5-Folder PDF Vault.');
      return;
    }
    const targetDivision: BusinessMode = divisionFilter === 'ALL' ? 'FTL' : divisionFilter;
    const saved = await savePdfToVault({
      folder: activeFolder,
      division: targetDivision,
      fileName: file.name.replace(/\s+/g, '_'),
      blob: file,
      createdDate: todayISO(),
    });
    if (saved) {
      setStatusMessage(`Archived ${saved.fileName} into ${PDF_VAULT_FOLDER_META[activeFolder].label}.`);
      playVerifiedBeep();
    }
  };

  const activeFolderMeta = PDF_VAULT_FOLDER_META[activeFolder];
  const todayKey = todayISO();

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header Band */}
      <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-amber-300 shrink-0" />
            <h3 className="text-sm font-bold tracking-tight truncate">
              PDF Store Vault — 5 Segregated Date-Grouped Folders
            </h3>
          </div>
          <p className="text-[11px] text-slate-300 mt-0.5 truncate">
            {titleSubtitle ||
              'Stores pure binary .pdf files across FTL, Logistics, PTL & Courier for instant WhatsApp / Email multi-select sharing & Drive sync'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={uploadInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => void handleManualPdfUpload(e)}
          />
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Archive .PDF Here</span>
          </button>
        </div>
      </div>

      {/* Division Filter & 5 Folder Tabs */}
      <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {DIVISION_TABS.map((div) => {
              const active = divisionFilter === div.id;
              return (
                <button
                  key={div.id}
                  type="button"
                  onClick={() => setDivisionFilter(div.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {div.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search file, party, LR, bill, truck..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs w-56 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
        </div>

        {/* 5 Segregated Folders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {PDF_VAULT_FOLDERS.map((folderId) => {
            const meta = PDF_VAULT_FOLDER_META[folderId];
            const active = activeFolder === folderId;
            const count = folderCounts[folderId];
            return (
              <button
                key={folderId}
                type="button"
                onClick={() => {
                  setActiveFolder(folderId);
                  setSelectedIds(new Set());
                }}
                className={`px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#0D47A1] border-[#0D47A1] text-white'
                    : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold truncate">{meta.label}</span>
                  <span
                    className={`text-xs font-mono-num font-bold shrink-0 ${
                      active ? 'text-amber-300' : 'text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </div>
                <div
                  className={`text-[10px] font-mono-num mt-1 truncate ${
                    active ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  {meta.patternHint}
                </div>
              </button>
            );
          })}
        </div>

        {/* Recipient Override + Pure Binary Share Notice */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700">Target Share Contact (optional):</span>
            <input
              type="text"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="WhatsApp Mobile (auto from Party if blank)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono-num w-52"
            />
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="Party Email (auto from Party if blank)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs w-56"
            />
          </div>
          <div className="text-[11px] text-slate-600">
            Folder Format: <span className="font-mono-num font-semibold">{activeFolderMeta.patternHint}</span> · Pure Binary .PDF Sharing Only
          </div>
        </div>
      </div>

      {/* Batch Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-bold text-slate-900 font-mono-num">
            {selectedIds.size} PDF file(s) selected
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleShareSelectedBatch('whatsapp')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp Selected PDF(s)</span>
            </button>
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleShareSelectedBatch('email')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Email Selected PDF(s)</span>
            </button>
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleSyncSelectedToDrive()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>{driveAccessToken ? 'Sync Selected to Drive' : 'Connect Drive & Sync'}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs font-semibold">
          {errorMessage}
        </div>
      )}

      {/* Body: Loading / Empty / Date-Grouped Rows */}
      <div className="divide-y divide-slate-200">
        {loading ? (
          <div className="p-4 space-y-2.5">
            <div className="h-10 rounded-lg bg-slate-100" />
            <div className="h-10 rounded-lg bg-slate-100" />
            <div className="h-10 rounded-lg bg-slate-100" />
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <FileText className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="text-sm font-bold text-slate-800">
              No PDFs saved in {activeFolderMeta.label} yet
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Every LR Copy, Tax Invoice, 2-Page Quotation, Section 194C Declaration, or POD PDF generated or scanned automatically archives here grouped by date.
            </p>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0D47A1] hover:bg-blue-900 text-white text-xs font-semibold cursor-pointer mt-1"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload External .PDF into {activeFolderMeta.shortLabel}</span>
            </button>
          </div>
        ) : (
          dateGroups.map(([dateKey, items]) => {
            const isToday = dateKey === todayKey;
            const dateLabel = isToday
              ? `Today's PDFs · ${formatDateHyphenDDMMYYYY(dateKey)}`
              : formatDateHyphenDDMMYYYY(dateKey);
            const isCollapsed = collapsedDates.has(dateKey);
            const allDateSelected = items.every((i) => selectedIds.has(i.id));

            return (
              <div key={dateKey}>
                {/* Date Group Header */}
                <div className="px-4 py-2.5 bg-slate-100/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800">
                      <input
                        type="checkbox"
                        checked={allDateSelected}
                        onChange={() => toggleSelectDateBatch(items)}
                        className="rounded border-slate-400"
                      />
                      <span>Select Date Batch</span>
                    </label>
                    <span className="text-slate-300" aria-hidden="true">|</span>
                    <button
                      type="button"
                      onClick={() => toggleDateCollapse(dateKey)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 hover:text-[#0D47A1] cursor-pointer"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      <span className="font-mono-num">{dateLabel}</span>
                    </button>
                  </div>

                  <div className="text-xs font-mono-num text-slate-600">
                    {items.length} file{items.length === 1 ? '' : 's'}
                  </div>
                </div>

                {/* Date Group Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const checked = selectedIds.has(item.id);
                      const detailParts = [
                        item.division,
                        item.docNo ? `Doc ${item.docNo}` : '',
                        item.partyName || '',
                        item.truckNo ? `Truck ${item.truckNo}` : '',
                        `${item.sizeKB} KB`,
                        item.driveSynced ? 'Synced to Drive' : 'Local Vault',
                      ].filter(Boolean);

                      return (
                        <div
                          key={item.id}
                          className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 transition-colors ${
                            checked ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectItem(item.id)}
                              aria-label={`Select ${item.fileName}`}
                              className="mt-1 rounded border-slate-400 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold font-mono-num text-slate-900 truncate">
                                {item.fileName}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono-num flex flex-wrap items-center gap-x-1.5 mt-0.5">
                                {detailParts.map((part, idx) => (
                                  <React.Fragment key={`${item.id}_part_${idx}`}>
                                    {idx > 0 && <span aria-hidden="true">·</span>}
                                    <span
                                      className={
                                        part === 'Synced to Drive'
                                          ? 'text-emerald-700 font-semibold'
                                          : undefined
                                      }
                                    >
                                      {part}
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handlePreviewEntry(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Preview</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDownloadEntry(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              <span>.PDF</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleShareSingle(item, 'whatsapp')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <MessageSquare className="w-3 h-3" />
                              <span>WhatsApp</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleShareSingle(item, 'email')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#0D47A1] hover:bg-blue-900 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Mail className="w-3 h-3" />
                              <span>Mail</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => void handleUploadSingleToDrive(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <CloudUpload className="w-3 h-3" />
                              <span>Drive</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteEntry(item)}
                              aria-label={`Delete ${item.fileName}`}
                              className="p-1.5 rounded-md border border-slate-200 bg-white hover:bg-red-50 text-red-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
