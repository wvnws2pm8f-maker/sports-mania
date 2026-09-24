// ホーム画面の「注目ニュース」用データ取得スクリプト。
// ESPNは順位表・試合結果だけでなく、実際の編集記事(見出し・要約・写真)も公開している。
// これを使うことで「結果の寄せ集め」ではなく「今スポーツ界で何が起きているか」を伝えられる。
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { callGemini, parseGeminiJson, hasGeminiKey, hasQuotaExhausted } from './gemini.mjs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const NEWS_JSON_PATH = new URL('../public/data/news.json', import.meta.url)

// ニュースは(順位表と違って)リーグ横断のエンドポイントが無いので、
// リーグごとに取得して sportPath 単位でまとめる(サッカーは複数リーグを統合・重複除去)。
const SOCCER_LEAGUES = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions']

// MLB(baseball)のニュースはホーム画面に出さない(2026-09-24、「プレーオフは自分で追うので
// MLBの記事欄は不要、その分他スポーツの見出し翻訳に無駄打ちなく集中したい」との要望)。
// 対象から外すと、Geminiに翻訳依頼する記事の母数自体が減り、新着発生の頻度(=Geminiを
// 呼ぶ頻度)も下がる。need欄に戻したくなったら 'baseball' を配列に足すだけでよい。
const EXCLUDED_SPORTS = ['baseball']

// 【重要】fetchにタイムアウトを設定していなかったため、1件でも通信が詰まると
// Node標準のfetchはデフォルトでは(事実上)無期限に待ち続けてしまい、ワークフロー側の
// timeout-minutes: 8いっぱいまで固まって強制終了→本文の翻訳結果が一切保存されない、
// という不具合につながっていた(2026-09-20、「全文翻訳が一向に表示されない」との指摘で発覚。
// 本文取得件数が何時間経っても6〜7件から増えず、翻訳も常に0件のままだったのが症状)。
// AbortControllerで1リクエストあたりの上限を設け、詰まった1件のせいで実行全体が
// 巻き添えにならないようにする。
async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' }, signal: controller.signal })
    if (!res.ok) {
      throw new Error(`fetch failed ${res.status} ${url}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function normalizeArticle(sport, a) {
  return {
    id: a.id,
    sport,
    headline: a.headline || '',
    description: a.description || '',
    image: a.images?.[0]?.url || '',
    published: a.published || a.lastModified || '',
    link: a.links?.web?.href || ''
  }
}

async function fetchNewsFor(sportPath, leaguePath) {
  const data = await fetchJson(`${BASE}/${sportPath}/${leaguePath}/news`)
  return (data.articles || []).map((a) => normalizeArticle(sportPath, a))
}

// 「見出し・要約しか翻訳されず全文が読めない」との指摘(2026-09-18)を受けて調査したところ、
// ニュース一覧のnewsエンドポイント自体には見出し・要約しか無く(記事本文はそもそも
// 含まれていない)、全文本体は別の now.core.api.espn.com/v1/sports/news/{id} という
// 記事単体用のエンドポイントに story というHTML入りのフィールドとして存在すると
// 実際に取得して確認できた。あまりに長い記事は翻訳コスト・失敗リスクが上がるため、
// 一定文字数で切り詰める(「続きはリンク先で」という位置づけ)。
const BODY_MAX_CHARS = 3000

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchArticleBody(id) {
  try {
    const data = await fetchJson(`https://now.core.api.espn.com/v1/sports/news/${id}`)
    const story = data?.headlines?.[0]?.story
    if (!story) return ''
    return stripHtml(story).slice(0, BODY_MAX_CHARS)
  } catch (err) {
    console.error(`FAILED: article body ${id}: ${err.message}`)
    return ''
  }
}

// 英語の見出し・要約を日本語に翻訳する。GEMINI_API_KEYが無ければ何もしない
// (=翻訳無しの英語表示のまま、アプリ側は既にそれに対応済み)。
// 同じ記事を15分おきに毎回翻訳し直すのは無駄なので、前回の結果(news.json)に
// 同じidかつ同じ見出しの翻訳があればそれを使い回す。
function loadPreviousTranslations() {
  if (!existsSync(NEWS_JSON_PATH)) return new Map()
  try {
    const prev = JSON.parse(readFileSync(NEWS_JSON_PATH, 'utf8'))
    const map = new Map()
    for (const a of prev.articles || []) {
      if (a.headlineJa) map.set(a.id, { headline: a.headline, headlineJa: a.headlineJa, descriptionJa: a.descriptionJa })
    }
    return map
  } catch {
    return new Map()
  }
}

