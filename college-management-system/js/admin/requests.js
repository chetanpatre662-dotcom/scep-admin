/**
 * admin/requests.js — Admin Request Management.
 * -----------------------------------------------------------------------------
 * Lists every account that submitted a Faculty or Admin request (pending,
 * approved, or rejected) with requester name / email / phone / requested date /
 * status, and per-row actions:
 *   - Approve  (pending OR rejected -> approved; re-approve after reject works)
 *   - Reject   (pending -> rejected; kept in the list, re-approvable later)
 *   - Delete   (confirm, then remove from DB + Firebase)
 *
 * All authorization is enforced server-side (requireAuth + requireAdmin). This
 * page reuses the existing endpoints via js/services/adminService.js.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, debounce, initials, formatDate } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards, paginationBar } from '../common/components.js';
import { confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';
import { getAdminUsers, approveFaculty, approveAdmin, rejectUser, deleteUser } from '../services/adminService.js';

const PAGE_SIZE = 8;
let all = [];
let currentUser = null;
let page = 1;

bootstrapAdmin({ activeId: 'requests', title: 'Admin Requests' }).then((ctx) => { if (ctx) init(ctx); });

function init({ main, user }) {
  currentUser = user;
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Request Management</h1>
        <p class="page-subtitle">Approve, reject or remove faculty and admin access requests.</p>
      </div>
    </div>
    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search name, email or phone…" />
        <select id="fStatus">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select id="fType">
          <option value="">All types</option>
          <option value="faculty">Faculty</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </div></div>
    <div class="card"><div class="card-body"><div id="tableArea">${skeletonCards(1)}</div></div></div>
  `;

  $('#searchInput').addEventListener('input', debounce(() => { page = 1; render(); }, 200));
  $('#fStatus').addEventListener('change', () => { page = 1; render(); });
  $('#fType').addEventListener('change', () => { page = 1; render(); });

  load();
}

async function load() {
  const host = $('#tableArea');
  if (host) host.innerHTML = skeletonCards(1);
  const res = await getAdminUsers();
  if (!res.ok) {
    if (host) {
      host.innerHTML = errorState(res.error || 'Could not load requests.');
      host.querySelector('#retryBtn')?.addEventListener('click', load);
    }
    return;
  }
  // Requests = any account that applied for faculty or admin access.
  all = (res.users || []).filter((u) => u.isApplicant);
  render();
}

/** Derive a simple status label for a request row. */
function requestStatus(u) {
  if (u.isRejected) return 'rejected';
  if (u.adminPending || u.facultyPending) return 'pending';
  return 'approved';
}

/** faculty | admin */
function requestType(u) {
  return u.applicantType || (u.hasFacultyProfile ? 'faculty' : 'admin');
}

function requesterName(u) {
  return (u.faculty && u.faculty.fullName)
    || u.displayName
    || (u.email ? u.email.split('@')[0] : 'User');
}

function getFiltered() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const fs = $('#fStatus').value;
  const ft = $('#fType').value;
  return all.filter((u) => {
    const hay = `${requesterName(u)} ${u.email || ''} ${u.phone || ''}`.toLowerCase();
    const mQ = !q || hay.includes(q);
    const mS = !fs || requestStatus(u) === fs;
    const mT = !ft || requestType(u) === ft;
    return mQ && mS && mT;
  });
}

