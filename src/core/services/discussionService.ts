import { Repository, newId, nowIso } from '../store/repository';
import { Meeting, Message } from '../types';
import { getPersonaById } from '../personas';
import { getMeetingTypeById } from '../meetingTypes';
import { resolveProtocol } from '../protocol/protocols';
import { DiscussionTrigger } from '../protocol/protocol';
import { buildTurnPrompt } from '../agent/promptBuilder';
import { runAgentTurn } from '../agent/claudeAgent';
import { parseStance } from '../agent/stanceParser';

/** 議論の進行状況をUIへリアルタイムに伝えるためのイベント。 */
export type TurnEvent =
  | { type: 'turn-start'; meetingId: string; participantId: string }
  | { type: 'turn-end'; meetingId: string; message: Message };

export type TurnEventListener = (event: TurnEvent) => void;

/**
 * 議論エンジン本体。
 * protocol が決めた発言順に沿って、AI参加者を1体ずつ逐次で発言させる。
 * 逐次にしているのは、後で発言するAIが「直前までの発言」を踏まえて
 * 賛成/反対/反論できるようにするため（並列に呼ぶと相互参照できない）。
 */
export class DiscussionService {
  constructor(private repo: Repository) {}

  private async markStarted(meetingId: string): Promise<void> {
    await this.repo.updateMeeting(meetingId, (meeting) => {
      if (meeting.status === 'CREATED') {
        meeting.status = 'IN_PROGRESS';
        meeting.startedAt = nowIso();
      }
    });
  }

  private async runTurns(
    meetingId: string,
    trigger: DiscussionTrigger,
    directQuestion?: string,
    onEvent?: TurnEventListener,
  ): Promise<Message[]> {
    const meetingSnapshot = this.repo.getMeeting(meetingId);
    if (!meetingSnapshot) throw new Error(`Meeting not found: ${meetingId}`);
    if (meetingSnapshot.status === 'CONCLUDED') {
      throw new Error('この会議はすでに終了しています。');
    }

    const protocol = resolveProtocol(meetingSnapshot);
    const turns = protocol.planTurns(meetingSnapshot, trigger);
    if (turns.length === 0) return [];

    await this.markStarted(meetingId);

    const produced: Message[] = [];
    for (const turnParticipant of turns) {
      const meeting = this.repo.getMeeting(meetingId)!;
      const participant = meeting.participants.find((p) => p.id === turnParticipant.id);
      if (!participant || participant.status !== 'ACTIVE') continue; // ラウンド中に除籍された場合はスキップ

      const persona = getPersonaById(participant.personaId);
      if (!persona) continue;

      onEvent?.({ type: 'turn-start', meetingId, participantId: participant.id });

      const prompt = buildTurnPrompt({
        meeting,
        persona,
        participant,
        triggerKind: trigger.kind === 'REBUTTAL_ROUND' ? 'REBUTTAL_ROUND' : trigger.kind === 'ASK_SPECIFIC' ? 'ASK_SPECIFIC' : 'ASK_ALL_ACTIVE',
        directQuestion,
      });

      const result = await runAgentTurn(persona, prompt, meeting.workingDirectory);
      const { stance, content } = parseStance(result.text);

      const message: Message = {
        id: newId(),
        meetingId,
        speakerType: 'AI',
        speakerId: `${persona.id}#${participant.id}`,
        content: result.isError ? result.text : content,
        stance: result.isError ? null : stance,
        createdAt: nowIso(),
      };

      await this.repo.updateMeeting(meetingId, (m) => {
        m.transcript.push(message);
      });
      produced.push(message);
      onEvent?.({ type: 'turn-end', meetingId, message });
    }

    return produced;
  }

  /** 現在ACTIVEな全AIに、招集順で意見を求める。 */
  async askAllActiveToSpeak(meetingId: string, onEvent?: TurnEventListener): Promise<Message[]> {
    return this.runTurns(meetingId, { kind: 'ASK_ALL_ACTIVE' }, undefined, onEvent);
  }

  /** 特定のAIを指名して質問する。 */
  async askSpecific(
    meetingId: string,
    participantId: string,
    question: string,
    onEvent?: TurnEventListener,
  ): Promise<Message[]> {
    return this.runTurns(meetingId, { kind: 'ASK_SPECIFIC', participantId }, question, onEvent);
  }

  /** 反論ラウンド。会議タイプが反論を許可していない場合は何もしない。 */
  async requestRebuttalRound(meetingId: string, onEvent?: TurnEventListener): Promise<Message[]> {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    const meetingType = getMeetingTypeById(meeting.meetingTypeId);
    if (!meetingType?.protocol.allowRebuttal) {
      throw new Error(`会議タイプ「${meetingType?.name}」は反論ラウンドをサポートしていません。`);
    }
    return this.runTurns(meetingId, { kind: 'REBUTTAL_ROUND' }, undefined, onEvent);
  }

  /** 最高開発者（人間）の発言を議事録に追加する。 */
  async humanSpeak(meetingId: string, content: string): Promise<Message> {
    const meeting = this.repo.getMeeting(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    if (meeting.status === 'CONCLUDED') throw new Error('この会議はすでに終了しています。');

    await this.markStarted(meetingId);

    const message: Message = {
      id: newId(),
      meetingId,
      speakerType: 'HUMAN',
      speakerId: 'chief',
      content,
      stance: null,
      createdAt: nowIso(),
    };
    await this.repo.updateMeeting(meetingId, (m) => {
      m.transcript.push(message);
    });
    return message;
  }
}

export function latestStanceByParticipant(meeting: Meeting): Map<string, Message> {
  const byParticipant = new Map<string, Message>();
  for (const msg of meeting.transcript) {
    if (msg.speakerType !== 'AI') continue;
    const participantId = msg.speakerId.split('#')[1];
    byParticipant.set(participantId, msg);
  }
  return byParticipant;
}
