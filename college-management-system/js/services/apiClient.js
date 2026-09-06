/**
 * apiClient.js — Low-level authenticated HTTP client for the real backend.
 *
 * Exposes authedRequest (JSON) and authedUpload (multipart) which attach the
 * Firebase ID token. All feature services build on these; there is no mock path.
 */
import { ENV } from '../config.js';

/**
 * Low-level fetch wrapper against the backend. Used by the authenticated
 * helpers below. Throws an Error with `.status` and `.data` on non-2xx so
 * callers can inspect the response.
 */
async function rawRequest(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(`${ENV.API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }

  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Authenticated request: attaches `Authorization: Bearer <firebaseIdToken>`.
 * All feature services go through this (gated by ENV.AUTH_USE_BACKEND).
 *
 * @param {string} path - path under ENV.API_BASE_URL (e.g. '/auth/sync')
 * @param {string} idToken - Firebase ID token (obtained from the Firebase user)
 * @param {object} [opts] - { method, body, headers }
 */
export async function authedRequest(path, idToken, { method = 'GET', body, headers } = {}) {
  if (!idToken) {
    const err = new Error('authedRequest called without a Firebase ID token.');
    err.status = 401;
    throw err;
  }
  return rawRequest(path, {
    method,
    body,
    headers: { Authorization: `Bearer ${idToken}`, ...headers },
  });
}

/**
 * Authenticated multipart upload: sends a FormData body (file + fields) with
 * the Firebase token. Does NOT set Content-Type — the browser adds the correct
 * multipart boundary automatically. Throws with `.status`/`.data` on non-2xx.
 *
 * @param {string} path - path under ENV.API_BASE_URL
 * @param {string} idToken - Firebase ID token
 * @param {FormData} formData - the multipart payload (must include the file)
 * @param {object} [opts] - { method = 'POST' }
 */
export async function authedUpload(path, idToken, formData, { method = 'POST' } = {}) {
  if (!idToken) {
    const err = new Error('authedUpload called without a Firebase ID token.');
    err.status = 401;
    throw err;
  }
  const res = await fetch(`${ENV.API_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${idToken}` }, // no Content-Type: browser sets boundary
    body: formData,
  });
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Upload failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
