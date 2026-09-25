import { Repository, newId, nowIso } from '../store/repository';
import { ActionItem, ArtifactCard, ArtifactGoal, Project } from '../types';

export interface UpsertArtifactCardInput {
  id?: string;
  name: string;
  kind: ArtifactCard['kind'];
  status: string;
  summary: string;
  knownIssues: string[];
  backlog: string[];
  goals: { id?: string; label: string; target: number; current: number | null; unit: string; evidence: string }[];
}

function cardText(value: string, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}を入力してください`);
  return value.trim();
}

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
      artifactCards: [],
    };
    await this.repo.saveProject(project);
    return project;
  }

  async upsertArtifactCard(projectId: string, input: UpsertArtifactCardInput): Promise<ArtifactCard> {
    const name = cardText(input.name, '成果物名', 160);
    const status = cardText(input.status, '現状', 160);
    const summary = cardText(input.summary, '概要');
    if (!['app', 'tool', 'other'].includes(input.kind)) throw new Error('成果物の種類が不正です');
    const goals: ArtifactGoal[] = (input.goals || []).map((goal) => {
      if (!Number.isFinite(goal.target) || (goal.current !== null && !Number.isFinite(goal.current))) throw new Error('KGIの値が不正です');
      return {
        id: goal.id || newId(), label: cardText(goal.label, 'KGI名', 160),
        target: goal.target, current: goal.current, unit: goal.unit?.slice(0, 40) || '',
        evidence: goal.evidence?.slice(0, 1000) || '', verifiedAt: goal.current === null ? null : nowIso(),
      };
    });
    let result: ArtifactCard | undefined;
    await this.repo.updateProject(projectId, (project) => {
      project.artifactCards ??= [];
      let card = input.id ? project.artifactCards.find((entry) => entry.id === input.id) : undefined;
      if (input.id && !card) throw new Error('成果物カルテが見つかりません');
      if (!card) {
        card = { id: newId(), name, kind: input.kind, createdAt: nowIso(), versions: [] };
        project.artifactCards.push(card);
      }
      card.name = name;
      card.kind = input.kind;
      const previous = card.versions.at(-1);
      card.versions.push({
        version: (previous?.version ?? 0) + 1,
        status, summary, knownIssues: (input.knownIssues || []).map((entry) => entry.trim()).filter(Boolean).slice(0, 50),
        backlog: (input.backlog || []).map((entry) => entry.trim()).filter(Boolean).slice(0, 50),
        goals, decisionIds: previous?.decisionIds || [], commissionIds: previous?.commissionIds || [],
        updatedAt: nowIso(), source: 'human',
      });
      result = structuredClone(card);
    });
    return result!;
  }

  async recordDecision(projectId: string, meetingId: string, cardIds: string[]): Promise<void> {
    if (!cardIds.length) return;
    await this.repo.updateProject(projectId, (project) => {
      for (const card of project.artifactCards || []) {
        if (!cardIds.includes(card.id)) continue;
        const latest = card.versions.at(-1)!;
        card.versions.push({ ...structuredClone(latest), version: latest.version + 1,
          decisionIds: [...new Set([...latest.decisionIds, meetingId])], updatedAt: nowIso(), source: 'meeting' });
      }
    });
  }

  async recordCommissionDelivery(projectId: string, cardId: string, commissionId: string, delivery: string): Promise<void> {
    await this.repo.updateProject(projectId, (project) => {
      const card = project.artifactCards?.find((entry) => entry.id === cardId);
      if (!card) throw new Error('成果物カルテが見つかりません');
      const latest = card.versions.at(-1)!;
      card.versions.push({ ...structuredClone(latest), version: latest.version + 1,
        summary: delivery.slice(0, 4000), status: '納品済み・検証待ち',
        commissionIds: [...new Set([...latest.commissionIds, commissionId])], updatedAt: nowIso(), source: 'commission' });
    });
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
