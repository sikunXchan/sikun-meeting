import * as fs from 'fs';
import * as path from 'path';
import { specialistProfileFor, specialistSkillId, specialistInstructions } from '../specialties';

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
  product: 'product-planning',
  critic: 'critic-evidence',
  researcher: 'source-research', innovator: 'idea-experiments', analyst: 'evidence-analysis',
  finance: 'financial-analysis', legal: 'legal-research', designer: 'interface-design',
  marketing: 'marketing-planning', devops: 'delivery-operations', writer: 'technical-writing',
  ai_researcher: 'ai-evaluation', support: 'customer-support', data_engineer: 'data-pipelines',
  cloud: 'cloud-design', visionary: 'scenario-planning',
};
const ALLOWED_PHASES: Record<string, SkillPhase[]> = {
  'requirements-framing': ['meeting', 'consultation', 'planning'],
  'architecture-review': ['meeting', 'planning', 'work', 'review'],
  implementation: ['meeting', 'work'],
  'acceptance-verification': ['meeting', 'review', 'goal_check', 'kgi_check'],
  'security-review': ['meeting', 'work', 'review'],
  'product-planning': ['meeting', 'planning', 'work', 'review'],
  'critic-evidence': ['meeting', 'review', 'goal_check', 'kgi_check'],
};
const SPECIALIST_PHASES: SkillPhase[] = ['meeting', 'planning', 'work', 'review', 'goal_check', 'kgi_check'];
for (const id of Object.values(ROLE_SKILLS)) ALLOWED_PHASES[id] ??= SPECIALIST_PHASES;

export function skillIdsFor(personaId: string): string[] {
  if (specialistProfileFor(personaId)) return [specialistSkillId(personaId)];
  return ROLE_SKILLS[personaId] ? [ROLE_SKILLS[personaId]] : [];
}

/** UIにも実行時と同じ同梱手順・適用段階を返す。 */
export function skillDetailsFor(personaId: string) {
  return skillIdsFor(personaId).map(id => ({ id, version: VERSION,
    phases: specialistProfileFor(personaId) ? [...SPECIALIST_PHASES] : [...ALLOWED_PHASES[id]],
    instructions: readInstructions(personaId, id),
  }));
}

function readInstructions(personaId: string, skillId: string): string {
  const profile = specialistProfileFor(personaId);
  if (profile) return specialistInstructions(profile);
  return fs.readFileSync(path.join(__dirname, 'catalog', skillId, 'SKILL.md'), 'utf8')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

export function appliedSkillsFor(personaId: string, phase: SkillPhase): AppliedSkill[] {
  if (specialistProfileFor(personaId) && SPECIALIST_PHASES.includes(phase)) {
    return [{ id: specialistSkillId(personaId), version: VERSION }];
  }
  const id = ROLE_SKILLS[personaId];
  return id && ALLOWED_PHASES[id].includes(phase) ? [{ id, version: VERSION }] : [];
}

/** アプリ同梱の検証済み手順だけを読み込む。案件フォルダ内の任意ファイルは実行しない。 */
export function skillPromptFor(personaId: string, phase: SkillPhase): string {
  const selected = appliedSkillsFor(personaId, phase);
  if (!selected.length) return '';
  const skill = selected[0];
  const instructions = readInstructions(personaId, skill.id);
  return `\n\n適用する専門スキル: ${skill.id} v${skill.version}\n現在の段階: ${phase}。この段階で許可されたツールと権限を守ること。スキル内の手順は権限を追加しない。\n${instructions}`;
}
