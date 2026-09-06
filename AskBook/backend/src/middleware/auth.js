/**
 * middleware/auth.js
 * -----------------------------------------------------------------------------
 * Firebase authentication middleware.
 *
 * Expects an `Authorization: Bearer <Firebase ID Token>` header. Verifies the
 * token with the Firebase Admin SDK and attaches the verified identity to
 * `req.user`. On any missing/invalid token it responds with 401 Unauthorized.
 *
 * ROLE AUTHORIZATION IS INTENTIONALLY OUT OF SCOPE HERE. This middleware only
 * establishes IDENTITY (who the caller is). Role/permission checks arrive after
 * the database schema exists (they will read the user's server-side profile
 * keyed by the Firebase UID).
 * -----------------------------------------------------------------------------
 */
'use strict';

const { verifyIdToken } = require('../config/firebaseAdmin');
const ApiError = require('../utils/ApiError');

/** Extract a bearer token from the Authorization header, or null. */
function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Require a valid Firebase ID token. Attaches `req.user` on success:
 *   { uid, email, emailVerified, name, picture, firebase, token }
 * Calls next(ApiError(401)) on any failure so the central error handler formats
 * the response consistently.
 */
async function requireAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return next(
      new ApiError(401, 'Missing or malformed Authorization header.', {
        code: 'AUTH_NO_TOKEN',
      })
    );
  }

  try {
    const decoded = await verifyIdToken(token);
    // Attach a minimal, safe identity object. Firebase is the source of truth.
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: Boolean(decoded.email_verified),
      name: decoded.name || null,
      picture: decoded.picture || null,
      // Full decoded claims kept for later use (e.g. provider info).
      firebase: decoded,
    };
    return next();
  } catch (err) {
    // Do not leak SDK/internal details to the client; log for developers.
    console.debug('[auth] token verification failed:', err.message);
    return next(
      new ApiError(401, 'Invalid or expired authentication token.', {
        code: 'AUTH_INVALID_TOKEN',
      })
    );
  }
}

module.exports = { requireAuth, extractBearerToken };
