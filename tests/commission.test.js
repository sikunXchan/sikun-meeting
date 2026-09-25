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
const { RoutedAgentClient } = require('../dist/core/commission/agentRouter');
const { snapshotWorkspace } = require('../dist/core/commission/artifacts');

const taskPlan = JSON.stringify({ tasks: [{
  title: '成果物を作る', instructions: 'hello.txtを作る', acceptance: 'hello.txtがある',
  ownerPersonaId: 'engineer', reviewerPersonaId: 'qa',
}] });

test('完了条件が未達なら追加作業を計画し、検証を通るまで納品しない', async (t) => {
  let planCount = 0;
  let checkCount = 0;
  const agent = { async run(request) {
    if (request.phase === 'goal_check') {
      checkCount++;
      return response(JSON.stringify(checkCount === 1
        ? { complete: false, evidence: ['初版を確認'], remaining: ['説明書がない'] }
        : { complete: true, evidence: ['説明書を実ファイルで確認'], remaining: [] }));
    }
    if (request.personaId === 'product') {
      planCount++;
      return response(JSON.stringify({ tasks: [{
        title: planCount === 1 ? '初版' : '説明書',
        instructions: planCount === 1 ? '初版を作る' : '説明書を作る',
        acceptance: 'ファイルがある', ownerPersonaId: 'engineer', reviewerPersonaId: 'qa',
      }] }));
    }
    if (request.personaId === 'engineer') {
      fs.writeFileSync(path.join(request.workingDirectory, planCount === 1 ? 'app.txt' : 'manual.txt'), '作成済み');
      return response('ファイルを作成した');
    }
    if (request.personaId === 'qa') return response(JSON.stringify({ approved: true, note: 'ファイルを確認した' }));
    return response(request.phase === 'delivery' ? '納品した' : '企画案');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: 'アプリと説明書を作る',
    successCriteria: 'app.txtとmanual.txtが存在すること' });
  await f.service.consult(item.id, '進めてください');
  await f.service.confirmPlan(item.id, 'アプリと説明書を作る');
  const delivered = await waitFor(() => {
    const current = f.store.get(item.id);
    return current.status === 'delivered' || current.status === 'failed' ? current : null;
  });
  assert.equal(delivered.status, 'delivered', delivered.error);
  assert.equal(planCount, 2);
  assert.deepEqual(delivered.goalChecks.map((check) => check.complete), [false, true]);
  assert.equal(fs.existsSync(path.join(delivered.workingDirectory, 'manual.txt')), true);
});

function response(text, model = 'test-model') {
  return { text, observedModels: [model], estimatedCostUsd: 0.01, numTurns: 1 };
}

async function fixture(agent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-commission-'));
  const repo = new Repository(new JsonStore(dir));
  const project = await new ProjectService(repo).createProject('試験', '');
  const store = new CommissionStore(dir);
  const service = new CommissionService(store, repo, agent, dir);
  return { dir, repo, project, store, service, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function waitFor(predicate, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('状態の更新を待ってタイムアウトしました');
}

test('Pythonの実行キャッシュを成果物として追跡しない', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-artifacts-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('Temporary path escaped');
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of ['.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache']) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'generated.bin'), 'cache');
  }
  fs.writeFileSync(path.join(root, 'report.md'), 'evidence');
  const files = await snapshotWorkspace(root);
  assert.deepEqual([...files.keys()], ['report.md']);
});

