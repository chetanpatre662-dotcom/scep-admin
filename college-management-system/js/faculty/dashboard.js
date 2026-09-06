/**
 * faculty/dashboard.js — Faculty workspace: greeting, quick actions,
 * My Classes, and recent activity. ALL metrics/lists come from the real backend
 * (PostgreSQL aggregates). No mock, no localStorage, no fabricated numbers.
 */
import { ROUTES, resolvePath } from '../config.js';
import { esc, timeAgo, initials, avatarColor } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { loadingState, emptyState } from '../common/components.js';
import { bootstrapFaculty } from './nav.js';
import { getFacultyClasses } from '../services/classApiService.js';
import { getFacultyDashboard } from '../services/dashboardService.js';

bootstrapFaculty({ activeId: 'dashboard', title: 'Dashboard' }).then((ctx) => { if (ctx) init(ctx); });

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTIVITY_ICON = { note: 'file', question_paper: 'file', assignment: 'clipboard', project: 'folder' };
const ACTIVITY_LABEL = { note: 'Note', question_paper: 'Question paper', assignment: 'Assignment', project: 'Project' };

async function init({ main, user }) {
  const firstName = (user.name || 'there').split(' ')[0];

  main.innerHTML = `
    <div class="greeting">
      <div>
        <h1 class="g-title">${esc(greetingWord())}, ${esc(firstName)}</h1>
        <div class="g-sub">${esc(user.designation || 'Faculty')}${user.department ? ' · ' + esc(user.department) : ''}</div>
      </div>
      <div class="g-actions">
        <a class="btn btn-primary" href="${resolvePath(ROUTES.FACULTY.CLASSES)}">${icon('plus')} Create class</a>
      </div>
    </div>
    <div id="dashBody">${loadingState('Loading your workspace…')}</div>
  `;

  await load(main);
}

async function load(main) {
  const body = document.getElementById('dashBody');
  body.innerHTML = loadingState('Loading your workspace…');

  const [dashRes, classesRes] = await Promise.all([getFacultyDashboard(), getFacultyClasses()]);

  if (!dashRes.ok) {
    body.innerHTML = errorHTML(dashRes.error || 'Could not load your dashboard.');
    document.getElementById('dashRetry')?.addEventListener('click', () => load(main));
    return;
  }

  const stats = dashRes.stats || {};
  const recent = dashRes.recentActivity || [];
  const classes = classesRes.ok ? (classesRes.classes || []) : [];
  const active = classes.filter((c) => c.status === 'active');
  const classDetail = resolvePath(ROUTES.FACULTY.CLASS_DETAIL);

  body.innerHTML = `
    <div class="metric-row">
      ${metric('classes', stats.classes ?? 0, 'Active classes')}
      ${metric('users', stats.studentsReached ?? 0, 'Students reached')}
      ${metric('megaphone', stats.announcements ?? 0, 'Published announcements')}
      ${metric('file', stats.questionPapers ?? 0, 'Question papers')}
    </div>

    <section class="section">
      <div class="section-head"><h2>Quick actions</h2></div>
      <div class="quick-actions">
        ${qa('plus', 'Create class', ROUTES.FACULTY.CLASSES)}
        ${qa('message', 'Message a class', ROUTES.FACULTY.CLASSES)}
        ${qa('megaphone', 'Post announcement', ROUTES.FACULTY.ANNOUNCEMENTS)}
        ${qa('file', 'Upload question paper', ROUTES.FACULTY.QUESTION_PAPERS)}
      </div>
    </section>

    <div class="dash-cols mt-6">
      <section class="section">
        <div class="section-head"><h2>My classes</h2>
          <a class="btn btn-sm" href="${resolvePath(ROUTES.FACULTY.CLASSES)}">View all</a></div>
        ${active.length
          ? `<div class="class-grid">${active.slice(0, 4).map((c) => classCard(c, classDetail)).join('')}</div>`
          : emptyState({ iconName: 'classes', title: 'No classes yet', message: 'Create your first class to get started.' })}
      </section>

      <section class="section">
        <div class="section-head"><h2>Recent activity</h2></div>
        <div class="card"><div class="card-body" id="activity"></div></div>
      </section>
    </div>
  `;

  renderActivity(recent);
}

function metric(iconName, value, label) {
  return `<div class="metric"><div class="m-label">${icon(iconName)} ${esc(label)}</div><div class="m-value">${esc(String(value))}</div></div>`;
}
function qa(iconName, label, route) {
  return `<a class="qa" href="${resolvePath(route)}"><span class="qa-icon">${icon(iconName)}</span>${esc(label)}</a>`;
}

function classCard(c, detailUrl) {
  const subject = c.subject || c.title || 'Class';
  return `
    <a class="klass-card compact" href="${detailUrl}?id=${encodeURIComponent(c.id)}">
      <div class="kc-top">
        <span class="kc-avatar" style="background:${avatarColor(subject)}">${esc(initials(subject))}</span>
        <div class="kc-head">
          <div class="kc-title" title="${esc(subject)}">${esc(subject)}</div>
          <div class="kc-sub">${esc(c.course)} • ${esc(c.branch)} • Sem ${esc(String(c.semester))}</div>
        </div>
        <span class="kc-status">${esc((c.status || 'active').replace(/^./, (m) => m.toUpperCase()))}</span>
      </div>
      <div class="kc-meta">
        <span class="kc-open" style="margin-left:auto">Open ${icon('arrowRight')}</span>
      </div>
    </a>`;
}

function renderActivity(recent) {
  const host = document.getElementById('activity');
  if (!recent.length) { host.innerHTML = '<p class="text-muted">No recent activity.</p>'; return; }
  host.innerHTML = `<div class="list-flush">${recent.map((i) => `
    <div class="list-row">
      <span class="lr-icon">${icon(ACTIVITY_ICON[i.kind] || 'file')}</span>
      <div class="lr-main"><div class="lr-title">${esc(i.title)}</div><div class="lr-meta">${esc(ACTIVITY_LABEL[i.kind] || 'Item')}</div></div>
      <div class="lr-right"><span class="lr-meta">${esc(timeAgo(i.createdAt))}</span></div>
    </div>`).join('')}</div>`;
}

function errorHTML(message) {
  return `<div class="card"><div class="card-body" style="text-align:center;padding:24px">
    <div class="text-muted" style="margin-bottom:12px">${icon('alert')} ${esc(message)}</div>
    <button class="btn btn-primary" id="dashRetry">${icon('arrowRight')} Retry</button></div></div>`;
}
