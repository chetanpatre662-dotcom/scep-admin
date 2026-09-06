/**
 * services/storageService.js
 * -----------------------------------------------------------------------------
 * Isolated, provider-agnostic file-storage boundary backed by Firebase Cloud
 * Storage (bucket college-94cd7.firebasestorage.app, via the Admin SDK). ALL
 * binary storage goes through here so the provider can be swapped without
 * touching content/message code.
 *
 * - Binary bytes are NEVER stored in PostgreSQL; only metadata + storagePath.
 * - No local filesystem fallback, no fake URLs.
 * - Storage path convention:
 *     classes/{classId}/{notes|question-papers|assignments|projects}/{fileId}
 *     classes/{classId}/messages/{fileId}
 *
 * Image handling: PDFs/videos/documents are preserved byte-for-byte. Optional
 * server-side image optimization uses `sharp` ONLY if it is installed; the
 * primary compression happens client-side (canvas) before upload. If sharp is
 * absent we upload the original image untouched (never corrupt a file).
 * -----------------------------------------------------------------------------
 */
'use strict';

const crypto = require('crypto');
const { isStorageEnabled, getBucket } = require('../config/firebaseAdmin');
const ApiError = require('../utils/ApiError');

// Optional native image optimizer — used only if present.
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const FOLDER = {
  note: 'notes',
  question_paper: 'question-papers',
  assignment: 'assignments',
  project: 'projects',
  message: 'messages',
};

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB hard cap
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'video/mp4', 'video/webm',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);

function isEnabled() { return isStorageEnabled(); }

function newFileId() { return crypto.randomBytes(16).toString('hex'); }

/** Build the canonical storage object path for an entity's file. */
function buildPath({ classId, entityType, fileId }) {
  const folder = FOLDER[entityType] || entityType;
  return `classes/${classId}/${folder}/${fileId}`;
}

function requireEnabled() {
  if (!isEnabled()) {
    throw new ApiError(503, 'File storage is not enabled.', { code: 'STORAGE_NOT_ENABLED' });
  }
}

/** Validate an incoming file (size + mime). Throws 400 on rejection. */
function validate({ buffer, mimeType }) {
  if (!buffer || !buffer.length) throw new ApiError(400, 'Empty file.', { code: 'EMPTY_FILE' });
  if (buffer.length > MAX_BYTES) throw new ApiError(413, 'File exceeds the 25 MB limit.', { code: 'FILE_TOO_LARGE' });
  if (mimeType && !ALLOWED_MIME.has(mimeType)) {
    throw new ApiError(415, `Unsupported file type: ${mimeType}`, { code: 'UNSUPPORTED_TYPE' });
  }
}

/**
 * Optionally optimize images server-side (only if sharp is installed). Resizes
 * very large images and re-encodes at reasonable quality. PDFs/videos/other are
 * returned unchanged. Never throws on optimization failure — falls back to the
 * original buffer.
 */
async function maybeOptimizeImage(buffer, mimeType) {
  if (!sharp || !mimeType || !mimeType.startsWith('image/') || mimeType === 'image/gif') {
    return { buffer, mimeType };
  }
  try {
    const out = await sharp(buffer)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    // Only use the optimized version if it's actually smaller.
    if (out.length < buffer.length) return { buffer: out, mimeType: 'image/jpeg' };
    return { buffer, mimeType };
  } catch {
    return { buffer, mimeType };
  }
}

/**
 * Upload a buffer to Firebase Storage. Returns { fileId, storagePath, mimeType,
 * size }. Throws (and uploads nothing) if storage is disabled or validation fails.
 *
 * @param {object} p { buffer, mimeType, classId, entityType }
 */
async function upload({ buffer, mimeType, classId, entityType }) {
  requireEnabled();
  validate({ buffer, mimeType });

  const optimized = await maybeOptimizeImage(buffer, mimeType);
  const fileId = newFileId();
  const storagePath = buildPath({ classId, entityType, fileId });

  const bucket = getBucket();
  const file = bucket.file(storagePath);
  await file.save(optimized.buffer, {
    resumable: false,
    contentType: optimized.mimeType || 'application/octet-stream',
    metadata: { metadata: { classId: String(classId), entityType } },
  });

  return { fileId, storagePath, mimeType: optimized.mimeType || mimeType, size: optimized.buffer.length };
}

/**
 * Upload a STANDALONE AI knowledge-base document (not tied to a class). Stored
 * under `ai-documents/{fileId}`. Returns { fileId, storagePath, mimeType, size }.
 * @param {object} p { buffer, mimeType }
 */
async function uploadStandalone({ buffer, mimeType }) {
  requireEnabled();
  validate({ buffer, mimeType });
  const fileId = newFileId();
  const storagePath = `ai-documents/${fileId}`;
  const bucket = getBucket();
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    contentType: mimeType || 'application/octet-stream',
    metadata: { metadata: { entityType: 'ai_document' } },
  });
  return { fileId, storagePath, mimeType: mimeType || 'application/octet-stream', size: buffer.length };
}

/**
 * Download an object's raw bytes server-side (Admin SDK). Used by the AI
 * document-ingestion pipeline for text extraction. Access must be authorized by
 * the caller BEFORE calling this (ingestion runs as an admin-triggered job).
 * @param {string} storagePath
 * @returns {Promise<Buffer>}
 */
async function downloadBuffer(storagePath) {
  requireEnabled();
  if (!storagePath) throw new ApiError(400, 'Missing storage path.', { code: 'NO_STORAGE_PATH' });
  const bucket = getBucket();
  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
}

/**
 * Generate a short-lived signed download URL for an object. Access must be
 * authorized by the caller BEFORE calling this.
 */
async function getSignedDownloadUrl(storagePath, { minutes = 15 } = {}) {
  requireEnabled();
  const bucket = getBucket();
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + minutes * 60 * 1000,
  });
  return url;
}

/** Best-effort delete (orphan cleanup / content deletion). Never throws. */
async function remove(storagePath) {
  if (!isEnabled() || !storagePath) return { ok: false, skipped: true };
  try {
    await getBucket().file(storagePath).delete();
    return { ok: true };
  } catch (err) {
    // Already gone counts as success for cleanup intent.
    if (err && err.code === 404) return { ok: true, alreadyAbsent: true };
    return { ok: false, error: err.message };
  }
}

module.exports = {
  isEnabled,
  buildPath,
  newFileId,
  validate,
  upload,
  uploadStandalone,
  getSignedDownloadUrl,
  downloadBuffer,
  remove,
  ALLOWED_MIME,
  MAX_BYTES,
};
