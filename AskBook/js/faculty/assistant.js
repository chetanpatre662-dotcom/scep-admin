/**
 * faculty/assistant.js — Faculty AI Assistant page.
 */
import { bootstrapFaculty } from './nav.js';
import { renderAssistant } from '../common/aiAssistant.js';

bootstrapFaculty({ activeId: 'ai', title: 'AI Assistant' }).then((ctx) => {
  if (!ctx) return;
  renderAssistant({ main: ctx.main, user: ctx.user, role: 'faculty', profile: {} });
});
