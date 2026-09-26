// スマホ閲覧の縦断確認。モード: desktop | phone | offline
//   desktop: Electron（DESKTOP_CDP）の「スマホで見る」で同期を設定し、ペアリングURLを PAIRING_FILE に書く
//   phone:   Chromium（PHONE_CDP）をスマホ幅にしてペアリングURLを開き、一覧・詳細・PWA要素を確認する
//   offline: ローカルサーバー停止後に再読み込みし、前回の内容が表示されることを確認する
const fs = require('node:fs');
const path = require('node:path');

async function connect(port, match) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === 'page' && match(target.url));
  if (!page) throw new Error(`対象の画面がありません: ${targets.map((target) => target.url).join(', ')}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data);
    if (pending.has(reply.id)) { pending.get(reply.id)(reply); pending.delete(reply.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })); });
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 15000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await evaluate(expression).catch(() => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`待機がタイムアウトしました: ${expression}`);
  };
  const screenshot = async (file, full = false) => {
    if (!file) return;
    await send('Page.enable');
    const params = { format: 'png' };
    if (full) {
      const metrics = await send('Page.getLayoutMetrics');
      const size = metrics.result.cssContentSize;
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 6000), scale: 1 };
    }
    const shot = await send('Page.captureScreenshot', params);
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  };
  return { socket, send, evaluate, waitFor, screenshot };
}

const shots = process.env.SCREENSHOT_DIR;
const shotPath = (name) => (shots ? path.join(shots, name) : null);

async function desktop() {
  const page = await connect(Number(process.env.DESKTOP_CDP || 9222), (url) => url.includes('/renderer/index.html'));
  await page.evaluate(`document.getElementById('mobile-open-btn').click(), true`);
  await page.waitFor(`!document.getElementById('mobile-view').classList.contains('hidden') && document.getElementById('mobile-status').textContent.includes('自動同期')`);
  await page.evaluate(`(() => {
    document.getElementById('mobile-base-url').value = ${JSON.stringify(process.env.BASE_URL)};
    document.getElementById('mobile-token').value = ${JSON.stringify(process.env.TYPE_TOKEN === '0' ? '' : process.env.SYNC_TOKEN)};
    document.getElementById('mobile-enabled').checked = true;
    document.getElementById('mobile-save-btn').click();
    return true;
  })()`);
  await page.waitFor(`document.getElementById('mobile-status').textContent.includes('送った会議')`);
  const result = await page.evaluate(`({
    status: document.getElementById('mobile-status').textContent,
    tokenState: document.getElementById('mobile-token-state').textContent,
    tokenCleared: document.getElementById('mobile-token').value === '',
    qr: document.getElementById('mobile-qr').src.startsWith('data:image/png;base64,') && document.getElementById('mobile-qr').naturalWidth > 0,
    pairingUrl: document.getElementById('mobile-pairing-url').value,
  })`);
  await page.screenshot(shotPath('desktop-mobile.png'));
  page.socket.close();
  console.log(JSON.stringify({ ...result, pairingUrl: result.pairingUrl.replace(/#k=.*/, '#k=***') }, null, 2));
  if (!result.qr || !result.tokenCleared || !result.status.includes('送った会議: 2件') || result.status.includes('エラー')) throw new Error('デスクトップ側の確認に失敗しました');
  fs.writeFileSync(process.env.PAIRING_FILE, result.pairingUrl);
}

async function phonePage() {
  const page = await connect(Number(process.env.PHONE_CDP || 9223), () => true);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await page.send('Page.enable');
  return page;
}

async function phone() {
  const page = await phonePage();
  const pairingUrl = fs.readFileSync(process.env.PAIRING_FILE, 'utf8').trim();
  await page.send('Page.navigate', { url: pairingUrl });
  await page.waitFor(`document.querySelectorAll('.meeting-item').length === 2`);
  const list = await page.evaluate(`({
    hashCleared: location.hash === '',
    keySaved: /^[A-Za-z0-9_-]{43}$/.test(localStorage.getItem('sikun-mobile-key') || ''),
    titles: [...document.querySelectorAll('.meeting-title')].map((node) => node.textContent.trim()),
    noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth,
  })`);
  await page.screenshot(shotPath('phone-list.png'));
  await page.evaluate(`[...document.querySelectorAll('.meeting-item')].find((node) => node.textContent.includes('決済基盤')).click(), true`);
  await page.waitFor(`document.querySelectorAll('.message').length === 5`);
  const detail = await page.evaluate(`(async () => ({
    route: location.hash,
    decision: document.querySelector('.decision-text')?.textContent,
    doneActions: [...document.querySelectorAll('.action.done .action-text')].map((node) => node.textContent),
    openActions: [...document.querySelectorAll('.action:not(.done) .action-text')].map((node) => node.textContent),
    stances: [...document.querySelectorAll('.message .stance')].map((node) => node.textContent),
    table: document.querySelectorAll('.markdown table').length,
    dangerous: document.querySelectorAll('img[onerror], a[href^="javascript"], script:not([src])').length,
    avatars: (await Promise.all([...document.querySelectorAll('.participant img, .message img')].map(async (img) => {
      const response = await fetch(img.src);
      return response.ok && response.headers.get('content-type') === 'image/png';
    }))).every(Boolean),
    noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth,
    workingDirectoryLeak: document.body.textContent.includes('/home/secret'),
  }))()`);
  await page.screenshot(shotPath('phone-detail.png'), true);
  const pwa = await page.evaluate(`(async () => {
    const manifest = await (await fetch('/manifest.webmanifest')).json();
    const registration = await navigator.serviceWorker.ready;
    const icons = await Promise.all(manifest.icons.map(async (icon) => (await fetch(icon.src)).ok));
    return { display: manifest.display, icons: icons.every(Boolean), sw: Boolean(registration.active), csp: (await fetch('/')).headers.get('content-security-policy')?.includes("script-src 'self'") };
  })()`);
  page.socket.close();
  const result = { list, detail, pwa };
  console.log(JSON.stringify(result, null, 2));
  const ok = list.hashCleared && list.keySaved && list.titles[0].includes('会員ランク') && list.noHorizontalScroll
    && detail.decision?.includes('Stripeを採用') && detail.doneActions.includes('決済APIの負荷試験を実施する') && detail.openActions.includes('移行手順書を作る')
    && detail.table === 1 && detail.dangerous === 0 && detail.avatars && detail.noHorizontalScroll && !detail.workingDirectoryLeak
    && pwa.display === 'standalone' && pwa.icons && pwa.sw && pwa.csp;
  if (!ok) throw new Error('スマホ側の確認に失敗しました');
}

async function offline() {
  const page = await phonePage();
  await page.send('Page.reload', { ignoreCache: false });
  await page.waitFor(`document.querySelectorAll('.message').length === 5 || document.querySelectorAll('.meeting-item').length === 2`);
  const result = await page.evaluate(`({
    banner: document.getElementById('banner').textContent,
    decision: document.querySelector('.decision-text')?.textContent || null,
    items: document.querySelectorAll('.meeting-item').length,
  })`);
  await page.screenshot(shotPath('phone-offline.png'));
  page.socket.close();
  console.log(JSON.stringify(result, null, 2));
  if (!result.banner.includes('オフライン')) throw new Error('オフライン表示の確認に失敗しました');
}

const mode = process.argv[2];
({ desktop, phone, offline })[mode]().catch((error) => { console.error(error); process.exit(1); });
