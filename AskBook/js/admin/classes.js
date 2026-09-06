/**
 * admin/classes.js — Institute-wide class directory (REAL backend).
 * -----------------------------------------------------------------------------
 * Lists real PostgreSQL classes via GET /api/admin/classes with DB-backed
 * filters (Course + Branch from the catalog, Semester, Faculty). Admin can
 * delete a class. Classes are CREATED by faculty (Phase C2), so there is no
 * admin "create class" here. Only schema-backed fields are shown — no
 * fabricated room/schedule. Handles loading/empty/error states.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, debounce, initials, avatarColor } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';
import { getAdminClasses, deleteAdminClass } from '../services/adminService.js';
import { getCatalogCourses, getCatalogBranches } from '../services/catalogService.js';

let all = [];
let courses = [];

bootstrapAdmin({ activeId: 'classes', title: 'Classes' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Classes</h1>
        <p class="page-subtitle">All classes across the institute (created by faculty). Membership is derived from each class's course, branch and semester.</p>
      </div>
    </div>
    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search subject, faculty or branch…" />
        <select id="fCourse"><option value="">All Courses</option></select>
        <select id="fBranch"><option value="">All Branches</option></select>
        <select id="fSem"><option value="">All Semesters</option></select>
      </div>
    </div></div>
    <div id="grid">${skeletonCards(3)}</div>
  `;

  // Populate Course filter from the catalog (DB-driven).
  const cRes = await getCatalogCourses();
  if (cRes.ok) {
    courses = cRes.courses || [];
    const sel = $('#fCourse');
    sel.innerHTML = '<option value="">All Courses</option>' + courses.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  }

  $('#searchInput').addEventListener('input', debounce(render, 200));
  $('#fCourse').addEventListener('change', onCourseChange);
  $('#fBranch').addEventListener('change', load);
  $('#fSem').addEventListener('change', load);

  await load();
}

async function onCourseChange() {
  const courseName = $('#fCourse').value;
  const branchSel = $('#fBranch');
  const semSel = $('#fSem');
  const course = courses.find((c) => c.name === courseName);

  // Branch options for the chosen course (DB-driven); reset when "All Courses".
  if (course) {
    const bRes = await getCatalogBranches(course.id);
    const branches = bRes.ok ? bRes.branches : [];
    branchSel.innerHTML = '<option value="">All Branches</option>' + branches.map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('');
    const total = course.totalSemesters || 8;
    semSel.innerHTML = '<option value="">All Semesters</option>' + Array.from({ length: total }, (_, i) => `<option value="${i + 1}">Semester ${i + 1}</option>`).join('');
  } else {
    branchSel.innerHTML = '<option value="">All Branches</option>';
    semSel.innerHTML = '<option value="">All Semesters</option>';
  }
  await load();
}

async function load() {
  const host = $('#grid');
  host.innerHTML = skeletonCards(3);
  const filter = {
    program: $('#fCourse').value || undefined,
    branch: $('#fBranch').value || undefined,
    semester: $('#fSem').value || undefined,
  };
  const res = await getAdminClasses(filter);
  if (!res.ok) {
    host.innerHTML = errorState(res.error || 'Failed to load classes. Please try again.');
    host.querySelector('#retryBtn')?.addEventListener('click', load);
    return;
  }
  all = res.classes || [];
  render();
}

function render() {
  const q = ($('#searchInput').value || '').trim().toLowerCase();
  const filtered = all.filter((c) => {
    const hay = `${c.subject || ''} ${c.facultyName || ''} ${c.branch || ''}`.toLowerCase();
    return !q || hay.includes(q);
  });

  const host = $('#grid');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      iconName: 'classes',
      title: all.length ? 'No matching classes' : 'No classes yet',
      message: all.length ? 'Try a different search or filter.' : 'Classes created by faculty will appear here.',
    });
    return;
  }
  host.innerHTML = `<div class="class-grid">${filtered.map(cardHTML).join('')}</div>`;
  $$('[data-view]', host).forEach((card) => card.addEventListener('click', () => onView(card.dataset.view)));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); onDelete(b.dataset.del); }));
}

function cardHTML(c) {
  const archived = c.status === 'archived';
  const subject = c.subject || 'Class';
  return `
    <div class="klass-card">
      <div class="kc-top" role="button" tabindex="0" data-view="${c.id}">
        <span class="kc-avatar" style="background:${avatarColor(subject)}">${esc(initials(subject))}</span>
        <div class="kc-head">
          <div class="kc-title" title="${esc(subject)}">${esc(subject)}</div>
          <div class="kc-sub">${esc(c.course || '')} • ${esc(c.branch || '')} • Sem ${esc(String(c.semester))}</div>
        </div>
        <span class="kc-status ${archived ? 'archived' : ''}">${esc((c.status || 'active').charAt(0).toUpperCase() + (c.status || 'active').slice(1))}</span>
      </div>
      <div class="kc-meta"><span class="kc-fact">${esc(c.facultyName || 'Faculty')}</span></div>
      <div class="kc-foot">
        <button class="btn btn-sm btn-outline" data-view="${c.id}">Open ${icon('arrowRight')}</button>
        <button class="btn-icon" data-del="${c.id}" title="Delete class">${icon('trash')}</button>
      </div>
    </div>`;
}

function onView(id) {
  const c = all.find((x) => String(x.id) === String(id));
  if (!c) return;
  openModal({
    title: c.subject || 'Class',
    body: `
      <div class="wizard-summary" style="display:flex;flex-wrap:wrap">
        <div class="ws-item"><div class="k">Course</div><div class="v">${esc(c.course || '—')}</div></div>
        <div class="ws-item"><div class="k">Branch</div><div class="v">${esc(c.branch || '—')}</div></div>
        <div class="ws-item"><div class="k">Semester</div><div class="v">${esc(String(c.semester))}</div></div>
        <div class="ws-item"><div class="k">Subject</div><div class="v">${esc(c.subject || '—')}</div></div>
        <div class="ws-item"><div class="k">Faculty</div><div class="v">${esc(c.facultyName || '—')}</div></div>
        <div class="ws-item"><div class="k">Status</div><div class="v">${esc(c.status || '—')}</div></div>
      </div>
      ${c.description ? `<p class="text-muted mt-4">${esc(c.description)}</p>` : ''}
    `,
    actions: [{ label: 'Close', class: 'btn-primary' }],
  });
}

async function onDelete(id) {
  const c = all.find((x) => String(x.id) === String(id));
  const label = c?.subject || 'this class';
  const ok = await confirmDialog({
    title: 'Delete class?',
    message: `"${label}" will be permanently removed. This cannot be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  const res = await deleteAdminClass(id);
  if (!res.ok) return toastError(res.error || 'Could not delete class.');
  toastSuccess('Class deleted.');
  await load();
}

function errorState(message) {
  return `<div class="card"><div class="card-body" style="text-align:center;padding:var(--sp-6)">
    <div class="text-muted" style="margin-bottom:var(--sp-3)">${icon('alert')} ${esc(message)}</div>
    <button class="btn btn-primary" id="retryBtn">${icon('arrowRight')} Retry</button>
  </div></div>`;
}
