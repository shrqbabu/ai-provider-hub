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
  ensureDataDir();

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed?.kv) parsed.kv = {};
      if (!parsed?.apiKeys) parsed.apiKeys = {};
      if (!parsed?.comboLogs) parsed.comboLogs = [];
      if (!parsed?.usageLogs) parsed.usageLogs = [];
      memoryDb = parsed;
      return memoryDb!;
    } catch (err) {
      console.error("[local-db] Failed to read database file:", err);
    }
  }

  if (!memoryDb) {
    memoryDb = {
      kv: {},
      apiKeys: {},
      comboLogs: [],
      usageLogs: [],
    };
    saveDb(memoryDb);
  }
  return memoryDb;
}

function saveDb(db: LocalDbSchema): void {
  ensureDataDir();
  memoryDb = db;

  try {
    const tmpFile = DB_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), "utf-8");
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
    } catch (e) {
      console.error("[local-db] Failed to save database to disk:", e);
    }
  }
}

// -----------------------------------------------------------------------------
// Key-Value Store
// -----------------------------------------------------------------------------
export async function readLocalKV<T>(uid: string, key: string, fallback: T): Promise<T> {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  const doc = db.kv[docKey];
  if (doc && doc.value !== undefined && doc.value !== null) {
    if (Array.isArray(doc.value)) {
      if (doc.value.length > 0) return doc.value as T;
    } else {
      return (doc.value as T) ?? fallback;
    }
  }

  // Fallback: check any other namespace in local db (e.g. "local_user::providers")
  const targetSuffix = `::${key}`;
  for (const [k, v] of Object.entries(db.kv)) {
    if (k.endsWith(targetSuffix) && v && v.value !== undefined && v.value !== null) {
      if (Array.isArray(v.value)) {
        if (v.value.length > 0) return v.value as T;
      } else {
        return v.value as T;
      }
    }
  }

  return fallback;
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
// Gateway API Keys Store
// -----------------------------------------------------------------------------
const PREFIX = "ah-";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function genRawKey(): string {
  return PREFIX + randomBytes(30).toString("hex");
}

export async function createLocalApiKey(
  uid: string,
  label: string,
  nowMs: number
): Promise<{
  raw: string;
  record: {
    id: string;
    uid: string;
    label: string;
    last4: string;
    createdAt: number;
    revoked: boolean;
  };
}> {
  const db = loadDb();
  const raw = genRawKey();
  const hash = hashKey(raw);

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
  const all = Object.values(db.apiKeys);
  const matching = all.filter((k) => k.uid === uid && !k.revoked);
  if (matching.length > 0) {
    return matching
      .map((k) => ({
        id: k.id,
        label: k.label,
        last4: k.last4,
        createdAt: k.createdAt,
        revoked: k.revoked,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Fallback for self-hosted / single-tenant setups: if user has no keys under this exact UID,
  // return any existing non-revoked local keys so keys are never lost across sessions/reloads!
  return all
    .filter((k) => !k.revoked)
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
  if (!key) return true;
  delete db.apiKeys[id];
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
