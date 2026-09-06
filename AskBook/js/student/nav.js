/**
 * student/nav.js — Student sidebar config + shared page bootstrap.
 */
import { ROUTES, resolvePath } from '../config.js';
import { requireAuth } from '../common/authGuard.js';
import { mountLayout } from '../common/layout.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: ROUTES.STUDENT.DASHBOARD },
  { id: 'ai', label: 'AI Assistant', icon: 'sparkles', href: ROUTES.STUDENT.AI, ai: true },
  { section: 'Academics' },
  { id: 'classes', label: 'My Classes', icon: 'classes', href: ROUTES.STUDENT.CLASSES },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone', href: ROUTES.STUDENT.ANNOUNCEMENTS },
  { id: 'papers', label: 'Question Papers', icon: 'file', href: ROUTES.STUDENT.QUESTION_PAPERS },
  { id: 'events', label: 'Events', icon: 'calendar', href: ROUTES.STUDENT.EVENTS },
  { section: 'Account' },
  { id: 'profile', label: 'My Profile', icon: 'user', href: ROUTES.STUDENT.PROFILE },
];

/** @returns {Promise<{main:HTMLElement, user:object}|null>} */
export async function bootstrapStudent({ activeId, title }) {
  const loginUrl = resolvePath(ROUTES.STUDENT.LOGIN);
  const user = await requireAuth(loginUrl);
  if (!user) return null;

  const main = mountLayout({
    roleClass: 'role-student',
    roleLabel: 'Student Portal',
    nav: NAV,
    activeId,
    loginUrl,
    title,
    user,
  });
  return { main, user };
}
