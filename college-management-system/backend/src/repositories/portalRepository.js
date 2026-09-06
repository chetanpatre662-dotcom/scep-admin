/**
 * repositories/portalRepository.js
 * -----------------------------------------------------------------------------
 * Aggregate/read queries for dashboards + standalone question-paper listings.
 * Parameterized SQL only. Computes real counts from real tables (no fabrication).
 * -----------------------------------------------------------------------------
 */
'use strict';

const { query } = require('../config/database');

/* ---------------- Faculty dashboard aggregates ---------------- */

/** Counts scoped to the classes a faculty owns. */
async function facultyStats(facultyId) {
  const { rows } = await query(
    `WITH my_classes AS (
       SELECT id, program, branch, semester FROM classes WHERE faculty_id = $1
     )
     SELECT
       (SELECT COUNT(*) FROM my_classes) AS classes,
       (SELECT COUNT(*) FROM my_classes WHERE program IS NOT NULL) AS classes_all,
       (SELECT COUNT(*) FROM notes n            WHERE n.class_id IN (SELECT id FROM my_classes)) AS notes,
       (SELECT COUNT(*) FROM question_papers q  WHERE q.class_id IN (SELECT id FROM my_classes)) AS papers,
       (SELECT COUNT(*) FROM assignments a      WHERE a.class_id IN (SELECT id FROM my_classes)) AS assignments,
       (SELECT COUNT(*) FROM projects p         WHERE p.class_id IN (SELECT id FROM my_classes)) AS projects,
       (SELECT COUNT(DISTINCT s.id) FROM students s
          JOIN my_classes c ON s.program = c.program AND s.branch = c.branch AND s.semester = c.semester
       ) AS students_reached`,
    [facultyId]
  );
  return rows[0];
}

/** Published-announcement count authored by a user. */
async function announcementCountByCreator(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM announcements WHERE created_by = $1 AND status = 'published'`,
    [userId]
  );
  return rows[0].n;
}

/* ---------------- Student dashboard aggregates ---------------- */

/** Counts scoped to the classes matching a student's academic group. */
async function studentStats({ program, branch, semester }) {
  const { rows } = await query(
    `WITH my_classes AS (
       SELECT id FROM classes
        WHERE program = $1 AND branch = $2 AND semester = $3
     )
     SELECT
       (SELECT COUNT(*) FROM my_classes) AS classes,
       (SELECT COUNT(*) FROM notes n           WHERE n.class_id IN (SELECT id FROM my_classes)) AS notes,
       (SELECT COUNT(*) FROM question_papers q WHERE q.class_id IN (SELECT id FROM my_classes)) AS papers,
       (SELECT COUNT(*) FROM assignments a     WHERE a.class_id IN (SELECT id FROM my_classes)) AS assignments,
       (SELECT COUNT(*) FROM projects p        WHERE p.class_id IN (SELECT id FROM my_classes)) AS projects`,
    [program, branch, Number(semester)]
  );
  return rows[0];
}

/* ---------------- Standalone question papers ---------------- */

const QP_COLS = `q.id, q.title, q.year, q.semester, q.class_id,
  q.file_url, q.file_name, q.file_type, q.created_at,
  c.program, c.branch, subj.name AS subject_name,
  f.id AS file_id, f.mime_type AS file_mime, f.size_bytes AS file_size`;

/** Question papers across the classes a faculty owns. */
async function questionPapersForFaculty(facultyId) {
  const { rows } = await query(
    `SELECT ${QP_COLS}
       FROM question_papers q
       JOIN classes c   ON c.id = q.class_id
       LEFT JOIN courses subj ON subj.id = c.course_id
       LEFT JOIN files f ON f.entity_type = 'question_paper' AND f.entity_id = q.id
      WHERE c.faculty_id = $1
      ORDER BY q.created_at DESC, q.id DESC`,
    [facultyId]
  );
  return rows;
}

/** Question papers across classes matching a student's academic group. */
async function questionPapersForStudent({ program, branch, semester }) {
  const { rows } = await query(
    `SELECT ${QP_COLS}
       FROM question_papers q
       JOIN classes c   ON c.id = q.class_id
       LEFT JOIN courses subj ON subj.id = c.course_id
       LEFT JOIN files f ON f.entity_type = 'question_paper' AND f.entity_id = q.id
      WHERE c.program = $1 AND c.branch = $2 AND c.semester = $3
      ORDER BY q.created_at DESC, q.id DESC`,
    [program, branch, Number(semester)]
  );
  return rows;
}

/* ---------------- Recent activity (faculty) ---------------- */

/** Recent content items across a faculty's classes (union, newest first). */
async function facultyRecentActivity(facultyId, limit = 8) {
  const { rows } = await query(
    `WITH my_classes AS (SELECT id FROM classes WHERE faculty_id = $1)
     SELECT * FROM (
       SELECT 'note' AS kind, id, title, created_at FROM notes           WHERE class_id IN (SELECT id FROM my_classes)
       UNION ALL
       SELECT 'question_paper', id, title, created_at FROM question_papers WHERE class_id IN (SELECT id FROM my_classes)
       UNION ALL
       SELECT 'assignment', id, title, created_at FROM assignments        WHERE class_id IN (SELECT id FROM my_classes)
       UNION ALL
       SELECT 'project', id, title, created_at FROM projects              WHERE class_id IN (SELECT id FROM my_classes)
     ) t ORDER BY created_at DESC LIMIT $2`,
    [facultyId, limit]
  );
  return rows;
}

module.exports = {
  facultyStats, announcementCountByCreator, studentStats,
  questionPapersForFaculty, questionPapersForStudent, facultyRecentActivity,
};
