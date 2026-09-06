/**
 * routes/auth.routes.js
 * -----------------------------------------------------------------------------
 * Authentication-related routes.
 *
 *   GET  /api/auth/verify — protected identity echo (Firebase token only).
 *   POST /api/auth/sync   — provision-or-fetch the PostgreSQL user for the
 *                           verified Firebase identity (first login creates the
 *                           row with the safe default role 'student').
 *   GET  /api/auth/me     — return the current PostgreSQL user; 404 if none.
 *
 * All routes are protected by the existing requireAuth middleware (verifies the
 * Firebase ID token and attaches req.user). Role is NEVER read from the request
 * body — it is owned by the server (PostgreSQL). Errors flow through ApiError +
 * the central errorHandler so DB/Firebase internals are never exposed.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const userService = require('../services/userService');
const ApiError = require('../utils/ApiError');

const router = express.Router();

/** Shape a DB user row into a stable public JSON profile. */
function toProfile(user) {
  return {
    id: user.id,
    firebaseUid: user.firebase_uid,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * GET /api/auth/verify — protected identity echo.
 * Returns the verified Firebase identity attached by requireAuth.
 * (Unchanged behavior — does not touch PostgreSQL.)
 */
router.get('/verify', requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Token verified',
    user: {
      uid: req.user.uid,
      email: req.user.email,
      emailVerified: req.user.emailVerified,
      name: req.user.name,
    },
  });
});

/**
 * POST /api/auth/sync — link the verified Firebase identity to a PostgreSQL
 * user. Creates the row on first login (role defaults to 'student'); otherwise
 * returns the existing user (role preserved). No role is accepted from the body.
 */
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const { user, created } = await userService.syncUser(req.user.firebase);
    res.status(created ? 201 : 200).json({
      success: true,
      message: created ? 'User provisioned' : 'User synced',
      created,
      user: toProfile(user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me — return the current PostgreSQL user for the verified UID.
 * Returns 404 (does NOT create a user) when no profile exists yet.
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await userService.getByFirebaseUid(req.user.uid);
    if (!user) {
      return next(
        new ApiError(404, 'No application profile found for this account.', {
          code: 'USER_NOT_FOUND',
        })
      );
    }
    res.status(200).json({ success: true, user: toProfile(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
