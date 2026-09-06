/**
 * services/messageService.js
 * -----------------------------------------------------------------------------
 * Two-way class messaging. BOTH faculty and eligible students may send/read
 * (access enforced by classService.getClassForUser). PostgreSQL persists every
 * message; the WebSocket layer broadcasts the persisted server version.
 *
 * Server owns id + timestamp (client timestamps are never trusted). An optional
 * clientMsgId is echoed back so the sender can de-duplicate its optimistic copy.
 * -----------------------------------------------------------------------------
 */
'use strict';

const messageRepository = require('../repositories/messageRepository');
const classService = require('./classService');
const fileService = require('./fileService');
const ApiError = require('../utils/ApiError');

function toMessage(row, file) {
  return {
    id: row.id,
    classId: row.class_id,
    senderId: row.sender_user_id,
    senderName: row.sender_name || 'User',
    senderRole: row.sender_role || null,
    messageType: row.message_type || 'text',
    text: row.message || '',
    fileId: row.file_id || null,
    file: file || null, // metadata reference (populated for attachment messages)
    createdAt: row.created_at,
  };
}

/** Resolve + attach signed-URL file metadata for a message that has a file_id. */
async function withFile(row) {
  if (!row.file_id) return toMessage(row);
  const fileRow = await fileService.findById(row.file_id);
  if (!fileRow) return toMessage(row);
  let url = null;
  try { url = await fileService.signedUrlForFile(fileRow); } catch { url = null; }
  return toMessage(row, fileService.toFile(fileRow, url));
}

/** History (bootstrap + cursor pagination). Access-checked. */
async function history(user, classId, { limit, before } = {}) {
  await classService.getClassForUser(user, classId); // 403/404 if not allowed
  const rows = await messageRepository.listByClass(classId, { limit, before });
  const messages = await Promise.all(rows.map(withFile));
  const nextCursor = messages.length ? messages[0].id : null; // oldest loaded id
  return { messages, nextCursor };
}

/**
 * Persist a message from an authorized class member.
 * @param {object} user verified DB user
 * @param {number} classId
 * @param {object} input { text, messageType?, fileId? }
 * @returns {Promise<object>} the persisted, server-authoritative message
 */
async function sendMessage(user, classId, input = {}) {
  await classService.getClassForUser(user, classId); // any authorized member may send
  const type = ['text', 'image', 'file', 'video'].includes(input.messageType) ? input.messageType : 'text';
  const text = input.text != null ? String(input.text).trim() : '';

  // Text messages require text. Attachment messages require a fileId.
  if (type === 'text' && !text) {
    throw new ApiError(400, 'Message text is required.', { code: 'EMPTY_MESSAGE' });
  }
  if (type !== 'text' && !input.fileId) {
    throw new ApiError(400, 'Attachment messages require an uploaded file.', { code: 'MISSING_FILE' });
  }

  const row = await messageRepository.insert({
    classId: Number(classId),
    senderUserId: user.id,
    message: text,
    messageType: type,
    fileId: input.fileId || null,
  });
  return withFile(row);
}

/**
 * Send an attachment message: uploads the file to Storage, persists the files
 * row, then persists an attachment message that references it. Returns the
 * persisted message (with signed file URL). The WebSocket layer broadcasts it.
 * @param {object} user
 * @param {number} classId
 * @param {object} uploadedFile multer file { buffer, mimetype, originalname }
 * @param {object} opts { text? }
 */
async function sendAttachmentMessage(user, classId, uploadedFile, opts = {}) {
  await classService.getClassForUser(user, classId);
  if (!uploadedFile || !uploadedFile.buffer) {
    throw new ApiError(400, 'No file provided.', { code: 'MISSING_FILE' });
  }
  const mime = uploadedFile.mimetype || '';
  const type = mime.startsWith('image/') ? 'image' : (mime.startsWith('video/') ? 'video' : 'file');

  const f = await fileService.uploadFor({
    buffer: uploadedFile.buffer,
    mimeType: mime,
    originalFilename: uploadedFile.originalname,
    classId: Number(classId),
    entityType: 'message',
    uploadedBy: user.id,
  });

  let row;
  try {
    row = await messageRepository.insert({
      classId: Number(classId),
      senderUserId: user.id,
      message: opts.text ? String(opts.text).trim() : null,
      messageType: type,
      fileId: f.id,
    });
    await fileService.linkEntity(f.id, row.id);
  } catch (err) {
    await fileService.deleteFile(f.id); // orphan cleanup (Storage + metadata)
    throw err;
  }
  return withFile(row);
}

module.exports = { history, sendMessage, sendAttachmentMessage, toMessage };
