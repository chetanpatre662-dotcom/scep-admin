/**
 * faculty/profile.js — Faculty "My Profile" page.
 */
import { bootstrapFaculty } from './nav.js';
import { renderProfilePage } from '../common/profilePage.js';

bootstrapFaculty({ activeId: 'profile', title: 'My Profile' }).then((ctx) => {
  if (ctx) renderProfilePage(ctx.main);
});
