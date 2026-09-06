/**
 * services/subjectService.js
 * -----------------------------------------------------------------------------
 * Business logic for admin-managed SUBJECTS within a Course + Branch + Semester.
 * Subjects are stored in the `courses` table (see subjectRepository).
 *
 * Valid Course/Branch values come from the admin-managed catalog (course_catalog
 * + branches, migration 004) — NOT a hardcoded list. Each course defines its own
 * total_semesters, so the semester cap is per-course. The lookup key is
 * (program, branch, semester) so B.Tech CSE Sem 3 and Polytechnic CSE Sem 3 are
 * always kept separate.
 * -----------------------------------------------------------------------------
 */
'use strict';

const subjectRepository = require('../repositories/subjectRepository');
const catalogRepository = require('../repositories/catalogRepository');
const { pool } = require('../config/database');
const ApiError = require('../utils/ApiError');

/**
 * Validate a Course+Branch+Semester triple against the catalog. Async because
 * valid values are DB-driven now. Returns normalized { program, branch, semester }.
 */
async function validateGroup({ program, branch, semester }) {
  const p = String(program || '').trim();
  const b = String(branch || '').trim();
  const s = Number(semester);

  const courses = await catalogRepository.listCourses();
  const course = courses.find((c) => c.name.toLowerCase() === p.toLowerCase());
  if (!course) {
    throw new ApiError(400, `Unknown course: ${program}`, { code: 'UNKNOWN_COURSE' });
  }
  const branches = await catalogRepository.listBranches(course.id);
  const branchRow = branches.find((x) => x.name.toLowerCase() === b.toLowerCase());
  if (!branchRow) {
    throw new ApiError(400, `Unknown branch for ${course.name}: ${branch}`, { code: 'UNKNOWN_BRANCH' });
  }
  const maxSem = course.total_semesters || 8;
  if (!Number.isInteger(s) || s < 1 || s > maxSem) {
    throw new ApiError(400, `semester must be between 1 and ${maxSem} for ${course.name}.`, {
      code: 'VALIDATION_ERROR',
    });
  }
  // Use the canonical names from the catalog (consistent casing).
  return { program: course.name, branch: branchRow.name, semester: s };
}

/** Derive academic year from semester (not stored). */
function yearFromSemester(semester) {
  const s = Number(semester);
  return s ? Math.ceil(s / 2) : null;
}

/** Shape a courses row into a public subject object. */
function toSubject(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code || null,
    program: row.program,        // Course
    branch: row.branch,
    semester: row.semester,
    year: yearFromSemester(row.semester),
    description: row.description || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List subjects for a Course + Branch + Semester. */
async function listSubjects(filter) {
  const group = await validateGroup(filter);
  const rows = await subjectRepository.listByGroup(group);
  return rows.map(toSubject);
}

/** Create a single subject. `createdBy` = admin users.id. */
async function createSubject(input, createdBy) {
  const group = await validateGroup(input);
  const name = String(input.name || '').trim();
  if (!name) throw new ApiError(400, 'Subject name is required.', { code: 'VALIDATION_ERROR' });
  const code = input.code ? String(input.code).trim() : null;
  const description = input.description ? String(input.description).trim() : null;

  try {
    const row = await subjectRepository.insert({ name, code, description, createdBy, ...group });
    return toSubject(row);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'A subject with this name already exists for this course, branch and semester.', {
        code: 'DUPLICATE_SUBJECT',
      });
    }
    throw err;
  }
}

/**
 * Create MANY subjects for exactly ONE Course + Branch + Semester, atomically.
 * Either every subject is inserted or NONE are (single transaction).
 *
 * Validation before insert:
 *   - group (course/branch/semester) valid against the catalog
 *   - at least one subject; each name non-empty
 *   - no duplicate names WITHIN the request (case-insensitive)
 *   - no name that already EXISTS for this group (case-insensitive)
 * A unique-violation during insert also rolls the whole transaction back.
 *
 * @param {object} input { program, branch, semester, subjects: [{name, code?, description?} | string] }
 * @param {number|null} createdBy admin users.id
 * @returns {Promise<{created: object[]}>}
 */
