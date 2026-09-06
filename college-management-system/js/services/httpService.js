/**
 * httpService.js — Shared authenticated HTTP helpers for real backend services.
 * -----------------------------------------------------------------------------
 * Every real feature service (announcements, question papers, notifications,
 * dashboard, profile) uses these helpers so we never scatter fetch calls or the
 * token/error boilerplate across the codebase.
 *
 * Returns { ok, ... } result objects (never throws) so pages can render
 * loading/empty/error/retry states — NO mock fallback, NO localStorage.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

/** Resolve a Firebase ID token or a structured error result. */
async function token() {
  if (!ENV.AUTH_USE_BACKEND) return { t: null, err: { ok: false, error: 'Backend disabled.', status: 0 } };
  const t = await getIdToken();
  if (!t) return { t: null, err: { ok: false, error: 'Not authenticated.', status: 401 } };
  return { t, err: null };
}

/**
 * Authenticated JSON request. Returns { ok:true, ...data } or
 * { ok:false, error, status }.
 */
export async function apiCall(path, opts = {}) {
  const { t, err } = await token();
  if (err) return err;
  try {
    const res = await authedRequest(path, t, opts);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Request failed.', status: e?.status };
  }
}
