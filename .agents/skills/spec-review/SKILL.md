---
name: spec-review
description: Use the develop-flow Markdown templates and review MCP to run human-reviewed requirements, design, and task planning in an Orca project. Apply to substantial feature work when review is required; omit for small edits unless requested.
---

# 仕様レビュー

このプロジェクトでは、要件・設計・タスクを `.steering/<作業ID>/` の Markdown に残し、レビュー画面の承認を受けてから次の段階へ進む。レビュー操作は画面で行う。エージェントは自分の文書を承認しない。

1. `AGENTS.md` と対象作業の文書、関係する `docs/` とコードを確認する。新しい作業は `.steering/_template/` から作り、`.steering/README.md` に追加する。
2. `requirements.md` に現状・要求・提案・未確定事項・受け入れ条件を区別して記録し、MCP の `review_submit` で `requirements` を提出する。
3. 画面での承認後に `design.md` を作成・提出する。同様に `tasklist.md` を提出し、その承認後に実装へ進む。前の段階が `approved` でないときは後の段階に進まない。
4. 差し戻されたら `review_status` または `review_read` でコメントを読み、文書を直して再提出する。文書変更で `outdated` になった場合も再提出する。承認内容に影響する変更は後の段階も見直す。
5. 実装後は受け入れ条件を検証し、`tasklist.md` と `handoff.md` を更新する。実行していない検証を成功と書かない。

提出後、OrcaのターミナルhandleがMCPに渡っていれば、画面操作後に同じエージェントへ再開指示が届く。handleが渡らない環境では `review_wait` で結果を待つ。いずれもレビュー結果はMCPで確認する。MCPサーバーが使えない場合は、設定不足を伝え、未承認の段階を承認済みとして扱わない。
