# マニアスタジアム 引き継ぎメモ(無料のClaude向け)

このファイルは、Claude Code(有料プラン)で開発してきたこのアプリを、**無料のclaude.ai**で
相談しながら保守していくための引き継ぎ資料です。

## 使い方

1. claude.ai で新しいチャットを開き、このファイルの中身を丸ごと貼り付ける
2. 続けて「◯◯をしたい」と頼む
3. 直したいファイルがあれば、GitHubでそのファイルを開いて中身をコピーし、チャットに貼る
4. Claudeが返した修正後の内容を、GitHubの画面で貼り替えて保存する(手順は下の「GitHubでファイルを直す」)

無料のClaudeはリポジトリを直接読んだり書き換えたりできません。**必要なファイルは毎回貼り付けてください**。

---

## Claudeへ: このプロジェクトの前提

- リポジトリ: `wvnws2pm8f-maker/sports-mania`(GitHub)
- 公開URL: https://wvnws2pm8f-maker.github.io/sports-mania/ (GitHub Pages)
- 中身: React + Vite の PWA。サッカー(欧州5大リーグ+CL)・NBA・MLB・NFL・F1・ボクシングの
  順位表・試合結果・ニュースを表示する日本語の観戦アプリ
- 持ち主はプログラミングの専門家ではない。手順は「GitHubの画面で、どのファイルの、どこを、どう変えるか」を
  具体的に書き、変更後のファイル全体(長い場合は変更箇所の前後を含む抜粋)を出すこと
- 詳しい設計は `README.md` と各スクリプト冒頭のコメントにある。日付つきで「なぜこうなっているか」が
  書いてあるので、変える前に必ず読むこと

### 自動で動いているもの(GitHub Actions)

| ワークフロー | 頻度 | やること | AI |
|---|---|---|---|
| `update-data.yml` | 15分おき | ESPN等から試合・順位・ニュースを取得し `public/data/` に保存。ニュース見出しを日本語訳 | Gemma 4 31B(混雑時は26B) |
| `update-team-data.yml` | 毎日 JST 12:00 | チームのロースター、好調チームの一言解説 | Gemma 4 26B |
| `update-boxing-data.yml` | 毎日 JST 17:30 | 日付が過ぎたボクシングの試合の結果を、両選手のWikipedia記事の戦績表から読み取って反映 | Gemma 4 26B |
| `deploy.yml` | データ更新のたび | サイトをビルドして公開 | なし |
| `deploy-worker.yml` | (未使用) | 記事本文のその場翻訳用Cloudflare Worker。今はアプリから使っていない | — |

- データ更新の3つは、他の更新と同時に保存してぶつかっても、自動で取り込み直して再試行する
- ボクシングの `src/data/` はビルド時に取り込まれるので、更新後に `deploy.yml` を自動で起動している

### AI(Gemini API)について

- APIキーは GitHub の Secrets に `GEMINI_API_KEY` として登録済み(値はClaudeに見せないこと)
- 無料枠のみで運用している。無料枠は**モデルごと**に別々に数えられる
  - `gemini-3.6-flash`: 1日20回・1分5回しかない。Web検索機能は無料枠では使えなかった
  - Gemma 4 31B / 26B: 1分30回。ニュース・一言解説・ボクシングはこちらを使う
- 使用状況と上限の確認: https://aistudio.google.com/rate-limit
- 使うモデルは `scripts/gemini.mjs` の `MODEL_ROLES` で決まる。コードを変えずに差し替えたい時は、
  GitHubの Settings → Secrets and variables → Actions → Variables に
  `GEMINI_MODEL_NEWS` / `GEMINI_MODEL_COMMENTARY` / `GEMINI_MODEL_BOXING` を登録する
- 枠切れや混雑の時は、その回は諦めて次の実行で再試行する作りになっている(データは壊れない)

### 主なファイル

| ファイル | 内容 |
|---|---|
| `src/data/boxingSchedule.json` | ボクシングの今後の試合(`fights`)と結果(`results`)。**今後の試合の追加は手動** |
| `src/data/boxerProfiles.json` | 注目ボクサーのプロフィール・近況(`recentUpdate`)。**手動で更新** |
| `src/components/HomeView.jsx` | ホーム画面(推し・ニュース・注目カード等) |
| `src/components/BoxingView.jsx` | ボクシング画面 |
| `scripts/*.mjs` | GitHub Actions で動くデータ取得スクリプト |
| `scripts/gemini.mjs` | Gemini/Gemma の呼び出しと、用途ごとのモデル割り当て |
| `scripts/update-boxing-data.mjs` | ボクシング結果の自動反映(Wikipedia + Gemma) |
| `public/data/*.json` | 自動取得されたデータ(手で直さない。次の更新で上書きされる) |

---

## よくある作業

### 1. ボクシングの新しい試合を追加する(手動)

結果は自動で反映されますが、**今後の試合を予定に加えるのは手動**です。

無料のClaudeに次のように頼みます(Web検索が使える場合):

