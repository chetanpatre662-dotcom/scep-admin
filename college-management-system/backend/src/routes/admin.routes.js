/**
 * routes/admin.routes.js
 * -----------------------------------------------------------------------------
 * Admin-only user management. Every route is protected by:
 *   requireAuth   -> verifies the Firebase ID token, sets req.user (uid)
 *   requireAdmin  -> loads the PostgreSQL user, enforces role='admin', sets
 *                    req.dbUser (the verified admin)
 *
 * Role is never accepted from the client. The specific role transitions are
 * fixed by the endpoint (approve-faculty / make-admin), not by a body field.
 *
 *   GET    /api/admin/stats                       dashboard counts
 *   GET    /api/admin/users                       list users (+profiles)
 *   PATCH  /api/admin/users/:id/approve-faculty   student -> faculty
 *   PATCH  /api/admin/users/:id/make-admin        faculty -> admin
 *   DELETE /api/admin/users/:id                   delete user (PG + Firebase)
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const adminService = require('../services/adminService');
const subjectService = require('../services/subjectService');
const catalogService = require('../services/catalogService');
const classAdminService = require('../services/classAdminService');

const router = express.Router();

// All admin routes require an authenticated admin.
router.use(requireAuth, requireAdmin);

/** GET /api/admin/stats */
router.get('/stats', async (_req, res, next) => {
  try {
    const stats = await adminService.getStats();
    res.status(200).json({ success: true, stats });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/users */
router.get('/users', async (_req, res, next) => {
  try {
    const users = await adminService.listUsers();
    res.status(200).json({ success: true, users });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:id/approve-faculty */
router.patch('/users/:id/approve-faculty', async (req, res, next) => {
  try {
    const result = await adminService.approveFaculty(req.params.id);
    res.status(200).json({
      success: true,
      message: result.changed ? 'Faculty approved.' : 'User is already faculty.',
      changed: result.changed,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:id/make-admin */
router.patch('/users/:id/make-admin', async (req, res, next) => {
  try {
    const result = await adminService.makeAdmin(req.params.id);
    res.status(200).json({
      success: true,
      message: result.changed ? 'User promoted to admin.' : 'User is already admin.',
      changed: result.changed,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:id/approve-admin — approve a pending/rejected admin applicant. */
router.patch('/users/:id/approve-admin', async (req, res, next) => {
  try {
    const result = await adminService.approveAdmin(req.params.id);
    res.status(200).json({
      success: true,
      message: result.changed ? 'Admin approved.' : 'Admin is already approved.',
      changed: result.changed,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:id/reject — mark a pending faculty/admin applicant rejected. */
router.patch('/users/:id/reject', async (req, res, next) => {
  try {
    const result = await adminService.rejectUser(req.params.id, req.dbUser);
    res.status(200).json({
      success: true,
      message: result.changed ? 'Applicant rejected.' : 'No change.',
      changed: result.changed,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:id/remove-admin — admin -> faculty (no delete). */
router.patch('/users/:id/remove-admin', async (req, res, next) => {
  try {
    const result = await adminService.removeAdmin(req.params.id, req.dbUser);
    res.status(200).json({
      success: true,
      message: result.changed ? 'Admin role removed.' : 'User is not an admin.',
      changed: result.changed,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/users/:id */
router.delete('/users/:id', async (req, res, next) => {
  try {
    // req.dbUser is the verified admin (from requireAdmin) — used for self-delete guard.
    const result = await adminService.deleteUser(req.params.id, req.dbUser);
    res.status(200).json({
      success: true,
      message: result.partialFailure
        ? 'User removed from the database, but the Firebase account could not be deleted. Please remove it manually.'
        : 'User deleted.',
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Subject management (Course + Branch + Semester -> subjects)         */
/* ------------------------------------------------------------------ */

/** GET /api/admin/subjects?program=&branch=&semester= — list subjects. */
router.get('/subjects', async (req, res, next) => {
  try {
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

/** POST /api/admin/subjects — create a subject. */
router.post('/subjects', async (req, res, next) => {
  try {
    const subject = await subjectService.createSubject(req.body || {}, req.dbUser ? req.dbUser.id : null);
    res.status(201).json({ success: true, message: 'Subject added.', subject });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/subjects/:id — update a subject. */
router.patch('/subjects/:id', async (req, res, next) => {
  try {
    const subject = await subjectService.updateSubject(req.params.id, req.body || {});
    res.status(200).json({ success: true, message: 'Subject updated.', subject });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/subjects/:id — delete a subject. */
router.delete('/subjects/:id', async (req, res, next) => {
  try {
    const subject = await subjectService.deleteSubject(req.params.id);
    res.status(200).json({ success: true, message: 'Subject deleted.', subject });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/subjects/bulk — create many subjects atomically. */
router.post('/subjects/bulk', async (req, res, next) => {
  try {
    const result = await subjectService.createSubjectsBulk(req.body || {}, req.dbUser ? req.dbUser.id : null);
    res.status(201).json({
      success: true,
      message: `Added ${result.created.length} subject(s).`,
      created: result.created,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Academic catalog: Courses + Branches (Option B)                     */
/* ------------------------------------------------------------------ */

/** GET /api/admin/courses — list courses (with branch counts). */
router.get('/courses', async (_req, res, next) => {
  try {
    const courses = await catalogService.listCourses();
    res.status(200).json({ success: true, courses });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/courses — create a course. */
router.post('/courses', async (req, res, next) => {
  try {
    const course = await catalogService.createCourse(req.body || {});
    res.status(201).json({ success: true, message: 'Course added.', course });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/courses/:id/branches — branches for a course. */
router.get('/courses/:id/branches', async (req, res, next) => {
  try {
    const branches = await catalogService.listBranches(req.params.id);
    res.status(200).json({ success: true, branches });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/courses/:id/branches — add a branch to a course. */
router.post('/courses/:id/branches', async (req, res, next) => {
  try {
    const branch = await catalogService.createBranch(req.params.id, req.body || {});
    res.status(201).json({ success: true, message: 'Branch added.', branch });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Classes (real DB): list + delete + filter options                   */
/* ------------------------------------------------------------------ */

/** GET /api/admin/classes?program=&branch=&semester=&facultyId= */
router.get('/classes', async (req, res, next) => {
  try {
    const classes = await classAdminService.listClasses({
      program: req.query.program,
      branch: req.query.branch,
      semester: req.query.semester,
      facultyId: req.query.facultyId,
    });
    res.status(200).json({ success: true, classes });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/classes/faculty-options — faculty that own classes. */
router.get('/classes/faculty-options', async (_req, res, next) => {
  try {
    const faculty = await classAdminService.facultyFilterOptions();
    res.status(200).json({ success: true, faculty });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/classes/:id */
router.delete('/classes/:id', async (req, res, next) => {
  try {
    const result = await classAdminService.deleteClass(req.params.id);
    res.status(200).json({ success: true, message: 'Class deleted.', ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
