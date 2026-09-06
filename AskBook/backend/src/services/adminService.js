/**
 * services/adminService.js
 * -----------------------------------------------------------------------------
 * Admin user-management business logic. Sits between admin routes and the
 * repository. All operations assume the caller is ALREADY verified as an admin
 * by the requireAdmin middleware.
 *
 * Role transitions are deliberately narrow and server-enforced:
 *   - approveFaculty: student -> faculty, ONLY if the user has a faculty profile
 *     (i.e. a pending faculty applicant). Never touches admins/students-without-
 *     a-faculty-profile.
 *   - makeAdmin: <role> -> admin, ONLY for users who have a faculty profile
 *     (per policy: admin promotion is limited to faculty users). No arbitrary
 *     student->admin from the UI.
 *
 * Deletion also removes the Firebase Auth account so a deleted user cannot be
 * silently recreated by /api/auth/sync on next login. Postgres + Firebase are
 * not atomically transactional, so partial failure is reported explicitly.
 * -----------------------------------------------------------------------------
 */
'use strict';

const adminRepository = require('../repositories/adminRepository');
const subjectRepository = require('../repositories/subjectRepository');
const { deleteFirebaseUser } = require('../config/firebaseAdmin');
const ApiError = require('../utils/ApiError');

/** Derive academic year label from program + semester (year is not stored). */
function yearFromSemester(program, semester) {
  const sem = Number(semester);
  if (!sem) return null;
  return Math.ceil(sem / 2); // 1-2->1, 3-4->2, 5-6->3, 7-8->4
}

/** Reduce a stored phone (E.164 or raw) to bare 10 digits for display. */
function tenDigits(value) {
  if (!value) return null;
  let d = String(value).replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10) d = d.slice(-10);
  return d || null;
}

/** Shape a joined user row into a stable public JSON object. */
function toUserView(row) {
  const hasStudent = row.student_id != null;
  const hasFaculty = row.faculty_id != null;
  const status = row.status || 'approved';
  // Pending faculty = has a faculty profile but not yet fully approved
  // (role promoted to 'faculty' AND status 'approved').
  const facultyPending = hasFaculty && !(row.role === 'faculty' && status === 'approved');
  const adminPending = row.role === 'admin' && status !== 'approved';
  const isRejected = status === 'rejected';
  // Any user who submitted a faculty/admin application (incl. rejected ones).
  const isApplicant = hasFaculty || row.role === 'admin';

  // Best phone for display: faculty/student mobile first, else the users.phone.
  const phone = tenDigits(row.faculty_mobile) || tenDigits(row.student_mobile) || tenDigits(row.user_phone);

  const view = {
    id: row.id,
    firebaseUid: row.firebase_uid,
    email: row.email,
    displayName: row.display_name,
    phone,
    role: row.role,
    status,
    createdAt: row.created_at,
    hasStudentProfile: hasStudent,
    hasFacultyProfile: hasFaculty,
    facultyPending,
    adminPending,
    isRejected,
    isApplicant,
    // The "kind" of application, for the requests page label + approve routing.
    applicantType: (row.role === 'admin') ? 'admin' : (hasFaculty ? 'faculty' : null),
    // Eligibility flags the UI can use (backend still re-enforces).
    // Approve a pending faculty applicant (faculty profile, not yet faculty/approved).
    canApproveFaculty: hasFaculty && !(row.role === 'faculty' && status === 'approved') && row.role !== 'admin',
    canMakeAdmin: hasFaculty && row.role !== 'admin',
    // Reject applies to any pending faculty/admin applicant (not already rejected/approved).
    canReject: (facultyPending || adminPending) && status !== 'rejected',
    // Re-approve applies to a REJECTED applicant (rejected faculty or rejected admin).
    canReApprove: isRejected && isApplicant,
    student: null,
    faculty: null,
  };

  if (hasStudent) {
    view.student = {
      id: row.student_id,
      rollNumber: row.student_roll_number,
      fullName: row.student_full_name,
      mobileNumber: row.student_mobile,
      program: row.student_program,
      branch: row.student_branch,
      semester: row.student_semester,
      year: yearFromSemester(row.student_program, row.student_semester),
    };
  }
  if (hasFaculty) {
    view.faculty = {
      id: row.faculty_id,
      employeeId: row.faculty_employee_id, // may be null until assigned
      fullName: row.faculty_full_name,
      mobileNumber: row.faculty_mobile,
      department: row.faculty_department,
      designation: row.faculty_designation,
    };
  }
  return view;
}