test('企画確定後だけ実作業し、内部確認後に納品と修正を行う', async (t) => {
  const calls = [];
  let planCount = 0;
  const agent = { async run(request) {
    calls.push({ personaId: request.personaId, tools: request.tools, model: request.model, fallbackModel: request.fallbackModel });
    if (request.personaId === 'product') { planCount++; return response(taskPlan); }
    if (request.personaId === 'engineer') {
      fs.writeFileSync(path.join(request.workingDirectory, 'hello.txt'), planCount === 1 ? '初版' : '改訂版');
      return response('hello.txtを作成し確認した');
    }
    if (request.personaId === 'qa') {
      assert.equal(fs.existsSync(path.join(request.workingDirectory, 'hello.txt')), true);
      fs.writeFileSync(path.join(request.workingDirectory, 'review.txt'), '確認済み');
      return response(JSON.stringify({ approved: true, note: 'ファイルを確認' }));
    }
    return response(request.prompt.includes('発注者へ納品') ? '納品: hello.txt' : '企画案: hello.txtを作る');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: 'ファイルを作る', settings: { modelByPersona: { engineer: 'special-model' } } });
  await f.service.consult(item.id, 'ファイルを作りたい');
  assert.equal(f.store.get(item.id).status, 'consulting');
  assert.equal(f.store.get(item.id).workItems.length, 0);
  assert.equal(calls.some((call) => call.tools === 'full'), false);
  await f.service.confirmPlan(item.id, 'hello.txtを作成する');
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  assert.equal(f.store.get(item.id).workItems[0].status, 'accepted');
  assert.equal(f.store.get(item.id).artifacts[0].relativePath, 'hello.txt');
  assert.equal(f.store.get(item.id).artifacts[0].status, 'accepted');
  assert.equal(f.store.get(item.id).artifacts.some((artifact) => artifact.relativePath === 'review.txt' && artifact.status === 'accepted'), true);
  assert.equal(f.store.get(item.id).reviewDecisions[0].approved, true);
  assert.equal(f.store.get(item.id).memories.length, 1);
  assert.equal(f.store.get(item.id).delivery, '納品: hello.txt');
  assert.equal(calls.find((call) => call.personaId === 'engineer').model, 'special-model');
  assert.equal(calls.find((call) => call.personaId === 'product').model, 'claude-opus-5-5');
  assert.equal(calls.find((call) => call.personaId === 'qa').model, 'claude-sonnet-5');
  assert.equal(calls.find((call) => call.personaId === 'qa').fallbackModel, 'claude-haiku-4-5-20251001');
  assert.equal(f.store.events(item.id).some((event) => event.detail.includes('内部確認を通過')), true);
  await f.service.requestRevision(item.id, '改訂版にする');
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  assert.equal(fs.readFileSync(path.join(item.workingDirectory, 'hello.txt'), 'utf8'), '改訂版');
  assert.equal(f.store.get(item.id).workItems.length, 2);
  assert.equal(f.store.get(item.id).runs.filter((run) => run.phase === 'work').length, 2);
  assert.equal(f.store.get(item.id).runs.every((run) => run.observedModels.includes('test-model')), true);
});

test('旧案件はClaudeのまま、新しいCodex案件は全工程でCodexを使う', async (t) => {
  const calls = [];
  function client(backend) {
    return { async run(request) {
      calls.push({ backend, provider: request.provider, model: request.model });
      if (request.personaId === 'product') return response(taskPlan);
      if (request.personaId === 'engineer') {
        fs.writeFileSync(path.join(request.workingDirectory, 'hello.txt'), 'Codex成果');
        return response('ファイルを作成');
      }
      if (request.personaId === 'qa') return response('{"approved":true,"note":"確認済み"}');
      return response(request.prompt.includes('発注者へ納品') ? '納品完了' : '企画案');
    } };
  }
  const f = await fixture(new RoutedAgentClient(client('claude'), client('codex'))); t.after(f.cleanup);
  const legacy = await f.service.create({ projectId: f.project.id, goal: '旧案件' });
  await f.store.update(legacy.id, (item) => {
    delete item.settings.provider;
    delete item.settings.codexModel;
  });
  await f.service.consult(legacy.id, '相談');
  assert.deepEqual(calls.map((call) => call.backend), ['claude']);

  const codex = await f.service.create({ projectId: f.project.id, goal: 'Codex案件', settings: { provider: 'codex', codexModel: 'gpt-6-sol' } });
  await f.service.consult(codex.id, '相談');
  await f.service.confirmPlan(codex.id, 'hello.txtを作る');
  await waitFor(() => f.store.get(codex.id).status === 'delivered');
  assert.equal(calls.slice(1).length, 5);
  assert.equal(calls.slice(1).every((call) => call.backend === 'codex' && call.provider === 'codex' && call.model === 'gpt-6-sol'), true);
  assert.equal(f.store.get(codex.id).runs.every((run) => run.provider === 'codex'), true);
});

