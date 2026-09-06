/**
 * services/geminiService.js
 * -----------------------------------------------------------------------------
 * THE ONLY place the app talks to Google Gemini. Centralized so:
 *   - the GEMINI_API_KEY is read once (from config/env) and NEVER logged,
 *     returned to the client, or scattered across controllers,
 *   - timeout / retry / error mapping are consistent,
 *   - the transport (Gemini REST v1beta) can be swapped/versioned in one file.
 *
 * Transport choice: raw REST over Node's native `fetch` (Node >= 18). This
 * avoids adding the @google/generative-ai SDK (and its transitive deps) for a
 * small, stable surface. All request/response shaping lives here.
 *
 * Public API (all async, all throw ApiError on failure):
 *   generate({ system, contents, generationConfig })          -> { text, raw }
 *   generateWithTools({ system, contents, tools, ... })        -> { text, functionCalls, raw }
 *   embed(text, { taskType })                                  -> number[]
 *   embedBatch(texts, { taskType })                            -> number[][]
 *
 * `contents` uses the Gemini REST shape:
 *   [{ role: 'user'|'model', parts: [{ text }] | [{ functionResponse }] | ... }]
 * -----------------------------------------------------------------------------
 */
'use strict';

const { env } = require('../config/env');
const ApiError = require('../utils/ApiError');

const { ai } = env;

/** True when a Gemini API key is configured. Callers should check this first. */
function isEnabled() {
  return Boolean(ai.isConfigured);
}

function requireEnabled() {
  if (!isEnabled()) {
    throw new ApiError(503, 'The AI Assistant is not configured on the server.', {
      code: 'AI_NOT_CONFIGURED',
    });
  }
}

/** Sleep helper for retry backoff. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Low-level POST to a Gemini REST endpoint with timeout + retry.
 * The API key is passed as the `x-goog-api-key` header (never in the URL/query,
 * so it can't leak into logs/referrers). Retries transient 429/5xx failures.
 *
 * @param {string} path - e.g. `models/gemini-1.5-flash:generateContent`
 * @param {object} body - JSON request body
 * @returns {Promise<object>} parsed JSON response
 */
async function post(path, body) {
  requireEnabled();
  const url = `${ai.apiBaseUrl}/${path}`;
  let lastErr;

  for (let attempt = 0; attempt <= ai.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': ai.geminiApiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        return await res.json();
      }

      // Read the error body for developer logs, but NEVER surface it to clients.
      let detail = '';
      try {
        const errJson = await res.json();
        detail = (errJson && errJson.error && errJson.error.message) || '';
      } catch {
        /* ignore parse errors */
      }

      // 401/403 => bad/expired/insufficient key. Not retryable; map to 503 so we
      // never echo provider auth detail to the client.
      if (res.status === 401 || res.status === 403) {
        console.error('[gemini] auth error (check GEMINI_API_KEY):', detail);
        throw new ApiError(503, 'The AI service is temporarily unavailable.', {
          code: 'AI_AUTH_ERROR',
        });
      }
      // 400 => our request was malformed (bug); not retryable.
      if (res.status === 400) {
        console.error('[gemini] bad request:', detail);
        throw new ApiError(502, 'The AI service rejected the request.', {
          code: 'AI_BAD_REQUEST',
        });
      }
      // 429 / 5xx => transient; retry with backoff.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApiError(503, 'The AI service is busy. Please try again.', {
          code: res.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UPSTREAM_ERROR',
        });
        console.warn(`[gemini] transient ${res.status} (attempt ${attempt + 1}): ${detail}`);
      } else {
        // Other unexpected status — do not retry.
        console.error(`[gemini] unexpected status ${res.status}: ${detail}`);
        throw new ApiError(502, 'The AI service returned an unexpected response.', {
          code: 'AI_UNEXPECTED',
        });
      }
    } catch (err) {
      // Propagate our own mapped errors immediately (except retryable lastErr).
      if (err instanceof ApiError && err.code !== 'AI_RATE_LIMITED' && err.code !== 'AI_UPSTREAM_ERROR') {
        throw err;
      }
      if (err.name === 'AbortError') {
        lastErr = new ApiError(504, 'The AI service timed out. Please try again.', {
          code: 'AI_TIMEOUT',
        });
        console.warn(`[gemini] timeout after ${ai.timeoutMs}ms (attempt ${attempt + 1})`);
      } else if (!(err instanceof ApiError)) {
        // Network/DNS/etc.
        lastErr = new ApiError(503, 'Could not reach the AI service.', {
          code: 'AI_NETWORK_ERROR',
        });
        console.warn(`[gemini] network error (attempt ${attempt + 1}): ${err.message}`);
      } else {
        lastErr = err;
      }
    } finally {
      clearTimeout(timer);
    }

    // Backoff before the next attempt (skip after the final attempt).
    if (attempt < ai.maxRetries) {
      await sleep(400 * (attempt + 1));
    }
  }

  throw lastErr || new ApiError(503, 'The AI service is unavailable.', { code: 'AI_UNAVAILABLE' });
}

