# 20260926-スマホ閲覧PWAの再開メモ

更新日時：2026-09-26 01:00 UTC
状態：確認待ち（Vercelへのデプロイ、実機スマホ）

## 次の操作

README「スマホで見る（PWA）」の手順でVercelにデプロイし、デスクトップの「📱 スマホで見る」から同期して、実機のスマホで二次元コードを読み取り、一覧・詳細・ホーム画面追加・オフライン表示を確認する。

## 再開する環境

- リポジトリ・ブランチ：sikunXchan/sikun-meeting・`claude/feature-ideas-50-hzt0sq`（PR #1）
- 最後に確認したコミット：このメモを含むコミット（基点 `adffacf`）
- 未コミットの変更：なし

## 現在地

実装済み・自動テスト済み：保存API、暗号化スナップショット、同期サービス、鍵の作り直し、資材の一致。
実起動で確認済み：ローカルの同じAPIでデスクトップ→スマホ幅Chromiumの表示、Service Worker、オフライン。
未確認：tasklist.mdの「未確認」を参照。

## 未解決事項

- スマホからの書き込み、委託案件・コミュニティの表示、プッシュ通知は対象外。必要なら別作業にする。
- Vercel Functionsの本文上限の公式値は未確認（4MBで制限）。

## 繰り返さなくてよい調査

- Vercel Blobの非公開保存：`put(..., { access: 'private', allowOverwrite: true })`、最新の読み取り：`get(..., { access: 'private', useCache: false })`、見つからなければ `null`（`@vercel/blob` 2.8.0 の `dist/index.d.ts`）。
- Linuxコンテナでは `safeStorage` が実質平文の `basic_text` になるため保存を拒否し、環境変数を使う。
- `pkill -f` はシェル自身の引数にも一致して自分を止めることがある。`ps -eo pid,args` で対象を絞る。

## 読む必要がある資料

- docs/decisions.md の D-010
- docs/product-requirements.md の P-017
