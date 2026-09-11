import { useEffect, useState } from 'react'
import { getTeamDetail, getNews } from '../services/espn.js'
import { isFavoriteTeam, toggleFavoriteTeam, isFavoritePlayer, toggleFavoritePlayer } from '../utils/favorites.js'

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

// チーム名の最後の単語(愛称・略称であることが多い: "Los Angeles Dodgers"→"Dodgers")で
// ニュースの見出し/要約に含まれるかを判定する。フルネームだと一致しないニュースが多いため。
function teamNewsKeyword(teamName) {
  const words = (teamName || '').trim().split(/\s+/)
  return words[words.length - 1] || teamName
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
  const [news, setNews] = useState(null)

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
    getNews()
      .then((d) => !cancelled && setNews(d.articles))
      .catch((err) => console.warn('[TeamDetail] news load failed', err)) // 無くても致命的ではない
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

  // このチームに関連しそうなニュース(注目ニュースの中から、愛称が見出し/要約に含まれるものを検索)
  const teamKeyword = teamNewsKeyword(teamName)
  const teamNews = teamKeyword
    ? (news || []).filter((a) => (a.headline || '').includes(teamKeyword) || (a.description || '').includes(teamKeyword))
    : []

  // 推し選手(このチームの中で☆登録済み)に関連するニュース
  const favPlayers = (detail?.roster || []).filter((p) => favPlayerIds.includes(p.id))
  const favPlayerNews = favPlayers.map((p) => ({
    player: p,
    items: (news || []).filter((a) => (a.headline || '').includes(p.name) || (a.description || '').includes(p.name))
  }))

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

      {favPlayerNews.some((f) => f.items.length > 0) && (
        <>
          <div className="team-detail-section-title">⭐ 推し選手の関連ニュース</div>
          <div className="news-list news-list-compact">
            {favPlayerNews
              .filter((f) => f.items.length > 0)
              .flatMap((f) => f.items.slice(0, 2).map((a) => ({ ...a, playerName: f.player.name })))
              .map((a) => (
                <a key={`${a.playerName}-${a.id}`} className="news-card news-card-compact" href={a.link} target="_blank" rel="noreferrer">
                  {a.image && <img className="news-card-image" src={a.image} alt="" />}
                  <div className="news-card-body">
                    <div className="news-card-tag">{a.playerName}</div>
                    <div className="news-card-headline">{a.headlineJa || a.headline}</div>
                    <div className="news-card-time">{timeAgo(a.published)}</div>
                  </div>
                </a>
              ))}
          </div>
        </>
      )}

      {teamNews.length > 0 && (
        <>
          <div className="team-detail-section-title">📰 チーム関連ニュース</div>
          <div className="news-list news-list-compact">
            {teamNews.slice(0, 4).map((a) => (
              <a key={a.id} className="news-card news-card-compact" href={a.link} target="_blank" rel="noreferrer">
                {a.image && <img className="news-card-image" src={a.image} alt="" />}
                <div className="news-card-body">
                  <div className="news-card-headline">{a.headlineJa || a.headline}</div>
                  <div className="news-card-time">{timeAgo(a.published)}</div>
                </div>
              </a>
            ))}
          </div>
        </>
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
