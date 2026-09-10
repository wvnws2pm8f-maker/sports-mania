// 「好調なチーム」判定ロジック。HomeView(以前)とSportPanel(現在)の両方で使うため切り出した。
//
// 連勝(streak)の検出:
// NBA/MLBはESPNが streak(例:"W3") をそのまま返すのでそれを使う。
// サッカーはstreak統計が無いため、「今シーズン無敗で全勝」を連勝の近似値として扱う。
export function extractWinStreak(sportPath, row) {
  if (row.streak && /^W(\d+)$/.test(row.streak)) {
    return parseInt(row.streak.slice(1), 10)
  }
  if (sportPath === 'soccer') {
    const gp = parseInt(row.gamesPlayed, 10)
    const wins = parseInt(row.wins, 10)
    if (gp >= 3 && wins === gp) return gp
  }
  return 0
}

// standings(SportPanel/HomeViewが既に取得しているもの)から3連勝以上のチームを抽出する。
export function findStreaks(sportPath, standings) {
  const found = []
  for (const g of standings || []) {
    for (const r of g.rows) {
      const streak = extractWinStreak(sportPath, r)
      if (streak >= 3) {
        found.push({ teamId: r.id, team: r.team, logo: r.logo, streak })
      }
    }
  }
  found.sort((a, b) => b.streak - a.streak)
  return found
}
