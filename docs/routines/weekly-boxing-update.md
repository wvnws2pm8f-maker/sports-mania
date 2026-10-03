# 週次ボクシングデータ更新 (Claude Routine)

> **2026-10-03 以降は使っていません。** ボクシングの結果は GitHub Actions(`update-boxing-data.yml`)が
> 選手のWikipedia記事から自動で反映するようになりました。今の運用は `docs/HANDOFF.md` を見てください。
> このファイルは、ClaudeのRoutineを再び使いたくなった時のための控えとして残しています。

Claude Code の Routine(スケジュール実行)で動かしている処理の控え。
Claude のプランを解約・再開して Routine が消えていた場合は、この内容で作り直す。
Claude を使わずに手で更新するときの手順書としても使える。

## 設定

| 項目 | 値 |
|---|---|
| 名前 | `sports-mania: weekly boxing data update` |
| スケジュール | `0 0 * * 1`(毎週月曜 UTC 0:00 = JST 9:00) |
| 実行方式 | 実行ごとに新しいセッションを作成 |
| 対象ファイル | `src/data/boxingSchedule.json`, `src/data/boxerProfiles.json` |

## 作り直し方

Claude Code のセッションで次のように頼む:

> `docs/routines/weekly-boxing-update.md` の「プロンプト」をそのまま使って、
> 毎週月曜 JST 9:00 に新しいセッションで実行される Routine を作って

## プロンプト

以下を Routine のプロンプトとしてそのまま使う。

````text
You maintain boxing data for "マニアスタジアム" (Mania Stadium), a Japanese sports PWA app. The repo is checked out at the repo root. This runs weekly (every Monday) — your job is to keep two files current using ONLY verified facts from WebSearch, never guesses or assumptions.

FILE 1: `src/data/boxingSchedule.json`, shape:
```json
{
  "updatedAt": "YYYY-MM-DD",
  "note": "...",
  "results": [ { "date": "YYYY-MM-DD", "venue": "...", "cardName": "...", "fighters": ["A","B"], "winner": "...", "method": "...", "note": "..." (optional) } ],
  "fights": [ { "date": "YYYY-MM-DD", "venue": "...", "cardName": "...", "fighters": ["A","B"], "broadcast": "..." } ]
}
```
`results` is chronological ascending, newest last. `fighters` must be exactly the two fighter names as plain strings (used elsewhere in the app to let users individually follow/pin a fighter) — match the spelling style already used in the file (Japanese fighters in kanji, e.g. "井上尚弥"; overseas fighters in katakana or roman letters matching existing entries).

FILE 2: `src/data/boxerProfiles.json`, shape:
```json
{ "updatedAt": "...", "note": "...", "boxers": [ { "name": "...", "weightClass": "...", "titles": "...", "record": "...", "note": "...", "recentUpdate": { "checkedAt": "...", "summary": "..." } } ] }
```

TASKS (in order):

1. Read `src/data/boxingSchedule.json`. Determine today's real date (`date +%Y-%m-%d`). For every entry in `fights` whose `date` is in the past, WebSearch for that specific fight's actual result (winner, method: for KO/TKO give round+time if available e.g. "TKO(7回38秒)"; for decisions give type+scorecards if available e.g. "判定(Unanimous Decision 114-113, 116-111, 116-111, 12回)" — match the exact style/format of existing `results` entries in the file). Move each resolved fight from `fights` to `results` (append in date order) with `winner`, `method`, and an optional short `note` (Japanese) for notable context (title won, dramatic finish, etc.). NEVER assume the higher-profile or Japanese fighter won — record the true result even if they lost. If you cannot find a verifiable result for a past-dated fight after searching, leave it in `fights` untouched and mention this in your final summary rather than guessing.

2. WebSearch for newly-confirmed notable upcoming boxing matches scheduled in roughly the next 2-3 months that are NOT already present in `fights` (check by fighter names + date). Focus only on: world title fights / unification bouts, or ANY fight involving a Japanese boxer (regardless of title status) — do not add routine non-title club fights. For each, add an entry to `fights` with `date`, `venue`, `cardName` (mirror the existing style: fighters + weight class/title context in parentheses, Japanese), `fighters` (array of 2 names), and `broadcast` if you can confirm it. Verify each one is real via WebSearch before adding (this project has been burned before by adding fights that turned out to already be long over or nonexistent — always confirm date, participants, and that the fight is real).

3. WebSearch for any material update on 井上尚弥 (Naoya Inoue)'s next fight status (opponent, date, weight class considerations). If there's genuinely new confirmed information beyond what's already in `boxerProfiles.json`'s `recentUpdate.summary`, replace that field with `checkedAt` = today and a fresh 1-3 sentence Japanese summary in the same tone as the existing one. If nothing has changed, leave it untouched.

4. For any file you actually modified in steps 1-3, update its top-level `updatedAt` to today's date (YYYY-MM-DD).

5. Validate: run `python3 -m json.tool src/data/boxingSchedule.json` and `python3 -m json.tool src/data/boxerProfiles.json` to confirm both are valid JSON (fix immediately if not). Then run `npm install` if node_modules is missing, and `npm run build` to confirm the app still builds cleanly with no errors.

6. If you made zero changes (no past-dated fights needed resolving, no new notable fights found, no Inoue news), STOP HERE — do not commit anything.

7. If you made changes: `git add` only the files you touched (`src/data/boxingSchedule.json` and/or `src/data/boxerProfiles.json` — never anything else), commit with a clear message in English summarizing what changed (which fights got results with their outcomes, which new fights were added, in a few lines), then run `git push`. If `git push` fails for any reason (auth, permissions, diverged branch), instead create a new branch named `boxing-update-YYYY-MM-DD`, push that branch, and open a pull request with `gh pr create` using the same summary as the PR body. Do not force-push and do not touch any branch other than the one you create.

CONSTRAINTS:
- Every date/venue/result/fighter fact must trace back to an actual WebSearch result you performed this run — never invent, infer, or assume outcomes.
- Match the existing Japanese phrasing/style in both files exactly (look at current entries before writing new ones).
- Do not touch any file other than the two named above.
- Do not create an empty/no-op commit.

End with a short summary (Japanese is fine) of exactly what you changed, or state clearly that nothing needed updating this week.
````
