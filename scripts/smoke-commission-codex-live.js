const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppContext } = require('../dist/core');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-codex-commission-'));
  try {
    const ctx = createAppContext(dir);
    const project = await ctx.projectService.createProject('Codex縦断試験', '');
    const commission = await ctx.commissionService.create({
      projectId: project.id,
      goal: '作業ディレクトリに greeting.txt を作り、内容を正確に hello とする。確認して納品する。',
      settings: { provider: 'codex', codexModel: 'gpt-6-sol', maxCalls: 7 },
    });
    await ctx.commissionService.consult(commission.id, 'この小さな試験の企画を一文でまとめてください。');
    await ctx.commissionService.confirmPlan(commission.id, 'greeting.txt に正確に hello と書き、内容を確認して納品する。');
    const deadline = Date.now() + 5 * 60 * 1000;
    let result;
    while (Date.now() < deadline) {
      result = ctx.commissionService.get(commission.id).commission;
      if (result.status === 'delivered' || result.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (result.status !== 'delivered' && result.status !== 'failed') {
      await ctx.commissionService.stop(commission.id);
      throw new Error('Codex縦断試験が時間内に終わりませんでした');
    }
    console.log(JSON.stringify({
      status: result.status,
      error: result.error,
      work: result.workItems.map((entry) => ({ title: entry.title, status: entry.status })),
      artifacts: result.artifacts.map((entry) => ({ path: entry.relativePath, status: entry.status })),
      runs: result.runs.map((entry) => ({ phase: entry.phase, provider: entry.provider, model: entry.requestedModel, status: entry.status })),
      directory: result.workingDirectory,
    }));
    if (result.status !== 'delivered') throw new Error(result.error || 'Codex縦断試験が失敗しました');
    if (fs.readFileSync(path.join(result.workingDirectory, 'greeting.txt'), 'utf8').trim() !== 'hello') throw new Error('成果ファイルの内容が不正です');
    if (!result.artifacts.some((entry) => entry.relativePath === 'greeting.txt' && entry.status === 'accepted')) throw new Error('成果ファイルが採用されていません');
    if (!result.runs.every((entry) => entry.provider === 'codex' && entry.requestedModel === 'gpt-6-sol')) throw new Error('Codex以外の実行が混在しました');
  } finally {
    const target = path.resolve(dir);
    if (!target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('試験用フォルダが一時領域の外です');
    if (!process.argv.includes('--keep')) fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
