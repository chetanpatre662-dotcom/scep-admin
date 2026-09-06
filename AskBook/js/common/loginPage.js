/**
 * loginPage.js — Shared login controller for all portals (Firebase Auth).
 * -----------------------------------------------------------------------------
 * Handles: email/password sign-in, "Continue with Google", forgot-password,
 * password visibility toggle, remember-me persistence, loading state, and
 * duplicate-submit prevention. Each login.html imports this with portal config.
 *
 * The `role` passed in is only an UNVERIFIED UX hint (which portal was used);
 * it is stored via authService and never treated as an authorization claim.
 * -----------------------------------------------------------------------------
 */
import { resolvePath, ROUTES } from '../config.js';
import { $ } from './dom.js';
import { icon } from './icons.js';
import { toastSuccess, toastError, toastInfo } from './toast.js';
import { validateForm, rules, clearErrors, setFieldError } from './validation.js';
import { openModal } from './modal.js';
import {
  loginWithEmail,
  loginWithGoogle,
  sendPasswordReset,
  isFirebaseConfigured,
} from '../services/authService.js';
import { renderPendingApproval } from './pendingApproval.js';

/**
 * Map the backend (PostgreSQL) role to its dashboard route. The DB role — NOT
 * the portal the user logged in through — decides where they land. Falls back
 * to the portal's own dashboard when no backend profile is available.
 */
function dashboardForRole(role, fallbackUrl) {
  switch (role) {
    case 'admin': return ROUTES.ADMIN.DASHBOARD;
    case 'faculty': return ROUTES.FACULTY.DASHBOARD;
    case 'student': return ROUTES.STUDENT.DASHBOARD;
    default: return fallbackUrl;
  }
}

/**
 * Handle post-login routing with status awareness.
 * Pending faculty/admin → show OTP approval screen inline.
 * Approved users → redirect to dashboard.
 */
function routeAfterLogin(profile, cfg, restore) {
  const role = profile?.role;
  const status = profile?.status;

  // Pending or rejected — don't redirect to a dashboard.
  if ((role === 'faculty' || role === 'admin') && status === 'pending') {
    if (restore) restore();
    showPendingScreen(profile, cfg);
    return;
  }
  if ((role === 'faculty' || role === 'admin') && status === 'rejected') {
    if (restore) restore();
    toastError('Your account has been rejected. Please contact an administrator.');
    return;
  }
  redirect(dashboardForRole(role, cfg.dashboardUrl));
}

function showPendingScreen(profile, cfg) {
  const card = document.querySelector('.auth-card');
  if (!card) { toastInfo('Your account is pending approval.'); return; }
  const role = profile?.role;
  const dashboardUrl = resolvePath(role === 'admin' ? ROUTES.ADMIN.DASHBOARD : ROUTES.FACULTY.DASHBOARD);
  const pillColor = role === 'admin' ? '#6d28d9' : '#0284c7';
  renderPendingApproval(card, { role, dashboardUrl, rolePillColor: pillColor });
}

/**
 * @param {object} cfg
 * @param {string} cfg.role 'faculty' | 'student' | 'admin' (UX hint only)
 * @param {string} cfg.dashboardUrl root-relative dashboard path
 */
export function initLoginPage(cfg) {
  const form = $('#loginForm');
  if (!form) return;

  warnIfUnconfigured();

  // If redirected here with ?pending=1, the user is already signed in but
  // their account is pending/rejected — show the pending screen immediately
  // without requiring them to re-enter credentials.
  if (new URLSearchParams(window.location.search).get('pending') === '1') {
    _checkAndShowPendingOnLoad(cfg);
  }

  // --- Password visibility toggle ---
  const toggle = $('#togglePw');
  const pw = form.elements['password'];
  if (toggle) {
    toggle.innerHTML = icon('eye');
    toggle.addEventListener('click', () => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      toggle.innerHTML = icon(show ? 'eyeOff' : 'eye');
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  }

  const submitBtn = $('#submitBtn');
  const googleBtn = $('#googleBtn');

  // --- Forgot password ---
  $('#forgotLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    openForgotPassword(form.elements['email']?.value || '');
  });

  // --- Email/password submit ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);

    const ok = validateForm(form, {
      email: [rules.required, rules.email],
      password: [rules.required, rules.minLen(6)],
    });
    if (!ok) return;

    const email = form.elements['email'].value;
    const password = form.elements['password'].value;
    const remember = form.elements['remember']?.checked || false;

    const restore = setLoading(submitBtn, 'Signing in…');
    if (googleBtn) googleBtn.disabled = true;

    const result = await loginWithEmail({ email, password, remember, role: cfg.role });

    if (result.ok) {
      toastSuccess('Signed in successfully.');
      routeAfterLogin(result.profile, cfg, restore);
    } else {
      restore();
      if (googleBtn) googleBtn.disabled = false;
      toastError(result.error || 'Login failed.');
    }
  });

  // --- Google sign-in ---
  googleBtn?.addEventListener('click', async () => {
    const restore = setLoading(googleBtn, 'Connecting…');
    submitBtn.disabled = true;

    const result = await loginWithGoogle({ remember: true, role: cfg.role });

    if (result.ok) {
      toastSuccess('Signed in with Google.');
      routeAfterLogin(result.profile, cfg, () => { submitBtn.disabled = false; restore(); });
    } else {
      restore();
      submitBtn.disabled = false;
      toastError(result.error || 'Google sign-in failed.');
    }
  });
}

