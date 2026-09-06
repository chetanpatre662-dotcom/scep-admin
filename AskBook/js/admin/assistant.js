/**
 * admin/assistant.js — Admin AI Assistant page.
 */
import { bootstrapAdmin } from './nav.js';
import { renderAssistant } from '../common/aiAssistant.js';

bootstrapAdmin({ activeId: 'ai', title: 'AI Assistant' }).then((ctx) => {
  if (!ctx) return;
  renderAssistant({ main: ctx.main, user: ctx.user, role: 'admin', profile: {} });
});
