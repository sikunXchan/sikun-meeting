# 無人運用・Codexの部門別制限・脆弱性是正のタスク

| ID | タスク | 完了条件 | 状態 |
|---|---|---|---|
| T-01 | 依存関係の更新 | `npm audit` 0件 | 完了 |
| T-02 | Codexの部門別方針 | AC-01〜03のテスト成功 | 完了 |
| T-03 | トークン記録・予算・停止の区別 | AC-08のテスト成功 | 完了 |
| T-04 | 自動再試行・起動時再開 | AC-04、05のテスト成功 | 完了 |
| T-05 | 継続サイクル・KGI測定・無進捗停止 | AC-06、07、09のテスト成功 | 完了 |
| T-06 | プロンプトの切り詰め | AC-11のテスト成功 | 完了 |
| T-07 | 委託画面の無人運用設定・表示 | 実起動で設定と表示を確認 | 完了 |
| T-08 | 常駐・多重起動防止・ログイン時起動 | 実起動でトレイ作成と起動を確認 | 完了（ログイン時起動はWindows・macOS未確認） |
| T-09 | 遷移遮断・IPC送信元確認・sandbox・HTML整形 | AC-13〜16 | 完了 |
| T-10 | 共通文書の反映と引き継ぎ | docs・README・handoff更新 | 完了 |
| T-11 | トレースアニメーション | ユーザーの再開指示 | 保留（2026-09-25 ユーザー指示） |

## 検証結果

実施日時：2026-09-25 23:00〜23:15 UTC、ブランチ `claude/feature-ideas-50-hzt0sq`、基点コミット `29863ec` からの未コミット差分（このコミットに含む）。Linuxコンテナ（root）上で実施。

| 対象 | コマンド・方法 | 結果 |
|---|---|---|
| AC-12 | `npm audit` | found 0 vulnerabilities（更新前は14件：critical 1、high 13） |
| 型 | `npm run typecheck` | 成功 |
| AC-01〜11、14、既存機能（AC-10） | `npm test` | 34件すべて成功（既存21件、`tests/autonomy.test.js` 10件、`tests/security.test.js` 3件） |
| AC-13、15、16、T-07 | `xvfb-run npx electron . --no-sandbox --remote-debugging-port=9222` 後に `SEEDED_COMMISSION=1 node scripts/smoke-security-ui.js` | 成功。`window.api` 利用可、`require`/`process` は画面から見えない、IPC応答あり、危険なHTMLは除去、`window.open` とリンクは画面内で開かず `shell.openExternal` へ（コンテナに `xdg-open` がなく起動失敗のログ2件）、無人運用欄と継続サイクル表示を確認（スクリーンショット目視） |
| AC-16（配布形式） | `npx electron-builder --linux dir` 後、パッケージ版を同じスモークで確認 | 成功（Electron 44.4.5、asar内のsandbox化preloadが動作） |
| T-08 | 同一データで2つ目を起動 | 2つ目は1秒で終了、1つ目の画面は維持 |
| T-08 | メインプロセスから `BrowserWindow.close()` | 破棄されず非表示、プロセスは常駐 |

未確認：
- 実SDK（Claude・Codex）での無人長時間運用。この環境には認証がない。
- OSのサンドボックス自体（rootのため `--no-sandbox` で起動した。preloadのsandbox用ローダーでの動作は確認済み）。
- Windows・macOSのログイン時起動、Windows配布版（nsis）のビルド。
- `window.close()` をレンダラーから呼んだ場合はウィンドウが破棄される（アプリは常駐し、トレイから再作成できる）。
