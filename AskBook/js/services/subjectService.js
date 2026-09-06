/**
 * services/subjectService.js — Subject read client for Student & Faculty panels.
 * -----------------------------------------------------------------------------
 * Real backend only (no mock). Attaches the Firebase ID token; the backend
 * derives/authorizes the academic scope:
 *   - Student: subjects for the student's OWN Course+Branch+Semester (server
 *     reads the profile; the client cannot request another group).
 *   - Faculty: subjects for a chosen Course+Branch+Semester (faculty/admin only).
 *
 * Returns { ok, ... } result objects (never throws) for clean UI states.
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

/**
 * GET /api/students/subjects — subjects for the logged-in student's own group.
 * @returns {Promise<{ok:boolean, subjects?:object[], context?:object, error?:string, status?:number}>}
 */
export async function getMySubjects() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/students/subjects', token, { method: 'GET' });
    return { ok: true, subjects: Array.isArray(res?.subjects) ? res.subjects : [], context: res?.context || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load your subjects.', status: e?.status };
  }
}

/**
 * GET /api/faculty/subjects?program=&branch=&semester= — subjects for a chosen
 * Course + Branch + Semester (faculty/admin).
 */
export async function getFacultySubjects({ program, branch, semester }) {
  const { token, error } = await withToken();
  if (error) return error;
  const qs = new URLSearchParams({ program, branch, semester: String(semester) }).toString();
  try {
    const res = await authedRequest(`/faculty/subjects?${qs}`, token, { method: 'GET' });
    return { ok: true, subjects: Array.isArray(res?.subjects) ? res.subjects : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load subjects.', status: e?.status };
  }
}
