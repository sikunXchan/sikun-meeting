# 20260924-autonomous-ai-organization の再開メモ

更新日：2026-09-24（JST）
状態：要件レビュー待ち。設計・タスク・実装は未着手。

## 次の操作

1. http://127.0.0.1:4174/ の要件レビューを人間が確認し、承認または修正依頼をする。承認前に design.md と tasklist.md を提出しない。
2. 要件の未確定事項、特に「PC全体へのフル権限」と「役割外行動の事前防止」の優先順位を決める。変更があれば requirements.md を更新し、再提出する。
3. 要件が承認されたら、現行コードを踏まえて design.md を作成・提出する。

## 再開する環境

- プロジェクト：C:\Users\sikun\OneDrive\Desktop\研究\sikun-meeting-claude-desktop-native-app-6af139\sikun-meeting-claude-desktop-native-app-6af139
- Gitリポジトリを初期化し、mainブランチに初回コミットを作成。コミットIDは `git rev-parse HEAD` で確認する。
- 仕様レビューのMCP設定は .codex/config.toml と .mcp.json に作成済み。Codex/Claude Codeの新規セッションで読み込む。
- レビューアプリは4173番がdevelop-flowのdemoで使用中だったため、対象プロジェクト用を4174番で起動した。レビュー状態は .steering/20260924-autonomous-ai-organization/review.json に保存される。

## 現在地

READMEと src/core/types.ts、agent、discussionService、decisionService を確認済み。requirements.mdを作成し、review_submitでrequirementsを提出済み。設計・実装・製品動作の検証は行っていない。

## Orca/Codexの状態

- 2026-09-24にOpenAI公式npmパッケージ @openai/codex@0.156.1 をグローバルインストール済み。C:\Users\sikun\AppData\Roaming\npm\codex.cmd の --version は codex-cli 0.156.1、login status は「Logged in using ChatGPT」。~/.codex/auth.json と config.toml は存在する（中身は確認していない）。
- Orcaアプリ（1.4.207）は C:\Users\sikun\AppData\Local\Programs\orca\Orca.exe にあるが、このセッションで orca コマンドは認識されない。Orca CLIスキルに従い、別の実行ファイルへの推測切替は行っていない。
- ユーザーによるとOrcaのエージェント選択肢にCodexが出ない。Orcaの設定・バージョン・エージェント検出を画面で確認する必要がある。
- OrcaのGit worktreeを使う場合は、このリポジトリのmainブランチを取り込む。

## 読む資料

AGENTS.md、.agents/skills/spec-review/SKILL.md、requirements.md、README.md、関係する src/core のコード。

再開時は実ファイルとレビュー状態を照合し、未承認を承認済みとして扱わない。
