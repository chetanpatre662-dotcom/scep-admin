/**
 * student/class.js — Class detail (read-only for students).
 */
import { ROUTES, resolvePath } from '../config.js';
import { bootstrapStudent } from './nav.js';
import { renderClassDetail } from '../common/classDetail.js';

bootstrapStudent({ activeId: 'classes', title: 'Class' }).then((ctx) => {
  if (!ctx) return;
  renderClassDetail({
    main: ctx.main,
    user: ctx.user,
    role: 'student',
    backUrl: resolvePath(ROUTES.STUDENT.CLASSES),
    canManage: false, // students never post/upload — read-only
  });
});