/* ---------------- helpers ---------------- */

function redirect(dashboardUrl) {
  // Small delay lets the success toast render before navigation.
  setTimeout(() => window.location.replace(resolvePath(dashboardUrl)), 400);
}

/** Put a button into a disabled loading state; returns a restore() fn. */
function setLoading(btn, label) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span> ${label}`;
  return () => { btn.disabled = false; btn.innerHTML = original; };
}

function warnIfUnconfigured() {
  if (!isFirebaseConfigured()) {
    toastInfo('Firebase is not configured yet. Add your config in js/firebase/firebase-config.js.', 6000);
  }
}

/** Forgot-password modal that calls Firebase's reset email. */
function openForgotPassword(prefillEmail = '') {
  const { close, el } = openModal({
    title: 'Reset your password',
    body: `
      <p class="text-muted mb-4">Enter your account email and we'll send you a password reset link.</p>
      <form id="resetForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="resetEmail">Email <span class="req">*</span></label>
          <input class="input" id="resetEmail" name="resetEmail" type="email" value="${prefillEmail.replace(/"/g, '&quot;')}" placeholder="you@example.com" />
          <div class="field-error"></div>
        </div>
      </form>
    `,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: 'Send reset link', class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });

  const form = $('#resetForm', el);
  const field = form.elements['resetEmail'];
  const sendBtn = el.querySelectorAll('.modal-footer .btn')[1];

  async function submit() {
    setFieldError(field, '');
    const emailVal = field.value.trim();
    if (!emailVal) { setFieldError(field, 'Email is required.'); return; }
    if (rules.email(emailVal) !== true) { setFieldError(field, 'Enter a valid email address.'); return; }

    const restore = setLoading(sendBtn, 'Sending…');
    const result = await sendPasswordReset(emailVal);
    restore();

    if (result.ok) {
      close();
      // Neutral message: don't reveal whether an account exists (privacy).
      toastSuccess('If an account exists for that email, a reset link has been sent.');
    } else {
      toastError(result.error || 'Could not send reset email.');
    }
  }
}

/**
 * Called when login.html is loaded with ?pending=1 (redirected from a
 * dashboard guard). The user is already signed in — sync their profile and
 * show the pending/rejected screen without requiring re-login.
 */
async function _checkAndShowPendingOnLoad(cfg) {
  const { syncProfile } = await import('../services/authService.js');
  const { renderPendingApproval } = await import('./pendingApproval.js');

  const sync = await syncProfile(true);
  if (!sync.ok || !sync.profile) return; // not signed in — let the normal form handle it

  const profile = sync.profile;
  const role = profile.role;
  const status = profile.status;

  // Already approved — just redirect to the correct dashboard.
  if (status === 'approved') {
    redirect(dashboardForRole(role, cfg.dashboardUrl));
    return;
  }

  // Rejected: show a clear message, no OTP option.
  if (status === 'rejected') {
    const card = document.querySelector('.auth-card');
    if (card) {
      card.innerHTML = `
        <h2 style="color:var(--error-600,#dc2626)">Account Rejected</h2>
        <p class="auth-desc">Your account has been rejected by an administrator.</p>
        <p class="text-muted" style="margin:12px 0 20px">
          If you believe this is a mistake, please contact the college administrator directly.
        </p>
        <a class="btn btn-primary btn-block" href="${resolvePath(cfg.dashboardUrl).split('?')[0]}">
          Back to sign in
        </a>
      `;
    }
    return;
  }

  // Pending: show the full pending approval screen.
  if (status === 'pending') {
    const card = document.querySelector('.auth-card');
    if (!card) return;
    const dashboardUrl = resolvePath(role === 'admin' ? ROUTES.ADMIN.DASHBOARD : ROUTES.FACULTY.DASHBOARD);
    const pillColor = role === 'admin' ? '#6d28d9' : '#0284c7';
    renderPendingApproval(card, { role, dashboardUrl, rolePillColor: pillColor });
  }
}
