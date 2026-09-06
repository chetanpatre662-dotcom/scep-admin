/**
 * admin/profile.js — Admin "My Profile" page.
 */
import { bootstrapAdmin } from './nav.js';
import { renderProfilePage } from '../common/profilePage.js';

bootstrapAdmin({ activeId: 'profile', title: 'My Profile' }).then((ctx) => {
  if (ctx) renderProfilePage(ctx.main);
});
