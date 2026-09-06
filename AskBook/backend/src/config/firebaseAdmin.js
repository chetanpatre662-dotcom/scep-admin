/**
 * config/firebaseAdmin.js
 * -----------------------------------------------------------------------------
 * Firebase Admin SDK initialization for the BACKEND only.
 *
 * Credentials (project id, client email, private key) are read exclusively from
 * environment variables via config/env.js. They are SECRETS and must never be
 * hard-coded here or shipped to the frontend.
 *
 * This is the ONLY place the Firebase Admin SDK is initialized. The auth
 * middleware imports `verifyIdToken` from here to validate incoming tokens.
 * -----------------------------------------------------------------------------
 */
'use strict';

const admin = require('firebase-admin');
const { env } = require('./env');

let initialized = false;
let initError = null;

/**
 * Initialize the Firebase Admin app exactly once, using credentials from env.
 * Returns a structured result instead of throwing so server startup can decide
 * how to handle a missing/invalid configuration.
 * @returns {{ok: boolean, error?: string, projectId?: string}}
 */
function initFirebaseAdmin() {
  if (initialized) {
    return { ok: true, projectId: env.firebase.projectId };
  }
  if (initError) {
    return { ok: false, error: initError };
  }

  if (!env.firebase.isConfigured) {
    initError =
      'Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, ' +
      'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in backend/.env.';
    return { ok: false, error: initError };
  }

  try {
    // Guard against double init if the SDK was already initialized elsewhere.
    if (admin.apps.length === 0) {
      const opts = {
        credential: admin.credential.cert({
          projectId: env.firebase.projectId,
          clientEmail: env.firebase.clientEmail,
          privateKey: env.firebase.privateKey,
        }),
      };
      // Attach the Cloud Storage bucket when configured (Half B).
      if (env.firebase.storageBucket) opts.storageBucket = env.firebase.storageBucket;
      admin.initializeApp(opts);
    }
    initialized = true;
    return { ok: true, projectId: env.firebase.projectId };
  } catch (err) {
    initError = err.message;
    return { ok: false, error: err.message };
  }
}

/** Whether a Storage bucket is configured. */
function isStorageEnabled() {
  return Boolean(env.firebase.storageBucket);
}

/**
 * Get the Firebase Cloud Storage bucket handle. Ensures Admin is initialized.
 * Throws if Storage is not configured.
 */
function getBucket() {
  if (!env.firebase.storageBucket) {
    throw new Error('Firebase Storage bucket is not configured (FIREBASE_STORAGE_BUCKET).');
  }
  if (!initialized) {
    const r = initFirebaseAdmin();
    if (!r.ok) throw new Error(`Firebase Admin not initialized: ${r.error}`);
  }
  return admin.storage().bucket(env.firebase.storageBucket);
}

/** Whether Firebase Admin has been successfully initialized. */
function isInitialized() {
  return initialized;
}

/**
 * Verify a Firebase ID token. Ensures the SDK is initialized first.
 * Throws if the SDK is not configured or the token is invalid — callers
 * (the auth middleware) translate that into a 401.
 * @param {string} idToken
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken>}
 */
async function verifyIdToken(idToken) {
  if (!initialized) {
    const result = initFirebaseAdmin();
    if (!result.ok) {
      throw new Error(`Firebase Admin not initialized: ${result.error}`);
    }
  }
  return admin.auth().verifyIdToken(idToken);
}

/**
 * Delete a Firebase Authentication user by UID (server-side, Admin SDK).
 * Ensures the SDK is initialized first. Treats "user not found" as success
 * (idempotent) since the goal is that the account no longer exists.
 *
 * @param {string} uid - Firebase UID to delete
 * @returns {Promise<{ok: boolean, alreadyAbsent?: boolean, error?: string}>}
 */
async function deleteFirebaseUser(uid) {
  if (!uid) return { ok: false, error: 'No UID provided.' };
  if (!initialized) {
    const result = initFirebaseAdmin();
    if (!result.ok) {
      return { ok: false, error: `Firebase Admin not initialized: ${result.error}` };
    }
  }
  try {
    await admin.auth().deleteUser(uid);
    return { ok: true };
  } catch (err) {
    // If the user is already gone, that satisfies the delete intent.
    if (err && err.code === 'auth/user-not-found') {
      return { ok: true, alreadyAbsent: true };
    }
    return { ok: false, error: err.message };
  }
}

module.exports = { admin, initFirebaseAdmin, isInitialized, verifyIdToken, deleteFirebaseUser, isStorageEnabled, getBucket };
