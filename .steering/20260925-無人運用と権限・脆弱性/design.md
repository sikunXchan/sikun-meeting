# 無人運用・Codexの部門別制限・脆弱性是正の設計

更新日：2026-09-25
対象要件：AC-01〜AC-17

## 現在の実装から確認したこと

- `src/core/capabilities.ts` の `approvedTools()` はClaude経路（`commission/agent.ts:30`、`agent/claudeAgent.ts:111`）だけが使う。`commission/codexAgent.ts:40-47` は `sandboxMode` を `request.tools` だけで決め、`networkAccessEnabled: true` 固定。
- `@openai/codex-sdk` 0.156 の `ThreadOptions` は `sandboxMode`（read-only / workspace-write / danger-full-access）、`networkAccessEnabled`、`webSearchEnabled`、`approvalPolicy` を持つ。個別ツールの許可リストはない。
- `commission/service.ts` の `execute()` は、計画→仕事（最大2回）→目標検証（最大3回、無進捗なら停止）→納品で終わる。例外はすべて `failed` になる（L540-546）。`callAgent()` は `maxCalls` だけを確認する（L241）。
- `commission/store.ts` は起動時に `running` を `interrupted` に変える。再開は人間の操作だけ。
- `workPrompt()`（L361）と `planningPrompt()`（L355）は採用済みの仕事の報告を全文・全件で渡す。
- Claude SDKの結果メッセージは `modelUsage`（inputTokens、outputTokens、cacheRead/CreationInputTokens）、Codexの `turn.completed` は `usage`（input_tokens、output_tokens）を返す。現在はトークン数を保存していない。
- KGIは成果物カルテ `ArtifactGoal { target, current, unit, evidence }`。監査（`audit/service.ts:54-55`）は `current >= target` を達成とする。
- `main/index.ts` はウィンドウを閉じると終了し、多重起動を防がない。`sandbox: false`、画面遷移の制限なし。`ipc.ts` は送信元を確認しない。`renderer.ts:1096-1104` は正規表現でHTMLを除去する。
- `npm audit`：Electron 33（Electronの多数の勧告、extract-zip）とelectron-builder 25（tar critical、builder-util-runtime等）。修正版はElectron 44.4.5、electron-builder 26.15.3。

## 変更方法

### Codexの部門別制限

`capabilities.ts` に `codexPolicy(personaId, phase)` を追加し、Claudeと同じ `CODE_ROLES` から導く。`codexAgent.ts` は `codexThreadOptions(request)`（純関数・テスト可能）でスレッド設定を作る。Web検索は常に無効にする。非コード部門の作業プロンプトに「コマンドはファイルの閲覧と検証に限る」を加える。これは指示であり強制ではないことを文書に明記する。

### 無人運用

`CommissionSettings.autonomy` を追加する（既存案件は未設定＝従来動作）。

| 設定 | 既定 | 範囲 |
|---|---|---|
| enabled | false | 無人運用 |
| continuous | false | KGIまで継続。成果物カルテのKGIが1件以上必要 |
| maxTokens | null | 総トークン予算。nullは無制限 |
| deadline | null | ISO日時の期限 |
| maxCycles | 10 | 1〜100 |
| retryLimit | 3 | 連続した自動再試行の回数、0〜10 |

無人運用時の `maxCalls` 上限は200から5000へ広げる。

- 停止の区別：予算・上限・無進捗など意図した停止は `CommissionHalt` を投げる。`execute()` の例外処理で、`CommissionHalt` と人間の一時停止・停止は再試行しない。それ以外は `autoRetry.count` を増やし、`retryLimit` 以下なら `autoRetry.nextAt` を記録してタイマーで `resume(id, { auto: true })` する。待ち時間は1分・5分・15分（以後15分）。自動再開時は失敗した仕事を `queued`・試行回数0に戻す。仕事が内部確認を通過したら回数を0に戻す。
- 起動時：`CommissionService.resumeAutonomous()` を `main/index.ts` から呼ぶ。`interrupted` の無人案件は再開し、`autoRetry.nextAt` のある `failed` の無人案件はその時刻に再開する。
- 予算：`callAgent()` の前に呼び出し回数・トークン合計・期限を確認する。無人でない案件の文言は従来どおり。
- 継続サイクル：`execute()` の本体をサイクルのループにする。納品文を作った後、継続でなければ従来どおり `delivered`。継続なら、
  1. カルテに納品を記録する。
  2. 独立したCriticが `kgi_check`（読み取り専用）で作業場所の実物からKGIを測定する。担当AIの報告を根拠にしない。証拠のない数値は未測定として扱う。
  3. 測定値をカルテの新しい版（source: commission）に保存し、`cycles` に記録する（納品要約、KGI、採用ファイル数、呼び出し数、トークン数）。
  4. 全KGIが `current >= target`（監査と同じ判定）なら `stopReason = KGI達成` で `delivered`。
  5. サイクル数の上限、または直近3サイクルで採用ファイル0件かつKGIの改善なしなら停止する。
  6. それ以外は未達KGIとカルテの改善バックログから継続依頼を作り、同じ確定企画のまま次のサイクルを計画する。
