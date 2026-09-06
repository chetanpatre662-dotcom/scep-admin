/**
 * routes/announcement.routes.js
 * -----------------------------------------------------------------------------
 * Announcements API (mounted at /api). Identity/role resolved server-side.
 *
 *   GET    /api/faculty/announcements   own (faculty) or all (admin)
 *   GET    /api/student/announcements   targeted published feed (student profile)
 *   POST   /api/announcements           faculty/admin create
 *   PATCH  /api/announcements/:id        owner or admin
 *   DELETE /api/announcements/:id        owner or admin
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const announcementService = require('../services/announcementService');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

router.get('/faculty/announcements', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const items = await announcementService.listForFaculty(user);
    res.status(200).json({ success: true, items });
  } catch (err) { next(err); }
});

router.get('/student/announcements', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const items = await announcementService.listForStudent(user);
    res.status(200).json({ success: true, items });
  } catch (err) { next(err); }
});

router.post('/announcements', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const item = await announcementService.create(user, req.body || {});
    res.status(201).json({ success: true, item });
  } catch (err) { next(err); }
});

router.patch('/announcements/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const item = await announcementService.update(user, req.params.id, req.body || {});
    res.status(200).json({ success: true, item });
  } catch (err) { next(err); }
});

router.delete('/announcements/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await announcementService.remove(user, req.params.id);
    res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
