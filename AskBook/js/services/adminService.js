/**
 * services/adminService.js — Admin user-management API client (real backend).
 * -----------------------------------------------------------------------------
 * Talks to the admin-only backend endpoints. Every call attaches the current
 * Firebase ID token; the backend independently verifies the token AND the
 * caller's PostgreSQL role='admin' (requireAuth + requireAdmin). The frontend
 * never sends a role — role transitions are fixed by the endpoint.
 *
 * These functions return { ok, ... } result objects (never throw) so the UI can
 * render proper loading/error/empty states instead of crashing.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

/** Resolve a fresh Firebase ID token, or a structured 401-style error. */
async function withToken() {
  if (!ENV.AUTH_USE_BACKEND) {
    return { token: null, error: { ok: false, error: 'Backend is disabled.', status: 0 } };
  }
  const token = await getIdToken();
  if (!token) return { token: null, error: { ok: false, error: 'Not authenticated.', status: 401 } };
  return { token, error: null };
}

/**
 * GET /api/admin/stats — dashboard counts.
 * @returns {Promise<{ok:boolean, stats?:object, error?:string, status?:number}>}
 */
export async function getAdminStats() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/stats', token, { method: 'GET' });
    return { ok: true, stats: res?.stats || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to load statistics.', status: e?.status };
  }
}

/**
 * GET /api/admin/users — full user list with profiles.
 * @returns {Promise<{ok:boolean, users?:object[], error?:string, status?:number}>}
 */
export async function getAdminUsers() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/users', token, { method: 'GET' });
    return { ok: true, users: Array.isArray(res?.users) ? res.users : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to load users.', status: e?.status };
  }
}

/** PATCH /api/admin/users/:id/approve-faculty — student -> faculty. */
export async function approveFaculty(userId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/users/${encodeURIComponent(userId)}/approve-faculty`, token, { method: 'PATCH' });
    return { ok: true, changed: res?.changed, user: res?.user, message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not approve faculty.', status: e?.status };
  }
}

/** PATCH /api/admin/users/:id/make-admin — faculty -> admin. */
export async function makeAdmin(userId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/users/${encodeURIComponent(userId)}/make-admin`, token, { method: 'PATCH' });
    return { ok: true, changed: res?.changed, user: res?.user, message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not promote user.', status: e?.status };
  }
}

/** PATCH /api/admin/users/:id/approve-admin — approve a pending/rejected admin applicant. */
export async function approveAdmin(userId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/users/${encodeURIComponent(userId)}/approve-admin`, token, { method: 'PATCH' });
    return { ok: true, changed: res?.changed, user: res?.user, message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not approve admin.', status: e?.status };
  }
}

/** PATCH /api/admin/users/:id/remove-admin — admin -> faculty (no delete). */
export async function removeAdmin(userId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/users/${encodeURIComponent(userId)}/remove-admin`, token, { method: 'PATCH' });
    return { ok: true, changed: res?.changed, user: res?.user, message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not remove admin role.', status: e?.status };
  }
}

/** PATCH /api/admin/users/:id/reject — reject a pending faculty/admin applicant. */
export async function rejectUser(userId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/users/${encodeURIComponent(userId)}/reject`, token, { method: 'PATCH' });
    return { ok: true, changed: res?.changed, user: res?.user, message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not reject applicant.', status: e?.status };
  }
}

/** DELETE /api/admin/users/:id — delete user (PostgreSQL + Firebase Auth). */
export async function deleteUser(userId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/users/${encodeURIComponent(userId)}`, token, { method: 'DELETE' });
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not delete user.', status: e?.status };
  }
}

/* ------------------------------------------------------------------ */
/* Admin subject management (Course + Branch + Semester)               */
/* ------------------------------------------------------------------ */

