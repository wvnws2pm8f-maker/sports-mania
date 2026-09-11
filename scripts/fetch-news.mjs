// ホーム画面の「注目ニュース」用データ取得スクリプト。
// ESPNは順位表・試合結果だけでなく、実際の編集記事(見出し・要約・写真)も公開している。
// これを使うことで「結果の寄せ集め」ではなく「今スポーツ界で何が起きているか」を伝えられる。
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { callGemini, parseGeminiJson, hasGeminiKey } from './gemini.mjs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const NEWS_JSON_PATH = new URL('../public/data/news.json', import.meta.url)

// ニュースは(順位表と違って)リーグ横断のエンドポイントが無いので、
// リーグごとに取得して sportPath 単位でまとめる(サッカーは複数リーグを統合・重複除去)。
const SOCCER_LEAGUES = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions']

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
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

async function translateArticles(articles) {
  if (!hasGeminiKey()) return articles
  const cache = loadPreviousTranslations()
  const toTranslate = []
  const byId = new Map()
  for (const a of articles) {
    const cached = cache.get(a.id)
    if (cached && cached.headline === a.headline) {
      byId.set(a.id, { ...a, headlineJa: cached.headlineJa, descriptionJa: cached.descriptionJa })
    } else {
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

async function main() {
  const bySport = { soccer: new Map(), basketball: new Map(), baseball: new Map() }

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
    ['baseball', 'mlb']
  ]) {
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

  const translated = await translateArticles(all)
  if (hasGeminiKey()) {
    const newlyTranslated = translated.filter((a) => a.headlineJa).length
    console.log(`translation: ${newlyTranslated}/${translated.length} articles have 日本語`)
  } else {
    console.log('GEMINI_API_KEY未設定のため翻訳はスキップ(英語のまま表示されます)')
  }

  const output = { articles: translated, updatedAt: new Date().toISOString() }
  writeFileSync(NEWS_JSON_PATH, JSON.stringify(output))
  console.log(`done. total articles=${translated.length}`)
}

main()
