/** 実行時に参照する部門別能力。プロンプト上の肩書きだけで権限を決めない。 */
export interface PersonaCapability {
  model: string;
  meetingTools: string[];
  workTools: string[];
  reviewTools: string[];
  skills: string[];
}

const READ = ['Read', 'Grep', 'Glob'];
const EDIT = [...READ, 'Edit', 'Write'];
const CODE = [...EDIT, 'Bash'];
const STRONG = 'claude-opus-5-5';
const STANDARD = 'claude-sonnet-5';
const FAST = 'claude-haiku-4-5-20251001';

const CODE_ROLES = new Set(['architect', 'engineer', 'backend', 'devops', 'cloud', 'data_engineer', 'security', 'qa', 'ai_researcher']);
const STRONG_ROLES = new Set(['critic', 'security', 'finance', 'legal', 'architect', 'auditor']);
const FAST_ROLES = new Set(['innovator']);
const SKILLS: Record<string, string[]> = {
  architect: ['design-review'], engineer: ['implementation'], backend: ['implementation'],
  devops: ['operations'], cloud: ['operations'], security: ['security-review'],
  qa: ['verification'], finance: ['financial-review'], legal: ['legal-review'],
  researcher: ['source-check'], writer: ['documentation'], designer: ['interface-review'],
  critic: ['counterargument'], innovator: ['idea-generation'],
};

const METHODS: Record<string, string> = {
  critic: '独立して反証し、反対理由が解消された証拠がない限り撤回しない。',
  innovator: '複数の発想を出し、実現可能性が未確認ならその旨を付ける。',
  security: '権限境界、秘密情報、外部副作用、復旧方法を点検する。',
  finance: '金額・期間・仮定を分け、計算と根拠を確認する。',
  legal: '適用法域と原資料の確認状況を明記し、未確認事項を残す。',
  qa: '受け入れ条件に対応する実測結果を示し、未実行の試験を合格扱いにしない。',
  researcher: '出典、日付、引用箇所を記録し、推測と確認済み事実を分ける。',
};

export function methodFor(personaId: string): string {
  const names = SKILLS[personaId] ?? [];
  const procedure = METHODS[personaId] ?? '事実、推測、未確認事項を分け、担当領域の根拠を示す。';
  return `${names.length ? `適用するアプリ内専門手順: ${names.join('、')}。` : ''}${procedure}`;
}

export function capabilityFor(personaId: string): PersonaCapability {
  const model = STRONG_ROLES.has(personaId) ? STRONG : FAST_ROLES.has(personaId) ? FAST : STANDARD;
  const canRunCode = CODE_ROLES.has(personaId);
  return {
    model,
    meetingTools: [...READ],
    workTools: canRunCode ? [...CODE] : [...EDIT],
    reviewTools: canRunCode ? [...READ, 'Bash'] : [...READ],
    skills: SKILLS[personaId] ?? [],
  };
}

export function approvedTools(personaId: string, phase: 'meeting' | 'read' | 'work' | 'review'): string[] {
  const capability = capabilityFor(personaId);
  if (phase === 'meeting' || phase === 'read') return capability.meetingTools;
  return phase === 'review' ? capability.reviewTools : capability.workTools;
}

export interface CodexPolicy {
  sandboxMode: 'read-only' | 'workspace-write';
  networkAccessEnabled: boolean;
  canRunCode: boolean;
}

/** Codex SDKは個別ツールを許可できないため、書き込み範囲とネットワークで部門差を表す。 */
export function codexPolicy(personaId: string, phase: 'meeting' | 'read' | 'work' | 'review'): CodexPolicy {
  const canRunCode = CODE_ROLES.has(personaId);
  if (phase === 'meeting' || phase === 'read') return { sandboxMode: 'read-only', networkAccessEnabled: false, canRunCode };
  if (phase === 'review') return { sandboxMode: 'read-only', networkAccessEnabled: canRunCode, canRunCode };
  return { sandboxMode: 'workspace-write', networkAccessEnabled: canRunCode, canRunCode };
}
