import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | undefined;

function init(): App {
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
      path.resolve(process.cwd(), "data/service-account.json"),
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
      // ignore
    }
  }

  if (raw) {
    let creds: Record<string, unknown>;
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
      credential: cert(creds as any),
      projectId: (creds.project_id as string) || process.env.VITE_FIREBASE_PROJECT_ID,
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

export function getDb(): Firestore {
  return getFirestore(init());
}

export function getAdminAuth(): Auth {
  return getAuth(init());
}

export function isFirebaseAdminReady(): boolean {
  try {
    init();
    return true;
  } catch {
    return false;
  }
}
