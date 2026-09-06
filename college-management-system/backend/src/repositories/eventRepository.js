/**
 * repositories/eventRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the GLOBAL events table. Parameterized SQL only. Reads are
 * global (no user filtering); the service layer applies optional status filter.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

const COLS =
  'id, title, type, description, event_date, start_time, end_time, location, status, created_by, created_by_name, created_at, updated_at';

/** List events (optionally by status), soonest event_date first. */
async function list({ status } = {}) {
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE status = $${params.length}`; }
  const { rows } = await query(
    `SELECT ${COLS} FROM events ${where} ORDER BY event_date ASC, start_time ASC NULLS LAST, id ASC`,
    params
  );
  return rows;
}

async function findById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM events WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function insert(e) {
  const { rows } = await query(
    `INSERT INTO events (title, type, description, event_date, start_time, end_time, location, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLS}`,
    [e.title, e.type, e.description, e.eventDate, e.startTime, e.endTime, e.location, e.createdBy, e.createdByName]
  );
  return rows[0];
}

async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE events SET status = $2 WHERE id = $1 RETURNING ${COLS}`,
    [id, status]
  );
  return rows[0] || null;
}

async function deleteById(id) {
  const { rows } = await query('DELETE FROM events WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

module.exports = { list, findById, insert, updateStatus, deleteById };
