/**
 * profilePage.js — Shared "My Profile" view + edit + save (all roles).
 * -----------------------------------------------------------------------------
 * Loads the current user's profile from GET /api/profile/me and renders a
 * read-only view. "Edit" reveals editable fields; "Save" PATCHes /profile/me
 * (backend derives identity from the token — a user can only edit themselves).
 *
 * Role-specific editable fields:
 *   - student: full name, mobile (+91/10-digit), course, branch, semester, roll no.
 *   - faculty: full name, mobile, department, designation.
 *   - admin (no faculty/student profile): display name, mobile.
 * Email and role/status are shown read-only (not editable).
 *
 * After Save, the view re-renders from the server response, so a refresh shows
 * the persisted data (no local-only state).
 * -----------------------------------------------------------------------------
 */
import {
  BRANCHES, DEPARTMENTS, DESIGNATIONS, COURSE_TYPES,
  yearsForProgram, semestersForYear,
} from '../config.js';
import { $, esc } from './dom.js';
import { icon } from './icons.js';
import { toastSuccess, toastError } from './toast.js';
import { loadingState, emptyState } from './components.js';
import { validateForm, rules, clearErrors, setFieldError } from './validation.js';
import { phoneFieldHTML, wirePhoneInputs, phoneForSubmit } from './phoneInput.js';
import { getMyProfile, updateMyProfile } from '../services/profileApiService.js';

/**
 * Render the profile page into `main`.
 * @param {HTMLElement} main
 */
