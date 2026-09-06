/**
 * common/events.js — Shared event helpers + card renderer used by both the
 * faculty (manage) and student (showcase) events pages.
 */
import { esc } from './dom.js';
import { icon } from './icons.js';

/** Deterministic banner gradient per event type (professional hues). */
const TYPE_GRADS = {
  Workshop: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
  Seminar: 'linear-gradient(135deg, #0284c7, #0891b2)',
  Cultural: 'linear-gradient(135deg, #db2777, #be185d)',
  Sports: 'linear-gradient(135deg, #059669, #047857)',
  Exam: 'linear-gradient(135deg, #b45309, #d97706)',
};
export function eventBannerGradient(type) {
  return TYPE_GRADS[type] || 'linear-gradient(135deg, #4338ca, #6d28d9)';
}

/** True if the event's datetime is in the future. */
export function isUpcoming(ev) {
  return new Date(ev.datetime).getTime() >= Date.now();
}

/** Human-friendly date + time, e.g. "20 Sep 2026 · 10:00 AM". */
export function formatEventWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Render one event card.
 * @param {object} ev event record
 * @param {object} [opts] { manage: boolean } — faculty gets delete/archive; student gets brochure link
 */
export function eventCardHTML(ev, opts = {}) {
  const upcoming = isUpcoming(ev);
  const archived = ev.status === 'archived';
  const footer = opts.manage
    ? `
      <span class="ev-status ${upcoming ? 'ev-tag-upcoming' : 'ev-tag-past'}">${upcoming ? 'Upcoming' : 'Past'}${archived ? ' · Archived' : ''}</span>
      <span class="row-actions">
        <button class="btn-icon" data-arch="${ev.id}" title="${archived ? 'Restore' : 'Archive'}">${icon(archived ? 'checkCircle' : 'inbox')}</button>
        <button class="btn-icon" data-del="${ev.id}" title="Delete event">${icon('trash')}</button>
      </span>`
    : `
      <span class="ev-status ${upcoming ? 'ev-tag-upcoming' : 'ev-tag-past'}">${upcoming ? 'Upcoming' : 'Past'}</span>
      ${ev.brochure ? `<button class="btn btn-sm" data-brochure="${esc(ev.brochure)}">${icon('download')} Brochure</button>` : ''}`;

  return `
    <div class="event-card" data-id="${ev.id}">
      <div class="event-banner" style="background:${eventBannerGradient(ev.type)}">
        <span class="ev-type">${esc(ev.type)}</span>
        <span class="ev-when">${icon('calendar')} ${esc(formatEventWhen(ev.datetime))}</span>
      </div>
      <div class="event-body">
        <div class="ev-title">${esc(ev.title)}</div>
        <div class="ev-venue">${icon('mapPin')} ${esc(ev.venue || 'TBA')}</div>
        ${ev.description ? `<div class="ev-desc">${esc(ev.description)}</div>` : ''}
      </div>
      <div class="event-foot">${footer}</div>
    </div>`;
}
