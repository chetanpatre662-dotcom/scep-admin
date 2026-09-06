/**
 * app.js
 * -----------------------------------------------------------------------------
 * Builds and configures the Express application (middleware -> routes -> error
 * handling). Kept separate from server.js so the app can be imported by tests
 * without starting a listening socket.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const cors = require('cors');

const { corsOptions } = require('./config/cors');
const apiRoutes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

/** Create a fully configured Express app instance. */
function createApp() {
  const app = express();

  // Trust proxy headers when running behind a reverse proxy (safe default).
  app.set('trust proxy', 1);

  // --- Core middleware ---
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // --- Routes ---
  app.use('/api', apiRoutes);

  // --- 404 + centralized error handling (must be last) ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
