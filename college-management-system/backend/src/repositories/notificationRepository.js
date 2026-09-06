/**
 * repositories/notificationRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the per-user `notifications` table (008). Parameterized SQL.
 * Feed query is index-backed: (user_id, created_at DESC); unread via partial idx.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS = 'id, user_id, type, title, body, link, ref_type, ref_id, is_read, created_at';

/** Latest notifications for a user (newest first). */
async function listByUser(userId, { limit = 30 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const { rows } = await query(
    `SELECT ${COLS} FROM notifications
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, lim]
  );
  return rows;
}

async function unreadCount(userId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );
  return rows[0].n;
}

async function insertOne(p) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, link, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
    [p.userId, p.type || 'general', p.title, p.body ?? null, p.link ?? null, p.refType ?? null, p.refId ?? null]
  );
  return rows[0];
}

/** Bulk insert the same notification for many users (fan-out). */
async function insertForUsers(userIds, p) {
  if (!userIds || !userIds.length) return 0;
  // Build a multi-row VALUES list with parameterized user ids.
  const values = [];
  const params = [p.type || 'general', p.title, p.body ?? null, p.link ?? null, p.refType ?? null, p.refId ?? null];
  userIds.forEach((uid, i) => { values.push(`($${7 + i}, $1, $2, $3, $4, $5, $6)`); params.push(uid); });
  await query(
    `INSERT INTO notifications (user_id, type, title, body, link, ref_type, ref_id)
     VALUES ${values.join(', ')}`,
    params
  );
  return userIds.length;
}

async function markRead(userId, id) {
  const { rows } = await query(
    'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return rows[0] || null;
}

async function markAllRead(userId) {
  const { rowCount } = await query(
    'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
    [userId]
  );
  return rowCount;
}

module.exports = { listByUser, unreadCount, insertOne, insertForUsers, markRead, markAllRead, COLS };
