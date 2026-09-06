/**
 * student/question-papers.js — Browse + download question papers (REAL backend).
 * -----------------------------------------------------------------------------
 * Papers come from GET /student/question-papers (scoped to the student's real
 * academic group). Downloads use the backend signed-URL redirect. No mock, no
 * localStorage, no fake download toasts.
 * -----------------------------------------------------------------------------
 */
import { ENV, COURSE_TYPES, BRANCHES } from '../config.js';
import { $, $$, esc, formatDate, debounce } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { bootstrapStudent } from './nav.js';
import { getStudentPapers, paperDownloadPath } from '../services/questionPaperService.js';

let all = [];

bootstrapStudent({ activeId: 'papers', title: 'Question Papers' }).then((ctx) => { if (ctx) init(ctx); });

function downloadUrl(fileId) { return `${ENV.API_BASE_URL}${paperDownloadPath(fileId)}`; }

async function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Previous Question Papers</h1>
        <p class="page-subtitle">Question papers shared for your course, branch and semester.</p>
      </div>
    </div>
    <div class="card mb-4"><div class="card-body">
      <div class="toolbar">
        <input class="input search" id="searchInput" type="search" placeholder="Search subject or title…" />
        <select id="fCourse"><option value="">All Courses</option>
          <option>${COURSE_TYPES.BTECH}</option><option>${COURSE_TYPES.POLYTECHNIC}</option></select>
        <select id="fBranch"><option value="">All Branches</option>
          ${BRANCHES.map((b) => `<option>${b}</option>`).join('')}</select>
      </div>
    </div></div>
    <div id="list">${skeletonCards(3)}</div>
  `;

  $('#searchInput').addEventListener('input', debounce(render, 200));
  ['fCourse', 'fBranch'].forEach((id) => $('#' + id).addEventListener('change', render));

  await load();
}

async function load() {
  const host = $('#list');
  host.innerHTML = skeletonCards(3);
  const res = await getStudentPapers();
  if (!res.ok) {
    host.innerHTML = errorHTML(res.error || 'Could not load question papers.');
    $('#qpRetry')?.addEventListener('click', load);
    return;
  }
  all = res.items || [];
  render();
}

function render() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const fc = $('#fCourse').value, fb = $('#fBranch').value;

  const filtered = all.filter((p) => {
    const mQ = !q || `${p.title} ${p.subject || ''}`.toLowerCase().includes(q);
    const mC = !fc || p.course === fc;
    const mB = !fb || p.branch === fb;
    return mQ && mC && mB;
  });

  const host = $('#list');
  if (!filtered.length) {
    host.innerHTML = emptyState({ iconName: 'file', title: all.length ? 'No papers found' : 'No question papers yet', message: all.length ? 'Try adjusting the filters above.' : 'Your faculty haven\'t shared any question papers yet.' });
    return;
  }

  host.innerHTML = `<div class="grid grid-cards">${filtered.map(cardHTML).join('')}</div>`;
}

function cardHTML(p) {
  const dl = p.file && p.file.id
    ? `<a class="btn btn-sm btn-primary" href="${esc(downloadUrl(p.file.id))}" target="_blank" rel="noopener">${icon('download')} Download</a>`
    : `<span class="text-muted" style="font-size:var(--fs-xs)">No file</span>`;
  return `
    <div class="card">
      <div class="card-body">
        <div class="flex items-center gap-2" style="color:var(--brand-600)">${icon('file')}
          ${p.year ? `<span class="badge badge-brand">${esc(String(p.year))}</span>` : ''}</div>
        <h3 class="mt-2" style="font-size:var(--fs-md)">${esc(p.subject || p.title)}</h3>
        <p class="text-muted" style="font-size:var(--fs-sm)">${esc(p.title)}</p>
        <div class="mt-2" style="font-size:var(--fs-xs);color:var(--text-muted)">
          ${esc(p.course || '')} · ${esc(p.branch || '')}${p.created ? ' · ' + esc(formatDate(p.created)) : ''}
        </div>
        <div class="flex gap-2 mt-4">${dl}</div>
      </div>
    </div>`;
}

function errorHTML(message) {
  return `<div class="card"><div class="card-body" style="text-align:center;padding:24px">
    <div class="text-muted" style="margin-bottom:12px">${icon('alert')} ${esc(message)}</div>
    <button class="btn btn-primary" id="qpRetry">${icon('arrowRight')} Retry</button></div></div>`;
}
