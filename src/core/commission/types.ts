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

export interface ReviewDecision {
  id: string;
  workItemId: string;
  reviewerPersonaId: string;
  approved: boolean;
  note: string;
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
  maxTurns: number;
  abortSignal: AbortSignal;
  onTool?: (detail: string) => void | Promise<void>;
}

export interface AgentResponse {
  text: string;
  observedModels: string[];
  effectiveModel?: string;
  estimatedCostUsd: number;
  numTurns: number;
  tokens?: number;
}

export interface AgentClient {
  run(request: AgentRequest): Promise<AgentResponse>;
}
