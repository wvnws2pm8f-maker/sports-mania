import { useEffect, useState } from 'react'
import { getNews, getStandings, getScoreboard, getHotTeams } from '../services/espn.js'
import { allLeagueTargets } from '../data/leagues.js'
import { rivalries } from '../data/rivalries.js'
import boxingData from '../data/boxingSchedule.json'
import TeamDetail from './TeamDetail.jsx'

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`
}

function timeAgo(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 60) return `${Math.max(diffMin, 0)}分前`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  return `${Math.round(diffHour / 24)}日前`
}

// 連勝(好調)を検出する。
// NBA/MLBはESPNが streak(例:"W3") をそのまま返すのでそれを使う。
// サッカーはstreak統計が無いため、「今シーズン無敗で全勝」を連勝の近似値として扱う。
function extractWinStreak(sportPath, row) {
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

export default function HomeView() {
  const [news, setNews] = useState(null)
  const [streaks, setStreaks] = useState(null)
  const [hotTeams, setHotTeams] = useState(null)
  const [notableGames, setNotableGames] = useState(null)
  const [leaguesData, setLeaguesData] = useState(null)
  const [error, setError] = useState(null)
  const [selectedTeam, setSelectedTeam] = useState(null) // { sportPath, leaguePath, teamId }

  useEffect(() => {
    let cancelled = false

    getNews()
      .then((d) => !cancelled && setNews(d.articles))
      .catch((err) => {
        console.warn('[HomeView] news load failed', err)
        if (!cancelled) setError((e) => e || 'ニュースを取得できませんでした')
      })

    getHotTeams()
      .then((d) => !cancelled && setHotTeams(d.teams))
      .catch((err) => console.warn('[HomeView] hot teams load failed', err)) // 無くても致命的ではないので黙って諦める

    Promise.all(
      allLeagueTargets.map(async (t) => {
        const [standings, games] = await Promise.all([getStandings(t.sportPath, t.leaguePath), getScoreboard(t.sportPath, t.leaguePath)])
        return { ...t, standings, games }
      })
    )
      .then((leagues) => {
        if (cancelled) return
        setLeaguesData(leagues)

        // 好調なチーム(3連勝以上)を抽出
        const foundStreaks = []
        for (const l of leagues) {
          for (const g of l.standings || []) {
            for (const r of g.rows) {
              const streak = extractWinStreak(l.sportPath, r)
              if (streak >= 3) {
                foundStreaks.push({
                  sportPath: l.sportPath,
                  leaguePath: l.leaguePath,
                  teamId: r.id,
                  team: r.team,
                  logo: r.logo,
                  streak,
                  leagueName: l.leagueName
                })
              }
            }
          }
        }
        foundStreaks.sort((a, b) => b.streak - a.streak)
        setStreaks(foundStreaks.slice(0, 6))

        // 今週末の注目カード: まずライバル対決、無ければ首位同士の対戦を拾う
        const now = Date.now()
        const weekAhead = now + 8 * 24 * 60 * 60 * 1000
        const found = []
        for (const l of leagues) {
          const upcoming = (l.games || []).filter((g) => {
            const t2 = new Date(g.date).getTime()
            return !g.isFinal && t2 >= now - 60 * 60 * 1000 && t2 <= weekAhead
          })

          const rivalryMatch = upcoming.find((g) =>
            rivalries.some(
              (r) =>
                r.sportPath === l.sportPath &&
                ((r.teamIds[0] === g.home.id && r.teamIds[1] === g.away.id) ||
                  (r.teamIds[1] === g.home.id && r.teamIds[0] === g.away.id))
            )
          )
          if (rivalryMatch) {
            const rivalry = rivalries.find(
              (r) =>
                r.sportPath === l.sportPath &&
                ((r.teamIds[0] === rivalryMatch.home.id && r.teamIds[1] === rivalryMatch.away.id) ||
                  (r.teamIds[1] === rivalryMatch.home.id && r.teamIds[0] === rivalryMatch.away.id))
            )
            found.push({
              ...rivalryMatch,
              sportPath: l.sportPath,
              leaguePath: l.leaguePath,
              leagueName: l.leagueName,
              label: rivalry?.label || '注目カード'
            })
            continue
          }

          // 首位同士の対戦(グループの先頭2チーム)
          const topIds = (l.standings?.[0]?.rows || []).slice(0, 2).map((r) => r.id)
          if (topIds.length === 2) {
            const topClash = upcoming.find((g) => topIds.includes(g.home.id) && topIds.includes(g.away.id))
            if (topClash) {
              found.push({ ...topClash, sportPath: l.sportPath, leaguePath: l.leaguePath, leagueName: l.leagueName, label: '首位対決' })
            }
          }
        }
        found.sort((a, b) => new Date(a.date) - new Date(b.date))
        setNotableGames(found.slice(0, 6))
      })
      .catch((err) => {
        console.warn('[HomeView] league scan failed', err)
        if (!cancelled) setError((e) => e || 'データを取得できませんでした')
      })

    return () => {
      cancelled = true
    }
  }, [])

  function openTeam(sportPath, leaguePath, teamId) {
    setSelectedTeam({ sportPath, leaguePath, teamId })
  }

  if (selectedTeam) {
    const league = leaguesData?.find((l) => l.sportPath === selectedTeam.sportPath && l.leaguePath === selectedTeam.leaguePath)
    const standingsRow = league?.standings?.flatMap((g) => g.rows).find((r) => r.id === selectedTeam.teamId)
    return (
      <div className="home-view">
        <TeamDetail
          sportPath={selectedTeam.sportPath}
          teamId={selectedTeam.teamId}
          standingsRow={standingsRow}
          games={league?.games}
          onBack={() => setSelectedTeam(null)}
        />
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const upcomingFights = (boxingData.fights || []).filter((f) => f.date >= today).slice(0, 2)

  return (
    <div className="home-view">
      {error && <p className="error-text">{error}</p>}

      {notableGames && notableGames.length > 0 && (
        <section className="home-section">
          <h2 className="home-section-title">📅 今週の注目カード</h2>
          <div className="notable-games-row">
            {notableGames.map((g) => (
              <div key={g.id} className="notable-game-card">
                <div className="notable-game-label">
                  {g.label} ・ {g.leagueName}
                </div>
                <div className="notable-game-date">{formatDate(g.date)}</div>
                <div className="notable-game-teams">
                  <button type="button" className="team-cell-button" onClick={() => openTeam(g.sportPath, g.leaguePath, g.home.id)}>
                    {g.home.logo && <img className="team-logo" src={g.home.logo} alt="" />}
                    <span>{g.home.team}</span>
                  </button>
                  <span className="notable-game-vs">vs</span>
                  <button type="button" className="team-cell-button" onClick={() => openTeam(g.sportPath, g.leaguePath, g.away.id)}>
                    {g.away.logo && <img className="team-logo" src={g.away.logo} alt="" />}
                    <span>{g.away.team}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {((streaks && streaks.length > 0) || (hotTeams && hotTeams.length > 0)) && (
        <section className="home-section">
          <h2 className="home-section-title">🔥 好調なチーム</h2>

          {streaks && streaks.length > 0 && (
            <>
              <div className="home-subsection-title">連勝中</div>
              <div className="streak-row">
                {streaks.map((s, i) => (
                  <button
                    type="button"
                    key={i}
                    className="streak-chip"
                    onClick={() => openTeam(s.sportPath, s.leaguePath, s.teamId)}
                  >
                    {s.logo && <img className="team-logo" src={s.logo} alt="" />}
                    <span className="streak-chip-team">{s.team}</span>
                    <span className="streak-chip-count">{s.streak}連勝</span>
                    <span className="streak-chip-league">{s.leagueName}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {hotTeams && hotTeams.length > 0 && (
            <>
              <div className="home-subsection-title">直近{hotTeams[0].played}試合の勝率が高いチーム</div>
              <div className="streak-row">
                {hotTeams.map((t, i) => (
                  <button
                    type="button"
                    key={i}
                    className="streak-chip"
                    onClick={() => openTeam(t.sportPath, t.leaguePath, t.teamId)}
                  >
                    {t.logo && <img className="team-logo" src={t.logo} alt="" />}
                    <span className="streak-chip-team">{t.team}</span>
                    <span className="streak-chip-count">
                      {t.wins}勝{t.losses}敗
                    </span>
                    <span className="streak-chip-league">{t.leagueName}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {upcomingFights.length > 0 && (
        <section className="home-section">
          <h2 className="home-section-title">🥊 ボクシング速報</h2>
          <div className="game-list">
            {upcomingFights.map((f, i) => (
              <div key={i} className="game-card boxing-card">
                <div className="game-card-status">{formatDate(f.date)}</div>
                <div className="boxing-card-title">{f.cardName}</div>
                <div className="boxing-card-venue">📍 {f.venue}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <h2 className="home-section-title">📰 注目ニュース</h2>
        {!news && !error && <p className="muted">よみこみちゅう…</p>}
        {news && (
          <div className="news-list">
            {news.map((a) => (
              <a key={a.id} className="news-card" href={a.link} target="_blank" rel="noreferrer">
                {a.image && <img className="news-card-image" src={a.image} alt="" />}
                <div className="news-card-body">
                  <div className="news-card-headline">{a.headline}</div>
                  <div className="news-card-desc">{a.description}</div>
                  <div className="news-card-time">{timeAgo(a.published)}</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
