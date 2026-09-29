const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../dist/core/store/jsonStore');
const { Repository } = require('../dist/core/store/repository');
const { ProjectService } = require('../dist/core/services/projectService');
const { MeetingService } = require('../dist/core/services/meetingService');
const { DiscussionService } = require('../dist/core/services/discussionService');
const { DecisionService } = require('../dist/core/services/decisionService');
const { AuditStore } = require('../dist/core/audit/store');
const { AuditService } = require('../dist/core/audit/service');
const { EmailStore } = require('../dist/core/email/store');
const { EmailService } = require('../dist/core/email/service');
const { approvedTools, capabilityFor, methodFor } = require('../dist/core/capabilities');
const { appliedSkillsFor, skillPromptFor } = require('../dist/core/skills/catalog');

test('部門別モデルと工程別ツールを分け、監査・会議を読み取り専用にする', () => {
  assert.notEqual(capabilityFor('critic').model, capabilityFor('innovator').model);
  assert.deepEqual(approvedTools('auditor', 'meeting'), ['Read', 'Grep', 'Glob']);
  assert.equal(approvedTools('engineer', 'work').includes('Bash'), true);
  assert.equal(approvedTools('finance', 'work').includes('Bash'), false);
  assert.equal(approvedTools('finance', 'meeting').includes('Write'), false);
  assert.equal(methodFor('security').includes('security-review'), true);
});

