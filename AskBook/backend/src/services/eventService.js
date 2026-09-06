/**
 * services/eventService.js
 * -----------------------------------------------------------------------------
 * GLOBAL events business logic. Reads are shared by all authenticated faculty
 * and students. Creation is limited to faculty/admin; archive/delete to the
 * creator or an admin. Role is taken from the verified DB user (never client).
 *
 * The public shape matches what the existing event UI + common/events.js
 * expect: { id, title, type, datetime(ISO), venue, description, banner,
 * brochure, status, createdBy, createdByName }. `datetime` is composed from
 * event_date + start_time so eventCardHTML works unchanged. banner/brochure are
 * always null for now (file storage is a future feature — not fabricated).
 * -----------------------------------------------------------------------------
 */
'use strict';

const eventRepository = require('../repositories/eventRepository');
const ApiError = require('../utils/ApiError');

/** Compose an ISO datetime string from a DATE + optional TIME. */
function toDatetime(eventDate, startTime) {
  if (!eventDate) return null;
  // event_date comes back as a Date (midnight) or 'YYYY-MM-DD'; normalize.
  const d = eventDate instanceof Date ? eventDate.toISOString().slice(0, 10) : String(eventDate).slice(0, 10);
  const t = startTime ? String(startTime).slice(0, 5) : '00:00';
  return `${d}T${t}:00`;
}

function toEvent(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type || 'Seminar',
    description: row.description || '',
    datetime: toDatetime(row.event_date, row.start_time),
    venue: row.location || '',
    location: row.location || '',
    startTime: row.start_time || null,
    endTime: row.end_time || null,
    status: row.status,
    banner: null,     // file storage not implemented yet (do not fabricate)
    brochure: null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || 'Staff',
    createdAt: row.created_at,
  };
}

/** List events (optional status filter). Global for all authenticated users. */
async function listEvents({ status } = {}) {
  const rows = await eventRepository.list({ status });
  return rows.map(toEvent);
}

/** Split an incoming `datetime` (ISO/local) into date + time parts. */
function splitDatetime(datetime) {
  if (!datetime) return { date: null, time: null };
  const m = String(datetime).match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (!m) return { date: null, time: null };
  return { date: m[1], time: m[2] || null };
}

/**
 * Create a global event. Caller must be faculty or admin (checked by route via
 * requireEventCreator). `requester` is the verified DB user (req.dbUser or the
 * resolved user); its id becomes created_by.
 */
async function createEvent(input, requester) {
  const title = String(input.title || '').trim();
  if (!title) throw new ApiError(400, 'Event title is required.', { code: 'VALIDATION_ERROR' });

  // Accept either a combined `datetime` or explicit event_date/start_time.
  let date = input.eventDate || null;
  let time = input.startTime || null;
  if (input.datetime) {
    const parts = splitDatetime(input.datetime);
    date = date || parts.date;
    time = time || parts.time;
  }
  if (!date) throw new ApiError(400, 'A valid event date is required.', { code: 'VALIDATION_ERROR' });

  const row = await eventRepository.insert({
    title,
    type: input.type ? String(input.type).trim() : null,
    description: input.description ? String(input.description).trim() : null,
    eventDate: date,
    startTime: time,
    endTime: input.endTime || null,
    location: input.venue ? String(input.venue).trim() : (input.location ? String(input.location).trim() : null),
    createdBy: requester ? requester.id : null,
    createdByName: (requester && (requester.display_name || requester.email)) || 'Staff',
  });
  return toEvent(row);
}

/** Load an event or 404. */
async function requireEvent(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new ApiError(400, 'Invalid event id.', { code: 'INVALID_ID' });
  }
  const row = await eventRepository.findById(numId);
  if (!row) throw new ApiError(404, 'Event not found.', { code: 'EVENT_NOT_FOUND' });
  return row;
}

/** Owner (creator) or admin may mutate. */
function assertCanMutate(row, requester) {
  const isAdmin = requester && requester.role === 'admin';
  const isOwner = requester && row.created_by != null && Number(row.created_by) === Number(requester.id);
  if (!isAdmin && !isOwner) {
    throw new ApiError(403, 'You can only modify events you created.', { code: 'NOT_EVENT_OWNER' });
  }
}

/** Archive/restore an event (owner or admin). */
async function setStatus(id, status, requester) {
  if (!['active', 'archived'].includes(status)) {
    throw new ApiError(400, 'Invalid status.', { code: 'VALIDATION_ERROR' });
  }
  const row = await requireEvent(id);
  assertCanMutate(row, requester);
  const updated = await eventRepository.updateStatus(row.id, status);
  return toEvent(updated);
}

/** Delete an event (owner or admin). */
async function deleteEvent(id, requester) {
  const row = await requireEvent(id);
  assertCanMutate(row, requester);
  await eventRepository.deleteById(row.id);
  return { id: row.id };
}

module.exports = { listEvents, createEvent, setStatus, deleteEvent, toEvent };