function render() {
  const filtered = getFiltered();
  const host = $('#tableArea');
  if (!filtered.length) {
    host.innerHTML = emptyState({ iconName: 'bell', title: 'No requests', message: 'No access requests match the current filters.' });
    return;
  }
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, pages);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  host.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Requester</th><th>Type</th><th>Phone</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows.map(rowHTML).join('')}</tbody>
    </table></div>
    ${paginationBar({ page, pageSize: PAGE_SIZE, total })}
  `;

  $$('[data-approve-faculty]', host).forEach((b) => b.addEventListener('click', () => onApprove(b.dataset.approveFaculty, 'faculty')));
  $$('[data-approve-admin]', host).forEach((b) => b.addEventListener('click', () => onApprove(b.dataset.approveAdmin, 'admin')));
  $$('[data-reject]', host).forEach((b) => b.addEventListener('click', () => onReject(b.dataset.reject)));
  $$('[data-delete]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.delete)));
  $$('.page-btn', host).forEach((b) => b.addEventListener('click', () => {
    const p = Number(b.dataset.page);
    if (p >= 1 && p <= pages) { page = p; render(); }
  }));
}

function statusBadge(status) {
  const map = {
    pending: '<span class="badge" style="background:var(--warning-100,#fef3c7);color:var(--warning-700,#b45309)">Pending</span>',
    approved: '<span class="badge" style="background:var(--success-100,#dcfce7);color:var(--success-700,#15803d)">Approved</span>',
    rejected: '<span class="badge" style="background:var(--error-100,#fee2e2);color:var(--error-700,#b91c1c)">Rejected</span>',
  };
  return map[status] || esc(status);
}

function typeBadge(type) {
  return type === 'admin'
    ? '<span class="badge" style="background:#ede9fe;color:#6d28d9">Admin</span>'
    : '<span class="badge badge-brand">Faculty</span>';
}

function rowHTML(u) {
  const name = requesterName(u);
  const type = requestType(u);
  const status = requestStatus(u);
  const isSelf = currentUser && Number(u.id) === Number(currentUser.id);

  const actions = [];
  // Approve is available for PENDING and REJECTED applicants (re-approve).
  if (status === 'pending' || status === 'rejected') {
    if (type === 'admin') {
      actions.push(`<button class="btn btn-sm btn-primary" data-approve-admin="${u.id}">${icon('check')} Approve</button>`);
    } else {
      actions.push(`<button class="btn btn-sm btn-primary" data-approve-faculty="${u.id}">${icon('check')} Approve</button>`);
    }
  }
  // Reject is only for currently-pending applicants (not already rejected/approved).
  if (status === 'pending' && !isSelf) {
    actions.push(`<button class="btn btn-sm" data-reject="${u.id}" style="background:var(--error-100,#fee2e2);color:var(--error-700,#b91c1c)">${icon('xCircle')} Reject</button>`);
  }
  // Delete always available (except self).
  if (!isSelf) {
    actions.push(`<button class="btn-icon" data-delete="${u.id}" title="Delete request">${icon('trash')}</button>`);
  }

  return `
    <tr>
      <td><div class="flex items-center gap-3">
        <div class="avatar" style="width:34px;height:34px;font-size:var(--fs-xs)">${esc(initials(name))}</div>
        <div><div style="font-weight:600">${esc(name)}${isSelf ? ' <span class="text-muted" style="font-weight:400">(you)</span>' : ''}</div>
          <div class="text-muted" style="font-size:var(--fs-xs)">${esc(u.email || '')}</div></div>
      </div></td>
      <td>${typeBadge(type)}</td>
      <td>${u.phone ? '+91 ' + esc(u.phone) : '—'}</td>
      <td>${esc(formatDate(u.createdAt))}</td>
      <td>${statusBadge(status)}</td>
      <td><div class="row-actions">${actions.join('') || '<span class="text-muted">—</span>'}</div></td>
    </tr>`;
}

async function onApprove(id, type) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = requesterName(u);
  const ok = await confirmDialog({
    title: `Approve ${type} request?`,
    message: `${name} will be granted ${type} access.`,
    confirmLabel: 'Approve',
  });
  if (!ok) return;
  const res = type === 'admin' ? await approveAdmin(id) : await approveFaculty(id);
  if (!res.ok) return toastError(res.error || 'Could not approve the request.');
  toastSuccess(`${type === 'admin' ? 'Admin' : 'Faculty'} request approved.`);
  await load();
}

async function onReject(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = requesterName(u);
  const ok = await confirmDialog({
    title: 'Reject request?',
    message: `${name}'s request will be marked rejected. They will not get access, but you can approve them later.`,
    confirmLabel: 'Reject',
  });
  if (!ok) return;
  const res = await rejectUser(id);
  if (!res.ok) return toastError(res.error || 'Could not reject the request.');
  toastSuccess('Request rejected.');
  await load();
}

async function onDelete(id) {
  const u = all.find((x) => String(x.id) === String(id));
  const name = requesterName(u);
  const ok = await confirmDialog({
    title: 'Delete request?',
    message: `${name} will be permanently removed from the database and Firebase Authentication. This cannot be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  const res = await deleteUser(id);
  if (!res.ok) return toastError(res.error || 'Could not delete the request.');
  if (res.partialFailure) {
    toastError('Removed from database, but the Firebase account could not be deleted. Please remove it manually.');
  } else {
    toastSuccess('Request deleted.');
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
