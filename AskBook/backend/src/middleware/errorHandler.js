/**
 * middleware/errorHandler.js
 * -----------------------------------------------------------------------------
 * Centralized error + 404 handling.
 *
 *   - notFoundHandler: turns unmatched routes into a clean 404 JSON response.
 *   - errorHandler: final Express error middleware. Returns a consistent JSON
 *     shape and NEVER exposes raw stack traces to clients in production.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { env } = require('../config/env');
const ApiError = require('../utils/ApiError');

/** 404 for any route not handled above. */
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
}

/**
 * Express error-handling middleware (must have 4 args to be recognized).
 * eslint-disable-next-line no-unused-vars — `next` is required by the signature.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : err.statusCode || 500;

  // Unexpected (non-operational) errors are logged in full for developers.
  if (!isApiError || statusCode >= 500) {
    console.error('[error]', err);
  }

  const body = {
    success: false,
    message:
      statusCode >= 500 && env.isProduction
        ? 'Internal server error.'
        : err.message || 'Internal server error.',
  };

  if (err.code) body.code = err.code;

  // Only include stack traces outside production to aid debugging.
  if (!env.isProduction && err.stack) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
