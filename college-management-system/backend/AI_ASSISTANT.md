# Askbook AI Assistant

A production, server-side AI Assistant built into the existing Askbook college
management system. It uses Google Gemini for generation + embeddings, PostgreSQL
`pgvector` for retrieval-augmented generation (RAG), controlled tool/function
calling over the existing services, role-based authorization, conversation
memory, and strict anti-hallucination + read-only rules.

It is **not** a generic chatbot: it answers using Askbook's real data and
documents, scoped to what each authenticated user is allowed to see.

> **Security first:** the `GEMINI_API_KEY` is read only on the server
> (`config/env.js`), sent to Gemini via a request header, and **never** exposed
> to the frontend, browser JavaScript, HTML, localStorage, logs, or API
> responses. Do not paste a real key into this document or any committed file.

---

## 1. Architecture

```
Frontend chat UI (js/common/aiAssistant.js)
  -> POST /api/ai/chat            (Firebase auth; userId/role NEVER from body)
    -> aiOrchestrator             (loads user ctx + memory, grounded prompt)
      -> geminiService            (Gemini generate / tool-calling / embeddings)
        -> aiToolRegistry         (7 READ-ONLY tools; authz via existing services)
        -> ragService             (permission-filtered vector retrieval)
          -> aiRepository         (pgvector KNN + conversation memory; SQL only)
          -> PostgreSQL (pgvector)
    <- grounded answer + source references
  <- rendered answer + "Sources" links
```

**Files added**

| File | Purpose |
|------|---------|
| `src/services/geminiService.js` | The only place we call Gemini (REST over native `fetch`). generate / generateWithTools / embed / embedBatch, with timeout, retry, error mapping. |
| `src/services/aiToolRegistry.js` | 7 read-only tools + Gemini function declarations. Delegates authorization to existing services. |
| `src/services/ragService.js` | Permission-scoped retrieval: embeds the query, resolves the caller's access scope, returns chunks + sources. |
| `src/services/embeddingService.js` | Text extraction (PDF/DOCX/TXT), normalization, chunking, hashing, batch embedding. |
| `src/services/documentIngestService.js` | Ingestion pipeline: download -> extract -> chunk -> embed -> upsert. Fails loudly. |
| `src/services/aiOrchestrator.js` | The brain: context, grounded prompt, tool-calling loop, sources, conversation memory. |
| `src/repositories/aiRepository.js` | Data-access for conversations, messages, and the vector index (parameterized SQL only). |
| `src/routes/ai.routes.js` | `POST /api/ai/chat`, `GET /api/ai/conversations`, admin `POST /api/ai/ingest`. |
| `migrations/010_ai_assistant.sql` | pgvector extension + `ai_conversations`, `ai_messages`, `ai_document_chunks`. |

**Files modified**

- `src/config/env.js` — added the `env.ai` config group.
- `src/routes/index.js` — mounted the AI router.
- `src/services/storageService.js` — added `downloadBuffer()` for server-side bytes.
- `package.json` — added `pdf-parse` and `mammoth`.
- Frontend: `js/services/aiService.js` (calls the backend), `js/common/aiAssistant.js` (renders sources + threads conversation), `css/features.css` (source styles).

---

## 2. Environment variables

Add these to `backend/.env` (see `backend/.env.example` for the documented
template). Only `GEMINI_API_KEY` is required to enable the assistant.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes (to enable) | *(empty)* | Google Gemini API key. **Secret.** Empty ⇒ assistant is cleanly disabled and endpoints return a friendly "not configured" message. Get one at https://aistudio.google.com/app/apikey |
| `GEMINI_MODEL` | No | `gemini-1.5-flash` | Generative/chat/tool-calling model. |
| `GEMINI_EMBEDDING_MODEL` | No | `text-embedding-004` | Embedding model for RAG. |
| `GEMINI_EMBEDDING_DIM` | No | `768` | Vector dimension. **Must match the embedding model** and the `vector(N)` column in migration 010 (`text-embedding-004` = 768). |
| `GEMINI_API_BASE_URL` | No | `https://generativelanguage.googleapis.com/v1beta` | Gemini REST base (bump the API version here). |
| `GEMINI_TIMEOUT_MS` | No | `30000` | Per-request timeout. |
| `GEMINI_MAX_RETRIES` | No | `2` | Retries on transient 429/5xx. |
| `AI_MAX_TOOL_TURNS` | No | `4` | Max Gemini tool-calling round-trips per question (cost guard). |
| `AI_HISTORY_TURNS` | No | `8` | How many prior messages are sent as conversation memory. |
| `AI_RAG_TOP_K` | No | `6` | Max document chunks retrieved per RAG query. |

