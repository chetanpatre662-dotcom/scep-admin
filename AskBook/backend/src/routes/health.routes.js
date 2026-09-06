/**
 * routes/health.routes.js
 * -----------------------------------------------------------------------------
 * Health endpoints (public, no auth):
 *   GET /api/health          -> basic liveness
 *   GET /api/health/db       -> PostgreSQL connectivity
 *   GET /api/health/firebase -> Firebase Admin init status
 * -----------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const { health, healthDb, healthFirebase } = require('../controllers/healthController');

const router = express.Router();

router.get('/', health);
router.get('/db', healthDb);
router.get('/firebase', healthFirebase);

module.exports = router;
