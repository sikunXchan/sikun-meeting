const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../dist/core/store/jsonStore');
const { Repository } = require('../dist/core/store/repository');
const { ProjectService } = require('../dist/core/services/projectService');
const { CommunityStore } = require('../dist/core/community/store');
const { CommunityService } = require('../dist/core/community/service');

async function fixture(agent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-community-'));
  const repo = new Repository(new JsonStore(dir));
  const project = await new ProjectService(repo).createProject('開発', '実用的な機能を作る');
  const commissions = [];
  let createCount = 0;
  const commissionService = {
    list: (projectId) => commissions.filter((entry) => entry.projectId === projectId),
    get: (id) => ({ commission: commissions.find((entry) => entry.id === id) }),
    async create(input) {
      createCount++;
      const commission = { id: 'commission-' + createCount, ...input, status: 'consulting', workItems: [] };
      commissions.push(commission);
      return commission;
    },
  };
  const store = new CommunityStore(dir);
  const service = new CommunityService(store, repo, commissionService, agent);
  return {
    dir, project, store, service, commissions, getCreateCount: () => createCount,
    cleanup: () => {
      if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary path escaped');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('初回意見は独立させ、公開後の議論では他の発言と採用知識を読める', async (t) => {
  const prompts = [];
  const f = await fixture(async (persona, prompt) => {
    prompts.push({ personaId: persona.id, prompt });
    return { text: persona.id + 'の具体案', isError: false };
  });
  t.after(f.cleanup);
  const first = await f.service.create({
    projectId: f.project.id, title: '設定画面を改善', body: '操作時間を減らす',
    personaIds: ['product', 'critic'],
  });
  await f.service.comment(first.id, '既存設定との互換性を重視');
  const events = [];
  await f.service.runRound(first.id, (event) => events.push(event));
  assert.equal(f.service.get(first.id).messages.length, 3);
  assert.equal(prompts[1].prompt.includes('productの具体案'), false);
  assert.equal(prompts[0].prompt.includes('既存設定との互換性'), true);
  assert.equal(events.filter((event) => event.type === 'turn-end').length, 2);
  await f.service.runRound(first.id);
  assert.equal(prompts[2].prompt.includes('productの具体案'), true);
  await f.service.accept(first.id, '設定を一画面に整理し、既存値を保持する');
  const second = await f.service.create({ projectId: f.project.id, title: '次の課題', body: '設定をテストする', personaIds: ['qa'] });
  await f.service.runRound(second.id);
  assert.equal(prompts[4].prompt.includes('設定を一画面に整理'), true);
  const reopened = new CommunityStore(f.dir);
  assert.equal(reopened.get(first.id).acceptedAt !== null, true);
  assert.equal(reopened.get(first.id).messages[2].authorId, 'critic');
});

test('同じ投稿からの並行した委託は1件にまとまる', async (t) => {
  const f = await fixture(async () => ({ text: '意見', isError: false }));
  t.after(f.cleanup);
  const post = await f.service.create({ projectId: f.project.id, title: '成果物を作る', body: '利用者向けの説明を書く' });
  const [a, b] = await Promise.all([f.service.startCommission(post.id), f.service.startCommission(post.id)]);
  assert.equal(a.id, b.id);
  assert.equal(f.getCreateCount(), 1);
  assert.equal(f.service.get(post.id).commissionId, a.id);
  const restarted = new CommunityService(new CommunityStore(f.dir), new Repository(new JsonStore(f.dir)), {
    list: () => f.commissions,
    get: (id) => ({ commission: f.commissions.find((entry) => entry.id === id) }),
  }, async () => ({ text: '', isError: false }));
  assert.equal((await restarted.startCommission(post.id)).id, a.id);
});

test('AIの失敗を発言として保存せず、次の試行を可能にする', async (t) => {
  let fail = true;
  const f = await fixture(async () => {
    if (fail) return { text: 'SDKに接続できません', isError: true };
    return { text: '再試行で回答', isError: false };
  });
  t.after(f.cleanup);
  const post = await f.service.create({ projectId: f.project.id, title: '接続を確認', body: '失敗時の再試行', personaIds: ['qa'] });
  await assert.rejects(() => f.service.runRound(post.id));
  assert.equal(f.service.get(post.id).messages.length, 0);
  fail = false;
  await f.service.runRound(post.id);
  assert.equal(f.service.get(post.id).messages[0].content, '再試行で回答');
});

test('AIが既存の成果から根拠付きの課題を投稿する', async (t) => {
  let seenPrompt = '';
  const f = await fixture(async (_persona, prompt) => {
    seenPrompt = prompt;
    return { text: JSON.stringify({ title: '次の改善', body: '前の納品を踏まえ、利用手順を整える。完了条件: 手順書を確認する。' }), isError: false };
  });
  t.after(f.cleanup);
  await assert.rejects(() => f.service.suggest(f.project.id), /まだありません/);
  f.commissions.push({
    id: 'prior', projectId: f.project.id, goal: '設定画面を作る',
    status: 'delivered', delivery: '設定画面を納品した',
  });
  const post = await f.service.suggest(f.project.id);
  assert.equal(post.createdBy, 'ai');
  assert.equal(post.creatorPersonaId, 'product');
  assert.equal(seenPrompt.includes('設定画面を納品した'), true);
  assert.equal(f.service.list(f.project.id)[0].title, '次の改善');
});
