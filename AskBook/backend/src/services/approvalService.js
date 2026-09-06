/**
 * services/approvalService.js
 * -----------------------------------------------------------------------------
 * OTP-based approval for Faculty + new Admin accounts, ALONGSIDE the existing
 * admin-panel approval. ALL authorization is enforced here (server-side); the
 * frontend is never trusted for role, status, phone, selected-approver phone,
 * or an "approved" flag.
 *
 * Security model:
 *   - Approvers eligible for OTP = users with role='admin' AND status='approved'
 *     AND a registered verified phone. Pending/rejected admins, faculty and
 *     students are NEVER eligible and NEVER exposed.
 *   - The frontend selects an approver by ID only; it may NOT supply a phone
 *     number. The backend resolves the phone from the DB for that approver.
 *   - OTP delivery/verification is performed by Firebase (client-side phone
 *     auth). The backend re-verifies the resulting phone-auth ID token via the
 *     Admin SDK and reads the VERIFIED phone_number from the decoded token,
 *     then compares it (server-side) to the selected approver's DB phone (or the
 *     configured BOOTSTRAP_ADMIN_PHONE). No raw OTP is ever stored.
 *   - Bootstrap flow is available WHENEVER BOOTSTRAP_ADMIN_PHONE is configured,
 *     regardless of how many approved admins exist (0, 1, or 100). It acts as a
 *     permanent super-approver for admin applicants. The verified OTP phone is
 *     still compared to the configured bootstrap phone at the final approval
 *     step, so it is never blocked or bypassed by any admin-count condition.
 * -----------------------------------------------------------------------------
 */
'use strict';

const userRepository = require('../repositories/userRepository');
const approvalRepository = require('../repositories/approvalRepository');
const facultyRepository = require('../repositories/facultyRepository');
const { verifyIdToken } = require('../config/firebaseAdmin');
const { env, normalizePhone } = require('../config/env');
const ApiError = require('../utils/ApiError');

/** Mask a phone for display: keep last 4 digits only. e.g. "+91 ******1234". */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.length < 4) return '******';
  const last4 = digits.slice(-4);
  const cc = String(phone || '').startsWith('+') ? `+${digits.slice(0, digits.length - 10 > 0 ? digits.length - 10 : 2)} ` : '';
  return `${cc}******${last4}`.trim();
}

function last4(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits.slice(-4) || null;
}

/** Count of currently APPROVED admins. */
async function approvedAdminCount() {
  return userRepository.countByRoleStatus('admin', 'approved');
}

/**
 * Determine the "applicant type" for a user.
 * Pending faculty = role='student' (Option A model) + status='pending' + has faculty profile row.
 * Pending admin   = role='admin'   + status='pending'.
 * Approved faculty/admin = role='faculty'/'admin' + status='approved'.
 * Returns: 'pending_faculty' | 'pending_admin' | 'approved' | 'none'
 */
async function classifyApplicant(dbUser) {
  if (dbUser.role === 'admin') {
    return dbUser.status === 'approved' ? 'approved' : 'pending_admin';
  }
  if (dbUser.role === 'faculty') {
    return dbUser.status === 'approved' ? 'approved' : 'pending_faculty';
  }
  // role='student': check if they have a faculty profile + pending status
  if (dbUser.status === 'pending') {
    const fp = await facultyRepository.findByUserId(dbUser.id);
    if (fp) return 'pending_faculty';
  }
  return 'none'; // regular student or no pending application
}

/**
 * The current user's approval situation (role/status/pending) — used to render
 * the "pending approval" UI. Reads the DB (never trusts the client).
 * @param {object} dbUser - the verified DB user row
 */
async function myStatus(dbUser) {
  const role = dbUser.role;
  const status = dbUser.status;
  const applicantType = await classifyApplicant(dbUser);
  const needsApproval = applicantType === 'pending_faculty' || applicantType === 'pending_admin';
  return {
    role,
    status,
    applicantType,          // 'pending_faculty' | 'pending_admin' | 'approved' | 'none'
    needsApproval,
    isApproved: status === 'approved' && applicantType === 'approved',
    isRejected: status === 'rejected',
  };
}

