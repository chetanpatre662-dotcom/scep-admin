/**
 * classDetail.js — Shared real-data class detail (faculty + student).
 * -----------------------------------------------------------------------------
 * Tabs: Overview, Notes, Question Papers, Assignments, Projects, Messages.
 *
 * Data flow (NO polling, NO mock):
 *   1. Bootstrap: GET /api/classes/:id (access-checked) + one content GET per
 *      tab on first open + GET messages history once.
 *   2. Live: realtimeService WebSocket — join the class room, then apply pushed
 *      events (note.created, assignment.created, message.created, …) to the
 *      in-memory class state and patch only the affected tab. No refetch loops.
 *
 * Permissions: faculty (owner/admin access) can publish/delete Notes, Question
 * Papers, Assignments, Projects. Students are read-only for those. Messages are
 * two-way for everyone with class access.
 *
 * File attachments are REAL (Firebase Cloud Storage via the backend): faculty
 * attach files to content, and anyone with class access can attach files to
 * messages. Images are compressed client-side (canvas) before upload; PDFs and
 * videos are preserved as-is. Binary never touches PostgreSQL — only metadata +
 * the storage reference. Downloads use backend-issued signed URLs
 * (GET /api/files/:id/download). No local/fake fallback.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, formatDate, timeAgo, initials } from './dom.js';
import { icon } from './icons.js';
import { emptyState, loadingState } from './components.js';
import { toastSuccess, toastError } from './toast.js';
import { openModal, confirmDialog } from './modal.js';
import { validateForm, rules, clearErrors } from './validation.js';
import { getClass, listContent, createContent, createContentWithFile, deleteContent, getMessages, sendMessageAttachment, fileDownloadPath } from '../services/classApiService.js';
import { ENV } from '../config.js';
import * as realtime from '../services/realtimeService.js';

// Build an absolute backend URL for authenticated file downloads.
function downloadUrl(fileId) { return `${ENV.API_BASE_URL}${fileDownloadPath(fileId)}`; }

// tab key -> { label, content(url segment) | 'messages' | 'overview', event prefix }
const CONTENT_TABS = [
  { key: 'notes', label: 'Notes', seg: 'notes', ev: 'note' },
  { key: 'papers', label: 'Question Papers', seg: 'question-papers', ev: 'questionPaper' },
  { key: 'assignments', label: 'Assignments', seg: 'assignments', ev: 'assignment' },
  { key: 'projects', label: 'Projects', seg: 'projects', ev: 'project' },
];

/**
 * @param {object} opts { main, user, role:'student'|'faculty', backUrl, canManage }
 */
