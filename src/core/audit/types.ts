export interface AuditFinding {
  kind: 'goal' | 'decision' | 'evidence';
  referenceId: string;
  finding: string;
}

export interface AuditRecord {
  id: string;
  projectId: string;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string;
  meetingIds: string[];
  cardVersions: { cardId: string; version: number }[];
  goalProgress: { cardId: string; goalId: string; label: string; target: number; current: number | null; evidence: string; status: 'met' | 'unmet' | 'unverified' }[];
  findings: AuditFinding[];
  assessment: string;
  requestedModel?: string;
  effectiveModel?: string;
}
