import { contextBridge, ipcRenderer } from 'electron';
import type { CreateMeetingInput } from '../core/services/meetingService';
import type { FinalizeDecisionInput } from '../core/services/decisionService';
import type { TurnEvent } from '../core/services/discussionService';
import type { CreateCommissionInput } from '../core/commission/service';
import type { CreateCommunityPostInput, CommunityProgress } from '../core/community/types';
import type { UpsertArtifactCardInput } from '../core/services/projectService';
import type { EmailMcpConfig } from '../core/email/types';

// sandbox:true のpreloadは相対パスのrequireができないため、ipc.ts と同じチャンネル名をここにも持つ（一致はテストで確認）。
const IPC_CHANNELS = {
  personasList: 'personas:list',
  personasSkills: 'personas:skills',
  personasSkillMetrics: 'personas:skillMetrics',
  homeRequested: 'navigation:home',
  meetingTypesList: 'meetingTypes:list',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsGet: 'projects:get',
  projectsToggleActionItem: 'projects:toggleActionItem',
  projectsUpsertArtifactCard: 'projects:upsertArtifactCard',
  meetingsList: 'meetings:list',
  meetingsGet: 'meetings:get',
  meetingsCreate: 'meetings:create',
  meetingsInvite: 'meetings:inviteParticipant',
  meetingsDeactivate: 'meetings:deactivateParticipant',
  meetingsReactivate: 'meetings:reactivateParticipant',
  meetingsSetWorkingDirectory: 'meetings:setWorkingDirectory',
  discussionAskAll: 'discussion:askAll',
  discussionAskSpecific: 'discussion:askSpecific',
  discussionRebuttal: 'discussion:rebuttal',
  discussionHumanSpeak: 'discussion:humanSpeak',
  discussionProgress: 'discussion:progress',
  decisionFinalize: 'decision:finalize',
  decisionGate: 'decision:gate',
  decisionUpdateActionItems: 'decision:updateActionItems',
  minutesGet: 'minutes:get',
  minutesDownload: 'minutes:download',
  chooseDirectory: 'system:chooseDirectory',
  chooseFiles: 'system:chooseFiles',
  preferencesGet: 'system:preferencesGet',
  preferencesSave: 'system:preferencesSave',
  meetingsStartAuto: 'meetings:startAuto',
  meetingsPauseAuto: 'meetings:pauseAuto',
  meetingsAutoProgress: 'meetings:autoProgress',
  pendingMeetingReady: 'pending-meeting:ready',
  commissionsList: 'commissions:list',
  commissionsCreate: 'commissions:create',
  commissionsFromActionItem: 'commissions:fromActionItem',
  commissionsGet: 'commissions:get',
  commissionsConsult: 'commissions:consult',
  commissionsConfirm: 'commissions:confirm',
  commissionsPause: 'commissions:pause',
  commissionsStop: 'commissions:stop',
  commissionsResume: 'commissions:resume',
  commissionsRevise: 'commissions:revise',
  commissionsProgress: 'commissions:progress',
  commissionsOpenArtifact: 'commissions:openArtifact',
  commissionsPreviewArtifact: 'commissions:previewArtifact',
  commissionsAddInstruction: 'commissions:addInstruction',
  communityList: 'community:list',
  communityGet: 'community:get',
  communityCreate: 'community:create',
  communitySuggest: 'community:suggest',
  communityComment: 'community:comment',
  communityRunRound: 'community:runRound',
  communityStartCommission: 'community:startCommission',
  communityAccept: 'community:accept',
  communityProgress: 'community:progress',
  emailConfigGet: 'email:configGet',
  emailConfigSave: 'email:configSave',
  emailTest: 'email:test',
  emailList: 'email:list',
  emailDraft: 'email:draft',
  emailSend: 'email:send',
  auditList: 'audit:list',
  auditRun: 'audit:run',
  mobileGet: 'mobile:get',
  mobileConfigure: 'mobile:configure',
  mobileSyncNow: 'mobile:syncNow',
  mobileRotateKey: 'mobile:rotateKey',
} as const;

/**
 * レンダラーに公開するAPI（window.api）。
 * contextIsolation下で、レンダラーはNode/Electron APIに直接触れず、
 * ここで定義した関数だけを呼べる。
 */
const api = {
  onHomeRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC_CHANNELS.homeRequested, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.homeRequested, listener);
  },
  personas: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.personasList),
    skills: () => ipcRenderer.invoke(IPC_CHANNELS.personasSkills),
    skillMetrics: () => ipcRenderer.invoke(IPC_CHANNELS.personasSkillMetrics),
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
    previewArtifact: (id: string, artifactId: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsPreviewArtifact, id, artifactId),
    addInstruction: (id: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.commissionsAddInstruction, id, text),
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
  mobile: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.mobileGet),
    configure: (input: { baseUrl: string; enabled: boolean; token?: string }) => ipcRenderer.invoke(IPC_CHANNELS.mobileConfigure, input),
    syncNow: () => ipcRenderer.invoke(IPC_CHANNELS.mobileSyncNow),
    rotateKey: () => ipcRenderer.invoke(IPC_CHANNELS.mobileRotateKey),
  },
  meetings: {
    startAuto: (id:string) => ipcRenderer.invoke(IPC_CHANNELS.meetingsStartAuto,id),
    pauseAuto: (id:string) => ipcRenderer.invoke(IPC_CHANNELS.meetingsPauseAuto,id),
    onAutoProgress: (callback:(id:string)=>void) => { const listener=(_e:unknown,id:string)=>callback(id);ipcRenderer.on(IPC_CHANNELS.meetingsAutoProgress,listener);return ()=>ipcRenderer.removeListener(IPC_CHANNELS.meetingsAutoProgress,listener); },
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
    getPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.preferencesGet),
    savePreferences: (value:unknown) => ipcRenderer.invoke(IPC_CHANNELS.preferencesSave,value),
    chooseFiles: (retainedIds: string[] = []) => ipcRenderer.invoke(IPC_CHANNELS.chooseFiles, retainedIds),
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
