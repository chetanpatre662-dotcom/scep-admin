/**
 * admin/students.js — Student directory (REAL backend).
 * -----------------------------------------------------------------------------
 * Lists users who have a STUDENT PROFILE from GET /api/admin/users. Supports
 * search + course/branch/semester filters, a details view, and Delete (removes
 * PostgreSQL + Firebase user). Year is derived from semester by the backend.
 *
 * There is no student "status/active" column in the schema, so no status is
 * shown or fabricated. All actions are authorized server-side (requireAdmin).
 * -----------------------------------------------------------------------------
 */
import { COURSE_TYPES, BRANCHES } from '../config.js';
import { $, $$, esc, debounce, initials } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards, paginationBar } from '../common/components.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';
import { getAdminUsers, deleteUser } from '../services/adminService.js';

const PAGE_SIZE = 6;
let all = [];
let currentUser = null;
let page = 1;

bootstrapAdmin({ activeId: 'students', title: 'Student Management' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  currentUser = user;
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Student Management</h1>
        <p class="page-subtitle">Browse the student directory and manage student accounts.</p>
      </div>
    </div>
    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search name, roll or email…" />
        <select id="fCourse"><option value="">All Courses</option>
          <option>${COURSE_TYPES.BTECH}</option><option>${COURSE_TYPES.POLYTECHNIC}</option></select>
        <select id="fBranch"><option value="">All Branches</option>
          ${BRANCHES.map((b) => `<option>${b}</option>`).join('')}</select>
        <select id="fSem"><option value="">All Semesters</option>
          ${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">Semester ${i + 1}</option>`).join('')}</select>
      </div>
    </div></div>
    <div class="card"><div class="card-body"><div id="tableArea">${skeletonCards(1)}</div></div></div>
  `;

  $('#searchInput').addEventListener('input', debounce(() => { page = 1; render(); }, 200));
  ['fCourse', 'fBranch', 'fSem'].forEach((id) => $('#' + id).addEventListener('change', () => { page = 1; render(); }));

  await load();
}

async function load() {
  const host = $('#tableArea');
  if (host) host.innerHTML = skeletonCards(1);
  const res = await getAdminUsers();
  if (!res.ok) {
    if (host) {
      host.innerHTML = errorState(res.error || 'Could not load students.');
      host.querySelector('#retryBtn')?.addEventListener('click', load);
    }
    return;
  }
  // Student page scope: users who have a student profile.
  all = (res.users || []).filter((u) => u.hasStudentProfile);
  render();
}

function getFiltered() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const fc = $('#fCourse').value, fb = $('#fBranch').value, fs = $('#fSem').value;
  return all.filter((u) => {
    const s = u.student || {};
    const mQ = !q || `${s.fullName || ''} ${s.rollNumber || ''} ${u.email || ''}`.toLowerCase().includes(q);
    const mC = !fc || s.program === fc;
    const mB = !fb || s.branch === fb;
    const mS = !fs || String(s.semester) === fs;
    return mQ && mC && mB && mS;
  });
}

function render() {
  const filtered = getFiltered();
  const host = $('#tableArea');
  if (!filtered.length) {
    host.innerHTML = emptyState({ iconName: 'graduation', title: 'No students found', message: 'Adjust your filters, or no students have registered yet.' });
    return;
  }
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, pages);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  host.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Student</th><th>Roll No.</th><th>Course</th><th>Branch</th><th>Year</th><th>Sem</th><th>Actions</th></tr></thead>
      <tbody>${rows.map(rowHTML).join('')}</tbody>
    </table></div>
    ${paginationBar({ page, pageSize: PAGE_SIZE, total })}
  `;

  $$('[data-view]', host).forEach((b) => b.addEventListener('click', () => onView(b.dataset.view)));
  $$('[data-delete]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.delete)));
  $$('.page-btn', host).forEach((b) => b.addEventListener('click', () => {
    const p = Number(b.dataset.page);
    if (p >= 1 && p <= pages) { page = p; render(); }
  }));
}

function rowHTML(u) {
  const s = u.student || {};
  const name = s.fullName || u.displayName || (u.email ? u.email.split('@')[0] : 'Student');
  const isSelf = currentUser && Number(u.id) === Number(currentUser.id);
  const del = isSelf ? '' : `<button class="btn-icon" data-delete="${u.id}" title="Delete user">${icon('trash')}</button>`;
  return `
    <tr>
      <td><div class="flex items-center gap-3">
        <div class="avatar" style="width:34px;height:34px;font-size:var(--fs-xs);background:var(--success-600)">${esc(initials(name))}</div>
        <div><div style="font-weight:600">${esc(name)}</div>
          <div class="text-muted" style="font-size:var(--fs-xs)">${esc(u.email || '')}</div></div>
      </div></td>
      <td>${esc(s.rollNumber || '—')}</td>
      <td>${esc(s.program || '—')}</td>
      <td>${esc(s.branch || '—')}</td>
      <td>${s.year != null ? esc('Year ' + s.year) : '—'}</td>
      <td>${s.semester != null ? esc(String(s.semester)) : '—'}</td>
      <td><div class="row-actions">
        <button class="btn-icon" data-view="${u.id}" title="View details">${icon('eye')}</button>
        ${del}
      </div></td>
    </tr>`;
}

function onView(id) {
  const u = all.find((x) => String(x.id) === String(id));
  if (!u) return;
  const s = u.student || {};
  const name = s.fullName || u.displayName || 'Student';
  openModal({
    title: name,
    body: `
      <div class="flex items-center gap-3 mb-4">
        <div class="avatar lg" style="background:var(--success-600)">${esc(initials(name))}</div>
        <div><div style="font-weight:700;font-size:var(--fs-lg)">${esc(name)}</div>
          <div class="text-muted">${esc(u.email || '')}</div></div>
      </div>
      <div class="wizard-summary" style="display:flex;flex-wrap:wrap">
        <div class="ws-item"><div class="k">Roll No.</div><div class="v">${esc(s.rollNumber || '—')}</div></div>
        <div class="ws-item"><div class="k">Mobile</div><div class="v">${esc(s.mobileNumber || '—')}</div></div>
        <div class="ws-item"><div class="k">Course</div><div class="v">${esc(s.program || '—')}</div></div>
        <div class="ws-item"><div class="k">Branch</div><div class="v">${esc(s.branch || '—')}</div></div>
        <div class="ws-item"><div class="k">Year</div><div class="v">${s.year != null ? esc('Year ' + s.year) : '—'}</div></div>
        <div class="ws-item"><div class="k">Semester</div><div class="v">${s.semester != null ? esc(String(s.semester)) : '—'}</div></div>
      </div>
    `,
    actions: [{ label: 'Close', class: 'btn-primary' }],
  });
}

async function onDelete(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = u?.student?.fullName || u?.email || 'this student';
  const ok = await confirmDialog({
    title: 'Delete user?',
    message: `${name} will be permanently removed from the database and Firebase Authentication. This cannot be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  const res = await deleteUser(id);
  if (!res.ok) return toastError(res.error || 'Could not delete user.');
  if (res.partialFailure) {
    toastError('User removed from database, but the Firebase account could not be deleted. Please remove it manually.');
  } else {
    toastSuccess('User deleted.');
  }
  await load();
}

function errorState(message) {
  return `
    <div style="text-align:center;padding:var(--sp-6)">
      <div class="text-muted" style="margin-bottom:var(--sp-3)">${icon('alert')} ${esc(message)}</div>
      <button class="btn btn-primary" id="retryBtn">${icon('arrowRight')} Retry</button>
    </div>`;
}
