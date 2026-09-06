/**
 * services/notificationService.js
 * -----------------------------------------------------------------------------
 * Per-user notifications. PostgreSQL is the persistence + unread-count source of
 * truth; realtime delivery is via the WebSocket pipeline (notifyBus) — NO
 * polling. Notifications are generated from real events (announcement published,
 * new class content, etc.), never hardcoded.
 * -----------------------------------------------------------------------------
 */
'use strict';

const notificationRepository = require('../repositories/notificationRepository');
const { notifyUser } = require('../realtime/notifyBus');

function toNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body || '',
    link: row.link || null,
    refType: row.ref_type || null,
    refId: row.ref_id || null,
    read: row.is_read === true,
    createdAt: row.created_at,
  };
}

/** List a user's latest notifications + unread count. */
async function listForUser(user, { limit } = {}) {
  const [rows, unread] = await Promise.all([
    notificationRepository.listByUser(user.id, { limit }),
    notificationRepository.unreadCount(user.id),
  ]);
  return { items: rows.map(toNotification), unread };
}

async function unreadCount(user) {
  return notificationRepository.unreadCount(user.id);
}

/** Create one notification for a single user + push it live. */
async function createForUser(userId, payload) {
  const row = await notificationRepository.insertOne({ userId, ...payload });
  const dto = toNotification(row);
  notifyUser(userId, 'notification.created', { notification: dto });
  return dto;
}

/** Fan out the same notification to many users (announcement targeting). */
async function createForUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return 0;
  await notificationRepository.insertForUsers(ids, payload);
  // Push a lightweight live event to each connected user (they can refetch or
  // just bump their unread badge). We don't have the per-row ids cheaply here,
  // so send a generic "refresh" signal; the client fetches the latest feed.
  ids.forEach((uid) => notifyUser(uid, 'notification.created', { notification: null }));
  return ids.length;
}

async function markRead(user, id) {
  const r = await notificationRepository.markRead(user.id, id);
  return { ok: Boolean(r) };
}

async function markAllRead(user) {
  const n = await notificationRepository.markAllRead(user.id);
  return { ok: true, updated: n };
}

module.exports = { listForUser, unreadCount, createForUser, createForUsers, markRead, markAllRead, toNotification };
