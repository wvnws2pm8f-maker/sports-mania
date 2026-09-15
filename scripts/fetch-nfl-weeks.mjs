// NFL専用: 週(Week)単位の試合データ取得スクリプト。
// NFLは他競技(サッカー/NBA/MLB)と違い、1シーズン全体が「第1週〜第18週」という
// 明確な単位で区切られており、ファンも「今週の対戦カード」という単位で試合を追う。
// 通常の日付範囲ベースのスコアボード取得(fetch-espn-data.mjs)では直近数日分しか
// 見えないため、シーズン全体を週単位で行き来できるようこのスクリプトを別に用意した。
// ESPNのscoreboardは `?seasontype=2&dates=<year>&week=<N>` で該当週の試合を返す
// (seasontype: 1=プレシーズン, 2=レギュラーシーズン, 3=ポストシーズン。
// 2026-09にWeb検索でこのパラメータ形式を確認済み)。
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
const REGULAR_SEASON_WEEKS = 18

// NFLのレギュラーシーズンは9月開幕・翌年1月終了なので、1〜7月は前年開幕シーズンの
// 真っ最中(プレーオフ〜オフシーズン)とみなし、ESPNのdatesパラメータに使う年を1つ戻す。
function currentNflSeasonYear() {
  const now = new Date()
  const month = now.getMonth() + 1
  return month <= 7 ? now.getFullYear() - 1 : now.getFullYear()
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
}

// fetch-espn-data.mjsのnormalizeEventと同等のロジック。
// このスクリプトは独立して動く前提であえて共有せず複製している。
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

async function main() {
  mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })
  const year = currentNflSeasonYear()

  const weeks = []
  for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
    try {
      const data = await fetchJson(`${BASE}?seasontype=2&dates=${year}&week=${w}`)
      const games = (data.events || []).map(normalizeEvent)
      weeks.push({ week: w, games })
    } catch (err) {
      console.error(`FAILED week ${w}: ${err.message}`)
    }
  }

  // 「現在の週」は、実際の試合状況から自己判定する(ESPNのレスポンス自体が返すweek.numberに
  // 頼らず、取得済みデータから逆算することで、シーズン境界のズレを避ける)。
  // 単純に「今日から◯日以内の試合がある週」で判定すると、ある週の最終試合の数日後には
  // 次の週の試合も同じ±日数の範囲に入ってしまい、既に全試合終了済みの週を誤って
  // 「現在の週」としてしまうことがあった(2026-09-15、ローカル検証で発覚)。
  // そこで「進行中の試合がある週」→「まだ終わっていない試合がある最も早い週」の順に探す。
  let currentWeek = weeks.find((w) => w.games.some((g) => g.isLive))?.week
  if (!currentWeek) {
    currentWeek = weeks.find((w) => w.games.some((g) => !g.isFinal))?.week
  }
  if (!currentWeek) {
    // 全日程終了済み(オフシーズン)なら最終週を既定にする
    currentWeek = weeks[weeks.length - 1]?.week || 1
  }

  if (weeks.every((w) => w.games.length === 0)) {
    throw new Error('NFLの週別データが1件も取得できませんでした')
  }

  const output = { season: year, currentWeek, weeks, updatedAt: new Date().toISOString() }
  writeFileSync(new URL('../public/data/football-nfl-weeks.json', import.meta.url), JSON.stringify(output))
  console.log(`done. season=${year} currentWeek=${currentWeek} weeksFetched=${weeks.filter((w) => w.games.length > 0).length}/${REGULAR_SEASON_WEEKS}`)
}

main()
