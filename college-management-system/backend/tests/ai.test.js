/**
 * tests/ai.test.js — AI Assistant Phase 2 tests (built-in `node --test`).
 * -----------------------------------------------------------------------------
 * No live Gemini / DB required. We stub the database `query` with a spy so the
 * permission-filtering SQL can be asserted, and rely on the fact that the Gemini
 * key is not configured locally to test graceful degradation.
 *
 * Run: node --test   (from backend/)
 * -----------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

/* ------------------------------------------------------------------ */
/* Stub config/database.query BEFORE any repo requires it, so repos    */
/* capture our spy. We record the last SQL + params per call.          */
/* ------------------------------------------------------------------ */
const dbPath = require.resolve('../src/config/database');
const calls = [];
let nextRows = [];
const stubDb = {
  pool: {},
  query: async (text, params) => {
    calls.push({ text, params });
    return { rows: nextRows, rowCount: nextRows.length };
  },
  verifyConnection: async () => ({ ok: true }),
  closePool: async () => {},
};
require.cache[dbPath] = new Module(dbPath, module);
require.cache[dbPath].exports = stubDb;
require.cache[dbPath].loaded = true;

const aiRepository = require('../src/repositories/aiRepository');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const aiOrchestrator = require('../src/services/aiOrchestrator');
const geminiService = require('../src/services/geminiService');

function lastSql() { return calls[calls.length - 1].text; }
function lastParams() { return calls[calls.length - 1].params; }

/* ============================ RAG permission scope ======================= */

test('RAG scope: student query filters to public OR own academic group', async () => {
  nextRows = [];
  await aiRepository.searchChunks({
    embedding: [0.1, 0.2, 0.3],
    scope: { role: 'student', studentGroup: { program: 'B.Tech', branch: 'CSE', semester: 3 } },
    topK: 5,
  });
  const sql = lastSql();
  const params = lastParams();
  assert.match(sql, /access_scope = 'public'/, 'must allow public chunks');
  assert.match(sql, /access_scope = 'class'/, 'must gate class chunks');
  assert.match(sql, /program = \$/, 'must bind program');
  assert.match(sql, /branch = \$/, 'must bind branch');
  assert.match(sql, /semester = \$/, 'must bind semester');
  assert.ok(params.includes('B.Tech') && params.includes('CSE') && params.includes(3),
    'student group values must be bound as parameters');
});

test('RAG scope: faculty query filters to public OR owned classes', async () => {
  nextRows = [];
  await aiRepository.searchChunks({
    embedding: [0.1], scope: { role: 'faculty', classIds: [11, 22] }, topK: 5,
  });
  const sql = lastSql();
  assert.match(sql, /class_id = ANY/, 'faculty scope must restrict to owned class ids');
  assert.ok(lastParams().some((p) => Array.isArray(p) && p.includes(11)), 'class ids bound as array param');
});

test('RAG scope: admin sees all chunks (WHERE TRUE)', async () => {
  nextRows = [];
  await aiRepository.searchChunks({ embedding: [0.1], scope: { role: 'admin' }, topK: 5 });
  assert.match(lastSql(), /WHERE TRUE/, 'admin scope should not filter');
});

test('RAG scope: unknown/no role falls back to public-only', async () => {
  nextRows = [];
  await aiRepository.searchChunks({ embedding: [0.1], scope: { role: 'none' }, topK: 5 });
  const sql = lastSql();
  assert.match(sql, /access_scope = 'public'/);
  assert.doesNotMatch(sql, /WHERE TRUE/);
});

/* ==================== conversation ownership isolation =================== */

test('findConversationForUser binds BOTH id AND user_id (ownership)', async () => {
  nextRows = [];
  await aiRepository.findConversationForUser(50, 7);
  assert.match(lastSql(), /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(lastParams(), [50, 7]);
});

test('deleteConversation is scoped to the owner (id AND user_id)', async () => {
  nextRows = [];
  await aiRepository.deleteConversation(50, 7);
  assert.match(lastSql(), /DELETE FROM ai_conversations WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(lastParams(), [50, 7]);
});

test('renameConversation is scoped to the owner (id AND user_id)', async () => {
  nextRows = [];
  await aiRepository.renameConversation(50, 7, 'New title');
  assert.match(lastSql(), /WHERE id = \$1 AND user_id = \$2/);
  assert.equal(lastParams()[0], 50);
  assert.equal(lastParams()[1], 7);
});

test('orchestrator.getConversation returns null when not owned (no leak)', async () => {
  // findConversationForUser returns [] (row not owned) -> null, and we never
  // proceed to fetch messages.
  nextRows = [];
  const result = await aiOrchestrator.getConversation({ id: 999, role: 'student' }, 50);
  assert.equal(result, null);
});

/* ========================= tool authorization design ===================== */

test('no AI tool accepts a user/role/id parameter (no impersonation)', () => {
  const decls = aiToolRegistry.toolDeclarations()[0].functionDeclarations;
  const leaks = decls.filter((d) => {
    const props = (d.parameters && d.parameters.properties) || {};
    return Object.keys(props).some((k) => /^(user|userid|user_id|role|firebase|studentid|facultyid)/i.test(k));
  });
  assert.equal(leaks.length, 0, 'tools must derive identity server-side, never from args');
});

test('AI toolset is READ-ONLY (no create/update/delete/write tools)', () => {
  const names = aiToolRegistry.toolNames();
  const writeish = names.filter((n) => /create|update|delete|remove|add|edit|approve|reject|send|set|write|modify/i.test(n));
  assert.equal(writeish.length, 0, `no write/action tools allowed, found: ${writeish.join(', ')}`);
});

test('executeTool refuses when there is no authenticated user', async () => {
  const r = await aiToolRegistry.executeTool('get_my_classes', {}, {});
  assert.ok(r && r.error === 'Not authenticated.');
});

test('executeTool rejects an unknown tool name', async () => {
  const r = await aiToolRegistry.executeTool('run_sql', { user: { id: 1 } }, {});
  assert.match(r.error, /Unknown tool/);
});

test('there is no raw-SQL / execute-SQL tool exposed', () => {
  const names = aiToolRegistry.toolNames().join(',').toLowerCase();
  assert.doesNotMatch(names, /sql|query|exec|raw/);
});

/* ===================== graceful degradation (no key) ===================== */

test('Gemini is not configured in the test env', () => {
  assert.equal(geminiService.isEnabled(), false);
});

test('orchestrator.ask degrades gracefully with no Gemini key (no throw, no secret)', async () => {
  const res = await aiOrchestrator.ask({
    user: { id: 1, role: 'student', firebase_uid: 'x' },
    message: 'hello',
  });
  assert.equal(res.degraded, true);
  assert.equal(typeof res.answer, 'string');
  assert.doesNotMatch(JSON.stringify(res).toLowerCase(), /gemini_api_key|apikey|private_key/);
});

/* ===================== system prompt hardening =========================== */

test('system prompt enforces read-only, anti-hallucination and confidentiality', () => {
  const p = aiOrchestrator.buildSystemPrompt({ role: 'student', display_name: 'A' }, { name: 'A', group: 'B.Tech CSE, sem 3' });
  assert.match(p, /READ-ONLY/);
  assert.match(p, /NEVER invent/);
  assert.match(p, /Never reveal/i);
  assert.match(p, /STUDENT/);
  // No sensitive identifier VALUES leaked into the prompt (the words may appear
  // in the read-only rules, e.g. "changing roles/passwords" — that's fine).
  assert.doesNotMatch(p, /firebase_uid|GEMINI_API_KEY|private_key/i);
});
