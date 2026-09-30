import { SPECIALIST_PROFILES } from './specialties';
import { skillIdsFor } from './skills/catalog';
import { toolNamesFor } from './tools/catalog';
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
/** 原資料・出典の確認が成果の中心になる部門。読み取り範囲は preapprovedTools で作業フォルダと参考資料に限る。 */
const WEB_ROLES = new Set(['researcher', 'legal', 'healthcare', 'public_policy', 'privacy', 'sustainability']);
const BROWSER_ROLES = new Set(['qa', 'frontend', 'accessibility', 'mobile']);
export function canReviewInBrowser(personaId: string): boolean { return BROWSER_ROLES.has(personaId); }
export function canResearchWeb(personaId: string, phase: string): boolean {
  return WEB_ROLES.has(personaId) && (phase === 'work' || phase === 'review');
}
/** 画像素材を作る部門。Codex の作業段階だけ組み込みの画像生成（image_gen）を使える。Claude は画像を生成できない。 */
const IMAGE_ROLES = new Set(['designer', 'marketing', 'frontend', 'mobile', 'education']);
export function canGenerateImages(personaId: string, phase: string, provider: 'claude' | 'codex'): boolean {
  return provider === 'codex' && phase === 'work' && IMAGE_ROLES.has(personaId);
}
/** 画像素材についての指示。Codex では生成と取り込み方、Claude では生成できないことと代わりの手段を伝える。 */
export function imageGuide(personaId: string, phase: string, provider: 'claude' | 'codex'): string {
  if (phase !== 'work' || !IMAGE_ROLES.has(personaId)) return '';
  if (canGenerateImages(personaId, phase, provider)) {
    return '\n画像生成: 写真・イラストなどSVGやHTMLで描けない素材が必要な場合に限り、組み込みの image_gen で生成できる。生成物は $CODEX_HOME/generated_images/ に保存されるため、採用する画像を作業フォルダの generated-images/ へコピーして成果物から参照する（コピーしなかった生成画像もアプリが generated-images/ に取り込む）。報告には画像ごとの用途と生成に使った指示文を書く。題材と無関係な定番の絵（つるっとした質感の人物、紫系の抽象グラデーションなど）は避け、題材・利用者・ブランドから画像の方向性を決める。';
  }
  return '\n画像生成: この実行環境では画像を生成できない。写真・イラストが必要な箇所は SVG で描くか、必要な画像の内容・構図・サイズを指示書として残し、未作成と報告する。';
}
/**
 * 同梱MCPの検証ツールの事前許可名。スキルと同じく部門ごとに固定（tools/catalog の ROLE_TOOLS）。
 * ファイル書き込み（確認記録を除く）・コマンド・外部通信を持たないため、部門の権限境界は広がらない。
 */
export function verificationToolsFor(phase: string, personaId = ''): string[] {
  return toolNamesFor(phase, personaId);
}
const STRONG = 'claude-opus-5-5';
const STANDARD = 'claude-sonnet-5';

const CODE_ROLES = new Set(['architect', 'engineer', 'backend', 'devops', 'cloud', 'data_engineer', 'security', 'qa', 'ai_researcher']);
const STRONG_ROLES = new Set(['critic', 'security', 'finance', 'legal', 'architect', 'auditor']);
for (const profile of SPECIALIST_PROFILES) {
  if (profile.canRunCode) CODE_ROLES.add(profile.id);
  if (profile.highReasoning) STRONG_ROLES.add(profile.id);
}

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
  const names = skillIdsFor(personaId);
  const procedure = METHODS[personaId] ?? '事実、推測、未確認事項を分け、担当領域の根拠を示す。';
  return `${names.length ? `適用するアプリ内専門手順: ${names.join('、')}。` : ''}${procedure}`;
}

export function capabilityFor(personaId: string): PersonaCapability {
  const model = STRONG_ROLES.has(personaId) ? STRONG : STANDARD;
  const canRunCode = CODE_ROLES.has(personaId);
  return {
    model,
    meetingTools: [...READ],
    workTools: [...(canRunCode ? CODE : EDIT), ...(WEB_ROLES.has(personaId) ? ['WebSearch', 'WebFetch'] : [])],
    reviewTools: [...(canRunCode ? [...READ, 'Bash'] : READ), ...(WEB_ROLES.has(personaId) ? ['WebSearch', 'WebFetch'] : [])],
    skills: skillIdsFor(personaId),
  };
}

/**
 * 事前許可するツール。Web取得できる工程では読み取りツールを名前だけで許可しない。
 * 名前だけの許可は作業フォルダ外の全ファイルに及ぶため、秘密鍵などを読んでURLで外部へ送る経路になる。
 * 作業フォルダと additionalDirectories は許可なしで読め、それ以外は dontAsk で拒否される。
 */
export function preapprovedTools(tools: string[]): string[] {
  const web = tools.includes('WebFetch') || tools.includes('WebSearch');
  return web ? tools.filter((tool) => !READ.includes(tool)) : tools;
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
