/**
 * repositories/aiRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the AI Assistant: conversation memory (ai_conversations,
 * ai_messages) and the RAG index (ai_document_chunks). Parameterized SQL only.
 *
 * PERMISSION-FILTERED RETRIEVAL: searchChunks() applies the caller's access
 * scope directly in the SQL WHERE clause, so a user can NEVER receive a chunk
 * from a document they are not authorized to read. The scope is derived from
 * the authenticated DB user (passed by ragService) — never from the model.
 *
 * pgvector note: the embedding parameter is passed as a text literal cast to
 * ::vector (e.g. '[0.1,0.2,...]'). Distance uses the cosine operator `<=>`.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

/* ============================ conversation memory ========================= */

/** Create a new conversation for a user. */
async function createConversation(userId, title) {
  const { rows } = await query(
    `INSERT INTO ai_conversations (user_id, title)
     VALUES ($1, $2)
     RETURNING id, user_id, title, created_at, updated_at`,
    [userId, title ? String(title).slice(0, 200) : null]
  );
  return rows[0];
}

/** Fetch a conversation IF it belongs to the user (ownership check). */
async function findConversationForUser(conversationId, userId) {
  const { rows } = await query(
    `SELECT id, user_id, title, created_at, updated_at
       FROM ai_conversations
      WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  return rows[0] || null;
}

/** List a user's conversations (most recently updated first). */
async function listConversations(userId, limit = 30) {
  const { rows } = await query(
    `SELECT id, title, created_at, updated_at
       FROM ai_conversations
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/** Touch updated_at so the conversation floats to the top. */
async function touchConversation(conversationId) {
  await query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
}

/** Append a message to a conversation. */
async function insertMessage({ conversationId, role, content, sources, metadata }) {
  const { rows } = await query(
    `INSERT INTO ai_messages (conversation_id, role, content, sources, metadata)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id, conversation_id, role, content, sources, metadata, created_at`,
    [
      conversationId,
      role,
      content,
      JSON.stringify(sources || []),
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0];
}

/** Full message thread for a conversation, oldest-first (for opening a chat). */
async function getMessages(conversationId, limit = 500) {
  const { rows } = await query(
    `SELECT id, role, content, sources, metadata, created_at
       FROM ai_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

/**
 * Rename a conversation IF it belongs to the user. Returns the updated row or
 * null when the conversation doesn't exist / isn't owned by the user.
 */
async function renameConversation(conversationId, userId, title) {
  const { rows } = await query(
    `UPDATE ai_conversations
        SET title = $3
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, title, created_at, updated_at`,
    [conversationId, userId, String(title || '').slice(0, 200) || 'Untitled chat']
  );
  return rows[0] || null;
}

/**
 * Delete a conversation IF it belongs to the user (ai_messages cascade via FK).
 * Returns true when a row was deleted, false otherwise (not found / not owned).
 */
async function deleteConversation(conversationId, userId) {
  const { rowCount } = await query(
    'DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return rowCount > 0;
}

/** Recent messages for a conversation, oldest-first, capped to `limit`. */
async function recentMessages(conversationId, limit = 12) {
  const { rows } = await query(
    `SELECT id, role, content, sources, created_at
       FROM (
         SELECT id, role, content, sources, created_at
           FROM ai_messages
          WHERE conversation_id = $1
          ORDER BY created_at DESC
          LIMIT $2
       ) t
      ORDER BY created_at ASC`,
    [conversationId, limit]
  );
  return rows;
}

/* ================================ RAG index =============================== */

/** Format a JS number[] as a pgvector text literal: '[a,b,c]'. */
function toVectorLiteral(embedding) {
  return `[${embedding.map((x) => Number(x)).join(',')}]`;
}

/**
 * Upsert one chunk (idempotent by (source_type, source_id, chunk_index)).
 * Re-ingesting the same chunk updates its text/embedding instead of duplicating.
 */
async function upsertChunk(chunk) {
  const {
    sourceType, sourceId, fileId = null, classId = null,
    program = null, branch = null, semester = null,
    accessScope = 'class', uploadedBy = null,
    title = null, chunkIndex = 0, chunkText, contentHash, embedding,
  } = chunk;

  const { rows } = await query(
    `INSERT INTO ai_document_chunks
       (source_type, source_id, file_id, class_id, program, branch, semester,
        access_scope, uploaded_by, title, chunk_index, chunk_text, content_hash, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::vector)
     ON CONFLICT (source_type, source_id, chunk_index) DO UPDATE
       SET file_id      = EXCLUDED.file_id,
           class_id     = EXCLUDED.class_id,
           program      = EXCLUDED.program,
           branch       = EXCLUDED.branch,
           semester     = EXCLUDED.semester,
           access_scope = EXCLUDED.access_scope,
           uploaded_by  = EXCLUDED.uploaded_by,
           title        = EXCLUDED.title,
           chunk_text   = EXCLUDED.chunk_text,
           content_hash = EXCLUDED.content_hash,
           embedding    = EXCLUDED.embedding,
           updated_at   = NOW()
     RETURNING id`,
    [
      sourceType, sourceId, fileId, classId, program, branch,
      semester != null ? Number(semester) : null,
      accessScope, uploadedBy, title, Number(chunkIndex) || 0,
      chunkText, contentHash, toVectorLiteral(embedding),
    ]
  );
  return rows[0];
}

/** Return the set of existing content_hashes for a source (dedup check). */
async function existingHashesForSource(sourceType, sourceId) {
  const { rows } = await query(
    `SELECT chunk_index, content_hash FROM ai_document_chunks
      WHERE source_type = $1 AND source_id = $2`,
    [sourceType, sourceId]
  );
  return rows;
}

/** Delete all chunks for a source (used when re-ingesting from scratch). */
async function deleteChunksForSource(sourceType, sourceId) {
  const { rowCount } = await query(
    'DELETE FROM ai_document_chunks WHERE source_type = $1 AND source_id = $2',
    [sourceType, sourceId]
  );
  return rowCount;
}

/**
 * Permission-filtered vector search.
 *
 * @param {object} p
 * @param {number[]} p.embedding      - query embedding
 * @param {object}   p.scope          - caller access scope:
 *      { role, studentGroup?: {program,branch,semester}, classIds?: number[] }
 * @param {string}   [p.sourceType]   - optional source_type filter
 * @param {number}   [p.topK=6]
 * @returns {Promise<Array>} rows: { id, source_type, source_id, file_id, class_id,
 *      title, chunk_index, chunk_text, distance }
 *
 * ACCESS RULES (enforced in SQL, before any content is returned):
 *   - admin           : all chunks.
 *   - faculty         : access_scope='public' OR class_id IN (their classIds).
 *   - student         : access_scope='public' OR (class-scoped AND the chunk's
 *                       program+branch+semester equals the student's group).
 *   - unknown/none    : access_scope='public' only.
 */
async function searchChunks({ embedding, scope, sourceType = null, topK = 6 }) {
  const vec = toVectorLiteral(embedding);
  const params = [vec];
  let where = '';

  if (scope && scope.role === 'admin') {
    where = 'TRUE';
  } else if (scope && scope.role === 'faculty') {
    // public OR chunks belonging to a class this faculty owns.
    const ids = Array.isArray(scope.classIds) ? scope.classIds : [];
    if (ids.length > 0) {
      params.push(ids);
      where = `(access_scope = 'public' OR class_id = ANY($${params.length}::bigint[]))`;
    } else {
      where = `access_scope = 'public'`;
    }
  } else if (scope && scope.role === 'student' && scope.studentGroup) {
    const g = scope.studentGroup;
    params.push(g.program, g.branch, Number(g.semester));
    where =
      `(access_scope = 'public' OR ` +
      `(access_scope = 'class' AND program = $${params.length - 2} ` +
      `AND branch = $${params.length - 1} AND semester = $${params.length}))`;
  } else {
    where = `access_scope = 'public'`;
  }

  // Optional source_type restriction.
  if (sourceType) {
    params.push(sourceType);
    where = `(${where}) AND source_type = $${params.length}`;
  }

  // topK is the last param.
  params.push(Number(topK) || 6);
  const limitIdx = params.length;

  const { rows } = await query(
    `SELECT id, source_type, source_id, file_id, class_id, title,
            chunk_index, chunk_text,
            (embedding <=> $1::vector) AS distance
       FROM ai_document_chunks
      WHERE ${where}
      ORDER BY embedding <=> $1::vector
      LIMIT $${limitIdx}`,
    params
  );
  return rows;
}

/** Count indexed chunks (health/metrics). */
async function countChunks() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM ai_document_chunks');
  return rows[0].n;
}

/* ========================= ingestion source lookups ====================== */
// These read (content row + its class scope + linked stored file) so the
// ingestion pipeline can extract text and stamp permission metadata. The table
// is chosen from a FIXED allow-list (never raw input) — no injection surface.

const INGEST_TABLES = {
  note: 'notes',
  question_paper: 'question_papers',
  assignment: 'assignments',
  project: 'projects',
};

/**
 * Fetch one class-scoped content item joined to its class group + stored file.
 * Returns null if not found. `file_*` come from the normalized files table
 * (status='stored' only) so we never try to download a pending/failed upload.
 */
async function findIngestSource(sourceType, sourceId) {
  const table = INGEST_TABLES[sourceType];
  if (!table) throw new Error(`Cannot ingest source type: ${sourceType}`);
  const { rows } = await query(
    `SELECT t.id, t.class_id, t.title, t.description,
            c.program, c.branch, c.semester,
            f.id AS file_id, f.storage_path, f.mime_type, f.uploaded_by
       FROM ${table} t
       LEFT JOIN classes c ON c.id = t.class_id
       LEFT JOIN files f ON f.entity_type = $2 AND f.entity_id = t.id
                        AND f.status = 'stored' AND f.storage_path IS NOT NULL
      WHERE t.id = $1`,
    [sourceId, sourceType]
  );
  return rows[0] || null;
}

/**
 * List class-scoped content of a type that HAS a stored file (for bulk
 * ingestion). Optionally restrict to a single class.
 */
async function listIngestSources(sourceType, { classId = null, limit = 500 } = {}) {
  const table = INGEST_TABLES[sourceType];
  if (!table) throw new Error(`Cannot ingest source type: ${sourceType}`);
  const params = [sourceType];
  let classFilter = '';
  if (classId != null) { params.push(Number(classId)); classFilter = `AND t.class_id = $${params.length}`; }
  params.push(Number(limit) || 500);
  const { rows } = await query(
    `SELECT t.id, t.class_id, t.title,
            c.program, c.branch, c.semester,
            f.id AS file_id, f.storage_path, f.mime_type, f.uploaded_by
       FROM ${table} t
       JOIN classes c ON c.id = t.class_id
       JOIN files f ON f.entity_type = $1 AND f.entity_id = t.id
                   AND f.status = 'stored' AND f.storage_path IS NOT NULL
      WHERE TRUE ${classFilter}
      ORDER BY t.id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

module.exports = {
  // conversation memory
  createConversation,
  findConversationForUser,
  listConversations,
  touchConversation,
  insertMessage,
  recentMessages,
  getMessages,
  renameConversation,
  deleteConversation,
  // RAG index
  toVectorLiteral,
  upsertChunk,
  existingHashesForSource,
  deleteChunksForSource,
  searchChunks,
  countChunks,
  findIngestSource,
  listIngestSources,
};
