/**
 * services/approvalService.js — OTP approval API client.
 * -----------------------------------------------------------------------------
 * Talks to the /api/approval/* endpoints. Every call sends the applicant's
 * Firebase ID token in the Authorization header (authedRequest). The phone-auth
 * ID token (OTP proof) is sent in the request body to the verify endpoint.
 *
 * The frontend NEVER supplies a phone number; it only sends an approverId (ID)
 * and the resulting phone-auth token. The backend resolves + validates the phone.
 * Full phone numbers are never returned — only masked strings.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

async function tok() {
  if (!ENV.AUTH_USE_BACKEND) return { t: null, err: { ok: false, error: 'Backend disabled.', status: 0 } };
  const t = await getIdToken();
  if (!t) return { t: null, err: { ok: false, error: 'Not authenticated.', status: 401 } };
  return { t, err: null };
}
async function call(path, opts = {}) {
  const { t, err } = await tok();
  if (err) return err;
  try {
    const res = await authedRequest(path, t, opts);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Request failed.', status: e?.status };
  }
}

/** GET /api/approval/status — my role/status/needsApproval. */
export function getApprovalStatus() {
  return call('/approval/status', { method: 'GET' });
}

/**
 * GET /api/approval/approvers — masked approved-admin list + bootstrapAvailable.
 * Response: { ok, approvers:[{id, name, maskedPhone}], bootstrapAvailable, approvedAdminCount }
 * Phone numbers are MASKED server-side; full numbers are never returned.
 */
export function getApprovers() {
  return call('/approval/approvers', { method: 'GET' });
}

/**
 * POST /api/approval/otp/verify — finalize approval with the phone-auth token.
 * @param {object} opts
 * @param {string} opts.phoneIdToken   - Firebase phone-auth ID token (OTP proof)
 * @param {number} [opts.approverId]   - selected approver ID (normal flow)
 * @param {boolean} [opts.bootstrap]   - true to approve via the configured bootstrap phone
 */
export function verifyOtp({ phoneIdToken, approverId, bootstrap }) {
  const body = { phoneIdToken };
  if (approverId != null) body.approverId = approverId;
  if (bootstrap) body.bootstrap = true;
  return call('/approval/otp/verify', { method: 'POST', body });
}

/**
 * POST /api/approval/admin/apply — declare admin intent on a fresh account.
 * @param {string} [phone] E.164 or local mobile number (stored unverified; overwritten at OTP time)
 */
export function applyForAdmin(phone) {
  const body = {};
  if (phone) body.phone = phone;
  return call('/approval/admin/apply', { method: 'POST', body });
}

/**
 * POST /api/approval/admin/phone — approved admin registers their verified phone
 * so they can act as an OTP approver in future. Requires phone-auth token.
 * @param {string} phoneIdToken - Firebase phone-auth ID token
 */
export function registerAdminPhone(phoneIdToken) {
  return call('/approval/admin/phone', { method: 'POST', body: { phoneIdToken } });
}
