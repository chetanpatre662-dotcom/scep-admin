-- =============================================================================
-- 004_course_branch_catalog.sql
-- -----------------------------------------------------------------------------
-- Option B: admin-managed catalog of arbitrary Courses and Branches, WITHOUT
-- migrating existing denormalized string data to IDs.
--
-- What this does:
--   1. Creates `course_catalog` (the list of allowed Course names, e.g. B.Tech,
--      Polytechnic, M.Tech, BCA ...). `total_semesters` lets each Course define
--      its own semester count (default 8).
--   2. Creates `branches` (branch names, each belonging to a course_catalog row).
--   3. DROPS the program/branch CHECK constraints on students, courses, classes
--      and announcements so arbitrary Course/Branch strings are allowed. The
--      catalog tables become the app-level source of truth for valid values;
--      the existing string columns are preserved unchanged for compatibility.
--   4. Seeds the catalog from the values already in use (B.Tech, Polytechnic +
--      the five existing branches) so ALL current rows remain valid and the UI
--      shows the current structure immediately.
--
-- Idempotent + additive: uses IF EXISTS / IF NOT EXISTS / ON CONFLICT. No data
-- is dropped or rewritten. The migration runner wraps this in one transaction.
-- =============================================================================

-- 1) Course catalog ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_catalog (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT        NOT NULL,
  code            TEXT,
  total_semesters SMALLINT    NOT NULL DEFAULT 8
                              CHECK (total_semesters BETWEEN 1 AND 12),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Course names are unique case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_catalog_name
  ON course_catalog (LOWER(name));

DROP TRIGGER IF EXISTS trg_course_catalog_updated_at ON course_catalog;
CREATE TRIGGER trg_course_catalog_updated_at
  BEFORE UPDATE ON course_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) Branches (belong to a course) -------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id   BIGINT      NOT NULL REFERENCES course_catalog (id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A branch name is unique (case-insensitive) within its course.
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_course_name
  ON branches (course_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_branches_course_id ON branches (course_id);

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) Drop program/branch CHECK constraints so arbitrary values are allowed ----
--    (Names confirmed by inspection of pg_constraint.)
ALTER TABLE students      DROP CONSTRAINT IF EXISTS students_program_check;
ALTER TABLE students      DROP CONSTRAINT IF EXISTS students_branch_check;
ALTER TABLE courses       DROP CONSTRAINT IF EXISTS courses_program_check;
ALTER TABLE courses       DROP CONSTRAINT IF EXISTS courses_branch_check;
ALTER TABLE classes       DROP CONSTRAINT IF EXISTS classes_program_check;
ALTER TABLE classes       DROP CONSTRAINT IF EXISTS classes_branch_check;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_target_program_check;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_target_branch_check;

-- 4) Seed existing Courses + Branches so current data stays valid -------------
INSERT INTO course_catalog (name, total_semesters) VALUES
  ('B.Tech', 8),
  ('Polytechnic', 6)
ON CONFLICT (LOWER(name)) DO NOTHING;

-- Seed the five existing branches under BOTH seeded courses (they were valid
-- for both in the old CHECK model). ON CONFLICT keeps this idempotent.
INSERT INTO branches (course_id, name)
SELECT c.id, b.name
FROM course_catalog c
CROSS JOIN (VALUES
  ('Computer Science'),
  ('Mining'),
  ('Electrical'),
  ('Civil'),
  ('Mechanical')
) AS b(name)
WHERE c.name IN ('B.Tech', 'Polytechnic')
ON CONFLICT (course_id, LOWER(name)) DO NOTHING;
