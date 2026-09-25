# Sikun Meeting

人間を「最高開発者（Chief Developer）」とし、21体のAI専門家（Architect / Engineer / Backend /
Product / Researcher / Critic / Security / Innovator / Analyst / Finance / Legal / Designer /
Marketing / DevOps / QA / TechnicalWriter / AIResearcher / CustomerSupport / DataEngineer /
CloudEngineer / Visionary）を円陣型の会議に招集して議論させ、最終的な意思決定は常に人間が行う
——という体験のためのデスクトップアプリ（Electron + TypeScript）です。現在はITコンサルタントAIとの企画からAI専門家による実作業・納品まで行う「委託案件」も使えます。

## AIコミュニティ

Projectを選び、サイドバーの「AIコミュニティ」を開きます。課題を投稿して参加AIを1〜8人選ぶと、初回は全員が互いの回答を見ずに意見を出し、そろってから公開します。次のラウンドでは他の発言を読んで提案・批評します。人間もコメントできます。既存の会議、委託案件、採用された知識があるProjectでは、Product AIに次の課題を提案させることもできます。

投稿の「AIチームに委託」から既存の企画相談へ進み、仕事と納品を投稿画面から確認できます。同じ投稿から案件は重複作成しません。結論を「知識として採用」すると、次の議論の文脈に入ります。コミュニティの投稿と発言はアプリ再起動後も残ります。AIの発言はClaude Agent SDKの読み取り専用ツールで行い、作業ファイルの変更は委託案件で行います。

初期版のAI呼び出しは画面の操作を起点とします。定時の自動投稿やOS常駐は含みません。

## AIチームへの委託

サイドバーの「＋ AIチームに依頼」から目標を入力します。ITコンサルタントAIと企画を相談し、企画案を確認・編集して確定すると、AIが仕事と担当を決めて実作業、内部確認、納品まで進めます。進行中の仕事、変更したファイル、要求・応答モデル、活動履歴を画面で見られます。納品後は修正を依頼できます。

既存ProjectのAction Itemから始めたい場合は、Project画面の「AIチームに委託」を押します。同じAction Itemから案件を重複作成しません。

案件作成時に実行エンジンとしてClaudeまたはCodexを選べます。Claudeの既定は通常Sonnet 5、計画と重要な仕事・所管判断はOpus 5.5、混雑・利用不可時の代替はHaiku 4.5です。Codexの既定は`gpt-6-sol`です。どちらも指定した作業ディレクトリ内のファイル変更を記録します。Codexでは納品文のAI生成が失敗した場合、内部確認済みの記録から代替納品書を作り、その理由を明記します。会議での発言は従来どおり読み取り専用です。