test('Codexの納品文生成だけ失敗したら確認済み記録から代替納品する', async (t) => {
  const agent = { async run(request) {
    assert.equal(request.provider, 'codex');
    if (request.phase === 'planning') return response(taskPlan);
    if (request.phase === 'work') {
      fs.writeFileSync(path.join(request.workingDirectory, 'hello.txt'), '確認済み成果');
      return response('hello.txtを作成');
    }
    if (request.phase === 'review') return response('{"approved":true,"note":"内容を確認した"}');
    if (request.phase === 'delivery') throw new Error('納品文の生成が時間切れ');
    return response('企画案');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: 'ファイルを納品', settings: { provider: 'codex' } });
  await f.service.consult(item.id, '作りたい');
  await f.service.confirmPlan(item.id, 'hello.txtを作る');
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  const delivered = f.store.get(item.id);
  assert.match(delivered.delivery, /代替納品書/);
  assert.match(delivered.delivery, /納品文の生成が時間切れ/);
  assert.match(delivered.delivery, /hello.txt/);
  assert.match(delivered.delivery, /内容を確認した/);
  assert.equal(delivered.runs.at(-1).status, 'failed');
  assert.equal(delivered.artifacts[0].status, 'accepted');
  assert.equal(f.store.events(item.id).some((event) => event.detail.includes('代替納品書')), true);
});

test('Engineerのデザイン変更はDesignerの内部確認まで提案状態に留まる', async (t) => {
  let completeReview;
  const review = new Promise((resolve) => { completeReview = resolve; });
  const plan = JSON.stringify({ tasks: [{
    title: '画面デザイン変更', instructions: '画面の色を変える', acceptance: 'Designerが確認する',
    ownerPersonaId: 'engineer', domainPersonaId: 'designer', reviewerPersonaId: 'designer',
  }] });
  const agent = { async run(request) {
    if (request.personaId === 'product') return response(plan);
    if (request.personaId === 'engineer') {
      fs.writeFileSync(path.join(request.workingDirectory, 'design.css'), 'body{color:red}');
      return response('デザイン変更を提案');
    }
    if (request.personaId === 'designer') { await review; return response('{"approved":true,"note":"デザイン方針に適合"}'); }
    return response(request.prompt.includes('発注者へ納品') ? '納品' : '企画案');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: 'デザイン改善' });
  await f.service.consult(item.id, '相談');
  await f.service.confirmPlan(item.id, '変更する');
  await waitFor(() => f.store.get(item.id).workItems[0]?.status === 'review_pending'
    && f.store.get(item.id).runs.some((run) => run.phase === 'review'));
  const pending = f.store.get(item.id);
  assert.equal(pending.artifacts[0].status, 'proposed');
  assert.equal(pending.workDecisions[0].status, 'proposed');
  assert.equal(pending.workItems[0].reviewerPersonaId, 'designer');
  assert.equal(pending.runs.find((run) => run.phase === 'review').requestedModel, 'claude-opus-5-5');
  completeReview();
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  assert.equal(f.store.get(item.id).artifacts[0].status, 'accepted');
  assert.equal(f.store.get(item.id).workDecisions[0].status, 'accepted');
});

test('一時停止直後の再開で二重実行せず、再起動時の実行中状態を中断扱いにする', async (t) => {
  let workCount = 0;
  let firstWorkStarted;
  const started = new Promise((resolve) => { firstWorkStarted = resolve; });
  const agent = { async run(request) {
    if (request.personaId === 'product') return response(taskPlan);
    if (request.personaId === 'engineer') {
      workCount++;
      if (workCount === 1) {
        firstWorkStarted();
        await new Promise((resolve, reject) => {
          request.abortSignal.addEventListener('abort', () => reject(new Error('中断')), { once: true });
        });
      }
      return response('作業完了');
    }
    if (request.personaId === 'qa') return response('{"approved":true,"note":"確認済み"}');
    return response(request.prompt.includes('発注者へ納品') ? '納品済み' : '企画案');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: '中断試験' });
  await f.service.consult(item.id, '相談');
  await f.service.confirmPlan(item.id, '作業する');
  await started;
  await f.service.pause(item.id);
  assert.equal(f.store.get(item.id).status, 'paused');
  assert.equal(f.store.get(item.id).runs.some((run) => run.status === 'interrupted'), true);
  await f.service.resume(item.id);
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  assert.equal(workCount, 2);
  await f.store.update(item.id, (current) => {
    current.status = 'running';
    current.workItems[0].status = 'running';
  });
  const reopened = new CommissionStore(f.dir);
  assert.equal(reopened.get(item.id).status, 'interrupted');
  assert.equal(reopened.get(item.id).workItems[0].status, 'interrupted');
});

