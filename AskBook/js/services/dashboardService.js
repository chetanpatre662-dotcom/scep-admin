/**
 * dashboardService.js — Real dashboard aggregates API client.
 * -----------------------------------------------------------------------------
 * All numbers come from the backend (computed from real tables). No fabricated
 * statistics, no mock. Result objects for loading/empty/error handling.
 * -----------------------------------------------------------------------------
 */
import { apiCall } from './httpService.js';

/** Faculty dashboard: { stats:{...}, recentActivity:[...] }. */
export async function getFacultyDashboard() {
  return apiCall('/faculty/dashboard', { method: 'GET' });
}

/** Student dashboard: { profile:{...}, stats:{...} }. */
export async function getStudentDashboard() {
  return apiCall('/student/dashboard', { method: 'GET' });
}
