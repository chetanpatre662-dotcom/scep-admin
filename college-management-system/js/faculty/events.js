/**
 * faculty/events.js — Event management (create, view active, delete/archive).
 */
import { EVENT_TYPES } from '../config.js';
import { $, $$, esc, debounce } from '../common/dom.js';
import { icon } from '../common/icons.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { openModal, confirmDialog } from '../common/modal.js';
import { toastSuccess, toastError } from '../common/toast.js';
import { validateForm, rules, clearErrors, setFieldError } from '../common/validation.js';
import { bootstrapFaculty } from './nav.js';
import { getEvents, createEvent, deleteEvent, setEventStatus } from '../services/eventService.js';
import { eventCardHTML } from '../common/events.js';

let USER = null;
let all = [];

bootstrapFaculty({ activeId: 'events', title: 'Events' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main, user }) {
  USER = user;
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Events</h1>
        <p class="page-subtitle">Create and manage institute events, workshops and activities.</p>
      </div>
      <button class="btn btn-primary" id="addBtn">${icon('plus')} Add Event</button>
    </div>

    <div class="ev-filters">
      <input class="input search" id="searchInput" type="search" placeholder="Search events…" />
    </div>

    <div id="grid">${skeletonCards(3)}</div>
  `;

  $('#addBtn').addEventListener('click', openAddEvent);
  $('#searchInput').addEventListener('input', debounce(render, 200));

  await load();
}

async function load() {
  const host = $('#grid');
  if (host) host.innerHTML = skeletonCards(3);
  try {
    all = await getEvents();
    render();
  } catch (e) {
    all = [];
    if (host) {
      host.innerHTML = `<div class="state"><h3>Couldn't load events</h3><p>${esc(e?.message || 'Failed to load data. Please try again.')}</p><button class="btn btn-primary" id="evRetry">Retry</button></div>`;
      host.querySelector('#evRetry')?.addEventListener('click', load);
    }
  }
}

function render() {
  const q = ($('#searchInput')?.value || '').trim().toLowerCase();
  const filtered = all.filter((e) => !q || `${e.title} ${e.type} ${e.venue}`.toLowerCase().includes(q));

  const host = $('#grid');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      title: all.length ? 'No matching events' : 'No events yet',
      message: all.length ? 'Try a different search.' : 'Create your first event to publish it to students.',
    });
    return;
  }

  host.innerHTML = `<div class="events-grid">${filtered.map((e) => eventCardHTML(e, { manage: true })).join('')}</div>`;
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => onDelete(b.dataset.del)));
  $$('[data-arch]', host).forEach((b) => b.addEventListener('click', () => onArchive(b.dataset.arch)));
}

async function onDelete(id) {
  const e = all.find((x) => x.id === id);
  const ok = await confirmDialog({ title: 'Delete event?', message: `"${e.title}" will be permanently removed.`, confirmLabel: 'Delete' });
  if (!ok) return;
  await deleteEvent(id);
  toastSuccess('Event deleted.');
  await load();
}

async function onArchive(id) {
  const e = all.find((x) => x.id === id);
  const next = (e.status === 'archived') ? 'active' : 'archived';
  await setEventStatus(id, next);
  toastSuccess(next === 'archived' ? 'Event archived.' : 'Event restored.');
  await load();
}

function openAddEvent() {
  const { close, el } = openModal({
    title: 'Add event',
    size: 'modal-lg',
    body: `
      <form id="evForm" novalidate>
        <div class="form-group">
          <label class="form-label" for="title">Event title <span class="req">*</span></label>
          <input class="input" id="title" name="title" placeholder="e.g. National Workshop on Cloud & DevOps" />
          <div class="field-error"></div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="type">Category / type <span class="req">*</span></label>
            <select id="type" name="type">${EVENT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="datetime">Date & time <span class="req">*</span></label>
            <input class="input" id="datetime" name="datetime" type="datetime-local" />
            <div class="field-error"></div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="venue">Venue / location <span class="req">*</span></label>
          <input class="input" id="venue" name="venue" placeholder="e.g. Seminar Hall A" />
          <div class="field-error"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="description">Description</label>
          <textarea class="input" id="description" name="description" placeholder="What is this event about?"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="banner">Banner / poster (image or PDF)</label>
            <input class="input" id="banner" name="banner" type="file" accept=".jpg,.jpeg,.png,.pdf" />
          </div>
          <div class="form-group">
            <label class="form-label" for="brochure">Brochure (optional PDF)</label>
            <input class="input" id="brochure" name="brochure" type="file" accept=".pdf" />
          </div>
        </div>
        <div class="text-muted" style="font-size:var(--fs-xs)">Files are stored in Firebase Cloud Storage once the backend is connected.</div>
      </form>`,
    actions: [
      { label: 'Cancel', class: 'btn-ghost' },
      { label: `${icon('check')} Publish event`, class: 'btn-primary', closeOnClick: false, onClick: () => submit() },
    ],
  });

  const form = $('#evForm', el);
  const publishBtn = el.querySelectorAll('.modal-footer .btn')[1];

  async function submit() {
    clearErrors(form);
    const ok = validateForm(form, { title: [rules.required], venue: [rules.required] });
    const dt = form.elements['datetime'];
    let dtOk = true;
    if (!dt.value) { setFieldError(dt, 'Pick a date and time.'); dtOk = false; }
    if (!ok || !dtOk) return;

    publishBtn.disabled = true;
    publishBtn.innerHTML = '<span class="spinner"></span> Publishing…';
    const bannerFile = form.elements['banner'].files[0];
    const brochureFile = form.elements['brochure'].files[0];
    const res = await createEvent({
      title: form.elements['title'].value.trim(),
      type: form.elements['type'].value,
      datetime: dt.value,
      venue: form.elements['venue'].value.trim(),
      description: form.elements['description'].value.trim(),
      banner: bannerFile ? bannerFile.name : null,
      brochure: brochureFile ? brochureFile.name : null,
      createdBy: USER.uid || 'faculty',
      createdByName: USER.name || 'Faculty',
    });
    if (!res.ok) { publishBtn.disabled = false; publishBtn.innerHTML = `${icon('check')} Publish event`; toastError('Could not publish event.'); return; }
    toastSuccess('Event published.');
    close();
    await load();
  }
}
