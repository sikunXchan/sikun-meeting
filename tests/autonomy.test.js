const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../dist/core/store/jsonStore');
const { Repository } = require('../dist/core/store/repository');
const { ProjectService } = require('../dist/core/services/projectService');
const { CommissionStore } = require('../dist/core/commission/store');
const { CommissionService } = require('../dist/core/commission/service');
const { codexThreadOptions, codexOptionsForPhase } = require('../dist/core/commission/codexAgent');

function reply(text, tokens = 0) {
  return { text, observedModels: ['test-model'], estimatedCostUsd: 0, numTurns: 1, tokens };
}

async function fixture(agent, goals) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-autonomy-'));
  const repo = new Repository(new JsonStore(dir));
  const projectService = new ProjectService(repo);
  const project = await projectService.createProject('無人運用', '');
  let card;
  if (goals) {
    card = await projectService.upsertArtifactCard(project.id, {
      name: '成果物', kind: 'tool', status: '開発中', summary: '試験用', knownIssues: ['説明不足'], backlog: ['ファイルを増やす'], goals,
    });
  }
  const store = new CommissionStore(dir);
  const service = new CommissionService(store, repo, agent, dir, projectService, { retryDelayMs: () => 20 });
  return { dir, repo, projectService, project, card, store, service, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('状態の更新を待ってタイムアウトしました');
}

/** 仕事ごとに1ファイル作り、KGIは作業場所のファイル数で測る試験用AI。 */
function fileAgent(options = {}) {
  let plan = 0;
  const calls = [];
  return {
    calls,
    async run(request) {
      calls.push(request);
      const tokens = options.tokens ?? 0;
      if (request.phase === 'consultation') return reply('企画案', tokens);
      if (request.phase === 'planning') {
        plan++;
        return reply(JSON.stringify({ tasks: [{ title: `改善${plan}`, instructions: 'ファイルを作る', acceptance: 'ファイルがある', ownerPersonaId: 'engineer', reviewerPersonaId: 'qa' }] }), tokens);
      }
      if (request.phase === 'work') {
        if (options.onWork) return options.onWork(request, plan);
        if (!options.noFiles) fs.writeFileSync(path.join(request.workingDirectory, `file-${plan}.txt`), '作成済み');
        return reply('作成した', tokens);
      }
      if (request.phase === 'review') return reply(JSON.stringify({ approved: true, note: '確認した' }), tokens);
      if (request.phase === 'goal_check') return reply(JSON.stringify({ complete: true, evidence: ['ファイルを確認'], remaining: [] }), tokens);
      if (request.phase === 'kgi_check') {
        const goalId = request.prompt.match(/id=(\S+)/)[1];
        const count = fs.readdirSync(request.workingDirectory).filter((name) => name.startsWith('file-')).length;
        const current = options.fixedKgi ?? count;
        return reply(JSON.stringify({ goals: [{ id: goalId, current, evidence: `file-*.txt を数えて${current}件` }] }), tokens);
      }
      return reply('納品報告', tokens);
    },
  };
}

async function startAutonomous(f, autonomy, extra = {}) {
  const item = await f.service.create({
    projectId: f.project.id, goal: 'ファイルを増やす', successCriteria: 'ファイルが存在する',
    artifactCardId: f.card?.id, settings: { maxCalls: 200, autonomy: { enabled: true, ...autonomy } }, ...extra,
  });
  await f.service.consult(item.id, '進めてください');
  await f.service.confirmPlan(item.id, 'ファイルを作る');
  return item;
}

test('Codex案件は部門と工程に応じてサンドボックスとネットワークを変える', () => {
  const base = { model: 'gpt-6-sol', workingDirectory: '/tmp/work' };
  const legalWork = codexThreadOptions({ ...base, personaId: 'legal', tools: 'full', phase: 'work' });
  assert.equal(legalWork.sandboxMode, 'workspace-write');
  assert.equal(legalWork.networkAccessEnabled, false);
  const engineerWork = codexThreadOptions({ ...base, personaId: 'engineer', tools: 'full', phase: 'work' });
  assert.equal(engineerWork.sandboxMode, 'workspace-write');
  assert.equal(engineerWork.networkAccessEnabled, true);
  const engineerReview = codexThreadOptions({ ...base, personaId: 'engineer', tools: 'full', phase: 'review' });
  assert.equal(engineerReview.sandboxMode, 'read-only');
  assert.equal(engineerReview.networkAccessEnabled, true);
  const legalReview = codexThreadOptions({ ...base, personaId: 'legal', tools: 'full', phase: 'review' });
  assert.equal(legalReview.sandboxMode, 'read-only');
  assert.equal(legalReview.networkAccessEnabled, false);
  for (const phase of ['consultation', 'planning', 'goal_check', 'kgi_check', 'delivery']) {
    for (const personaId of ['engineer', 'critic', 'it_consultant', 'product']) {
      const options = codexThreadOptions({ ...base, personaId, tools: 'read', phase });
      assert.equal(options.sandboxMode, 'read-only', `${personaId} ${phase}`);
      assert.equal(options.networkAccessEnabled, false, `${personaId} ${phase}`);
      assert.equal(options.webSearchMode, 'disabled');
      if (phase === 'consultation' || phase === 'planning' || phase === 'delivery') assert.equal(options.modelReasoningEffort, 'low');
      else assert.equal(options.modelReasoningEffort, undefined);
    }
  }
});

