/**
 * student/classes.js — "My Classes": the student's CURRENT-SEMESTER classes.
 *
 * Membership is AUTOMATIC and enforced server-side: the backend returns classes
 * matching the authenticated student's real DB profile (course + branch +
 * semester) via GET /api/student/classes. No mock data, no localStorage.
 */
import { ROUTES, resolvePath } from '../config.js';
import { $, $$, esc, debounce, initials, avatarColor } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { bootstrapStudent } from './nav.js';
import { getStudentClasses } from '../services/classApiService.js';
import { getMySubjects } from '../services/subjectService.js';

bootstrapStudent({ activeId: 'classes', title: 'My Classes' }).then((ctx) => { if (ctx) init(ctx); });

let all = [];

async function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Classes</h1>
        <p class="page-subtitle">Your current academic session. Classes are assigned automatically based on your course, branch and semester.</p>
      </div>
    </div>

    <div class="session-strip" id="sessionStrip" style="display:none">
      ${icon('graduation')}
      <span>Current Academic Session</span>
      <span class="ss-badge" id="sessionBadge"></span>
    </div>

    <section class="section">
      <div class="section-head"><h2>My Subjects</h2></div>
      <div id="subjectsArea">${skeletonCards(1)}</div>
    </section>

    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search classes or faculty…" />
      </div>
    </div></div>

    <div id="grid">${skeletonCards(3)}</div>
  `;

  $('#searchInput').addEventListener('input', debounce(render, 200));

  // Real subjects for the student's OWN Course+Branch+Semester (backend-derived).
  loadSubjects();

  await loadClasses();
}

/* ---- Real classes (PostgreSQL) for the logged-in student's group ---- */
async function loadClasses() {
  const host = $('#grid');
  if (host) host.innerHTML = skeletonCards(3);
  const res = await getStudentClasses();
  if (!res.ok) {
    all = [];
    if (host) {
      host.innerHTML = `<div class="state"><h3>Couldn't load classes</h3><p>${esc(res.error || 'Failed to load. Please try again.')}</p><button class="btn btn-primary" id="clsRetry">Retry</button></div>`;
      host.querySelector('#clsRetry')?.addEventListener('click', loadClasses);
    }
    return;
  }
  all = res.classes || [];
  // Populate the academic-session strip from the first class (or leave hidden).
  if (all.length) {
    const c = all[0];
    const strip = $('#sessionStrip'); const badge = $('#sessionBadge');
    if (strip && badge) { badge.textContent = `${c.course} • ${c.branch} • Semester ${c.semester}`; strip.style.display = ''; }
  }
  render();
}

/* ---- Real subjects (PostgreSQL) for the logged-in student's own group ---- */
async function loadSubjects() {
  const host = $('#subjectsArea');
  if (!host) return;
  const res = await getMySubjects();
  if (!res.ok) {
    if (res.status === 409) {
      // No/incomplete student profile.
      host.innerHTML = infoCard('Complete your student profile to see your semester subjects.');
    } else {
      host.innerHTML = errorCard(res.error || 'Failed to load subjects. Please try again.', 'retrySubjects');
      host.querySelector('#retrySubjects')?.addEventListener('click', loadSubjects);
    }
    return;
  }
  const subjects = res.subjects || [];
  const ctx = res.context;
  const ctxLabel = ctx ? `${esc(ctx.program)} • ${esc(ctx.branch)} • Semester ${esc(String(ctx.semester))}` : '';
  if (!subjects.length) {
    host.innerHTML = `<div class="card"><div class="card-body">
      ${ctxLabel ? `<div class="text-muted" style="margin-bottom:6px">${ctxLabel}</div>` : ''}
      <p class="text-muted">No subjects found for this Course, Branch and Semester.</p>
    </div></div>`;
    return;
  }
  host.innerHTML = `<div class="card"><div class="card-body">
    ${ctxLabel ? `<div class="text-muted" style="margin-bottom:10px">${ctxLabel}</div>` : ''}
    <div class="class-grid">${subjects.map(subjectCard).join('')}</div>
  </div></div>`;
}

function subjectCard(s) {
  return `
    <div class="klass-card">
      <div class="kc-top">
        <span class="kc-avatar" style="background:${avatarColor(s.name)}">${esc(initials(s.name))}</span>
        <div class="kc-head">
          <div class="kc-title" title="${esc(s.name)}">${esc(s.name)}</div>
          <div class="kc-sub">${s.code ? esc(s.code) + ' • ' : ''}Sem ${esc(String(s.semester))}</div>
        </div>
      </div>
      ${s.description ? `<p class="text-muted" style="font-size:var(--fs-sm);margin:8px 0 0">${esc(s.description)}</p>` : ''}
    </div>`;
}

function infoCard(message) {
  return `<div class="card"><div class="card-body"><p class="text-muted">${icon('info')} ${esc(message)}</p></div></div>`;
}

function errorCard(message, retryId) {
  return `<div class="card"><div class="card-body" style="text-align:center;padding:var(--sp-5)">
    <div class="text-muted" style="margin-bottom:var(--sp-3)">${icon('alert')} ${esc(message)}</div>
    <button class="btn btn-primary" id="${retryId}">${icon('arrowRight')} Retry</button>
  </div></div>`;
}

function render() {
  const q = ($('#searchInput')?.value || '').trim().toLowerCase();
  const filtered = all.filter((c) =>
    !q || `${c.subject || ''} ${c.facultyName || ''}`.toLowerCase().includes(q)
  );

  const host = $('#grid');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      iconName: 'classes',
      title: all.length ? 'No matching classes' : 'No classes yet',
      message: all.length
        ? 'Try a different search.'
        : 'Once faculty create classes for your program, branch and semester, they will appear here automatically.',
    });
    return;
  }

  const detailUrl = resolvePath(ROUTES.STUDENT.CLASS_DETAIL);
  host.innerHTML = `<div class="class-grid">${filtered.map((c) => cardHTML(c, detailUrl)).join('')}</div>`;
}

function cardHTML(c, detailUrl) {
  const subject = c.subject || c.title || 'Class';
  return `
    <a class="klass-card" href="${detailUrl}?id=${encodeURIComponent(c.id)}">
      <div class="kc-top">
        <span class="kc-avatar" style="background:${avatarColor(subject)}">${esc(initials(subject))}</span>
        <div class="kc-head">
          <div class="kc-title" title="${esc(subject)}">${esc(subject)}</div>
          <div class="kc-sub">${esc(c.course || '')} • ${esc(c.branch)} • Sem ${c.semester}</div>
        </div>
        <span class="kc-status">Active</span>
      </div>
      <div class="kc-foot">
        <span class="kc-activity">${esc(c.facultyName || 'Faculty')}</span>
        <span class="kc-open">Enter Class ${icon('arrowRight')}</span>
      </div>
    </a>`;
}