RAG also relies on the **existing** Firebase Storage config
(`FIREBASE_STORAGE_BUCKET`) for server-side document downloads during ingestion.

---

## 3. pgvector setup (deployment prerequisite)

The RAG index uses the PostgreSQL `pgvector` extension. It must be **installed on
the database server** before migration 010 runs.

**Install pgvector** (once, on the DB server):

- Debian/Ubuntu: `sudo apt install postgresql-16-pgvector` (match your PG major version)
- Or build from source: https://github.com/pgvector/pgvector
- Managed providers (RDS/Cloud SQL/Supabase/Neon) usually offer it — enable it in the console.

Migration 010 runs `CREATE EXTENSION IF NOT EXISTS vector;`. This needs a role
with privilege to create the extension (superuser, or a role granted it). If the
extension is not present on the server, the migration fails cleanly and rolls
back — **no other migration or existing data is affected**. Install pgvector,
then re-run migrations.

---

## 4. Database migration

Migration `010_ai_assistant.sql` is additive and idempotent. Run it with the
existing runner:

```bash
cd backend
npm run migrate          # apply pending migrations
npm run migrate:status   # list applied/pending
```

Tables created:

- **`ai_conversations`** — one chat thread per row, owned by a user (`user_id`).
- **`ai_messages`** — user/assistant turns (`role`, `content`, `sources` JSONB, `metadata` JSONB). Conversation memory.
- **`ai_document_chunks`** — the RAG index: `chunk_text`, `embedding vector(768)`, `content_hash`, plus permission metadata (`source_type`, `source_id`, `file_id`, `class_id`, `program`, `branch`, `semester`, `access_scope`). Unique on `(source_type, source_id, chunk_index)` for idempotent re-ingestion; `ivfflat` cosine index on `embedding`.

---

## 5. Document ingestion (RAG index build)

Ingestion is **admin-triggered** (not automatic on upload in this read-only
phase) so it stays explicit and observable. It reads existing class content
(notes / question papers / assignments / projects) that have a **stored file**,
extracts text, chunks, embeds, and writes the chunks with scope metadata.

**Endpoint:** `POST /api/ai/ingest` (admin only). Examples:

```jsonc
// Ingest ALL supported types (notes, question_papers, assignments, projects)
{}

// Ingest one type, optionally limited to a class
{ "sourceType": "question_paper", "classId": 12 }

// Ingest a single document
{ "sourceType": "note", "sourceId": 45 }
```

Response is a per-source report — each item is `indexed`, `skipped`, or `failed`
with a reason. **Nothing is faked:** an un-extractable or failed document is
reported as such, never marked indexed.

Supported extraction: `text/plain` (built-in), `application/pdf` (`pdf-parse`),
`.docx` (`mammoth`). Images/videos/`.doc`/`.ppt` are skipped with a reason
(not text-extractable here). Re-ingesting the same document replaces its chunks
(dedup by `content_hash` / unique chunk key), so embeddings are never duplicated.

**Re-indexing after changing the embedding model:** a `vector(N)` column's
dimension is fixed at DDL time. If you switch to a model with a different
dimension, add a **new** migration that alters the column type, update
`GEMINI_EMBEDDING_DIM`, then re-run `POST /api/ai/ingest`.

---

## 6. AI tools (read-only)

All identity is taken from the authenticated DB user — **no tool accepts a user
id**, so a user cannot fetch another user's data. Each tool delegates to an
existing service that already enforces authorization.

