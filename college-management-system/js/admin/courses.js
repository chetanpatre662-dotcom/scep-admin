/**
 * admin/courses.js — Academic Structure (file-manager-style explorer).
 * -----------------------------------------------------------------------------
 * Hierarchy, all backed by PostgreSQL (no hardcoded arrays):
 *   Level 1  Courses     (course_catalog)         -> Add Course
 *   Level 2  Branches    (branches by course)     -> Add Branch
 *   Level 3  Semesters   (1..course.totalSemesters)
 *   Level 4  Subjects    (courses table by group) -> Add Subjects (bulk), Edit, Delete
 *
 * Navigation: breadcrumbs + Back. Folder cards show item counts. Uses the
 * existing project card/button/typography classes — the change is information
 * architecture, not a new visual language.
 * -----------------------------------------------------------------------------
 */
import { $, $$, esc } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { validateForm, rules, clearErrors } from '../common/validation.js';
import { bootstrapAdmin } from './nav.js';
import {
  getCourses, createCourse, getBranches, createBranch,
  listSubjects, createSubjectsBulk, updateSubject, deleteSubject,
} from '../services/adminService.js';

// Explorer state: which level we're at + the current selection.
const nav = { level: 1, course: null, branch: null, semester: null };
let mainEl = null;

bootstrapAdmin({ activeId: 'courses', title: 'Academic Structure' }).then((ctx) => { if (ctx) init(ctx); });

function init({ main }) {
  mainEl = main;
  renderShell();
  goCourses();
}

function renderShell() {
  mainEl.innerHTML = `
    <div class="af-explorer">
      <div class="page-head">
        <div>
          <h1 class="page-title">Academic Structure</h1>
          <p class="page-subtitle">Browse and manage Courses, Branches, Semesters and Subjects.</p>
        </div>
        <div id="headActions" class="af-actions"></div>
      </div>
      <div id="breadcrumbs" class="af-breadcrumbs"></div>
      <div id="explorer">${skeletonGrid(4)}</div>
    </div>
  `;
}

/* ---- breadcrumbs + header actions ---- */
function renderBreadcrumbs() {
  const crumbs = [{ label: 'Home', go: goCourses }];
  if (nav.course) crumbs.push({ label: nav.course.name, go: () => goBranches(nav.course) });
  if (nav.branch) crumbs.push({ label: nav.branch.name, go: () => goSemesters(nav.course, nav.branch) });
  if (nav.semester) crumbs.push({ label: `Semester ${nav.semester}`, go: null });

  const host = $('#breadcrumbs');
  host.innerHTML = crumbs
    .map((c, i) => {
      const last = i === crumbs.length - 1;
      const sep = i > 0 ? `<span class="af-sep">${icon('chevronRight')}</span>` : '';
      if (last || !c.go) return `${sep}<span class="af-crumb current">${esc(c.label)}</span>`;
      return `${sep}<a href="#" class="af-crumb" data-crumb="${i}">${esc(c.label)}</a>`;
    })
    .join('');
  $$('[data-crumb]', host).forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); crumbs[Number(a.dataset.crumb)].go?.(); })
  );
}

function setHeadActions(html) {
  const host = $('#headActions');
  if (host) host.innerHTML = html;
}

/* ---------------- card builders (Google Classroom / LMS style) ------------- */

/**
 * A drill-down folder card (Course / Branch / Semester).
 * @param {object} o { theme, iconName, title, titleSub, chips[], dataAttr, menu }
 *   chips: array of {icon?, label}
 *   menu:  optional array of {label, icon, cls, action} for the ⋮ dropdown
 */
function folderCard(o) {
  const chips = (o.chips || [])
    .map((ch) => `<span class="af-chip">${ch.icon ? icon(ch.icon) : ''}${esc(ch.label)}</span>`)
    .join('');
  return `
    <div class="af-card is-folder" role="button" tabindex="0" ${o.dataAttr || ''}>
      <div class="af-card-banner af-banner-${o.theme}">
        <span class="af-ico">${icon(o.iconName)}</span>
        <div>
          <div class="af-title">${esc(o.title)}</div>
          ${o.titleSub ? `<div class="af-title-sub">${esc(o.titleSub)}</div>` : ''}
        </div>
      </div>
      <div class="af-card-body">${chips}</div>
      <div class="af-card-foot">
        <span class="af-open-hint">Open ${icon('arrowRight')}</span>
        ${o.menuHTML || ''}
      </div>
    </div>`;
}

