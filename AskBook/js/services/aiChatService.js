/**
 * aiChatService.js — AI conversation client (FRONTEND, backend-persisted).
 * -----------------------------------------------------------------------------
 * Phase 2: conversations now live in PostgreSQL (ai_conversations/ai_messages),
 * scoped to the authenticated user server-side. This module is a thin REST
 * client over the backend AI conversation endpoints. It replaces the previous
 * localStorage mock while keeping a compatible surface for the chat UI.
 *
 * Every call resolves the Firebase ID token and never sends userId/role — the
 * backend derives identity from the verified token, so a user can only ever see
 * or modify their OWN conversations.
 *
 * All functions return { ok, ... } result objects (never throw), so the UI can
 * render loading/empty/error states cleanly.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

async function tk() {
  if (!ENV.AUTH_USE_BACKEND) return { t: null, err: { ok: false, error: 'Backend disabled.', status: 0 } };
  let t = null;
  try { t = await getIdToken(); } catch { t = null; }
  if (!t) return { t: null, err: { ok: false, error: 'Not authenticated.', status: 401 } };
  return { t, err: null };
}

async function call(path, opts = {}) {
  const { t, err } = await tk();
  if (err) return err;
  try {
    const res = await authedRequest(path, t, opts);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e?.message || 'Request failed.', status: e?.status };
  }
}

/** List the current user's conversations (newest first). */
export function listConversations(limit = 30) {
  return call(`/ai/conversations?limit=${encodeURIComponent(limit)}`, { method: 'GET' });
}

/** Load one conversation with its full message thread (ownership enforced). */
export function getConversation(id) {
  return call(`/ai/conversations/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** Rename a conversation the user owns. */
export function renameConversation(id, title) {
  return call(`/ai/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } });
}

/** Delete a conversation the user owns (messages cascade). */
export function deleteConversation(id) {
  return call(`/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