| Tool | What it returns | Authorization |
|------|-----------------|---------------|
| `get_my_profile` | The caller's own profile | Keyed by the caller's Firebase UID |
| `get_my_classes` | Classes the caller is in | Student group / faculty ownership |
| `get_my_question_papers` | Question papers available to the caller (filter by subject/year/semester) | `portalService` scoping |
| `search_announcements` | Announcements visible to the caller | Student targeted+published / faculty own |
| `search_events` | Active college events (global) | Any authenticated user |
| `get_class_content` | Notes/QPs/assignments/projects for a class | `classService.getClassForUser` gate |
| `search_college_documents` | Semantic RAG over document text + sources | Permission-filtered in SQL before return |

There is **no raw-SQL tool** and no action (write) tool. Attendance/marks are
**not** available because Askbook does not store them — the assistant says so
rather than inventing data.

---

## 7. Permission model

Authorization is enforced **server-side in code**, never by the prompt:

- **Tools** call existing services (`classService`, `portalService`,
  `announcementService`, etc.) that re-check role + ownership + academic group.
- **RAG retrieval** filters chunks in SQL *before* any content reaches the model:
  - **Admin** — all chunks.
  - **Faculty** — `public` chunks OR chunks from classes they own.
  - **Student** — `public` chunks OR class chunks whose `program+branch+semester`
    equals the student's own group.
- **Conversations** are owned by `user_id`; a conversation id that isn't the
  caller's is ignored (a fresh thread starts) — no cross-user leakage.

The Gemini system prompt adds a second, defense-in-depth layer (anti-hallucination
+ read-only), but it is never the only control.

---

## 8. Conversation memory

- Each thread is an `ai_conversations` row; turns are `ai_messages`.
- The orchestrator sends only the last `AI_HISTORY_TURNS` (default 8) messages to
  Gemini — bounded to control cost/latency (not unlimited history).
- The frontend passes the returned `conversationId` back on the next question, so
  follow-ups ("which questions are repeated?", "solve question 3") keep context.

---

## 9. API endpoints

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/ai/chat` | Firebase | `{ message, conversationId? }` | `{ success, answer, sources[], conversationId, toolsUsed[], degraded }` |
| GET | `/api/ai/conversations` | Firebase | `?limit=` | `{ success, conversations[] }` |
| POST | `/api/ai/ingest` | Firebase + **admin** | see §5 | `{ success, result }` or `{ success, summary, results }` |

Errors follow the app convention: `{ success:false, message, code }`. No API
keys, DB details, stack traces, or raw tool output are returned to clients.

---

## 10. Frontend usage

The existing AI Assistant page (`{admin,faculty,student}/assistant.html`) renders
`renderAssistant()` from `js/common/aiAssistant.js`, which now calls the real
backend via `js/services/aiService.js`. Assistant answers show a **Sources**
block with real in-app links:

- Documents with a file → `GET /api/files/:id/download` (backend authorizes and
  302-redirects to a short-lived signed URL).
- Class-scoped items → the role's class detail page.

The frontend never sees Gemini or the API key; it only talks to the Askbook
backend. The UI is mobile-responsive (existing breakpoints) and degrades
gracefully when the assistant is disabled.

---

## 11. Deployment checklist

1. Install `pgvector` on the PostgreSQL server (see §3).
2. `cd backend && npm install` (installs `pdf-parse`, `mammoth`).
3. Set `GEMINI_API_KEY` (and any overrides) in `backend/.env`.
4. Ensure `FIREBASE_STORAGE_BUCKET` is set (needed for ingestion downloads).
5. `npm run migrate` to apply migration 010.
6. Restart the backend (e.g. `pm2 restart college-cms-backend`).
7. As an admin, call `POST /api/ai/ingest` to build the RAG index.

---

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Chat returns "AI Assistant is not enabled" | `GEMINI_API_KEY` is empty. Set it and restart. |
| `AI_AUTH_ERROR` in logs | Invalid/expired Gemini key. Rotate it. |
| Migration 010 fails on `CREATE EXTENSION vector` | pgvector not installed / insufficient privilege. Install it, use a privileged role, re-run. |
| RAG returns nothing / "document index is not available" | Migration not applied, or no documents ingested yet. Run migrate + `POST /api/ai/ingest`. |
| Ingestion reports `failed: ... requires "pdf-parse"/"mammoth"` | Optional dep missing. `npm install` in `backend`. |
| Ingestion reports `skipped: file type not text-extractable` | Image/video/`.doc`/`.ppt` — expected; only PDF/DOCX/TXT are extracted. |
| Answers are slow / time out | Lower `AI_MAX_TOOL_TURNS` / `AI_RAG_TOP_K`, raise `GEMINI_TIMEOUT_MS`, or use a faster model. |
| Follow-up questions lose context | Ensure the frontend sends back `conversationId` (it does by default). |

> Never log or commit the real `GEMINI_API_KEY`. Keep it only in `backend/.env`.

---

# Phase 2 — Conversation management, documents, markdown, hardening

Phase 2 builds on the Phase 1 foundation above. Everything is **additive and
backward-compatible**: the Phase 1 Gemini/RAG/tool-calling architecture is
unchanged. The AI remains strictly **read-only** and the `GEMINI_API_KEY` stays
server-side only.

## 1. Full conversation management (backend-persisted)

Conversations now live in PostgreSQL (`ai_conversations` / `ai_messages`) instead
of browser localStorage. The chat UI loads history, opens/continues a thread,
renames and deletes — all scoped to the authenticated user.

New endpoints (all `requireAuth`, identity from the verified token):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ai/conversations` | List the caller's own threads |
| GET | `/api/ai/conversations/:id` | Load one thread **with messages** (owner only; 404 otherwise) |
| PATCH | `/api/ai/conversations/:id` | Rename (owner only) |
| DELETE | `/api/ai/conversations/:id` | Delete (owner only; messages cascade) |