test('同梱スキルは担当部門と工程で選び、会議の権限を広げない', () => {
  assert.deepEqual(appliedSkillsFor('it_consultant', 'consultation'), [{ id: 'requirements-framing', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('engineer', 'work'), [{ id: 'implementation', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('engineer', 'review'), []);
  assert.deepEqual(appliedSkillsFor('qa', 'review'), [{ id: 'acceptance-verification', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('security', 'meeting'), [{ id: 'security-review', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('product', 'planning'), [{ id: 'product-planning', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('critic', 'goal_check'), [{ id: 'critic-evidence', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('critic', 'kgi_check'), [{ id: 'critic-evidence', version: '1.0.0' }]);
  assert.deepEqual(appliedSkillsFor('finance', 'work'), [{ id: 'financial-analysis', version: '1.0.0' }]);
  assert.match(skillPromptFor('architect', 'meeting'), /会議やレビューでは変更を提案/);
  assert.equal(skillPromptFor('architect', 'meeting').includes('description:'), false);
  assert.match(skillPromptFor('security', 'review'), /権限/);
  assert.match(skillPromptFor('product', 'planning'), /完成条件/);
  assert.match(skillPromptFor('critic', 'goal_check'), /証拠がない条件は未達/);
  assert.match(skillPromptFor('finance', 'work'), /費用と収支の検討/);
  assert.deepEqual(approvedTools('engineer', 'meeting'), ['Read', 'Grep', 'Glob']);
});

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikun-governance-'));
  t.after(() => {
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary path escaped');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const repo = new Repository(new JsonStore(dir));
  const projects = new ProjectService(repo);
  const project = await projects.createProject('検証', '会議の効果を測る');
  return { dir, repo, projects, project };
}

test('成果物カルテを会議開始時に固定し、全員の初回意見がそろうまで公開しない', async (t) => {
  const f = await fixture(t);
  const card = await f.projects.upsertArtifactCard(f.project.id, {
    name: '試作アプリ', kind: 'app', status: '検証中', summary: '初回利用を改善', knownIssues: ['離脱が多い'],
    backlog: ['操作を短縮'], goals: [{ label: '完了率', target: 80, current: 40, unit: '%', evidence: '計測A' }],
  });
  const meeting = await new MeetingService(f.repo).createMeeting({ projectId: f.project.id, meetingTypeId: 'product_review',
    title: '改善検討', agenda: '完了率を高める', personaIds: ['product', 'critic'] });
  assert.equal(meeting.artifactCardSnapshot[0].version, 1);
  let fail = true;
  const prompts = [];
  const discussion = new DiscussionService(f.repo, async (persona, prompt) => {
    prompts.push({ id: persona.id, prompt });
    if (persona.id === 'critic' && fail) return { text: '一時的な接続失敗', isError: true };
    return { text: `【立場: 賛成】${persona.id}の独立意見`, isError: false, requestedModel: 'test' };
  });
  await assert.rejects(() => discussion.askAllActiveToSpeak(meeting.id));
  assert.equal(f.repo.getMeeting(meeting.id).transcript.length, 0);
  assert.equal(f.repo.getMeeting(meeting.id).initialRound.responses.length, 1);
  fail = false;
  await discussion.askAllActiveToSpeak(meeting.id);
  assert.equal(prompts.filter((item) => item.id === 'product').length, 1);
  assert.equal(prompts.at(-1).prompt.includes('productの独立意見'), false);
  assert.equal(f.repo.getMeeting(meeting.id).transcript.length, 2);
  assert.equal(f.repo.getMeeting(meeting.id).initialRound.status, 'published');
  await discussion.askAllActiveToSpeak(meeting.id);
  assert.equal(prompts.at(-1).prompt.includes('productの独立意見'), true);
  const gate = new DecisionService(f.repo, f.projects).getGate(meeting.id);
  assert.equal(gate.ready, true);
  const result = await new DecisionService(f.repo, f.projects).finalizeDecision(meeting.id,
    { decisionText: '操作を短縮する', reasoning: ['離脱を減らす'], actionItems: [] });
  assert.equal(result.decision.gate.ready, true);
  assert.equal(f.projects.getProject(f.project.id).artifactCards[0].versions.at(-1).decisionIds.includes(meeting.id), true);
  assert.equal(card.id, f.projects.getProject(f.project.id).artifactCards[0].id);
});

test('議決条件を満たさない場合は理由付きの人間の例外判断だけを認める', async (t) => {
  const f = await fixture(t);
  const meeting = await new MeetingService(f.repo).createMeeting({ projectId: f.project.id, meetingTypeId: 'product_review',
    title: '未審議', agenda: '検討', personaIds: ['product', 'critic'] });
  const decisions = new DecisionService(f.repo, f.projects);
  await assert.rejects(() => decisions.finalizeDecision(meeting.id,
    { decisionText: '進める', reasoning: [], actionItems: [] }), /議決条件/);
  const concluded = await decisions.finalizeDecision(meeting.id,
    { decisionText: '緊急対応を進める', reasoning: [], actionItems: [], overrideReason: '障害対応のため' });
  assert.equal(concluded.decision.overrideReason, '障害対応のため');
});

test('独立監査は議事録とKGIを照合し、別の履歴に保存する', async (t) => {
  const f = await fixture(t);
  const card = await f.projects.upsertArtifactCard(f.project.id, {
    name: '試作', kind: 'app', status: '検証中', summary: '改善中', knownIssues: [], backlog: [],
    goals: [{ label: '完了率', target: 80, current: 40, unit: '%', evidence: '計測A' }],
  });
  const meeting = await new MeetingService(f.repo).createMeeting({ projectId: f.project.id, meetingTypeId: 'product_review',
    title: '改善', agenda: 'KGI', personaIds: ['product', 'critic'] });
  await new DecisionService(f.repo, f.projects).finalizeDecision(meeting.id,
    { decisionText: '試作を継続', reasoning: [], actionItems: [], overrideReason: '先行検証のため' });
  let seen = '';
  const service = new AuditService(new AuditStore(f.dir), f.repo, async (persona, prompt) => {
    assert.equal(persona.id, 'auditor'); seen = prompt;
    return { text: JSON.stringify({ assessment: 'KGI未達。決定は再検証が必要。', findings: [
      { kind: 'goal', referenceId: card.versions[0].goals[0].id, finding: '完了率が目標を下回る' },
    ] }), isError: false, requestedModel: 'opus' };
  });
  const record = await service.run(f.project.id);
  assert.equal(record.goalProgress[0].status, 'unmet');
  assert.equal(record.findings.length, 1);
  assert.equal(seen.includes('試作を継続'), true);
  assert.equal(new AuditStore(f.dir).list(f.project.id).length, 1);
  assert.equal(f.repo.getMeeting(meeting.id).transcript.length, 0);
});

test('監査は作成直後に自動実行せず、30日後に一度実行する', async (t) => {
  const f = await fixture(t);
  const meeting = await new MeetingService(f.repo).createMeeting({ projectId: f.project.id, meetingTypeId: 'product_review',
    title: '判断', agenda: '予定', personaIds: ['product', 'critic'] });
  await new DecisionService(f.repo, f.projects).finalizeDecision(meeting.id,
    { decisionText: '試行する', reasoning: [], actionItems: [], overrideReason: '先に確認する' });
  let calls = 0;
  const service = new AuditService(new AuditStore(f.dir), f.repo, async () => {
    calls++;
    return { text: JSON.stringify({ assessment: '進捗を確認', findings: [] }), isError: false };
  });
  await service.runDue();
  assert.equal(calls, 0);
  await f.repo.updateProject(f.project.id, (project) => { project.createdAt = '2020-01-01T00:00:00.000Z'; });
  await service.runDue();
  await service.runDue();
  assert.equal(calls, 1);
});

test('メールは確定会議から下書きを作り、送信結果不明なら再送しない', async (t) => {
  const f = await fixture(t);
  const meeting = await new MeetingService(f.repo).createMeeting({ projectId: f.project.id, meetingTypeId: 'product_review',
    title: '報告', agenda: '通知', personaIds: ['product', 'critic'] });
  await new DecisionService(f.repo, f.projects).finalizeDecision(meeting.id,
    { decisionText: '共有する', reasoning: [], actionItems: [], overrideReason: '早期共有' });
  let calls = 0;
  const service = new EmailService(new EmailStore(f.dir), f.repo, {
    async listTools() { return ['send_email']; },
    async send(_config, args) { calls++; assert.deepEqual(args.to, ['a@example.com']); throw new Error('通信断'); },
  });
  await service.configure({ endpoint: 'https://example.com/mcp', sendTool: 'send_email', authorizationEnv: '',
    argumentTemplate: { to: '{{toArray}}', subject: '{{subject}}', body: '{{body}}' } });
  const draft = await service.createDraft({ projectId: f.project.id, sourceMeetingId: meeting.id,
    to: ['a@example.com'], subject: '報告', body: '会議の決定を送ります' });
  await assert.rejects(() => service.sendDraft(draft.id), /通信断/);
  assert.equal(new EmailStore(f.dir).get(draft.id).status, 'unknown');
  await assert.rejects(() => service.sendDraft(draft.id), /下書きではありません/);
  assert.equal(calls, 1);
});
