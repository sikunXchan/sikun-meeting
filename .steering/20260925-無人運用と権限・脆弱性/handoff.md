# 20260925-無人運用と権限・脆弱性の再開メモ

更新日時：2026-09-25 23:15 UTC
状態：確認待ち（実SDKでの無人運用、Windows配布版）

## 次の操作

Windowsで `npm install` → `npm run dist` を実行し、配布版で無人運用の案件（KGI付きカルテ、トークン予算あり）を1件、Claude・Codexそれぞれで流して、自動再試行・再起動後の再開・KGI測定・停止理由の表示を確認する。

## 再開する環境

- リポジトリ・ブランチ：sikunXchan/sikun-meeting・`claude/feature-ideas-50-hzt0sq`
- 最後に確認したコミット：このメモを含むコミット（基点 `29863ec`）
- 未コミットの変更：なし

## 現在地

実装済み・自動テスト済み：Codexの部門別方針、無人運用（自動再試行・起動時再開・KGIと予算までの継続・無進捗停止）、トークン記録、プロンプトの切り詰め、IPC送信元の確認。
実起動で確認済み：Electron 44での画面、sandbox化preload、HTML整形、遷移遮断、無人運用欄、常駐、多重起動防止、Linuxパッケージ版。
未確認：tasklist.mdの「未確認」を参照。
検証の証拠：tasklist.mdの「検証結果」

## 未解決事項

- トレースアニメーションは保留。再開時は対象（委託案件の実行トレースか会議のリプレイか）をユーザーに確認する。
- KGIの達成判定は `current >= target` のみ（監査と同じ）。小さいほど良い指標の扱いは未決定。
- Codexの非コード部門のコマンド実行は強制的には止められない（SDKの制約、D-007）。

## 繰り返さなくてよい調査

- `npm audit` の修正版は Electron 44.4.5、electron-builder 26.15.3（`npm audit --json` の fixAvailable）。
- Electron 44の `console-message` はイベントオブジェクトの `level`・`message`・`lineNumber`・`sourceId`。
- rootのコンテナでは Electron に `--no-sandbox` が必要。`xvfb-run` とCDP（`--remote-debugging-port`）で画面確認できる。メインプロセスの操作は `--inspect` と `process.mainModule.require('electron')` で行える。
- レンダラーの `window.close()` はBrowserWindowの `close` イベントを経ずに破棄される。

## 読む必要がある資料

- docs/decisions.md の D-001、D-007〜D-009
- docs/product-requirements.md の P-013〜P-016
