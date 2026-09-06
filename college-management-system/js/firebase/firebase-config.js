/**
 * firebase-config.js
 * -----------------------------------------------------------------------------
 * Firebase Web App configuration + single app/auth initialization.
 *
 * This is the ONLY place Firebase is initialized in the entire project.
 * Every other module imports { auth } (or the SDK helpers) from here or from
 * ./auth.js — there must be no second initializeApp() call anywhere.
 *
 * SETUP (do this once):
 *   1. Go to Firebase Console -> Project settings -> "Your apps" -> Web app.
 *   2. Copy the firebaseConfig object it generates.
 *   3. Paste the values into the placeholders below (replace the PASTE_… strings).
 *
 * SECURITY NOTE:
 *   These Web config values are NOT secrets — they only identify your Firebase
 *   project to Google's servers and are safe to ship in frontend code.
 *   Do NOT place service-account keys, the Firebase Admin SDK, database
 *   passwords, or any private credentials in this (or any) frontend file.
 * -----------------------------------------------------------------------------
 */

// Firebase modular Web SDK via the official CDN (no npm / no bundler required).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

/* =============================================================================
   FIREBASE WEB APP CONFIGURATION
   Values below come from the Firebase Console (Project settings -> Your apps).
   These are Web config identifiers (NOT secrets) and are safe in frontend code.
   ============================================================================= */
const firebaseConfig = {
  apiKey: 'AIzaSyCLfNw8FwF13lmK4p1Zl85h-HaIhniPxuA',
  authDomain: 'college-94cd7.firebaseapp.com',
  projectId: 'college-94cd7',
  storageBucket: 'college-94cd7.firebasestorage.app',
  messagingSenderId: '523805859918',
  appId: '1:523805859918:web:25245a254189beb4d2a31f',
  measurementId: 'G-M4SER82Z5L', // optional (Analytics) — not used by Auth
};
/* ========================= END OF CONFIG ==================================== */

/**
 * Detects whether the required config values are real (not placeholders/empty),
 * so the UI can show a helpful message instead of a cryptic Firebase error
 * before setup is done. Only the keys Auth actually needs are required;
 * measurementId is optional.
 */
export function isFirebaseConfigured() {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId'];
  const isPlaceholder = (v) =>
    typeof v !== 'string' ||
    v.trim() === '' ||
    v.startsWith('PASTE_') ||
    v.startsWith('YOUR_');
  return required.every((key) => !isPlaceholder(firebaseConfig[key]));
}

// Initialize exactly once and export the shared instances.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Reusable Google provider (identity only — no scopes beyond default profile).
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export { app, auth, googleProvider, firebaseConfig };
