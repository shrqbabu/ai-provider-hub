// server.ts
import http from "node:http";
import fs3 from "node:fs";
import path3 from "node:path";
import { fileURLToPath } from "node:url";

// api/_lib/api-keys.ts
import { createHash as createHash2, randomBytes as randomBytes2 } from "node:crypto";

// api/_lib/firebase-admin.ts
import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
var app;
function init() {
  if (app) return app;
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) {
    const candidates = [
      path.resolve(process.cwd(), "service-account.json"),
      path.resolve(process.cwd(), "serviceAccountKey.json"),
      path.resolve(process.cwd(), "firebase-service-account.json"),
      path.resolve(process.cwd(), "firebase.json"),
      path.resolve(process.cwd(), "data/service-account.json")
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        raw = c;
        break;
      }
    }
  }
  if (raw && fs.existsSync(raw)) {
    try {
      raw = fs.readFileSync(raw, "utf-8");
    } catch {
    }
  }
  if (raw) {
    let creds;
    try {
      if (raw.trim().startsWith("{")) {
        creds = JSON.parse(raw);
      } else {
        const decoded = Buffer.from(raw, "base64").toString("utf-8");
        creds = JSON.parse(decoded);
      }
    } catch {
      try {
        creds = JSON.parse(raw);
      } catch (err) {
        console.warn("[Firebase Admin] Could not parse service account JSON:", err);
        throw err;
      }
    }
    if (typeof creds.private_key === "string") {
      creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    app = initializeApp({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credential: cert(creds),
      projectId: creds.project_id || process.env.VITE_FIREBASE_PROJECT_ID
    });
    return app;
  }
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  if (projectId) {
    app = initializeApp({ projectId });
    return app;
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT is not set.");
}
function getDb() {
  return getFirestore(init());
}
function getAdminAuth() {
  return getAuth(init());
}
function isFirebaseAdminReady() {
  try {
    init();
    return true;
  } catch {
    return false;
  }
}

// api/_lib/local-db.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { createHash, randomBytes } from "node:crypto";
var DATA_DIR = process.env.DATA_DIR || path2.resolve(process.cwd(), "./data");
var DB_FILE = path2.join(DATA_DIR, "hub_store.json");
var memoryDb = null;
function ensureDataDir() {
  try {
    if (!fs2.existsSync(DATA_DIR)) {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("[local-db] Failed to create data directory:", err);
  }
}
function loadDb() {
  if (memoryDb) return memoryDb;
  ensureDataDir();
  if (fs2.existsSync(DB_FILE)) {
    try {
      const raw = fs2.readFileSync(DB_FILE, "utf-8");
      memoryDb = JSON.parse(raw);
      if (!memoryDb?.kv) memoryDb.kv = {};
      if (!memoryDb?.apiKeys) memoryDb.apiKeys = {};
      if (!memoryDb?.comboLogs) memoryDb.comboLogs = [];
      if (!memoryDb?.usageLogs) memoryDb.usageLogs = [];
      return memoryDb;
    } catch (err) {
      console.error("[local-db] Failed to read database file, initializing empty:", err);
    }
  }
  memoryDb = {
    kv: {},
    apiKeys: {},
    comboLogs: [],
    usageLogs: []
  };
  saveDb(memoryDb);
  return memoryDb;
}
function saveDb(db) {
  ensureDataDir();
  memoryDb = db;
  try {
    const tmpFile = DB_FILE + ".tmp";
    fs2.writeFileSync(tmpFile, JSON.stringify(db, null, 2), "utf-8");
    fs2.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    try {
      fs2.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
    } catch (e) {
      console.error("[local-db] Failed to save database to disk:", e);
    }
  }
}
async function readLocalKV(uid, key, fallback) {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  const doc = db.kv[docKey];
  if (doc && doc.value !== void 0 && doc.value !== null) {
    if (Array.isArray(doc.value)) {
      if (doc.value.length > 0) return doc.value;
    } else {
      return doc.value ?? fallback;
    }
  }
  const targetSuffix = `::${key}`;
  for (const [k, v] of Object.entries(db.kv)) {
    if (k.endsWith(targetSuffix) && v && v.value !== void 0 && v.value !== null) {
      if (Array.isArray(v.value)) {
        if (v.value.length > 0) return v.value;
      } else {
        return v.value;
      }
    }
  }
  return fallback;
}
async function writeLocalKV(uid, key, value, nowMs) {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  db.kv[docKey] = { value, updatedAt: nowMs };
  saveDb(db);
}
async function deleteLocalKV(uid, key) {
  const db = loadDb();
  const docKey = `${uid}::${key}`;
  delete db.kv[docKey];
  saveDb(db);
}
async function getAllLocalKV(uid) {
  const db = loadDb();
  const result = {};
  const prefix = `${uid}::`;
  for (const [k, doc] of Object.entries(db.kv)) {
    if (k.startsWith(prefix)) {
      const actualKey = k.slice(prefix.length);
      result[actualKey] = doc.value;
    }
  }
  return result;
}
var PREFIX = "ah-";
function hashKey(raw) {
  return createHash("sha256").update(raw).digest("hex");
}
function genRawKey() {
  return PREFIX + randomBytes(30).toString("hex");
}
async function createLocalApiKey(uid, label, nowMs) {
  const raw = genRawKey();
  const hash = hashKey(raw);
  const db = loadDb();
  const record = {
    id: hash,
    uid,
    label: label || "Gateway key",
    last4: raw.slice(-4),
    createdAt: nowMs,
    revoked: false
  };
  db.apiKeys[hash] = record;
  saveDb(db);
  return { raw, record };
}
async function listLocalApiKeys(uid) {
  const db = loadDb();
  return Object.values(db.apiKeys).filter((k) => k.uid === uid).map((k) => ({
    id: k.id,
    label: k.label,
    last4: k.last4,
    createdAt: k.createdAt,
    revoked: k.revoked
  })).sort((a, b) => b.createdAt - a.createdAt);
}
async function revokeLocalApiKey(uid, id) {
  const db = loadDb();
  const key = db.apiKeys[id];
  if (!key) return true;
  delete db.apiKeys[id];
  saveDb(db);
  return true;
}
async function resolveLocalApiKey(raw) {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const hash = hashKey(raw);
  const db = loadDb();
  const key = db.apiKeys[hash];
  if (!key || key.revoked) return null;
  return key.uid;
}
function isFirebaseConfigured() {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

// api/_lib/api-keys.ts
var PREFIX2 = "ah-";
function hashKey2(raw) {
  return createHash2("sha256").update(raw).digest("hex");
}
async function createApiKey(uid, label, nowMs) {
  const result = await createLocalApiKey(uid, label, nowMs);
  if (isFirebaseAdminReady()) {
    try {
      await getDb().collection("apiKeys").doc(result.record.id).set({
        ...result.record,
        uid
      });
    } catch (e) {
      console.warn("[api-keys] Firestore save failed, saved to local db:", e);
    }
  }
  return result;
}
async function listApiKeys(uid) {
  if (isFirebaseAdminReady()) {
    try {
      const snap = await getDb().collection("apiKeys").where("uid", "==", uid).get();
      if (!snap.empty) {
        const firestoreList = snap.docs.map((d) => {
          const r = d.data();
          return {
            id: d.id,
            label: r.label,
            last4: r.last4,
            createdAt: r.createdAt,
            revoked: r.revoked
          };
        }).filter((k) => !k.revoked).sort((a, b) => b.createdAt - a.createdAt);
        return firestoreList;
      }
    } catch (err) {
      console.warn("[api-keys] Firestore listApiKeys failed, checking local:", err);
    }
  }
  return listLocalApiKeys(uid);
}
async function revokeApiKey(uid, id) {
  await revokeLocalApiKey(uid, id);
  if (isFirebaseAdminReady()) {
    try {
      const ref = getDb().collection("apiKeys").doc(id);
      await ref.delete();
    } catch {
    }
  }
  return true;
}
async function resolveApiKey(raw) {
  if (!raw || !raw.startsWith(PREFIX2)) return null;
  if (isFirebaseAdminReady()) {
    try {
      const hash = hashKey2(raw);
      const snap = await getDb().collection("apiKeys").doc(hash).get();
      if (snap.exists) {
        const r = snap.data();
        if (!r.revoked) {
          if (r.uid) return r.uid;
          try {
            const usersSnap = await getDb().collection("users").limit(5).get();
            if (!usersSnap.empty) {
              const targetUid = usersSnap.docs[0].id;
              await snap.ref.set({ uid: targetUid }, { merge: true });
              return targetUid;
            }
          } catch {
          }
        }
      }
    } catch (err) {
      console.warn("[api-keys] Firestore resolveApiKey failed, checking local:", err);
    }
  }
  return resolveLocalApiKey(raw);
}

// api/_lib/kv.ts
function docRef(uid, key) {
  return getDb().collection("users").doc(uid).collection("kv").doc(key);
}
async function readKV(uid, key, fallback) {
  if (isFirebaseAdminReady()) {
    try {
      const snap = await docRef(uid, key).get();
      if (snap.exists) {
        const data = snap.data();
        if (data !== void 0) {
          const val = data.v ?? data.value ?? data.data;
          if (val !== void 0) return val;
          if (typeof data === "object" && data !== null) {
            return data;
          }
        }
      }
    } catch (err) {
      console.warn(`[kv] Firestore read for ${key} failed, checking local:`, err);
    }
  }
  return readLocalKV(uid, key, fallback);
}
async function writeKV(uid, key, value, nowMs) {
  await writeLocalKV(uid, key, value, nowMs);
  if (isFirebaseAdminReady()) {
    try {
      const doc = { v: value, value, updatedAt: nowMs };
      await docRef(uid, key).set(doc, { merge: true });
    } catch (err) {
      console.warn(`[kv] Firestore write for ${key} failed:`, err);
    }
  }
}
async function deleteKV(uid, key) {
  await deleteLocalKV(uid, key);
  if (isFirebaseAdminReady()) {
    try {
      await docRef(uid, key).delete();
    } catch {
    }
  }
}

// api/_lib/upstreams.ts
var PROVIDER_BASE = {
  openai: "https://api.openai.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google: "https://generativelanguage.googleapis.com/v1",
  // OAuth provider bases — used when the provider was saved without an explicit
  // baseURL (shouldn't happen, but acts as a safety net).
  github: "https://api.githubcopilot.com",
  grok: "https://api.x.ai/v1",
  kimi: "https://api.kimi.com/coding/v1",
  codex: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com/v1",
  antigravity: "https://cloudcode-pa.googleapis.com"
};
function parseModel(model) {
  const trimmed = (model ?? "").trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const head = trimmed.slice(0, slash).toLowerCase();
    if (head in PROVIDER_BASE || head === "custom" || head === "aip") {
      return { providerHint: head, modelId: trimmed.slice(slash + 1) };
    }
  }
  return { modelId: trimmed };
}
function stripVirtualPrefix(model) {
  return (model ?? "").trim().replace(/^aip\//i, "");
}
function providerKeys(p) {
  const list = (p.apiKeys ?? []).map((k) => (k ?? "").trim()).filter(Boolean);
  const primary = (p.apiKey ?? "").trim();
  if (primary && !list.includes(primary)) list.unshift(primary);
  return Array.from(new Set(list));
}
function baseURLFor(p) {
  let url = (p.baseURL ?? "").trim().replace(/\/$/, "");
  if (!url) return PROVIDER_BASE[p.key] ?? "";
  if (url.startsWith("/")) {
    const port = process.env.PORT || "3000";
    url = `http://127.0.0.1:${port}${url}`;
  }
  url = url.replace(/\/chat\/completions\/?$/i, "").replace(/\/messages\/?$/i, "").replace(/\/completions\/?$/i, "").replace(/\/embeddings\/?$/i, "").replace(/\/$/, "");
  const isCloudCode = url.includes("cloudcode-pa.googleapis.com") || url.includes("daily-cloudcode-pa.googleapis.com");
  const isCopilot = url.includes("api.githubcopilot.com") || url.includes("copilot");
  const isKimiCoding = url.includes("api.kimi.com");
  if (isCloudCode || isCopilot || isKimiCoding) {
    return url;
  }
  if (p.key === "openai" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "nvidia" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "anthropic" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "openrouter" && !url.includes("/v1")) {
    url += "/api/v1";
  } else if (p.key === "google" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "custom") {
    if (url.includes("integrate.api.nvidia.com") && !url.includes("/v1")) {
      url += "/v1";
    } else if (url.includes("api.openai.com") && !url.includes("/v1")) {
      url += "/v1";
    } else if (url.includes("api.anthropic.com") && !url.includes("/v1")) {
      url += "/v1";
    } else if (url.includes("openrouter.ai") && !url.includes("/v1")) {
      url += "/api/v1";
    }
  }
  return url;
}
function resolveRoute(model, providers, models) {
  if (!model) return { error: "Request is missing `model`.", status: 400 };
  if (!providers.length)
    return {
      error: "No providers connected. Add a provider in the app first.",
      status: 400
    };
  const byId = new Map(providers.map((p) => [p.id, p]));
  const wanted = model.trim().toLowerCase();
  const hit = models.find((m) => (m.modelId ?? "").trim().toLowerCase() === wanted);
  if (hit) {
    const provider = byId.get(hit.providerId) || providers.find((p) => p.key === hit.providerKey);
    if (provider) return finalize(provider, hit.modelId);
  }
  const { providerHint, modelId } = parseModel(model);
  if (providerHint) {
    const match = providers.find((p) => p.key === providerHint || p.displayName && p.displayName.toLowerCase() === providerHint);
    if (match) return finalize(match, modelId);
  }
  const fuzzyHit = models.find(
    (m) => (m.modelId ?? "").toLowerCase().endsWith(wanted) || wanted.endsWith((m.modelId ?? "").toLowerCase()) || (m.modelId ?? "").toLowerCase().includes(wanted) || wanted.includes((m.modelId ?? "").toLowerCase())
  );
  if (fuzzyHit) {
    const provider = byId.get(fuzzyHit.providerId) || providers.find((p) => p.key === fuzzyHit.providerKey);
    if (provider) return finalize(provider, fuzzyHit.modelId);
  }
  if (wanted.startsWith("claude-") || wanted.startsWith("gemini-")) {
    const antigravity = providers.find(
      (p) => p.key === "antigravity" || (p.baseURL ?? "").includes("cloudcode-pa.googleapis.com") || (p.displayName ?? "").toLowerCase().includes("antigravity")
    );
    if (antigravity) {
      let targetModel = model;
      if (wanted === "claude-3-5-sonnet") targetModel = "claude-3-5-sonnet-v2";
      return finalize(antigravity, targetModel);
    }
    const anthropic = providers.find((p) => p.key === "anthropic" || p.apiFormat === "anthropic");
    if (anthropic) return finalize(anthropic, model);
  }
  if (wanted.startsWith("gpt-") || wanted.startsWith("o1-") || wanted.startsWith("o3-")) {
    const openai = providers.find((p) => p.key === "openai" || p.apiFormat === "openai" || (p.baseURL ?? "").includes("openai"));
    if (openai) return finalize(openai, model);
  }
  if (wanted.startsWith("grok-")) {
    const grok = providers.find((p) => p.key === "grok" || (p.baseURL ?? "").includes("api.x.ai"));
    if (grok) return finalize(grok, model);
  }
  if (wanted.startsWith("kimi-") || wanted.startsWith("moonshot-")) {
    const kimi = providers.find((p) => p.key === "kimi" || (p.baseURL ?? "").includes("api.kimi.com"));
    if (kimi) return finalize(kimi, model);
  }
  if (providers.length === 1) return finalize(providers[0], model);
  const firstActive = providers.find((p) => !p.disabled) || providers[0];
  if (firstActive) return finalize(firstActive, model);
  return {
    error: `Could not route model "${model}". Add it under a provider in the app, or check your connected providers.`,
    status: 400
  };
}
function finalize(provider, modelId) {
  return { provider, modelId, keys: providerKeys(provider) };
}
function resolveAttempts(model, providers, models, combos) {
  if (!model) return { error: "Request is missing `model`.", status: 400 };
  if (!providers.length)
    return {
      error: "No providers connected. Add a provider in the app first.",
      status: 400
    };
  const wanted = model.trim().toLowerCase();
  const { modelId: strippedWanted } = parseModel(wanted);
  const combo = combos.find((c) => {
    const name = (c.name ?? "").trim().toLowerCase();
    return name === wanted || name === strippedWanted;
  });
  if (combo) {
    const byId = new Map(providers.map((p) => [p.id, p]));
    const attempts = [];
    for (const member of combo.members ?? []) {
      const provider = byId.get(member.providerId);
      if (!provider) continue;
      const { modelId } = parseModel(member.modelId);
      attempts.push(finalize(provider, stripVirtualPrefix(modelId)));
    }
    if (!attempts.length)
      return {
        error: `Combo "${combo.name}" has no usable members. Its providers may have been removed \u2014 edit the combo in the app.`,
        status: 400
      };
    return { attempts, combo };
  }
  const route = resolveRoute(model, providers, models);
  if ("error" in route) return route;
  return { attempts: [route] };
}

// api/_lib/auth.ts
function bearerToken(req) {
  const h = req.header("authorization") ?? req.header("Authorization");
  if (!h) return void 0;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : void 0;
}
async function requireUser(req) {
  const token = bearerToken(req);
  const headerUid = req.header("x-user-uid");
  if (!token) {
    return headerUid || (isFirebaseConfigured() ? null : "local_user");
  }
  if (isFirebaseConfigured()) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      return decoded.uid;
    } catch (e) {
      console.warn("[Auth] Firebase Admin token verify failed:", e);
    }
  }
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
      const payload = JSON.parse(payloadJson);
      if (payload.user_id || payload.sub) {
        return payload.user_id || payload.sub;
      }
    }
  } catch (e) {
  }
  if (headerUid) return headerUid;
  return isFirebaseConfigured() ? null : "local_user";
}

