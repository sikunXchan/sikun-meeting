# スマホで会議を見るPWAの設計

更新日：2026-09-26
対象要件：AC-01〜AC-14

## 現在の実装から確認したこと

- 会議は `Meeting`（`src/core/types.ts`）で、`transcript` は公開済みの発言だけを持つ。初回意見の非公開分は `initialRound.responses` にある。`workingDirectory` はローカルの絶対パス。
- 画面のHTML整形は `src/renderer/sanitize.ts`（許可リスト方式）、Markdownは `marked` のUMD版を `scripts/copy-static.js` でコピーして使う。
- ペルソナの画像は `src/renderer/assets/personas/`（23ファイル、約800KB）。
- Vercel Blobは `put(pathname, body, { access: 'private', allowOverwrite: true })` で非公開保存と上書きができ、`get(pathname, { access: 'private', useCache: false })` でCDNを経ずに最新を読む（https://vercel.com/docs/vercel-blob/private-storage 、https://vercel.com/docs/storage/vercel-blob ）。非公開Blobの応答には `Cache-Control: private, no-cache` と `X-Content-Type-Options: nosniff` を推奨している（同上）。
- Vercel Functionsは `api/` 配下のファイルが関数になる（https://vercel.com/docs/errors/error-list の functions パターン）。

## 変更方法

### 構成

同じリポジトリに `mobile/` を置き、Vercelのプロジェクトは Root Directory を `mobile` にする。

| 場所 | 役割 |
|---|---|
| `mobile/api/snapshot.js` | Vercel Function。`lib/handler.js` にVercel Blobの保存口をつなぐ |
| `mobile/lib/handler.js` | 読み取り・書き込み・削除の検証（純関数、保存口を差し替えてテスト） |
| `mobile/public/` | PWA（`index.html`、`js/app.js`、`js/crypto.js`、`js/sanitize.js`、`vendor/marked.umd.js`、`sw.js`、`manifest.webmanifest`、アイコン、`personas/`） |
| `mobile/vercel.json` | 出力先 `public`、CSPなどのヘッダー、`sw.js` のキャッシュ無効 |
| `scripts/sync-mobile-assets.js` | デスクトップの `sanitize.js`、`marked`、ペルソナ画像を `mobile/public` にコピー。テストで一致を確認 |

### 暗号化と鍵

- デスクトップが32バイトの乱数で共有鍵を作る。HKDF-SHA256（salt `sikun-meeting-mobile-v1`）で、AES-256-GCMの暗号鍵（info `enc`）と保存用ID（info `id`、32バイトを16進）を導く。
- 送るのは `{ v: 1, alg: 'A256GCM', gzip: true, iv, data }`（`data` はgzipした平文の暗号文と認証タグ、Base64）。生成日時などはすべて暗号文の中に入れる。
- スマホへはURLの `#k=<鍵>` で渡す。フラグメントはサーバーに送られない。PWAは鍵を `localStorage` に保存し、`history.replaceState` でURLから消す。
- 鍵を作り直すと、新しいIDで保存し、古いIDの暗号文をAPIで削除する。

乱数鍵を二次元コードで渡す方式にした理由：合言葉方式だと、IDを導くために固定のsaltが要り、サーバーが持つ暗号文に対する総当たりの余地が残る。乱数鍵ならIDも推測できず、暗号文そのものを取得できない。

### API

- `GET /api/snapshot?id=<64桁16進>`：暗号文を返す。未保存は404。`Cache-Control: no-store`。
- `PUT /api/snapshot?id=...`：`Authorization: Bearer <SYNC_TOKEN>` が必要。本文は上の形式のJSONで4MB以下。
- `DELETE /api/snapshot?id=...`：同じ認証。
- トークンの比較は長さをそろえた `timingSafeEqual`。環境変数 `SYNC_TOKEN` が未設定なら書き込み系はすべて拒否する。
- 保存先は `snapshots/<id>.json`（`access: 'private'`、`allowOverwrite: true`）。読み取りは `useCache: false`。

### デスクトップ

- `src/core/mobile/snapshot.ts`：会議・Projectを読み取り用の形に変換する。作業ディレクトリ、モデル名、未公開の初回意見、議決ゲートの内部数値は含めない。ペルソナ名・絵文字・画像名を付ける。
- `src/core/mobile/envelope.ts`：Node `crypto` でHKDF・AES-256-GCM・gzip。
- `src/core/mobile/service.ts`：`MobileSyncService`。設定（公開先URL、有効、鍵）を `mobile-sync.json` に保存。トークンは差し替え可能な保存口で扱う。30秒ごと（と手動）に平文のハッシュを比べ、変わったときだけ暗号化して送る。4MBを超えたら古い会議から外す。直近の結果（時刻、件数、省略数、エラー）を保持する。
- `src/main/mobileToken.ts`：Electronの `safeStorage` が使えれば暗号化して保存する。使えない環境では保存せず、環境変数 `SIKUN_MOBILE_SYNC_TOKEN` を使う。
- 画面：サイドバーの「📱 スマホで見る」。公開先URL、同期トークン、有効化、今すぐ同期、状態、二次元コード（npm `qrcode`、MIT）、鍵の作り直し。

### PWA

- 一覧（Projectで絞り込み、状態、日付、決定の要約）と詳細（議題、参加者と最新の立場、発言、決定、理由、各AIの立場、Action Item）。ルーティングは `#/m/<会議ID>`。
- Markdownは `marked` → `sanitize.js`（デスクトップと同じファイル）で表示する。
- Service Workerはアプリ本体をキャッシュし、`/api/snapshot` はネットワーク優先で失敗時に最後の応答を返す（中身は暗号文）。
- CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`。

## データと外部への影響

デスクトップに `mobile-sync.json`（URL、有効、鍵）と、`safeStorage` で暗号化したトークンを保存する。鍵は会議データと同じ機密度でローカルに置く（会議データ自体もローカルでは平文）。Vercel側には暗号文だけが保存される。新しい依存：デスクトップ `qrcode`、Vercel側 `@vercel/blob`。

## 確認する範囲

`npm test` に、APIの認証・検証、スナップショットの除外項目、暗号化の往復（スマホ側の `crypto.js` をNodeで実行）、同期サービスの差分送信・省略・鍵の作り直し、コピーした資材の一致を加える。ローカルで同じAPIを動かすサーバーを用意し、Electronから同期してChromiumのスマホ幅で表示・オフラインを確認する。実際のVercelへのデプロイはユーザーが行うため未確認として残す。

## 設計変更の記録

なし
