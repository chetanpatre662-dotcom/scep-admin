/**
 * faculty/nav.js — Faculty sidebar config + shared page bootstrap.
 * Guards the route, mounts the shell, returns { main, session }.
 */
import { ROUTES, resolvePath } from '../config.js';
import { requireRole } from '../common/authGuard.js';
import { mountLayout } from '../common/layout.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: ROUTES.FACULTY.DASHBOARD },
  { id: 'ai', label: 'AI Assistant', icon: 'sparkles', href: ROUTES.FACULTY.AI, ai: true },
  { section: 'Teaching' },
  { id: 'classes', label: 'My Classes', icon: 'classes', href: ROUTES.FACULTY.CLASSES },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone', href: ROUTES.FACULTY.ANNOUNCEMENTS },
  { id: 'papers', label: 'Question Papers', icon: 'file', href: ROUTES.FACULTY.QUESTION_PAPERS },
  { id: 'events', label: 'Events', icon: 'calendar', href: ROUTES.FACULTY.EVENTS },
  { section: 'Account' },
  { id: 'profile', label: 'My Profile', icon: 'user', href: ROUTES.FACULTY.PROFILE },
];

/**
 * Gate the page on Firebase auth state AND DB role='faculty' + status='approved'.
 * Pending/rejected faculty are redirected to the login page with ?pending=1.
 * @returns {Promise<{main:HTMLElement, user:object}|null>}
 */
export async function bootstrapFaculty({ activeId, title }) {
  const loginUrl = resolvePath(ROUTES.FACULTY.LOGIN);
  const pendingUrl = loginUrl + '?pending=1';
  const profile = await requireRole('faculty', loginUrl, loginUrl, pendingUrl);
  if (!profile) return null;

  const user = {
    ...profile,
    name: profile.displayName || (profile.email ? profile.email.split('@')[0] : 'Faculty'),
  };

  const main = mountLayout({
    roleClass: 'role-faculty',
    roleLabel: 'Faculty Portal',
    nav: NAV,
    activeId,
    loginUrl,
    title,
    user,
  });
  return { main, user };
}
