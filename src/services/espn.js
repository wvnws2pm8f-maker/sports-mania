// ESPNの非公式(だが広く使われている)公開APIを使う。
// APIキー・会員登録が不要で、サッカー/NBA/MLBの順位表・試合速報を取得できる。
// 非公式なので将来変更・停止される可能性はある点だけ留意。
const BASE = 'https://site.api.espn.com/apis'

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`ESPN API error ${res.status}`)
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

// sportPath 例: 'soccer' | 'basketball' | 'baseball'
// leaguePath 例: 'eng.1' | 'nba' | 'mlb'
export async function getStandings(sportPath, leaguePath) {
  const data = await fetchJson(`${BASE}/v2/sports/${sportPath}/${leaguePath}/standings`)
  const groups = data.children && data.children.length > 0 ? data.children : [{ name: data.name, standings: data.standings }]
  return groups
    .map((g) => ({
      groupName: g.name,
      rows: (g.standings?.entries || []).map(normalizeEntry)
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
      team: home?.team?.displayName || '',
      score: home?.score ?? '',
      logo: home?.team?.logo || ''
    },
    away: {
      team: away?.team?.displayName || '',
      score: away?.score ?? '',
      logo: away?.team?.logo || ''
    }
  }
}

// dates: 'YYYYMMDD' または 'YYYYMMDD-YYYYMMDD'(範囲) 省略可(今日周辺のデフォルト)
export async function getScoreboard(sportPath, leaguePath, dates) {
  let url = `${BASE}/site/v2/sports/${sportPath}/${leaguePath}/scoreboard`
  if (dates) url += `?dates=${dates}`
  const data = await fetchJson(url)
  return (data.events || []).map(normalizeEvent)
}
