-- =============================================================================
-- 010_ai_assistant.sql
-- -----------------------------------------------------------------------------
-- AI Assistant (Gemini + RAG) storage. Adds THREE new tables plus the pgvector
-- extension. Purely ADDITIVE — no existing table is altered, no data is
-- dropped. Runs in one transaction (the migration runner wraps it).
--
--   1. pgvector extension          — vector similarity search for RAG.
--   2. ai_conversations            — one row per chat thread (conversation
--                                    memory root), owned by a user.
--   3. ai_messages                 — user/assistant turns within a conversation
--                                    (persistent history + source refs).
--   4. ai_document_chunks          — RAG index: text chunks + embeddings +
--                                    permission/scope metadata for retrieval.
--
-- DEPLOYMENT PREREQUISITE
-- -----------------------------------------------------------------------------
-- `CREATE EXTENSION vector` requires the pgvector extension to be INSTALLED on
-- the PostgreSQL server (the `vector.control` files present) and sufficient
-- privilege (superuser, or a role granted CREATE on the database, depending on
-- the pgvector packaging). If the extension is not installed on the server this
-- migration will fail cleanly and roll back — install pgvector first
-- (see backend/AI_ASSISTANT.md) then re-run `npm run migrate`. No other
-- migration or existing data is affected by that failure.
--
-- EMBEDDING DIMENSION
-- -----------------------------------------------------------------------------
-- The embedding column is fixed at vector(768) to match the default Gemini
-- embedding model `text-embedding-004` (768 dims), which corresponds to
-- env.ai.embeddingDim. If you switch to an embedding model with a DIFFERENT
-- dimension, you must create a NEW migration that changes the column type and
-- re-run document ingestion (a vector column's dimension is fixed at DDL time).
-- =============================================================================

-- ---- 1) pgvector extension ----
CREATE EXTENSION IF NOT EXISTS vector;

-- ---- 2) ai_conversations: a chat thread owned by one user ----
CREATE TABLE IF NOT EXISTS ai_conversations (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT,                                   -- derived from first message
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- 3) ai_messages: user/assistant turns (conversation memory) ----
CREATE TABLE IF NOT EXISTS ai_messages (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT      NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
  -- 'user' = the human's question; 'assistant' = the AI's grounded answer.
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT        NOT NULL,
  -- Structured source references attached to an assistant answer (array of
  -- { type, id, title, ... }). NULL/'[]' for plain messages. Enables the UI to
  -- render "Sources:" links using REAL Askbook document ids/routes.
  sources         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Lightweight, non-sensitive metadata (e.g. tools used, token counts). Never
  -- stores secrets or raw tool output that would leak cross-user data.
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, created_at ASC);

-- ---- 4) ai_document_chunks: the RAG index ----
-- Each row is a chunk of extracted document text plus its embedding and the
-- metadata needed to (a) permission-filter retrieval BEFORE exposing content to
-- the model and (b) attach an accurate source reference to the answer.
CREATE TABLE IF NOT EXISTS ai_document_chunks (
  id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- What Askbook entity this chunk came from. Mirrors files.entity_type plus
  -- broader corpora (announcement/event) that may be indexed later.
  source_type   TEXT         NOT NULL
                             CHECK (source_type IN
                               ('note','question_paper','assignment','project',
                                'announcement','event','document')),
  -- The id of the owning content row (e.g. question_papers.id).
  source_id     BIGINT       NOT NULL,
  -- The files.id row this text was extracted from (when it came from a file).
  file_id       BIGINT       REFERENCES files (id) ON DELETE CASCADE,
  -- ---- Permission / scope metadata (used to filter retrieval server-side) ----
  -- class_id ties class-scoped content to derived membership. NULL => the chunk
  -- is not class-scoped (e.g. a global announcement/event).
  class_id      BIGINT       REFERENCES classes (id) ON DELETE CASCADE,
  program       TEXT,        -- academic-group scope (mirrors classes.program)
  branch        TEXT,
  semester      SMALLINT,
  -- 'class'  => visible to the class's academic group (+ owning faculty/admin)
  -- 'public' => visible to any authenticated user (announcements/events)
  access_scope  TEXT         NOT NULL DEFAULT 'class'
                             CHECK (access_scope IN ('class','public')),
  uploaded_by   BIGINT       REFERENCES users (id) ON DELETE SET NULL,
  -- ---- Source display + content ----
  title         TEXT,        -- document title (for "Sources:" display)
  chunk_index   INTEGER      NOT NULL DEFAULT 0,
  chunk_text    TEXT         NOT NULL,
  -- SHA-256 of (source_type|source_id|chunk_index|normalized text). Used to
  -- skip re-embedding unchanged chunks (cost control / idempotent ingestion).
  content_hash  TEXT         NOT NULL,
  embedding     vector(768)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per (source, chunk). Re-ingesting the same source upserts by this key
-- so embeddings are never duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_chunks_source_chunk
  ON ai_document_chunks (source_type, source_id, chunk_index);

-- Fast metadata pre-filtering before/with the vector search.
CREATE INDEX IF NOT EXISTS idx_ai_chunks_scope
  ON ai_document_chunks (access_scope, program, branch, semester);
CREATE INDEX IF NOT EXISTS idx_ai_chunks_class
  ON ai_document_chunks (class_id);
CREATE INDEX IF NOT EXISTS idx_ai_chunks_source
  ON ai_document_chunks (source_type, source_id);

-- Approximate nearest-neighbour index for cosine distance. ivfflat needs data
-- to build good lists; with an empty table it still works (falls back to a
-- sequential scan until populated + ANALYZEd). lists=100 is a reasonable
-- starting point for small/medium corpora.
CREATE INDEX IF NOT EXISTS idx_ai_chunks_embedding
  ON ai_document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

DROP TRIGGER IF EXISTS trg_ai_chunks_updated_at ON ai_document_chunks;
CREATE TRIGGER trg_ai_chunks_updated_at
  BEFORE UPDATE ON ai_document_chunks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
