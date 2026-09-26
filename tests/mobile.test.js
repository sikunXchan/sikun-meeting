const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JsonStore } = require('../dist/core/store/jsonStore');
const { Repository } = require('../dist/core/store/repository');
const { PERSONAS } = require('../dist/core/personas');
const { buildSnapshot } = require('../dist/core/mobile/snapshot');
const { createShareKey, deriveShareKeys, encryptSnapshot } = require('../dist/core/mobile/envelope');
const { MobileSyncService, normalizeBaseUrl } = require('../dist/core/mobile/service');

const root = path.join(__dirname, '..');
const importMobile = (relative) => import(pathToFileURL(path.join(root, 'mobile', relative)).href);
const ID = 'a'.repeat(64);

function memoryStorage() {
  const files = new Map();
  return {
    files,
    async read(pathname) { return files.has(pathname) ? files.get(pathname) : null; },
    async write(pathname, text) { files.set(pathname, text); },
    async remove(pathname) { files.delete(pathname); },
  };
}

function envelope() {
  return encryptSnapshot('{"v":1}', deriveShareKeys(createShareKey()).encryptionKey);
}

function request(method, { id = ID, token, body } = {}) {
  return new Request(`https://example.test/api/snapshot?id=${id}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });
}

function meeting(overrides = {}) {
  return {
    id: 'm1', projectId: 'p1', meetingTypeId: 'architecture_review', title: '設計会議', agenda: '# 議題',
    status: 'CONCLUDED',
    participants: [{ id: 'pa', personaId: 'architect', status: 'ACTIVE', invitedAt: '2026-09-26T00:00:00.000Z' }],
    transcript: [
      { id: 'x1', meetingId: 'm1', speakerType: 'HUMAN', speakerId: 'chief', content: '始めます', stance: null, createdAt: '2026-09-26T00:01:00.000Z' },
      { id: 'x2', meetingId: 'm1', speakerType: 'AI', speakerId: 'architect#pa', content: '**賛成**です', stance: '賛成', createdAt: '2026-09-26T00:02:00.000Z', roundKind: 'initial', requestedModel: 'claude-opus-5-5', effectiveModel: 'claude-opus-5-5' },
    ],
    decision: {
      decisionText: '採用する', reasoning: ['安全'], disagreements: [{ participantId: 'pa', stance: '賛成', note: 'よい' }],
      actionItems: [{ id: 'ai1', description: '実装する', assignee: 'engineer', done: false }],
      decidedBy: 'chief', decidedAt: '2026-09-26T00:03:00.000Z',
      gate: { ready: true, recommended: true, reasons: [], activeCount: 1, validStanceCount: 1, supportCount: 1, opposeCount: 0, riskCount: 0, checkedAt: '2026-09-26T00:03:00.000Z' },
    },
    createdAt: '2026-09-26T00:00:00.000Z', startedAt: '2026-09-26T00:00:00.000Z', endedAt: '2026-09-26T00:03:00.000Z',
    workingDirectory: '/home/secret/project',
    initialRound: { status: 'published', participantIds: ['pa'], baseTranscriptLength: 1, responses: [{ id: 'hidden', content: '非公開の下書き' }], startedAt: '2026-09-26T00:01:00.000Z' },
    ...overrides,
  };
}

const project = { id: 'p1', name: '試験PJ', description: '', meetingIds: ['m1'], createdAt: '2026-09-26T00:00:00.000Z',
  actionItems: [{ id: 'ai1', description: '実装する', assignee: 'engineer', done: true, meetingId: 'm1', sourceMeetingTitle: '設計会議' }] };

test('保存APIは同期トークンがない書き込み・削除を拒否する', async () => {
  const { createHandler } = await importMobile('lib/handler.js');
  const storage = memoryStorage();
  const handle = createHandler({ storage, syncToken: 's'.repeat(32) });
  const body = JSON.stringify(envelope());
  assert.equal((await handle(request('PUT', { body }))).status, 401);
  assert.equal((await handle(request('PUT', { body, token: 'wrong-token-value-000000000000' }))).status, 401);
  assert.equal((await handle(request('DELETE', { token: 's'.repeat(31) }))).status, 401);
  assert.equal(storage.files.size, 0);
  const unset = createHandler({ storage, syncToken: '' });
  assert.equal((await unset(request('PUT', { body, token: '' }))).status, 401);
  assert.equal((await unset(request('PUT', { body, token: 'anything' }))).status, 401);
});

test('保存APIは形式外のID・本文と上限超えを拒否する', async () => {
  const { createHandler, MAX_BODY_BYTES } = await importMobile('lib/handler.js');
  const storage = memoryStorage();
  const token = 't'.repeat(32);
  const handle = createHandler({ storage, syncToken: token });
  assert.equal((await handle(request('GET', { id: '../x' }))).status, 400);
  assert.equal((await handle(request('GET', { id: 'A'.repeat(64) }))).status, 400);
  assert.equal((await handle(request('PUT', { token, body: 'not json' }))).status, 400);
  assert.equal((await handle(request('PUT', { token, body: JSON.stringify({ ...envelope(), extra: 1 }) }))).status, 400);
  assert.equal((await handle(request('PUT', { token, body: JSON.stringify({ ...envelope(), v: 2 }) }))).status, 400);
  const huge = JSON.stringify({ ...envelope(), data: 'A'.repeat(MAX_BODY_BYTES) });
  assert.equal((await handle(request('PUT', { token, body: huge }))).status, 413);
  assert.equal((await handle(request('POST', { token, body: '{}' }))).status, 405);
  assert.equal(storage.files.size, 0);
});

test('保存APIは暗号文を保存・返却・削除し、キャッシュさせない', async () => {
  const { createHandler } = await importMobile('lib/handler.js');
  const storage = memoryStorage();
  const token = 'u'.repeat(32);
  const handle = createHandler({ storage, syncToken: token });
  assert.equal((await handle(request('GET'))).status, 404);
  const sealed = envelope();
  assert.equal((await handle(request('PUT', { token, body: JSON.stringify(sealed) }))).status, 200);
  assert.deepEqual([...storage.files.keys()], [`snapshots/${ID}.json`]);
  const got = await handle(request('GET'));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await got.json(), sealed);
  assert.equal((await handle(request('DELETE', { token }))).status, 200);
  assert.equal((await handle(request('GET'))).status, 404);
});

test('スナップショットは作業場所・モデル名・非公開の初回意見を含めず、Action Itemの完了はProjectに従う', () => {
  const snapshot = buildSnapshot([meeting()], [project], '2026-09-26T01:00:00.000Z');
  const text = JSON.stringify(snapshot);
  for (const secret of ['/home/secret/project', 'claude-opus-5-5', '非公開の下書き', 'workingDirectory', 'initialRound', 'supportCount']) {
    assert.equal(text.includes(secret), false, secret);
  }
  const [item] = snapshot.meetings;
  assert.equal(item.typeName, getMeetingTypeName('architecture_review'));
  assert.deepEqual(item.participants[0], { id: 'pa', personaId: 'architect', name: 'Architect', emoji: '🧠', roleTitle: 'システム・技術設計の専門家', avatar: 'architect.png', active: true });
  assert.deepEqual(item.messages.map((message) => [message.speaker, message.participantId, message.stance]), [['human', undefined, null], ['ai', 'pa', '賛成']]);
  assert.equal(item.decision.actionItems[0].done, true);
  assert.deepEqual(snapshot.projects, [{ id: 'p1', name: '試験PJ' }]);
});

function getMeetingTypeName(id) {
  return require('../dist/core/meetingTypes').getMeetingTypeById(id).name;
}

test('デスクトップの暗号文をスマホ側の処理で復号でき、別の鍵では失敗する', async () => {
  const { deriveKeys, decryptEnvelope, isShareKey } = await importMobile('public/js/crypto.js');
  const shareKey = createShareKey();
  assert.equal(isShareKey(shareKey), true);
  assert.equal(isShareKey('short'), false);
  const snapshot = buildSnapshot([meeting()], [project]);
  const sealed = encryptSnapshot(JSON.stringify(snapshot), deriveShareKeys(shareKey).encryptionKey);
  const keys = await deriveKeys(shareKey);
  assert.equal(keys.id, deriveShareKeys(shareKey).id);
  assert.deepEqual(await decryptEnvelope(sealed, keys.aesKey), JSON.parse(JSON.stringify(snapshot)));
  const other = await deriveKeys(createShareKey());
  await assert.rejects(() => decryptEnvelope(sealed, other.aesKey));
  const tampered = { ...sealed, data: Buffer.from(Buffer.from(sealed.data, 'base64').map((byte, index) => index === 0 ? byte ^ 1 : byte)).toString('base64') };
  await assert.rejects(() => decryptEnvelope(tampered, keys.aesKey));
});

async function syncFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-mobile-'));
  const repo = new Repository(new JsonStore(dir));
  await repo.saveProject(project);
  await repo.saveMeeting(meeting());
  const calls = [];
  const { createHandler } = await importMobile('lib/handler.js');
  const storage = memoryStorage();
  const handle = createHandler({ storage, syncToken: 'v'.repeat(32) });
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init.method, bytes: init.body ? Buffer.byteLength(init.body) : 0 });
    return handle(new Request(url, init));
  };
  let token = null;
  const tokens = { get: () => token, set: (value) => { token = value; }, source: () => token ? 'secure' : 'none' };
  const service = new MobileSyncService(dir, repo, tokens, { fetch: fakeFetch, ...options });
  return { dir, repo, calls, storage, service, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('同期は内容が変わったときだけ送り、トークンを設定ファイルに書かない', async (t) => {
  const f = await syncFixture(); t.after(f.cleanup);
  const view = await f.service.configure({ baseUrl: 'https://sikun.example.com/', enabled: true, token: 'v'.repeat(32) });
  assert.equal(view.baseUrl, 'https://sikun.example.com');
  assert.match(view.pairingUrl, /^https:\/\/sikun\.example\.com\/#k=[A-Za-z0-9_-]{43}$/);
  assert.equal(view.status.meetings, 1);
  assert.equal(f.calls.filter((call) => call.method === 'PUT').length, 1);
  await f.service.syncNow();
  assert.equal(f.calls.filter((call) => call.method === 'PUT').length, 1);
  await f.repo.updateMeeting('m1', (item) => { item.title = '設計会議（更新）'; });
  await f.service.syncNow();
  assert.equal(f.calls.filter((call) => call.method === 'PUT').length, 2);
  const settings = fs.readFileSync(path.join(f.dir, 'mobile-sync.json'), 'utf8');
  assert.equal(settings.includes('v'.repeat(32)), false);
  const { deriveKeys, decryptEnvelope } = await importMobile('public/js/crypto.js');
  const shareKey = view.pairingUrl.split('#k=')[1];
  const keys = await deriveKeys(shareKey);
  const stored = JSON.parse(f.storage.files.get(`snapshots/${keys.id}.json`));
  assert.equal((await decryptEnvelope(stored, keys.aesKey)).meetings[0].title, '設計会議（更新）');
});

test('上限を超える場合は古い会議から省き、省いた件数を記録する', async (t) => {
  const f = await syncFixture({ maxBytes: 3000 }); t.after(f.cleanup);
  for (let index = 0; index < 12; index++) {
    const noise = require('node:crypto').randomBytes(300).toString('hex');
    await f.repo.saveMeeting(meeting({ id: `n${index}`, title: `会議${index}`, agenda: noise, createdAt: `2026-09-${String(10 + index).padStart(2, '0')}T00:00:00.000Z` }));
  }
  const view = await f.service.configure({ baseUrl: 'https://sikun.example.com', enabled: true, token: 'v'.repeat(32) });
  assert.ok(view.status.omitted > 0, JSON.stringify(view.status));
  assert.ok(view.status.bytes <= 3000);
  const { deriveKeys, decryptEnvelope } = await importMobile('public/js/crypto.js');
  const keys = await deriveKeys(view.pairingUrl.split('#k=')[1]);
  const snapshot = await decryptEnvelope(JSON.parse(f.storage.files.get(`snapshots/${keys.id}.json`)), keys.aesKey);
  assert.equal(snapshot.omittedMeetings, view.status.omitted);
  assert.equal(snapshot.meetings.length + snapshot.omittedMeetings, 13);
  const kept = snapshot.meetings.map((item) => item.createdAt);
  assert.deepEqual(kept, [...kept].sort().reverse());
});

test('鍵を作り直すと新しいIDへ送り、古い暗号文を削除する', async (t) => {
  const f = await syncFixture(); t.after(f.cleanup);
  const before = await f.service.configure({ baseUrl: 'https://sikun.example.com', enabled: true, token: 'v'.repeat(32) });
  const oldId = deriveShareKeys(before.pairingUrl.split('#k=')[1]).id;
  assert.ok(f.storage.files.has(`snapshots/${oldId}.json`));
  const after = await f.service.rotateKey();
  const newId = deriveShareKeys(after.pairingUrl.split('#k=')[1]).id;
  assert.notEqual(newId, oldId);
  assert.deepEqual([...f.storage.files.keys()], [`snapshots/${newId}.json`]);
  assert.equal(after.status.error, undefined);
});

test('公開先URLと同期トークンの入力を検証する', async (t) => {
  const f = await syncFixture(); t.after(f.cleanup);
  assert.equal(normalizeBaseUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.throws(() => normalizeBaseUrl('http://sikun.example.com'), /https/);
  assert.throws(() => normalizeBaseUrl('https://sikun.example.com/path'), /ドメインまで/);
  await assert.rejects(() => f.service.configure({ baseUrl: 'https://sikun.example.com', enabled: true, token: 'short' }), /16文字/);
  await assert.rejects(() => f.service.configure({ baseUrl: 'https://sikun.example.com', enabled: true }), /同期トークン/);
  const failing = await f.service.configure({ baseUrl: 'https://sikun.example.com', enabled: true, token: 'w'.repeat(32) });
  assert.match(failing.status.error, /SYNC_TOKEN と一致しません/);
});

test('PWAのHTML整形・Markdown・ペルソナ画像はデスクトップと同じ', () => {
  const same = (a, b) => assert.equal(fs.readFileSync(path.join(root, a), 'utf8'), fs.readFileSync(path.join(root, b), 'utf8'), `${a} != ${b}`);
  same('dist/renderer/sanitize.js', 'mobile/public/js/sanitize.js');
  same('node_modules/marked/lib/marked.umd.js', 'mobile/public/vendor/marked.umd.js');
  for (const file of [...new Set([...PERSONAS.map((persona) => persona.avatar), 'chief.png', 'default.png'])]) {
    assert.ok(fs.existsSync(path.join(root, 'mobile', 'public', 'personas', file)), file);
  }
  const worker = fs.readFileSync(path.join(root, 'mobile', 'public', 'sw.js'), 'utf8');
  for (const [, file] of worker.matchAll(/'(\/[^']+\.(?:js|css|png|webmanifest|html))'/g)) {
    assert.ok(fs.existsSync(path.join(root, 'mobile', 'public', file)), `sw.jsのキャッシュ対象 ${file}`);
  }
});
