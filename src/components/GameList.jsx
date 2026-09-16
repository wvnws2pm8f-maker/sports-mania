import { useState } from 'react'
import { highlightSearchUrl } from '../utils/highlightLink.js'
import { isFavoriteGame, toggleFavoriteGame } from '../utils/favorites.js'

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 推しチーム/推し選手に関係なく、この1試合だけを「見逃したくない試合」として
// ピン留めできる☆ボタン(2026-09-16の要望)。sportPath/leaguePathが無い場合(呼び出し側が
// 未対応)は無言でボタンを出さない。
function FavoriteGameStar({ g, sportPath, leaguePath }) {
  const [fav, setFav] = useState(() => isFavoriteGame(sportPath, g.id))
  if (!sportPath) return null
  return (
    <button
      type="button"
      className={`favorite-star favorite-star-small game-card-star ${fav ? 'is-active' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setFav(
          toggleFavoriteGame({
            sportPath,
            leaguePath,
            gameId: g.id,
            date: g.date,
            home: { id: g.home.id, team: g.home.team, logo: g.home.logo },
            away: { id: g.away.id, team: g.away.team, logo: g.away.logo }
          })
        )
      }}
      aria-label="見逃せない試合に登録"
    >
      {fav ? '★' : '☆'}
    </button>
  )
}

export default function GameList({ games, sportPath, leaguePath }) {
  if (!games || games.length === 0) {
    return <p className="muted">この期間の試合はありません</p>
  }

  return (
    <div className="game-list">
      {games.map((g) => (
        <div key={g.id} className={`game-card ${g.isLive ? 'is-live' : ''}`}>
          <div className="game-card-status">
            {g.isLive && <span className="live-badge">LIVE</span>}
            <span>{g.isFinal || g.isLive ? g.statusDetail : formatDate(g.date)}</span>
            <FavoriteGameStar g={g} sportPath={sportPath} leaguePath={leaguePath} />
          </div>
          {/* プレーオフ中、ESPNが対戦カードに付けてくる"シリーズ何勝何敗か"の情報。
              レギュラーシーズン中はg.seriesがnullなので何も表示されない */}
          {g.series?.summary && <div className="game-card-series">🏆 {g.series.title ? `${g.series.title} ・ ` : ''}{g.series.summary}</div>}
          <div className="game-card-row">
            <div className="game-card-team">
              {g.away.logo && <img className="team-logo" src={g.away.logo} alt="" />}
              <span>{g.away.team}</span>
            </div>
            <span className="game-card-score">{g.away.score}</span>
          </div>
          <div className="game-card-row">
            <div className="game-card-team">
              {g.home.logo && <img className="team-logo" src={g.home.logo} alt="" />}
              <span>{g.home.team}</span>
            </div>
            <span className="game-card-score">{g.home.score}</span>
          </div>
          {g.isFinal && (
            <a
              className="highlight-link"
              href={highlightSearchUrl(`${g.away.team} vs ${g.home.team} highlights`)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              🎥 ハイライトを見る
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
