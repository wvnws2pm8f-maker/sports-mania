// ESPNの非公式公開APIを叩いて、順位表・試合データを取得し public/data/ に静的JSONとして書き出す。
// ブラウザから直接ESPN APIを叩くとCORSでブロックされるため、
// GitHub Actions(サーバー環境=CORS制約なし)でこのスクリプトを定期実行し、
// 結果のJSONをリポジトリにコミットする方式に変更した。
// アプリはビルド後にこの public/data/*.json を fetch する。
import { writeFileSync, mkdirSync } from 'node:fs'
import { TARGETS } from './leagues.mjs'

const BASE = 'https://site.api.espn.com/apis'

function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// 直近3日〜10日後までの試合を拾う(常に「今日だけ」だと閑散期に空になりがちなため)
function scoreboardDateRange() {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 3)
  const to = new Date(now)
  to.setDate(to.getDate() + 10)
  return `${fmtDate(from)}-${fmtDate(to)}`
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
}

function statVal(entry, name) {
  const s = entry.stats?.find((s) => s.name === name)
  return s ? s.displayValue : ''
}

function normalizeEntry(entry) {
  return {
    id: entry.team?.id,
    team: entry.team?.displayName || entry.team?.name || '',
    shortName: entry.team?.abbreviation || '',
    logo: entry.team?.logos?.[0]?.href || entry.team?.logo || '',
    rank: statVal(entry, 'playoffSeed') || statVal(entry, 'rank'),
    gamesPlayed: statVal(entry, 'gamesPlayed'),
    wins: statVal(entry, 'wins'),
    ties: statVal(entry, 'ties'),
    losses: statVal(entry, 'losses'),
    winPercent: statVal(entry, 'winPercent'),
    gamesBehind: statVal(entry, 'gamesBehind'),
    streak: statVal(entry, 'streak'),
    points: statVal(entry, 'points'),
    goalDiff: statVal(entry, 'pointDifferential')
  }
}

// ESPNの順位表APIはリーグによって階層の深さが違う。MLB/NBAは
// リーグ/カンファレンス(children) > 地区(さらにchildren) > 各チーム、と2階層ネストしており、
// 従来はこの1階層目(アメリカンリーグ/ナショナルリーグ=15チームずつ)で止めていたため、
// 本来の「地区別」順位表(ア・ナ各リーグ東地区/中地区/西地区=5チームずつ×6)にならず、
// ユーザーから「違う、もう少し細かいはず」と指摘された(2026-09-12)。
// 子(children)を持つノードは実体の無い中間集計なので、子が無くなる末端までずっと辿る。
function collectStandingsGroups(node) {
  if (node.children && node.children.length > 0) {
    return node.children.flatMap(collectStandingsGroups)
  }
  return [{ name: node.name, entries: node.standings?.entries || [] }]
}

function normalizeStandings(data) {
  const groups =
    data.children && data.children.length > 0
      ? data.children.flatMap(collectStandingsGroups)
      : [{ name: data.name, entries: data.standings?.entries || [] }]
  return groups
    .map((g) => ({
      groupName: g.name,
      rows: (g.entries || []).map(normalizeEntry)
    }))
    .filter((g) => g.rows.length > 0)
}

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
    }
  }
}

function normalizeScoreboard(data) {
  return (data.events || []).map(normalizeEvent)
}

async function fetchLeague(sportPath, leaguePath) {
  const dates = scoreboardDateRange()
  const [standingsRaw, scoreboardRaw] = await Promise.all([
    fetchJson(`${BASE}/v2/sports/${sportPath}/${leaguePath}/standings`),
    fetchJson(`${BASE}/site/v2/sports/${sportPath}/${leaguePath}/scoreboard?dates=${dates}`)
  ])
  return {
    standings: normalizeStandings(standingsRaw),
    games: normalizeScoreboard(scoreboardRaw),
    updatedAt: new Date().toISOString()
  }
}

async function main() {
  mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })
  const results = []
  for (const [sportPath, leaguePath] of TARGETS) {
    const key = `${sportPath}-${leaguePath}`
    try {
      const data = await fetchLeague(sportPath, leaguePath)
      writeFileSync(new URL(`../public/data/${key}.json`, import.meta.url), JSON.stringify(data))
      console.log(`ok: ${key} (standings groups=${data.standings.length}, games=${data.games.length})`)
      results.push({ key, ok: true })
    } catch (err) {
      console.error(`FAILED: ${key}: ${err.message}`)
      results.push({ key, ok: false, error: err.message })
    }
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length === results.length) {
    // 全滅した場合だけビルド/コミットを失敗させる(一部リーグの不調では失敗させない)
    throw new Error('全リーグのデータ取得に失敗しました')
  }
  if (failed.length > 0) {
    console.warn(`一部失敗: ${failed.map((f) => f.key).join(', ')}`)
  }
}

main()
