const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexAgentClient } = require('../dist/core/commission/codexAgent');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-codex-agent-'));
  try {
    const result = await new CodexAgentClient().run({
      provider: 'codex',
      phase: 'consultation',
      personaId: 'it_consultant',
      prompt: '日本語で「動作確認済み」と一文だけ答えてください。ファイルは変更しないでください。',
      workingDirectory: dir,
      model: 'gpt-6-sol',
      tools: 'read',
      maxTurns: 12,
      abortSignal: new AbortController().signal,
    });
    if (!result.text.includes('動作確認済み')) throw new Error(`Unexpected reply: ${result.text}`);
    if (fs.readdirSync(dir).length !== 0) throw new Error('Read-only trial changed the workspace');
    console.log(JSON.stringify({ reply: result.text, responseModelObserved: Boolean(result.effectiveModel) }));
  } finally {
    if (!process.argv.includes('--keep')) fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