// api/_lib/http.ts
function jsonResponse(status, body) {
  return { status, jsonBody: body };
}

// api/_lib/oauth/device-flow.ts
import crypto from "crypto";

// api/_lib/oauth/public-creds.ts
var MASK = "omniroute-public-v1";
function unmaskCred(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ^ MASK.charCodeAt(i % MASK.length));
  }
  return out;
}
var EMBEDDED_PUBLIC_CREDS = {
  antigravity_id: [
    94,
    93,
    89,
    88,
    66,
    95,
    67,
    68,
    83,
    29,
    69,
    76,
    83,
    65,
    29,
    14,
    69,
    5,
    66,
    6,
    3,
    92,
    1,
    64,
    94,
    25,
    23,
    23,
    72,
    66,
    70,
    87,
    26,
    29,
    12,
    65,
    25,
    91,
    7,
    89,
    9,
    93,
    66,
    92,
    16,
    4,
    75,
    76,
    0,
    5,
    17,
    66,
    14,
    12,
    66,
    17,
    93,
    10,
    24,
    29,
    12,
    0,
    12,
    26,
    26,
    17,
    72,
    30,
    1,
    76,
    15,
    6,
    14
  ],
  antigravity_alt: [
    40,
    34,
    45,
    58,
    34,
    55,
    88,
    63,
    80,
    21,
    54,
    34,
    48,
    88,
    81,
    85,
    97,
    18,
    125,
    37,
    92,
    3,
    37,
    48,
    87,
    6,
    44,
    38,
    25,
    10,
    67,
    19,
    40,
    40,
    5
  ],
  claude_id: [
    86,
    9,
    95,
    10,
    64,
    90,
    69,
    21,
    72,
    72,
    70,
    68,
    0,
    65,
    93,
    87,
    73,
    79,
    28,
    87,
    85,
    11,
    13,
    95,
    90,
    76,
    64,
    81,
    73,
    65,
    76,
    84,
    94,
    15,
    86,
    72
  ],
  codex_id: [
    14,
    29,
    30,
    54,
    55,
    34,
    26,
    21,
    8,
    104,
    53,
    47,
    85,
    95,
    15,
    83,
    110,
    29,
    105,
    14,
    53,
    30,
    94,
    26,
    29,
    20,
    26,
    11
  ],
  kimi_id: [
    94,
    90,
    11,
    92,
    20,
    89,
    66,
    69,
    72,
    73,
    65,
    76,
    86,
    65,
    93,
    7,
    75,
    20,
    28,
    86,
    90,
    94,
    95,
    95,
    90,
    64,
    69,
    83,
    78,
    18,
    65,
    90,
    15,
    89,
    90,
    21
  ],
  github_copilot_id: [38, 27, 95, 71, 16, 90, 69, 67, 4, 29, 72, 22, 90, 91, 12, 0, 75, 19, 8, 87],
  grok_id: [
    13,
    92,
    15,
    89,
    66,
    91,
    76,
    70,
    72,
    29,
    71,
    70,
    3,
    65,
    93,
    84,
    72,
    23,
    28,
    87,
    92,
    88,
    15,
    95,
    91,
    22,
    71,
    87,
    20,
    66,
    67,
    86,
    13,
    81,
    81,
    21
  ]
};
function getPublicCred(key, envName) {
  if (envName && process.env[envName]) {
    return process.env[envName];
  }
  return unmaskCred(EMBEDDED_PUBLIC_CREDS[key]);
}

// api/_lib/oauth/constants.ts
var OAUTH_PROVIDERS = {
  github: {
    name: "GitHub Copilot",
    type: "device_code",
    clientId: getPublicCred("github_copilot_id", "GITHUB_OAUTH_CLIENT_ID"),
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    scopes: "read:user",
    apiVersion: "2023-07-07",
    userAgent: "GitHubCopilot/1.0",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o (Copilot)" },
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet (Copilot)" },
      { id: "o1-mini", name: "o1-mini (Copilot)" },
      { id: "o3-mini", name: "o3-mini (Copilot)" }
    ]
  },
  antigravity: {
    name: "Google Antigravity (Cloud Code)",
    type: "authorization_code",
    clientId: getPublicCred("antigravity_id", "ANTIGRAVITY_OAUTH_CLIENT_ID"),
    clientSecret: getPublicCred("antigravity_alt", "ANTIGRAVITY_OAUTH_CLIENT_SECRET"),
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs"
    ],
    defaultModels: [
      { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
      { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
      { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
      { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
      { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
      { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
      { id: "claude-3-5-sonnet-v2", name: "Claude 3.5 Sonnet v2" },
      { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" }
    ]
  },
  claude: {
    name: "Claude Code CLI",
    type: "authorization_code",
    clientId: getPublicCred("claude_id", "CLAUDE_OAUTH_CLIENT_ID"),
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://api.anthropic.com/v1/oauth/token",
    scopes: [
      "org:create_api_key",
      "user:profile",
      "user:inference",
      "user:sessions:claude_code"
    ],
    defaultModels: [
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" }
    ]
  },
  grok: {
    name: "xAI Grok Build",
    type: "device_code",
    clientId: getPublicCred("grok_id", "GROK_OAUTH_CLIENT_ID"),
    issuer: "https://auth.x.ai",
    deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    scopes: "openid profile email offline_access grok-cli:access api:access",
    defaultModels: [
      { id: "grok-2", name: "Grok 2" },
      { id: "grok-2-vision", name: "Grok 2 Vision" },
      { id: "grok-beta", name: "Grok Beta" },
      { id: "grok-vision-beta", name: "Grok Vision Beta" },
      { id: "grok-3", name: "Grok 3" },
      { id: "grok-3-mini", name: "Grok 3 Mini" }
    ]
  },
  kimi: {
    name: "Kimi Coding CLI",
    type: "device_code",
    clientId: getPublicCred("kimi_id", "KIMI_CODING_OAUTH_CLIENT_ID"),
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    scopes: "offline_access",
    defaultModels: [
      { id: "kimi-k1.5", name: "Kimi k1.5 (Coding)" },
      { id: "moonshot-v1-128k", name: "Moonshot v1 128k" }
    ]
  },
  codex: {
    name: "OpenAI Codex CLI",
    type: "authorization_code",
    clientId: getPublicCred("codex_id", "CODEX_OAUTH_CLIENT_ID"),
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scope: "openid profile email offline_access",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o (Codex)" },
      { id: "o1-preview", name: "o1 Preview" },
      { id: "o3-mini", name: "o3 Mini" }
    ]
  }
};

// api/_lib/oauth/device-flow.ts
function base64UrlEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}
function generateCodeChallenge(verifier) {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
}
async function initiateDeviceCode(providerKey) {
  const config = OAUTH_PROVIDERS[providerKey];
  if (!config) {
    throw new Error(`Unsupported OAuth provider: ${providerKey}`);
  }
  if (providerKey === "github") {
    const res = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": config.userAgent
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub device code error (${res.status}): ${err}`);
    }
    return await res.json();
  }
  if (providerKey === "grok") {
    const res = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-grok-client-version": "0.2.106",
        "x-grok-client-surface": "cli"
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok device code error (${res.status}): ${err}`);
    }
    return await res.json();
  }
  if (providerKey === "kimi") {
    const deviceId = crypto.randomUUID();
    const res = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-device-id": deviceId,
        "x-device-name": "desktop",
        "x-device-model": "windows",
        "x-os-version": "10"
      },
      body: new URLSearchParams({
        client_id: config.clientId
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kimi device code error (${res.status}): ${err}`);
    }
    const data = await res.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || "https://www.kimi.com/code/authorize_device",
      verification_uri_complete: data.verification_uri_complete || `https://www.kimi.com/code/authorize_device?user_code=${data.user_code}`,
      expires_in: data.expires_in || 1800,
      interval: data.interval || 5
    };
  }
  throw new Error(`Provider ${providerKey} does not support device code flow.`);
}
async function pollDeviceToken(providerKey, deviceCode) {
  const config = OAUTH_PROVIDERS[providerKey];
  if (!config) {
    return { status: "error", error: `Unsupported provider: ${providerKey}` };
  }
  try {
    if (providerKey === "github") {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": config.userAgent
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });
      const data = await res.json();
      if (data.error) {
        if (data.error === "authorization_pending" || data.error === "slow_down") {
          return { status: "pending" };
        }
        if (data.error === "expired_token") {
          return { status: "expired", error: "Device code expired. Please request a new code." };
        }
        if (data.error === "access_denied") {
          return { status: "error", error: "Login request was denied." };
        }
        return { status: "error", error: data.error_description || data.error };
      }
      if (data.access_token) {
        let userInfo = {};
        let copilotToken = {};
        try {
          const userRes = await fetch(config.userInfoUrl, {
            headers: {
              Authorization: `Bearer ${data.access_token}`,
              Accept: "application/json",
              "User-Agent": config.userAgent
            },
            signal: AbortSignal.timeout(4e3)
          });
          if (userRes.ok) userInfo = await userRes.json();
        } catch (e) {
          console.warn("[OAuth] UserInfo fetch warning:", e);
        }
        try {
          const copilotRes = await fetch(config.copilotTokenUrl, {
            headers: {
              Authorization: `Bearer ${data.access_token}`,
              Accept: "application/json",
              "X-GitHub-Api-Version": config.apiVersion,
              "User-Agent": config.userAgent
            },
            signal: AbortSignal.timeout(4e3)
          });
          if (copilotRes.ok) copilotToken = await copilotRes.json();
        } catch (e) {
          console.warn("[OAuth] Copilot token fetch warning:", e);
        }
        return {
          status: "success",
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: {
            id: userInfo.id,
            login: userInfo.login,
            name: userInfo.name || userInfo.login,
            email: userInfo.email,
            avatarUrl: userInfo.avatar_url
          },
          providerSpecificData: {
            copilotToken: copilotToken.token,
            copilotTokenExpiresAt: copilotToken.expires_at,
            copilotEndpoints: copilotToken.endpoints
          }
        };
      }
    }
    if (providerKey === "grok") {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "x-grok-client-version": "0.2.106",
          "x-grok-client-surface": "cli"
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });
      const data = await res.json();
      if (data.error) {
        if (data.error === "authorization_pending" || data.error === "slow_down") {
          return { status: "pending" };
        }
        if (data.error === "expired_token") {
          return { status: "expired", error: "Device code expired." };
        }
        return { status: "error", error: data.error_description || data.error };
      }
      if (data.access_token) {
        return {
          status: "success",
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: {
            name: "xAI User"
          }
        };
      }
    }
    if (providerKey === "kimi") {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });
      const data = await res.json();
      if (data.error) {
        if (data.error === "authorization_pending" || data.error === "slow_down") {
          return { status: "pending" };
        }
        if (data.error === "expired_token") {
          return { status: "expired", error: "Device code expired." };
        }
        return { status: "error", error: data.error_description || data.error };
      }
      if (data.access_token) {
        return {
          status: "success",
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: {
            name: "Kimi AI Developer"
          }
        };
      }
    }
    return { status: "error", error: "No token returned." };
  } catch (err) {
    return { status: "error", error: err.message || "Failed to poll token" };
  }
}
function initiatePkce(providerKey, callbackRedirectUri) {
  const config = OAUTH_PROVIDERS[providerKey];
  if (!config) throw new Error(`Unsupported OAuth provider: ${providerKey}`);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");
  if (providerKey === "antigravity") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: callbackRedirectUri || "http://localhost:3000/api/oauth/callback",
      scope: Array.isArray(config.scopes) ? config.scopes.join(" ") : config.scopes,
      state,
      access_type: "offline",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });
    return {
      authUrl: `${config.authorizeUrl}?${params.toString()}`,
      codeVerifier,
      state
    };
  }
  if (providerKey === "claude") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: "https://platform.claude.com/oauth/code/callback",
      scope: Array.isArray(config.scopes) ? config.scopes.join(" ") : config.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });
    return {
      authUrl: `${config.authorizeUrl}?${params.toString()}`,
      codeVerifier,
      state
    };
  }
  if (providerKey === "codex") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: "http://localhost:1455/auth/callback",
      scope: "openid profile email offline_access",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
      prompt: "login"
    });
    return {
      authUrl: `${config.authorizeUrl}?${params.toString()}`,
      codeVerifier,
      state
    };
  }
  throw new Error(`Provider ${providerKey} does not support PKCE flow.`);
}
function extractAuthCode(rawInput) {
  let text = rawInput.trim();
  if (!text) return "";
  if (text.startsWith("http://") || text.startsWith("https://") || text.includes("?")) {
    try {
      const parsedUrl = new URL(text.startsWith("http") ? text : `http://dummy.com/${text}`);
      const codeParam = parsedUrl.searchParams.get("code");
      if (codeParam) {
        return decodeURIComponent(codeParam);
      }
    } catch {
    }
  }
  const match = text.match(/[?&]code=([^&#\s]+)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  if (text.startsWith("4%2F") || text.includes("%2F") || text.includes("%3A")) {
    try {
      text = decodeURIComponent(text);
    } catch {
    }
  }
  return text;
}
async function exchangePkceCode(providerKey, rawCode, codeVerifier, redirectUri) {
  const config = OAUTH_PROVIDERS[providerKey];
  if (!config) throw new Error(`Unsupported OAuth provider: ${providerKey}`);
  const code = extractAuthCode(rawCode);
  if (!code) {
    throw new Error("No authorization code found in the provided input.");
  }
  const defaultRedirectUri = providerKey === "claude" ? "https://platform.claude.com/oauth/code/callback" : providerKey === "codex" ? "http://localhost:1455/auth/callback" : "http://localhost:3000/api/oauth/callback";
  const bodyParams = {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri || defaultRedirectUri
  };
  if (config.clientSecret) {
    bodyParams.client_secret = config.clientSecret;
  }
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams(bodyParams)
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const errorMsg = typeof data.error === "object" ? data.error?.message || data.error_description || JSON.stringify(data.error) : data.error_description || data.error || `Exchange failed (${res.status})`;
    throw new Error(errorMsg);
  }
  let userInfo = {};
  let providerSpecificData;
  if (providerKey === "antigravity") {
    try {
      const userRes = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${data.access_token}` },
        signal: AbortSignal.timeout(4e3)
      });
      if (userRes.ok) userInfo = await userRes.json();
    } catch {
    }
    try {
      const projectId = await resolveAntigravityProject(data.access_token);
      if (projectId) {
        providerSpecificData = { projectId };
      }
    } catch {
    }
  } else if (providerKey === "claude") {
    userInfo = { name: "Claude Code User" };
  } else if (providerKey === "codex") {
    userInfo = { name: "OpenAI Codex User" };
  }
  return {
    status: "success",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    user: {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name || userInfo.email || (providerKey === "antigravity" ? "Google Antigravity User" : "OAuth User"),
      avatarUrl: userInfo.picture
    },
    providerSpecificData
  };
}
var antigravityProjectCache = /* @__PURE__ */ new Map();
async function resolveAntigravityProject(accessToken) {
  if (!accessToken) return "";
  const cached = antigravityProjectCache.get(accessToken);
  if (cached) return cached;
  const endpoints = [
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.googleapis.com"
  ];
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "antigravity/1.0.0 darwin/arm64",
    "x-goog-api-client": "gl-node/22.21.1 google-api-nodejs-client/10.3.0"
  };
  for (const base of endpoints) {
    try {
      const loadRes = await fetch(`${base}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            pluginType: "GEMINI"
          }
        })
      });
      if (loadRes.ok) {
        const data = await loadRes.json();
        let proj = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || data.currentTier?.projectId || data.project || "";
        if (typeof proj === "string" && proj) {
          antigravityProjectCache.set(accessToken, proj);
          return proj;
        }
        const allowedTiers = data.allowedTiers || [];
        const targetTier = allowedTiers[0]?.id || allowedTiers[0]?.name || "free-tier";
        const onboardRes = await fetch(`${base}/v1internal:onboardUser`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            tierId: targetTier,
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              pluginType: "GEMINI"
            }
          })
        });
        if (onboardRes.ok) {
          const onboardData = await onboardRes.json();
          proj = onboardData.cloudaicompanionProject?.id || onboardData.cloudaicompanionProject || onboardData.project || "";
          if (typeof proj === "string" && proj) {
            antigravityProjectCache.set(accessToken, proj);
            return proj;
          }
        }
      }
    } catch {
    }
  }
  return "";
}

