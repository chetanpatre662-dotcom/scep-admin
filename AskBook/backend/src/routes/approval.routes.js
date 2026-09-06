/**
 * routes/approval.routes.js
 * -----------------------------------------------------------------------------
 * OTP-based approval endpoints for pending Faculty/Admin applicants + approver
 * phone registration for admins. Mounted at /api. All routes require a valid
 * Firebase token (requireAuth); every authorization decision is re-enforced in
 * approvalService (never trusts the client).
 *
 *   GET  /api/approval/status       my role/status/needsApproval
 *   GET  /api/approval/approvers    masked approved-admin list (+bootstrap flag)
 *   POST /api/approval/otp/verify   finalize approval with a phone-auth token
 *   POST /api/approval/admin/phone  approved admin registers their verified phone
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const approvalService = require('../services/approvalService');
const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

const router = express.Router();

/** Resolve the current DB user (identity from the verified token). */
async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

/** GET /api/approval/status — the caller's own approval state. */
router.get('/approval/status', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const status = await approvalService.myStatus(user);
    res.status(200).json({ success: true, ...status });
  } catch (err) { next(err); }
});

/** GET /api/approval/approvers — masked approver list (+ bootstrap availability). */
router.get('/approval/approvers', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    // listApprovers internally validates the applicant type via classifyApplicant.
    const data = await approvalService.listApprovers(user);
    res.status(200).json({ success: true, ...data });
  } catch (err) { next(err); }
});

/**
 * GET /api/approval/approver-phone?approverId=X OR ?bootstrap=1
 * Returns the REAL phone number for OTP delivery only.
 * The backend still re-validates the resulting OTP token at approval time.
 * Only usable by a pending faculty/admin applicant.
 */
router.get('/approval/approver-phone', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (user.status === 'approved') {
      throw new ApiError(409, 'Account already approved.', { code: 'ALREADY_APPROVED' });
    }
    // resolveApproverPhone validates applicant type internally via classifyApplicant.
    const phone = await approvalService.resolveApproverPhone(user, req.query);
    res.status(200).json({ success: true, phone });
  } catch (err) { next(err); }
});

/** POST /api/approval/otp/verify — finalize approval. Body: { phoneIdToken, approverId?, bootstrap? } */
router.post('/approval/otp/verify', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await approvalService.approveWithOtp(user, req.body || {});
    res.status(200).json({
      success: true,
      message: result.changed ? 'Account approved successfully.' : 'Account already approved.',
      ...result,
    });
  } catch (err) { next(err); }
});

/** POST /api/approval/admin/apply — declare admin intent (role=admin, status=pending). */
router.post('/approval/admin/apply', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await approvalService.applyForAdmin(user, req.body || {});
    res.status(200).json({ success: true, message: 'Admin application submitted (pending approval).', ...result });
  } catch (err) { next(err); }
});

/** POST /api/approval/admin/phone — approved admin registers their verified approver phone. */
router.post('/approval/admin/phone', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const result = await approvalService.registerMyPhone(user, (req.body || {}).phoneIdToken);
    res.status(200).json({ success: true, message: 'Approver phone registered.', ...result });
  } catch (err) { next(err); }
});

module.exports = router;
