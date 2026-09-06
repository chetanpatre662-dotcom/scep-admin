/**
 * announcementService.js — Real announcements API client.
 * -----------------------------------------------------------------------------
 * Backend is the source of truth (PostgreSQL). Faculty manage their own
 * announcements; students receive a server-targeted, published-only feed based
 * on their real DB academic profile. No mock, no localStorage.
 *
 * Result objects: { ok:true, ... } | { ok:false, error, status }.
 * -----------------------------------------------------------------------------
 */
import { apiCall } from './httpService.js';

/** Faculty (own) or admin (all) announcements. */
export async function getAnnouncements() {
  const r = await apiCall('/faculty/announcements', { method: 'GET' });
  return r.ok ? { ok: true, items: r.items || [] } : r;
}

/** Student targeted, published-only feed (backend applies audience matching). */
export async function getForStudent() {
  const r = await apiCall('/student/announcements', { method: 'GET' });
  return r.ok ? { ok: true, items: r.items || [] } : r;
}

export async function createAnnouncement(data) {
  const r = await apiCall('/announcements', { method: 'POST', body: data });
  return r.ok ? { ok: true, data: r.item } : r;
}

export async function updateAnnouncement(id, data) {
  const r = await apiCall(`/announcements/${encodeURIComponent(id)}`, { method: 'PATCH', body: data });
  return r.ok ? { ok: true, data: r.item } : r;
}

export async function deleteAnnouncement(id) {
  return apiCall(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
