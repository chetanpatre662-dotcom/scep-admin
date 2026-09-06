/**
 * routes/notification.routes.js
 * -----------------------------------------------------------------------------
 * Per-user notifications API (mounted at /api). Realtime delivery is via the
 * WebSocket pipeline; these endpoints are the initial fetch + read-state
 * mutations (NO polling).
 *
 *   GET   /api/notifications            latest feed + unread count
 *   GET   /api/notifications/unread     unread count only
 *   PATCH /api/notifications/:id/read   mark one read
 *   POST  /api/notifications/read-all   mark all read
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const data = await notificationService.listForUser(user, { limit: req.query.limit });
    res.status(200).json({ success: true, ...data });
  } catch (err) { next(err); }
});

router.get('/notifications/unread', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const unread = await notificationService.unreadCount(user);
    res.status(200).json({ success: true, unread });
  } catch (err) { next(err); }
});

router.patch('/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await notificationService.markRead(user, req.params.id);
    res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await notificationService.markAllRead(user);
    res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
