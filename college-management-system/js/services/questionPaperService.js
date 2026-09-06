/**
 * questionPaperService.js — Real question papers API client.
 * -----------------------------------------------------------------------------
 * Question papers are class-scoped content (question_papers table). Listing:
 *   - faculty: papers across the faculty's classes (GET /faculty/question-papers)
 *   - student: papers for the student's academic group (GET /student/question-papers)
 * Upload goes through the class content endpoint (multipart -> Firebase Storage)
 * via classApiService.createContentWithFile(classId, 'question-papers', ...).
 * Downloads use the backend signed-URL redirect (/files/:id/download).
 * No mock, no localStorage.
 * -----------------------------------------------------------------------------
 */
import { apiCall } from './httpService.js';
import { createContentWithFile, fileDownloadPath } from './classApiService.js';

/** Papers across the authenticated faculty's classes. */
export async function getFacultyPapers() {
  const r = await apiCall('/faculty/question-papers', { method: 'GET' });
  return r.ok ? { ok: true, items: r.items || [] } : r;
}

/** Papers for the authenticated student's academic group. */
export async function getStudentPapers() {
  const r = await apiCall('/student/question-papers', { method: 'GET' });
  return r.ok ? { ok: true, items: r.items || [] } : r;
}

/**
 * Upload a question paper to a class (real Firebase Storage + metadata).
 * @param {string|number} classId
 * @param {{title:string, description?:string, year?:number|string}} fields
 * @param {File} file
 */
export async function uploadPaper(classId, fields, file) {
  const data = { title: fields.title, description: fields.description || '' };
  return createContentWithFile(classId, 'question-papers', data, file);
}

/** Absolute-safe download path for a stored paper file id. */
export function paperDownloadPath(fileId) {
  return fileDownloadPath(fileId);
}
