/**
 * aiDocumentsService.js — Admin AI document management client (FRONTEND).
 * -----------------------------------------------------------------------------
 * REST client for the admin-only AI knowledge-base document endpoints. Upload
 * uses multipart (authedUpload); the rest use authedRequest. Identity + admin
 * authorization are enforced server-side (requireAuth + requireAdmin) — the
 * client never sends a role/userId. Returns { ok, ... } (never throws).
 *
 * The Gemini API key is never involved here; only Askbook backend calls.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest, authedUpload } from './apiClient.js';

async function tk() {
  if (!ENV.AUTH_USE_BACKEND) return { t: null, err: { ok: false, error: 'Backend disabled.', status: 0 } };
  let t = null;
  try { t = await getIdToken(); } catch { t = null; }
  if (!t) return { t: null, err: { ok: false, error: 'Not authenticated.', status: 401 } };
  return { t, err: null };
}

async function call(path, opts = {}) {
  const { t, err } = await tk();
  if (err) return err;
  try {
    const res = await authedRequest(path, t, opts);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Request failed.', status: e?.status };
  }
}

/** List all AI documents + their indexing status (admin). */
export function listDocuments() {
  return call('/ai/documents', { method: 'GET' });
}

/**
 * Upload + index a PDF/DOCX/TXT document.
 * @param {object} p
 * @param {File}   p.file
 * @param {string} p.title
 * @param {string} p.accessScope 'public' | 'class'
 * @param {string} [p.program] @param {string} [p.branch] @param {number} [p.semester] @param {number} [p.classId]
 */
export async function uploadDocument({ file, title, accessScope, program, branch, semester, classId }) {
  const { t, err } = await tk();
  if (err) return err;
  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  fd.append('accessScope', accessScope === 'class' ? 'class' : 'public');
  if (accessScope === 'class') {
    if (program) fd.append('program', program);
    if (branch) fd.append('branch', branch);
    if (semester != null && semester !== '') fd.append('semester', String(semester));
    if (classId != null && classId !== '') fd.append('classId', String(classId));
  }
  try {
    const res = await authedUpload('/ai/documents', t, fd);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Upload failed.', status: e?.status };
  }
}

/** Re-run indexing for a document (admin). */
export function reindexDocument(id) {
  return call(`/ai/documents/${encodeURIComponent(id)}/reindex`, { method: 'POST' });
}

/** Delete an AI document (removes AI metadata + chunks; original file too). */
export function deleteDocument(id) {
  return call(`/ai/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
