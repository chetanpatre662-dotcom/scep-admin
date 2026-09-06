/**
 * services/profileService.js
 * -----------------------------------------------------------------------------
 * Business logic for completing and reading Student/Faculty profiles, keyed to
 * the verified Firebase identity (via the PostgreSQL users row).
 *
 * SECURITY:
 *   - Role is server-owned. Nothing here reads or accepts a role from the
 *     client. Students self-provision as role 'student' (via userService).
 *     Faculty submitting a profile do NOT gain the 'faculty' role — that stays
 *     'student' until an admin promotes them (Option A). The route/response
 *     surfaces a "faculty pending" state so the frontend can gate access.
 *   - All domain values (program/branch/semester/department/designation) are
 *     re-validated here regardless of any frontend validation.
 * -----------------------------------------------------------------------------
 */
'use strict';

const userRepository = require('../repositories/userRepository');
const studentRepository = require('../repositories/studentRepository');
const facultyRepository = require('../repositories/facultyRepository');
const ApiError = require('../utils/ApiError');

/* ---- Authoritative domain constants (server side is the source of truth) ---- */
const PROGRAMS = ['Polytechnic', 'B.Tech'];
const BRANCHES = ['Computer Science', 'Mining', 'Electrical', 'Civil', 'Mechanical'];
const DEPARTMENTS = BRANCHES.slice();
const DESIGNATIONS = [
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'HOD',
  'Lecturer',
  'Lab Instructor',
];
const MAX_SEMESTER = { 'B.Tech': 8, Polytechnic: 6 };

/**
 * Normalize any mobile input to bare 10 Indian digits (server-side source of
 * truth for students/faculty). Strips a leading +91 / 91 / spaces / hyphens so
 * we never store values like "+919876543210" or "919876543210" in the
 * students.mobile_number / faculty.mobile_number columns.
 * @returns {string} up to 10 digits ('' if none)
 */
