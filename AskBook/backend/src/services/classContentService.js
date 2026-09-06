/**
 * services/classContentService.js
 * -----------------------------------------------------------------------------
 * Business logic for class content: notes, question_papers, assignments,
 * projects. Faculty (owner/admin) may create/update/delete; students may only
 * read. Access is enforced via classService.getClassForUser (server-side).
 *
 * On create/update/delete, a realtime event is broadcast to the class room via
 * realtimeBus (e.g. 'note.created'). PostgreSQL is the source of truth; the
 * broadcast is delivery only.
 *
 * File attachments: the schema is ready (file_* columns + files table), but
 * actual binary upload is gated on Firebase Storage (storageService). This pass
 * persists text/metadata only and never fabricates file URLs.
 * -----------------------------------------------------------------------------
 */
'use strict';

const repo = require('../repositories/classContentRepository');
const classService = require('./classService');
const classRepository = require('../repositories/classRepository');
const studentRepository = require('../repositories/studentRepository');
const fileService = require('./fileService');
const { query } = require('../config/database');
const { broadcastToClass } = require('../realtime/realtimeBus');
const ApiError = require('../utils/ApiError');

// content entityType -> the DB table (for backfilling file_* columns).
const CONTENT_TABLE = {
  note: 'notes',
  question_paper: 'question_papers',
  assignment: 'assignments',
  project: 'projects',
};

// Map entityType -> realtime event prefix.
const EVENT_PREFIX = {
  note: 'note',
  question_paper: 'questionPaper',
  assignment: 'assignment',
  project: 'project',
};

function toContent(entityType, row) {
  return {
    id: row.id,
    type: entityType,
    classId: row.class_id,
    authorId: row.author_id,
    title: row.title,
    description: row.description || null,
    dueDate: row.due_date || null,
    file: (row.file_id || row.file_url)
      ? {
          id: row.file_id || null,
          name: row.file_name,
          type: row.file_type || row.file_mime || null,
          size: row.file_size != null ? Number(row.file_size) : null,
          // storagePath kept server-side; clients download via /files/:id/download.
          storagePath: row.file_url || null,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Any authorized class member (faculty owner/admin/eligible student) may read. */
async function list(user, classId, entityType) {
  await classService.getClassForUser(user, classId); // throws 403/404 if not allowed
  const rows = await repo.listByClass(entityType, classId);
  return rows.map((r) => toContent(entityType, r));
}

/** Only faculty owner (or admin) may publish/modify content. */
async function assertFacultyAccess(user, classId) {
  const { access } = await classService.getClassForUser(user, classId);
  if (access !== 'faculty' && access !== 'admin') {
    throw new ApiError(403, 'Only the class faculty can manage this content.', { code: 'CONTENT_FORBIDDEN' });
  }
  return access;
}

async function create(user, classId, entityType, input = {}, uploadedFile = null) {
  await assertFacultyAccess(user, classId);
  const title = String(input.title || '').trim();
  if (!title) throw new ApiError(400, 'Title is required.', { code: 'VALIDATION_ERROR' });

  const params = {
    classId: Number(classId),
    authorId: user.id,
    title,
    description: input.description ? String(input.description).trim() : null,
    dueDate: input.dueDate || null,
  };
  // question_papers needs the class's subject (course_id).
  if (entityType === 'question_paper') {
    const cls = await classRepository.findById(classId);
    params.courseId = cls ? cls.course_id : null;
  }

  const row = await repo.insert(entityType, params);

  // Optional real attachment: upload to Firebase Storage, persist metadata,
  // and backfill the content row's file_* columns + files.entity_id.
  let fileRef = null;
  if (uploadedFile && uploadedFile.buffer) {
    const f = await fileService.uploadFor({
      buffer: uploadedFile.buffer,
      mimeType: uploadedFile.mimetype,
      originalFilename: uploadedFile.originalname,
      classId: Number(classId),
      entityType,
      uploadedBy: user.id,
    });
    await fileService.linkEntity(f.id, row.id);
    const url = await fileService.signedUrlForFile(await fileService.findById(f.id));
    const table = CONTENT_TABLE[entityType];
    await query(
      `UPDATE ${table} SET file_url = $2, file_name = $3, file_type = $4 WHERE id = $1`,
      [row.id, f.storagePath, f.name, f.mimeType]
    );
    row.file_url = f.storagePath; row.file_name = f.name; row.file_type = f.mimeType;
    fileRef = { id: f.id, name: f.name, type: f.mimeType, size: f.size, url };
  }

  const content = toContent(entityType, row);
  if (fileRef) content.file = fileRef;
  broadcastToClass(Number(classId), `${EVENT_PREFIX[entityType]}.created`, content);
  // Notify students in this class's academic group (best-effort, non-blocking).
  notifyClassStudents(Number(classId), entityType, title).catch(() => {});
  return content;
}

/** Best-effort: notify students of a class about new content. */
async function notifyClassStudents(classId, entityType, title) {
  const notificationService = require('./notificationService');
  const cls = await classRepository.findById(classId);
  if (!cls) return;
  const students = await studentRepository.findMatching({
    program: cls.program, branch: cls.branch, semester: cls.semester,
  });
  const label = { note: 'note', question_paper: 'question paper', assignment: 'assignment', project: 'project' }[entityType] || 'item';
  await notificationService.createForUsers(
    students.map((s) => s.user_id),
    { type: entityType, title: `New ${label}: ${title}`, refType: entityType, refId: classId, link: `/student/class.html?id=${classId}` }
  );
}

async function update(user, classId, entityType, id, input = {}) {
  await assertFacultyAccess(user, classId);
  const existing = await repo.findById(entityType, id);
  if (!existing || Number(existing.class_id) !== Number(classId)) {
    throw new ApiError(404, 'Content not found in this class.', { code: 'CONTENT_NOT_FOUND' });
  }
  const title = String(input.title ?? existing.title).trim();
  if (!title) throw new ApiError(400, 'Title is required.', { code: 'VALIDATION_ERROR' });
  const row = await repo.update(entityType, id, {
    title,
    description: input.description !== undefined ? (input.description ? String(input.description).trim() : null) : undefined,
    dueDate: input.dueDate,
  });
  const content = toContent(entityType, row);
  broadcastToClass(Number(classId), `${EVENT_PREFIX[entityType]}.updated`, content);
  return content;
}

async function remove(user, classId, entityType, id) {
  await assertFacultyAccess(user, classId);
  const existing = await repo.findById(entityType, id);
  if (!existing || Number(existing.class_id) !== Number(classId)) {
    throw new ApiError(404, 'Content not found in this class.', { code: 'CONTENT_NOT_FOUND' });
  }
  await repo.remove(entityType, id);
  broadcastToClass(Number(classId), `${EVENT_PREFIX[entityType]}.deleted`, { id: Number(id), type: entityType, classId: Number(classId) });
  return { id: Number(id) };
}

module.exports = { list, create, update, remove, toContent };
