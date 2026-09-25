// 開発中の Electron を --remote-debugging-port=9222 で起動してから実行する。
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const port = Number(process.env.CDP_PORT || 9222);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === 'page' && target.url.includes('/renderer/index.html'));
  if (!page) throw new Error('Sikun Meetingの画面が見つかりません');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data);
    if (!pending.has(reply.id)) return;
    pending.get(reply.id)(reply);
    pending.delete(reply.id);
  });
  async function evaluate(expression) {
    const requestId = ++id;
    const reply = await new Promise((resolve) => {
      pending.set(requestId, resolve);
      socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  }
  const ready = await evaluate(`({
    api: typeof window.api?.commissions?.create === 'function',
    list: document.getElementById('commission-list') !== null,
    existingMeeting: document.getElementById('meeting-list') !== null,
    consultantFields: document.getElementById('commission-goal') !== null,
    claudeSelected: document.getElementById('commission-provider')?.value === 'claude',
    codexModelDefault: document.getElementById('commission-model-codex')?.value === 'gpt-6-sol',
    sonnetDefault: document.getElementById('commission-model-consultant')?.value === 'claude-sonnet-5',
    opusDefault: document.getElementById('commission-model-critical')?.value === 'claude-opus-5-5',
    haikuFallback: document.getElementById('commission-model-fallback')?.value === 'claude-haiku-4-5-20251001',
    noCostInput: document.getElementById('commission-max-cost') === null,
    noCostHeading: !document.getElementById('commission-create')?.textContent.includes('推定利用額') &&
      !document.getElementById('commission-progress-section')?.textContent.includes('推定利用額')
  })`);
  if (Object.values(ready).some((value) => value !== true)) throw new Error(`初期画面が不正: ${JSON.stringify(ready)}`);
  const opened = await evaluate(`(() => {
    document.getElementById('commission-new-btn').click();
    return !document.getElementById('commission-create').classList.contains('hidden') &&
      document.getElementById('meeting-view').classList.contains('hidden');
  })()`);
  if (!opened) throw new Error('委託案件の作成画面が開きません');
  const codexFields = await evaluate(`(() => {
    const provider = document.getElementById('commission-provider');
    provider.value = 'codex';
    provider.dispatchEvent(new Event('change'));
    const codexVisible = !document.getElementById('commission-model-codex').closest('label').classList.contains('hidden');
    const claudeHidden = document.getElementById('commission-model-consultant').closest('label').classList.contains('hidden');
    provider.value = 'claude';
    provider.dispatchEvent(new Event('change'));
    return codexVisible && claudeHidden;
  })()`);
  if (!codexFields) throw new Error('Codexモデル欄の表示切替ができません');
  const cancelled = await evaluate(`(() => {
    document.getElementById('commission-create-cancel').click();
    return !document.getElementById('empty-state').classList.contains('hidden') &&
      document.getElementById('commission-create').classList.contains('hidden');
  })()`);
  if (!cancelled) throw new Error('作成画面から戻れません');
  const list = await evaluate(`window.api.commissions.list().then((items) => items.length)`);
  if (typeof list !== 'number') throw new Error('委託案件IPCが応答しません');
  const personas = await evaluate(`window.api.personas.list().then((items) => items.map((item) => item.id))`);
  if (personas.length !== 22 || !personas.includes('it_consultant')) throw new Error('既存21人とITコンサルタントの一覧が不正です');
  await evaluate(`window.api.meetings.list().then(async (items) => {
    if (!items.some((item) => item.title === 'UI互換試験')) {
      await window.api.meetings.create({ title: 'UI互換試験', agenda: '既存会議の表示確認', meetingTypeId: 'architecture_review', workingDirectory: null });
    }
    location.reload();
  })`);
  let meetingVisible = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      meetingVisible = await evaluate(`document.getElementById('meeting-list')?.textContent.includes('UI互換試験') === true`);
      if (meetingVisible) break;
    } catch { /* 再読み込み中 */ }
  }
  if (!meetingVisible) throw new Error('保存済みの会議が画面に表示されません');
  if (process.argv.includes('--action-item')) {
    const source = await evaluate(`(async () => {
      const project = await window.api.projects.create('Action Item UI試験', '');
      const meeting = await window.api.meetings.create({ title: '委託元の会議', agenda: '確認', meetingTypeId: 'architecture_review', workingDirectory: null, projectId: project.id });
      const decided = await window.api.decision.finalize(meeting.id, { decisionText: '実行する', reasoning: [], actionItems: [{ description: '試験成果物を作る', assignee: 'AI' }] });
      return { projectId: project.id, actionItemId: decided.decision.actionItems[0].id };
    })()`);
    await evaluate('location.reload()');
    let buttonVisible = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        buttonVisible = await evaluate(`(() => {
          const select = document.getElementById('project-select');
          if (![...select.options].some((option) => option.value === '${source.projectId}')) return false;
          select.value = '${source.projectId}';
          select.dispatchEvent(new Event('change'));
          document.getElementById('project-dashboard-btn').click();
          return [...document.querySelectorAll('#pv-action-items button')].some((button) => button.textContent === 'AIチームに委託');
        })()`);
        if (buttonVisible) break;
      } catch { /* 再読み込み中 */ }
    }
    if (!buttonVisible) throw new Error('Action Itemから委託するボタンが表示されません');
    const deduplicated = await evaluate(`(async () => {
      const first = await window.api.commissions.fromActionItem('${source.projectId}', '${source.actionItemId}');
      const second = await window.api.commissions.fromActionItem('${source.projectId}', '${source.actionItemId}');
      return first.id === second.id && first.sourceActionItem.actionItemId === '${source.actionItemId}';
    })()`);
    if (!deduplicated) throw new Error('Action Itemからの委託が重複しました');
    console.log('Action Item UI and IPC passed');
  }
  if (process.argv.includes('--consult')) {
    const consultation = await evaluate(`(async () => {
      const existing = await window.api.projects.list();
      const project = existing[0] || await window.api.projects.create('配布版試験', '');
      const item = await window.api.commissions.create({
        projectId: project.id, goal: '挨拶文を企画する',
        settings: { consultantModel: 'claude-haiku-4-5-20251001', plannerModel: 'claude-haiku-4-5-20251001', workerModel: 'claude-haiku-4-5-20251001', reviewerModel: 'claude-haiku-4-5-20251001', criticalModel: 'claude-haiku-4-5-20251001', fallbackModel: 'claude-haiku-4-5-20251001', maxCalls: 2, maxTurnsPerCall: 2 }
      });
      const reply = await window.api.commissions.consult(item.id, '短い企画案を一文で答えてください。');
      return { messages: reply.consultation.length, model: reply.runs[0]?.effectiveModel };
    })()`);
    if (consultation.messages !== 2 || !consultation.model) throw new Error(`配布版SDKが応答しません: ${JSON.stringify(consultation)}`);
    console.log(`Packaged SDK consultation passed: ${consultation.model}`);
  }
  if (process.argv.includes('--consult-default')) {
    const consultation = await evaluate(`(async () => {
      const project = await window.api.projects.create('Default model trial', '');
      const item = await window.api.commissions.create({ projectId: project.id, goal: 'Plan a short greeting.' });
      const reply = await window.api.commissions.consult(item.id, 'Please answer briefly in one sentence.');
      return {
        requestedModel: item.settings.consultantModel,
        effectiveModel: reply.runs[0]?.effectiveModel,
        messageCount: reply.consultation.length
      };
    })()`);
    if (consultation.requestedModel !== 'claude-sonnet-5' || consultation.effectiveModel !== 'claude-sonnet-5' || consultation.messageCount !== 2) {
      throw new Error(`Default Sonnet consultation failed: ${JSON.stringify(consultation)}`);
    }
    console.log(`Packaged default consultation passed: ${consultation.effectiveModel}`);
  }
  if (process.argv.includes('--hide-cost-check')) {
    const priorId = await evaluate(`(async () => {
      for (const entry of await window.api.commissions.list()) {
        const item = (await window.api.commissions.get(entry.id)).commission;
        if (item.runs.length > 0) return item.id;
      }
      return null;
    })()`);
    if (!priorId) throw new Error('No prior commission with runs for display check');
    await evaluate(`window.dispatchEvent(new CustomEvent('commission:open', { detail: '${priorId}' }))`);
    let runText = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      runText = await evaluate(`document.getElementById('commission-runs').textContent`);
      if (runText.includes('要求モデル')) break;
    }
    if (!runText.includes('要求モデル') || runText.includes('推定') || runText.includes('$')) {
      throw new Error(`Estimated cost is visible in run history: ${runText}`);
    }
    console.log('Saved run history shows models and turns without estimated cost');
  }
  if (process.argv.includes('--full-default')) {
    const created = await evaluate(`(async () => {
      const project = await window.api.projects.create('End-to-end trial', '');
      const item = await window.api.commissions.create({
        projectId: project.id,
        goal: 'Create greeting.txt in the assigned workspace with the exact text hello, verify it, and deliver.',
        settings: { maxCalls: 7, maxTurnsPerCall: 8 }
      });
      await window.api.commissions.consult(item.id, 'Please make a brief plan for this one-file trial.');
      await window.api.commissions.confirm(item.id, 'Create greeting.txt with the exact text hello in the assigned workspace. Verify its contents and deliver it.');
      return { id: item.id, settings: item.settings };
    })()`);
    if (created.settings.consultantModel !== 'claude-sonnet-5' || created.settings.plannerModel !== 'claude-opus-5-5') {
      throw new Error(`Unexpected model settings: ${JSON.stringify(created.settings)}`);
    }
    const deadline = Date.now() + 5 * 60 * 1000;
    let lastStatus;
    let result;
    while (Date.now() < deadline) {
      result = await evaluate(`(async () => {
        const item = (await window.api.commissions.get('${created.id}')).commission;
        return {
          status: item.status,
          error: item.error,
          workingDirectory: item.workingDirectory,
          artifacts: item.artifacts.map((artifact) => ({ path: artifact.relativePath, status: artifact.status })),
          runs: item.runs.map((run) => ({ phase: run.phase, model: run.effectiveModel, status: run.status }))
        };
      })()`);
      if (result.status !== lastStatus) {
        console.log(`End-to-end status: ${result.status}`);
        lastStatus = result.status;
      }
      if (result.status === 'delivered' || result.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (result.status !== 'delivered' && result.status !== 'failed') {
      await evaluate(`window.api.commissions.stop('${created.id}')`);
      throw new Error('End-to-end trial timed out and was stopped');
    }
    console.log(`End-to-end result: ${JSON.stringify(result)}`);
    if (result.status !== 'delivered') throw new Error(result.error || 'End-to-end trial failed');
    const greeting = fs.readFileSync(path.join(result.workingDirectory, 'greeting.txt'), 'utf8').trim();
    if (greeting !== 'hello') throw new Error(`Unexpected greeting: ${greeting}`);
    if (!result.artifacts.some((artifact) => artifact.path === 'greeting.txt' && artifact.status === 'accepted')) {
      throw new Error('greeting.txt was not accepted');
    }
    if (!result.runs.some((run) => run.phase === 'planning' && run.model === 'claude-opus-5-5')) {
      throw new Error('Opus planning did not run');
    }
    if (!result.runs.some((run) => run.phase === 'work' && run.model === 'claude-sonnet-5')) {
      throw new Error('Sonnet work did not run');
    }
    console.log('Packaged end-to-end trial passed');
  }
  if (process.argv.includes('--full-codex')) {
    const created = await evaluate(`(async () => {
      const project = await window.api.projects.create('Packaged Codex trial', '');
      const item = await window.api.commissions.create({
        projectId: project.id,
        goal: 'Create greeting.txt containing exactly hello, verify the file, and deliver it.',
        settings: { provider: 'codex', codexModel: 'gpt-6-sol', maxCalls: 7 }
      });
      await window.api.commissions.consult(item.id, 'Briefly plan this one-file task.');
      await window.api.commissions.confirm(item.id, 'Create greeting.txt containing exactly hello, verify it, and deliver it.');
      return { id: item.id, settings: item.settings };
    })()`);
    if (created.settings.provider !== 'codex' || created.settings.codexModel !== 'gpt-6-sol') {
      throw new Error(`Unexpected Codex settings: ${JSON.stringify(created.settings)}`);
    }
    const deadline = Date.now() + 6 * 60 * 1000;
    let result;
    while (Date.now() < deadline) {
      result = await evaluate(`(async () => {
        const item = (await window.api.commissions.get('${created.id}')).commission;
        return {
          status: item.status, error: item.error, delivery: item.delivery,
          workingDirectory: item.workingDirectory,
          artifacts: item.artifacts.map((artifact) => ({ path: artifact.relativePath, status: artifact.status })),
          runs: item.runs.map((run) => ({ phase: run.phase, provider: run.provider, model: run.requestedModel, status: run.status }))
        };
      })()`);
      if (result.status === 'delivered' || result.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (result.status !== 'delivered' && result.status !== 'failed') {
      await evaluate(`window.api.commissions.stop('${created.id}')`);
      throw new Error('Packaged Codex trial timed out and was stopped');
    }
    console.log(`Packaged Codex result: ${JSON.stringify({ status: result.status, error: result.error, runs: result.runs, artifacts: result.artifacts })}`);
    if (result.status !== 'delivered') throw new Error(result.error || 'Packaged Codex trial failed');
    if (fs.readFileSync(path.join(result.workingDirectory, 'greeting.txt'), 'utf8').trim() !== 'hello') {
      throw new Error('Packaged Codex produced an incorrect file');
    }
    if (!result.artifacts.some((artifact) => artifact.path === 'greeting.txt' && artifact.status === 'accepted')) {
      throw new Error('Packaged Codex file was not accepted');
    }
    if (!result.runs.every((run) => run.provider === 'codex' && run.model === 'gpt-6-sol')) {
      throw new Error('Packaged Codex used an unexpected provider or model');
    }
    if (!result.delivery) throw new Error('Packaged Codex did not produce a delivery report');
    console.log('Packaged Codex end-to-end trial passed');
  }
  console.log('UI smoke passed: 既存会議表示、22人、委託画面切替、IPC');
  socket.close();
}
main().catch((error) => { console.error(error); process.exit(1); });
