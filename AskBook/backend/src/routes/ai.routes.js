/**
 * routes/ai.routes.js
 * -----------------------------------------------------------------------------
 * AI Assistant endpoints. Mounted at /api. Every route requires a valid Firebase
 * token (requireAuth); the acting user is resolved server-side from the token
 * (userRepository.findByFirebaseUid) — userId/role are NEVER taken from the body.
 *
 *   POST /api/ai/chat            ask a question (tool-calling + RAG + memory)
 *   GET  /api/ai/conversations   list the caller's own chat threads
 *   POST /api/ai/ingest          (admin) build/refresh the RAG document index
 *
 * Responses follow the app convention: { success: true, ... } / errors via
 * ApiError -> central errorHandler. No API keys, DB details, stack traces, or
 * raw tool output leak to the client.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const userRepository = require('../repositories/userRepository');
const aiOrchestrator = require('../services/aiOrchestrator');
const documentIngestService = require('../services/documentIngestService');
const aiDocumentRepository = require('../repositories/aiDocumentRepository');
const fileRepository = require('../repositories/fileRepository');
const storageService = require('../services/storageService');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// In-memory multipart parsing (bytes go straight to Firebase Storage). 25 MB
// cap mirrors storageService.MAX_BYTES.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// MIME types the AI document pipeline can extract text from.
const AI_DOC_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
]);

/** Resolve the current DB user from the verified token (identity source). */
async function currentUser(req) {
  const user = await userRepository.findByFirebaseUid(req.user.uid);
  if (!user) throw new ApiError(404, 'No application profile found.', { code: 'USER_NOT_FOUND' });
  return user;
}

/**
 * POST /api/ai/chat
 * Body: { message: string, conversationId?: number }
 * Returns: { success, answer, sources, conversationId, toolsUsed }
 */
