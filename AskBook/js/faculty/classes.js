/**
 * faculty/classes.js — My Classes list + the "Create Class" wizard.
 *
 * Wizard flow: Course Type -> Branch -> Semester -> Create.
 * Semester options are driven by SEMESTER_STRUCTURE, so Polytechnic (6, grouped
 * by year) and B.Tech (8) render differently and update dynamically.
 */
import { COURSE_TYPES, BRANCHES, SEMESTER_STRUCTURE, ROUTES, resolvePath } from '../config.js';
import { $, $$, esc, debounce, initials, avatarColor } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { bootstrapFaculty } from './nav.js';
// Real backend APIs (no mock classService). Live updates elsewhere via WebSocket.
import { getFacultyClasses, createClass } from '../services/classApiService.js';
import { getFacultySubjects } from '../services/subjectService.js';

let allClasses = [];
let FACULTY_NAME = 'Faculty';

bootstrapFaculty({ activeId: 'classes', title: 'My Classes' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  FACULTY_NAME = user?.name || 'Faculty';
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Classes</h1>
        <p class="page-subtitle">Classes you have created across B.Tech and Polytechnic programs.</p>
      </div>
      <button class="btn btn-primary" id="addClassBtn">${icon('plus')} Create Class</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Subjects Catalogue</h2></div>
      <div class="card mb-4"><div class="card-body">
        <div class="toolbar">
          <label class="form-label" style="align-self:center;margin:0">Course</label>
          <select id="subjCourse">
            <option value="${COURSE_TYPES.BTECH}">${COURSE_TYPES.BTECH}</option>
            <option value="${COURSE_TYPES.POLYTECHNIC}">${COURSE_TYPES.POLYTECHNIC}</option>
          </select>
          <label class="form-label" style="align-self:center;margin:0">Branch</label>
          <select id="subjBranch">${BRANCHES.map((b) => `<option value="${b}">${b}</option>`).join('')}</select>
          <label class="form-label" style="align-self:center;margin:0">Semester</label>
          <select id="subjSem"></select>
        </div>
        <div id="subjResult" style="margin-top:var(--sp-4)"></div>
      </div></div>
    </section>

    <div class="card mb-4">
      <div class="card-body">
        <div class="toolbar">
          <input class="input search" id="searchInput" type="search" placeholder="Search by branch or course…" />
          <select id="filterCourse"><option value="">All Courses</option>
            <option>${COURSE_TYPES.BTECH}</option><option>${COURSE_TYPES.POLYTECHNIC}</option></select>
          <select id="filterBranch"><option value="">All Branches</option>
            ${BRANCHES.map((b) => `<option>${b}</option>`).join('')}</select>
          <select id="filterSemester"><option value="">All Semesters</option>
            ${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">Semester ${i + 1}</option>`).join('')}</select>
        </div>
      </div>
    </div>

    <div id="classGrid">${skeletonCards(4)}</div>
  `;

  $('#addClassBtn').addEventListener('click', openWizard);
  const rerender = debounce(render, 200);
  $('#searchInput').addEventListener('input', rerender);
  $('#filterCourse').addEventListener('change', render);
  $('#filterBranch').addEventListener('change', render);
  $('#filterSemester').addEventListener('change', render);

  wireSubjectCatalogue();

  await load();
}

async function load() {
  const host = $('#classGrid');
  if (host) host.innerHTML = skeletonCards(4);
  const res = await getFacultyClasses();
  if (!res.ok) {
    allClasses = [];
    if (host) {
      host.innerHTML = `<div class="state"><h3>Couldn't load classes</h3><p>${esc(res.error || 'Failed to load. Please try again.')}</p><button class="btn btn-primary" id="clsRetry">Retry</button></div>`;
      host.querySelector('#clsRetry')?.addEventListener('click', load);
    }
    return;
  }
  allClasses = res.classes || [];
  render();
}

