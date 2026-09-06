/**
 * admin/management.js — Admin Management (REAL backend).
 * -----------------------------------------------------------------------------
 * Lists all users whose PostgreSQL role is 'admin' (from GET /api/admin/users).
 * Action: "Remove Admin" -> demotes admin back to faculty (PATCH remove-admin).
 * This does NOT delete the user or their Firebase account.
 *
 * Self-protection: the currently logged-in admin cannot remove their own admin
 * role — the action is hidden in the UI and rejected server-side.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc, initials } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';
import { getAdminUsers, removeAdmin } from '../services/adminService.js';

let admins = [];
let currentUser = null;

bootstrapAdmin({ activeId: 'management', title: 'Admin Management' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  currentUser = user;
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Admin Management</h1>
        <p class="page-subtitle">All administrator accounts. Remove Admin reverts a user to faculty; it does not delete the account.</p>
      </div>
    </div>
    <div class="card"><div class="card-body"><div id="tableArea">${skeletonCards(1)}</div></div></div>
  `;
  await load();
}

async function load() {
  const host = $('#tableArea');
  if (host) host.innerHTML = skeletonCards(1);
  const res = await getAdminUsers();
  if (!res.ok) {
    if (host) {
      host.innerHTML = errorState(res.error || 'Could not load administrators.');
      host.querySelector('#retryBtn')?.addEventListener('click', load);
    }
    return;
  }
  admins = (res.users || []).filter((u) => u.role === 'admin');
  render();
}

function render() {
  const host = $('#tableArea');
  if (!admins.length) {
    host.innerHTML = emptyState({ iconName: 'shield', title: 'No administrators', message: 'There are no admin accounts to display.' });
    return;
  }
  host.innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Administrator</th><th>Email</th><th>Profile</th><th>Role</th><th>Actions</th></tr></thead>
      <tbody>${admins.map(rowHTML).join('')}</tbody>
    </table></div>
  `;
  $$('[data-remove]', host).forEach((b) => b.addEventListener('click', () => onRemove(b.dataset.remove)));
}

function profileInfo(u) {
  if (u.faculty) {
    const f = u.faculty;
    return `Faculty · ${esc(f.department || '—')}${f.designation ? ' · ' + esc(f.designation) : ''}`;
  }
  if (u.student) {
    const s = u.student;
    return `Student · ${esc(s.program || '—')} ${esc(s.branch || '')}`.trim();
  }
  return '<span class="text-muted">—</span>';
}

function rowHTML(u) {
  const name = u.faculty?.fullName || u.student?.fullName || u.displayName || (u.email ? u.email.split('@')[0] : 'Admin');
  const isSelf = currentUser && Number(u.id) === Number(currentUser.id);
  // Self-protection: no Remove Admin for the logged-in admin.
  const action = isSelf
    ? '<span class="text-muted">You</span>'
    : `<button class="btn btn-sm btn-outline" data-remove="${u.id}">${icon('logout')} Remove Admin</button>`;
  return `
    <tr>
      <td><div class="flex items-center gap-3">
        <div class="avatar" style="width:34px;height:34px;font-size:var(--fs-xs);background:#6d28d9">${esc(initials(name))}</div>
        <div><div style="font-weight:600">${esc(name)}${isSelf ? ' <span class="text-muted" style="font-weight:400">(you)</span>' : ''}</div></div>
      </div></td>
      <td>${esc(u.email || '—')}</td>
      <td>${profileInfo(u)}</td>
      <td><span class="badge" style="background:#ede9fe;color:#6d28d9">Admin</span></td>
      <td><div class="row-actions">${action}</div></td>
    </tr>`;
}

async function onRemove(id) {
  const u = admins.find((x) => String(x.id) === String(id));
  const name = u?.faculty?.fullName || u?.email || 'this admin';
  const ok = await confirmDialog({
    title: 'Remove admin role?',
    message: `${name} will be reverted to the faculty role and lose administrator access. Their account is not deleted.`,
    confirmLabel: 'Remove Admin',
  });
  if (!ok) return;
  const res = await removeAdmin(id);
  if (!res.ok) return toastError(res.error || 'Could not remove admin role.');
  toastSuccess('Admin role removed. User is now faculty.');
  await load();
}

function errorState(message) {
  return `
    <div style="text-align:center;padding:var(--sp-6)">
      <div class="text-muted" style="margin-bottom:var(--sp-3)">${icon('alert')} ${esc(message)}</div>
      <button class="btn btn-primary" id="retryBtn">${icon('arrowRight')} Retry</button>
    </div>`;
}
