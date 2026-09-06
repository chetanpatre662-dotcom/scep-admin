/**
 * repositories/messageRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for class_messages. Parameterized SQL only. Efficiently queryable
 * by (class_id, created_at) — indexed in migrations. Cursor pagination uses the
 * message id as a stable cursor (ids are monotonic).
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS =
  'm.id, m.class_id, m.sender_user_id, m.message, m.message_type, m.file_id, m.created_at, u.display_name AS sender_name, u.role AS sender_role';

/**
 * Latest messages for a class, optionally older than a cursor id (`before`).
 * Returns rows in ASCENDING created order (oldest→newest) for easy rendering.
 * @param {number} classId
 * @param {{limit?:number, before?:number}} opts
 */
async function listByClass(classId, { limit = 50, before } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = [classId];
  let cursor = '';
  if (before) { params.push(Number(before)); cursor = `AND m.id < $${params.length}`; }
  params.push(lim);
  const { rows } = await query(
    `SELECT * FROM (
       SELECT ${COLS}
         FROM class_messages m
         LEFT JOIN users u ON u.id = m.sender_user_id
        WHERE m.class_id = $1 ${cursor}
        ORDER BY m.id DESC
        LIMIT $${params.length}
     ) sub ORDER BY sub.id ASC`,
    params
  );
  return rows;
}

/** Insert a message; returns the full joined row (server-authoritative). */
async function insert({ classId, senderUserId, message, messageType = 'text', fileId = null }) {
  const { rows } = await query(
    `INSERT INTO class_messages (class_id, sender_user_id, message, message_type, file_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [classId, senderUserId, message, messageType, fileId]
  );
  const id = rows[0].id;
  const { rows: full } = await query(
    `SELECT ${COLS} FROM class_messages m LEFT JOIN users u ON u.id = m.sender_user_id WHERE m.id = $1`,
    [id]
  );
  return full[0];
}

module.exports = { listByClass, insert };
