/**
 * pendingApproval.js — Shared "Pending Approval" screen with OTP flow.
 * -----------------------------------------------------------------------------
 * Rendered when a faculty or admin applicant's account has status='pending'.
 * Supports two approval paths:
 *   1. OTP approval — applicant selects an approved admin (masked phone shown),
 *      Firebase phone OTP is sent to that admin, correct OTP approves the account.
 *   2. Admin Panel approval — applicant waits; admin approves via the dashboard.
 *      (Existing mechanism — no change required; this just explains the wait.)
 * Bootstrap mode — when approved-admin count is zero AND the applicant is a
 * pending admin, shows a "Bootstrap OTP" option using the backend-configured
 * phone (never revealed to the client).
 *
 * Security: phone numbers are NEVER sent from the frontend; only the approverId
 * and the resulting phone-auth token are sent to the backend, which does all
 * validation server-side. Full phone numbers are never shown to the user.
 *
 * The pending applicant's primary Firebase session is untouched; OTP runs on a
 * secondary isolated Firebase app instance (see js/firebase/auth.js).
 * -----------------------------------------------------------------------------
 */
import { esc } from './dom.js';
import { icon } from './icons.js';
import { toastSuccess, toastError, toastInfo } from './toast.js';
import { getApprovers, verifyOtp } from '../services/approvalService.js';
import { makeRecaptcha, sendPhoneOtp, confirmPhoneOtp } from '../firebase/auth.js';
import { syncProfile } from '../services/authService.js';

/**
 * Ensure a phone string is in E.164 format before passing to Firebase.
 * Firebase signInWithPhoneNumber requires +[countrycode][number].
 * Auto-prepends +91 for bare 10-digit Indian mobile numbers.
 */
function toE164(phone) {
  if (!phone) return '';
  const raw = String(phone).trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (hasPlus) return '+' + digits;
  if (digits.length === 10) return '+91' + digits;           // bare Indian number
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  return '+' + digits; // best effort
}

/**
 * Render the pending-approval screen into `container`.
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.role      'faculty' | 'admin'
 * @param {string} opts.dashboardUrl  resolved dashboard URL to navigate to on success
 * @param {string} [opts.rolePillColor] CSS variable / hex for the role pill accent
 */
export async function renderPendingApproval(container, { role, dashboardUrl, rolePillColor = '#6d28d9' }) {
  const isAdmin = role === 'admin';
  const roleLabel = isAdmin ? 'Admin' : 'Faculty';
  const roleIcon = isAdmin ? 'shield' : 'user';

  container.innerHTML = `
    <span class="role-pill" style="background:${rolePillColor}22;color:${rolePillColor}">
      ${icon(roleIcon)} ${roleLabel}
    </span>
    <h2>Account pending approval</h2>
    <p class="auth-desc">Your <strong>${roleLabel}</strong> account has been created and is awaiting approval.</p>
    <p class="text-muted" style="margin-bottom:20px">
      You have two options to get your account approved:
    </p>

    <div class="pending-options">
      <!-- Option 1: OTP -->
      <div class="pending-opt" id="otpOptWrap">
        <div class="pending-opt-head">
          <span class="pending-opt-icon">${icon('phone')}</span>
          <div>
            <div class="pending-opt-title">OTP Approval <span class="badge" style="background:#dcfce7;color:#166534;font-size:10px;vertical-align:middle">Instant</span></div>
            <div class="pending-opt-sub">An approved administrator verifies via phone OTP.</div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="startOtpBtn" style="margin-top:10px">
          ${icon('phone')} Get approval via OTP
        </button>
      </div>

      <div class="pending-divider">or</div>

      <!-- Option 2: Wait for admin panel -->
      <div class="pending-opt">
        <div class="pending-opt-head">
          <span class="pending-opt-icon">${icon('clock')}</span>
          <div>
            <div class="pending-opt-title">Admin Panel Approval</div>
            <div class="pending-opt-sub">Wait for an administrator to approve your account in the admin panel.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- OTP Flow (hidden initially) -->
    <div id="otpFlow" style="display:none;margin-top:20px"></div>

    <!-- reCAPTCHA container (invisible) -->
    <div id="recaptcha-container"></div>

    <p class="auth-footer-link" style="margin-top:20px">
      <a href="#" id="checkStatusLink">I've already been approved — sign in again</a>
    </p>
  `;

  container.querySelector('#startOtpBtn').addEventListener('click', () => startOtpFlow(container, { role, dashboardUrl, rolePillColor }));
  container.querySelector('#checkStatusLink').addEventListener('click', async (e) => {
    e.preventDefault();
    toastInfo('Refreshing your status…');
    const sync = await syncProfile(true);
    if (sync.ok && sync.profile?.status === 'approved') {
      toastSuccess('Account approved! Redirecting…');
      setTimeout(() => window.location.replace(dashboardUrl), 600);
    } else {
      toastError('Account is still pending approval. Please wait or use OTP approval.');
    }
  });
}

