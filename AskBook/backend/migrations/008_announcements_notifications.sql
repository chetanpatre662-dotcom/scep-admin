-- =============================================================================
-- 008_announcements_notifications.sql
-- -----------------------------------------------------------------------------
-- Two changes to support real (non-mock) Faculty + Student panels:
--
--   1. Extend `announcements` (from 001) with the presentational fields the UI
--      already uses: type, status (draft/published), event_date, and an
--      optional attachment reference into the normalized `files` table. The
--      existing target_program/target_branch/target_semester columns already
--      model audience targeting (NULL = broader audience).
--
--   2. New `notifications` table: per-user notification feed powering the header
--      bell + notifications list. Generated from real events (announcement
--      published, new class content, new message) — never hardcoded. Realtime
--      delivery is via the existing WebSocket pipeline; this table is the
--      persistence + unread-count source of truth.
--
-- Idempotent + additive. No data dropped. Wrapped in one transaction.
-- =============================================================================

-- ---- 1) Announcements: presentational + workflow columns ----
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS type               TEXT,
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'published'
                                              CHECK (status IN ('draft', 'published')),
  ADD COLUMN IF NOT EXISTS event_date         DATE,
  ADD COLUMN IF NOT EXISTS attachment_file_id BIGINT REFERENCES files (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements (status);
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements (created_by);

-- ---- 2) Notifications: per-user feed ----
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'general',
  title       TEXT        NOT NULL,
  body        TEXT,
  -- Optional deep link (app-relative path) + a lightweight source reference so
  -- the UI can route/dedupe without another join.
  link        TEXT,
  ref_type    TEXT,       -- e.g. 'announcement', 'note', 'assignment', 'message'
  ref_id      BIGINT,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed query: WHERE user_id = ? ORDER BY created_at DESC; unread count filter.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id) WHERE is_read = FALSE;
