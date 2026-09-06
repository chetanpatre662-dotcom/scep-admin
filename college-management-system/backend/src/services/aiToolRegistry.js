/**
 * services/aiToolRegistry.js
 * -----------------------------------------------------------------------------
 * The controlled, READ-ONLY toolbox the AI orchestrator exposes to Gemini.
 *
 * SECURITY MODEL (critical):
 *   - Gemini NEVER touches PostgreSQL. It can only request one of these named
 *     tools with a small, validated argument object.
 *   - Every tool's execute() receives the AUTHENTICATED DB user (resolved from
 *     the verified Firebase token by the orchestrator) as `ctx.user`. Identity
 *     (userId / role / academic group) is taken ONLY from that server-side
 *     object — NEVER from tool arguments. A student cannot pass another user's
 *     id to read their data because no tool accepts a user id at all.
 *   - Authorization is delegated to the EXISTING services (classService,
 *     portalService, announcementService, ...) which already enforce
 *     admin/faculty-owner/student-group rules. This registry adds no new
 *     access path — it is a thin, safe adapter over vetted logic.
 *   - Read-only: there are no create/update/delete tools. Action tools are a
 *     deliberate future phase gated on explicit confirmation.
 *   - No raw SQL is ever exposed to the model.
 *
 * Each tool = {
 *   declaration: Gemini functionDeclaration (name/description/parameters),
 *   execute(ctx, args) -> JSON-serializable result (already permission-scoped)
 * }
 * `ctx` = { user }  where user is the DB users row (id, role, status, email, ...)
 * -----------------------------------------------------------------------------
 */
'use strict';

const classService = require('./classService');
const classContentService = require('./classContentService');
const portalService = require('./portalService');
const announcementService = require('./announcementService');
const eventService = require('./eventService');
const profileService = require('./profileService');
const ragService = require('./ragService'); // used by search_college_documents

/* --------------------------------- helpers -------------------------------- */

/** Clamp a numeric arg into [min,max] with a default. */
function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Case-insensitive substring filter over selected fields. */
function textMatch(item, q, fields) {
  if (!q) return true;
  const needle = String(q).toLowerCase();
  return fields.some((f) => String(item[f] || '').toLowerCase().includes(needle));
}

/* ---------------------------------- tools --------------------------------- */

