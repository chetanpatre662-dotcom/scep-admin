/**
 * services/fileService.js
 * -----------------------------------------------------------------------------
 * Orchestrates: Firebase Storage upload  <->  PostgreSQL `files` metadata,
 * with consistency + orphan cleanup.
 *
 * Flow (uploadFor):
 *   1. Upload the binary to Firebase Storage (real object).
 *   2. Insert a `files` metadata row (status 'stored') referencing it.
 *   3. If the DB insert fails AFTER a successful upload, delete the orphaned
 *      Storage object (best-effort) and rethrow — never leave a fake record.
 *
 * The owning content/message row is linked separately by the caller, then
 * linkEntity() backfills files.entity_id.
 * -----------------------------------------------------------------------------
 */
'use strict';

const storageService = require('./storageService');
const fileRepository = require('../repositories/fileRepository');

/** Public shape for a file reference returned to clients. */
function toFile(row, downloadUrl) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.original_filename,
    mimeType: row.mime_type,
    size: row.size_bytes != null ? Number(row.size_bytes) : null,
    storagePath: row.storage_path,
    entityType: row.entity_type,
    entityId: row.entity_id,
    url: downloadUrl || null,
  };
}

/**
 * Upload a file for a class entity and persist its metadata.
 * @param {object} p { buffer, mimeType, originalFilename, classId, entityType, uploadedBy }
 * @returns {Promise<object>} the persisted files row (public shape)
 */
async function uploadFor(p) {
  // 1) Real Storage upload.
  const up = await storageService.upload({
    buffer: p.buffer,
    mimeType: p.mimeType,
    classId: p.classId,
    entityType: p.entityType,
  });

  // 2) Persist metadata; on failure clean up the orphaned Storage object.
  try {
    const row = await fileRepository.insert({
      classId: p.classId,
      uploadedBy: p.uploadedBy,
      entityType: p.entityType,
      entityId: null, // linked after the owning row is created
      originalFilename: p.originalFilename,
      storagePath: up.storagePath,
      mimeType: up.mimeType,
      sizeBytes: up.size,
      status: 'stored',
    });
    return toFile(row);
  } catch (err) {
    await storageService.remove(up.storagePath); // orphan cleanup
    throw err;
  }
}

/** Backfill the owning entity id on a files row. */
async function linkEntity(fileId, entityId) {
  await fileRepository.setEntityId(fileId, entityId);
}

/** Resolve a signed download URL after the caller has authorized access. */
async function signedUrlForFile(fileRow) {
  return storageService.getSignedDownloadUrl(fileRow.storage_path);
}

async function findById(id) { return fileRepository.findById(id); }

/** Delete a file (Storage object + metadata). Best-effort Storage delete. */
async function deleteFile(id) {
  const row = await fileRepository.deleteById(id);
  if (row && row.storage_path) await storageService.remove(row.storage_path);
  return { ok: true };
}

module.exports = { uploadFor, linkEntity, signedUrlForFile, findById, deleteFile, toFile };
