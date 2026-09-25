# 会議統治と継続実行の設計案

更新日：2026-09-25  
対象要件：AC-01〜08  
状態：実装済みの内容は `tasklist.md` に記載。以下は当初の設計案で、未実装項目も含む。

## 優先する実装順

| 段階 | 機能 | 理由 |
|---|---|---|
| 1 | 初回独立意見、議決状態と根拠、モデル記録 | 現在の会議品質と決定の意味を直接改善し、既存の外部接続を必要としない |
| 2 | 成果物カルテと目標判定 | 継続作業と次の会議に正しい文脈を渡す基盤になる |
| 3 | 能力台帳と外部MCP実行 | 対象と操作の境界を実装してから外部への副作用を開く |
| 4 | 独立監査と定期実行 | 決定・証拠・実測値が蓄積した後に検証する |

## 状態とデータ

- `Meeting` に `phase`（初回収集中、討論中、推奨可能、決定済み）、`initialOpinionIds`、`evidenceRefs`、`ballot`、`decisionGate`、`artifactCardVersionIds` を追加する。既存データには移行時に旧形式の印を付け、独立初回意見が実施されたものとして扱わない。
- 初回意見は同じ会議スナップショットから各AIのプロンプトを作り、収集完了まで他者の新しい回答を渡さない。公開時に一括保存し、既存の逐次討論へ移る。途中失敗時は成功回答を非公開のまま保持して再試行できるようにする。
- `Ballot` は議題の版、各参加者の賛否、条件、根拠、棄権理由を持つ。`DecisionGate` は必要部門、定足数、反論段階、根拠、残るリスクを評価し、結果と理由を保存する。多数決は推奨の一要素であり、最終確定は既存の人間操作を使う。
- `ArtifactCard` は成果物ID、現状、KGI定義と測定、課題、決定参照、成果物の版、確からしさ、最終確認日を持つ。会議では該当版の短い要約と根拠リンクのみ注入し、議事録全文を無制限に渡さない。
- `CapabilityGrant` は `personaId × phase × operation × resourceScope` で表す。モデルが要求したツール呼び出しを実行前に検証する。読み取り、下書き、書き込み、送信・確定を分ける。対象リソースの境界を検証できない広いフル権限実行は、部門別許可として表示しない。
- `ExternalAction` は提案、確認待ち、実行中、完了、失敗、結果不明の状態を持つ。リクエストと応答は機密を除いて保存する。送信や会計確定等は結果不明から自動再実行しない。
- `GoalCheckpoint` は計画時の達成条件、実測、残作業、検証証拠、停止理由を記録する。外部副作用・障害・上限・人間の停止要求は最低作業量に優先する。
- `AuditRun` は通常の会議から独立した実行ID、監査対象期間、参照した議事録・カルテ版、KGI差分、是正提案を記録する。通常部門の書き込み権限を持たせない。

## 実装箇所の見込み

| 場所 | 変更 |
|---|---|
| `src/core/services/discussionService.ts`、`agent/promptBuilder.ts`、`community/service.ts` | 初回独立意見と公開後の討論を分ける |
| `src/core/services/decisionService.ts`、`meetingTypes.ts`、`types.ts` | 投票・議決可能条件・決定の区別 |
| `src/core/agent/claudeAgent.ts`、`commission/agent.ts`、`commission/codexAgent.ts` | モデル・利用ツール・実行前の権限検査、実行記録 |
| 新しいカルテ、権限、外部操作、監査のサービスと保存層 | 版管理・外部効果・独立検証 |
| `src/main/ipc.ts`、`preload.ts`、画面 | 権限表示、投票、カルテ、外部操作の確認、監査結果 |

## 設計上の注意

- `allowedTools` は許可判断の指定であり、会議で使えるツール集合を厳格にするにはSDKの `tools` と拒否ルールも併用して確認する。現行の `permissionMode: default` に権限境界を委ねない。
- 委託案件の `full` はClaudeで `bypassPermissions`、Codexで `danger-full-access` に相当する。成果物の事後レビューだけでは送信・削除等の外部効果を止められないため、MCP実行経路を独立した権限付きサービスにする。
- 異なるClaudeモデルの割当は選択肢の幅を増やし得るが、結論の独立性を保証しない。初回の意見の隔離と、少数意見の保持を先に実装し、品質は具体的な課題セットで比較する。
- コンテキストに入れる過去の議論と外部コンテンツは引用付きの資料として扱う。ユーザーの確定目標やシステム規則と同じ権威を与えない。

## 一次資料

- Du et al., *Improving Factuality and Reasoning in Language Models through Multiagent Debate*: https://arxiv.org/abs/2305.14325
- Anthropic, *Create custom subagents*: https://code.claude.com/docs/en/sub-agents
