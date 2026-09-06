/**
 * server.js
 * -----------------------------------------------------------------------------
 * Startup orchestration. Clean, explicit initialization order:
 *
 *   load environment
 *      -> initialize Firebase Admin
 *      -> verify PostgreSQL pool connectivity
 *      -> create Express app (middleware -> routes -> error handler)
 *      -> start server
 *
 * Foundation phase philosophy: a missing DB or Firebase config should WARN, not
 * crash, so the server still boots and /api/health responds. Health endpoints
 * (/api/health/db, /api/health/firebase) surface the real dependency status.
 * -----------------------------------------------------------------------------
 */
'use strict';

// 1) Load environment first — every other module reads config from here.
const { env } = require('./config/env');

const { createApp } = require('./app');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const { verifyConnection, closePool } = require('./config/database');
const { allowedOrigins } = require('./config/cors');
const wsServer = require('./realtime/wsServer');

async function start() {
  console.log('----------------------------------------------------------');
  console.log(` College Management System — Backend (${env.NODE_ENV})`);
  console.log('----------------------------------------------------------');

  // 2) Initialize Firebase Admin (warn if credentials are absent).
  const fb = initFirebaseAdmin();
  if (fb.ok) {
    console.log(`[firebase] Admin SDK initialized (project: ${fb.projectId}).`);
  } else {
    console.warn(`[firebase] Admin SDK NOT initialized: ${fb.error}`);
    console.warn('[firebase] Auth-protected routes will return 401 until configured.');
  }

  // 3) Verify PostgreSQL connectivity (warn if unreachable).
  const db = await verifyConnection();
  if (db.ok) {
    console.log(`[db] PostgreSQL connection OK (server time: ${db.serverTime}).`);
  } else {
    console.warn(`[db] PostgreSQL connection FAILED: ${db.error}`);
    console.warn('[db] Server will still start; check /api/health/db for status.');
  }

  // 4) Create Express app.
  const app = createApp();

  // 5) Start listening.
  const server = app.listen(env.PORT, () => {
    console.log(`[server] Listening on http://localhost:${env.PORT}`);
    console.log(`[server] Health:    http://localhost:${env.PORT}/api/health`);
    console.log(`[cors]   Allowed origins: ${allowedOrigins.join(', ')}`);
    console.log('----------------------------------------------------------');
  });

  // 6) Attach the authenticated WebSocket realtime pipeline (shares the port).
  wsServer.attach(server);
  console.log(`[ws]     Realtime pipeline attached at ws://localhost:${env.PORT}/ws`);

  // --- Graceful shutdown ---
  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await closePool();
      console.log('[server] Closed. Bye.');
      process.exit(0);
    });
    // Force-exit if cleanup hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

// Safety nets for unexpected async failures.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
  process.exit(1);
});

start().catch((err) => {
  console.error('[fatal] Failed to start server:', err);
  process.exit(1);
});
