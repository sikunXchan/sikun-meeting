const { SdkAgentClient } = require('../dist/core/commission/agent');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const client = new SdkAgentClient();
  const full = process.argv.includes('--full');
  const model = process.argv.find((arg) => arg.startsWith('--model='))?.slice('--model='.length) || 'haiku';
  const workingDirectory = full ? fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-agent-smoke-')) : process.cwd();
  const result = await client.run({
    personaId: full ? 'engineer' : 'it_consultant',
    prompt: full ? 'この作業ディレクトリに smoke.txt を作り、内容を「確認済み」にしてください。完了したら一文で答えてください。' : '「企画案を承知しました」と一文だけ日本語で答えてください。',
    workingDirectory,
    model,
    fallbackModel: process.argv.includes('--no-fallback') ? undefined : 'claude-haiku-4-5-20251001',
    tools: full ? 'full' : 'read',
    maxTurns: full ? 4 : 1,
    abortSignal: new AbortController().signal,
  });
  const file = full ? path.join(workingDirectory, 'smoke.txt') : null;
  if (full && (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() !== '確認済み')) throw new Error('実作業の成果ファイルを確認できません');
  console.log(JSON.stringify({ text: result.text, effectiveModel: result.effectiveModel, models: result.observedModels, numTurns: result.numTurns, file }));
  if (full && !process.argv.includes('--keep')) {
    const target = path.resolve(workingDirectory);
    if (!target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('試験用フォルダが一時領域の外です');
    fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
