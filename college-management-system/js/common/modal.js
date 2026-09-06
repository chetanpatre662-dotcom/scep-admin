/**
 * modal.js — Accessible modal dialog + confirm() helper.
 * Handles focus trap basics, ESC to close, and backdrop click.
 */
import { icon } from './icons.js';

/**
 * Open a modal.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body  HTML string (caller is responsible for escaping user data)
 * @param {string} [opts.size] '' | 'modal-lg'
 * @param {Array}  [opts.actions] [{ label, class, onClick(close), closeOnClick }]
 * @returns {{ close: Function, el: HTMLElement }}
 */
export function openModal({ title, body, size = '', actions = [], onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title || 'Dialog'}">
      <div class="modal-header">
        <h3>${title || ''}</h3>
        <button class="btn-icon modal-x" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">${body || ''}</div>
      ${actions.length ? '<div class="modal-footer"></div>' : ''}
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    overlay.addEventListener('transitionend', () => {
      overlay.remove();
      if (typeof onClose === 'function') onClose();
    }, { once: true });
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-x').addEventListener('click', close);

  const footer = overlay.querySelector('.modal-footer');
  if (footer) {
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = `btn ${a.class || ''}`;
      btn.innerHTML = a.label;
      btn.addEventListener('click', () => {
        const result = a.onClick ? a.onClick(close, overlay) : undefined;
        if (a.closeOnClick !== false && result !== false) close();
      });
      footer.appendChild(btn);
    });
  }

  // Focus first focusable element for accessibility.
  const focusable = overlay.querySelector('input, select, textarea, button.btn');
  if (focusable) setTimeout(() => focusable.focus(), 60);

  return { close, el: overlay };
}

/** Confirmation dialog — resolves true/false. */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="text-muted">${message}</p>`,
      actions: [
        { label: 'Cancel', class: 'btn-ghost', onClick: () => resolve(false) },
        { label: confirmLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

/**
 * Single-line text prompt dialog — resolves the entered string, or null if the
 * user cancels/closes. The initial value is inserted as a DOM value (never as
 * raw HTML) so it can't inject markup.
 */
export function promptDialog({ title = 'Enter a value', label = '', value = '', confirmLabel = 'Save', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const { el } = openModal({
      title,
      body: `
        <div class="form-group">
          ${label ? `<label class="form-label" for="promptInput">${label}</label>` : ''}
          <input class="input" id="promptInput" type="text" placeholder="${placeholder}" />
        </div>`,
      actions: [
        { label: 'Cancel', class: 'btn-ghost', onClick: () => done(null) },
        {
          label: confirmLabel,
          class: 'btn-primary',
          onClick: (close, overlay) => {
            const inputEl = overlay.querySelector('#promptInput');
            done(inputEl ? inputEl.value : null);
          },
        },
      ],
      onClose: () => done(null),
    });
    // Set the initial value via the DOM property (safe — not parsed as HTML).
    const inputEl = el.querySelector('#promptInput');
    if (inputEl) {
      inputEl.value = value || '';
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = el.querySelector('.modal-footer .btn-primary');
          if (btn) btn.click();
        }
      });
    }
  });
}
