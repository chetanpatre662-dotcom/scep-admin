/**
 * repositories/classRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the `classes` table (admin views). Parameterized SQL only.
 *
 * A class references a subject (courses.id) and a faculty (faculty.id). We LEFT
 * JOIN so a class still lists even if a referenced row is missing. Only fields
 * that actually exist in the schema are returned (id, course/branch/semester,
 * subject name, faculty name, status, created_at). There is no room/schedule
 * column in the schema — those are intentionally NOT fabricated.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

/**
 * List classes with optional filters. Filters are matched on the class's own
 * denormalized program/branch/semester columns (source of truth for the class).
 * @param {{program?:string, branch?:string, semester?:number, facultyId?:number}} f
 */
async function list(f = {}) {
  const where = [];
  const params = [];
  if (f.program) { params.push(f.program); where.push(`cl.program = $${params.length}`); }
  if (f.branch) { params.push(f.branch); where.push(`cl.branch = $${params.length}`); }
  if (f.semester) { params.push(Number(f.semester)); where.push(`cl.semester = $${params.length}`); }
  if (f.facultyId) { params.push(Number(f.facultyId)); where.push(`cl.faculty_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT cl.id, cl.title, cl.program, cl.branch, cl.semester, cl.status, cl.description, cl.created_at,
            cl.course_id AS subject_id,
            subj.name    AS subject_name,
            subj.code    AS subject_code,
            cl.faculty_id,
            f.full_name  AS faculty_name,
            f.department AS faculty_department
       FROM classes cl
       LEFT JOIN courses subj ON subj.id = cl.course_id
       LEFT JOIN faculty f    ON f.id   = cl.faculty_id
       ${whereSql}
       ORDER BY cl.created_at DESC, cl.id DESC`,
    params
  );
  return rows;
}

async function findById(id) {
  const { rows } = await query('SELECT id, faculty_id, course_id, program, branch, semester FROM classes WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Full class detail row (joined subject + faculty) for the bootstrap load. */
async function findDetailById(id) {
  const { rows } = await query(
    `SELECT cl.id, cl.title, cl.program, cl.branch, cl.semester, cl.status, cl.description, cl.created_at, cl.updated_at,
            cl.course_id AS subject_id,
            subj.name    AS subject_name,
            subj.code    AS subject_code,
            cl.faculty_id,
            f.full_name  AS faculty_name,
            f.department AS faculty_department,
            f.user_id    AS faculty_user_id
       FROM classes cl
       LEFT JOIN courses subj ON subj.id = cl.course_id
       LEFT JOIN faculty f    ON f.id   = cl.faculty_id
      WHERE cl.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Insert a class. subjectId (courses.id) is stored in course_id. A faculty
 * cannot create two classes for the same subject+group (enforced by caller +
 * this uniqueness check via the existing uq_classes_course_group constraint on
 * (course_id, program, branch, semester)).
 */
async function insert({ subjectId, facultyId, program, branch, semester, title, description }) {
  const { rows } = await query(
    `INSERT INTO classes (course_id, faculty_id, program, branch, semester, title, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     RETURNING id, course_id, faculty_id, program, branch, semester, title, description, status, created_at, updated_at`,
    [subjectId, facultyId, program, branch, semester, title || null, description || null]
  );
  return rows[0];
}

async function deleteById(id) {
  const { rows } = await query(
    'DELETE FROM classes WHERE id = $1 RETURNING id',
    [id]
  );
  return rows[0] || null;
}

/** Distinct faculty that own at least one class (for the faculty filter). */
async function facultyWithClasses() {
  const { rows } = await query(
    `SELECT DISTINCT f.id, f.full_name
       FROM classes cl JOIN faculty f ON f.id = cl.faculty_id
      ORDER BY f.full_name ASC`
  );
  return rows;
}

module.exports = { list, findById, findDetailById, insert, deleteById, facultyWithClasses };
