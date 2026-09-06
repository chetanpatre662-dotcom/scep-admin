/**
 * routes/profile.routes.js
 * -----------------------------------------------------------------------------
 * Student/Faculty profile completion + status. All routes require a valid
 * Firebase token (requireAuth) and operate on the verified UID only.
 *
 *   POST /api/students/profile — save the current user's student profile.
 *   POST /api/faculty/profile  — save the current user's faculty profile
 *                                (does NOT grant the 'faculty' role).
 *   GET  /api/profile/status   — completion + role state for gating the UI.
 *
 * Role is NEVER read from the request body. It stays server-owned.
 * Errors flow through ApiError + the central errorHandler.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const profileService = require('../services/profileService');

const router = express.Router();

/** POST /api/students/profile */
router.post('/students/profile', requireAuth, async (req, res, next) => {
  try {
    const profile = await profileService.saveStudentProfile(req.user.uid, req.body || {});
    res.status(200).json({ success: true, message: 'Student profile saved', profile });
  } catch (err) {
    next(err);
  }
});

/** POST /api/faculty/profile */
router.post('/faculty/profile', requireAuth, async (req, res, next) => {
  try {
    const profile = await profileService.saveFacultyProfile(req.user.uid, req.body || {});
    res.status(200).json({
      success: true,
      message: 'Faculty profile saved. Awaiting admin approval for faculty access.',
      profile,
      // Faculty role is admin-granted; surface pending state explicitly.
      facultyPending: true,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/profile/status */
router.get('/profile/status', requireAuth, async (req, res, next) => {
  try {
    const status = await profileService.getProfileStatus(req.user.uid);
    res.status(200).json({ success: true, status });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/profile/me — the current user's full editable profile (view).
 * Identity is derived from the verified Firebase token; no id is accepted.
 */
router.get('/profile/me', requireAuth, async (req, res, next) => {
  try {
    const profile = await profileService.getMyProfile(req.user.uid);
    res.status(200).json({ success: true, profile });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/profile/me — update the current user's OWN profile only.
 * The user is resolved from the verified token; a client cannot target another
 * user by sending an id. Only safe fields are editable (never role/status/ids).
 */
router.patch('/profile/me', requireAuth, async (req, res, next) => {
  try {
    const profile = await profileService.updateMyProfile(req.user.uid, req.body || {});
    res.status(200).json({ success: true, message: 'Profile updated.', profile });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
