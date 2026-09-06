/**
 * services/classService.js
 * -----------------------------------------------------------------------------
 * Faculty/Student class business logic (distinct from admin classAdminService).
 *
 *   - createClass: authenticated faculty creates a real class. The subject must
 *     be a real admin-configured subject that belongs to the chosen
 *     Course+Branch+Semester (validated via subjectService.verifySubjectInGroup).
 *   - listForFaculty: classes owned by the authenticated faculty.
 *   - listForStudent: classes matching the student's own profile group.
 *   - getClassForUser: bootstrap detail load with server-side access control
 *     (faculty owner OR student in the matching academic group).
 *
 * PostgreSQL is the source of truth. Identity/role come from the verified user;
 * nothing (classId scope, role, group) is trusted from the client.
 * -----------------------------------------------------------------------------
 */
'use strict';

const classRepository = require('../repositories/classRepository');
const subjectService = require('../services/subjectService');
const facultyRepository = require('../repositories/facultyRepository');
const studentRepository = require('../repositories/studentRepository');
const ApiError = require('../utils/ApiError');

function yearFromSemester(semester) {
  const s = Number(semester);
  return s ? Math.ceil(s / 2) : null;
}

/** Public class shape. `subject` = the admin subject name; `title` optional. */
function toClass(row) {
  return {
    id: row.id,
    title: row.title || row.subject_name || 'Class',
    subject: row.subject_name || null,
    subjectId: row.subject_id != null ? row.subject_id : (row.course_id != null ? row.course_id : null),
    subjectCode: row.subject_code || null,
    course: row.program,
    branch: row.branch,
    semester: row.semester,
    year: yearFromSemester(row.semester),
    description: row.description || null,
    status: row.status,
    facultyId: row.faculty_id,
    facultyName: row.faculty_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Resolve the faculty profile row for a verified user, or 403/409. */
async function requireFaculty(user) {
  if (!user) throw new ApiError(401, 'Authentication required.', { code: 'AUTH_REQUIRED' });
  // Only faculty or admin may create/own classes.
  if (user.role !== 'faculty' && user.role !== 'admin') {
    throw new ApiError(403, 'Only faculty can create classes.', { code: 'FACULTY_REQUIRED' });
  }
  // A pending/rejected faculty (or admin) must be approved before acting.
  if (user.status && user.status !== 'approved') {
    throw new ApiError(403, 'Your account is pending approval.', { code: 'ACCOUNT_PENDING' });
  }
  const faculty = await facultyRepository.findByUserId(user.id);
  if (!faculty) {
    throw new ApiError(409, 'Your faculty profile is incomplete. Please complete it first.', {
      code: 'NO_FACULTY_PROFILE',
    });
  }
  return faculty;
}

/**
 * Create a class owned by the authenticated faculty.
 * @param {object} user - verified DB user (id, role)
 * @param {object} input - { subjectId, program(course), branch, semester, title?, description? }
 */
async function createClass(user, input = {}) {
  const faculty = await requireFaculty(user);

  const group = { program: input.program, branch: input.branch, semester: input.semester };
  // Validate the subject belongs to this exact Course+Branch+Semester.
  const subject = await subjectService.verifySubjectInGroup(input.subjectId, group);

  try {
    const row = await classRepository.insert({
      subjectId: subject.id,
      facultyId: faculty.id,
      program: subject.program,   // canonical values from the catalog
      branch: subject.branch,
      semester: subject.semester,
      title: input.title ? String(input.title).trim() : subject.name,
      description: input.description ? String(input.description).trim() : null,
    });
    // Re-read with joins for a consistent shape.
    const detail = await classRepository.findDetailById(row.id);
    return toClass(detail);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'A class for this subject already exists for this course, branch and semester.', {
        code: 'DUPLICATE_CLASS',
      });
    }
    throw err;
  }
}

/** Classes owned by the authenticated faculty. */
async function listForFaculty(user) {
  const faculty = await requireFaculty(user);
  const rows = await classRepository.list({ facultyId: faculty.id });
  return rows.map(toClass);
}

/** Classes matching the authenticated student's own profile group. */
async function listForStudent(user) {
  if (!user) throw new ApiError(401, 'Authentication required.', { code: 'AUTH_REQUIRED' });
  const student = await studentRepository.findByUserId(user.id);
  if (!student) {
    throw new ApiError(409, 'Your student profile is incomplete. Please complete it first.', {
      code: 'NO_STUDENT_PROFILE',
    });
  }
  const rows = await classRepository.list({
    program: student.program,
    branch: student.branch,
    semester: student.semester,
  });
  return rows.map(toClass);
}

/**
 * Determine whether a user may access a class, and return the class detail.
 * Faculty: must own the class (or be admin). Student: profile group must match.
 * Throws 403/404 otherwise. Returns { class, role: 'faculty'|'student'|'admin' }.
 */
async function getClassForUser(user, classId) {
  if (!user) throw new ApiError(401, 'Authentication required.', { code: 'AUTH_REQUIRED' });
  const detail = await classRepository.findDetailById(classId);
  if (!detail) throw new ApiError(404, 'Class not found.', { code: 'CLASS_NOT_FOUND' });

  if (user.role === 'admin') {
    return { class: toClass(detail), access: 'admin' };
  }

  if (user.role === 'faculty') {
    const faculty = await facultyRepository.findByUserId(user.id);
    if (faculty && detail.faculty_id != null && Number(detail.faculty_id) === Number(faculty.id)) {
      return { class: toClass(detail), access: 'faculty' };
    }
    throw new ApiError(403, 'You do not have access to this class.', { code: 'CLASS_FORBIDDEN' });
  }

  // Student: academic group must match the class group exactly.
  const student = await studentRepository.findByUserId(user.id);
  if (
    student &&
    student.program === detail.program &&
    student.branch === detail.branch &&
    Number(student.semester) === Number(detail.semester)
  ) {
    return { class: toClass(detail), access: 'student' };
  }
  throw new ApiError(403, 'This class is not part of your course, branch and semester.', {
    code: 'CLASS_FORBIDDEN',
  });
}

module.exports = { createClass, listForFaculty, listForStudent, getClassForUser, requireFaculty, toClass };
