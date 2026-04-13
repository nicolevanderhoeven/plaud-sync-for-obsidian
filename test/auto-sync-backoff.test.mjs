import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(path.join(root, 'src/auto-sync-backoff.ts')).href;
const {createAutoSyncBackoff, MAX_CONSECUTIVE_AUTO_SYNC_FAILURES} = await import(moduleUrl);

test('default max failures constant is 3', () => {
  assert.equal(MAX_CONSECUTIVE_AUTO_SYNC_FAILURES, 3);
});

test('starts with zero failures and not paused', () => {
  const backoff = createAutoSyncBackoff();
  assert.equal(backoff.consecutiveFailures, 0);
  assert.equal(backoff.paused, false);
});

test('recordFailure returns true when limit is reached', () => {
  const backoff = createAutoSyncBackoff(3);

  assert.equal(backoff.recordFailure(), false);
  assert.equal(backoff.consecutiveFailures, 1);
  assert.equal(backoff.paused, false);

  assert.equal(backoff.recordFailure(), false);
  assert.equal(backoff.consecutiveFailures, 2);
  assert.equal(backoff.paused, false);

  assert.equal(backoff.recordFailure(), true);
  assert.equal(backoff.consecutiveFailures, 3);
  assert.equal(backoff.paused, true);
});

test('recordSuccess resets consecutive failures', () => {
  const backoff = createAutoSyncBackoff(3);

  backoff.recordFailure();
  backoff.recordFailure();
  assert.equal(backoff.consecutiveFailures, 2);

  backoff.recordSuccess();
  assert.equal(backoff.consecutiveFailures, 0);
  assert.equal(backoff.paused, false);
});

test('reset clears failures and unpauses', () => {
  const backoff = createAutoSyncBackoff(2);

  backoff.recordFailure();
  backoff.recordFailure();
  assert.equal(backoff.paused, true);

  backoff.reset();
  assert.equal(backoff.consecutiveFailures, 0);
  assert.equal(backoff.paused, false);
});

test('success after partial failures prevents pause', () => {
  const backoff = createAutoSyncBackoff(3);

  backoff.recordFailure();
  backoff.recordFailure();
  backoff.recordSuccess();
  backoff.recordFailure();

  assert.equal(backoff.consecutiveFailures, 1);
  assert.equal(backoff.paused, false);
});

test('custom maxFailures threshold is respected', () => {
  const backoff = createAutoSyncBackoff(1);

  assert.equal(backoff.recordFailure(), true);
  assert.equal(backoff.paused, true);
});
