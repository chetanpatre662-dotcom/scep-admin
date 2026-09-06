/**
 * scripts/promoteAdmin.js
 * -----------------------------------------------------------------------------
 * One-time, controlled, server-side ADMIN provisioning.
 *
 * Promotes an EXISTING PostgreSQL user (matched by email) to role='admin'.
 * This is intentionally a manual operator script — there is NO API/endpoint and
 * NO frontend path to assign the admin role. Admin role is server-controlled.
 *
 * Safety properties:
 *   - Idempotent: if the user is already 'admin', it reports and makes no change.
 *   - Never creates a user: if the email is not found, it errors clearly and
 *     exits non-zero (an admin must first authenticate via Firebase so the
 *     users row exists through the normal sync flow).
 *   - Never deletes or touches any other row.
 *   - No secrets are hard-coded: DB credentials come from backend/.env via the
 *     existing config/database pool.
 *
 * Usage (from the backend/ folder):
 *   node scripts/promoteAdmin.js <email>
 *   node scripts/promoteAdmin.js chetanpatre32@gmail.com
 *
 * If <email> is omitted, the DEFAULT_ADMIN_EMAIL below is used. The email is a
 * non-secret identifier (safe to keep in source); no password is involved.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { pool, closePool } = require('../src/config/database');

// Non-secret default (an email address, not a credential). Override via CLI arg.
const DEFAULT_ADMIN_EMAIL = 'chetanpatre32@gmail.com';

async function promote(email) {
  if (!email || !email.includes('@')) {
    throw new Error(`Invalid email argument: "${email}". Usage: node scripts/promoteAdmin.js <email>`);
  }

  // Case-insensitive match on email; role change is the only mutation.
  const found = await pool.query(
    'SELECT id, firebase_uid, email, role FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );

  if (found.rows.length === 0) {
    throw new Error(
      `No PostgreSQL user found with email "${email}". ` +
        'The user must sign in once (Firebase) so their users row is created ' +
        'via the normal /api/auth/sync flow, then re-run this script.'
    );
  }

  if (found.rows.length > 1) {
    // Defensive: email is not unique in the schema; refuse to guess.
    throw new Error(
      `Multiple users found with email "${email}" (${found.rows.length}). ` +
        'Refusing to promote ambiguously. Resolve duplicates first.'
    );
  }

  const user = found.rows[0];

  if (user.role === 'admin') {
    console.log(`[promoteAdmin] No change — user id=${user.id} (${user.email}) is already 'admin'.`);
    return { changed: false, user };
  }

  const updated = await pool.query(
    `UPDATE users SET role = 'admin' WHERE id = $1
     RETURNING id, firebase_uid, email, role`,
    [user.id]
  );

  const row = updated.rows[0];
  console.log(
    `[promoteAdmin] Promoted user id=${row.id} (${row.email}) from '${user.role}' to '${row.role}'.`
  );
  return { changed: true, user: row };
}

async function main() {
  const email = process.argv[2] || DEFAULT_ADMIN_EMAIL;
  try {
    await promote(email);
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error(`[promoteAdmin] ERROR: ${err.message}`);
    await closePool();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { promote };
