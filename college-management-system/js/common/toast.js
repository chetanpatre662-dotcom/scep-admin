/**
 * toast.js — Non-blocking toast notifications (success/error/info/warning).
 */
import { icon } from './icons.js';
import { esc } from './dom.js';

let container;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = {
  success: 'checkCircle',
  error: 'alert',
  warning: 'alert',
  info: 'info',
};

const TITLES = {
  success: 'Success',
  error: 'Error',
  warning: 'Warning',
  info: 'Notice',
};

/**
 * Show a toast.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration ms (0 = sticky)
 */
export function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icon(ICONS[type] || 'info')}</span>
    <div>
      <div class="toast-title">${esc(TITLES[type] || 'Notice')}</div>
      <div class="toast-msg">${esc(message)}</div>
    </div>
    <button class="toast-close" aria-label="Dismiss">${icon('x')}</button>
  `;
  const remove = () => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  el.querySelector('.toast-close').addEventListener('click', remove);
  ensureContainer().appendChild(el);
  if (duration > 0) setTimeout(remove, duration);
  return el;
}

export const toastSuccess = (m, d) => toast(m, 'success', d);
export const toastError = (m, d) => toast(m, 'error', d);
export const toastInfo = (m, d) => toast(m, 'info', d);
export const toastWarning = (m, d) => toast(m, 'warning', d);
