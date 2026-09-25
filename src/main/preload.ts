import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipc';
import { CreateMeetingInput } from '../core/services/meetingService';
import { FinalizeDecisionInput } from '../core/services/decisionService';
import { TurnEvent } from '../core/services/discussionService';
import { CreateCommissionInput } from '../core/commission/service';
import { CreateCommunityPostInput, CommunityProgress } from '../core/community/types';
import { UpsertArtifactCardInput } from '../core/services/projectService';
import { EmailMcpConfig } from '../core/email/types';

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
    upsertArtifactCard: (projectId: string, input: UpsertArtifactCardInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsUpsertArtifactCard, projectId, input),
    toggleActionItem: (projectId: string, actionItemId: string, done: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsToggleActionItem, projectId, actionItemId, done),
  },
  commissions: {
    list: (projectId?: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsList, projectId),
    create: (input: CreateCommissionInput) => ipcRenderer.invoke(IPC_CHANNELS.commissionsCreate, input),
    fromActionItem: (projectId: string, actionItemId: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsFromActionItem, projectId, actionItemId),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsGet, id),
    consult: (id: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsConsult, id, text),
    confirm: (id: string, planText: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsConfirm, id, planText),
    pause: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsPause, id),
    stop: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsStop, id),
    resume: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsResume, id),
    revise: (id: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsRevise, id, text),
    openArtifact: (id: string, artifactId: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsOpenArtifact, id, artifactId),
    onProgress: (callback: (id: string) => void) => {
      const listener = (_e: unknown, id: string) => callback(id);
      ipcRenderer.on(IPC_CHANNELS.commissionsProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.commissionsProgress, listener);
    },
  },
  community: {
    list: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.communityList, projectId),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.communityGet, id),
    create: (input: CreateCommunityPostInput) => ipcRenderer.invoke(IPC_CHANNELS.communityCreate, input),
    suggest: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.communitySuggest, projectId),
    comment: (id: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.communityComment, id, text),
    runRound: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.communityRunRound, id),
    startCommission: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.communityStartCommission, id),
    accept: (id: string, note: string) => ipcRenderer.invoke(IPC_CHANNELS.communityAccept, id, note),
    onProgress: (callback: (event: CommunityProgress) => void) => {
      const listener = (_e: unknown, event: CommunityProgress) => callback(event);
      ipcRenderer.on(IPC_CHANNELS.communityProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.communityProgress, listener);
    },
  },
  email: {
    config: () => ipcRenderer.invoke(IPC_CHANNELS.emailConfigGet),
    configure: (config: Omit<EmailMcpConfig, 'updatedAt'>) => ipcRenderer.invoke(IPC_CHANNELS.emailConfigSave, config),
    test: () => ipcRenderer.invoke(IPC_CHANNELS.emailTest),
    list: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.emailList, projectId),
    draft: (input: { projectId: string; sourceMeetingId: string; to: string[]; subject: string; body: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.emailDraft, input),
    send: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.emailSend, id),
  },
  audit: {
    list: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.auditList, projectId),
    run: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.auditRun, projectId),
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
    gate: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.decisionGate, meetingId),
    finalize: (meetingId: string, input: FinalizeDecisionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.decisionFinalize, meetingId, input),
    updateActionItems: (meetingId: string, items: { id?: string; description: string; assignee: string }[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.decisionUpdateActionItems, meetingId, items),
  },
  minutes: {
    get: (meetingId: string) => ipcRenderer.invoke(IPC_CHANNELS.minutesGet, meetingId),
    download: (meetingId: string, markdown: string, suggestedFileName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.minutesDownload, meetingId, markdown, suggestedFileName),
  },
  system: {
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseDirectory),
  },
  /**
   * 外部アプリ（Sikun Lab IDE等）から `--pending-meeting <jsonファイル>` 付きで
   * 起動された場合、そのファイルから自動作成された会議のIDが1回だけ届く。
   */
  onPendingMeetingReady: (callback: (meetingId: string) => void) => {
    const listener = (_e: unknown, meetingId: string) => callback(meetingId);
    ipcRenderer.on(IPC_CHANNELS.pendingMeetingReady, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pendingMeetingReady, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
