/**
 * services/announcementService.js
 * -----------------------------------------------------------------------------
 * Announcement business logic. Faculty/admin create; a faculty member manages
 * only their own; admin manages all. Students receive a targeted, published-only
 * feed based on their REAL DB academic profile (never client-supplied).
 *
 * Audience model (UI) <-> target_* columns (DB):
 *   'All Students'      -> program NULL, branch NULL, semester NULL
 *   'B.Tech'            -> program 'B.Tech'
 *   'Polytechnic'       -> program 'Polytechnic'
 *   'Specific Branch'   -> program + branch
 *   'Specific Semester' -> program + branch + semester
 *
 * A new notification is generated for matching students when an announcement is
 * published (via notificationService) — best-effort, never blocks the write.
 * -----------------------------------------------------------------------------
 */
'use strict';

const announcementRepository = require('../repositories/announcementRepository');
const studentRepository = require('../repositories/studentRepository');
const ApiError = require('../utils/ApiError');

const PROGRAMS = ['Polytechnic', 'B.Tech'];
const BRANCHES = ['Computer Science', 'Mining', 'Electrical', 'Civil', 'Mechanical'];
const AUDIENCES = ['All Students', 'B.Tech', 'Polytechnic', 'Specific Branch', 'Specific Semester'];

/** Derive the UI `audience` label from target_* columns. */
function audienceFromTargets(row) {
  if (!row.target_program && !row.target_branch && !row.target_semester) return 'All Students';
  if (row.target_program && !row.target_branch && !row.target_semester) return row.target_program;
  if (row.target_program && row.target_branch && row.target_semester) return 'Specific Semester';
  if (row.target_program && row.target_branch) return 'Specific Branch';
  return 'All Students';
}

/** Map a UI `audience` + fields to target_* columns. */
function targetsFromAudience(input) {
  const audience = input.audience || 'All Students';
  const program = input.course || input.program || null;
  const branch = input.branch || null;
  const semester = input.semester != null && input.semester !== '' ? Number(input.semester) : null;

  switch (audience) {
    case 'All Students':
      return { targetProgram: null, targetBranch: null, targetSemester: null };
    case 'B.Tech':
      return { targetProgram: 'B.Tech', targetBranch: null, targetSemester: null };
    case 'Polytechnic':
      return { targetProgram: 'Polytechnic', targetBranch: null, targetSemester: null };
    case 'Specific Branch':
      return { targetProgram: program, targetBranch: branch, targetSemester: null };
    case 'Specific Semester':
      return { targetProgram: program, targetBranch: branch, targetSemester: semester };
    default:
      return { targetProgram: null, targetBranch: null, targetSemester: null };
  }
}

/** Public shape (matches what the existing announcement UI expects). */
function toAnnouncement(row) {
  return {
    id: row.id,
    facultyId: row.created_by,
    authorName: row.created_by_name || 'Staff',
    title: row.title,
    type: row.type || null,
    description: row.content || '',
    audience: audienceFromTargets(row),
    course: row.target_program || null,
    branch: row.target_branch || null,
    semester: row.target_semester != null ? Number(row.target_semester) : null,
    eventDate: row.event_date || null,
    attachment: null, // file attachments for announcements: future (do not fabricate)
    status: row.status || 'published',
    created: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validate(input) {
  const errors = [];
  if (!String(input.title || '').trim()) errors.push('Title is required.');
  if (!String(input.description || input.content || '').trim()) errors.push('Description is required.');
  const audience = input.audience || 'All Students';
  if (!AUDIENCES.includes(audience)) errors.push('Invalid audience.');
  if ((audience === 'Specific Branch' || audience === 'Specific Semester')) {
    if (!PROGRAMS.includes(input.course || input.program)) errors.push('A valid course is required for this audience.');
    if (!BRANCHES.includes(input.branch)) errors.push('A valid branch is required for this audience.');
  }
  if (audience === 'Specific Semester' && !(Number(input.semester) >= 1)) {
    errors.push('A valid semester is required for this audience.');
  }
  if (input.status && !['draft', 'published'].includes(input.status)) errors.push('Invalid status.');
  if (errors.length) throw new ApiError(400, errors.join(' '), { code: 'VALIDATION_ERROR' });
}

/* ---- Faculty/Admin: own list ---- */
async function listForFaculty(user) {
  const rows = user.role === 'admin'
    ? await announcementRepository.listAll()
    : await announcementRepository.listByCreator(user.id);
  return rows.map(toAnnouncement);
}

/* ---- Student: targeted published feed (real profile) ---- */
async function listForStudent(user) {
  const student = await studentRepository.findByUserId(user.id);
  if (!student) throw new ApiError(404, 'Complete your student profile to view announcements.', { code: 'NO_STUDENT_PROFILE' });
  const rows = await announcementRepository.listForStudent({
    program: student.program, branch: student.branch, semester: student.semester,
  });
  return rows.map(toAnnouncement);
}

function assertCreator(user) {
  if (user.role !== 'faculty' && user.role !== 'admin') {
    throw new ApiError(403, 'Only faculty or admins can manage announcements.', { code: 'FORBIDDEN' });
  }
}

async function requireOwned(user, id) {
  const row = await announcementRepository.findById(id);
  if (!row) throw new ApiError(404, 'Announcement not found.', { code: 'NOT_FOUND' });
  const isAdmin = user.role === 'admin';
  const isOwner = row.created_by != null && Number(row.created_by) === Number(user.id);
  if (!isAdmin && !isOwner) throw new ApiError(403, 'You can only modify your own announcements.', { code: 'NOT_OWNER' });
  return row;
}

async function create(user, input = {}) {
  assertCreator(user);
  validate(input);
  const targets = targetsFromAudience(input);
  const row = await announcementRepository.insert({
    createdBy: user.id,
    title: String(input.title).trim(),
    content: String(input.description || input.content).trim(),
    type: input.type ? String(input.type).trim() : null,
    status: input.status || 'published',
    eventDate: input.eventDate || null,
    ...targets,
  });
  const dto = toAnnouncement(row);
  // Fan out notifications to matching students (best-effort).
  if (dto.status === 'published') fanoutToStudents(row).catch(() => {});
  return dto;
}

async function update(user, id, input = {}) {
  assertCreator(user);
  await requireOwned(user, id);
  validate(input);
  const targets = targetsFromAudience(input);
  const row = await announcementRepository.update(id, {
    title: String(input.title).trim(),
    content: String(input.description || input.content).trim(),
    type: input.type ? String(input.type).trim() : null,
    status: input.status || 'published',
    eventDate: input.eventDate || null,
    ...targets,
  });
  return toAnnouncement(row);
}

async function remove(user, id) {
  assertCreator(user);
  await requireOwned(user, id);
  await announcementRepository.deleteById(id);
  return { id: Number(id) };
}

/** Best-effort: notify students whose profile matches the announcement targeting. */
async function fanoutToStudents(row) {
  const notificationService = require('./notificationService');
  const students = await studentRepository.findMatching({
    program: row.target_program, branch: row.target_branch, semester: row.target_semester,
  });
  await notificationService.createForUsers(
    students.map((s) => s.user_id),
    {
      type: 'announcement',
      title: `New announcement: ${row.title}`,
      body: (row.content || '').slice(0, 140),
      refType: 'announcement',
      refId: row.id,
    }
  );
}

module.exports = { listForFaculty, listForStudent, create, update, remove, toAnnouncement };
