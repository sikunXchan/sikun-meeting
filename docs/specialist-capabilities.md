# 部門別の手順・権限・外部接続

更新日：2026-09-26

## 現在の割り当て

| 部門 | アプリ同梱の専門手順 | 主な適用工程 |
|---|---|---|
| IT Consultant | `requirements-framing` | 相談・計画 |
| Product | `product-planning` | 会議・計画・作業・確認 |
| Architect | `architecture-review` | 会議・計画・作業・確認 |
| Engineer、Backend | `implementation` | 会議・作業 |
| QA | `acceptance-verification` | 会議・確認・目標確認 |
| Security | `security-review` | 会議・作業・確認 |
| Critic | `critic-evidence` | 会議・確認・目標確認・KGI確認 |
| Researcher、Innovator、Analyst、Finance、Legal、Designer、Marketing、DevOps、Writer、AI Researcher、Support、Data Engineer、Cloud、Visionary | 役割別の指示と共通の根拠確認手順 | 必要な会議・仕事・確認 |

同梱スキルは役割と工程から選ばれ、ClaudeとCodexのプロンプトに加わる。RunにはIDと版が残る。ツール権限は別に`src/core/capabilities.ts`で決める。会議と目標確認は読み取り専用、作業の書き込みは案件の作業先に限る。Codex SDKには個別ツールの許可リストがないため、非コード部門のコマンド実行制限は指示に依存する。

## 次に追加する基準

1. 実案件で同じ判断の失敗が繰り返され、短い役割指示だけでは防げない。
2. 手順に入力、確認方法、完成の証拠を具体的に書ける。
3. 手順を適用したRunと成果物で改善を確かめられる。

次の候補は、出典と鮮度を確認するResearcher、実画面の操作負荷を測るDesigner。FinanceとLegalは、対象の法域・会計基準・原資料を特定できる案件で個別に設計する。部門の数に合わせて形式的にスキルを増やさない。

実機試験で判明した優先課題は、QAがHTMLの画面操作を独立して検証するためのブラウザハーネス。Codexの確認工程は元の成果物を守るため読み取り専用で、Chromeの隔離プロファイルを作れず、試験ではQAが正しく差し戻した。担当AIや人間がブラウザで成功したことと、QAが独立して成功を確認したことは別に記録する。将来のハーネスは元の成果物を変更できない状態を保ち、隔離したブラウザで操作・再読込・結果を確認できる必要がある。

外部MCPやプラグインは業務の接続先ごとに、許可する操作と人間の確認点を定義してから使う。現時点ではメールの下書き・明示的な送信経路があるが、MCPサーバーのURLと送信ツールが未設定なので実送信は未確認。会計など具体的な利用予定のないサービスは接続しない。

このCodex環境ではGmailコネクタがインストール済みと確認できたが、Sikun MeetingのメールMCP設定には自動で引き継がれない。アプリで使うメールサービスは、利用するアカウントと接続方法が決まった時点で設定する。
