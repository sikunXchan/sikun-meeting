// 隔離したElectronプロファイルを --remote-debugging-port=9222 で起動してから実行する。
// 設定画面の開閉、KGIの保存と再編集、入力エラーを実際のレンダラーで確認する。
const fs = require('node:fs');

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
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`画面の更新が完了しません: ${expression}`);
  }
  try {
    const setup = await evaluate(`(() => {
      document.getElementById('project-new-btn').click();
      document.getElementById('pj-name').value = '設定UI試験';
      document.getElementById('pj-submit').click();
      return true;
    })()`);
    if (!setup) throw new Error('プロジェクトを作成できません');
    await waitFor(`document.getElementById('project-dashboard-btn').classList.contains('hidden') === false`);
    await evaluate(`document.getElementById('project-dashboard-btn').click()`);
    await waitFor(`document.getElementById('project-view').classList.contains('hidden') === false`);
    const focusMode = await evaluate(`document.body.classList.contains('project-active') && getComputedStyle(document.getElementById('discussion-panel')).display === 'none'`);
    if (!focusMode) throw new Error('設定画面で会議の発言欄が閉じません');
    const settings = await evaluate(`(() => {
      const emailAdvanced = document.getElementById('email-template').closest('details');
      return !emailAdvanced.open && document.getElementById('email-tool').value === 'send_email';
    })()`);
    if (!settings) throw new Error('メールの詳細設定が既定で閉じていません');
    await evaluate(`(() => {
      const byId = (id) => document.getElementById(id);
      byId('pv-card-editor').open = true;
      byId('pv-card-name').value = '試験アプリ';
      byId('pv-card-status').value = '試用中';
      byId('pv-card-summary').value = '画面を試す';
      byId('pv-card-goal-add').click();
      byId('pv-card-save').click();
      return true;
    })()`);
    await waitFor(`document.getElementById('pv-card-error').classList.contains('hidden') === false`);
    const validation = await evaluate(`document.getElementById('pv-card-error').textContent.includes('指標と数値')`);
    if (!validation) throw new Error('目標の入力エラーがフォーム内に表示されません');
    await evaluate(`(() => {
      const row = document.querySelector('.goal-row');
      row.querySelector('.goal-label').value = '利用完了率';
      row.querySelector('.goal-target').value = '80';
      row.querySelector('.goal-current').value = '65';
      row.querySelector('.goal-unit').value = '%';
      row.querySelector('.goal-evidence').value = '9月の計測';
      document.getElementById('pv-card-save').click();
      return true;
    })()`);
    await waitFor(`document.getElementById('pv-card-list').textContent.includes('試験アプリ')`);
    await evaluate(`document.querySelector('#pv-card-list button').click()`);
    const card = await evaluate(`(() => {
      const row = document.querySelector('.goal-row');
      return { count: document.querySelectorAll('.goal-row').length,
        label: row.querySelector('.goal-label').value, target: row.querySelector('.goal-target').value,
        current: row.querySelector('.goal-current').value, evidence: row.querySelector('.goal-evidence').value,
        id: row.dataset.goalId };
    })()`);
    if (card.count !== 1 || card.label !== '利用完了率' || card.target !== '80'
      || card.current !== '65' || card.evidence !== '9月の計測' || !card.id) {
      throw new Error(`目標の再編集が不正です: ${JSON.stringify(card)}`);
    }
    if (process.env.SCREENSHOT) {
      await send('Page.enable');
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, 'base64'));
    }
    await evaluate(`document.getElementById('commission-new-btn').click()`);
    const commission = await evaluate(`(() => {
      const modelDetails = document.getElementById('commission-model-consultant').closest('details');
      return !modelDetails.open && document.getElementById('commission-max-calls').value === '24';
    })()`);
    if (!commission) throw new Error('委託のモデル詳細が既定で閉じていません');
    await evaluate(`document.getElementById('mobile-open-btn').click()`);
    const mobile = await evaluate(`document.getElementById('mobile-view').textContent.includes('1. 公開先を設定') && document.getElementById('mobile-view').textContent.includes('3. スマホで読み取る')`);
    if (!mobile) throw new Error('スマホ設定の順番が表示されません');
    console.log(JSON.stringify({ focusMode, emailSettings: settings, validation, card, commission, mobile }, null, 2));
  } finally {
    socket.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
