import { randomUUID } from 'crypto';
import { Repository } from '../store/repository';
import { runAgentTurn, AgentTurnResult } from '../agent/claudeAgent';
import { Persona } from '../types';
import { AuditStore } from './store';
import { AuditFinding, AuditRecord } from './types';

const AUDITOR: Persona = {
  id: 'auditor', name: '社外取締役', emoji: '🔎', roleTitle: '独立監査',
  expertise: 'KGI、会議の判断、実行結果の照合', avatar: 'critic.png',
  systemPrompt: 'あなたは通常の会議に参加しない独立監査人。提供された記録だけを根拠に、KGIの実測値と過去の決定を検証する。根拠のない達成宣言を認めず、異論を遠慮なく書く。ファイルの変更や外部通信はしない。',
};

type AuditAgent = (persona: Persona, prompt: string, workingDirectory: string | null) => Promise<AgentTurnResult>;

function parseAssessment(text: string, validIds: Set<string>): { assessment: string; findings: AuditFinding[] } {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] || text) as { assessment?: unknown; findings?: unknown };
    if (typeof parsed.assessment !== 'string' || !parsed.assessment.trim()) throw new Error('評価が空です');
    const findings = Array.isArray(parsed.findings) ? parsed.findings.map((item: any) => ({
      kind: item.kind, referenceId: item.referenceId, finding: item.finding,
    })).filter((item: AuditFinding) =>
      ['goal', 'decision', 'evidence'].includes(item.kind) && validIds.has(item.referenceId) &&
      typeof item.finding === 'string' && item.finding.trim().length > 0) : [];
    return { assessment: parsed.assessment.trim().slice(0, 10000), findings: findings.slice(0, 50) };
  } catch { throw new Error('監査AIの回答が所定のJSON形式ではありません'); }
}

export class AuditService {
  private active = new Set<string>();
  constructor(private store: AuditStore, private repo: Repository, private agent: AuditAgent = runAgentTurn) {}

  list(projectId: string): AuditRecord[] {
    if (!this.repo.getProject(projectId)) throw new Error('プロジェクトが見つかりません');
    return this.store.list(projectId);
  }

  async run(projectId: string): Promise<AuditRecord> {
    if (this.active.has(projectId)) throw new Error('このプロジェクトの監査は実行中です');
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    const meetings = this.repo.listMeetings()
      .filter((meeting) => meeting.projectId === projectId && meeting.decision)
      .sort((a, b) => a.decision!.decidedAt.localeCompare(b.decision!.decidedAt))
      .slice(-10);
    if (!meetings.length) throw new Error('監査対象の決定済み会議がありません');
    this.active.add(projectId);
    try {
      const cards = (project.artifactCards || []).map((card) => ({ card, latest: card.versions.at(-1)! }));
      const goalProgress = cards.flatMap(({ card, latest }) => latest.goals.map((goal) => ({
        cardId: card.id, goalId: goal.id, label: goal.label, target: goal.target,
        current: goal.current, evidence: goal.evidence,
        status: goal.current === null || !goal.evidence ? 'unverified' as const :
          goal.current >= goal.target ? 'met' as const : 'unmet' as const,
      })));
      const periodEnd = new Date().toISOString();
      const previous = this.store.list(projectId)[0];
      const input = {
        project: { id: project.id, name: project.name, description: project.description },
        cards: cards.map(({ card, latest }) => ({ id: card.id, name: card.name, version: latest.version,
          status: latest.status, summary: latest.summary.slice(0, 1000),
          knownIssues: latest.knownIssues.slice(0, 20), backlog: latest.backlog.slice(0, 20),
          goals: latest.goals, decisionIds: latest.decisionIds, commissionIds: latest.commissionIds })),
        decisions: meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, agenda: meeting.agenda,
          decidedAt: meeting.decision!.decidedAt, decision: meeting.decision!.decisionText,
          reasoning: meeting.decision!.reasoning, disagreements: meeting.decision!.disagreements,
          gate: meeting.decision!.gate, overrideReason: meeting.decision!.overrideReason,
          actionItems: meeting.decision!.actionItems,
          minutes: meeting.transcript.slice(-20).map((message) => ({
            speakerId: message.speakerId, stance: message.stance, content: message.content.slice(0, 400),
          })) })),
        actionItems: project.actionItems.slice(-100),
      };
      const prompt = `この監査は通常の21部門の会議と独立している。以下の記録について、KGI実測値と議事録・議決理由・反対意見・実行項目を突き合わせ、過去の決定が妥当だったか評価せよ。自己申告や推測を実測扱いしない。JSONのみ返す: {"assessment":"全体評価","findings":[{"kind":"goal|decision|evidence","referenceId":"実在するgoalIdまたはmeetingIdまたはcardId","finding":"具体的な指摘"}]}。\n\n${JSON.stringify(input)}`;
      const response = await this.agent(AUDITOR, prompt, null);
      if (response.isError || !response.text.trim()) throw new Error(response.text || '監査AIの回答がありません');
      const ids = new Set([...meetings.map((meeting) => meeting.id), ...cards.map(({ card }) => card.id), ...goalProgress.map((goal) => goal.goalId)]);
      const parsed = parseAssessment(response.text, ids);
      return this.store.append({
        id: randomUUID(), projectId, createdAt: periodEnd, periodStart: previous?.createdAt || null, periodEnd,
        meetingIds: meetings.map((meeting) => meeting.id),
        cardVersions: cards.map(({ card, latest }) => ({ cardId: card.id, version: latest.version })),
        goalProgress, findings: parsed.findings, assessment: parsed.assessment,
        requestedModel: response.requestedModel, effectiveModel: response.effectiveModel,
      });
    } finally { this.active.delete(projectId); }
  }

  /** アプリ稼働中は30日ごとに一度。監査可能なプロジェクトだけ対象。 */
  async runDue(): Promise<void> {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const project of this.repo.listProjects()) {
      const latest = this.store.list(project.id)[0];
      if (Date.parse(latest?.createdAt || project.createdAt) > cutoff) continue;
      const decisions = this.repo.listMeetings().filter((meeting) => meeting.projectId === project.id && meeting.decision);
      if (!decisions.length) continue;
      try { await this.run(project.id); } catch (error) { console.error('[audit] failed', project.id, error); }
    }
  }
}
