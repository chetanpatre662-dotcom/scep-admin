/**
 * config.js
 * Central application configuration and domain constants.
 * Single source of truth for course types, branches, semesters and app settings.
 *
 * NOTE (security): No secrets, API keys, or credentials belong in frontend files.
 * When the backend is added, only the BASE_URL / endpoints below change.
 */

export const APP = {
  NAME: 'College Management System',
  SHORT_NAME: 'CMS',
  COLLEGE_NAME: 'Askbook',
  COLLEGE_SHORT: 'Askbook',
  // Full institution name (used in footers/meta).
  COLLEGE_FULL: 'Satpuda College of Engineering and Polytechnic',
  // Sub-brand / co-brand tag rendered as a refined badge next to the name.
  COLLEGE_SUB: 'SCEP',
  // Local college logo asset (app-root-relative; use resolvePath() for links).
  COLLEGE_LOGO: './assets/images/college_logo.png', 
  VERSION: '1.0.0-frontend',
};

/**
 * Backend configuration. The app is fully backed by the real Node.js/Express +
 * PostgreSQL backend (no mock data). AUTH_USE_BACKEND gates all authenticated
 * API calls; the static frontend is typically served from a different origin
 * than the backend, so API_BASE_URL must be absolute for cross-origin calls.
 */
export const ENV = {
  API_BASE_URL: 'http://162.245.191.109:5000/api',
  AUTH_USE_BACKEND: true,
  WS_URL: '', // empty -> realtimeService derives ws(s)://host/ws from API_BASE_URL
};

export const ROLES = {
  FACULTY: 'faculty',
  STUDENT: 'student',
  ADMIN: 'admin',
};

export const COURSE_TYPES = {
  POLYTECHNIC: 'Polytechnic',
  BTECH: 'B.Tech',
};

export const BRANCHES = [
  'Computer Science',
  'Mining',
  'Electrical',
  'Civil',
  'Mechanical',
];

/**
 * Semester structure differs per course type.
 * Polytechnic: 3 years, 6 semesters, grouped by year.
 * B.Tech: 4 years, 8 semesters.
 */
export const SEMESTER_STRUCTURE = {
  [COURSE_TYPES.POLYTECHNIC]: {
    totalSemesters: 6,
    years: [
      { year: '1st Year', semesters: [1, 2] },
      { year: '2nd Year', semesters: [3, 4] },
      { year: '3rd Year', semesters: [5, 6] },
    ],
  },
  [COURSE_TYPES.BTECH]: {
    totalSemesters: 8,
    years: [
      { year: '1st Year', semesters: [1, 2] },
      { year: '2nd Year', semesters: [3, 4] },
      { year: '3rd Year', semesters: [5, 6] },
      { year: '4th Year', semesters: [7, 8] },
    ],
  },
};

/**
 * Faculty departments — same set as academic BRANCHES for this college.
 * Kept as its own export so intent is clear at faculty-registration call sites.
 */
export const DEPARTMENTS = [...BRANCHES];

/**
 * Faculty designations. Mirrors the options already used in the admin faculty
 * form (Assistant/Associate/Professor) plus the additional roles requested.
 */
export const DESIGNATIONS = [
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'HOD',
  'Lecturer',
  'Lab Instructor',
];

/**
 * Year options for a given course/program, derived from SEMESTER_STRUCTURE.
 * @param {string} program COURSE_TYPES value
 * @returns {{label:string, semesters:number[]}[]}
 */
export function yearsForProgram(program) {
  const struct = SEMESTER_STRUCTURE[program];
  if (!struct) return [];
  return struct.years.map((y) => ({ label: y.year, semesters: y.semesters }));
}

/**
 * Semesters available for a given program + year label.
 * @returns {number[]}
 */
export function semestersForYear(program, yearLabel) {
  const struct = SEMESTER_STRUCTURE[program];
  if (!struct) return [];
  const entry = struct.years.find((y) => y.year === yearLabel);
  return entry ? entry.semesters.slice() : [];
}

/**
 * Derive the academic year label from a program + semester (year is NOT stored;
 * it is always derived from the authoritative semester).
 * @returns {string|null}
 */
export function yearFromSemester(program, semester) {
  const struct = SEMESTER_STRUCTURE[program];
  if (!struct) return null;
  const sem = Number(semester);
  const entry = struct.years.find((y) => y.semesters.includes(sem));
  return entry ? entry.year : null;
}