// api/_lib/gateway-core.ts
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate"
]);
function shouldFallback(status) {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422 || status === 429 || status >= 500;
}
async function handleGateway(req, nowMs) {
  const isAnthropicReq = req.subPath.toLowerCase().includes("messages");
  const raw = bearerToken(req) || req.header("x-api-key") || req.header("api-key") || req.query.get("key") || req.query.get("api_key");
  if (!raw) {
    return formatGatewayError(
      401,
      "Missing API key. Send `Authorization: Bearer ah-\xE2\u20AC\xA6` or `x-api-key: ah-\xE2\u20AC\xA6`.",
      isAnthropicReq
    );
  }
  const connectionId = req.header("x-connection-id") || req.header("x-provider-id");
  const providerKeyHeader = req.header("x-provider-key");
  let uid = raw ? await resolveApiKey(raw) : null;
  if (!uid) {
    uid = await requireUser(req);
  }
  if (!uid) {
    return formatGatewayError(401, "Invalid or revoked API key.", isAnthropicReq);
  }
  const path4 = req.subPath.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
  let [providers, models, combos] = await Promise.all([
    readKV(uid, "providers", []),
    readKV(uid, "models", []),
    readKV(uid, "combos", [])
  ]);
  if (!providers || providers.length === 0) {
    if (uid !== "local_user") {
      const [localProv, localMod, localComb] = await Promise.all([
        readKV("local_user", "providers", []),
        readKV("local_user", "models", []),
        readKV("local_user", "combos", [])
      ]);
      if (localProv && localProv.length > 0) {
        providers = localProv;
        if (!models || models.length === 0) models = localMod;
        if (!combos || combos.length === 0) combos = localComb;
      }
    }
  }
  if (path4 === "models" || path4 === "v1/models") {
    let detectProviderKey2 = function(p) {
      const url = (p.baseURL || "").toLowerCase();
      const name = (p.displayName || p.name || "").toLowerCase();
      if (url.includes("githubcopilot.com") || name.includes("copilot") || name.includes("github")) return "github";
      if (url.includes("api.x.ai") || name.includes("grok") || name.includes("xai")) return "grok";
      if (url.includes("api.kimi.com") || name.includes("kimi") || name.includes("moonshot")) return "kimi";
      if (url.includes("nvidia.com") || name.includes("nvidia")) return "nvidia";
      if (url.includes("openrouter.ai") || name.includes("openrouter")) return "openrouter";
      if (url.includes("anthropic.com") || name.includes("anthropic") || name.includes("claude")) return "anthropic";
      if (url.includes("cloudcode-pa.googleapis.com") || name.includes("antigravity")) return "antigravity";
      if (url.includes("generativelanguage.googleapis.com") || name.includes("google") || name.includes("gemini")) return "google";
      if (url.includes("openai.com") || name.includes("openai") || name.includes("codex")) return "openai";
      return p.key || "custom";
    };
    var detectProviderKey = detectProviderKey2;
    const data = [];
    const seenIds = /* @__PURE__ */ new Set();
    const activeProviders = Array.isArray(providers) ? providers.filter((p) => p && !p.disabled) : [];
    const activeProviderMap = /* @__PURE__ */ new Map();
    for (const p of activeProviders) {
      if (p.id) activeProviderMap.set(p.id, p);
      if (p.key) activeProviderMap.set(p.key, p);
      if (p.displayName) activeProviderMap.set(p.displayName.toLowerCase(), p);
    }
    const providerModelCounts = /* @__PURE__ */ new Map();
    if (Array.isArray(models)) {
      for (const m of models) {
        if (!m || !m.modelId || seenIds.has(m.modelId)) continue;
        let parentProvider;
        if (activeProviders.length > 0) {
          parentProvider = m.providerId && activeProviderMap.get(m.providerId) || m.providerKey && activeProviderMap.get(m.providerKey) || activeProviders.find(
            (p) => p.id === m.providerId || p.key === m.providerKey || p.displayName && m.providerId && p.displayName.toLowerCase() === m.providerId.toLowerCase()
          );
          if (!parentProvider && activeProviders.length > 0 && (m.providerId || m.providerKey)) {
            continue;
          }
        }
        const cleanId = m.modelId.replace(/^aip\//i, "");
        if (seenIds.has(cleanId)) continue;
        seenIds.add(cleanId);
        const owner = parentProvider?.key || parentProvider?.displayName || m.providerKey || m.providerId || "provider";
        data.push({
          id: cleanId,
          object: "model",
          owned_by: owner
        });
        if (parentProvider?.id) {
          providerModelCounts.set(parentProvider.id, (providerModelCounts.get(parentProvider.id) || 0) + 1);
        }
      }
    }
    const DEFAULT_CATALOG = {
      openai: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o3-mini"],
      anthropic: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
      google: [
        "gemini-3.7-flash-high",
        "gemini-3.7-flash-medium",
        "gemini-3.7-flash-low",
        "gemini-pro-agent",
        "gemini-3.1-pro-low",
        "gemini-3.1-flash-lite",
        "claude-opus-4-6-thinking",
        "claude-sonnet-4-6",
        "claude-3-5-sonnet-v2",
        "gpt-oss-120b-medium",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash"
      ],
      antigravity: [
        "gemini-3.7-flash-high",
        "gemini-3.7-flash-medium",
        "gemini-3.7-flash-low",
        "gemini-pro-agent",
        "gemini-3.1-pro-low",
        "gemini-3.1-flash-lite",
        "claude-opus-4-6-thinking",
        "claude-sonnet-4-6",
        "claude-3-5-sonnet-v2",
        "gpt-oss-120b-medium",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash"
      ],
      github: ["gpt-4o", "claude-3.5-sonnet", "o1-mini"],
      grok: ["grok-2", "grok-2-vision", "grok-beta"],
      kimi: ["kimi-k1.5", "moonshot-v1-128k", "moonshot-v1-32k"],
      nvidia: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1"],
      openrouter: ["anthropic/claude-3.7-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1"]
    };
    for (const p of activeProviders) {
      const count = (p.id ? providerModelCounts.get(p.id) : 0) || 0;
      const effectiveKey = detectProviderKey2(p);
      if (count === 0 && (DEFAULT_CATALOG[effectiveKey] || DEFAULT_CATALOG[p.key])) {
        const catalogList = DEFAULT_CATALOG[effectiveKey] || DEFAULT_CATALOG[p.key] || [];
        for (const mid of catalogList) {
          if (!seenIds.has(mid)) {
            seenIds.add(mid);
            data.push({
              id: mid,
              object: "model",
              owned_by: effectiveKey || p.key || "provider"
            });
          }
        }
      }
    }
    if (Array.isArray(combos)) {
      for (const c of combos) {
        const comboName = (c?.name || c?.comboName || c?.id || "").trim();
        if (comboName && !seenIds.has(comboName)) {
          seenIds.add(comboName);
          data.push({
            id: comboName,
            object: "model",
            owned_by: "combo"
          });
        }
      }
    }
    return jsonResponse(200, {
      object: "list",
      data
    });
  }
  const endpoint = matchEndpoint(path4);
  if (!endpoint) {
    return formatGatewayError(
      400,
      `Unsupported gateway path "/${path4}".`,
      isAnthropicReq
    );
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return formatGatewayError(
      400,
      "Request body must be valid JSON.",
      isAnthropicReq
    );
  }
  const requestedModel = String(body.model ?? "");
  const resolved = resolveAttempts(requestedModel, providers, models, combos);
  if ("error" in resolved) {
    return formatGatewayError(resolved.status, resolved.error, isAnthropicReq);
  }
  const wantsStream = body.stream === true;
  const tries = [];
  for (const route of resolved.attempts) {
    if (!baseURLFor(route.provider)) continue;
    const authList = route.provider.authMode === "cookie" ? [route.provider.cookie ?? ""].filter(Boolean) : route.keys.length ? route.keys : providerKeys(route.provider);
    for (const cred of authList) tries.push({ route, cred });
  }
  if (!tries.length) {
    return formatGatewayError(
      400,
      `No usable provider/key found for "${requestedModel}". Check the provider's base URL and API key in the app.`,
      isAnthropicReq
    );
  }
  let lastStatus = 502;
  let lastText = "All provider attempts failed.";
  const isCombo = resolved && "combo" in resolved && !!resolved.combo;
  const comboStart = Date.now();
  const comboAttempts = [];
  for (let i = 0; i < tries.length; i++) {
    const { route, cred } = tries[i];
    const { provider, modelId } = route;
    const attemptStart = Date.now();
    const isAnthropicProvider = (provider.apiFormat ?? "openai") === "anthropic";
    const needsTranslation = endpoint === "/messages" && !isAnthropicProvider;
    const toAnthropicProvider = endpoint === "/chat/completions" && isAnthropicProvider;
    const isGoogleProvider = provider.key === "google" || (provider.baseURL ?? "").includes("generativelanguage.googleapis.com") || (provider.baseURL ?? "").includes("cloudcode-pa.googleapis.com");
    const isOAuth = provider.authMode === "oauth" || cred.startsWith("ya29.");
    let actualEndpoint;
    let targetURL;
    let upstreamBody;
    const cleanModelId = modelId.replace(/^(google\/|aip\/)/i, "");
    const candidateUrls = [];
    if (needsTranslation && isGoogleProvider) {
      const googleRequest = anthropicToGoogle(body, cleanModelId);
      const streamEndpoint = wantsStream ? "streamGenerateContent" : "generateContent";
      const sseParam = wantsStream ? isOAuth ? "?alt=sse" : "&alt=sse" : "";
      if (isOAuth) {
        let projectId = provider.extraHeaders?.projectId || "";
        if (!projectId) {
          try {
            projectId = await resolveAntigravityProject(cred);
          } catch {
          }
        }
        candidateUrls.push(
          `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://cloudcode-pa.googleapis.com/v1alpha/models/${cleanModelId}:${streamEndpoint}${sseParam}`
        );
        if (cleanModelId.startsWith("claude-")) {
          const gemFallback = cleanModelId.includes("sonnet") || cleanModelId.includes("opus") ? "gemini-2.5-pro" : "gemini-2.0-flash";
          candidateUrls.push(
            `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://cloudcode-pa.googleapis.com/v1alpha/models/${gemFallback}:${streamEndpoint}${sseParam}`
          );
        }
        upstreamBody = JSON.stringify({
          model: cleanModelId,
          project: projectId || "",
          request: googleRequest
        });
      } else {
        candidateUrls.push(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`
        );
        upstreamBody = JSON.stringify({ model: cleanModelId, ...googleRequest });
      }
      actualEndpoint = endpoint;
    } else if (isGoogleProvider) {
      const googleRequest = openAIToGoogle(body, cleanModelId);
      const streamEndpoint = wantsStream ? "streamGenerateContent" : "generateContent";
      const sseParam = wantsStream ? isOAuth ? "?alt=sse" : "&alt=sse" : "";
      if (isOAuth) {
        let projectId = provider.extraHeaders?.projectId || "";
        if (!projectId) {
          try {
            projectId = await resolveAntigravityProject(cred);
          } catch {
          }
        }
        candidateUrls.push(
          `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://cloudcode-pa.googleapis.com/v1alpha/models/${cleanModelId}:${streamEndpoint}${sseParam}`
        );
        if (cleanModelId.startsWith("claude-")) {
          const gemFallback = cleanModelId.includes("sonnet") || cleanModelId.includes("opus") ? "gemini-2.5-pro" : "gemini-2.0-flash";
          candidateUrls.push(
            `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://cloudcode-pa.googleapis.com/v1alpha/models/${gemFallback}:${streamEndpoint}${sseParam}`
          );
        }
        upstreamBody = JSON.stringify({
          model: cleanModelId,
          project: projectId || "",
          request: googleRequest
        });
      } else {
        candidateUrls.push(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`
        );
        upstreamBody = JSON.stringify({ model: cleanModelId, ...googleRequest });
      }
      actualEndpoint = endpoint;
    } else if (needsTranslation) {
      actualEndpoint = "/chat/completions";
      candidateUrls.push(baseURLFor(provider).replace(/\/$/, "") + actualEndpoint);
      upstreamBody = JSON.stringify(
        anthropicToOpenAI(body, cleanModelId, provider.key)
      );
    } else if (toAnthropicProvider) {
      actualEndpoint = "/messages";
      candidateUrls.push(baseURLFor(provider).replace(/\/$/, "") + actualEndpoint);
      upstreamBody = JSON.stringify(openAIToAnthropic(body, cleanModelId));
    } else {
      actualEndpoint = endpoint;
      candidateUrls.push(baseURLFor(provider).replace(/\/$/, "") + actualEndpoint);
      upstreamBody = JSON.stringify({ ...body, model: cleanModelId });
    }
    const headers = isGoogleProvider ? buildUpstreamHeaders(provider, cred, actualEndpoint) : buildUpstreamHeaders(provider, cred, actualEndpoint);
    let upstream = null;
    for (const url of candidateUrls) {
      try {
        const candidateResp = await fetch(url, {
          method: "POST",
          headers,
          body: upstreamBody
        });
        const ct = (candidateResp.headers.get("content-type") ?? "").toLowerCase();
        if (ct.includes("text/html")) {
          lastStatus = candidateResp.status || 502;
          lastText = `Upstream returned an HTML page (Error ${candidateResp.status}). Check the provider Base URL (include /v1).`;
          continue;
        }
        if (candidateResp.ok) {
          upstream = candidateResp;
          break;
        }
        lastStatus = candidateResp.status;
        lastText = await safeText(candidateResp);
        if (isHtmlLike(lastText)) {
          lastText = `Upstream returned an HTML page (Error ${candidateResp.status}). Check the provider Base URL (include /v1).`;
          continue;
        }
        if (candidateUrls.length > 1) {
          continue;
        }
        upstream = candidateResp;
        break;
      } catch (err) {
        lastStatus = 502;
        lastText = err instanceof Error ? err.message : "Upstream fetch failed.";
      }
    }
    if (!upstream) {
      if (isCombo) {
        comboAttempts.push({
          providerId: provider.id,
          modelId,
          displayName: modelId,
          status: "failed",
          error: lastText,
          durationMs: Date.now() - attemptStart
        });
      }
      continue;
    }
    if (shouldFallback(upstream.status) && i < tries.length - 1) {
      lastStatus = upstream.status;
      lastText = await safeText(upstream);
      if (isCombo) {
        comboAttempts.push({
          providerId: provider.id,
          modelId,
          displayName: modelId,
          status: "failed",
          error: lastText,
          durationMs: Date.now() - attemptStart
        });
      }
      continue;
    }
    const succeeded = upstream.ok;
    if (succeeded) {
      void recordUsage(uid, provider.id, modelId, nowMs).catch(() => {
      });
    } else {
      lastStatus = upstream.status;
    }
    if (isCombo && resolved.combo) {
      const attemptError = succeeded ? void 0 : await safeText(upstream.clone()).catch(() => `HTTP ${upstream.status}`);
      comboAttempts.push({
        providerId: provider.id,
        modelId,
        displayName: modelId,
        status: succeeded ? "success" : "failed",
        error: attemptError,
        durationMs: Date.now() - attemptStart
      });
      void recordComboLog(uid, {
        id: `glog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        comboId: resolved.combo.id,
        comboName: resolved.combo.name,
        respondingModelId: succeeded ? modelId : "",
        respondingProviderId: succeeded ? provider.id : "",
        respondingModelName: succeeded ? modelId : void 0,
        attempts: [...comboAttempts],
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - comboStart,
        createdAt: Date.now()
      }).catch(() => {
      });
    }
    if (needsTranslation && isGoogleProvider) {
      return await translateGoogleResponseToAnthropic(upstream, wantsStream, modelId, body);
    }
    if (isGoogleProvider) {
      return await translateGoogleResponseToOpenAI(upstream, wantsStream, cleanModelId, body);
    }
    if (needsTranslation) {
      return await translateResponseToAnthropic(upstream, wantsStream, modelId);
    }
    if (toAnthropicProvider) {
      return await translateAnthropicResponseToOpenAI(
        upstream,
        wantsStream,
        cleanModelId
      );
    }
    return relay(upstream, wantsStream);
  }
  if (isCombo && resolved.combo) {
    void recordComboLog(uid, {
      id: `glog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      comboId: resolved.combo.id,
      comboName: resolved.combo.name,
      respondingModelId: "",
      respondingProviderId: "",
      attempts: [...comboAttempts],
      tokensIn: 0,
      tokensOut: 0,
      durationMs: Date.now() - comboStart,
      createdAt: Date.now()
    }).catch(() => {
    });
  }
  return formatGatewayError(
    lastStatus,
    `All ${tries.length} attempt(s) failed. Last upstream error: ${lastText}`,
    isAnthropicReq
  );
}
function buildUpstreamHeaders(provider, cred, endpoint) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept-Encoding", "identity");
  const isCopilot = (provider.baseURL ?? "").includes("api.githubcopilot.com") || (provider.baseURL ?? "").includes("copilot");
  const isGrok = (provider.baseURL ?? "").includes("api.x.ai");
  if (provider.key === "google" || (provider.baseURL ?? "").includes("googleapis.com")) {
    headers.set("User-Agent", "antigravity/1.0.0 darwin/arm64");
    headers.set("x-goog-api-client", "gl-node/22.21.1 google-api-nodejs-client/10.3.0");
  }
  const isAnthropic = provider.apiFormat === "anthropic" || endpoint === "/messages";
  if (isCopilot) {
    const copilotToken = provider.extraHeaders?.copilotToken || cred;
    headers.set("Authorization", `Bearer ${copilotToken}`);
    headers.set("X-GitHub-Api-Version", "2023-07-07");
    headers.set("User-Agent", "GitHubCopilot/1.0");
    headers.set("Editor-Version", "vscode/1.95.0");
    headers.set("Editor-Plugin-Version", "copilot/1.255.0");
    headers.set("Copilot-Integration-Id", "vscode-chat");
    headers.set("Openai-Intent", "conversation-panel");
    return headers;
  }
  if (isGrok) {
    headers.set("Authorization", `Bearer ${cred}`);
    headers.set("x-grok-client-version", "0.2.106");
    headers.set("x-grok-client-surface", "cli");
  } else if (provider.authMode === "cookie") {
    headers.set("Cookie", cred);
  } else if (isAnthropic) {
    headers.set("x-api-key", cred);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("Authorization", `Bearer ${cred}`);
  }
  if (provider.organization)
    headers.set("OpenAI-Organization", provider.organization);
  if (provider.extraHeaders) {
    for (const [k, v] of Object.entries(provider.extraHeaders)) {
      if (k === "copilotToken" || k === "copilotTokenExpiresAt" || k === "copilotEndpoints") continue;
      headers.set(k, v);
    }
  }
  return headers;
}
function openAIToAnthropic(body, modelId) {
  const messages = [];
  const inMsgs = body.messages ?? [];
  for (const msg of inMsgs) {
    if (msg.role === "system") continue;
    const role = msg.role === "assistant" ? "assistant" : "user";
    if (typeof msg.content === "string") {
      messages.push({ role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) {
      messages.push({ role, content: String(msg.content ?? "") });
      continue;
    }
    const parts = [];
    for (const b of msg.content) {
      const block = b;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "image_url") {
        const url = block.image_url?.url ?? "";
        if (typeof url === "string" && url) {
          const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(url);
          if (m) {
            parts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: m[1],
                data: m[2]
              }
            });
          } else {
            parts.push({ type: "text", text: `[image: ${url}]` });
          }
        }
      } else if (block.type === "file") {
        const file = block.file;
        const filename = String(file?.filename ?? "file");
        const fileData = String(file?.file_data ?? "");
        const m = /^data:(application\/[\w.+-]+);base64,(.+)$/.exec(fileData);
        if (m) {
          parts.push({
            type: "document",
            source: { type: "base64", media_type: m[1], data: m[2] },
            title: filename
          });
        } else {
          parts.push({ type: "text", text: `[attached file: ${filename}]` });
        }
      }
    }
    if (parts.length === 0) parts.push({ type: "text", text: "" });
    messages.push({ role, content: parts });
  }
  const result = {
    model: modelId,
    messages
  };
  if (body.stream === true) result.stream = true;
  if (body.max_tokens != null) result.max_tokens = body.max_tokens;
  else if (body.max_completion_tokens != null) {
    result.max_tokens = body.max_completion_tokens;
  }
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  const systemParts = [];
  for (const msg of inMsgs) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") systemParts.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type === "text") {
            systemParts.push(String(b.text ?? ""));
          }
        }
      }
    }
  }
  if (systemParts.length) {
    result.system = systemParts.join("\n");
  }
  const tools = body.tools;
  if (Array.isArray(tools) && tools.length) {
    result.tools = tools.map((t) => ({
      name: t.function?.name ?? "",
      description: t.function?.description ?? "",
      input_schema: t.function?.parameters ?? { type: "object", properties: {} }
    }));
    const tc = body.tool_choice;
    if (typeof tc === "string") {
      if (tc === "required") result.tool_choice = { type: "any" };
      else if (tc === "auto") result.tool_choice = { type: "auto" };
      else result.tool_choice = { type: "auto" };
    } else if (tc?.type === "function" && tc.function?.name) {
      result.tool_choice = { type: "tool", name: tc.function.name };
    } else if (tc?.type === "required") {
      result.tool_choice = { type: "any" };
    } else if (tc?.type === "auto") {
      result.tool_choice = { type: "auto" };
    }
  }
  return result;
}
function anthropicToOpenAI(body, modelId, providerKey) {
  const messages = [];
  const sys = body.system;
  if (sys) {
    const sysText = typeof sys === "string" ? sys : Array.isArray(sys) ? sys.map((b) => b.text ?? "").join("\n") : "";
    if (sysText) messages.push({ role: "system", content: sysText });
  }
  const inMsgs = body.messages ?? [];
  for (const msg of inMsgs) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: String(msg.content ?? "") });
      continue;
    }
    const blocks = msg.content;
    const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    if (msg.role === "assistant") {
      const toolUses = blocks.filter((b) => b.type === "tool_use");
      const m = {
        role: "assistant",
        content: textParts || null
      };
      if (toolUses.length) {
        m.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) }
        }));
      }
      messages.push(m);
      continue;
    }
    const toolResults = blocks.filter((b) => b.type === "tool_result");
    for (const tr of toolResults) {
      let trText = "";
      const trc = tr.content;
      if (typeof trc === "string") trText = trc;
      else if (Array.isArray(trc)) {
        trText = trc.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
      }
      messages.push({
        role: "tool",
        tool_call_id: tr.tool_use_id,
        content: trText
      });
    }
    if (textParts || !toolResults.length) {
      messages.push({ role: "user", content: textParts });
    }
  }
  const result = {
    model: modelId,
    messages
  };
  if (body.stream === true) result.stream = true;
  if (body.max_tokens != null) {
    let maxTokens = Number(body.max_tokens);
    if (providerKey === "nvidia" && maxTokens > 4096) {
      maxTokens = 4096;
    }
    result.max_tokens = maxTokens;
  }
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stop_sequences != null) result.stop = body.stop_sequences;
  const tools = body.tools;
  if (Array.isArray(tools) && tools.length) {
    result.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.input_schema ?? { type: "object", properties: {} }
      }
    }));
    const tc = body.tool_choice;
    if (tc?.type === "tool" && tc.name) {
      result.tool_choice = { type: "function", function: { name: tc.name } };
    } else if (tc?.type === "any") {
      result.tool_choice = "required";
    } else if (tc?.type === "auto") {
      result.tool_choice = "auto";
    }
  }
  return result;
}
var GOOGLE_ALLOWED_SCHEMA_KEYS = /* @__PURE__ */ new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required"
]);
function cleanSchemaForGoogle(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanSchemaForGoogle);
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!GOOGLE_ALLOWED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = cleanSchemaForGoogle(value);
  }
  if (Array.isArray(cleaned.required) && cleaned.properties && typeof cleaned.properties === "object") {
    const validProps = new Set(
      Object.keys(cleaned.properties)
    );
    cleaned.required = cleaned.required.filter(
      (name) => typeof name === "string" && validProps.has(name)
    );
    if (cleaned.required.length === 0) {
      delete cleaned.required;
    }
  }
  return cleaned;
}
var KNOWN_CLAUDE_TOOLS = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  todomvc: "TodoMVC",
  websearch: "WebSearch",
  fetch: "Fetch",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  execute_command: "Bash"
};
function sanitizeGoogleOutputText(text) {
  if (!text) return text;
  if (text.includes("<GenerateWidget")) {
    text = text.replace(/<GenerateWidget[^>]*>([\s\S]*?)<\/GenerateWidget>/gi, (_, inner) => {
      try {
        const parsed = JSON.parse(inner.trim());
        if (parsed.widgetSpec?.prompt) {
          return parsed.widgetSpec.prompt;
        }
      } catch {
      }
      return "";
    });
    text = text.replace(/<GenerateWidget[^>]*>[\s\S]*/gi, (match) => {
      const jsonStart = match.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(match.slice(jsonStart).trim());
          if (parsed.widgetSpec?.prompt) return parsed.widgetSpec.prompt;
        } catch {
        }
      }
      return "";
    });
  }
  return text;
}
function extractToolNameMap(body) {
  const map = /* @__PURE__ */ new Map();
  for (const [k, v] of Object.entries(KNOWN_CLAUDE_TOOLS)) {
    map.set(k.toLowerCase(), v);
    map.set(k.toLowerCase().replace(/[_\s-]/g, ""), v);
  }
  if (!body) return map;
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      const name = t?.function?.name || t?.name;
      if (typeof name === "string" && name.trim()) {
        const exact = name.trim();
        const lower = exact.toLowerCase();
        const normalized = lower.replace(/[_\s-]/g, "");
        map.set(exact, exact);
        map.set(lower, exact);
        map.set(normalized, exact);
      }
    }
  }
  return map;
}
function isDeclaredTool(rawName, map) {
  if (!rawName) return false;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  if (trimmed.includes(":") || trimmed.startsWith("image_agent") || trimmed.startsWith("google_search") || trimmed.startsWith("python")) {
    return false;
  }
  return map.has(trimmed) || map.has(lower) || map.has(normalized) || !!KNOWN_CLAUDE_TOOLS[lower];
}
function restoreToolName(rawName, map) {
  if (!rawName) return rawName;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  return map.get(trimmed) || map.get(lower) || map.get(normalized) || KNOWN_CLAUDE_TOOLS[lower] || trimmed;
}
function anthropicToGoogle(body, _modelId) {
  const contents = [];
  const toolNameMap = extractToolNameMap(body);
  const toolUseMap = /* @__PURE__ */ new Map();
  const inMsgs = body.messages ?? [];
  for (const msg of inMsgs) {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];
    if (typeof msg.content === "string") {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          const id = String(block.id ?? "");
          const name = String(block.name ?? "");
          if (id && name) toolUseMap.set(id, name);
          parts.push({
            functionCall: {
              name,
              args: block.input && typeof block.input === "object" ? block.input : {}
            }
          });
        } else if (block.type === "tool_result") {
          const toolUseId = String(block.tool_use_id ?? "");
          let name = toolUseMap.get(toolUseId);
          if (!name) {
            const firstDeclared = body.tools?.[0]?.name;
            name = firstDeclared || "tool_result";
          }
          name = restoreToolName(name ?? "tool_result", toolNameMap);
          let resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content.filter((x) => x.type === "text").map((x) => String(x.text ?? "")).join("\n");
          } else {
            resultText = String(block.content ?? "");
          }
          parts.push({
            functionResponse: {
              name,
              response: { name, output: resultText }
            }
          });
        }
      }
    }
    if (parts.length === 0) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }
  if (contents.length > 0 && contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }
  const googleBody = { contents };
  const sys = body.system;
  let sysText = typeof sys === "string" ? sys : Array.isArray(sys) ? sys.map((b) => b.text ?? "").join("\n") : "";
  const noWidgetInstruction = "You are an AI assistant. Output standard markdown text or execute tools. Only call tools that have been explicitly provided in the tools/function declarations. Never call undeclared internal tools (such as image_agent, fetch_images, python, or web search). Never output frontend web UI tags like <GenerateWidget>, widgetSpec, or component placeholders.";
  sysText = sysText ? `${sysText}

${noWidgetInstruction}` : noWidgetInstruction;
  googleBody.systemInstruction = { parts: [{ text: sysText }] };
  const tools = body.tools;
  if (Array.isArray(tools) && tools.length) {
    googleBody.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          parameters: cleanSchemaForGoogle(
            t.input_schema ?? { type: "object", properties: {} }
          )
        }))
      }
    ];
  }
  const generationConfig = {};
  if (body.max_tokens != null)
    generationConfig.maxOutputTokens = body.max_tokens;
  if (body.temperature != null)
    generationConfig.temperature = body.temperature;
  if (body.top_p != null) generationConfig.topP = body.top_p;
  if (Object.keys(generationConfig).length > 0) {
    googleBody.generationConfig = generationConfig;
  }
  return googleBody;
}
async function translateGoogleResponseToAnthropic(upstream, wantsStream, modelId, requestBody) {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
    }
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      true
    );
  }
  if (wantsStream) {
    return translateGoogleStreamToAnthropic(upstream, modelId, requestBody);
  }
  let googleResp;
  try {
    googleResp = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      true
    );
  }
  const toolNameMap = extractToolNameMap(requestBody);
  const candidate = googleResp.response?.candidates?.[0] || googleResp.candidates?.[0] || googleResp.result?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content = [];
  let hasToolCall = false;
  for (const p of parts) {
    if (p.text) {
      const clean = sanitizeGoogleOutputText(p.text);
      if (clean) {
        if (p.thought) {
          content.push({ type: "thinking", thinking: clean });
        } else {
          content.push({ type: "text", text: clean });
        }
      }
    }
    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
      hasToolCall = true;
      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
      content.push({
        type: "tool_use",
        id: `toolu_g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: exactName,
        input: p.functionCall.args ?? {}
      });
    }
  }
  if (content.length === 0) {
    const fallbackText = sanitizeGoogleOutputText(
      googleResp.response?.reply || googleResp.reply || googleResp.response?.message || googleResp.message || ""
    );
    content.push({ type: "text", text: fallbackText || "" });
  }
  const usageMeta = googleResp.response?.usageMetadata || googleResp.usageMetadata || googleResp.result?.usageMetadata;
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: modelId,
      content,
      stop_reason: hasToolCall ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: usageMeta?.promptTokenCount ?? 0,
        output_tokens: usageMeta?.candidatesTokenCount ?? 0
      }
    }
  };
}
function translateGoogleStreamToAnthropic(upstream, modelId, requestBody) {
  const encoder = new TextEncoder();
  const msgId = `msg_${Date.now()}`;
  const toolNameMap = extractToolNameMap(requestBody);
  const ev = (obj, name) => encoder.encode(`event: ${name}
data: ${JSON.stringify(obj)}

`);
  const stream = new ReadableStream({
    async start(controller) {
      let nextIndex = 0;
      let textIndex = -1;
      let textOpen = false;
      let thinkingIndex = -1;
      let thinkingOpen = false;
      let toolCount = 0;
      const closeThinking = () => {
        if (thinkingOpen) {
          controller.enqueue(
            ev({ type: "content_block_stop", index: thinkingIndex }, "content_block_stop")
          );
          thinkingOpen = false;
        }
      };
      const closeText = () => {
        if (textOpen) {
          controller.enqueue(
            ev({ type: "content_block_stop", index: textIndex }, "content_block_stop")
          );
          textOpen = false;
        }
      };
      controller.enqueue(
        ev(
          {
            type: "message_start",
            message: {
              id: msgId,
              type: "message",
              role: "assistant",
              model: modelId,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 }
            }
          },
          "message_start"
        )
      );
      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            const candidate = chunk.response?.candidates?.[0] || chunk.candidates?.[0] || chunk.result?.candidates?.[0];
            const parts = candidate?.content?.parts ?? [];
            for (const p of parts) {
              if (p.text) {
                const clean = sanitizeGoogleOutputText(p.text);
                if (!clean) continue;
                if (p.thought) {
                  closeText();
                  if (!thinkingOpen) {
                    thinkingIndex = nextIndex++;
                    thinkingOpen = true;
                    controller.enqueue(
                      ev(
                        {
                          type: "content_block_start",
                          index: thinkingIndex,
                          content_block: { type: "thinking", thinking: "" }
                        },
                        "content_block_start"
                      )
                    );
                  }
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_delta",
                        index: thinkingIndex,
                        delta: { type: "thinking_delta", thinking: clean }
                      },
                      "content_block_delta"
                    )
                  );
                } else {
                  closeThinking();
                  if (!textOpen) {
                    textIndex = nextIndex++;
                    textOpen = true;
                    controller.enqueue(
                      ev(
                        {
                          type: "content_block_start",
                          index: textIndex,
                          content_block: { type: "text", text: "" }
                        },
                        "content_block_start"
                      )
                    );
                  }
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_delta",
                        index: textIndex,
                        delta: { type: "text_delta", text: clean }
                      },
                      "content_block_delta"
                    )
                  );
                }
              }
              if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
                closeThinking();
                closeText();
                const anthIndex = nextIndex++;
                toolCount += 1;
                const exactName = restoreToolName(p.functionCall.name, toolNameMap);
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_start",
                      index: anthIndex,
                      content_block: {
                        type: "tool_use",
                        id: `toolu_g_${msgId}_${anthIndex}`,
                        name: exactName,
                        input: {}
                      }
                    },
                    "content_block_start"
                  )
                );
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_delta",
                      index: anthIndex,
                      delta: {
                        type: "input_json_delta",
                        partial_json: JSON.stringify(p.functionCall.args ?? {})
                      }
                    },
                    "content_block_delta"
                  )
                );
                controller.enqueue(
                  ev(
                    { type: "content_block_stop", index: anthIndex },
                    "content_block_stop"
                  )
                );
              }
            }
          }
        }
        closeThinking();
        closeText();
      } catch {
      }
      closeText();
      const stopReason = toolCount ? "tool_use" : "end_turn";
      controller.enqueue(
        ev(
          {
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: 0 }
          },
          "message_delta"
        )
      );
      controller.enqueue(ev({ type: "message_stop" }, "message_stop"));
      controller.close();
    }
  });
  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    },
    streamBody: stream
  };
}
function openAIToGoogle(body, _modelId) {
  const contents = [];
  const inMsgs = body.messages ?? [];
  let systemInstruction;
  for (const msg of inMsgs) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemInstruction = msg.content;
      }
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];
    if (typeof msg.content === "string") {
      if (msg.content.trim()) parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const url = part.image_url?.url || "";
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(.*?);base64,(.*)$/);
            if (match) {
              parts.push({
                inlineData: { mimeType: match[1], data: match[2] }
              });
            }
          }
        }
      }
    }
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
        } catch {
        }
        parts.push({
          functionCall: {
            name: tc.function?.name || "",
            args
          }
        });
      }
    } else if (msg.role === "tool") {
      const name = msg.name || "tool_result";
      const resultText = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      parts.push({
        functionResponse: {
          name,
          response: { name, output: resultText }
        }
      });
    }
    if (parts.length === 0) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }
  if (contents.length > 0 && contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }
  const googleBody = { contents };
  const noWidgetInstruction = "You are an AI assistant. Output standard markdown text or execute tools. Only call tools that have been explicitly provided in the tools/function declarations. Never call undeclared internal tools (such as image_agent, fetch_images, python, or web search). Never output frontend web UI tags like <GenerateWidget>, widgetSpec, or component placeholders.";
  const finalSys = systemInstruction ? `${systemInstruction}

${noWidgetInstruction}` : noWidgetInstruction;
  googleBody.systemInstruction = { parts: [{ text: finalSys }] };
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    googleBody.tools = [
      {
        functionDeclarations: body.tools.map((t) => ({
          name: t.function?.name || t.name,
          description: t.function?.description || t.description || "",
          parameters: cleanSchemaForGoogle(
            t.function?.parameters || t.parameters || { type: "object", properties: {} }
          )
        }))
      }
    ];
  }
  const generationConfig = {};
  if (body.temperature !== void 0) generationConfig.temperature = body.temperature;
  if (body.max_tokens != null || body.max_completion_tokens != null) {
    generationConfig.maxOutputTokens = body.max_tokens ?? body.max_completion_tokens;
  }
  if (body.top_p !== void 0) generationConfig.topP = body.top_p;
  if (Object.keys(generationConfig).length > 0) {
    googleBody.generationConfig = generationConfig;
  }
  return googleBody;
}
async function translateGoogleResponseToOpenAI(upstream, wantsStream, modelId, requestBody) {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
    }
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      false
    );
  }
  if (wantsStream) {
    return translateGoogleStreamToOpenAI(upstream, modelId, requestBody);
  }
  let googleResp;
  try {
    googleResp = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      false
    );
  }
  const candidate = googleResp.response?.candidates?.[0] || googleResp.candidates?.[0] || googleResp.result?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textParts = [];
  const reasoningParts = [];
  const toolCalls = [];
  const toolNameMap = extractToolNameMap(requestBody);
  for (const p of parts) {
    if (p.text) {
      const clean = sanitizeGoogleOutputText(p.text);
      if (clean) {
        if (p.thought) {
          reasoningParts.push(clean);
        } else {
          textParts.push(clean);
        }
      }
    }
    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: exactName,
          arguments: JSON.stringify(p.functionCall.args || {})
        }
      });
    }
  }
  let text = textParts.join("");
  const reasoningText = reasoningParts.join("");
  if (!text && !toolCalls.length) {
    if (typeof candidate?.message?.content === "string") text = sanitizeGoogleOutputText(candidate.message.content);
    else if (typeof googleResp.response?.reply === "string") text = sanitizeGoogleOutputText(googleResp.response.reply);
    else if (typeof googleResp.reply === "string") text = sanitizeGoogleOutputText(googleResp.reply);
    else if (typeof googleResp.response?.message === "string") text = sanitizeGoogleOutputText(googleResp.response.message);
    else if (typeof googleResp.message === "string") text = sanitizeGoogleOutputText(googleResp.message);
    else if (typeof googleResp.response === "string") text = sanitizeGoogleOutputText(googleResp.response);
  }
  const messageObj = {
    role: "assistant",
    content: text || (toolCalls.length ? null : "")
  };
  if (reasoningText) {
    messageObj.reasoning_content = reasoningText;
  }
  if (toolCalls.length) {
    messageObj.tool_calls = toolCalls;
  }
  const usageMeta = googleResp.response?.usageMetadata || googleResp.usageMetadata || googleResp.result?.usageMetadata;
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model: modelId,
      choices: [
        {
          index: 0,
          message: messageObj,
          finish_reason: toolCalls.length ? "tool_calls" : candidate?.finishReason?.toLowerCase() || "stop"
        }
      ],
      usage: {
        prompt_tokens: usageMeta?.promptTokenCount ?? 0,
        completion_tokens: usageMeta?.candidatesTokenCount ?? 0,
        total_tokens: usageMeta?.totalTokenCount ?? 0
      }
    }
  };
}
function translateGoogleStreamToOpenAI(upstream, modelId, requestBody) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chatId = `chatcmpl-${Date.now()}`;
  const toolNameMap = extractToolNameMap(requestBody);
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }
        let buffer = "";
        let toolIndex = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let startIdx = 0;
          while (startIdx < buffer.length) {
            const objStart = buffer.indexOf("{", startIdx);
            if (objStart === -1) break;
            let braceCount = 0;
            let objEnd = -1;
            for (let i = objStart; i < buffer.length; i++) {
              if (buffer[i] === "{") braceCount++;
              if (buffer[i] === "}") {
                braceCount--;
                if (braceCount === 0) {
                  objEnd = i + 1;
                  break;
                }
              }
            }
            if (objEnd !== -1) {
              const chunk = buffer.substring(objStart, objEnd);
              try {
                const googleChunk = JSON.parse(chunk);
                const candidate = googleChunk.response?.candidates?.[0] || googleChunk.candidates?.[0] || googleChunk.result?.candidates?.[0];
                if (candidate) {
                  const parts = candidate?.content?.parts || [];
                  for (const p of parts) {
                    if (p.text) {
                      const cleanText = sanitizeGoogleOutputText(p.text);
                      if (cleanText) {
                        const delta = p.thought ? { reasoning_content: cleanText } : { content: cleanText };
                        controller.enqueue(
                          encoder.encode(
                            `data: ${JSON.stringify({
                              id: chatId,
                              object: "chat.completion.chunk",
                              created: Math.floor(Date.now() / 1e3),
                              model: modelId,
                              choices: [
                                { index: 0, delta, finish_reason: null }
                              ]
                            })}

`
                          )
                        );
                      }
                    }
                  }
                  for (const p of parts) {
                    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
                      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({
                            id: chatId,
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1e3),
                            model: modelId,
                            choices: [
                              {
                                index: 0,
                                delta: {
                                  tool_calls: [
                                    {
                                      index: toolIndex++,
                                      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                                      type: "function",
                                      function: {
                                        name: exactName,
                                        arguments: JSON.stringify(p.functionCall.args || {})
                                      }
                                    }
                                  ]
                                },
                                finish_reason: null
                              }
                            ]
                          })}

`
                        )
                      );
                    }
                  }
                  if (candidate?.finishReason) {
                    const hasTool = parts.some((p) => p.functionCall);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          id: chatId,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1e3),
                          model: modelId,
                          choices: [
                            {
                              index: 0,
                              delta: {},
                              finish_reason: hasTool ? "tool_calls" : candidate.finishReason.toLowerCase()
                            }
                          ]
                        })}

`
                      )
                    );
                  }
                } else if (googleChunk.response?.reply || googleChunk.reply || googleChunk.response?.message || googleChunk.message) {
                  const directText = sanitizeGoogleOutputText(googleChunk.response?.reply || googleChunk.reply || googleChunk.response?.message || googleChunk.message || "");
                  if (directText) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          id: chatId,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1e3),
                          model: modelId,
                          choices: [{ index: 0, delta: { content: directText }, finish_reason: null }]
                        })}

