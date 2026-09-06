/**
 * utils/ApiError.js
 * -----------------------------------------------------------------------------
 * A small operational Error subclass carrying an HTTP status code, so route
 * handlers/middleware can `throw new ApiError(401, '...')` and let the central
 * error handler format a clean JSON response.
 * -----------------------------------------------------------------------------
 */
'use strict';

class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status (e.g. 400, 401, 404, 500)
   * @param {string} message - safe, client-facing message
   * @param {object} [options]
   * @param {string} [options.code] - optional short error code
   */
  constructor(statusCode, message, { code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    // Marks errors we intentionally created (safe to show) vs unexpected ones.
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }
}

module.exports = ApiError;