- 目標検証の3回上限と無進捗判定はサイクルごとに数える（`GoalCheck.cycle`）。2サイクル目以降の目標検証には、そのサイクルの継続依頼も条件として渡す。
- 予算切れで止まった時点で過去のサイクルの納品があれば `delivered`、なければ `failed` とし、どちらも `stopReason` を残す。
- コンテキスト：前の仕事の報告を1件600字・直近20件に切り詰める（作業・計画）。納品文には今のサイクルの仕事だけを渡す。
- トークン：Claudeは `modelUsage` の入力・出力・キャッシュ読み書きの合計、Codexは `usage.input_tokens + output_tokens` を `AgentRun.tokens` に保存する。
- メール：無人運用の処理はメールサービスを呼ばない。

### 常駐

- `app.requestSingleInstanceLock()` で多重起動を防ぐ。2つ目の起動では既存ウィンドウを表示する。
- トレイを作り、「ウィンドウを表示」「ウィンドウを閉じても常駐」「ログイン時に起動」「終了」を置く。設定は `userData/data/app-settings.json` に保存する。常駐は既定で有効。ログイン時起動は既定で無効、有効時は `--hidden` で起動する。
- 実行中の案件がある間は `powerSaveBlocker('prevent-app-suspension')` を使う。

### 脆弱性

- Electron ^44.4.5、electron-builder ^26.15.3 に更新する。`console-message` は新しいイベント形式で受け取る。
- `main/security.ts`：`isAppUrl()` で送信元URLがアプリの `renderer/index.html` かを判定する。`registerIpcHandlers` のハンドラーはすべてこの確認を通す。`will-navigate`、`will-attach-webview` を拒否し、`setWindowOpenHandler` は拒否したうえで http(s) だけ既定ブラウザで開く。
- `renderer/sanitize.ts`：`<template>` で解析し、許可した要素と属性だけ残す。`href` は http(s)、mailto、`#` のみ。`renderer.ts` はこれを使う。
- preloadはチャンネル名を自前で持ち、`sandbox: true` にする。チャンネル名の一致は自動テストで確認する。

| 変更箇所 | 変更内容 | 対応する条件 |
|---|---|---|
| `src/core/capabilities.ts`、`commission/codexAgent.ts` | Codexの部門別方針、トークン記録 | AC-01〜03 |
| `commission/types.ts`、`service.ts`、`store.ts`、`agent.ts` | 無人運用、継続サイクル、KGI測定、予算、自動再試行、切り詰め | AC-04〜11、17 |
| `services/projectService.ts` | KGI測定の版を記録 | AC-06 |
| `main/index.ts`、`main/appSettings.ts` | 常駐、多重起動防止、ログイン時起動、起動時再開 | AC-05 |
| `main/security.ts`、`ipc.ts`、`preload.ts` | 遷移遮断、送信元確認、sandbox | AC-13、14、16 |
| `renderer/sanitize.ts`、`renderer.ts`、`index.html`、`commission.ts` | 許可リスト方式のHTML整形、無人運用の設定と表示 | AC-15 |
| `package.json` | Electron・electron-builderの更新 | AC-12 |

## データと外部への影響

`commissions.json` に任意項目（`settings.autonomy`、`cycle`、`cycles`、`stopReason`、`autoRetry`、`AgentRun.tokens`、`WorkItem.cycle`、`GoalCheck.cycle`）を追加する。既存案件は未設定のまま従来どおり動く。カルテには `source: commission` の版が増える。アプリ設定 `app-settings.json` を追加する。Electronのメジャー更新により配布版の再ビルドが必要。

## 確認する範囲

`npm test`（既存21件と追加分）、`npm run typecheck`、`npm audit`、xvfb上のElectron 44実起動とCDPでの画面・サニタイズ確認。実SDKでの無人長時間運用はこの環境に認証がないため未確認として残す。

## 設計変更の記録

- 2026-09-25：トレースアニメーションはユーザーの指示で保留。
