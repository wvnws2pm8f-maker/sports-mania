// ボクシングの試合結果を、選手本人のWikipedia記事の戦績表から自動で取り込んで
// src/data/boxingSchedule.json を更新する(fights → results への移動)。
//
// 【経緯】ボクシングには安定した無料APIが無い。以前はClaudeのRoutineが週1回Web検索して
// 更新していたが、無料で回せるよう GitHub Actions + Gemini のWeb検索に移行しようとした
// (2026-10-02)。ところがGeminiのWeb検索(グラウンディング)は無料枠では使えなかった
// (2026-10-03、検索付きの呼び出しだけが理由なしの429で断られた)。
// 次に「その年のボクシング」のWikipedia記事を読む方式を試したが、日本語版・英語版とも
// そういう記事は存在しなかった(2026-10-03)。一方、有名選手の記事には戦績表があり、
// 試合後すぐに更新されることが多い。そこで、試合する2人の選手の記事(公開APIで無料・
// キー不要)を取得し、その戦績表の中からだけGemma(無料枠)に結果を抜き出させる方式にした。
//
// 間違った情報を載せないことを最優先にしている:
// - Gemmaには記憶ではなく、渡したWikipediaの文章からだけ答えさせる
// - 対戦相手の名前と試合の日付が、抜き出した戦績表の部分に実際に書かれている時だけ読む
// - 試合方法はGemmaに部品(種類・ラウンド・時間・採点)だけ答えさせて表記はプログラムで組み立て、
//   各部品が元の文章に書かれているかを確かめる。確かめられなければ捨てる
// - 勝敗は、もう1人の選手の記事でも確かめ(無ければ聞き方を変えて同じ記事で)、
//   同じ答えの時だけ反映する
// - 引き分け・無効試合・中止は自動では反映しない(画面が「◯◯が勝利」表示のため)
// 確認できなかったものはそのまま残し、翌日以降の実行で再度調べる。
//
// 今後の試合の追加と、選手の近況(boxerProfiles.jsonのrecentUpdate)は、無料で確実に
// 取れる情報源が無いため自動更新の対象外(手動で追加・更新する)。
//
// 実行頻度: 毎日。BOXING_DRY_RUN=1 の時は、反映する内容をログに出すだけで書き換えない。
import { readFileSync, writeFileSync } from 'node:fs'
import { callGemini, parseGeminiJson, hasGeminiKey, hasQuotaExhausted } from './gemini.mjs'

const SCHEDULE_URL = new URL('../src/data/boxingSchedule.json', import.meta.url)

const RESULT_LOOKBACK_DAYS = 30 // これより前の未確定の試合は、中止などとみなして毎日調べ直すのをやめる
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 表記ゆれ(空白・中黒・大文字小文字・全角半角)を無視して名前を比べるための正規化
const normName = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s・･.\-=＝]/g, '')

const hasJapanese = (s) => /[぀-ヿ一-龯]/.test(s)

// ---- Wikipedia ----

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

const pageCache = new Map()

