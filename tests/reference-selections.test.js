const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { ReferenceSelections } = require('../dist/main/referenceSelections');
const { persistReferences, MAX_REFERENCE_BYTES } = require('../dist/core/commission/references');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-references-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root, 'note.txt'); fs.writeFileSync(source, 'selected content');
  return { root, source, selections: new ReferenceSelections() };
}
test('only the selecting renderer can consume opaque IDs; arbitrary paths and reused IDs are rejected', async t => {
  const {source, selections} = fixture(t), [file] = selections.select(1, [source]);
  assert.deepEqual(Object.keys(file).sort(), ['id', 'name']); assert.equal(file.name, 'note.txt');
  let calls = 0;
  const action = async () => { calls++; };
  for (const ids of [[source], ['~/.ssh/id_rsa'], [file.id, file.id], [null], null, Array(11).fill(file.id)]) {
    await assert.rejects(selections.consume(1, ids, action));
  }
  await assert.rejects(selections.consume(2, [file.id], action), /選び直/);
  assert.equal(calls, 0);
  fs.writeFileSync(source, 'changed after dialog');
  await selections.consume(1, [file.id], async files => assert.equal(files[0].content.toString(), 'selected content'));
  await assert.rejects(selections.consume(1, [file.id], action), /選び直/);
});
test('failed creation retains selection, concurrent reuse is blocked, closing/reloading clears it', async t => {
  const {source, selections} = fixture(t), [file] = selections.select(1, [source]);
  await assert.rejects(selections.consume(1, [file.id], async files => { files[0].content.fill(0); throw Error('invalid project'); }));
  let release;
  const pending = selections.consume(1, [file.id], async files => {
    assert.equal(files[0].content.toString(), 'selected content');
    await new Promise(resolve => { release = resolve; });
  });
  await assert.rejects(selections.consume(1, [file.id], async () => {}), /選び直/);
  assert.throws(() => selections.select(1, [], [file.id]));
  release(); await pending;
  const [second] = selections.select(1, [source]); selections.clear(1);
  await assert.rejects(selections.consume(1, [second.id], async () => {}), /選び直/);
});
test('file and total count limits do not discard earlier selected files on failure', async t => {
  const {root, source, selections} = fixture(t), [file] = selections.select(1, [source]);
  assert.throws(() => selections.select(1, [root], [file.id]), /ファイル/);
  const big = path.join(root, 'big'); const fd = fs.openSync(big, 'w'); fs.ftruncateSync(fd, MAX_REFERENCE_BYTES + 1); fs.closeSync(fd);
  assert.throws(() => selections.select(1, [big], [file.id]), /20 MB/);
  assert.throws(() => selections.select(1, Array(10).fill(source), [file.id]), /10件/);
  await selections.consume(1, [file.id], async files => assert.equal(files[0].content.toString(), 'selected content'));
});
test('reference copies stay outside the selected repository and reject unsafe storage roots', t => {
  const {root} = fixture(t), data = path.join(root, 'app-data'), repo = path.join(root, 'project');
  fs.mkdirSync(data); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, '.git'));
  const files = [{ name: 'note.txt', content: Buffer.from('reference') }];
  const copied = persistReferences(data, 'job-1', repo, files);
  assert.equal(path.isAbsolute(copied[0]), true);
  assert.equal(fs.readFileSync(copied[0], 'utf8'), 'reference');
  assert.deepEqual(fs.readdirSync(repo), ['.git']);
  assert.throws(() => persistReferences(data, 'job-1', repo, files)); // no overwrites
  assert.throws(() => persistReferences(data, 'job-2', root, files), /含まない/);
  assert.throws(() => persistReferences(data, '../escape', repo, files), /保存先/);
  assert.throws(() => persistReferences(data, 'job-3', repo, [{ name: '../private', content: Buffer.from('x') }]), /不正/);
  assert.throws(() => persistReferences(repo, 'job-4', data, files), /Git/);
  const linkRoot = path.join(root, 'linked-data'); fs.mkdirSync(linkRoot);
  try { fs.symlinkSync(repo, path.join(linkRoot, 'commission-references'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.diagnostic('symlink unavailable'); throw error; }
  assert.throws(() => persistReferences(linkRoot, 'job-5', data, files), /保存先/);
});
