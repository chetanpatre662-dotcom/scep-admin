-- =============================================================================
-- 011_ai_documents.sql
-- -----------------------------------------------------------------------------
-- Phase 2: a registry for STANDALONE college documents an admin uploads
-- specifically for the AI knowledge base (as opposed to class-attached content
-- like notes/question papers, which already live in their own tables and are
-- indexed via ai_document_chunks with source_type in those categories).
--
-- Purely ADDITIVE — migration 010 is NOT modified. No existing data touched.
--
-- Separation of concerns:
--   - The original uploaded bytes live in Firebase Storage; their metadata lives
--     in the existing `files` table (files.id referenced here as file_id).
--   - This table holds the AI-specific registry entry + indexing status.
--   - The extracted text + embeddings live in ai_document_chunks
--     (source_type='document', source_id = ai_documents.id).
--
-- Deleting an ai_documents row cascades to its chunks (source rows) via the
-- application layer; the underlying Firebase file is only removed when the
-- admin explicitly asks (handled in the service), so AI metadata and original
-- file storage stay decoupled.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_documents (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         TEXT        NOT NULL,
  -- The stored original file (Firebase) this document was built from.
  file_id       BIGINT      REFERENCES files (id) ON DELETE SET NULL,
  original_filename TEXT,
  mime_type     TEXT,
  size_bytes    BIGINT,
  -- ---- Permission / scope metadata (mirrors ai_document_chunks) ----
  --  'public' => any authenticated user may retrieve it.
  --  'class'  => restricted to the given academic group (program/branch/sem).
  access_scope  TEXT        NOT NULL DEFAULT 'public'
                            CHECK (access_scope IN ('public', 'class')),
  program       TEXT,
  branch        TEXT,
  semester      SMALLINT,
  class_id      BIGINT      REFERENCES classes (id) ON DELETE SET NULL,
  -- ---- Indexing status (observable in the admin UI; never faked) ----
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'indexed', 'failed', 'skipped')),
  index_error   TEXT,       -- populated with the reason when status='failed'/'skipped'
  chunks_count  INTEGER     NOT NULL DEFAULT 0,
  uploaded_by   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_documents_status ON ai_documents (status);
CREATE INDEX IF NOT EXISTS idx_ai_documents_scope
  ON ai_documents (access_scope, program, branch, semester);
CREATE INDEX IF NOT EXISTS idx_ai_documents_created ON ai_documents (created_at DESC);

DROP TRIGGER IF EXISTS trg_ai_documents_updated_at ON ai_documents;
CREATE TRIGGER trg_ai_documents_updated_at
  BEFORE UPDATE ON ai_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Allow standalone AI documents in the existing files metadata table ----
-- The `files` table (migration 007) constrains entity_type to class content
-- kinds. Standalone AI documents need their own entity_type = 'ai_document'.
-- Rebuild the CHECK constraint to ADD that value (guarded + idempotent). This
-- is additive: existing values remain valid, no rows are affected.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_entity_type_check') THEN
    ALTER TABLE files DROP CONSTRAINT files_entity_type_check;
  END IF;
  ALTER TABLE files
    ADD CONSTRAINT files_entity_type_check
    CHECK (entity_type IN ('note','question_paper','assignment','project','message','ai_document'));
END $$;
