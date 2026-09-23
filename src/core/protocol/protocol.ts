import { Meeting, Participant } from '../types';

export type DiscussionTrigger =
  | { kind: 'ASK_ALL_ACTIVE' }
  | { kind: 'ASK_SPECIFIC'; participantId: string }
  | { kind: 'REBUTTAL_ROUND' };

/**
 * 会議タイプごとの進行ルール。
 * 「次にどのAI参加者を、どの順番で発言させるか」を決める。
 * 実際の発言生成(AgentRuntime呼び出し)は DiscussionService が
 * この順序に従って1体ずつ逐次実行し、直前の発言をコンテキストに含める
 * ことで、AI同士が互いの発言を踏まえた議論になるようにする。
 */
export interface MeetingProtocol {
  id: string;
  /** このトリガーで発言させる参加者を、発言させたい順に返す。 */
  planTurns(meeting: Meeting, trigger: DiscussionTrigger): Participant[];
}

export function activeParticipantsInRosterOrder(meeting: Meeting): Participant[] {
  return meeting.participants.filter((p) => p.status === 'ACTIVE');
}