> 今後2〜3か月に予定されている、世界タイトルマッチと日本人選手が出る試合を Web で調べて、
> 下の形式のJSONで出してください。実在と日付・対戦相手を必ず確認し、確認できないものは入れないでください。
> 日本人選手は漢字表記、海外選手は既存データと同じ表記(カタカナか英字)にしてください。
>
> ```json
> {
>   "date": "2026-10-10",
>   "venue": "Wintrust Arena, Chicago",
>   "cardName": "Floyd Schofield vs Lucas Bahdi（空位のWBA世界ライト級王座）",
>   "fighters": ["Floyd Schofield", "Lucas Bahdi"],
>   "broadcast": "DAZN"
> }
> ```

出てきたものを、`src/data/boxingSchedule.json` の `"fights": [ ... ]` の中に、日付順で追加します。

- `fighters` は**必ず2人の名前だけ**。結果の自動反映は、この名前でWikipediaの選手記事を探す
  (日本語の名前は日本語版、それ以外は英語版)。Wikipediaの記事名と同じ表記にしておくと自動反映されやすい
- 追加したら、ファイル先頭の `"updatedAt"` を今日の日付にする

### 2. 自動で反映されない結果を手で入れる

次の場合は自動では反映されないので、手で `fights` から `results` に移します。

- 引き分け・無効試合・中止(画面が「◯◯が勝利」としか表示できないため)
- RTD(棄権)・失格・負傷判定
- 選手のWikipedia記事が無い/戦績表に載らない試合(30日たつとログに「手動で確認してください」と出る)

`results` の1件の形(`note` は無くてもよい):

```json
{
  "date": "2026-09-27",
  "venue": "TOYOTA ARENA TOKYO",
  "cardName": "坪井智也 vs リカルド・マラジカ（WBC世界スーパーフライ級王座決定戦）",
  "fighters": ["坪井智也", "リカルド・マラジカ"],
  "winner": "リカルド・マラジカ",
  "method": "判定(Split Decision, 12回)",
  "note": "坪井智也は目の上のカットに苦しみ、僅差の判定で王座獲得ならず"
}
```

試合方法の書き方: `KO(1回1分5秒)` / `TKO(7回38秒)` / `TKO(9回)` /
`判定(Unanimous Decision 114-113, 116-111, 116-111, 12回)` / `判定(Majority Decision, 10回)` /
`判定(Split Decision, 12回)`。`results` は日付の古い順に並べる。

### 3. 井上尚弥などの近況を更新する

`src/data/boxerProfiles.json` の該当選手の `recentUpdate` を書き換えます。

```json
"recentUpdate": { "checkedAt": "2026-10-03", "summary": "1〜3文の日本語の近況" }
```

### 4. 自動更新がうまく動いているか確かめる

GitHub のリポジトリ → **Actions** タブ → 左の一覧からワークフローを選ぶ → 最新の実行を開く →
`update` → 各ステップを開くとログが読める。ログをコピーしてClaudeに貼れば原因を一緒に探せます。

よく出るログの意味:

| ログ | 意味 | 対応 |
|---|---|---|
| `Gemini API error 503: ... high demand` | Google側が混雑 | 不要(次の実行で再試行) |
| `Gemini API error 429 ... PerDay` | そのモデルの1日の枠を使い切った | 不要(翌日に回復) |
| `翻訳は今回10件までにし、残りは次回に持ち越します` | 少しずつ翻訳している | 不要 |
| `[result] ...: Wikipediaの戦績にまだ載っていません` | 記事がまだ更新されていない | 不要(翌日また調べる) |
| `[result] ...: 2回目の確認で勝者が一致しなかったため見送ります` | 読み取りが食い違った | 手で結果を入れる(作業2) |
| `... は30日以上結果が確認できていません` | 自動では無理だった | 手で結果を入れる(作業2) |

ボクシングの自動反映の精度を確かめたい時は、Actions → **Update Boxing Data** →
右上の **Run workflow** → **dry_run にチェック** → 実行。ファイルは変えずに、直近の登録済み結果を
Wikipediaから読み直して「◯件中◯件一致」とログに出します(2026-10-03時点で 8件中8件一致)。

---

## GitHubでファイルを直す

1. https://github.com/wvnws2pm8f-maker/sports-mania を開く
2. 直したいファイルを開き、右上の鉛筆アイコン(Edit this file)を押す
3. 中身を書き換える(全部貼り替える時は、⌘A で全選択してから貼り付け)
4. 右上の **Commit changes...** → メッセージを書いて **Commit changes**
5. 数分後に自動でサイトに反映される(Actions タブの「Deploy to GitHub Pages」が緑になればOK)

JSONファイルはカンマや括弧が1つずれるとサイトのビルドが失敗します。保存前にClaudeに
「このJSONが正しいか確認して」と頼むと安心です。ビルドが失敗した時は Actions タブで赤くなっているので、
そのログをClaudeに貼ってください。

---

## 経緯メモ(2026-10-02〜03)

- ボクシングは以前、ClaudeのRoutine(毎週月曜)がWeb検索して更新していた。有料プラン解約に備え、
  GitHub Actionsだけで回る今の方式に置き換えた(Routineの指示文は `docs/routines/weekly-boxing-update.md`)
- ニュース翻訳が何時間も止まっていた原因は、`gemini-3.6-flash` の無料枠(1日20回)の使い切り。
  用途ごとに Gemma に分けて解決した
- ニュースの11件目以降に本文(「全文を読む」)が出なかった不具合は修正済み
