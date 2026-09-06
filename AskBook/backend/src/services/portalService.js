/**
 * services/portalService.js
 * -----------------------------------------------------------------------------
 * Real dashboard aggregates + standalone question-paper listings for faculty and
 * students. Every number is computed from real tables — nothing is fabricated.
 * Question paper file downloads reuse the normalized `files` table + the
 * /api/files/:id/download signed-URL flow.
 * -----------------------------------------------------------------------------
 */
'use strict';

const portalRepository = require('../repositories/portalRepository');
const facultyRepository = require('../repositories/facultyRepository');
const studentRepository = require('../repositories/studentRepository');
const ApiError = require('../utils/ApiError');

function toPaper(row) {
  return {
    id: row.id,
    title: row.title,
    year: row.year != null ? Number(row.year) : null,
    semester: row.semester != null ? Number(row.semester) : null,
    classId: row.class_id,
    course: row.program || null,
    branch: row.branch || null,
    subject: row.subject_name || null,
    file: row.file_id
      ? { id: row.file_id, name: row.file_name, type: row.file_type || row.file_mime || null,
          size: row.file_size != null ? Number(row.file_size) : null }
      : (row.file_url ? { id: null, name: row.file_name, type: row.file_type, storagePath: row.file_url } : null),
    created: row.created_at,
  };
}

/* ---- Faculty dashboard ---- */
async function facultyDashboard(user) {
  const faculty = await facultyRepository.findByUserId(user.id);
  if (!faculty) throw new ApiError(409, 'Complete your faculty profile first.', { code: 'NO_FACULTY_PROFILE' });
  const [stats, announcements, recent] = await Promise.all([
    portalRepository.facultyStats(faculty.id),
    portalRepository.announcementCountByCreator(user.id),
    portalRepository.facultyRecentActivity(faculty.id, 8),
  ]);
  return {
    stats: {
      classes: Number(stats.classes) || 0,
      studentsReached: Number(stats.students_reached) || 0,
      notes: Number(stats.notes) || 0,
      questionPapers: Number(stats.papers) || 0,
      assignments: Number(stats.assignments) || 0,
      projects: Number(stats.projects) || 0,
      announcements: Number(announcements) || 0,
    },
    recentActivity: recent.map((r) => ({ kind: r.kind, id: r.id, title: r.title, createdAt: r.created_at })),
  };
}

/* ---- Student dashboard ---- */
async function studentDashboard(user) {
  const student = await studentRepository.findByUserId(user.id);
  if (!student) throw new ApiError(409, 'Complete your student profile first.', { code: 'NO_STUDENT_PROFILE' });
  const stats = await portalRepository.studentStats(student);
  return {
    profile: {
      name: student.full_name, roll: student.roll_number,
      course: student.program, branch: student.branch, semester: student.semester,
    },
    stats: {
      classes: Number(stats.classes) || 0,
      notes: Number(stats.notes) || 0,
      questionPapers: Number(stats.papers) || 0,
      assignments: Number(stats.assignments) || 0,
      projects: Number(stats.projects) || 0,
    },
  };
}

/* ---- Standalone question papers ---- */
async function questionPapersForFaculty(user) {
  const faculty = await facultyRepository.findByUserId(user.id);
  if (!faculty) throw new ApiError(409, 'Complete your faculty profile first.', { code: 'NO_FACULTY_PROFILE' });
  const rows = await portalRepository.questionPapersForFaculty(faculty.id);
  return rows.map(toPaper);
}

async function questionPapersForStudent(user) {
  const student = await studentRepository.findByUserId(user.id);
  if (!student) throw new ApiError(409, 'Complete your student profile first.', { code: 'NO_STUDENT_PROFILE' });
  const rows = await portalRepository.questionPapersForStudent(student);
  return rows.map(toPaper);
}

module.exports = { facultyDashboard, studentDashboard, questionPapersForFaculty, questionPapersForStudent, toPaper };
