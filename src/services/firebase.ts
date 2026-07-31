// Firebase Web SDK — client-side auth only. Config comes from VITE_FIREBASE_*
// env vars (safe to expose; these identify the project, they aren't secrets).
// All DATA access goes through our backend (/api/data) via the Admin SDK — the
// client never talks to Firestore directly.
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (!firebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Set VITE_FIREBASE_* in your .env (see .env.example)."
    );
  }
  if (!app) app = initializeApp(config);
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
}
