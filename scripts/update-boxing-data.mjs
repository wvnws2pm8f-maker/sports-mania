// ボクシングの試合結果・今後の試合・注目選手の近況を、GeminiのWeb検索(グラウンディング)で
// 調べて src/data/boxingSchedule.json と src/data/boxerProfiles.json を更新する。
// ボクシングには安定した無料APIが無いため、以前はClaudeのRoutineが週1回Web検索して
// 手で更新していた内容を、GitHub Actionsだけで回せるようにしたもの(2026-10-02)。
//
// 間違った情報(勝敗の取り違え・存在しない試合)を載せないことを最優先にしている:
// - 検索結果(sources)を1件も参照していない回答は捨てる
// - 勝敗・新しい試合は、聞き方を変えた2回目の検索で同じ答えが返った時だけ反映する
// - 引き分け・無効試合・中止は自動では反映せず、ログに出すだけ(画面が「◯◯が勝利」表示のため)
// 確認できなかったものはそのまま残し、翌日以降の実行で再度調べる。
//
// 実行頻度: 毎日。過去の日付になった試合の結果確認は毎回、新しい試合の検索と
// 選手の近況確認は前回から7日以上空いた時だけ行う(Geminiの無料枠を節約するため)。
import { readFileSync, writeFileSync } from 'node:fs'
import { callGeminiWithSearch, parseGeminiJson, hasGeminiKey, hasQuotaExhausted } from './gemini.mjs'

const SCHEDULE_URL = new URL('../src/data/boxingSchedule.json', import.meta.url)
const PROFILES_URL = new URL('../src/data/boxerProfiles.json', import.meta.url)

const RESULT_LOOKBACK_DAYS = 30 // これより前の未確定の試合は、中止などとみなして毎日調べ直すのをやめる
const WEEKLY_INTERVAL_DAYS = 7
const NEW_FIGHT_HORIZON_DAYS = 90
const MAX_NEW_FIGHTS_PER_RUN = 5

function todayJST() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000)
}

