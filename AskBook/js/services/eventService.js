/**
 * eventService.js — GLOBAL institute events (REAL backend).
 * -----------------------------------------------------------------------------
 * All authenticated faculty and students read the SAME events via GET /api/events
 * (no mock data, no per-user datasets). Create/archive/delete require the right
 * role/ownership, enforced server-side.
 *
 * Return shapes are kept compatible with the existing events UI:
 *   - getEvents(...)      -> resolves to an ARRAY of events (throws on failure so
 *                            the page can show a real error state — never a mock
 *                            fallback).
 *   - createEvent(...)    -> { ok, data? , error? }
 *   - setEventStatus(...) -> { ok, data? , error? }
 *   - deleteEvent(...)    -> { ok, error? }
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

async function token() {
  if (!ENV.AUTH_USE_BACKEND) throw new Error('Backend is disabled.');
  const t = await getIdToken();
  if (!t) { const e = new Error('Not authenticated.'); e.status = 401; throw e; }
  return t;
}

/**
 * All events (optionally filtered by status), soonest-first.
 * @param {{createdBy?:string, status?:string}} [opts]
 * @returns {Promise<object[]>} resolves to an array; THROWS on error.
 */
export async function getEvents({ status } = {}) {
  const t = await token();
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await authedRequest(`/events${qs}`, t, { method: 'GET' });
  const list = Array.isArray(res?.events) ? res.events : [];
  // Soonest-first by datetime (backend already orders, but keep stable).
  return list.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

/** Fetch a single event (from the global list). */
export async function getEvent(id) {
  const list = await getEvents();
  return list.find((e) => String(e.id) === String(id)) || null;
}

/**
 * Create a global event (faculty/admin only — enforced server-side).
 * @param {object} p { title, type, datetime, venue, description, ... }
 */
export async function createEvent(p) {
  try {
    const t = await token();
    const res = await authedRequest('/events', t, {
      method: 'POST',
      body: {
        title: p.title,
        type: p.type,
        datetime: p.datetime,
        venue: p.venue,
        description: p.description,
      },
    });
    return { ok: true, data: res?.event || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not create event.', status: e?.status };
  }
}

/** Archive/restore an event (owner or admin). */
export async function setEventStatus(id, status) {
  try {
    const t = await token();
    const res = await authedRequest(`/events/${encodeURIComponent(id)}/status`, t, { method: 'PATCH', body: { status } });
    return { ok: true, data: res?.event || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not update event.', status: e?.status };
  }
}

/** Delete an event (owner or admin). */
export async function deleteEvent(id) {
  try {
    const t = await token();
    await authedRequest(`/events/${encodeURIComponent(id)}`, t, { method: 'DELETE' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not delete event.', status: e?.status };
  }
}