`
                      )
                    );
                  }
                }
                const usageMeta = googleChunk.response?.usageMetadata || googleChunk.usageMetadata || googleChunk.result?.usageMetadata;
                if (usageMeta) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        id: chatId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1e3),
                        model: modelId,
                        choices: [],
                        usage: {
                          prompt_tokens: usageMeta.promptTokenCount || 0,
                          completion_tokens: usageMeta.candidatesTokenCount || 0,
                          total_tokens: usageMeta.totalTokenCount || 0
                        }
                      })}

`
                    )
                  );
                }
              } catch {
              }
              startIdx = objEnd;
            } else {
              break;
            }
          }
          buffer = buffer.substring(startIdx);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {
        }
      }
    }
  });
  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    },
    streamBody: stream
  };
}
async function translateResponseToAnthropic(upstream, wantsStream, modelId) {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText);
      if (typeof parsed.error === "string") message = parsed.error;
      else if (parsed.error?.message) message = parsed.error.message;
    } catch {
    }
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      true
    );
  }
  if (wantsStream) {
    return translateStreamToAnthropic(upstream, modelId);
  }
  let openai;
  try {
    openai = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      true
    );
  }
  const choice = openai.choices?.[0];
  const text = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls ?? [];
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const tc of toolCalls) {
    let input = {};
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: tc.id ?? `toolu_${Date.now()}`,
      name: tc.function?.name ?? "",
      input
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  let stopReason;
  if (toolCalls.length) stopReason = "tool_use";
  else if (choice?.finish_reason === "length") stopReason = "max_tokens";
  else stopReason = "end_turn";
  const anthropicBody = {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelId,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openai.usage?.prompt_tokens ?? 0,
      output_tokens: openai.usage?.completion_tokens ?? 0
    }
  };
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: anthropicBody
  };
}
async function translateAnthropicResponseToOpenAI(upstream, wantsStream, modelId) {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message2 = errText;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error?.message) message2 = parsed.error.message;
    } catch {
    }
    return formatGatewayError(
      upstream.status,
      message2 || `Upstream error ${upstream.status}.`,
      false
    );
  }
  if (wantsStream) {
    return translateAnthropicStreamToOpenAI(upstream, modelId);
  }
  let anth;
  try {
    anth = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      false
    );
  }
  const text = (anth.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text ?? "").join("");
  const toolUses = (anth.content ?? []).filter((b) => b.type === "tool_use");
  const message = { role: "assistant", content: text };
  if (toolUses.length) {
    message.tool_calls = toolUses.map((t) => ({
      id: t.id ?? `call_${Date.now()}`,
      type: "function",
      function: {
        name: t.name ?? "",
        arguments: JSON.stringify(t.input ?? {})
      }
    }));
  }
  let finishReason;
  switch (anth.stop_reason) {
    case "tool_use":
      finishReason = "tool_calls";
      break;
    case "max_tokens":
      finishReason = "length";
      break;
    default:
      finishReason = "stop";
  }
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model: modelId,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason
        }
      ],
      usage: {
        prompt_tokens: anth.usage?.input_tokens ?? 0,
        completion_tokens: anth.usage?.output_tokens ?? 0,
        total_tokens: (anth.usage?.input_tokens ?? 0) + (anth.usage?.output_tokens ?? 0)
      }
    }
  };
}
function translateAnthropicStreamToOpenAI(upstream, modelId) {
  const encoder = new TextEncoder();
  const chatId = `chatcmpl-${Date.now()}`;
  const sse = (obj) => encoder.encode(`data: ${JSON.stringify(obj)}

`);
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.enqueue(sse({ id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1e3), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let textOpen = false;
        let stopReason = "stop";
        let usageIn = 0;
        let usageOut = 0;
        const closeText = () => {
          if (textOpen) {
            controller.enqueue(
              sse({
                id: chatId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1e3),
                model: modelId,
                choices: [{ index: 0, delta: {}, finish_reason: null }]
              })
            );
            textOpen = false;
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            if (evt.type === "content_block_delta" && evt.delta?.text) {
              if (!textOpen) {
                textOpen = true;
                controller.enqueue(
                  sse({
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1e3),
                    model: modelId,
                    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]
                  })
                );
              }
              controller.enqueue(
                sse({
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1e3),
                  model: modelId,
                  choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }]
                })
              );
            } else if (evt.type === "message_delta") {
              if (evt.delta?.stop_reason) {
                stopReason = evt.delta.stop_reason === "tool_use" ? "tool_calls" : evt.delta.stop_reason === "max_tokens" ? "length" : "stop";
              }
              usageOut = evt.usage?.output_tokens ?? usageOut;
            } else if (evt.type === "message_start") {
              usageIn = evt.message?.usage?.input_tokens ?? usageIn;
            } else if (evt.type === "message_stop") {
              closeText();
            }
          }
        }
        controller.enqueue(
          sse({
            id: chatId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1e3),
            model: modelId,
            choices: [],
            usage: {
              prompt_tokens: usageIn,
              completion_tokens: usageOut,
              total_tokens: usageIn + usageOut
            }
          })
        );
        controller.enqueue(sse({ id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1e3), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: stopReason }] }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        try {
          controller.enqueue(sse({ id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1e3), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
        }
      }
    }
  });
  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    },
    streamBody: stream
  };
}
function translateStreamToAnthropic(upstream, modelId) {
  const encoder = new TextEncoder();
  const msgId = `msg_${Date.now()}`;
  const ev = (obj, name) => encoder.encode(`event: ${name}
data: ${JSON.stringify(obj)}

`);
  const stream = new ReadableStream({
    async start(controller) {
      let nextIndex = 0;
      let textIndex = -1;
      let textOpen = false;
      const toolBlocks = /* @__PURE__ */ new Map();
      let finishReason = null;
      let closed = false;
      const closeText = () => {
        if (textOpen) {
          controller.enqueue(
            ev({ type: "content_block_stop", index: textIndex }, "content_block_stop")
          );
          textOpen = false;
        }
      };
      controller.enqueue(
        ev(
          {
            type: "message_start",
            message: {
              id: msgId,
              type: "message",
              role: "assistant",
              model: modelId,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 }
            }
          },
          "message_start"
        )
      );
      try {
        const reader = upstream.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              let chunk;
              try {
                chunk = JSON.parse(payload);
              } catch {
                continue;
              }
              const choice = chunk.choices?.[0];
              if (!choice) continue;
              if (choice.finish_reason) finishReason = choice.finish_reason;
              const td = choice.delta?.content ?? choice.text;
              if (td) {
                if (!textOpen) {
                  textIndex = nextIndex++;
                  textOpen = true;
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_start",
                        index: textIndex,
                        content_block: { type: "text", text: "" }
                      },
                      "content_block_start"
                    )
                  );
                }
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_delta",
                      index: textIndex,
                      delta: { type: "text_delta", text: td }
                    },
                    "content_block_delta"
                  )
                );
              }
              for (const tc of choice.delta?.tool_calls ?? []) {
                const k = tc.index ?? 0;
                let block = toolBlocks.get(k);
                if (!block) {
                  closeText();
                  block = { anthIndex: nextIndex++ };
                  toolBlocks.set(k, block);
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_start",
                        index: block.anthIndex,
                        content_block: {
                          type: "tool_use",
                          id: tc.id || `toolu_${msgId}_${k}`,
                          name: tc.function?.name ?? "",
                          input: {}
                        }
                      },
                      "content_block_start"
                    )
                  );
                }
                if (tc.function?.arguments) {
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_delta",
                        index: block.anthIndex,
                        delta: {
                          type: "input_json_delta",
                          partial_json: tc.function.arguments
                        }
                      },
                      "content_block_delta"
                    )
                  );
                }
              }
            }
          }
        }
      } catch {
      }
      closeText();
      for (const { anthIndex } of Array.from(toolBlocks.values()).sort(
        (a, b) => a.anthIndex - b.anthIndex
      )) {
        controller.enqueue(
          ev({ type: "content_block_stop", index: anthIndex }, "content_block_stop")
        );
      }
      const stopReason = toolBlocks.size ? "tool_use" : finishReason === "length" ? "max_tokens" : "end_turn";
      controller.enqueue(
        ev(
          {
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: 0 }
          },
          "message_delta"
        )
      );
      controller.enqueue(ev({ type: "message_stop" }, "message_stop"));
      if (!closed) {
        controller.close();
        closed = true;
      }
    }
  });
  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    },
    streamBody: stream
  };
}
function formatGatewayError(status, message, isAnthropic) {
  const code = status === 404 ? 400 : status;
  let cleanMsg = message;
  if (cleanMsg.includes("404 page not found") || cleanMsg.includes("404 Not Found")) {
    cleanMsg = `Upstream API returned 404 Page Not Found. Check provider Base URL (ensure /v1 is included) and model ID in AI Provider Hub. Details: ${message}`;
  } else if (/<\/?[a-z][\s\S]*>/i.test(cleanMsg)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleanMsg);
    cleanMsg = title?.[1]?.trim() ? `Upstream returned an HTML page (${title[1].trim()}). Check the provider Base URL (include /v1).` : "Upstream returned an HTML page instead of an API response. Check the provider Base URL (include /v1).";
  }
  if (isAnthropic) {
    return jsonResponse(code, {
      type: "error",
      error: {
        type: status === 401 ? "authentication_error" : "invalid_request_error",
        message: cleanMsg
      }
    });
  }
  return jsonResponse(code, {
    error: { message: cleanMsg, type: "invalid_request_error" }
  });
}
function matchEndpoint(path4) {
  const p = path4.replace(/^v1\//, "").replace(/\/$/, "");
  if (p === "chat/completions") return "/chat/completions";
  if (p === "completions") return "/completions";
  if (p === "embeddings") return "/embeddings";
  if (p === "messages") return "/messages";
  return null;
}
function relay(upstream, _wantsStream) {
  const headers = {};
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) return;
    if (lk === "content-encoding" || lk === "content-length") return;
    headers[k] = v;
  });
  if ((headers["content-type"] ?? "").toLowerCase().includes("text/html")) {
    return formatGatewayError(
      upstream.status,
      `Upstream returned an HTML page instead of an API response (${upstream.status}). Check the provider Base URL (include /v1) and that it's an API endpoint, not a website.`,
      false
    );
  }
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
    streamBody: upstream.body
  };
}
async function safeText(res) {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}
function isHtmlLike(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  return /^</.test(t) || /<!doctype html/i.test(t) || /<html[\s>]/i.test(t);
}
async function safeJson(upstream) {
  const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("text/html")) {
    throw new Error(
      `Upstream returned an HTML page (Error ${upstream.status}). Check the provider Base URL (include /v1).`
    );
  }
  const text = await upstream.text();
  if (!text || text.trim().startsWith("<")) {
    throw new Error(
      `Upstream returned non-JSON (${upstream.status}): ${text.slice(0, 100)}`
    );
  }
  return JSON.parse(text);
}
async function recordUsage(uid, providerId, modelId, nowMs) {
  const KEY = "gatewayUsage";
  const list = await readKV(uid, KEY, []);
  list.push({ providerId, modelId, at: nowMs });
  const trimmed = list.slice(-500);
  await writeKV(uid, KEY, trimmed, nowMs);
}
async function recordComboLog(uid, entry) {
  const KEY = "combo_logs";
  const list = await readKV(uid, KEY, []);
  const nextList = [entry, ...list].slice(0, 1e3);
  await writeKV(uid, KEY, nextList, entry.createdAt);
}