Ownership is enforced in SQL (`WHERE id = $1 AND user_id = $2`), so a user can
never read, rename, or delete another user's conversation — a non-owned id is
indistinguishable from a missing one (404, no existence leak).

Frontend: `js/services/aiChatService.js` (backend client) + `js/common/aiAssistant.js`
(loading/empty/error states, retry, rename via a prompt dialog, delete with
confirmation, auto-scroll, Enter to send / Shift+Enter for newline).

## 2. Role-specific behavior

The orchestrator sends a **minimal, role-scoped** context line (no ids, emails,
or phone numbers) — just enough for the model to be helpful and correctly
scoped:

- **Student** — own profile + classes/papers/announcements/events/documents for
  their academic group.
- **Faculty** — own profile + owned classes and their content + public
  announcements/events.
- **Admin** — the administrative read-only view.

All three ask questions naturally ("meri classes kaun si hain?", "latest
announcements?", "is subject ke documents me kya hai?") and the model uses the
authorized tools/RAG. Authorization is always re-checked server-side.

## 3. Admin document management + RAG scoping

Admins can upload standalone documents into the AI knowledge base at
**Admin → AI Documents** (`admin/ai-documents.html`).

- Supported: **PDF, DOCX, TXT** (max 25 MB).
- Visibility scope set at upload time:
  - **Public** — any authenticated user can have the AI surface it.
  - **Class-scoped** — restricted to a `program` / `branch` / `semester` group.
- The admin table shows name, type, size, scope, **indexing status** (indexed /
  pending / failed / skipped), the chunk count, indexing error (if any), and the
  uploaded date. Re-index and delete are available per row.

Storage separation (important):

- The original file bytes go to Firebase Storage; metadata to the existing
  `files` table (`entity_type = 'ai_document'`, added in migration 011).
- The AI registry row lives in `ai_documents`; the extracted text + embeddings
  live in `ai_document_chunks` (`source_type = 'document'`).
- **Deleting** an AI document removes its registry row + its RAG chunks, and the
  underlying file **only because that file was uploaded specifically for the AI
  KB** (guarded by `entity_type = 'ai_document'`). It never touches class-content
  files. Pass `?keepFile=1` to preserve the stored file.

Retrieval permission filtering happens in SQL (`ai_document_chunks` +
`aiRepository.searchChunks`) **before** any chunk reaches the model, so a student
never receives a chunk from a document outside their scope.

Endpoints (admin only): `GET /api/ai/documents`, `POST /api/ai/documents`
(multipart), `POST /api/ai/documents/:id/reindex`, `DELETE /api/ai/documents/:id`.

## 4. Source rendering

Assistant answers show a **Sources** block. Each source shows a human label
(Note / Question Paper / Assignment / Project / Announcement / Event / Document),
the document title, and a section indicator when available. Links point to real
in-app routes only — the file download endpoint (`/api/files/:id/download`,
which authorizes then 302-redirects to a short-lived signed URL) or the class
detail page. No signed URLs, storage credentials, keys, or DB internals are ever
exposed. Tool-only answers (no document) show an understandable label without a
broken link.

## 5. Markdown rendering (XSS-safe)

Assistant text is rendered through `js/common/markdown.js` — a tiny,
**dependency-free, escape-first** renderer. Every character is HTML-escaped
*before* a small whitelist of formatting (headings, bold, italic, inline + fenced
code, lists, block quotes, GFM tables, horizontal rules, and links restricted to
`http`/`https`/`mailto`) is re-introduced. Raw HTML, images, and unsafe URL
schemes (`javascript:`, `data:`) are neutralized. This is the single sanitized
entry point for model output.

## 6. Error handling

Handled distinctly, with friendly user messages and server-only diagnostics
(never leaking keys, stack traces, SQL, or infrastructure):

- Gemini not configured → clear "AI not enabled" message (degraded mode).
- Gemini unavailable / invalid key → 503 (mapped `AI_AUTH_ERROR`, logged).
- Timeout → 504; rate limit → retry then friendly "busy" message.
- Tool execution failure → the model is told the lookup failed; the user gets a
  helpful answer or a clear "couldn't complete that".
- RAG / pgvector unavailable → retrieval returns empty and the answer says the
  information isn't available (never fabricated).
- Document ingestion failure → recorded on the `ai_documents` row (`failed` +
  reason); never marked indexed.
- Unauthorized / expired auth → 401/403; the UI prompts re-sign-in.
- Network failure → friendly retry affordance in the chat.

## 7. Security model (recap)

- `GEMINI_API_KEY` server-side only; never in JS/HTML/CSS/localStorage/responses/logs.
- Identity always from the verified Firebase token — never from the request body
  or from tool arguments. No tool accepts a user/role/id parameter.
- Read-only: no create/update/delete/approve/reject tools; no raw-SQL tool.
- Permission filtering for tools (existing services) and RAG (SQL scope) both
  run server-side.
- Firebase credentials are never exposed.

## 8. Database (migration 011)

`011_ai_documents.sql` (additive; migration 010 untouched) adds the
`ai_documents` registry table (with indexes on status + scope + created) and
extends the `files.entity_type` CHECK to include `'ai_document'`. Conversation
cascades come from migration 010 (`ai_messages → ai_conversations ON DELETE
CASCADE`), and chunk dedup is guaranteed by the unique
`(source_type, source_id, chunk_index)` index; deleting a document removes its
chunks so nothing stays retrievable through RAG.

## 9. Testing

Automated tests run with Node's built-in runner (no new dependency):

```bash
cd backend
npm test          # node --test
```

`backend/tests/ai.test.js` + `backend/tests/markdown.test.mjs` cover: RAG scope
SQL for student/faculty/admin/none, conversation ownership isolation
(find/rename/delete + orchestrator returns null cross-user), no tool exposes a
user/role/id parameter, the toolset is read-only with no raw-SQL tool,
`executeTool` refusal without a user, Gemini-not-configured graceful degradation,
system-prompt hardening, and markdown XSS safety (script/img escaped,
`javascript:`/`data:` neutralized, safe links allowed). Current result: **23
passing**.

> These do not exercise a live Gemini call. End-to-end Gemini behavior requires a
> real `GEMINI_API_KEY` (see below).

## 10. Activating Gemini (no paid key required to implement)

Everything above is implemented and testable **without** a Gemini key. To turn
on live answers/embeddings, set `GEMINI_API_KEY` in `backend/.env` (Google AI
Studio provides a free tier), install `pgvector` on the database server, run
`npm run migrate`, restart the backend, and index documents via the Admin → AI
Documents page (or `POST /api/ai/ingest`). Until a key is set, the assistant
degrades gracefully and document uploads are stored but reported as not-yet-
indexed with a clear reason.
