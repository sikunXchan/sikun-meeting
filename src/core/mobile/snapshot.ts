import { Meeting, Project, Stance } from '../types';
import { getPersonaById } from '../personas';
import { getMeetingTypeById } from '../meetingTypes';

export interface MobileParticipant {
  id: string;
  personaId: string;
  name: string;
  emoji: string;
  roleTitle: string;
  avatar: string;
  active: boolean;
}

export interface MobileMessage {
  id: string;
  speaker: 'human' | 'ai' | 'system';
  participantId?: string;
  content: string;
  stance: Stance;
  createdAt: string;
  round?: string;
}

export interface MobileMeeting {
  id: string;
  projectId: string | null;
  title: string;
  agenda: string;
  typeName: string;
  typeEmoji: string;
  status: Meeting['status'];
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  participants: MobileParticipant[];
  messages: MobileMessage[];
  decision: null | {
    text: string;
    reasoning: string[];
    stances: { participantId: string; stance: Stance; note?: string }[];
    actionItems: { description: string; assignee: string; done: boolean }[];
    decidedAt: string;
    overrideReason?: string;
  };
}

export interface MobileSnapshot {
  v: 1;
  generatedAt: string;
  omittedMeetings: number;
  projects: { id: string; name: string }[];
  meetings: MobileMeeting[];
}

/** スマホで読むための形に変換する。作業ディレクトリ・モデル名・未公開の初回意見は含めない。 */
export function toMobileMeeting(meeting: Meeting, project?: Project): MobileMeeting {
  const type = getMeetingTypeById(meeting.meetingTypeId);
  const doneById = new Map((project?.actionItems ?? []).filter((item) => item.meetingId === meeting.id).map((item) => [item.id, item.done]));
  return {
    id: meeting.id,
    projectId: meeting.projectId,
    title: meeting.title,
    agenda: meeting.agenda,
    typeName: type?.name ?? meeting.meetingTypeId,
    typeEmoji: type?.emoji ?? '',
    status: meeting.status,
    createdAt: meeting.createdAt,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    participants: meeting.participants.map((participant) => {
      const persona = getPersonaById(participant.personaId);
      return {
        id: participant.id,
        personaId: participant.personaId,
        name: persona?.name ?? participant.personaId,
        emoji: persona?.emoji ?? '',
        roleTitle: persona?.roleTitle ?? '',
        avatar: persona?.avatar ?? 'default.png',
        active: participant.status === 'ACTIVE',
      };
    }),
    messages: meeting.transcript.map((message) => ({
      id: message.id,
      speaker: message.speakerType === 'HUMAN' ? 'human' : message.speakerType === 'SYSTEM' ? 'system' : 'ai',
      participantId: message.speakerType === 'AI' ? message.speakerId.split('#')[1] : undefined,
      content: message.content,
      stance: message.stance,
      createdAt: message.createdAt,
      round: message.roundKind,
    })),
    decision: meeting.decision ? {
      text: meeting.decision.decisionText,
      reasoning: meeting.decision.reasoning,
      stances: meeting.decision.disagreements.map((entry) => ({ participantId: entry.participantId, stance: entry.stance, note: entry.note })),
      actionItems: meeting.decision.actionItems.map((item) => ({
        description: item.description, assignee: item.assignee, done: doneById.get(item.id) ?? item.done,
      })),
      decidedAt: meeting.decision.decidedAt,
      overrideReason: meeting.decision.overrideReason,
    } : null,
  };
}

export function buildSnapshot(meetings: Meeting[], projects: Project[], generatedAt = new Date().toISOString()): MobileSnapshot {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const sorted = [...meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    v: 1,
    generatedAt,
    omittedMeetings: 0,
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
    meetings: sorted.map((meeting) => toMobileMeeting(meeting, meeting.projectId ? projectById.get(meeting.projectId) : undefined)),
  };
}
