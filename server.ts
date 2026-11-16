import express, { Response } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

// ============================================================================
// Shared Persistent Multi-Branch ERP Store (Atomic JSON + Real-Time SSE Sync)
// Supports Master Admin (admin / admin123) + 50+ Concurrent Branch Staff IDs
// ============================================================================

const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'drc-erp-db.json');

type CollectionKey =
  | 'parties'
  | 'vehicles'
  | 'drivers'
  | 'consignments'
  | 'invoices'
  | 'quotations'
  | 'lorry_hires'
  | 'transactions'
  | 'declarations'
  | 'staff_accounts'
  | 'presence'
  | 'activity_logs'
  | 'settings'
  | 'counters';

const VALID_COLLECTIONS = new Set<CollectionKey>([
  'parties',
  'vehicles',
  'drivers',
  'consignments',
  'invoices',
  'quotations',
  'lorry_hires',
  'transactions',
  'declarations',
  'staff_accounts',
  'presence',
  'activity_logs',
  'settings',
  'counters',
]);

interface ErpDoc {
  id: string;
  [key: string]: unknown;
}

interface AdminCredentials {
  userId: string;
  password: string;
}

interface ErpDbSchema {
  version: number;
  adminCredentials: AdminCredentials;
  parties: ErpDoc[];
  vehicles: ErpDoc[];
  drivers: ErpDoc[];
  consignments: ErpDoc[];
  invoices: ErpDoc[];
  quotations: ErpDoc[];
  lorry_hires: ErpDoc[];
  transactions: ErpDoc[];
  declarations: ErpDoc[];
  staff_accounts: ErpDoc[];
  presence: ErpDoc[];
  activity_logs: ErpDoc[];
  settings: ErpDoc[];
  counters: ErpDoc[];
}

const APP_VERSION = '2.0.0';
const SERVER_BOOT_ISO = new Date().toISOString();

const DEFAULT_COMPANY_SETTINGS_SERVER = {
  id: 'company',
  companyName: 'DOLPHIN ROAD CARRIER',
  tagline: 'Fast • Safe • Reliable',
  address: '30/1/29, Nobin Chandra Das Road, Nawapara, Kolkata - 700090',
  pan: 'DOTPS3540M',
  gstin: '19DOTPS3540M1ZZ',
  msme: 'UDYAM-WB-14-0024412',
  hsn: '996791',
  phones: '9062167077, 9674115666',
  email: 'drc.kolkata1@gmail.com',
  bankName: 'PUNJAB NATIONAL BANK',
  bankBranch: 'JORASANKO, KOLKATA',
  accountNo: '0672050014252',
  ifsc: 'PUNB0008020',
  swift: 'PUNBINBBXXX',
  currentFy: '2026-2027',
  ownerUid: 'drc_master_workspace',
};

const DEFAULT_STAFF_SEED: ErpDoc[] = [
  {
    id: 'staff_0',
    staffCode: 'DRC-STAFF-01',
    displayName: 'Amitava Sen (Howrah Billing)',
    role: 'Billing',
    branchCode: 'HOWRAH',
    pinHash: '1234',
    active: true,
    permissions: ['dashboard', 'lr', 'billing', 'reports'],
    ownerUid: 'drc_master_workspace',
  },
  {
    id: 'staff_1',
    staffCode: 'DRC-STAFF-02',
    displayName: 'Suman Chatterjee (Siliguri Accounts)',
    role: 'Accounts',
    branchCode: 'SILIGURI',
    pinHash: '5678',
    active: true,
    permissions: ['dashboard', 'lorryHire', 'accounts', 'reports', 'mis'],
    ownerUid: 'drc_master_workspace',
  },
];

function createEmptyDb(): ErpDbSchema {
  const now = Date.now();
  return {
    version: 1,
    adminCredentials: {
      userId: 'admin',
      password: 'admin123',
    },
    parties: [],
    vehicles: [],
    drivers: [],
    consignments: [],
    invoices: [],
    quotations: [],
    lorry_hires: [],
    transactions: [],
    declarations: [],
    staff_accounts: DEFAULT_STAFF_SEED.map((s) => ({
      ...s,
      createdAt: now,
      updatedAt: now,
    })),
    presence: [],
    activity_logs: [],
    settings: [{ ...DEFAULT_COMPANY_SETTINGS_SERVER, updatedAt: now }],
    counters: [],
  };
}

let erpDb: ErpDbSchema = createEmptyDb();
let persistChain: Promise<void> = Promise.resolve();
let mutationQueue: Promise<unknown> = Promise.resolve();
const sseClients = new Set<Response>();

function getPublicErpState(): Omit<ErpDbSchema, 'adminCredentials'> {
  const { adminCredentials: _secret, ...publicState } = erpDb;
  return publicState;
}

function loadDbFromDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      erpDb = createEmptyDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(erpDb, null, 2), 'utf8');
      return;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ErpDbSchema>;
    const base = createEmptyDb();
    if (
      parsed.adminCredentials &&
      typeof parsed.adminCredentials.userId === 'string' &&
      parsed.adminCredentials.userId.trim() &&
      typeof parsed.adminCredentials.password === 'string' &&
      parsed.adminCredentials.password.trim()
    ) {
      base.adminCredentials = {
        userId: parsed.adminCredentials.userId.trim(),
        password: parsed.adminCredentials.password,
      };
    }
    for (const key of VALID_COLLECTIONS) {
      if (Array.isArray(parsed[key])) {
        base[key] = parsed[key] as ErpDoc[];
      }
    }
    if (base.settings.length === 0) {
      base.settings = [{ ...DEFAULT_COMPANY_SETTINGS_SERVER, updatedAt: Date.now() }];
    }
    if (base.staff_accounts.length === 0) {
      const now = Date.now();
      base.staff_accounts = DEFAULT_STAFF_SEED.map((s) => ({
        ...s,
        createdAt: now,
        updatedAt: now,
      }));
    }
    erpDb = base;
  } catch (err) {
    console.error('Failed to load ERP DB from disk, starting with fresh defaults:', err);
    erpDb = createEmptyDb();
  }
}

loadDbFromDisk();

function queueDiskPersist(): Promise<void> {
  const snapshot = JSON.stringify(erpDb);
  persistChain = persistChain
    .then(async () => {
      if (!fs.existsSync(DATA_DIR)) {
        await fsp.mkdir(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
      await fsp.writeFile(tmpFile, snapshot, 'utf8');
      await fsp.rename(tmpFile, DB_FILE);
    })
    .catch((err) => {
      console.error('ERP DB persist warning:', err);
    });
  return persistChain;
}

function runAtomicMutation<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = mutationQueue.then(fn, fn);
  mutationQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function broadcastEvent(payload: unknown): void {
  const dataStr = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(dataStr);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastCollections(collections: CollectionKey[]): void {
  for (const col of collections) {
    broadcastEvent({
      type: 'collection',
      collection: col,
      items: erpDb[col],
    });
  }
}

function makeDocId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayIsoServer(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatFyShortServer(fy: string): string {
  const parts = fy.split('-').map((p) => p.trim());
  if (parts.length === 2 && parts[0].length >= 4 && parts[1].length >= 2) {
    return `${parts[0].slice(-2)}-${parts[1].slice(-2)}`;
  }
  return '26-27';
}

function branchShortPrefixServer(branchCode: string): string {
  const clean = (branchCode || 'KOL-HQ').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean || clean === 'ALL' || clean.startsWith('KOL')) return 'KOL';
  return clean.slice(0, 3);
}

function sanitizeSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
}

function getCollectionSafe(name: unknown): CollectionKey | null {
  if (typeof name !== 'string') return null;
  return VALID_COLLECTIONS.has(name as CollectionKey) ? (name as CollectionKey) : null;
}

// ============================================================================
// ERP API Routes (Auth, Sync, Atomic Counters, Presence, Seed, Restore)
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dolphin-road-carriers-erp' });
});

app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    ok: true,
    version: APP_VERSION,
    buildTime: process.env.NODE_ENV === 'production' ? SERVER_BOOT_ISO : 'dev',
    serverBootAt: SERVER_BOOT_ISO,
  });
});

app.get('/api/erp/auth/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { userId, password } = erpDb.adminCredentials;
  const isDefaultAdmin = userId.toLowerCase() === 'admin' && password === 'admin123';
  res.json({
    ok: true,
    isDefaultAdmin,
    adminUserIdHint: userId,
  });
});

app.post('/api/erp/auth/login', (req, res) => {
  const { userId, password } = (req.body || {}) as { userId?: string; password?: string };
  const cleanUserId = String(userId || '').trim();
  const cleanPassword = String(password || '').trim();

  if (!cleanUserId || !cleanPassword) {
    res.status(400).json({ error: 'Please enter both User ID and Password.' });
    return;
  }

  // Master Admin Credentials (default: admin / admin123; customizable in Settings)
  const adminCreds = erpDb.adminCredentials;
  if (cleanUserId.toLowerCase() === adminCreds.userId.toLowerCase()) {
    if (cleanPassword !== adminCreds.password) {
      res.status(401).json({
        error:
          adminCreds.password === 'admin123'
            ? 'Invalid password for Master Admin (default: admin123).'
            : 'Invalid password for Master Admin.',
      });
      return;
    }
    res.json({
      ok: true,
      session: {
        userId: adminCreds.userId,
        displayName: 'Master Admin',
        role: 'Admin',
        isMasterAdmin: true,
        branchCode: 'ALL',
        workspaceUid: 'drc_master_workspace',
        staffAccount: null,
        loggedInAt: Date.now(),
      },
    });
    return;
  }

  // Staff User ID & Password Match (50+ Branch Logins created in Settings)
  const matchedStaff = erpDb.staff_accounts.find(
    (s) => String(s.staffCode || '').trim().toLowerCase() === cleanUserId.toLowerCase()
  );

  if (!matchedStaff) {
    res.status(401).json({ error: `User ID "${cleanUserId}" not found. Check Settings or contact Admin.` });
    return;
  }

  if (matchedStaff.active === false) {
    res.status(403).json({ error: `User ID "${matchedStaff.staffCode}" is currently disabled.` });
    return;
  }

  if (String(matchedStaff.pinHash || '') !== cleanPassword) {
    res.status(401).json({ error: 'Incorrect password for this Staff User ID.' });
    return;
  }

  res.json({
    ok: true,
    session: {
      userId: String(matchedStaff.staffCode),
      displayName: String(matchedStaff.displayName || matchedStaff.staffCode),
      role: String(matchedStaff.role || 'Staff'),
      isMasterAdmin: matchedStaff.role === 'Admin',
      branchCode: String(matchedStaff.branchCode || 'ALL'),
      workspaceUid: 'drc_master_workspace',
      staffAccount: matchedStaff,
      loggedInAt: Date.now(),
    },
  });
});