// 記事のwikitextを取得し、Gemmaに渡しやすいよう脚注・コメント・リンク記法を取り除く
async function fetchWikiPage(lang, title) {
  const key = `${lang}:${title}`
  if (pageCache.has(key)) return pageCache.get(key)
  const data = await wikiApi(lang, { action: 'parse', prop: 'wikitext', redirects: '1', page: title })
  let text = null
  if (data?.error) console.log(`[wiki] ${key}: ${data.error.info || data.error.code}`)
  else if (data?.parse) text = cleanWikitext(data.parse.wikitext || '')
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

// 選手本人の記事。日本語表記の選手は日本語版、それ以外は英語版を探す。
// 同名の別人がいることがあるので「(boxer)」「(ボクサー)」付きも候補にし、曖昧さ回避ページは除く。
const fighterPageCache = new Map()
async function resolveFighterPage(name) {
  if (fighterPageCache.has(name)) return fighterPageCache.get(name)
  const tries = hasJapanese(name)
    ? [{ lang: 'ja', titles: [name, `${name} (ボクサー)`, `${name} (プロボクサー)`] }]
    : [{ lang: 'en', titles: [name, `${name} (boxer)`] }]
  let found = null
  for (const { lang, titles } of tries) {
    const data = await wikiApi(lang, { action: 'query', redirects: '1', prop: 'pageprops', titles: titles.join('|') })
    const pages = (data?.query?.pages || []).filter((p) => !p.missing && !p.invalid && !p.pageprops?.disambiguation)
    // 「(boxer)」付きの記事があればそちらを優先する(本人の記事である可能性が高いため)
    pages.sort((a, b) => /\((boxer|ボクサー|プロボクサー)\)/.test(b.title) - /\((boxer|ボクサー|プロボクサー)\)/.test(a.title))
    if (pages.length) {
      found = { lang, title: pages[0].title }
      break
    }
  }
  console.log(`[wiki] ${name} の記事: ${found ? `${found.lang}:${found.title}` : '見つかりません'}`)
  fighterPageCache.set(name, found)
  return found
}

// 名前を探すためのキー(フルネームと、3文字以上の各部分。漢字の名前は2文字以上の各部分)
function nameKeys(name) {
  const keys = new Set([normName(name)])
  for (const part of String(name).split(/[\s・･]+/)) {
    if (part.length >= 3 || /^[一-龯]{2,}$/.test(part)) keys.add(normName(part))
  }
  return [...keys].filter(Boolean)
}

const lineHasName = (line, keys) => {
  const n = normName(line)
  return keys.some((k) => n.includes(k))
}

// 記事の中で対戦相手の名前が出てくる場所の前後を抜き出す(戦績表の1行は複数行にまたがるため広めに)
function excerptAroundOpponent(text, opponent) {
  const lines = text.split('\n')
  const keys = nameKeys(opponent)
  const windows = []
  lines.forEach((l, i) => {
    if (lineHasName(l, keys)) windows.push([Math.max(0, i - 12), Math.min(lines.length, i + 13)])
  })
  if (windows.length === 0) return null
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

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// 試合の日付(時差で前後1日ずれることがある)が、文章のどこかに書かれているか
function dateGrounded(text, date) {
  return [-1, 0, 1].some((off) => {
    const d = addDays(date, off)
    const [y, m, day] = d.split('-').map(Number)
    const mon = EN_MONTHS[m - 1]
    const patterns = [
      `${y}年${m}月${day}日`,
      `${y}年 ${m}月 ${day}日`,
      d,
      `${day} ${mon} ${y}`,
      `${mon} ${day}, ${y}`,
      `${day} ${mon.slice(0, 3)} ${y}`,
      `${mon.slice(0, 3)} ${day}, ${y}`,
      `${y}|${m}|${day}`,
      `${y}|${String(m).padStart(2, '0')}|${String(day).padStart(2, '0')}`
    ]
    return patterns.some((p) => text.includes(p))
  })
}

// ---- 検証 ----

// ---- 試合方法の組み立てと検証 ----
// Gemmaには試合方法を文章で書かせず、種類・ラウンド・時間・採点の部品だけを答えさせて、
// 表記はここで既存データと同じ形に組み立てる(2026-10-03の本番テストで、Gemmaに書かせると
// 英語のまま("Majority decision (98–92…)")や、負けた側から見た表記("判定0-3")になったため)。
// 部品はそれぞれ元の文章に書かれているかを確かめる。

const DASHES = /[-–—−‐－ー]/g
const sameDash = (s) => String(s).replace(DASHES, '-')

// "1:05" → "1分5秒"、"0:38" → "38秒"
function formatTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim())
  if (!m) return null
  const min = Number(m[1])
  const sec = Number(m[2])
  return `${min ? `${min}分` : ''}${sec ? `${sec}秒` : ''}` || null
}

// 時間が文章に書かれているか("1:05" / "1分5秒" / "1分05秒" / 1分未満なら "38秒")
function timeGrounded(t, text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim())
  if (!m) return false
  const min = Number(m[1])
  const sec = Number(m[2])
  const variants = [`${min}:${m[2]}`]
  if (min > 0) variants.push(`${min}分${sec}秒`, `${min}分${m[2]}秒`)
  else variants.push(`${sec}秒`)
  return variants.some((v) => text.includes(v))
}

const roundGrounded = (n, text) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text)

const DECISIONS = { UD: 'Unanimous Decision', MD: 'Majority Decision', SD: 'Split Decision' }
const DECISION_WORDS = {
  UD: [/\bUD\b/, /unanimous/i, /判定/],
  MD: [/\bMD\b/, /majority/i, /判定/],
  SD: [/\bSD\b/, /split/i, /判定/]
}

