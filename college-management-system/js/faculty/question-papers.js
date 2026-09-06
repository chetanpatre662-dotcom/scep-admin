/**
 * faculty/question-papers.js — Upload + browse question papers (REAL backend).
 * -----------------------------------------------------------------------------
 * Papers are class-scoped content. Listing comes from GET /faculty/question-papers
 * (papers across the faculty's classes). Upload sends the real file to Firebase
 * Storage via the class content endpoint; only metadata is stored in Postgres.
 * Downloads use the backend signed-URL redirect. No mock, no localStorage.
 * -----------------------------------------------------------------------------
 */
import { ENV, COURSE_TYPES, BRANCHES } from '../config.js';
import { $, $$, esc, formatDate, debounce } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { validateForm, rules, clearErrors, setFieldError } from '../common/validation.js';
import { bootstrapFaculty } from './nav.js';
import { getFacultyPapers, uploadPaper, paperDownloadPath } from '../services/questionPaperService.js';
import { getFacultyClasses, deleteContent } from '../services/classApiService.js';

let all = [];
let facultyClasses = [];

bootstrapFaculty({ activeId: 'papers', title: 'Question Papers' }).then((ctx) => { if (ctx) init(ctx); });

function downloadUrl(fileId) { return `${ENV.API_BASE_URL}${paperDownloadPath(fileId)}`; }

async function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Previous Question Papers</h1>
        <p class="page-subtitle">Upload and organize question papers for your classes.</p>
      </div>
      <button class="btn btn-primary" id="uploadBtn">${icon('upload')} Upload Paper</button>
    </div>

    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search by subject or title…" />
        <select id="filterCourse"><option value="">All Courses</option>
          <option>${COURSE_TYPES.BTECH}</option><option>${COURSE_TYPES.POLYTECHNIC}</option></select>
        <select id="filterBranch"><option value="">All Branches</option>
          ${BRANCHES.map((b) => `<option>${b}</option>`).join('')}</select>
      </div>
    </div></div>

    <div id="list">${skeletonCards(3)}</div>
  `;

  $('#uploadBtn').addEventListener('click', openUpload);
  $('#searchInput').addEventListener('input', debounce(render, 200));
  $('#filterCourse').addEventListener('change', render);
  $('#filterBranch').addEventListener('change', render);

  await load();
}

async function load() {
  const host = $('#list');
  host.innerHTML = skeletonCards(3);
  const [papersRes, classesRes] = await Promise.all([getFacultyPapers(), getFacultyClasses()]);
  if (!papersRes.ok) {
    host.innerHTML = errorHTML(papersRes.error || 'Could not load question papers.');
    $('#qpRetry')?.addEventListener('click', load);
    return;
  }
  all = papersRes.items || [];
  facultyClasses = classesRes.ok ? (classesRes.classes || []) : [];
  render();
}

function render() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const fc = $('#filterCourse').value;
  const fb = $('#filterBranch').value;

  const filtered = all.filter((p) => {
    const matchQ = !q || `${p.title} ${p.subject || ''}`.toLowerCase().includes(q);
    const matchC = !fc || p.course === fc;
    const matchB = !fb || p.branch === fb;
    return matchQ && matchC && matchB;
  });

  const host = $('#list');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      iconName: 'file',
      title: all.length ? 'No matching papers' : 'No question papers yet',
      message: all.length ? 'Adjust your filters.' : 'Upload your first question paper to one of your classes.',
    });
    return;
  }

  host.innerHTML = `<div class="table-wrap card"><table class="data-table">
    <thead><tr><th>Paper</th><th>Course</th><th>Branch</th><th>Subject</th><th>Uploaded</th><th>Actions</th></tr></thead>
    <tbody>${filtered.map(rowHTML).join('')}</tbody>
  </table></div>`;

  $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.del, b.dataset.class)));
}

function rowHTML(p) {
  const dl = p.file && p.file.id
    ? `<a class="btn-icon" href="${esc(downloadUrl(p.file.id))}" target="_blank" rel="noopener" title="Download">${icon('download')}</a>`
    : '';
  return `
    <tr>
      <td><div class="flex items-center gap-2">${icon('file')}<strong>${esc(p.title)}</strong></div></td>
      <td>${esc(p.course || '')}</td>
      <td>${esc(p.branch || '')}</td>
      <td>${esc(p.subject || '')}</td>
      <td>${esc(formatDate(p.created))}</td>
      <td><div class="row-actions">
        ${dl}
        <button class="btn-icon" data-del="${p.id}" data-class="${p.classId}" title="Delete">${icon('trash')}</button>
      </div></td>
    </tr>`;
}

async function onDelete(id, classId) {
  const p = all.find((x) => String(x.id) === String(id));
  const ok = await confirmDialog({ title: 'Delete paper?', message: `"${p.title}" will be removed for everyone.`, confirmLabel: 'Delete' });
  if (!ok) return;
  const res = await deleteContent(classId, 'question-papers', id);
  if (!res.ok) return toastError(res.error || 'Could not delete.');
  toastSuccess('Question paper deleted.');
  await load();
}

function openUpload() {
  if (!facultyClasses.length) {
    return toastError('Create a class first — question papers are attached to a class.');
  }
  const { close, el } = openModal({
    title: 'Upload question paper',
    size: 'modal-lg',
    body: `
      <form id="qpForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="classId">Class <span class="req">*</span></label>
          <select id="classId" name="classId">
            ${facultyClasses.map((c) => `<option value="${c.id}">${esc(c.subject || c.title)} · ${esc(c.branch)} · Sem ${esc(String(c.semester))}</option>`).join('')}
          </select>
          <div class="field-error"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="title">Paper title <span class="req">*</span></label>
          <input class="input" id="title" name="title" placeholder="e.g. Data Structures — End Sem 2024" />
          <div class="field-error"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="file">Question paper file <span class="req">*</span></label>
          <input class="input" id="file" name="file" type="file" accept=".pdf,.doc,.docx,image/*" />
          <div class="field-error"></div>
          <div class="text-muted" style="font-size:var(--fs-xs);margin-top:4px">PDF/DOC/image, up to 25 MB. Uploaded to Firebase Cloud Storage.</div>
        </div>
      </form>
    `,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: `${icon('upload')} Upload`, class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });

  const form = $('#qpForm', el);
  const uploadActionBtn = el.querySelectorAll('.modal-footer .btn')[1];

  async function submit() {
    clearErrors(form);
    const ok = validateForm(form, { title: [rules.required] });
    const fileInput = form.elements['file'];
    let fileOk = true;
    if (!fileInput.files.length) { setFieldError(fileInput, 'Please choose a file.'); fileOk = false; }
    if (!ok || !fileOk) return;

    uploadActionBtn.disabled = true;
    uploadActionBtn.innerHTML = '<span class="spinner"></span> Uploading…';

    const res = await uploadPaper(
      form.elements['classId'].value,
      { title: form.elements['title'].value.trim() },
      fileInput.files[0]
    );

    if (!res.ok) {
      uploadActionBtn.disabled = false;
      uploadActionBtn.innerHTML = `${icon('upload')} Upload`;
      return toastError(res.error || 'Upload failed.');
    }
    toastSuccess('Question paper uploaded.');
    close();
    await load();
  }
}

function errorHTML(message) {
  return `<div class="card"><div class="card-body" style="text-align:center;padding:24px">
    <div class="text-muted" style="margin-bottom:12px">${icon('alert')} ${esc(message)}</div>
    <button class="btn btn-primary" id="qpRetry">${icon('arrowRight')} Retry</button></div></div>`;
}
