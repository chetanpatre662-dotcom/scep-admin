/**
 * profileApiService.js — Self-service profile view/edit client (real backend).
 * -----------------------------------------------------------------------------
 * Talks to GET /api/profile/me and PATCH /api/profile/me. The backend derives
 * the user's identity from the verified Firebase token — the frontend NEVER
 * sends a user id, so one user can never edit another's profile.
 *
 * Returns { ok, ... } result objects (never throws) per project convention.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

async function withToken() {
  if (!ENV.AUTH_USE_BACKEND) return { token: null, error: { ok: false, error: 'Backend is disabled.', status: 0 } };
  const token = await getIdToken();
  if (!token) return { token: null, error: { ok: false, error: 'Not authenticated.', status: 401 } };
  return { token, error: null };
}

/** GET /api/profile/me — the current user's editable profile. */
export async function getMyProfile() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/profile/me', token, { method: 'GET' });
    return { ok: true, profile: res?.profile || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load your profile.', status: e?.status };
  }
}

/**
 * PATCH /api/profile/me — update the current user's own profile.
 * @param {object} data role-appropriate editable fields (see backend).
 */
export async function updateMyProfile(data) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/profile/me', token, { method: 'PATCH', body: data });
    return { ok: true, profile: res?.profile || null, message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not save your profile.', status: e?.status };
  }
}
