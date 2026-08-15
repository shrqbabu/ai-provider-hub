import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "./data");
const DB_FILE = path.join(DATA_DIR, "hub_store.json");

interface LocalDbSchema {
  kv: Record<string, { value: unknown; updatedAt: number }>;
  apiKeys: Record<
    string,
    {
      id: string;
      uid: string;
      label: string;
      last4: string;
      createdAt: number;
      revoked: boolean;
    }
  >;
  comboLogs: Array<{
    id: string;
    uid: string;
    data: unknown;
    createdAt: number;
  }>;
  usageLogs: Array<{
    id: string;
    uid: string;
    providerId: string;
    modelId: string;
    createdAt: number;
  }>;
}

let memoryDb: LocalDbSchema | null = null;

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("[local-db] Failed to create data directory:", err);
  }
}

function loadDb(): LocalDbSchema {
  if (memoryDb) return memoryDb;
  ensureDataDir();

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      memoryDb = JSON.parse(raw);
      if (!memoryDb?.kv) memoryDb!.kv = {};
      if (!memoryDb?.apiKeys) memoryDb!.apiKeys = {};
      if (!memoryDb?.comboLogs) memoryDb!.comboLogs = [];
      if (!memoryDb?.usageLogs) memoryDb!.usageLogs = [];
      return memoryDb!;
    } catch (err) {
      console.error("[local-db] Failed to read database file, initializing empty:", err);
    }
  }

  memoryDb = {
    kv: {},
    apiKeys: {},
    comboLogs: [],
    usageLogs: [],
  };
  saveDb(memoryDb);
  return memoryDb;
}

let saveTimeout: NodeJS.Timeout | null = null;

function saveDb(db: LocalDbSchema): void {
  ensureDataDir();
  memoryDb = db;

  // Debounce writes to prevent disk thrashing
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const tmpFile = DB_FILE + ".tmp";
      fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), "utf-8");
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      console.error("[local-db] Failed to save database to disk:", err);
    }
  }, 100);
}

// -----------------------------------------------------------------------------
// KV Operations
// -----------------------------------------------------------------------------
export async function readLocalKV<T>(uid: string, key: string, fallback: T): Promise<T> {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  const doc = db.kv[docKey];
  if (!doc) return fallback;
  return (doc.value as T) ?? fallback;
}

export async function writeLocalKV(
  uid: string,
  key: string,
  value: unknown,
  nowMs: number
): Promise<void> {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  db.kv[docKey] = { value, updatedAt: nowMs };
  saveDb(db);
}

export async function deleteLocalKV(uid: string, key: string): Promise<void> {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  delete db.kv[docKey];
  saveDb(db);
}

export async function getAllLocalKV(uid: string): Promise<Record<string, unknown>> {
  const db = loadDb();
  const result: Record<string, unknown> = {};
  const prefix = `${uid}::`;
  for (const [k, doc] of Object.entries(db.kv)) {
    if (k.startsWith(prefix)) {
      const actualKey = k.slice(prefix.length);
      result[actualKey] = doc.value;
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// API Keys Operations
// -----------------------------------------------------------------------------
const PREFIX = "ah-";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function genRawKey(): string {
  return PREFIX + randomBytes(30).toString("hex");
}

export async function createLocalApiKey(
  uid: string,
  label: string,
  nowMs: number
): Promise<{ raw: string; record: { id: string; label: string; last4: string; createdAt: number; revoked: boolean } }> {
  const raw = genRawKey();
  const hash = hashKey(raw);
  const db = loadDb();

  const record = {
    id: hash,
    uid,
    label: label || "Gateway key",
    last4: raw.slice(-4),
    createdAt: nowMs,
    revoked: false,
  };

  db.apiKeys[hash] = record;
  saveDb(db);

  return { raw, record };
}

export async function listLocalApiKeys(uid: string) {
  const db = loadDb();
  return Object.values(db.apiKeys)
    .filter((k) => k.uid === uid)
    .map((k) => ({
      id: k.id,
      label: k.label,
      last4: k.last4,
      createdAt: k.createdAt,
      revoked: k.revoked,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeLocalApiKey(uid: string, id: string): Promise<boolean> {
  const db = loadDb();
  const key = db.apiKeys[id];
  if (!key || key.uid !== uid) return false;
  key.revoked = true;
  saveDb(db);
  return true;
}

export async function resolveLocalApiKey(raw: string): Promise<string | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const hash = hashKey(raw);
  const db = loadDb();
  const key = db.apiKeys[hash];
  if (!key || key.revoked) return null;
  return key.uid;
}

// -----------------------------------------------------------------------------
// Combo & Usage Logs
// -----------------------------------------------------------------------------
export async function recordLocalComboLog(uid: string, log: any): Promise<void> {
  const db = loadDb();
  db.comboLogs.unshift({
    id: log.id || `glog_${Date.now()}`,
    uid,
    data: log,
    createdAt: Date.now(),
  });
  if (db.comboLogs.length > 500) db.comboLogs = db.comboLogs.slice(0, 500);
  saveDb(db);
}

export async function listLocalComboLogs(uid: string) {
  const db = loadDb();
  return db.comboLogs
    .filter((l) => l.uid === uid)
    .map((l) => l.data)
    .slice(0, 100);
}

export async function recordLocalUsage(
  uid: string,
  providerId: string,
  modelId: string,
  nowMs: number
): Promise<void> {
  const db = loadDb();
  db.usageLogs.unshift({
    id: `u_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    uid,
    providerId,
    modelId,
    createdAt: nowMs,
  });
  if (db.usageLogs.length > 2000) db.usageLogs = db.usageLogs.slice(0, 2000);
  saveDb(db);
}

export function isFirebaseConfigured(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}
