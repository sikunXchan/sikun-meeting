// 起動済みの隔離 QA アプリで、案内と依頼フォームの表示を確かめる。
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.env.CDP_PORT || 9346);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find((entry) => entry.type === 'page' && entry.url.includes('/renderer/index.html'));
  if (!page) throw new Error('隔離したアプリの画面が見つかりません');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data);
    const resolve = pending.get(reply.id);
    if (resolve) resolve(reply);
    pending.delete(reply.id);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const nextId = ++id;
    pending.set(nextId, resolve);
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  };
  const capture = async (name) => {
    const output = path.join(process.env.SCREENSHOT_DIR || process.cwd(), `${name}.png`);
    const reply = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(output, Buffer.from(reply.result.data, 'base64'));
    console.log(output);
  };
  try {
    await send('Page.enable');
    await send('Page.reload', { ignoreCache: true });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await evaluate(`(document.getElementById('nm-type')?.options.length || 0) > 0`);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('起動後の画面初期化が終わりません');
    const welcome = await evaluate(`(() => {
      const bear = document.querySelector('#empty-state .guide-bear');
      return { visible: !document.getElementById('empty-state').classList.contains('hidden'),
        imageLoaded: bear.complete && bear.naturalWidth > 0,
        title: document.querySelector('#empty-state h1')?.textContent };
    })()`);
    if (!welcome.visible || !welcome.imageLoaded || welcome.title !== '今日は何を進めますか？') {
      throw new Error(`開始画面が不正です: ${JSON.stringify(welcome)}`);
    }
    await capture('sikun-welcome');
    await evaluate(`document.getElementById('welcome-commission-btn').click()`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`!document.getElementById('commission-create').classList.contains('hidden')`)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const form = await evaluate(`(() => {
      const root = document.getElementById('commission-create');
      const input = document.getElementById('commission-goal');
      return { visible: !root.classList.contains('hidden'),
        bearLoaded: root.querySelector('.guide-bear').naturalWidth > 0,
        fontSize: getComputedStyle(input).fontSize,
        advancedClosed: !document.getElementById('commission-advanced').open };
    })()`);
    if (!form.visible || !form.bearLoaded || parseFloat(form.fontSize) < 15 || !form.advancedClosed) {
      throw new Error(`依頼フォームが不正です: ${JSON.stringify(form)}`);
    }
    await capture('sikun-commission-form');
    console.log('案内役、フォーム、文字サイズ、詳細設定の初期状態を確認しました。');
  } finally {
    socket.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
