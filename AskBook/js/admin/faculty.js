/**
 * admin/faculty.js — Faculty management (REAL backend).
 * -----------------------------------------------------------------------------
 * Lists users who have a FACULTY PROFILE (pending applicants + approved
 * faculty) from GET /api/admin/users. Admin actions:
 *   - Approve Faculty  (pending: role student -> faculty)   [PATCH approve-faculty]
 *   - Make Admin       (faculty-profile user -> admin)       [PATCH make-admin]
 *   - Delete           (removes PostgreSQL + Firebase user)  [DELETE]
 *
 * Faculty self-register (there is no admin "add faculty" in the real model), so
 * the previous mock add/edit/toggle flow is replaced by these real actions.
 * All authorization is enforced server-side (requireAuth + requireAdmin); the
 * UI simply reflects the server's eligibility flags and re-checks on the server.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, debounce, initials } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards, paginationBar } from '../common/components.js';
import { confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';
import { getAdminUsers, approveFaculty, approveAdmin, makeAdmin, rejectUser, deleteUser } from '../services/adminService.js';

const PAGE_SIZE = 6;
let all = [];        // users with a faculty profile
let currentUser = null; // logged-in admin (for self-delete protection)
let page = 1;

bootstrapAdmin({ activeId: 'faculty', title: 'Faculty Management' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  currentUser = user;
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Faculty Management</h1>
        <p class="page-subtitle">Approve pending faculty, promote to admin, and manage faculty accounts.</p>
      </div>
    </div>
    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search name, email or department…" />
        <select id="fStatus"><option value="">All</option>
          <option value="pending">Pending approval</option>
          <option value="pending-admin">Pending admin</option>
          <option value="faculty">Approved faculty</option>
          <option value="admin">Admins</option>
          <option value="rejected">Rejected</option></select>
      </div>
    </div></div>
    <div class="card"><div class="card-body"><div id="tableArea">${skeletonCards(1)}</div></div></div>
  `;

  $('#searchInput').addEventListener('input', debounce(() => { page = 1; render(); }, 200));
  $('#fStatus').addEventListener('change', () => { page = 1; render(); });

  await load();
}

async function load() {
  const host = $('#tableArea');
  if (host) host.innerHTML = skeletonCards(1);
  const res = await getAdminUsers();
  if (!res.ok) {
    if (host) {
      host.innerHTML = errorState(res.error || 'Could not load users.');
      host.querySelector('#retryBtn')?.addEventListener('click', load);
    }
    return;
  }
  all = (res.users || []).filter((u) => u.hasFacultyProfile || u.role === 'admin' || u.adminPending);
  render();
}

function statusOf(u) {
  if (u.isRejected) return 'rejected';
  if (u.role === 'admin' && u.status === 'approved') return 'admin';
  if (u.adminPending) return 'pending-admin';
  if (u.role === 'faculty' && u.status === 'approved') return 'faculty';
  return 'pending'; // has faculty profile but not yet fully approved
}

function getFiltered() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const fs = $('#fStatus').value;
  return all.filter((u) => {
    const f = u.faculty || {};
    const hay = `${f.fullName || u.displayName || ''} ${u.email || ''} ${f.department || ''}`.toLowerCase();
    const mQ = !q || hay.includes(q);
    const mS = !fs || statusOf(u) === fs;
    return mQ && mS;
  });
}

function render() {
  const filtered = getFiltered();
  const host = $('#tableArea');
  if (!filtered.length) {
    host.innerHTML = emptyState({ iconName: 'user', title: 'No faculty found', message: 'No faculty users match the current filter.' });
    return;
  }
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, pages);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  host.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Faculty</th><th>Department</th><th>Designation</th><th>Employee ID</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows.map(rowHTML).join('')}</tbody>
    </table></div>
    ${paginationBar({ page, pageSize: PAGE_SIZE, total })}
  `;

  $$('[data-approve]', host).forEach((b) => b.addEventListener('click', () => onApprove(b.dataset.approve)));
  $$('[data-approve-admin]', host).forEach((b) => b.addEventListener('click', () => onApproveAdmin(b.dataset.approveAdmin)));
  $$('[data-makeadmin]', host).forEach((b) => b.addEventListener('click', () => onMakeAdmin(b.dataset.makeadmin)));
  $$('[data-reject]', host).forEach((b) => b.addEventListener('click', () => onReject(b.dataset.reject)));
  $$('[data-delete]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.delete)));
  $$('.page-btn', host).forEach((b) => b.addEventListener('click', () => {
    const p = Number(b.dataset.page);
    if (p >= 1 && p <= pages) { page = p; render(); }
  }));
}

function statusBadgeFor(u) {
  const s = statusOf(u);
  const map = {
    pending: '<span class="badge" style="background:var(--warning-100,#fef3c7);color:var(--warning-700,#b45309)">Pending approval</span>',
    'pending-admin': '<span class="badge" style="background:#ede9fe;color:#6d28d9">Pending admin</span>',
    faculty: '<span class="badge" style="background:var(--success-100,#dcfce7);color:var(--success-700,#15803d)">Faculty</span>',
    admin: '<span class="badge" style="background:#ede9fe;color:#6d28d9">Admin</span>',
    rejected: '<span class="badge" style="background:var(--error-100,#fee2e2);color:var(--error-700,#b91c1c)">Rejected</span>',
  };
  return map[s] || esc(s);
}

function rowHTML(u) {
  const f = u.faculty || {};
  const name = f.fullName || u.displayName || (u.email ? u.email.split('@')[0] : 'User');
  const isSelf = currentUser && Number(u.id) === Number(currentUser.id);

  const actions = [];
  if (u.canApproveFaculty) {
    actions.push(`<button class="btn btn-sm btn-primary" data-approve="${u.id}">${icon('check')} Approve</button>`);
  }
  if (u.adminPending && !u.isRejected) {
    // Approve a pending admin via the admin panel.
    actions.push(`<button class="btn btn-sm btn-primary" data-approve-admin="${u.id}">${icon('check')} Approve Admin</button>`);
  }
  if (u.canMakeAdmin) {
    actions.push(`<button class="btn btn-sm btn-outline" data-makeadmin="${u.id}">${icon('shield')} Make Admin</button>`);
  }
  if (u.canReject) {
    actions.push(`<button class="btn btn-sm" data-reject="${u.id}" style="background:var(--error-100,#fee2e2);color:var(--error-700,#b91c1c)">${icon('xCircle')} Reject</button>`);
  }
  // Self-delete protection: never render a delete button for the logged-in admin.
  if (!isSelf) {
    actions.push(`<button class="btn-icon" data-delete="${u.id}" title="Delete user">${icon('trash')}</button>`);
  }

  return `
    <tr>
      <td><div class="flex items-center gap-3">
        <div class="avatar" style="width:34px;height:34px;font-size:var(--fs-xs)">${esc(initials(name))}</div>
        <div><div style="font-weight:600">${esc(name)}${isSelf ? ' <span class="text-muted" style="font-weight:400">(you)</span>' : ''}</div>
          <div class="text-muted" style="font-size:var(--fs-xs)">${esc(u.email || '')}</div></div>
      </div></td>
      <td>${esc(f.department || '—')}</td>
      <td>${esc(f.designation || '—')}</td>
      <td>${esc(f.employeeId || '—')}</td>
      <td>${statusBadgeFor(u)}</td>
      <td><div class="row-actions">${actions.join('') || '<span class="text-muted">—</span>'}</div></td>
    </tr>`;
}

async function onApprove(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = u?.faculty?.fullName || u?.email || 'this user';
  const ok = await confirmDialog({
    title: 'Approve faculty?',
    message: `${name} will be granted the faculty role and faculty portal access.`,
    confirmLabel: 'Approve',
  });
  if (!ok) return;
  const res = await approveFaculty(id);
  if (!res.ok) return toastError(res.error || 'Could not approve faculty.');
  toastSuccess('Faculty approved.');
  await load();
}

async function onApproveAdmin(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = u?.displayName || u?.email || 'this admin';
  const ok = await confirmDialog({
    title: 'Approve admin?',
    message: `${name} will be granted approved administrator access.`,
    confirmLabel: 'Approve',
  });
  if (!ok) return;
  // Approve an admin applicant (works for self-signup admins without a faculty
  // profile, and re-approves a previously rejected admin).
  const res = await approveAdmin(id);
  if (!res.ok) return toastError(res.error || 'Could not approve admin.');
  toastSuccess('Admin approved.');
  await load();
}

async function onReject(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = u?.faculty?.fullName || u?.displayName || u?.email || 'this user';
  const ok = await confirmDialog({
    title: 'Reject applicant?',
    message: `${name}'s application will be rejected. They will not be able to access their dashboard.`,
    confirmLabel: 'Reject',
  });
  if (!ok) return;
  const res = await rejectUser(id);
  if (!res.ok) return toastError(res.error || 'Could not reject applicant.');
  toastSuccess('Applicant rejected.');
  await load();
}

async function onMakeAdmin(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = u?.faculty?.fullName || u?.email || 'this user';
  const ok = await confirmDialog({
    title: 'Promote to admin?',
    message: `${name} will be granted full administrator access. This is a powerful role — proceed with care.`,
    confirmLabel: 'Make Admin',
  });
  if (!ok) return;
  const res = await makeAdmin(id);
  if (!res.ok) return toastError(res.error || 'Could not promote user.');
  toastSuccess('User promoted to admin.');
  await load();
}

async function onDelete(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = u?.faculty?.fullName || u?.email || 'this user';
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