/** Subject (leaf) card with Edit/Delete action strip. */
function subjectCard(s) {
  const chips = [
    s.code ? `<span class="af-chip">${icon('file')}${esc(s.code)}</span>` : '',
    `<span class="af-chip">Semester ${esc(String(s.semester))}</span>`,
  ].join('');
  return `
    <div class="af-card is-subject">
      <div class="af-card-banner af-banner-subject">
        <span class="af-ico">${icon('file')}</span>
        <div><div class="af-title">${esc(s.name)}</div></div>
      </div>
      <div class="af-card-body">
        ${chips}
        ${s.description ? `<div class="af-card-desc">${esc(s.description)}</div>` : ''}
      </div>
      <div class="af-card-foot">
        <span class="af-open-hint" style="color:var(--gray-400);font-weight:500">Subject</span>
        <div class="af-foot-actions">
          <button class="af-iconbtn edit" data-edit="${s.id}" title="Edit" aria-label="Edit subject">${icon('edit')}</button>
          <button class="af-iconbtn delete" data-del="${s.id}" title="Delete" aria-label="Delete subject">${icon('trash')}</button>
        </div>
      </div>
    </div>`;
}

/* ---------------- shared state renderers ---------------- */

function skeletonGrid(n = 4) {
  const card = `
    <div class="af-skel">
      <div class="af-skel-banner af-shimmer"></div>
      <div class="af-skel-body">
        <span class="af-skel-chip af-shimmer"></span>
        <span class="af-skel-chip af-shimmer"></span>
      </div>
      <div class="af-skel-foot af-shimmer"></div>
    </div>`;
  return `<div class="af-grid">${Array.from({ length: n }, () => card).join('')}</div>`;
}

function emptyBlock({ iconName, title, message, ctaLabel, ctaId }) {
  return `
    <div class="af-grid"><div class="af-empty">
      <div class="af-empty-ico">${icon(iconName)}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      ${ctaLabel ? `<button class="btn btn-primary" id="${ctaId}">${icon('plus')} ${esc(ctaLabel)}</button>` : ''}
    </div></div>`;
}

function errorState(message, retryFn) {
  const host = $('#explorer');
  host.innerHTML = `
    <div class="af-grid"><div class="af-error">
      <div class="af-error-ico">${icon('alert')}</div>
      <p>${esc(message)}</p>
      <button class="btn btn-primary" id="retryBtn">${icon('arrowRight')} Retry</button>
    </div></div>`;
  host.querySelector('#retryBtn')?.addEventListener('click', retryFn);
}