/**
 * Validate that a program + semester combination is legal
 * (B.Tech: 1–8, Polytechnic: 1–6).
 * @returns {boolean}
 */
export function isValidProgramSemester(program, semester) {
  const struct = SEMESTER_STRUCTURE[program];
  if (!struct) return false;
  const sem = Number(semester);
  return Number.isInteger(sem) && sem >= 1 && sem <= struct.totalSemesters;
}

export const ANNOUNCEMENT_TYPES = [
  'General',
  'Event',
  'Holiday',
  'Exam',
  'Important Notice',
];

export const TARGET_AUDIENCES = [
  'All Students',
  'B.Tech',
  'Polytechnic',
  'Specific Branch',
  'Specific Semester',
];

/**
 * Storage keys for ALLOWED client-side caches only (NOT business data):
 *   SESSION  — cached verified backend profile (auth convenience; re-verified
 *              server-side on every request).
 *   AI_CHATS — local AI assistant chat threads (scoped per Firebase UID).
 * Business data (classes/notes/papers/announcements/messages/notifications) is
 * NEVER stored client-side; it lives in PostgreSQL and is fetched from the API.
 */
export const STORAGE_KEYS = {
  SESSION: 'cms.session',
  AI_CHATS: 'cms.aiChats',
};

/** Event categories/types (used by faculty Add Event + student filter). */
export const EVENT_TYPES = ['Workshop', 'Seminar', 'Cultural', 'Sports', 'Exam'];

/** Route map keeps navigation consistent and easy to refactor. */
export const ROUTES = {
  HOME: '/index.html',
  FACULTY: {
    LOGIN: '/faculty/login.html',
    DASHBOARD: '/faculty/dashboard.html',
    CLASSES: '/faculty/classes.html',
    CLASS_DETAIL: '/faculty/class.html',
    ANNOUNCEMENTS: '/faculty/announcements.html',
    QUESTION_PAPERS: '/faculty/question-papers.html',
    EVENTS: '/faculty/events.html',
    AI: '/faculty/assistant.html',
    PROFILE: '/faculty/profile.html',
  },
  STUDENT: {
    LOGIN: '/student/login.html',
    DASHBOARD: '/student/dashboard.html',
    CLASSES: '/student/classes.html',
    CLASS_DETAIL: '/student/class.html',
    ANNOUNCEMENTS: '/student/announcements.html',
    QUESTION_PAPERS: '/student/question-papers.html',
    EVENTS: '/student/events.html',
    AI: '/student/assistant.html',
    PROFILE: '/student/profile.html',
  },
  ADMIN: {
    LOGIN: '/admin/login.html',
    DASHBOARD: '/admin/dashboard.html',
    FACULTY: '/admin/faculty.html',
    STUDENTS: '/admin/students.html',
    MANAGEMENT: '/admin/management.html',
    REQUESTS: '/admin/requests.html',
    CLASSES: '/admin/classes.html',
    COURSES: '/admin/courses.html',
    SETTINGS: '/admin/settings.html',
    AI: '/admin/assistant.html',
    AI_DOCUMENTS: '/admin/ai-documents.html',
    PROFILE: '/admin/profile.html',
  },
};

/**
 * Resolve an app-root-relative path (starting with "/") to a path that works
 * regardless of how deep the current page is nested (e.g. /faculty/x.html).
 * Keeps links robust without a server rewrite layer.
 */
export function resolvePath(rootRelative) {
  // Determine how many levels deep we are relative to the app root.
  // The app root is the folder that contains index.html.
  const path = window.location.pathname;
  const marker = '/college-management-system/';
  let base = '';
  if (path.includes(marker)) {
    base = path.substring(0, path.indexOf(marker) + marker.length - 1);
  } else {
    // Fallback: assume the folder holding index.html is the app root.
    // Strip the trailing file + one folder if we're inside faculty/student/admin.
    const segments = path.split('/').filter(Boolean);
    segments.pop(); // remove file name
    if (['faculty', 'student', 'admin'].includes(segments[segments.length - 1])) {
      segments.pop();
    }
    base = '/' + segments.join('/');
  }
  return (base + rootRelative).replace(/\/{2,}/g, '/');
}
