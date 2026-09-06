-- =============================================================================
-- 007_messages_and_files.sql
-- -----------------------------------------------------------------------------
-- Realtime messaging + normalized file metadata.
--
--   * class_messages: add message_type (text/image/file/video) and file_id
--     (reference into the new `files` table). `message` stays for text content;
--     it becomes nullable so an attachment-only message is valid.
--   * files: ONE normalized metadata table for all class attachments (notes,
--     question papers, assignments, projects, messages). Binary bytes NEVER go
--     here — only metadata + a Firebase Storage reference (populated once
--     Storage is enabled; NULL/empty until then). entity_type + entity_id link
--     a file to its owning content row without duplicating columns everywhere.
--
-- Idempotent + additive. No data dropped. Wrapped in one transaction.
-- =============================================================================

-- ---- Normalized file metadata (Firebase Storage reference) ----
CREATE TABLE IF NOT EXISTS files (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id          BIGINT      REFERENCES classes (id) ON DELETE CASCADE,
  uploaded_by       BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  entity_type       TEXT        NOT NULL
                                CHECK (entity_type IN ('note','question_paper','assignment','project','message')),
  entity_id         BIGINT,     -- id of the owning content/message row (set after insert)
  original_filename TEXT,
  storage_path      TEXT,       -- Firebase Storage object path (null until uploaded)
  storage_provider  TEXT        NOT NULL DEFAULT 'firebase',
  mime_type         TEXT,
  size_bytes        BIGINT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','stored','failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_files_class ON files (class_id);

DROP TRIGGER IF EXISTS trg_files_updated_at ON files;
CREATE TRIGGER trg_files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- class_messages: message type + optional attachment ----
ALTER TABLE class_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE class_messages ADD COLUMN IF NOT EXISTS file_id BIGINT REFERENCES files (id) ON DELETE SET NULL;

-- Allow attachment-only messages (text becomes optional). Guarded so re-running
-- is safe even if already nullable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'class_messages' AND column_name = 'message' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE class_messages ALTER COLUMN message DROP NOT NULL;
  END IF;
END $$;

-- Constrain message_type to the supported set (added separately so the DEFAULT
-- backfill on existing rows doesn't violate it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'class_messages_message_type_check'
  ) THEN
    ALTER TABLE class_messages
      ADD CONSTRAINT class_messages_message_type_check
      CHECK (message_type IN ('text','image','file','video'));
  END IF;
END $$;
