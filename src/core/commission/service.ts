import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Repository } from '../store/repository';
import { PERSONAS } from '../personas';
import { ProjectService } from '../services/projectService';
import { CommissionStore } from './store';
import { compareSnapshots, snapshotWorkspace } from './artifacts';
import { BrowserReviewSession } from './browserReview';
import {
  ActivityEvent, AgentClient, AgentResponse, AgentRun, AutonomySettings, Commission, CommissionSettings,
  ConsultationMessage, CycleRecord, GoalCheck, KgiMeasurement, WorkItem,
} from './types';
import { ArtifactGoal } from '../types';
import { appliedSkillsFor } from '../skills/catalog';

/** 予算・上限・無進捗など、再試行しても結果が変わらない意図的な停止。 */
export class CommissionHalt extends Error {}

export interface CommissionServiceOptions {
  retryDelayMs?: (attempt: number) => number;
}

const DEFAULT_AUTONOMY: AutonomySettings = {
  enabled: false, continuous: false, maxTokens: null, deadline: null, maxCycles: 10, retryLimit: 3,
};

function clip(text: string | undefined, max: number): string {
  const value = text ?? '';
  return value.length > max ? `${value.slice(0, max)}…（以下省略）` : value;
}

function acceptedSummary(items: WorkItem[]): string {
  return items.filter((work) => work.status === 'accepted').slice(-20)
    .map((work) => `${work.title}: ${clip(work.result, 600)}`).join('\n');
}

function normalizeAutonomy(raw: Partial<AutonomySettings>): AutonomySettings {
  const value = { ...DEFAULT_AUTONOMY, ...raw };
  if (typeof value.enabled !== 'boolean' || typeof value.continuous !== 'boolean') throw new Error('無人運用の設定が不正です');
  if (value.continuous && !value.enabled) throw new Error('KGIまでの継続には無人運用を有効にしてください');
  if (value.maxTokens !== null && (!Number.isInteger(value.maxTokens) || value.maxTokens < 1)) throw new Error('トークン予算が不正です');
  if (value.deadline !== null && (typeof value.deadline !== 'string' || !Number.isFinite(Date.parse(value.deadline)))) throw new Error('期限が不正です');
  if (!Number.isInteger(value.maxCycles) || value.maxCycles < 1 || value.maxCycles > 100) throw new Error('最大サイクル数が不正です');
  if (!Number.isInteger(value.retryLimit) || value.retryLimit < 0 || value.retryLimit > 10) throw new Error('自動再試行の回数が不正です');
  return {
    enabled: value.enabled, continuous: value.continuous, maxTokens: value.maxTokens,
    deadline: value.deadline === null ? null : new Date(value.deadline).toISOString(),
    maxCycles: value.maxCycles, retryLimit: value.retryLimit,
  };
}

function parseKgi(text: string, goals: ArtifactGoal[]): { goalId: string; current: number | null; evidence: string }[] {
  const parsed = parseObject(text);
  if (!Array.isArray(parsed.goals)) throw new Error('KGI測定の結果が不正です');
  const ids = new Set(goals.map((goal) => goal.id));
  return parsed.goals.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !ids.has(entry.id)) return [];
    const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
    const current = typeof entry.current === 'number' && Number.isFinite(entry.current) && evidence ? entry.current : null;
    return [{ goalId: entry.id, current, evidence }];
  });
}

function improved(previous: CycleRecord | undefined, current: CycleRecord): boolean {
  return current.kgi.some((goal) => {
    const before = previous?.kgi.find((entry) => entry.goalId === goal.goalId)?.current ?? null;
    return goal.current !== null && (before === null || goal.current > before);
  });
}

function stagnant(cycles: CycleRecord[]): boolean {
  if (cycles.length < 3) return false;
  return cycles.slice(-3).every((cycle) => {
    const index = cycles.indexOf(cycle);
    return cycle.acceptedArtifacts === 0 && !improved(cycles[index - 1], cycle);
  });
}

export interface CreateCommissionInput {
  projectId: string;
  goal: string;
  artifactCardId?: string;
  successCriteria?: string;
  workingDirectory?: string;
  settings?: Partial<CommissionSettings>;
  sourceActionItem?: { meetingId: string; actionItemId: string };
  sourceCommunityPostId?: string;
}

