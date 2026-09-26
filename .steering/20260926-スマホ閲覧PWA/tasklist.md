# スマホで会議を見るPWAのタスク

| ID | タスク | 完了条件 | 状態 |
|---|---|---|---|
| T-01 | Vercel側API（handler・関数） | AC-01〜03のテスト成功 | 完了 |
| T-02 | デスクトップのスナップショット・暗号化 | AC-04、05のテスト成功 | 完了 |
| T-03 | 同期サービス・トークン保存 | AC-06〜09のテスト成功 | 完了 |
| T-04 | デスクトップ画面「スマホで見る」 | 実起動で二次元コードと同期状態を確認 | 完了 |
| T-05 | PWA画面・Service Worker・manifest | AC-10〜13を実起動で確認 | 完了 |
| T-06 | 資材コピーと一致テスト | AC-11のテスト成功 | 完了 |
| T-07 | 文書・デプロイ手順・引き継ぎ | docs・README・handoff更新 | 完了 |

## 検証結果

実施日時：2026-09-26 00:40〜01:00 UTC、ブランチ `claude/feature-ideas-50-hzt0sq`、基点コミット `adffacf` からの差分（このコミットに含む）。Linuxコンテナ（root）。

| 対象 | コマンド・方法 | 結果 |
|---|---|---|
| AC-01〜09、11、14 | `npm test` | 44件すべて成功（既存34件、`tests/mobile.test.js` 10件） |
| 型・依存 | `npm run typecheck`、`npm audit`、`cd mobile && npm audit` | 成功、0件、0件 |
| 縦断（デスクトップ） | `serve-mobile-local.js` を起動し、Electronで「スマホで見る」に `http://127.0.0.1:3100` を設定（`node scripts/smoke-mobile-pwa.js desktop`） | 会議2件・3KBを送信、二次元コード表示、トークン欄は保存後に空。保存先ファイルは暗号文のみ（平文の語「Stripe」を含まない） |
| AC-10、11、13 | Chromium（390×844、iPhoneのUA）でペアリングURLを開く（`smoke-mobile-pwa.js phone`） | URLから鍵が消え保存、一覧2件・詳細（決定、理由、Action Itemの完了状態はProject側に一致、各AIの立場、表、発言5件）、`<img onerror>` と `javascript:` リンクは0件、横スクロールなし、作業場所のパスは表示されない、manifest（standalone・アイコン）とService Worker有効、CSPヘッダーあり。スクリーンショット目視 |
| AC-12 | ローカルサーバー停止後に再読み込み（`smoke-mobile-pwa.js offline`） | 前回の決定内容とオフラインの案内を表示 |
| AC-09 | この環境（Linux、鍵管理サービスなし）で画面からトークンを保存 | 平文で保存せず「環境変数 SIKUN_MOBILE_SYNC_TOKEN に設定」を表示。環境変数からの読み込みで同期成功 |
| 既存の画面安全性 | `CDP_PORT=9231 node scripts/smoke-security-ui.js` | 成功 |

未確認：
- 実際のVercelへのデプロイとVercel Blobでの保存・読み取り（ユーザーが行う）。`@vercel/blob` 2.8.0 の型定義と公式文書で `get`・`put`・`del` の使い方は確認済み。
- 実機のiPhone・AndroidでのPWAインストールとカメラでの読み取り。
- Windows・macOSの `safeStorage` によるトークン保存。
- Vercel Functionsの本文上限値（公式文書の検索で見つからず、4MBに制限した）。
