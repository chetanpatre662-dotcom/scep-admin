/**
 * routes/class.routes.js
 * -----------------------------------------------------------------------------
 * Faculty/Student real class endpoints (mounted at /api). Bootstrap/REST only;
 * live updates arrive via the WebSocket pipeline (later pass).
 *
 *   POST /api/classes                 create a class (faculty). Body:
 *                                      { subjectId, program, branch, semester, title?, description? }
 *   GET  /api/faculty/classes         classes owned by the authenticated faculty
 *   GET  /api/student/classes         classes matching the student's own group
 *   GET  /api/classes/:id             class detail bootstrap (access-checked)
 *
 * Identity/role resolved server-side from the verified Firebase UID.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const classService = require('../services/classService');
const classContentService = require('../services/classContentService');
const messageService = require('../services/messageService');
const fileService = require('../services/fileService');
const { broadcastToClass } = require('../realtime/realtimeBus');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// In-memory multipart parsing (files go straight to Firebase Storage, never to
// disk / never into PostgreSQL). 25 MB cap mirrors storageService.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Map URL segment -> content entityType.
const CONTENT_TYPES = {
  notes: 'note',
  'question-papers': 'question_paper',
  assignments: 'assignment',
  projects: 'project',
};

async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

/** POST /api/classes — faculty creates a class. */
router.post('/classes', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const cls = await classService.createClass(user, req.body || {});
    res.status(201).json({ success: true, message: 'Class created.', class: cls });
  } catch (err) {
    next(err);
  }
});

/** GET /api/faculty/classes — classes owned by the authenticated faculty. */
router.get('/faculty/classes', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const classes = await classService.listForFaculty(user);
    res.status(200).json({ success: true, classes });
  } catch (err) {
    next(err);
  }
});

/** GET /api/student/classes — classes for the student's own academic group. */
router.get('/student/classes', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const classes = await classService.listForStudent(user);
    res.status(200).json({ success: true, classes });
  } catch (err) {
    next(err);
  }
});

/** GET /api/classes/:id — access-checked class detail bootstrap. */
router.get('/classes/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await classService.getClassForUser(user, req.params.id);
    res.status(200).json({ success: true, class: result.class, access: result.access });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Class content: notes / question-papers / assignments / projects    */
/*   GET    list (any authorized member)                               */
/*   POST   create (faculty owner/admin)                               */
/*   PATCH  update (faculty owner/admin)                               */
/*   DELETE (faculty owner/admin)                                      */
/* Live updates are broadcast over WebSocket; these REST routes are    */
/* bootstrap + mutations only (no polling).                            */
/* ------------------------------------------------------------------ */

/** GET /api/classes/:id/messages?before=&limit= — history bootstrap + pagination.
 *  Registered BEFORE the generic /:content route so "messages" isn't captured. */
router.get('/classes/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await messageService.history(user, req.params.id, {
      limit: req.query.limit,
      before: req.query.before,
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/** GET /api/classes/:id/:content */
router.get('/classes/:id/:content', requireAuth, async (req, res, next) => {
  try {
    const entityType = CONTENT_TYPES[req.params.content];
    if (!entityType) return next(new ApiError(404, 'Unknown content type.', { code: 'NOT_FOUND' }));
    const user = await currentUser(req);
    const items = await classContentService.list(user, req.params.id, entityType);
    res.status(200).json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/classes/:id/:content — JSON (text-only) or multipart (with `file`). */
router.post('/classes/:id/:content', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const entityType = CONTENT_TYPES[req.params.content];
    if (!entityType) return next(new ApiError(404, 'Unknown content type.', { code: 'NOT_FOUND' }));
    const user = await currentUser(req);
    const item = await classContentService.create(user, req.params.id, entityType, req.body || {}, req.file || null);
    res.status(201).json({ success: true, item });
  } catch (err) {
    next(err);
  }
});

/** POST /api/classes/:id/messages/attachment — upload a message attachment. */
router.post('/classes/:id/messages/attachment', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const message = await messageService.sendAttachmentMessage(user, req.params.id, req.file, { text: (req.body || {}).text });
    // Broadcast the persisted attachment message (metadata only — no binary).
    broadcastToClass(Number(req.params.id), 'message.created', { message, clientMsgId: (req.body || {}).clientMsgId || null });
    res.status(201).json({ success: true, message });
  } catch (err) {
    next(err);
  }
});

/** GET /api/files/:id/download — access-checked signed URL redirect. */
router.get('/files/:id/download', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const fileRow = await fileService.findById(req.params.id);
    if (!fileRow) return next(new ApiError(404, 'File not found.', { code: 'FILE_NOT_FOUND' }));
    // Authorize by the file's class (throws 403/404 if not allowed).
    await classService.getClassForUser(user, fileRow.class_id);
    const url = await fileService.signedUrlForFile(fileRow);
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/classes/:id/:content/:itemId */
router.patch('/classes/:id/:content/:itemId', requireAuth, async (req, res, next) => {
  try {
    const entityType = CONTENT_TYPES[req.params.content];
    if (!entityType) return next(new ApiError(404, 'Unknown content type.', { code: 'NOT_FOUND' }));
    const user = await currentUser(req);
    const item = await classContentService.update(user, req.params.id, entityType, req.params.itemId, req.body || {});
    res.status(200).json({ success: true, item });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/classes/:id/:content/:itemId */
router.delete('/classes/:id/:content/:itemId', requireAuth, async (req, res, next) => {
  try {
    const entityType = CONTENT_TYPES[req.params.content];
    if (!entityType) return next(new ApiError(404, 'Unknown content type.', { code: 'NOT_FOUND' }));
    const user = await currentUser(req);
    const result = await classContentService.remove(user, req.params.id, entityType, req.params.itemId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
