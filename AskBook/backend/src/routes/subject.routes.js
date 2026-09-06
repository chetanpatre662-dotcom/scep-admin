/**
 * routes/subject.routes.js
 * -----------------------------------------------------------------------------
 * Read-only subject endpoints for Student and Faculty panels. Admin subject
 * CRUD lives in admin.routes.js (admin-only).
 *
 *   GET /api/students/subjects
 *     - Auth required. Derives Course+Branch+Semester from the CURRENT student's
 *       own PostgreSQL profile (never from client params). Returns that
 *       semester's subjects. 404/409 if the caller has no student profile.
 *
 *   GET /api/faculty/subjects?program=&branch=&semester=
 *     - Auth required; caller must be role 'faculty' or 'admin'. Faculty browse
 *       arbitrary Course+Branch+Semester combinations (they teach across groups).
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const subjectService = require('../services/subjectService');
const catalogService = require('../services/catalogService');
const userRepository = require('../repositories/userRepository');
const studentRepository = require('../repositories/studentRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

/* ---- Read-only catalog for dropdowns (any authenticated user) ---- */

/** GET /api/catalog/courses — list courses (name, totalSemesters, branchCount). */
router.get('/catalog/courses', requireAuth, async (_req, res, next) => {
  try {
    const courses = await catalogService.listCourses();
    res.status(200).json({ success: true, courses });
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/courses/:id/branches — branches for a course. */
router.get('/catalog/courses/:id/branches', requireAuth, async (req, res, next) => {
  try {
    const branches = await catalogService.listBranches(req.params.id);
    res.status(200).json({ success: true, branches });
  } catch (err) {
    next(err);
  }
});

/** GET /api/students/subjects — subjects for the logged-in student's own group. */
router.get('/students/subjects', requireAuth, async (req, res, next) => {
  try {
    const user = await userRepository.findByFirebaseUid(req.user.uid);
    if (!user) {
      return next(new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' }));
    }
    const student = await studentRepository.findByUserId(user.id);
    if (!student) {
      return next(new ApiError(409, 'Your student profile is incomplete. Please complete your profile first.', {
        code: 'NO_STUDENT_PROFILE',
      }));
    }
    // Course+Branch+Semester come from the DB profile, not the client.
    const subjects = await subjectService.listSubjects({
      program: student.program,
      branch: student.branch,
      semester: student.semester,
    });
    res.status(200).json({
      success: true,
      context: {
        program: student.program,
        branch: student.branch,
        semester: student.semester,
      },
      subjects,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/faculty/subjects — subjects for a chosen Course+Branch+Semester. */
router.get('/faculty/subjects', requireAuth, async (req, res, next) => {
  try {
    const user = await userRepository.findByFirebaseUid(req.user.uid);
    if (!user || (user.role !== 'faculty' && user.role !== 'admin')) {
      return next(new ApiError(403, 'Faculty access required.', { code: 'FACULTY_REQUIRED' }));
    }
    const subjects = await subjectService.listSubjects({
      program: req.query.program,
      branch: req.query.branch,
      semester: req.query.semester,
    });
    res.status(200).json({ success: true, subjects });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
