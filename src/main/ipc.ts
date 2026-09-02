import { ipcMain, dialog, BrowserWindow } from 'electron';
import { AppContext, PERSONAS, MEETING_TYPES } from '../core';
import { CreateMeetingInput } from '../core/services/meetingService';
import { FinalizeDecisionInput } from '../core/services/decisionService';
import { TurnEvent } from '../core/services/discussionService';

/** IPCチャンネル名を1箇所に集約（preload.ts と対で管理する）。 */
export const IPC_CHANNELS = {
  personasList: 'personas:list',
  meetingTypesList: 'meetingTypes:list',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsGet: 'projects:get',
  projectsToggleActionItem: 'projects:toggleActionItem',
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
  minutesGet: 'minutes:get',
  chooseDirectory: 'system:chooseDirectory',
} as const;

export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.personasList, () => PERSONAS);
  ipcMain.handle(IPC_CHANNELS.meetingTypesList, () => MEETING_TYPES);

  ipcMain.handle(IPC_CHANNELS.projectsList, () => ctx.projectService.listProjects());
  ipcMain.handle(IPC_CHANNELS.projectsCreate, (_e, name: string, description: string) =>
    ctx.projectService.createProject(name, description),
  );
  ipcMain.handle(IPC_CHANNELS.projectsGet, (_e, id: string) => ctx.projectService.getProject(id));
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

  ipcMain.handle(IPC_CHANNELS.minutesGet, (_e, meetingId: string) => ctx.minutesService.getMinutes(meetingId));

  ipcMain.handle(IPC_CHANNELS.chooseDirectory, async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