// クォータ超過を検知した時の「無駄打ち防止バックオフ」の状態をnews.jsonに永続化する
// (2026-09-24、「クォータが回復するまでは翻訳を試みず、回復したら見出し翻訳を再開したい」
// との要望で追加)。実行のたびに毎回Geminiを叩いて429を量産するのではなく、クォータ超過を
// 検知したら次のBACKOFF_INITIAL_MINUTES分は翻訳自体を試みず、時間が来たら1回だけ
// 様子見の試行をする。それでも失敗すれば待ち時間を倍にして(最大BACKOFF_MAX_MINUTES分)
// 繰り返し、成功(またはクォータ超過に遭遇しなかった)回でリセットする。
const BACKOFF_INITIAL_MINUTES = 60
const BACKOFF_MAX_MINUTES = 240

function loadGeminiBackoff() {
  if (!existsSync(NEWS_JSON_PATH)) return null
  try {
    const prev = JSON.parse(readFileSync(NEWS_JSON_PATH, 'utf8'))
    return prev.geminiBackoff || null // { minutes, untilISO }
  } catch {
    return null
  }
}

// 本文のキャッシュ(id+見出しが同じなら前回取得済みのbodyを使い回し、APIを叩き直さない)。
// 本文の日本語訳はもう作らない(2026-09-23、Geminiの無料枠クォータが慢性的に枯渇しており
// リトライしても解決しないと判明したため)。本文は常に原文(英語)のまま表示し、読みたい人には
// 端末側の翻訳機能(Safari/iPhoneの「翻訳」機能等、Geminiのクォータと無関係)を案内する
// (src/components/HomeView.jsx参照)。見出し・要約だけは記事一覧を開いた瞬間に全員が
// 目にするため引き続きここで事前翻訳する。
function loadPreviousBodies() {
  if (!existsSync(NEWS_JSON_PATH)) return new Map()
  try {
    const prev = JSON.parse(readFileSync(NEWS_JSON_PATH, 'utf8'))
    const map = new Map()
    for (const a of prev.articles || []) {
      if (a.body) map.set(a.id, { headline: a.headline, body: a.body })
    }
    return map
  } catch {
    return new Map()
  }
}

// 以前は記事ごとに1回ずつGeminiを呼んでいたが、1回の実行で新規記事が多いと
// (特にサッカーは6リーグ分あるため上位リストの入れ替わりが激しい)、
// 1分あたりのレート制限に引っかかったり、1回の実行あたりの新規翻訳数に上限(8件)を
// 設けても入れ替わり速度に追いつけず、いつまでも未翻訳の記事が残り続ける問題があった
// (2026-09-11に発覚)。そこで未翻訳分をまとめて1回のGemini呼び出しで一括翻訳する方式に変更。
// API呼び出し回数が最大24記事でも1回で済むため、レート制限の影響をほぼ受けない。
async function translateArticlesBatch(items) {
  if (items.length === 0) return new Map()
  const input = items.map((a) => ({ id: String(a.id), headline: a.headline, description: a.description }))
  const prompt = `以下は英語のスポーツニュース記事の配列です。それぞれの見出し(headline)と要約(description)を自然な日本語に翻訳してください。
出力は入力と同じ件数・同じ順序のJSON配列のみとし、他の説明・前置き・コードブロック記号は一切付けないでください。
各要素は次の形式にしてください(idは入力のidをそのまま文字列でコピーすること): {"id": "入力と同じid", "headline": "翻訳した見出し", "description": "翻訳した要約"}

入力:
${JSON.stringify(input)}`
  const text = await callGemini(prompt, { asJson: true })
  const parsed = parseGeminiJson(text)
  const map = new Map()
  if (Array.isArray(parsed)) {
    parsed.forEach((item, i) => {
      // idが文字列として正しく返らないケースに備え、返ってこなければ入力順で対応付ける
      const id = item?.id != null ? String(item.id) : items[i] ? String(items[i].id) : null
      if (id && item?.headline) map.set(id, item)
    })
  }
  return map
}

