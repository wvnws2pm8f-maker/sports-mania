// ブラウザから直接ESPNの公開APIを叩くとCORSでブロックされる(ESPN側がAccess-Control-Allow-Originを
// 返さないため)。そこでGitHub Actions上で scripts/fetch-espn-data.mjs を定期実行し、
// 取得・整形済みのJSONを public/data/ にコミットしておき、アプリはそれを読みに行く方式にした。
// public/data/<sportPath>-<leaguePath>.json の中身: { standings, games, updatedAt }

const dataCache = new Map()

function dataUrl(sportPath, leaguePath) {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}data/${sportPath}-${leaguePath}.json`.replace(/\/{2,}/g, '/').replace(':/', '://')
}

function loadLeagueData(sportPath, leaguePath) {
  const key = `${sportPath}-${leaguePath}`
  if (!dataCache.has(key)) {
    const promise = fetch(dataUrl(sportPath, leaguePath), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`data fetch error ${res.status}`)
        return res.json()
      })
      .catch((err) => {
        dataCache.delete(key) // 失敗時は次回リトライできるようキャッシュから外す
        throw err
      })
    dataCache.set(key, promise)
  }
  return dataCache.get(key)
}

// sportPath 例: 'soccer' | 'basketball' | 'baseball'
// leaguePath 例: 'eng.1' | 'nba' | 'mlb'
export async function getStandings(sportPath, leaguePath) {
  const data = await loadLeagueData(sportPath, leaguePath)
  return data.standings || []
}

export async function getScoreboard(sportPath, leaguePath) {
  const data = await loadLeagueData(sportPath, leaguePath)
  return data.games || []
}

// データが最後にサーバー側で取得された時刻(=表示用の「最終更新」)
export async function getDataUpdatedAt(sportPath, leaguePath) {
  const data = await loadLeagueData(sportPath, leaguePath)
  return data.updatedAt ? new Date(data.updatedAt) : null
}

// 手動更新ボタン用: メモリ上のキャッシュを捨てて再フェッチさせる
export function invalidate(sportPath, leaguePath) {
  dataCache.delete(`${sportPath}-${leaguePath}`)
}

// ホーム画面の「注目ニュース」。public/data/news.json を読む。
let newsPromise = null
export function getNews() {
  if (!newsPromise) {
    const base = import.meta.env.BASE_URL || '/'
    const url = `${base}data/news.json`.replace(/\/{2,}/g, '/').replace(':/', '://')
    newsPromise = fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`news fetch error ${res.status}`)
        return res.json()
      })
      .catch((err) => {
        newsPromise = null
        throw err
      })
  }
  return newsPromise
}

// ホーム画面の「調子の良いチーム」。public/data/hot-teams.json を読む。
// (直近10試合の勝率をscripts/fetch-team-details.mjsが1日1回計算する。現在の連勝数だけでは
//  連勝が途切れた直後の好調なチームを見逃すため、こちらは「直近◯試合で◯勝」の観点で拾う)
let hotTeamsPromise = null
export function getHotTeams() {
  if (!hotTeamsPromise) {
    const base = import.meta.env.BASE_URL || '/'
    const url = `${base}data/hot-teams.json`.replace(/\/{2,}/g, '/').replace(':/', '://')
    hotTeamsPromise = fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`hot-teams fetch error ${res.status}`)
        return res.json()
      })
      .catch((err) => {
        hotTeamsPromise = null
        throw err
      })
  }
  return hotTeamsPromise
}

// チーム詳細(ロスター等)。public/data/team/<sportPath>-<teamId>.json を読む。
// ロスターは1日1回更新(scripts/fetch-team-details.mjs)なので、標準のfetchキャッシュのままでよい。
const teamCache = new Map()

export async function getTeamDetail(sportPath, teamId) {
  const key = `${sportPath}-${teamId}`
  if (!teamCache.has(key)) {
    const base = import.meta.env.BASE_URL || '/'
    const url = `${base}data/team/${key}.json`.replace(/\/{2,}/g, '/').replace(':/', '://')
    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`team data fetch error ${res.status}`)
        return res.json()
      })
      .catch((err) => {
        teamCache.delete(key)
        throw err
      })
    teamCache.set(key, promise)
  }
  return teamCache.get(key)
}
