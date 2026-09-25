const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppContext } = require('../dist/core');

async function main() {
  const workspace = process.argv[2] || path.resolve(__dirname, '..', '..', 'sikun-cyber-security');
  if (!fs.statSync(workspace).isDirectory()) throw new Error(`Workspace does not exist: ${workspace}`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-scs-commission-'));
  const ctx = createAppContext(dataDir);
  const project = await ctx.projectService.createProject('SCS Codex integration', '');
  const commission = await ctx.commissionService.create({
    projectId: project.id,
    workingDirectory: workspace,
    goal: 'Use Sikun Meeting with Codex to run Sikun Cyber Security against its own localhost-only test server and verify the result without a Gemini key.',
    settings: { provider: 'codex', codexModel: 'gpt-6-luna', maxCalls: 6 },
  });
  console.log(JSON.stringify({ phase: 'created', dataDir, commissionId: commission.id, workspace }));
  await ctx.commissionService.consult(commission.id,
    'In one sentence, outline a localhost-only verification task. Do not inspect files, edit files, or contact any host yet.');
  console.log(JSON.stringify({ phase: 'consulted', status: ctx.commissionService.get(commission.id).commission.status }));
  await ctx.commissionService.confirmPlan(commission.id,
    'Run exactly one local verification command in the existing Sikun Cyber Security worktree: .\\.venv\\Scripts\\python.exe scripts\\smoke_codex_runtime.py. It starts its own loopback HTTP server and uses the ChatGPT-signed-in Codex SDK without a Gemini key. Report the actual exit status and the result JSON. Do not edit files, do not contact external hosts, and keep this as one work item.');
  const deadline = Date.now() + 12 * 60 * 1000;
  let previous = '';
  let result;
  while (Date.now() < deadline) {
    result = ctx.commissionService.get(commission.id).commission;
    const status = JSON.stringify({ status: result.status, runs: result.runs.map((run) => `${run.phase}:${run.status}`),
      work: result.workItems.map((work) => `${work.title}:${work.status}`) });
    if (status !== previous) { console.log(status); previous = status; }
    if (result.status === 'delivered' || result.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (result.status !== 'delivered' && result.status !== 'failed') {
    await ctx.commissionService.stop(commission.id);
    throw new Error('SCS commission exceeded the twelve-minute trial deadline');
  }
  console.log(JSON.stringify({ phase: 'final', status: result.status, error: result.error,
    artifacts: result.artifacts.map((artifact) => ({ path: artifact.relativePath, status: artifact.status })),
    delivery: result.delivery, dataDir }));
  if (result.status !== 'delivered') throw new Error(result.error || 'SCS commission failed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
