const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppContext } = require('../dist/core');

async function waitFor(service, id) {
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const item = service.get(id).commission;
    if (item.status === 'delivered' || item.status === 'failed') return item;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('3分以内に納品または失敗になりませんでした');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-commission-live-'));
  try {
    const ctx = createAppContext(dir);
    const project = await ctx.projectService.createProject('統合試験', '');
    const commission = await ctx.commissionService.create({
      projectId: project.id,
      goal: '作業ディレクトリに greeting.txt を作り、内容を「こんにちは」にする。ファイルを確認して納品する。',
      settings: { consultantModel: 'haiku', plannerModel: 'haiku', workerModel: 'haiku', reviewerModel: 'haiku', maxCalls: 8, maxTurnsPerCall: 8 },
    });
    const consulted = await ctx.commissionService.consult(commission.id, 'この小さな試験用の企画をまとめてください。');
    console.log(`consulted: ${consulted.consultation.length} messages`);
    await ctx.commissionService.confirmPlan(commission.id, '作業ディレクトリに greeting.txt を新規作成し、内容を「こんにちは」にする。内部確認でファイルの存在と内容を確認し、納品する。');
    const result = await waitFor(ctx.commissionService, commission.id);
    console.log(JSON.stringify({ status: result.status, error: result.error, work: result.workItems.map((work) => ({ title: work.title, status: work.status })), artifacts: result.artifacts.map((artifact) => ({ path: artifact.relativePath, status: artifact.status })), models: result.runs.flatMap((run) => run.observedModels), delivery: result.delivery?.slice(0, 350) }));
    if (result.status !== 'delivered') throw new Error(result.error || '納品に失敗しました');
    if (fs.readFileSync(path.join(result.workingDirectory, 'greeting.txt'), 'utf8').trim() !== 'こんにちは') throw new Error('成果ファイルの内容が不正です');
    if (!result.artifacts.some((artifact) => artifact.relativePath === 'greeting.txt' && artifact.status === 'accepted')) throw new Error('成果ファイルが採用されていません');
  } finally {
    const target = path.resolve(dir);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!target.startsWith(tempRoot)) throw new Error('試験用フォルダが一時領域の外です');
    if (!process.argv.includes('--keep')) fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