// api/_lib/keys-core.ts
async function handleKeys(req, nowMs) {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });
  const method = req.method.toUpperCase();
  if (method === "GET") {
    const keys = await listApiKeys(uid);
    return jsonResponse(200, { keys });
  }
  if (method === "POST") {
    let label = "Gateway key";
    try {
      const body = await req.json();
      if (body?.label) label = String(body.label).slice(0, 60);
    } catch {
    }
    const { raw, record } = await createApiKey(uid, label, nowMs);
    return jsonResponse(201, { raw, key: record });
  }
  if (method === "DELETE") {
    let id = req.query.get("id");
    if (!id) {
      try {
        const b = await req.json();
        if (b?.id) id = b.id;
      } catch {
      }
    }
    if (!id) return jsonResponse(400, { error: "Missing `id`." });
    const ok = await revokeApiKey(uid, id);
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(405, { error: "Method not allowed." });
}

// api/_lib/data-core.ts
async function handleData(req, nowMs) {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });
  const key = req.query.get("key");
  if (!key || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
    return jsonResponse(400, { error: "Invalid or missing `key`." });
  }
  const method = req.method.toUpperCase();
  if (method === "GET") {
    const value = await readKV(uid, key, null);
    return jsonResponse(200, { value });
  }
  if (method === "PUT" || method === "POST") {
    let payload;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "Body must be JSON { value }." });
    }
    await writeKV(uid, key, payload.value ?? null, nowMs);
    return jsonResponse(200, { ok: true });
  }
  if (method === "DELETE") {
    await deleteKV(uid, key);
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(405, { error: "Method not allowed." });
}

