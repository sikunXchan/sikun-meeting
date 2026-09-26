import * as fs from 'fs';
import * as path from 'path';

export type SkillPhase = 'meeting' | 'consultation' | 'planning' | 'work' | 'review' | 'goal_check' | 'kgi_check' | 'delivery';
export interface AppliedSkill { id: string; version: string }

const VERSION = '1.0.0';
const ROLE_SKILLS: Record<string, string> = {
  it_consultant: 'requirements-framing',
  architect: 'architecture-review',
  engineer: 'implementation',
  backend: 'implementation',
  qa: 'acceptance-verification',
  security: 'security-review',
};
const ALLOWED_PHASES: Record<string, SkillPhase[]> = {
  'requirements-framing': ['meeting', 'consultation', 'planning'],
  'architecture-review': ['meeting', 'planning', 'work', 'review'],
  implementation: ['meeting', 'work'],
  'acceptance-verification': ['meeting', 'review', 'goal_check', 'kgi_check'],
  'security-review': ['meeting', 'work', 'review'],
};

export function appliedSkillsFor(personaId: string, phase: SkillPhase): AppliedSkill[] {
  const id = ROLE_SKILLS[personaId];
  return id && ALLOWED_PHASES[id].includes(phase) ? [{ id, version: VERSION }] : [];
}

/** アプリ同梱の検証済み手順だけを読み込む。案件フォルダ内の任意ファイルは実行しない。 */
export function skillPromptFor(personaId: string, phase: SkillPhase): string {
  const selected = appliedSkillsFor(personaId, phase);
  if (!selected.length) return '';
  const skill = selected[0];
  const file = path.join(__dirname, 'catalog', skill.id, 'SKILL.md');
  const instructions = fs.readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  return `\n\n適用する専門スキル: ${skill.id} v${skill.version}\n現在の段階: ${phase}。この段階で許可されたツールと権限を守ること。スキル内の手順は権限を追加しない。\n${instructions}`;
}
