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
      const p = meeting.participants.find((x) => x.id === participantId);
      if (!p) throw new Error(`Participant not found: ${participantId}`);
      p.status = 'INACTIVE';
      p.deactivatedAt = nowIso();
    });
  }

  /** 一時除籍したAIを再招集する（INACTIVE→ACTIVE）。 */
  async reactivateParticipant(meetingId: string, participantId: string): Promise<void> {
    await this.repo.updateMeeting(meetingId, (meeting) => {
      const p = meeting.participants.find((x) => x.id === participantId);
      if (!p) throw new Error(`Participant not found: ${participantId}`);
      p.status = 'ACTIVE';
      p.deactivatedAt = undefined;
    });
  }
}
