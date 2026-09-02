import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc';
import { CreateMeetingInput } from '../core/services/meetingService';
import { FinalizeDecisionInput } from '../core/services/decisionService';

/**
 * レンダラーに公開するAPI（window.api）。
 * contextIsolation下で、レンダラーはNode/Electron APIに直接触れず、
 * ここで定義した関数だけを呼べる。
 */
const api = {
  personas: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.personasList),
  },
  meetingTypes: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.meetingTypesList),
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    create: (name: string, description: string) => ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, name, description),
  },
  meetings: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.meetingsList),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.meetingsGet, id),
    create: (input: CreateMeetingInput) => ipcRenderer.invoke(IPC_CHANNELS.meetingsCreate, input),
    inviteParticipant: (meetingId: string, personaId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.meetingsInvite, meetingId, personaId),
    deactivateParticipant: (meetingId: string, participantId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.meetingsDeactivate, meetingId, participantId),
    reactivateParticipant: (meetingId: string, participantId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.meetingsReactivate, meetingId, participantId),
  },
  discussion: {
    askAll: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.discussionAskAll, meetingId),
    askSpecific: (meetingId: string, participantId: string, question: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.discussionAskSpecific, meetingId, participantId, question),
    rebuttal: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.discussionRebuttal, meetingId),
    humanSpeak: (meetingId: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.discussionHumanSpeak, meetingId, content),
  },
  decision: {
    finalize: (meetingId: string, input: FinalizeDecisionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.decisionFinalize, meetingId, input),
  },
  minutes: {
    get: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.minutesGet, meetingId),
  },
  system: {
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseDirectory),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
