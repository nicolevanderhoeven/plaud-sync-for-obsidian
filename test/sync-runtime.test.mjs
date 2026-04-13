import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(path.join(root, 'src/sync-runtime.ts')).href;
const {createPlaudSyncRuntime} = await import(moduleUrl);

test('startup sync respects syncOnStartup setting', async () => {
  let runCalls = 0;
  const notices = [];

  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => false,
    runSync: async () => {
      runCalls += 1;
    },
    onLocked: (message) => {
      notices.push(message);
    }
  });

  const ran = await runtime.runStartupSync();

  assert.equal(ran, false);
  assert.equal(runCalls, 0);
  assert.deepEqual(notices, []);
});

test('concurrent sync attempts are prevented with clear messaging', async () => {
  let release;
  let runCalls = 0;
  const notices = [];

  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => true,
    runSync: async () => {
      runCalls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    onLocked: (message) => {
      notices.push(message);
    }
  });

  const first = runtime.runManualSync();
  await Promise.resolve();
  const second = await runtime.runManualSync();

  assert.equal(second, false);
  assert.equal(runCalls, 1);
  assert.deepEqual(notices, ['Plaud sync already running. Please wait for current run to finish.']);

  release();
  const firstResult = await first;
  assert.equal(firstResult, true);
});

test('auto sync runs sync with auto trigger', async () => {
  const triggers = [];

  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => true,
    runSync: async (trigger) => {
      triggers.push(trigger);
    },
    onLocked: () => {}
  });

  const ran = await runtime.runAutoSync();

  assert.equal(ran, true);
  assert.deepEqual(triggers, ['auto']);
});

test('auto sync skips silently when sync is in flight', async () => {
  let release;
  const notices = [];

  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => true,
    runSync: async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    onLocked: (message) => {
      notices.push(message);
    }
  });

  const first = runtime.runManualSync();
  await Promise.resolve();
  const autoResult = await runtime.runAutoSync();

  assert.equal(autoResult, false);
  assert.deepEqual(notices, [], 'auto sync should not fire onLocked');

  release();
  await first;
});
