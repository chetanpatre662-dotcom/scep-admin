-- =============================================================================
-- 005_events.sql
-- -----------------------------------------------------------------------------
-- GLOBAL institute events. A single shared dataset: every authenticated faculty
-- and student reads the SAME events (no per-user event tables, no user_id
-- filtering on reads).
--
--   created_by references the creating user (ON DELETE SET NULL keeps the event
--   if the creator is later removed). created_by_name is a denormalized display
--   label so events still show an author after user changes.
--
-- Idempotent + additive. Wrapped in one transaction by the migration runner.
-- =============================================================================

CREATE TABLE IF NOT EXISTS events (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title           TEXT        NOT NULL,
  type            TEXT,
  description     TEXT,
  event_date      DATE        NOT NULL,
  start_time      TIME,
  end_time        TIME,
  location        TEXT,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived')),
  created_by      BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_event_date ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_status     ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events (created_by);

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
