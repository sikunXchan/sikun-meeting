# 同梱の検証ツール（MCPサーバー `sikun`）

更新日：2026-09-30

AIが「答えが一つに決まる確認」（計算・集計・照合・引用の実在・差分・色のコントラスト・画面の崩れ）を暗算や目視ではなくツールで行うための、アプリ同梱の stdio MCP サーバー。ClaudeとCodexの両方に同じサーバーを渡す（`src/mcp/stdio.ts`、`src/core/tools/`）。

## 共通の約束

- コマンド実行・外部通信・作業フォルダへの書き込みはしない。記録系（`record_criterion`・`record_source`）だけがアプリのデータ領域に書く。
- 読めるのは作業フォルダと参考資料フォルダの中だけ。シンボリックリンクで外へ出るファイルも拒否する。
- 画面系は作業フォルダのローカルHTMLだけを、外部通信を遮断した分離ブラウザ（Chrome / Edge）で開く。AIが書いたスクリプトは実行しない。
- 近似値（標準偏差・年平均成長率・内部収益率）は結果に approximate と明示する。祝日・為替・税率のように更新が必要なデータは持たない。

## ツール一覧（40個）

| グループ | ツール | 渡す部門・段階 |
|---|---|---|
| 計算（8） | calculate, describe_statistics, growth_rate, npv_irr, loan_payment, sensitivity_table, convert_units, calculate_dates | 全部門の作業・確認 |
| 表（6） | read_table, describe_table, query_table, reconcile_tables, validate_table, read_structured_data | 全部門の作業・確認 |
| 文書（8） | extract_text, text_diff, find_quote, text_statistics, check_placeholders, check_links, document_outline, check_terms | 全部門の作業・確認 |
| 配色・画像（6） | color_contrast, color_palette, compare_colors, image_info, compare_images, optimize_svg | designer・frontend・mobile・accessibility・marketing・education・product |
| 画面（3） | screenshot_page, audit_accessibility, check_layout | 上記とQA、全部門の確認段階 |
| コード（5） | test_regex, compare_versions, validate_config, validate_json_schema, explain_cron | コードを扱う部門（architect・engineer・backend・devops・cloud・data_engineer・security・qa・ai_researcher・frontend・mobile・embedded・data_scientist） |
| 出典（2） | record_source, list_sources | Web取得を使う部門（researcher・legal・healthcare・public_policy・privacy・sustainability）の作業・レビュー |
| 確認記録（2） | record_criterion, list_criteria | 確認・目標確認・KGI確認の段階（fail・unverified が残る承認はアプリが差し戻す） |

相談・計画・納品の段階ではツールを渡さない。1回に渡す数は最大38（frontend・mobile の確認段階）。公式資料では一度に読み込むツールが30〜50を超えると選択精度が落ちるとされ、Claude のSDKは必要なツールだけを読み込む（ツール検索）。Codex が全ツールを最初に読み込むかは未確認。

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
