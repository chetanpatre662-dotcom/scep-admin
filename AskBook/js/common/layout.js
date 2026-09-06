/**
 * layout.js — Builds the shared app shell (sidebar + header) for dashboards.
 * Each role passes its nav config; the rest (mobile toggle, notifications,
 * user menu, logout) is handled here so it stays consistent everywhere.
 */
import { APP, resolvePath } from '../config.js';
import { icon } from './icons.js';
import { esc, initials, timeAgo } from './dom.js';
import { logout } from '../services/authService.js';
import { getNotifications, markAllRead } from '../services/notificationService.js';
import * as realtime from '../services/realtimeService.js';

/**
 * @param {object} cfg
 * @param {string} cfg.roleClass 'role-faculty' | 'role-student' | 'role-admin'
 * @param {string} cfg.roleLabel display label (e.g. 'Faculty Portal')
 * @param {Array}  cfg.nav [{ label, icon, href, id }]
 * @param {string} cfg.activeId currently active nav id
 * @param {string} cfg.loginUrl resolved login url for logout redirect
 * @param {string} cfg.title header title text
 * @param {object} cfg.user authenticated identity (from Firebase) { name, email, ... }
 */
export function mountLayout(cfg) {
  // The authenticated Firebase identity is passed in by the page bootstrap.
  const user = cfg.user || { name: 'User' };
  document.body.classList.add(cfg.roleClass);

  const navHTML = cfg.nav
    .map((item) => {
      if (item.section) {
        return `<div class="sb-section-label">${esc(item.section)}</div>`;
      }
      const classes = [
        'sb-link',
        item.id === cfg.activeId ? 'active' : '',
        item.ai ? 'sb-ai' : '',
      ].filter(Boolean).join(' ');
      const badge = item.badge ? `<span class="sb-badge">${esc(item.badge)}</span>` : '';
      return `
      <a class="${classes}" href="${resolvePath(item.href)}">
        ${icon(item.icon)}<span>${esc(item.label)}</span>${badge}
      </a>`;
    })
    .join('');

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <aside class="sidebar" id="sidebar" aria-label="Primary navigation">
      <div class="sb-brand">
        <div class="sb-logo"><img src="${resolvePath(APP.COLLEGE_LOGO)}" alt="${esc(APP.COLLEGE_NAME)} logo" /></div>
        <div class="sb-brand-text">
          <div class="sb-name">${esc(APP.COLLEGE_SHORT)}<span class="sb-subbrand">${esc(APP.COLLEGE_SUB)}</span></div>
          <div class="sb-role">${esc(cfg.roleLabel)}</div>
        </div>
      </div>
      <nav class="sb-nav">
        ${navHTML}
      </nav>
      <div class="sb-foot">
        ${(cfg.footNav || []).map((item) => `
          <a class="sb-link ${item.id === cfg.activeId ? 'active' : ''}" href="${resolvePath(item.href)}">
            ${icon(item.icon)}<span>${esc(item.label)}</span>
          </a>`).join('')}
        <button class="btn" id="logoutBtn">${icon('logout')} Sign out</button>
      </div>
    </aside>

    <header class="app-header">
      <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu">${icon('menu')}</button>
      <div class="header-title">${esc(cfg.title)}</div>
      <div class="header-right">
        <div class="notif-wrap">
          <button class="notif-btn" id="notifBtn" aria-label="Notifications">
            ${icon('bell')}
            <span class="dot" id="notifDot" style="display:none"></span>
          </button>
          <div class="notif-panel" id="notifPanel" role="dialog" aria-label="Notifications">
            <div class="np-head">
              <span>Notifications</span>
              <span class="badge badge-brand" id="notifCount">0 new</span>
            </div>
            <div class="np-list" id="notifList"><div class="text-muted" style="padding:12px">Loading…</div></div>
          </div>
        </div>
        <div class="user-chip">
          <div class="avatar">${esc(initials(user.name))}</div>
          <div>
            <div class="u-name">${esc(user.name)}</div>
            <div class="u-role">${esc(user.designation || user.roll || cfg.roleLabel)}</div>
          </div>
        </div>
      </div>
    </header>

    <main class="app-main" id="appMain"></main>
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
  `;

  document.body.prepend(shell);

  // Mobile sidebar toggle
  const sidebar = shell.querySelector('#sidebar');
  const backdrop = shell.querySelector('#sidebarBackdrop');
  const openSidebar = () => { sidebar.classList.add('open'); backdrop.classList.add('open'); };
  const closeSidebar = () => { sidebar.classList.remove('open'); backdrop.classList.remove('open'); };
  shell.querySelector('#menuToggle').addEventListener('click', openSidebar);
  backdrop.addEventListener('click', closeSidebar);

  // Notifications dropdown (REAL data + live via WebSocket, no polling)
  const notifPanel = shell.querySelector('#notifPanel');
  const notifBtn = shell.querySelector('#notifBtn');
  const notifList = shell.querySelector('#notifList');
  const notifCount = shell.querySelector('#notifCount');
  const notifDot = shell.querySelector('#notifDot');

  function renderNotifications(items, unread) {
    notifCount.textContent = `${unread || 0} new`;
    notifDot.style.display = unread > 0 ? '' : 'none';
    if (!items || !items.length) {
      notifList.innerHTML = `<div class="text-muted" style="padding:12px">No notifications yet.</div>`;
      return;
    }
    notifList.innerHTML = items.map((n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="ni-icon">${icon('bell')}</div>
        <div>
          <div class="ni-title">${esc(n.title)}</div>
          <div class="ni-time">${esc(timeAgo(n.createdAt))}</div>
        </div>
      </div>`).join('');
  }

  async function loadNotifications() {
    const res = await getNotifications({ limit: 20 });
    if (!res.ok) { notifList.innerHTML = `<div class="text-muted" style="padding:12px">Could not load notifications.</div>`; return; }
    renderNotifications(res.items, res.unread);
  }

  loadNotifications();

  // Live: connect the shared WebSocket and refresh on pushed notifications.
  realtime.connect();
  realtime.subscribe('notification.created', () => loadNotifications());

  notifBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const opening = !notifPanel.classList.contains('open');
    notifPanel.classList.toggle('open');
    if (opening) {
      // Mark everything read when the panel is opened, then refresh the badge.
      await markAllRead();
      notifDot.style.display = 'none';
      notifCount.textContent = '0 new';
      loadNotifications();
    }
  });
  document.addEventListener('click', (e) => {
    if (!notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
      notifPanel.classList.remove('open');
    }
  });

  // Logout — end the Firebase session, then redirect to login.
  shell.querySelector('#logoutBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await logout();
    window.location.replace(cfg.loginUrl);
  });

  return shell.querySelector('#appMain');
}
