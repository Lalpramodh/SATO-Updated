import test from 'node:test';
import assert from 'node:assert/strict';

import { createBackendHealthCheck } from './api.js';

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
