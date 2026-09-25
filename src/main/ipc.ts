import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppContext, PERSONAS, MEETING_TYPES } from '../core';
import { CreateMeetingInput } from '../core/services/meetingService';
import { FinalizeDecisionInput } from '../core/services/decisionService';
import { TurnEvent } from '../core/services/discussionService';
import { CreateCommissionInput } from '../core/commission/service';
import { CreateCommunityPostInput, CommunityProgress } from '../core/community/types';
import { UpsertArtifactCardInput } from '../core/services/projectService';
import { EmailMcpConfig } from '../core/email/types';

/** IPCチャンネル名を1箇所に集約（preload.ts と対で管理する）。 */
export const IPC_CHANNELS = {
  personasList: 'personas:list',
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
} as const;

export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.personasList, () => PERSONAS);
  ipcMain.handle(IPC_CHANNELS.meetingTypesList, () => MEETING_TYPES);

  ipcMain.handle(IPC_CHANNELS.projectsList, () => ctx.projectService.listProjects());
  ipcMain.handle(IPC_CHANNELS.projectsCreate, (_e, name: string, description: string) =>
    ctx.projectService.createProject(name, description),
  );
  ipcMain.handle(IPC_CHANNELS.projectsGet, (_e, id: string) => ctx.projectService.getProject(id));
  ipcMain.handle(IPC_CHANNELS.projectsUpsertArtifactCard, (_e, projectId: string, input: UpsertArtifactCardInput) =>
    ctx.projectService.upsertArtifactCard(projectId, input));
  ipcMain.handle(IPC_CHANNELS.commissionsList, (_e, projectId?: string) => ctx.commissionService.list(projectId));
  ipcMain.handle(IPC_CHANNELS.commissionsCreate, (_e, input: CreateCommissionInput) => ctx.commissionService.create(input));
  ipcMain.handle(IPC_CHANNELS.commissionsFromActionItem, (_e, projectId: string, actionItemId: string) => ctx.commissionService.fromActionItem(projectId, actionItemId));
  ipcMain.handle(IPC_CHANNELS.commissionsGet, (_e, id: string) => ctx.commissionService.get(id));
  ipcMain.handle(IPC_CHANNELS.commissionsConsult, (_e, id: string, text: string) => ctx.commissionService.consult(id, text));
  ipcMain.handle(IPC_CHANNELS.commissionsConfirm, (_e, id: string, planText: string) => ctx.commissionService.confirmPlan(id, planText));
  ipcMain.handle(IPC_CHANNELS.commissionsPause, (_e, id: string) => ctx.commissionService.pause(id));
  ipcMain.handle(IPC_CHANNELS.commissionsStop, (_e, id: string) => ctx.commissionService.stop(id));
  ipcMain.handle(IPC_CHANNELS.commissionsResume, (_e, id: string) => ctx.commissionService.resume(id));
  ipcMain.handle(IPC_CHANNELS.commissionsRevise, (_e, id: string, text: string) => ctx.commissionService.requestRevision(id, text));
  ipcMain.handle(IPC_CHANNELS.commissionsOpenArtifact, (_e, id: string, artifactId: string) => {
    const commission = ctx.commissionService.get(id).commission;
    const artifact = commission.artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) throw new Error('成果ファイルが見つかりません');
    const root = path.resolve(commission.workingDirectory);
    const target = path.resolve(root, artifact.relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('成果ファイルの場所が不正です');
    if (!fs.existsSync(target)) throw new Error('成果ファイルが削除されています');
    shell.showItemInFolder(target);
  });
  ctx.commissionService.subscribe((id) => getWindow()?.webContents.send(IPC_CHANNELS.commissionsProgress, id));
  ipcMain.handle(IPC_CHANNELS.communityList, (_e, projectId: string) => ctx.communityService.list(projectId));
  ipcMain.handle(IPC_CHANNELS.communityGet, (_e, id: string) => ctx.communityService.get(id));
  ipcMain.handle(IPC_CHANNELS.communityCreate, (_e, input: CreateCommunityPostInput) => ctx.communityService.create(input));
  ipcMain.handle(IPC_CHANNELS.communitySuggest, (_e, projectId: string) => ctx.communityService.suggest(projectId));
  ipcMain.handle(IPC_CHANNELS.communityComment, (_e, id: string, text: string) => ctx.communityService.comment(id, text));
  ipcMain.handle(IPC_CHANNELS.communityRunRound, (_e, id: string) =>
    ctx.communityService.runRound(id, (event: CommunityProgress) =>
      getWindow()?.webContents.send(IPC_CHANNELS.communityProgress, event),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.communityStartCommission, (_e, id: string) => ctx.communityService.startCommission(id));
  ipcMain.handle(IPC_CHANNELS.communityAccept, (_e, id: string, note: string) => ctx.communityService.accept(id, note));
  ipcMain.handle(IPC_CHANNELS.emailConfigGet, () => ctx.emailService.config());
  ipcMain.handle(IPC_CHANNELS.emailConfigSave, (_e, config: Omit<EmailMcpConfig, 'updatedAt'>) => ctx.emailService.configure(config));
  ipcMain.handle(IPC_CHANNELS.emailTest, () => ctx.emailService.testConnection());
  ipcMain.handle(IPC_CHANNELS.emailList, (_e, projectId: string) => ctx.emailService.list(projectId));
  ipcMain.handle(IPC_CHANNELS.emailDraft, (_e, input: { projectId: string; sourceMeetingId: string; to: string[]; subject: string; body: string }) =>
    ctx.emailService.createDraft(input));
  ipcMain.handle(IPC_CHANNELS.emailSend, (_e, id: string) => ctx.emailService.sendDraft(id));
  ipcMain.handle(IPC_CHANNELS.auditList, (_e, projectId: string) => ctx.auditService.list(projectId));
  ipcMain.handle(IPC_CHANNELS.auditRun, (_e, projectId: string) => ctx.auditService.run(projectId));
  ipcMain.handle(
    IPC_CHANNELS.projectsToggleActionItem,
    (_e, projectId: string, actionItemId: string, done: boolean) =>
      ctx.projectService.setActionItemDone(projectId, actionItemId, done),
  );

  ipcMain.handle(IPC_CHANNELS.meetingsList, () => ctx.meetingService.listMeetings());
  ipcMain.handle(IPC_CHANNELS.meetingsGet, (_e, id: string) => ctx.meetingService.getMeeting(id));
  ipcMain.handle(IPC_CHANNELS.meetingsCreate, (_e, input: CreateMeetingInput) =>
    ctx.meetingService.createMeeting(input),
  );
  ipcMain.handle(IPC_CHANNELS.meetingsInvite, (_e, meetingId: string, personaId: string) =>
    ctx.meetingService.inviteParticipant(meetingId, personaId),
  );
  ipcMain.handle(IPC_CHANNELS.meetingsDeactivate, (_e, meetingId: string, participantId: string) =>
    ctx.meetingService.deactivateParticipant(meetingId, participantId),
  );
  ipcMain.handle(IPC_CHANNELS.meetingsReactivate, (_e, meetingId: string, participantId: string) =>
    ctx.meetingService.reactivateParticipant(meetingId, participantId),
  );
  ipcMain.handle(IPC_CHANNELS.meetingsSetWorkingDirectory, (_e, meetingId: string, dir: string | null) =>
    ctx.meetingService.setWorkingDirectory(meetingId, dir),
  );

  // 議論中の各AIのターン開始/終了を、完了を待たずレンダラーへ逐次pushする。
  // これにより円陣の座席を「発言中」としてリアルタイムにハイライトできる。
  const emitProgress = (event: TurnEvent): void => {
    getWindow()?.webContents.send(IPC_CHANNELS.discussionProgress, event);
  };

  ipcMain.handle(IPC_CHANNELS.discussionAskAll, (_e, meetingId: string) =>
    ctx.discussionService.askAllActiveToSpeak(meetingId, emitProgress),
  );
  ipcMain.handle(IPC_CHANNELS.discussionAskSpecific, (_e, meetingId: string, participantId: string, question: string) =>
    ctx.discussionService.askSpecific(meetingId, participantId, question, emitProgress),
  );
  ipcMain.handle(IPC_CHANNELS.discussionRebuttal, (_e, meetingId: string) =>
    ctx.discussionService.requestRebuttalRound(meetingId, emitProgress),
  );
  ipcMain.handle(IPC_CHANNELS.discussionHumanSpeak, (_e, meetingId: string, content: string) =>
    ctx.discussionService.humanSpeak(meetingId, content),
  );

  ipcMain.handle(IPC_CHANNELS.decisionFinalize, (_e, meetingId: string, input: FinalizeDecisionInput) =>
    ctx.decisionService.finalizeDecision(meetingId, input),
  );
  ipcMain.handle(IPC_CHANNELS.decisionGate, (_e, meetingId: string) => ctx.decisionService.getGate(meetingId));
  ipcMain.handle(
    IPC_CHANNELS.decisionUpdateActionItems,
    (_e, meetingId: string, items: { id?: string; description: string; assignee: string }[]) =>
      ctx.decisionService.updateActionItems(meetingId, items),
  );

  ipcMain.handle(IPC_CHANNELS.minutesGet, (_e, meetingId: string) => ctx.minutesService.getMinutes(meetingId));

  ipcMain.handle(
    IPC_CHANNELS.minutesDownload,
    async (_e, meetingId: string, markdown: string, suggestedFileName: string) => {
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

  ipcMain.handle(IPC_CHANNELS.chooseDirectory, async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
