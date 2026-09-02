# AI Team Meeting OS

人間を「最高開発者（Chief Developer）」とし、複数のAI専門家（Architect / Critic / Product /
Security / Analyst / Researcher / Finance / DevOps）を会議に招集して議論させ、最終的な意思決定は
常に人間が行う——という体験のためのデスクトップアプリ（Electron + TypeScript）です。

UI/UXは意図的に最小限にしてあり、今回のスコープはバックエンド（会議モデル・AI参加者モデル・
議論エンジン・意思決定・議事録）とネイティブアプリとしてのビルド導線です。

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
  異なり、招集順に1体ずつ逐次発言させることで、後発のAIが直前の発言を踏まえて賛成/反対/反論
  できるようにしています。
- **永続化**: `src/core/store` に単一JSONファイルへのアトミック書き込みストア。DBサーバー不要で、
  Electronの `userData` ディレクトリ配下に保存されます。

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

（`ANTHROPIC_API_KEY` 環境変数や Anthropic Console のAPIキーを使う運用も可能です。その場合は
Agent SDKがそちらを優先して使用します。）

## 開発・起動

```bash
npm run build     # tsc + 静的アセットのコピー
npm start          # ビルド後 Electron を起動
npm run dev         # 同上（--devフラグ付き）
npm run typecheck   # 型チェックのみ
```

## 配布用ビルド

```bash
npm run dist   # electron-builder（mac: dmg / win: nsis / linux: AppImage）
```

## 現状のスコープ

- ✅ 会議モデル / AI参加者モデル（招集・一時除籍・再招集）
- ✅ 発言・議論エンジン（会議タイプごとの進行プロトコル、反論ラウンド）
- ✅ 意思決定（Decision: 理由・各AIの立場・Action Items）と議事録生成
- ✅ Project ↔ Meeting 連携（Decisionで生まれたAction ItemsをProjectに転記）
- ✅ ネイティブアプリとしてのビルド導線（electron-builder）
- 🚧 円陣型UI・デザイン（今回は最小限の機能的UIのみ）
