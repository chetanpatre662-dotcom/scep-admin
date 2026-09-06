/**
 * services/ragService.js
 * -----------------------------------------------------------------------------
 * Retrieval-Augmented Generation retrieval layer.
 *
 * retrieve(user, { query, sourceType?, subject?, topK }) ->
 *   { chunks: [{ text, distance, source }], sources: [{ type, id, title, ... }] }
 *
 * SECURITY: the caller's access scope is computed HERE from the authenticated
 * DB user (student academic group / faculty-owned class ids / admin=all) and
 * passed to aiRepository.searchChunks, which enforces it in SQL. No chunk a
 * user cannot access is ever returned to the model. The model cannot influence
 * the scope — it only supplies the free-text query and optional filters.
 *
 * Graceful degradation: if the AI/embeddings are not configured, or the vector
 * store/extension is unavailable, retrieve() returns an empty, well-formed
 * result (never throws to the orchestrator) so the assistant can still answer
 * from tools/general knowledge and honestly say documents were not searched.
 * -----------------------------------------------------------------------------
 */
'use strict';

const aiRepository = require('../repositories/aiRepository');
const geminiService = require('./geminiService');
const studentRepository = require('../repositories/studentRepository');
const facultyRepository = require('../repositories/facultyRepository');
const classService = require('./classService');
const { env } = require('../config/env');

/**
 * Resolve the caller's retrieval access scope from the authenticated DB user.
 * @param {object} user - DB users row (id, role, ...)
 * @returns {Promise<object>} scope for aiRepository.searchChunks
 */
async function resolveScope(user) {
  if (!user) return { role: 'none' };
  if (user.role === 'admin') return { role: 'admin' };

  if (user.role === 'faculty') {
    // Faculty may see documents from classes they own.
    let classIds = [];
    try {
      const classes = await classService.listForFaculty(user);
      classIds = classes.map((c) => Number(c.id)).filter(Boolean);
    } catch {
      classIds = [];
    }
    return { role: 'faculty', classIds };
  }

  if (user.role === 'student') {
    const student = await studentRepository.findByUserId(user.id);
    if (!student) return { role: 'none' };
    return {
      role: 'student',
      studentGroup: {
        program: student.program,
        branch: student.branch,
        semester: Number(student.semester),
      },
    };
  }

  return { role: 'none' };
}

/**
 * Retrieve the most relevant, permission-scoped document chunks for a query.
 * Always returns a well-formed object; never throws to the orchestrator.
 */
async function retrieve(user, { query, sourceType = null, subject = null, topK } = {}) {
  const q = String(query || '').trim();
  const k = Math.max(1, Math.min(Number(topK) || env.ai.ragTopK, 12));
  const empty = { chunks: [], sources: [], searched: false };

  if (!q) return { ...empty, note: 'Empty query.' };
  if (!geminiService.isEnabled()) return { ...empty, note: 'AI embeddings are not configured.' };

  // Blend an optional subject hint into the query text for better recall.
  const queryText = subject ? `${subject}: ${q}` : q;

  let embedding;
  try {
    embedding = await geminiService.embed(queryText, { taskType: 'RETRIEVAL_QUERY' });
  } catch (err) {
    console.warn('[rag] query embedding failed:', err && err.message);
    return { ...empty, note: 'Document search is temporarily unavailable.' };
  }

  let scope;
  try {
    scope = await resolveScope(user);
  } catch (err) {
    console.warn('[rag] scope resolution failed:', err && err.message);
    scope = { role: 'none' };
  }

  let rows;
  try {
    rows = await aiRepository.searchChunks({ embedding, scope, sourceType, topK: k });
  } catch (err) {
    // Most likely cause: pgvector extension/table not present yet.
    console.warn('[rag] vector search failed (is pgvector installed + migrated?):', err && err.message);
    return { ...empty, note: 'The document index is not available.' };
  }

  const chunks = rows.map((r) => ({
    text: r.chunk_text,
    distance: r.distance != null ? Number(r.distance) : null,
    source: {
      type: r.source_type,
      id: Number(r.source_id),
      title: r.title || null,
      fileId: r.file_id != null ? Number(r.file_id) : null,
      classId: r.class_id != null ? Number(r.class_id) : null,
      chunkIndex: r.chunk_index,
    },
  }));

  // Deduplicate sources (a document may contribute several chunks).
  const seen = new Map();
  for (const c of chunks) {
    const key = `${c.source.type}:${c.source.id}`;
    if (!seen.has(key)) {
      seen.set(key, {
        type: c.source.type,
        id: c.source.id,
        title: c.source.title,
        fileId: c.source.fileId,
        classId: c.source.classId,
      });
    }
  }

  return { chunks, sources: Array.from(seen.values()), searched: true };
}

module.exports = { retrieve, resolveScope };
