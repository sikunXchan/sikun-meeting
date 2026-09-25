const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAppUrl, isExternalWebUrl, assertTrustedSender } = require('../dist/main/security');

const appUrl = 'file:///opt/sikun/resources/app.asar/dist/renderer/index.html';

test('IPCはアプリ自身の画面からの呼び出しだけを受け付ける', () => {
  assert.equal(isAppUrl(appUrl, appUrl), true);
  assert.equal(isAppUrl(`${appUrl}#meeting`, appUrl), true);
  for (const url of [
    'https://example.com/index.html',
    'file:///tmp/evil/index.html',
    'file:///opt/sikun/resources/app.asar/dist/renderer/other.html',
    'devtools://devtools/bundled/inspector.html',
    'about:blank',
    '',
    null,
  ]) {
    assert.equal(isAppUrl(url, appUrl), false, String(url));
    assert.throws(() => assertTrustedSender({ senderFrame: url === null ? null : { url } }, appUrl), /許可されていない画面/);
  }
  assert.doesNotThrow(() => assertTrustedSender({ senderFrame: { url: appUrl } }, appUrl));
});

test('既定のブラウザで開くのは http(s) だけ', () => {
  assert.equal(isExternalWebUrl('https://example.com'), true);
  assert.equal(isExternalWebUrl('http://example.com'), true);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'smb://host/share', 'ms-settings:', 'not a url']) {
    assert.equal(isExternalWebUrl(url), false, url);
  }
});

test('sandbox化したpreloadのチャンネル名はメイン側と一致し、相対requireを含まない', () => {
  const { IPC_CHANNELS } = require('../dist/main/ipc');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'dist', 'main', 'preload.js'), 'utf8');
  const inPreload = new Set([...preload.matchAll(/'([A-Za-z-]+:[A-Za-z]+)'/g)].map((match) => match[1]));
  assert.deepEqual([...inPreload].sort(), Object.values(IPC_CHANNELS).sort());
  const requires = [...preload.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(requires, ['electron']);
});
