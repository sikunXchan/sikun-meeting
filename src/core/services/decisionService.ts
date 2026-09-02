import { Repository, newId, nowIso } from '../store/repository';
import { ActionItem, Decision, Meeting } from '../types';
import { latestStanceByParticipant } from './discussionService';
import { ProjectService } from './projectService';

export interface FinalizeDecisionInput {
  decisionText: string;
  reasoning: string[];
  actionItems: { description: string; assignee: string }[];
}

/**
 * 会議の最終意思決定を確定する。
 * 決定権は常に人間の最高開発者にあり、AIの発言はあくまで賛否・提案・リスクの提示にとどまる。
 */
export class DecisionService {
  constructor(private repo: Repository, private projectService: ProjectService) {}

  async finalizeDecision(meetingId: string, input: FinalizeDecisionInput): Promise<Meeting> {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    if (meeting.status === 'CONCLUDED') throw new Error('この会議はすでに終了しています。');

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
      decisionText: input.decisionText,
      reasoning: input.reasoning,
      disagreements,
      actionItems,
      decidedBy: 'chief',
      decidedAt: nowIso(),
    };

    const updated = await this.repo.updateMeeting(meetingId, (m) => {
      m.decision = decision;
      m.status = 'CONCLUDED';
      m.endedAt = nowIso();
    });

    if (updated.projectId && actionItems.length > 0) {
      await this.projectService.recordActionItems(updated.projectId, meetingId, updated.title, actionItems);
    }

    return updated;
  }
}