function isDue(lastDate, today) {
  return !lastDate || daysBetween(lastDate, today) >= WEEKLY_INTERVAL_DAYS
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const isText = (s, max = 200) => typeof s === 'string' && s.trim() !== '' && s.length <= max

// 表記ゆれ(空白・中黒・大文字小文字)を無視して名前を比べるための正規化
const normName = (s) => String(s).toLowerCase().replace(/[\s・･.\-]/g, '')

// 検索付きで聞いてJSONを取り出す。検索結果を1件も参照していない回答は根拠が無いので捨てる。
async function askWithSearch(prompt, label) {
  const res = await callGeminiWithSearch(prompt)
  if (!res) return null
  if (res.sources.length === 0) {
    console.warn(`[${label}] 検索結果に基づかない回答だったため破棄します`)
    return null
  }
  const data = parseGeminiJson(res.text)
  if (!data) return null
  return { data, sources: res.sources }
}

function describeFight(f) {
  return `Date (local to venue): ${f.date}\nVenue: ${f.venue}\nCard: ${f.cardName}\nFighter A: ${f.fighters[0]}\nFighter B: ${f.fighters[1]}`
}

// ---- 1. 日付が過ぎた試合の結果を確認して results に移す ----

async function resolvePastFights(schedule, today) {
  let changed = false
  const methodExamples = [...new Set(schedule.results.map((r) => r.method))].slice(-6)
  const noteExamples = schedule.results.map((r) => r.note).filter(Boolean).slice(-3)

  for (const fight of [...schedule.fights]) {
    if (hasQuotaExhausted()) break
    if (!(fight.date < today)) continue
    if (daysBetween(fight.date, today) > RESULT_LOOKBACK_DAYS) {
      console.warn(`[result] ${fight.cardName} は${RESULT_LOOKBACK_DAYS}日以上結果が確認できていません。手動で確認してください`)
      continue
    }

    const first = await askWithSearch(
      `Search the web for the official result of this professional boxing match.

${describeFight(fight)}

Reply with ONLY a JSON object, no other text:
{"status": "finished" | "not_yet" | "cancelled" | "unknown", "winner": "A" | "B" | "draw" | "no_contest" | null, "method": string, "note": string}

Rules:
- Use "finished" only if a search result actually reports the outcome of this exact bout. Never guess, and never assume the more famous or Japanese fighter won.
- "method" must follow the style of these examples exactly (Japanese, round number with 回): ${JSON.stringify(methodExamples)}. Include the stoppage time or scorecards only if a search result states them.
- "note" is an optional short Japanese sentence about notable context (title won, records, upset), in the style of: ${JSON.stringify(noteExamples)}. Use "" if nothing notable.`,
      'result'
    )
    if (!first) continue
    const r = first.data
    if (r.status !== 'finished') {
      console.log(`[result] ${fight.cardName}: 結果未確認 (status=${r.status})`)
      continue
    }
    if (r.winner !== 'A' && r.winner !== 'B') {
      console.warn(`[result] ${fight.cardName}: winner=${r.winner} のため自動反映しません。手動で確認してください`)
      continue
    }
    if (!isText(r.method, 80)) {
      console.warn(`[result] ${fight.cardName}: methodが不正なため反映しません (${JSON.stringify(r.method)})`)
      continue
    }

    // 聞き方を変えてもう一度調べ、勝者が一致した時だけ反映する
    const second = await askWithSearch(
      `Who won the professional boxing match between ${fight.fighters[0]} and ${fight.fighters[1]} held on ${fight.date} at ${fight.venue}? Search for a match report.

Reply with ONLY a JSON object, no other text:
{"winner": "A" | "B" | "draw" | "no_contest" | "unknown"}
where A = ${fight.fighters[0]} and B = ${fight.fighters[1]}.`,
      'result-verify'
    )
    const expected = fight.fighters[r.winner === 'A' ? 0 : 1]
    if (!second || second.data.winner !== r.winner) {
      console.warn(`[result] ${fight.cardName}: 2回目の確認で勝者が一致しなかったため見送ります (1回目=${r.winner}, 2回目=${second?.data.winner})`)
      continue
    }

    const result = {
      date: fight.date,
      venue: fight.venue,
      cardName: fight.cardName,
      fighters: fight.fighters,
      winner: expected,
      method: r.method.trim()
    }
    if (isText(r.note, 120)) result.note = r.note.trim()
    schedule.results.push(result)
    schedule.fights = schedule.fights.filter((f) => f !== fight)
    changed = true
    console.log(`[result] ${fight.cardName}: ${result.winner} ${result.method} (sources: ${first.sources.slice(0, 3).join(', ')})`)
  }

  schedule.results.sort((a, b) => a.date.localeCompare(b.date))
  return changed
}

// ---- 2. 新しく決まった注目試合を fights に追加する ----

function isDuplicateFight(candidate, existing) {
  const names = candidate.fighters.map(normName)
  return existing.some(
    (f) =>
      Math.abs(daysBetween(f.date, candidate.date)) <= 3 && (f.fighters || []).some((n) => names.includes(normName(n)))
  )
}

// 戻り値: null=検索自体に失敗(次回また試す), それ以外=追加した件数
async function addNewFights(schedule, today) {
  const horizon = addDays(today, NEW_FIGHT_HORIZON_DAYS)
  const known = [...schedule.fights, ...schedule.results]
  const knownList = known.map((f) => `${f.date}: ${f.fighters.join(' vs ')}`).join('\n')
  const examples = schedule.fights.slice(0, 3)

  const res = await askWithSearch(
    `Today is ${today}. Search the web for professional boxing matches that are officially scheduled between ${addDays(today, 1)} and ${horizon}, and that are either:
- a world title fight or unification bout (WBA / WBC / IBF / WBO), or
- any fight involving a Japanese boxer.
Skip ordinary non-title fights without a Japanese boxer.

These fights are already known, do NOT include them:
${knownList}

Reply with ONLY a JSON array (use [] if there are none), no other text. Each element:
{"date": "YYYY-MM-DD", "venue": string, "cardName": string, "fighters": [string, string], "broadcast": string}

Style rules — follow these existing entries exactly:
${JSON.stringify(examples, null, 2)}
- "date" is the local date at the venue.
- Japanese fighters' names in kanji (e.g. "井上尚弥"); overseas fighters in the same katakana or Latin spelling style as above.
- "cardName" is "A vs B（weight class / title context in Japanese）".
- "broadcast" only if a search result confirms it, otherwise "".
- Only include a fight if a search result confirms its date and both opponents. Never invent fights.`,
    'new-fights'
  )
  if (!res) return null
  if (!Array.isArray(res.data)) {
    console.warn('[new-fights] 配列以外が返ったため無視します')
    return null
  }

  let added = 0
  for (const c of res.data) {
    if (added >= MAX_NEW_FIGHTS_PER_RUN || hasQuotaExhausted()) break
    const valid =
      c &&
      isDate(c.date) &&
      c.date > today &&
      c.date <= horizon &&
      isText(c.venue) &&
      isText(c.cardName) &&
      Array.isArray(c.fighters) &&
      c.fighters.length === 2 &&
      c.fighters.every((n) => isText(n, 60)) &&
      normName(c.fighters[0]) !== normName(c.fighters[1])
    if (!valid) {
      console.warn(`[new-fights] 形式が不正なため無視します: ${JSON.stringify(c)}`)
      continue
    }
    if (isDuplicateFight(c, [...schedule.fights, ...schedule.results])) {
      console.log(`[new-fights] 登録済みのため無視します: ${c.cardName}`)
      continue
    }

    // 「実はもう終わっていた」「存在しなかった」試合を載せないよう、別の聞き方で再確認する
    const check = await askWithSearch(
      `Is the professional boxing match ${c.fighters[0]} vs ${c.fighters[1]} officially scheduled to take place on ${c.date} at ${c.venue}? Search for an official announcement or news report. Answer false if it has already taken place, was cancelled, is only rumored, or the date differs.

Reply with ONLY a JSON object, no other text:
{"confirmed": true | false, "date": "YYYY-MM-DD" | null}`,
      'new-fights-verify'
    )
    if (!check || check.data.confirmed !== true || check.data.date !== c.date) {
      console.warn(`[new-fights] 2回目の確認が取れなかったため見送ります: ${c.cardName} (${JSON.stringify(check?.data)})`)
      continue
    }

    const fight = {
      date: c.date,
      venue: c.venue.trim(),
      cardName: c.cardName.trim(),
      fighters: c.fighters.map((n) => n.trim())
    }
    if (isText(c.broadcast, 60)) fight.broadcast = c.broadcast.trim()
    schedule.fights.push(fight)
    added++
    console.log(`[new-fights] 追加: ${fight.date} ${fight.cardName} (sources: ${check.sources.slice(0, 3).join(', ')})`)
  }

  schedule.fights.sort((a, b) => a.date.localeCompare(b.date))
  return added
}

// ---- 3. 選手の近況(recentUpdate)を更新する ----

// 戻り値: null=検索に失敗(次回また試す), true/false=更新したかどうか
async function updateBoxerNews(profiles, today) {
  let changed = false
  for (const boxer of profiles.boxers) {
    if (!boxer.recentUpdate) continue
    if (hasQuotaExhausted()) return null
    const current = boxer.recentUpdate.summary

    const res = await askWithSearch(
      `Today is ${today}. Search the latest news about the professional boxer ${boxer.name} (${boxer.weightClass}, ${boxer.titles}): next fight, opponent, date, venue, weight class move, broadcast.

Current summary (checked ${boxer.recentUpdate.checkedAt}):
${current}

Reply with ONLY a JSON object, no other text:
{"hasNewInfo": true | false, "summary": string}

- "hasNewInfo" is true only if a search result reports a concrete new fact that is not in the current summary (e.g. officially announced opponent or date, a change of plans). Rewording or rumors already covered do not count.
- If true, "summary" is a fresh 1-3 sentence Japanese summary in the same tone as the current summary, containing only facts confirmed by search results. If false, use "".`,
      'news'
    )
    if (!res) return null
    if (res.data.hasNewInfo !== true) {
      console.log(`[news] ${boxer.name}: 新しい情報なし`)
      continue
    }
    if (!isText(res.data.summary, 400)) {
      console.warn(`[news] ${boxer.name}: summaryが不正なため反映しません`)
      continue
    }

    const check = await askWithSearch(
      `Fact-check this Japanese summary about the boxer ${boxer.name} against current news (today is ${today}):
${res.data.summary}

Reply with ONLY a JSON object, no other text:
{"accurate": true | false}

Answer true only if every factual claim in it is supported by search results.`,
      'news-verify'
    )
    if (!check || check.data.accurate !== true) {
      console.warn(`[news] ${boxer.name}: 事実確認が取れなかったため見送ります`)
      continue
    }

    boxer.recentUpdate = { checkedAt: today, summary: res.data.summary.trim() }
    changed = true
    console.log(`[news] ${boxer.name}: 更新 (sources: ${res.sources.slice(0, 3).join(', ')})`)
  }
  return changed
}

// fighters配列は既存ファイルと同じく1行で書く(差分を見やすくするため)
function toJson(obj) {
  return (
    JSON.stringify(obj, null, 2).replace(
      /"fighters": \[\s*("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*")\s*\]/g,
      '"fighters": [$1, $2]'
    ) + '\n'
  )
}

async function main() {
  if (!hasGeminiKey()) {
    console.log('GEMINI_API_KEY が無いためスキップします')
    return
  }
  const today = todayJST()
  const schedule = JSON.parse(readFileSync(SCHEDULE_URL, 'utf8'))
  const profiles = JSON.parse(readFileSync(PROFILES_URL, 'utf8'))
  const state = { ...(schedule.autoUpdate || {}) }

  let scheduleChanged = await resolvePastFights(schedule, today)

  if (isDue(state.lastFightSearchAt, today) && !hasQuotaExhausted()) {
    const added = await addNewFights(schedule, today)
    if (added !== null) {
      state.lastFightSearchAt = today
      if (added > 0) scheduleChanged = true
    }
  }

  let profilesChanged = false
  if (isDue(state.lastNewsCheckAt, today) && !hasQuotaExhausted()) {
    const changed = await updateBoxerNews(profiles, today)
    if (changed !== null) {
      state.lastNewsCheckAt = today
      profilesChanged = changed
    }
  }

  if (hasQuotaExhausted()) console.warn('Geminiの無料枠を使い切ったため、残りは次回の実行で確認します')

  if (scheduleChanged) schedule.updatedAt = today
  if (profilesChanged) profiles.updatedAt = today
  // 検索の記録(autoUpdate)は、実際に検索できた時だけ変わる。何も変わらなかった回に
  // 空の記録だけを書き込んでコミット・再デプロイしないよう、変化がある時だけ書き出す。
  if (JSON.stringify(state) !== JSON.stringify(schedule.autoUpdate || {})) schedule.autoUpdate = state
  const scheduleJson = toJson(schedule)
  if (scheduleJson !== readFileSync(SCHEDULE_URL, 'utf8')) writeFileSync(SCHEDULE_URL, scheduleJson)
  if (profilesChanged) writeFileSync(PROFILES_URL, toJson(profiles))
  console.log(`完了: 試合データ${scheduleChanged ? '更新あり' : '変更なし'} / 選手の近況${profilesChanged ? '更新あり' : '変更なし'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