/** Dashboard statistics (real counts), incl. real class + subject counts. */
async function getStats() {
  const counts = await adminRepository.getCounts();
  const [classes, subjects] = await Promise.all([
    subjectRepository.classCount(),
    subjectRepository.subjectCount(),
  ]);
  return { ...counts, classes, subjects };
}

/** Full user list for admin management. */
async function listUsers() {
  const rows = await adminRepository.listUsers();
  return rows.map(toUserView);
}

/** Load + validate a target user by id, or throw 404. */
async function requireTarget(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new ApiError(400, 'Invalid user id.', { code: 'INVALID_ID' });
  }
  const user = await adminRepository.findById(numId);
  if (!user) {
    throw new ApiError(404, 'User not found.', { code: 'USER_NOT_FOUND' });
  }
  return user;
}

/**
 * Approve a pending faculty applicant: role student -> faculty.
 * Requires the target to have a faculty profile and currently be 'student'.
 */
async function approveFaculty(targetId) {
  const target = await requireTarget(targetId);

  const hasFaculty = await adminRepository.hasFacultyProfile(target.id);
  if (!hasFaculty) {
    throw new ApiError(400, 'User has no faculty profile to approve.', {
      code: 'NO_FACULTY_PROFILE',
    });
  }
  if (target.role === 'admin') {
    // Don't silently downgrade/alter an admin via the faculty-approve path.
    throw new ApiError(409, `Cannot approve a user with role '${target.role}'.`, {
      code: 'INVALID_ROLE_TRANSITION',
    });
  }
  if (target.role === 'faculty' && target.status === 'approved') {
    // Idempotent: already fully approved.
    return { changed: false, user: target };
  }

  // Approve = promote to faculty AND set status approved (works whether the
  // applicant was role 'student' pending or role 'faculty' status 'pending').
  const updated = await adminRepository.updateRoleAndStatus(target.id, 'faculty', 'approved');
  return { changed: true, user: updated };
}

/**
 * Reject a pending faculty/admin applicant: status -> 'rejected'. Does not
 * delete the account or change the role. Only pending applicants can be
 * rejected (an already-approved user must be demoted/deleted instead).
 */
async function rejectUser(targetId, requester) {
  const target = await requireTarget(targetId);
  if (requester && Number(target.id) === Number(requester.id)) {
    throw new ApiError(400, 'You cannot reject your own account.', { code: 'SELF_REJECT_FORBIDDEN' });
  }
  const hasFaculty = await adminRepository.hasFacultyProfile(target.id);
  const isPendingFaculty = hasFaculty && !(target.role === 'faculty' && target.status === 'approved') && target.role !== 'admin';
  const isPendingAdmin = target.role === 'admin' && target.status !== 'approved';
  if (!isPendingFaculty && !isPendingAdmin) {
    throw new ApiError(409, 'Only a pending faculty or admin applicant can be rejected.', { code: 'NOT_PENDING' });
  }
  const updated = await adminRepository.updateStatus(target.id, 'rejected');
  return { changed: true, user: updated };
}

/**
 * Approve an ADMIN applicant (role='admin', status pending OR rejected) by
 * setting status='approved'. This is the correct path for a self-signup admin
 * request, which has role='admin' but NO faculty profile (so makeAdmin's
 * faculty-profile requirement does not apply). Also handles RE-APPROVAL of a
 * previously rejected admin.
 */
async function approveAdmin(targetId) {
  const target = await requireTarget(targetId);
  if (target.role !== 'admin') {
    throw new ApiError(409, `Cannot approve-admin a user with role '${target.role}'.`, {
      code: 'NOT_ADMIN_APPLICANT',
    });
  }
  if (target.status === 'approved') {
    return { changed: false, user: target };
  }
  const updated = await adminRepository.updateRoleAndStatus(target.id, 'admin', 'approved');
  return { changed: true, user: updated };
}

