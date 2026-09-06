/**
 * repositories/catalogRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the admin-managed academic catalog: course_catalog + branches
 * (migration 004). Parameterized SQL only. The catalog is the app-level source
 * of truth for valid Course/Branch names.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

/* ---- Courses ---- */

async function listCourses() {
  const { rows } = await query(
    `SELECT c.id, c.name, c.code, c.total_semesters,
            (SELECT COUNT(*)::int FROM branches b WHERE b.course_id = c.id) AS branch_count
       FROM course_catalog c
      ORDER BY c.name ASC`
  );
  return rows;
}

async function findCourseById(id) {
  const { rows } = await query(
    'SELECT id, name, code, total_semesters FROM course_catalog WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function insertCourse({ name, code = null, totalSemesters = 8 }) {
  const { rows } = await query(
    `INSERT INTO course_catalog (name, code, total_semesters)
     VALUES ($1, $2, $3)
     RETURNING id, name, code, total_semesters`,
    [name, code, totalSemesters]
  );
  return rows[0];
}

/* ---- Branches ---- */

async function listBranches(courseId) {
  const { rows } = await query(
    'SELECT id, course_id, name FROM branches WHERE course_id = $1 ORDER BY name ASC',
    [courseId]
  );
  return rows;
}

async function findBranchById(id) {
  const { rows } = await query('SELECT id, course_id, name FROM branches WHERE id = $1', [id]);
  return rows[0] || null;
}

async function insertBranch({ courseId, name }) {
  const { rows } = await query(
    `INSERT INTO branches (course_id, name) VALUES ($1, $2)
     RETURNING id, course_id, name`,
    [courseId, name]
  );
  return rows[0];
}

module.exports = {
  listCourses,
  findCourseById,
  insertCourse,
  listBranches,
  findBranchById,
  insertBranch,
};
