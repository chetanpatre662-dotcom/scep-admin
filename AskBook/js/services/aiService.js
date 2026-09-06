/**
 * aiService.js — AI Assistant client (FRONTEND).
 * -----------------------------------------------------------------------------
 * Calls the real Askbook backend AI Assistant:  POST /api/ai/chat
 *
 * The backend (aiOrchestrator) runs Google Gemini with server-side tool-calling,
 * RAG over college documents, role-based authorization and conversation memory.
 * The Gemini API key lives ONLY on the server — it is never exposed here, in the
 * browser, in localStorage, or in any response.
 *
 * ask() returns a reply object the shared chat UI understands:
 *   { role:'assistant', text, sources:[...], conversationId, at }
 *
 * Never throws: on any transport/auth error it returns a friendly assistant
 * message so the UI can render an error bubble (graceful degradation).
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';
import { authedRequest } from './apiClient.js';

/** Role-specific suggested prompts shown in the empty state. */
export function suggestedPrompts(role) {
  if (role === 'faculty') {
    return [
      'Show my active classes',
      'Summarize my recent announcements',
      'List my question papers',
      'What can you help me with?',
    ];
  }
  if (role === 'admin') {
    return [
      'What are the latest announcements?',
      'What upcoming events are there?',
      'What can you do?',
    ];
  }
  return [
    'Show my classes this semester',
    'Which question papers are available to me?',
    'Any announcements relevant to me?',
    'Find repeated questions in my previous papers',
  ];
}

function reply(text, extra = {}) {
  return { role: 'assistant', text, sources: [], at: new Date().toISOString(), ...extra };
}

/**
 * Ask the backend AI Assistant a question.
 * @param {object} p
 * @param {string} p.text            - the user's message
 * @param {number} [p.conversationId] - continue an existing thread
 * @returns {Promise<object>} assistant reply object (never throws)
 */
export async function ask({ text, conversationId } = {}) {
  const message = String(text || '').trim();
  if (!message) return reply('Please type a question.');

  if (!ENV.AUTH_USE_BACKEND) {
    return reply('The assistant needs the backend to be enabled.');
  }

  let token;
  try {
    token = await getIdToken();
  } catch {
    token = null;
  }
  if (!token) {
    return reply('Please sign in again to use the assistant.');
  }

  try {
    const body = { message };
    if (conversationId != null) body.conversationId = conversationId;
    const res = await authedRequest('/ai/chat', token, { method: 'POST', body });
    return reply(res.answer || "I couldn't find an answer to that.", {
      sources: Array.isArray(res.sources) ? res.sources : [],
      conversationId: res.conversationId != null ? res.conversationId : conversationId || null,
      toolsUsed: res.toolsUsed || [],
      degraded: Boolean(res.degraded),
    });
  } catch (e) {
    // Friendly, non-leaky error messages by status.
    const status = e && e.status;
    if (status === 503) {
      return reply('The AI Assistant is not available right now. Please try again later.');
    }
    if (status === 504) {
      return reply('The assistant took too long to respond. Please try again.');
    }
    if (status === 401) {
      return reply('Your session expired. Please sign in again.');
    }
    if (status === 413) {
      return reply('That message is too long. Please shorten it and try again.');
    }
    return reply('Something went wrong answering that. Please try again.');
  }
}
