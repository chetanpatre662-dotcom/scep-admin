/**
 * student/events.js — Event showcase: responsive grid + All/Upcoming/Past
 * filter + search. Read-only for students; brochure "download" is a mock toast.
 */
import { $, $$, debounce } from '../common/dom.js';
import { emptyState, skeletonCards } from '../common/components.js';
import { toastInfo } from '../common/toast.js';
import { bootstrapStudent } from './nav.js';
import { getEvents } from '../services/eventService.js';
import { eventCardHTML, isUpcoming } from '../common/events.js';

let all = [];
let activeFilter = 'all';

bootstrapStudent({ activeId: 'events', title: 'Events' }).then((ctx) => { if (ctx) init(ctx); });

async function init({ main }) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Events</h1>
        <p class="page-subtitle">Workshops, seminars, cultural and sports events across the institute.</p>
      </div>
    </div>

    <div class="ev-filters">
      <div class="ev-seg" id="segFilter">
        <button class="active" data-f="all">All</button>
        <button data-f="upcoming">Upcoming</button>
        <button data-f="past">Past</button>
      </div>
      <input class="input search" id="searchInput" type="search" placeholder="Search events…" />
    </div>

    <div id="grid">${skeletonCards(3)}</div>
  `;

  $$('#segFilter button', main).forEach((b) =>
    b.addEventListener('click', () => {
      activeFilter = b.dataset.f;
      $$('#segFilter button', main).forEach((x) => x.classList.toggle('active', x === b));
      render();
    })
  );
  $('#searchInput').addEventListener('input', debounce(render, 200));

  await load();
}

async function load() {
  const host = $('#grid');
  if (host) host.innerHTML = skeletonCards(3);
  try {
    // Students only see published (active) events.
    all = await getEvents({ status: 'active' });
    render();
  } catch (e) {
    all = [];
    if (host) {
      host.innerHTML = `<div class="state"><h3>Couldn't load events</h3><p>${e?.message || 'Failed to load data. Please try again.'}</p><button class="btn btn-primary" id="evRetry">Retry</button></div>`;
      host.querySelector('#evRetry')?.addEventListener('click', load);
    }
  }
}

function render() {
  const q = ($('#searchInput')?.value || '').trim().toLowerCase();
  const filtered = all.filter((e) => {
    const matchQ = !q || `${e.title} ${e.type} ${e.venue}`.toLowerCase().includes(q);
    const up = isUpcoming(e);
    const matchF = activeFilter === 'all' || (activeFilter === 'upcoming' && up) || (activeFilter === 'past' && !up);
    return matchQ && matchF;
  });

  const host = $('#grid');
  if (!filtered.length) {
    host.innerHTML = emptyState({
      title: 'No events found',
      message: activeFilter === 'upcoming' ? 'There are no upcoming events right now.' : 'Try a different filter or search.',
    });
    return;
  }

  host.innerHTML = `<div class="events-grid">${filtered.map((e) => eventCardHTML(e, { manage: false })).join('')}</div>`;
  $$('[data-brochure]', host).forEach((b) =>
    b.addEventListener('click', () => toastInfo('Brochure download will stream from Firebase Storage once connected.'))
  );
}
