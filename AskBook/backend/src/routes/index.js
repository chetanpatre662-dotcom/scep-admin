/**
 * routes/index.js
 * -----------------------------------------------------------------------------
 * Root API router. Mounts all feature route modules under /api.
 *
 * Foundation phase mounts only health + auth probe. Business route modules
 * (students, faculty, classes, ...) will be added here after the database
 * schema exists.
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const profileRoutes = require('./profile.routes');
const adminRoutes = require('./admin.routes');
const subjectRoutes = require('./subject.routes');
const eventRoutes = require('./event.routes');
const classRoutes = require('./class.routes');
const announcementRoutes = require('./announcement.routes');
const notificationRoutes = require('./notification.routes');
const portalRoutes = require('./portal.routes');
const approvalRoutes = require('./approval.routes');
const aiRoutes = require('./ai.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
// Profile + subject + event + class routes declare their own full paths, so
// mount at the API root.
router.use('/', profileRoutes);
router.use('/', subjectRoutes);
router.use('/', eventRoutes);
router.use('/', classRoutes);
router.use('/', announcementRoutes);
router.use('/', notificationRoutes);
router.use('/', portalRoutes);
router.use('/', approvalRoutes);
router.use('/', aiRoutes);

module.exports = router;
