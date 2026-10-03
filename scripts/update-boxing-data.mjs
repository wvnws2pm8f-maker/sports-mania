// ボクシングの試合結果と今後の注目試合を、Wikipediaの記事から自動で取り込んで
// src/data/boxingSchedule.json を更新する。
//
// 【経緯】ボクシングには安定した無料APIが無い。以前はClaudeのRoutineが週1回Web検索して
// 更新していたが、無料で回せるよう GitHub Actions + Gemini のWeb検索に移行しようとした
// (2026-10-02)。ところがGeminiのWeb検索(グラウンディング)は無料枠では使えなかった
// (2026-10-03、検索付きの呼び出しだけが理由なしの429で断られた)。
// そこで「その年のボクシング」のWikipedia記事(公開APIで無料・キー不要)を取得し、
// その文章の中からだけGemma(無料枠)に試合を抜き出させる方式にした。
//
// 間違った情報を載せないことを最優先にしている:
// - Gemmaには記憶ではなく、渡したWikipediaの文章からだけ答えさせる
// - 選手名・会場・試合方法の数字(ラウンド・時間・採点)・団体名が、元の文章に実際に
//   書かれているかをプログラムで確かめ、書かれていなければ捨てる
// - 勝敗は聞き方を変えて2回聞き、同じ答えの時だけ反映する
// - 引き分け・無効試合・中止は自動では反映しない(画面が「◯◯が勝利」表示のため)
// 確認できなかったものはそのまま残し、翌日以降の実行で再度調べる。
//
// 選手の近況(boxerProfiles.jsonのrecentUpdate)は、Wikipediaからは確実に取れないため
// 自動更新の対象外(手動で更新する)。
//
// 実行頻度: 毎日。結果の確認は毎回、新しい試合の追加は前回から7日以上空いた時だけ。
// BOXING_DRY_RUN=1 の時は、反映する内容をログに出すだけでファイルは書き換えない。
import { readFileSync, writeFileSync } from 'node:fs'
import { callGemini, parseGeminiJson, hasGeminiKey, hasQuotaExhausted } from './gemini.mjs'

const SCHEDULE_URL = new URL('../src/data/boxingSchedule.json', import.meta.url)

const RESULT_LOOKBACK_DAYS = 30 // これより前の未確定の試合は、中止などとみなして毎日調べ直すのをやめる
const WEEKLY_INTERVAL_DAYS = 7
const NEW_FIGHT_HORIZON_DAYS = 90
const MAX_NEW_FIGHTS_PER_RUN = 5
const EXCERPT_MAX_CHARS = 6000 // Gemmaの無料枠は1分あたり16Kトークンなので、1回に渡す文章は控えめに
const GEMMA_CALL_INTERVAL_MS = 15000 // 同じ理由で、呼び出しの間を少し空ける
const DRY_RUN = process.env.BOXING_DRY_RUN === '1' || process.env.BOXING_DRY_RUN === 'true'
const USER_AGENT = 'sports-mania-bot/1.0 (https://github.com/wvnws2pm8f-maker/sports-mania)'

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const isText = (s, max = 200) => typeof s === 'string' && s.trim() !== '' && s.length <= max

// 表記ゆれ(空白・中黒・大文字小文字)を無視して名前を比べるための正規化
const normName = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s・･.\-=＝]/g, '')

// ---- Wikipedia ----

const pageCache = new Map()

// 記事のwikitextを取得し、Gemmaに渡しやすいよう脚注・コメント・リンク記法を取り除く
async function fetchWikiPage(lang, title) {
  const key = `${lang}:${title}`
  if (pageCache.has(key)) return pageCache.get(key)
  let text = null
  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    )
    const data = await res.json()
    if (data.error) {
      console.log(`[wiki] ${key}: ${data.error.info || data.error.code}`)
    } else {
      text = cleanWikitext(data.parse?.wikitext || '')
      console.log(`[wiki] ${key}: ${text.length}文字`)
    }
  } catch (err) {
    console.error(`[wiki] ${key} の取得に失敗: ${err.message}`)
  }
  pageCache.set(key, text)
  return text
}

