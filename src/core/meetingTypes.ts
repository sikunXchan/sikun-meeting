import { MeetingType } from './types';

function specialistMeetingType(id: string, name: string, description: string, defaultPersonaIds: string[]): MeetingType {
  return { id, name, emoji: '', description, focusAreas: [description], defaultPersonaIds,
    protocol: { id: `${id}_protocol`, name: '専門分野の検討', description: '各分野の根拠と懸念を独立に整理し、比較・検討して実施条件をまとめる。',
      turnStrategy: 'structuredRounds', maxAutoRoundsPerAsk: 2, allowRebuttal: true, votingEnabled: false } };
}

/**
 * 会議タイプ registry。
 * 会議タイプごとに「どのAIをデフォルト招集するか」「どう議論を進行するか(protocol)」を切り替える。
 */
export const MEETING_TYPES: MeetingType[] = [
  {
    id: 'steering_committee',
    name: 'Steering Committee',
    emoji: '🏛',
    description: '経営・戦略・KPI・投資判断・リスクを扱う会議',
    focusAreas: ['経営', '戦略', 'KPI', '投資判断', 'リスク'],
    defaultPersonaIds: ['analyst', 'finance', 'legal', 'critic', 'visionary'],
    protocol: {
      id: 'steering_committee_protocol',
      name: '構造化ラウンド + 最終判断',
      description: '意見表明 → 議論 → 論点整理 → 最終判断の順で進行し、各AIの賛否を必ず記録する。',
      turnStrategy: 'structuredRounds',
      maxAutoRoundsPerAsk: 2,
      allowRebuttal: true,
      votingEnabled: true,
    },
  },
  {
    id: 'architecture_review',
    name: 'Architecture Review',
    emoji: '💻',
    description: 'システム設計・技術選定・アーキテクチャレビューを扱う会議',
    focusAreas: ['システム設計', '技術選定', 'アーキテクチャレビュー'],
    defaultPersonaIds: ['architect', 'critic', 'security', 'backend', 'engineer'],
    protocol: {
      id: 'architecture_review_protocol',
      name: '技術討論ラウンド',
      description: '技術的な意見表明→反論→再検討を許可し、最後にDecisionへ収束する。',
      turnStrategy: 'structuredRounds',
      maxAutoRoundsPerAsk: 3,
      allowRebuttal: true,
      votingEnabled: false,
    },
  },
  {
    id: 'product_review',
    name: 'Product Review',
    emoji: '🚀',
    description: 'プロダクト・UX・機能優先度・ユーザー価値を扱う会議',
    focusAreas: ['プロダクト', 'UX', '機能優先度', 'ユーザー価値'],
    defaultPersonaIds: ['product', 'designer', 'marketing', 'researcher', 'critic'],
    protocol: {
      id: 'product_review_protocol',
      name: 'ユーザー価値ラウンド',
      description: 'プロダクト視点を軸にラウンドロビンで意見を集める。',
      turnStrategy: 'roundRobin',
      maxAutoRoundsPerAsk: 2,
      allowRebuttal: true,
      votingEnabled: false,
    },
  },
  {
    id: 'incident_review',
    name: 'Incident Review',
    emoji: '🐛',
    description: '障害分析・原因究明・再発防止を扱う会議',
    focusAreas: ['障害分析', '原因究明', '再発防止'],
    defaultPersonaIds: ['devops', 'security', 'qa', 'architect', 'cloud'],
    protocol: {
      id: 'incident_review_protocol',
      name: '原因究明ラウンド',
      description: '事実整理→原因分析→再発防止策の順に構造化して進行する。',
      turnStrategy: 'structuredRounds',
      maxAutoRoundsPerAsk: 2,
      allowRebuttal: true,
      votingEnabled: false,
    },
  },
  {
    id: 'brainstorming',
    name: 'Brainstorming',
    emoji: '🧪',
    description: 'アイデア創出・アイデア評価・発散と収束を扱う会議',
    focusAreas: ['アイデア創出', 'アイデア評価', '発散・収束'],
    defaultPersonaIds: ['innovator', 'visionary', 'product', 'researcher', 'critic'],
    protocol: {
      id: 'brainstorming_protocol',
      name: '自由発言（発散→収束）',
      description: '発言順を固定せず自由に発言させ、最後にCriticが収束の論点整理を行う。',
      turnStrategy: 'freeForm',
      maxAutoRoundsPerAsk: 1,
      allowRebuttal: false,
      votingEnabled: false,
    },
  },
  {
    id: 'investment_committee',
    name: 'Investment Committee',
    emoji: '💰',
    description: '投資判断・財務分析・市場分析・リスク評価を扱う会議',
    focusAreas: ['投資判断', '財務分析', '市場分析', 'リスク評価'],
    defaultPersonaIds: ['finance', 'analyst', 'researcher', 'legal', 'security'],
    protocol: {
      id: 'investment_committee_protocol',
      name: '財務構造化ラウンド + 投票',
      description: '財務・市場・リスクの順に意見を集め、最後に賛否を投票させてから最高開発者が決定する。',
      turnStrategy: 'structuredRounds',
      maxAutoRoundsPerAsk: 2,
      allowRebuttal: true,
      votingEnabled: true,
    },
  },
  specialistMeetingType('digital_experience', 'Web・モバイル・使いやすさ', '画面実装、モバイル対応、アクセシビリティと個人情報', ['frontend', 'mobile', 'designer', 'accessibility', 'privacy', 'qa']),
  specialistMeetingType('data_science_review', 'データ分析・実験', 'データ品質、統計分析、予測と検証', ['data_scientist', 'data_engineer', 'analyst', 'ai_researcher', 'privacy', 'critic']),
  specialistMeetingType('business_operations', '営業・人事・経理', '営業活動、組織運営、会計と業務改善', ['sales', 'human_resources', 'accountant', 'finance', 'legal', 'product']),
  specialistMeetingType('industrial_operations', '製造・調達・物流', '工程、組み込み、供給、配送と環境負荷', ['manufacturing', 'embedded', 'procurement', 'logistics', 'sustainability', 'qa']),
  specialistMeetingType('public_services', '医療・教育・公共サービス', '医療情報、学習設計、公共政策と利用しやすさ', ['healthcare', 'education', 'public_policy', 'accessibility', 'privacy', 'legal']),
  specialistMeetingType('global_expansion', '海外展開・多言語', '地域別の顧客対応、翻訳、販売と契約条件', ['localization', 'sales', 'marketing', 'legal', 'product', 'support']),
];

export function getMeetingTypeById(id: string): MeetingType | undefined {
  return MEETING_TYPES.find((t) => t.id === id);
}
