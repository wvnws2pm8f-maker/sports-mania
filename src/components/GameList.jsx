import { useState } from 'react'
import { highlightSearchUrl } from '../utils/highlightLink.js'
import { isFavoriteGame, toggleFavoriteGame } from '../utils/favorites.js'

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dateKey(iso) {
  // 現地時刻ではなくJSTの日付単位でまとめる(試合時刻がUTC深夜=JST午前になるカードが多いため、
  // 単純にISO文字列の先頭10文字で切ると同じ試合日のカードが別の日付タブに分かれてしまう)
  const d = new Date(iso)
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

function dateLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}/${d}(${w})`
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

// games: 日付範囲でまとめて取得した試合一覧(いつの試合か分かりにくいとの指摘、2026-09-17)。
// 日付ごとにタブを分け、既定では「今日」または直近の試合がある日を選んでおく。
// onSelectGame: 渡されていれば、終了した試合に「📋 試合詳細」ボタンを表示する
// (未終了の試合は得点者・出場選手などの詳細データがそもそも無いため対象外)。
export default function GameList({ games, sportPath, leaguePath, onSelectGame }) {
  const grouped = new Map()
  for (const g of games || []) {
    const key = dateKey(g.date)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(g)
  }
  const dateKeys = [...grouped.keys()].sort()

  const todayKey = dateKey(new Date().toISOString())
  const [selectedDate, setSelectedDate] = useState(() => {
    if (dateKeys.includes(todayKey)) return todayKey
    return dateKeys.find((k) => k >= todayKey) || dateKeys[dateKeys.length - 1] || null
  })

  if (!games || games.length === 0 || dateKeys.length === 0) {
    return <p className="muted">この期間の試合はありません</p>
  }

  const activeKey = dateKeys.includes(selectedDate) ? selectedDate : dateKeys[0]
  const activeIndex = dateKeys.indexOf(activeKey)
  const activeGames = grouped.get(activeKey) || []

  return (
    <div>
      <div className="week-picker-row">
        <button
          type="button"
          className="week-picker-arrow"
          disabled={activeIndex <= 0}
          onClick={() => setSelectedDate(dateKeys[Math.max(0, activeIndex - 1)])}
        >
          ←
        </button>
        <select className="week-picker-select" value={activeKey} onChange={(e) => setSelectedDate(e.target.value)}>
          {dateKeys.map((k) => (
            <option key={k} value={k}>
              {dateLabel(k)}
              {k === todayKey ? '(今日)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="week-picker-arrow"
          disabled={activeIndex >= dateKeys.length - 1}
          onClick={() => setSelectedDate(dateKeys[Math.min(dateKeys.length - 1, activeIndex + 1)])}
        >
          →
        </button>
      </div>

      <div className="game-list">
        {activeGames.map((g) => (
          <div key={g.id} className={`game-card ${g.isLive ? 'is-live' : ''}`}>
            <div className="game-card-status">
              {g.isLive && <span className="live-badge">LIVE</span>}
              <span>{g.isFinal || g.isLive ? g.statusDetail : formatDate(g.date)}</span>
              <FavoriteGameStar g={g} sportPath={sportPath} leaguePath={leaguePath} />
            </div>
            {/* プレーオフ中、ESPNが対戦カードに付けてくる"シリーズ何勝何敗か"の情報。
                レギュラーシーズン中はg.seriesがnullなので何も表示されない */}
            {g.series?.summary && (
              <div className="game-card-series">
                🏆 {g.series.title ? `${g.series.title} ・ ` : ''}
                {g.series.summary}
              </div>
            )}
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
              <div className="game-card-actions">
                {onSelectGame && (
                  <button type="button" className="game-detail-link" onClick={() => onSelectGame(g)}>
                    📋 試合詳細
                  </button>
                )}
                <a
                  className="highlight-link"
                  href={highlightSearchUrl(`${g.away.team} vs ${g.home.team} highlights`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  🎥 ハイライトを見る
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
