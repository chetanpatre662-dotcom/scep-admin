/**
 * repositories/subjectRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for SUBJECTS. Subjects are stored in the existing `courses`
 * table (see migration 003): each row is a subject within a specific
 * Course(program) + Branch + Semester. Parameterized SQL only.
 *
 * Column mapping:
 *   courses.program  <-> Course (B.Tech / Polytechnic)
 *   courses.branch   <-> Branch
 *   courses.semester <-> Semester
 *   courses.name     <-> Subject name
 *   courses.code     <-> Subject code (optional / nullable)
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS = 'id, name, code, program, branch, semester, description, created_at, updated_at';

/**
 * List subjects for a Course + Branch + Semester, ordered by name.
 * @param {{program:string, branch:string, semester:number}} f
 */
async function listByGroup({ program, branch, semester }) {
  const { rows } = await query(
    `SELECT ${COLS} FROM courses
      WHERE program = $1 AND branch = $2 AND semester = $3
      ORDER BY name ASC`,
    [program, branch, semester]
  );
  return rows;
}

/** Find a single subject by id. */
async function findById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM courses WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Insert a subject. `createdBy` is the admin's users.id (nullable-safe).
 */
async function insert({ name, code = null, program, branch, semester, description = null, createdBy = null }) {
  const { rows } = await query(
    `INSERT INTO courses (name, code, program, branch, semester, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLS}`,
    [name, code, program, branch, semester, description, createdBy]
  );
  return rows[0];
}

/**
 * Update a subject's editable fields (name, code, description). The academic
 * group (program/branch/semester) is intentionally NOT changed here — moving a
 * subject between combinations is out of scope for this flow.
 */
async function update(id, { name, code = null, description = null }) {
  const { rows } = await query(
    `UPDATE courses SET name = $2, code = $3, description = $4 WHERE id = $1
     RETURNING ${COLS}`,
    [id, name, code, description]
  );
  return rows[0] || null;
}

/** Delete a subject by id. Returns the deleted row (or null). */
async function remove(id) {
  const { rows } = await query(
    `DELETE FROM courses WHERE id = $1 RETURNING ${COLS}`,
    [id]
  );
  return rows[0] || null;
}

/** Count distinct classes (for admin dashboard stats). */
async function classCount() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM classes');
  return rows[0] ? rows[0].n : 0;
}

/** Count all subjects (courses rows). */
async function subjectCount() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM courses');
  return rows[0] ? rows[0].n : 0;
}

module.exports = { listByGroup, findById, insert, update, remove, classCount, subjectCount };
