/**
 * registerPage.js — Shared registration controller (Firebase Auth + backend
 * profile completion).
 * -----------------------------------------------------------------------------
 * Flow (both Student and Faculty portals):
 *   1. Base account fields: Full Name, Email, Password, Confirm (password only
 *      for email/password signup).
 *   2. Role-specific PROFILE fields are injected into #profileFields:
 *        Student: Roll Number, Mobile, Course, Year, Semester (Year→Semester
 *                 depends on Course; B.Tech max 8, Polytechnic max 6).
 *        Faculty: Mobile, Department, Designation.
 *   3. Email/password: create Firebase account → sync → save profile → route.
 *   4. Google: authenticate → sync → if profile incomplete, switch the form
 *      into a "complete your profile" step (password fields hidden, name/email
 *      prefilled from Google) → save profile → route.
 *
 * SECURITY: the portal's `role` is only a UX hint. The backend owns the role.
 *   - Students land on the student dashboard (DB role 'student').
 *   - Faculty save their profile but the role stays 'student' until an admin
 *     promotes them; they are routed to a "Faculty approval pending" state,
 *     NOT the student dashboard.
 * -----------------------------------------------------------------------------
 */
import {
  resolvePath,
  ROUTES,
  ROLES,
  COURSE_TYPES,
  BRANCHES,
  DEPARTMENTS,
  DESIGNATIONS,
  yearsForProgram,
  semestersForYear,
} from '../config.js';
import { $, esc } from './dom.js';
import { icon } from './icons.js';
import { toastSuccess, toastError, toastInfo } from './toast.js';
import { validateForm, rules, clearErrors, setFieldError } from './validation.js';
import { phoneFieldHTML, wirePhoneInputs, phoneForSubmit } from './phoneInput.js';
import {
  registerWithEmail,
  loginWithGoogle,
  saveStudentProfile,
  saveFacultyProfile,
  isFirebaseConfigured,
} from '../services/authService.js';

/**
 * @param {object} cfg
 * @param {string} cfg.role 'faculty' | 'student' (UX hint only)
 * @param {string} cfg.dashboardUrl root-relative dashboard path
 */
export function initRegisterPage(cfg) {
  const form = $('#registerForm');
  if (!form) return;

  const isStudent = cfg.role === ROLES.STUDENT;

  if (!isFirebaseConfigured()) {
    toastInfo('Firebase is not configured yet. Add your config in js/firebase/firebase-config.js.', 6000);
  }

  // Inject role-specific profile fields into the placeholder container.
  const profileHost = $('#profileFields');
  if (profileHost) {
    profileHost.innerHTML = isStudent ? studentFieldsHTML() : facultyFieldsHTML();
    if (isStudent) wireStudentDependentDropdowns(form);
    // Wire the fixed-+91 phone input behavior (numeric-only, max 10, paste-normalize).
    wirePhoneInputs(profileHost);
  }

  // Password visibility toggles.
  wireToggle('#togglePw', form.elements['password']);
  wireToggle('#toggleConfirm', form.elements['confirm']);

  const submitBtn = $('#submitBtn');
  const googleBtn = $('#googleBtn');

  // ---- Email/password registration ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);

    // If we're in Google "complete profile" mode, password isn't required.
    const profileOnly = form.dataset.mode === 'complete-profile';

    const baseSchema = profileOnly
      ? { name: [rules.required], email: [rules.required, rules.email] }
      : {
          name: [rules.required],
          email: [rules.required, rules.email],
          password: [rules.required, rules.minLen(6)],
          confirm: [rules.required],
        };

    let ok = validateForm(form, baseSchema);
    ok = validateProfileFields(form, isStudent) && ok;

    if (!profileOnly) {
      const password = form.elements['password'].value;
      const confirm = form.elements['confirm'].value;
      if (ok && password !== confirm) {
        setFieldError(form.elements['confirm'], 'Passwords do not match.');
        ok = false;
      }
    }
    if (!ok) return;

    const restore = setLoading(submitBtn, profileOnly ? 'Saving…' : 'Creating account…');
    if (googleBtn) googleBtn.disabled = true;

    // Path A: Google user completing their profile (already authenticated).
    if (profileOnly) {
      const done = await submitProfile(form, isStudent, cfg);
      if (!done) { restore(); if (googleBtn) googleBtn.disabled = false; }
      return;
    }

    // Path B: brand-new email/password account.
    const result = await registerWithEmail({
      name: form.elements['name'].value,
      email: form.elements['email'].value,
      password: form.elements['password'].value,
      remember: true,
      role: cfg.role,
    });

    if (!result.ok) {
      restore();
      if (googleBtn) googleBtn.disabled = false;
      toastError(result.error || 'Registration failed.');
      return;
    }

    // Account created + backend-synced; now persist the profile, then route.
    const done = await submitProfile(form, isStudent, cfg);
    if (!done) { restore(); if (googleBtn) googleBtn.disabled = false; }
  });

  // ---- Google sign-up ----
  googleBtn?.addEventListener('click', async () => {
    clearErrors(form);
    const restore = setLoading(googleBtn, 'Connecting…');
    submitBtn.disabled = true;

    const result = await loginWithGoogle({ remember: true, role: cfg.role });
    if (!result.ok) {
      restore();
      submitBtn.disabled = false;
      toastError(result.error || 'Google sign-in failed.');
      return;
    }

    // Google authenticated + backend-synced. The account is a bare 'student'
    // with NO role/faculty profile yet, so require profile completion before
    // any dashboard access — never send an incomplete account to a dashboard.
    restore();
    submitBtn.disabled = false;
    enterProfileCompletionMode(form, result, isStudent);
    toastInfo('Almost there — please complete your profile to continue.', 5000);
  });
}