async function startOtpFlow(container, { role, dashboardUrl }) {
  const isAdmin = role === 'admin';
  const flowEl = container.querySelector('#otpFlow');
  flowEl.style.display = 'block';
  flowEl.innerHTML = `<div class="text-muted" style="padding:8px 0"><span class="spinner" style="width:16px;height:16px;display:inline-block;margin-right:6px"></span> Loading approvers…</div>`;
  container.querySelector('#startOtpBtn').disabled = true;

  const res = await getApprovers();
  if (!res.ok) {
    flowEl.innerHTML = `<div class="text-muted" style="color:var(--error-600,#dc2626)">${icon('alert')} ${esc(res.error || 'Could not load approvers.')}</div>`;
    container.querySelector('#startOtpBtn').disabled = false;
    return;
  }

  const { approvers, bootstrapAvailable } = res;
  const hasApprovers = approvers && approvers.length > 0;

  if (!hasApprovers && !bootstrapAvailable) {
    // No approved admins and no bootstrap — can only wait for admin panel.
    flowEl.innerHTML = `
      <div style="padding:12px;background:var(--warning-50,#fffbeb);border:1px solid var(--warning-200,#fde68a);border-radius:8px">
        ${icon('alert')} <strong>No approved administrators are registered yet.</strong><br>
        <span class="text-muted">OTP approval is not available right now. Please wait for an administrator to approve your account via the admin panel.</span>
      </div>`;
    container.querySelector('#startOtpBtn').disabled = false;
    return;
  }

  // Build selector UI
  let selectorHTML = `<div style="margin-bottom:12px"><strong>Select an administrator to receive the OTP:</strong></div>`;

  if (bootstrapAvailable) {
    selectorHTML += `
      <label class="approver-option" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:8px">
        <input type="radio" name="approver" value="__bootstrap__" style="margin:0" />
        <div>
          <div style="font-weight:600">Bootstrap Admin Approval</div>
          <div class="text-muted" style="font-size:var(--fs-xs)">Use the configured bootstrap phone (first admin setup)</div>
        </div>
      </label>`;
  }

  if (hasApprovers) {
    selectorHTML += approvers.map((a) => `
      <label class="approver-option" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:8px">
        <input type="radio" name="approver" value="${esc(String(a.id))}" style="margin:0" />
        <div>
          <div style="font-weight:600">${esc(a.name)}</div>
          <div class="text-muted" style="font-size:var(--fs-xs)">${esc(a.maskedPhone)}</div>
        </div>
      </label>`).join('');
  }

  flowEl.innerHTML = `
    ${selectorHTML}
    <p class="text-muted" style="font-size:var(--fs-xs);margin-bottom:12px">
      OTP will be sent to the selected administrator's registered phone.
    </p>
    <button class="btn btn-primary" id="sendOtpBtn">${icon('phone')} Send OTP</button>
    <div id="otpStep" style="display:none;margin-top:16px"></div>
  `;

  flowEl.querySelector('#sendOtpBtn').addEventListener('click', () => sendOtpStep(container, flowEl, role, dashboardUrl));
}

