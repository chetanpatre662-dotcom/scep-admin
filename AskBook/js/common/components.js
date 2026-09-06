/**
 * components.js — Reusable UI fragment builders (states, badges, pagination).
 */
import { esc } from './dom.js';

/**
 * Text-only empty state — no decorative illustration/icon. `iconName` is kept
 * in the signature for backward compatibility with existing callers but is
 * intentionally NOT rendered (clean product UI, not sticker art).
 */
export function emptyState({ iconName, title = 'Nothing here yet', message = '', action = '' } = {}) {
  return `
    <div class="state">
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ''}
      ${action ? `<div class="mt-4">${action}</div>` : ''}
    </div>`;
}

export function loadingState(message = 'Loading…') {
  return `
    <div class="state">
      <span class="spinner"></span>
      <p class="mt-4">${esc(message)}</p>
    </div>`;
}

export function errorState(message = 'Something went wrong.') {
  return `
    <div class="state">
      <h3>Unable to load</h3>
      <p>${esc(message)}</p>
    </div>`;
}

/** Skeleton card grid placeholder. */
export function skeletonCards(count = 4) {
  return `<div class="grid grid-cards">${Array.from({ length: count })
    .map(() => `<div class="card"><div class="card-body"><div class="skeleton" style="height:18px;width:60%"></div><div class="skeleton mt-4" style="height:14px;width:90%"></div><div class="skeleton mt-2" style="height:14px;width:70%"></div></div></div>`)
    .join('')}</div>`;
}

const STATUS_BADGE = {
  active: 'badge-success',
  published: 'badge-success',
  inactive: 'badge-danger',
  archived: 'badge-warning',
  draft: 'badge-warning',
};

export function statusBadge(status) {
  const cls = STATUS_BADGE[status] || 'badge';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

const TYPE_BADGE = {
  General: 'badge-brand',
  Event: 'badge-info',
  Holiday: 'badge-success',
  Exam: 'badge-danger',
  'Important Notice': 'badge-accent',
};

export function typeBadge(type) {
  return `<span class="badge ${TYPE_BADGE[type] || 'badge'}">${esc(type)}</span>`;
}

/**
 * Render simple pagination controls into a container.
 * @returns HTML string; caller wires click via event delegation using data-page.
 */
export function paginationBar({ page, pageSize, total }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return '';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  let btns = '';
  for (let p = 1; p <= pages; p++) {
    btns += `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }
  return `
    <div class="pagination">
      <span class="text-muted">Showing ${start}–${end} of ${total}</span>
      <div class="pages">
        <button class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Prev</button>
        ${btns}
        <button class="page-btn" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Next</button>
      </div>
    </div>`;
}
