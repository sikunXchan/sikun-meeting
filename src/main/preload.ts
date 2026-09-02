import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc';
import { CreateMeetingInput } from '../core/services/meetingService';
import { FinalizeDecisionInput } from '../core/services/decisionService';
import { TurnEvent } from '../core/services/discussionService';

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
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.projectsGet, id),
    toggleActionItem: (projectId: string, actionItemId: string, done: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsToggleActionItem, projectId, actionItemId, done),
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
    setWorkingDirectory: (meetingId: string, dir: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.meetingsSetWorkingDirectory, meetingId, dir),
  },
  discussion: {
    askAll: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.discussionAskAll, meetingId),
    askSpecific: (meetingId: string, participantId: string, question: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.discussionAskSpecific, meetingId, participantId, question),
    rebuttal: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.discussionRebuttal, meetingId),
    humanSpeak: (meetingId: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.discussionHumanSpeak, meetingId, content),
    /** ターン開始/終了イベントを購読する。呼び出すと購読解除関数を返す。 */
    onProgress: (callback: (event: TurnEvent) => void) => {
      const listener = (_e: unknown, event: TurnEvent) => callback(event);
      ipcRenderer.on(IPC_CHANNELS.discussionProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.discussionProgress, listener);
    },
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
