import { Meeting, Participant } from '../types';
import { getMeetingTypeById } from '../meetingTypes';
import { activeParticipantsInRosterOrder, DiscussionTrigger, MeetingProtocol } from './protocol';

/** 構造化ラウンド: 招集順に1人ずつ、直前の発言を踏まえて発言する。反論ラウンドを許可。 */
class StructuredRoundsProtocol implements MeetingProtocol {
  id = 'structuredRounds';

  planTurns(meeting: Meeting, trigger: DiscussionTrigger): Participant[] {
    if (trigger.kind === 'ASK_SPECIFIC') {
      const p = meeting.participants.find((x) => x.id === trigger.participantId && x.status === 'ACTIVE');
      return p ? [p] : [];
    }
    // ASK_ALL_ACTIVE / REBUTTAL_ROUND ともに、現在ACTIVEな参加者を招集順に1巡させる。
    // REBUTTAL_ROUND では AgentRuntime 側のプロンプトが「反論があれば」という条件を付与する。
    return activeParticipantsInRosterOrder(meeting);
  }
}

/** ラウンドロビン: 構造化ラウンドと同様だが反論ラウンドは行わない前提の会議タイプ用。 */
class RoundRobinProtocol implements MeetingProtocol {
  id = 'roundRobin';

  planTurns(meeting: Meeting, trigger: DiscussionTrigger): Participant[] {
    if (trigger.kind === 'ASK_SPECIFIC') {
      const p = meeting.participants.find((x) => x.id === trigger.participantId && x.status === 'ACTIVE');
      return p ? [p] : [];
    }
    return activeParticipantsInRosterOrder(meeting);
  }
}

/** 自由発言: 発散目的のため、発言順を招集順のまま維持しつつ短い一巡のみ行う。 */
class FreeFormProtocol implements MeetingProtocol {
  id = 'freeForm';

  planTurns(meeting: Meeting, trigger: DiscussionTrigger): Participant[] {
    if (trigger.kind === 'ASK_SPECIFIC') {
      const p = meeting.participants.find((x) => x.id === trigger.participantId && x.status === 'ACTIVE');
      return p ? [p] : [];
    }
    if (trigger.kind === 'REBUTTAL_ROUND') {
      // Brainstormingは反論ラウンドを持たない設計（meetingTypes.ts で allowRebuttal:false）。
      return [];
    }
    return activeParticipantsInRosterOrder(meeting);
  }
}

const PROTOCOLS: Record<string, MeetingProtocol> = {
  structuredRounds: new StructuredRoundsProtocol(),
  roundRobin: new RoundRobinProtocol(),
  freeForm: new FreeFormProtocol(),
};

export function resolveProtocol(meeting: Meeting): MeetingProtocol {
  const meetingType = getMeetingTypeById(meeting.meetingTypeId);
  const strategy = meetingType?.protocol.turnStrategy ?? 'roundRobin';
  return PROTOCOLS[strategy];
}
