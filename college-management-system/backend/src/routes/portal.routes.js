/**
 * routes/portal.routes.js
 * -----------------------------------------------------------------------------
 * Faculty/Student dashboard aggregates + standalone question-paper listings.
 * All numbers are computed from real tables server-side.
 *
 *   GET /api/faculty/dashboard         real faculty aggregates + recent activity
 *   GET /api/student/dashboard         real student aggregates + profile
 *   GET /api/faculty/question-papers   papers across the faculty's classes
 *   GET /api/student/question-papers   papers for the student's academic group
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const portalService = require('../services/portalService');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

router.get('/faculty/dashboard', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const data = await portalService.facultyDashboard(user);
    res.status(200).json({ success: true, ...data });
  } catch (err) { next(err); }
});

router.get('/student/dashboard', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const data = await portalService.studentDashboard(user);
    res.status(200).json({ success: true, ...data });
  } catch (err) { next(err); }
});

router.get('/faculty/question-papers', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const items = await portalService.questionPapersForFaculty(user);
    res.status(200).json({ success: true, items });
  } catch (err) { next(err); }
});

router.get('/student/question-papers', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const items = await portalService.questionPapersForStudent(user);
    res.status(200).json({ success: true, items });
  } catch (err) { next(err); }
});

module.exports = router;