/** GET /api/admin/subjects?program=&branch=&semester= */
export async function listSubjects({ program, branch, semester }) {
  const { token, error } = await withToken();
  if (error) return error;
  const qs = new URLSearchParams({ program, branch, semester: String(semester) }).toString();
  try {
    const res = await authedRequest(`/admin/subjects?${qs}`, token, { method: 'GET' });
    return { ok: true, subjects: Array.isArray(res?.subjects) ? res.subjects : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load subjects.', status: e?.status };
  }
}

/** POST /api/admin/subjects — { name, code?, description?, program, branch, semester } */
export async function createSubject(data) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/subjects', token, { method: 'POST', body: data });
    return { ok: true, subject: res?.subject || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not add subject.', status: e?.status };
  }
}

/** PATCH /api/admin/subjects/:id — { name?, code?, description? } */
export async function updateSubject(id, data) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/subjects/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: data });
    return { ok: true, subject: res?.subject || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not update subject.', status: e?.status };
  }
}

/** DELETE /api/admin/subjects/:id */
export async function deleteSubject(id) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/subjects/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
    return { ok: true, subject: res?.subject || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not delete subject.', status: e?.status };
  }
}

/** POST /api/admin/subjects/bulk — { program, branch, semester, subjects:[...] } */
export async function createSubjectsBulk(data) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/subjects/bulk', token, { method: 'POST', body: data });
    return { ok: true, created: Array.isArray(res?.created) ? res.created : [], message: res?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not add subjects.', status: e?.status };
  }
}

/* ------------------------------------------------------------------ */
/* Academic catalog (Courses + Branches) — admin writes                */
/* ------------------------------------------------------------------ */

/** GET /api/admin/courses */
export async function getCourses() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/courses', token, { method: 'GET' });
    return { ok: true, courses: Array.isArray(res?.courses) ? res.courses : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load courses.', status: e?.status };
  }
}

/** POST /api/admin/courses — { name, code?, totalSemesters? } */
export async function createCourse(data) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/courses', token, { method: 'POST', body: data });
    return { ok: true, course: res?.course || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not add course.', status: e?.status };
  }
}

/** GET /api/admin/courses/:id/branches */
export async function getBranches(courseId) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/courses/${encodeURIComponent(courseId)}/branches`, token, { method: 'GET' });
    return { ok: true, branches: Array.isArray(res?.branches) ? res.branches : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load branches.', status: e?.status };
  }
}

/** POST /api/admin/courses/:id/branches — { name } */
export async function createBranch(courseId, data) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/courses/${encodeURIComponent(courseId)}/branches`, token, { method: 'POST', body: data });
    return { ok: true, branch: res?.branch || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not add branch.', status: e?.status };
  }
}

/* ------------------------------------------------------------------ */
/* Classes (real DB) — admin list/delete/filter                        */
/* ------------------------------------------------------------------ */

/** GET /api/admin/classes?program=&branch=&semester=&facultyId= */
export async function getAdminClasses(filter = {}) {
  const { token, error } = await withToken();
  if (error) return error;
  const params = new URLSearchParams();
  if (filter.program) params.set('program', filter.program);
  if (filter.branch) params.set('branch', filter.branch);
  if (filter.semester) params.set('semester', String(filter.semester));
  if (filter.facultyId) params.set('facultyId', String(filter.facultyId));
  const qs = params.toString();
  try {
    const res = await authedRequest(`/admin/classes${qs ? '?' + qs : ''}`, token, { method: 'GET' });
    return { ok: true, classes: Array.isArray(res?.classes) ? res.classes : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load classes.', status: e?.status };
  }
}

/** GET /api/admin/classes/faculty-options */
export async function getClassFacultyOptions() {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest('/admin/classes/faculty-options', token, { method: 'GET' });
    return { ok: true, faculty: Array.isArray(res?.faculty) ? res.faculty : [] };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load faculty options.', status: e?.status };
  }
}

/** DELETE /api/admin/classes/:id */
export async function deleteAdminClass(id) {
  const { token, error } = await withToken();
  if (error) return error;
  try {
    const res = await authedRequest(`/admin/classes/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not delete class.', status: e?.status };
  }
}