app.post('/api/erp/auth/update-admin', async (req, res) => {
  const { currentPassword, newUserId, newPassword } = (req.body || {}) as {
    currentPassword?: string;
    newUserId?: string;
    newPassword?: string;
  };

  const currPwd = String(currentPassword || '').trim();
  const nextUid = String(newUserId || '').trim();
  const nextPwd = String(newPassword || '').trim();

  if (!currPwd || !nextUid || !nextPwd) {
    res.status(400).json({ error: 'Enter Current Password, New Admin User ID, and New Password.' });
    return;
  }

  if (nextUid.length < 3 || /\s/.test(nextUid)) {
    res.status(400).json({ error: 'Admin User ID must be at least 3 characters with no spaces.' });
    return;
  }

  if (nextPwd.length < 4) {
    res.status(400).json({ error: 'New Admin Password must be at least 4 characters.' });
    return;
  }

  try {
    const updatedSession = await runAtomicMutation(async () => {
      if (currPwd !== erpDb.adminCredentials.password) {
        throw new Error('Current Master Admin password is incorrect.');
      }

      const collidesWithStaff = erpDb.staff_accounts.some(
        (s) => String(s.staffCode || '').trim().toLowerCase() === nextUid.toLowerCase()
      );
      if (collidesWithStaff) {
        throw new Error(`User ID "${nextUid}" is already assigned to a Staff account.`);
      }

      erpDb.adminCredentials = {
        userId: nextUid,
        password: nextPwd,
      };
      await queueDiskPersist();

      return {
        userId: nextUid,
        displayName: 'Master Admin',
        role: 'Admin',
        isMasterAdmin: true,
        branchCode: 'ALL',
        workspaceUid: 'drc_master_workspace',
        staffAccount: null,
        loggedInAt: Date.now(),
      };
    });

    res.json({ ok: true, session: updatedSession });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update Admin credentials.' });
  }
});

app.get('/api/erp/state', (_req, res) => {
  res.json({ ok: true, state: getPublicErpState() });
});

