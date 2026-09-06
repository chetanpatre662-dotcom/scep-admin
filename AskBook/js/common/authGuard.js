/**
 * authGuard.js — Client-side route protection (UX layer only).
 * -----------------------------------------------------------------------------
 * Blocks rendering of protected pages until Firebase confirms an authenticated
 * user. If no user is signed in, redirects to the given login page.
 *
 * IMPORTANT: This is a UX convenience, NOT a security boundary. A determined
 * user can bypass any client-side check. Real protection comes later when the
 * Node.js backend verifies the Firebase ID token on every request and enforces
 * role/permission checks server-side. Never rely on this guard for authorization.
 *
 * Roles are intentionally NOT enforced here — this phase separates identity
 * (Firebase) from roles (future backend). The guard only answers:
 * "is someone authenticated?"
 * -----------------------------------------------------------------------------
 */
import {
  listenToAuthState,
  getSessionProfile,
  syncProfile,
} from '../services/authService.js';

/**
 * Wait for the first definitive Firebase auth state.
 * @returns {Promise<object|null>} identity or null
 */
export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = listenToAuthState((identity) => {
      unsub(); // we only need the first resolved state
      resolve(identity);
    });
  });
}

/**
 * Require an authenticated user before continuing. Redirects to loginUrl if not.
 * @param {string} loginUrl resolved URL to redirect unauthenticated users to
 * @returns {Promise<object|null>} identity if authenticated, else null (redirecting)
 */
export async function requireAuth(loginUrl) {
  const identity = await waitForAuth();
  if (!identity) {
    window.location.replace(loginUrl);
    return null;
  }
  return identity;
}

/**
 * Resolve the backend (PostgreSQL) profile for the current user. Uses the
 * cached session profile when present; otherwise performs a backend sync.
 * Returns null if unauthenticated or the backend is unreachable.
 *
 * The DB `role` here is the source of truth. This is still a UX-level guard —
 * the backend independently re-verifies the Firebase token and enforces
 * authorization on every protected request, so tampering with the cached
 * profile cannot grant server-side access.
 *
 * @returns {Promise<object|null>} backend profile { id, firebaseUid, email, role, ... }
 */
export async function resolveProfile() {
  const cached = getSessionProfile();
  // Ensure we have a profile with the 'status' field (added in this release).
  // If cached profile is missing 'status', force a fresh sync.
  if (cached && cached.role && cached.status) return cached;
  const res = await syncProfile();
  return res.ok ? res.profile : null;
}

/**
 * Require an authenticated user whose DB role matches `expectedRole` AND whose
 * account status is 'approved'. Pending/rejected users are redirected to
 * `pendingUrl` (if supplied) instead of the login page.
 *
 * @param {string} expectedRole 'student' | 'faculty' | 'admin'
 * @param {string} loginUrl resolved login URL for unauthenticated users
 * @param {string} [unauthorizedUrl] where to send role-mismatched users
 * @param {string} [pendingUrl] where to send pending/rejected users (defaults to loginUrl)
 * @returns {Promise<object|null>} the backend profile if authorized, else null
 */
export async function requireRole(expectedRole, loginUrl, unauthorizedUrl, pendingUrl) {
  const identity = await waitForAuth();
  if (!identity) {
    window.location.replace(loginUrl);
    return null;
  }
  const profile = await resolveProfile();
  if (!profile || profile.role !== expectedRole) {
    window.location.replace(unauthorizedUrl || loginUrl);
    return null;
  }
  // Students are always approved; faculty/admin must be approved too.
  if (expectedRole !== 'student' && profile.status && profile.status !== 'approved') {
    window.location.replace(pendingUrl || loginUrl);
    return null;
  }
  return profile;
}
