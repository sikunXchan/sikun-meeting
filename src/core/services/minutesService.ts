import { Repository } from '../store/repository';
import { Meeting } from '../types';
import { getPersonaById } from '../personas';
import { getMeetingTypeById } from '../meetingTypes';

export interface MinutesView {
  meeting: Meeting;
  meetingTypeName: string;
  participantLabels: Record<string, string>; // participantId -> "🧠 Architect"
  markdown: string;
}

/** 会議の議事録（Decision + Transcript）を人間可読な形式に整形する。 */
export class MinutesService {
  constructor(private repo: Repository) {}

  getMinutes(meetingId: string): MinutesView {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);

    const meetingType = getMeetingTypeById(meeting.meetingTypeId);
    const participantLabels: Record<string, string> = {};
    for (const p of meeting.participants) {
      const persona = getPersonaById(p.personaId);
      participantLabels[p.id] = persona ? `${persona.emoji} ${persona.name}` : p.personaId;
    }

    const markdown = this.toMarkdown(meeting, meetingType?.name ?? meeting.meetingTypeId, participantLabels);

    return { meeting, meetingTypeName: meetingType?.name ?? meeting.meetingTypeId, participantLabels, markdown };
  }

  private toMarkdown(meeting: Meeting, meetingTypeName: string, labels: Record<string, string>): string {
    const lines: string[] = [];
    lines.push(`# ${meeting.title}`);
    lines.push('');
    lines.push(`- 会議タイプ: ${meetingTypeName}`);
    lines.push(`- 議題: ${meeting.agenda}`);
    lines.push(`- ステータス: ${meeting.status}`);
    lines.push(`- 開始: ${meeting.startedAt ?? '-'}`);
    lines.push(`- 終了: ${meeting.endedAt ?? '-'}`);
    lines.push(
      `- 参加者: ${meeting.participants.map((p) => `${labels[p.id]}(${p.status})`).join(', ')}`,
    );
    lines.push('');
    lines.push('## 発言ログ');
    for (const msg of meeting.transcript) {
      const speaker = msg.speakerType === 'HUMAN' ? '👤 最高開発者' : msg.speakerType === 'SYSTEM' ? '🗒 system' : labels[msg.speakerId.split('#')[1]] ?? msg.speakerId;
      const stance = msg.stance ? `[${msg.stance}] ` : '';
      lines.push(`- **${speaker}** (${msg.createdAt}): ${stance}${msg.content}`);
    }
    lines.push('');

    if (meeting.decision) {
      const d = meeting.decision;
      lines.push('## FINAL DECISION');
      lines.push(d.decisionText);
      lines.push('');
      lines.push('### Reasoning');
      d.reasoning.forEach((r) => lines.push(`- ${r}`));
      lines.push('');
      lines.push('### Disagreements（各AIの立場）');
      d.disagreements.forEach((dis) => {
        lines.push(`- ${labels[dis.participantId] ?? dis.participantId}: ${dis.stance ?? '（発言なし）'}`);
      });
      lines.push('');
      lines.push('### Action Items');
      d.actionItems.forEach((ai) => lines.push(`- [ ] ${ai.assignee}: ${ai.description}`));
    } else {
      lines.push('## FINAL DECISION');
      lines.push('（未決定）');
    }

    return lines.join('\n');
  }
}