/**
 * List eligible OTP approvers for the given target, with MASKED phones only.
 * For a pending ADMIN, bootstrapAvailable is true whenever BOOTSTRAP_ADMIN_PHONE
 * is configured — shown ALONGSIDE any approved admins, never hidden by their
 * count. Only role='admin' AND status='approved' users appear as approvers
 * (pending/rejected admins are excluded).
 * @param {object} dbUser - the verified pending applicant
 */
async function listApprovers(dbUser) {
  const applicantType = await classifyApplicant(dbUser);
  if (applicantType !== 'pending_faculty' && applicantType !== 'pending_admin') {
    throw new ApiError(403, 'Only pending faculty or admin applicants can request approvers.', { code: 'NOT_APPLICABLE' });
  }

  const admins = await userRepository.listApprovedAdminsWithPhone();
  const count = await approvedAdminCount();

  // Bootstrap is available whenever the bootstrap phone is configured —
  // regardless of how many approved admins already exist. This lets the
  // bootstrap number act as a permanent super-approver for all new admins.
  // Security: the backend still validates the OTP proof against the exact
  // bootstrap phone at final approval time (resolveApproverPhone / approveWithOtp).
  const bootstrapAvailable =
    applicantType === 'pending_admin' && env.bootstrap.isConfigured;

  return {
    approvers: admins.map((a) => ({
      id: a.id,
      name: a.display_name || (a.email ? a.email.split('@')[0] : 'Administrator'),
      maskedPhone: maskPhone(a.phone),
    })),
    bootstrapAvailable,
    approvedAdminCount: count,
  };
}

/** Purpose string for the audit trail based on the applicant's resolved type. */
function purposeFor(targetRole, isBootstrap) {
  if (isBootstrap) return 'bootstrap_admin';
  return targetRole === 'admin' ? 'admin_approval' : 'faculty_approval';
}

/**
 * Finalize OTP approval. Re-verifies EVERY condition server-side at this final
 * step (so state changes mid-flow — e.g. another admin approved — are caught).
 *
 * @param {object} dbUser - the verified pending applicant (from requireAuth)
 * @param {object} input
 * @param {string} input.phoneIdToken - Firebase phone-auth ID token (proves the
 *   OTP for the target phone was completed on the client).
 * @param {number} [input.approverId] - the selected approved admin (normal flow)
 * @param {boolean} [input.bootstrap] - true to use the bootstrap-admin path
 */