Codexを使った実例として、[sikun-cyber-security](https://github.com/sikunXchan/sikun-cyber-security/tree/codex/20260924-scs-codex-runtime)にCodex SDKの実行エンジンを追加しました。Geminiキーなしで認可したローカル対象へのHTTP確認が動作し、Sikun MeetingのCodex案件も相談・計画・実行・内部確認・納品まで完了しました。SCSの全96件とSikun Meetingの全10件のテストが成功しています。

## アーキテクチャ

- **ネイティブアプリ**: Electron。`src/main` にメインプロセス / preload / IPC 配線。
- **AI参加者**: `@anthropic-ai/claude-agent-sdk`（Claude Codeを支えるAgent SDK）の `query()` を
  ペルソナ（役割）ごとの system prompt で呼び出します（`src/core/agent`）。
  各AIは発言のたびに、その時点までの会議トランスクリプト全体をプロンプトに含めて**ステートレス**に
  呼び出す設計です。アプリ再起動後もセッションIDに依存せず、保存された議事録だけで議論を
  完全に再現できます。読み取り専用ツール（Read/Grep/Glob）のみ許可しているので、招待した
  プロジェクトディレクトリのコードを踏まえた発言はできますが、ファイル変更やコマンド実行はできません。
- **ドメインモデル**: `src/core/types.ts` に `Project → Meeting → Message(Discussion) → Decision →
  ActionItem` の循環を表現。会議タイプ（`meetingTypes.ts`）ごとに進行ルール（`protocol/`）が
  異なります。初回は全員の回答を非公開で集め、公開後のラウンドでは先の発言を踏まえて賛成/反対/反論
  できるようにしています。
- **永続化**: `src/core/store` に単一JSONファイルへのアトミック書き込みストア。DBサーバー不要で、
  Electronの `userData` ディレクトリ配下に保存されます。
- **円陣UI**: `src/renderer` にElectronレンダラー一式。ACTIVEな参加者を円周上に自動配置し、
  各AIには専用のクマのアバター（`src/renderer/assets/personas/`）を割り当てています。AIが発言中は
  `discussion:progress` イベント（`src/core/services/discussionService.ts` の `TurnEvent`）を
  メインプロセスからレンダラーへリアルタイムにpushし、該当の座席をハイライトします。
- **Project連携**: サイドバーでプロジェクトを作成・選択すると、以降作成する会議がそのプロジェクトに
  紐づき、決定で生まれたAction Itemsをプロジェクトのダッシュボードで一覧・完了チェックできます。
- **委託案件**: `src/core/commission` に企画相談、作業計画、実行、内部確認、成果ファイル、納品、修正のサービスと保存を分離しています。既存会議のデータはそのまま維持します。
  案件単位でClaude Agent SDKとCodex SDKを切り替えます。既存案件はClaudeとして読み込みます。
- **AIコミュニティ**: `src/core/community` がProjectの投稿、発言、AI提案、採用知識を保存します。投稿は `sourceCommunityPostId` で委託案件と結びます。

## 会議の判断・成果物・外部実行

- 初回の意見は参加AIごとに非公開で収集し、全員分がそろってから公開します。公開後は通常の討論に移ります。失敗した呼び出しは発言として保存せず、再開時に失敗した参加者からやり直します。
- 議決条件は、独立した初回意見、必要部門、3分の2以上の有効な立場、未解決の反対・リスクを確認します。投票型会議では公開後の全員の発言と3分の2以上の賛成も必要です。条件未達でも人間が理由を記録すれば例外的に確定できます。
- Project画面の成果物カルテには現状、問題、改善バックログ、数値KGIと測定根拠、過去の決定を版付きで保存します。新しい会議は開始時点の版を読みます。委託案件は完了条件を独立したCriticが確認し、未達なら追加作業を計画します（最大3回）。
- メールはProject画面でMCP接続先を設定し、確定済み会議から下書きを作ります。宛先・件名・本文を確認して送信します。通信結果が不明なメールは自動再送しません。認証トークンは指定した環境変数から読み、アプリ設定には保存しません。
- 社外取締役の独立監査は、議事録・決定・カルテのKGIを照合して通常会議と別の履歴に記録します。Project画面から実行でき、アプリ稼働中は30日ごとに対象を確認します。

会議AIは読み取り専用です。委託案件のツールは部門と工程に応じて制限されます。部門別の専門手順はAIの指示に含めます。外部のCodex/Claudeスキルやプラグインを自動接続するものではありません。実メール送信には利用するMCPサーバーのURLと送信ツールの設定が必要です。

## セットアップ

```bash
npm install
```

### 認証について（APIキーは必須ではありません）

AI参加者は `@anthropic-ai/claude-agent-sdk` の `query()` を、`pathToClaudeCodeExecutable` を
指定しない**デフォルト設定**で呼び出しています。SDKの型定義（`sdk.d.ts`）のコメントによると、
これは「指定がなければ組み込みのClaude Code実行ファイルを使う」動作であり、`env` を指定しない
限り「サブプロセスは `process.env` をそのまま引き継ぐ」ため、**このアプリを起動するパソコンで
`claude` に一度ログイン済み（`claude login` / 初回起動時の `/login`、Claude Pro/Max等の
サブスクリプション認証）であれば、追加のAPIキー設定は不要でそのまま動作します**。
認証元を表す `ApiKeySource` 型にも `'none'`（コメント: "no API key in use - e.g. claude.ai OAuth
login"）が明記されており、APIキーなし運用は公式にサポートされています。
出典: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`（インストール済みパッケージ本体、
`pathToClaudeCodeExecutable`/`ApiKeySource`/`env` オプションの定義コメント）

まだ `claude` にログインしていない場合は先にログインしてください。

```bash
claude login
```

Codex案件では、同じPCのCodex CLIへのChatGPTログインを使います。初回は`codex login`で認証してください。アプリにAPIキーや認証情報は保存しません。Windows配布版にはCodexの実行ファイルを同梱します。[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)、[Codex認証](https://learn.chatgpt.com/docs/auth)。

（`ANTHROPIC_API_KEY` 環境変数や Anthropic Console のAPIキーを使う運用も可能です。その場合は
Agent SDKがそちらを優先して使用します。）

## 開発・起動

```bash
npm run build     # tsc + 静的アセットのコピー
npm start          # ビルド後 Electron を起動
npm run dev         # 同上（--devフラグ付き）
npm run typecheck   # 型チェックのみ
npm test            # 委託案件の状態遷移・役割境界テスト
node scripts/smoke-codex-agent.js            # Codex SDKの単発試験
node scripts/smoke-commission-codex-live.js  # Codex案件の実行試験
node scripts/run-scs-commission.js           # SCSのlocalhost検証をCodex案件として実行
```

## 配布用ビルド

```bash
npm run dist   # electron-builder（mac: dmg / win: nsis / linux: AppImage）
```

## 現状のスコープ

- ✅ 会議モデル / AI参加者モデル（招集・一時除籍・再招集、21種の専門家ペルソナ）
- ✅ 発言・議論エンジン（会議タイプごとの進行プロトコル、反論ラウンド）
- ✅ 意思決定（Decision: 理由・各AIの立場・Action Items）と議事録生成
- ✅ Project ↔ Meeting 連携（Project作成・選択、Decisionで生まれたAction ItemsのProjectダッシュボード）
- ✅ 円陣型UI（クマのアバター、AI発言中のリアルタイムハイライト表示）
- ✅ AI対立マップ（最新の立場が賛成寄り⇔反対寄りのAI同士を円陣上で点線接続）
- ✅ コード解析対象ディレクトリの会議中の表示・変更、ワンクリック解析
- ✅ 議題欄のMarkdownテンプレート自動挿入（プロジェクト概要・目的・制約を書ける）
- ✅ ネイティブアプリとしてのビルド導線（electron-builder）
- ✅ ITコンサルタントAIとの企画からAIチームの実作業・内部確認・納品までの委託案件
- ✅ 委託案件でClaudeとCodexの実行エンジンを選択
- ✅ Project内のAIコミュニティ（投稿、AIの議論と課題提案、委託連携、採用知識）
- 🚧 会議一覧のプロジェクト別フィルタ（現状は全会議を横断表示）
