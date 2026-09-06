/**
 * faculty/announcements.js — Create / edit / delete / filter announcements.
 * Target audience selection dynamically reveals course/branch/semester fields.
 */
import { COURSE_TYPES, BRANCHES, ANNOUNCEMENT_TYPES, TARGET_AUDIENCES } from '../config.js';
import { $, $$, esc, formatDate, debounce } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { statusBadge, typeBadge, emptyState, skeletonCards } from '../common/components.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { validateForm, rules, clearErrors } from '../common/validation.js';
import { bootstrapFaculty } from './nav.js';
import {
  getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
} from '../services/announcementService.js';

let all = [];

bootstrapFaculty({ activeId: 'announcements', title: 'Announcements' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Announcements</h1>
        <p class="page-subtitle">Publish notices targeted to specific programs, branches or semesters.</p>
      </div>
      <button class="btn btn-primary" id="newBtn">${icon('plus')} New Announcement</button>
    </div>

    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search announcements…" />
        <select id="filterType"><option value="">All Types</option>
          ${ANNOUNCEMENT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
        <select id="filterStatus"><option value="">All Status</option>
          <option value="published">Published</option><option value="draft">Draft</option></select>
      </div>
    </div></div>

    <div id="list">${skeletonCards(3)}</div>
  `;

  $('#newBtn').addEventListener('click', () => openForm());
  $('#searchInput').addEventListener('input', debounce(render, 200));
  $('#filterType').addEventListener('change', render);
  $('#filterStatus').addEventListener('change', render);

  await load();
}

async function load() {
  const host = $('#list');
  host.innerHTML = skeletonCards(3);
  const res = await getAnnouncements();
  if (!res.ok) {
    host.innerHTML = emptyState({ iconName: 'megaphone', title: 'Could not load announcements', message: res.error || 'Please try again.' });
    return;
  }
  all = res.items || [];
  render();
}

function render() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const ft = $('#filterType').value;
  const fst = $('#filterStatus').value;

  const filtered = all.filter((a) => {
    const matchQ = !q || `${a.title} ${a.description}`.toLowerCase().includes(q);
    const matchT = !ft || a.type === ft;
    const matchS = !fst || a.status === fst;
    return matchQ && matchT && matchS;
  });

  const host = $('#list');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      iconName: 'megaphone',
      title: all.length ? 'No matching announcements' : 'No announcements yet',
      message: all.length ? 'Adjust your filters.' : 'Create your first announcement.',
    });
    return;
  }

  host.innerHTML = `<div class="table-wrap card"><table class="data-table">
    <thead><tr><th>Title</th><th>Type</th><th>Audience</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${filtered.map(rowHTML).join('')}</tbody>
  </table></div>`;

  $$('[data-view]', host).forEach((b) => b.addEventListener('click', () => onView(b.dataset.view)));
  $$('[data-edit]', host).forEach((b) => b.addEventListener('click', () => openForm(b.dataset.edit)));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.del)));
}

function audienceLabel(a) {
  if (a.audience === 'Specific Semester') return `${a.course} · ${a.branch} · Sem ${a.semester}`;
  if (a.audience === 'Specific Branch') return `${a.course} · ${a.branch}`;
  return a.audience;
}

function rowHTML(a) {
  return `
    <tr>
      <td><strong>${esc(a.title)}</strong></td>
      <td>${typeBadge(a.type)}</td>
      <td><span class="badge badge-brand">${esc(audienceLabel(a))}</span></td>
      <td>${formatDate(a.created)}</td>
      <td>${statusBadge(a.status)}</td>
      <td><div class="row-actions">
        <button class="btn-icon" data-view="${a.id}" title="View">${icon('eye')}</button>
        <button class="btn-icon" data-edit="${a.id}" title="Edit">${icon('edit')}</button>
        <button class="btn-icon" data-del="${a.id}" title="Delete">${icon('trash')}</button>
      </div></td>
    </tr>`;
}

function onView(id) {
  const a = all.find((x) => x.id === id);
  openModal({
    title: a.title,
    body: `
      <div class="flex gap-3 mb-4">${typeBadge(a.type)} ${statusBadge(a.status)}</div>
      <p>${esc(a.description)}</p>
      <div class="wizard-summary mt-4" style="display:flex">
        <div class="ws-item"><div class="k">Audience</div><div class="v">${esc(audienceLabel(a))}</div></div>
        ${a.eventDate ? `<div class="ws-item"><div class="k">Event date</div><div class="v">${formatDate(a.eventDate)}</div></div>` : ''}
        ${a.attachment ? `<div class="ws-item"><div class="k">Attachment</div><div class="v">${esc(a.attachment)}</div></div>` : ''}
        <div class="ws-item"><div class="k">Published</div><div class="v">${formatDate(a.created)}</div></div>
      </div>
    `,
    actions: [{ label: 'Close', class: 'btn-primary' }],
  });
}

async function onDelete(id) {
  const a = all.find((x) => x.id === id);
  const ok = await confirmDialog({ title: 'Delete announcement?', message: `"${a.title}" will be permanently removed.`, confirmLabel: 'Delete' });
  if (!ok) return;
  await deleteAnnouncement(id);
  toastSuccess('Announcement deleted.');
  await load();
}

function openForm(editId) {
  const existing = editId ? all.find((x) => x.id === editId) : null;

  const semesterOptions = Array.from({ length: 8 }, (_, i) =>
    `<option value="${i + 1}">Semester ${i + 1}</option>`).join('');

  const { close, el } = openModal({
    title: existing ? 'Edit announcement' : 'New announcement',
    size: 'modal-lg',
    body: `
      <form id="annForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="title">Title <span class="req">*</span></label>
          <input class="input" id="title" name="title" placeholder="e.g. Mid-Semester Exam Schedule" />
          <div class="field-error"></div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="type">Type <span class="req">*</span></label>
            <select id="type" name="type">${ANNOUNCEMENT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="audience">Target audience <span class="req">*</span></label>
            <select id="audience" name="audience">${TARGET_AUDIENCES.map((t) => `<option>${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-row" id="targetFields"></div>
        <div class="form-group">
          <label class="form-label" for="description">Description <span class="req">*</span></label>
          <textarea class="input" id="description" name="description" placeholder="Write the announcement details…"></textarea>
          <div class="field-error"></div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="eventDate">Event / holiday date</label>
            <input class="input" id="eventDate" name="eventDate" type="date" />
          </div>
        </div>
      </form>
    `,
    actions: [
      { label: 'Save as draft', class: 'btn-ghost', closeOnClick: false, onClick: () => submit('draft') },
      { label: existing ? 'Update' : 'Publish', class: 'btn-primary', closeOnClick: false, onClick: () => submit('published') },
    ],
  });

  const form = $('#annForm', el);
  const audienceSel = form.elements['audience'];
  const targetFields = $('#targetFields', el);

  function renderTargetFields() {
    const aud = audienceSel.value;
    const needsCourse = ['Specific Branch', 'Specific Semester'].includes(aud);
    const needsSem = aud === 'Specific Semester';
    targetFields.innerHTML = needsCourse
      ? `
        <div class="form-group">
          <label class="form-label" for="course">Course <span class="req">*</span></label>
          <select id="course" name="course"><option>${COURSE_TYPES.BTECH}</option><option>${COURSE_TYPES.POLYTECHNIC}</option></select>
        </div>
        <div class="form-group">
          <label class="form-label" for="branch">Branch <span class="req">*</span></label>
          <select id="branch" name="branch">${BRANCHES.map((b) => `<option>${b}</option>`).join('')}</select>
        </div>
        ${needsSem ? `<div class="form-group"><label class="form-label" for="semester">Semester <span class="req">*</span></label><select id="semester" name="semester">${semesterOptions}</select></div>` : ''}
      `
      : '';
    // Prefill when editing
    if (existing) {
      if (form.elements['course']) form.elements['course'].value = existing.course || COURSE_TYPES.BTECH;
      if (form.elements['branch']) form.elements['branch'].value = existing.branch || BRANCHES[0];
      if (form.elements['semester'] && existing.semester) form.elements['semester'].value = existing.semester;
    }
  }

  audienceSel.addEventListener('change', renderTargetFields);

  // Prefill
  if (existing) {
    form.elements['title'].value = existing.title;
    form.elements['type'].value = existing.type;
    form.elements['audience'].value = existing.audience;
    form.elements['description'].value = existing.description;
    if (existing.eventDate) form.elements['eventDate'].value = existing.eventDate;
  }
  renderTargetFields();

  async function submit(status) {
    clearErrors(form);
    const schema = { title: [rules.required], description: [rules.required] };
    if (!validateForm(form, schema)) return;

    const aud = form.elements['audience'].value;
    const payload = {
      title: form.elements['title'].value.trim(),
      type: form.elements['type'].value,
      audience: aud,
      description: form.elements['description'].value.trim(),
      eventDate: form.elements['eventDate'].value || null,
      course: form.elements['course']?.value || null,
      branch: form.elements['branch']?.value || null,
      semester: form.elements['semester']?.value ? Number(form.elements['semester'].value) : null,
      status,
    };

    const res = existing
      ? await updateAnnouncement(existing.id, payload)
      : await createAnnouncement(payload);

    if (!res.ok) return toastError(res.error || 'Save failed.');
    toastSuccess(existing ? 'Announcement updated.' : status === 'draft' ? 'Saved as draft.' : 'Announcement published.');
    close();
    await load();
  }
}
