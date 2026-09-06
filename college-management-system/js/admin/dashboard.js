/**
 * admin/dashboard.js — Administration overview.
 * -----------------------------------------------------------------------------
 * User counts (Total users / Students / Faculty / Admins) come from the REAL
 * backend (`GET /api/admin/stats` -> PostgreSQL). Pending-faculty count is also
 * real. Metrics that depend on data not yet migrated to the backend (classes,
 * announcements, question papers — Phase B) are shown as an honest "N/A" rather
 * than fabricated mock numbers. No mock services are used here anymore.
 * -----------------------------------------------------------------------------
 */
import { ROUTES, resolvePath } from '../config.js';
import { esc } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { loadingState } from '../common/components.js';
import { bootstrapAdmin } from './nav.js';
import { getAdminStats } from '../services/adminService.js';

bootstrapAdmin({ activeId: 'dashboard', title: 'Overview' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  main.innerHTML = `
    <div class="greeting">
      <div>
        <h1 class="g-title">Overview</h1>
        <div class="g-sub">Signed in as ${esc(user.name || 'Administrator')} · ${esc(user.designation || 'Admin')}</div>
      </div>
    </div>
    <div id="dashBody">${loadingState('Loading overview…')}</div>
  `;

  const body = document.getElementById('dashBody');
  const res = await getAdminStats();

  if (!res.ok) {
    // Honest API-error state (no fake values), with a retry.
    body.innerHTML = errorState(res.error || 'Could not load statistics.');
    body.querySelector('#retryStats')?.addEventListener('click', () => init({ main, user }));
    return;
  }

  const s = res.stats || {};
  const naNote = 'N/A'; // Phase B metrics not yet backed by the database.

  body.innerHTML = `
    <div class="metric-row">
      ${metric('users', s.totalUsers ?? 0, 'Total users', null)}
      ${metric('graduation', s.students ?? 0, 'Students', ROUTES.ADMIN.STUDENTS)}
      ${metric('user', s.faculty ?? 0, 'Faculty', ROUTES.ADMIN.FACULTY)}
      ${metric('shield', s.admins ?? 0, 'Admins', null)}
    </div>

    <div class="metric-row">
      ${metric('checkCircle', s.pendingFaculty ?? 0, 'Pending faculty', ROUTES.ADMIN.FACULTY)}
      ${metric('classes', s.classes ?? 0, 'Classes', ROUTES.ADMIN.CLASSES)}
      ${metric('book', s.subjects ?? 0, 'Subjects', ROUTES.ADMIN.COURSES)}
      ${metric('megaphone', naNote, 'Announcements', null)}
    </div>

    <div class="dash-cols">
      <section class="section">
        <div class="section-head"><h2>Recent announcements</h2></div>
        <div class="card"><div class="card-body">
          <p class="text-muted">Announcement data will appear here once the announcements module is connected to the database (Phase B).</p>
        </div></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Manage</h2></div>
        <div class="card"><div class="card-body">
          <div class="list-flush">
            ${link('Student directory', ROUTES.ADMIN.STUDENTS, 'graduation')}
            ${link('Faculty accounts', ROUTES.ADMIN.FACULTY, 'user')}
            ${link('Classes', ROUTES.ADMIN.CLASSES, 'classes')}
            ${link('Courses & branches', ROUTES.ADMIN.COURSES, 'book')}
            ${link('System settings', ROUTES.ADMIN.SETTINGS, 'settings')}
          </div>
        </div></div>
      </section>
    </div>
  `;
}

function errorState(message) {
  return `
    <div class="card"><div class="card-body" style="text-align:center;padding:var(--sp-6)">
      <div class="text-muted" style="margin-bottom:var(--sp-3)">${icon('alert')} ${esc(message)}</div>
      <button class="btn btn-primary" id="retryStats">${icon('arrowRight')} Retry</button>
    </div></div>`;
}

function metric(iconName, value, label, route) {
  const inner = `<div class="metric"><div class="m-label">${icon(iconName)} ${esc(label)}</div><div class="m-value">${esc(String(value))}</div></div>`;
  return route ? `<a href="${resolvePath(route)}" style="text-decoration:none">${inner}</a>` : inner;
}

function link(label, route, iconName) {
  return `<a class="list-link" href="${resolvePath(route)}"><span class="lr-icon">${icon(iconName)}</span>
    <span class="lr-title">${esc(label)}</span><span class="ll-chev">${icon('chevronRight')}</span></a>`;
}