app.get('/api/erp/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'full', state: getPublicErpState() })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

app.post('/api/erp/upsert', async (req, res) => {
  const { collection: colName, id, payload, isNew } = (req.body || {}) as {
    collection?: string;
    id?: string;
    payload?: Record<string, unknown>;
    isNew?: boolean;
  };

  const col = getCollectionSafe(colName);
  if (!col || !id || !payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Invalid upsert payload.' });
    return;
  }

  const safeId = sanitizeSafeId(id);

  try {
    const resultId = await runAtomicMutation(async () => {
      const list = erpDb[col];
      const idx = list.findIndex((item) => item.id === safeId);
      const now = Date.now();

      // Server-side guard: Enforce Strict POD Lock on Lorry Hire balance payment
      if (col === 'lorry_hires') {
        const merged = idx >= 0 ? { ...list[idx], ...payload } : { ...payload };
        if (merged.balancePaid === true) {
          const hasPod =
            merged.podReceived === true &&
            typeof merged.podReceiveDate === 'string' &&
            merged.podReceiveDate.length >= 8 &&
            typeof merged.podFileName === 'string' &&
            merged.podFileName.length >= 1;
          if (!hasPod) {
            throw new Error(
              'POD Lock Active: Signed POD scan and POD Receive Date are mandatory before releasing balance payment.'
            );
          }
        }
      }

      if (idx >= 0) {
        const existing = list[idx];
        list[idx] = {
          ...existing,
          ...payload,
          id: safeId,
          createdAt: existing.createdAt ?? now,
          updatedAt: now,
        };
      } else {
        list.push({
          ...payload,
          id: safeId,
          createdAt: isNew ? now : (payload.createdAt ?? now),
          updatedAt: now,
        });
      }

      await queueDiskPersist();
      broadcastCollections([col]);
      return safeId;
    });

    res.json({ ok: true, id: resultId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upsert failed' });
  }
});

app.post('/api/erp/delete', async (req, res) => {
  const { collection: colName, id } = (req.body || {}) as {
    collection?: string;
    id?: string;
  };
  const col = getCollectionSafe(colName);
  if (!col || !id) {
    res.status(400).json({ error: 'Invalid delete request.' });
    return;
  }

  await runAtomicMutation(async () => {
    erpDb[col] = erpDb[col].filter((item) => item.id !== id);
    await queueDiskPersist();
    broadcastCollections([col]);
  });

  res.json({ ok: true });
});

app.post('/api/erp/settings', async (req, res) => {
  const { settingId, payload } = (req.body || {}) as {
    settingId?: string;
    payload?: Record<string, unknown>;
  };
  if (!settingId || !payload) {
    res.status(400).json({ error: 'Invalid settings payload.' });
    return;
  }

  const safeId = sanitizeSafeId(settingId);
  await runAtomicMutation(async () => {
    const idx = erpDb.settings.findIndex((s) => s.id === safeId);
    const now = Date.now();
    if (idx >= 0) {
      erpDb.settings[idx] = {
        ...erpDb.settings[idx],
        ...payload,
        id: safeId,
        updatedAt: now,
      };
    } else {
      erpDb.settings.push({
        ...payload,
        id: safeId,
        updatedAt: now,
      });
    }
    await queueDiskPersist();
    broadcastCollections(['settings']);
  });

  res.json({ ok: true });
});

app.post('/api/erp/counter/next', async (req, res) => {
  const { type, fy, branchCode, staffCode, ownerUid } = (req.body || {}) as {
    type?: 'cn' | 'invoice' | 'quotation' | 'tx';
    fy?: string;
    branchCode?: string;
    staffCode?: string;
    ownerUid?: string;
  };

  if (!type || !['cn', 'invoice', 'quotation', 'tx'].includes(type)) {
    res.status(400).json({ error: 'Invalid counter type.' });
    return;
  }

  const fyStr = String(fy || '2026-2027');
  const fySafe = fyStr.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12) || '2026_2027';
  const counterId = `counter_${type}_${fySafe}`;
  const fyShort = formatFyShortServer(fyStr);
  const branchTag = branchShortPrefixServer(branchCode || 'KOL-HQ');
  const prefixMap = {
    cn: branchTag,
    invoice: branchTag,
    quotation: 'QTN',
    tx: 'TRN',
  } as const;

  const result = await runAtomicMutation(async () => {
    const idx = erpDb.counters.findIndex((c) => c.id === counterId);
    const now = Date.now();
    let nextSeq = 1;

    if (idx < 0) {
      erpDb.counters.push({
        id: counterId,
        seq: 1,
        prefix: prefixMap[type],
        fy: fyStr.slice(0, 12),
        branchCode: String(branchCode || 'KOL-HQ').slice(0, 32),
        lastUpdatedBy: String(staffCode || 'ADMIN').slice(0, 64),
        ownerUid: ownerUid || 'drc_master_workspace',
        updatedAt: now,
      });
    } else {
      const curr = Number(erpDb.counters[idx].seq || 0);
      nextSeq = Number.isFinite(curr) && curr >= 1 ? Math.floor(curr) + 1 : 1;
      erpDb.counters[idx] = {
        ...erpDb.counters[idx],
        seq: nextSeq,
        branchCode: String(branchCode || 'KOL-HQ').slice(0, 32),
        lastUpdatedBy: String(staffCode || 'ADMIN').slice(0, 64),
        updatedAt: now,
      };
    }

    await queueDiskPersist();
    broadcastCollections(['counters']);

    let formattedNo = '';
    if (type === 'cn') {
      formattedNo = `${branchTag}-${146 + nextSeq}/${fyShort}`;
    } else if (type === 'invoice') {
      formattedNo = `${branchTag}/${104 + nextSeq}/${fyShort}`;
    } else if (type === 'quotation') {
      const fyStartYear = fyStr.split('-')[0] || '2026';
      formattedNo = `QTN/${fyStartYear}/${String(18 + nextSeq).padStart(3, '0')}`;
    } else {
      formattedNo = `TRN${String(5 + nextSeq).padStart(3, '0')}`;
    }

    return { formattedNo, seq: nextSeq };
  });

  res.json({ ok: true, ...result });
});

app.post('/api/erp/presence', async (req, res) => {
  const params = (req.body || {}) as {
    ownerUid?: string;
    staffCode?: string;
    displayName?: string;
    role?: string;
    branchCode?: string;
    activeModule?: string;
    deviceType?: string;
    status?: 'online' | 'offline';
  };

  const safeStaff = String(params.staffCode || 'ADMIN')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 32);
  const safeUid = String(params.ownerUid || 'drc_master_workspace')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 64);
  const presenceId = `pres_${safeUid}_${safeStaff}`.slice(0, 128);

  await runAtomicMutation(async () => {
    const idx = erpDb.presence.findIndex((p) => p.id === presenceId);
    const entry: ErpDoc = {
      id: presenceId,
      staffCode: safeStaff,
      ownerUid: params.ownerUid || 'drc_master_workspace',
      displayName: String(params.displayName || 'Operator').slice(0, 100),
      role: String(params.role || 'Admin').slice(0, 32),
      branchCode: String(params.branchCode || 'KOL-HQ').slice(0, 32),
      activeModule: String(params.activeModule || 'dashboard').slice(0, 64),
      deviceType: String(params.deviceType || 'Desktop').slice(0, 40),
      status: params.status === 'offline' ? 'offline' : 'online',
      lastSeenAt: Date.now(),
    };

    if (idx >= 0) {
      erpDb.presence[idx] = entry;
    } else {
      erpDb.presence.push(entry);
    }

    await queueDiskPersist();
    broadcastCollections(['presence']);
  });

  res.json({ ok: true });
});

