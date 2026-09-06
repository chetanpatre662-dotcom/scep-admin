/**
 * repositories/adminRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for admin user-management. Parameterized SQL only.
 *
 * Reuses the existing schema (users + students + faculty). No new columns.
 * "Faculty pending" is derived: a user that HAS a faculty profile but whose
 * role is still 'student' is a pending faculty applicant.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

/**
 * Aggregate counts for the admin dashboard.
 * Returns totals by role plus pending-faculty count. There is no user status
 * column in the schema, so "active users" is intentionally not fabricated.
 */
async function getCounts() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM users)                                   AS total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'student')            AS students,
      (SELECT COUNT(*) FROM users WHERE role = 'faculty')            AS faculty,
      (SELECT COUNT(*) FROM users WHERE role = 'admin')              AS admins,
      (SELECT COUNT(*) FROM faculty f
         JOIN users u ON u.id = f.user_id
        WHERE u.role <> 'faculty' OR u.status <> 'approved')         AS pending_faculty,
      (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status <> 'approved') AS pending_admins
  `);
  const r = rows[0] || {};
  return {
    totalUsers: Number(r.total_users || 0),
    students: Number(r.students || 0),
    faculty: Number(r.faculty || 0),
    admins: Number(r.admins || 0),
    pendingFaculty: Number(r.pending_faculty || 0),
    pendingAdmins: Number(r.pending_admins || 0),
  };
}

/**
 * List all users with their optional student/faculty profile details.
 * LEFT JOINs so users without a profile still appear. Newest first.
 */
async function listUsers() {
  const { rows } = await query(`
    SELECT
      u.id, u.firebase_uid, u.email, u.display_name, u.role, u.status, u.phone AS user_phone, u.created_at,
      s.id            AS student_id,
      s.roll_number   AS student_roll_number,
      s.full_name     AS student_full_name,
      s.mobile_number AS student_mobile,
      s.program       AS student_program,
      s.branch        AS student_branch,
      s.semester      AS student_semester,
      f.id            AS faculty_id,
      f.employee_id   AS faculty_employee_id,
      f.full_name     AS faculty_full_name,
      f.mobile_number AS faculty_mobile,
      f.department    AS faculty_department,
      f.designation   AS faculty_designation
    FROM users u
    LEFT JOIN students s ON s.user_id = u.id
    LEFT JOIN faculty  f ON f.user_id = u.id
    ORDER BY u.created_at DESC, u.id DESC
  `);
  return rows;
}

/** Find a single user row by primary key. */
async function findById(id) {
  const { rows } = await query(
    'SELECT id, firebase_uid, email, display_name, role, status, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/** Whether a user has a faculty profile row. */
async function hasFacultyProfile(userId) {
  const { rows } = await query('SELECT 1 FROM faculty WHERE user_id = $1 LIMIT 1', [userId]);
  return rows.length > 0;
}

/** Update a user's role. Returns the updated row. */
async function updateRole(id, role) {
  const { rows } = await query(
    `UPDATE users SET role = $2 WHERE id = $1
     RETURNING id, firebase_uid, email, display_name, role, status, created_at`,
    [id, role]
  );
  return rows[0] || null;
}

/** Update a user's role AND approval status together (approval transitions). */
async function updateRoleAndStatus(id, role, status) {
  const { rows } = await query(
    `UPDATE users SET role = $2, status = $3 WHERE id = $1
     RETURNING id, firebase_uid, email, display_name, role, status, created_at`,
    [id, role, status]
  );
  return rows[0] || null;
}

/** Update only a user's approval status ('pending'|'approved'|'rejected'). */
async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE users SET status = $2 WHERE id = $1
     RETURNING id, firebase_uid, email, display_name, role, status, created_at`,
    [id, status]
  );
  return rows[0] || null;
}

/**
 * Delete a user by id. Dependent students/faculty rows cascade via the existing
 * ON DELETE CASCADE FKs. Returns the deleted row (incl. firebase_uid so the
 * caller can remove the Firebase Auth account).
 */
async function deleteById(id) {
  const { rows } = await query(
    'DELETE FROM users WHERE id = $1 RETURNING id, firebase_uid, email, role',
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  getCounts,
  listUsers,
  findById,
  hasFacultyProfile,
  updateRole,
  updateRoleAndStatus,
  updateStatus,
  deleteById,
};
