import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();

const apiModuleUrl = pathToFileURL(path.join(root, 'src/plaud-api.ts')).href;
const {createPlaudApiClient, PlaudApiError} = await import(apiModuleUrl);

const vaultModuleUrl = pathToFileURL(path.join(root, 'src/plaud-vault.ts')).href;
const {buildPlaudAudioFilename} = await import(vaultModuleUrl);

const rendererModuleUrl = pathToFileURL(path.join(root, 'src/plaud-renderer.ts')).href;
const {renderPlaudMarkdown} = await import(rendererModuleUrl);

const syncModuleUrl = pathToFileURL(path.join(root, 'src/plaud-sync.ts')).href;
const {runPlaudSync} = await import(syncModuleUrl);

// --- API client: getFileAudioUrl ---

test('getFileAudioUrl calls /file/temp-url/{id} and returns mp3 url', async () => {
  let called = null;
  const client = createPlaudApiClient({
    apiDomain: 'https://api.plaud.ai',
    token: 'tok_123',
    request: async (req) => {
      called = req;
      return {status: 200, json: {status: 0, temp_url: 'https://s3.example.com/audio.mp3', temp_url_opus: null}};
    }
  });

  const result = await client.getFileAudioUrl('file_abc');
  assert.equal(called.method, 'GET');
  assert.equal(called.url, 'https://api.plaud.ai/file/temp-url/file_abc');
  assert.equal(called.headers.Authorization, 'Bearer tok_123');
  assert.equal(result.mp3, 'https://s3.example.com/audio.mp3');
  assert.equal(result.opus, '');
});

test('getFileAudioUrl returns both mp3 and opus when available', async () => {
  const client = createPlaudApiClient({
    apiDomain: 'https://api.plaud.ai',
    token: 'tok_123',
    request: async () => ({
      status: 200,
      json: {status: 0, temp_url: 'https://s3.example.com/audio.mp3', temp_url_opus: 'https://s3.example.com/audio.opus'}
    })
  });

  const result = await client.getFileAudioUrl('file_abc');
  assert.equal(result.mp3, 'https://s3.example.com/audio.mp3');
  assert.equal(result.opus, 'https://s3.example.com/audio.opus');
});

test('getFileAudioUrl throws when no download links are present', async () => {
  const client = createPlaudApiClient({
    apiDomain: 'https://api.plaud.ai',
    token: 'tok_123',
    request: async () => ({status: 200, json: {status: 0, temp_url: null, temp_url_opus: null}})
  });

  await assert.rejects(
    () => client.getFileAudioUrl('file_abc'),
    (error) => error instanceof PlaudApiError && error.category === 'invalid_response'
  );
});

test('getFileAudioUrl encodes fileId in the URL', async () => {
  let called = null;
  const client = createPlaudApiClient({
    apiDomain: 'https://api.plaud.ai',
    token: 'tok_123',
    request: async (req) => {
      called = req;
      return {status: 200, json: {status: 0, temp_url: 'https://s3.example.com/audio.mp3'}};
    }
  });

  await client.getFileAudioUrl('file with spaces');
  assert.equal(called.url, 'https://api.plaud.ai/file/temp-url/file%20with%20spaces');
});

// --- buildPlaudAudioFilename ---

test('buildPlaudAudioFilename produces mp3 extension matching the markdown filename', () => {
  const result = buildPlaudAudioFilename({
    filenamePattern: 'plaud-{date}-{title}',
    date: '2024-11-04',
    title: 'Weekly Sync: Team / Product'
  });

  assert.equal(result, 'plaud-2024-11-04-weekly-sync-team-product.mp3');
});

test('buildPlaudAudioFilename uses default pattern for empty input', () => {
  const result = buildPlaudAudioFilename({
    filenamePattern: '',
    date: '2024-01-01',
    title: ''
  });

  assert.equal(result, 'plaud-2024-01-01-recording.mp3');
});

// --- renderPlaudMarkdown with audio ---

const sampleDetail = {
  id: 'abc',
  fileId: 'f_abc',
  title: 'Weekly sync',
  startAtMs: 1730678400000,
  durationMs: 1800000,
  summary: 'Summary text',
  highlights: ['Highlight one'],
  transcript: 'Speaker A: Hello',
  raw: {}
};

