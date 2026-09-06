-- =============================================================================
-- 003_subjects_on_courses.sql
-- -----------------------------------------------------------------------------
-- Academic hierarchy: Course (program) -> Branch -> Semester -> Subjects.
--
-- DESIGN DECISION (reuse, don't duplicate): the existing `courses` table
-- already models exactly "a named academic item within a program+branch+
-- semester" — which is precisely a SUBJECT. So subjects are stored in `courses`;
-- no new table is introduced.
--
-- Two adjustments make it fit admin-managed subjects cleanly:
--   1. `code` becomes NULLABLE — admins add a subject with just a name
--      (subject code is optional; preserved/used when provided).
--   2. Add a uniqueness rule that prevents DUPLICATE SUBJECT NAMES within the
--      same Course+Branch+Semester. This also guarantees B.Tech CSE Sem 3 and
--      Polytechnic CSE Sem 3 remain separate academic combinations, because
--      `program` (the Course) is part of the key.
--
-- Names are compared case-insensitively (LOWER) so "Data Structures" and
-- "data structures" cannot both exist in the same combination.
--
-- The original 001 constraint uq_courses_code_group (code, program, branch,
-- semester) was NOT NULL-code based; with nullable codes PostgreSQL treats
-- NULLs as distinct, so it no longer blocks multiple code-less subjects. We
-- keep it (harmless for real codes) and add the name-based rule below.
--
-- Additive and safe: no data dropped. Wrapped in a single transaction by the
-- migration runner.
-- =============================================================================

-- 1) Subject code is optional.
ALTER TABLE courses ALTER COLUMN code DROP NOT NULL;

-- 2) Prevent duplicate subject NAMES within the same Course+Branch+Semester
--    (case-insensitive). A unique index supports the "no duplicate subject for
--    the same Course+Branch+Semester" requirement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_group_name
  ON courses (program, branch, semester, LOWER(name));
