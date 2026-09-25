import { Repository, newId, nowIso } from '../store/repository';
import { Meeting, Participant } from '../types';
import { getMeetingTypeById } from '../meetingTypes';
import { getPersonaById } from '../personas';

export interface CreateMeetingInput {
  title: string;
  agenda: string;
  meetingTypeId: string;
  projectId?: string | null;
  workingDirectory?: string | null;
  /** 省略時は会議タイプの defaultPersonaIds を招集する。 */
  personaIds?: string[];
}

export class MeetingService {
  constructor(private repo: Repository) {}

  listMeetings(): Meeting[] {
    return this.repo.listMeetings();
  }

  getMeeting(id: string): Meeting {
    const meeting = this.repo.getMeeting(id);
    if (!meeting) throw new Error(`Meeting not found: ${id}`);
    return meeting;
  }

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const meetingType = getMeetingTypeById(input.meetingTypeId);
    if (!meetingType) throw new Error(`Unknown meetingTypeId: ${input.meetingTypeId}`);

    const personaIds = input.personaIds && input.personaIds.length > 0 ? input.personaIds : meetingType.defaultPersonaIds;
    const invalid = personaIds.find((id) => !getPersonaById(id));
    if (invalid) throw new Error(`Unknown personaId: ${invalid}`);

    const now = nowIso();
    const participants: Participant[] = personaIds.map((personaId) => ({
      id: newId(),
      personaId,
      status: 'ACTIVE',
      invitedAt: now,
    }));

    const project = input.projectId ? this.repo.getProject(input.projectId) : undefined;
    if (input.projectId && !project) throw new Error('プロジェクトが見つかりません');
    const artifactCardSnapshot = (project?.artifactCards || []).map((card) => {
      const latest = card.versions.at(-1)!;
      const goals = latest.goals.map((goal) =>
        `${goal.label}: ${goal.current ?? '未測定'} / ${goal.target}${goal.unit}（根拠: ${goal.evidence || '未記録'}）`).join('; ');
      return {
        cardId: card.id, version: latest.version,
        summary: `${card.name}｜現状: ${latest.status}｜${latest.summary.slice(0, 600)}｜既知の問題: ${latest.knownIssues.join('、').slice(0, 500) || 'なし'}｜改善: ${latest.backlog.join('、').slice(0, 500) || 'なし'}｜KGI: ${goals.slice(0, 500) || '未設定'}｜過去の決定: ${latest.decisionIds.slice(-5).join('、') || 'なし'}`,
      };
    });

    const meeting: Meeting = {
      id: newId(),
      projectId: input.projectId ?? null,
      meetingTypeId: input.meetingTypeId,
      title: input.title,
      agenda: input.agenda,
      status: 'CREATED',
      participants,
      transcript: [],
      decision: null,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      workingDirectory: input.workingDirectory ?? null,
      artifactCardSnapshot,
    };

    await this.repo.saveMeeting(meeting);

    if (meeting.projectId) {
      await this.repo.updateProject(meeting.projectId, (project) => {
        if (!project.meetingIds.includes(meeting.id)) {
          project.meetingIds.push(meeting.id);
        }
      });
    }

    return meeting;
  }

  /** 会議に新しいAIを招集する。既存参加者(同一persona)がINACTIVEなら再招集扱いにする。 */
  async inviteParticipant(meetingId: string, personaId: string): Promise<Participant> {
    if (!getPersonaById(personaId)) throw new Error(`Unknown personaId: ${personaId}`);

    let result: Participant | undefined;
    await this.repo.updateMeeting(meetingId, (meeting) => {
      if (meeting.initialRound?.status === 'collecting') throw new Error('初回意見の収集中は参加者を変更できません');
      const existing = meeting.participants.find((p) => p.personaId === personaId);
      if (existing) {
        existing.status = 'ACTIVE';
        existing.deactivatedAt = undefined;
        result = existing;
        return;
      }
      const participant: Participant = {
        id: newId(),
        personaId,
        status: 'ACTIVE',
        invitedAt: nowIso(),
      };
      meeting.participants.push(participant);
      result = participant;
    });
    return result!;
  }

  /** AIを一時除籍する（ACTIVE→INACTIVE）。削除はしない。 */
  async deactivateParticipant(meetingId: string, participantId: string): Promise<void> {
    await this.repo.updateMeeting(meetingId, (meeting) => {
      if (meeting.initialRound?.status === 'collecting') throw new Error('初回意見の収集中は参加者を変更できません');
      const p = meeting.participants.find((x) => x.id === participantId);
      if (!p) throw new Error(`Participant not found: ${participantId}`);
      p.status = 'INACTIVE';
      p.deactivatedAt = nowIso();
    });
  }

  /** 一時除籍したAIを再招集する（INACTIVE→ACTIVE）。 */
  async reactivateParticipant(meetingId: string, participantId: string): Promise<void> {
    await this.repo.updateMeeting(meetingId, (meeting) => {
      if (meeting.initialRound?.status === 'collecting') throw new Error('初回意見の収集中は参加者を変更できません');
      const p = meeting.participants.find((x) => x.id === participantId);
      if (!p) throw new Error(`Participant not found: ${participantId}`);
      p.status = 'ACTIVE';
      p.deactivatedAt = undefined;
    });
  }

  /**
   * AIがコードを読んで発言する対象ディレクトリを、会議開始後でも設定・変更できるようにする。
   * ここで設定した値は、以後のAI発言（claudeAgent.ts の cwd）にそのまま使われる。
   */
  async setWorkingDirectory(meetingId: string, workingDirectory: string | null): Promise<Meeting> {
    return this.repo.updateMeeting(meetingId, (meeting) => {
      meeting.workingDirectory = workingDirectory;
    });
  }
}
