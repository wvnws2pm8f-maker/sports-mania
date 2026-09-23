// サッカーの試合結果を「第何節」でまとめたいという要望(2026-09-22、NFLの週別表示のような
// まとめ方が欲しいとのこと)を受けて追加。
//
// 【重要】ESPNの非公式APIには、NFLの"week"パラメータのような公式の節(matchday/round)番号が
// 存在しない。実データで確認済み(2026-09-22): サッカーの試合個別データ(sports.core.api.espn.com
// のevent/競技オブジェクト、site.web.api.espn.comのチームスケジュール)のどちらにも
// week/round/matchdayに相当するフィールドが一切無く、notesも空。ESPN自身のサイトが
// 節番号をどこか別の内部データで持っているとしても、この公開APIからは取得できない。
//
// そのため、節番号は自前で算出する。総当たり方式のリーグ戦・CLのリーグフェーズは、
// どちらも「1節=参加チームが必ず1試合ずつ」という構造のため、1節あたりの試合数は
// 常に(参加チーム数÷2)になる。日付順に並べたシーズン全試合をこの固定サイズで
// 区切るだけで節番号を算出する(詳細はassignRounds関数のコメント参照。
// 当初は「同じチームが再登場したら次の節」という貪欲法だったが、ラ・リーガで
// 実際の38節のはずが41節に分裂する不具合が実データで発覚したため、この固定サイズ方式に変更した)。
// (fetch-nfl-weeks.mjsで「現在の週をESPNの値に頼らず自己判定する」とした方針と同じ考え方)
//
// 【2026-09-23追記・修正】当初はfetch-espn-data.mjsの狭い取得範囲(前後3〜10日)で
// 既に書き出し済みのgames配列にroundを後付けするだけだったが、これだと
// ①1つの節の試合が範囲の途中で切れて一部のカードしか表示されない
// ②過去の節・2週間以上先の節が見れない
// という2つの不具合になった(2026-09-23、実データで確認・ユーザー指摘)。
// そこで方針を変更: このスクリプトがシーズン全試合を取得して節番号を算出したうえで、
// games配列そのものをシーズン全体のデータで丸ごと置き換える(fetch-espn-data.mjsの後に
// 実行する前提で、standings等はそのまま・gamesだけ上書き)。これによりGameList.jsxの
// 節ドロップダウンで開幕から最終節まで自由に行き来できるようになる。
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

// シーズンを8月開始〜翌6月終了とみなし、対象の年月(YYYYMM)を列挙する。
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

// fetch-espn-data.mjsのnormalizeEventと同等のロジック。両スクリプトは独立して動く前提で
// あえて共有せず複製している(fetch-nfl-weeks.mjsと同じ方針)。
function normalizeEvent(ev) {
  const comp = ev.competitions?.[0]
  const competitors = comp?.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home')
  const away = competitors.find((c) => c.homeAway === 'away')
  const statusType = ev.status?.type || {}
  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    statusDetail: statusType.shortDetail || statusType.description || '',
    isLive: statusType.state === 'in',
    isFinal: Boolean(statusType.completed),
    venue: comp?.venue?.fullName || '',
    home: {
      id: home?.team?.id || '',
      team: home?.team?.displayName || '',
      score: home?.score ?? '',
      logo: home?.team?.logo || ''
    },
    away: {
      id: away?.team?.id || '',
      team: away?.team?.displayName || '',
      score: away?.score ?? '',
      logo: away?.team?.logo || ''
    },
    series: comp?.series?.summary ? { summary: comp.series.summary, title: comp.series.title || '' } : null
  }
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
      const norm = normalizeEvent(ev)
      if (norm.id && norm.home.id && norm.away.id) byId.set(norm.id, norm)
    }
  }
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date))
}

// 【2026-09-23・当初の「登場済みチームが再登場したら次の節」方式から変更】
// プレミアリーグ/セリエA/CLでは正しく実際の節数と一致したが、ラ・リーガだけ
// 38節のはずが41節に分裂する不具合が実データで発覚した(日程が週をまたいで
// 分散しているカードがあり、素朴な貪欲法だと1つの節が誤って2〜3個に割れてしまうため)。
// 総当たりのリーグ戦・CLのリーグフェーズは、どちらも「1節=全チームが必ず1試合ずつ」
// という構造上、1節あたりの試合数が必ず(参加チーム数 ÷ 2)になる。これは日程の
// 前後関係に一切左右されない不変の性質なので、日付順に並べたイベントを単純に
// この固定サイズで区切るだけで、節番号は必ず実際の総節数と一致する
// (例: 20チーム→1節10試合、380試合÷10=38節。36チーム・CLリーグフェーズ→1節18試合、
// 144試合÷18=8節。いずれも実データで一致を確認済み)。
function assignRounds(events) {
  const teamIds = new Set()
  for (const ev of events) {
    teamIds.add(ev.home.id)
    teamIds.add(ev.away.id)
  }
  const roundSize = Math.max(1, Math.floor(teamIds.size / 2))
  events.forEach((ev, i) => {
    ev.round = Math.floor(i / roundSize) + 1
  })
  return events
}

async function main() {
  for (const leaguePath of SOCCER_LEAGUES) {
    const key = `soccer-${leaguePath}`
    const path = new URL(`../public/data/${key}.json`, import.meta.url)
    try {
      const seasonEvents = await fetchSeasonEvents(leaguePath)
      if (seasonEvents.length === 0) {
        console.log(`::warning::soccer-rounds ${key}: シーズンの試合が1件も取得できず、gamesの置き換えをスキップしました`)
        continue
      }
      const withRounds = assignRounds(seasonEvents)
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      data.games = withRounds
      writeFileSync(path, JSON.stringify(data))
      const lastRound = withRounds[withRounds.length - 1]?.round
      console.log(`ok: ${key} games replaced with full season (${withRounds.length}試合, 第1〜${lastRound}節)`)
    } catch (err) {
      console.log(`::error::FAILED soccer-rounds ${key}: ${err.message}`)
    }
  }
}

main()
