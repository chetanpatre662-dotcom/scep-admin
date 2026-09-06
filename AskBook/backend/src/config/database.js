/**
 * config/database.js
 * -----------------------------------------------------------------------------
 * PostgreSQL connection pool (pg.Pool) + a safe connectivity check.
 *
 * Configuration comes entirely from config/env.js:
 *   - If DATABASE_URL is set, it is used (preferred).
 *   - Otherwise the individual DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD vars
 *     are used to build the pool.
 *
 * The pool is created lazily and reused across the whole app (module singleton).
 * Foundation phase: no tables, no queries beyond a `SELECT 1` health probe.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { Pool, types } = require('pg');
const { env } = require('./env');

// Return DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings instead of JS
// Date objects. This avoids timezone shifts (a DATE has no time/zone; letting
// node-postgres build a local Date can roll the day back/forward).
types.setTypeParser(1082, (val) => val);

/** Build the pg pool config from env (connection string preferred). */
function buildPoolConfig() {
  const base = {
    // Reasonable pool defaults for local/dev; tune later for production.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  // Enable SSL only when explicitly requested (managed/cloud databases).
  if (env.db.ssl) {
    base.ssl = { rejectUnauthorized: false };
  }

  if (env.db.connectionString) {
    return { ...base, connectionString: env.db.connectionString };
  }

  return {
    ...base,
    host: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
  };
}

// Single shared pool for the entire process.
const pool = new Pool(buildPoolConfig());

// Prevent an unexpected idle-client error from crashing the process. Log it so
// operators can react; individual queries still surface their own errors.
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Thin query helper so repositories don't import `pool` directly.
 * @param {string} text - parameterized SQL
 * @param {Array} [params] - query parameters
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Verify database connectivity safely. Acquires a client, runs `SELECT 1`, and
 * always releases the client. Never throws — returns a structured result so the
 * server can decide whether to warn or exit.
 * @returns {Promise<{ok: boolean, error?: string, serverTime?: string}>}
 */
async function verifyConnection() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW() AS now');
    return { ok: true, serverTime: result.rows[0]?.now };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (client) client.release();
  }
}

/** Gracefully close the pool (used on shutdown). */
async function closePool() {
  try {
    await pool.end();
  } catch (err) {
    console.error('[db] Error while closing pool:', err.message);
  }
}

module.exports = { pool, query, verifyConnection, closePool };