/** Extract the first text part from a generateContent response candidate. */
function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

/** Extract functionCall parts (tool calls) from a response candidate. */
function extractFunctionCalls(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => p && p.functionCall)
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
}

/**
 * Plain text generation.
 * @param {object} p
 * @param {string} [p.system]  - system instruction text
 * @param {Array}  p.contents  - Gemini `contents` array
 * @param {object} [p.generationConfig]
 * @returns {Promise<{ text: string, raw: object }>}
 */
async function generate({ system, contents, generationConfig } = {}) {
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (generationConfig) body.generationConfig = generationConfig;

  const data = await post(`models/${ai.chatModel}:generateContent`, body);
  return { text: extractText(data), raw: data };
}

/**
 * Generation with function/tool calling. Returns any tool calls the model wants
 * to make (the ORCHESTRATOR executes them with authorization, then calls again
 * with functionResponse parts). The model never touches the DB directly.
 *
 * @param {object} p
 * @param {string} [p.system]
 * @param {Array}  p.contents
 * @param {Array}  p.tools           - Gemini `tools` (functionDeclarations)
 * @param {object} [p.toolConfig]    - e.g. { functionCallingConfig: { mode } }
 * @param {object} [p.generationConfig]
 * @returns {Promise<{ text: string, functionCalls: Array, raw: object }>}
 */
async function generateWithTools({ system, contents, tools, toolConfig, generationConfig } = {}) {
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools) body.tools = tools;
  if (toolConfig) body.toolConfig = toolConfig;
  if (generationConfig) body.generationConfig = generationConfig;

  const data = await post(`models/${ai.chatModel}:generateContent`, body);
  return {
    text: extractText(data),
    functionCalls: extractFunctionCalls(data),
    raw: data,
  };
}

/**
 * Embed a single text. Returns a numeric vector of length env.ai.embeddingDim.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.taskType] - RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY | ...
 * @returns {Promise<number[]>}
 */
async function embed(text, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new ApiError(400, 'Cannot embed empty text.', { code: 'AI_EMPTY_EMBED' });

  const body = {
    model: `models/${ai.embeddingModel}`,
    content: { parts: [{ text: clean }] },
    taskType,
  };
  const data = await post(`models/${ai.embeddingModel}:embedContent`, body);
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new ApiError(502, 'The AI service returned no embedding.', { code: 'AI_EMBED_EMPTY' });
  }
  return values;
}

/**
 * Embed many texts in one request (cost/latency efficient).
 * @param {string[]} texts
 * @param {object} [opts]
 * @returns {Promise<number[][]>}  one vector per input, in order
 */
async function embedBatch(texts, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
  const list = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (list.length === 0) return [];

  const body = {
    requests: list.map((text) => ({
      model: `models/${ai.embeddingModel}`,
      content: { parts: [{ text }] },
      taskType,
    })),
  };
  const data = await post(`models/${ai.embeddingModel}:batchEmbedContents`, body);
  const embeddings = data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== list.length) {
    throw new ApiError(502, 'The AI service returned an incomplete embedding batch.', {
      code: 'AI_EMBED_BATCH_MISMATCH',
    });
  }
  return embeddings.map((e) => e.values);
}

module.exports = {
  isEnabled,
  generate,
  generateWithTools,
  embed,
  embedBatch,
  // exported for unit testing of response parsing
  _extractText: extractText,
  _extractFunctionCalls: extractFunctionCalls,
};
