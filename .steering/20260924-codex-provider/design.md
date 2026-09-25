# Codex実行エンジンの設計

更新日：2026-09-24
対象要件：AC-01〜06

## 現在の実装から確認したこと

- `CommissionService` は `AgentClient` を1つ受け取り、相談・計画・作業・確認・納品の各Runを同じ経路で実行する。`createAppContext` はClaude用の `SdkAgentClient` を渡す。
- 案件設定にはClaude用のフェーズ別モデルと呼び出し回数・ターン数がある。種別のない既存保存データがある。
- `CommissionStore` は案件とRunを保存し、各Runの前後に作業ディレクトリの差分を取る。これはCodexの作業にも使える。
- このPCのCodex CLI 0.156.1はChatGPTでログイン済み。公式 `@openai/codex-sdk` 0.156.1を一時領域に導入し、`gpt-6-sol` の読み取り専用Runが実応答した。SDK型には `startThread`、`runStreamed`、`workingDirectory`、モデル指定、`read-only`/`danger-full-access`、中断Signalがある。Runイベントには実応答モデルIDがない。
- 公式資料：[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)、[Codexの認証](https://learn.chatgpt.com/docs/auth)。SDKはローカルCodexを操作し、CLIのChatGPTログインを利用できる。アプリ自身はAPIキーや認証情報を保存しない。

## 変更方法

案件設定に `provider: 'claude' | 'codex'` と `codexModel` を追加する。新規の既定はClaude、Codexモデルの既定は `gpt-6-sol`。既存案件で `provider` が欠ける場合はClaudeと解釈し、保存内容を一括書き換えない。Codex案件の全フェーズはCodexモデルを使い、Claude用のモデル・代替設定には触れない。

`RoutedAgentClient` がRunごとの案件種別でClaudeまたはCodexのクライアントを選ぶ。Codexクライアントは公式TypeScript SDKを動的importし、各Runごとに作業ディレクトリを指定してスレッドを作る。相談・計画は `read-only`、作業・内部確認は `danger-full-access`、承認方針は `never` とする。アプリ内の担当・所管・内部確認・採用状態は現在の仕組みを通す。Runのコマンドとファイル変更イベントは活動履歴へ要約して記録する。中断Signalと通常12分の時間制限をSDKに渡し、納品文の生成は60秒で打ち切る。

全仕事が内部確認を通過した後、納品文のSDK呼び出しだけが失敗・時間切れになった場合は、既存の仕事・確認判断・採用成果ファイルから機械的な納品文を作る。報告冒頭に代替生成であることと元の失敗理由を記し、活動履歴にも残す。一時停止・停止による中断では代替納品せず、通常の中断状態を維持する。仕事や内部確認が失敗した場合も代替納品しない。

Codex SDKのイベントで確認できる応答本文と利用ターン数を保存する。実応答モデルのフィールドがないため `effectiveModel` は未確認のまま残し、要求モデルだけを表示する。CodexではClaude用の `fallbackModel` と `maxTurnsPerCall` を適用しない。Codexの実行量は案件の呼び出し回数とRunの時間制限で制御し、画面ではCodex選択時に適用外の設定を隠す。

Windows配布版ではCodex SDKの同梱CLI実行ファイルを `extraResources` にコピーし、SDKの `codexPathOverride` に渡す。開発時はSDKが同梱する標準CLIを利用する。CLIはOS側のCodexログイン状態を読む。配布先が未ログインなら、認証不足をエラーとして表示する。

| 変更箇所 | 変更内容 | 対応条件 |
|---|---|---|
| `src/core/commission/types.ts`、`service.ts` | 案件種別・Codexモデルの設定、既存案件のClaude互換、Runへの種別記録 | AC-01〜04 |
| `src/core/commission/codexAgent.ts`、ルータ | 公式SDKの呼び出し、イベント・中断、実行経路の切替 | AC-01〜04 |
| `src/core/index.ts`、`package.json` | 両実行クライアントの組み立てとWindows CLIの同梱 | AC-03、05 |
| `src/renderer/index.html`、`commission.ts` | 案件作成時の実行エンジン・モデル選択とRun表示 | AC-01、03、05 |
| テスト、試験スクリプト | 互換・経路・中断・配布版の縦断試験 | AC-01〜05 |
| `sikunXchan/sikun-cyber-security` の作業ツリー | 認可スコープのURL解析とWindowsのGit Bash選択を改良し、回帰試験を追加 | AC-06 |

## データと外部への影響

既存案件には `provider` がなく、読み込み時にClaudeへフォールバックする。新規案件は種別を保存し、以後の修正・再開でも変えない。Codexは選択した作業ディレクトリを読む。作業・内部確認フェーズではその外もOS権限上は触れられるため、対象リポジトリを確認してから依頼する。成果の自動追跡は指定した作業ディレクトリ内に限る。外部リポジトリへのpushやPRはCodexのローカル実作業とは分けて検証する。

## 確認する範囲

`npm test` と型・ビルド検査で経路切替、旧案件のClaude互換、Codexの中断・失敗、納品文失敗時の代替報告を確認する。開発版でCodex SDKの読み取り専用相談と小さな実作業を試し、Windows配布版でアプリ画面からCodex案件を起こして相談→計画→ファイル作成→内部確認→納品を確認する。対象リポジトリでは、URLのauthorityを`urlparse`で解釈して接続先を抽出し、WindowsではGit Bashの実行ファイルを明示する。認可スコープ、並行シェル、永続シェルの回帰試験と全テストで検証する。

## 設計変更の記録

2026-09-24：初回の実SDK縦断試験は内部確認まで通過したが、納品文の呼び出しが5分以内に終わらなかった。確認済みの成果を失敗扱いにしないため、納品文だけ短い制限時間と証拠ベースの代替報告を追加する。

2026-09-24：ユーザーが `https://github.com/sikunXchan/sikun-cyber-security` を指定した。旧名は実体のない推測だったため、対象をこのリポジトリに確定した。コードを調べて認可スコープのURL解析とWindowsのシェル選択に具体的な欠陥を確認し、AC-06の改善対象とした。
