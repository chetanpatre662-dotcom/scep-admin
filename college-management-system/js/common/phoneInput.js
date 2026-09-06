/**
 * phoneInput.js — Reusable Indian (+91) mobile-number input helper.
 * -----------------------------------------------------------------------------
 * The country code +91 is FIXED in the UI; the user types only the 10-digit
 * number. This module centralizes:
 *   - the markup (a `+91 |` prefix affixed to a text input), and
 *   - the behavior (numeric-only, max 10 digits, paste normalization that
 *     strips a pasted +91 / 91 / spaces / hyphens so we never end up with
 *     values like +91919876543210).
 *
 * The value submitted to the backend is ALWAYS the bare 10 digits (e.g.
 * "9876543210"). The backend adds/normalizes the +91 prefix consistently.
 * -----------------------------------------------------------------------------
 */

/**
 * Build the HTML for a +91-prefixed phone input group. Reuses existing form CSS.
 * @param {object} [opts]
 * @param {string} [opts.id='mobileNumber'] input id/name
 * @param {string} [opts.label='Mobile number']
 * @param {boolean} [opts.required=true]
 * @param {string} [opts.value=''] initial 10-digit value (any format; normalized)
 * @returns {string} HTML string
 */
export function phoneFieldHTML({ id = 'mobileNumber', label = 'Mobile number', required = true, value = '' } = {}) {
  const req = required ? ' <span class="req">*</span>' : '';
  const val = toTenDigits(value);
  return `
    <div class="form-group">
      <label class="form-label" for="${id}">${label}${req}</label>
      <div class="phone-input-group" style="display:flex;align-items:stretch">
        <span class="phone-cc" style="display:flex;align-items:center;padding:0 10px;background:var(--gray-100,#f1f5f9);border:1px solid var(--border,#d1d5db);border-right:0;border-radius:8px 0 0 8px;font-weight:600;color:var(--text-muted,#64748b);white-space:nowrap">+91</span>
        <input class="input" id="${id}" name="${id}" type="tel" inputmode="numeric" autocomplete="tel-national"
          maxlength="10" placeholder="9876543210" value="${val}"
          style="border-radius:0 8px 8px 0" aria-label="${label} (10 digits, +91 prefix is fixed)" />
      </div>
      <div class="field-error"></div>
    </div>
  `;
}

/**
 * Wire numeric-only + max-10 + paste normalization onto a phone input element.
 * Safe to call on any input rendered by phoneFieldHTML (or an existing input).
 * @param {HTMLInputElement} input
 */
export function wirePhoneInput(input) {
  if (!input) return;
  // Normalize any pre-filled value to bare 10 digits.
  input.value = toTenDigits(input.value);

  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 10);
    if (input.value !== digits) input.value = digits;
  });

  input.addEventListener('keypress', (e) => {
    // Block non-digit characters at keypress (defense in depth for input event).
    if (e.key && e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault();
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text') || '';
    input.value = toTenDigits(pasted);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Find + wire all phone inputs rendered by phoneFieldHTML within a root.
 * @param {HTMLElement|Document} [root=document]
 */
export function wirePhoneInputs(root = document) {
  root.querySelectorAll('.phone-input-group input[type="tel"]').forEach(wirePhoneInput);
}

/**
 * Normalize ANY phone string to bare 10 Indian digits.
 * Handles pastes like "+91 9876543210", "919876543210", "+919876543210",
 * "98765-43210" -> "9876543210". Returns at most the last 10 digits.
 * @param {string} value
 * @returns {string} up to 10 digits
 */
export function toTenDigits(value) {
  if (!value) return '';
  let digits = String(value).replace(/\D/g, '');
  // Strip a leading country code 91 when the result would otherwise exceed 10.
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  // If still longer than 10 (e.g. pasted junk), keep the last 10 digits.
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

/**
 * Compose the value to SEND to the backend. We submit the bare 10 digits;
 * the backend normalizes/prefixes +91 consistently. Returns '' if not 10 digits.
 * @param {string} value raw input value
 * @returns {string} 10 digits, or '' if invalid
 */
export function phoneForSubmit(value) {
  const d = toTenDigits(value);
  return /^\d{10}$/.test(d) ? d : '';
}
