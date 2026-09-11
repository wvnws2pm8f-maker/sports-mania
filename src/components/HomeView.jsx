import { useEffect, useState } from 'react'
import { getNews, getStandings, getScoreboard, getSeasonMilestones, getTeamDetail } from '../services/espn.js'
import { allLeagueTargets } from '../data/leagues.js'
import { rivalries } from '../data/rivalries.js'
import { mlbPlayoffFormat, nbaPlayoffFormat, boxingTitleSystem } from '../data/championshipInfo.js'
import { getFavoriteTeams, getFavoritePlayers } from '../utils/favorites.js'
import boxingData from '../data/boxingSchedule.json'
import boxerProfiles from '../data/boxerProfiles.json'
import TeamDetail from './TeamDetail.jsx'

function daysUntil(iso) {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

// サッカーの優勝争い・残留争いを順位表から計算する。
// 降格枠の数はリーグによって違う(20チームリーグは3枠、18チームリーグは2枠が一般的)ので、
// チーム数から単純に推測する(playoff等の細かい例外までは踏み込まない)。
function computeSoccerRace(rows) {
  if (!rows || rows.length < 6) return null
  const sorted = [...rows]
  const leader = sorted[0]
  const second = sorted[1]
  const titleGap = second ? parseInt(leader.points, 10) - parseInt(second.points, 10) : null

  const relegationCount = sorted.length >= 20 ? 3 : 2
  const lastSafe = sorted[sorted.length - relegationCount - 1]
  const firstDropZone = sorted[sorted.length - relegationCount]
  const relegationGap =
    lastSafe && firstDropZone ? parseInt(lastSafe.points, 10) - parseInt(firstDropZone.points, 10) : null

  return { leader, second, titleGap, lastSafe, firstDropZone, relegationGap }
}

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

export default function HomeView() {
  const [news, setNews] = useState(null)
  const [milestones, setMilestones] = useState(null)
  const [notableGames, setNotableGames] = useState(null)
  const [leaguesData, setLeaguesData] = useState(null)
  const [error, setError] = useState(null)
  const [selectedTeam, setSelectedTeam] = useState(null) // { sportPath, leaguePath, teamId }
  // 「今週の注目カード」「チャンピオンへの道」はタイトルだけ横並びで表示し、
  // タップしたものだけその場で詳細を展開する(両方を初めから開くとホーム画面が縦に長くなりすぎるため)。
  const [expanded, setExpanded] = useState(null) // null | 'notable' | 'championship'
  // 推し(お気に入り)チーム・選手。ログイン機能が無いためこの端末のlocalStorageに保存されている。
  // 他のページ(TeamDetail)で☆を付けて戻ってくるとHomeViewが再マウントされるので、
  // マウント時に読み直せば最新の状態になる。
  const [favoriteTeams] = useState(() => getFavoriteTeams())
  const [favoritePlayers] = useState(() => getFavoritePlayers())
  const [playerStats, setPlayerStats] = useState({}) // playerId -> stats(最新の個人成績)

  useEffect(() => {
    let cancelled = false

    // 推し選手の個人成績(サッカー/ボクシングには無いので該当選手のみ取得)。
    // 登録時点のスナップショットではなく毎回最新のチーム詳細データから拾う。
    Promise.all(
      favoritePlayers
        .filter((p) => p.sportPath !== 'boxing' && p.teamId)
        .map((p) =>
          getTeamDetail(p.sportPath, p.teamId)
            .then((d) => {
              const row = d.roster.find((r) => r.id === p.playerId)
              return row?.stats ? [p.playerId, row.stats] : null
            })
            .catch(() => null)
        )
    ).then((pairs) => {
      if (cancelled) return
      const map = {}
      for (const pair of pairs) if (pair) map[pair[0]] = pair[1]
      setPlayerStats(map)
    })

    getNews()
      .then((d) => !cancelled && setNews(d.articles))
      .catch((err) => {
        console.warn('[HomeView] news load failed', err)
        if (!cancelled) setError((e) => e || 'ニュースを取得できませんでした')
      })

    getSeasonMilestones()
      .then((d) => !cancelled && setMilestones(d))
      .catch((err) => console.warn('[HomeView] season milestones load failed', err)) // 無くても致命的ではない

    Promise.all(
      allLeagueTargets.map(async (t) => {
        const [standings, games] = await Promise.all([getStandings(t.sportPath, t.leaguePath), getScoreboard(t.sportPath, t.leaguePath)])
        return { ...t, standings, games }
      })
    )
      .then((leagues) => {
        if (cancelled) return
        setLeaguesData(leagues)

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
              label: rivalry?.label || '注目カード',
              background: rivalry?.background || ''
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
          leaguePath={selectedTeam.leaguePath}
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
  const titleFights = (boxingData.fights || []).filter((f) => f.date >= today && /王座|統一/.test(f.cardName))

  const soccerRaces = (leaguesData || [])
    .filter((l) => l.sportPath === 'soccer' && l.leaguePath !== 'uefa.champions')
    .map((l) => {
      const race = computeSoccerRace(l.standings?.[0]?.rows)
      return race ? { ...race, leagueName: l.leagueName, sportPath: l.sportPath, leaguePath: l.leaguePath } : null
    })
    .filter(Boolean)

  const mlbDays = milestones?.mlb ? (milestones.mlb.inPostseason ? null : daysUntil(milestones.mlb.postseasonStart)) : null
  const nbaMilestone = milestones?.nba?.nextMilestone
  const nbaDays = nbaMilestone ? daysUntil(nbaMilestone.startDate) : null
  const nbaLabel = nbaMilestone?.type === 3 ? 'プレーオフ開幕' : nbaMilestone?.type === 2 ? 'レギュラーシーズン開幕' : null

  // 推しチーム: 現在の成績・次の試合を、既にホームで取得済みのleaguesDataから拾う
  const favTeamsWithData = favoriteTeams.map((t) => {
    const league = (leaguesData || []).find((l) => l.sportPath === t.sportPath && l.leaguePath === t.leaguePath)
    const row = league?.standings?.flatMap((g) => g.rows).find((r) => r.id === t.teamId)
    const nextGame = (league?.games || [])
      .filter((g) => !g.isFinal && (g.home.id === t.teamId || g.away.id === t.teamId))
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0]
    return { ...t, row, nextGame }
  })

  // 推し選手: 名前が見出し/要約に含まれるニュースを拾う(注目ニュースの範囲内なので網羅的ではない)。
  // ボクシングの選手はチームが無いので、代わりにboxingSchedule.jsonから次の試合を探す。
  const favPlayersWithNews = favoritePlayers.map((p) => {
    const relatedNews = (news || []).filter((a) => (a.headline || '').includes(p.name) || (a.description || '').includes(p.name))
    const nextFight =
      p.sportPath === 'boxing'
        ? (boxingData.fights || []).find((f) => f.date >= today && (f.fighters || []).includes(p.name))
        : null
    const profile = p.sportPath === 'boxing' ? boxerProfiles.boxers.find((b) => b.name === p.name) || null : null
    return { ...p, relatedNews, nextFight, profile, stats: playerStats[p.playerId] || null }
  })

  const notableTeaser =
    notableGames && notableGames.length > 0
      ? `${notableGames[0].label}${notableGames.length > 1 ? ` ほか${notableGames.length - 1}件` : ''}`
      : notableGames
        ? '今週は注目カードなし'
        : 'よみこみちゅう…'

  const championshipTeaser =
    milestones?.mlb?.inPostseason
      ? 'MLBはポストシーズン開催中！'
      : mlbDays !== null
        ? `MLBポストシーズンまであと${mlbDays}日`
        : milestones
          ? ''
          : 'よみこみちゅう…'

  function toggle(section) {
    setExpanded((prev) => (prev === section ? null : section))
  }

  return (
    <div className="home-view">
      {error && <p className="error-text">{error}</p>}

      <section className="home-section">
        <h2 className="home-section-title">⭐ 推し</h2>
        {favTeamsWithData.length === 0 && favPlayersWithNews.length === 0 ? (
          <p className="oshi-empty-hint">チームや選手のページで☆をタップすると、ここに表示されます</p>
        ) : (
          <>
            {favTeamsWithData.length > 0 && (
              <div className="oshi-teams-row">
                {favTeamsWithData.map((t) => (
                  <button
                    key={`${t.sportPath}-${t.teamId}`}
                    type="button"
                    className="oshi-team-card"
                    onClick={() => openTeam(t.sportPath, t.leaguePath, t.teamId)}
                  >
                    {t.logo && <img className="team-logo" src={t.logo} alt="" />}
                    <span className="oshi-team-name">{t.name}</span>
                    {t.row && (
                      <span className="oshi-team-record">
                        {t.sportPath === 'soccer' ? `勝点${t.row.points}` : `${t.row.wins}勝${t.row.losses}敗`}
                      </span>
                    )}
                    {t.nextGame && <span className="oshi-team-next">次戦 {formatDate(t.nextGame.date)}</span>}
                  </button>
                ))}
              </div>
            )}
            {favPlayersWithNews.length > 0 && (
              <div className="oshi-players-row">
                {favPlayersWithNews.map((p) => {
                  const isBoxer = p.sportPath === 'boxing'
                  const Tag = isBoxer ? 'div' : 'button'
                  return (
                    <Tag
                      key={`${p.sportPath}-${p.playerId}`}
                      type={isBoxer ? undefined : 'button'}
                      className="oshi-player-card"
                      onClick={isBoxer ? undefined : () => openTeam(p.sportPath, p.leaguePath, p.teamId)}
                    >
                      {p.headshot || p.teamLogo ? (
                        <img className="oshi-player-avatar" src={p.headshot || p.teamLogo} alt="" />
                      ) : (
                        <div className="oshi-player-avatar oshi-player-avatar-fallback">🥊</div>
                      )}
                      <div className="oshi-player-name">{p.name}</div>
                      <div className="oshi-player-meta">
                        {isBoxer
                          ? p.nextFight
                            ? `次戦 ${formatDate(p.nextFight.date)}`
                            : '次戦未定'
                          : `${p.teamName} ${p.jersey && `#${p.jersey}`} ${p.position}`}
                      </div>
                      {p.profile && <div className="oshi-player-news">{p.profile.titles} ・ {p.profile.record}</div>}
                      {p.stats && (
                        <div className="roster-card-stats">
                          {Object.entries(p.stats.values).map(([label, value]) => (
                            <span key={label}>
                              {value}
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.relatedNews.length > 0 && (
                        <div className="oshi-player-news">📰 {p.relatedNews[0].headlineJa || p.relatedNews[0].headline}</div>
                      )}
                    </Tag>
                  )
                })}
              </div>
            )}
          </>
        )}
      </section>

      <div className="digest-row">
        <button type="button" className={`digest-tile ${expanded === 'notable' ? 'is-active' : ''}`} onClick={() => toggle('notable')}>
          <div className="digest-tile-title">📅 今週の注目カード</div>
          <div className="digest-tile-teaser">{notableTeaser}</div>
        </button>
        <button
          type="button"
          className={`digest-tile ${expanded === 'championship' ? 'is-active' : ''}`}
          onClick={() => toggle('championship')}
        >
          <div className="digest-tile-title">🏆 チャンピオンへの道</div>
          <div className="digest-tile-teaser">{championshipTeaser}</div>
        </button>
      </div>

      {expanded === 'notable' && notableGames && notableGames.length > 0 && (
        <section className="home-section">
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
                {g.background && <div className="notable-game-background">{g.background}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {expanded === 'championship' && (
        <section className="home-section">
          <div className="home-subsection-title">プレーオフまで</div>
          <div className="playoff-countdown-row">
            <div className="playoff-countdown-card">
              <div className="playoff-countdown-sport">⚾ MLB</div>
              {milestones?.mlb?.inPostseason ? (
                <div className="playoff-countdown-days">ポストシーズン開催中！</div>
              ) : mlbDays !== null ? (
                <div className="playoff-countdown-days">
                  ポストシーズンまで <span className="col-strong">あと{mlbDays}日</span>
                </div>
              ) : (
                <div className="muted">よみこみちゅう…</div>
              )}
              <ul className="playoff-format-list">
                {mlbPlayoffFormat.rounds.map((r) => (
                  <li key={r.name}>
                    {r.name}: {r.format}
                  </li>
                ))}
              </ul>
              <div className="playoff-format-tip">{mlbPlayoffFormat.tip}</div>
            </div>

            <div className="playoff-countdown-card">
              <div className="playoff-countdown-sport">🏀 NBA</div>
              {nbaDays !== null ? (
                <div className="playoff-countdown-days">
                  {nbaLabel}まで <span className="col-strong">あと{nbaDays}日</span>
                </div>
              ) : (
                <div className="muted">よみこみちゅう…</div>
              )}
              <ul className="playoff-format-list">
                {nbaPlayoffFormat.rounds.map((r) => (
                  <li key={r.name}>
                    {r.name}: {r.format}
                  </li>
                ))}
              </ul>
              <div className="playoff-format-tip">{nbaPlayoffFormat.tip}</div>
            </div>
          </div>

          {soccerRaces.length > 0 && (
            <>
              <div className="home-subsection-title">⚽ 優勝争い・残留争い</div>
              <div className="race-row">
                {soccerRaces.map((r) => (
                  <div key={r.leaguePath} className="race-card">
                    <div className="race-card-league">{r.leagueName}</div>
                    <div className="race-card-line">
                      <span className="race-card-label">首位</span>
                      {r.leader.logo && <img className="team-logo" src={r.leader.logo} alt="" />}
                      <span>{r.leader.team}</span>
                      {r.titleGap !== null && (
                        <span className="race-card-gap">{r.titleGap === 0 ? '(2位と同勝点)' : `(2位と${r.titleGap}差)`}</span>
                      )}
                    </div>
                    {r.relegationGap !== null && (
                      <div className="race-card-line">
                        <span className="race-card-label">残留争い</span>
                        <span>ボーダーとの差 {r.relegationGap}pt</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {titleFights.length > 0 && (
            <>
              <div className="home-subsection-title">🥊 王座統一戦とは</div>
              <div className="title-explainer-card">
                <div>{boxingTitleSystem.explanation}</div>
                <div className="playoff-format-tip">{boxingTitleSystem.tip}</div>
                <div className="title-fights-list">
                  {titleFights.map((f, i) => (
                    <div key={i} className="title-fight-row">
                      {formatDate(f.date)} ・ {f.cardName}
                    </div>
                  ))}
                </div>
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
                  <div className="news-card-headline">{a.headlineJa || a.headline}</div>
                  <div className="news-card-desc">{a.descriptionJa || a.description}</div>
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
