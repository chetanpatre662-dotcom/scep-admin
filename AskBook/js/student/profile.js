/**
 * student/profile.js — Student "My Profile" page.
 */
import { bootstrapStudent } from './nav.js';
import { renderProfilePage } from '../common/profilePage.js';

bootstrapStudent({ activeId: 'profile', title: 'My Profile' }).then((ctx) => {
  if (ctx) renderProfilePage(ctx.main);
});
