/**
 * validation.js — Lightweight form validation helpers.
 * Frontend validation only; backend will always re-validate (security mindset).
 */
import { $$ } from './dom.js';

export const rules = {
  required: (v) => (v !== null && v !== undefined && String(v).trim() !== '') || 'This field is required.',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) || 'Enter a valid email address.',
  minLen: (n) => (v) => String(v).length >= n || `Must be at least ${n} characters.`,
  // Mobile: 10–15 digits, optional leading +, spaces/hyphens ignored for the check.
  mobile: (v) => /^\+?\d{10,15}$/.test(String(v).replace(/[\s-]/g, '')) || 'Enter a valid mobile number.',
  // Indian mobile: EXACTLY 10 digits (the +91 country code is fixed in the UI
  // and added by the backend, so the user enters only the 10-digit number).
  mobileIN: (v) => /^\d{10}$/.test(String(v).replace(/\D/g, '')) || 'Enter a valid 10-digit mobile number.',
  // For <select> fields: must be a non-empty, chosen value.
  selected: (v) => (v !== null && v !== undefined && String(v).trim() !== '') || 'Please select an option.',
};

/**
 * Validate a single field element and render its error message.
 * @param {HTMLElement} field input/select/textarea
 * @param {Function[]} validators
 * @returns {boolean} valid
 */
export function validateField(field, validators = []) {
  const value = field.value;
  let error = '';
  for (const fn of validators) {
    const result = fn(value);
    if (result !== true) { error = result; break; }
  }
  setFieldError(field, error);
  return error === '';
}

export function setFieldError(field, message) {
  field.classList.toggle('error', Boolean(message));
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
  let errEl = field.parentElement.querySelector('.field-error');
  if (!errEl) {
    // support input-group wrappers
    const host = field.closest('.form-group') || field.parentElement;
    errEl = host.querySelector('.field-error');
  }
  if (errEl) errEl.textContent = message || '';
}

/**
 * Validate a form using a schema: { fieldName: [validators] }.
 * @returns {boolean} whole-form validity
 */
export function validateForm(form, schema) {
  let valid = true;
  Object.entries(schema).forEach(([name, validators]) => {
    const field = form.elements[name];
    if (!field) return;
    if (!validateField(field, validators)) valid = false;
  });
  return valid;
}

/** Clear all field errors in a form. */
export function clearErrors(form) {
  $$('.error', form).forEach((f) => f.classList.remove('error'));
  $$('.field-error', form).forEach((e) => (e.textContent = ''));
}
