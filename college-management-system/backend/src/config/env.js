/**
 * config/env.js
 * -----------------------------------------------------------------------------
 * Loads environment variables from `.env` (via dotenv) and exposes a single,
 * validated, typed configuration object for the rest of the backend.
 *
 * This is the ONLY place `process.env` is read. Everything else imports `env`.
 * No secrets are hard-coded here — real values live only in `.env` (gitignored).
 * -----------------------------------------------------------------------------
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load .env from the backend root (two levels up from src/config).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/** Parse a boolean-ish env string ("true"/"1"/"yes") into a real boolean. */
function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/** Split a comma-separated env value into a trimmed, non-empty array. */
function toList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize a phone number to E.164 form: strip spaces, hyphens, parentheses;
 * keep a single leading '+'. Returns '' when empty.
 * Auto-prepends +91 for 10-digit Indian mobile numbers without a country code.
 * Used server-side for storage and comparison — never sent to the frontend.
 */
function normalizePhone(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (hasPlus) return '+' + digits;
  // 10-digit number → assume Indian mobile, prepend +91
  if (digits.length === 10) return '+91' + digits;
  // 12-digit number starting with 91 → add '+'
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  // Anything else with explicit digits — keep as-is with no country code prefix
  return digits;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const env = {
  NODE_ENV,
  isProduction: NODE_ENV === 'production',

  // ---- Server ----
  PORT: Number(process.env.PORT) || 5000,

  // ---- CORS ----
  // Allowed frontend origins (comma-separated). Sensible dev defaults are used
  // only when FRONTEND_URL is not provided.
  FRONTEND_ORIGINS: (() => {
    const configured = toList(process.env.FRONTEND_URL);
    if (configured.length > 0) return configured;
    return [
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:3000',
    ];
  })(),

  // ---- PostgreSQL ----
  db: {
    // Preferred single connection string; falls back to individual vars.
    connectionString: process.env.DATABASE_URL || '',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'college_cms',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: toBool(process.env.DB_SSL, false),
  },

  // ---- Firebase Admin ----
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    // Env files store the key with literal "\n"; convert to real newlines.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    // Firebase Cloud Storage bucket (e.g. college-94cd7.firebasestorage.app).
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  },

  // ---- Bootstrap Admin (first-admin OTP approval) ----
  // Verified phone allowed to approve the FIRST admin when none exists yet.
  // SECRET-ISH config: kept server-side only, never returned to the frontend.
  bootstrap: {
    adminPhone: normalizePhone(process.env.BOOTSTRAP_ADMIN_PHONE || ''),
  },

  // ---- AI Assistant (Google Gemini) ----
  // The Gemini API key is a SECRET: read only here, never returned to the
  // frontend, never logged. All Gemini calls happen server-side in
  // services/geminiService.js. Everything else (model names, dimensions,
  // limits) is safe, tunable configuration.
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    // REST base — kept configurable so the API version can be bumped later.
    apiBaseUrl: process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    // Generative (chat / tool-calling / analysis) model.
    chatModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    // Embedding model used for RAG. Keep configurable so re-indexing is possible
    // if the model (and thus the vector space) changes later.
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
    // Vector dimension for the pgvector column. MUST match the embedding model's
    // real output dimension (text-embedding-004 => 768). If the model changes,
    // update this AND re-run the ingestion (see AI_ASSISTANT.md re-indexing).
    embeddingDim: Number(process.env.GEMINI_EMBEDDING_DIM) || 768,
    // Per-request timeout for Gemini HTTP calls (ms).
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30_000,
    // How many times to retry transient Gemini failures (429/5xx).
    maxRetries: Number(process.env.GEMINI_MAX_RETRIES) || 2,
    // Cost/context guards.
    maxToolTurns: Number(process.env.AI_MAX_TOOL_TURNS) || 4,
    historyTurns: Number(process.env.AI_HISTORY_TURNS) || 8,
    ragTopK: Number(process.env.AI_RAG_TOP_K) || 6,
  },
};

/** True when all three Firebase Admin credentials are present. */
env.firebase.isConfigured = Boolean(
  env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey
);

/** True when either a connection string or a DB name+host is available. */
env.db.isConfigured = Boolean(env.db.connectionString || (env.db.host && env.db.name));

/** Whether a bootstrap admin phone is configured (server-side only). */
env.bootstrap.isConfigured = Boolean(env.bootstrap.adminPhone);

/** Whether the AI Assistant (Gemini) is configured. When false, AI endpoints
 *  degrade gracefully (clear "AI not configured" message) instead of crashing. */
env.ai.isConfigured = Boolean(env.ai.geminiApiKey);

module.exports = { env, toBool, toList, normalizePhone };