const DEFAULT_SETTINGS: CommissionSettings = {
  provider: 'claude',
  codexModel: 'gpt-6-sol',
  consultantModel: 'claude-sonnet-5',
  plannerModel: 'claude-opus-5-5',
  workerModel: 'claude-sonnet-5',
  reviewerModel: 'claude-sonnet-5',
  criticalModel: 'claude-opus-5-5',
  fallbackModel: 'claude-haiku-4-5-20251001',
  maxCalls: 24,
  maxTurnsPerCall: 12,
  modelByPersona: {},
};

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}を入力してください`);
  if (value.length > maxLength) throw new Error(`${label}が長すぎます`);
  return value.trim();
}

function parseObject(text: string): Record<string, unknown> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(stripped) as Record<string, unknown>; }
  catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AIの計画をJSONとして読み取れませんでした');
    return JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function parseWorkItems(text: string): WorkItem[] {
  const parsed = parseObject(text);
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length < 1 || parsed.tasks.length > 8) {
    throw new Error('AIの計画に1〜8件の仕事が必要です');
  }
  const personaIds = new Set(PERSONAS.map((persona) => persona.id));
  return parsed.tasks.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object') throw new Error(`${index + 1}件目の仕事が不正です`);
    const item = raw as Record<string, unknown>;
    const owner = requiredText(item.ownerPersonaId, '担当者', 80);
    const reviewer = requiredText(item.reviewerPersonaId, '確認者', 80);
    const domain = item.domainPersonaId ? requiredText(item.domainPersonaId, '所管者', 80) : owner;
    if (!personaIds.has(owner) || !personaIds.has(reviewer) || !personaIds.has(domain)) throw new Error('計画に存在しないAIが含まれています');
    if (owner === reviewer) throw new Error('担当者と確認者を分けてください');
    if (owner !== domain && reviewer !== domain) throw new Error('担当外の仕事は所管者が確認する必要があります');
    return {
      id: randomUUID(),
      title: requiredText(item.title, '仕事名', 200),
      instructions: requiredText(item.instructions, '作業内容', 5000),
      acceptance: requiredText(item.acceptance, '確認条件', 3000),
      ownerPersonaId: owner,
      domainPersonaId: domain,
      reviewerPersonaId: reviewer,
      critical: item.critical === true,
      status: 'queued',
      attempts: 0,
    } satisfies WorkItem;
  });
}

function parseReview(text: string): { approved: boolean; note: string } {
  const parsed = parseObject(text);
  if (typeof parsed.approved !== 'boolean') throw new Error('AIの確認結果に approved がありません');
  return { approved: parsed.approved, note: typeof parsed.note === 'string' ? parsed.note : text };
}

function parseGoalCheck(text: string): Pick<GoalCheck, 'complete' | 'evidence' | 'remaining'> {
  const parsed = parseObject(text);
  if (typeof parsed.complete !== 'boolean' || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.remaining)) {
    throw new Error('目標検証の結果が不正です');
  }
  const evidence = parsed.evidence.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).slice(0, 20);
  const remaining = parsed.remaining.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).slice(0, 20);
  if (parsed.complete && (!evidence.length || remaining.length)) throw new Error('目標達成には証拠が必要で、未完了項目を残せません');
  return { complete: parsed.complete, evidence, remaining };
}

function recordedDelivery(item: Commission, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  const work = item.workItems.map((entry) => {
    const files = item.artifacts
      .filter((artifact) => artifact.workItemId === entry.id && artifact.status === 'accepted')
      .map((artifact) => `- ${artifact.relativePath}（${artifact.change}）`);
    return [
      `### ${entry.title}`,
      `状態: ${entry.status}`,
      `作業報告: ${entry.result || '記録なし'}`,
      `内部確認: ${entry.review || '記録なし'}`,
      '採用されたファイル:',
      ...(files.length ? files : ['- 記録なし']),
    ].join('\n');
  }).join('\n\n');
  return [
    '# 代替納品書（記録から自動作成）',
    `納品文のAI生成に失敗しました: ${reason.slice(0, 500)}`,
    `目標: ${item.goal}`,
    `作業場所: ${item.workingDirectory}`,
    `確定した企画: ${item.planText}`,
    '## 内部確認を通過した作業',
    work,
    '## 検証と未確認事項',
    '上記の「内部確認」は保存された確認者の判断です。ここに記載のないテストや動作確認の実施は確認できません。',
  ].join('\n\n');
}