// api/_lib/backup-core.ts
var STORE_KEYS = [
  "providers",
  "models",
  "combos",
  "keystore",
  "chats"
];
async function handleBackup(req, nowMs) {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });
  const method = req.method.toUpperCase();
  if (method === "GET") {
    const data = {
      version: 1,
      exportedAt: nowMs
    };
    for (const key of STORE_KEYS) {
      const val = await readKV(uid, key, null);
      if (val !== null) {
        data[key] = val;
      }
    }
    const localAll = await getAllLocalKV(uid);
    for (const [k, v] of Object.entries(localAll)) {
      if (data[k] === void 0 && v !== null) {
        data[k] = v;
      }
    }
    try {
      const keys = await listApiKeys(uid);
      data["gatewayKeys"] = keys;
    } catch {
    }
    return jsonResponse(200, { data });
  }
  if (method === "PUT" || method === "POST") {
    let payload;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON payload." });
    }
    const incoming = payload.data || {};
    let restoredCount = 0;
    for (const key of STORE_KEYS) {
      if (incoming[key] !== void 0) {
        await writeKV(uid, key, incoming[key], nowMs);
        restoredCount++;
      }
    }
    return jsonResponse(200, {
      ok: true,
      message: `Successfully imported ${restoredCount} datasets.`,
      restoredCount
    });
  }
  return jsonResponse(405, { error: "Method not allowed." });
}

