# 同梱の検証ツール（MCPサーバー `sikun`）

更新日：2026-09-30

AIが「答えが一つに決まる確認」（計算・集計・照合・引用の実在・差分・色のコントラスト・画面の崩れ）を暗算や目視ではなくツールで行うための、アプリ同梱の stdio MCP サーバー。ClaudeとCodexの両方に同じサーバーを渡す（`src/mcp/stdio.ts`、`src/core/tools/`）。

## 共通の約束

- コマンド実行・外部通信・作業フォルダへの書き込みはしない。記録系（`record_criterion`・`record_source`）だけがアプリのデータ領域に書く。
- 読めるのは作業フォルダと参考資料フォルダの中だけ。シンボリックリンクで外へ出るファイルも拒否する。
- 画面系は作業フォルダのローカルHTMLだけを、外部通信を遮断した分離ブラウザ（Chrome / Edge）で開く。AIが書いたスクリプトは実行しない。
- 近似値（標準偏差・年平均成長率・内部収益率）は結果に approximate と明示する。祝日・為替・税率のように更新が必要なデータは持たない。

## ツール一覧（42個）

| グループ | ツール |
|---|---|
| 計算（8） | calculate, describe_statistics, growth_rate, npv_irr, loan_payment, sensitivity_table, convert_units, calculate_dates |
| 表（6） | read_table, describe_table, query_table, reconcile_tables, validate_table, read_structured_data |
| 文書（8） | extract_text, text_diff, find_quote, text_statistics, check_placeholders, check_links, document_outline, check_terms |
| 配色・画像（6） | color_contrast, color_palette, compare_colors, image_info, compare_images, optimize_svg |
| 画面（4） | screenshot_page, audit_accessibility, check_layout, check_design_patterns |
| コード（5） | test_regex, compare_versions, validate_config, validate_json_schema, explain_cron |
| UI/UXの原則（1） | lookup_ux_principles |
| 出典（2） | record_source, list_sources |
| 確認記録（2） | record_criterion, list_criteria |

## 部門ごとのツール

スキルと同じく、部門ごとに渡すツールを固定する（`src/core/tools/catalog.ts` の `ROLE_TOOLS`）。AIが42個から選ぶ必要をなくすため、部門の仕事で確かめる対象に合うものだけを5〜10個にしている。

- 作業：下表の部門のツールだけ。
- 確認・目標確認・KGI確認：下表に `record_criterion`・`list_criteria` を加える（7〜12個）。目標確認・KGI確認では `record_source` を渡さない。
- 会議・相談・計画・納品：ツールを渡さない。
- 表に無い部門（利用者が追加したAIなど）：calculate, read_table, extract_text, find_quote。
- 同じ一覧はアプリの「専門家のスキル」にも表示する。

