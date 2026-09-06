/**
 * repositories/announcementRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the `announcements` table (001 + 008). Parameterized SQL only.
 *
 * Targeting: target_program/target_branch/target_semester are NULL for a
 * broader audience. A student matches an announcement when each target dimension
 * is NULL-or-equal to the student's own program/branch/semester.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS = `a.id, a.created_by, a.title, a.content, a.type, a.status,
  a.target_program, a.target_branch, a.target_semester, a.class_id,
  a.event_date, a.attachment_file_id, a.created_at, a.updated_at,
  u.display_name AS created_by_name`;

/** List announcements created by a given user (faculty view of their own). */
async function listByCreator(userId) {
  const { rows } = await query(
    `SELECT ${COLS} FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.created_by = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [userId]
  );
  return rows;
}

/** List ALL announcements (admin view). */
async function listAll() {
  const { rows } = await query(
    `SELECT ${COLS} FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC, a.id DESC`
  );
  return rows;
}

/**
 * List published announcements targeted at a student's academic group.
 * NULL target dimension = broader audience (matches everyone).
 */
async function listForStudent({ program, branch, semester }) {
  const { rows } = await query(
    `SELECT ${COLS} FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.status = 'published'
        AND (a.target_program  IS NULL OR a.target_program  = $1)
        AND (a.target_branch   IS NULL OR a.target_branch   = $2)
        AND (a.target_semester IS NULL OR a.target_semester = $3)
      ORDER BY a.created_at DESC, a.id DESC`,
    [program || null, branch || null, semester != null ? Number(semester) : null]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await query(
    `SELECT ${COLS} FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function insert(p) {
  const { rows } = await query(
    `INSERT INTO announcements
       (created_by, title, content, type, status, target_program, target_branch, target_semester, class_id, event_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [p.createdBy, p.title, p.content, p.type ?? null, p.status || 'published',
     p.targetProgram ?? null, p.targetBranch ?? null, p.targetSemester ?? null,
     p.classId ?? null, p.eventDate ?? null]
  );
  return findById(rows[0].id);
}

async function update(id, p) {
  const { rows } = await query(
    `UPDATE announcements SET
       title = $2, content = $3, type = $4, status = $5,
       target_program = $6, target_branch = $7, target_semester = $8,
       event_date = $9
     WHERE id = $1 RETURNING id`,
    [id, p.title, p.content, p.type ?? null, p.status || 'published',
     p.targetProgram ?? null, p.targetBranch ?? null, p.targetSemester ?? null,
     p.eventDate ?? null]
  );
  return rows[0] ? findById(id) : null;
}

async function deleteById(id) {
  const { rows } = await query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

module.exports = { listByCreator, listAll, listForStudent, findById, insert, update, deleteById };