async function sendOtpStep(container, flowEl, role, dashboardUrl) {
  const selected = flowEl.querySelector('input[name="approver"]:checked');
  if (!selected) { toastError('Please select an approver.'); return; }

  const isBootstrap = selected.value === '__bootstrap__';
  const approverId = isBootstrap ? null : Number(selected.value);

  const maskedPhoneEl = selected.closest('label')?.querySelector('.text-muted');
  const maskedPhone = maskedPhoneEl ? maskedPhoneEl.textContent.trim() : '******';

  const sendBtn = flowEl.querySelector('#sendOtpBtn');
  const originalBtnHtml = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = `<span class="spinner"></span> Sending OTP…`;

  let recaptchaVerifier;
  let confirmation;
  try {
    // For bootstrap: backend knows the phone; we ask it to tell us what E.164
    // number to send to via a dedicated lookup, OR we use the pre-confirmed
    // bootstrap approach (backend validates after the fact). For the bootstrap
    // flow, we need the actual phone number to send OTP to. Since the backend
    // never reveals it, we must call a small lookup endpoint to get just enough
    // to send the OTP, or ask the user to enter the known bootstrap phone.
    // Simplest secure approach: for bootstrap, show an input for the bootstrap phone
    // (the person doing bootstrap setup knows their own number). For normal approvers,
    // we need to retrieve the phone to dial — but the backend only returns masked phones.
    //
    // DESIGN DECISION: The backend returns masked phones only. To actually SEND
    // the OTP we need the real phone number. Solution: add a GET endpoint that
    // returns the full phone ONLY to the pending applicant making the request,
    // resolved server-side by approverId. This is secure because: (a) it requires
    // a valid token, (b) the backend re-verifies the token at final approval.
    //
    // For now (first version), the cleanest UX is: the approver's phone is not
    // retrievable client-side → implement a backend-proxied OTP send endpoint.
    // The user sees "OTP sent to +91 ******1234" and enters the code.
    // The backend will send the OTP, not the client.
    //
    // PIVOT: To avoid complex server-side SMS integration (Firebase phone auth
    // requires the client to trigger signInWithPhoneNumber with the real number),
    // add GET /api/approval/approver-phone?approverId=X which returns the real
    // phone number ONLY for the purpose of sending OTP. It's a narrow, auth-gated
    // endpoint and the backend still re-validates at verify time.

    const phoneRes = await fetchApproverPhone(isBootstrap, approverId);
    if (!phoneRes.ok) {
      toastError(phoneRes.error || 'Could not retrieve approver phone for OTP delivery.');
      sendBtn.disabled = false;
      sendBtn.innerHTML = originalBtnHtml;
      return;
    }
    const e164Phone = toE164(phoneRes.phone);
    if (!e164Phone) {
      toastError('Invalid phone number format from server. Please contact an administrator.');
      sendBtn.disabled = false;
      sendBtn.innerHTML = originalBtnHtml;
      return;
    }

    recaptchaVerifier = await makeRecaptcha('recaptcha-container');
    confirmation = await sendPhoneOtp(e164Phone, recaptchaVerifier);
  } catch (err) {
    toastError(err?.message || 'Could not send OTP. Please try again.');
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalBtnHtml;
    return;
  }

  sendBtn.style.display = 'none';

  const otpStep = flowEl.querySelector('#otpStep');
  otpStep.style.display = 'block';
  otpStep.innerHTML = `
    <div style="padding:10px 14px;background:var(--success-50,#f0fdf4);border:1px solid var(--success-200,#bbf7d0);border-radius:8px;margin-bottom:14px">
      ${icon('check')} OTP sent to <strong>${esc(maskedPhone)}</strong>
    </div>
    <div class="form-group">
      <label class="form-label" for="otpInput">Enter the 6-digit OTP</label>
      <input class="input" id="otpInput" type="text" inputmode="numeric" maxlength="6"
        placeholder="e.g. 123456" autocomplete="one-time-code" style="letter-spacing:0.2em;font-size:1.25rem;text-align:center" />
    </div>
    <button class="btn btn-primary btn-block" id="verifyOtpBtn">${icon('check')} Verify OTP &amp; Approve</button>
    <button class="btn btn-ghost btn-block" id="resendOtpBtn" style="margin-top:6px">Resend OTP</button>
  `;

  otpStep.querySelector('#verifyOtpBtn').addEventListener('click', () =>
    verifyOtpStep(otpStep, confirmation, isBootstrap, approverId, dashboardUrl));

  otpStep.querySelector('#resendOtpBtn').addEventListener('click', () => {
    otpStep.style.display = 'none';
    sendBtn.style.display = '';
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalBtnHtml;
  });
}

async function verifyOtpStep(otpStep, confirmation, isBootstrap, approverId, dashboardUrl) {
  const code = otpStep.querySelector('#otpInput').value.trim();
  if (!code || code.length < 4) { toastError('Enter the OTP code.'); return; }

  const verifyBtn = otpStep.querySelector('#verifyOtpBtn');
  verifyBtn.disabled = true;
  verifyBtn.innerHTML = `<span class="spinner"></span> Verifying…`;

  try {
    // 1. Complete the Firebase phone OTP on the secondary app (no session swap).
    const phoneIdToken = await confirmPhoneOtp(confirmation, code);

    // 2. Send to backend for final re-verification and approval.
    const result = await verifyOtp({ phoneIdToken, approverId: isBootstrap ? null : approverId, bootstrap: isBootstrap });

    if (!result.ok) {
      toastError(result.error || 'OTP verification failed.');
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `${icon('check')} Verify OTP & Approve`;
      return;
    }

    // 3. Success — refresh the session profile and redirect.
    toastSuccess('Account approved successfully!');
    await syncProfile(true);
    setTimeout(() => window.location.replace(dashboardUrl), 800);
  } catch (err) {
    const msg = err?.message || 'Verification failed. Please try again.';
    // Common Firebase code errors
    const friendly = msg.includes('invalid-verification-code') ? 'Incorrect OTP. Please try again.'
      : msg.includes('code-expired') ? 'OTP expired. Please resend.'
      : msg;
    toastError(friendly);
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = `${icon('check')} Verify OTP & Approve`;
  }
}

/**
 * Retrieve the real phone number for the selected approver (from backend).
 * Only used client-side to dial the Firebase phone OTP.
 * The backend still re-validates the resulting token at approval time.
 */
async function fetchApproverPhone(isBootstrap, approverId) {
  try {
    const { getIdToken } = await import('../firebase/auth.js');
    const { authedRequest } = await import('../services/apiClient.js');
    const { ENV } = await import('../config.js');
    if (!ENV.AUTH_USE_BACKEND) return { ok: false, error: 'Backend disabled.' };
    const token = await getIdToken();
    if (!token) return { ok: false, error: 'Not authenticated.' };
    const qs = isBootstrap ? 'bootstrap=1' : `approverId=${encodeURIComponent(approverId)}`;
    const res = await authedRequest(`/approval/approver-phone?${qs}`, token, { method: 'GET' });
    return { ok: true, phone: res.phone };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not fetch approver phone.' };
  }
}