/**
 * Promote a faculty user to admin: role -> admin.
 * Policy: only users WITH a faculty profile may be promoted to admin.
 */
async function makeAdmin(targetId) {
  const target = await requireTarget(targetId);

  const hasFaculty = await adminRepository.hasFacultyProfile(target.id);
  if (!hasFaculty) {
    throw new ApiError(400, 'Only faculty users can be promoted to admin.', {
      code: 'NOT_FACULTY',
    });
  }
  if (target.role === 'admin' && target.status === 'approved') {
    return { changed: false, user: target };
  }

  // Promotion via the admin panel grants admin AND approves in one step.
  const updated = await adminRepository.updateRoleAndStatus(target.id, 'admin', 'approved');
  return { changed: true, user: updated };
}

/**
 * Remove admin: role admin -> faculty (the reverse of makeAdmin). Does NOT
 * delete the user or their Firebase account. Since makeAdmin is only allowed
 * for users with a faculty profile, the correct reverse role is 'faculty'.
 *
 * Safety:
 *   - Rejects self-demotion (an admin cannot remove their own admin role).
 *   - Requires the target to currently be an admin.
 *   - Requires a faculty profile (guards against demoting to a role the user
 *     has no profile for; in practice every admin here came from faculty).
 *
 * @param {number|string} targetId
 * @param {object} requester - the verified admin DB user (req.dbUser)
 */
async function removeAdmin(targetId, requester) {
  const target = await requireTarget(targetId);

  if (requester && Number(target.id) === Number(requester.id)) {
    throw new ApiError(400, 'You cannot remove your own admin role.', {
      code: 'SELF_DEMOTE_FORBIDDEN',
    });
  }
  if (target.role !== 'admin') {
    throw new ApiError(409, 'User is not an admin.', { code: 'NOT_ADMIN' });
  }

  const hasFaculty = await adminRepository.hasFacultyProfile(target.id);
  if (!hasFaculty) {
    throw new ApiError(400, 'Cannot remove admin: user has no faculty profile to revert to.', {
      code: 'NO_FACULTY_PROFILE',
    });
  }

  // Revert to an APPROVED faculty (they were an approved admin).
  const updated = await adminRepository.updateRoleAndStatus(target.id, 'faculty', 'approved');
  return { changed: true, user: updated };
}

/**
 * Delete a user (Postgres + Firebase Auth).
 * @param {number|string} targetId - user id to delete
 * @param {object} requester - the verified admin DB user (req.dbUser)
 *
 * Safety:
 *   - Rejects self-delete (admin cannot delete their own account).
 *   - Deletes the Postgres row first (cascades students/faculty), then the
 *     Firebase Auth account. Reports partial failure clearly if Firebase
 *     deletion fails, so the operator can reconcile (the user can no longer
 *     authenticate a NEW app profile because the Postgres row is gone, but the
 *     Firebase account may still exist and should be removed manually).
 */
async function deleteUser(targetId, requester) {
  const target = await requireTarget(targetId);

  if (requester && Number(target.id) === Number(requester.id)) {
    throw new ApiError(400, 'You cannot delete your own admin account.', {
      code: 'SELF_DELETE_FORBIDDEN',
    });
  }

  // 1) Delete Postgres user (cascades to students/faculty via FK).
  const deleted = await adminRepository.deleteById(target.id);
  if (!deleted) {
    throw new ApiError(404, 'User not found.', { code: 'USER_NOT_FOUND' });
  }

  // 2) Delete the Firebase Auth account so it can't be recreated on next login.
  const fb = await deleteFirebaseUser(deleted.firebase_uid);

  return {
    deleted: {
      id: deleted.id,
      email: deleted.email,
      role: deleted.role,
    },
    firebase: {
      ok: fb.ok,
      alreadyAbsent: fb.alreadyAbsent || false,
      error: fb.ok ? undefined : fb.error,
    },
    // Overall "clean" only when both sides succeeded.
    partialFailure: !fb.ok,
  };
}

module.exports = { getStats, listUsers, approveFaculty, approveAdmin, rejectUser, makeAdmin, removeAdmin, deleteUser, toUserView };
