-- =============================================================================
-- 001_initial_schema.sql
-- College Management System — initial PostgreSQL schema.
-- -----------------------------------------------------------------------------
-- Design notes:
--   * Firebase Authentication owns IDENTITY. `users.firebase_uid` is the bridge
--     between a Firebase account and this application's source-of-truth profile.
--   * Role/profile data lives here (PostgreSQL), NOT trusted from the frontend.
--   * Class membership is DERIVED from (program, branch, semester) — there is no
--     class_members table and no "join class" flow (see classes table below).
--   * Files (notes, question papers, profile photos) live in Firebase Cloud
--     Storage later; here we store only metadata + the storage URL/reference.
--
-- This migration is additive and safe: it creates a shared updated_at trigger,
-- tables, constraints and indexes. It does not drop anything. The migration
-- runner wraps this file in a single transaction.
--
-- Enum-like fields are modeled with CHECK constraints (easier to evolve than
-- native ENUM types and friendly to plain-SQL migrations).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared trigger function: keep updated_at current on every UPDATE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- USERS — application-level user record, keyed to a Firebase account.
--   firebase_uid is the identity bridge (unique, not null).
--   role is the application source of truth for authorization (never trusted
--   from the client).
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firebase_uid  TEXT        NOT NULL UNIQUE,
  email         TEXT,
  display_name  TEXT,
  role          TEXT        NOT NULL DEFAULT 'student'
                            CHECK (role IN ('student', 'faculty', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users (firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_role         ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_email        ON users (email);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- STUDENTS — student profile, one-to-one with a user row.
--   program/branch/semester drive automatic class membership.
-- =============================================================================
CREATE TABLE IF NOT EXISTS students (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT      NOT NULL UNIQUE
                                REFERENCES users (id) ON DELETE CASCADE,
  roll_number       TEXT        NOT NULL UNIQUE,
  full_name         TEXT        NOT NULL,
  mobile_number     TEXT,
  program           TEXT        NOT NULL
                                CHECK (program IN ('Polytechnic', 'B.Tech')),
  branch            TEXT        NOT NULL
                                CHECK (branch IN ('Computer Science', 'Mining',
                                                  'Electrical', 'Civil', 'Mechanical')),
  semester          SMALLINT    NOT NULL
                                CHECK (semester BETWEEN 1 AND 8),
  profile_photo_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_id already indexed via UNIQUE; add the academic-group lookup index used
-- for deriving class membership and roster queries.
CREATE INDEX IF NOT EXISTS idx_students_prog_branch_sem
  ON students (program, branch, semester);
CREATE INDEX IF NOT EXISTS idx_students_roll_number ON students (roll_number);

DROP TRIGGER IF EXISTS trg_students_updated_at ON students;
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- FACULTY — faculty profile, one-to-one with a user row.
-- =============================================================================
CREATE TABLE IF NOT EXISTS faculty (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT      NOT NULL UNIQUE
                                REFERENCES users (id) ON DELETE CASCADE,
  employee_id       TEXT        NOT NULL UNIQUE,
  full_name         TEXT        NOT NULL,
  mobile_number     TEXT,
  department        TEXT,
  designation       TEXT,
  profile_photo_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faculty_employee_id ON faculty (employee_id);

DROP TRIGGER IF EXISTS trg_faculty_updated_at ON faculty;
CREATE TRIGGER trg_faculty_updated_at
  BEFORE UPDATE ON faculty
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- COURSES — a course definition for a given academic group.
--   created_by references the user who created it (typically faculty/admin).
--   ON DELETE SET NULL preserves the course if the creating user is removed.
--   Uniqueness prevents accidental duplicate courses within the same group.
-- =============================================================================
CREATE TABLE IF NOT EXISTS courses (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         TEXT        NOT NULL,
  code         TEXT        NOT NULL,
  program      TEXT        NOT NULL
                           CHECK (program IN ('Polytechnic', 'B.Tech')),
  branch       TEXT        NOT NULL
                           CHECK (branch IN ('Computer Science', 'Mining',
                                             'Electrical', 'Civil', 'Mechanical')),
  semester     SMALLINT    NOT NULL CHECK (semester BETWEEN 1 AND 8),
  description  TEXT,
  created_by   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A course code is unique within a specific academic group.
  CONSTRAINT uq_courses_code_group UNIQUE (code, program, branch, semester)
);

CREATE INDEX IF NOT EXISTS idx_courses_prog_branch_sem
  ON courses (program, branch, semester);
CREATE INDEX IF NOT EXISTS idx_courses_created_by ON courses (created_by);

DROP TRIGGER IF EXISTS trg_courses_updated_at ON courses;
CREATE TRIGGER trg_courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- CLASSES — a course offered to a particular academic group by a faculty.
--   Membership is DERIVED: a student belongs to a class when
--     student.program = class.program AND
--     student.branch  = class.branch  AND
--     student.semester = class.semester
--   No class_members table and no class code by design.
--   faculty_id references faculty (RESTRICT so an in-use faculty isn't deleted
--   silently); course_id cascades so removing a course removes its classes.
-- =============================================================================
CREATE TABLE IF NOT EXISTS classes (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id    BIGINT      NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  faculty_id   BIGINT      NOT NULL REFERENCES faculty (id) ON DELETE RESTRICT,
  program      TEXT        NOT NULL
                           CHECK (program IN ('Polytechnic', 'B.Tech')),
  branch       TEXT        NOT NULL
                           CHECK (branch IN ('Computer Science', 'Mining',
                                             'Electrical', 'Civil', 'Mechanical')),
  semester     SMALLINT    NOT NULL CHECK (semester BETWEEN 1 AND 8),
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'archived')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Prevent duplicate offerings of the same course to the same group.
  CONSTRAINT uq_classes_course_group UNIQUE (course_id, program, branch, semester)
);

CREATE INDEX IF NOT EXISTS idx_classes_prog_branch_sem
  ON classes (program, branch, semester);
CREATE INDEX IF NOT EXISTS idx_classes_course_id  ON classes (course_id);
CREATE INDEX IF NOT EXISTS idx_classes_faculty_id ON classes (faculty_id);
CREATE INDEX IF NOT EXISTS idx_classes_status     ON classes (status);

DROP TRIGGER IF EXISTS trg_classes_updated_at ON classes;
CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- CLASS_MESSAGES — chat/message stream within a class.
--   sender_user_id references users (SET NULL keeps history if a user is
--   removed). class_id cascades so deleting a class removes its messages.
-- =============================================================================
CREATE TABLE IF NOT EXISTS class_messages (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id       BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  sender_user_id BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  message        TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Common query: fetch a class's messages newest-first.
CREATE INDEX IF NOT EXISTS idx_class_messages_class_created
  ON class_messages (class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_messages_sender
  ON class_messages (sender_user_id);

DROP TRIGGER IF EXISTS trg_class_messages_updated_at ON class_messages;
CREATE TRIGGER trg_class_messages_updated_at
  BEFORE UPDATE ON class_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- NOTES — study material metadata for a class (file lives in Firebase Storage).
-- =============================================================================
CREATE TABLE IF NOT EXISTS notes (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id     BIGINT      NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  uploaded_by  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  file_url     TEXT,       -- Firebase Storage download URL / reference
  file_name    TEXT,
  file_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_class_id    ON notes (class_id);
CREATE INDEX IF NOT EXISTS idx_notes_uploaded_by ON notes (uploaded_by);

DROP TRIGGER IF EXISTS trg_notes_updated_at ON notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- QUESTION_PAPERS — past paper metadata (file lives in Firebase Storage).
--   Belongs to a course; optionally scoped to a specific class.
-- =============================================================================
CREATE TABLE IF NOT EXISTS question_papers (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id    BIGINT      NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  class_id     BIGINT      REFERENCES classes (id) ON DELETE SET NULL,
  uploaded_by  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  year         SMALLINT    CHECK (year IS NULL OR year BETWEEN 1990 AND 2100),
  semester     SMALLINT    CHECK (semester IS NULL OR semester BETWEEN 1 AND 8),
  file_url     TEXT,       -- Firebase Storage download URL / reference
  file_name    TEXT,
  file_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_papers_course_id ON question_papers (course_id);
CREATE INDEX IF NOT EXISTS idx_question_papers_class_id  ON question_papers (class_id);

DROP TRIGGER IF EXISTS trg_question_papers_updated_at ON question_papers;
CREATE TRIGGER trg_question_papers_updated_at
  BEFORE UPDATE ON question_papers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- ANNOUNCEMENTS — targeted messages.
--   NULL target_* fields mean "not filtered by that dimension" (i.e. broader
--   audience). A class_id can scope an announcement to a single class.
--   This shape lets later queries filter announcements for a given student by
--   matching NULL-or-equal on program/branch/semester.
-- =============================================================================
CREATE TABLE IF NOT EXISTS announcements (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by       BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  title            TEXT        NOT NULL,
  content          TEXT        NOT NULL,
  target_program   TEXT        CHECK (target_program IS NULL
                                      OR target_program IN ('Polytechnic', 'B.Tech')),
  target_branch    TEXT        CHECK (target_branch IS NULL
                                      OR target_branch IN ('Computer Science', 'Mining',
                                                           'Electrical', 'Civil', 'Mechanical')),
  target_semester  SMALLINT    CHECK (target_semester IS NULL
                                      OR target_semester BETWEEN 1 AND 8),
  class_id         BIGINT      REFERENCES classes (id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Targeting/filtering indexes.
CREATE INDEX IF NOT EXISTS idx_announcements_targeting
  ON announcements (target_program, target_branch, target_semester);
CREATE INDEX IF NOT EXISTS idx_announcements_class_id ON announcements (class_id);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements (created_at DESC);

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements;
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