/* ------------------------------------------------------------------ */
/* Profile submission + routing                                        */
/* ------------------------------------------------------------------ */

/**
 * Read + save the role-specific profile to the backend, then route.
 * @returns {Promise<boolean>} true if saved+routed, false on error (caller
 *   should restore the button state).
 */
async function submitProfile(form, isStudent, cfg) {
  if (isStudent) {
    const data = {
      fullName: form.elements['name'].value.trim(),
      rollNumber: form.elements['rollNumber'].value.trim(),
      mobileNumber: phoneForSubmit(form.elements['mobileNumber'].value),
      program: form.elements['program'].value,
      branch: form.elements['branch'].value,
      semester: Number(form.elements['semester'].value),
    };
    const res = await saveStudentProfile(data);
    if (!res.ok) {
      // Surface roll-number/other server validation on the relevant field.
      if (/roll/i.test(res.error || '')) setFieldError(form.elements['rollNumber'], res.error);
      toastError(res.error || 'Could not save profile.');
      return false;
    }
    toastSuccess('Profile saved. Welcome!');
    redirect(ROUTES.STUDENT.DASHBOARD);
    return true;
  }

  // Faculty: save profile, then route to the "approval pending" state — NOT the
  // student dashboard, even though the DB role is currently 'student'.
  const data = {
    fullName: form.elements['name'].value.trim(),
    mobileNumber: phoneForSubmit(form.elements['mobileNumber'].value),
    department: form.elements['department'].value,
    designation: form.elements['designation'].value,
  };
  const res = await saveFacultyProfile(data);
  if (!res.ok) {
    toastError(res.error || 'Could not save profile.');
    return false;
  }
  showFacultyPending(form);
  return true;
}

/**
 * Switch the form into "complete your profile" mode for a Google user:
 * hide password fields, prefill name/email from the Google identity, and make
 * email/name read-only so the user doesn't re-enter data unnecessarily.
 */
function enterProfileCompletionMode(form, result, isStudent) {
  form.dataset.mode = 'complete-profile';

  // Hide the password + confirm groups (they are not needed for Google).
  hideFieldGroup(form.elements['password']);
  hideFieldGroup(form.elements['confirm']);

  // Prefill + lock name/email from the authenticated identity.
  const identity = result.user || {};
  if (form.elements['name'] && identity.name) {
    form.elements['name'].value = identity.name;
  }
  if (form.elements['email'] && identity.email) {
    form.elements['email'].value = identity.email;
    form.elements['email'].readOnly = true;
  }

  // Update the submit button label + a small heading hint.
  const submitBtn = $('#submitBtn');
  if (submitBtn) submitBtn.textContent = isStudent ? 'Complete student profile' : 'Complete faculty profile';

  // Hide the Google button + divider now that we're authenticated.
  const gbtn = $('#googleBtn');
  if (gbtn) hideEl(gbtn);
  const divider = document.querySelector('.auth-divider');
  if (divider) hideEl(divider);

  // Focus the first profile field for convenience.
  const first = isStudent ? form.elements['rollNumber'] : form.elements['mobileNumber'];
  first?.focus();
}

/** Replace the form with the shared "pending approval" OTP screen. */
async function showFacultyPending(form) {
  const card = form.closest('.auth-card') || form.parentElement;
  if (!card) { redirect(ROUTES.FACULTY.LOGIN); return; }
  const { renderPendingApproval } = await import('./pendingApproval.js');
  renderPendingApproval(card, {
    role: 'faculty',
    dashboardUrl: resolvePath(ROUTES.FACULTY.DASHBOARD),
    rolePillColor: '#0284c7',
  });
}

/* ------------------------------------------------------------------ */
/* Field HTML builders (reuse existing form CSS classes)               */
/* ------------------------------------------------------------------ */

