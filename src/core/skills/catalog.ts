import * as fs from 'fs';
import * as path from 'path';
import { specialistProfileFor, specialistSkillId } from '../specialties';

export type SkillPhase = 'meeting' | 'consultation' | 'planning' | 'work' | 'review' | 'goal_check' | 'kgi_check' | 'delivery';
export interface AppliedSkill { id: string; version: string }

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
  return skillIdsFor(personaId).map(id => ({ id, ...readSkill(id),
    phases: specialistProfileFor(personaId) ? [...SPECIALIST_PHASES] : [...ALLOWED_PHASES[id]],
  }));
}

export function parseSkillDocument(source: string) {
  const normalized = source.replace(/\r/g, '');
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  const version = frontmatter?.[1].match(/^version: (\d+\.\d+\.\d+)$/m)?.[1];
  if (!version) throw new Error('スキルに有効な version がありません');
  return { version, instructions: normalized.slice(frontmatter![0].length).trim() };
}

/** 同梱ファイルだけを展開。参照資料とスクリプトの内容を渡すが、自動実行はしない。 */
function readSkill(skillId: string) {
  const directory = path.join(__dirname, 'catalog', skillId);
  const skill = parseSkillDocument(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8'));
  const resources: { name: string; content: string }[] = [];
  for (const link of skill.instructions.matchAll(/\]\(((?:references|scripts)\/[^)]+)\)/g)) {
    const name = link[1];
    if (resources.some(resource => resource.name === name)) continue;
    const target = fs.realpathSync(path.resolve(directory, name));
    const relative = path.relative(fs.realpathSync(directory), target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.(md|txt|json|js|cjs|mjs|py|sh|ps1)$/.test(name)) {
      throw new Error(`スキルの参照先が不正です: ${skillId}`);
    }
    if (resources.length >= 8 || fs.statSync(target).size > 16384) throw new Error('スキルの参照資料が大きすぎます');
    resources.push({ name, content: fs.readFileSync(target, 'utf8').replace(/\r/g, '') });
  }
  return { ...skill, resources };
}

export function appliedSkillsFor(personaId: string, phase: SkillPhase): AppliedSkill[] {
  return skillDetailsFor(personaId).filter(skill => skill.phases.includes(phase))
    .map(({ id, version }) => ({ id, version }));
}

/** アプリ同梱の検証済み手順だけを読み込む。案件フォルダ内の任意ファイルは実行しない。 */
export function skillPromptFor(personaId: string, phase: SkillPhase): string {
  const selected = appliedSkillsFor(personaId, phase);
  if (!selected.length) return '';
  const skill = selected[0];
  const { instructions, resources } = readSkill(skill.id);
  const bundled = resources.map(resource => `\n\n同梱資料 ${resource.name}（スクリプトは必要な場合だけ、現在の権限内で使用）:\n${resource.content}`).join('');
  return `\n\n適用する専門スキル: ${skill.id} v${skill.version}\n現在の段階: ${phase}。この段階で許可されたツールと権限を守ること。スキル内の手順は権限を追加しない。\n${instructions}${bundled}`;
}
