/**
 * faculty/class.js — Class detail for faculty (can post messages, upload notes).
 * NOTE: canManage is true here for the demo. The backend must verify the
 * authenticated faculty actually OWNS this class before allowing writes.
 */
import { ROUTES, resolvePath } from '../config.js';
import { bootstrapFaculty } from './nav.js';
import { renderClassDetail } from '../common/classDetail.js';

bootstrapFaculty({ activeId: 'classes', title: 'Class' }).then((ctx) => {
  if (!ctx) return;
  renderClassDetail({
    main: ctx.main,
    user: ctx.user,
    role: 'faculty',
    backUrl: resolvePath(ROUTES.FACULTY.CLASSES),
    canManage: true,
  });
});
