const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserReviewSession } = require('../dist/core/commission/browserReview');

test('QA browser can exercise an HTML artifact without editing it or opening other files', async (t) => {
  const browsers = process.platform === 'win32'
    ? [path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  if (!browsers.some(fs.existsSync)) return t.skip('Chrome/Edge unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-browser-test-'));
  const file = path.join(root, 'index.html');
  const original = '<!doctype html><input id="name" aria-label="Name"><button id="go" onclick="document.querySelector(\'#answer\').textContent=document.querySelector(\'#name\').value">Go</button><div id="answer"></div><div id="net"></div><script>fetch("https://example.com/").then(()=>net.textContent="reached").catch(()=>net.textContent="blocked")</script>';
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(root, '.secret.html'), 'hidden');
  const session = new BrowserReviewSession(root, ['index.html']);
  try {
    await session.start();
    const instructions = session.instructions();
    const origin = instructions.match(/URL: (http:\/\/127\.0\.0\.1:\d+)/)[1];
    const token = instructions.match(/Authorization: Bearer ([a-f0-9]+)/)[1];
    const call = async (route, params) => {
      const response = await fetch(origin + route, { method: params ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body: params ? new URLSearchParams(params) : undefined });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await fetch(origin + '/help')).status, 401);
    assert.equal((await call('/open', { file: 'index.html' })).data.ok, true);
    assert.equal((await call('/press', { key: 'Tab' })).data.result.focus.id, 'name');
    assert.equal((await call('/press', { key: 'Tab' })).data.result.focus.id, 'go');
    assert.equal((await call('/press', { key: 'Shift+Tab' })).data.result.focus.id, 'name');
    assert.equal((await call('/press', { key: 'F12' })).status, 400);
    const ax = (await call('/accessibility')).data.result;
    assert.ok(ax.nodes.some(n => n.role === 'textbox' && n.name === 'Name'));
    assert.match(ax.note, /未検証/);
    assert.equal((await call('/viewport', { width: '390', height: '844' })).data.result.width, 390);
    assert.equal((await call('/viewport', { width: '1', height: '99999' })).status, 400);
    assert.equal((await call('/type', { selector: '#name', text: 'Sikun' })).data.result.value, 'Sikun');
    assert.equal((await call('/click', { selector: '#go' })).data.result.clicked, true);
    assert.equal((await call('/state?selector=%23answer')).data.result.text, 'Sikun');
    for (let i = 0; i < 20 && (await call('/state?selector=%23net')).data.result.text !== 'blocked'; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await call('/state?selector=%23net')).data.result.text, 'blocked');
    assert.equal((await call('/open', { file: '../outside.html' })).status, 400);
    assert.equal((await fetch(origin + '/files/.secret.html')).status, 400);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.match(session.summary(), /click #go/);
  } finally {
    const profile = session.profile;
    await session.close();
    assert.equal(fs.existsSync(profile), false);
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
