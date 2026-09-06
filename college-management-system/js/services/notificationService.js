/**
 * notificationService.js — Real per-user notifications API client.
 * -----------------------------------------------------------------------------
 * Initial fetch over REST; live updates via the WebSocket pipeline
 * (realtimeService 'notification.created'). NO polling, no mock.
 * -----------------------------------------------------------------------------
 */
import { apiCall } from './httpService.js';

/** Latest notifications + unread count. */
export async function getNotifications({ limit = 20 } = {}) {
  const r = await apiCall(`/notifications?limit=${encodeURIComponent(limit)}`, { method: 'GET' });
  return r.ok ? { ok: true, items: r.items || [], unread: r.unread || 0 } : r;
}

export async function getUnreadCount() {
  const r = await apiCall('/notifications/unread', { method: 'GET' });
  return r.ok ? { ok: true, unread: r.unread || 0 } : r;
}

export async function markRead(id) {
  return apiCall(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function markAllRead() {
  return apiCall('/notifications/read-all', { method: 'POST' });
}
