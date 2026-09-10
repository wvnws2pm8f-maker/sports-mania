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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function translateArticle(headline, description) {
  const prompt = `以下は英語のスポーツニュースの見出しと要約です。自然な日本語に翻訳してください。
出力は次のJSON形式のみとし、他の説明・前置き・コードブロック記号は一切付けないでください。
{"headline": "翻訳した見出し", "description": "翻訳した要約"}

見出し: ${headline}
要約: ${description}`
  // asJson: Geminiに前置き無しの純粋なJSONだけを返させる。これが無いと、見出し=要約の
  // 動画ハイライトのような単純な記事で説明文を付けて返すことがありJSON parseに失敗していた。
  const text = await callGemini(prompt, { asJson: true })
  const parsed = parseGeminiJson(text)
  if (!parsed?.headline) return null
  return parsed
}

async function translateArticles(articles) {
  if (!hasGeminiKey()) return articles
  const cache = loadPreviousTranslations()
  const result = []
  for (const a of articles) {
    const cached = cache.get(a.id)
    if (cached && cached.headline === a.headline) {
      result.push({ ...a, headlineJa: cached.headlineJa, descriptionJa: cached.descriptionJa })
      continue
    }
    const translated = await translateArticle(a.headline, a.description)
    if (translated) {
      result.push({ ...a, headlineJa: translated.headline, descriptionJa: translated.description || '' })
    } else {
      result.push(a) // 翻訳失敗時は原文のまま(次回実行時に再度リトライされる)
    }
    // 無料枠のレート制限(1分あたりの回数制限)に引っかからないよう、実際にAPIを呼んだ時だけ間隔を空ける
    // (キャッシュ済みでスキップしたものは待たない)
    await sleep(1500)
  }
  return result
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
