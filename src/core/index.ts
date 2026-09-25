import { JsonStore } from './store/jsonStore';
import { Repository } from './store/repository';
import { MeetingService } from './services/meetingService';
import { DiscussionService } from './services/discussionService';
import { DecisionService } from './services/decisionService';
import { MinutesService } from './services/minutesService';
import { ProjectService } from './services/projectService';
import { CommissionStore } from './commission/store';
import { CommissionService } from './commission/service';
import { RoutedAgentClient } from './commission/agentRouter';
import { CommunityStore } from './community/store';
import { CommunityService } from './community/service';
import { EmailStore } from './email/store';
import { EmailService } from './email/service';
import { AuditStore } from './audit/store';
import { AuditService } from './audit/service';

export * from './types';
export * from './commission/types';
export * from './community/types';
export * from './email/types';
export * from './audit/types';
export { PERSONAS, getPersonaById } from './personas';
export { MEETING_TYPES, getMeetingTypeById } from './meetingTypes';

/** アプリ全体で使うサービス一式。main プロセス起動時に一度だけ構築する。 */
export interface AppContext {
  repo: Repository;
  meetingService: MeetingService;
  discussionService: DiscussionService;
  decisionService: DecisionService;
  minutesService: MinutesService;
  projectService: ProjectService;
  commissionService: CommissionService;
  communityService: CommunityService;
  emailService: EmailService;
  auditService: AuditService;
}

export function createAppContext(dataDir: string): AppContext {
  const store = new JsonStore(dataDir);
  const repo = new Repository(store);
  const projectService = new ProjectService(repo);
  const commissionService = new CommissionService(new CommissionStore(dataDir), repo, new RoutedAgentClient(), dataDir, projectService);
  const communityService = new CommunityService(new CommunityStore(dataDir), repo, commissionService);
  return {
    repo,
    meetingService: new MeetingService(repo),
    discussionService: new DiscussionService(repo),
    decisionService: new DecisionService(repo, projectService),
    minutesService: new MinutesService(repo),
    projectService,
    commissionService,
    communityService,
    emailService: new EmailService(new EmailStore(dataDir), repo),
    auditService: new AuditService(new AuditStore(dataDir), repo),
  };
}
