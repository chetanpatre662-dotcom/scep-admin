/**
 * services/embeddingService.js
 * -----------------------------------------------------------------------------
 * Pure text pipeline for RAG ingestion: extract -> normalize -> chunk -> hash,
 * plus a thin wrapper over geminiService for batched embeddings.
 *
 * Text extractors depend on OPTIONAL packages (pdf-parse for PDF, mammoth for
 * DOCX). They are loaded lazily with try/catch so the server NEVER crashes if a
 * package is not installed — instead, ingesting that format fails loudly with a
 * clear, actionable reason (which the ingestion pipeline records; it never
 * marks an un-extractable document as "indexed").
 *
 * Supported extraction:
 *   - text/plain                     -> always (built-in)
 *   - application/pdf                -> requires `pdf-parse`
 *   - .docx (openxml wordprocessing) -> requires `mammoth`
 *   - images / video / .doc / .ppt   -> NOT text-extractable here (skipped with
 *                                        a reason; titles/descriptions can still
 *                                        be indexed by the caller as metadata)
 * -----------------------------------------------------------------------------
 */
'use strict';

const crypto = require('crypto');
const geminiService = require('./geminiService');

// ---- Optional extractors (loaded lazily so absence never crashes boot) ----
let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch { pdfParse = null; }
let mammoth = null;
try { mammoth = require('mammoth'); } catch { mammoth = null; }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Which mime types this module can turn into text (given optional deps). */
function isExtractable(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  return m === 'text/plain' || m === 'application/pdf' || m === DOCX_MIME;
}

/**
 * Extract UTF-8 text from a document buffer. Throws a descriptive Error on any
 * failure (missing dependency, unsupported type, parse error) so the caller can
 * record the reason and NOT mark the document as successfully indexed.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<string>} extracted text (possibly empty for empty docs)
 */
async function extractText(buffer, mimeType) {
  if (!buffer || !buffer.length) throw new Error('Empty file buffer.');
  const m = String(mimeType || '').toLowerCase();

  if (m === 'text/plain') {
    return buffer.toString('utf8');
  }
  if (m === 'application/pdf') {
    if (!pdfParse) {
      throw new Error('PDF extraction requires the "pdf-parse" package (npm i pdf-parse).');
    }
    const data = await pdfParse(buffer);
    return data && typeof data.text === 'string' ? data.text : '';
  }
  if (m === DOCX_MIME) {
    if (!mammoth) {
      throw new Error('DOCX extraction requires the "mammoth" package (npm i mammoth).');
    }
    const result = await mammoth.extractRawText({ buffer });
    return result && typeof result.value === 'string' ? result.value : '';
  }
  throw new Error(`Unsupported document type for text extraction: ${mimeType || 'unknown'}.`);
}

/**
 * Normalize extracted text: unify newlines, collapse excessive whitespace,
 * strip control chars, and trim. Keeps paragraph boundaries (double newline)
 * so chunking can prefer natural breaks.
 */
function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')                 // CRLF/CR -> LF
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ') // control chars
    .replace(/[ \t]+/g, ' ')                 // collapse spaces/tabs
    .replace(/\n{3,}/g, '\n\n')              // cap blank runs
    .replace(/[ \t]*\n[ \t]*/g, '\n')        // trim line edges
    .trim();
}

/**
 * Split text into overlapping chunks on natural boundaries where possible.
 * Prefers paragraph then sentence boundaries; falls back to hard slicing for
 * very long unbroken text. Sizes are in characters (a stable, dependency-free
 * proxy for tokens for our small corpora).
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxChars=1200]
 * @param {number} [opts.overlap=150]
 * @returns {string[]}
 */
function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const clean = normalizeText(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Split into paragraph-ish units first.
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  const pushBuf = () => {
    const trimmed = buf.trim();
    if (trimmed) chunks.push(trimmed);
    buf = '';
  };

  for (const para of paras) {
    if (para.length > maxChars) {
      // Flush current buffer, then hard-split the oversized paragraph.
      pushBuf();
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if ((buf + '\n\n' + para).trim().length > maxChars) {
      pushBuf();
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  pushBuf();

  // Add overlap between adjacent chunks for retrieval continuity.
  if (overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i += 1) {
      const prevTail = chunks[i - 1].slice(-overlap);
      if (prevTail && !chunks[i].startsWith(prevTail)) {
        chunks[i] = `${prevTail} ${chunks[i]}`.trim();
      }
    }
  }
  return chunks.filter(Boolean);
}

/**
 * Deterministic content hash for a chunk, used to skip re-embedding unchanged
 * content (cost control + idempotent ingestion).
 */
function hashChunk({ sourceType, sourceId, chunkIndex, text }) {
  return crypto
    .createHash('sha256')
    .update(`${sourceType}|${sourceId}|${chunkIndex}|${normalizeText(text)}`, 'utf8')
    .digest('hex');
}

/**
 * Embed an array of chunk texts (delegates to geminiService.embedBatch with the
 * RETRIEVAL_DOCUMENT task type). Returns one vector per chunk, in order.
 */
async function embedChunks(texts) {
  if (!texts || texts.length === 0) return [];
  return geminiService.embedBatch(texts, { taskType: 'RETRIEVAL_DOCUMENT' });
}

module.exports = {
  isExtractable,
  extractText,
  normalizeText,
  chunkText,
  hashChunk,
  embedChunks,
  DOCX_MIME,
  // introspection for docs/health
  _deps: () => ({ pdf: Boolean(pdfParse), docx: Boolean(mammoth) }),
};