// 戻り値: 既存データと同じ表記の試合方法。部品が元の文章で確かめられない時は null
function buildMethod(r, text) {
  const t = sameDash(text)
  const type = String(r.decision || '').toUpperCase()
  const round = Number(r.round)
  if (type === 'KO' || type === 'TKO') {
    if (!Number.isInteger(round) || round < 1 || round > 15 || !roundGrounded(round, t)) return null
    if (!new RegExp(type === 'KO' ? '\\bKO\\b|ノックアウト|KO勝' : 'TKO|テクニカルノックアウト').test(text)) return null
    let time = ''
    if (r.time) {
      if (!timeGrounded(r.time, t)) return null
      time = formatTime(r.time) || ''
    }
    return `${type}(${round}回${time})`
  }
  if (DECISIONS[type]) {
    if (!DECISION_WORDS[type].some((re) => re.test(text))) return null
    const rounds = Number(r.scheduled_rounds || r.round)
    if (!Number.isInteger(rounds) || rounds < 4 || rounds > 15 || !roundGrounded(rounds, t)) return null
    const scores = (Array.isArray(r.scores) ? r.scores : []).map(sameDash).filter((x) => /^\d{2,3}-\d{2,3}$/.test(x))
    // 採点は「114-113」の形で文章に書かれているものだけ使う(書かれていないものが1つでもあれば採点は付けない)
    const useScores = scores.length > 0 && scores.every((x) => t.includes(x))
    return useScores
      ? `判定(${DECISIONS[type]} ${scores.join(', ')}, ${rounds}回)`
      : `判定(${DECISIONS[type]}, ${rounds}回)`
  }
  return null // RTD・失格・負傷判定などは表記が揺れるので自動では扱わない
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

// ---- 日付が過ぎた試合の結果を確認して results に移す ----

// 選手(subject)本人の記事から、相手(opponent)との試合の部分を抜き出す。
// 相手の名前と試合の日付の両方が書かれている時だけ返す。
async function excerptFromFighterArticle(subject, opponent, date) {
  const page = await resolveFighterPage(subject)
  if (!page) return null
  const text = await fetchWikiPage(page.lang, page.title)
  if (!text) return null
  const excerpt = excerptAroundOpponent(text, opponent)
  if (!excerpt) {
    console.log(`[wiki] ${page.lang}:${page.title} に ${opponent} の記載がありません`)
    return null
  }
  if (!dateGrounded(excerpt, date)) {
    console.log(`[wiki] ${page.lang}:${page.title} の ${opponent} 戦の部分に ${date} の日付がありません(まだ更新されていない可能性)`)
    return null
  }
  return { excerpt, subject, source: `${page.lang}:${page.title}` }
}

// 記事の主(subject)から見た勝敗を聞き、試合全体の勝者(fighters の添字)に直して返す
async function askWinner(fight, ex) {
  const opponent = fight.fighters.find((n) => n !== ex.subject)
  const r = await askGemma(
    `以下はWikipediaの「${ex.subject}」の記事(${ex.source})の一部です。戦績表の勝敗は ${ex.subject} から見たものです。
この文章に書かれている情報だけを使って、${fight.date}(前後1日のずれは同じ試合とみなす)に行われた ${ex.subject} 対 ${opponent} の試合の結果を答えてください。文章に書かれていないことは推測しないでください。

--- 記事の一部 ---
${ex.excerpt}
--- ここまで ---

次の形式のJSONだけを出力してください(前置きや説明は不要):
{"status": "finished" | "not_found", "subject_result": "win" | "loss" | "draw" | "no_contest" | null, "decision": "KO" | "TKO" | "UD" | "MD" | "SD" | "other", "round": 決着したラウンド(数字), "scheduled_rounds": 予定ラウンド数(数字、不明ならnull), "time": "決着した時間 m:ss(KO/TKOで書かれている時だけ。なければnull)", "scores": ["採点(例: 114-113)", ...]}

- この試合の結果が文章に書かれている時だけ "finished" にする。書かれていなければ "not_found"
- "subject_result" は ${ex.subject} が勝ったなら "win"、負けたなら "loss"
- "decision": 判定の場合、3-0・全員一致は "UD"、2-0(1人が引き分け)は "MD"、2-1は "SD"。RTD・失格・負傷判定などは "other"
- "scores" は文章に書かれている採点だけを、勝った選手の点数を先にして並べる("116-111×2" のような書き方は2つに分ける)。書かれていなければ []`,
    'result'
  )
  if (!r || r.status !== 'finished') return { status: r?.status || 'error' }
  if (r.subject_result !== 'win' && r.subject_result !== 'loss') return { status: 'not_win_loss', detail: r.subject_result }
  const subjectIdx = fight.fighters.indexOf(ex.subject)
  const winnerIdx = r.subject_result === 'win' ? subjectIdx : 1 - subjectIdx
  return { status: 'finished', winnerIdx, method: buildMethod(r, ex.excerpt), raw: r }
}

async function resolvePastFights(schedule, today) {
  let changed = false
  for (const fight of [...schedule.fights]) {
    if (hasQuotaExhausted()) break
    if (!(fight.date < today)) continue
    if (daysBetween(fight.date, today) > RESULT_LOOKBACK_DAYS) {
      console.warn(`[result] ${fight.cardName} は${RESULT_LOOKBACK_DAYS}日以上結果が確認できていません。手動で確認してください`)
      continue
    }

    // 2人それぞれの記事から、この試合の部分を探す
    const excerpts = []
    for (const [i, subject] of fight.fighters.entries()) {
      const ex = await excerptFromFighterArticle(subject, fight.fighters[1 - i], fight.date)
      if (ex) excerpts.push(ex)
    }
    if (excerpts.length === 0) {
      console.log(`[result] ${fight.cardName}: Wikipediaの戦績にまだ載っていません`)
      continue
    }

    const first = await askWinner(fight, excerpts[0])
    if (first.status === 'not_win_loss') {
      console.warn(`[result] ${fight.cardName}: 結果が ${first.detail} のため自動反映しません。手動で確認してください`)
      continue
    }
    if (first.status !== 'finished') {
      console.log(`[result] ${fight.cardName}: 結果未確認 (${first.status})`)
      continue
    }
    if (!first.method) {
      console.warn(`[result] ${fight.cardName}: 試合方法を元の文章で確かめられないため見送ります (${JSON.stringify(first.raw)})`)
      continue
    }

    // もう1人の記事があればそちらで、無ければ同じ記事でもう一度聞き、勝者が一致した時だけ反映する
    const second = await askWinner(fight, excerpts[1] || excerpts[0])
    if (second.status !== 'finished' || second.winnerIdx !== first.winnerIdx) {
      console.warn(`[result] ${fight.cardName}: 2回目の確認で勝者が一致しなかったため見送ります (1回目=${fight.fighters[first.winnerIdx]}, 2回目=${second.status === 'finished' ? fight.fighters[second.winnerIdx] : second.status})`)
      continue
    }

    const winner = fight.fighters[first.winnerIdx]
    schedule.results.push({
      date: fight.date,
      venue: fight.venue,
      cardName: fight.cardName,
      fighters: fight.fighters,
      winner,
      method: first.method.trim()
    })
    schedule.fights = schedule.fights.filter((f) => f !== fight)
    changed = true
    console.log(`[result] ${fight.cardName}: ${winner} ${first.method.trim()} (出典: ${excerpts.map((e) => e.source).join(', ')})`)
  }

  schedule.results.sort((a, b) => a.date.localeCompare(b.date))
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

// ドライラン時の動作確認: 直近の結果が分かっている試合を「結果未確認」として調べ直し、
// Wikipediaから読み取った結果が、登録済みの結果と一致するかを表示する(書き換えはしない)。
async function selfTest(schedule, today) {
  const known = schedule.results.filter((r) => daysBetween(r.date, today) <= RESULT_LOOKBACK_DAYS)
  if (known.length === 0) return
  console.log(`--- 動作確認: 登録済みの結果${known.length}件を調べ直して照合します ---`)
  const test = {
    results: schedule.results.filter((r) => !known.includes(r)),
    fights: known.map(({ date, venue, cardName, fighters }) => ({ date, venue, cardName, fighters }))
  }
  await resolvePastFights(test, today)
  let ok = 0
  for (const k of known) {
    const got = test.results.find((r) => r.date === k.date && r.cardName === k.cardName)
    if (!got) console.log(`[照合] ${k.cardName}: 読み取れず(登録済み: ${k.winner} ${k.method})`)
    else if (got.winner === k.winner) {
      ok++
      console.log(`[照合] ${k.cardName}: 勝者一致 ✓ 読み取り=${got.method} / 登録済み=${k.method}`)
    } else console.log(`[照合] ${k.cardName}: 勝者が違う ✗ 読み取り=${got.winner} / 登録済み=${k.winner}`)
  }
  console.log(`--- 動作確認ここまで: ${known.length}件中 ${ok}件一致 ---`)
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

  if (DRY_RUN) await selfTest(schedule, today)

  const changed = await resolvePastFights(schedule, today)

  if (hasQuotaExhausted()) console.warn('Gemmaの無料枠を使い切ったため、残りは次回の実行で確認します')
  console.log(`完了: 試合データ${changed ? '更新あり' : '変更なし'}`)
  if (DRY_RUN || !changed) return

  schedule.updatedAt = today
  delete schedule.autoUpdate // 以前の「新しい試合の検索」の記録(今は使っていない)
  writeFileSync(SCHEDULE_URL, toJson(schedule))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
