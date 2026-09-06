/**
 * repositories/studentRepository.js
 * -----------------------------------------------------------------------------
 * Data-access layer for the `students` table. Parameterized SQL only.
 *
 * Schema reference (migrations/001_initial_schema.sql):
 *   students(id, user_id UNIQUE -> users, roll_number UNIQUE NOT NULL,
 *            full_name, mobile_number, program, branch, semester,
 *            profile_photo_url, created_at, updated_at)
 *
 * NOTE: academic YEAR is NOT stored — it is derived from (program, semester)
 * at read time. Only the authoritative semester is persisted.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const RETURNING =
  'id, user_id, roll_number, full_name, mobile_number, program, branch, semester, profile_photo_url, created_at, updated_at';

/** Find a student profile by the owning user id. */
async function findByUserId(userId) {
  const { rows } = await query(
    `SELECT ${RETURNING} FROM students WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Find students matching an announcement's targeting (NULL target = broader).
 * Returns minimal rows ({ user_id }) for notification fan-out.
 */
async function findMatching({ program, branch, semester }) {
  const { rows } = await query(
    `SELECT user_id FROM students
      WHERE ($1::text     IS NULL OR program  = $1)
        AND ($2::text     IS NULL OR branch   = $2)
        AND ($3::smallint IS NULL OR semester = $3)`,
    [program || null, branch || null, semester != null ? Number(semester) : null]
  );
  return rows;
}

/** Check whether a roll number is already taken by a different user. */
async function rollNumberTakenByOther(rollNumber, userId) {
  const { rows } = await query(
    'SELECT 1 FROM students WHERE roll_number = $1 AND user_id <> $2 LIMIT 1',
    [rollNumber, userId]
  );
  return rows.length > 0;
}

/**
 * Insert or update the student profile for a user (one profile per user).
 * On conflict of user_id, updates the mutable profile fields.
 * @param {object} p
 * @param {number} p.userId
 * @param {string} p.rollNumber
 * @param {string} p.fullName
 * @param {string} p.mobileNumber
 * @param {string} p.program
 * @param {string} p.branch
 * @param {number} p.semester
 */
async function upsertByUserId({ userId, rollNumber, fullName, mobileNumber, program, branch, semester }) {
  const { rows } = await query(
    `INSERT INTO students
       (user_id, roll_number, full_name, mobile_number, program, branch, semester)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE
       SET roll_number   = EXCLUDED.roll_number,
           full_name     = EXCLUDED.full_name,
           mobile_number = EXCLUDED.mobile_number,
           program       = EXCLUDED.program,
           branch        = EXCLUDED.branch,
           semester      = EXCLUDED.semester
     RETURNING ${RETURNING}`,
    [userId, rollNumber, fullName, mobileNumber, program, branch, semester]
  );
  return rows[0];
}

module.exports = { findByUserId, findMatching, rollNumberTakenByOther, upsertByUserId };
