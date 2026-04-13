import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';

const root = process.cwd();
const schemaModuleUrl = pathToFileURL(path.join(root, 'src/settings-schema.ts')).href;
const {
  DEFAULT_SETTINGS,
  MIN_AUTO_SYNC_MINUTES,
  normalizeSettings,
  toPersistedSettings
} = await import(schemaModuleUrl);

const mainSource = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');

test('default settings expose full Plaud sync schema', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), [
    'apiDomain',
    'autoSyncIntervalMinutes',
    'filenamePattern',
    'lastSyncAtMs',
    'syncFolder',
    'syncOnStartup',
    'updateExisting'
  ]);

  assert.equal(DEFAULT_SETTINGS.apiDomain, 'https://api.plaud.ai');
  assert.equal(DEFAULT_SETTINGS.syncFolder, 'Plaud');
  assert.equal(DEFAULT_SETTINGS.syncOnStartup, true);
  assert.equal(DEFAULT_SETTINGS.autoSyncIntervalMinutes, 0);
  assert.equal(DEFAULT_SETTINGS.updateExisting, true);
  assert.equal(DEFAULT_SETTINGS.filenamePattern, 'plaud-{timestamp}');
  assert.equal(DEFAULT_SETTINGS.lastSyncAtMs, 0);
});

test('normalizeSettings merges persisted partial values with defaults', () => {
  const merged = normalizeSettings({
    syncFolder: 'My Plaud Notes',
    syncOnStartup: false,
    lastSyncAtMs: 1730000000123
  });

  assert.equal(merged.apiDomain, DEFAULT_SETTINGS.apiDomain);
  assert.equal(merged.syncFolder, 'My Plaud Notes');
  assert.equal(merged.syncOnStartup, false);
  assert.equal(merged.updateExisting, DEFAULT_SETTINGS.updateExisting);
  assert.equal(merged.filenamePattern, DEFAULT_SETTINGS.filenamePattern);
  assert.equal(merged.lastSyncAtMs, 1730000000123);
});

test('normalizeSettings protects against malformed persisted values', () => {
  const merged = normalizeSettings({
    apiDomain: '',
    syncFolder: 42,
    syncOnStartup: 'yes',
    autoSyncIntervalMinutes: 'often',
    updateExisting: null,
    filenamePattern: '',
    lastSyncAtMs: -100
  });

  assert.deepEqual(merged, DEFAULT_SETTINGS);
});

test('toPersistedSettings preserves explicit lastSyncAtMs checkpoint semantics', () => {
  const persisted = toPersistedSettings({
    ...DEFAULT_SETTINGS,
    lastSyncAtMs: 1731000000000
  });

  assert.equal(persisted.lastSyncAtMs, 1731000000000);
});

test('normalizeSettings clamps autoSyncIntervalMinutes below minimum to minimum', () => {
  const merged = normalizeSettings({ autoSyncIntervalMinutes: 2 });
  assert.equal(merged.autoSyncIntervalMinutes, MIN_AUTO_SYNC_MINUTES);
});

test('normalizeSettings preserves autoSyncIntervalMinutes at or above minimum', () => {
  const merged = normalizeSettings({ autoSyncIntervalMinutes: 30 });
  assert.equal(merged.autoSyncIntervalMinutes, 30);
});

test('normalizeSettings treats zero autoSyncIntervalMinutes as disabled', () => {
  const merged = normalizeSettings({ autoSyncIntervalMinutes: 0 });
  assert.equal(merged.autoSyncIntervalMinutes, 0);
});

test('normalizeSettings treats negative autoSyncIntervalMinutes as disabled', () => {
  const merged = normalizeSettings({ autoSyncIntervalMinutes: -10 });
  assert.equal(merged.autoSyncIntervalMinutes, 0);
});

test('normalizeSettings floors fractional autoSyncIntervalMinutes', () => {
  const merged = normalizeSettings({ autoSyncIntervalMinutes: 7.9 });
  assert.equal(merged.autoSyncIntervalMinutes, 7);
});

test('plugin main wiring uses normalizeSettings during load path', () => {
  assert.match(mainSource, /this\.settings\s*=\s*normalizeSettings\(await this\.loadData\(\)\)/);
});
