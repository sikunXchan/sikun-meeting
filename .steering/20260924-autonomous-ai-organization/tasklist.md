# 自律AI組織化の実装タスク

更新日時：2026-09-24 09:14 JST
対象：`main` ブランチの未コミット差分。仕様レビューで要件→設計→タスクの順に承認を記録した後、実装した。
状態：主要な委託フローとWindows配布版を実装・検証済み。推定料金表示と金額上限の撤廃も検証済み。GUI操作の画面取得は実機確認待ち。

## タスク

| ID | 作業 | 対応条件 | 状態 | 完了根拠・残る条件 |
|---|---|---|---|---|
| T-01 | 既存21人を維持し、ITコンサルタントAIと企画相談・企画確定を追加 | AC-01、08 | 完了 | 22人の一覧、複数ターン保存、確定前に仕事0件をテスト。配布版から相談応答を確認。 |
| T-02 | 案件・仕事・Run・判断・成果物の永続化と復元を追加 | AC-02、04、07 | 完了 | `CommissionStore` の保存、イベントJSONL、起動時の中断復元、成果ファイルのハッシュと提案・採用状態をテスト。 |
| T-03 | AIによる作業計画・担当決定・実行キューを追加 | AC-02、03、08 | 完了 | 計画から自動で担当・所管・確認者を選び、1件ずつ実行。小さな実SDK試験では1仕事へ分解した。 |
| T-04 | SDKによる実作業能力、実行ログ、GUI操作経路を追加 | AC-02、03 | 確認待ち | Windows配布版でOpus計画→Sonnet実作業・確認・納品を完走。Orca computer CLIは`screenshots`権限を`unsupported`と返し、画像取得に失敗。GUIの操作完了試験は未実行。 |
| T-05 | 自動進行、停止・再開、利用枠、失敗処理を追加 | AC-04〜06、08 | 完了 | 一時停止→再開、再起動時の中断、呼び出し上限、失敗時の部分成果をテスト。停止ボタンも追加。 |
| T-06 | 内部確認、統合納品、ユーザー修正の循環を追加 | AC-03、07、08 | 完了 | EngineerのDesigner所管変更はDesigner確認まで提案状態。納品と修正後の再納品をテスト。実SDKでも内部確認・納品まで完了。 |
| T-07 | 画面・IPCを統合し、既存会議とAction Itemとの互換性を確認 | AC-01〜08 | 完了 | 配布版で既存会議、22人、委託画面、Action Itemからの重複なし起票、相談IPCを確認。 |
| T-08 | 検証結果、共通仕様、引き継ぎを更新 | 全AC | 完了 | 本書、`handoff.md`、`docs/`、READMEを更新。未検証のGUI操作は成功扱いにしていない。 |
| T-09 | 推定料金の表示・設定・自動停止を撤廃する | AC-09 | 完了 | 画面と説明から推定料金を除き、金額上限とSDK予算指定を撤廃。旧設定値が残り、SDK推定値が高くても納品できる模擬試験が成功。配布版で保存済みRunを開き、モデル・ターン数のみ表示されることを確認。呼び出し回数上限の試験も成功。 |

## 検証結果

| 日時（JST） | 条件 | 操作・コマンド | 対象 | 結果 |
|---|---|---|---|---|
| 2026-09-24 08:42〜08:47 | AC-01〜08 | `npm test`、`npm run typecheck`、`git diff --check` | `main` の差分 | テスト6件成功、型検査成功、差分の空白エラーなし。 |
| 2026-09-24 08:15〜08:18 | AC-02、08 | `node scripts/smoke-commission-live.js` | 一時ディレクトリ、実Claude SDK | 相談→計画→実作業→QA確認→納品。`greeting.txt` と `verification_log.txt` が採用済み。Haikuを使用。試験フォルダはスクリプトが削除。 |
| 2026-09-24 08:20〜08:25 | AC-06 | `node scripts/smoke-commission-sdk.js` をモデル指定で実行 | SDK 0.3.281 | Sonnet 5、Opus 5.5の応答モデルを実測。Haikuの相談と実ファイル作成も成功。SDK 0.3.258ではOpus 5.5が未対応だったため更新。 |
| 2026-09-24 08:33〜08:47 | AC-01、02、08 | `CDP_PORT=9226 node scripts/smoke-commission-ui.js --action-item --consult` | `release-complete/win-unpacked` のWindows配布版、隔離した試験データ | 既存会議表示、22人、Action Item起票・重複防止、委託画面、配布版SDKによるHaiku相談応答に成功。実利用データは変更していない。 |
| 2026-09-24 08:56〜08:59 | AC-01〜03、07、08 | `CDP_PORT=9228 node scripts/smoke-commission-ui.js --action-item --consult`、`--consult-default`、`--full-default` | `release-complete/win-unpacked` のWindows配布版、`%TEMP%/sikun-meeting-trial-20260924` の隔離データ | 画面・IPCの再確認に成功。既定のSonnet 5による相談後、Opus 5.5で計画、Sonnet 5で作業・内部確認・納品が完了。`greeting.txt` の内容 `hello` と採用状態を確認。試験用アプリを終了した。 |
| 2026-09-24 09:09〜09:14 | AC-05、09 | `npm test`、`npm run typecheck`、`git diff --check`、`CDP_PORT=9229 node scripts/smoke-commission-ui.js --hide-cost-check` | `main` の差分、`release-nocost/win-unpacked`、隔離した保存済み試験データ | テスト7件、型検査、差分検査が成功。旧案件の金額上限と高いSDK推定値があっても納品完了。配布版の設定と既存Run表示に金額がなく、モデル・ターン数を確認。 |
| 2026-09-24 09:12 | 配布 | `npx electron-builder --win nsis --config.directories.output=release-nocost` | `release-nocost/Sikun Meeting Setup 0.1.0.exe` | 成功。272,583,886バイト。SHA-256 `40185EE97052E4BD9E45E7999C2A98A2237847045B797C60B229AFB94A2D3542`。最終案内先。 |
| 2026-09-24 08:47 | 配布 | `npx electron-builder --win nsis --config.directories.output=release-complete` | `release-complete/Sikun Meeting Setup 0.1.0.exe` | 成功。272,584,083バイト。SHA-256 `45CE52760C11F07B6EBCD5CEDCDA404DA8A8260F76BE5A3F68FFD9E2B03C017D`。同梱Claude Code 2.1.281の起動を確認。 |
| 2026-09-24 | GUI | `orca computer capabilities --json`、`orca computer permissions --id screenshots --json`、画面状態取得 | Windows GUIプロバイダ | 操作・画面取得能力は報告されたが、権限状態は`unsupported`で画像取得が失敗。実際のGUI仕事の受け入れ試験は保留。 |

## 実装の境界と次の確認

成果ファイルの自動追跡は作業ディレクトリ内が対象。全員に実作業ツールを渡すため、担当外のファイル操作そのものをOS権限で防ぐものではない。内部確認前の採用状態を分ける。配布版のGUI仕事と長時間運転は、画面取得に対応する環境と実際の案件を用いた追加の実機検証が必要。人格間の文化形成とOS常駐実行は今回の初期範囲に含めない。