async function createSubjectsBulk(input, createdBy) {
  const group = await validateGroup(input);

  // Normalize subjects: accept array of strings or {name, code?, description?}.
  const raw = Array.isArray(input.subjects) ? input.subjects : [];
  const items = raw
    .map((s) => (typeof s === 'string' ? { name: s } : s || {}))
    .map((s) => ({
      name: String(s.name || '').trim(),
      code: s.code ? String(s.code).trim() : null,
      description: s.description ? String(s.description).trim() : null,
    }))
    .filter((s) => s.name !== '');

  if (items.length === 0) {
    throw new ApiError(400, 'Provide at least one subject name.', { code: 'VALIDATION_ERROR' });
  }

  // In-request duplicates (case-insensitive).
  const seen = new Set();
  for (const it of items) {
    const key = it.name.toLowerCase();
    if (seen.has(key)) {
      throw new ApiError(409, `Duplicate subject in request: "${it.name}".`, { code: 'DUPLICATE_IN_REQUEST' });
    }
    seen.add(key);
  }

  // Existing duplicates for this exact group (case-insensitive).
  const existing = await subjectRepository.listByGroup(group);
  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));
  const clash = items.find((it) => existingNames.has(it.name.toLowerCase()));
  if (clash) {
    throw new ApiError(409, `Subject already exists for this course, branch and semester: "${clash.name}".`, {
      code: 'DUPLICATE_SUBJECT',
    });
  }

  // Atomic insert.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const it of items) {
      const { rows } = await client.query(
        `INSERT INTO courses (name, code, program, branch, semester, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, code, program, branch, semester, description, created_at, updated_at`,
        [it.name, it.code, group.program, group.branch, group.semester, it.description, createdBy]
      );
      created.push(toSubject(rows[0]));
    }
    await client.query('COMMIT');
    return { created };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      throw new ApiError(409, 'One or more subjects already exist for this course, branch and semester. No subjects were created.', {
        code: 'DUPLICATE_SUBJECT',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verify that a subjectId actually belongs to the given Course+Branch+Semester.
 * Used to validate faculty class creation server-side (never trust the subject
 * name/id combination sent by the client). Throws 400/404 on mismatch.
 *
 * @param {number|string} subjectId
 * @param {{program:string, branch:string, semester:number}} group
 * @returns {Promise<object>} the validated subject (public shape)
 */
async function verifySubjectInGroup(subjectId, group) {
  const g = await validateGroup(group); // normalizes + validates against catalog
  const numId = Number(subjectId);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new ApiError(400, 'A valid subjectId is required.', { code: 'INVALID_SUBJECT' });
  }
  const row = await subjectRepository.findById(numId);
  if (!row) throw new ApiError(404, 'Subject not found.', { code: 'SUBJECT_NOT_FOUND' });
  if (
    row.program !== g.program ||
    row.branch !== g.branch ||
    Number(row.semester) !== Number(g.semester)
  ) {
    throw new ApiError(400, 'The selected subject does not belong to this course, branch and semester.', {
      code: 'SUBJECT_GROUP_MISMATCH',
    });
  }
  return toSubject(row);
}

/** Load a subject or throw 404. */
async function requireSubject(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new ApiError(400, 'Invalid subject id.', { code: 'INVALID_ID' });
  }
  const row = await subjectRepository.findById(numId);
  if (!row) throw new ApiError(404, 'Subject not found.', { code: 'SUBJECT_NOT_FOUND' });
  return row;
}

/** Update a subject's name/code/description. */
async function updateSubject(id, input) {
  const existing = await requireSubject(id);
  const name = String(input.name ?? existing.name).trim();
  if (!name) throw new ApiError(400, 'Subject name is required.', { code: 'VALIDATION_ERROR' });
  const code = input.code !== undefined ? (input.code ? String(input.code).trim() : null) : existing.code;
  const description =
    input.description !== undefined ? (input.description ? String(input.description).trim() : null) : existing.description;

  try {
    const row = await subjectRepository.update(existing.id, { name, code, description });
    return toSubject(row);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'A subject with this name already exists for this course, branch and semester.', {
        code: 'DUPLICATE_SUBJECT',
      });
    }
    throw err;
  }
}

/** Delete a subject. */
async function deleteSubject(id) {
  const existing = await requireSubject(id);
  const row = await subjectRepository.remove(existing.id);
  return toSubject(row);
}

module.exports = {
  listSubjects,
  createSubject,
  createSubjectsBulk,
  updateSubject,
  deleteSubject,
  verifySubjectInGroup,
  validateGroup,
  toSubject,
};
