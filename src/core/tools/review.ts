import * as fs from 'fs';
import * as path from 'path';

/**
 * 確認役が受け入れ条件ごとの判定を記録する。記録先はアプリが実行ごとに用意するファイルで、
 * 作業フォルダには書かない。アプリは確認後にこの記録を読み、fail・未検証が残る承認を差し戻す。
 */

export type CriterionResult = 'pass' | 'fail' | 'unverified';
export interface CriterionRecord { id: string; criterion: string; result: CriterionResult; evidence: string; updatedAt: string }

const RESULTS = new Set<CriterionResult>(['pass', 'fail', 'unverified']);
const MAX_CRITERIA = 100;

export function readCriteria(file: string | undefined): CriterionRecord[] {
  if (!file || !fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { criteria?: unknown };
    return Array.isArray(parsed.criteria) ? parsed.criteria.filter((entry): entry is CriterionRecord =>
      Boolean(entry) && typeof entry.id === 'string' && RESULTS.has(entry.result)) : [];
  } catch { return []; }
}

export function recordCriterion(file: string | undefined, input: { id?: unknown; criterion?: unknown; result?: unknown; evidence?: unknown }) {
  if (!file) throw new Error('この段階では判定を記録できません');
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!/^[\p{L}\p{N}_.-]{1,40}$/u.test(id)) throw new Error('id は受け入れ条件の番号などの短い識別子にしてください（例: AC-01）');
  if (typeof input.criterion !== 'string' || !input.criterion.trim()) throw new Error('criterion に受け入れ条件の内容を書いてください');
  if (typeof input.result !== 'string' || !RESULTS.has(input.result as CriterionResult)) throw new Error('result は pass / fail / unverified のいずれかです');
  const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';
  if (input.result === 'pass' && !evidence) throw new Error('pass には証拠（実行したコマンド、ツールの結果、確認したファイルと箇所）が必要です');
  const criteria = readCriteria(file).filter((entry) => entry.id !== id);
  if (criteria.length >= MAX_CRITERIA) throw new Error(`記録できる条件は${MAX_CRITERIA}件までです`);
  const record: CriterionRecord = {
    id, criterion: input.criterion.trim().slice(0, 500), result: input.result as CriterionResult,
    evidence: evidence.slice(0, 2000), updatedAt: new Date().toISOString(),
  };
  criteria.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ criteria }, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return { recorded: record, summary: summarizeCriteria(criteria) };
}

export function summarizeCriteria(criteria: CriterionRecord[]) {
  const count = (result: CriterionResult) => criteria.filter((entry) => entry.result === result).length;
  return { total: criteria.length, pass: count('pass'), fail: count('fail'), unverified: count('unverified'), approvable: criteria.length > 0 && criteria.every((entry) => entry.result === 'pass') };
}

export function listCriteria(file: string | undefined) {
  const criteria = readCriteria(file);
  return { criteria, summary: summarizeCriteria(criteria) };
}