// allowNewCalls: false の時は、既に翻訳済み(キャッシュ)の記事の引き継ぎだけ行い、
// 新規記事のGemini呼び出しは行わない(クォータ超過によるバックオフ中に使う。下のmain()参照)。
async function translateArticles(articles, allowNewCalls) {
  if (!hasGeminiKey()) return articles
  const cache = loadPreviousTranslations()
  const toTranslate = []
  const byId = new Map()
  for (const a of articles) {
    const cached = cache.get(a.id)
    if (cached && cached.headline === a.headline) {
      byId.set(a.id, { ...a, headlineJa: cached.headlineJa, descriptionJa: cached.descriptionJa })
    } else if (allowNewCalls) {
      toTranslate.push(a)
    }
  }
  if (toTranslate.length > 0) {
    const translatedMap = await translateArticlesBatch(toTranslate)
    for (const a of toTranslate) {
      const t = translatedMap.get(String(a.id))
      if (t?.headline) {
        byId.set(a.id, { ...a, headlineJa: t.headline, descriptionJa: t.description || '' })
      } else {
        byId.set(a.id, a) // 翻訳失敗時は原文のまま(次回実行時に再度リトライされる)
      }
    }
  }
  return articles.map((a) => byId.get(a.id) || a)
}

// 簡易な並列実行プール(ESPNへの同時アクセスを抑える。fetch-team-details.mjs等と同じ考え方)
async function runPool(items, limit, worker) {
  const results = new Array(items.length)
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
  return results
}

const BODY_FETCH_CONCURRENCY = 4
// 本文取得+翻訳は見出しよりずっと重い処理(記事単位の追加API呼び出し+長文のGemini翻訳)。
// 新着記事をまとめて一度に処理しようとすると1回の実行時間が延び、次の15分おきのcronに
// 追い越されてジョブごとキャンセルされる(concurrency: cancel-in-progress: true)ことがあり、
// その場合は同じ実行内で先に済んでいた見出し翻訳の書き出しすら失われてしまっていた
// (2026-09-18発覚: 見出し翻訳が0/26に戻ってしまうという報告で発覚)。
// 1回の実行で処理する新規記事数に上限を設け、残りは次回以降の実行に持ち越すことで
// 1回あたりの実行時間を抑える(下のmain()側で見出し翻訳を先に保存する対策と合わせて二重の対策)。
const MAX_NEW_BODIES_PER_RUN = 10

// 全文本体(英語)の取得。見出し・要約とは別のAPI呼び出しが必要なため、独立した関数にしている。
// 既に本文を取得済み(id+見出しが同じ)ならAPIを叩き直さず前回の結果を使い回す。
// 翻訳はここでは行わない(クリック時にブラウザ側でその場で翻訳する。上のコメント参照)。
async function attachBodies(articles) {
  const cache = loadPreviousBodies()
  const needsFetch = []
  const byId = new Map()
  for (const a of articles) {
    const cached = cache.get(a.id)
    if (cached && cached.headline === a.headline) {
      byId.set(a.id, { body: cached.body })
    } else {
      needsFetch.push(a)
    }
  }
  if (needsFetch.length > MAX_NEW_BODIES_PER_RUN) {
    console.log(`本文取得は今回${MAX_NEW_BODIES_PER_RUN}件までにし、残り${needsFetch.length - MAX_NEW_BODIES_PER_RUN}件は次回に持ち越します`)
    needsFetch.length = MAX_NEW_BODIES_PER_RUN
  }

  if (needsFetch.length > 0) {
    const bodies = await runPool(needsFetch, BODY_FETCH_CONCURRENCY, async (a) => ({
      id: a.id,
      body: await fetchArticleBody(a.id)
    }))
    for (const b of bodies) {
      byId.set(b.id, { body: b.body })
    }
  }

  return articles.map((a) => {
    const b = byId.get(a.id)
    return b ? { ...a, body: b.body } : a
  })
}

