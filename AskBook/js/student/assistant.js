/**
 * student/assistant.js — Student AI Assistant page.
 */
import { bootstrapStudent } from './nav.js';
import { renderAssistant } from '../common/aiAssistant.js';

bootstrapStudent({ activeId: 'ai', title: 'AI Assistant' }).then((ctx) => {
  if (!ctx) return;
  renderAssistant({ main: ctx.main, user: ctx.user, role: 'student', profile: {} });
});
