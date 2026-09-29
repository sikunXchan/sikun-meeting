# 見本の全専門分野（0.8.5）

見本2枚に含まれる38分野をすべて登録。DataEngineerは2枚に重複しているため1分野として扱う。相談役IT Consultantを含めた登録数は39体。

追加した17分野: FrontendEngineer、MobileEngineer、EmbeddedEngineer、AccessibilitySpecialist、PrivacySpecialist、Sales、DataScientist、HumanResources、Procurement、Accountant、HealthcareSpecialist、LocalizationSpecialist、PublicPolicySpecialist、ManufacturingSpecialist、LogisticsSpecialist、SustainabilitySpecialist、EducationSpecialist。

提供された画像の既存切り出しを使用。既存キャラクター、紫基調、丸い机、依頼のタブ構成は維持。

## 実行への接続

- personasに登録し、会議・招集・個別質問・コミュニティ・モバイルの既存経路で参照可能。
- specialtiesで分野ごとの成果物、作業手順、確認基準、確認役候補を定義。
- 部門別の実行権限と専門手順をClaude／Codexの既存クライアントに接続。適用した専門手順は実行履歴にも記録。
- 依頼の計画に専門内容と成果物の例を渡し、汎用開発担当への一律割り当てを避ける。実装・計算の支援が必要なら技術担当が作業し、専門分野の担当者が確認する。
- 6つの会議構成を追加。Web・モバイル、データ分析、営業・人事・経理、製造・調達・物流、医療・教育・公共、海外展開・多言語。
- メンバー選択に名前・専門分野の検索を追加。絞り込んでも選択済みメンバーは保持。

## 検証

全85テストが成功。新17分野の担当作業、別の担当者の成果物に対する所管レビュー、自動納品、保存・復元、39体の会議、個別質問、PWAへのスナップショット変換、Claude実行クライアントへの専門手順とツール設定を検証。

AI応答は模擬。各分野の実案件における成果品質や外部情報の正しさを保証する試験ではない。利用できない資料・機器・外部サービスが必要な検証は、未確認として報告するよう専門手順に明記。
PWA用画像とキャッシュ版はローカルの公開用ファイルに同期。PWA公開サイトのデプロイはこの変更には含まない。
