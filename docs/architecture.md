# Sikun Meeting の構成と開発手順

状態：現行構成（2026-09-24）

## 構成

Electronのメインプロセスがサービスとローカルデータを持ち、preloadの限定したIPCからレンダラーへ公開する。既存の会議は `Project → Meeting → Message → Decision → ActionItem` を使う。委託案件は別の `Commission` に相談、企画、仕事、Run、成果ファイル、内部判断、納品、修正履歴を保存する。Action Itemからの起票時は `(meetingId, actionItemId)` を保存して重複作成を避ける。既存の `db.json` は変更せず、案件は `commissions.json`、活動は案件別JSONLに保存する。

ProjectのAIコミュニティは `CommunityPost` に投稿者、参加AI、議論、委託案件ID、採用知識を保存する。`CommunityService` が読み取り専用のAI発言を逐次実行し、後のAIには前の発言を渡す。AIによる課題提案は最近の会議、案件、採用知識を参照する。投稿からの発注には `sourceCommunityPostId` を保存して重複を防ぐ。コミュニティは `community.json` に保存し、直前のバックアップを保持する。

`src/core/commission/service.ts` が企画確定後の逐次実行を管理し、`agentRouter.ts` が案件の設定に応じてClaude Agent SDKの`agent.ts`またはCodex SDKの`codexAgent.ts`へ送る。既存案件で種別がない場合はClaudeとする。相談・計画は読み取り専用、確定後の実作業と内部確認はSDKのツールを使う。実作業では全専門家が担当にかかわらず同じツールを利用できる。担当と所管は仕事のデータで区別し、担当外の成果は所管AIの内部確認まで提案状態にする。技術的なOS権限制限ではない。Codexの納品文生成は60秒で打ち切り、内部確認済みなら記録から代替納品書を作る。

ファイル変更は作業ディレクトリの実行前後のSHA-256比較で検出する。`.git`、`node_modules`、`dist`などを走査から除外し、ファイル数・総サイズに上限を設ける。作業ディレクトリ外の変更は自動追跡できない。SDKの推定値は診断用に記録するが、画面表示と停止条件には使わない。Claudeは呼び出し回数・ターン数・時間、Codexは呼び出し回数・時間で実行量を制御する。

## 主要ファイル

| 場所 | 役割 |
|---|---|
| `src/core/commission/types.ts` | 案件・仕事・Run・成果・判断の型 |
| `src/core/commission/store.ts` | 状態の直列保存と再起動時の中断復元 |
| `src/core/commission/service.ts` | 相談、計画、仕事、内部確認、納品、修正の状態遷移 |
| `src/core/commission/agent.ts` | SDK実行、モデル・代替・使用量・ツールイベント |
| `src/core/commission/agentRouter.ts`、`codexAgent.ts` | 案件ごとの実行エンジン選択、Codex SDKの実行・中断・イベント |
| `src/core/commission/artifacts.ts` | 作業ディレクトリ内の成果ファイル比較 |
| `src/core/community/types.ts`、`store.ts`、`service.ts` | Projectの投稿、発言、AI提案、委託連携、採用知識 |
| `src/main/ipc.ts`、`preload.ts` | 画面との通信 |
| `src/renderer/commission.ts`、`index.html` | 委託案件の画面 |
| `src/renderer/community.ts`、`index.html` | AIコミュニティの画面 |

## 実行と検証

| 用途 | コマンド |
|---|---|
| 起動 | `npm start` |
| 型確認 | `npm run typecheck` |
| ビルド | `npm run build` |
| 状態遷移テスト | `npm test` |
| 実SDK単発試験 | `node scripts/smoke-commission-sdk.js --model=claude-opus-5-5 --no-fallback` |
| 実SDK縦断試験 | `node scripts/smoke-commission-live.js` |
| Codex SDK単発試験 | `node scripts/smoke-codex-agent.js` |
| Codex SDK縦断試験 | `node scripts/smoke-commission-codex-live.js` |
| UI試験 | Electronを`--remote-debugging-port=9222`で起動後 `node scripts/smoke-commission-ui.js` |

Claude案件にはClaudeの認証済み環境、Codex案件にはCodex CLIのChatGPTログインが必要。Windows配布版には両SDKの実行ファイルを同梱する。GUI操作を伴う仕事は、画面取得に対応する環境で追加の実機確認が必要。
# 2026-09-25 会議・実行・監査の拡張

- 会議とコミュニティの初回ラウンドは、全員に同じ公開済みスナップショットだけを渡す。回答を非公開で保存し、全員成功後に一括公開する。失敗時は成功分を保持して再開する。
- `capabilities.ts` が部門別のモデル、会議・作業・確認のツール集合、領域別の確認手順を定義する。会議と独立監査は読み取り専用。外部プラグインはAIに自動配布せず、メールMCPをアプリの明示的な下書き・送信経路に限定する。ファイルのOS権限を部門単位で隔離する仕組みは今後の課題。
- `DecisionService` は必要部門、有効な立場の3分の2、未解決の異論を評価する。投票型会議では公開後の全員の発言と3分の2の支持も要求する。未達時の人間の例外判断は理由付きで保存する。
- `ProjectService` は成果物カルテを版付きで管理する。会議作成時に版を固定し、議論のプロンプトに要約を加える。委託案件の完了条件は、通常の実行担当と別のCriticが最大3回確認し、未達なら追加作業を計画する。
- `EmailService` はMCP設定、下書き、送信状態を `email-actions.json` に保存する。送信開始前に状態を記録し、通信失敗・再起動中の送信を結果不明として再送しない。
- `AuditService` は通常会議と別の監査AI・`independent-audits.json` を使う。直近10件の決定と各会議の直近20発言、カルテとKGIを照合する。アプリ稼働中、初回はProject作成30日後から、以後は前回監査から30日ごとに自動実行する。手動監査も可能。
