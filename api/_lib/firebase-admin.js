// Firebase Admin SDK singleton. Initialized once from the FIREBASE_SERVICE_ACCOUNT
// env var (the full service-account JSON, single line). Every backend route
// imports getDb()/getAdminAuth() from here so we never re-init the app.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
var app;
function init() {
    if (app)
        return app;
    var existing = getApps();
    if (existing.length) {
        app = existing[0];
        return app;
    }
    var raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set. Paste the service-account JSON into your env (see .env.example).");
    }
    var creds;
    try {
        creds = JSON.parse(raw);
    }
    catch (_a) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON. It must be the entire service-account file on one line.");
    }
    // Vercel/dotenv often escape newlines in the private key as literal "\n".
    // Firebase needs real newlines, so normalize them back.
    if (typeof creds.private_key === "string") {
        creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    app = initializeApp({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        credential: cert(creds),
    });
    return app;
}
export function getDb() {
    return getFirestore(init());
}
export function getAdminAuth() {
    return getAuth(init());
}
