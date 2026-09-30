export type CommissionStatus = 'consulting' | 'running' | 'paused' | 'stopped' | 'interrupted' | 'delivered' | 'failed';
export type WorkStatus = 'queued' | 'running' | 'review_pending' | 'accepted' | 'failed' | 'interrupted';
export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted';
export type CommissionProvider = 'claude' | 'codex';

export interface ConsultationMessage {
  id: string;
  speaker: 'human' | 'it_consultant';
  content: string;
  createdAt: string;
}

export interface AutonomySettings {
  enabled: boolean;
  continuous: boolean;
  maxTokens: number | null;
  deadline: string | null;
  maxCycles: number;
  retryLimit: number;
}

export interface CommissionSettings {
  executionMode: 'automatic' | 'review';
  provider: CommissionProvider;
  codexModel: string;
  consultantModel: string;
  plannerModel: string;
  workerModel: string;
  reviewerModel: string;
  criticalModel: string;
  fallbackModel: string;
  maxCalls: number;
  maxTurnsPerCall: number;
  modelByPersona: Record<string, string>;
  autonomy?: AutonomySettings;
}

export interface WorkItem {
  id: string;
  title: string;
  instructions: string;
  acceptance: string;
  ownerPersonaId: string;
  domainPersonaId: string;
  reviewerPersonaId: string;
  critical: boolean;
  status: WorkStatus;
  result?: string;
  review?: string;
  attempts: number;
  cycle?: number;
}

export interface Artifact {
  id: string;
  workItemId: string;
  runId: string;
  relativePath: string;
  change: 'added' | 'modified' | 'deleted';
  beforeHash?: string;
  afterHash?: string;
  status: 'proposed' | 'accepted';
  detectedAt: string;
}

export interface WorkDecision {
  id: string;
  workItemId: string;
  domainPersonaId: string;
  proposedByPersonaId: string;
  reviewerPersonaId: string;
  rationale: string;
  status: 'proposed' | 'accepted' | 'rejected';
  decidedAt?: string;
}

import type { CriterionRecord } from '../tools/review';

export interface ReviewDecision {
  id: string;
  workItemId: string;
  /** 旧記録には存在しない。推測で補完せず、対応が明示された判定だけを集計する。 */
  workRunId?: string;
  reviewRunId?: string;
  reviewerPersonaId: string;
  approved: boolean;
  note: string;
  /** 確認役が record_criterion で記録した受け入れ条件ごとの判定。 */
  criteria?: CriterionRecord[];
  artifactIds: string[];
  decidedAt: string;
}

export interface ProjectMemory {
  id: string;
  workItemId: string;
  summary: string;
  artifactPaths: string[];
  createdAt: string;
}

export interface AgentRun {
  id: string;
  /** 確認段階で記録された受け入れ条件ごとの判定。 */
  criteria?: CriterionRecord[];
  provider?: CommissionProvider;
  phase: 'consultation' | 'planning' | 'work' | 'review' | 'goal_check' | 'kgi_check' | 'delivery';
  workItemId?: string;
  personaId: string;
  appliedSkills?: { id: string; version: string }[];
  requestedModel: string;
  observedModels: string[];
  effectiveModel?: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  result?: string;
  error?: string;
  estimatedCostUsd: number;
  numTurns: number;
  tokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
}

export interface ActivityEvent {
  id: string;
  commissionId: string;
  runId?: string;
  at: string;
  kind: 'state' | 'tool' | 'message' | 'error';
  detail: string;
}

export interface Commission {
  referenceFiles?: string[];
  id: string;
  projectId: string;
  artifactCardId?: string;
  successCriteria?: string;
  sourceActionItem?: { meetingId: string; actionItemId: string };
  sourceCommunityPostId?: string;
  goal: string;
  workingDirectory: string;
  status: CommissionStatus;
  createdAt: string;
  updatedAt: string;
  consultation: ConsultationMessage[];
  planText: string;
  planConfirmedAt?: string;
  settings: CommissionSettings;
  workItems: WorkItem[];
  artifacts: Artifact[];
  workDecisions: WorkDecision[];
  reviewDecisions: ReviewDecision[];
  memories: ProjectMemory[];
  goalChecks?: GoalCheck[];
  runs: AgentRun[];
  delivery?: string;
  revisionRequests: string[];
  plannedRevisionCount: number;
  error?: string;
  cycle?: number;
  cycles?: CycleRecord[];
  stopReason?: string;
  autoRetry?: { count: number; nextAt?: string };
}

export interface KgiMeasurement {
  goalId: string;
  label: string;
  target: number;
  current: number | null;
  unit: string;
  evidence: string;
  met: boolean;
}

export interface CycleRecord {
  index: number;
  startedAt: string;
  endedAt: string;
  delivery: string;
  kgi: KgiMeasurement[];
  acceptedArtifacts: number;
  calls: number;
  tokens: number;
}

export interface GoalCheck {
  id: string;
  checkedAt: string;
  complete: boolean;
  evidence: string[];
  remaining: string[];
  workItemCount: number;
  reviewerPersonaId: 'critic';
  cycle?: number;
}

export interface AgentRequest {
  provider: CommissionProvider;
  phase: AgentRun['phase'];
  personaId: string;
  prompt: string;
  workingDirectory: string;
  model: string;
  fallbackModel?: string;
  tools: 'read' | 'full';
  /** 作業フォルダ以外で読み取りを認めるフォルダ（参考資料の保存先など）。絶対パス。 */
  readableDirectories?: string[];
  /** 確認段階で受け入れ条件の判定を記録するファイル（アプリのデータ領域）。 */
  reviewFile?: string;
  /** 出典の記録先（案件ごと、アプリのデータ領域）。 */
  sourcesFile?: string;
  maxTurns: number;
  abortSignal: AbortSignal;
  onTool?: (detail: string) => void | Promise<void>;
}

export interface AgentResponse {
  text: string;
  /** アプリが確認記録ファイルから読んだ判定（エージェントは返さない）。 */
  criteria?: CriterionRecord[];
  observedModels: string[];
  effectiveModel?: string;
  estimatedCostUsd: number;
  numTurns: number;
  tokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
}

export interface AgentClient {
  run(request: AgentRequest): Promise<AgentResponse>;
}