async function main() {
  const bySport = { soccer: new Map(), basketball: new Map(), football: new Map() }

  for (const leaguePath of SOCCER_LEAGUES) {
    try {
      const articles = await fetchNewsFor('soccer', leaguePath)
      for (const a of articles) bySport.soccer.set(a.id, a)
      console.log(`ok: soccer/${leaguePath} (${articles.length} articles)`)
    } catch (err) {
      console.error(`FAILED: soccer/${leaguePath}: ${err.message}`)
    }
  }

  for (const [sportPath, leaguePath] of [
    ['basketball', 'nba'],
    ['football', 'nfl']
  ]) {
    if (EXCLUDED_SPORTS.includes(sportPath)) continue
    try {
      const articles = await fetchNewsFor(sportPath, leaguePath)
      for (const a of articles) bySport[sportPath].set(a.id, a)
      console.log(`ok: ${sportPath}/${leaguePath} (${articles.length} articles)`)
    } catch (err) {
      console.error(`FAILED: ${sportPath}/${leaguePath}: ${err.message}`)
    }
  }

  // 各スポーツの記事を新しい順に整列し、上位だけ残す(容量を抑える)
  const PER_SPORT_LIMIT = 8
  const all = []
  for (const [sportPath, map] of Object.entries(bySport)) {
    const sorted = [...map.values()]
      .filter((a) => a.headline && a.image) // 画像・見出しが無い記事は読み物として弱いので除外
      .sort((a, b) => new Date(b.published) - new Date(a.published))
      .slice(0, PER_SPORT_LIMIT)
    all.push(...sorted)
  }
  // スポーツ単位で上位N件を選んだ後、全体を新しい順に混ぜ直す(ホーム画面は1つのフィードとして表示するため)
  all.sort((a, b) => new Date(b.published) - new Date(a.published))

  if (all.length === 0) {
    throw new Error('ニュース記事が1件も取得できませんでした')
  }

  // 見出し・要約は記事一覧を開いた瞬間に全員の目に入るので、クォータ超過によるバックオフ中
  // でなければ毎回(15分おき)翻訳を試みる。1回のGemini呼び出しで未翻訳分をまとめて処理する
  // ため(translateArticlesBatch参照)、新着が無い実行ではGeminiを呼ぶことさえない。
  const backoff = loadGeminiBackoff()
  const now = Date.now()
  const inBackoff = hasGeminiKey() && Boolean(backoff) && now < new Date(backoff.untilISO).getTime()
  if (inBackoff) {
    const waitMin = Math.ceil((new Date(backoff.untilISO).getTime() - now) / 60000)
    console.log(`翻訳: クォータ超過中のため試行をスキップ(次の様子見まであと約${waitMin}分)`)
  }

  const translatedHeadlines = await translateArticles(all, !inBackoff)

  let geminiBackoff = backoff
  if (hasGeminiKey() && !inBackoff) {
    if (hasQuotaExhausted()) {
      const minutes = Math.min((backoff?.minutes || BACKOFF_INITIAL_MINUTES / 2) * 2, BACKOFF_MAX_MINUTES)
      geminiBackoff = { minutes, untilISO: new Date(now + minutes * 60000).toISOString() }
      console.log(`翻訳: クォータ超過を検知。次は約${minutes}分後まで試行をスキップします`)
    } else {
      geminiBackoff = null // 成功、またはクォータ超過に遭遇しなかった(=新着自体が無かった)のでリセット
    }
  }

  if (hasGeminiKey()) {
    const newlyTranslated = translatedHeadlines.filter((a) => a.headlineJa).length
    console.log(`translation: ${newlyTranslated}/${translatedHeadlines.length} articles have 日本語`)
  } else {
    console.log('GEMINI_API_KEY未設定のため翻訳はスキップ(英語のまま表示されます)')
  }

  // 【重要】本文取得(この後)を始める前に、ここで一度書き出しておく。
  // 本文取得は時間がかかり、次の15分おきのcronに追い越されてジョブごと
  // キャンセルされることがある(concurrency: cancel-in-progress: true)。
  // 最後に1回だけ書き出す方式だと、そうなった場合に見出し翻訳の分まで
  // 消えてしまっていた(2026-09-18、見出し翻訳が0/26に戻る不具合として発覚)。
  writeFileSync(
    NEWS_JSON_PATH,
    JSON.stringify({ articles: translatedHeadlines, updatedAt: new Date().toISOString(), geminiBackoff })
  )
  console.log('interim save done (headlines committed before starting body fetch)')

  // 全文本体(英語)の取得。本文取得はニュース一覧APIとは別のAPIコールが必要なため、
  // 見出し翻訳とは独立して行う。本文の日本語訳はここでは作らない(常に原文表示。
  // src/components/HomeView.jsxのコメント参照)。
  const translated = await attachBodies(translatedHeadlines)

  const output = { articles: translated, updatedAt: new Date().toISOString(), geminiBackoff }
  writeFileSync(NEWS_JSON_PATH, JSON.stringify(output))
  console.log(`done. total articles=${translated.length}`)
}

main()