router.post('/ai/chat', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const body = req.body || {};

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      throw new ApiError(400, 'A message is required.', { code: 'VALIDATION_ERROR' });
    }
    if (message.length > 4000) {
      throw new ApiError(413, 'Message is too long (max 4000 characters).', { code: 'MESSAGE_TOO_LONG' });
    }
    // conversationId (optional) must be a positive integer if provided.
    let conversationId = null;
    if (body.conversationId != null) {
      const cid = Number(body.conversationId);
      if (!Number.isInteger(cid) || cid <= 0) {
        throw new ApiError(400, 'Invalid conversationId.', { code: 'VALIDATION_ERROR' });
      }
      conversationId = cid;
    }

    const result = await aiOrchestrator.ask({ user, message, conversationId });

    res.status(200).json({
      success: true,
      answer: result.answer,
      sources: result.sources || [],
      conversationId: result.conversationId,
      toolsUsed: result.toolsUsed || [],
      degraded: Boolean(result.degraded),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/conversations?limit=30
 * Returns the caller's own conversation threads (ownership enforced in SQL).
 */
router.get('/ai/conversations', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 30, 100));
    const conversations = await aiOrchestrator.listConversations(user, limit);
    res.status(200).json({
      success: true,
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Parse + validate a positive-integer :id route param, or throw 400. */
function parseId(raw, label = 'id') {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `Invalid ${label}.`, { code: 'VALIDATION_ERROR' });
  }
  return n;
}

/**
 * GET /api/ai/conversations/:id
 * Returns one conversation WITH its full message thread — only if owned by the
 * caller. A non-owned/absent id returns 404 (no existence leak).
 */
router.get('/ai/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const id = parseId(req.params.id, 'conversation id');
    const conversation = await aiOrchestrator.getConversation(user, id);
    if (!conversation) {
      throw new ApiError(404, 'Conversation not found.', { code: 'CONVERSATION_NOT_FOUND' });
    }
    res.status(200).json({ success: true, conversation });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/ai/conversations/:id   Body: { title }
 * Rename a conversation the caller owns.
 */
router.patch('/ai/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const id = parseId(req.params.id, 'conversation id');
    const title = typeof (req.body || {}).title === 'string' ? req.body.title.trim() : '';
    if (!title) throw new ApiError(400, 'A title is required.', { code: 'VALIDATION_ERROR' });
    if (title.length > 200) throw new ApiError(413, 'Title is too long.', { code: 'TITLE_TOO_LONG' });
    const updated = await aiOrchestrator.renameConversation(user, id, title);
    if (!updated) throw new ApiError(404, 'Conversation not found.', { code: 'CONVERSATION_NOT_FOUND' });
    res.status(200).json({
      success: true,
      conversation: { id: updated.id, title: updated.title, updatedAt: updated.updated_at },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/ai/conversations/:id
 * Delete a conversation the caller owns (messages cascade). 404 otherwise.
 */
router.delete('/ai/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const id = parseId(req.params.id, 'conversation id');
    const ok = await aiOrchestrator.deleteConversation(user, id);
    if (!ok) throw new ApiError(404, 'Conversation not found.', { code: 'CONVERSATION_NOT_FOUND' });
    res.status(200).json({ success: true, deleted: id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/ingest  (ADMIN ONLY)
 * Body: { sourceType?, sourceId?, classId?, limit? }
 *   - sourceType + sourceId => ingest ONE document
 *   - sourceType (+ optional classId) => bulk ingest that type
 *   - no body => ingest all supported types
 * Returns a per-source summary (indexed/skipped/failed + reasons). Never fakes
 * success: un-extractable/failed documents are reported as such.
 */
router.post('/ai/ingest', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const sourceType = body.sourceType ? String(body.sourceType) : null;

    if (sourceType && body.sourceId != null) {
      const sourceId = Number(body.sourceId);
      if (!Number.isInteger(sourceId) || sourceId <= 0) {
        throw new ApiError(400, 'Invalid sourceId.', { code: 'VALIDATION_ERROR' });
      }
      const result = await documentIngestService.ingestSource(sourceType, sourceId);
      return res.status(200).json({ success: true, result });
    }

    const classId = body.classId != null ? Number(body.classId) : null;
    const limit = body.limit != null ? Number(body.limit) : 500;
    const report = await documentIngestService.ingestAll({ sourceType, classId, limit });
    return res.status(200).json({ success: true, ...report });
  } catch (err) {
    next(err);
  }
});

/* ======================= AI document management (admin) ================== */

/** Shape an ai_documents row for the admin UI (no secrets/paths leaked). */
function toDocumentView(row) {
  return {
    id: row.id,
    title: row.title,
    fileId: row.file_id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    size: row.size_bytes != null ? Number(row.size_bytes) : null,
    accessScope: row.access_scope,
    program: row.program,
    branch: row.branch,
    semester: row.semester,
    classId: row.class_id,
    status: row.status,
    indexError: row.index_error,
    chunksCount: row.chunks_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/ai/documents  (ADMIN) — list uploaded AI documents + index status.
 */
router.get('/ai/documents', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await aiDocumentRepository.list({ limit: 200 });
    res.status(200).json({ success: true, documents: rows.map(toDocumentView) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/documents  (ADMIN, multipart) — upload a PDF/DOCX/TXT into the AI
 * knowledge base, then index it. Fields: title, accessScope(public|class),
 * program?, branch?, semester?, classId?. File field: `file`.
 * The original file goes to Firebase Storage; a `files` row + `ai_documents`
 * row are created; the document is then ingested (chunks + embeddings).
 */
router.post('/ai/documents', requireAuth, requireAdmin, upload.single('file'), async (req, res, next) => {
  try {
    if (!storageService.isEnabled()) {
      throw new ApiError(503, 'File storage is not enabled.', { code: 'STORAGE_NOT_ENABLED' });
    }
    const file = req.file;
    if (!file || !file.buffer || !file.buffer.length) {
      throw new ApiError(400, 'A file is required.', { code: 'VALIDATION_ERROR' });
    }
    if (!AI_DOC_MIME.has(file.mimetype)) {
      throw new ApiError(415, 'Only PDF, DOCX and TXT documents are supported.', { code: 'UNSUPPORTED_TYPE' });
    }
    const body = req.body || {};
    const title = String(body.title || file.originalname || 'Untitled document').trim().slice(0, 300);
    const accessScope = body.accessScope === 'class' ? 'class' : 'public';
    const scope = {
      program: accessScope === 'class' ? (body.program || null) : null,
      branch: accessScope === 'class' ? (body.branch || null) : null,
      semester: accessScope === 'class' && body.semester != null && body.semester !== ''
        ? Number(body.semester) : null,
      classId: accessScope === 'class' && body.classId ? Number(body.classId) : null,
    };

    // 1) Upload bytes to Firebase Storage (standalone path).
    const stored = await storageService.uploadStandalone({ buffer: file.buffer, mimeType: file.mimetype });

    // 2) Persist a `files` metadata row (entity_type='ai_document', no class).
    const fileRow = await fileRepository.insert({
      classId: null,
      uploadedBy: req.dbUser ? req.dbUser.id : null,
      entityType: 'ai_document',
      entityId: null,
      originalFilename: file.originalname,
      storagePath: stored.storagePath,
      mimeType: stored.mimeType,
      sizeBytes: stored.size,
      status: 'stored',
    });

    // 3) Register the AI document.
    const doc = await aiDocumentRepository.insert({
      title,
      fileId: fileRow.id,
      originalFilename: file.originalname,
      mimeType: stored.mimeType,
      sizeBytes: stored.size,
      accessScope,
      program: scope.program,
      branch: scope.branch,
      semester: scope.semester,
      classId: scope.classId,
      uploadedBy: req.dbUser ? req.dbUser.id : null,
    });
    // Backfill files.entity_id to the ai_documents row.
    try { await fileRepository.setEntityId(fileRow.id, doc.id); } catch { /* non-fatal */ }

    // 4) Index it (extract -> chunk -> embed). Updates the doc status; if Gemini
    // is not configured this returns status:'failed' with a clear reason — the
    // upload still succeeds so the admin can index later once a key is set.
    const ingest = await documentIngestService.ingestDocument(doc.id);
    const fresh = await aiDocumentRepository.findById(doc.id);

    res.status(201).json({ success: true, document: toDocumentView(fresh || doc), ingest });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai/documents/:id/reindex  (ADMIN) — re-run ingestion for a document.
 */
router.post('/ai/documents/:id/reindex', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id, 'document id');
    const ingest = await documentIngestService.ingestDocument(id);
    const fresh = await aiDocumentRepository.findById(id);
    if (!fresh) throw new ApiError(404, 'Document not found.', { code: 'DOCUMENT_NOT_FOUND' });
    res.status(200).json({ success: true, document: toDocumentView(fresh), ingest });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/ai/documents/:id  (ADMIN) — remove the AI document.
 * Always removes the AI registry row + its RAG chunks. The original stored file
 * is removed too (this document was uploaded specifically for the AI KB, so its
 * file is owned by it) — but ONLY the object this document created, never any
 * class content file. Query `?keepFile=1` preserves the stored file/metadata.
 */
router.delete('/ai/documents/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id, 'document id');
    const doc = await aiDocumentRepository.findById(id);
    if (!doc) throw new ApiError(404, 'Document not found.', { code: 'DOCUMENT_NOT_FOUND' });

    // 1) Remove RAG chunks for this document (source_type='document').
    await require('../repositories/aiRepository').deleteChunksForSource('document', id);

    // 2) Remove the AI registry row.
    await aiDocumentRepository.deleteById(id);

    // 3) Remove the underlying stored file (this doc owns it) unless keepFile=1.
    const keepFile = req.query.keepFile === '1' || req.query.keepFile === 'true';
    let fileRemoved = false;
    if (!keepFile && doc.file_id) {
      try {
        const fileRow = await fileRepository.findById(doc.file_id);
        if (fileRow && fileRow.entity_type === 'ai_document' && fileRow.storage_path) {
          await storageService.remove(fileRow.storage_path); // best-effort, never throws
          await fileRepository.deleteById(doc.file_id);
          fileRemoved = true;
        }
      } catch (e) {
        // Never fail the delete because storage cleanup hiccupped.
        console.error('[ai] document file cleanup failed:', e && e.message);
      }
    }

    res.status(200).json({ success: true, deleted: id, fileRemoved });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
