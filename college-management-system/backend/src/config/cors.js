/**
 * config/cors.js
 * -----------------------------------------------------------------------------
 * CORS options driven by env (FRONTEND_URL, comma-separated). A wildcard "*"
 * is intentionally NOT used as the production strategy — origins are matched
 * against an allow-list.
 *
 * In development, requests with no Origin header (curl, same-origin, server to
 * server) are allowed so local tooling works smoothly.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { env } = require('./env');

const allowed = new Set(env.FRONTEND_ORIGINS);

const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser / same-origin requests that omit Origin.
    if (!origin) return callback(null, true);
    if (allowed.has(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = { corsOptions, allowedOrigins: env.FRONTEND_ORIGINS };
