/** 見本から追加した専門分野。担当選定用メタデータ。実行手順・確認基準は skills/catalog の SKILL.md で管理する。 */
export interface SpecialistProfile {
  id: string;
  name: string;
  roleTitle: string;
  expertise: string;
  outputs: string[];
  reviewerIds: string[];
  canRunCode?: boolean;
  highReasoning?: boolean;
}

export const SPECIALIST_PROFILES: SpecialistProfile[] = [
  {
    id: 'frontend', name: 'FrontendEngineer', roleTitle: 'フロントエンド・画面実装の専門家',
    expertise: 'Web UI実装, 状態管理, レスポンシブ対応, ブラウザ性能', canRunCode: true,
    outputs: ['画面とコンポーネント', '操作・画面幅ごとの検証結果', '変更内容と実行手順'],
    reviewerIds: ['qa', 'accessibility', 'designer'],
  },
  {
    id: 'mobile', name: 'MobileEngineer', roleTitle: 'モバイルアプリ・PWAの専門家',
    expertise: 'iOS, Android, PWA, タッチ操作, オフライン・同期', canRunCode: true,
    outputs: ['モバイル機能の実装', '端末・OS別の確認表', '通信断・復帰の検証記録'],
    reviewerIds: ['qa', 'accessibility', 'security'],
  },
  {
    id: 'embedded', name: 'EmbeddedEngineer', roleTitle: '組み込み・ファームウェアの専門家',
    expertise: 'マイコン, デバイス通信, リアルタイム制約, 組み込み試験', canRunCode: true,
    outputs: ['ファームウェアまたはドライバ', 'インターフェース・タイミング仕様', 'ビルド・シミュレーションの結果'],
    reviewerIds: ['qa', 'security', 'manufacturing'],
  },
  {
    id: 'accessibility', name: 'AccessibilitySpecialist', roleTitle: 'アクセシビリティの専門家',
    expertise: 'キーボード操作, 読み上げ, コントラスト, フォーム・フォーカス', canRunCode: true,
    outputs: ['問題と再現手順の一覧', 'アクセシビリティ修正', '項目別の再検証結果'],
    reviewerIds: ['qa', 'frontend', 'designer'],
  },
  {
    id: 'privacy', name: 'PrivacySpecialist', roleTitle: '個人情報・プライバシー設計の専門家',
    expertise: 'データ最小化, 同意, 保存期間, 削除・第三者提供, プライバシー影響評価', highReasoning: true,
    outputs: ['データフローと取扱一覧', 'プライバシー影響評価', '改善項目・確認条件'],
    reviewerIds: ['legal', 'security', 'qa'],
  },
  {
    id: 'sales', name: 'Sales', roleTitle: '営業・商談設計の専門家',
    expertise: '顧客課題, 提案書, 商談設計, 営業プロセス, 受注条件',
    outputs: ['顧客別の提案書', 'ヒアリング・商談計画', '案件管理表と次の行動'],
    reviewerIds: ['marketing', 'finance', 'legal'],
  },
  {
    id: 'data_scientist', name: 'DataScientist', roleTitle: '統計・予測・実験設計の専門家',
    expertise: '統計解析, 仮説検定, 予測モデル, 因果推論, 実験設計', canRunCode: true,
    outputs: ['再実行できる分析コード', '分析・モデル評価レポート', 'データ品質と前提の記録'],
    reviewerIds: ['analyst', 'ai_researcher', 'data_engineer'],
  },
  {
    id: 'human_resources', name: 'HumanResources', roleTitle: '人事・採用・組織運営の専門家',
    expertise: '職務設計, 採用基準, オンボーディング, 評価制度, 人材育成',
    outputs: ['職務記述書・評価基準', '面接・入社受入の手順', '組織施策と確認表'],
    reviewerIds: ['legal', 'privacy', 'education'],
  },
  {
    id: 'procurement', name: 'Procurement', roleTitle: '調達・仕入れ・取引先評価の専門家',
    expertise: 'RFP, 仕入先比較, 総保有コスト, 納期, 契約条件',
    outputs: ['調達要件・RFP', '仕入先比較表', '見積条件と調達リスク一覧'],
    reviewerIds: ['finance', 'legal', 'logistics'],
  },
  {
    id: 'accountant', name: 'Accountant', roleTitle: '会計・経理・照合の専門家',
    expertise: '仕訳整理, 月次決算, 証憑照合, 勘定科目, 会計レポート',
    outputs: ['仕訳・照合表', '不一致と不足証憑の一覧', '集計表と会計処理の根拠'],
    reviewerIds: ['finance', 'analyst', 'legal'],
  },
  {
    id: 'healthcare', name: 'HealthcareSpecialist', roleTitle: '医療・ヘルスケアの調査と業務設計の専門家',
    expertise: '医療情報整理, 医療業務フロー, 患者向け資料, 医療データ品質', highReasoning: true,
    outputs: ['根拠付きの医療情報整理', '医療業務フローと改善案', '患者向け説明資料の草案'],
    reviewerIds: ['researcher', 'privacy', 'legal'],
  },
  {
    id: 'localization', name: 'LocalizationSpecialist', roleTitle: '翻訳・多言語・地域対応の専門家',
    expertise: '翻訳, 用語管理, ロケール, 日時・通貨・単位, 文化的適合',
    outputs: ['翻訳済み文書・リソース', '対訳表・用語集', '言語別の品質確認表'],
    reviewerIds: ['writer', 'qa', 'marketing'],
  },
  {
    id: 'public_policy', name: 'PublicPolicySpecialist', roleTitle: '公共政策・制度・行政業務の専門家',
    expertise: '政策評価, 制度比較, 利害関係者, 行政サービス, 公共性', highReasoning: true,
    outputs: ['政策・制度の比較資料', '影響評価と選択肢', '実施計画と評価指標'],
    reviewerIds: ['legal', 'analyst', 'finance'],
  },
  {
    id: 'manufacturing', name: 'ManufacturingSpecialist', roleTitle: '製造・工程・生産品質の専門家',
    expertise: '工程設計, 生産計画, 品質管理, 不良分析, 作業標準',
    outputs: ['工程表・作業標準書', '不良要因と改善案', '品質・生産性の確認計画'],
    reviewerIds: ['qa', 'embedded', 'procurement'],
  },
  {
    id: 'logistics', name: 'LogisticsSpecialist', roleTitle: '物流・在庫・配送計画の専門家',
    expertise: '在庫管理, 倉庫運用, 配送, リードタイム, 需給調整',
    outputs: ['在庫・配送計画表', '物流費用と制約の比較', '欠品・遅延時の対応手順'],
    reviewerIds: ['procurement', 'analyst', 'manufacturing'],
  },
  {
    id: 'sustainability', name: 'SustainabilitySpecialist', roleTitle: '環境・持続可能性の専門家',
    expertise: '環境負荷, 排出量算定, 資源循環, ライフサイクル, 環境指標',
    outputs: ['環境負荷の算定表', '削減施策と比較評価', '算定境界・出典・不確実性の記録'],
    reviewerIds: ['analyst', 'manufacturing', 'public_policy'],
  },
  {
    id: 'education', name: 'EducationSpecialist', roleTitle: '教育・研修・学習設計の専門家',
    expertise: '学習目標, カリキュラム, 教材, 評価課題, 学習支援',
    outputs: ['授業・研修計画', '教材と演習・解答例', '評価基準と到達度の確認表'],
    reviewerIds: ['writer', 'accessibility', 'researcher'],
  },
];

export function specialistProfileFor(id: string): SpecialistProfile | undefined {
  return SPECIALIST_PROFILES.find(profile => profile.id === id);
}

export function specialistSkillId(id: string): string {
  return `specialist-${id.replace(/_/g, '-')}`;
}