function cleanWikitext(wt) {
  return wt
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>/]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[(?:File|Image|ファイル|画像):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

async function wikiApi(lang, params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${qs}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    })
    return await res.json()
  } catch (err) {
    console.error(`[wiki] ${lang} API呼び出しに失敗: ${err.message}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// その年のボクシング記事のタイトル。記事名の付け方は言語版・年によって違うことがあるので
// (2026-10-03、「2026年のボクシング」「2026 in boxing」という記事は存在しなかった)、
// よくある候補名を確かめ、無ければWikipediaの検索で「年」と「ボクシング」を含む記事を探す。
const TITLE_CANDIDATES = {
  ja: (y) => [`${y}年のボクシング界`, `${y}年のボクシング`, `${y}年のプロボクシング`],
  en: (y) => [`${y} in boxing`, `List of ${y} boxing events`, `${y} in professional boxing`]
}
const TITLE_SEARCH = {
  ja: (y) => ({ q: `intitle:${y} intitle:ボクシング`, ok: (t) => t.includes(String(y)) && t.includes('ボクシング') }),
  en: (y) => ({ q: `intitle:${y} intitle:boxing`, ok: (t) => t.includes(String(y)) && /boxing/i.test(t) })
}
const yearPageCache = new Map()

async function resolveYearPage(lang, year) {
  const key = `${lang}:${year}`
  if (yearPageCache.has(key)) return yearPageCache.get(key)
  let title = null
  const exist = await wikiApi(lang, { action: 'query', redirects: '1', titles: TITLE_CANDIDATES[lang](year).join('|') })
  const pages = (exist?.query?.pages || []).filter((p) => !p.missing && !p.invalid)
  // 候補の並び順(上ほど優先)で選ぶ。リダイレクトされた場合は転送先のタイトルになっている
  const order = TITLE_CANDIDATES[lang](year)
  const redirects = Object.fromEntries((exist?.query?.redirects || []).map((r) => [r.to, r.from]))
  pages.sort((a, b) => order.indexOf(redirects[a.title] || a.title) - order.indexOf(redirects[b.title] || b.title))
  if (pages.length) title = pages[0].title
  if (!title) {
    const { q, ok } = TITLE_SEARCH[lang](year)
    const found = await wikiApi(lang, { action: 'query', list: 'search', srsearch: q, srnamespace: '0', srlimit: '10' })
    const hits = (found?.query?.search || []).map((h) => h.title)
    console.log(`[wiki] ${lang}:${year} の検索結果: ${JSON.stringify(hits)}`)
    title = hits.find(ok) || null
  }
  console.log(`[wiki] ${lang}:${year} の記事: ${title || '見つかりません'}`)
  yearPageCache.set(key, title)
  return title
}

// その年のボクシング記事(日本語版を優先し、無ければ英語版)
async function yearPages(year) {
  const out = []
  for (const lang of ['ja', 'en']) {
    const title = await resolveYearPage(lang, year)
    if (title) out.push({ lang, title })
  }
  return out
}

// 名前を探すためのキー(フルネームと、3文字以上の各部分)
function nameKeys(name) {
  const keys = new Set([normName(name)])
  for (const part of String(name).split(/[\s・･]+/)) {
    if (part.length >= 3 || /[一-龯]{2,}/.test(part)) keys.add(normName(part))
  }
  return [...keys].filter(Boolean)
}

const lineHasName = (line, keys) => {
  const n = normName(line)
  return keys.some((k) => n.includes(k))
}

// 2人の選手名が近く(前後15行以内)に出てくる場所の前後を抜き出す
function excerptAroundFight(text, fighters) {
  const lines = text.split('\n')
  const [ka, kb] = fighters.map(nameKeys)
  const windows = []
  for (let i = 0; i < lines.length; i++) {
    if (!lineHasName(lines[i], ka)) continue
    const lo = Math.max(0, i - 15)
    const hi = Math.min(lines.length, i + 16)
    if (!lines.slice(lo, hi).some((l) => lineHasName(l, kb))) continue
    windows.push([Math.max(0, i - 25), Math.min(lines.length, i + 26)])
  }
  if (windows.length === 0) return null
  // 重なる範囲をまとめる
  windows.sort((a, b) => a[0] - b[0])
  const merged = [windows[0]]
  for (const w of windows.slice(1)) {
    const last = merged[merged.length - 1]
    if (w[0] <= last[1]) last[1] = Math.max(last[1], w[1])
    else merged.push(w)
  }
  return merged
    .map(([a, b]) => lines.slice(a, b).join('\n'))
    .join('\n...\n')
    .slice(0, EXCERPT_MAX_CHARS)
}

// 指定期間の日付が書かれている行の前後を抜き出す(新しい試合を探す用)
function excerptsForPeriod(text, from, to) {
  const lines = text.split('\n')
  const months = []
  for (let d = from.slice(0, 7); d <= to.slice(0, 7); ) {
    months.push(d)
    const [y, m] = d.split('-').map(Number)
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const patterns = months.map((ym) => {
    const m = Number(ym.slice(5))
    return new RegExp(`(^|[^0-9])${m}月\\s*\\d{1,2}日|${EN_MONTHS[m - 1]}\\s+\\d{1,2}|\\d{1,2}\\s+${EN_MONTHS[m - 1]}|${ym}-\\d{2}`)
  })
  const keep = new Array(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (patterns.some((p) => p.test(l))) {
      for (let j = Math.max(0, i - 3); j < Math.min(lines.length, i + 20); j++) keep[j] = true
    }
  })
  // 残した行を EXCERPT_MAX_CHARS ごとのかたまりに分ける
  const chunks = []
  let cur = ''
  lines.forEach((l, i) => {
    if (!keep[i]) {
      if (cur && !cur.endsWith('\n...\n')) cur += '...\n'
      return
    }
    if ((cur + l).length > EXCERPT_MAX_CHARS) {
      chunks.push(cur)
      cur = ''
    }
    cur += l + '\n'
  })
  if (cur.trim()) chunks.push(cur)
  return chunks.slice(0, 2) // 1回の実行で読むのは2かたまりまで(Gemmaの枠の節約)
}

// ---- 検証 ----

const textHas = (text, s) => normName(text).includes(normName(s))

// 試合方法に含まれる数字(ラウンド・時間・採点)が、すべて元の文章に書かれているか
function numbersGrounded(method, text) {
  const nums = String(method).match(/\d+/g) || []
  const t = String(text)
  return nums.every((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(t))
}

// 団体名(WBA等)が元の文章に書かれているか
function orgsGrounded(s, text) {
  const orgs = String(s).match(/WBA|WBC|IBF|WBO|IBO/g) || []
  return orgs.every((o) => text.includes(o))
}

let lastGemmaCall = 0
async function askGemma(prompt, label) {
  const wait = lastGemmaCall + GEMMA_CALL_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastGemmaCall = Date.now()
  const text = await callGemini(prompt, { role: 'boxing', retries: 1, timeoutMs: 90000 })
  const data = parseGeminiJson(text)
  if (!data) console.warn(`[${label}] Gemmaの応答を読み取れませんでした`)
  return data
}

// ---- 1. 日付が過ぎた試合の結果を確認して results に移す ----

async function findFightExcerpt(fight) {
  const year = fight.date.slice(0, 4)
  for (const { lang, title } of await yearPages(year)) {
    const text = await fetchWikiPage(lang, title)
    if (!text) continue
    const ex = excerptAroundFight(text, fight.fighters)
    if (ex) return { excerpt: ex, source: `${lang}:${title}` }
  }
  return null
}

async function resolvePastFights(schedule, today) {
  let changed = false
  const methodExamples = [...new Set(schedule.results.map((r) => r.method))].slice(-6)

  for (const fight of [...schedule.fights]) {
    if (hasQuotaExhausted()) break
    if (!(fight.date < today)) continue
    if (daysBetween(fight.date, today) > RESULT_LOOKBACK_DAYS) {
      console.warn(`[result] ${fight.cardName} は${RESULT_LOOKBACK_DAYS}日以上結果が確認できていません。手動で確認してください`)
      continue
    }
    const found = await findFightExcerpt(fight)
    if (!found) {
      console.log(`[result] ${fight.cardName}: Wikipediaにまだ載っていません`)
      continue
    }
    const { excerpt, source } = found

    const r = await askGemma(
      `以下はWikipediaの記事(${source})の一部です。この文章に書かれている情報だけを使って、次の試合の結果を答えてください。文章に書かれていないことは推測しないでください。

試合: ${fight.date} ${fight.venue}
選手A: ${fight.fighters[0]}
選手B: ${fight.fighters[1]}

--- 記事の一部 ---
${excerpt}
--- ここまで ---

次の形式のJSONだけを出力してください(前置きや説明は不要):
{"status": "finished" | "not_yet" | "cancelled" | "unknown", "winner": "A" | "B" | "draw" | "no_contest" | null, "method": "試合方法"}

- この試合の結果が文章に書かれている時だけ "finished" にする。書かれていなければ "unknown"
- "method" は次の例と同じ書き方にする: ${JSON.stringify(methodExamples)}
  (KO/TKOならラウンドと時間、判定なら種類と採点。文章に書かれている数字だけを使う)`,
      'result'
    )
    if (!r) continue
    if (r.status !== 'finished') {
      console.log(`[result] ${fight.cardName}: 結果未確認 (status=${r.status})`)
      continue
    }
    if (r.winner !== 'A' && r.winner !== 'B') {
      console.warn(`[result] ${fight.cardName}: winner=${r.winner} のため自動反映しません。手動で確認してください`)
      continue
    }
    if (!isText(r.method, 80) || !numbersGrounded(r.method, excerpt)) {
      console.warn(`[result] ${fight.cardName}: 試合方法が元の文章と合わないため見送ります (${JSON.stringify(r.method)})`)
      continue
    }

    // 聞き方を変えてもう一度聞き、勝者が一致した時だけ反映する
    const check = await askGemma(
      `次の文章によると、${fight.fighters[0]} と ${fight.fighters[1]} の試合で勝ったのはどちらですか。文章に書かれていなければ "unknown" と答えてください。

${excerpt}

次の形式のJSONだけを出力してください: {"winner": "${fight.fighters[0]}" | "${fight.fighters[1]}" | "draw" | "no_contest" | "unknown"}`,
      'result-verify'
    )
    const winner = fight.fighters[r.winner === 'A' ? 0 : 1]
    if (!check || normName(check.winner) !== normName(winner)) {
      console.warn(`[result] ${fight.cardName}: 2回目の確認で勝者が一致しなかったため見送ります (1回目=${winner}, 2回目=${check?.winner})`)
      continue
    }

    schedule.results.push({
      date: fight.date,
      venue: fight.venue,
      cardName: fight.cardName,
      fighters: fight.fighters,
      winner,
      method: r.method.trim()
    })
    schedule.fights = schedule.fights.filter((f) => f !== fight)
    changed = true
    console.log(`[result] ${fight.cardName}: ${winner} ${r.method.trim()} (出典: ${source})`)
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

// 戻り値: null=記事を読めなかった(次回また試す), それ以外=追加した件数
async function addNewFights(schedule, today) {
  const from = addDays(today, 1)
  const horizon = addDays(today, NEW_FIGHT_HORIZON_DAYS)
  const examples = schedule.fights.slice(0, 3).map(({ date, venue, cardName, fighters }) => ({ date, venue, cardName, fighters }))

  // 期間が年をまたぐ時は翌年の記事も読む。日本語版があれば日本語版だけを使う(選手名の表記を揃えるため)
  const chunks = []
  for (const year of [...new Set([from.slice(0, 4), horizon.slice(0, 4)])]) {
    for (const { lang, title } of await yearPages(year)) {
      const text = await fetchWikiPage(lang, title)
      if (!text) continue
      for (const c of excerptsForPeriod(text, from, horizon)) chunks.push({ text: c, source: `${lang}:${title}` })
      break
    }
  }
  if (chunks.length === 0) return null

  let added = 0
  let readAny = false
  for (const { text, source } of chunks) {
    if (added >= MAX_NEW_FIGHTS_PER_RUN || hasQuotaExhausted()) break
    const list = await askGemma(
      `以下はWikipediaの記事(${source})の一部です。この文章に書かれている情報だけを使って、${from} から ${horizon} までに予定されているプロボクシングの試合のうち、次のどちらかに当てはまるものを挙げてください。
- 世界タイトルマッチ・王座統一戦(WBA / WBC / IBF / WBO)
- 日本人選手が出場する試合

--- 記事の一部 ---
${text}
--- ここまで ---

次の形式のJSON配列だけを出力してください(該当なしなら []、前置きや説明は不要):
[{"date": "YYYY-MM-DD", "venue": "会場(文章に書かれていなければ空文字)", "fighters": ["選手名", "選手名"], "title": "階級とタイトル(日本語、例: WBA世界フェザー級タイトルマッチ)", "broadcast": "放送・配信(文章に書かれていなければ空文字)"}]

- 選手名・会場は文章に書かれている表記のまま写す
- 文章に書かれていない試合は絶対に含めない
- 既に終わった試合(結果が書かれている試合)は含めない`,
      'new-fights'
    )
    if (!Array.isArray(list)) continue
    readAny = true

    for (const c of list) {
      if (added >= MAX_NEW_FIGHTS_PER_RUN) break
      const valid =
        c &&
        isDate(c.date) &&
        c.date >= from &&
        c.date <= horizon &&
        Array.isArray(c.fighters) &&
        c.fighters.length === 2 &&
        c.fighters.every((n) => isText(n, 60)) &&
        normName(c.fighters[0]) !== normName(c.fighters[1])
      if (!valid) {
        console.warn(`[new-fights] 形式が不正なため無視します: ${JSON.stringify(c)}`)
        continue
      }
      // 選手名・会場・団体名が元の文章に実際に書かれているかを確かめる
      if (!c.fighters.every((n) => textHas(text, n))) {
        console.warn(`[new-fights] 選手名が元の文章に無いため無視します: ${c.fighters.join(' vs ')}`)
        continue
      }
      const title = isText(c.title, 60) && orgsGrounded(c.title, text) ? c.title.trim() : ''
      const venue = isText(c.venue, 80) && textHas(text, c.venue) ? c.venue.trim() : '会場未定'
      const fight = {
        date: c.date,
        venue,
        cardName: `${c.fighters[0].trim()} vs ${c.fighters[1].trim()}${title ? `（${title}）` : ''}`,
        fighters: c.fighters.map((n) => n.trim())
      }
      if (isText(c.broadcast, 60) && textHas(text, c.broadcast)) fight.broadcast = c.broadcast.trim()
      if (isDuplicateFight(fight, [...schedule.fights, ...schedule.results])) {
        console.log(`[new-fights] 登録済みのため無視します: ${fight.cardName}`)
        continue
      }
      schedule.fights.push(fight)
      added++
      console.log(`[new-fights] 追加: ${fight.date} ${fight.cardName} @ ${fight.venue} (出典: ${source})`)
    }
  }

  schedule.fights.sort((a, b) => a.date.localeCompare(b.date))
  return readAny ? added : null
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
  if (DRY_RUN) console.log('*** ドライラン: 反映する内容を表示するだけで、ファイルは書き換えません ***')
  const today = todayJST()
  const original = readFileSync(SCHEDULE_URL, 'utf8')
  const schedule = JSON.parse(original)
  const state = { ...(schedule.autoUpdate || {}) }

  let changed = await resolvePastFights(schedule, today)

  if ((DRY_RUN || isDue(state.lastFightSearchAt, today)) && !hasQuotaExhausted()) {
    const added = await addNewFights(schedule, today)
    if (added !== null) {
      state.lastFightSearchAt = today
      if (added > 0) changed = true
    }
  }

  if (hasQuotaExhausted()) console.warn('Gemmaの無料枠を使い切ったため、残りは次回の実行で確認します')
  console.log(`完了: 試合データ${changed ? '更新あり' : '変更なし'}`)
  if (DRY_RUN) return

  if (changed) schedule.updatedAt = today
  // 検索の記録(autoUpdate)は、実際に記事を読めた時だけ変わる。何も変わらなかった回に
  // 記録だけを書き込んでコミット・再デプロイしないよう、変化がある時だけ書き出す。
  if (JSON.stringify(state) !== JSON.stringify(schedule.autoUpdate || {})) schedule.autoUpdate = state
  const json = toJson(schedule)
  if (json !== original) writeFileSync(SCHEDULE_URL, json)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