const TOOLS = {
  /* ------------------------------ profile ------------------------------ */
  get_my_profile: {
    declaration: {
      name: 'get_my_profile',
      description:
        "Get the CURRENT authenticated user's own Askbook profile (name, role, " +
        'and — for students — course/branch/semester/roll; for faculty — ' +
        'department/designation). Use when the user asks about their own account, ' +
        'course, branch, or semester. Never returns another user.',
      parameters: { type: 'object', properties: {} },
    },
    async execute(ctx) {
      // profileService keys off the Firebase UID, not a client id.
      const profile = await profileService.getMyProfile(ctx.user.firebase_uid);
      return { profile };
    },
  },

  /* ------------------------------ classes ------------------------------ */
  get_my_classes: {
    declaration: {
      name: 'get_my_classes',
      description:
        "List the classes the CURRENT user is part of. For a student these are " +
        'the classes matching their course+branch+semester; for a faculty these ' +
        'are the classes they own. Use for questions like "my classes", "my ' +
        'subjects this semester". Returns class id, subject, course, branch, ' +
        'semester, faculty.',
      parameters: {
        type: 'object',
        properties: {
          includeArchived: {
            type: 'boolean',
            description: 'Include archived classes (default false).',
          },
        },
      },
    },
    async execute(ctx, args = {}) {
      const { user } = ctx;
      let classes;
      if (user.role === 'student') {
        classes = await classService.listForStudent(user);
      } else if (user.role === 'faculty' || user.role === 'admin') {
        classes = await classService.listForFaculty(user);
      } else {
        classes = [];
      }
      if (!args.includeArchived) {
        classes = classes.filter((c) => c.status !== 'archived');
      }
      return {
        count: classes.length,
        classes: classes.map((c) => ({
          id: c.id,
          subject: c.subject || c.title,
          course: c.course || c.program,
          branch: c.branch,
          semester: c.semester,
          faculty: c.facultyName || null,
          status: c.status,
        })),
      };
    },
  },

  /* --------------------------- question papers -------------------------- */
  get_my_question_papers: {
    declaration: {
      name: 'get_my_question_papers',
      description:
        'List the question papers available to the CURRENT user, scoped to their ' +
        'classes (student: their course+branch+semester; faculty: their classes). ' +
        'Optionally filter by subject name, year, or semester. Use for "show M1 ' +
        'papers", "previous year papers", "question papers for <subject>". Returns ' +
        'paper id, title, subject, year, semester, and whether a file is attached.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Filter by subject/title substring (e.g. "M1", "Mathematics").' },
          year: { type: 'integer', description: 'Filter by exam year (e.g. 2024).' },
          semester: { type: 'integer', description: 'Filter by semester (1-8).' },
          limit: { type: 'integer', description: 'Max papers to return (default 20, max 50).' },
        },
      },
    },
    async execute(ctx, args = {}) {
      const { user } = ctx;
      let papers;
      if (user.role === 'student') {
        papers = await portalService.questionPapersForStudent(user);
      } else if (user.role === 'faculty' || user.role === 'admin') {
        papers = await portalService.questionPapersForFaculty(user);
      } else {
        papers = [];
      }
      if (args.subject) papers = papers.filter((p) => textMatch(p, args.subject, ['subject', 'title']));
      if (args.year != null) papers = papers.filter((p) => Number(p.year) === Number(args.year));
      if (args.semester != null) papers = papers.filter((p) => Number(p.semester) === Number(args.semester));
      const limit = clampInt(args.limit, 20, 1, 50);
      const sliced = papers.slice(0, limit);
      return {
        count: sliced.length,
        totalMatched: papers.length,
        papers: sliced.map((p) => ({
          id: p.id,
          title: p.title,
          subject: p.subject,
          year: p.year,
          semester: p.semester,
          course: p.course,
          branch: p.branch,
          hasFile: Boolean(p.file && p.file.id),
          fileId: p.file && p.file.id ? p.file.id : null,
        })),
      };
    },
  },

  /* ---------------------------- announcements --------------------------- */
  search_announcements: {
    declaration: {
      name: 'search_announcements',
      description:
        'Search Askbook announcements/notices visible to the CURRENT user ' +
        '(students see published announcements targeted to their group; ' +
        'faculty/admin see the ones they manage). Optionally filter by a keyword ' +
        'or type. Use for "any notices?", "latest announcements", "circular about ' +
        'exams". Returns title, type, a short excerpt, audience and date.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to match in title/description.' },
          type: { type: 'string', description: 'Filter by announcement type (e.g. "Exam", "General").' },
          limit: { type: 'integer', description: 'Max results (default 10, max 25).' },
        },
      },
    },
    async execute(ctx, args = {}) {
      const { user } = ctx;
      let items =
        user.role === 'student'
          ? await announcementService.listForStudent(user)
          : await announcementService.listForFaculty(user);
      // Students only ever see published (listForStudent already enforces this);
      // for faculty/admin hide drafts from the assistant view for safety.
      items = items.filter((a) => a.status !== 'draft');
      if (args.query) items = items.filter((a) => textMatch(a, args.query, ['title', 'description', 'type']));
      if (args.type) items = items.filter((a) => String(a.type || '').toLowerCase() === String(args.type).toLowerCase());
      const limit = clampInt(args.limit, 10, 1, 25);
      const sliced = items.slice(0, limit);
      return {
        count: sliced.length,
        totalMatched: items.length,
        announcements: sliced.map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          excerpt: String(a.description || '').slice(0, 240),
          audience: a.audience,
          author: a.authorName,
          date: a.created,
        })),
      };
    },
  },

  /* -------------------------------- events ------------------------------ */
  search_events: {
    declaration: {
      name: 'search_events',
      description:
        'Search Askbook college events (seminars, fests, workshops). Events are ' +
        'global to all authenticated users. Optionally filter by keyword or type, ' +
        'or restrict to upcoming events only. Use for "upcoming events", "any ' +
        'seminars?", "events this month". Returns title, type, date/time, venue.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to match in title/description.' },
          type: { type: 'string', description: 'Filter by event type.' },
          upcomingOnly: { type: 'boolean', description: 'Only future events (default false).' },
          limit: { type: 'integer', description: 'Max results (default 10, max 25).' },
        },
      },
    },
    async execute(ctx, args = {}) {
      let items = await eventService.listEvents({ status: 'active' });
      if (args.query) items = items.filter((e) => textMatch(e, args.query, ['title', 'description', 'type', 'venue']));
      if (args.type) items = items.filter((e) => String(e.type || '').toLowerCase() === String(args.type).toLowerCase());
      if (args.upcomingOnly) {
        const now = Date.now();
        items = items.filter((e) => e.datetime && new Date(e.datetime).getTime() >= now);
      }
      const limit = clampInt(args.limit, 10, 1, 25);
      const sliced = items.slice(0, limit);
      return {
        count: sliced.length,
        totalMatched: items.length,
        events: sliced.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          datetime: e.datetime,
          venue: e.venue,
          excerpt: String(e.description || '').slice(0, 200),
        })),
      };
    },
  },

  /* --------------------------- class content ---------------------------- */
  get_class_content: {
    declaration: {
      name: 'get_class_content',
      description:
        'List content items (notes, question papers, assignments, or projects) ' +
        'for a SPECIFIC class the current user is authorized to access. You must ' +
        'provide a classId (get it from get_my_classes first) and a contentType. ' +
        'Access is enforced server-side: students must belong to the class group; ' +
        'faculty must own it. Use for "assignments in my DBMS class", "notes for ' +
        'class 12".',
      parameters: {
        type: 'object',
        properties: {
          classId: { type: 'integer', description: 'The class id (from get_my_classes).' },
          contentType: {
            type: 'string',
            enum: ['note', 'question_paper', 'assignment', 'project'],
            description: 'Which kind of content to list.',
          },
          limit: { type: 'integer', description: 'Max items (default 20, max 50).' },
        },
        required: ['classId', 'contentType'],
      },
    },
    async execute(ctx, args = {}) {
      const classId = Number(args.classId);
      const type = String(args.contentType || '');
      if (!Number.isInteger(classId) || classId <= 0) {
        return { error: 'A valid classId is required.' };
      }
      if (!['note', 'question_paper', 'assignment', 'project'].includes(type)) {
        return { error: 'contentType must be one of note, question_paper, assignment, project.' };
      }
      // classContentService.list -> classService.getClassForUser (THE access gate).
      const items = await classContentService.list(ctx.user, classId, type);
      const limit = clampInt(args.limit, 20, 1, 50);
      const sliced = items.slice(0, limit);
      return {
        count: sliced.length,
        totalMatched: items.length,
        contentType: type,
        classId,
        items: sliced.map((it) => ({
          id: it.id,
          title: it.title,
          description: it.description ? String(it.description).slice(0, 240) : null,
          dueDate: it.dueDate || null,
          hasFile: Boolean(it.file && it.file.id),
          fileId: it.file && it.file.id ? it.file.id : null,
          createdAt: it.createdAt,
        })),
      };
    },
  },

  /* --------------------- RAG over college documents --------------------- */
  search_college_documents: {
    declaration: {
      name: 'search_college_documents',
      description:
        'Semantic search over the text INSIDE Askbook documents the current user ' +
        'is authorized to see (notes, question papers, assignments, projects, ' +
        'plus public announcements/events). Returns the most relevant text ' +
        'excerpts WITH their source document, so you can answer grounded, ' +
        'cite sources, and analyze/compare content (e.g. repeated question-paper ' +
        'topics). Use this for any question about what a document CONTAINS, not ' +
        'just its title. If nothing relevant is found, say the information is not ' +
        'available in Askbook.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for inside the documents.' },
          sourceType: {
            type: 'string',
            enum: ['note', 'question_paper', 'assignment', 'project', 'announcement', 'event'],
            description: 'Optional: restrict search to one document type (e.g. question_paper).',
          },
          subject: { type: 'string', description: 'Optional subject hint (e.g. "M1").' },
          topK: { type: 'integer', description: 'Max excerpts to retrieve (default 6, max 12).' },
        },
        required: ['query'],
      },
    },
    async execute(ctx, args = {}) {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'A search query is required.' };
      const topK = clampInt(args.topK, 6, 1, 12);
      // ragService applies permission filtering in SQL BEFORE returning chunks.
      const result = await ragService.retrieve(ctx.user, {
        query,
        sourceType: args.sourceType || null,
        subject: args.subject || null,
        topK,
      });
      return result; // { chunks:[{text,source,...}], sources:[...] }
    },
  },
};

