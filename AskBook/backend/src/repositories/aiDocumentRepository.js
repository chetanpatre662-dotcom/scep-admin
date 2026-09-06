/**
 * repositories/aiDocumentRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for `ai_documents` — the registry of standalone college documents
 * an admin uploads for the AI knowledge base (migration 011). Parameterized SQL
 * only. Kept separate from the RAG chunk index (ai_document_chunks) and from the
 * original Firebase file metadata (files) so concerns stay decoupled.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS = `id, title, file_id, original_filename, mime_type, size_bytes,
  access_scope, program, branch, semester, class_id, status, index_error,
  chunks_count, uploaded_by, created_at, updated_at`;

/** Insert a new document registry row (status starts 'pending'). */
async function insert(p) {
  const { rows } = await query(
    `INSERT INTO ai_documents
       (title, file_id, original_filename, mime_type, size_bytes,
        access_scope, program, branch, semester, class_id, uploaded_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
     RETURNING ${COLS}`,
    [
      p.title, p.fileId ?? null, p.originalFilename ?? null, p.mimeType ?? null,
      p.sizeBytes ?? null, p.accessScope || 'public', p.program ?? null,
      p.branch ?? null, p.semester != null ? Number(p.semester) : null,
      p.classId ?? null, p.uploadedBy ?? null,
    ]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM ai_documents WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** List all documents (admin view), newest first. */
async function list({ limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT ${COLS} FROM ai_documents ORDER BY created_at DESC, id DESC LIMIT $1`,
    [Number(limit) || 200]
  );
  return rows;
}

/** Update indexing status/result after an ingestion attempt. */
async function setStatus(id, { status, indexError = null, chunksCount = 0 }) {
  const { rows } = await query(
    `UPDATE ai_documents
        SET status = $2, index_error = $3, chunks_count = $4, updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, status, indexError, Number(chunksCount) || 0]
  );
  return rows[0] || null;
}

async function deleteById(id) {
  const { rows } = await query(
    'DELETE FROM ai_documents WHERE id = $1 RETURNING id, file_id',
    [id]
  );
  return rows[0] || null;
}

module.exports = { insert, findById, list, setStatus, deleteById };
