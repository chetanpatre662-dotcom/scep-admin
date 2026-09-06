/**
 * repositories/fileRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the normalized `files` metadata table (migration 007).
 * Stores ONLY metadata + the Firebase Storage reference — never binary bytes.
 * Parameterized SQL only.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS =
  'id, class_id, uploaded_by, entity_type, entity_id, original_filename, storage_path, storage_provider, mime_type, size_bytes, status, created_at, updated_at';

async function insert(p) {
  const { rows } = await query(
    `INSERT INTO files
       (class_id, uploaded_by, entity_type, entity_id, original_filename, storage_path, mime_type, size_bytes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${COLS}`,
    [p.classId, p.uploadedBy, p.entityType, p.entityId ?? null, p.originalFilename ?? null,
     p.storagePath, p.mimeType ?? null, p.sizeBytes ?? null, p.status || 'stored']
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM files WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function setEntityId(id, entityId) {
  await query('UPDATE files SET entity_id = $2 WHERE id = $1', [id, entityId]);
}

async function deleteById(id) {
  const { rows } = await query('DELETE FROM files WHERE id = $1 RETURNING storage_path', [id]);
  return rows[0] || null;
}

module.exports = { insert, findById, setEntityId, deleteById };