| 部門 | 数 | 作業で使うツール |
|---|---|---|
| IT Consultant（it_consultant） | 7 | calculate, calculate_dates, read_table, extract_text, find_quote, text_diff, document_outline |
| Architect（architect） | 7 | calculate, convert_units, extract_text, document_outline, validate_config, validate_json_schema, compare_versions |
| Engineer（engineer） | 8 | calculate, read_structured_data, text_diff, test_regex, compare_versions, validate_config, validate_json_schema, explain_cron |
| Backend（backend） | 9 | calculate, calculate_dates, read_structured_data, text_diff, test_regex, compare_versions, validate_config, validate_json_schema, explain_cron |
| Product（product） | 9 | calculate, growth_rate, sensitivity_table, read_table, query_table, document_outline, screenshot_page, check_layout, lookup_ux_principles |
| Researcher（researcher） | 8 | calculate, growth_rate, read_table, extract_text, find_quote, check_links, record_source, list_sources |
| Critic（critic） | 8 | calculate, read_table, reconcile_tables, extract_text, find_quote, text_diff, screenshot_page, check_layout |
| Security（security） | 8 | read_structured_data, extract_text, find_quote, test_regex, compare_versions, validate_config, validate_json_schema, explain_cron |
| Innovator（innovator） | 6 | calculate, describe_statistics, growth_rate, sensitivity_table, read_table, extract_text |
| Analyst（analyst） | 9 | calculate, describe_statistics, growth_rate, read_table, describe_table, query_table, reconcile_tables, validate_table, extract_text |
| Finance（finance） | 9 | calculate, growth_rate, npv_irr, loan_payment, sensitivity_table, calculate_dates, read_table, query_table, reconcile_tables |
| Legal（legal） | 8 | calculate_dates, extract_text, find_quote, text_diff, document_outline, check_terms, record_source, list_sources |
| Designer（designer） | 10 | color_contrast, color_palette, compare_colors, image_info, compare_images, screenshot_page, audit_accessibility, check_layout, check_design_patterns, lookup_ux_principles |
| Marketing（marketing） | 10 | calculate, growth_rate, sensitivity_table, read_table, query_table, text_statistics, check_terms, color_contrast, image_info, screenshot_page |
| DevOps（devops） | 8 | convert_units, calculate_dates, read_structured_data, test_regex, compare_versions, validate_config, validate_json_schema, explain_cron |
| QA（qa） | 10 | calculate, reconcile_tables, text_diff, compare_images, screenshot_page, audit_accessibility, check_layout, test_regex, validate_config, validate_json_schema |
| TechnicalWriter（writer） | 8 | extract_text, text_diff, find_quote, text_statistics, check_placeholders, check_links, document_outline, check_terms |
| AIResearcher（ai_researcher） | 8 | calculate, describe_statistics, read_table, query_table, reconcile_tables, read_structured_data, text_diff, validate_json_schema |
| CustomerSupport（support） | 7 | calculate_dates, query_table, extract_text, find_quote, text_statistics, document_outline, check_terms |
| DataEngineer（data_engineer） | 10 | read_table, describe_table, query_table, reconcile_tables, validate_table, read_structured_data, test_regex, validate_config, validate_json_schema, explain_cron |
| CloudEngineer（cloud） | 7 | calculate, sensitivity_table, convert_units, compare_versions, validate_config, validate_json_schema, explain_cron |
| Visionary（visionary） | 5 | calculate, describe_statistics, growth_rate, sensitivity_table, extract_text |
| FrontendEngineer（frontend） | 10 | color_contrast, compare_images, optimize_svg, screenshot_page, audit_accessibility, check_layout, test_regex, compare_versions, validate_config, lookup_ux_principles |
| MobileEngineer（mobile） | 9 | color_contrast, image_info, compare_images, screenshot_page, audit_accessibility, check_layout, compare_versions, validate_config, lookup_ux_principles |
| EmbeddedEngineer（embedded） | 6 | calculate, convert_units, read_table, test_regex, compare_versions, validate_config |
| AccessibilitySpecialist（accessibility） | 7 | document_outline, color_contrast, compare_colors, screenshot_page, audit_accessibility, check_layout, lookup_ux_principles |
| PrivacySpecialist（privacy） | 9 | calculate_dates, validate_table, read_structured_data, extract_text, text_diff, find_quote, check_terms, record_source, list_sources |
| Sales（sales） | 6 | calculate, growth_rate, sensitivity_table, calculate_dates, read_table, query_table |
| DataScientist（data_scientist） | 9 | calculate, describe_statistics, growth_rate, sensitivity_table, read_table, describe_table, query_table, reconcile_tables, validate_table |
| HumanResources（human_resources） | 7 | calculate, calculate_dates, read_table, query_table, validate_table, text_statistics, check_terms |
| Procurement（procurement） | 8 | calculate, sensitivity_table, convert_units, calculate_dates, read_table, query_table, reconcile_tables, text_diff |
| Accountant（accountant） | 8 | calculate, loan_payment, calculate_dates, read_table, describe_table, query_table, reconcile_tables, validate_table |
| HealthcareSpecialist（healthcare） | 8 | calculate, describe_statistics, convert_units, calculate_dates, extract_text, find_quote, record_source, list_sources |
| LocalizationSpecialist（localization） | 8 | read_structured_data, extract_text, text_diff, text_statistics, check_placeholders, check_terms, screenshot_page, check_layout |
| PublicPolicySpecialist（public_policy） | 8 | calculate, growth_rate, calculate_dates, read_table, extract_text, find_quote, record_source, list_sources |
| ManufacturingSpecialist（manufacturing） | 7 | calculate, describe_statistics, sensitivity_table, convert_units, calculate_dates, read_table, query_table |
| LogisticsSpecialist（logistics） | 7 | calculate, sensitivity_table, convert_units, calculate_dates, read_table, query_table, reconcile_tables |
| SustainabilitySpecialist（sustainability） | 9 | calculate, growth_rate, convert_units, read_table, query_table, extract_text, find_quote, record_source, list_sources |
| EducationSpecialist（education） | 8 | calculate_dates, extract_text, text_statistics, document_outline, check_terms, color_contrast, screenshot_page, check_layout |

公式資料では、一度に読み込むツールが30〜50個を超えると選択精度が落ちるとされる。部門ごとの固定により、1回に渡す数は最大12個になった（以前は最大38個）。

`check_design_patterns` は、次の2つを所見として返す（良し悪しは判定しない）。
- 絵文字：本文・aria-label・alt・::before/::after の中から探す。© や ™、矢印のような記号は数えない。
- 題材に関係なく出やすい定番の型：同じ角丸と影のカードの割合、英大文字の小ラベル、見出しの一部だけの強調、01/02 番号、グラデーション、アニメーション、書体の割合。

定番の型の例は、Anthropic 公開の frontend-design スキル（github.com/anthropics/skills の skills/frontend-design/SKILL.md）が「AI生成のデザインが集まりやすい特徴」として挙げるものを参考にした。

`lookup_ux_principles` は、利用者が整理した UI/UX の原則集（`src/core/skills/catalog/interface-design/knowledge/ux-principles.md`、500項目）を、番号か語で引く。全文はプロンプトに入れず、必要な項目だけを返す。Designer のスキルには、その要点を項目番号付きでまとめた確認リスト（`references/ux-checklist.md`）を同梱している。

## 使っているOSS

| ライブラリ | 用途 | ライセンス |
|---|---|---|
| culori | 色の変換・OKLCH・CIEDE2000 | MIT |
| pngjs / jpeg-js / image-size | 画像の読み込み・大きさ | MIT / BSD-3-Clause / MIT |
| pixelmatch | 画像の差分 | ISC |
| svgo | SVGの最適化 | MIT |
| axe-core | アクセシビリティの自動検査 | MPL-2.0（改変せずに同梱） |
| diff (jsdiff) | 文章の差分 | BSD-3-Clause |
| mammoth | Word（.docx）の本文抽出 | BSD-2-Clause |
| pdfjs-dist（既存） | PDFの本文抽出 | Apache-2.0 |
| exceljs・js-yaml（既存） | xlsx・YAMLの読み取り | MIT |
| smol-toml | TOMLの構文検査 | BSD-3-Clause |
| ajv | JSON Schema の検証 | MIT |
| semver | バージョン比較 | ISC |
| cron-parser | cron式の次回実行 | MIT |
