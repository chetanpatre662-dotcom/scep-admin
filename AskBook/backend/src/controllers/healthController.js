/**
 * controllers/healthController.js
 * -----------------------------------------------------------------------------
 * Health/liveness controllers. No auth required — used by monitors and during
 * local development to confirm the server and its dependencies are reachable.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { verifyConnection } = require('../config/database');
const { isInitialized } = require('../config/firebaseAdmin');

/** GET /api/health — basic liveness. */
function health(_req, res) {
  res.status(200).json({
    success: true,
    message: 'Backend is running',
  });
}

/** GET /api/health/db — verifies PostgreSQL connectivity. */
async function healthDb(_req, res) {
  const result = await verifyConnection();
  if (result.ok) {
    return res.status(200).json({
      success: true,
      message: 'Database connection OK',
      serverTime: result.serverTime,
    });
  }
  return res.status(503).json({
    success: false,
    message: 'Database connection failed',
    // `error` is safe here: it is a connectivity diagnostic, not user data.
    error: result.error,
  });
}

/** GET /api/health/firebase — reports whether Firebase Admin is initialized. */
function healthFirebase(_req, res) {
  const ok = isInitialized();
  res.status(ok ? 200 : 503).json({
    success: ok,
    message: ok
      ? 'Firebase Admin initialized'
      : 'Firebase Admin not initialized',
  });
}

module.exports = { health, healthDb, healthFirebase };
