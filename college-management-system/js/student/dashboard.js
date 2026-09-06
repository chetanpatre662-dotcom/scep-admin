/**
 * student/dashboard.js — Student overview: greeting + real academic context,
 * My Classes (auto-matched from the real profile), content counts, and relevant
 * announcements. ALL data from the backend. No mock, no localStorage, no
 * DEMO_CONTENT, no fabricated statistics.
 */
import { ROUTES, resolvePath } from '../config.js';
import { esc, timeAgo, initials, avatarColor } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { typeBadge, emptyState, loadingState } from '../common/components.js';
import { bootstrapStudent } from './nav.js';
import { getForStudent } from '../services/announcementService.js';
import { getStudentClasses } from '../services/classApiService.js';
import { getStudentDashboard } from '../services/dashboardService.js';

bootstrapStudent({ activeId: 'dashboard', title: 'Dashboard' }).then((ctx) => { if (ctx) init(ctx); });

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

async function init({ main, user: identity }) {
  const firstName = (identity.name || 'there').split(' ')[0];
  main.innerHTML = `
    <div class="greeting">
      <div>
        <h1 class="g-title">${esc(greetingWord())}, ${esc(firstName)}</h1>
        <div class="g-sub"><span class="g-context" id="gContext">${icon('graduation')} Loading…</span></div>
      </div>
      <div class="g-actions">
        <a class="btn btn-primary" href="${resolvePath(ROUTES.STUDENT.AI)}">${icon('sparkles')} Ask the assistant</a>
      </div>
    </div>
    <div id="dashBody">${loadingState('Loading your dashboard…')}</div>
  `;
  await load();
}

async function load() {
  const body = document.getElementById('dashBody');
  body.innerHTML = loadingState('Loading your dashboard…');

  const [dashRes, classesRes, annRes] = await Promise.all([
    getStudentDashboard(), getStudentClasses(), getForStudent(),
  ]);

  if (!dashRes.ok) {
    body.innerHTML = errorHTML(dashRes.error || 'Could not load your dashboard.');
    document.getElementById('dashRetry')?.addEventListener('click', load);
    return;
  }

  const profile = dashRes.profile || {};
  const stats = dashRes.stats || {};
  const classes = classesRes.ok ? (classesRes.classes || []) : [];
  const anns = annRes.ok ? (annRes.items || []) : [];

  const ctx = document.getElementById('gContext');
  if (ctx) ctx.innerHTML = `${icon('graduation')} ${esc(profile.course || '')} • ${esc(profile.branch || '')} • Semester ${esc(String(profile.semester ?? ''))}`;

  const classDetail = resolvePath(ROUTES.STUDENT.CLASS_DETAIL);

  body.innerHTML = `
    <div class="metric-row">
      ${metric('classes', stats.classes ?? 0, 'My classes')}
      ${metric('file', stats.notes ?? 0, 'Notes')}
      ${metric('file', stats.questionPapers ?? 0, 'Question papers')}
      ${metric('clipboard', stats.assignments ?? 0, 'Assignments')}
    </div>

    <section class="section mt-6">
      <div class="section-head">
        <h2>My Classes</h2>
        <a class="btn btn-sm" href="${resolvePath(ROUTES.STUDENT.CLASSES)}">View all</a>
      </div>
      ${classes.length
        ? `<div class="class-grid">${classes.slice(0, 6).map((c) => classCard(c, classDetail)).join('')}</div>`
        : emptyState({ iconName: 'classes', title: 'No classes yet', message: 'Classes for your program, branch and semester will appear here automatically.' })}
    </section>

    <section class="section mt-6">
      <div class="section-head">
        <h2>Announcements</h2>
        <a class="btn btn-sm" href="${resolvePath(ROUTES.STUDENT.ANNOUNCEMENTS)}">View all</a>
      </div>
      <div class="card"><div class="card-body">
        ${anns.length
          ? `<div class="list-flush">${anns.slice(0, 5).map(annRow).join('')}</div>`
          : emptyRow('No announcements', 'Nothing relevant to you right now.')}
      </div></div>
    </section>
  `;
}

function metric(iconName, value, label) {
  return `<div class="metric"><div class="m-label">${icon(iconName)} ${esc(label)}</div><div class="m-value">${esc(String(value))}</div></div>`;
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
        <span class="kc-open">${icon('arrowRight')}</span>
      </div>
      <div class="kc-meta">
        <span class="kc-fact">${esc(c.facultyName || 'Faculty')}</span>
      </div>
    </a>`;
}

function annRow(a) {
  return `
    <div class="list-row">
      <span class="lr-icon">${icon('megaphone')}</span>
      <div class="lr-main"><div class="lr-title">${esc(a.title)}</div>
        <div class="lr-meta">${esc(timeAgo(a.created))}</div></div>
      <div class="lr-right">${a.type ? typeBadge(a.type) : ''}</div>
    </div>`;
}

function emptyRow(title, message) {
  return `<div class="text-muted" style="padding:var(--sp-2) 0"><strong style="display:block;color:var(--gray-700)">${esc(title)}</strong>${esc(message)}</div>`;
}

function errorHTML(message) {
  return `<div class="card"><div class="card-body" style="text-align:center;padding:24px">
    <div class="text-muted" style="margin-bottom:12px">${icon('alert')} ${esc(message)}</div>
    <button class="btn btn-primary" id="dashRetry">${icon('arrowRight')} Retry</button></div></div>`;
}