async function approveWithOtp(dbUser, input = {}) {
  // 0) Classify the applicant: must be a pending faculty or pending admin.
  const applicantType = await classifyApplicant(dbUser);
  if (applicantType !== 'pending_faculty' && applicantType !== 'pending_admin') {
    if (applicantType === 'approved') return { changed: false, status: 'approved' };
    throw new ApiError(403, 'Only pending faculty or admin applicants use OTP approval.', { code: 'NOT_APPLICABLE' });
  }
  if (dbUser.status === 'rejected') {
    throw new ApiError(403, 'This account was rejected. Contact an administrator.', { code: 'ACCOUNT_REJECTED' });
  }

  // 1) Verify the Firebase phone-auth ID token and extract the VERIFIED phone.
  const token = String(input.phoneIdToken || '');
  if (!token) throw new ApiError(400, 'Missing verification token.', { code: 'NO_OTP_TOKEN' });

  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch (e) {
    throw new ApiError(401, 'Phone verification failed or expired. Please try again.', { code: 'OTP_VERIFY_FAILED' });
  }
  const verifiedPhone = normalizePhone(decoded && decoded.phone_number);
  if (!verifiedPhone) {
    throw new ApiError(400, 'The verification did not include a verified phone number.', { code: 'NO_VERIFIED_PHONE' });
  }

  const isBootstrap = Boolean(input.bootstrap);

  if (isBootstrap) {
    // ---- Bootstrap path: approve the FIRST admin ----
    if (dbUser.role !== 'admin') {
      throw new ApiError(403, 'Bootstrap approval is only for the first admin.', { code: 'BOOTSTRAP_NOT_ADMIN' });
    }
    if (!env.bootstrap.isConfigured) {
      throw new ApiError(403, 'Bootstrap admin approval is not configured.', { code: 'BOOTSTRAP_DISABLED' });
    }
    // Bootstrap phone is always valid regardless of approved admin count.
    // The verified phone must equal the configured bootstrap phone.
    if (verifiedPhone !== env.bootstrap.adminPhone) {
      throw new ApiError(403, 'This phone is not authorized for bootstrap approval.', { code: 'BOOTSTRAP_PHONE_MISMATCH' });
    }

    // Bootstrap only applies to pending admins — role stays 'admin'.
    const updated = await userRepository.updateRoleAndStatus(dbUser.id, 'admin', 'approved');
    await approvalRepository.record({
      targetId: dbUser.id, approverId: null, purpose: 'bootstrap_admin', phoneLast4: last4(verifiedPhone),
    });
    return { changed: true, status: 'approved', user: safeUser(updated) };
  }
  // ---- Normal path: an APPROVED admin approves via their verified phone ----
  const approverId = Number(input.approverId);
  if (!Number.isInteger(approverId) || approverId <= 0) {
    throw new ApiError(400, 'Select a valid approver.', { code: 'NO_APPROVER' });
  }
  const approver = await userRepository.findById(approverId);
  // Re-validate the approver at the final step: must be an APPROVED ADMIN with a phone.
  if (!approver || approver.role !== 'admin' || approver.status !== 'approved') {
    throw new ApiError(403, 'Selected approver is not an authorized administrator.', { code: 'INVALID_APPROVER' });
  }
  const approverPhone = normalizePhone(approver.phone);
  if (!approverPhone) {
    throw new ApiError(409, 'Selected administrator has no verified phone on record.', { code: 'APPROVER_NO_PHONE' });
  }
  // The OTP must have been completed for the SELECTED approver's phone — never
  // a client-supplied number.
  if (verifiedPhone !== approverPhone) {
    throw new ApiError(403, 'The verified phone does not match the selected administrator.', { code: 'PHONE_MISMATCH' });
  }

  // Determine the correct role to set: pending faculty (role='student') → 'faculty';
  // pending admin (role='admin') → stays 'admin'. Both get status='approved'.
  const targetRole = applicantType === 'pending_faculty' ? 'faculty' : dbUser.role;
  const updated = await userRepository.updateRoleAndStatus(dbUser.id, targetRole, 'approved');
  await approvalRepository.record({
    targetId: dbUser.id,
    approverId: approver.id,
    purpose: purposeFor(targetRole, false),
    phoneLast4: last4(verifiedPhone),
  });
  return { changed: true, status: 'approved', user: safeUser(updated) };
}

/**
 * Register/verify the CURRENT admin's own phone (so they can later act as an
 * OTP approver). The phone must come from a verified Firebase phone-auth token
 * for THIS user — we read it from the decoded token, never from the body.
 * Only an approved admin may set their approver phone.
 */
async function registerMyPhone(dbUser, phoneIdToken) {
  if (dbUser.role !== 'admin' || dbUser.status !== 'approved') {
    throw new ApiError(403, 'Only approved admins can register an approver phone.', { code: 'NOT_APPROVED_ADMIN' });
  }
  let decoded;
  try {
    decoded = await verifyIdToken(String(phoneIdToken || ''));
  } catch (e) {
    throw new ApiError(401, 'Phone verification failed or expired.', { code: 'OTP_VERIFY_FAILED' });
  }
  const verifiedPhone = normalizePhone(decoded && decoded.phone_number);
  if (!verifiedPhone) throw new ApiError(400, 'No verified phone in the token.', { code: 'NO_VERIFIED_PHONE' });
  const updated = await userRepository.setVerifiedPhone(dbUser.id, verifiedPhone);
  return { ok: true, maskedPhone: maskPhone(verifiedPhone), user: safeUser(updated) };
}

/**
 * Declare ADMIN intent for the current account (admin self-signup). Sets
 * role='admin', status='pending'. Guarded to prevent privilege escalation:
 *   - Only a bare 'student' with NO student profile and NO faculty profile may
 *     apply (i.e. a freshly-provisioned account from the admin register page).
 *   - Never touches an already-approved/other-role account.
 * The account remains locked out of protected admin APIs until it is approved
 * (bootstrap OTP or an existing approved admin's OTP / admin panel).
 * @param {object} dbUser
 */
