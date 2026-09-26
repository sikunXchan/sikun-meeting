// 実践試験で作られた meeting-actions.html を Chrome で操作する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

if (!process.argv[2]) throw new Error('meeting-actions.html のパスを指定してください');
const file = path.resolve(process.argv[2]);
if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`成果ファイルがありません: ${file}`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-html-browser-'));
const url = pathToFileURL(file).href;
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, url], { windowsHide: true, stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(active)) { port = Number(fs.readFileSync(active, 'utf8').split('\n')[0]); break; }
    if (chrome.exitCode !== null) throw new Error('Chrome が起動できません');
    await delay(100);
  }
  if (!port) throw new Error('Chrome の操作口が開きません');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find((entry) => entry.type === 'page' && entry.url.startsWith('file:'));
  if (!tab) throw new Error('成果ファイルがブラウザに開かれていません');
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
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
  async function command(method, params = {}) {
    const id = ++nextId;
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    if (reply.error || reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result;
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return result.result.value;
  }
  try {
    assert.equal(await evaluate('document.title'), '会議の決定事項');
    assert.equal(await evaluate('document.querySelectorAll("#action-list li").length'), 0);
    const added = await evaluate(`(() => {
      const input = document.getElementById('action-input');
      input.value = '資料を共有する';
      document.getElementById('action-form').requestSubmit();
      return document.querySelectorAll('#action-list li').length;
    })()`);
    assert.equal(added, 1);
    await evaluate(`document.querySelector('#action-list input[type="checkbox"]').click()`);
    assert.equal(await evaluate(`document.querySelector('#action-list input[type="checkbox"]').checked`), true);
    await command('Page.enable');
    await command('Page.reload', { ignoreCache: true });
    let restored = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      restored = await evaluate(`document.querySelector('#action-list input[type="checkbox"]')?.checked === true`);
      if (restored) break;
      await delay(100);
    }
    assert.equal(restored, true, '再読込後の完了状態');
    await evaluate(`document.querySelector('#action-list .delete-button').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('#action-list li').length`), 0);
    console.log('PASS: 追加、完了切替、再読込後の保持、削除');
  } finally { socket.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  chrome.kill();
  await delay(500);
  const target = path.resolve(profile);
  if (target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(target).startsWith('sikun-html-browser-')) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
