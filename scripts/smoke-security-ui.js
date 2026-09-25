// 開発中の Electron を --remote-debugging-port=9222 で起動してから実行する。
// preload・IPC・HTML整形・画面遷移の遮断・無人運用の設定欄を実画面で確認する。
const fs = require('node:fs');

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === 'page' && target.url.includes('/renderer/index.html'));
  if (!page) throw new Error(`Sikun Meetingの画面が見つかりません: ${JSON.stringify(targets.map((target) => target.url))}`);
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
  const send = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  }
  return { socket, send, evaluate };
}

async function main() {
  const port = Number(process.env.CDP_PORT || 9222);
  const { socket, send, evaluate } = await connect(port);
  const results = {};

  results.preload = await evaluate(`(async () => ({
    api: typeof window.api?.commissions?.create === 'function',
    nodeHidden: typeof window.require === 'undefined' && typeof window.process === 'undefined',
    ipc: Array.isArray(await window.api.commissions.list()),
  }))()`);

  results.sanitize = await evaluate(`(() => {
    const cases = {
      img: window.sanitizeHtml('<p>a<img src=x onerror=alert(1)>b</p>'),
      iframe: window.sanitizeHtml('<iframe src="https://example.com"></iframe>ok'),
      script: window.sanitizeHtml('<script>alert(1)<\\/script>ok'),
      js: window.sanitizeHtml('<a href="javascript:alert(1)">x</a>'),
      svg: window.sanitizeHtml('<svg onload=alert(1)><circle/></svg>ok'),
      style: window.sanitizeHtml('<p style="position:fixed" onclick="x()">t</p>'),
      link: window.sanitizeHtml('<a href="https://example.com" target="_blank">x</a>'),
      table: window.sanitizeHtml('<table><tr><td align="left">1</td></tr></table>'),
      code: window.sanitizeHtml('<pre><code class="language-js">x</code></pre>'),
    };
    return {
      cases,
      ok: !cases.img.includes('onerror') && !cases.img.includes('<img')
        && !cases.iframe.includes('iframe') && cases.iframe.includes('ok')
        && !cases.script.includes('script') && !cases.script.includes('alert')
        && !cases.js.includes('javascript')
        && !cases.svg.includes('svg') && !cases.svg.includes('onload')
        && !cases.style.includes('style=') && !cases.style.includes('onclick')
        && cases.link.includes('href="https://example.com"') && !cases.link.includes('target') && cases.link.includes('noopener')
        && cases.table.includes('align="left"')
        && cases.code.includes('class="language-js"'),
    };
  })()`);

  results.windowOpen = await evaluate(`window.open('https://example.com') === null`);
  await evaluate(`(() => { const a = document.createElement('a'); a.href = 'https://example.com/'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  results.stayedOnApp = await evaluate(`location.href.endsWith('/renderer/index.html') && typeof window.api === 'object'`);

  results.autonomyForm = await evaluate(`(() => {
    document.getElementById('commission-new-btn').click();
    const auto = document.getElementById('commission-autonomy');
    const continuous = document.getElementById('commission-continuous');
    const before = { continuousDisabled: continuous.disabled, max: document.getElementById('commission-max-calls').max };
    auto.checked = true; auto.dispatchEvent(new Event('change'));
    const after = { continuousDisabled: continuous.disabled, max: document.getElementById('commission-max-calls').max };
    return { before, after, ok: before.continuousDisabled && before.max === '200' && !after.continuousDisabled && after.max === '5000' };
  })()`);

  if (process.env.SEEDED_COMMISSION) {
    results.autonomyView = await evaluate(`(async () => {
      document.querySelector('#commission-list li').click();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const section = document.getElementById('commission-autonomy-section');
      return { visible: !section.classList.contains('hidden'), text: section.textContent,
        subtitle: document.getElementById('commission-subtitle').textContent };
    })()`);
    await send('Page.enable');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (process.env.SCREENSHOT) fs.writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, 'base64'));
  }

  socket.close();
  console.log(JSON.stringify(results, null, 2));
  const failed = !results.preload.api || !results.preload.nodeHidden || !results.preload.ipc || !results.sanitize.ok
    || !results.windowOpen || !results.stayedOnApp || !results.autonomyForm.ok
    || (results.autonomyView && (!results.autonomyView.visible || !results.autonomyView.text.includes('KGIを達成しました')));
  if (failed) throw new Error('確認に失敗しました');
}

main().catch((error) => { console.error(error); process.exit(1); });
