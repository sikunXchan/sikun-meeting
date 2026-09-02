import { Repository, newId, nowIso } from '../store/repository';
import { ActionItem, Project } from '../types';

/**
 * Project ↔ Meeting の連携を担うサービス。
 * 「議論 → 意思決定 → 実行」の循環のうち、Decisionで生まれたActionItemを
 * プロジェクト側に転記して追跡できるようにする。
 */
export class ProjectService {
  constructor(private repo: Repository) {}

  listProjects(): Project[] {
    return this.repo.listProjects();
  }

  getProject(id: string): Project {
    const project = this.repo.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  }

  async createProject(name: string, description: string): Promise<Project> {
    const project: Project = {
      id: newId(),
      name,
      description,
      meetingIds: [],
      actionItems: [],
      createdAt: nowIso(),
    };
    await this.repo.saveProject(project);
    return project;
  }

  async recordActionItems(
    projectId: string,
    meetingId: string,
    sourceMeetingTitle: string,
    actionItems: ActionItem[],
  ): Promise<void> {
    await this.repo.updateProject(projectId, (project) => {
      for (const item of actionItems) {
        project.actionItems.push({ ...item, meetingId, sourceMeetingTitle });
      }
    });
  }
}
