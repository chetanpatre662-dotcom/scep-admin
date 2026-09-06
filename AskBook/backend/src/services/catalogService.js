/**
 * services/catalogService.js
 * -----------------------------------------------------------------------------
 * Business logic for the academic catalog (Courses + Branches). Validates input
 * and maps 23505 unique violations to friendly 409s. Admin-only writes are
 * enforced at the route layer (requireAdmin).
 * -----------------------------------------------------------------------------
 */
'use strict';

const catalogRepository = require('../repositories/catalogRepository');
const ApiError = require('../utils/ApiError');

function toCourse(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code || null,
    totalSemesters: row.total_semesters,
    branchCount: row.branch_count != null ? row.branch_count : undefined,
  };
}
function toBranch(row) {
  return { id: row.id, courseId: row.course_id, name: row.name };
}

/** All courses with branch counts. */
async function listCourses() {
  const rows = await catalogRepository.listCourses();
  return rows.map(toCourse);
}

/** Create a course. */
async function createCourse({ name, code, totalSemesters } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new ApiError(400, 'Course name is required.', { code: 'VALIDATION_ERROR' });

  let sems = Number(totalSemesters);
  if (!Number.isInteger(sems) || sems < 1 || sems > 12) sems = 8; // sensible default
  const cleanCode = code ? String(code).trim() : null;

  try {
    const row = await catalogRepository.insertCourse({ name: cleanName, code: cleanCode, totalSemesters: sems });
    return toCourse(row);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'A course with this name already exists.', { code: 'DUPLICATE_COURSE' });
    }
    throw err;
  }
}

/** Require a course by id or 404. */
async function requireCourse(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new ApiError(400, 'Invalid course id.', { code: 'INVALID_ID' });
  }
  const course = await catalogRepository.findCourseById(numId);
  if (!course) throw new ApiError(404, 'Course not found.', { code: 'COURSE_NOT_FOUND' });
  return course;
}

/** Branches for a course. */
async function listBranches(courseId) {
  await requireCourse(courseId);
  const rows = await catalogRepository.listBranches(courseId);
  return rows.map(toBranch);
}

/** Create a branch under a course. */
async function createBranch(courseId, { name } = {}) {
  const course = await requireCourse(courseId);
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new ApiError(400, 'Branch name is required.', { code: 'VALIDATION_ERROR' });
  try {
    const row = await catalogRepository.insertBranch({ courseId: course.id, name: cleanName });
    return toBranch(row);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'A branch with this name already exists for this course.', { code: 'DUPLICATE_BRANCH' });
    }
    throw err;
  }
}

/**
 * Resolve a Course NAME + Branch NAME against the catalog (used by subject
 * validation so subjects can only be created for catalog-known combinations).
 * Returns { course, branch } rows or throws 400.
 */
async function resolveByName(courseName, branchName) {
  const courses = await catalogRepository.listCourses();
  const course = courses.find((c) => c.name.toLowerCase() === String(courseName || '').trim().toLowerCase());
  if (!course) throw new ApiError(400, `Unknown course: ${courseName}`, { code: 'UNKNOWN_COURSE' });
  const branches = await catalogRepository.listBranches(course.id);
  const branch = branches.find((b) => b.name.toLowerCase() === String(branchName || '').trim().toLowerCase());
  if (!branch) throw new ApiError(400, `Unknown branch for ${course.name}: ${branchName}`, { code: 'UNKNOWN_BRANCH' });
  return { course, branch };
}

module.exports = {
  listCourses,
  createCourse,
  requireCourse,
  listBranches,
  createBranch,
  resolveByName,
  toCourse,
  toBranch,
};