test('Codexの企画相談・計画・納品では探索ツールを有効化しない', () => {
  for (const phase of ['consultation', 'planning', 'delivery']) {
    const options = codexOptionsForPhase(phase);
    assert.equal(options.config.features.shell_tool, false);
    assert.equal(options.config.features.code_mode_host, false);
    assert.equal(options.config.features.apps, false);
  }
  assert.deepEqual(codexOptionsForPhase('work').config, { features: { image_generation: false } });
  assert.deepEqual(codexOptionsForPhase('review').config, { features: { image_generation: false } });
});

test('無人運用では一時的な失敗を自動で再試行して納品まで進む', async (t) => {
  let failures = 0;
  const agent = fileAgent({
    onWork(request, plan) {
      if (failures < 2) { failures++; throw new Error('一時的な接続エラー'); }
      fs.writeFileSync(path.join(request.workingDirectory, `file-${plan}.txt`), '作成済み');
      return reply('作成した');
    },
  });
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await startAutonomous(f, { retryLimit: 3 });
  const done = await waitFor(() => { const current = f.store.get(item.id); return current.status === 'delivered' && current; });
  assert.equal(failures, 2);
  assert.equal(done.stopReason, undefined);
  const events = f.store.events(item.id).map((event) => event.detail);
  assert.equal(events.filter((detail) => detail.includes('人間の操作なしで再開')).length, 2);
});

test('自動再試行の上限を超えると理由を残して停止する', async (t) => {
  const agent = fileAgent({ onWork() { throw new Error('恒常的なエラー'); } });
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await startAutonomous(f, { retryLimit: 2 });
  const failed = await waitFor(() => { const current = f.store.get(item.id); return current.status === 'failed' && !current.autoRetry && current; });
  assert.match(failed.stopReason, /自動再試行の上限（2回）/);
  assert.equal(agent.calls.filter((call) => call.phase === 'work').length, 3);
});

test('再起動後は無人運用の案件だけを自動で再開する', async (t) => {
  const agent = fileAgent();
  const f = await fixture(agent); t.after(f.cleanup);
  const auto = await f.service.create({ projectId: f.project.id, goal: '無人', successCriteria: 'ファイルがある', settings: { autonomy: { enabled: true } } });
  const manual = await f.service.create({ projectId: f.project.id, goal: '手動', successCriteria: 'ファイルがある' });
  for (const id of [auto.id, manual.id]) {
    await f.store.update(id, (item) => {
      item.status = 'running'; item.planText = 'ファイルを作る'; item.planConfirmedAt = new Date().toISOString();
    });
  }
  const restartedStore = new CommissionStore(f.dir);
  assert.equal(restartedStore.get(auto.id).status, 'interrupted');
  const restarted = new CommissionService(restartedStore, f.repo, agent, f.dir, f.projectService, { retryDelayMs: () => 20 });
  restarted.resumeAutonomous();
  await waitFor(() => restartedStore.get(auto.id).status === 'delivered');
  assert.equal(restartedStore.get(manual.id).status, 'interrupted');
});

test('KGI未達なら同じ企画のまま改善サイクルを続け、KGI達成で止まる', async (t) => {
  const agent = fileAgent();
  const f = await fixture(agent, [{ label: 'ファイル数', target: 2, current: 0, unit: '件', evidence: '' }]);
  t.after(f.cleanup);
  const item = await startAutonomous(f, { continuous: true, maxCycles: 5 });
  const done = await waitFor(() => { const current = f.store.get(item.id); return current.status === 'delivered' && current; });
  assert.equal(done.stopReason, 'KGIを達成しました');
  assert.equal(done.cycles.length, 2);
  assert.deepEqual(done.cycles.map((cycle) => cycle.kgi[0].current), [1, 2]);
  assert.equal(done.planText, 'ファイルを作る');
  assert.match(done.revisionRequests.at(-1), /^継続サイクル2: KGIが未達です（ファイル数 1\/2件）/);
  assert.equal(agent.calls.filter((call) => call.phase === 'kgi_check').every((call) => call.personaId === 'critic' && call.tools === 'read'), true);
  const goalCheckPrompt = agent.calls.filter((call) => call.phase === 'goal_check').at(-1).prompt;
  assert.match(goalCheckPrompt, /今回の継続サイクルで満たすべき追加条件:\n継続サイクル2:/);
  const card = f.repo.getProject(f.project.id).artifactCards[0].versions.at(-1);
  assert.equal(card.goals[0].current, 2);
  assert.equal(card.source, 'commission');
});

