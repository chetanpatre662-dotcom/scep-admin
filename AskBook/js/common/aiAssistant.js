/**
 * aiAssistant.js — Shared AI Assistant UI (backend-persisted conversations).
 * -----------------------------------------------------------------------------
 * Two-pane chat: left = conversation history (New chat, search, list with
 * rename/delete), right = the active thread + composer.
 *
 * Phase 2:
 *  - Conversations + messages are loaded from the backend (PostgreSQL), scoped
 *    to the authenticated user. No cross-user data (server-enforced).
 *  - Assistant answers render safe Markdown (js/common/markdown.js) + a Sources
 *    block with real in-app links.
 *  - Loading / empty / error states, retry, rename, delete-with-confirm.
 *  - Enter to send, Shift+Enter for newline, auto-scroll, disabled-while-busy.
 *
 * The Gemini API key is NEVER referenced here — the browser only talks to the
 * Askbook backend.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, initials } from './dom.js';
import { icon } from './icons.js';
import { ENV, ROUTES, resolvePath } from '../config.js';
import { renderMarkdown } from './markdown.js';
import { ask, suggestedPrompts } from '../services/aiService.js';
import {
  listConversations, getConversation, renameConversation, deleteConversation,
} from '../services/aiChatService.js';
import { confirmDialog, promptDialog } from './modal.js';
import { toastError, toastSuccess } from './toast.js';

/* Human-readable labels for source reference types. */
const SOURCE_LABEL = {
  note: 'Note',
  question_paper: 'Question Paper',
  assignment: 'Assignment',
  project: 'Project',
  announcement: 'Announcement',
  event: 'Event',
  document: 'Document',
};

/** Build a real, in-app link for a source reference (never an invented URL). */
function sourceHref(src, role) {
  if (!src) return null;
  if (src.fileId != null) {
    return `${ENV.API_BASE_URL}/files/${encodeURIComponent(src.fileId)}/download`;
  }
  if (src.classId != null) {
    const routes = ROUTES[String(role || '').toUpperCase()];
    if (routes && routes.CLASS_DETAIL) {
      return `${resolvePath(routes.CLASS_DETAIL)}?id=${encodeURIComponent(src.classId)}`;
    }
  }
  return null;
}

/** Render the "Sources" block for an assistant message (if any). */
function sourcesHTML(sources, role) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const items = sources.map((s) => {
    const label = SOURCE_LABEL[s.type] || 'Source';
    const title = esc(s.title || `${label} #${s.id}`);
    const meta = s.chunkIndex != null ? ` <span class="ai-src-meta">· section ${Number(s.chunkIndex) + 1}</span>` : '';
    const href = sourceHref(s, role);
    const inner = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : title;
    return `<li>${icon('file')} <span class="ai-src-type">${esc(label)}:</span> ${inner}${meta}</li>`;
  }).join('');
  return `<div class="ai-sources"><div class="ai-sources-head">Sources</div><ul>${items}</ul></div>`;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.main #appMain
 * @param {object} opts.user authenticated identity (+merged profile)
 * @param {'student'|'faculty'|'admin'} opts.role
 */