function render() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const fc = $('#filterCourse').value;
  const fb = $('#filterBranch').value;
  const fs = $('#filterSemester').value;

  const filtered = allClasses.filter((c) => {
    const hay = `${c.subject || ''} ${c.course || ''} ${c.branch || ''}`.toLowerCase();
    const matchQ = !q || hay.includes(q);
    const matchC = !fc || c.course === fc;
    const matchB = !fb || c.branch === fb;
    const matchS = !fs || String(c.semester) === fs;
    return matchQ && matchC && matchB && matchS;
  });

  const host = $('#classGrid');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      iconName: 'classes',
      title: allClasses.length ? 'No matching classes' : 'No classes yet',
      message: allClasses.length ? 'Try adjusting your search or filters.' : 'Create your first class to get started.',
    });
    return;
  }

  const detailUrl = resolvePath(ROUTES.FACULTY.CLASS_DETAIL);
  host.innerHTML = `<div class="classes-grid">${filtered.map((c) => cardHTML(c, detailUrl)).join('')}</div>`;

  // Whole card is clickable (keyboard + mouse); the delete button opts out.
  $$('.classroom-card', host).forEach((card) => {
    const go = () => { window.location.href = card.dataset.href; };
    card.addEventListener('click', (e) => { if (!e.target.closest('[data-del]')) go(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

/* Inline SVGs (self-contained — do not depend on the shared icon() sizing). */
const SVG_USERS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
const SVG_TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

function cardHTML(c, detailUrl) {
  const archived = c.status === 'archived';
  const subject = c.subject || c.title || 'Class';
  const students = c.students || 0;
  const href = `${detailUrl}?id=${encodeURIComponent(c.id)}`;
  return `
    <div class="classroom-card" role="link" tabindex="0" data-href="${href}">
      <div class="card-header" style="background:${bannerGradient(subject)}">
        <span class="status-badge ${archived ? 'archived' : ''}">${esc(statusLabel(c.status))}</span>
        <h3 class="class-title" title="${esc(subject)}">${esc(subject)}</h3>
        <p class="class-subtitle">${esc(c.course || '')} • ${esc(c.branch)} • Sem ${c.semester}</p>
      </div>
      <div class="card-body">
        <div class="student-count">${SVG_USERS}<span>${students} Student${students === 1 ? '' : 's'}</span></div>
      </div>
      <div class="card-footer">
        <a href="${href}" class="btn-open" tabindex="-1">Open Class &rarr;</a>
      </div>
    </div>`;
}

function statusLabel(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Deterministic 2-stop gradient per subject (Google-Classroom-style banner).
 * Stable per subject name; professional hues (no neon).
 */
const BANNER_GRADS = [
  'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #0284c7 0%, #0891b2 100%)',
  'linear-gradient(135deg, #059669 0%, #047857 100%)',
  'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
  'linear-gradient(135deg, #db2777 0%, #be185d 100%)',
  'linear-gradient(135deg, #4338ca 0%, #6d28d9 100%)',
];
function bannerGradient(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return BANNER_GRADS[hash % BANNER_GRADS.length];
}

/* ---------------- Create Class Wizard ---------------- */

function openWizard() {
  const state = { step: 1, course: '', branch: '', semester: null, subjectId: '', subjectName: '', description: '' };
  const LAST = 4;

  const { close, el } = openModal({
    title: 'Create a new class',
    size: 'modal-lg',
    body: `
      <div class="wizard-steps">
        <div class="step active" data-step="1"><span class="num">1</span> Program</div>
        <div class="connector"></div>
        <div class="step" data-step="2"><span class="num">2</span> Branch</div>
        <div class="connector"></div>
        <div class="step" data-step="3"><span class="num">3</span> Semester</div>
        <div class="connector"></div>
        <div class="step" data-step="4"><span class="num">4</span> Details</div>
      </div>

      <div class="wizard-panel active" data-panel="1">
        <label class="form-label">Select program</label>
        <div class="chip-group" id="courseChips">
          <button type="button" class="chip" data-course="${COURSE_TYPES.BTECH}">${COURSE_TYPES.BTECH}</button>
          <button type="button" class="chip" data-course="${COURSE_TYPES.POLYTECHNIC}">${COURSE_TYPES.POLYTECHNIC}</button>
        </div>
      </div>

      <div class="wizard-panel" data-panel="2">
        <label class="form-label">Select branch</label>
        <div class="chip-group" id="branchChips">
          ${BRANCHES.map((b) => `<button type="button" class="chip" data-branch="${esc(b)}">${esc(b)}</button>`).join('')}
        </div>
      </div>

      <div class="wizard-panel" data-panel="3">
        <label class="form-label">Select semester</label>
        <div id="semesterArea"></div>
      </div>

      <div class="wizard-panel" data-panel="4">
        <div class="form-group">
          <label class="form-label" for="wzSubject">Subject <span class="req">*</span></label>
          <select class="input" id="wzSubject" disabled>
            <option value="">Select a semester first</option>
          </select>
          <div class="field-error" id="wzSubjectErr"></div>
          <p class="text-muted" id="wzSubjectHint" style="font-size:var(--fs-xs);margin-top:6px">
            Subjects are configured by the admin for this Course, Branch and Semester.
          </p>
        </div>
        <div class="form-group">
          <label class="form-label" for="wzDescription">Description</label>
          <textarea class="input" id="wzDescription" placeholder="Short description of the class (optional)"></textarea>
        </div>
        <p class="text-muted" style="font-size:var(--fs-xs)">All students in the matching program, branch and semester will be automatically enrolled.</p>
      </div>

      <div class="wizard-summary" id="summary"></div>
    `,
    actions: [
      { label: 'Back', class: 'btn-ghost', closeOnClick: false, onClick: () => goBack() },
      { label: 'Next', class: 'btn-primary', closeOnClick: false, onClick: () => goNext() },
    ],
    onClose: () => {},
  });

  const panels = () => $$('.wizard-panel', el);
  const steps = () => $$('.wizard-steps .step', el);
  const backBtn = el.querySelectorAll('.modal-footer .btn')[0];
  const nextBtn = el.querySelectorAll('.modal-footer .btn')[1];

  function refresh() {
    panels().forEach((p) => p.classList.toggle('active', Number(p.dataset.panel) === state.step));
    steps().forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle('active', n === state.step);
      s.classList.toggle('done', n < state.step);
    });
    backBtn.style.visibility = state.step === 1 ? 'hidden' : 'visible';
    nextBtn.innerHTML = state.step === LAST ? `${icon('check')} Create Class` : 'Next';
    renderSummary();
  }

  function renderSummary() {
    const parts = [];
    if (state.course) parts.push(['Course', state.course]);
    if (state.branch) parts.push(['Branch', state.branch]);
    if (state.semester) parts.push(['Semester', `Semester ${state.semester}`]);
    if (state.subjectName) parts.push(['Subject', state.subjectName]);
    $('#summary', el).innerHTML = parts.length
      ? parts.map(([k, v]) => `<div class="ws-item"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')
      : '<span class="text-muted">Your selections will appear here.</span>';
    $('#summary', el).style.display = parts.length ? 'flex' : 'none';
  }

  function renderSemesters() {
    const struct = SEMESTER_STRUCTURE[state.course];
    const area = $('#semesterArea', el);
    area.innerHTML = struct.years
      .map(
        (yr) => `
        <div class="year-group">
          <div class="yg-label">${yr.year}</div>
          <div class="chip-group">
            ${yr.semesters.map((s) => `<button type="button" class="chip ${state.semester === s ? 'selected' : ''}" data-sem="${s}">Semester ${s}</button>`).join('')}
          </div>
        </div>`
      )
      .join('');
    $$('[data-sem]', area).forEach((btn) =>
      btn.addEventListener('click', () => {
        state.semester = Number(btn.dataset.sem);
        // Semester changed -> subject must be re-chosen from the DB.
        state.subjectId = ''; state.subjectName = '';
        resetSubjectSelect('Select a semester first');
        $$('[data-sem]', area).forEach((b) => b.classList.toggle('selected', b === btn));
        renderSummary();
      })
    );
  }

  // Course chip selection — resets branch, semester and subject (cascade).
  $$('#courseChips .chip', el).forEach((chip) =>
    chip.addEventListener('click', () => {
      state.course = chip.dataset.course;
      state.branch = '';
      state.semester = null;
      state.subjectId = ''; state.subjectName = '';
      $$('#courseChips .chip', el).forEach((c) => c.classList.toggle('selected', c === chip));
      $$('#branchChips .chip', el).forEach((c) => c.classList.remove('selected'));
      resetSubjectSelect('Select a semester first');
      renderSummary();
    })
  );
  // Branch chip selection — resets semester and subject (cascade).
  $$('#branchChips .chip', el).forEach((chip) =>
    chip.addEventListener('click', () => {
      state.branch = chip.dataset.branch;
      state.semester = null;
      state.subjectId = ''; state.subjectName = '';
      $$('#branchChips .chip', el).forEach((c) => c.classList.toggle('selected', c === chip));
      resetSubjectSelect('Select a semester first');
      renderSummary();
    })
  );

  function resetSubjectSelect(placeholder) {
    const sel = $('#wzSubject', el);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.value = '';
    sel.disabled = true;
  }

  /** Load DB subjects for the current Course+Branch+Semester into the dropdown. */
  async function loadWizardSubjects() {
    const sel = $('#wzSubject', el);
    const hint = $('#wzSubjectHint', el);
    if (!sel) return;
    sel.disabled = true;
    sel.innerHTML = '<option value="">Loading subjects…</option>';
    const res = await getFacultySubjects({ program: state.course, branch: state.branch, semester: state.semester });
    if (!res.ok) {
      sel.innerHTML = '<option value="">Could not load subjects</option>';
      if (hint) hint.textContent = res.error || 'Failed to load subjects. Please try again.';
      return;
    }
    const subjects = res.subjects || [];
    if (!subjects.length) {
      sel.innerHTML = '<option value="">No subjects available</option>';
      if (hint) hint.textContent = 'No subjects configured for this Course, Branch and Semester. Ask an admin to add them.';
      return;
    }
    sel.innerHTML = '<option value="">Select a subject</option>' +
      subjects.map((s) => `<option value="${s.id}">${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''}</option>`).join('');
    sel.disabled = false;
    if (hint) hint.textContent = 'Subjects are configured by the admin for this Course, Branch and Semester.';
    sel.onchange = () => {
      state.subjectId = sel.value;
      state.subjectName = sel.value ? sel.options[sel.selectedIndex].textContent.replace(/\s*\(.*\)$/, '') : '';
      renderSummary();
    };
  }

  function goBack() {
    if (state.step > 1) { state.step -= 1; refresh(); }
  }

  async function goNext() {
    if (state.step === 1) {
      if (!state.course) return toastError('Please select a program.');
      state.step = 2; refresh(); return;
    }
    if (state.step === 2) {
      if (!state.branch) return toastError('Please select a branch.');
      state.step = 3; renderSemesters(); refresh(); return;
    }
    if (state.step === 3) {
      if (!state.semester) return toastError('Please select a semester.');
      state.step = 4; refresh();
      // Load the admin-configured subjects for this exact group from the DB.
      loadWizardSubjects();
      return;
    }
    // step 4 -> create. Subject MUST be chosen from the DB dropdown (no free text).
    state.description = ($('#wzDescription', el).value || '').trim();
    const errEl = $('#wzSubjectErr', el);
    if (errEl) errEl.textContent = '';
    if (!state.subjectId) {
      if (errEl) errEl.textContent = 'Please select a subject.';
      return;
    }
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<span class="spinner"></span> Creating…';
    // Real backend create. Server validates subjectId belongs to the group.
    const res = await createClass({
      subjectId: state.subjectId,
      program: state.course,
      branch: state.branch,
      semester: state.semester,
      title: state.subjectName,
      description: state.description,
    });
    if (!res.ok) {
      nextBtn.disabled = false;
      nextBtn.innerHTML = `${icon('check')} Create Class`;
      return toastError(res.error || 'Could not create class.');
    }
    toastSuccess(`Class created: ${state.subjectName} · ${state.branch} · Semester ${state.semester}`);
    close();
    await load();
  }

  refresh();
}

/* ------------------------------------------------------------------ */
/* Subjects Catalogue (REAL PostgreSQL data)                           */
/* Faculty picks Course + Branch + Semester and sees the subjects for  */
/* that exact combination. Subjects come from the backend, never mock. */
/* ------------------------------------------------------------------ */
function wireSubjectCatalogue() {
  const selCourse = $('#subjCourse');
  const selBranch = $('#subjBranch');
  const selSem = $('#subjSem');
  if (!selCourse || !selBranch || !selSem) return;

  function refreshSemesters() {
    const struct = SEMESTER_STRUCTURE[selCourse.value];
    const total = struct ? struct.totalSemesters : 8;
    const cur = Number(selSem.value) || 1;
    selSem.innerHTML = Array.from({ length: total }, (_, i) => `<option value="${i + 1}">Semester ${i + 1}</option>`).join('');
    selSem.value = String(Math.min(cur, total));
  }
  refreshSemesters();

  selCourse.addEventListener('change', () => { refreshSemesters(); loadSubjectCatalogue(); });
  selBranch.addEventListener('change', loadSubjectCatalogue);
  selSem.addEventListener('change', loadSubjectCatalogue);

  loadSubjectCatalogue();
}

async function loadSubjectCatalogue() {
  const host = $('#subjResult');
  if (!host) return;
  const program = $('#subjCourse').value;
  const branch = $('#subjBranch').value;
  const semester = Number($('#subjSem').value);
  host.innerHTML = skeletonCards(1);

  const res = await getFacultySubjects({ program, branch, semester });
  if (!res.ok) {
    host.innerHTML = `<div class="text-muted" style="text-align:center;padding:var(--sp-4)">
      ${icon('alert')} ${esc(res.error || 'Failed to load subjects. Please try again.')}
      <div style="margin-top:10px"><button class="btn btn-sm btn-primary" id="subjRetry">${icon('arrowRight')} Retry</button></div>
    </div>`;
    host.querySelector('#subjRetry')?.addEventListener('click', loadSubjectCatalogue);
    return;
  }
  const subjects = res.subjects || [];
  const label = `${esc(program)} • ${esc(branch)} • Semester ${esc(String(semester))}`;
  if (!subjects.length) {
    host.innerHTML = `<div class="text-muted">${label}<br>No subjects found for this Course, Branch and Semester.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="text-muted" style="margin-bottom:10px">${label}</div>
    <div class="class-grid">${subjects.map(subjectCatalogueCard).join('')}</div>`;
}

function subjectCatalogueCard(s) {
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