// api/_lib/oauth/oauth-core.ts
async function handleOAuth(req) {
  const method = req.method.toUpperCase();
  const path4 = (req.subPath || "").replace(/^\/+/, "");
  if (method === "GET" && (path4 === "providers" || path4 === "")) {
    const list = Object.entries(OAUTH_PROVIDERS).map(([key, config]) => ({
      key,
      name: config.name,
      type: config.type,
      defaultModels: config.defaultModels || []
    }));
    return jsonResponse(200, { ok: true, providers: list });
  }
  if (method === "POST" && path4 === "device/code") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
    }
    const provider = body.provider;
    if (!provider) {
      return jsonResponse(400, { ok: false, error: "Missing required 'provider' parameter." });
    }
    try {
      const codeResp = await initiateDeviceCode(provider);
      return jsonResponse(200, { ok: true, ...codeResp });
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message || "Failed to initiate device code" });
    }
  }
  if (method === "POST" && path4 === "device/poll") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
    }
    const { provider, device_code } = body;
    if (!provider || !device_code) {
      return jsonResponse(400, {
        ok: false,
        error: "Missing required 'provider' or 'device_code' parameter."
      });
    }
    try {
      const pollResult = await pollDeviceToken(provider, device_code);
      return jsonResponse(200, { ok: true, ...pollResult });
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message || "Failed to poll device token" });
    }
  }
  if (method === "POST" && path4 === "pkce/init") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
    }
    const { provider, redirect_uri } = body;
    if (!provider) {
      return jsonResponse(400, { ok: false, error: "Missing required 'provider' parameter." });
    }
    try {
      const res = initiatePkce(provider, redirect_uri);
      return jsonResponse(200, { ok: true, ...res });
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message || "Failed to initiate PKCE flow" });
    }
  }
  if (method === "POST" && path4 === "pkce/exchange") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
    }
    const { provider, code, code_verifier, redirect_uri } = body;
    if (!provider || !code || !code_verifier) {
      return jsonResponse(400, {
        ok: false,
        error: "Missing required 'provider', 'code', or 'code_verifier' parameter."
      });
    }
    try {
      const res = await exchangePkceCode(provider, code, code_verifier, redirect_uri);
      return jsonResponse(200, { ok: true, ...res });
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message || "Failed to exchange authorization code" });
    }
  }
  return jsonResponse(404, { ok: false, error: `OAuth route not found: ${path4}` });
}

// api/_lib/node-adapter.ts
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
function toCoreRequest(req, subPath, query) {
  let rawPromise;
  const raw = () => rawPromise ??= readRawBody(req);
  return {
    method: req.method ?? "GET",
    header: (name) => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
    query,
    subPath,
    async json() {
      const bytes = await raw();
      const text = new TextDecoder().decode(bytes);
      return text ? JSON.parse(text) : {};
    },
    rawBody: raw
  };
}
async function sendCoreResponse(res, core) {
  res.statusCode = core.status === 404 ? 400 : core.status;
  if (core.headers) {
    for (const [k, v] of Object.entries(core.headers)) res.setHeader(k, v);
  }
  if (core.streamBody) {
    const reader = core.streamBody.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(core.jsonBody ?? {}));
}
function sendError(res, err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api error]", err);
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

