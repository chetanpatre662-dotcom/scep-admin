/**
 * services/userService.js
 * -----------------------------------------------------------------------------
 * Business logic for linking a verified Firebase identity to the application's
 * PostgreSQL `users` record. Sits between the routes and the repository:
 *   route (requireAuth) -> userService -> userRepository -> DB
 *
 * SECURITY:
 *   - The Firebase UID comes from a token already verified by requireAuth; it is
 *     the trusted identity key.
 *   - Role is NEVER taken from the client. First-time provisioning uses the
 *     agreed safe default 'student'. An existing user's role is never changed
 *     here (see userRepository.upsertByFirebaseUid).
 * -----------------------------------------------------------------------------
 */
'use strict';

const userRepository = require('../repositories/userRepository');

/** Default role assigned to brand-new users on first provisioning. */
const DEFAULT_ROLE = 'student';

/**
 * Normalize the fields we care about out of a verified Firebase token.
 * The token shape follows firebase-admin's DecodedIdToken.
 */
function identityFromToken(decoded) {
  return {
    firebaseUid: decoded.uid,
    email: decoded.email || null,
    // Firebase uses `name`; fall back to the email local-part for a friendly
    // default display name when `name` is absent (e.g. email/password signups).
    displayName: decoded.name || (decoded.email ? decoded.email.split('@')[0] : null),
  };
}

/**
 * Provision-or-fetch the PostgreSQL user for a verified Firebase identity.
 *
 * If the user exists, returns it (role preserved; email/display_name refreshed
 * only when new non-null values are present). If not, creates the row with the
 * safe default role.
 *
 * @param {import('firebase-admin/auth').DecodedIdToken} decoded - verified token
 * @returns {Promise<{user: object, created: boolean}>}
 */
async function syncUser(decoded) {
  if (!decoded || !decoded.uid) {
    // Defensive: requireAuth guarantees this, but never assume.
    throw new Error('syncUser called without a verified Firebase UID.');
  }

  const identity = identityFromToken(decoded);

  // Determine whether this is a first-time provision (for the `created` flag).
  const existing = await userRepository.findByFirebaseUid(identity.firebaseUid);

  const user = await userRepository.upsertByFirebaseUid({
    firebaseUid: identity.firebaseUid,
    email: identity.email,
    displayName: identity.displayName,
    role: DEFAULT_ROLE, // only used for the initial insert
  });

  return { user, created: !existing };
}

/**
 * Fetch the PostgreSQL user for a verified Firebase UID without creating one.
 * @param {string} firebaseUid
 * @returns {Promise<object|null>}
 */
async function getByFirebaseUid(firebaseUid) {
  return userRepository.findByFirebaseUid(firebaseUid);
}

module.exports = { syncUser, getByFirebaseUid, DEFAULT_ROLE };
