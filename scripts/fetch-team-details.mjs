// チーム詳細ページ用データ取得スクリプト。
// 各リーグの「チーム一覧」→ 重複除去 → チームごとに「ロスター(選手一覧)」を取得し、
// public/data/team/<sportPath>-<teamId>.json として書き出す。
//
// 注意: ESPNの選手データは競技によって形が違う。
// - NBA: athletes が選手のフラットな配列。各選手に headshot.href が入っている。
// - MLB: athletes が「ポジション区分ごとのグループ」の配列({ position, items: [選手,...] })。
//   選手個別に headshot は無いが、`https://a.espncdn.com/i/headshots/mlb/players/full/<id>.png`
//   のURLパターンで実在すれば取得できる(無ければ404なので、表示側でチームロゴにフォールバックする)。
// - soccer: athletes はフラットな配列。有名選手には headshot.href が入っているが、
//   多くの控え選手・若手には無い(ESPNの編集コンテンツ次第らしい)。無い場合は
//   表示側(TeamDetail)でチームロゴにフォールバックする。
//
// ロスターは試合ほど頻繁には変わらないため、このスクリプトは
// (15分おきのスコア取得とは別に)1日1回程度の実行を想定している。
import { writeFileSync, mkdirSync } from 'node:fs'
import { TARGETS } from './leagues.mjs'

const BASE = 'https://site.api.espn.com/apis/site/v2'
const CONCURRENCY = 5

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
}

async function getTeamList(sportPath, leaguePath) {
  const data = await fetchJson(`${BASE}/sports/${sportPath}/${leaguePath}/teams?limit=100`)
  const teams = data.sports?.[0]?.leagues?.[0]?.teams || []
  return teams.map((t) => t.team)
}

function headshotFor(sportPath, athleteId, apiHeadshot) {
  if (apiHeadshot?.href) return apiHeadshot.href
  if (sportPath === 'baseball') {
    // MLBはAPIにheadshotフィールドが無いが、CDNのURLパターンで取得できる選手が多い。
    // 無い場合は表示側(img onError)でチームロゴにフォールバックさせる。
    return `https://a.espncdn.com/i/headshots/mlb/players/full/${athleteId}.png`
  }
  // basketball(NBA)はAPIのheadshotで足りる。soccerは公開データに顔写真が無いため null のまま
  // (表示側でチームロゴを使う)。
  return null
}

function normalizeAthlete(sportPath, a) {
  return {
    id: a.id,
    name: a.fullName || a.displayName || '',
    jersey: a.jersey || '',
    position: a.position?.abbreviation || a.position?.displayName || (typeof a.position === 'string' ? a.position : ''),
    headshot: headshotFor(sportPath, a.id, a.headshot)
  }
}

function flattenAthletes(sportPath, athletesField) {
  if (!Array.isArray(athletesField)) return []
  // グループ形式({ position, items }) とフラット形式のどちらにも対応する
  if (athletesField.length > 0 && Array.isArray(athletesField[0]?.items)) {
    return athletesField.flatMap((group) => (group.items || []).map((a) => normalizeAthlete(sportPath, a)))
  }
  return athletesField.map((a) => normalizeAthlete(sportPath, a))
}

async function fetchTeamDetail(sportPath, leaguePath, teamMeta) {
  const rosterData = await fetchJson(`${BASE}/sports/${sportPath}/${leaguePath}/teams/${teamMeta.id}/roster`)
  return {
    team: {
      id: teamMeta.id,
      name: teamMeta.displayName || teamMeta.name || '',
      abbreviation: teamMeta.abbreviation || '',
      logo: teamMeta.logos?.[0]?.href || teamMeta.logo || '',
      color: teamMeta.color || ''
    },
    roster: flattenAthletes(sportPath, rosterData.athletes),
    updatedAt: new Date().toISOString()
  }
}

// 簡易な並列実行プール(ESPNの非公式APIに一度に大量アクセスしないよう抑える)
async function runPool(items, limit, worker) {
  const results = []
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      try {
        results[idx] = { ok: true, value: await worker(items[idx], idx) }
      } catch (err) {
        results[idx] = { ok: false, error: err }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
  return results
}

async function main() {
  mkdirSync(new URL('../public/data/team/', import.meta.url), { recursive: true })

  // sportPathごとにチームを重複除去して集める(サッカーは国内リーグとCLの両方に同じチームが出る)
  const bySport = new Map() // sportPath -> Map(teamId -> { leaguePath, teamMeta })

  for (const [sportPath, leaguePath] of TARGETS) {
    if (!bySport.has(sportPath)) bySport.set(sportPath, new Map())
    const teamMap = bySport.get(sportPath)
    let teams
    try {
      teams = await getTeamList(sportPath, leaguePath)
    } catch (err) {
      console.error(`FAILED team list: ${sportPath}/${leaguePath}: ${err.message}`)
      continue
    }
    for (const t of teams) {
      if (!teamMap.has(t.id)) {
        teamMap.set(t.id, { leaguePath, teamMeta: t })
      }
    }
    console.log(`team list ok: ${sportPath}/${leaguePath} (${teams.length} teams)`)
  }

  let totalOk = 0
  let totalFail = 0

  for (const [sportPath, teamMap] of bySport) {
    const entries = [...teamMap.entries()]
    console.log(`fetching rosters for ${sportPath}: ${entries.length} unique teams...`)
    const results = await runPool(entries, CONCURRENCY, async ([teamId, { leaguePath, teamMeta }]) => {
      const detail = await fetchTeamDetail(sportPath, leaguePath, teamMeta)
      writeFileSync(new URL(`../public/data/team/${sportPath}-${teamId}.json`, import.meta.url), JSON.stringify(detail))
      return teamId
    })
    for (const r of results) {
      if (r.ok) totalOk++
      else {
        totalFail++
        console.error(`FAILED roster: ${sportPath}: ${r.error.message}`)
      }
    }
  }

  console.log(`done. ok=${totalOk} fail=${totalFail}`)
  if (totalOk === 0) {
    throw new Error('チーム詳細データの取得に全て失敗しました')
  }
}

main()
