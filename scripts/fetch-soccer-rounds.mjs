// サッカーの試合結果を「第何節」でまとめたいという要望(2026-09-22、NFLの週別表示のような
// まとめ方が欲しいとのこと)を受けて追加。
//
// 【重要】ESPNの非公式APIには、NFLの"week"パラメータのような公式の節(matchday/round)番号が
// 存在しない。実データで確認済み(2026-09-22): サッカーの試合個別データ(sports.core.api.espn.com
// のevent/競技オブジェクト、site.web.api.espn.comのチームスケジュール)のどちらにも
// week/round/matchdayに相当するフィールドが一切無く、notesも空。ESPN自身のサイトが
// 節番号をどこか別の内部データで持っているとしても、この公開APIからは取得できない。
//
// そのため、節番号は自前で算出する。総当たり方式のリーグ戦では「同じ節の中に同じチームは
// 2回登場しない」という性質を使い、シーズン全試合を日付順に走査して、既に登場済みの
// チームが再登場したタイミングで次の節に進める、という貪欲法でグルーピングする。
// (fetch-nfl-weeks.mjsで「現在の週をESPNの値に頼らず自己判定する」とした方針と同じ考え方)
// 延期戦などで日付の前後が入れ替わると節番号が1つずれる可能性はあるが、致命的な破綻にはならない。
//
// このスクリプトは fetch-espn-data.mjs の後に実行する前提: 既に書き出し済みの
// public/data/soccer-<league>.json を読み込み、games配列の各試合にroundフィールドを
// 追記して上書き保存する(standings等はそのまま)。
import { readFileSync, writeFileSync } from 'node:fs'
import { TARGETS } from './leagues.mjs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const SOCCER_LEAGUES = TARGETS.filter(([sportPath]) => sportPath === 'soccer').map(([, leaguePath]) => leaguePath)

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

// シーズンを8月開始〜翌5月終了とみなし、対象の年月(YYYYMM)を列挙する。
// (欧州サッカーの主要リーグ・チャンピオンズリーグはいずれもこの期間に収まる。
// ondays系のカレンダーAPIで実データを確認済み: 2026-27プレミアリーグは8/21開幕〜5/30閉幕)
// シーズン全体を対象にするのは、途中の月だけだと節の境界(貪欲法の基準となる
// 「登場済みチーム集合」)がシーズン開始からズレて狂ってしまうため。
function seasonMonths() {
  const now = new Date()
  const month = now.getMonth() + 1
  const startYear = month >= 7 ? now.getFullYear() : now.getFullYear() - 1
  const months = []
  for (let m = 8; m <= 12; m++) months.push(`${startYear}${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 6; m++) months.push(`${startYear + 1}${String(m).padStart(2, '0')}`)
  return months
}

function normalizeMini(ev) {
  const comp = ev.competitions?.[0]
  const competitors = comp?.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home')
  const away = competitors.find((c) => c.homeAway === 'away')
  return { id: ev.id, date: ev.date, homeId: home?.team?.id || '', awayId: away?.team?.id || '' }
}

async function fetchSeasonEvents(leaguePath) {
  const months = seasonMonths()
  const results = await Promise.all(
    months.map((ym) =>
      fetchJson(`${BASE}/soccer/${leaguePath}/scoreboard?dates=${ym}&limit=500`).catch((err) => {
        console.log(`::warning::soccer-rounds ${leaguePath} ${ym} 取得失敗: ${err.message}`)
        return { events: [] }
      })
    )
  )
  const byId = new Map()
  for (const data of results) {
    for (const ev of data.events || []) {
      const norm = normalizeMini(ev)
      if (norm.id && norm.homeId && norm.awayId) byId.set(norm.id, norm)
    }
  }
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date))
}

function assignRounds(events) {
  const roundOf = new Map()
  let round = 1
  let seen = new Set()
  for (const ev of events) {
    if (seen.has(ev.homeId) || seen.has(ev.awayId)) {
      round += 1
      seen = new Set()
    }
    seen.add(ev.homeId)
    seen.add(ev.awayId)
    roundOf.set(ev.id, round)
  }
  return roundOf
}

async function main() {
  for (const leaguePath of SOCCER_LEAGUES) {
    const key = `soccer-${leaguePath}`
    const path = new URL(`../public/data/${key}.json`, import.meta.url)
    try {
      const seasonEvents = await fetchSeasonEvents(leaguePath)
      if (seasonEvents.length === 0) {
        console.log(`::warning::soccer-rounds ${key}: シーズンの試合が1件も取得できず、節番号の付与をスキップしました`)
        continue
      }
      const roundOf = assignRounds(seasonEvents)
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      let patched = 0
      for (const g of data.games || []) {
        if (roundOf.has(g.id)) {
          g.round = roundOf.get(g.id)
          patched++
        }
      }
      writeFileSync(path, JSON.stringify(data))
      console.log(`ok: ${key} rounds patched=${patched}/${data.games?.length || 0} (season events=${seasonEvents.length})`)
    } catch (err) {
      console.log(`::error::FAILED soccer-rounds ${key}: ${err.message}`)
    }
  }
}

main()
