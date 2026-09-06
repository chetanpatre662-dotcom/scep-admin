/**
 * services/classApiService.js — REST client for real classes + class content.
 * -----------------------------------------------------------------------------
 * Bootstrap/history/mutations over authenticated HTTP. LIVE updates come via
 * realtimeService (WebSocket) — this client is NOT polled. Returns { ok, ... }
 * result objects (never throws) so pages can render loading/empty/error states.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest, authedUpload } from './apiClient.js';

async function tk() {
  if (!ENV.AUTH_USE_BACKEND) return { t: null, err: { ok: false, error: 'Backend disabled.', status: 0 } };
  const t = await getIdToken();
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

/* ---- Classes ---- */
export function createClass(data) { return call('/classes', { method: 'POST', body: data }); }
export function getFacultyClasses() { return call('/faculty/classes', { method: 'GET' }); }
export function getStudentClasses() { return call('/student/classes', { method: 'GET' }); }
export function getClass(id) { return call(`/classes/${encodeURIComponent(id)}`, { method: 'GET' }); }

/* ---- Content: notes | question-papers | assignments | projects ---- */
export function listContent(classId, content) {
  return call(`/classes/${encodeURIComponent(classId)}/${content}`, { method: 'GET' });
}
export function createContent(classId, content, data) {
  return call(`/classes/${encodeURIComponent(classId)}/${content}`, { method: 'POST', body: data });
}
export function updateContent(classId, content, itemId, data) {
  return call(`/classes/${encodeURIComponent(classId)}/${content}/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: data });
}
export function deleteContent(classId, content, itemId) {
  return call(`/classes/${encodeURIComponent(classId)}/${content}/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
}

/* ---- File uploads (multipart -> Firebase Storage via backend) ---- */

/**
 * Client-side image compression before upload (canvas). Downscales large images
 * and re-encodes as JPEG to cut upload size. Non-images and small files pass
 * through UNCHANGED. Never corrupts a file: on any failure returns the original.
 * PDFs/videos/docs are always returned as-is (preserved exactly).
 * @param {File} file
 * @param {{maxDim?:number, quality?:number, minBytes?:number}} [o]
 * @returns {Promise<Blob|File>}
 */
export async function compressImage(file, { maxDim = 1600, quality = 0.82, minBytes = 200 * 1024 } = {}) {
  try {
    if (!file || !file.type || !file.type.startsWith('image/')) return file; // non-image untouched
    if (file.type === 'image/gif') return file;      // preserve animation
    if (file.size <= minBytes) return file;           // already small enough
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file; // only use if actually smaller
    // Preserve a sensible filename with .jpg extension.
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file; // safety: never block the upload on compression failure
  }
}

/**
 * Create class content (note/paper/assignment/project) WITH a file attachment.
 * Compresses images client-side, then uploads multipart to the backend, which
 * stores the binary in Firebase Storage and persists only metadata in Postgres.
 * @param {string|number} classId
 * @param {string} content - notes|question-papers|assignments|projects
 * @param {{title:string, description?:string, dueDate?:string}} fields
 * @param {File} file
 */
export async function createContentWithFile(classId, content, fields, file) {
  const { t, err } = await tk();
  if (err) return err;
  try {
    const payload = await compressImage(file);
    const fd = new FormData();
    fd.append('title', fields.title || '');
    if (fields.description) fd.append('description', fields.description);
    if (fields.dueDate) fd.append('dueDate', fields.dueDate);
    fd.append('file', payload, payload.name || (file && file.name) || 'upload');
    const res = await authedUpload(`/classes/${encodeURIComponent(classId)}/${content}`, t, fd);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Upload failed.', status: e?.status };
  }
}

/**
 * Send a message attachment (image/pdf/video/file). The binary goes to Firebase
 * Storage via the backend; the message itself is persisted + broadcast over the
 * WebSocket pipeline. Returns the persisted message.
 * @param {string|number} classId
 * @param {File} file
 * @param {{text?:string, clientMsgId?:string}} [opts]
 */
export async function sendMessageAttachment(classId, file, opts = {}) {
  const { t, err } = await tk();
  if (err) return err;
  try {
    const payload = await compressImage(file);
    const fd = new FormData();
    fd.append('file', payload, payload.name || (file && file.name) || 'upload');
    if (opts.text) fd.append('text', opts.text);
    if (opts.clientMsgId) fd.append('clientMsgId', opts.clientMsgId);
    const res = await authedUpload(`/classes/${encodeURIComponent(classId)}/messages/attachment`, t, fd);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Upload failed.', status: e?.status };
  }
}

/** Authenticated download URL for a stored file (backend redirects to signed URL). */
export function fileDownloadPath(fileId) {
  return `/files/${encodeURIComponent(fileId)}/download`;
}

/* ---- Messages (bootstrap + cursor pagination; live via WebSocket) ---- */
export function getMessages(classId, { before, limit = 50 } = {}) {
  const p = new URLSearchParams();
  if (before) p.set('before', String(before));
  if (limit) p.set('limit', String(limit));
  const qs = p.toString();
  return call(`/classes/${encodeURIComponent(classId)}/messages${qs ? '?' + qs : ''}`, { method: 'GET' });
}
