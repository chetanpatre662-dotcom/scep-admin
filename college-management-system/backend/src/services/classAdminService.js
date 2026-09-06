/**
 * services/classAdminService.js
 * -----------------------------------------------------------------------------
 * Admin-facing class listing/deletion. Classes are CREATED by faculty (Phase
 * C2), so admin operations here are: list (with real DB-backed filters) and
 * delete. Only schema-backed fields are exposed — no fabricated room/schedule.
 * -----------------------------------------------------------------------------
 */
'use strict';

const classRepository = require('../repositories/classRepository');
const ApiError = require('../utils/ApiError');

function toClass(row) {
  return {
    id: row.id,
    course: row.program,          // Course (denormalized on the class)
    branch: row.branch,
    semester: row.semester,
    subject: row.subject_name || null,   // from courses.name via course_id
    facultyId: row.faculty_id,
    facultyName: row.faculty_name || null,
    facultyDepartment: row.faculty_department || null,
    status: row.status,
    description: row.description || null,
    createdAt: row.created_at,
  };
}

/** List classes with optional filters. */
async function listClasses(filter = {}) {
  const rows = await classRepository.list(filter);
  return rows.map(toClass);
}

/** Delete a class by id. */
async function deleteClass(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new ApiError(400, 'Invalid class id.', { code: 'INVALID_ID' });
  }
  const existing = await classRepository.findById(numId);
  if (!existing) throw new ApiError(404, 'Class not found.', { code: 'CLASS_NOT_FOUND' });
  const deleted = await classRepository.deleteById(numId);
  return { id: deleted.id };
}

/** Faculty that currently own classes (for the faculty filter dropdown). */
async function facultyFilterOptions() {
  const rows = await classRepository.facultyWithClasses();
  return rows.map((r) => ({ id: r.id, name: r.full_name }));
}

module.exports = { listClasses, deleteClass, facultyFilterOptions, toClass };
