-- =============================================================================
-- 001_dev_seed.sql — DEVELOPMENT / DEMO DATA ONLY.
-- -----------------------------------------------------------------------------
-- This is NOT production data and NOT part of the migrations. It is safe demo
-- content for local development so repositories/services can be built against
-- realistic rows.
--
-- IMPORTANT:
--   * The firebase_uid values below are obvious DEMO placeholders
--     (prefixed "demo-uid-"). They are NOT real Firebase accounts and grant no
--     authentication. Real users are created when a real Firebase account first
--     calls the backend (a later phase links firebase_uid -> profile).
--   * No passwords, no credentials, no service-account data here.
--   * Idempotent: uses ON CONFLICT so re-running does not duplicate rows.
-- =============================================================================

-- ---- Users (demo profiles keyed by placeholder Firebase UIDs) ----
INSERT INTO users (firebase_uid, email, display_name, role) VALUES
  ('demo-uid-admin-001',   'demo.admin@example.edu',    'Demo Admin',      'admin'),
  ('demo-uid-faculty-001', 'demo.faculty@example.edu',  'Dr. Demo Sharma', 'faculty'),
  ('demo-uid-student-001', 'demo.student@example.edu',  'Demo Student',    'student')
ON CONFLICT (firebase_uid) DO NOTHING;

-- ---- Faculty profile (links to the demo faculty user) ----
INSERT INTO faculty (user_id, employee_id, full_name, mobile_number, department, designation)
SELECT u.id, 'EMP-DEMO-001', 'Dr. Demo Sharma', '9000000001', 'Computer Science', 'Assistant Professor'
FROM users u
WHERE u.firebase_uid = 'demo-uid-faculty-001'
ON CONFLICT (employee_id) DO NOTHING;

-- ---- Student profile (links to the demo student user) ----
INSERT INTO students (user_id, roll_number, full_name, mobile_number, program, branch, semester)
SELECT u.id, 'CSE-B3-001', 'Demo Student', '9000000002', 'B.Tech', 'Computer Science', 3
FROM users u
WHERE u.firebase_uid = 'demo-uid-student-001'
ON CONFLICT (roll_number) DO NOTHING;

-- ---- Course (created by the demo admin) ----
INSERT INTO courses (name, code, program, branch, semester, description, created_by)
SELECT 'Data Structures', 'CS301', 'B.Tech', 'Computer Science', 3,
       'Core data structures and algorithms course (demo).', u.id
FROM users u
WHERE u.firebase_uid = 'demo-uid-admin-001'
ON CONFLICT (code, program, branch, semester) DO NOTHING;

-- ---- Class (the demo course offered to B.Tech / CS / sem 3, taught by demo faculty) ----
INSERT INTO classes (course_id, faculty_id, program, branch, semester, description, status)
SELECT c.id, f.id, 'B.Tech', 'Computer Science', 3, 'Demo class for Data Structures.', 'active'
FROM courses c
JOIN faculty f ON f.employee_id = 'EMP-DEMO-001'
WHERE c.code = 'CS301' AND c.program = 'B.Tech' AND c.branch = 'Computer Science' AND c.semester = 3
ON CONFLICT (course_id, program, branch, semester) DO NOTHING;

-- ---- Announcement targeted to B.Tech / CS / sem 3 (created by demo faculty) ----
INSERT INTO announcements (created_by, title, content, target_program, target_branch, target_semester)
SELECT u.id, 'Welcome to the semester', 'This is a demo announcement for CS sem 3.',
       'B.Tech', 'Computer Science', 3
FROM users u
WHERE u.firebase_uid = 'demo-uid-faculty-001'
  AND NOT EXISTS (
    SELECT 1 FROM announcements a WHERE a.title = 'Welcome to the semester'
  );
