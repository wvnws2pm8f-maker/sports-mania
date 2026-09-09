// ホーム画面の「注目ニュース」用データ取得スクリプト。
// ESPNは順位表・試合結果だけでなく、実際の編集記事(見出し・要約・写真)も公開している。
// これを使うことで「結果の寄せ集め」ではなく「今スポーツ界で何が起きているか」を伝えられる。
import { writeFileSync } from 'node:fs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports'

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

  const output = { articles: all, updatedAt: new Date().toISOString() }
  writeFileSync(new URL('../public/data/news.json', import.meta.url), JSON.stringify(output))
  console.log(`done. total articles=${all.length}`)
}

main()