export async function renderClassDetail({ main, user, role, backUrl, canManage }) {
  const classId = new URLSearchParams(window.location.search).get('id');
  main.innerHTML = loadingState('Loading class…');

  const res = await getClass(classId);
  if (!res.ok) {
    main.innerHTML = `
      <div class="page-head"><a class="btn btn-sm" href="${backUrl}">${icon('arrowLeft')} Back</a></div>
      ${emptyState({ iconName: 'classes', title: 'Class unavailable', message: res.error || 'You do not have access to this class.' })}`;
    return;
  }
  const cls = res.class;
  // canManage should reflect the SERVER's access decision, not the portal.
  const manage = canManage && (res.access === 'faculty' || res.access === 'admin');

  // In-memory class state; realtime events patch only the relevant slice.
  const state = { notes: [], papers: [], assignments: [], projects: [], messages: [], loaded: {} };

  const subject = cls.subject || cls.title || 'Class';
  main.innerHTML = `
    <div class="page-head"><a class="btn btn-sm" href="${backUrl}">${icon('arrowLeft')} Back to classes</a></div>
    <div class="class-hero">
      <h1>${esc(subject)}</h1>
      <div class="ch-sub">
        <span>${esc(cls.course)} • ${esc(cls.branch)} • Semester ${esc(String(cls.semester))}</span>
        <span>·</span><span>${esc(cls.facultyName || 'Faculty')}</span>
        <span class="kc-status">${esc((cls.status || 'active').replace(/^./, (m) => m.toUpperCase()))}</span>
        <span class="rt-indicator" id="rtDot" title="Realtime status">●</span>
      </div>
      ${cls.description ? `<p class="ch-desc">${esc(cls.description)}</p>` : ''}
    </div>
    <div class="tabs" role="tablist" id="tabs"></div>
    <div id="tabBody"></div>
  `;

  const TABS = ['overview', ...CONTENT_TABS.map((t) => t.key), 'messages'];
  const TAB_LABELS = { overview: 'Overview', notes: 'Notes', papers: 'Question Papers', assignments: 'Assignments', projects: 'Projects', messages: 'Messages' };
  let activeTab = 'overview';

  const tabsEl = $('#tabs', main);
  tabsEl.innerHTML = TABS.map((k) => `<button class="tab ${k === 'overview' ? 'active' : ''}" data-tab="${k}">${TAB_LABELS[k]}</button>`).join('');
  $$('.tab', tabsEl).forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));

  // Realtime connection status dot.
  const rtDot = $('#rtDot', main);
  const applyState = (s) => { if (rtDot) rtDot.style.color = s === 'authenticated' ? 'var(--success-600,#16a34a)' : (s === 'reconnecting' ? 'var(--warning-600,#d97706)' : 'var(--gray-400,#94a3b8)'); };
  const offState = realtime.onStateChange(applyState);
  applyState(realtime.getState());

  // Join the class room and subscribe to live events.
  realtime.joinClass(classId);
  const subs = [];
  CONTENT_TABS.forEach((t) => {
    subs.push(realtime.subscribe(`${t.ev}.created`, (m) => { state[t.key].unshift(m); if (activeTab === t.key) renderTab(); }));
    subs.push(realtime.subscribe(`${t.ev}.deleted`, (m) => { state[t.key] = state[t.key].filter((x) => String(x.id) !== String(m.id)); if (activeTab === t.key) renderTab(); }));
    subs.push(realtime.subscribe(`${t.ev}.updated`, (m) => { const i = state[t.key].findIndex((x) => String(x.id) === String(m.id)); if (i >= 0) state[t.key][i] = m; if (activeTab === t.key) renderTab(); }));
  });
  subs.push(realtime.subscribe('message.created', (frame) => {
    const msg = frame.message;
    if (String(msg.classId) !== String(classId)) return;
    state.messages.push(msg);
    if (activeTab === 'messages') { renderMessagesList(); scrollMessages(); }
  }));

  // Clean up realtime subscriptions when navigating away.
  window.addEventListener('beforeunload', cleanup, { once: true });
  function cleanup() { subs.forEach((off) => off && off()); offState && offState(); realtime.leaveClass(classId); }

  selectTab('overview');

  /* ---------------- tab rendering ---------------- */
  async function selectTab(key) {
    activeTab = key;
    $$('.tab', tabsEl).forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    await ensureLoaded(key);
    renderTab();
  }

  async function ensureLoaded(key) {
    if (key === 'overview') return;
    if (state.loaded[key]) return;
    const body = $('#tabBody', main);
    body.innerHTML = loadingState('Loading…');
    if (key === 'messages') {
      const r = await getMessages(classId, { limit: 50 });
      if (!r.ok) { body.innerHTML = errorHTML(r.error, () => { state.loaded[key] = false; selectTab(key); }); wireRetry(body, key); return; }
      state.messages = r.messages || [];
      state.messagesCursor = r.nextCursor || null;
    } else {
      const t = CONTENT_TABS.find((x) => x.key === key);
      const r = await listContent(classId, t.seg);
      if (!r.ok) { body.innerHTML = errorHTML(r.error, null); wireRetry(body, key); return; }
      state[key] = r.items || [];
    }
    state.loaded[key] = true;
  }

  function wireRetry(body, key) {
    body.querySelector('#tabRetry')?.addEventListener('click', () => { state.loaded[key] = false; selectTab(key); });
  }

  function renderTab() {
    const body = $('#tabBody', main);
    if (activeTab === 'overview') return renderOverview(body);
    if (activeTab === 'messages') return renderMessages(body);
    return renderContent(body, activeTab);
  }

  function renderOverview(body) {
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="metric-row">
          ${stat(state.notes.length, 'Notes')}${stat(state.papers.length, 'Question Papers')}
          ${stat(state.assignments.length, 'Assignments')}${stat(state.projects.length, 'Projects')}
        </div>
        <p class="text-muted" style="margin-top:12px">${esc(cls.course)} • ${esc(cls.branch)} • Semester ${esc(String(cls.semester))}${cls.subjectCode ? ' • ' + esc(cls.subjectCode) : ''}</p>
        ${cls.description ? `<p style="margin-top:8px">${esc(cls.description)}</p>` : ''}
      </div></div>`;
  }
  function stat(v, l) { return `<div class="metric"><div class="m-label">${esc(l)}</div><div class="m-value">${v}</div></div>`; }

  /* ---- content tabs (notes/papers/assignments/projects) ---- */
  function renderContent(body, key) {
    const t = CONTENT_TABS.find((x) => x.key === key);
    const items = state[key] || [];
    const addBtn = manage ? `<button class="btn btn-primary btn-sm" id="addContentBtn">${icon('plus')} Add ${TAB_LABELS[key].replace(/s$/, '')}</button>` : '';
    const list = items.length
      ? `<div class="list-flush">${items.map((it) => contentRow(it, t)).join('')}</div>`
      : emptyState({ iconName: 'file', title: `No ${TAB_LABELS[key].toLowerCase()} yet`, message: manage ? 'Publish the first one for your students.' : `Your faculty hasn't posted any ${TAB_LABELS[key].toLowerCase()} yet.` });
    body.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">${TAB_LABELS[key]}</span>${addBtn}</div><div class="card-body">${list}</div></div>`;
    if (manage) {
      $('#addContentBtn', body)?.addEventListener('click', () => openAddContent(t));
      $$('[data-del]', body).forEach((b) => b.addEventListener('click', () => onDeleteContent(t, b.dataset.del)));
    }
  }
  function contentRow(it, t) {
    const due = it.dueDate ? ` · Due ${esc(formatDate(it.dueDate))}` : '';
    const del = manage ? `<button class="btn-icon" data-del="${it.id}" title="Delete">${icon('trash')}</button>` : '';
    // Downloadable when a real Storage file id exists (served via signed URL).
    let dl = '';
    if (it.file && it.file.id) {
      const sz = it.file.size ? ` (${fmtSize(it.file.size)})` : '';
      dl = `<a class="btn btn-sm" href="${esc(downloadUrl(it.file.id))}" target="_blank" rel="noopener" title="${esc((it.file.name || 'file') + sz)}">${icon('download')}</a>`;
    }
    return `<div class="list-row"><span class="lr-icon">${icon('file')}</span>
      <div class="lr-main"><div class="lr-title">${esc(it.title)}</div>
      <div class="lr-meta">${esc(it.description || '')}${due}${it.file && it.file.name ? ' · ' + esc(it.file.name) : ''}</div></div>
      <div class="lr-right">${dl}${del}</div></div>`;
  }
  function fmtSize(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function openAddContent(t) {
    const isDue = t.key === 'assignments' || t.key === 'projects';
    const { close, el } = openModal({
      title: `Add ${TAB_LABELS[t.key].replace(/s$/, '')}`,
      body: `<form id="cForm" novalidate>
        <div class="form-group"><label class="form-label" for="title">Title <span class="req">*</span></label>
          <input class="input" id="title" name="title" /><div class="field-error"></div></div>
        <div class="form-group"><label class="form-label" for="description">Description</label>
          <textarea class="input" id="description" name="description"></textarea></div>
        ${isDue ? `<div class="form-group"><label class="form-label" for="dueDate">Due date</label><input class="input" id="dueDate" name="dueDate" type="date" /></div>` : ''}
        <div class="form-group"><label class="form-label" for="file">Attachment (optional)</label>
          <input class="input" id="file" name="file" type="file" accept="image/*,application/pdf,video/mp4,video/webm,.doc,.docx,.ppt,.pptx,.txt" />
          <div class="field-error"></div>
          <p class="text-muted" style="font-size:var(--fs-xs);margin-top:4px">PDF/images/video up to 25 MB. Images are compressed before upload.</p></div>
      </form>`,
      actions: [
        { label: 'Cancel', class: 'btn-ghost' },
        { label: 'Publish', class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
      ],
    });
    const form = $('#cForm', el);
    async function submit() {
      clearErrors(form);
      if (!validateForm(form, { title: [rules.required] })) return;
      const data = { title: form.elements['title'].value.trim(), description: form.elements['description'].value.trim() };
      if (isDue && form.elements['dueDate'].value) data.dueDate = form.elements['dueDate'].value;
      const fileInput = form.elements['file'];
      const file = fileInput && fileInput.files && fileInput.files[0];
      const publishBtn = el.querySelector('.btn-primary');
      if (publishBtn) { publishBtn.disabled = true; publishBtn.textContent = file ? 'Uploading…' : 'Publishing…'; }
      // With a file -> multipart upload (Storage); without -> JSON create.
      const r = file
        ? await createContentWithFile(classId, t.seg, data, file)
        : await createContent(classId, t.seg, data);
      if (publishBtn) { publishBtn.disabled = false; publishBtn.textContent = 'Publish'; }
      if (!r.ok) return toastError(r.error || 'Could not publish.');
      // The realtime <ev>.created event will add it to state + re-render; also
      // add locally for the publisher in case they aren't yet in the room.
      if (r.item && !state[t.key].some((x) => String(x.id) === String(r.item.id))) state[t.key].unshift(r.item);
      toastSuccess(`${TAB_LABELS[t.key].replace(/s$/, '')} published.`);
      close();
      if (activeTab === t.key) renderTab();
    }
  }

  async function onDeleteContent(t, id) {
    const ok = await confirmDialog({ title: 'Delete?', message: 'This will be removed for everyone.', confirmLabel: 'Delete' });
    if (!ok) return;
    const r = await deleteContent(classId, t.seg, id);
    if (!r.ok) return toastError(r.error || 'Could not delete.');
    state[t.key] = state[t.key].filter((x) => String(x.id) !== String(id));
    toastSuccess('Deleted.');
    if (activeTab === t.key) renderTab();
  }

  /* ---- messages (two-way realtime) ---- */
  function renderMessages(body) {
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <div id="msgList" class="msg-list" style="max-height:52vh;overflow:auto"></div>
        <div class="msg-composer" style="margin-top:12px;display:flex;gap:8px;align-items:flex-end">
          <textarea class="input" id="msgText" placeholder="Type a message…" rows="2" style="flex:1"></textarea>
          <input type="file" id="msgFile" accept="image/*,application/pdf,video/mp4,video/webm,.doc,.docx,.ppt,.pptx,.txt" hidden />
          <button class="btn btn-ghost" id="msgAttach" title="Attach a file">${icon('file')}</button>
          <button class="btn btn-primary" id="msgSend">${icon('send')} Send</button>
        </div>
        <div id="msgFileName" class="text-muted" style="font-size:var(--fs-xs);margin-top:4px"></div>
      </div></div>`;
    renderMessagesList();
    scrollMessages();
    const ta = $('#msgText', body);
    const fileEl = $('#msgFile', body);
    const nameEl = $('#msgFileName', body);
    $('#msgAttach', body).addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      nameEl.innerHTML = f ? `${icon('file')} ${esc(f.name)} — <a href="#" id="msgFileClear">remove</a>` : '';
      nameEl.querySelector('#msgFileClear')?.addEventListener('click', (e) => { e.preventDefault(); fileEl.value = ''; nameEl.textContent = ''; });
    });
    $('#msgSend', body).addEventListener('click', () => doSend(ta, fileEl, nameEl));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(ta, fileEl, nameEl); } });
  }
  function renderMessagesList() {
    const listEl = $('#msgList', main);
    if (!listEl) return;
    if (!state.messages.length) { listEl.innerHTML = `<p class="text-muted" style="text-align:center;padding:20px">No messages yet. Start the conversation.</p>`; return; }
    listEl.innerHTML = state.messages.map(msgRow).join('');
  }
  function msgRow(m) {
    const mine = user && (m.senderName === user.name);
    return `<div class="msg-item ${mine ? 'mine' : ''}">
      <div class="msg-avatar">${esc(initials(m.senderName || 'U'))}</div>
      <div style="flex:1">
        <div class="msg-head"><strong>${esc(m.senderName || 'User')}</strong>
          <span class="text-muted" style="font-size:var(--fs-xs)"> · ${esc(m.senderRole || '')} · ${esc(timeAgo(m.createdAt))}</span></div>
        ${m.text ? `<div class="msg-body">${esc(m.text)}</div>` : ''}
        ${attachmentHTML(m)}
      </div></div>`;
  }
  /** Render an attachment preview inside a message (image thumb / video / file link). */
  function attachmentHTML(m) {
    if (!m.file || !m.file.id) return '';
    const href = downloadUrl(m.file.id);
    const type = m.file.mimeType || m.file.type || '';
    const name = esc(m.file.name || 'attachment');
    if (type.startsWith('image/')) {
      return `<a class="msg-attach" href="${esc(href)}" target="_blank" rel="noopener" title="${name}">
        <img src="${esc(m.file.url || href)}" alt="${name}" style="max-width:220px;max-height:220px;border-radius:8px;margin-top:6px;display:block" loading="lazy" /></a>`;
    }
    if (type.startsWith('video/')) {
      return `<video src="${esc(m.file.url || href)}" controls style="max-width:260px;border-radius:8px;margin-top:6px;display:block"></video>`;
    }
    return `<a class="btn btn-sm msg-attach" href="${esc(href)}" target="_blank" rel="noopener" style="margin-top:6px">${icon('download')} ${name}</a>`;
  }
  function scrollMessages() { const el = $('#msgList', main); if (el) el.scrollTop = el.scrollHeight; }

  let sending = false;
  async function doSend(ta, fileEl, nameEl) {
    const text = (ta.value || '').trim();
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (sending) return;
    if (!text && !file) return;
    sending = true;
    try {
      if (file) {
        // Attachment: upload to Storage via backend (multipart); the message is
        // persisted + broadcast over WebSocket as message.created (deduped).
        const clientMsgId = `c-${Date.now()}`;
        const r = await sendMessageAttachment(classId, file, { text, clientMsgId });
        if (!r.ok) { toastError(r.error || 'Could not send attachment.'); return; }
        if (fileEl) fileEl.value = '';
        if (nameEl) nameEl.textContent = '';
        ta.value = '';
      } else {
        // Text: send over WebSocket; persisted message returns via message.created
        // (deduped). No optimistic append — server-authoritative round-trip.
        realtime.sendMessage(classId, text, `c-${Date.now()}`);
        ta.value = '';
      }
    } finally {
      setTimeout(() => { sending = false; }, 150);
    }
  }

  function errorHTML(message, _retry) {
    return `<div class="card"><div class="card-body" style="text-align:center;padding:24px">
      <div class="text-muted" style="margin-bottom:12px">${icon('alert')} ${esc(message || 'Failed to load. Please try again.')}</div>
      <button class="btn btn-primary" id="tabRetry">${icon('arrowRight')} Retry</button></div></div>`;
  }
}
