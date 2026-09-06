/**
 * admin/settings.js — Institute profile, preferences, and demo-data reset.
 * Settings are cosmetic in Phase 1; persistence arrives with the backend.
 */
import { APP } from '../config.js';
import { $, $$, esc } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { toastSuccess, toastInfo } from '../common/toast.js';
import { bootstrapAdmin } from './nav.js';

bootstrapAdmin({ activeId: 'settings', title: 'Settings' }).then((ctx) => { if (ctx) init(ctx); });

function init({ main, user }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Manage institute profile and system preferences.</p>
      </div>
    </div>

    <div class="settings-grid">
      <nav class="settings-nav card"><div class="card-body" style="padding:var(--sp-3)">
        <a class="sn-link active" data-tab="institute">Institute Profile</a>
        <a class="sn-link" data-tab="preferences">Preferences</a>
        <a class="sn-link" data-tab="account">Admin Account</a>
      </div></nav>

      <div id="tabArea"></div>
    </div>
  `;

  const tabs = {
    institute: institutePanel(),
    preferences: preferencesPanel(),
    account: accountPanel(user),
  };

  const area = $('#tabArea');
  const show = (tab) => {
    area.innerHTML = tabs[tab];
    wire(tab, area);
    $$('.sn-link', main).forEach((l) => l.classList.toggle('active', l.dataset.tab === tab));
  };
  $$('.sn-link', main).forEach((l) => l.addEventListener('click', () => show(l.dataset.tab)));
  show('institute');
}

function card(title, bodyHTML, footHTML = '') {
  return `<div class="card"><div class="card-header"><h3 class="card-title">${esc(title)}</h3></div>
    <div class="card-body">${bodyHTML}</div>${footHTML}</div>`;
}

function institutePanel() {
  return card('Institute Profile', `
    <form id="instForm">
      <div class="form-group"><label class="form-label">Institute name</label>
        <input class="input" name="name" value="${esc(APP.COLLEGE_NAME)}" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Short code</label>
          <input class="input" name="short" value="${esc(APP.COLLEGE_SHORT)}" /></div>
        <div class="form-group"><label class="form-label">Contact email</label>
          <input class="input" name="email" type="email" value="info@askbook.edu" /></div>
      </div>
      <button type="button" class="btn btn-primary" id="saveInst">${icon('check')} Save changes</button>
    </form>
  `);
}

function preferencesPanel() {
  return card('Preferences', `
    <div class="form-group"><label class="checkbox-row"><input type="checkbox" checked /> Email notifications for new announcements</label></div>
    <div class="form-group"><label class="checkbox-row"><input type="checkbox" checked /> Allow faculty to upload question papers</label></div>
    <div class="form-group"><label class="checkbox-row"><input type="checkbox" /> Require admin approval before publishing announcements</label></div>
    <button type="button" class="btn btn-primary" id="savePrefs">${icon('check')} Save preferences</button>
  `);
}

function accountPanel(user) {
  return card('Admin Account', `
    <div class="flex items-center gap-3 mb-4">
      <div class="avatar lg" style="background:#6d28d9">${esc((user.name || 'A')[0])}</div>
      <div><div style="font-weight:700">${esc(user.name)}</div>
        <div class="text-muted">${esc(user.email || 'admin@askbook.edu')}</div></div>
    </div>
    <div class="form-group"><label class="form-label">Change password</label>
      <input class="input" type="password" placeholder="New password" /></div>
    <button type="button" class="btn btn-primary" id="savePw">${icon('key')} Update password</button>
  `);
}

function wire(tab, area) {
  const stub = (id, msg) => area.querySelector('#' + id)?.addEventListener('click', () => toastInfo(msg));
  if (tab === 'institute') area.querySelector('#saveInst')?.addEventListener('click', () => toastSuccess('Institute profile saved (frontend only).'));
  if (tab === 'preferences') area.querySelector('#savePrefs')?.addEventListener('click', () => toastSuccess('Preferences saved (frontend only).'));
  if (tab === 'account') stub('savePw', 'Password changes require backend authentication (Phase 2).');
}
