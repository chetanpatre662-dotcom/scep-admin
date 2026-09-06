/**
 * db/seed.js
 * -----------------------------------------------------------------------------
 * Development-only seed runner. Completely separate from migrations.
 *
 * Applies every *.sql file in backend/seeds (sorted) inside a single
 * transaction. Seed files are written to be idempotent (ON CONFLICT / NOT
 * EXISTS), so re-running is safe.
 *
 * SAFETY:
 *   - Refuses to run when NODE_ENV=production (guard against seeding prod).
 *     Override intentionally with --force if ever needed.
 *   - Uses the existing pool; no hard-coded credentials.
 *   - Seeds contain demo data only (no real Firebase accounts/credentials).
 *
 * Usage:
 *   node src/db/seed.js            # apply dev seeds
 *   node src/db/seed.js --force    # allow even if NODE_ENV=production
 * -----------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { env } = require('../config/env');
const { pool, closePool } = require('../config/database');

const SEEDS_DIR = path.resolve(__dirname, '../../seeds');

/** Sorted list of seed .sql files. */
function readSeedFiles() {
  if (!fs.existsSync(SEEDS_DIR)) return [];
  return fs
    .readdirSync(SEEDS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function seed({ force = false } = {}) {
  if (env.isProduction && !force) {
    throw new Error(
      'Refusing to seed while NODE_ENV=production. Use --force to override.'
    );
  }

  const files = readSeedFiles();
  if (files.length === 0) {
    console.log('[seed] No seed files found in seeds/. Nothing to do.');
    return { fileCount: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      const sql = fs.readFileSync(path.join(SEEDS_DIR, file), 'utf8');
      console.log(`[seed] Applying ${file} ...`);
      await client.query(sql);
      console.log(`[seed]   ✓ ${file}`);
    }
    await client.query('COMMIT');
    console.log(`[seed] Done. Applied ${files.length} seed file(s).`);
    return { fileCount: files.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Seeding failed: ${err.message}`);
  } finally {
    client.release();
  }
}

async function main() {
  const force = process.argv.includes('--force');
  try {
    await seed({ force });
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error(`[seed] ERROR: ${err.message}`);
    await closePool();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { seed, readSeedFiles };
