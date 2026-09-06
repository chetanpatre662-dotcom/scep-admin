/**
 * student/announcements.js — Targeted announcement feed for the student.
 * Only announcements matching the student's profile are shown, and each item
 * visually shows the target audience it was addressed to.
 */
import { ANNOUNCEMENT_TYPES } from '../config.js';
import { $, $$, esc, formatDate, timeAgo, debounce } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { typeBadge, emptyState, skeletonCards } from '../common/components.js';
import { bootstrapStudent } from './nav.js';
import { getForStudent } from '../services/announcementService.js';
import { fetchProfileStatus } from '../services/authService.js';

let all = [];

bootstrapStudent({ activeId: 'announcements', title: 'Announcements' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Announcements</h1>
        <p class="page-subtitle" id="annSub">Notices relevant to your course, branch and semester.</p>
      </div>
    </div>
    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search announcements…" />
        <select id="filterType"><option value="">All Types</option>
          ${ANNOUNCEMENT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
      </div>
    </div></div>
    <div id="feed">${skeletonCards(3)}</div>
  `;

  $('#searchInput').addEventListener('input', debounce(render, 200));
  $('#filterType').addEventListener('change', render);

  // Real academic profile for the subtitle (best-effort).
  fetchProfileStatus().then((r) => {
    const s = r.ok && r.status && r.status.student;
    const sub = $('#annSub');
    if (s && sub) sub.textContent = `Notices addressed to ${s.program} · ${s.branch} · Semester ${s.semester}.`;
  });

  await load();
}

async function load() {
  const host = $('#feed');
  host.innerHTML = skeletonCards(3);
  const res = await getForStudent();
  if (!res.ok) {
    host.innerHTML = emptyState({ iconName: 'megaphone', title: 'Could not load announcements', message: res.error || 'Please try again.' });
    return;
  }
  all = res.items || [];
  render();
}

function audienceLabel(a) {
  if (a.audience === 'Specific Semester') return `${a.course} · ${a.branch} · Sem ${a.semester}`;
  if (a.audience === 'Specific Branch') return `${a.course} · ${a.branch}`;
  return a.audience;
}

function render() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const ft = $('#filterType').value;
  const filtered = all.filter((a) => {
    const mQ = !q || `${a.title} ${a.description}`.toLowerCase().includes(q);
    const mT = !ft || a.type === ft;
    return mQ && mT;
  });

  const host = $('#feed');
  if (!filtered.length) {
    host.innerHTML = emptyState({ iconName: 'megaphone', title: all.length ? 'No matches' : 'No announcements yet', message: all.length ? 'Try different filters.' : 'You are all caught up.' });
    return;
  }

  host.innerHTML = `<div class="ann-feed">${filtered
    .map(
      (a) => `
      <div class="ann-item type-${esc(a.type).replace(/\s/g, '.')}">
        <div class="ann-head">
          <span class="ann-title">${esc(a.title)}</span>
          ${typeBadge(a.type)}
        </div>
        <p class="ann-desc">${esc(a.description)}</p>
        <div class="ann-foot">
          <span class="target-tags"><span class="badge badge-brand">${icon('users')} ${esc(audienceLabel(a))}</span></span>
          ${a.eventDate ? `<span>${icon('calendar')} ${formatDate(a.eventDate)}</span>` : ''}
          <span>${icon('clock')} ${esc(timeAgo(a.created))}</span>
          ${a.attachment ? `<span>${icon('file')} ${esc(a.attachment)}</span>` : ''}
        </div>
      </div>`
    )
    .join('')}</div>`;
}
