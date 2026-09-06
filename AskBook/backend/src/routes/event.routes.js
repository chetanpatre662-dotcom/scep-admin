/**
 * routes/event.routes.js
 * -----------------------------------------------------------------------------
 * GLOBAL events API. Mounted at /api.
 *
 *   GET    /api/events           any authenticated user (faculty + student read
 *                                the SAME global dataset). Optional ?status=.
 *   POST   /api/events           faculty or admin only.
 *   PATCH  /api/events/:id/status  owner or admin (archive/restore).
 *   DELETE /api/events/:id       owner or admin.
 *
 * Role/identity is resolved server-side from the verified Firebase UID; the
 * client never supplies role/ownership.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const eventService = require('../services/eventService');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

/** Resolve the current DB user, or 404 if there's no application profile. */
async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

/** GET /api/events — global read for any authenticated user. */
router.get('/events', requireAuth, async (req, res, next) => {
  try {
    const status = req.query.status || undefined;
    const events = await eventService.listEvents({ status });
    res.status(200).json({ success: true, events });
  } catch (err) {
    next(err);
  }
});

/** POST /api/events — faculty or admin. */
router.post('/events', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (user.role !== 'faculty' && user.role !== 'admin') {
      return next(new ApiError(403, 'Only faculty or admins can create events.', { code: 'FORBIDDEN' }));
    }
    const event = await eventService.createEvent(req.body || {}, user);
    res.status(201).json({ success: true, message: 'Event created.', event });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/events/:id/status — owner or admin. */
router.patch('/events/:id/status', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const event = await eventService.setStatus(req.params.id, (req.body || {}).status, user);
    res.status(200).json({ success: true, message: 'Event updated.', event });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/events/:id — owner or admin. */
router.delete('/events/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await eventService.deleteEvent(req.params.id, user);
    res.status(200).json({ success: true, message: 'Event deleted.', ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
