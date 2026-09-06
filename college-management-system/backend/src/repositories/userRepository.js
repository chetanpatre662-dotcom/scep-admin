/**
 * repositories/userRepository.js
 * -----------------------------------------------------------------------------
 * Data-access layer for the `users` table. This is the ONLY place that holds
 * SQL for users — services and routes never write SQL directly.
 *
 * All queries are parameterized (no string interpolation of user input) to
 * prevent SQL injection. Firebase UID (`firebase_uid`) is the identity key.
 *
 * Schema reference (from migrations/001_initial_schema.sql):
 *   users(id, firebase_uid UNIQUE NOT NULL, email, display_name,
 *         role CHECK IN ('student','faculty','admin') DEFAULT 'student',
 *         created_at, updated_at)
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

// Columns returned to callers — keep this stable so services/routes have a
// predictable shape and we never accidentally leak added internal columns.
const RETURNING = 'id, firebase_uid, email, display_name, role, status, phone, phone_verified, created_at, updated_at';

/**
 * Find a user by their Firebase UID.
 * @param {string} firebaseUid
 * @returns {Promise<object|null>} the user row, or null if not found
 */
async function findByFirebaseUid(firebaseUid) {
  const { rows } = await query(
    `SELECT ${RETURNING} FROM users WHERE firebase_uid = $1`,
    [firebaseUid]
  );
  return rows[0] || null;
}

/**
 * Insert a new user row.
 * @param {object} params
 * @param {string} params.firebaseUid  - required identity key
 * @param {string|null} [params.email]
 * @param {string|null} [params.displayName]
 * @param {string} [params.role='student'] - decided server-side, never from client
 * @returns {Promise<object>} the inserted user row
 */
async function insertUser({ firebaseUid, email = null, displayName = null, role = 'student' }) {
  const { rows } = await query(
    `INSERT INTO users (firebase_uid, email, display_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${RETURNING}`,
    [firebaseUid, email, displayName, role]
  );
  return rows[0];
}

/**
 * Upsert a user by Firebase UID.
 *
 * On first insert, the provided `role` (default 'student') is used. On conflict
 * (user already exists) the row's ROLE IS DELIBERATELY PRESERVED — role is never
 * changed here. Only email/display_name are refreshed, and only when a non-null
 * value is supplied (COALESCE keeps existing data if the new value is null).
 *
 * @param {object} params
 * @param {string} params.firebaseUid
 * @param {string|null} [params.email]
 * @param {string|null} [params.displayName]
 * @param {string} [params.role='student'] - used ONLY for the initial insert
 * @returns {Promise<object>} the resulting user row
 */
async function upsertByFirebaseUid({ firebaseUid, email = null, displayName = null, role = 'student' }) {
  const { rows } = await query(
    `INSERT INTO users (firebase_uid, email, display_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firebase_uid) DO UPDATE
       SET email        = COALESCE(EXCLUDED.email, users.email),
           display_name = COALESCE(EXCLUDED.display_name, users.display_name)
     RETURNING ${RETURNING}`,
    [firebaseUid, email, displayName, role]
  );
  return rows[0];
}

/** Find a user by primary key. */
async function findById(id) {
  const { rows } = await query(`SELECT ${RETURNING} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Set a user's account status ('pending' | 'approved' | 'rejected').
 * Returns the updated row.
 */
async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE users SET status = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, status]
  );
  return rows[0] || null;
}

/** Set a user's role AND status in one update (used by admin promotions). */
async function updateRoleAndStatus(id, role, status) {
  const { rows } = await query(
    `UPDATE users SET role = $2, status = $3 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, role, status]
  );
  return rows[0] || null;
}

/** Record a user's verified phone (server-side; set after phone-auth verify). */
async function setVerifiedPhone(id, phone) {
  const { rows } = await query(
    `UPDATE users SET phone = $2, phone_verified = TRUE WHERE id = $1 RETURNING ${RETURNING}`,
    [id, phone]
  );
  return rows[0] || null;
}

/** Save an UNVERIFIED phone number provided at registration (not OTP-verified yet). */
async function saveUnverifiedPhone(id, phone) {
  const { rows } = await query(
    `UPDATE users SET phone = $2, phone_verified = FALSE WHERE id = $1 RETURNING ${RETURNING}`,
    [id, phone]
  );
  return rows[0] || null;
}

/**
 * Update a user's display_name and/or phone (used by the self-service Admin
 * profile edit). Only the provided fields are changed (COALESCE keeps existing
 * values when a param is null). Does NOT touch role, status, or phone_verified.
 */
async function updateContact(id, { displayName = null, phone = null } = {}) {
  const { rows } = await query(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            phone        = COALESCE($3, phone)
      WHERE id = $1
      RETURNING ${RETURNING}`,
    [id, displayName, phone]
  );
  return rows[0] || null;
}

/** Count users matching a role + status (e.g. approved admins). */
async function countByRoleStatus(role, status) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM users WHERE role = $1 AND status = $2',
    [role, status]
  );
  return rows[0].n;
}

/**
 * List eligible OTP approvers: role='admin' AND status='approved' AND a
 * non-empty phone. Returns ONLY id + phone (caller masks the phone). Never
 * expose the raw phone beyond the service layer.
 */
async function listApprovedAdminsWithPhone() {
  const { rows } = await query(
    `SELECT id, display_name, email, phone
       FROM users
      WHERE role = 'admin' AND status = 'approved'
        AND phone IS NOT NULL AND phone <> ''
      ORDER BY id ASC`
  );
  return rows;
}

module.exports = {
  findByFirebaseUid,
  findById,
  insertUser,
  upsertByFirebaseUid,
  updateStatus,
  updateRoleAndStatus,
  setVerifiedPhone,
  saveUnverifiedPhone,
  updateContact,
  countByRoleStatus,
  listApprovedAdminsWithPhone,
};
