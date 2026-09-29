import type { AgentRun, Commission, ReviewDecision } from '../commission/types';

export interface SkillMetric {
  id: string;
  version: string;
  personaId: string;
  phase: 'work' | 'review';
  provider: string;
  model: string;
  runs: number;
  completed: number;
  failed: number;
  interrupted: number;
  running: number;
  reviewed: number;
  returned: number;
  unlinked: number;
  returnRate: number | null;
  commissionCount: number;
}

/** 作業回ごとの内部確認を集計する。完了条件の未達・人間の追加依頼とは分ける。 */
export function skillMetricsFor(commissions: Commission[]) {
  const groups = new Map<string, { metric: SkillMetric; commissions: Set<string> }>();
  let excludedDecisions = 0;
  for (const commission of commissions) {
    const runs = new Map(commission.runs.map(run => [run.id, run]));
    const candidates: ReviewDecision[] = [];
    const counts = new Map<string, number>();
    for (const decision of commission.reviewDecisions ?? []) {
      const work = runs.get(decision.workRunId ?? ''), review = runs.get(decision.reviewRunId ?? '');
      if (!work || !review || work.phase !== 'work' || review.phase !== 'review'
          || work.status !== 'completed' || review.status !== 'completed'
          || work.workItemId !== decision.workItemId || review.workItemId !== decision.workItemId
          || review.personaId !== decision.reviewerPersonaId || typeof decision.approved !== 'boolean') {
        excludedDecisions++;
        continue;
      }
      candidates.push(decision);
      for (const id of [work.id, review.id]) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const outcomes = new Map<string, boolean>();
    for (const decision of candidates) {
      if (counts.get(decision.workRunId!) !== 1 || counts.get(decision.reviewRunId!) !== 1) {
        excludedDecisions++;
        continue; // 重複・矛盾する判定を二重計上しない。
      }
      outcomes.set(decision.workRunId!, decision.approved);
      outcomes.set(decision.reviewRunId!, decision.approved);
    }
    for (const run of commission.runs) {
      if (run.phase !== 'work' && run.phase !== 'review') continue;
      const seen = new Set<string>();
      for (const skill of run.appliedSkills ?? []) {
        const key = JSON.stringify([skill.id, skill.version, run.personaId, run.phase, run.provider ?? 'unknown', observedModel(run)]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!groups.has(key)) groups.set(key, {
          metric: { ...skill, personaId: run.personaId, phase: run.phase, provider: run.provider ?? 'unknown',
            model: observedModel(run), runs: 0, completed: 0, failed: 0, interrupted: 0, running: 0,
            reviewed: 0, returned: 0, unlinked: 0, returnRate: null, commissionCount: 0 },
          commissions: new Set(),
        });
        const group = groups.get(key)!, metric = group.metric;
        group.commissions.add(commission.id);
        metric.runs++;
        metric[run.status]++;
        if (outcomes.has(run.id)) {
          metric.reviewed++;
          if (!outcomes.get(run.id)) metric.returned++;
        } else if (run.status === 'completed') metric.unlinked++;
      }
    }
  }
  return {
    rows: [...groups.values()].map(({ metric, commissions }) => ({ ...metric,
      returnRate: metric.reviewed ? metric.returned / metric.reviewed : null,
      commissionCount: commissions.size,
    })).sort((a, b) => a.id.localeCompare(b.id) || a.phase.localeCompare(b.phase)
      || b.version.localeCompare(a.version, undefined, { numeric: true })
      || a.personaId.localeCompare(b.personaId) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
    excludedDecisions,
  };
}

function observedModel(run: AgentRun): string {
  // 要求モデルを実際に使ったモデルと見なさない。複数使用した場合も別の比較条件にする。
  const models = [...new Set(run.observedModels ?? [])].sort();
  return models.length > 1 ? models.join(' + ') : run.effectiveModel || models[0] || 'unknown';
}