function studentFieldsHTML() {
  const courseOpts = [COURSE_TYPES.BTECH, COURSE_TYPES.POLYTECHNIC]
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const branchOpts = BRANCHES.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  return `
    <div class="form-group">
      <label class="form-label" for="rollNumber">Roll number <span class="req">*</span></label>
      <input class="input" id="rollNumber" name="rollNumber" type="text" placeholder="e.g. CSE-B3-014" />
      <div class="field-error"></div>
    </div>
    ${phoneFieldHTML({ id: 'mobileNumber', label: 'Mobile number', required: true })}
    <div class="form-group">
      <label class="form-label" for="program">Course <span class="req">*</span></label>
      <select class="input" id="program" name="program">
        <option value="">Select course</option>
        ${courseOpts}
      </select>
      <div class="field-error"></div>
    </div>
    <div class="form-group">
      <label class="form-label" for="branch">Branch <span class="req">*</span></label>
      <select class="input" id="branch" name="branch">
        <option value="">Select branch</option>
        ${branchOpts}
      </select>
      <div class="field-error"></div>
    </div>
    <div class="form-group">
      <label class="form-label" for="year">Year <span class="req">*</span></label>
      <select class="input" id="year" name="year" disabled>
        <option value="">Select course first</option>
      </select>
      <div class="field-error"></div>
    </div>
    <div class="form-group">
      <label class="form-label" for="semester">Semester <span class="req">*</span></label>
      <select class="input" id="semester" name="semester" disabled>
        <option value="">Select year first</option>
      </select>
      <div class="field-error"></div>
    </div>
  `;
}

function facultyFieldsHTML() {
  const deptOpts = DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  const desigOpts = DESIGNATIONS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  return `
    ${phoneFieldHTML({ id: 'mobileNumber', label: 'Mobile number', required: true })}
    <div class="form-group">
      <label class="form-label" for="department">Department <span class="req">*</span></label>
      <select class="input" id="department" name="department">
        <option value="">Select department</option>
        ${deptOpts}
      </select>
      <div class="field-error"></div>
    </div>
    <div class="form-group">
      <label class="form-label" for="designation">Designation <span class="req">*</span></label>
      <select class="input" id="designation" name="designation">
        <option value="">Select designation</option>
        ${desigOpts}
      </select>
      <div class="field-error"></div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Dynamic Course -> Year -> Semester                                  */
/* ------------------------------------------------------------------ */

function wireStudentDependentDropdowns(form) {
  const programSel = form.elements['program'];
  const yearSel = form.elements['year'];
  const semSel = form.elements['semester'];

  const resetSelect = (sel, placeholder) => {
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.value = '';
    sel.disabled = true;
  };

  programSel.addEventListener('change', () => {
    const program = programSel.value;
    // Course changed -> clear year + semester so no stale/invalid combo remains.
    resetSelect(yearSel, 'Select year');
    resetSelect(semSel, 'Select year first');
    if (!program) { resetSelect(yearSel, 'Select course first'); return; }

    const years = yearsForProgram(program); // [{label, semesters}]
    yearSel.innerHTML =
      `<option value="">Select year</option>` +
      years.map((y) => `<option value="${esc(y.label)}">${esc(y.label)}</option>`).join('');
    yearSel.disabled = false;
  });

  yearSel.addEventListener('change', () => {
    const program = programSel.value;
    const yearLabel = yearSel.value;
    resetSelect(semSel, 'Select semester');
    if (!program || !yearLabel) { resetSelect(semSel, 'Select year first'); return; }

    const sems = semestersForYear(program, yearLabel); // e.g. [3,4]
    semSel.innerHTML =
      `<option value="">Select semester</option>` +
      sems.map((s) => `<option value="${s}">Semester ${s}</option>`).join('');
    semSel.disabled = false;
  });
}

/* ------------------------------------------------------------------ */
/* Validation for the injected profile fields                          */
/* ------------------------------------------------------------------ */

function validateProfileFields(form, isStudent) {
  if (isStudent) {
    return validateForm(form, {
      rollNumber: [rules.required],
      mobileNumber: [rules.required, rules.mobileIN],
      program: [rules.selected],
      branch: [rules.selected],
      year: [rules.selected],
      semester: [rules.selected],
    });
  }
  return validateForm(form, {
    mobileNumber: [rules.required, rules.mobileIN],
    department: [rules.selected],
    designation: [rules.selected],
  });
}

/* ---------------- small DOM helpers ---------------- */

function wireToggle(selector, input) {
  const btn = $(selector);
  if (!btn || !input) return;
  btn.innerHTML = icon('eye');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}

/** Hide the .form-group wrapping a field (and remove it from validation view). */
function hideFieldGroup(field) {
  if (!field) return;
  const group = field.closest('.form-group');
  if (group) hideEl(group);
}

function hideEl(el) {
  el.style.display = 'none';
}

function redirect(dashboardUrl) {
  setTimeout(() => window.location.replace(resolvePath(dashboardUrl)), 400);
}

function setLoading(btn, label) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span> ${label}`;
  return () => { btn.disabled = false; btn.innerHTML = original; };
}
