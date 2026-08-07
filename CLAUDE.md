# japan-proxy-cost（Japan Proxy Cost Calculator）

日本の購入代行サービス（Buyee / ZenMarket / Neokyo / FROM JAPAN）の着地総額を比較する英語のWebツール。
背景・調査結果は [要件定義書.md](./要件定義書.md)、料金の一次情報は [料金データ収集メモ.md](./料金データ収集メモ.md) を参照。

## 技術スタック（2026-08-07確定）

- フロントエンド: React + Vite（既存2アプリと共通）
- **バックエンドなし**。計算はブラウザ内で完結し、料金データは `data/*.json` を同梱する
- ホスティング: Cloudflare Workers（GitHub Actions から `npx wrangler deploy`）
- 本番URL: https://japanproxy.kakuni-lab.com

Render も UptimeRobot も使わない（スリープ問題が発生しない）。運用コストはゼロ。

## SEO（このアプリの生命線）

SNS運用も動画撮影も行わないため、**流入は検索のみ**。したがって静的HTML生成が必須。

- `scripts/prerender.mjs` を `postbuild` で実行し、**153ページ**（比較42・仕入れ元別49・重量別49・料金解説4・輸入税7・トップ1・404）と sitemap.xml / robots.txt を生成する
- **`dist/foo/index.html` ではなく `dist/foo.html` に出力すること。** 前者は Cloudflare で `/foo` → `/foo/` の307リダイレクトが挟まり canonical と食い違う（[技術記事](../../技術記事プロジェクト/articles/vite-spa-prerender-cloudflare.md)参照）
- 検証は `vite preview` ではなく **`wrangler dev`** で行う。前者はSPAフォールバックが優先され、静的HTMLが使われない
- `not_found_handling = "404-page"` にしているので **`dist/404.html` の生成が必須**（無いと本文ゼロバイトの白ページになる）
- ページを増やす際は、**そのページ固有の実計算値が載ること**を必ず守る。テンプレートを言い換えただけのページは Google の "scaled content abuse" に該当する

## 料金データを触るときの鉄則

- **未確認の項目を黙って0円扱いにしない。** データが欠けている会社が不当に安く見え、利用者に嘘をつくことになる。`unverified: true` を立てて warnings に出す
- **輸入税は「配送先の国」の制度であって代行会社の性質ではない。** 代行が決めるのは事前徴収か着払いかだけ。単純に足すと、正直に事前徴収している会社ほど高く見える。必ず ①代行に払う額 / ②到着時に払う額 / ③合計 の3段に分けて全社に同条件で乗せる
- `npm run verify` が、手計算で検証済みの試算表と一致するかを確認する。**料金データを変更したら必ず実行する**（CIでも走る）
- `npm run scenarios` で「条件次第で最安が入れ替わるか」を確認できる。1社が全シナリオで最安になったら、比較ツールとしての価値がないので設計を見直す

## 収益モデル

3本立て。1本目が弱いことが判明しているため分散させている。

1. **直販ストアのアフィリエイト**（主力想定）— Kokoro 20% / YesStyle 10% / CDJapan 7% / HobbyLink Japan 3% 等。「この商品は代行不要」と正直に伝える導線
2. **代行サービスのアフィリエイト**（薄い）— **FROM JAPAN は現金報酬なし**（FJポイントのみ・換金不可）。ZenMarket は登録1件¥100。Buyee は ASP 経由で条件非公開
3. **AdSense** — `kakuni-lab.com` はドメイン全体で承認済みのため `ca-pub-1372013098776592` のタグを置くだけでよい

**最安が FROM JAPAN（報酬ゼロ）になるケースが多いが、正直に出す。** 嘘をつくとツールの存在価値が消える。

## プラットフォーム方針

当面はWEBアプリのみ。iOS化は保留（検索流入が軸のため）。ルートCLAUDE.mdの「Web版とiOS版で整合性を保つ」は本プロジェクトでは一時適用対象外。