/* ================= LEVEL 1 — COURSES ================= */
async function goCourses() {
  nav.level = 1; nav.course = null; nav.branch = null; nav.semester = null;
  renderBreadcrumbs();
  setHeadActions(`<button class="btn btn-primary" id="addCourseBtn">${icon('plus')} Add Course</button>`);
  $('#addCourseBtn').addEventListener('click', openAddCourse);
  const host = $('#explorer');
  host.innerHTML = skeletonGrid(4);

  const res = await getCourses();
  if (!res.ok) return errorState(res.error || 'Failed to load data. Please try again.', goCourses);
  const courses = res.courses || [];
  if (!courses.length) {
    host.innerHTML = emptyBlock({
      iconName: 'book', title: 'No courses yet',
      message: 'Create your first course (e.g. B.Tech, BCA, M.Tech) to start building the academic structure.',
      ctaLabel: 'Add First Course', ctaId: 'emptyAddCourse',
    });
    host.querySelector('#emptyAddCourse')?.addEventListener('click', openAddCourse);
    return;
  }
  host.innerHTML = `<div class="af-grid">${courses.map((c) => {
    const n = c.branchCount ?? 0;
    return folderCard({
      theme: 'course', iconName: 'folder', title: c.name,
      chips: [
        { icon: 'layers', label: `${n} Branch${n === 1 ? '' : 'es'}` },
        { label: `${c.totalSemesters} Semesters` },
        ...(c.code ? [{ icon: 'file', label: c.code }] : []),
      ],
      dataAttr: `data-course="${c.id}"`,
    });
  }).join('')}</div>`;
  $$('[data-course]', host).forEach((card) => {
    const c = courses.find((x) => String(x.id) === card.dataset.course);
    const open = () => goBranches(c);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function openAddCourse() {
  const { close, el } = openModal({
    title: 'Add course',
    body: `
      <form id="courseForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="name">Course name <span class="req">*</span></label>
          <input class="input" id="name" name="name" placeholder="e.g. M.Tech, BCA, Diploma" />
          <div class="field-error"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="totalSemesters">Total semesters</label>
          <input class="input" id="totalSemesters" name="totalSemesters" type="number" min="1" max="12" value="8" />
        </div>
      </form>`,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: 'Add course', class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });
  const form = $('#courseForm', el);
  async function submit() {
    clearErrors(form);
    if (!validateForm(form, { name: [rules.required] })) return;
    const res = await createCourse({
      name: form.elements['name'].value.trim(),
      totalSemesters: Number(form.elements['totalSemesters'].value) || 8,
    });
    if (!res.ok) return toastError(res.error || 'Could not add course.');
    toastSuccess('Course added.');
    close();
    goCourses();
  }
}

/* ================= LEVEL 2 — BRANCHES ================= */
async function goBranches(course) {
  nav.level = 2; nav.course = course; nav.branch = null; nav.semester = null;
  renderBreadcrumbs();
  setHeadActions(`
    <button class="btn btn-ghost" id="backBtn">${icon('arrowLeft')} Back</button>
    <button class="btn btn-primary" id="addBranchBtn">${icon('plus')} Add Branch</button>`);
  $('#backBtn').addEventListener('click', goCourses);
  $('#addBranchBtn').addEventListener('click', () => openAddBranch(course));
  const host = $('#explorer');
  host.innerHTML = skeletonGrid(4);

  const res = await getBranches(course.id);
  if (!res.ok) return errorState(res.error || 'Failed to load data. Please try again.', () => goBranches(course));
  const branches = res.branches || [];
  if (!branches.length) {
    host.innerHTML = emptyBlock({
      iconName: 'layers', title: 'No branches yet',
      message: `Add the first branch under ${course.name} (e.g. Computer Science, Information Technology).`,
      ctaLabel: 'Add First Branch', ctaId: 'emptyAddBranch',
    });
    host.querySelector('#emptyAddBranch')?.addEventListener('click', () => openAddBranch(course));
    return;
  }
  host.innerHTML = `<div class="af-grid">${branches.map((b) =>
    folderCard({
      theme: 'branch', iconName: 'folder', title: b.name, titleSub: course.name,
      chips: [{ label: `${course.totalSemesters} Semesters` }],
      dataAttr: `data-branch="${b.id}"`,
    })
  ).join('')}</div>`;
  $$('[data-branch]', host).forEach((card) => {
    const b = branches.find((x) => String(x.id) === card.dataset.branch);
    const open = () => goSemesters(course, b);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function openAddBranch(course) {
  const { close, el } = openModal({
    title: `Add branch to ${course.name}`,
    body: `
      <form id="branchForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="name">Branch name <span class="req">*</span></label>
          <input class="input" id="name" name="name" placeholder="e.g. Information Technology, AI & Data Science" />
          <div class="field-error"></div>
        </div>
      </form>`,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: 'Add branch', class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });
  const form = $('#branchForm', el);
  async function submit() {
    clearErrors(form);
    if (!validateForm(form, { name: [rules.required] })) return;
    const res = await createBranch(course.id, { name: form.elements['name'].value.trim() });
    if (!res.ok) return toastError(res.error || 'Could not add branch.');
    toastSuccess('Branch added.');
    close();
    goBranches(course);
  }
}

/* ================= LEVEL 3 — SEMESTERS ================= */
function goSemesters(course, branch) {
  nav.level = 3; nav.course = course; nav.branch = branch; nav.semester = null;
  renderBreadcrumbs();
  setHeadActions(`<button class="btn btn-ghost" id="backBtn">${icon('arrowLeft')} Back</button>`);
  $('#backBtn').addEventListener('click', () => goBranches(course));
  const host = $('#explorer');
  const total = course.totalSemesters || 8;
  const sems = Array.from({ length: total }, (_, i) => i + 1);
  host.innerHTML = `<div class="af-grid">${sems.map((s) =>
    folderCard({
      theme: 'sem', iconName: 'folder', title: `Semester ${s}`, titleSub: `${course.name} · ${branch.name}`,
      chips: [{ icon: 'file', label: 'Subjects' }],
      dataAttr: `data-sem="${s}"`,
    })
  ).join('')}</div>`;
  $$('[data-sem]', host).forEach((card) => {
    const s = Number(card.dataset.sem);
    const open = () => goSubjects(course, branch, s);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

/* ================= LEVEL 4 — SUBJECTS ================= */
async function goSubjects(course, branch, semester) {
  nav.level = 4; nav.course = course; nav.branch = branch; nav.semester = semester;
  renderBreadcrumbs();
  setHeadActions(`
    <button class="btn btn-ghost" id="backBtn">${icon('arrowLeft')} Back</button>
    <button class="btn btn-primary" id="addSubjectsBtn">${icon('plus')} Add Subjects</button>`);
  $('#backBtn').addEventListener('click', () => goSemesters(course, branch));
  $('#addSubjectsBtn').addEventListener('click', () => openBulkSubjects(course, branch, semester));
  await loadSubjects();
}

async function loadSubjects() {
  const { course, branch, semester } = nav;
  const host = $('#explorer');
  host.innerHTML = skeletonGrid(4);
  const res = await listSubjects({ program: course.name, branch: branch.name, semester });
  if (!res.ok) return errorState(res.error || 'Failed to load data. Please try again.', loadSubjects);
  const subjects = res.subjects || [];
  if (!subjects.length) {
    host.innerHTML = emptyBlock({
      iconName: 'book', title: 'No subjects yet',
      message: `Add subjects for ${course.name} · ${branch.name} · Semester ${semester}. You can add several at once.`,
      ctaLabel: 'Add First Subject', ctaId: 'emptyAddSubject',
    });
    host.querySelector('#emptyAddSubject')?.addEventListener('click', () => openBulkSubjects(course, branch, semester));
    return;
  }
  host.innerHTML = `<div class="af-grid">${subjects.map(subjectCard).join('')}</div>`;
  $$('[data-edit]', host).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openEditSubject(subjects.find((s) => String(s.id) === b.dataset.edit)); }));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); onDeleteSubject(subjects.find((s) => String(s.id) === b.dataset.del)); }));
}

/* ---- Bulk add subjects (one Course+Branch+Semester) ---- */
function openBulkSubjects(course, branch, semester) {
  const rowHTML = (i) => `
    <div class="form-group af-subj-row" data-row>
      <div class="input-group">
        <input class="input" name="subject" placeholder="Subject ${i}" />
        <button type="button" class="btn-icon" data-removerow title="Remove">${icon('x')}</button>
      </div>
    </div>`;

  const { close, el } = openModal({
    title: `Add subjects · ${course.name} → ${branch.name} → Semester ${semester}`,
    body: `
      <form id="bulkForm" novalidate>
        <p class="text-muted" style="font-size:var(--fs-sm);margin-bottom:10px">
          Add one or more subjects. They will all be created for
          <strong>${esc(course.name)} → ${esc(branch.name)} → Semester ${esc(String(semester))}</strong>
          in a single operation.
        </p>
        <div id="rows">${[1, 2, 3].map(rowHTML).join('')}</div>
        <button type="button" class="btn btn-sm btn-ghost" id="addRowBtn">${icon('plus')} Add another subject</button>
        <div class="field-error" id="bulkErr" style="margin-top:8px"></div>
      </form>`,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: 'Save All Subjects', class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });

  const rowsHost = $('#rows', el);
  let count = 3;
  $('#addRowBtn', el).addEventListener('click', () => {
    count += 1;
    rowsHost.insertAdjacentHTML('beforeend', rowHTML(count));
    wireRemovers();
  });
  function wireRemovers() {
    $$('[data-removerow]', rowsHost).forEach((b) => {
      b.onclick = () => { if ($$('[data-row]', rowsHost).length > 1) b.closest('[data-row]').remove(); };
    });
  }
  wireRemovers();

  async function submit() {
    const names = $$('input[name="subject"]', el).map((i) => i.value.trim()).filter(Boolean);
    const errEl = $('#bulkErr', el);
    errEl.textContent = '';
    if (!names.length) { errEl.textContent = 'Enter at least one subject name.'; return; }

    const res = await createSubjectsBulk({ program: course.name, branch: branch.name, semester, subjects: names });
    if (!res.ok) { errEl.textContent = res.error || 'Could not add subjects.'; return; }
    toastSuccess(res.message || `Added ${res.created.length} subject(s).`);
    close();
    // Remain in the same semester and refresh the subject list.
    await loadSubjects();
  }
}

function openEditSubject(s) {
  if (!s) return;
  const { close, el } = openModal({
    title: 'Edit subject',
    body: `
      <form id="editForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="name">Subject name <span class="req">*</span></label>
          <input class="input" id="name" name="name" value="${esc(s.name)}" />
          <div class="field-error"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="code">Subject code <span class="text-muted">(optional)</span></label>
          <input class="input" id="code" name="code" value="${esc(s.code || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="description">Description <span class="text-muted">(optional)</span></label>
          <input class="input" id="description" name="description" value="${esc(s.description || '')}" />
        </div>
      </form>`,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: 'Update', class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });
  const form = $('#editForm', el);
  async function submit() {
    clearErrors(form);
    if (!validateForm(form, { name: [rules.required] })) return;
    const res = await updateSubject(s.id, {
      name: form.elements['name'].value.trim(),
      code: form.elements['code'].value.trim() || undefined,
      description: form.elements['description'].value.trim() || undefined,
    });
    if (!res.ok) return toastError(res.error || 'Could not update subject.');
    toastSuccess('Subject updated.');
    close();
    await loadSubjects();
  }
}

async function onDeleteSubject(s) {
  if (!s) return;
  const ok = await confirmDialog({
    title: 'Delete subject?',
    message: `"${s.name}" will be permanently removed from ${nav.course.name} → ${nav.branch.name} → Semester ${nav.semester}.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  const res = await deleteSubject(s.id);
  if (!res.ok) return toastError(res.error || 'Could not delete subject.');
  toastSuccess('Subject deleted.');
  await loadSubjects();
}
