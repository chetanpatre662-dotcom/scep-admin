/**
 * dom.js — Small DOM utility helpers used across pages.
 * Keeps page controllers concise and avoids repeated boilerplate.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element from an HTML string (returns the first node). */
export function fromHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

/** Escape user-provided text before inserting into innerHTML (XSS-safe). */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Format an ISO date string to a readable date. */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Relative time ("2h ago") for notifications/feeds. */
export function timeAgo(iso) {
  const d = new Date(iso);
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  const table = [
    [60, 'second'],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
  ];
  if (secs < 60) return 'just now';
  for (const [limit, label, div] of table) {
    if (secs < limit) {
      const val = Math.floor(secs / (div || 1));
      return `${val} ${label}${val > 1 ? 's' : ''} ago`;
    }
  }
  const years = Math.floor(secs / 31557600);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

/** Debounce for search inputs. */
export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Generate a reasonably unique id (mock-only; backend will assign real ids). */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Build initials from a name for avatar fallbacks. */
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');
}

/**
 * Deterministic avatar color from a string (stable per subject/name).
 * Returns a CSS color from a small, professional (not neon) palette.
 */
const AVATAR_COLORS = [
  '#4f46e5', '#0284c7', '#059669', '#b45309',
  '#7c3aed', '#db2777', '#0891b2', '#4338ca',
];
export function avatarColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
