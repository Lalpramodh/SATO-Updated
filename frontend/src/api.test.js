import test from 'node:test';
import assert from 'node:assert/strict';

import { api, createBackendHealthCheck } from './api.js';

test('createBackendHealthCheck retries until the backend becomes available', async () => {
  let calls = 0;

  const waitForBackend = createBackendHealthCheck({
    retryDelayMs: 0,
    timeoutMs: 50,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error('offline');
      }
      return {
        ok: true,
        json: async () => ({ status: 'ok', service: 'test-service' }),
      };
    },
  });

  await assert.doesNotReject(() => waitForBackend());
  assert.equal(calls, 3);
});

test('addFaculty preserves the structured conflict response for the modal', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      error: 'FACULTY_SCHEDULING_CONFLICT',
      message: 'This faculty member is already assigned.',
      details: { faculty: 'Dr. Ravi', requested_time: '09:00-11:00' },
    }),
  });

  try {
    await assert.rejects(api.addFaculty({}), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.errorCode, 'FACULTY_SCHEDULING_CONFLICT');
      assert.equal(error.payload.details.requested_time, '09:00-11:00');
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('unrelated API errors retain their own error code', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'INTERNAL_ERROR', message: 'Unable to load data.' }),
  });

  try {
    await assert.rejects(api.addFaculty({}), (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.errorCode, 'INTERNAL_ERROR');
      assert.notEqual(error.errorCode, 'FACULTY_SCHEDULING_CONFLICT');
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('assignFacultyToEntry uses the row-scoped PUT endpoint', async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ assigned: true }) };
  };

  try {
    const response = await api.assignFacultyToEntry('table-1', 'entry-2', 'faculty-3');
    assert.equal(response.assigned, true);
    assert.match(request.url, /table-1\/entries\/entry-2\/faculty$/);
    assert.equal(request.options.method, 'PUT');
    assert.deepEqual(JSON.parse(request.options.body), { faculty_id: 'faculty-3' });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('generation uses the original endpoint once and preserves scope and validation errors', async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 400, json: async () => ({ success: false, error: 'SCHEDULING_CONFLICT', validation: { valid: false, violations: [{ code: 'faculty_overlap', resource: 'Dr. Ravi' }] } }) };
  };
  const payload = { academic_year: '2026-27', semester: 3, department: 'CSE-AIML', student_group: 'group-1' };

  try {
    await assert.rejects(api.generateTimetable(payload), (error) => {
      assert.equal(error.payload.validation.violations[0].resource, 'Dr. Ravi');
      return true;
    });
    assert.deepEqual(calls.map((call) => new URL(call.url, 'http://localhost').pathname), [
      '/api/timetable/generate',
    ]);
    assert.ok(calls.every((call) => call.options.method === 'POST'));
    assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