// api/proxy.ts
var TARGETS = {
  openai: "https://api.openai.com",
  nvidia: "https://integrate.api.nvidia.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai",
  google: "https://generativelanguage.googleapis.com",
  antigravity: "https://cloudcode-pa.googleapis.com"
};
var HOP_BY_HOP2 = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate"
]);
async function handler(req) {
  const url = new URL(req.url);
  let rawPath = url.searchParams.get("__p") ?? "";
  if (!rawPath) {
    const m = url.pathname.match(/^\/api\/proxy\/?(.*)$/);
    rawPath = m ? m[1] : "";
  }
  if (!rawPath) {
    return json({ error: "Missing proxy path." }, 400);
  }
  const [providerKey, ...rest] = rawPath.split("/");
  const upstreamPath = "/" + rest.join("/");
  let upstreamBase = TARGETS[providerKey];
  if (providerKey === "custom") {
    const target = url.searchParams.get("target");
    if (!target) return json({ error: "Missing ?target=<base-url>" }, 400);
    try {
      const parsed = new URL(target);
      upstreamBase = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
      return json({ error: "Invalid ?target URL" }, 400);
    }
  }
  if (!upstreamBase) {
    return json({ error: `Unknown provider "${providerKey}"` }, 400);
  }
  const forwardedParams = new URLSearchParams(url.searchParams);
  forwardedParams.delete("target");
  forwardedParams.delete("__p");
  const providerToken = req.headers.get("x-provider-key");
  if (providerKey === "google" && providerToken && !providerToken.startsWith("ya29.")) {
    forwardedParams.set("key", providerToken);
  }
  const qs = forwardedParams.toString();
  let targetURL = upstreamBase + upstreamPath + (qs ? "?" + qs : "");
  targetURL = targetURL.replace(/\/v1\/v1\//g, "/v1/");
  const outHeaders = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP2.has(k)) return;
    if (k === "host" || k === "origin" || k === "referer") return;
    if (k === "cookie") return;
    if (k === "x-provider-key") return;
    if (k === "x-provider-cookie") return;
    if (k.startsWith("x-vercel-") || k.startsWith("cf-") || k.startsWith("sec-")) return;
    outHeaders.set(key, value);
  });
  if (providerToken && (providerKey !== "google" || providerToken.startsWith("ya29."))) {
    if (upstreamPath.includes("/messages") || providerKey === "anthropic") {
      outHeaders.set("x-api-key", providerToken);
    } else {
      outHeaders.set("Authorization", `Bearer ${providerToken}`);
    }
  }
  const providerCookie = req.headers.get("x-provider-cookie");
  if (providerCookie) {
    outHeaders.set("Cookie", providerCookie);
  }
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  if (providerKey === "antigravity" && upstreamPath.includes("/models")) {
    return json(
      {
        object: "list",
        data: [
          { id: "gemini-3.7-flash-high", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-3.7-flash-medium", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-3.7-flash-low", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-pro-agent", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-3.1-pro-low", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-3.1-flash-lite", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "claude-opus-4-6-thinking", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "claude-sonnet-4-6", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "claude-3-5-sonnet-v2", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gpt-oss-120b-medium", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-2.5-pro", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-2.5-flash", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-2.0-flash", object: "model", created: Date.now(), owned_by: "google-antigravity" }
        ]
      },
      200
    );
  }
  if ((providerKey === "google" || providerKey === "antigravity") && upstreamPath.includes("/chat/completions")) {
    if (!providerToken) {
      return json({ error: `Missing API key or OAuth token for ${providerKey} provider` }, 401);
    }
    return handleGoogleChatCompletion(req, providerToken, providerKey);
  }
  try {
    const upstream = await fetch(targetURL, {
      method,
      headers: outHeaders,
      body: hasBody ? await req.arrayBuffer() : void 0,
      redirect: "follow"
    });
    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (HOP_BY_HOP2.has(lk)) return;
      if (lk === "content-encoding" || lk === "content-length") return;
      respHeaders.set(k, v);
    });
    if ((respHeaders.get("content-type") ?? "").includes("text/html")) {
      const text = await upstream.text().catch(() => "");
      return json(
        {
          error: `Upstream returned an HTML page instead of an API response (${upstream.status}). Check the Base URL (include /v1) and that it's an API endpoint, not a website.${text ? ` HTML: ${text.slice(0, 200)}` : ""}`
        },
        upstream.status
      );
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Proxy fetch failed" },
      502
    );
  }
}
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function handleGoogleChatCompletion(req, apiKey, providerKey = "google") {
  let openaiBody;
  try {
    openaiBody = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const rawModel = openaiBody.model || "gemini-2.0-flash";
  let model = rawModel.replace(/^(antigravity\/|google\/|aip\/)/i, "").trim();
  const messages = openaiBody.messages || [];
  const stream = openaiBody.stream === true;
  const isOAuth = providerKey === "antigravity" || apiKey.startsWith("ya29.") || apiKey.startsWith("oauth_") || req.headers.get("x-auth-mode") === "oauth";
  const contents = [];
  let systemInstruction;
  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = typeof msg.content === "string" ? msg.content : "";
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];
    if (typeof msg.content === "string") {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const url = part.image_url?.url || "";
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(.*?);base64,(.*)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2]
                }
              });
            }
          }
        }
      }
    }
    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }
  const mergedContents = [];
  for (const c of contents) {
    const last = mergedContents[mergedContents.length - 1];
    if (last && last.role === c.role) {
      last.parts.push(...c.parts);
    } else {
      mergedContents.push({ role: c.role, parts: [...c.parts] });
    }
  }
  if (mergedContents.length === 0) {
    mergedContents.push({ role: "user", parts: [{ text: "Hello" }] });
  }
  const googleBody = { contents: mergedContents };
  const generationConfig = {};
  if (openaiBody.temperature !== void 0) generationConfig.temperature = openaiBody.temperature;
  if (openaiBody.max_tokens || openaiBody.max_completion_tokens) {
    generationConfig.maxOutputTokens = openaiBody.max_tokens || openaiBody.max_completion_tokens;
  }
  if (openaiBody.top_p !== void 0) generationConfig.topP = openaiBody.top_p;
  if (Object.keys(generationConfig).length > 0) googleBody.generationConfig = generationConfig;
  if (systemInstruction) googleBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  const endpoint = stream ? "streamGenerateContent" : "generateContent";
  const sseParam = stream ? isOAuth ? "?alt=sse" : "&alt=sse" : "";
  const promptText = messages.map((m) => typeof m.content === "string" ? m.content : "").join("\n");
  const companionBody = {
    model,
    prompt: promptText,
    messages: messages.map((m) => ({
      author: m.role === "assistant" ? "model" : "user",
      content: typeof m.content === "string" ? m.content : ""
    }))
  };
  let projectId = req.headers.get("x-project-id") || "";
  if (isOAuth && !projectId) {
    try {
      projectId = await resolveAntigravityProject(apiKey);
    } catch {
    }
  }
  const internalBody = {
    model,
    ...googleBody
  };
  const wrappedInternalBody = {
    model,
    project: projectId || "",
    request: googleBody
  };
  const candidateRequests = [];
  if (isOAuth) {
    candidateRequests.push(
      { url: `https://cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(wrappedInternalBody) },
      { url: `https://daily-cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(wrappedInternalBody) },
      { url: `https://cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(internalBody) },
      { url: `https://daily-cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(internalBody) }
    );
    candidateRequests.push(
      { url: `https://cloudaicompanion.googleapis.com/v1alpha:generateMessage`, body: JSON.stringify(companionBody) },
      { url: `https://cloudcode-pa.googleapis.com/v1alpha:generateMessage`, body: JSON.stringify(companionBody) }
    );
    let baseModel = "gemini-2.5-flash";
    if (model.includes("3.1-pro") || model.includes("2.5-pro") || model.includes("opus") || model.includes("sonnet")) {
      baseModel = "gemini-2.5-pro";
    }
    const fallbackWrapped = { model: baseModel, project: projectId || "", request: googleBody };
    candidateRequests.push(
      { url: `https://cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(fallbackWrapped) },
      { url: `https://daily-cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(fallbackWrapped) }
    );
  } else {
    candidateRequests.push(
      { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${encodeURIComponent(apiKey)}${sseParam}`, body: JSON.stringify(googleBody) },
      { url: `https://generativelanguage.googleapis.com/v1/models/${model}:${endpoint}?key=${encodeURIComponent(apiKey)}${sseParam}`, body: JSON.stringify(googleBody) }
    );
  }
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "antigravity/1.0.0 darwin/arm64",
    "x-goog-api-client": "gl-node/22.21.1 google-api-nodejs-client/10.3.0"
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  let lastErrorText = "";
  let lastStatus = 502;
  for (const reqItem of candidateRequests) {
    try {
      const upstream = await fetch(reqItem.url, {
        method: "POST",
        headers,
        body: reqItem.body
      });
      if (upstream.ok) {
        if (stream) return streamGoogleResponse(upstream, model, openaiBody);
        else return convertGoogleResponse(await upstream.json(), model, openaiBody);
      }
      lastStatus = upstream.status;
      lastErrorText = await upstream.text().catch(() => `HTTP ${upstream.status}`);
      continue;
    } catch (err) {
      lastErrorText = err?.message || "Upstream fetch error";
    }
  }
  try {
    const errorJson = JSON.parse(lastErrorText);
    const errorMsg = errorJson.error?.message || lastErrorText;
    return json({ error: { message: errorMsg, type: "google_api_error", code: errorJson.error?.code || lastStatus } }, lastStatus);
  } catch {
    return json({ error: { message: lastErrorText || "Google API request failed", type: "google_api_error", code: lastStatus } }, lastStatus);
  }
}
var KNOWN_CLAUDE_TOOLS2 = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  todomvc: "TodoMVC",
  websearch: "WebSearch",
  fetch: "Fetch",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  execute_command: "Bash"
};
function extractToolNameMap2(body) {
  const map = /* @__PURE__ */ new Map();
  for (const [k, v] of Object.entries(KNOWN_CLAUDE_TOOLS2)) {
    map.set(k.toLowerCase(), v);
    map.set(k.toLowerCase().replace(/[_\s-]/g, ""), v);
  }
  if (!body) return map;
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      const name = t?.function?.name || t?.name;
      if (typeof name === "string" && name.trim()) {
        const exact = name.trim();
        const lower = exact.toLowerCase();
        const normalized = lower.replace(/[_\s-]/g, "");
        map.set(exact, exact);
        map.set(lower, exact);
        map.set(normalized, exact);
      }
    }
  }
  return map;
}
function restoreToolName2(rawName, map) {
  if (!rawName) return rawName;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  return map.get(trimmed) || map.get(lower) || map.get(normalized) || KNOWN_CLAUDE_TOOLS2[lower] || trimmed;
}
function sanitizeGoogleOutputText2(text) {
  if (!text) return text;
  if (text.includes("<GenerateWidget")) {
    text = text.replace(/<GenerateWidget[^>]*>([\s\S]*?)<\/GenerateWidget>/gi, (_, inner) => {
      try {
        const parsed = JSON.parse(inner.trim());
        if (parsed.widgetSpec?.prompt) {
          return parsed.widgetSpec.prompt;
        }
      } catch {
      }
      return "";
    });
    text = text.replace(/<GenerateWidget[^>]*>[\s\S]*/gi, (match) => {
      const jsonStart = match.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(match.slice(jsonStart).trim());
          if (parsed.widgetSpec?.prompt) return parsed.widgetSpec.prompt;
        } catch {
        }
      }
      return "";
    });
  }
  return text;
}
function isDeclaredTool2(rawName, map) {
  if (!rawName) return false;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  if (trimmed.includes(":") || trimmed.startsWith("image_agent") || trimmed.startsWith("google_search") || trimmed.startsWith("python")) {
    return false;
  }
  return map.has(trimmed) || map.has(lower) || map.has(normalized) || !!KNOWN_CLAUDE_TOOLS2[lower];
}
function convertGoogleResponse(googleResp, modelName = "gemini-2.5-flash", openaiBody) {
  const candidate = googleResp.response?.candidates?.[0] || googleResp.candidates?.[0] || googleResp.result?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const textParts = [];
  const reasoningParts = [];
  const toolCalls = [];
  const toolNameMap = extractToolNameMap2(openaiBody);
  for (const p of parts) {
    if (p.text) {
      const clean = sanitizeGoogleOutputText2(p.text);
      if (clean) {
        if (p.thought) {
          reasoningParts.push(clean);
        } else {
          textParts.push(clean);
        }
      }
    }
    if (p.functionCall?.name && isDeclaredTool2(p.functionCall.name, toolNameMap)) {
      const exactName = restoreToolName2(p.functionCall.name, toolNameMap);
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: exactName,
          arguments: JSON.stringify(p.functionCall.args || {})
        }
      });
    }
  }
  let text = textParts.join("");
  const reasoningText = reasoningParts.join("");
  if (!text && !toolCalls.length) {
    if (typeof candidate?.message?.content === "string") text = sanitizeGoogleOutputText2(candidate.message.content);
    else if (typeof googleResp.response?.reply === "string") text = sanitizeGoogleOutputText2(googleResp.response.reply);
    else if (typeof googleResp.reply === "string") text = sanitizeGoogleOutputText2(googleResp.reply);
    else if (typeof googleResp.response?.message === "string") text = sanitizeGoogleOutputText2(googleResp.response.message);
    else if (typeof googleResp.message === "string") text = sanitizeGoogleOutputText2(googleResp.message);
    else if (typeof googleResp.response === "string") text = sanitizeGoogleOutputText2(googleResp.response);
    else if (Array.isArray(googleResp.predictions) && googleResp.predictions[0]) {
      text = typeof googleResp.predictions[0] === "string" ? sanitizeGoogleOutputText2(googleResp.predictions[0]) : JSON.stringify(googleResp.predictions[0]);
    }
  }
  const message = { role: "assistant", content: text || (toolCalls.length ? null : "") };
  if (reasoningText) {
    message.reasoning_content = reasoningText;
  }
  if (toolCalls.length) {
    message.tool_calls = toolCalls;
  }
  const usageMeta = googleResp.response?.usageMetadata || googleResp.usageMetadata || googleResp.result?.usageMetadata;
  return json({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1e3),
    model: modelName || googleResp.modelVersion || "gemini-2.5-flash",
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length ? "tool_calls" : candidate?.finishReason?.toLowerCase() || "stop"
    }],
    usage: {
      prompt_tokens: usageMeta?.promptTokenCount || 0,
      completion_tokens: usageMeta?.candidatesTokenCount || 0,
      total_tokens: usageMeta?.totalTokenCount || 0
    }
  }, 200);
}
function streamGoogleResponse(upstream, modelName = "gemini-2.0-flash", openaiBody) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toolNameMap = extractToolNameMap2(openaiBody);
  (async () => {
    try {
      const reader = upstream.body?.getReader();
      if (!reader) {
        await writer.close();
        return;
      }
      let buffer = "";
      let toolIndex = 0;
      const chatId = `chatcmpl-${Date.now()}`;
      const effectiveModel = modelName || "gemini-2.0-flash";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let startIdx = 0;
        while (startIdx < buffer.length) {
          const objStart = buffer.indexOf("{", startIdx);
          if (objStart === -1) break;
          let braceCount = 0;
          let objEnd = -1;
          for (let i = objStart; i < buffer.length; i++) {
            if (buffer[i] === "{") braceCount++;
            if (buffer[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                objEnd = i + 1;
                break;
              }
            }
          }
          if (objEnd !== -1) {
            const chunk = buffer.substring(objStart, objEnd);
            try {
              const googleChunk = JSON.parse(chunk);
              const candidate = googleChunk.response?.candidates?.[0] || googleChunk.candidates?.[0] || googleChunk.result?.candidates?.[0];
              if (candidate) {
                const parts = candidate?.content?.parts || [];
                for (const p of parts) {
                  if (p.text) {
                    const cleanText = sanitizeGoogleOutputText2(p.text);
                    if (cleanText) {
                      const delta = p.thought ? { reasoning_content: cleanText } : { content: cleanText };
                      await writer.write(encoder.encode(`data: ${JSON.stringify({
                        id: chatId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1e3),
                        model: effectiveModel,
                        choices: [{ index: 0, delta, finish_reason: null }]
                      })}

`));
                    }
                  }
                }
                for (const p of parts) {
                  if (p.functionCall?.name && isDeclaredTool2(p.functionCall.name, toolNameMap)) {
                    const exactName = restoreToolName2(p.functionCall.name, toolNameMap);
                    await writer.write(encoder.encode(`data: ${JSON.stringify({
                      id: chatId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1e3),
                      model: effectiveModel,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolIndex++,
                            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                            type: "function",
                            function: {
                              name: exactName,
                              arguments: JSON.stringify(p.functionCall.args || {})
                            }
                          }]
                        },
                        finish_reason: null
                      }]
                    })}

`));
                  }
                }
                if (candidate?.finishReason) {
                  const hasTool = parts.some((p) => p.functionCall);
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1e3),
                    model: effectiveModel,
                    choices: [{ index: 0, delta: {}, finish_reason: hasTool ? "tool_calls" : candidate.finishReason.toLowerCase() }]
                  })}

`));
                }
              } else if (googleChunk.response?.reply || googleChunk.reply || googleChunk.response?.message || googleChunk.message) {
                const directText = sanitizeGoogleOutputText2(googleChunk.response?.reply || googleChunk.reply || googleChunk.response?.message || googleChunk.message || "");
                if (directText) {
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1e3),
                    model: effectiveModel,
                    choices: [{ index: 0, delta: { content: directText }, finish_reason: null }]
                  })}

`));
                }
              }
              const usageMeta = googleChunk.response?.usageMetadata || googleChunk.usageMetadata || googleChunk.result?.usageMetadata;
              if (usageMeta) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1e3),
                  model: effectiveModel,
                  choices: [],
                  usage: {
                    prompt_tokens: usageMeta.promptTokenCount || 0,
                    completion_tokens: usageMeta.candidatesTokenCount || 0,
                    total_tokens: usageMeta.totalTokenCount || 0
                  }
                })}

`));
              }
            } catch (e) {
            }
            startIdx = objEnd;
          } else {
            break;
          }
        }
        buffer = buffer.substring(startIdx);
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {
      }
    }
  })();
  return new Response(readable, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
  });
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
function getDistDir() {
  const candidates = [
    path3.resolve(process.cwd(), "./dist"),
    path3.resolve(__dirname, "./dist"),
    path3.resolve(__dirname, "../dist")
  ];
  for (const c of candidates) {
    if (fs3.existsSync(c)) return c;
  }
  return path3.resolve(process.cwd(), "./dist");
}
var PORT = parseInt(process.env.PORT || "3000", 10);
var HOST = process.env.HOST || "0.0.0.0";
var DIST_DIR = getDistDir();
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8"
};
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-provider-key, x-provider-cookie, x-auth-mode, anthropic-version, openai-organization"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
}
async function handleWebRequest(req, res, handler2) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${protocol}://${host}`);
  const method = (req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  let body;
  if (hasBody) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    body = new Uint8Array(Buffer.concat(chunks));
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) {
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, v);
      }
    }
  }
  const webReq = new Request(url.toString(), {
    method,
    headers,
    body,
    // @ts-ignore
    duplex: "half"
  });
  const webRes = await handler2(webReq);
  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => {
    res.setHeader(k, v);
  });
  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } else {
    res.end();
  }
}
function serveStaticFile(req, res, filePath) {
  try {
    const stat = fs3.statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = path3.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else if (filePath.includes("/assets/") || filePath.includes("\\assets\\")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    const stream = fs3.createReadStream(filePath);
    stream.pipe(res);
    return true;
  } catch {
    return false;
  }
}
var server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  const rawUrl = req.url || "/";
  const [pathname, qs = ""] = rawUrl.split("?");
  const query = new URLSearchParams(qs);
  try {
    if (pathname === "/api/ping" || pathname === "/health" || pathname === "/ping") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, status: "healthy", timestamp: Date.now() }));
      return;
    }
    if (pathname.startsWith("/api/v1") || pathname.startsWith("/v1")) {
      let subPath = query.get("__p") || "";
      if (!subPath) {
        subPath = pathname.replace(/^\/(?:api\/)?v1\/?/, "");
      }
      const core = toCoreRequest(req, subPath, query);
      const result = await handleGateway(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }
    if (pathname.startsWith("/api/proxy")) {
      await handleWebRequest(req, res, handler);
      return;
    }
    if (pathname.startsWith("/api/keys")) {
      const core = toCoreRequest(req, "", query);
      const result = await handleKeys(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }
    if (pathname.startsWith("/api/data")) {
      const core = toCoreRequest(req, "", query);
      const result = await handleData(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }
    if (pathname.startsWith("/api/oauth")) {
      const subPath = pathname.replace(/^\/api\/oauth\/?/, "");
      const core = toCoreRequest(req, subPath, query);
      const result = await handleOAuth(core);
      await sendCoreResponse(res, result);
      return;
    }
    if (pathname.startsWith("/api/backup")) {
      const core = toCoreRequest(req, "", query);
      const result = await handleBackup(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }
    if (fs3.existsSync(DIST_DIR)) {
      const safePath = path3.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, "");
      const fullPath = path3.join(DIST_DIR, safePath);
      if (safePath !== "/" && fs3.existsSync(fullPath) && fs3.statSync(fullPath).isFile()) {
        if (serveStaticFile(req, res, fullPath)) return;
      }
      const indexPath = path3.join(DIST_DIR, "index.html");
      if (fs3.existsSync(indexPath)) {
        serveStaticFile(req, res, indexPath);
        return;
      }
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    sendError(res, err);
  }
});
server.listen(PORT, HOST, () => {
  console.log(`> AI Provider Hub Server running at http://${HOST}:${PORT}`);
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server...");
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("SIGINT received, closing server...");
  server.close(() => process.exit(0));
});