test('呼び出し回数上限を超えると失敗理由を保存する', async (t) => {
  const agent = { async run(request) {
    return response(request.personaId === 'product' ? taskPlan : '企画案');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: '上限試験', settings: { maxCalls: 1 } });
  await f.service.consult(item.id, '相談');
  await f.service.confirmPlan(item.id, '実行');
  await waitFor(() => f.store.get(item.id).status === 'failed');
  assert.match(f.store.get(item.id).error, /上限/);
  assert.equal(f.store.get(item.id).runs.length, 1);
});

test('旧案件の推定料金上限と高いSDK推定値で実行が止まらない', async (t) => {
  const calls = [];
  const agent = { async run(request) {
    calls.push(request);
    if (request.personaId === 'engineer') fs.writeFileSync(path.join(request.workingDirectory, 'hello.txt'), 'hello');
    const text = request.personaId === 'product' ? taskPlan
      : request.personaId === 'qa' ? '{"approved":true,"note":"確認済み"}'
      : request.prompt.includes('発注者へ納品') ? 'hello.txtを納品' : '企画案';
    return { ...response(text), estimatedCostUsd: 100 };
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({
    projectId: f.project.id, goal: '推定料金に依存せず納品する',
    settings: { maxCalls: 5, maxEstimatedCostUsd: 0.01 },
  });
  await f.service.consult(item.id, '相談');
  await f.service.confirmPlan(item.id, 'hello.txtを作る');
  await waitFor(() => f.store.get(item.id).status === 'delivered');
  assert.equal(calls.length, 5);
  assert.equal(calls.every((request) => !('maxBudgetUsd' in request)), true);
  assert.equal(f.store.get(item.id).runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0), 500);
});

test('実作業が失敗しても途中のファイルと利用量を提案状態で残す', async (t) => {
  const agent = { async run(request) {
    if (request.personaId === 'product') return response(taskPlan);
    if (request.personaId === 'engineer') {
      fs.writeFileSync(path.join(request.workingDirectory, 'partial.txt'), '途中まで');
      throw Object.assign(new Error('作業に失敗'), {
        observedModels: ['claude-sonnet-5'], effectiveModel: 'claude-sonnet-5',
        estimatedCostUsd: 0.15, numTurns: 2,
      });
    }
    return response('企画案');
  } };
  const f = await fixture(agent); t.after(f.cleanup);
  const item = await f.service.create({ projectId: f.project.id, goal: '失敗時の記録' });
  await f.service.consult(item.id, '相談');
  await f.service.confirmPlan(item.id, '作業する');
  await waitFor(() => f.store.get(item.id).status === 'failed');
  const failed = f.store.get(item.id);
  assert.equal(failed.workItems[0].status, 'failed');
  assert.equal(failed.artifacts[0].relativePath, 'partial.txt');
  assert.equal(failed.artifacts[0].status, 'proposed');
  assert.equal(failed.runs.find((run) => run.phase === 'work').estimatedCostUsd, 0.15);
});

test('会議のAction Itemから委託案件を重複なく作れる', async (t) => {
  const f = await fixture({ async run() { return response('企画案'); } });
  t.after(f.cleanup);
  await f.repo.updateProject(f.project.id, (project) => {
    project.actionItems.push({ id: 'action-1', meetingId: 'meeting-1', sourceMeetingTitle: '会議', description: '説明書を作る', assignee: 'AI', done: false });
  });
  const first = await f.service.fromActionItem(f.project.id, 'action-1');
  const second = await f.service.fromActionItem(f.project.id, 'action-1');
  assert.equal(first.id, second.id);
  assert.equal(first.goal, '説明書を作る');
  assert.deepEqual(first.sourceActionItem, { meetingId: 'meeting-1', actionItemId: 'action-1' });
});
