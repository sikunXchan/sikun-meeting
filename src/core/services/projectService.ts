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

  /**
   * ある会議のAction Items一覧をプロジェクト側の転記済みリストに反映する。
   * 決定確定時の初回転記にも、後からのAction Items編集（追加・書き換え・削除）にも使う
   * upsert方式: idが一致する既存項目は内容を更新、無ければ新規追加、
   * actionItemsに含まれなくなった（削除された）このmeeting由来の項目は取り除く。
   * done（完了状態）はプロジェクト側で個別に管理しているためここでは上書きしない。
   */
  async syncActionItems(
    projectId: string,
    meetingId: string,
    sourceMeetingTitle: string,
    actionItems: ActionItem[],
  ): Promise<void> {
    await this.repo.updateProject(projectId, (project) => {
      const keepIds = new Set(actionItems.map((a) => a.id));
      project.actionItems = project.actionItems.filter((a) => a.meetingId !== meetingId || keepIds.has(a.id));

      for (const item of actionItems) {
        const existing = project.actionItems.find((a) => a.meetingId === meetingId && a.id === item.id);
        if (existing) {
          existing.description = item.description;
          existing.assignee = item.assignee;
        } else {
          project.actionItems.push({ ...item, meetingId, sourceMeetingTitle });
        }
      }
    });
  }

  /** Action Itemの完了状態を切り替える（Projectダッシュボードのチェックボックス用）。 */
  async setActionItemDone(projectId: string, actionItemId: string, done: boolean): Promise<Project> {
    return this.repo.updateProject(projectId, (project) => {
      const item = project.actionItems.find((a) => a.id === actionItemId);
      if (!item) throw new Error(`ActionItem not found: ${actionItemId}`);
      item.done = done;
    });
  }
}
