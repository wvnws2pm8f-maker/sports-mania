import { useEffect, useState } from 'react'
import { getTeamDetail } from '../services/espn.js'
import { isFavoriteTeam, toggleFavoriteTeam, isFavoritePlayer, toggleFavoritePlayer } from '../utils/favorites.js'

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`
}

// 選手の顔写真。無い/読み込み失敗(主にサッカー・一部のマイナー選手)はチームロゴで代用する。
function PlayerAvatar({ headshot, teamLogo, name }) {
  const [failed, setFailed] = useState(false)
  const src = !failed && headshot ? headshot : teamLogo
  return <img className="player-avatar" src={src} alt={name} onError={() => setFailed(true)} />
}

// standingsRow: このチームのStandingsTable用データ(順位表に既にある。無ければnull)
// games: 現在表示中リーグの全試合(SportPanelで既に取得済みのものを渡す。チームIDで絞り込む)
export default function TeamDetail({ sportPath, leaguePath, teamId, standingsRow, games, onBack }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [teamFav, setTeamFav] = useState(false)
  const [favPlayerIds, setFavPlayerIds] = useState([])

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    setTeamFav(isFavoriteTeam(sportPath, teamId))
    getTeamDetail(sportPath, teamId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setFavPlayerIds(d.roster.filter((p) => isFavoritePlayer(sportPath, p.id)).map((p) => p.id))
        }
      })
      .catch((err) => {
        console.warn('[TeamDetail] load failed', err)
        if (!cancelled) setError('選手情報を取得できませんでした。')
      })
    return () => {
      cancelled = true
    }
  }, [sportPath, teamId])

  const teamGames = (games || [])
    .filter((g) => g.home.id === teamId || g.away.id === teamId)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  const isSoccerStyle = sportPath === 'soccer'
  const teamName = detail?.team?.name || standingsRow?.team || ''
  const teamLogo = detail?.team?.logo || standingsRow?.logo || ''

  function handleToggleTeam() {
    const nowFav = toggleFavoriteTeam({ sportPath, leaguePath, teamId, name: teamName, logo: teamLogo })
    setTeamFav(nowFav)
  }

  function handleTogglePlayer(p) {
    const nowFav = toggleFavoritePlayer({
      sportPath,
      leaguePath,
      teamId,
      playerId: p.id,
      name: p.name,
      jersey: p.jersey,
      position: p.position,
      headshot: p.headshot,
      teamName,
      teamLogo
    })
    setFavPlayerIds((prev) => (nowFav ? [...prev, p.id] : prev.filter((id) => id !== p.id)))
  }

  return (
    <div className="team-detail">
      <button type="button" className="back-button" onClick={onBack}>
        ← 戻る
      </button>

      <div className="team-detail-header">
        {teamLogo && <img className="team-detail-logo" src={teamLogo} alt="" />}
        <div className="team-detail-title">{teamName}</div>
        <button type="button" className={`favorite-star ${teamFav ? 'is-active' : ''}`} onClick={handleToggleTeam} aria-label="推しチームに登録">
          {teamFav ? '★' : '☆'}
        </button>
      </div>

      {standingsRow && (
        <div className="team-detail-record">
          {isSoccerStyle ? (
            <>
              <span>{standingsRow.gamesPlayed}試合</span>
              <span>{standingsRow.wins}勝{standingsRow.ties}分{standingsRow.losses}敗</span>
              <span>得失点 {standingsRow.goalDiff}</span>
              <span className="col-strong">勝点 {standingsRow.points}</span>
            </>
          ) : (
            <>
              <span>{standingsRow.wins}勝{standingsRow.losses}敗</span>
              <span>勝率 {standingsRow.winPercent}</span>
              <span>{standingsRow.streak}</span>
            </>
          )}
        </div>
      )}

      <div className="team-detail-section-title">直近・予定の試合</div>
      {teamGames.length === 0 ? (
        <p className="muted">この期間の試合はありません</p>
      ) : (
        <div className="team-games-list">
          {teamGames.map((g) => {
            const isHome = g.home.id === teamId
            const opponent = isHome ? g.away : g.home
            const selfSide = isHome ? g.home : g.away
            return (
              <div key={g.id} className={`team-game-row ${g.isLive ? 'is-live' : ''}`}>
                <span className="team-game-date">{g.isFinal || g.isLive ? g.statusDetail : formatDate(g.date)}</span>
                <span>{isHome ? 'vs' : '@'}</span>
                {opponent.logo && <img className="team-logo" src={opponent.logo} alt="" />}
                <span className="team-game-opponent">{opponent.team}</span>
                {(g.isFinal || g.isLive) && (
                  <span className="team-game-score">
                    {selfSide.score}-{opponent.score}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="team-detail-section-title">ロスター</div>
      {error && <p className="error-text">{error}</p>}
      {!error && !detail && <p className="muted">よみこみちゅう…</p>}
      {!error && detail && (
        <div className="roster-grid">
          {detail.roster.map((p) => {
            const isFav = favPlayerIds.includes(p.id)
            return (
              <div key={p.id} className="roster-card">
                <div className="roster-card-avatar-wrap">
                  <PlayerAvatar headshot={p.headshot} teamLogo={teamLogo} name={p.name} />
                  <button
                    type="button"
                    className={`favorite-star favorite-star-small ${isFav ? 'is-active' : ''}`}
                    onClick={() => handleTogglePlayer(p)}
                    aria-label="推し選手に登録"
                  >
                    {isFav ? '★' : '☆'}
                  </button>
                </div>
                <div className="roster-card-name">{p.name}</div>
                <div className="roster-card-meta">
                  {p.jersey && <span>#{p.jersey}</span>}
                  {p.position && <span>{p.position}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
