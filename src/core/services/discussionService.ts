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
  private active = new Set<string>();
  constructor(private repo: Repository, private agent: typeof runAgentTurn = runAgentTurn) {}

  private async runInitialRound(meetingId: string, onEvent?: TurnEventListener): Promise<Message[]> {
    let meeting = this.repo.getMeeting(meetingId)!;
    if (!meeting.initialRound) {
      const ids = meeting.participants.filter((p) => p.status === 'ACTIVE').map((p) => p.id);
      await this.repo.updateMeeting(meetingId, (current) => {
        current.initialRound = {
          status: 'collecting', participantIds: ids,
          baseTranscriptLength: current.transcript.length, responses: [], startedAt: nowIso(),
        };
      });
    }
    meeting = this.repo.getMeeting(meetingId)!;
    const round = meeting.initialRound!;
    if (round.status === 'published') return [];
    for (const participantId of round.participantIds) {
      meeting = this.repo.getMeeting(meetingId)!;
      const current = meeting.initialRound!;
      if (current.responses.some((message) => message.speakerId.endsWith(`#${participantId}`))) continue;
      const participant = meeting.participants.find((item) => item.id === participantId);
      if (!participant || participant.status !== 'ACTIVE') throw new Error('初回意見の収集中は参加者を変更できません');
      const persona = getPersonaById(participant.personaId);
      if (!persona) throw new Error('参加AIの定義が見つかりません');
      onEvent?.({ type: 'turn-start', meetingId, participantId });
      const prompt = buildTurnPrompt({
        meeting: { ...meeting, transcript: meeting.transcript.slice(0, current.baseTranscriptLength) },
        persona, participant, triggerKind: 'ASK_ALL_ACTIVE', initialIndependent: true,
      });
      const result = await this.agent(persona, prompt, meeting.workingDirectory);
      if (result.isError) throw new Error(`${persona.name}: ${result.text}`);
      const { stance, content } = parseStance(result.text);
      const message: Message = {
        id: newId(), meetingId, speakerType: 'AI', speakerId: `${persona.id}#${participant.id}`,
        content, stance, createdAt: nowIso(), roundKind: 'initial',
        requestedModel: result.requestedModel, effectiveModel: result.effectiveModel,
      };
      await this.repo.updateMeeting(meetingId, (updated) => {
        if (!updated.initialRound || updated.initialRound.status !== 'collecting') throw new Error('初回意見の状態が変わりました');
        updated.initialRound.responses.push(message);
      });
    }
    let published: Message[] = [];
    await this.repo.updateMeeting(meetingId, (updated) => {
      const pending = updated.initialRound!;
      if (pending.responses.length !== pending.participantIds.length) throw new Error('初回意見がそろっていません');
      published = [...pending.responses];
      updated.transcript.push(...published);
      pending.responses = [];
      pending.status = 'published';
    });
    for (const message of published) {
      onEvent?.({ type: 'turn-end', meetingId, message });
    }
    return published;
  }

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
    if (this.active.has(meetingId)) throw new Error('この会議ではAIが発言中です');
    this.active.add(meetingId);
    try {
    const meetingSnapshot = this.repo.getMeeting(meetingId);
    if (!meetingSnapshot) throw new Error(`Meeting not found: ${meetingId}`);
    if (meetingSnapshot.status === 'CONCLUDED') {
      throw new Error('この会議はすでに終了しています。');
    }

    if (meetingSnapshot.initialRound?.status === 'collecting' ||
      (trigger.kind === 'ASK_ALL_ACTIVE' && !meetingSnapshot.transcript.some((message) => message.speakerType === 'AI') && !meetingSnapshot.initialRound)) {
      if (trigger.kind !== 'ASK_ALL_ACTIVE') throw new Error('全員の初回意見を集めてから討論してください');
      await this.markStarted(meetingId);
      return this.runInitialRound(meetingId, onEvent);
    }
    if (!meetingSnapshot.initialRound && !meetingSnapshot.transcript.some((message) => message.speakerType === 'AI') && trigger.kind !== 'ASK_ALL_ACTIVE') {
      throw new Error('全員の初回意見を集めてから討論してください');
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

      const result = await this.agent(persona, prompt, meeting.workingDirectory);
      if (result.isError) throw new Error(`${persona.name}: ${result.text}`);
      const { stance, content } = parseStance(result.text);

      const message: Message = {
        id: newId(),
        meetingId,
        speakerType: 'AI',
        speakerId: `${persona.id}#${participant.id}`,
        content,
        stance,
        createdAt: nowIso(),
        roundKind: trigger.kind === 'REBUTTAL_ROUND' ? 'rebuttal' : 'discussion',
        requestedModel: result.requestedModel,
        effectiveModel: result.effectiveModel,
      };

      await this.repo.updateMeeting(meetingId, (m) => {
        m.transcript.push(message);
      });
      produced.push(message);
      onEvent?.({ type: 'turn-end', meetingId, message });
    }

    return produced;
    } finally {
      this.active.delete(meetingId);
    }
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
    if (meeting.initialRound?.status === 'collecting') throw new Error('初回意見の収集中は発言を追加できません');

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