function normalizeMobile10(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

/** Indian mobile: EXACTLY 10 digits after normalization. */
const MOBILE_IN_RE = /^\d{10}$/;

function isNonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** Resolve the current PostgreSQL user for a verified UID, or 404. */
async function requireDbUser(firebaseUid) {
  const user = await userRepository.findByFirebaseUid(firebaseUid);
  if (!user) {
    throw new ApiError(404, 'No application profile found for this account.', {
      code: 'USER_NOT_FOUND',
    });
  }
  return user;
}

/**
 * Validate + save a student profile for the current verified user.
 * @param {string} firebaseUid - trusted UID from requireAuth
 * @param {object} input - { rollNumber, fullName, mobileNumber, program, branch, semester }
 */
async function saveStudentProfile(firebaseUid, input = {}) {
  const user = await requireDbUser(firebaseUid);

  const rollNumber = String(input.rollNumber || '').trim();
  const fullName = String(input.fullName || '').trim();
  const mobileNumber = normalizeMobile10(input.mobileNumber);
  const program = String(input.program || '').trim();
  const branch = String(input.branch || '').trim();
  const semester = Number(input.semester);

  const errors = [];
  if (!isNonEmpty(fullName)) errors.push('fullName is required.');
  if (!isNonEmpty(rollNumber)) errors.push('rollNumber is required.');
  if (!MOBILE_IN_RE.test(mobileNumber)) errors.push('A valid 10-digit mobileNumber is required.');
  if (!PROGRAMS.includes(program)) errors.push('program must be Polytechnic or B.Tech.');
  if (!BRANCHES.includes(branch)) errors.push('branch is invalid.');
  if (!Number.isInteger(semester) || semester < 1 || semester > (MAX_SEMESTER[program] || 0)) {
    errors.push(`semester must be between 1 and ${MAX_SEMESTER[program] || '?'} for ${program || 'the selected program'}.`);
  }
  if (errors.length) {
    throw new ApiError(400, errors.join(' '), { code: 'VALIDATION_ERROR' });
  }

  // Roll number must be unique across other users.
  if (await studentRepository.rollNumberTakenByOther(rollNumber, user.id)) {
    throw new ApiError(409, 'This roll number is already registered.', {
      code: 'ROLL_NUMBER_TAKEN',
    });
  }

  const profile = await studentRepository.upsertByUserId({
    userId: user.id,
    rollNumber,
    fullName,
    mobileNumber,
    program,
    branch,
    semester,
  });

  return profile;
}

/**
 * Validate + save a faculty profile for the current verified user.
 * Does NOT change the user's role (stays 'student' until admin promotion).
 * @param {string} firebaseUid
 * @param {object} input - { fullName, mobileNumber, department, designation }
 */
async function saveFacultyProfile(firebaseUid, input = {}) {
  const user = await requireDbUser(firebaseUid);

  const fullName = String(input.fullName || '').trim();
  const mobileNumber = normalizeMobile10(input.mobileNumber);
  const department = String(input.department || '').trim();
  const designation = String(input.designation || '').trim();

  const errors = [];
  if (!isNonEmpty(fullName)) errors.push('fullName is required.');
  if (!MOBILE_IN_RE.test(mobileNumber)) errors.push('A valid 10-digit mobileNumber is required.');
  if (!DEPARTMENTS.includes(department)) errors.push('department is invalid.');
  if (!DESIGNATIONS.includes(designation)) errors.push('designation is invalid.');
  if (errors.length) {
    throw new ApiError(400, errors.join(' '), { code: 'VALIDATION_ERROR' });
  }

  const profile = await facultyRepository.upsertByUserId({
    userId: user.id,
    fullName,
    mobileNumber,
    department,
    designation,
  });

  // Mark the account as pending approval (explicit status model). The ROLE is
  // intentionally left as-is (Option A: stays 'student' until an admin/ OTP
  // approval promotes it to 'faculty'), which keeps the existing admin-panel
  // pending detection working. Never downgrade an already-approved faculty.
  if (user.status !== 'approved' || user.role !== 'faculty') {
    try {
      if (user.status !== 'pending' && user.role !== 'faculty') {
        await userRepository.updateStatus(user.id, 'pending');
      }
    } catch (e) {
      // Non-fatal: the profile is saved; status default remains.
      console.debug('[profile] could not set faculty pending status:', e.message);
    }
  }

  return profile;
}

/**
 * Compute the profile/completion status for the current user. Used by the
 * frontend to decide dashboard access vs. profile-completion vs. faculty
 * "approval pending".
 *
 * facultyPending is true when a faculty profile exists but the DB role has not
 * yet been promoted to 'faculty' (Option A security model).
 *
 * @param {string} firebaseUid
 */
async function getProfileStatus(firebaseUid) {
  const user = await requireDbUser(firebaseUid);
  const [student, faculty] = await Promise.all([
    studentRepository.findByUserId(user.id),
    facultyRepository.findByUserId(user.id),
  ]);

  return {
    role: user.role, // server-owned source of truth
    status: user.status, // 'pending' | 'approved' | 'rejected'
    hasStudentProfile: Boolean(student),
    hasFacultyProfile: Boolean(faculty),
    // A faculty applicant is "pending" until approved (role promoted to faculty
    // AND status approved). Approval happens via admin panel OR OTP.
    facultyPending: Boolean(faculty) && !(user.role === 'faculty' && user.status === 'approved'),
    // An admin applicant is "pending" until status is approved.
    adminPending: user.role === 'admin' && user.status !== 'approved',
    student: student || null,
    faculty: faculty || null,
  };
}

/* ------------------------------------------------------------------ */
/* Self-service PROFILE view + edit (GET/PATCH /api/profile/me)         */
/* ------------------------------------------------------------------ */

/** Reduce any stored phone to bare 10 digits for consistent UI display. */
function displayMobile(value) {
  return normalizeMobile10(value);
}

/**
 * Build the unified profile view for the current user. Identity comes from the
 * verified Firebase UID (never the client). Shape:
 *   { role, status, email, displayName, phone(10 digits or ''),
 *     student: {...}|null, faculty: {...}|null }
 * @param {string} firebaseUid
 */
async function getMyProfile(firebaseUid) {
  const user = await requireDbUser(firebaseUid);
  const [student, faculty] = await Promise.all([
    studentRepository.findByUserId(user.id),
    facultyRepository.findByUserId(user.id),
  ]);

  return {
    role: user.role,
    status: user.status,
    email: user.email,
    displayName: user.display_name,
    // Admin phone lives on users.phone (E.164); students/faculty on mobile_number.
    phone: displayMobile(user.phone),
    student: student
      ? {
          rollNumber: student.roll_number,
          fullName: student.full_name,
          mobileNumber: displayMobile(student.mobile_number),
          program: student.program,
          branch: student.branch,
          semester: student.semester,
        }
      : null,
    faculty: faculty
      ? {
          employeeId: faculty.employee_id,
          fullName: faculty.full_name,
          mobileNumber: displayMobile(faculty.mobile_number),
          department: faculty.department,
          designation: faculty.designation,
        }
      : null,
  };
}

/**
 * Update the current user's OWN profile. Identity from the verified UID only;
 * a client CANNOT target another user. The editable fields depend on which
 * profile the user actually has (student row, faculty row, or bare admin/user).
 *
 * Editable (safe) fields ONLY. NEVER role, status, approval, employee_id, ids.
 *   - Student profile present: fullName, mobileNumber, program, branch, semester.
 *     (roll number is identity-ish; kept editable but re-checked for uniqueness.)
 *   - Faculty profile present: fullName, mobileNumber, department, designation.
 *   - No student/faculty profile (e.g. admin): displayName + phone on users.
 *
 * @param {string} firebaseUid
 * @param {object} input
 */
async function updateMyProfile(firebaseUid, input = {}) {
  const user = await requireDbUser(firebaseUid);
  const [student, faculty] = await Promise.all([
    studentRepository.findByUserId(user.id),
    facultyRepository.findByUserId(user.id),
  ]);

  // ---- Student self-edit ----
  if (student) {
    const rollNumber = input.rollNumber != null ? String(input.rollNumber).trim() : student.roll_number;
    const fullName = input.fullName != null ? String(input.fullName).trim() : student.full_name;
    const mobileNumber = input.mobileNumber != null ? normalizeMobile10(input.mobileNumber) : student.mobile_number;
    const program = input.program != null ? String(input.program).trim() : student.program;
    const branch = input.branch != null ? String(input.branch).trim() : student.branch;
    const semester = input.semester != null ? Number(input.semester) : student.semester;

    const errors = [];
    if (!isNonEmpty(fullName)) errors.push('fullName is required.');
    if (!isNonEmpty(rollNumber)) errors.push('rollNumber is required.');
    if (!MOBILE_IN_RE.test(mobileNumber)) errors.push('A valid 10-digit mobileNumber is required.');
    if (!PROGRAMS.includes(program)) errors.push('program must be Polytechnic or B.Tech.');
    if (!BRANCHES.includes(branch)) errors.push('branch is invalid.');
    if (!Number.isInteger(semester) || semester < 1 || semester > (MAX_SEMESTER[program] || 0)) {
      errors.push(`semester must be between 1 and ${MAX_SEMESTER[program] || '?'} for ${program || 'the selected program'}.`);
    }
    if (errors.length) throw new ApiError(400, errors.join(' '), { code: 'VALIDATION_ERROR' });

    if (await studentRepository.rollNumberTakenByOther(rollNumber, user.id)) {
      throw new ApiError(409, 'This roll number is already registered.', { code: 'ROLL_NUMBER_TAKEN' });
    }
    await studentRepository.upsertByUserId({ userId: user.id, rollNumber, fullName, mobileNumber, program, branch, semester });
    return getMyProfile(firebaseUid);
  }

  // ---- Faculty self-edit ----
  if (faculty) {
    const fullName = input.fullName != null ? String(input.fullName).trim() : faculty.full_name;
    const mobileNumber = input.mobileNumber != null ? normalizeMobile10(input.mobileNumber) : faculty.mobile_number;
    const department = input.department != null ? String(input.department).trim() : faculty.department;
    const designation = input.designation != null ? String(input.designation).trim() : faculty.designation;

    const errors = [];
    if (!isNonEmpty(fullName)) errors.push('fullName is required.');
    if (!MOBILE_IN_RE.test(mobileNumber)) errors.push('A valid 10-digit mobileNumber is required.');
    if (!DEPARTMENTS.includes(department)) errors.push('department is invalid.');
    if (!DESIGNATIONS.includes(designation)) errors.push('designation is invalid.');
    if (errors.length) throw new ApiError(400, errors.join(' '), { code: 'VALIDATION_ERROR' });

    // upsertByUserId never touches employee_id (admin-assigned) — safe.
    await facultyRepository.upsertByUserId({ userId: user.id, fullName, mobileNumber, department, designation });
    return getMyProfile(firebaseUid);
  }

  // ---- Bare user (e.g. admin without a faculty/student profile) ----
  const displayName = input.displayName != null || input.fullName != null
    ? String(input.displayName ?? input.fullName).trim()
    : null;
  let phone = null;
  if (input.mobileNumber != null || input.phone != null) {
    const ten = normalizeMobile10(input.mobileNumber ?? input.phone);
    if (!MOBILE_IN_RE.test(ten)) {
      throw new ApiError(400, 'A valid 10-digit mobileNumber is required.', { code: 'VALIDATION_ERROR' });
    }
    // Store admin phone as E.164 (+91) so it stays consistent with OTP matching.
    phone = '+91' + ten;
  }
  if (displayName !== null && !isNonEmpty(displayName)) {
    throw new ApiError(400, 'Name cannot be empty.', { code: 'VALIDATION_ERROR' });
  }
  await userRepository.updateContact(user.id, { displayName, phone });
  return getMyProfile(firebaseUid);
}

module.exports = {
  saveStudentProfile,
  saveFacultyProfile,
  getProfileStatus,
  getMyProfile,
  updateMyProfile,
  // exported for potential reuse/testing
  PROGRAMS,
  BRANCHES,
  DEPARTMENTS,
  DESIGNATIONS,
  MAX_SEMESTER,
};
