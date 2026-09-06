/**
 * admin/aiDocuments.js — Admin AI Knowledge-Base document management.
 * -----------------------------------------------------------------------------
 * Admin-only page to upload PDF/DOCX/TXT documents into the AI knowledge base,
 * view their indexing status (indexed / pending / failed / skipped + error and
 * chunk count), re-index, and delete. Access scope (public vs a class academic
 * group) is set at upload time and enforced server-side during RAG retrieval.
 *
 * All authorization is server-side (requireAuth + requireAdmin). This page never
 * sees the Gemini key. Uploads succeed even when the AI is not configured — the
 * document is stored and marked 'failed' with a clear reason so it can be
 * re-indexed once a key is set.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, formatDate, debounce } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, errorState, loadingState } from '../common/components.js';
import { confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError, toastInfo } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';
import { listDocuments, uploadDocument, reindexDocument, deleteDocument } from '../services/aiDocumentsService.js';

let docs = [];

bootstrapAdmin({ activeId: 'ai-documents', title: 'AI Documents' }).then((ctx) => { if (ctx) init(ctx); });

function formatBytes(n) {
  if (n == null) return '—';
  const b = Number(n);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_BADGE = {
  indexed: 'badge badge-success',
  pending: 'badge',
  failed: 'badge badge-danger',
  skipped: 'badge badge-warning',
};

function statusBadge(d) {
  const cls = STATUS_BADGE[d.status] || 'badge';
  const label = (d.status || 'pending').replace(/^\w/, (c) => c.toUpperCase());
  const chunks = d.status === 'indexed' && d.chunksCount ? ` · ${d.chunksCount} chunks` : '';
  return `<span class="${cls}" title="${esc(d.indexError || '')}">${esc(label)}${chunks}</span>`;
}

function scopeLabel(d) {
  if (d.accessScope === 'public') return 'Public (all users)';
  const parts = [d.program, d.branch, d.semester != null ? `Sem ${d.semester}` : null].filter(Boolean);
  return parts.length ? `Class: ${esc(parts.join(' · '))}` : 'Class-scoped';
}

function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">AI Knowledge Base</h1>
        <p class="page-subtitle">Upload college documents (PDF, DOCX, TXT) for the AI Assistant to search. Access scope controls who the AI can surface a document to.</p>
      </div>
    </div>

    <div class="card mb-4"><div class="card-body">
      <h3 class="mb-3">Upload a document</h3>
      <form id="uploadForm" class="ai-doc-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="docTitle">Title</label>
            <input class="input" id="docTitle" type="text" placeholder="e.g. Academic Calendar 2026" />
          </div>
          <div class="form-group">
            <label class="form-label" for="docFile">File (PDF, DOCX or TXT · max 25 MB)</label>
            <input class="input" id="docFile" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" required />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="docScope">Visibility</label>
            <select id="docScope">
              <option value="public">Public — any authenticated user</option>
              <option value="class">Class-scoped — a specific academic group</option>
            </select>
          </div>
        </div>
        <div class="form-row" id="scopeFields" style="display:none">
          <div class="form-group">
            <label class="form-label" for="docProgram">Course / Program</label>
            <input class="input" id="docProgram" type="text" placeholder="e.g. B.Tech" />
          </div>
          <div class="form-group">
            <label class="form-label" for="docBranch">Branch</label>
            <input class="input" id="docBranch" type="text" placeholder="e.g. Computer Science" />
          </div>
          <div class="form-group">
            <label class="form-label" for="docSemester">Semester</label>
            <input class="input" id="docSemester" type="number" min="1" max="8" placeholder="e.g. 3" />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="uploadBtn">${icon('plusCircle')} Upload &amp; index</button>
          <span class="ai-doc-hint text-muted">The document is indexed immediately when the AI is configured.</span>
        </div>
      </form>
    </div></div>

    <div class="card"><div class="card-body">
      <div class="toolbar mb-3">
        <input class="input search" id="searchInput" type="search" placeholder="Search documents…" />
        <button class="btn btn-ghost" id="refreshBtn">${icon('refresh')} Refresh</button>
      </div>
      <div id="docTable">${loadingState('Loading documents…')}</div>
    </div></div>
  `;

  const scopeSel = $('#docScope', main);
  const scopeFields = $('#scopeFields', main);
  scopeSel.addEventListener('change', () => {
    scopeFields.style.display = scopeSel.value === 'class' ? '' : 'none';
  });

  $('#uploadForm', main).addEventListener('submit', onUpload);
  $('#refreshBtn', main).addEventListener('click', load);
  $('#searchInput', main).addEventListener('input', debounce(render, 200));

  load();
}

async function load() {
  const host = $('#docTable');
  if (host) host.innerHTML = loadingState('Loading documents…');
  const res = await listDocuments();
  if (!res.ok) {
    if (host) host.innerHTML = errorState(res.status === 401 ? 'Please sign in again.' : 'Could not load documents.');
    return;
  }
  docs = res.documents || [];
  render();
}

function render() {
  const host = $('#docTable');
  if (!host) return;
  const q = ($('#searchInput') && $('#searchInput').value || '').trim().toLowerCase();
  const rows = docs.filter((d) => !q || (d.title || '').toLowerCase().includes(q) || (d.filename || '').toLowerCase().includes(q));

  if (!rows.length) {
    host.innerHTML = emptyState({
      iconName: 'file',
      title: docs.length ? 'No matching documents' : 'No documents yet',
      message: docs.length ? 'Try a different search.' : 'Upload a PDF, DOCX or TXT to build the AI knowledge base.',
    });
    return;
  }

  host.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Document</th><th>Type</th><th>Size</th><th>Scope</th>
            <th>Status</th><th>Uploaded</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((d) => `
            <tr data-id="${d.id}">
              <td><strong>${esc(d.title || 'Untitled')}</strong><br><span class="text-muted small">${esc(d.filename || '')}</span></td>
              <td>${esc(shortType(d.mimeType))}</td>
              <td>${formatBytes(d.size)}</td>
              <td>${scopeLabel(d)}</td>
              <td>${statusBadge(d)}${d.status === 'failed' && d.indexError ? `<br><span class="text-muted small">${esc(d.indexError)}</span>` : ''}</td>
              <td>${formatDate(d.createdAt)}</td>
              <td class="row-actions">
                <button class="btn-icon" data-reindex="${d.id}" title="Re-index">${icon('refresh')}</button>
                <button class="btn-icon" data-del="${d.id}" title="Delete">${icon('trash')}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  $$('[data-reindex]', host).forEach((b) => b.addEventListener('click', () => onReindex(b.dataset.reindex)));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.del)));
}

function shortType(mime) {
  if (!mime) return '—';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('wordprocessingml')) return 'DOCX';
  if (mime === 'text/plain') return 'TXT';
  return mime;
}

async function onUpload(e) {
  e.preventDefault();
  const fileEl = $('#docFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) { toastError('Choose a file to upload.'); return; }

  const scope = $('#docScope').value;
  const btn = $('#uploadBtn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Uploading…`;

  const res = await uploadDocument({
    file,
    title: ($('#docTitle').value || '').trim() || file.name,
    accessScope: scope,
    program: $('#docProgram') ? $('#docProgram').value.trim() : '',
    branch: $('#docBranch') ? $('#docBranch').value.trim() : '',
    semester: $('#docSemester') ? $('#docSemester').value : '',
  });

  btn.disabled = false;
  btn.innerHTML = `${icon('plusCircle')} Upload &amp; index`;

  if (!res.ok) {
    toastError(res.error || 'Upload failed.');
    return;
  }
  // Report the real indexing outcome (never fake success).
  const ing = res.ingest || (res.document ? { status: res.document.status } : null);
  if (ing && ing.status === 'indexed') toastSuccess(`Uploaded and indexed (${ing.chunks || res.document.chunksCount || 0} chunks).`);
  else if (ing && ing.status === 'failed') toastInfo(`Uploaded, but not indexed: ${ing.reason || 'see status'}. You can re-index later.`);
  else if (ing && ing.status === 'skipped') toastInfo(`Uploaded, but skipped indexing: ${ing.reason || 'no extractable text'}.`);
  else toastSuccess('Document uploaded.');

  $('#uploadForm').reset();
  $('#scopeFields').style.display = 'none';
  load();
}

async function onReindex(id) {
  toastInfo('Re-indexing…');
  const res = await reindexDocument(id);
  if (!res.ok) { toastError(res.error || 'Re-index failed.'); return; }
  const ing = res.ingest || {};
  if (ing.status === 'indexed') toastSuccess(`Indexed (${ing.chunks || 0} chunks).`);
  else toastInfo(`Not indexed: ${ing.reason || ing.status || 'see status'}.`);
  load();
}

async function onDelete(id) {
  const ok = await confirmDialog({
    title: 'Delete document?',
    message: 'This removes the document from the AI knowledge base (its text index and the uploaded file). This cannot be undone.',
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  const res = await deleteDocument(id);
  if (!res.ok) { toastError(res.error || 'Delete failed.'); return; }
  docs = docs.filter((d) => String(d.id) !== String(id));
  render();
  toastSuccess('Document deleted.');
}
