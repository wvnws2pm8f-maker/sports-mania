import { useEffect, useState } from 'react'
import { getNews, getStandings, getScoreboard, getSeasonMilestones, getTeamDetail } from '../services/espn.js'
import { allLeagueTargets } from '../data/leagues.js'
import { rivalries } from '../data/rivalries.js'
import { mlbPlayoffFormat, nbaPlayoffFormat, boxingTitleSystem, uclFormat } from '../data/championshipInfo.js'
import { getFavoriteTeams, getFavoritePlayers, getFavoriteGames } from '../utils/favorites.js'
import boxingData from '../data/boxingSchedule.json'
import boxerProfiles from '../data/boxerProfiles.json'
import TeamDetail from './TeamDetail.jsx'
import SearchLinks from './SearchLinks.jsx'

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
  // 推し選手カードをタップした時に、その場で詳細(全成績・全ニュース・検索リンク等)を展開する。
  // 以前はボクサーのカードはタップしても何も起きず、選手カードはチームページに飛ぶだけで
  // 選手個人の詳細が見えなかった(ユーザー報告により発覚、2026-09-11)。
  const [expandedPlayerKey, setExpandedPlayerKey] = useState(null) // `${sportPath}-${playerId}` | null
  // 「見出し・要約しか翻訳されず全文が読めない」との要望(2026-09-18)で、ニュースカードを
  // タップするとその場で全文(翻訳できていれば日本語、できていなければ原文英語)を
  // 展開できるようにした。
  const [expandedNewsId, setExpandedNewsId] = useState(null)
  // 推し(お気に入り)チーム・選手。ログイン機能が無いためこの端末のlocalStorageに保存されている。
  // 他のページ(TeamDetail)で☆を付けて戻ってくるとHomeViewが再マウントされるので、
  // マウント時に読み直せば最新の状態になる。
  const [favoriteTeams] = useState(() => getFavoriteTeams())
  const [favoritePlayers] = useState(() => getFavoritePlayers())
  const [favoriteGames] = useState(() => getFavoriteGames())
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

  // チャンピオンズリーグは降格が無い単一リーグ表(新方式)なので、優勝争い/残留争いではなく
  // 現在の暫定順位(直接ラウンド16=1〜8位、プレーオフ圏=9〜24位、敗退圏=25位以下)を見せる
  const uclLeague = (leaguesData || []).find((l) => l.sportPath === 'soccer' && l.leaguePath === 'uefa.champions')
  const uclTopRows = uclLeague?.standings?.[0]?.rows?.slice(0, 8) || []

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
    const lastResult =
      p.sportPath === 'boxing'
        ? [...(boxingData.results || [])].reverse().find((r) => (r.fighters || []).includes(p.name))
        : null
    const profile = p.sportPath === 'boxing' ? boxerProfiles.boxers.find((b) => b.name === p.name) || null : null
    // 選手個人の「次の試合」はチームの次戦と同じ(ボクシング以外)。推しチームには入れていない
    // 選手だけ推し登録しているケースをカバーするため、ここでもチームの次戦を拾っておく。
    const league =
      p.sportPath !== 'boxing' ? (leaguesData || []).find((l) => l.sportPath === p.sportPath && l.leaguePath === p.leaguePath) : null
    const nextGame =
      p.sportPath !== 'boxing'
        ? (league?.games || [])
            .filter((g) => !g.isFinal && (g.home.id === p.teamId || g.away.id === p.teamId))
            .sort((a, b) => new Date(a.date) - new Date(b.date))[0]
        : null
    return { ...p, relatedNews, nextFight, nextGame, lastResult, profile, stats: playerStats[p.playerId] || null }
  })

  // 「見逃したくない試合」: 推しチーム・推し選手(のチーム)・推しボクサーの次の試合/試合を
  // 1つのリストにまとめ、開催が近い順に並べて日数カウントダウン付きで見せる
  // (2026-09-15、「アナウンス・あと何日か、をホームに欲しい」との要望で追加)。
  const myUpcomingEventsMap = new Map() // key(sportPath-teamId or boxer-name) -> event
  for (const t of favTeamsWithData) {
    if (!t.nextGame) continue
    const isHome = t.nextGame.home.id === t.teamId
    const opponent = isHome ? t.nextGame.away : t.nextGame.home
    myUpcomingEventsMap.set(`team-${t.sportPath}-${t.teamId}`, {
      key: `team-${t.sportPath}-${t.teamId}`,
      kind: 'team',
      logo: t.logo,
      title: t.name,
      description: `${isHome ? 'vs' : '@'} ${opponent.team}`,
      date: t.nextGame.date,
      sportPath: t.sportPath,
      leaguePath: t.leaguePath,
      teamId: t.teamId
    })
  }
  for (const p of favPlayersWithNews) {
    if (p.sportPath === 'boxing') {
      if (!p.nextFight) continue
      myUpcomingEventsMap.set(`boxer-${p.name}`, {
        key: `boxer-${p.name}`,
        kind: 'boxer',
        logo: p.headshot,
        title: p.name,
        description: p.nextFight.cardName,
        date: p.nextFight.date
      })
    } else {
      if (!p.nextGame) continue
      const teamKey = `team-${p.sportPath}-${p.teamId}`
      if (myUpcomingEventsMap.has(teamKey)) continue // 同じチームを既に推し登録していれば重複させない
      const isHome = p.nextGame.home.id === p.teamId
      const opponent = isHome ? p.nextGame.away : p.nextGame.home
      myUpcomingEventsMap.set(`player-${p.sportPath}-${p.playerId}`, {
        key: `player-${p.sportPath}-${p.playerId}`,
        kind: 'player',
        logo: p.headshot || p.teamLogo,
        title: `${p.name}(${p.teamName})`,
        description: `${isHome ? 'vs' : '@'} ${opponent.team}`,
        date: p.nextGame.date,
        sportPath: p.sportPath,
        leaguePath: p.leaguePath,
        teamId: p.teamId
      })
    }
  }
  // 推しチーム/推し選手に関係なく個別にピン留めした試合(GameListの☆ボタンから登録)。
  // 終了済みのものはリストが際限なく伸びないよう表示から外す(登録自体は残るので、
  // 再度その試合が一覧に出た時に☆を消せば完全に削除できる)。
  for (const g of favoriteGames) {
    if (new Date(g.date).getTime() < Date.now() - 24 * 60 * 60 * 1000) continue
    myUpcomingEventsMap.set(`game-${g.sportPath}-${g.gameId}`, {
      key: `game-${g.sportPath}-${g.gameId}`,
      kind: 'game',
      awayLogo: g.away.logo,
      homeLogo: g.home.logo,
      title: `${g.away.team} vs ${g.home.team}`,
      description: '',
      date: g.date
    })
  }

  const myUpcomingEvents = [...myUpcomingEventsMap.values()].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 6)

  function countdownLabel(iso) {
    const d = daysUntil(iso)
    if (d === 0) return '今日!'
    if (d === 1) return '明日'
    return `あと${d}日`
  }

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
                  const key = `${p.sportPath}-${p.playerId}`
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`oshi-player-card ${expandedPlayerKey === key ? 'is-active' : ''}`}
                      onClick={() => setExpandedPlayerKey((prev) => (prev === key ? null : key))}
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
                      {p.profile?.recentUpdate && <div className="oshi-player-news">📰 {p.profile.recentUpdate.summary}</div>}
                      {p.profile && !p.profile.recentUpdate && (
                        <div className="oshi-player-news">
                          {p.profile.titles} ・ {p.profile.record}
                        </div>
                      )}
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
                      <div className="oshi-player-tap-hint">{expandedPlayerKey === key ? '▲ とじる' : '▼ もっと見る'}</div>
                    </button>
                  )
                })}
              </div>
            )}

            {expandedPlayerKey &&
              (() => {
                const p = favPlayersWithNews.find((x) => `${x.sportPath}-${x.playerId}` === expandedPlayerKey)
                if (!p) return null
                const isBoxer = p.sportPath === 'boxing'
                return (
                  <div className="oshi-player-detail">
                    <div className="oshi-player-detail-header">
                      {p.headshot || p.teamLogo ? (
                        <img className="oshi-player-avatar" src={p.headshot || p.teamLogo} alt="" />
                      ) : (
                        <div className="oshi-player-avatar oshi-player-avatar-fallback">🥊</div>
                      )}
                      <div>
                        <div className="oshi-player-detail-name">{p.name}</div>
                        <div className="oshi-player-meta">
                          {isBoxer ? 'ボクシング' : `${p.teamName} ${p.jersey && `#${p.jersey}`} ${p.position}`}
                        </div>
                      </div>
                    </div>

                    {isBoxer ? (
                      <>
                        {p.profile ? (
                          <>
                            <div className="boxer-profile-line">
                              {p.profile.weightClass} ・ {p.profile.titles}
                            </div>
                            <div className="boxer-profile-line col-strong">{p.profile.record}</div>
                            <div className="boxer-profile-note">{p.profile.note}</div>
                            {p.profile.recentUpdate && (
                              <div className="boxer-profile-recent">
                                <span className="boxer-profile-recent-tag">最近の動向({p.profile.recentUpdate.checkedAt}確認)</span>
                                <div>{p.profile.recentUpdate.summary}</div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="muted">プロフィール未登録です。「{p.name}のプロフィールを追加して」と頼んでもらえれば調べて追加します。</p>
                        )}
                        {p.nextFight ? (
                          <div className="boxer-profile-line">
                            📅 次戦: {formatDate(p.nextFight.date)} {p.nextFight.cardName}
                            {p.nextFight.venue && <> ・ 📍 {p.nextFight.venue}</>}
                          </div>
                        ) : (
                          <p className="muted">次戦は未発表です</p>
                        )}
                        {p.lastResult && (
                          <div className="boxer-profile-line">
                            🏆 前戦: {formatDate(p.lastResult.date)} {p.lastResult.winner}が{p.lastResult.method}で勝利
                          </div>
                        )}
                        <SearchLinks name={p.name} />
                      </>
                    ) : (
                      <>
                        {p.stats ? (
                          <div className="roster-card-stats">
                            {Object.entries(p.stats.values).map(([label, value]) => (
                              <span key={label}>
                                {value}
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="muted">個人成績は未取得です(次回のデータ更新をお待ちください)</p>
                        )}
                        {p.relatedNews.length > 0 ? (
                          <div className="oshi-player-detail-news-list">
                            {p.relatedNews.map((a) => (
                              <a key={a.id} className="news-card" href={a.link} target="_blank" rel="noreferrer">
                                <div className="news-card-body">
                                  <div className="news-card-headline">{a.headlineJa || a.headline}</div>
                                  <div className="news-card-time">{timeAgo(a.published)}</div>
                                </div>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="muted">現在、この選手に直接関する注目ニュースはありません(チームのニュースはチームページで確認できます)</p>
                        )}
                        <SearchLinks name={p.name} />
                        <button
                          type="button"
                          className="oshi-player-detail-team-link"
                          onClick={() => openTeam(p.sportPath, p.leaguePath, p.teamId)}
                        >
                          {p.teamName || 'チーム'}のページを見る →
                        </button>
                      </>
                    )}
                  </div>
                )
              })()}
          </>
        )}
      </section>

      {myUpcomingEvents.length > 0 && (
        <section className="home-section">
          <h2 className="home-section-title">📅 見逃せない試合</h2>
          <div className="upcoming-event-list">
            {myUpcomingEvents.map((ev) => {
              const isSoon = daysUntil(ev.date) <= 1
              // 個別にピン留めした試合(kind: 'game')はどちらのチームのページに飛ぶべきか
              // 決め打てないため、他の推しカードと違いタップ不可の情報表示のみにする
              const isInteractive = ev.kind === 'team' || ev.kind === 'player'
              const Tag = isInteractive ? 'button' : 'div'
              return (
                <Tag
                  key={ev.key}
                  type={isInteractive ? 'button' : undefined}
                  className="upcoming-event-card"
                  onClick={isInteractive ? () => openTeam(ev.sportPath, ev.leaguePath, ev.teamId) : undefined}
                >
                  {ev.kind === 'game' && (ev.awayLogo || ev.homeLogo) ? (
                    <div className="upcoming-event-logo-pair">
                      {ev.awayLogo && <img className="upcoming-event-logo upcoming-event-logo-small" src={ev.awayLogo} alt="" />}
                      {ev.homeLogo && <img className="upcoming-event-logo upcoming-event-logo-small" src={ev.homeLogo} alt="" />}
                    </div>
                  ) : ev.kind === 'game' ? (
                    // ボクシングのピン留め(ロゴが無い)はフォールバック絵文字にする
                    <div className="upcoming-event-logo upcoming-event-logo-fallback">🥊</div>
                  ) : ev.logo ? (
                    <img className="upcoming-event-logo" src={ev.logo} alt="" />
                  ) : (
                    <div className="upcoming-event-logo upcoming-event-logo-fallback">🥊</div>
                  )}
                  <div className="upcoming-event-body">
                    <div className="upcoming-event-title">{ev.title}</div>
                    {ev.description && <div className="upcoming-event-desc">{ev.description}</div>}
                    <div className="upcoming-event-date">{formatDate(ev.date)}</div>
                  </div>
                  <div className={`upcoming-event-countdown ${isSoon ? 'is-soon' : ''}`}>{countdownLabel(ev.date)}</div>
                </Tag>
              )
            })}
          </div>
        </section>
      )}

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

          {uclTopRows.length > 0 && (
            <>
              <div className="home-subsection-title">⚽ チャンピオンズリーグとは</div>
              <div className="title-explainer-card">
                <ul className="playoff-format-list">
                  {uclFormat.rounds.map((r) => (
                    <li key={r.name}>
                      {r.name}: {r.format}
                    </li>
                  ))}
                </ul>
                <div className="playoff-format-tip">{uclFormat.tip}</div>
                <div className="home-subsection-title">現在の暫定順位(1〜8位・ラウンド16直接進出圏)</div>
                <div className="ucl-standings-mini">
                  {uclTopRows.map((r, i) => (
                    <div key={r.id} className="ucl-standings-mini-row">
                      <span className="col-rank">{i + 1}</span>
                      {r.logo && <img className="team-logo" src={r.logo} alt="" />}
                      <span className="ucl-standings-mini-team">{r.team}</span>
                      <span className="col-strong">{r.points}pt</span>
                    </div>
                  ))}
                </div>
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
            {news.map((a) => {
              const isExpanded = expandedNewsId === a.id
              const bodyText = a.bodyJa || a.body
              return (
                <div key={a.id} className="news-card-container">
                  <button
                    type="button"
                    className="news-card-tap-area"
                    onClick={() => setExpandedNewsId((prev) => (prev === a.id ? null : a.id))}
                  >
                    {a.image && <img className="news-card-image" src={a.image} alt="" />}
                    <div className="news-card-body">
                      <div className="news-card-headline">{a.headlineJa || a.headline}</div>
                      <div className="news-card-desc">{a.descriptionJa || a.description}</div>
                      <div className="news-card-time">
                        {timeAgo(a.published)}
                        {bodyText && (isExpanded ? ' ・ ▲ とじる' : ' ・ ▼ 全文を読む')}
                      </div>
                    </div>
                  </button>
                  {isExpanded && bodyText && (
                    <div className="news-card-full-body">
                      {/* 本文は見出しと違ってAI翻訳しない(Geminiのクォータが不安定なため、
                          2026-09-23に見出しのみの翻訳へ変更)。原文(英語)のまま表示し、
                          読みたい人には端末側の翻訳機能(Safari/iPhoneの「翻訳」機能等)を
                          案内する。 */}
                      {!a.bodyJa && (
                        <div className="news-card-untranslated-note">
                          ※ 本文は原文(英語)です。Safari右上の「aA」→「日本語に翻訳」等、端末の翻訳機能でお読みください
                        </div>
                      )}
                      {bodyText.split('\n\n').map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                      <a className="news-card-original-link" href={a.link} target="_blank" rel="noreferrer">
                        元記事(ESPN)を見る ↗
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