test('サイクル数の上限で停止し、自動再試行しない', async (t) => {
  const agent = fileAgent();
  const f = await fixture(agent, [{ label: 'ファイル数', target: 10, current: 0, unit: '件', evidence: '' }]);
  t.after(f.cleanup);
  const item = await startAutonomous(f, { continuous: true, maxCycles: 1 });
  const done = await waitFor(() => { const current = f.store.get(item.id); return current.status === 'delivered' && current; });
  assert.match(done.stopReason, /サイクル数の上限（1）/);
  assert.equal(done.autoRetry, undefined);
});

test('トークン予算に達したら再試行せずに停止する', async (t) => {
  const agent = fileAgent({ tokens: 1000 });
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await startAutonomous(f, { maxTokens: 1500, retryLimit: 3 });
  const stopped = await waitFor(() => { const current = f.store.get(item.id); return current.status === 'failed' && current; });
  assert.match(stopped.stopReason, /トークン予算（1500）/);
  assert.equal(stopped.autoRetry, undefined);
  assert.equal(stopped.runs.reduce((sum, run) => sum + run.tokens, 0), 2000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.store.get(item.id).status, 'failed');
});

test('3サイクル続けて採用ファイルもKGIの改善もなければ無進捗で止める', async (t) => {
  const agent = fileAgent({ noFiles: true, fixedKgi: 0 });
  const f = await fixture(agent, [{ label: 'ファイル数', target: 5, current: null, unit: '件', evidence: '' }]);
  t.after(f.cleanup);
  const item = await startAutonomous(f, { continuous: true, maxCycles: 10 });
  const done = await waitFor(() => { const current = f.store.get(item.id); return current.status === 'delivered' && current; });
  assert.match(done.stopReason, /^無進捗/);
  assert.equal(done.cycles.length, 4);
});

test('KGIまでの継続にはKGI付きの成果物カルテが必要', async (t) => {
  const f = await fixture(fileAgent()); t.after(f.cleanup);
  await assert.rejects(() => f.service.create({ projectId: f.project.id, goal: '継続', successCriteria: '条件',
    settings: { autonomy: { enabled: true, continuous: true } } }), /KGIを設定した成果物カルテ/);
  await assert.rejects(() => f.service.create({ projectId: f.project.id, goal: '継続', successCriteria: '条件',
    settings: { maxCalls: 201 } }), /最大呼び出し回数/);
  const wide = await f.service.create({ projectId: f.project.id, goal: '無人', successCriteria: '条件',
    settings: { maxCalls: 2000, autonomy: { enabled: true } } });
  assert.equal(wide.settings.maxCalls, 2000);
});

test('後続の作業には前の仕事の報告を切り詰めて渡す', async (t) => {
  const long = 'あ'.repeat(2000);
  const prompts = [];
  const agent = { async run(request) {
    if (request.phase === 'consultation') return reply('企画案');
    if (request.phase === 'planning') return reply(JSON.stringify({ tasks: [
      { title: '前半', instructions: '書く', acceptance: '書いた', ownerPersonaId: 'engineer', reviewerPersonaId: 'qa' },
      { title: '後半', instructions: '書く', acceptance: '書いた', ownerPersonaId: 'engineer', reviewerPersonaId: 'qa' },
    ] }));
    if (request.phase === 'work') { prompts.push(request.prompt); return reply(prompts.length === 1 ? long : '短い報告'); }
    if (request.phase === 'review') return reply(JSON.stringify({ approved: true, note: '確認した' }));
    if (request.phase === 'goal_check') return reply(JSON.stringify({ complete: true, evidence: ['確認'], remaining: [] }));
    return reply('納品');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: '長文', successCriteria: '書いた' });
  await f.service.consult(item.id, '進めて');
  await f.service.confirmPlan(item.id, '書く');
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].includes(long), false);
  assert.match(prompts[1], /前半: あ{600}…（以下省略）/);
});
