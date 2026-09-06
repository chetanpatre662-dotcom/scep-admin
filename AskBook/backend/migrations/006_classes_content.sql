-- =============================================================================
-- 006_classes_content.sql
-- -----------------------------------------------------------------------------
-- Real class model + content tables (foundation for the realtime class system).
--
-- DESIGN (reuse, don't duplicate):
--   * A class already references its SUBJECT via classes.course_id -> courses(id)
--     (the `courses` table stores admin-managed subjects). We keep that FK as the
--     subject reference and simply add a `title` for a human-friendly class name.
--   * notes / question_papers / class_messages already exist with file-metadata
--     columns (file_url/file_name/file_type) — reused as-is.
--   * This migration ADDS the two missing content tables (assignments, projects)
--     mirroring the notes shape, plus indexes for realtime-friendly queries.
--
-- Firebase Storage integration, WebSocket delivery, and message-attachment
-- columns are intentionally NOT added here — they belong to later passes so we
-- don't create columns/tables ahead of a verified implementation.
--
-- Idempotent + additive. No data dropped. Wrapped in one transaction.
-- =============================================================================

-- Human-friendly class title (optional; subject name is the fallback in the app).
ALTER TABLE classes ADD COLUMN IF NOT EXISTS title TEXT;

-- Faster faculty message history + content lookups.
CREATE INDEX IF NOT EXISTS idx_class_messages_class_created2
  ON class_messages (class_id, created_at DESC);

-- =============================================================================
-- ASSIGNMENTS — faculty-published, scoped to a class.
-- =============================================================================
CREATE TABLE IF NOT EXISTS assignments (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id     BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  created_by   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  due_date     DATE,
  file_url     TEXT,       -- Firebase Storage reference (later pass)
  file_name    TEXT,
  file_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assignments_class_created ON assignments (class_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_assignments_updated_at ON assignments;
CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- PROJECTS — faculty-published, scoped to a class.
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id     BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  created_by   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  due_date     DATE,
  file_url     TEXT,
  file_name    TEXT,
  file_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_class_created ON projects (class_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
