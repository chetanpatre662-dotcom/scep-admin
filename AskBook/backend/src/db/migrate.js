/**
 * db/migrate.js
 * -----------------------------------------------------------------------------
 * Minimal, dependency-free SQL migration runner.
 *
 * Responsibilities:
 *   - Ensure a `schema_migrations` tracking table exists.
 *   - Read all *.sql files from backend/migrations, sorted by filename.
 *   - Apply only migrations that have not been recorded yet.
 *   - Run each migration file inside its own transaction (all-or-nothing).
 *   - Record applied migrations so they never run twice.
 *   - Print clear success/error output.
 *
 * Uses the existing shared pool from config/database.js. Credentials come from
 * env only — nothing is hard-coded here. This is a foundation-safe runner: it
 * never drops databases/tables and performs no destructive operations of its
 * own (individual migration files are responsible for being additive/safe).
 *
 * Usage:
 *   node src/db/migrate.js         # apply pending migrations
 *   node src/db/migrate.js --status  # show applied/pending without applying
 * -----------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { pool, closePool } = require('../config/database');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/** Create the tracking table if it does not exist. */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      filename    TEXT        NOT NULL UNIQUE,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/** Return the sorted list of migration filenames on disk. */
function readMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** md5 checksum of a file's contents (used to detect edited migrations). */
function checksumOf(contents) {
  return crypto.createHash('md5').update(contents, 'utf8').digest('hex');
}

/** Fetch already-applied migrations as a Map<filename, checksum>. */
async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    'SELECT filename, checksum FROM schema_migrations ORDER BY filename'
  );
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

/** Print applied/pending status without applying anything. */
async function status() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = readMigrationFiles();

    console.log('Migration status:');
    if (files.length === 0) {
      console.log('  (no migration files found in migrations/)');
      return;
    }
    for (const file of files) {
      console.log(`  [${applied.has(file) ? 'APPLIED' : 'PENDING'}] ${file}`);
    }
  } finally {
    client.release();
  }
}

/** Apply all pending migrations. */
async function migrate() {
  const files = readMigrationFiles();
  const client = await pool.connect();
  let appliedCount = 0;

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    if (files.length === 0) {
      console.log('[migrate] No migration files found. Nothing to do.');
      return { appliedCount: 0 };
    }

    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      const checksum = checksumOf(sql);

      if (applied.has(file)) {
        // Warn (do not fail) if a previously-applied migration was edited.
        if (applied.get(file) !== checksum) {
          console.warn(
            `[migrate] WARNING: ${file} was already applied but its checksum ` +
              'changed. Applied migrations should be immutable — create a new ' +
              'migration for further changes.'
          );
        }
        continue;
      }

      // Each migration runs in its own transaction: all-or-nothing.
      console.log(`[migrate] Applying ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
        appliedCount += 1;
        console.log(`[migrate]   ✓ ${file} applied.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed in ${file}: ${err.message}`);
      }
    }

    if (appliedCount === 0) {
      console.log('[migrate] Database is up to date. No pending migrations.');
    } else {
      console.log(`[migrate] Done. Applied ${appliedCount} migration(s).`);
    }
    return { appliedCount };
  } finally {
    client.release();
  }
}

/** CLI entrypoint. */
async function main() {
  const wantStatus = process.argv.includes('--status');
  try {
    if (wantStatus) {
      await status();
    } else {
      await migrate();
    }
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error(`[migrate] ERROR: ${err.message}`);
    await closePool();
    process.exit(1);
  }
}

// Run only when invoked directly (allows importing migrate() elsewhere later).
if (require.main === module) {
  main();
}

module.exports = { migrate, status, readMigrationFiles };
