import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const browserPath = [process.env.SATO_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((candidate) => candidate && existsSync(candidate));

// The smoke test exercises the real auth components with an in-memory session.
const authFixture = `
  export const supabaseConfigMissing = false;
  const user = { id: 'fixture-user', email: 'admin@example.test' };
  let session = { user };
  const listeners = new Set();
  const changeSession = (next) => { session = next; for (const listener of listeners) listener('TEST', session); };
  export const supabase = { auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (listener) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
    signOut: async () => { changeSession(null); return { error: null }; },
    signInWithPassword: async () => { changeSession({ user }); return { data: { session }, error: null }; },
  } };
`;

test('GeneratePage browser interaction regressions', { skip: !browserPath, timeout: 60000 }, async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    plugins: [react(), {
      name: 'sato-isolated-auth-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (source === './supabase' && importer?.replaceAll('\\', '/').includes('/src/auth/')) return '\0sato-auth-fixture';
      },
      load(id) { if (id === '\0sato-auth-fixture') return authFixture; },
      configureServer(devServer) {
        devServer.middlewares.use((request, response, next) => {
          if (request.url !== '/api/health') return next();
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ status: 'ok' }));
        });
      },
    }], server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  const profile = await mkdtemp(path.join(tmpdir(), 'sato-generation-'));
  let browser;
  let socket;
  try {
    await server.listen();
    browser = spawn(browserPath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true });
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timeout = setTimeout(() => reject(new Error(`Browser failed to start: ${stderr}`)), 15000);
      browser.on('error', (error) => { clearTimeout(timeout); reject(error); });
      browser.stderr.on('data', (data) => {
        stderr += data;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!pending.has(message.id)) return;
      const { resolve, reject, timeout } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timeout);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    function command(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await command('Page.enable', {}, sessionId);
    await command('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/generation.browser.html` }, sessionId);
    const result = await command('Runtime.evaluate', {
      expression: '(async () => { while (!window.satoTestResults) await new Promise(resolve => setTimeout(resolve, 10)); return await window.satoTestResults; })()',
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    assert.ok(Array.isArray(result.result.value), 'Browser returned no test results');
    for (const outcome of result.result.value) {
      await t.test(outcome.name, () => assert.equal(outcome.passed, true, outcome.error));
    }
    await command('Browser.close');
  } finally {
    socket?.close();
    browser?.kill();
    await server.close();
    const temporaryRoot = path.resolve(tmpdir()) + path.sep;
    if (path.resolve(profile).startsWith(temporaryRoot) && path.basename(profile).startsWith('sato-generation-')) {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
    }
  }
});
