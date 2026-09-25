import { Repository, newId, nowIso } from '../store/repository';
import { ActionItem, Decision, DecisionGate, Meeting } from '../types';
import { latestStanceByParticipant } from './discussionService';
import { ProjectService } from './projectService';
import { getMeetingTypeById } from '../meetingTypes';

export interface FinalizeDecisionInput {
  decisionText: string;
  reasoning: string[];
  actionItems: { description: string; assignee: string }[];
  overrideReason?: string;
}

const REQUIRED_ROLES: Record<string, string[]> = {
  steering_committee: ['finance', 'legal'],
  architecture_review: ['architect', 'security'],
  product_review: ['product', 'critic'],
  incident_review: ['devops', 'security'],
  investment_committee: ['finance', 'legal'],
};

export function evaluateDecisionGate(meeting: Meeting): DecisionGate {
  const active = meeting.participants.filter((participant) => participant.status === 'ACTIVE');
  const byParticipant = latestStanceByParticipant(meeting);
  const responses = active.map((participant) => byParticipant.get(participant.id));
  const validStanceCount = responses.filter((message) => message?.stance).length;
  const supportCount = responses.filter((message) => message?.stance === '賛成' || message?.stance === '条件付き賛成').length;
  const opposeCount = responses.filter((message) => message?.stance === '反対').length;
  const riskCount = responses.filter((message) => message?.stance === 'リスク指摘').length;
  const reasons: string[] = [];
  const meetingType = getMeetingTypeById(meeting.meetingTypeId);
  if (meeting.initialRound?.status !== 'published') reasons.push('全員の独立した初回意見が公開されていません');
  const required = REQUIRED_ROLES[meeting.meetingTypeId] ?? [];
  const present = new Set(active.map((participant) => participant.personaId));
  for (const role of required) if (!present.has(role)) reasons.push(`必要な専門部門 ${role} が参加していません`);
  if (active.length < 2) reasons.push('有効な参加者が2人未満です');
  if (validStanceCount < Math.ceil(active.length * 2 / 3)) reasons.push('有効な意見が定足数（参加者の3分の2）に達していません');
  if (meetingType?.protocol.votingEnabled) {
    const postReveal = new Set(meeting.transcript.filter((message) => message.speakerType === 'AI' && message.roundKind !== 'initial')
      .map((message) => message.speakerId.split('#')[1]));
    if (active.some((participant) => !postReveal.has(participant.id))) reasons.push('公開後の討論を全員が終えていません');
    if (supportCount < Math.ceil(active.length * 2 / 3)) reasons.push('賛成・条件付き賛成が参加者の3分の2に達していません');
  }
  if (opposeCount || riskCount) reasons.push('反対意見またはリスク指摘が残っています');
  return {
    ready: reasons.length === 0,
    recommended: reasons.length === 0,
    reasons, activeCount: active.length, validStanceCount, supportCount, opposeCount, riskCount,
    checkedAt: nowIso(),
  };
}

/**
 * 会議の最終意思決定を確定する。
 * 決定権は常に人間の最高開発者にあり、AIの発言はあくまで賛否・提案・リスクの提示にとどまる。
 */
export class DecisionService {
  constructor(private repo: Repository, private projectService: ProjectService) {}

  getGate(meetingId: string): DecisionGate {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    return evaluateDecisionGate(meeting);
  }

  async finalizeDecision(meetingId: string, input: FinalizeDecisionInput): Promise<Meeting> {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    if (meeting.status === 'CONCLUDED') throw new Error('この会議はすでに終了しています。');
    if (!input.decisionText?.trim()) throw new Error('決定内容を入力してください');
    const gate = evaluateDecisionGate(meeting);
    const overrideReason = input.overrideReason?.trim() || undefined;
    if (!gate.ready && !overrideReason) {
      throw new Error(`議決条件が未達です: ${gate.reasons.join('、')}。例外として決定する場合は理由を記録してください`);
    }

    const stanceByParticipant = latestStanceByParticipant(meeting);
    const disagreements = meeting.participants
      .filter((p) => p.status === 'ACTIVE')
      .map((p) => {
        const lastMsg = stanceByParticipant.get(p.id);
        return { participantId: p.id, stance: lastMsg?.stance ?? null, note: lastMsg?.content };
      });

    const actionItems: ActionItem[] = input.actionItems.map((a) => ({
      id: newId(),
      description: a.description,
      assignee: a.assignee,
      done: false,
    }));

    const decision: Decision = {
      decisionText: input.decisionText.trim(),
      reasoning: input.reasoning,
      disagreements,
      actionItems,
      decidedBy: 'chief',
      decidedAt: nowIso(),
      gate,
      overrideReason,
    };

    const updated = await this.repo.updateMeeting(meetingId, (m) => {
      m.decision = decision;
      m.status = 'CONCLUDED';
      m.endedAt = nowIso();
    });

    if (updated.projectId && actionItems.length > 0) {
      await this.projectService.syncActionItems(updated.projectId, meetingId, updated.title, actionItems);
    }
    if (updated.projectId) {
      await this.projectService.recordDecision(updated.projectId, meetingId,
        updated.artifactCardSnapshot?.map((entry) => entry.cardId) || []);
    }

    return updated;
  }

  /**
   * 決定確定後、Action Itemsだけを編集する。
   * 決定文・理由・各AIの立場（disagreements）といった「その場で何が話されたか」の記録は
   * 通常の会議では改ざんに等しいため変更不可のままにし、実行タスクであるAction Itemsのみ
   * 書き換え・追加・削除できるようにする（idを省略した項目は新規追加、既存idのdone状態は保持）。
   */
  async updateActionItems(
    meetingId: string,
    items: { id?: string; description: string; assignee: string }[],
  ): Promise<Meeting> {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    if (!meeting.decision) throw new Error('この会議はまだ決定していません。');

    const existingById = new Map(meeting.decision.actionItems.map((a) => [a.id, a]));
    const actionItems: ActionItem[] = items.map((item) => {
      const existing = item.id ? existingById.get(item.id) : undefined;
      return {
        id: existing?.id ?? newId(),
        description: item.description,
        assignee: item.assignee,
        done: existing?.done ?? false,
      };
    });

    const updated = await this.repo.updateMeeting(meetingId, (m) => {
      if (m.decision) m.decision.actionItems = actionItems;
    });

    if (updated.projectId) {
      await this.projectService.syncActionItems(updated.projectId, meetingId, updated.title, actionItems);
    }

    return updated;
  }
}
