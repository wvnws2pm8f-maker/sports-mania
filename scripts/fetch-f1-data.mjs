// F1(フォーミュラ1)用データ取得スクリプト。
// ESPNのF1データは薄く(このプロジェクトのボクシング同様、無料APIとして頼りない)、
// 代わりにJolpica-F1(旧Ergast APIの後継、オープンソースの無料F1専用API)を使う。
// https://github.com/jolpica/jolpica-f1 、エンドポイントはErgast互換で
// ドライバーズ/コンストラクターズ選手権・レースカレンダー・レース結果が取得できる。
// F1は「チーム対戦」ではなく「ポイント争い」+「レースカレンダー」という構造のため、
// 他競技(サッカー/NBA/MLB/NFL)のfetch-espn-data.mjsとは別の専用スクリプトにしている。
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'https://api.jolpi.ca/ergast/f1'

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
}

function normalizeDriverStanding(s) {
  return {
    position: s.position,
    points: s.points,
    wins: s.wins,
    driverId: s.Driver?.driverId,
    name: `${s.Driver?.givenName || ''} ${s.Driver?.familyName || ''}`.trim(),
    code: s.Driver?.code || '',
    nationality: s.Driver?.nationality || '',
    constructorName: s.Constructors?.[0]?.name || ''
  }
}

function normalizeConstructorStanding(s) {
  return {
    position: s.position,
    points: s.points,
    wins: s.wins,
    constructorId: s.Constructor?.constructorId,
    name: s.Constructor?.name || '',
    nationality: s.Constructor?.nationality || ''
  }
}

function normalizeRace(r) {
  return {
    round: r.round,
    raceName: r.raceName,
    circuitName: r.Circuit?.circuitName || '',
    locality: r.Circuit?.Location?.locality || '',
    country: r.Circuit?.Location?.country || '',
    date: r.date,
    time: r.time || ''
  }
}

function normalizeResult(r) {
  return {
    position: r.position,
    driverName: `${r.Driver?.givenName || ''} ${r.Driver?.familyName || ''}`.trim(),
    constructorName: r.Constructor?.name || '',
    status: r.status || '',
    points: r.points
  }
}

async function main() {
  mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })

  const [driverData, constructorData, scheduleData, lastResultData] = await Promise.all([
    fetchJson(`${BASE}/current/driverStandings.json`),
    fetchJson(`${BASE}/current/constructorStandings.json`),
    fetchJson(`${BASE}/current.json`),
    fetchJson(`${BASE}/current/last/results.json`).catch((err) => {
      console.error(`FAILED last race results: ${err.message}`)
      return null
    })
  ])

  const driverStandings = (driverData.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || []).map(
    normalizeDriverStanding
  )
  const constructorStandings = (
    constructorData.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || []
  ).map(normalizeConstructorStanding)
  const races = (scheduleData.MRData?.RaceTable?.Races || []).map(normalizeRace)

  const now = Date.now()
  const nextRace = races.find((r) => new Date(`${r.date}T${r.time || '00:00:00Z'}`).getTime() >= now) || null

  let lastRace = null
  const lastRaceRaw = lastResultData?.MRData?.RaceTable?.Races?.[0]
  if (lastRaceRaw) {
    lastRace = {
      round: lastRaceRaw.round,
      raceName: lastRaceRaw.raceName,
      date: lastRaceRaw.date,
      results: (lastRaceRaw.Results || []).slice(0, 10).map(normalizeResult)
    }
  }

  const output = {
    season: scheduleData.MRData?.RaceTable?.season || '',
    driverStandings,
    constructorStandings,
    races,
    nextRace,
    lastRace,
    updatedAt: new Date().toISOString()
  }

  if (driverStandings.length === 0 && races.length === 0) {
    throw new Error('F1データが1件も取得できませんでした')
  }

  writeFileSync(new URL('../public/data/f1.json', import.meta.url), JSON.stringify(output))
  console.log(
    `done. drivers=${driverStandings.length} constructors=${constructorStandings.length} races=${races.length} nextRace=${nextRace?.raceName || 'none'}`
  )
}

main()