/** Gemini `tools` payload: all function declarations in one entry. */
function toolDeclarations() {
  return [{ functionDeclarations: Object.values(TOOLS).map((t) => t.declaration) }];
}

/** List of tool names (for logging/metadata). */
function toolNames() {
  return Object.keys(TOOLS);
}

/**
 * Execute a named tool with authorization + validation. Never throws to the
 * caller for expected/authorization errors — returns a structured, model-safe
 * result so the orchestrator can feed it back to Gemini. Unexpected errors are
 * logged server-side and returned as a generic tool error (no internals leak).
 *
 * @param {string} name
 * @param {object} ctx  - { user } (authenticated DB user)
 * @param {object} args - model-supplied arguments (validated per tool)
 * @returns {Promise<object>} JSON-serializable tool result
 */
async function executeTool(name, ctx, args = {}) {
  const tool = TOOLS[name];
  if (!tool) {
    return { error: `Unknown tool: ${name}` };
  }
  if (!ctx || !ctx.user || !ctx.user.id) {
    return { error: 'Not authenticated.' };
  }
  try {
    return await tool.execute(ctx, args || {});
  } catch (err) {
    // ApiError carries a safe, client-facing message (e.g. 403 forbidden). Pass
    // that back to the model so it can explain politely. For anything else,
    // return a generic message and log the detail for developers.
    if (err && err.isOperational) {
      return { error: err.message, code: err.code || null };
    }
    console.error(`[ai] tool "${name}" failed:`, err && err.message);
    return { error: 'That lookup could not be completed right now.' };
  }
}

module.exports = { TOOLS, toolDeclarations, toolNames, executeTool };
