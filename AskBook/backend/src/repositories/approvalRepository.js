/**
 * repositories/approvalRepository.js
 * -----------------------------------------------------------------------------
 * Data-access for the OTP approval audit trail (otp_approval_events).
 * Parameterized SQL only. Never stores raw OTPs — only who approved whom,
 * the purpose, and the phone's last 4 digits for accountability.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

/**
 * Record an approval event.
 * @param {object} p
 * @param {number} p.targetId    - the user that was approved
 * @param {number|null} p.approverId - the approving admin (null for bootstrap)
 * @param {string} p.purpose     - faculty_approval | admin_approval | bootstrap_admin
 * @param {string|null} p.phoneLast4 - last 4 digits of the OTP-target phone
 */
async function record({ targetId, approverId = null, purpose, phoneLast4 = null }) {
  const { rows } = await query(
    `INSERT INTO otp_approval_events (target_id, approver_id, purpose, phone_last4)
     VALUES ($1, $2, $3, $4)
     RETURNING id, target_id, approver_id, purpose, phone_last4, created_at`,
    [targetId, approverId, purpose, phoneLast4]
  );
  return rows[0];
}

module.exports = { record };
