-- =============================================================================
-- 002_faculty_employee_id_nullable.sql
-- -----------------------------------------------------------------------------
-- Public faculty self-registration does NOT collect an employee ID (it is
-- assigned later by an admin). The initial schema declared
-- faculty.employee_id as NOT NULL UNIQUE, which prevented creating a faculty
-- profile row at registration time.
--
-- This migration relaxes the NOT NULL constraint so employee_id can be NULL
-- until an admin assigns it. The UNIQUE constraint from 001 is preserved and
-- still applies to non-NULL values (PostgreSQL allows multiple NULLs under a
-- UNIQUE constraint), so real employee IDs remain unique once assigned.
--
-- Additive and safe: no data is dropped, no other columns change.
-- The migration runner wraps this file in a single transaction.
-- =============================================================================

ALTER TABLE faculty ALTER COLUMN employee_id DROP NOT NULL;
