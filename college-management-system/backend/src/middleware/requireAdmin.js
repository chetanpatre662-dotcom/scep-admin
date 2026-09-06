/**
 * middleware/requireAdmin.js
 * -----------------------------------------------------------------------------
 * Server-side admin authorization. MUST be used AFTER requireAuth, which has
 * already verified the Firebase ID token and attached req.user (with the
 * verified Firebase UID).
 *
 * This middleware:
 *   1. Reads the verified Firebase UID from req.user (set by requireAuth).
 *   2. Looks up the corresponding PostgreSQL user (source of truth for role).
 *   3. Requires role === 'admin', else responds 403.
 *   4. Attaches the resolved DB user to req.dbUser for downstream handlers.
 *
 * The frontend NEVER supplies the role — it is read exclusively from the DB.
 * -----------------------------------------------------------------------------
 */
'use strict';

const userRepository = require('../repositories/userRepository');
const ApiError = require('../utils/ApiError');

/**
 * Require the authenticated user to be a PostgreSQL admin.
 * Chain: requireAuth -> requireAdmin.
 */
async function requireAdmin(req, _res, next) {
  try {
    // requireAuth guarantees req.user.uid; be defensive anyway.
    const uid = req.user && req.user.uid;
    if (!uid) {
      return next(new ApiError(401, 'Authentication required.', { code: 'AUTH_REQUIRED' }));
    }

    const dbUser = await userRepository.findByFirebaseUid(uid);
    if (!dbUser) {
      // Authenticated in Firebase but no application profile — not authorized.
      return next(
        new ApiError(403, 'Admin access required.', { code: 'ADMIN_REQUIRED' })
      );
    }

    if (dbUser.role !== 'admin') {
      return next(
        new ApiError(403, 'Admin access required.', { code: 'ADMIN_REQUIRED' })
      );
    }

    // A pending/rejected admin (created via signup, not yet OTP/panel-approved)
    // must NOT access protected admin APIs — even if they tamper with the
    // frontend. Approval status is the server-side source of truth.
    if (dbUser.status !== 'approved') {
      return next(
        new ApiError(403, 'Your admin account is pending approval.', { code: 'ADMIN_PENDING' })
      );
    }

    // Expose the verified DB admin to downstream handlers (e.g. self-delete guard).
    req.dbUser = dbUser;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin };
