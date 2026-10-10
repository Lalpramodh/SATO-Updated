const runtimeEnv = typeof import.meta !== 'undefined' && import.meta && import.meta.env ? import.meta.env : {};
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "/api";
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error || `Request failed: ${response.status}`);
  return payload;
}

export function createBackendHealthCheck({ retryDelayMs = 2000, timeoutMs = 30000, fetchImpl = fetch } = {}) {
  return async function waitForBackend(signal) {
    const startedAt = Date.now();
    while (true) {
      if (signal?.aborted) {
        const error = new Error('Backend health check cancelled');
        error.name = 'AbortError';
        throw error;
      }

      try {
        const response = await fetchImpl(`${API_BASE_URL}/health`, {
          signal,
          headers: { 'Content-Type': 'application/json' },
        });
        const payload = await response.json().catch(() => ({}));

        if (response.ok) return payload;
        throw new ApiError(response.status, payload.error || `Health check failed: ${response.status}`);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (Date.now() - startedAt >= timeoutMs) {
          throw error instanceof ApiError ? error : new ApiError(503, 'Backend is still starting up or is unavailable.');
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  };
}

export const waitForBackend = createBackendHealthCheck();

export const api = {
  getHealth: () => request('/health'),
  getDepartments: (signal) => request('/departments', { signal }),
  getCourses: (semester = 1, signal) => request(`/courses?semester=${semester}`, { signal }),
  getFaculty: (signal) => request('/faculty', { signal }),
  addFaculty: (payload, signal) => request('/faculty', { method: 'POST', body: JSON.stringify(payload), signal }),
  getStudentGroups: (semester = 1, signal) => request(`/student-groups?semester=${semester}`, { signal }),
  getRooms: (signal) => request('/rooms', { signal }),
  getTimeSlots: (signal) => request('/time-slots', { signal }),
  getTimetable: (id, signal) => request(`/timetable/${id}`, { signal }),
  getTimetables: (academicYear, semester, signal) => {
    const params = new URLSearchParams();
    if (academicYear) params.set('academic_year', academicYear);
    if (semester !== undefined && semester !== null) params.set('semester', semester);
    const query = params.toString();
    return request(`/timetables${query ? `?${query}` : ''}`, { signal });
  },
  getSummary: (semester = 1, signal) => request(`/timetable/data?semester=${semester}`, { signal }),
  generateTimetable: (payload, signal) => request('/timetable/generate', { method: 'POST', body: JSON.stringify(payload), signal }),
};

export { API_BASE_URL };
