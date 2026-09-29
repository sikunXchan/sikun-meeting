import { ReferenceSelections } from './referenceSelections';
import { WorkspaceSettingsStore } from './workspaceSettings';
import { MeetingAutomationService } from '../core/services/meetingAutomationService';
import { app, ipcMain, dialog, BrowserWindow, shell, IpcMainInvokeEvent } from 'electron';
import { assertTrustedSender } from './security';
import * as QRCode from 'qrcode';
import { MobileSyncService } from '../core/mobile/service';
import * as fs from 'fs';
import { skillDetailsFor } from '../core/skills/catalog';
import { skillMetricsFor } from '../core/skills/metrics';
import { AppContext, PERSONAS, MEETING_TYPES } from '../core';
import { CreateMeetingInput } from '../core/services/meetingService';
import { FinalizeDecisionInput } from '../core/services/decisionService';
import { TurnEvent } from '../core/services/discussionService';
import { CreateCommissionInput } from '../core/commission/service';
import { CreateCommunityPostInput, CommunityProgress } from '../core/community/types';
import { UpsertArtifactCardInput } from '../core/services/projectService';
import { readArtifactPreview, resolveArtifactPath } from './artifactPreview';
import { EmailMcpConfig } from '../core/email/types';

/** IPCチャンネル名を1箇所に集約（preload.ts と対で管理する）。 */
export const IPC_CHANNELS = {
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

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null, mobile?: MobileSyncService): void {
  const references = new ReferenceSelections();
  const selectionEpochs = new Map<number, object>();
  const choosing = new Set<number>();
  const meetingEdits = new Set<string>([
    IPC_CHANNELS.discussionAskAll, IPC_CHANNELS.discussionAskSpecific,
    IPC_CHANNELS.discussionRebuttal, IPC_CHANNELS.discussionHumanSpeak,
    IPC_CHANNELS.meetingsInvite, IPC_CHANNELS.meetingsDeactivate,
    IPC_CHANNELS.meetingsReactivate, IPC_CHANNELS.meetingsSetWorkingDirectory,
    IPC_CHANNELS.decisionFinalize,
  ]);
  const handle = (channel: string, handler: Handler): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event);
      if (meetingEdits.has(channel) && automatic.isBusy(args[0])) {
        throw new Error('自動進行を一時停止してから操作してください');
      }
      return handler(event, ...args);
    });
  };
  const preferences=new WorkspaceSettingsStore(app.getPath('userData'));
  const automatic=new MeetingAutomationService(ctx.repo,ctx.discussionService,(id)=>getWindow()?.webContents.send(IPC_CHANNELS.meetingsAutoProgress,id),(event)=>getWindow()?.webContents.send(IPC_CHANNELS.discussionProgress,event));
  handle(IPC_CHANNELS.preferencesGet,()=>preferences.get());
  handle(IPC_CHANNELS.preferencesSave,(_e,value)=>preferences.set(value));
  handle(IPC_CHANNELS.chooseFiles, async (event, retainedIds: unknown = []) => {
    const sender = event.sender, owner = sender.id, win = getWindow();
    if (!win || win.webContents.id !== owner) throw new Error('参考資料を選択できません');
    if (choosing.has(owner)) throw new Error('資料選択ダイアログは開いています');
    if (!selectionEpochs.has(owner)) {
      selectionEpochs.set(owner, {});
      sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) { references.clear(owner); selectionEpochs.set(owner, {}); }
      });
      sender.once('destroyed', () => { references.clear(owner); selectionEpochs.delete(owner); });
    }
    const epoch = selectionEpochs.get(owner);
    const retained = references.select(owner, [], retainedIds);
    choosing.add(owner);
    try {
      const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: '参考資料を選択' });
      if (sender.isDestroyed() || selectionEpochs.get(owner) !== epoch) throw new Error('参考資料を選び直してください');
      return result.canceled ? retained : references.select(owner, result.filePaths, retainedIds);
    } finally { choosing.delete(owner); }
  });
  handle(IPC_CHANNELS.meetingsStartAuto,(_e,id:string)=>automatic.start(id));
  handle(IPC_CHANNELS.meetingsPauseAuto,(_e,id:string)=>automatic.pause(id));
  handle(IPC_CHANNELS.personasList, () => PERSONAS);
  handle(IPC_CHANNELS.personasSkills, () => PERSONAS.map(({ id, name, roleTitle, expertise, avatar }) =>
    ({ id, name, roleTitle, expertise, avatar, skills: skillDetailsFor(id) })));
  handle(IPC_CHANNELS.personasSkillMetrics, () => skillMetricsFor(ctx.commissionService.list()));
  handle(IPC_CHANNELS.meetingTypesList, () => MEETING_TYPES);

  handle(IPC_CHANNELS.projectsList, () => ctx.projectService.listProjects());
  handle(IPC_CHANNELS.projectsCreate, (_e, name: string, description: string) =>
    ctx.projectService.createProject(name, description),
  );
  handle(IPC_CHANNELS.projectsGet, (_e, id: string) => ctx.projectService.getProject(id));
  handle(IPC_CHANNELS.projectsUpsertArtifactCard, (_e, projectId: string, input: UpsertArtifactCardInput) =>
    ctx.projectService.upsertArtifactCard(projectId, input));
  handle(IPC_CHANNELS.commissionsList, (_e, projectId?: string) => ctx.commissionService.list(projectId));
  handle(IPC_CHANNELS.commissionsCreate, (event, input: CreateCommissionInput) => {
    if (!input || typeof input !== 'object' || 'referenceFiles' in input) throw new Error('参考資料は選択ダイアログから指定してください');
    const { referenceIds = [], ...details } = input;
    return references.consume(event.sender.id, referenceIds, files => ctx.commissionService.create(details, files));
  });
  handle(IPC_CHANNELS.commissionsFromActionItem, (_e, projectId: string, actionItemId: string) => ctx.commissionService.fromActionItem(projectId, actionItemId));
  handle(IPC_CHANNELS.commissionsGet, (_e, id: string) => ctx.commissionService.get(id));
  handle(IPC_CHANNELS.commissionsConsult, (_e, id: string, text: string) => ctx.commissionService.consult(id, text));
  handle(IPC_CHANNELS.commissionsConfirm, (_e, id: string, planText: string) => ctx.commissionService.confirmPlan(id, planText));
  handle(IPC_CHANNELS.commissionsPause, (_e, id: string) => ctx.commissionService.pause(id));
  handle(IPC_CHANNELS.commissionsStop, (_e, id: string) => ctx.commissionService.stop(id));
  handle(IPC_CHANNELS.commissionsResume, (_e, id: string) => ctx.commissionService.resume(id));
  handle(IPC_CHANNELS.commissionsRevise, (_e, id: string, text: string) => ctx.commissionService.requestRevision(id, text));
  handle(IPC_CHANNELS.commissionsPreviewArtifact, (_e, id: string, artifactId: string) => readArtifactPreview(ctx.commissionService.get(id).commission, artifactId));
  handle(IPC_CHANNELS.commissionsAddInstruction, (_e, id: string, text: string) => ctx.commissionService.addInstruction(id, text));
  handle(IPC_CHANNELS.commissionsOpenArtifact, async (_e, id: string, artifactId: string) => {
    const commission = ctx.commissionService.get(id).commission;
    const artifact = commission.artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) throw new Error('成果ファイルが見つかりません');
    const target = await resolveArtifactPath(commission, artifactId);
    shell.showItemInFolder(target);
  });
  ctx.commissionService.subscribe((id) => getWindow()?.webContents.send(IPC_CHANNELS.commissionsProgress, id));
  handle(IPC_CHANNELS.communityList, (_e, projectId: string) => ctx.communityService.list(projectId));
  handle(IPC_CHANNELS.communityGet, (_e, id: string) => ctx.communityService.get(id));
  handle(IPC_CHANNELS.communityCreate, (_e, input: CreateCommunityPostInput) => ctx.communityService.create(input));
  handle(IPC_CHANNELS.communitySuggest, (_e, projectId: string) => ctx.communityService.suggest(projectId));
  handle(IPC_CHANNELS.communityComment, (_e, id: string, text: string) => ctx.communityService.comment(id, text));
  handle(IPC_CHANNELS.communityRunRound, (_e, id: string) =>
    ctx.communityService.runRound(id, (event: CommunityProgress) =>
      getWindow()?.webContents.send(IPC_CHANNELS.communityProgress, event),
    ),
  );
  handle(IPC_CHANNELS.communityStartCommission, (_e, id: string) => ctx.communityService.startCommission(id));
  handle(IPC_CHANNELS.communityAccept, (_e, id: string, note: string) => ctx.communityService.accept(id, note));
  handle(IPC_CHANNELS.emailConfigGet, () => ctx.emailService.config());
  handle(IPC_CHANNELS.emailConfigSave, (_e, config: Omit<EmailMcpConfig, 'updatedAt'>) => ctx.emailService.configure(config));
  handle(IPC_CHANNELS.emailTest, () => ctx.emailService.testConnection());
  handle(IPC_CHANNELS.emailList, (_e, projectId: string) => ctx.emailService.list(projectId));
  handle(IPC_CHANNELS.emailDraft, (_e, input: { projectId: string; sourceMeetingId: string; to: string[]; subject: string; body: string }) =>
    ctx.emailService.createDraft(input));
  handle(IPC_CHANNELS.emailSend, (_e, id: string) => ctx.emailService.sendDraft(id));
  handle(IPC_CHANNELS.auditList, (_e, projectId: string) => ctx.auditService.list(projectId));
  handle(IPC_CHANNELS.auditRun, (_e, projectId: string) => ctx.auditService.run(projectId));
  const mobileView = async () => {
    if (!mobile) throw new Error('スマホ同期を利用できません');
    const view = mobile.view();
    const qr = view.pairingUrl ? await QRCode.toDataURL(view.pairingUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 }) : null;
    return { ...view, qr };
  };
  handle(IPC_CHANNELS.mobileGet, () => mobileView());
  handle(IPC_CHANNELS.mobileConfigure, async (_e, input: { baseUrl: string; enabled: boolean; token?: string }) => {
    await mobile?.configure({ baseUrl: String(input?.baseUrl ?? ''), enabled: input?.enabled === true, token: typeof input?.token === 'string' ? input.token : undefined });
    return mobileView();
  });
  handle(IPC_CHANNELS.mobileSyncNow, async () => { await mobile?.syncNow({ force: true }); return mobileView(); });
  handle(IPC_CHANNELS.mobileRotateKey, async () => { await mobile?.rotateKey(); return mobileView(); });
  handle(
    IPC_CHANNELS.projectsToggleActionItem,
    (_e, projectId: string, actionItemId: string, done: boolean) =>
      ctx.projectService.setActionItemDone(projectId, actionItemId, done),
  );

  handle(IPC_CHANNELS.meetingsList, () => ctx.meetingService.listMeetings());
  handle(IPC_CHANNELS.meetingsGet, (_e, id: string) => ctx.meetingService.getMeeting(id));
  handle(IPC_CHANNELS.meetingsCreate, (_e, input: CreateMeetingInput) =>
    ctx.meetingService.createMeeting(input),
  );
  handle(IPC_CHANNELS.meetingsInvite, (_e, meetingId: string, personaId: string) =>
    ctx.meetingService.inviteParticipant(meetingId, personaId),
  );
  handle(IPC_CHANNELS.meetingsDeactivate, (_e, meetingId: string, participantId: string) =>
    ctx.meetingService.deactivateParticipant(meetingId, participantId),
  );
  handle(IPC_CHANNELS.meetingsReactivate, (_e, meetingId: string, participantId: string) =>
    ctx.meetingService.reactivateParticipant(meetingId, participantId),
  );
  handle(IPC_CHANNELS.meetingsSetWorkingDirectory, (_e, meetingId: string, dir: string | null) =>
    ctx.meetingService.setWorkingDirectory(meetingId, dir),
  );

  // 議論中の各AIのターン開始/終了を、完了を待たずレンダラーへ逐次pushする。
  // これにより円陣の座席を「発言中」としてリアルタイムにハイライトできる。
  const emitProgress = (event: TurnEvent): void => {
    getWindow()?.webContents.send(IPC_CHANNELS.discussionProgress, event);
  };

  handle(IPC_CHANNELS.discussionAskAll, (_e, meetingId: string) =>
    ctx.discussionService.askAllActiveToSpeak(meetingId, emitProgress),
  );
  handle(IPC_CHANNELS.discussionAskSpecific, (_e, meetingId: string, participantId: string, question: string) =>
    ctx.discussionService.askSpecific(meetingId, participantId, question, emitProgress),
  );
  handle(IPC_CHANNELS.discussionRebuttal, (_e, meetingId: string) =>
    ctx.discussionService.requestRebuttalRound(meetingId, emitProgress),
  );
  handle(IPC_CHANNELS.discussionHumanSpeak, (_e, meetingId: string, content: string) =>
    ctx.discussionService.humanSpeak(meetingId, content),
  );

  handle(IPC_CHANNELS.decisionFinalize, (_e, meetingId: string, input: FinalizeDecisionInput) =>
    ctx.decisionService.finalizeDecision(meetingId, input),
  );
  handle(IPC_CHANNELS.decisionGate, (_e, meetingId: string) => ctx.decisionService.getGate(meetingId));
  handle(
    IPC_CHANNELS.decisionUpdateActionItems,
    (_e, meetingId: string, items: { id?: string; description: string; assignee: string }[]) =>
      ctx.decisionService.updateActionItems(meetingId, items),
  );

  handle(IPC_CHANNELS.minutesGet, (_e, meetingId: string) => ctx.minutesService.getMinutes(meetingId));

  handle(
    IPC_CHANNELS.minutesDownload,
    async (_e, _meetingId: string, markdown: string, suggestedFileName: string) => {
      const win = getWindow();
      if (!win) return { saved: false };
      const result = await dialog.showSaveDialog(win, {
        defaultPath: suggestedFileName,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await fs.promises.writeFile(result.filePath, markdown, 'utf-8');
      return { saved: true, filePath: result.filePath };
    },
  );

  handle(IPC_CHANNELS.chooseDirectory, async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