app.post('/api/erp/activity', async (req, res) => {
  const params = (req.body || {}) as {
    action?: string;
    module?: string;
    docRefCode?: string;
    summary?: string;
    staffCode?: string;
    staffName?: string;
    branchCode?: string;
    ownerUid?: string;
  };

  await runAtomicMutation(async () => {
    const entry: ErpDoc = {
      id: makeDocId('act'),
      action: String(params.action || 'Action').slice(0, 80),
      module: String(params.module || 'ERP').slice(0, 40),
      docRefCode: String(params.docRefCode || '').slice(0, 80),
      summary: String(params.summary || '').slice(0, 300),
      staffCode: String(params.staffCode || 'ADMIN').slice(0, 32),
      staffName: String(params.staffName || params.staffCode || 'Admin').slice(0, 100),
      branchCode: String(params.branchCode || 'KOL-HQ').slice(0, 32),
      ownerUid: params.ownerUid || 'drc_master_workspace',
      createdAt: Date.now(),
    };

    erpDb.activity_logs = [entry, ...erpDb.activity_logs].slice(0, 500);
    await queueDiskPersist();
    broadcastCollections(['activity_logs']);
  });

  res.json({ ok: true });
});

app.post('/api/erp/seed', async (req, res) => {
  const { ownerUid = 'drc_master_workspace' } = (req.body || {}) as { ownerUid?: string };
  const today = todayIsoServer();
  const now = Date.now();

  await runAtomicMutation(async () => {
    const mergeById = (col: CollectionKey, rows: ErpDoc[]) => {
      const map = new Map(erpDb[col].map((d) => [d.id, d]));
      for (const r of rows) {
        if (!map.has(r.id)) {
          map.set(r.id, { ...r, createdAt: now, updatedAt: now });
        }
      }
      erpDb[col] = Array.from(map.values());
    };

    mergeById('parties', [
      {
        id: 'party_sample_0',
        name: 'PARUCCO FUNDRY P LTD',
        partyType: 'Customer',
        address: '142/1 G T ROAD SERAMPORE HOOGHLY',
        gstin: '19AADCP0740Q1Z1',
        pan: 'AADCP0740Q',
        phone: '9830123456',
        email: 'accounts@parucco.in',
        openingBalance: 0,
        currentBalance: 179950,
        balanceType: 'Dr',
        ownerUid,
      },
      {
        id: 'party_sample_1',
        name: 'BENGAL IRON CORPORATION',
        partyType: 'Customer',
        address: 'RG/Office- P-5 C.I.T Road Scheme Vim PHO, Kolkata-700054',
        gstin: '19AACFB7509H1ZG',
        pan: 'AACFB7509H',
        phone: '9831044556',
        email: 'billing@bengaliron.com',
        openingBalance: 45000,
        currentBalance: 120000,
        balanceType: 'Dr',
        ownerUid,
      },
      {
        id: 'party_sample_2',
        name: 'M/s. Krishi Bharati',
        partyType: 'Consignor',
        address: '353, B.B Housing, PO-Shyamnagar, 24 PGS(N)',
        gstin: '19AAHFK8744E1ZP',
        pan: 'AAHFK8744E',
        phone: '9830556677',
        email: 'dispatch@krishibharati.in',
        openingBalance: 0,
        currentBalance: 62744,
        balanceType: 'Dr',
        ownerUid,
      },
      {
        id: 'party_sample_3',
        name: 'Bikash Ghosh Fleet Owners',
        partyType: 'TruckOwner',
        address: 'Dankuni Transport Nagar, Hooghly',
        gstin: '',
        pan: 'BKPGH4412L',
        phone: '9733112233',
        email: '',
        openingBalance: 0,
        currentBalance: 32000,
        balanceType: 'Cr',
        ownerUid,
      },
    ]);

    mergeById('vehicles', [
      {
        id: 'veh_sample_0',
        truckNo: 'WB23C6597',
        vehicleType: '22 FT Open Trailer',
        ownerName: 'Dolphin Road Carrier Fleet',
        ownerPhone: '9062167077',
        engineNo: 'B591803251H63458725',
        chassisNo: 'MAT466420F1H19488',
        fitnessExpiry: '2027-06-15',
        insuranceExpiry: '2027-05-20',
        permitExpiry: '2027-08-01',
        pucExpiry: '2027-02-15',
        ownerUid,
      },
      {
        id: 'veh_sample_1',
        truckNo: 'WB51B0800',
        vehicleType: '16 Ton 6-Wheeler',
        ownerName: 'Bikash Ghosh',
        ownerPhone: '9733112233',
        engineNo: '497TCIC441122',
        chassisNo: 'MAT448120K1B08811',
        fitnessExpiry: '2026-10-15',
        insuranceExpiry: '2026-11-30',
        permitExpiry: '2027-03-10',
        pucExpiry: '2026-11-01',
        ownerUid,
      },
      {
        id: 'veh_sample_2',
        truckNo: 'WB57C4332',
        vehicleType: '32 FT Container',
        ownerName: 'Saha Transport Syndicate',
        ownerPhone: '9674115666',
        engineNo: 'ISBE67001122',
        chassisNo: 'MAT559011L1C4332',
        fitnessExpiry: '2027-09-12',
        insuranceExpiry: '2027-04-04',
        permitExpiry: '2027-10-15',
        pucExpiry: '2027-03-01',
        ownerUid,
      },
    ]);

    mergeById('drivers', [
      {
        id: 'drv_sample_0',
        name: 'Raju Shaw',
        dlNo: 'WB-512008000488',
        dlExpiry: '2026-11-01',
        phone: '9831990011',
        address: 'N-24 PGS, West Bengal',
        ownerUid,
      },
      {
        id: 'drv_sample_1',
        name: 'Manoj Kumar Yadav',
        dlNo: 'WB-232015009812',
        dlExpiry: '2028-05-19',
        phone: '9830778899',
        address: 'Dankuni, Hooghly',
        ownerUid,
      },
    ]);

    mergeById('consignments', [
      {
        id: 'cn_sample_0',
        cnNo: 'KOL/118/26-27',
        cnDate: '2026-10-09',
        deliveryOffice: 'PETRAPOLE / DHAKA BORDER',
        consignorName: 'PARUCCO FUNDRY P LTD',
        consignorAddress: '142/1 G T ROAD SERAMPORE HOOGHLY',
        consignorGstin: '19AADCP0740Q1Z1',
        consigneeName: 'BENGAL TEA MACHINERY LTD',
        consigneeAddress: 'DHAKA, BANGLADESH',
        consigneeGstin: '',
        packages: '42',
        particulars: 'TEA MACHINERY PARTS AS PER CHALLAN',
        nettWeight: 14.5,
        grossWeight: 15.2,
        loadingCharge: 0,
        unloadingCharge: 9300,
        returnLorryCharge: 0,
        sttCharge: 150,
        totalFreight: 157000,
        paidAmount: 0,
        toPayAmount: 157000,
        taxInvNo: 'PFPL/26-27/E/21',
        taxInvDate: '2026-10-09',
        ewayBillNo: '871768055110',
        ewayBillDate: '2026-10-09',
        valueOfGoods: 1850000,
        truckNo: 'WB23C6597',
        fromCity: 'HOOGHLY',
        toCity: 'BANGLADESH (DHAKA)',
        engineNo: 'B591803251H63458725',
        chassisNo: 'MAT466420F1H19488',
        ownerName: 'Dolphin Road Carrier Fleet',
        driverName: 'Manoj Kumar Yadav',
        driverDlNo: 'WB-232015009812',
        gstPaidBy: 'Consignee (RCM)',
        insuranceStatus: 'The Customer has not insured the consignment',
        billed: true,
        invoiceId: 'sample_inv_104',
        branchCode: 'KOL-HQ',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
      {
        id: 'cn_sample_1',
        cnNo: 'KOL-146/26-27',
        cnDate: '2026-11-10',
        deliveryOffice: 'SILIGURI',
        consignorName: 'M/s. Krishi Bharati',
        consignorAddress: '353, B.B Housing, PO-Shyamnagar, 24 PGS(N)',
        consignorGstin: '19AAHFK8744E1ZP',
        consigneeName: 'M/s. Krishi Bharati (Siliguri Branch)',
        consigneeAddress: '52, C.R. Das Sarani, Siliguri',
        consigneeGstin: '19AAHFK8744E1ZP',
        packages: '400',
        particulars: '400 Nos of Univenmi Compost 50 Kg HSN 310100 As per challan attached',
        nettWeight: 20,
        grossWeight: 20,
        loadingCharge: 0,
        unloadingCharge: 0,
        returnLorryCharge: 0,
        sttCharge: 0,
        totalFreight: 42500,
        paidAmount: 0,
        toPayAmount: 42500,
        taxInvNo: 'KB/TRF/214/26-27',
        taxInvDate: '2026-11-10',
        ewayBillNo: '871768055885',
        ewayBillDate: '2026-11-10',
        valueOfGoods: 162744,
        truckNo: 'WB51B0800',
        fromCity: 'N-24 PGS',
        toCity: 'SILIGURI',
        engineNo: 'B591803251H63458725',
        chassisNo: 'MAT466420F1H19488',
        ownerName: 'Bikash Ghosh',
        driverName: 'Raju Shaw',
        driverDlNo: 'WB-512008000488',
        gstPaidBy: 'Consignee (RCM)',
        insuranceStatus: 'The Customer has not insured the consignment',
        billed: false,
        invoiceId: '',
        branchCode: 'SILIGURI',
        createdByStaff: 'DRC-STAFF-01',
        ownerUid,
      },
    ]);

    mergeById('invoices', [
      {
        id: 'sample_inv_104',
        invoiceNo: 'KOL/104/26-27',
        invoiceDate: '2026-10-23',
        dueDate: '2026-10-30',
        partyName: 'PARUCCO FUNDRY P LTD',
        partyAddress: '142/1 G T ROAD SERAMPORE HOOGHLY',
        partyGstin: '19AADCP0740Q1Z1',
        partyPan: 'AADCP0740Q',
        sac: '996791',
        reverseCharge: true,
        gstRate: 5,
        cgstAmt: 4498.75,
        sgstAmt: 4498.75,
        igstAmt: 0,
        totalTax: 8997.5,
        freightCharges: 157000,
        detentionCharges: 13500,
        unloadingCharges: 9300,
        stCharges: 150,
        grandTotal: 179950,
        paidAmount: 0,
        status: 'Unpaid',
        remarks: '1) INV- PFPL/26-27/E/21',
        consignmentRows: [
          {
            cnNo: 'KOL/118/26-27',
            cnDate: '2026-10-09',
            vehicle: 'WB23C6597',
            from: 'HOOGHLY',
            to: 'BANGLADESH (DHAKA)',
            weight: 0,
            ratePerMt: 157000,
            freight: 157000,
            description: 'TEA MACHINERY',
          },
        ],
        annexureLorries: [
          {
            cnNo: 'KOL/118/26-27',
            lorryNumbers: 'WB57C4332; WB15B7288',
          },
        ],
        branchCode: 'KOL-HQ',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
    ]);

    mergeById('lorry_hires', [
      {
        id: 'hire_sample_0',
        cnNo: 'KOL-146/26-27',
        cnDate: '2026-11-10',
        truckNo: 'WB51B0800',
        ownerName: 'Bikash Ghosh',
        fromCity: 'N-24 PGS',
        toCity: 'SILIGURI',
        hireAmount: 36000,
        advancePaid: 15000,
        balancePayable: 21000,
        podReceived: false,
        podReceiveDate: '',
        podImageDataUrl: '',
        podFileName: '',
        balancePaid: false,
        balancePaidDate: '',
        paymentMode: '',
        paymentRef: '',
        branchCode: 'SILIGURI',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
    ]);

    mergeById('transactions', [
      {
        id: 'tx_sample_0',
        txCode: 'TRN001',
        txDate: today,
        txType: 'Income',
        ledgerAccount: 'Customer A/c',
        partyName: 'ABC Transport Ltd.',
        amount: 50000,
        narration: 'Freight Charges for Kolkata',
        paymentMode: 'Bank Transfer',
        referenceNo: 'RT-2026-1111',
        linkedCnNo: '',
        linkedInvoiceNo: '',
        branchCode: 'KOL-HQ',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
      {
        id: 'tx_sample_1',
        txCode: 'TRN002',
        txDate: '2026-11-10',
        txType: 'Expense',
        ledgerAccount: 'Diesel & Fuel A/c',
        partyName: 'Fuel Station',
        amount: 12500,
        narration: 'Diesel Expense',
        paymentMode: 'Cash',
        referenceNo: 'CSH-109',
        linkedCnNo: 'KOL-146/26-27',
        linkedInvoiceNo: '',
        branchCode: 'HOWRAH',
        createdByStaff: 'DRC-STAFF-02',
        ownerUid,
      },
      {
        id: 'tx_sample_2',
        txCode: 'TRN003',
        txDate: '2026-11-09',
        txType: 'Income',
        ledgerAccount: 'Customer A/c',
        partyName: 'XYZ Logistics',
        amount: 75000,
        narration: 'Booking Payment',
        paymentMode: 'NEFT',
        referenceNo: 'NEFT-88210',
        linkedCnNo: '',
        linkedInvoiceNo: '',
        branchCode: 'KOL-HQ',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
      {
        id: 'tx_sample_3',
        txCode: 'TRN004',
        txDate: '2026-11-08',
        txType: 'Expense',
        ledgerAccount: 'Highway Toll A/c',
        partyName: 'Toll Tax',
        amount: 6200,
        narration: 'Highway Toll',
        paymentMode: 'Cash',
        referenceNo: 'FASTAG-441',
        linkedCnNo: '',
        linkedInvoiceNo: '',
        branchCode: 'DANKUNI',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
      {
        id: 'tx_sample_4',
        txCode: 'TRN005',
        txDate: '2026-11-07',
        txType: 'Income',
        ledgerAccount: 'Customer A/c',
        partyName: 'DEF Carriers',
        amount: 62000,
        narration: 'Transport Charges',
        paymentMode: 'Bank Transfer',
        referenceNo: 'PNB-99412',
        linkedCnNo: '',
        linkedInvoiceNo: '',
        branchCode: 'KOL-HQ',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
    ]);

    mergeById('quotations', [
      {
        id: 'quote_sample_0',
        quotationNo: 'QTN/2026/018',
        quotationDate: today,
        partyName: 'BENGAL IRON CORPORATION',
        partyAddress: 'P-5 C.I.T Road, Kolkata-700054',
        partyGstin: '19AACFB7509H1ZG',
        subject: 'To Vehicles Freight Rate Quotation',
        validityText: '7 Days After Lorry Unloading',
        vehicleType: '09 TON Closed / Open Lorry',
        freight: 34500,
        loadingCharge: 'NO Extra Charges',
        unloadingCharge: 'YES Extra Charges',
        parkingCharge: 'YES Extra Charges',
        detentionCharge: 'YES Extra Charges',
        tonGuarantee: '09 TON Loading Capacity',
        destination: 'KOLKATA to SILIGURI',
        advancePay: 'No Advance Before Lorry Loading',
        entryPoint: 'As Applicable',
        branchCode: 'KOL-HQ',
        createdByStaff: 'ADMIN',
        ownerUid,
      },
    ]);

    await queueDiskPersist();
    broadcastEvent({ type: 'full', state: getPublicErpState() });
  });

  res.json({ ok: true });
});

app.post('/api/erp/restore', async (req, res) => {
  const payload = (req.body || {}) as Record<string, unknown>;
  await runAtomicMutation(async () => {
    const restorableCols: CollectionKey[] = [
      'parties',
      'vehicles',
      'drivers',
      'consignments',
      'invoices',
      'quotations',
      'lorry_hires',
      'transactions',
      'declarations',
      'staff_accounts',
    ];
    for (const col of restorableCols) {
      const incoming = payload[col];
      if (Array.isArray(incoming)) {
        const map = new Map(erpDb[col].map((d) => [d.id, d]));
        for (const row of incoming) {
          if (row && typeof row === 'object' && typeof (row as ErpDoc).id === 'string') {
            const docItem = row as ErpDoc;
            map.set(docItem.id, docItem);
          }
        }
        erpDb[col] = Array.from(map.values());
      }
    }
    await queueDiskPersist();
    broadcastEvent({ type: 'full', state: getPublicErpState() });
  });
  res.json({ ok: true });
});

// ============================================================================
// Gemini AI Vision OCR & CA MIS Advisor Routes
// ============================================================================

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.post('/api/gemini/ocr-lr', async (req, res) => {
  try {
    const { imageBase64, mimeType, tesseractText } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      tesseractText?: string;
    };

    if (!imageBase64 && !tesseractText) {
      res.status(400).json({ error: 'Provide an LR image or OCR text to analyze.' });
      return;
    }

    const ai = getGeminiClient();
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (imageBase64 && mimeType) {
      parts.push({
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      });
    }

    parts.push({
      text: [
        'You are an expert Indian road transport Consignment Note (LR / Bilty) extraction engine for Dolphin Road Carrier.',
        'Extract all handwritten and printed fields accurately from the attached LR scan and/or Tesseract OCR text.',
        'Normalize dates to YYYY-MM-DD when possible (for example 10/11/2026 -> 2026-11-10).',
        'Normalize Indian truck registration numbers without spaces (e.g. WB51B0800 or WB23C6597).',
        'Extract numeric weights (in MT or Kg as printed; if Kg like 24000, keep number accurately) and freight amounts cleanly.',
        tesseractText ? `Tesseract OCR raw text hint:\n${tesseractText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cnNo: { type: Type.STRING, description: 'Consignment Note / LR number e.g. KOL-146/26-27' },
            cnDate: { type: Type.STRING, description: 'CN Date in YYYY-MM-DD format' },
            consignorName: { type: Type.STRING },
            consignorAddress: { type: Type.STRING },
            consignorGstin: { type: Type.STRING },
            consigneeName: { type: Type.STRING },
            consigneeAddress: { type: Type.STRING },
            consigneeGstin: { type: Type.STRING },
            packages: { type: Type.STRING },
            particulars: { type: Type.STRING },
            nettWeight: { type: Type.NUMBER },
            grossWeight: { type: Type.NUMBER },
            totalFreight: { type: Type.NUMBER },
            truckNo: { type: Type.STRING },
            fromCity: { type: Type.STRING },
            toCity: { type: Type.STRING },
            ewayBillNo: { type: Type.STRING },
            ewayBillDate: { type: Type.STRING },
            taxInvNo: { type: Type.STRING },
            taxInvDate: { type: Type.STRING },
            valueOfGoods: { type: Type.NUMBER },
            ownerName: { type: Type.STRING },
            driverName: { type: Type.STRING },
            driverDlNo: { type: Type.STRING },
            confidenceNote: { type: Type.STRING, description: 'Brief note on extracted fields or unclear handwriting' },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ data: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse LR document';
    console.error('OCR LR error:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/gemini/ocr-pod', async (req, res) => {
  try {
    const { imageBase64, mimeType, tesseractText } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      tesseractText?: string;
    };

    if (!imageBase64 && !tesseractText) {
      res.status(400).json({ error: 'Provide a POD scan image or text.' });
      return;
    }

    const ai = getGeminiClient();
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (imageBase64 && mimeType) {
      parts.push({ inlineData: { mimeType, data: imageBase64 } });
    }

    parts.push({
      text: [
        'Inspect this Proof of Delivery (POD) scan for a freight truck consignment.',
        'Check whether a receiver signature/stamp is visible, extract any receiving date (YYYY-MM-DD), CN number, truck number, and shortage/damage remarks.',
        tesseractText ? `Tesseract OCR text:\n${tesseractText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signedDetected: { type: Type.BOOLEAN },
            podDate: { type: Type.STRING },
            cnNo: { type: Type.STRING },
            truckNo: { type: Type.STRING },
            remarks: { type: Type.STRING },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ data: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify POD scan';
    console.error('OCR POD error:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/gemini/mis-advice', async (req, res) => {
  try {
    const { query, summaryData } = req.body as {
      query?: string;
      summaryData?: unknown;
    };

    if (!query || !query.trim()) {
      res.status(400).json({ error: 'Query is required.' });
      return;
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Financial & Fleet Context (Dolphin Road Carrier, Kolkata):\n${JSON.stringify(summaryData ?? {}, null, 2)}\n\nUser Question:\n${query}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        systemInstruction:
          'You are the Senior Chartered Accountant & Logistics MIS Advisor for Dolphin Road Carrier (Kolkata, PAN DOTPS3540M, GSTIN 19DOTPS3540M1ZZ). Provide concise, actionable, tabular/bulleted answers grounded strictly in the provided ERP financial metrics, Indian GST GTA Reverse Charge (RCM 5% vs FCM 12%), Section 194C TDS rules, party payment aging, lorry profitability, and POD lock status.',
      },
    });

    res.json({ answer: response.text ?? 'No analysis returned.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to run MIS analysis';
    console.error('MIS Advice error:', message);
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });

    // Prevent @vite/client from opening a failing HMR WebSocket when HMR is disabled
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function injectQuery(url) {
  return url;
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dolphin Road Carriers ERP server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
