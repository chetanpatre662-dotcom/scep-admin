/**
 * services/catalogService.js — read-only academic catalog client.
 * -----------------------------------------------------------------------------
 * Any authenticated user can read the catalog (Courses + Branches) for
 * dropdowns/explorers. Admin writes live in adminService.js. Real backend only.
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

/** GET /api/catalog/courses */
export async function getCatalogCourses() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/catalog/courses', token, { method: 'GET' });
    return { ok: true, courses: Array.isArray(res?.courses) ? res.courses : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load courses.', status: e?.status };
  }
}

/** GET /api/catalog/courses/:id/branches */
export async function getCatalogBranches(courseId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/catalog/courses/${encodeURIComponent(courseId)}/branches`, token, { method: 'GET' });
    return { ok: true, branches: Array.isArray(res?.branches) ? res.branches : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load branches.', status: e?.status };
  }
}
