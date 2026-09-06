-- =============================================================================
-- 009_approval_status_otp.sql
-- -----------------------------------------------------------------------------
-- Adds an explicit account APPROVAL STATUS model + phone fields to support the
-- Faculty/Admin OTP-approval feature, ALONGSIDE the existing admin-panel
-- approval flow. Nothing about the existing role model is removed.
--
-- Model:
--   users.status IN ('pending','approved','rejected')
--     - Students are always 'approved' (their self-signup flow is unchanged).
--     - Faculty/Admin applicants are 'pending' until approved (admin panel OR
--       OTP approval). A protected Faculty/Admin API additionally requires
--       status='approved' (enforced server-side in middleware).
--   users.phone / phone_verified
--     - An APPROVED admin's verified phone is the OTP target when they act as an
--       approver. NEVER exposed in full to the frontend (masked server-side).
--
-- otp_approval_events: a lightweight AUDIT trail. It does NOT store raw OTPs
-- (Firebase performs OTP delivery/verification; the backend only re-verifies the
-- resulting phone-auth ID token). We keep who-approved-whom + phone last-4 +
-- purpose for accountability.
--
-- BACKFILL SAFETY: the column is added with DEFAULT 'approved' so EVERY existing
-- row (students, already-approved faculty, existing admins) becomes 'approved'
-- immediately — no existing user is locked out. New pending accounts are set to
-- 'pending' explicitly by the application at signup time.
--
-- Idempotent + additive. No data dropped. Runner wraps this file in one
-- transaction.
-- =============================================================================

-- ---- users.status (approval state) ----
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected'));

-- Every pre-existing user keeps working (already 'approved' via the default).
-- Belt-and-suspenders: ensure any NULLs (shouldn't exist) are approved, and
-- students are always approved regardless of anything else.
UPDATE users SET status = 'approved' WHERE status IS NULL;
UPDATE users u SET status = 'approved'
  WHERE u.role = 'student' AND u.status <> 'approved';

CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, status);

-- ---- users.phone (approver OTP target; verified via Firebase phone auth) ----
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- OTP approval audit trail (NO raw OTP stored) ----
CREATE TABLE IF NOT EXISTS otp_approval_events (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The approver whose verified phone received the OTP. NULL for the bootstrap
  -- flow (no approver exists yet).
  approver_id   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  purpose       TEXT        NOT NULL
                            CHECK (purpose IN ('faculty_approval', 'admin_approval', 'bootstrap_admin')),
  -- Only the last 4 digits of the OTP-target phone, for audit (never the full
  -- number, never the OTP itself).
  phone_last4   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_approval_target ON otp_approval_events (target_id);
CREATE INDEX IF NOT EXISTS idx_otp_approval_created ON otp_approval_events (created_at DESC);
