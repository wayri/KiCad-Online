const test = require('node:test');
const assert = require('node:assert/strict');

const extensionOrigin = 'chrome-extension://comparison-test/';
const sessionRecord = { tabId: 42, provider: 'github', host: 'https://github.com',
  repository: 'owner/repo', inline: false };
const gitlabRecord = { tabId: 43, provider: 'gitlab', host: 'https://gitlab.com',
  repository: 'team/sub/repo', inline: false };
const session = new Map([['repository-view-sessions-v1', [sessionRecord, gitlabRecord]]]);
const local = new Map();
const area = store => ({ get: async key => ({ [key]: store.get(key) }),
  set: async items => { for (const [key, value] of Object.entries(items)) store.set(key, value); },
  remove: async key => { store.delete(key); } });
let listener, websiteURL = 'https://github.com/owner/repo/tree/main';
let gitlabURL = 'https://gitlab.com/team/sub/repo';
global.KiCadGitHub = require('../parsing.js');
global.KiCadProjectLaunch = require('../project-launch.js');
global.KiCadGitHubSessionReader = require('../github-session-reader.js');
global.KiCadGitHubProjectBuffer = require('../github-project-buffer.js');
const projectReads = [];
global.KiCadGitHubProjectView = { create: () => ({ read: async message => {
  projectReads.push(message);
  if (message.type === 'revision-resolve') return { sha: 'a'.repeat(40) };
  if (message.type === 'drawing-files') return { files: ['board.kicad_pcb', 'board.kicad_sch'] };
  if (message.type === 'project-file') return { path: message.file, content: '(kicad_pcb)' };
  return [{ path: message.file, content: '(kicad_pcb)' }];
} }) };
global.KiCadBrowserData = require('../browser-data.js');
global.KiCadReviewComments = require('../review-comments.js');
global.KiCadGitHubReviewApi = require('../github-review-api.js');
global.KiCadReviewFileStore = { status: async () => ({ connected: false }) };
global.KiCadEnvironmentDiagnostics = require('../environment-diagnostics.js');
global.KiCadGitLabHosts = { allowed: async host => host === 'https://gitlab.com' };
global.KiCadGitLabProvider = { forHost: () => ({
  resolve: async () => ({ sha: 'b'.repeat(40) }),
  projectFile: async (repository, ref, file) => ({ path: file, content: 'Reference,Value\nR1,1k\n' })
}) };
global.importScripts = () => {};
global.chrome = {
  runtime: { id: 'comparison-test', getURL: path => extensionOrigin + path,
    onMessage: { addListener: value => { listener = value; } } },
  action: { onClicked: { addListener() {} }, setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  storage: { local: area(local), session: area(session) },
  tabs: { get: async id => ({ id, url: id === 43 ? gitlabURL : websiteURL }), query: async () => [],
    sendMessage: async () => ({ ok: false, error: 'No website response.' }) }
};
require('../background.js');
const sender = query => ({ id: 'comparison-test', frameId: 0,
  url: extensionOrigin + 'comparison-viewer.html?' + new URLSearchParams(query) });
const scope = { repository: 'owner/repo', file: 'board.kicad_pcb' };
const allowed = sender(scope);
const read = (type, source = allowed, extra = {}) => new Promise(resolve => {
  const message = { type, repository: 'owner/repo', provider: 'github', host: 'https://github.com',
    ref: 'a'.repeat(40), file: 'board.kicad_pcb', ...extra };
  if (!listener(message, source, resolve)) resolve({ ignored: true });
});

test('comparison source reads require matching top-level page and live bound repository session', async () => {
  assert.equal((await read('project-file', { ...allowed, frameId: 1 })).ignored, true);
  assert.equal((await read('project-file', sender({ repository: 'other/repo', file: scope.file }))).ok, false);
  assert.equal((await read('project-file', allowed, { repository: 'other/repo' })).ok, false);
  assert.equal((await read('project-file', allowed, { file: 'other.kicad_pcb' })).ok, false);
  assert.equal((await read('comment-save')).ok, false);
  websiteURL = 'https://github.com/other/repo';
  assert.match((await read('project-file')).error, /matching repository website session/);
  websiteURL = 'https://github.com/owner/repo/tree/main';
});

test('comparison reads return source object and project array without write permissions', async () => {
  const prior = projectReads.length;
  const source = await read('project-file');
  assert.equal(source.ok, true);
  assert.equal(source.result.path, 'board.kicad_pcb');
  const project = await read('project');
  assert.equal(project.ok, true);
  assert.ok(Array.isArray(project.result));
  assert.equal(project.result[0].path, 'board.kicad_pcb');
  assert.equal(projectReads.length, prior + 2);
});

test('renamed file scope allows only the two URL-specified paths', async () => {
  const renamed = sender({ ...scope, oldFile: 'previous.kicad_pcb' });
  assert.equal((await read('project-file', renamed, { file: 'previous.kicad_pcb' })).ok, true);
  assert.match((await read('project-file', renamed, { file: 'third.kicad_pcb' })).error, /scope/);
  const cross = sender({ ...scope, headRepository: 'other/repo' });
  assert.match((await read('project-file', cross)).error, /scope/);
});

test('CSV and GitLab subgroup source reads stay in their exact bound sessions', async () => {
  const csv = sender({ repository: 'owner/repo', file: 'bom.csv' });
  assert.equal((await read('project-file', csv, { file: 'bom.csv' })).ok, true);
  const gitlab = sender({ repository: 'team/sub/repo', file: 'bom.csv',
    provider: 'gitlab', host: 'https://gitlab.com' });
  const message = { repository: 'team/sub/repo', provider: 'gitlab', host: 'https://gitlab.com',
    file: 'bom.csv' };
  assert.equal((await read('project-file', gitlab, message)).ok, true);
  assert.equal((await read('revision-resolve', gitlab, message)).result.sha, 'b'.repeat(40));
  gitlabURL = 'https://gitlab.com/other/repo';
  assert.match((await read('project-file', gitlab, message)).error, /matching repository website session/);
  gitlabURL = 'https://gitlab.com/team/sub/repo';
});

test('only a same-stem drawing companion can be loaded from scoped inventory', async () => {
  const listing = await read('drawing-files');
  assert.deepEqual(listing.result.files, ['board.kicad_pcb', 'board.kicad_sch']);
  assert.equal((await read('project', allowed, { file: 'board.kicad_sch' })).ok, true);
  assert.match((await read('project', allowed, { file: 'different.kicad_sch' })).error, /scope/);
});