async function applyForAdmin(dbUser, input = {}) {
  if (dbUser.role === 'admin') {
    // Idempotent: already admin. Still update phone if newly supplied and not yet set.
    if (input.phone && !dbUser.phone) {
      const cleaned = normalizePhone(input.phone);
      if (cleaned) await userRepository.saveUnverifiedPhone(dbUser.id, cleaned);
    }
    return { changed: false, role: 'admin', status: dbUser.status };
  }
  if (dbUser.role !== 'student') {
    throw new ApiError(409, 'Only a new account can apply for admin access.', { code: 'INVALID_STATE' });
  }
  const studentRepository = require('../repositories/studentRepository');
  const facultyRepository = require('../repositories/facultyRepository');
  const [student, faculty] = await Promise.all([
    studentRepository.findByUserId(dbUser.id),
    facultyRepository.findByUserId(dbUser.id),
  ]);
  if (student || faculty) {
    throw new ApiError(409, 'This account already has a student or faculty profile.', { code: 'PROFILE_EXISTS' });
  }
  const updated = await userRepository.updateRoleAndStatus(dbUser.id, 'admin', 'pending');
  // Save the unverified mobile number if provided (will be overwritten by phone_verified=true
  // once the admin registers their phone via OTP at approval time).
  if (input.phone) {
    const cleaned = normalizePhone(input.phone);
    if (cleaned) await userRepository.saveUnverifiedPhone(dbUser.id, cleaned);
  }
  return { changed: true, role: 'admin', status: 'pending', user: safeUser(updated) };
}

/**
 * Resolve the REAL phone number for OTP delivery to an approver.
 * This endpoint exists only to allow the client to initiate Firebase phone auth
 * (which requires the actual E.164 number). The backend re-validates everything
 * again at the final verify step — this is just a narrow phone lookup.
 * Returns the real phone if valid, throws otherwise.
 */
async function resolveApproverPhone(applicant, query = {}) {
  // Validate the caller is actually a pending applicant (not a regular student/approved user).
  const applicantType = await classifyApplicant(applicant);
  if (applicantType !== 'pending_faculty' && applicantType !== 'pending_admin') {
    throw new ApiError(403, 'Only pending faculty/admin applicants can request approver phone.', { code: 'NOT_APPLICABLE' });
  }

  const isBootstrap = query.bootstrap === '1' || query.bootstrap === 'true';
  if (isBootstrap) {
    if (applicantType !== 'pending_admin') {
      throw new ApiError(403, 'Bootstrap is only for admin applicants.', { code: 'BOOTSTRAP_NOT_ADMIN' });
    }
    if (!env.bootstrap.isConfigured) {
      throw new ApiError(403, 'Bootstrap admin phone is not configured.', { code: 'BOOTSTRAP_DISABLED' });
    }
    // Bootstrap phone is always available when configured.
    return env.bootstrap.adminPhone;
  }
  const approverId = Number(query.approverId);
  if (!Number.isInteger(approverId) || approverId <= 0) {
    throw new ApiError(400, 'Invalid approverId.', { code: 'INVALID_APPROVER' });
  }
  const approver = await userRepository.findById(approverId);
  if (!approver || approver.role !== 'admin' || approver.status !== 'approved') {
    throw new ApiError(403, 'Selected approver is not an authorized administrator.', { code: 'INVALID_APPROVER' });
  }
  const phone = normalizePhone(approver.phone);
  if (!phone) {
    throw new ApiError(409, 'Selected administrator has no verified phone registered.', { code: 'APPROVER_NO_PHONE' });
  }
  return phone;
}

/** Strip sensitive fields (phone) before returning a user to the client. */
function safeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    status: u.status,
    phoneVerified: u.phone_verified === true,
  };
}

module.exports = { myStatus, classifyApplicant, listApprovers, approveWithOtp, registerMyPhone, applyForAdmin, resolveApproverPhone, approvedAdminCount, maskPhone, safeUser };
