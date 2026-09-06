/**
 * repositories/classContentRepository.js
 * -----------------------------------------------------------------------------
 * Generic data-access for class content that shares the same shape:
 *   notes, question_papers, assignments, projects.
 * Parameterized SQL only. The table is chosen from a fixed allow-list (never
 * from raw user input) so there is no SQL-injection surface via the table name.
 *
 * Column notes:
 *   - notes/assignments/projects use `class_id` + `created_by`/`uploaded_by`.
 *   - question_papers historically uses `course_id` (NOT NULL) + `class_id`
 *     (nullable) + `uploaded_by`; we populate both course_id (from the class's
 *     subject) and class_id so it lists per-class.
 *   - assignments/projects have `due_date`.
 * File columns (file_url/file_name/file_type) exist but stay null until Storage
 * is enabled.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

// Allow-list of content tables + their author column + extra columns.
const TABLES = {
  note: { table: 'notes', author: 'uploaded_by', hasDue: false, hasCourse: false },
  question_paper: { table: 'question_papers', author: 'uploaded_by', hasDue: false, hasCourse: true },
  assignment: { table: 'assignments', author: 'created_by', hasDue: true, hasCourse: false },
  project: { table: 'projects', author: 'created_by', hasDue: true, hasCourse: false },
};

function cfg(entityType) {
  const c = TABLES[entityType];
  if (!c) throw new Error(`Unknown content type: ${entityType}`);
  return c;
}

/** List a class's content of one type, newest first. */
async function listByClass(entityType, classId) {
  const c = cfg(entityType);
  const dueCol = c.hasDue ? 't.due_date,' : '';
  // LEFT JOIN the normalized files row (entity_type + entity_id) to expose a
  // downloadable file id + size for the frontend (backend serves signed URLs).
  const { rows } = await query(
    `SELECT t.id, t.class_id, t.${c.author} AS author_id, t.title, t.description, ${dueCol}
            t.file_url, t.file_name, t.file_type, t.created_at, t.updated_at,
            f.id AS file_id, f.mime_type AS file_mime, f.size_bytes AS file_size
       FROM ${c.table} t
       LEFT JOIN files f ON f.entity_type = $2 AND f.entity_id = t.id AND f.class_id = t.class_id
      WHERE t.class_id = $1
      ORDER BY t.created_at DESC, t.id DESC`,
    [classId, entityType]
  );
  return rows;
}

async function findById(entityType, id) {
  const c = cfg(entityType);
  const { rows } = await query(
    `SELECT id, class_id, ${c.author} AS author_id, title FROM ${c.table} WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Insert a content row.
 * @param {object} p { classId, authorId, courseId?, title, description?, dueDate? }
 */
async function insert(entityType, p) {
  const c = cfg(entityType);
  const cols = ['class_id', c.author, 'title', 'description'];
  const vals = [p.classId, p.authorId, p.title, p.description ?? null];
  if (c.hasDue) { cols.push('due_date'); vals.push(p.dueDate ?? null); }
  if (c.hasCourse) { cols.push('course_id'); vals.push(p.courseId); }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const dueCol = c.hasDue ? 'due_date,' : '';
  const { rows } = await query(
    `INSERT INTO ${c.table} (${cols.join(', ')})
     VALUES (${placeholders})
     RETURNING id, class_id, ${c.author} AS author_id, title, description, ${dueCol}
               file_url, file_name, file_type, created_at, updated_at`,
    vals
  );
  return rows[0];
}

/** Update mutable fields (title/description/due_date). */
async function update(entityType, id, p) {
  const c = cfg(entityType);
  const sets = ['title = $2', 'description = $3'];
  const vals = [id, p.title, p.description ?? null];
  if (c.hasDue) { sets.push('due_date = $4'); vals.push(p.dueDate ?? null); }
  const dueCol = c.hasDue ? 'due_date,' : '';
  const { rows } = await query(
    `UPDATE ${c.table} SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, class_id, ${c.author} AS author_id, title, description, ${dueCol}
               file_url, file_name, file_type, created_at, updated_at`,
    vals
  );
  return rows[0] || null;
}

async function remove(entityType, id) {
  const c = cfg(entityType);
  const { rows } = await query(`DELETE FROM ${c.table} WHERE id = $1 RETURNING id`, [id]);
  return rows[0] || null;
}

module.exports = { listByClass, findById, insert, update, remove, TABLES };
