import { JsonStore } from './store/jsonStore';
import { Repository } from './store/repository';
import { MeetingService } from './services/meetingService';
import { DiscussionService } from './services/discussionService';
import { DecisionService } from './services/decisionService';
import { MinutesService } from './services/minutesService';
import { ProjectService } from './services/projectService';

export * from './types';
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
}

export function createAppContext(dataDir: string): AppContext {
  const store = new JsonStore(dataDir);
  const repo = new Repository(store);
  const projectService = new ProjectService(repo);
  return {
    repo,
    meetingService: new MeetingService(repo),
    discussionService: new DiscussionService(repo),
    decisionService: new DecisionService(repo, projectService),
    minutesService: new MinutesService(repo),
    projectService,
  };
}