export async function renderProfilePage(main) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Profile</h1>
        <p class="page-subtitle">View and update your account information.</p>
      </div>
    </div>
    <div id="profileArea">${loadingState('Loading your profile…')}</div>
  `;
  await load(main);
}

async function load(main) {
  const area = $('#profileArea', main);
  area.innerHTML = loadingState('Loading your profile…');
  const res = await getMyProfile();
  if (!res.ok || !res.profile) {
    area.innerHTML = errorHTML(res.error || 'Could not load your profile.');
    area.querySelector('#retryBtn')?.addEventListener('click', () => load(main));
    return;
  }
  renderView(main, res.profile);
}

/* ---------------- helpers to derive the editable "kind" ---------------- */

function kindOf(p) {
  if (p.student) return 'student';
  if (p.faculty) return 'faculty';
  return 'basic'; // admin / bare user
}

function displayName(p) {
  if (p.student) return p.student.fullName;
  if (p.faculty) return p.faculty.fullName;
  return p.displayName || (p.email ? p.email.split('@')[0] : 'User');
}

function roleBadge(p) {
  const label = (p.role || 'user').replace(/^./, (c) => c.toUpperCase());
  return `<span class="badge badge-brand">${esc(label)}</span>`;
}

/* ---------------- VIEW MODE ---------------- */

function renderView(main, p) {
  const area = $('#profileArea', main);
  const kind = kindOf(p);
  const rows = [];
  rows.push(field('Name', displayName(p)));
  rows.push(field('Email', p.email || '—'));
  rows.push(field('Role', (p.role || '—').replace(/^./, (c) => c.toUpperCase())));

  if (kind === 'student') {
    const s = p.student;
    rows.push(field('Roll number', s.rollNumber || '—'));
    rows.push(field('Mobile', s.mobileNumber ? `+91 ${esc(s.mobileNumber)}` : '—'));
    rows.push(field('Course', s.program || '—'));
    rows.push(field('Branch', s.branch || '—'));
    rows.push(field('Semester', s.semester != null ? String(s.semester) : '—'));
  } else if (kind === 'faculty') {
    const f = p.faculty;
    rows.push(field('Mobile', f.mobileNumber ? `+91 ${esc(f.mobileNumber)}` : '—'));
    rows.push(field('Department', f.department || '—'));
    rows.push(field('Designation', f.designation || '—'));
    rows.push(field('Employee ID', f.employeeId || 'Not assigned'));
  } else {
    rows.push(field('Mobile', p.phone ? `+91 ${esc(p.phone)}` : '—'));
  }

  area.innerHTML = `
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
        <span class="card-title">Account details ${roleBadge(p)}</span>
        <button class="btn btn-primary btn-sm" id="editBtn">${icon('edit')} Edit profile</button>
      </div>
      <div class="card-body">
        <div class="profile-grid" style="display:grid;grid-template-columns:1fr;gap:12px;max-width:560px">
          ${rows.join('')}
        </div>
      </div>
    </div>
  `;
  area.querySelector('#editBtn').addEventListener('click', () => renderEdit(main, p));
}

function field(label, value) {
  return `
    <div class="profile-row" style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--border,#e5e7eb)">
      <span class="text-muted" style="font-weight:500">${esc(label)}</span>
      <span style="font-weight:600;text-align:right">${esc(String(value))}</span>
    </div>`;
}

/* ---------------- EDIT MODE ---------------- */

function renderEdit(main, p) {
  const area = $('#profileArea', main);
  const kind = kindOf(p);

  let fieldsHTML = '';
  if (kind === 'student') {
    const s = p.student;
    const courseOpts = [COURSE_TYPES.BTECH, COURSE_TYPES.POLYTECHNIC]
      .map((c) => `<option value="${esc(c)}"${c === s.program ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const branchOpts = BRANCHES.map((b) => `<option value="${esc(b)}"${b === s.branch ? ' selected' : ''}>${esc(b)}</option>`).join('');
    fieldsHTML = `
      ${textField('name', 'Full name', s.fullName)}
      ${textField('rollNumber', 'Roll number', s.rollNumber)}
      ${phoneFieldHTML({ id: 'mobileNumber', label: 'Mobile number', required: true, value: s.mobileNumber || '' })}
      <div class="form-group"><label class="form-label" for="program">Course <span class="req">*</span></label>
        <select class="input" id="program" name="program"><option value="">Select course</option>${courseOpts}</select>
        <div class="field-error"></div></div>
      <div class="form-group"><label class="form-label" for="branch">Branch <span class="req">*</span></label>
        <select class="input" id="branch" name="branch"><option value="">Select branch</option>${branchOpts}</select>
        <div class="field-error"></div></div>
      <div class="form-group"><label class="form-label" for="semester">Semester <span class="req">*</span></label>
        <select class="input" id="semester" name="semester"></select>
        <div class="field-error"></div></div>
    `;
  } else if (kind === 'faculty') {
    const f = p.faculty;
    const deptOpts = DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === f.department ? ' selected' : ''}>${esc(d)}</option>`).join('');
    const desigOpts = DESIGNATIONS.map((d) => `<option value="${esc(d)}"${d === f.designation ? ' selected' : ''}>${esc(d)}</option>`).join('');
    fieldsHTML = `
      ${textField('name', 'Full name', f.fullName)}
      ${phoneFieldHTML({ id: 'mobileNumber', label: 'Mobile number', required: true, value: f.mobileNumber || '' })}
      <div class="form-group"><label class="form-label" for="department">Department <span class="req">*</span></label>
        <select class="input" id="department" name="department"><option value="">Select department</option>${deptOpts}</select>
        <div class="field-error"></div></div>
      <div class="form-group"><label class="form-label" for="designation">Designation <span class="req">*</span></label>
        <select class="input" id="designation" name="designation"><option value="">Select designation</option>${desigOpts}</select>
        <div class="field-error"></div></div>
    `;
  } else {
    fieldsHTML = `
      ${textField('name', 'Display name', displayName(p))}
      ${phoneFieldHTML({ id: 'mobileNumber', label: 'Mobile number', required: true, value: p.phone || '' })}
    `;
  }

  area.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-title">Edit profile</span></div>
      <div class="card-body">
        <form id="profileForm" novalidate style="max-width:560px">
          <div class="form-group"><label class="form-label">Email</label>
            <input class="input" value="${esc(p.email || '')}" readonly disabled />
            <div class="text-muted" style="font-size:var(--fs-xs);margin-top:4px">Email is linked to your login and cannot be changed here.</div>
          </div>
          ${fieldsHTML}
          <div class="flex gap-2" style="margin-top:16px">
            <button type="submit" class="btn btn-primary" id="saveBtn">${icon('check')} Save changes</button>
            <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = $('#profileForm', area);
  wirePhoneInputs(area);

  // Student: wire dependent semester dropdown off the selected course.
  if (kind === 'student') {
    const programSel = form.elements['program'];
    const semSel = form.elements['semester'];
    const fillSemesters = (selected) => {
      const program = programSel.value;
      const max = program === COURSE_TYPES.POLYTECHNIC ? 6 : 8;
      let opts = '<option value="">Select semester</option>';
      for (let i = 1; i <= max; i++) opts += `<option value="${i}"${Number(selected) === i ? ' selected' : ''}>Semester ${i}</option>`;
      semSel.innerHTML = opts;
    };
    fillSemesters(p.student.semester);
    programSel.addEventListener('change', () => fillSemesters(''));
  }

  area.querySelector('#cancelBtn').addEventListener('click', () => renderView(main, p));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(main, p, form); });
}

function textField(id, label, value) {
  return `
    <div class="form-group">
      <label class="form-label" for="${id}">${esc(label)} <span class="req">*</span></label>
      <input class="input" id="${id}" name="${id}" type="text" value="${esc(value || '')}" />
      <div class="field-error"></div>
    </div>`;
}

async function save(main, p, form) {
  clearErrors(form);
  const kind = kindOf(p);

  // Validate per role.
  let schema = { name: [rules.required], mobileNumber: [rules.required, rules.mobileIN] };
  if (kind === 'student') {
    schema = {
      name: [rules.required],
      rollNumber: [rules.required],
      mobileNumber: [rules.required, rules.mobileIN],
      program: [rules.selected],
      branch: [rules.selected],
      semester: [rules.selected],
    };
  } else if (kind === 'faculty') {
    schema = {
      name: [rules.required],
      mobileNumber: [rules.required, rules.mobileIN],
      department: [rules.selected],
      designation: [rules.selected],
    };
  }
  if (!validateForm(form, schema)) return;

  // Build role-appropriate payload (backend ignores fields it doesn't allow).
  const mobileNumber = phoneForSubmit(form.elements['mobileNumber'].value);
  let payload;
  if (kind === 'student') {
    payload = {
      fullName: form.elements['name'].value.trim(),
      rollNumber: form.elements['rollNumber'].value.trim(),
      mobileNumber,
      program: form.elements['program'].value,
      branch: form.elements['branch'].value,
      semester: Number(form.elements['semester'].value),
    };
  } else if (kind === 'faculty') {
    payload = {
      fullName: form.elements['name'].value.trim(),
      mobileNumber,
      department: form.elements['department'].value,
      designation: form.elements['designation'].value,
    };
  } else {
    payload = { displayName: form.elements['name'].value.trim(), mobileNumber };
  }

  const saveBtn = $('#saveBtn', form);
  const orig = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span> Saving…`;

  const res = await updateMyProfile(payload);

  saveBtn.disabled = false;
  saveBtn.innerHTML = orig;

  if (!res.ok) {
    if (/roll/i.test(res.error || '')) setFieldError(form.elements['rollNumber'], res.error);
    return toastError(res.error || 'Could not save your profile.');
  }
  toastSuccess('Profile updated.');
  renderView(main, res.profile); // re-render from server (persisted) data
}

function errorHTML(message) {
  return `
    <div class="card"><div class="card-body" style="text-align:center;padding:24px">
      <div class="text-muted" style="margin-bottom:12px">${icon('alert')} ${esc(message)}</div>
      <button class="btn btn-primary" id="retryBtn">${icon('arrowRight')} Retry</button>
    </div></div>`;
}
