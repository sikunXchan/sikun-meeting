// Isolated QA Electron を --remote-debugging-port=9224 で起動してから実行する。
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.CDP_PORT || 9224);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((entry) => entry.type === 'page' && entry.url.includes('/renderer/index.html'));
  if (!page) throw new Error('Sikun Meeting の画面が見つかりません');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data);
    const resolve = pending.get(reply.id);
    if (resolve) { pending.delete(reply.id); resolve(reply); }
  });
  async function evaluate(expression) {
    const id = ++nextId;
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  }
  const goal = `会議の決定事項を扱う小さなツールを meeting-actions.html という単一ファイルで作る。項目の追加、完了の切替、削除、再読込後の保持を実現する。外部ライブラリは使わない。試験 ${Date.now()}`;
  const criteria = 'meeting-actions.html をブラウザで開ける。項目の追加、完了の切替、削除が画面で動き、再読込後も項目と完了状態が残る。';
  const resumeId = process.env.RESUME_COMMISSION_ID;
  try {
    let item;
    const deadline = Date.now() + 12 * 60 * 1000;
    if (!resumeId) {
    await evaluate(`document.getElementById('commission-new-btn').click()`);
    let opened = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      opened = await evaluate(`!document.getElementById('commission-create').classList.contains('hidden')`);
      if (opened) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!opened) throw new Error('委託作成画面が開きません');
    const form = await evaluate(`(() => {
      document.getElementById('commission-goal').value = ${JSON.stringify(goal)};
      document.getElementById('commission-criteria').value = ${JSON.stringify(criteria)};
      const advanced = document.getElementById('commission-advanced');
      advanced.open = true;
      const provider = document.getElementById('commission-provider');
      provider.value = 'codex';
      provider.dispatchEvent(new Event('change'));
      document.getElementById('commission-max-calls').value = '16';
      const ready = !document.getElementById('commission-create').classList.contains('hidden')
        && document.getElementById('commission-model-codex').value === 'gpt-6-sol';
      document.getElementById('commission-create-btn').click();
      return ready;
    })()`);
    if (!form) throw new Error('画面から委託を開始できません');
    while (Date.now() < deadline) {
      item = await evaluate(`(async () => {
        const matches = (await window.api.commissions.list()).filter((entry) => entry.goal === ${JSON.stringify(goal)});
        if (!matches.length) return null;
        const snapshot = (await window.api.commissions.get(matches.at(-1).id)).commission;
        return { id: snapshot.id, status: snapshot.status, consultant: snapshot.consultation.some((entry) => entry.speaker === 'it_consultant'), plan: snapshot.planText, error: snapshot.error };
      })()`);
      if (item?.error) throw new Error(item.error);
      if (item?.consultant && item?.status === 'consulting') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!item?.consultant) throw new Error('画面からの企画相談が完了しません');
    let confirmed = false;
    let confirmState;
    for (let attempt = 0; attempt < 50; attempt++) {
      confirmState = await evaluate(`(() => {
        const button = document.getElementById('commission-confirm-btn');
        const plan = document.getElementById('commission-plan');
        return { disabled: button.disabled, plan: plan.value, visible: !document.getElementById('commission-view').classList.contains('hidden') };
      })()`);
      if (!confirmState.disabled && confirmState.plan.trim() && confirmState.visible) {
        confirmed = await evaluate(`(() => { document.getElementById('commission-confirm-btn').click(); return true; })()`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!confirmed) throw new Error(`画面から企画を確定できません: ${JSON.stringify(confirmState)}`);
    } else {
      item = { id: resumeId };
      await evaluate(`window.dispatchEvent(new CustomEvent('commission:open', { detail: ${JSON.stringify(resumeId)} }))`);
      let resumed = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        resumed = await evaluate(`(() => {
          const button = document.getElementById('commission-resume-btn');
          if (button.classList.contains('hidden') || button.disabled) return false;
          button.click();
          return true;
        })()`);
        if (resumed) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!resumed) throw new Error('画面から案件を再開できません');
    }
    let result;
    let lastStatus;
    while (Date.now() < deadline) {
      result = await evaluate(`(async () => {
        const item = (await window.api.commissions.get('${item.id}')).commission;
        return { status: item.status, error: item.error, directory: item.workingDirectory,
          artifacts: item.artifacts.map((entry) => ({ path: entry.relativePath, status: entry.status })),
          runs: item.runs.map((entry) => ({ phase: entry.phase, provider: entry.provider, status: entry.status, skills: entry.appliedSkills })) };
      })()`);
      if (result.status !== lastStatus) { console.log(`UI trial: ${result.status}`); lastStatus = result.status; }
      if (result.status === 'delivered' || result.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!['delivered', 'failed'].includes(result?.status)) {
      await evaluate(`window.api.commissions.stop('${item.id}')`);
      throw new Error('画面からの実践試験が時間内に完了しません');
    }
    console.log(JSON.stringify(result));
    if (result.status !== 'delivered') throw new Error(result.error || '納品に失敗しました');
    const file = path.join(result.directory, 'meeting-actions.html');
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('localStorage') || !html.includes('<html')) throw new Error('成果物に HTML と保存処理がありません');
    if (!result.artifacts.some((entry) => entry.path === 'meeting-actions.html' && entry.status === 'accepted')) throw new Error('成果物が採用されていません');
    for (const phase of ['consultation', 'planning', 'work', 'review', 'goal_check', 'delivery']) {
      if (!result.runs.some((entry) => entry.phase === phase && entry.status === 'completed')) throw new Error(`${phase} が完了していません`);
    }
    let view;
    for (let attempt = 0; attempt < 30; attempt++) {
      view = await evaluate(`({ status: document.getElementById('commission-status').textContent,
        artifact: document.getElementById('commission-artifacts').textContent,
        delivery: document.getElementById('commission-delivery').textContent })`);
      if (view.status.includes('納品') && view.artifact.includes('meeting-actions.html') && view.delivery.trim()) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!view.status.includes('納品') || !view.artifact.includes('meeting-actions.html') || !view.delivery.trim()) {
      throw new Error(`画面に納品結果が表示されていません: ${JSON.stringify(view)}`);
    }
    console.log(`UI trial passed: ${file}`);
  } finally {
    socket.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
