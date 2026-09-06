/**
 * firebase/auth.js
 * -----------------------------------------------------------------------------
 * Thin wrapper around the Firebase Authentication SDK.
 *
 * This module is the ONLY place that imports Firebase Auth SDK functions.
 * The rest of the app talks to services/authService.js, which in turn calls
 * these helpers. Keeping the SDK isolated here means:
 *   - UI code never touches Firebase directly.
 *   - Swapping SDK versions or adding providers happens in one file.
 *
 * No user identities, UIDs, emails or passwords are stored here. Firebase
 * Authentication is the source of truth for identity; every UID is generated
 * by Firebase and read back dynamically via the returned user objects.
 * -----------------------------------------------------------------------------
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

import { auth, googleProvider, isFirebaseConfigured } from './firebase-config.js';

export { auth, isFirebaseConfigured };

/**
 * Choose how long the session survives.
 * remember=true  -> persists across browser restarts (local persistence)
 * remember=false -> cleared when the tab/window closes (session persistence)
 */
export async function applyPersistence(remember) {
  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence
  );
}

export function createEmailUser(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signInEmailUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signInGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function setDisplayName(user, displayName) {
  return updateProfile(user, { displayName });
}

/**
 * Get a Firebase ID token for the currently authenticated user.
 * Returns null if no user is signed in. Firebase refreshes the token
 * automatically when needed; pass forceRefresh=true to force a new one.
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<string|null>}
 */
export async function getIdToken(forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

/**
 * Subscribe to Firebase auth state changes.
 * @param {(user: import('firebase/auth').User|null) => void} callback
 * @returns {Function} unsubscribe
 */
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ------------------------------------------------------------------ */
/* Phone OTP (approval flow)                                           */
/* ------------------------------------------------------------------ */
/**
 * Phone OTP is used ONLY to prove possession of an approver's / bootstrap
 * phone during account approval. It runs on a SEPARATE, isolated Firebase app
 * instance so it never disturbs the primary session (the pending applicant
 * stays signed in on `auth`). The resulting phone-auth ID token is sent to the
 * backend, which re-verifies it and compares the verified phone_number against
 * the selected approver's DB phone (or the configured bootstrap phone).
 *
 * The applicant NEVER supplies a phone number to the backend — only the
 * approver's id + the phone-auth token.
 */
let _otpApp = null;
let _otpAuth = null;
let _recaptchaVerifier = null; // track active verifier for cleanup

async function getOtpAuth() {
  if (_otpAuth) return _otpAuth;
  const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
  const { getAuth } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js');
  const { firebaseConfig } = await import('./firebase-config.js');
  const NAME = 'otp-approval';
  const existing = getApps().find((a) => a.name === NAME);
  _otpApp = existing || initializeApp(firebaseConfig, NAME);
  _otpAuth = getAuth(_otpApp);
  return _otpAuth;
}

/**
 * Build an invisible reCAPTCHA verifier bound to a container element id.
 * Firebase requires an App Check / reCAPTCHA for phone auth.
 * @param {string} containerId - id of an (empty) DOM element
 * @returns {Promise<RecaptchaVerifier>}
 */
export async function makeRecaptcha(containerId) {
  const otpAuth = await getOtpAuth();
  // Clear any previous verifier before creating a new one — Firebase throws
  // if a verifier is re-created on the same element without clearing first.
  if (_recaptchaVerifier) {
    try { _recaptchaVerifier.clear(); } catch { /* ignore if already cleared */ }
    _recaptchaVerifier = null;
  }
  _recaptchaVerifier = new RecaptchaVerifier(otpAuth, containerId, { size: 'invisible' });
  await _recaptchaVerifier.render();
  return _recaptchaVerifier;
}

/**
 * Send an OTP to a phone number (E.164). Returns a confirmation handle whose
 * .confirm(code) resolves to a phone-auth credential. The phone number here is
 * NOT chosen by the user — the caller passes the selected approver's number
 * that the BACKEND already validated/returned context for. (In this app the
 * backend re-verifies the resulting token against the approver's DB phone, so
 * even a tampered number cannot approve an account.)
 * @param {string} e164Phone
 * @param {RecaptchaVerifier} verifier
 */
export async function sendPhoneOtp(e164Phone, verifier) {
  const otpAuth = await getOtpAuth();
  return signInWithPhoneNumber(otpAuth, e164Phone, verifier);
}

/**
 * Confirm the OTP code and return the phone-auth ID token (to send to the
 * backend). Signs OUT of the isolated OTP app immediately afterwards so no
 * lingering phone session remains. The primary `auth` session is untouched.
 * @param {import('firebase/auth').ConfirmationResult} confirmation
 * @param {string} code
 * @returns {Promise<string>} phone-auth ID token
 */
export async function confirmPhoneOtp(confirmation, code) {
  const cred = await confirmation.confirm(code);
  const token = await cred.user.getIdToken();
  // Clear the verifier so a fresh one can be created if needed.
  if (_recaptchaVerifier) {
    try { _recaptchaVerifier.clear(); } catch { /* ignore */ }
    _recaptchaVerifier = null;
  }
  try { await getOtpAuth().then((a) => a.signOut()); } catch { /* ignore */ }
  return token;
}