export function renderAssistant({ main, user, role }) {
  let activeId = null;         // server conversation id of the open thread
  let conversations = [];      // cached list for the sidebar
  let busy = false;
  let lastFailed = null;       // { text } of the last message that errored (retry)

  main.innerHTML = `
    <div class="ai-layout">
      <aside class="ai-history">
        <div class="aih-head">
          <button class="btn aih-new" id="newChat">${icon('plusCircle')} New chat</button>
        </div>
        <div class="aih-search">
          <input class="input" id="chatSearch" type="search" placeholder="Search chats…" />
        </div>
        <div class="aih-list" id="chatList"></div>
      </aside>

      <section class="ai-main">
        <div class="ai-scroll" id="aiScroll"></div>
        <div class="ai-composer-wrap">
          <div class="ai-composer">
            <textarea id="aiInput" rows="1" placeholder="Ask about your classes, papers, announcements, events, documents…"></textarea>
            <button class="ai-send" id="aiSend" aria-label="Send" disabled>${icon('send')}</button>
          </div>
          <div class="ai-disclaimer">Answers are grounded in your accessible Askbook data and cite their sources. The assistant is read-only and may occasionally be wrong &mdash; verify important details.</div>
        </div>
      </section>
    </div>
  `;

  const scroll = $('#aiScroll', main);
  const input = $('#aiInput', main);
  const sendBtn = $('#aiSend', main);

  /* ============================ history sidebar ========================== */

  async function loadHistory() {
    const list = $('#chatList', main);
    list.innerHTML = `<div class="aih-loading">${icon('loader')} Loading chats…</div>`;
    const res = await listConversations(50);
    if (!res.ok) {
      list.innerHTML = `<div class="aih-error">Couldn't load chats. <button class="btn-link" id="retryHist">Retry</button></div>`;
      const r = $('#retryHist', list);
      if (r) r.addEventListener('click', loadHistory);
      return;
    }
    conversations = res.conversations || [];
    renderHistory();
  }

  function renderHistory() {
    const q = ($('#chatSearch', main).value || '').trim().toLowerCase();
    const items = conversations.filter((c) => !q || (c.title || '').toLowerCase().includes(q));
    const list = $('#chatList', main);
    if (!items.length) {
      list.innerHTML = `<div class="aih-empty">${q ? 'No chats match your search.' : 'No conversations yet. Start a new chat.'}</div>`;
      return;
    }
    list.innerHTML = items.map((c) => `
      <div class="aih-item ${String(c.id) === String(activeId) ? 'active' : ''}" data-chat="${c.id}">
        ${icon('message')}
        <span class="aih-title">${esc(c.title || 'Untitled chat')}</span>
        <button class="btn-icon aih-rename" data-rename="${c.id}" aria-label="Rename chat">${icon('edit')}</button>
        <button class="btn-icon aih-del" data-del="${c.id}" aria-label="Delete chat">${icon('trash')}</button>
      </div>`).join('');

    $$('.aih-item', list).forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]') || e.target.closest('[data-rename]')) return;
        openConversation(el.dataset.chat);
      }));

    $$('[data-rename]', list).forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.rename;
        const current = conversations.find((c) => String(c.id) === String(id));
        const title = await promptDialog({
          title: 'Rename conversation',
          label: 'Conversation title',
          value: current ? current.title : '',
          confirmLabel: 'Save',
        });
        if (title == null) return;
        const trimmed = String(title).trim();
        if (!trimmed) return;
        const res = await renameConversation(id, trimmed);
        if (!res.ok) { toastError('Could not rename the conversation.'); return; }
        if (current) current.title = res.conversation ? res.conversation.title : trimmed;
        renderHistory();
        toastSuccess('Conversation renamed.');
      }));

    $$('[data-del]', list).forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.del;
        const ok = await confirmDialog({
          title: 'Delete conversation?',
          message: 'This conversation and its messages will be permanently removed.',
          confirmLabel: 'Delete',
        });
        if (!ok) return;
        const res = await deleteConversation(id);
        if (!res.ok) { toastError('Could not delete the conversation.'); return; }
        conversations = conversations.filter((c) => String(c.id) !== String(id));
        if (String(activeId) === String(id)) { activeId = null; renderWelcome(); }
        renderHistory();
        toastSuccess('Conversation deleted.');
      }));
  }

  /* ============================== thread view ============================ */

  function renderWelcome() {
    activeId = null;
    const prompts = suggestedPrompts(role);
    scroll.innerHTML = `
      <div class="ai-welcome">
        <div class="aiw-badge">${icon('sparkles')}</div>
        <h2>Ask anything about your college</h2>
        <p>I answer using only the Askbook data you're allowed to see — your classes, question papers, announcements, events and documents.</p>
        <div class="ai-suggestions">
          ${prompts.map((p) => `<button type="button" class="ai-suggestion" data-prompt="${esc(p)}">${icon('arrowRight')} ${esc(p)}</button>`).join('')}
        </div>
      </div>`;
    $$('.ai-suggestion', scroll).forEach((el) =>
      el.addEventListener('click', () => { input.value = el.dataset.prompt; onSend(); }));
    renderHistory();
  }

  function ensureThread() {
    let thread = $('#thread', scroll);
    if (!thread) {
      scroll.innerHTML = `<div class="ai-thread" id="thread"></div>`;
      thread = $('#thread', scroll);
    }
    return thread;
  }

  function bubble(m) {
    const el = document.createElement('div');
    el.className = `ai-msg ${m.role}`;
    const isAssistant = m.role === 'assistant';
    // Assistant text -> safe markdown; user text -> escaped plain (renderMarkdown
    // escapes first, so both are XSS-safe).
    const bodyHtml = isAssistant ? renderMarkdown(m.text || m.content || '') : `<p>${esc(m.text || m.content || '')}</p>`;
    const srcHtml = isAssistant ? sourcesHTML(m.sources, role) : '';
    el.innerHTML = `
      <div class="ai-ava">${isAssistant ? icon('sparkles') : esc(initials(user.name || 'You'))}</div>
      <div style="flex:1">
        <div class="ai-role">${isAssistant ? 'Assistant' : 'You'}</div>
        <div class="ai-body ai-md">${bodyHtml}</div>
        ${srcHtml}
      </div>`;
    return el;
  }

  function typingBubble() {
    const el = document.createElement('div');
    el.className = 'ai-msg assistant';
    el.id = 'typing';
    el.innerHTML = `
      <div class="ai-ava">${icon('sparkles')}</div>
      <div style="flex:1">
        <div class="ai-role">Assistant</div>
        <div class="ai-typing"><span></span><span></span><span></span></div>
      </div>`;
    return el;
  }

  function retryBar(text) {
    const el = document.createElement('div');
    el.className = 'ai-retry';
    el.innerHTML = `<button class="btn btn-sm" id="retryBtn">${icon('refresh')} Retry</button>`;
    el.querySelector('#retryBtn').addEventListener('click', () => {
      el.remove();
      input.value = text;
      onSend();
    });
    return el;
  }

  function scrollToBottom() { scroll.scrollTop = scroll.scrollHeight; }

  async function openConversation(id) {
    if (busy) return;
    activeId = id;
    renderHistory();
    scroll.innerHTML = `<div class="ai-loading-thread">${icon('loader')} Loading conversation…</div>`;
    const res = await getConversation(id);
    if (!res.ok || !res.conversation) {
      scroll.innerHTML = `<div class="ai-error-thread">Couldn't load this conversation. <button class="btn-link" id="reopen">Retry</button></div>`;
      const r = $('#reopen', scroll);
      if (r) r.addEventListener('click', () => openConversation(id));
      return;
    }
    const thread = ensureThread();
    thread.innerHTML = '';
    (res.conversation.messages || []).forEach((m) => thread.appendChild(bubble(m)));
    scrollToBottom();
  }

  /* =============================== send flow ============================= */

  async function onSend() {
    const text = input.value.trim();
    if (!text || busy) return;
    lastFailed = null;

    const thread = ensureThread();
    // Remove welcome content if present.
    const welcome = $('.ai-welcome', scroll);
    if (welcome) { scroll.innerHTML = `<div class="ai-thread" id="thread"></div>`; }
    const t = $('#thread', scroll);

    t.appendChild(bubble({ role: 'user', text }));
    input.value = '';
    autoGrow();
    busy = true;
    updateSendState();

    const typing = typingBubble();
    t.appendChild(typing);
    scrollToBottom();

    const answer = await ask({ text, conversationId: activeId || null });
    typing.remove();

    // Thread the server conversation id (new conversations get one back).
    const wasNew = !activeId;
    if (answer && answer.conversationId != null) activeId = answer.conversationId;

    t.appendChild(bubble({ role: 'assistant', text: answer.text, sources: answer.sources }));

    // On error, offer a retry affordance.
    if (answer && answer.error) {
      lastFailed = { text };
      t.appendChild(retryBar(text));
    }
    scrollToBottom();

    busy = false;
    updateSendState();

    // Refresh the sidebar so a newly-created conversation appears.
    if (wasNew && activeId != null) { await loadHistory(); }
  }

  /* ============================ composer behaviour ======================= */

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }
  function updateSendState() { sendBtn.disabled = input.value.trim() === '' || busy; }

  input.addEventListener('input', () => { autoGrow(); updateSendState(); });
  input.addEventListener('keydown', (e) => {
    // Enter to send, Shift+Enter for newline.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  });
  sendBtn.addEventListener('click', onSend);
  $('#newChat', main).addEventListener('click', () => { if (!busy) { renderWelcome(); input.focus(); } });
  $('#chatSearch', main).addEventListener('input', renderHistory);

  // Initial state
  renderWelcome();
  loadHistory();
  updateSendState();
  input.focus();
}