test('renders audio section when audioFilename is provided', () => {
  const markdown = renderPlaudMarkdown(sampleDetail, {audioFilename: 'weekly-sync.mp3'});

  assert.match(markdown, /^## Audio$/m);
  assert.match(markdown, /!\[\[weekly-sync\.mp3\]\]/);

  const audioIndex = markdown.indexOf('## Audio');
  const summaryIndex = markdown.indexOf('## Summary');
  assert.ok(audioIndex < summaryIndex, 'Audio section should appear before Summary');
});

test('omits audio section when audioFilename is not provided', () => {
  const markdown = renderPlaudMarkdown(sampleDetail);
  assert.ok(!markdown.includes('## Audio'));
});

test('omits audio section when audioFilename is empty string', () => {
  const markdown = renderPlaudMarkdown(sampleDetail, {audioFilename: ''});
  assert.ok(!markdown.includes('## Audio'));
});

// --- sync loop with downloadAudio ---

function baseSettings(overrides = {}) {
  return {
    syncFolder: 'Plaud',
    filenamePattern: 'plaud-{date}-{title}',
    updateExisting: true,
    downloadAudio: false,
    lastSyncAtMs: 0,
    ...overrides
  };
}

function makeNormalizer() {
  return (raw) => ({
    id: raw.id,
    fileId: raw.file_id,
    title: raw.file_name,
    startAtMs: raw.start_time,
    durationMs: raw.duration,
    summary: '',
    highlights: [],
    transcript: '',
    raw
  });
}

function makeVault(existingFiles = new Set()) {
  return {
    ensuredFolders: [],
    createdBinaries: [],
    async ensureFolder(p) { this.ensuredFolders.push(p); },
    async listMarkdownFiles() { return []; },
    async read() { return ''; },
    async write() {},
    async create() {},
    async createBinary(p, data) { this.createdBinaries.push({path: p, size: data.byteLength}); },
    fileExists(p) { return existingFiles.has(p); }
  };
}

test('sync downloads audio when downloadAudio is enabled', async () => {
  const audioDownloads = [];
  const vault = makeVault();

  await runPlaudSync({
    api: {
      async listFiles() {
        return [{id: 'f1', file_id: 'f1', start_time: 100, is_trash: false}];
      },
      async getFileDetail(id) {
        return {id, file_id: id, file_name: 'test', start_time: 100, duration: 60000};
      },
      async getFileAudioUrl() { return {mp3: 'https://s3.example.com/audio.mp3', opus: ''}; }
    },
    vault,
    settings: baseSettings({downloadAudio: true}),
    saveCheckpoint: async () => {},
    normalizeDetail: makeNormalizer(),
    renderMarkdown: (detail, opts) => `---\nfile_id: ${detail.fileId}\n---\naudio: ${opts?.audioFilename ?? 'none'}`,
    upsertNote: async () => ({action: 'created', path: 'Plaud/test.md'}),
    downloadAudio: async (fileId, destPath) => { audioDownloads.push({fileId, destPath}); },
    buildAudioFilename: (input) => `${input.date}-test.mp3`
  });

  assert.equal(audioDownloads.length, 1);
  assert.equal(audioDownloads[0].fileId, 'f1');
  assert.match(audioDownloads[0].destPath, /\.mp3$/);
});

test('sync does not download audio when downloadAudio is disabled', async () => {
  const audioDownloads = [];

  await runPlaudSync({
    api: {
      async listFiles() {
        return [{id: 'f1', file_id: 'f1', start_time: 100, is_trash: false}];
      },
      async getFileDetail(id) {
        return {id, file_id: id, file_name: 'test', start_time: 100, duration: 60000};
      },
      async getFileAudioUrl() { return {mp3: 'https://s3.example.com/audio.mp3', opus: ''}; }
    },
    vault: makeVault(),
    settings: baseSettings({downloadAudio: false}),
    saveCheckpoint: async () => {},
    normalizeDetail: makeNormalizer(),
    renderMarkdown: () => '---\nfile_id: f1\n---',
    upsertNote: async () => ({action: 'created', path: 'Plaud/test.md'}),
    downloadAudio: async (fileId, destPath) => { audioDownloads.push({fileId, destPath}); },
    buildAudioFilename: () => 'test.mp3'
  });

  assert.equal(audioDownloads.length, 0);
});

test('sync skips audio download when file already exists in vault', async () => {
  const audioDownloads = [];
  const vault = makeVault(new Set(['Plaud/1970-01-01-test.mp3']));

  await runPlaudSync({
    api: {
      async listFiles() {
        return [{id: 'f1', file_id: 'f1', start_time: 100, is_trash: false}];
      },
      async getFileDetail(id) {
        return {id, file_id: id, file_name: 'test', start_time: 100, duration: 60000};
      },
      async getFileAudioUrl() { return {mp3: 'https://s3.example.com/audio.mp3', opus: ''}; }
    },
    vault,
    settings: baseSettings({downloadAudio: true}),
    saveCheckpoint: async () => {},
    normalizeDetail: makeNormalizer(),
    renderMarkdown: () => '---\nfile_id: f1\n---',
    upsertNote: async () => ({action: 'created', path: 'Plaud/test.md'}),
    downloadAudio: async (fileId, destPath) => { audioDownloads.push({fileId, destPath}); },
    buildAudioFilename: () => '1970-01-01-test.mp3'
  });

  assert.equal(audioDownloads.length, 0);
});