export class CommissionService {
  private active = new Map<string, AbortController>();
  private executions = new Map<string, Promise<void>>();
  private consulting = new Set<string>();
  private listeners = new Set<(id: string) => void>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private store: CommissionStore,
    private repo: Repository,
    private agent: AgentClient,
    private dataDir: string,
    private projectService?: ProjectService,
    private options: CommissionServiceOptions = {},
  ) {}

  private retryDelay(attempt: number): number {
    if (this.options.retryDelayMs) return this.options.retryDelayMs(attempt);
    return [60_000, 300_000][attempt - 1] ?? 900_000;
  }

  private scheduleRetry(id: string, delayMs: number): void {
    this.cancelRetry(id);
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      const item = this.store.get(id);
      if (item.status === 'failed' && item.autoRetry?.nextAt) {
        void this.resume(id, { auto: true }).catch((error) => this.event(id, 'error', `自動再試行を開始できません: ${error instanceof Error ? error.message : String(error)}`));
      }
    }, delayMs);
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  private cancelRetry(id: string): void {
    const timer = this.retryTimers.get(id);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(id);
  }

  /** 起動時に、無人運用の案件を人間の操作なしで再開する。 */
  resumeAutonomous(): void {
    for (const item of this.store.list()) {
      if (!item.settings.autonomy?.enabled) continue;
      if (item.status === 'interrupted') {
        void this.resume(item.id, { auto: true }).catch((error) => this.event(item.id, 'error', `自動再開できません: ${error instanceof Error ? error.message : String(error)}`));
      } else if (item.status === 'failed' && item.autoRetry?.nextAt) {
        this.scheduleRetry(item.id, Math.max(0, Date.parse(item.autoRetry.nextAt) - Date.now()));
      }
    }
  }

  /** 無人運用の案件が実行中か（常駐・スリープ抑止の判断用）。 */
  hasActiveAutonomy(): boolean {
    return this.store.list().some((item) => item.settings.autonomy?.enabled
      && (item.status === 'running' || (item.status === 'failed' && !!item.autoRetry?.nextAt)));
  }

  hasRunning(): boolean {
    return this.active.size > 0;
  }

  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(id: string): void {
    for (const listener of this.listeners) listener(id);
  }

  private async event(id: string, kind: ActivityEvent['kind'], detail: string, runId?: string): Promise<void> {
    await this.store.appendEvent({ id: randomUUID(), commissionId: id, runId, at: new Date().toISOString(), kind, detail });
    this.notify(id);
  }

  list(projectId?: string): Commission[] {
    return this.store.list(projectId);
  }

  get(id: string): { commission: Commission; events: ActivityEvent[] } {
    return { commission: this.store.get(id), events: this.store.events(id) };
  }

  async create(input: CreateCommissionInput): Promise<Commission> {
    const project = this.repo.getProject(input.projectId);
    if (!project) throw new Error('プロジェクトを選択してください');
    if (input.sourceActionItem) {
      const source = project.actionItems.find((entry) => entry.id === input.sourceActionItem!.actionItemId && entry.meetingId === input.sourceActionItem!.meetingId);
      if (!source) throw new Error('元のAction Itemが見つかりません');
      const previous = this.store.list(project.id).find((entry) => entry.sourceActionItem?.actionItemId === source.id && entry.sourceActionItem?.meetingId === source.meetingId);
      if (previous) return previous;
    }
    if (input.sourceCommunityPostId) {
      const previous = this.store.list(project.id).find((entry) => entry.sourceCommunityPostId === input.sourceCommunityPostId);
      if (previous) return previous;
    }
    const goal = requiredText(input.goal, '目標', 10000);
    if (input.artifactCardId && !project.artifactCards?.some((card) => card.id === input.artifactCardId)) {
      throw new Error('対象の成果物カルテが見つかりません');
    }
    const successCriteria = input.successCriteria?.trim() || undefined;
    const id = randomUUID();
    const workingDirectory = input.workingDirectory?.trim() || path.join(this.dataDir, 'commission-workspaces', id);
    if (input.workingDirectory) {
      if (!fs.statSync(workingDirectory).isDirectory()) throw new Error('作業ディレクトリが見つかりません');
    } else {
      fs.mkdirSync(workingDirectory, { recursive: true });
    }
    const autonomy = input.settings?.autonomy ? normalizeAutonomy(input.settings.autonomy) : undefined;
    const settings: CommissionSettings = { ...DEFAULT_SETTINGS, ...input.settings, modelByPersona: { ...DEFAULT_SETTINGS.modelByPersona, ...input.settings?.modelByPersona } };
    if (autonomy?.enabled) settings.autonomy = autonomy;
    else delete settings.autonomy;
    if (autonomy?.continuous) {
      if (!successCriteria) throw new Error('KGIまでの継続には完了条件が必要です');
      const card = project.artifactCards?.find((entry) => entry.id === input.artifactCardId);
      if (!card || !card.versions.at(-1)?.goals.length) throw new Error('KGIまでの継続には、KGIを設定した成果物カルテを選んでください');
    }
    if (settings.provider !== 'claude' && settings.provider !== 'codex') throw new Error('実行エンジンが不正です');
    requiredText(settings.codexModel, 'Codexモデル', 120);
    for (const model of [settings.consultantModel, settings.plannerModel, settings.workerModel, settings.reviewerModel, settings.criticalModel, settings.fallbackModel]) {
      requiredText(model, 'モデル', 120);
    }
    for (const [personaId, model] of Object.entries(settings.modelByPersona ?? {})) {
      if (!PERSONAS.some((persona) => persona.id === personaId)) throw new Error(`不明なAIのモデル設定: ${personaId}`);
      requiredText(model, 'モデル', 120);
    }
    const callLimit = settings.autonomy?.enabled ? 5000 : 200;
    if (!Number.isInteger(settings.maxCalls) || settings.maxCalls < 1 || settings.maxCalls > callLimit) throw new Error('最大呼び出し回数が不正です');
    if (!Number.isInteger(settings.maxTurnsPerCall) || settings.maxTurnsPerCall < 1 || settings.maxTurnsPerCall > 100) throw new Error('最大ターン数が不正です');
    const now = new Date().toISOString();
    const commission: Commission = {
      id, projectId: input.projectId, sourceActionItem: input.sourceActionItem,
      sourceCommunityPostId: input.sourceCommunityPostId,
      goal, artifactCardId: input.artifactCardId, successCriteria,
      workingDirectory, status: 'consulting',
      createdAt: now, updatedAt: now, consultation: [], planText: '', settings,
      workItems: [], artifacts: [], workDecisions: [], reviewDecisions: [], memories: [], goalChecks: [],
      runs: [], revisionRequests: [], plannedRevisionCount: 0,
    };
    await this.store.insert(commission);
    await this.event(id, 'state', '企画相談を開始しました');
    return commission;
  }

  async fromActionItem(projectId: string, actionItemId: string): Promise<Commission> {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error('プロジェクトが見つかりません');
    const actionItem = project.actionItems.find((entry) => entry.id === actionItemId);
    if (!actionItem) throw new Error('Action Itemが見つかりません');
    return this.create({
      projectId,
      goal: actionItem.description,
      sourceActionItem: { meetingId: actionItem.meetingId, actionItemId: actionItem.id },
    });
  }

  private async callAgent(
    id: string,
    phase: AgentRun['phase'],
    personaId: string,
    prompt: string,
    tools: 'read' | 'full',
    signal: AbortSignal,
    workItemId?: string,
  ): Promise<AgentResponse> {
    const snapshot = this.store.get(id);
    if (snapshot.runs.length >= snapshot.settings.maxCalls) throw new CommissionHalt('AI呼び出し回数の上限に達しました');
    const autonomy = snapshot.settings.autonomy;
    if (autonomy?.enabled) {
      const usedTokens = snapshot.runs.reduce((sum, run) => sum + (run.tokens ?? 0), 0);
      if (autonomy.maxTokens !== null && usedTokens >= autonomy.maxTokens) throw new CommissionHalt(`トークン予算（${autonomy.maxTokens}）に達しました`);
      if (autonomy.deadline !== null && Date.now() >= Date.parse(autonomy.deadline)) throw new CommissionHalt('無人運用の期限に達しました');
    }
    const phaseModel = phase === 'consultation' || phase === 'delivery' ? snapshot.settings.consultantModel
      : phase === 'planning' ? snapshot.settings.plannerModel
      : phase === 'goal_check' || phase === 'kgi_check' ? snapshot.settings.criticalModel
      : phase === 'review' ? snapshot.settings.reviewerModel : snapshot.settings.workerModel;
    const workItem = snapshot.workItems.find((work) => work.id === workItemId);
    const important = Boolean(workItem?.critical) || (phase === 'review' && workItem?.ownerPersonaId !== workItem?.domainPersonaId);
    const provider = snapshot.settings.provider === 'codex' ? 'codex' : 'claude';
    const model = provider === 'codex' ? snapshot.settings.codexModel || DEFAULT_SETTINGS.codexModel
      : snapshot.settings.modelByPersona?.[personaId] || (important ? snapshot.settings.criticalModel : phaseModel);
    const run: AgentRun = {
      id: randomUUID(), provider, phase, workItemId, personaId, requestedModel: model,
      appliedSkills: appliedSkillsFor(personaId, phase),
      observedModels: [], status: 'running', startedAt: new Date().toISOString(),
      estimatedCostUsd: 0, numTurns: 0,
    };
    await this.store.update(id, (item) => { item.runs.push(run); });
    await this.event(id, 'state', `${personaId}: ${phase} を開始`, run.id);
    try {
      const response = await this.agent.run({
        provider, phase, personaId, prompt, workingDirectory: snapshot.workingDirectory, model,
        fallbackModel: provider === 'claude' && snapshot.settings.fallbackModel !== model ? snapshot.settings.fallbackModel : undefined,
        tools,
        maxTurns: snapshot.settings.maxTurnsPerCall,
        abortSignal: signal,
        onTool: (detail) => this.event(id, 'tool', detail, run.id),
      });
      if (signal.aborted) throw new Error('実行が中断されました');
      await this.store.update(id, (item) => {
        const current = item.runs.find((entry) => entry.id === run.id)!;
        current.status = 'completed';
        current.endedAt = new Date().toISOString();
        current.result = response.text;
        current.observedModels = response.observedModels;
        current.effectiveModel = response.effectiveModel;
        current.estimatedCostUsd = response.estimatedCostUsd;
        current.numTurns = response.numTurns;
        current.tokens = response.tokens ?? 0;
        current.inputTokens = response.inputTokens;
        current.cachedInputTokens = response.cachedInputTokens;
        current.outputTokens = response.outputTokens;
        current.toolCalls = response.toolCalls;
      });
      await this.event(id, 'message', `${personaId}: ${phase} を完了`, run.id);
      if (provider === 'claude' && snapshot.settings.fallbackModel && response.effectiveModel === snapshot.settings.fallbackModel && model !== snapshot.settings.fallbackModel) {
        await this.event(id, 'state', `${personaId}: ${model} から代替モデル ${snapshot.settings.fallbackModel} に切り替わりました`, run.id);
      }
      return response;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const usage = error as Partial<AgentResponse>;
      await this.store.update(id, (item) => {
        const current = item.runs.find((entry) => entry.id === run.id)!;
        current.status = signal.aborted ? 'interrupted' : 'failed';
        current.endedAt = new Date().toISOString();
        current.error = detail;
        if (Array.isArray(usage?.observedModels)) current.observedModels = usage.observedModels;
        if (typeof usage?.effectiveModel === 'string') current.effectiveModel = usage.effectiveModel;
        if (Number.isFinite(usage?.estimatedCostUsd)) current.estimatedCostUsd = usage.estimatedCostUsd!;
        if (Number.isFinite(usage?.numTurns)) current.numTurns = usage.numTurns!;
        if (Number.isFinite(usage?.tokens)) current.tokens = usage.tokens!;
        if (Number.isFinite(usage?.inputTokens)) current.inputTokens = usage.inputTokens!;
        if (Number.isFinite(usage?.cachedInputTokens)) current.cachedInputTokens = usage.cachedInputTokens!;
        if (Number.isFinite(usage?.outputTokens)) current.outputTokens = usage.outputTokens!;
        if (Number.isFinite(usage?.toolCalls)) current.toolCalls = usage.toolCalls!;
      });
      await this.event(id, 'error', `${personaId}: ${detail}`, run.id);
      throw error;
    }
  }

  async consult(id: string, text: string): Promise<Commission> {
    const question = requiredText(text, '相談内容', 6000);
    const initial = this.store.get(id);
    if (initial.status !== 'consulting') throw new Error('企画相談中の案件ではありません');
    if (this.consulting.has(id)) throw new Error('ITコンサルタントが回答中です');
    this.consulting.add(id);
    const controller = new AbortController();
    const human: ConsultationMessage = { id: randomUUID(), speaker: 'human', content: question, createdAt: new Date().toISOString() };
    await this.store.update(id, (item) => { item.consultation.push(human); });
    try {
      const snapshot = this.store.get(id);
      const history = snapshot.consultation.map((message) => `${message.speaker === 'human' ? '発注者' : 'ITコンサルタント'}: ${message.content}`).join('\n\n');
      const response = await this.callAgent(id, 'consultation', 'it_consultant',
        `発注者の目標: ${snapshot.goal}\n\nこれまでの相談:\n${history}\n\n目的・完成像・制約・成功条件を一緒に具体化してください。必要な質問は絞り、企画案が固まれば発注者が確定できるように要点を整理してください。実装やファイル変更はまだ行わないでください。`,
        'read', controller.signal);
      const answer: ConsultationMessage = { id: randomUUID(), speaker: 'it_consultant', content: response.text, createdAt: new Date().toISOString() };
      const updated = await this.store.update(id, (item) => {
        item.consultation.push(answer);
        item.planText = response.text;
      });
      this.notify(id);
      return updated;
    } finally {
      this.consulting.delete(id);
    }
  }

  async confirmPlan(id: string, planText: string): Promise<Commission> {
    const plan = requiredText(planText, '企画', 20000);
    const initial = this.store.get(id);
    if (initial.status !== 'consulting') throw new Error('企画相談中の案件ではありません');
    if (this.consulting.has(id)) throw new Error('ITコンサルタントの回答が終わってから企画を確定してください');
    if (!initial.consultation.some((message) => message.speaker === 'it_consultant')) throw new Error('先にITコンサルタントと企画を相談してください');
    const updated = await this.store.update(id, (item) => {
      item.planText = plan;
      item.planConfirmedAt = new Date().toISOString();
      item.status = 'running';
      item.error = undefined;
    });
    await this.event(id, 'state', '発注者が企画を確定しました。AI組織が自律実行を開始します');
    this.start(id);
    return updated;
  }

  private start(id: string): void {
    const task = this.execute(id);
    this.executions.set(id, task);
    void task.finally(() => {
      if (this.executions.get(id) === task) this.executions.delete(id);
    });
  }

  private planningPrompt(item: Commission, revision = false): string {
    const roster = PERSONAS.map((persona) => `${persona.id}: ${persona.roleTitle}`).join('\n');
    const prior = acceptedSummary(item.workItems);
    const memory = this.store.list(item.projectId).flatMap((entry) => entry.memories ?? []).slice(-12).map((entry) => entry.summary).join('\n');
    return `発注者がITコンサルタントAIと確定した企画:\n${item.planText}\n\n発注者の完了条件:\n${item.successCriteria || item.goal}\n\n${revision ? `修正依頼:\n${item.revisionRequests.at(-1)}\n\n既に完了した仕事:\n${prior}` : ''}\n\n同じプロジェクトの採用済み記録:\n${memory || 'なし'}\n\nAIチームの専門家:\n${roster}\n\n人間の個別割当なしで成果物を完成させるため、順番に実行する1〜8件の仕事を計画してください。仕事の数は最小限にし、1ファイル作成などの小さな目標は1件にまとめてください。事前の要件解析・計画立案・内部レビュー・納品判定を独立した仕事にしないでください。それらはこの仕組みが自動的に行います。各仕事は担当AIと異なる確認AIを持ち、結果をファイルまたは検証可能な内容で残します。担当AIと所管AIが異なる場合、確認AIを必ず所管AIにしてください。重大な外部影響や複雑な設計・実装を伴う仕事に限って critical=true としてください。担当外の所管判断も重要判断として扱われます。曖昧な部分は企画の制約内で仮定を記録して進めます。JSONだけで回答してください。形式: {"tasks":[{"title":"...","instructions":"...","acceptance":"...","ownerPersonaId":"engineer","domainPersonaId":"engineer","reviewerPersonaId":"qa","critical":false}]}`;
  }

  private workPrompt(item: Commission, work: WorkItem): string {
    const completed = acceptedSummary(item.workItems);
    const retry = work.review ? `前回の確認で修正が必要とされた点:\n${work.review}\n` : '';
    return `確定した企画:\n${item.planText}\n\n発注者の完了条件:\n${item.successCriteria || item.goal}\n\n今回の担当作業: ${work.title}\n${work.instructions}\n担当: ${work.ownerPersonaId} / 所管: ${work.domainPersonaId} / 確認: ${work.reviewerPersonaId}\n\n確認条件:\n${work.acceptance}\n\n完了済みの仕事:\n${completed || 'なし'}\n\n${retry}実際に必要なファイル編集・コマンド実行を行い、使える成果物を作ってください。可能なら検証してください。役割外の方針変更は提案として報告し、担当領域の判断を尊重してください。GUIが必要で、Orcaのcomputerコマンドが利用可能ならその機能を使えます。最後に変更内容、成果物の場所、検証結果、残る問題を日本語で報告してください。`;
  }

  private async execute(id: string): Promise<void> {
    if (this.active.has(id)) return;
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      let item = this.store.get(id);
      if (item.status !== 'running') return;
      if (!item.cycle) await this.store.update(id, (current) => { current.cycle = 1; });
      for (;;) {
      while (true) {
      item = this.store.get(id);
      if (item.workItems.length === 0 || item.revisionRequests.length > (item.plannedRevisionCount ?? 0)) {
        const revision = item.workItems.length > 0;
        const response = await this.callAgent(id, 'planning', 'product', this.planningPrompt(item, revision), 'read', controller.signal);
        const workItems = parseWorkItems(response.text);
        await this.store.update(id, (current) => {
          for (const work of workItems) work.cycle = current.cycle ?? 1;
          current.workItems.push(...workItems);
          current.workDecisions.push(...workItems.map((work) => ({
            id: randomUUID(), workItemId: work.id, domainPersonaId: work.domainPersonaId,
            proposedByPersonaId: work.ownerPersonaId, reviewerPersonaId: work.reviewerPersonaId,
            rationale: work.instructions, status: 'proposed' as const,
          })));
          current.plannedRevisionCount = current.revisionRequests.length;
        });
        await this.event(id, 'state', `${workItems.length}件の仕事と担当を決めました`);
      }
      item = this.store.get(id);
      for (const original of item.workItems) {
        let work = this.store.get(id).workItems.find((entry) => entry.id === original.id)!;
        if (work.status === 'accepted') continue;
        while (work.attempts < 2 && work.status !== 'accepted') {
          if (controller.signal.aborted) return;
          await this.store.update(id, (current) => {
            const target = current.workItems.find((entry) => entry.id === work.id)!;
            target.status = 'running'; target.attempts += 1;
          });
          const snapshot = this.store.get(id);
          const before = await snapshotWorkspace(snapshot.workingDirectory);
          let response: AgentResponse;
          try {
            response = await this.callAgent(id, 'work', work.ownerPersonaId, this.workPrompt(snapshot, work), 'full', controller.signal, work.id);
          } catch (error) {
            const afterFailure = await snapshotWorkspace(snapshot.workingDirectory);
            const partialChanges = compareSnapshots(before, afterFailure);
            const failedRunId = this.store.get(id).runs.at(-1)!.id;
            await this.store.update(id, (current) => {
              const target = current.workItems.find((entry) => entry.id === work.id)!;
              target.status = controller.signal.aborted ? 'interrupted' : 'failed';
              current.artifacts.push(...partialChanges.map((change) => ({
                id: randomUUID(), workItemId: work.id, runId: failedRunId,
                ...change, status: 'proposed' as const, detectedAt: new Date().toISOString(),
              })));
            });
            if (partialChanges.length) await this.event(id, 'state', `${work.title}: 失敗前の${partialChanges.length}件のファイル変更を提案中として保存`);
            throw error;
          }
          const after = await snapshotWorkspace(snapshot.workingDirectory);
          const changes = compareSnapshots(before, after);
          const workRunId = this.store.get(id).runs.at(-1)!.id;
          const artifactIds: string[] = changes.map(() => randomUUID());
          await this.store.update(id, (current) => {
            const target = current.workItems.find((entry) => entry.id === work.id)!;
            target.status = 'review_pending'; target.result = response.text;
            current.artifacts.push(...changes.map((change, index) => ({
              id: artifactIds[index], workItemId: work.id, runId: workRunId,
              ...change, status: 'proposed' as const, detectedAt: new Date().toISOString(),
            })));
          });
          await this.event(id, 'state', `${work.title}: ${changes.length}件のファイル変更を検出`);
          let reviewPrompt = `確定した企画:\n${snapshot.planText}\n\n仕事: ${work.title}\n所管: ${work.domainPersonaId}\n確認条件: ${work.acceptance}\n担当AIの報告:\n${response.text}\n変更ファイル:\n${changes.map((change) => `${change.change} ${change.relativePath}`).join('\n') || 'なし'}\n\n作業ディレクトリの成果物と必要な検証を確認してください。あなたは${work.reviewerPersonaId}として採用可否を判断します。JSONのみで {"approved":true/false,"note":"根拠と修正点"} と回答してください。`;
          const htmlFiles = changes.filter((change) => change.change !== 'deleted' && /\.html?$/i.test(change.relativePath))
            .map((change) => change.relativePath);
          let browserReview: BrowserReviewSession | undefined;
          if (work.reviewerPersonaId === 'qa' && htmlFiles.length) {
            const candidate = new BrowserReviewSession(snapshot.workingDirectory, htmlFiles);
            try {
              await candidate.start();
              browserReview = candidate;
              reviewPrompt += candidate.instructions();
              await this.event(id, 'state', `${work.title}: QAのブラウザ実機確認を開始`);
            } catch (error) {
              await candidate.close();
              reviewPrompt += `\n\nブラウザ実機確認は起動できませんでした: ${error instanceof Error ? error.message : String(error)}。未検証の動作を合格扱いにしないでください。`;
            }
          }
          let review: AgentResponse;
          try {
            review = await this.callAgent(id, 'review', work.reviewerPersonaId, reviewPrompt, 'full', controller.signal, work.id);
          } catch (error) {
            const afterFailure = await snapshotWorkspace(snapshot.workingDirectory);
            const partialChanges = compareSnapshots(after, afterFailure);
            const failedRunId = this.store.get(id).runs.at(-1)!.id;
            await this.store.update(id, (current) => {
              const target = current.workItems.find((entry) => entry.id === work.id)!;
              target.status = controller.signal.aborted ? 'interrupted' : 'failed';
              current.artifacts.push(...partialChanges.map((change) => ({
                id: randomUUID(), workItemId: work.id, runId: failedRunId,
                ...change, status: 'proposed' as const, detectedAt: new Date().toISOString(),
              })));
            });
            throw error;
          } finally {
            if (browserReview) {
              const trace = browserReview.summary();
              await browserReview.close();
              await this.event(id, 'state', `${work.title}: ブラウザ確認 ${trace || '操作なし'}`);
            }
          }
          const afterReview = await snapshotWorkspace(snapshot.workingDirectory);
          const reviewChanges = compareSnapshots(after, afterReview);
          const reviewRunId = this.store.get(id).runs.at(-1)!.id;
          const reviewArtifactIds: string[] = reviewChanges.map(() => randomUUID());
          const verdict = parseReview(review.text);
          await this.store.update(id, (current) => {
            const target = current.workItems.find((entry) => entry.id === work.id)!;
            target.review = verdict.note;
            target.status = verdict.approved ? 'accepted' : 'queued';
            current.artifacts.push(...reviewChanges.map((change, index) => ({
              id: reviewArtifactIds[index], workItemId: work.id, runId: reviewRunId,
              ...change, status: 'proposed' as const, detectedAt: new Date().toISOString(),
            })));
            current.reviewDecisions.push({
              id: randomUUID(), workItemId: work.id, reviewerPersonaId: work.reviewerPersonaId,
              approved: verdict.approved, note: verdict.note, artifactIds: [...artifactIds, ...reviewArtifactIds],
              decidedAt: new Date().toISOString(),
            });
            const decision = current.workDecisions.find((entry) => entry.workItemId === work.id)!;
            decision.status = verdict.approved ? 'accepted' : 'rejected';
            decision.decidedAt = new Date().toISOString();
            if (verdict.approved) {
              if (current.autoRetry) current.autoRetry.count = 0;
              for (const artifact of current.artifacts) {
                if (artifactIds.includes(artifact.id) || reviewArtifactIds.includes(artifact.id)) artifact.status = 'accepted';
              }
              current.memories.push({
                id: randomUUID(), workItemId: work.id,
                summary: `${work.title}: ${response.text.slice(0, 600)}（確認: ${verdict.note.slice(0, 300)}）`,
                artifactPaths: [...changes, ...reviewChanges].map((change) => change.relativePath),
                createdAt: new Date().toISOString(),
              });
            }
          });
          await this.event(id, 'state', `${work.title}: ${verdict.approved ? '内部確認を通過' : '修正して再実行'}`);
          work = this.store.get(id).workItems.find((entry) => entry.id === work.id)!;
        }
        if (work.status !== 'accepted') throw new Error(`${work.title} が内部確認を通過しませんでした`);
      }
      item = this.store.get(id);
      if (!item.successCriteria) break; // 旧案件は従来の状態遷移を保つ
      const cycleIndex = item.cycle ?? 1;
      const cycleChecks = (item.goalChecks ?? []).filter((check) => (check.cycle ?? 1) === cycleIndex);
      const lastCheck = cycleChecks.at(-1);
      if (lastCheck?.complete && lastCheck.workItemCount === item.workItems.length &&
        item.revisionRequests.length === (item.plannedRevisionCount ?? 0)) break;
      if (lastCheck && !lastCheck.complete && lastCheck.workItemCount === item.workItems.length) {
        throw new CommissionHalt('目標検証後に新しい仕事が増えていません。無進捗として停止しました');
      }
      const acceptedFiles = item.artifacts.filter((artifact) => artifact.status === 'accepted')
        .map((artifact) => `${artifact.relativePath}: ${artifact.afterHash || artifact.change}`).slice(-40);
      const checkPrompt = `あなたは通常の担当・確認から独立したCriticです。発注者の完了条件を証拠に照らして検証してください。担当AIの完了宣言を事実として扱わないでください。\n完了条件:\n${item.successCriteria}\n確定企画:\n${item.planText}${cycleIndex > 1 ? `\n今回の継続サイクルで満たすべき追加条件:\n${clip(item.revisionRequests.filter((request) => request.startsWith(`継続サイクル${cycleIndex}:`)).at(-1), 2000)}` : ''}\n内部確認済みの仕事:\n${item.workItems.filter((work) => work.status === 'accepted').slice(-20).map((work) => `${work.title}: ${clip(work.result, 900)} / 確認: ${clip(work.review, 500)}`).join('\n')}\n成果ファイルとハッシュ:\n${acceptedFiles.join('\n') || 'なし'}\n作業場所を必要に応じて読んで検証し、JSONのみで {"complete":true/false,"evidence":["確認した具体的な根拠"],"remaining":["未達成の条件"]} と返してください。検証できない条件は未達とします。`;
      const response = await this.callAgent(id, 'goal_check', 'critic', checkPrompt, 'read', controller.signal);
      const verdict = parseGoalCheck(response.text);
      const check: GoalCheck = {
        id: randomUUID(), checkedAt: new Date().toISOString(), reviewerPersonaId: 'critic',
        workItemCount: item.workItems.length, cycle: cycleIndex, ...verdict,
      };
      await this.store.update(id, (current) => { current.goalChecks ??= []; current.goalChecks.push(check); });
      await this.event(id, 'state', `目標検証: ${verdict.complete ? '達成' : '未達'}（${verdict.remaining.join('、') || verdict.evidence.join('、')}）`);
      if (verdict.complete) break;
      if (cycleChecks.length + 1 >= 3) throw new CommissionHalt('目標を3回検証しても達成できませんでした');
      await this.store.update(id, (current) => {
        current.revisionRequests.push(`目標検証で未達: ${verdict.remaining.join('、') || '具体的な証拠が不足'}。既存の仕事を繰り返さず不足分を追加してください。`);
      });
      }
      item = this.store.get(id);
      const deliveryCycle = item.cycle ?? 1;
      const results = item.workItems.filter((work) => (work.cycle ?? 1) === deliveryCycle).map((work) => `## ${work.title}\n担当: ${work.ownerPersonaId} / 確認: ${work.reviewerPersonaId}\n結果: ${work.result?.slice(0, 1500)}\n確認: ${work.review?.slice(0, 500)}`).join('\n\n');
      let deliveryText: string;
      try {
        const delivery = await this.callAgent(id, 'delivery', 'it_consultant',
          `確定した企画:\n${item.planText}\n\nAIチームの仕事と確認結果:\n${results}\n\n発注者へ納品する報告を日本語で作成してください。目標との対応、作成物の場所、実施した検証、未完了・未確認事項を明確にしてください。実施していない検証を成功と書かないでください。`,
          'read', controller.signal);
        deliveryText = delivery.text;
      } catch (error) {
        const snapshot = this.store.get(id);
        const lastRun = snapshot.runs.at(-1);
        if (controller.signal.aborted || snapshot.settings.provider !== 'codex'
          || lastRun?.phase !== 'delivery' || lastRun.status !== 'failed'
          || !snapshot.workItems.every((work) => work.status === 'accepted')) throw error;
        deliveryText = recordedDelivery(snapshot, error);
        await this.event(id, 'state', '納品文のAI生成に失敗したため、内部確認済みの記録から代替納品書を作成しました');
      }
      const continuous = Boolean(item.settings.autonomy?.enabled && item.settings.autonomy.continuous);
      await this.store.update(id, (current) => {
        current.delivery = deliveryText;
        if (!continuous) {
          current.status = 'delivered';
          current.error = undefined;
        }
      });
      if (item.artifactCardId && this.projectService) {
        await this.projectService.recordCommissionDelivery(item.projectId, item.artifactCardId, id, deliveryText);
      }
      if (!continuous) {
        await this.event(id, 'state', '成果物を納品しました');
        return;
      }
      await this.event(id, 'state', `サイクル${deliveryCycle}の成果物を納品しました`);
      const stopReason = await this.finishCycle(id, deliveryText, controller.signal);
      if (stopReason) {
        await this.store.update(id, (current) => {
          current.status = 'delivered';
          current.stopReason = stopReason;
          current.error = undefined;
          current.autoRetry = undefined;
        });
        await this.event(id, 'state', `継続運用を終了しました: ${stopReason}`);
        return;
      }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = this.store.get(id);
      if (current.status !== 'paused' && current.status !== 'stopped') {
        const autonomy = current.settings.autonomy;
        const halted = error instanceof CommissionHalt;
        const attempt = (current.autoRetry?.count ?? 0) + 1;
        if (autonomy?.enabled && !halted && !controller.signal.aborted && attempt <= autonomy.retryLimit) {
          const delay = this.retryDelay(attempt);
          const nextAt = new Date(Date.now() + delay).toISOString();
          await this.store.update(id, (item) => {
            item.status = 'failed';
            item.error = `${message}（${new Date(nextAt).toLocaleString('ja-JP')}に${attempt}回目の自動再試行を予定）`;
            item.autoRetry = { count: attempt, nextAt };
          });
          this.scheduleRetry(id, delay);
        } else {
          await this.store.update(id, (item) => {
            const keepDelivery = halted && Boolean(item.delivery);
            item.status = keepDelivery ? 'delivered' : 'failed';
            item.error = keepDelivery ? undefined : message;
            item.autoRetry = undefined;
            if (halted) item.stopReason = message;
            else if (autonomy?.enabled) item.stopReason = `自動再試行の上限（${autonomy.retryLimit}回）に達しました: ${message}`;
          });
        }
      }
      await this.event(id, 'error', message);
    } finally {
      this.active.delete(id);
      this.notify(id);
    }
  }

  /** 継続運用の1サイクルを締める。停止する場合はその理由、続ける場合はnullを返す。 */
  private async finishCycle(id: string, delivery: string, signal: AbortSignal): Promise<string | null> {
    const item = this.store.get(id);
    const autonomy = item.settings.autonomy!;
    const cycleIndex = item.cycle ?? 1;
    const card = this.repo.getProject(item.projectId)?.artifactCards?.find((entry) => entry.id === item.artifactCardId);
    const goals = card?.versions.at(-1)?.goals ?? [];
    if (!card || !goals.length) return 'KGIを設定した成果物カルテが見つからないため継続できません';
    const prompt = `あなたは通常の担当・確認から独立したCriticです。成果物カルテのKGIを、作業場所の実物を読んで測定してください。担当AIの報告や完了宣言を根拠にしないでください。測定できないKGIは current を null にし、推測の数値を書かないでください。\n確定企画:\n${clip(item.planText, 4000)}\nKGI:\n${goals.map((goal) => `- id=${goal.id} ${goal.label}: 目標 ${goal.target}${goal.unit} / 前回 ${goal.current ?? '未測定'}${goal.unit}（根拠: ${clip(goal.evidence, 200) || 'なし'}）`).join('\n')}\n今回のサイクルの納品:\n${clip(delivery, 3000)}\nJSONのみで {"goals":[{"id":"...","current":数値またはnull,"evidence":"測定した方法と結果"}]} と返してください。`;
    const response = await this.callAgent(id, 'kgi_check', 'critic', prompt, 'read', signal);
    const measured = parseKgi(response.text, goals);
    if (this.projectService) await this.projectService.recordKgiMeasurement(item.projectId, card.id, id, measured);
    const kgi: KgiMeasurement[] = goals.map((goal) => {
      const entry = measured.find((value) => value.goalId === goal.id);
      const current = entry?.current ?? null;
      return {
        goalId: goal.id, label: goal.label, target: goal.target, current, unit: goal.unit,
        evidence: entry?.evidence ?? '', met: current !== null && current >= goal.target,
      };
    });
    const snapshot = this.store.get(id);
    const startedAt = snapshot.cycles?.at(-1)?.endedAt ?? snapshot.planConfirmedAt ?? snapshot.createdAt;
    const runs = snapshot.runs.filter((run) => run.startedAt >= startedAt);
    const record: CycleRecord = {
      index: cycleIndex, startedAt, endedAt: new Date().toISOString(), delivery: clip(delivery, 4000), kgi,
      acceptedArtifacts: snapshot.artifacts.filter((artifact) => artifact.status === 'accepted' && artifact.detectedAt >= startedAt).length,
      calls: runs.length, tokens: runs.reduce((sum, run) => sum + (run.tokens ?? 0), 0),
    };
    const updated = await this.store.update(id, (current) => { current.cycles ??= []; current.cycles.push(record); });
    await this.event(id, 'state', `KGI測定（サイクル${cycleIndex}）: ${kgi.map((goal) => `${goal.label} ${goal.current ?? '未測定'}/${goal.target}${goal.unit}`).join('、')}`);
    if (kgi.every((goal) => goal.met)) return 'KGIを達成しました';
    if (updated.cycles!.length >= autonomy.maxCycles) return `サイクル数の上限（${autonomy.maxCycles}）に達しました`;
    if (stagnant(updated.cycles!)) return '無進捗: 3サイクル連続で採用ファイルもKGIの改善もありません';
    const latest = this.repo.getProject(item.projectId)?.artifactCards?.find((entry) => entry.id === card.id)?.versions.at(-1);
    const backlog = [...(latest?.backlog ?? []), ...(latest?.knownIssues ?? [])].slice(0, 10);
    const unmet = kgi.filter((goal) => !goal.met).map((goal) => `${goal.label} ${goal.current ?? '未測定'}/${goal.target}${goal.unit}`);
    const next = cycleIndex + 1;
    await this.store.update(id, (current) => {
      current.revisionRequests.push(`継続サイクル${next}: KGIが未達です（${unmet.join('、')}）。${backlog.length ? `成果物カルテの改善バックログ: ${backlog.join('、')}。` : ''}前のサイクルで完了した仕事を繰り返さず、KGIを上げるための最小限の仕事を追加してください。KGIが測定できない場合は、測定できる状態にする仕事を含めてください。`);
      current.cycle = next;
    });
    await this.event(id, 'state', `KGI未達のため継続サイクル${next}を開始します`);
    return null;
  }

  async pause(id: string): Promise<Commission> {
    const item = this.store.get(id);
    if (item.status !== 'running') throw new Error('実行中の案件ではありません');
    const updated = await this.store.update(id, (current) => { current.status = 'paused'; });
    this.active.get(id)?.abort();
    await this.executions.get(id);
    await this.event(id, 'state', '実行を一時停止しました');
    return updated;
  }

  async stop(id: string): Promise<Commission> {
    const item = this.store.get(id);
    const retryPending = item.status === 'failed' && Boolean(item.autoRetry?.nextAt);
    if (item.status !== 'running' && !retryPending) throw new Error('実行中の案件ではありません');
    this.cancelRetry(id);
    const updated = await this.store.update(id, (current) => { current.status = 'stopped'; current.autoRetry = undefined; });
    this.active.get(id)?.abort();
    await this.executions.get(id);
    await this.event(id, 'state', '実行を停止しました。再開する場合は内容を確認してください');
    return updated;
  }

  async resume(id: string, options: { auto?: boolean } = {}): Promise<Commission> {
    const item = this.store.get(id);
    if (!['paused', 'stopped', 'interrupted', 'failed'].includes(item.status)) throw new Error('再開できる案件ではありません');
    this.cancelRetry(id);
    const updated = await this.store.update(id, (current) => {
      current.status = 'running'; current.error = undefined; current.stopReason = undefined;
      current.autoRetry = options.auto && current.autoRetry ? { count: current.autoRetry.count } : undefined;
      for (const work of current.workItems) {
        if (work.status === 'running' || work.status === 'review_pending' || work.status === 'interrupted') work.status = 'queued';
        if (options.auto && (work.status === 'failed' || (work.status === 'queued' && work.attempts >= 2))) {
          work.status = 'queued';
          work.attempts = 0;
        }
      }
    });
    await this.event(id, 'state', options.auto ? '無人運用: 人間の操作なしで再開しました' : '案件を再開しました');
    this.start(id);
    return updated;
  }

  async requestRevision(id: string, text: string): Promise<Commission> {
    const revision = requiredText(text, '修正内容', 6000);
    const item = this.store.get(id);
    if (item.status !== 'delivered') throw new Error('納品済みの案件ではありません');
    const updated = await this.store.update(id, (current) => {
      current.revisionRequests.push(revision);
      current.delivery = undefined;
      current.status = 'running';
      current.stopReason = undefined;
    });
    await this.event(id, 'state', '発注者の修正依頼を受け、追加作業を開始しました');
    this.start(id);
    return updated;
  }
}
