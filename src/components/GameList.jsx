import { useState } from 'react'
import { highlightSearchUrl } from '../utils/highlightLink.js'
import { isFavoriteGame, toggleFavoriteGame } from '../utils/favorites.js'
import { translateGameStatus } from '../utils/espnLabels.js'

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

// 「第N節」ラベルの日付部分用(節は複数日にまたがることが多いため、曜日は付けず月/日だけ)
function monthDay(iso) {
  const d = new Date(iso)
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`
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
// 既定ではタブを日付ごとに分けるが、サッカーは「日付だと見にくい、NFLの週別表示のように
// 第何節でまとめて欲しい」との要望(2026-09-22)を受け、scripts/fetch-soccer-rounds.mjsが
// 各試合に付与したg.round(節番号)があればそちらでグルーピングする。
// (ESPNのAPIには節番号の公式フィールドが無いため自前算出。詳細はそのスクリプトのコメント参照)
// 1件でもroundを持つ試合があれば節モードにする。roundを持たない試合(算出対象外の期間・
// 未対応競技など)は日付単位のグループにフォールバックし、節グループと混在させても
// 最小日時でソートするので表示順は崩れない。
// onSelectGame: 渡されていれば、終了した試合に「📋 試合詳細」ボタンを表示する
// (未終了の試合は得点者・出場選手などの詳細データがそもそも無いため対象外)。
export default function GameList({ games, sportPath, leaguePath, onSelectGame }) {
  const hasRounds = (games || []).some((g) => g.round != null)

  const grouped = new Map()
  for (const g of games || []) {
    const key = hasRounds && g.round != null ? `round-${g.round}` : `date-${dateKey(g.date)}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(g)
  }
  const groupKeys = [...grouped.keys()].sort((a, b) => {
    const da = Math.min(...grouped.get(a).map((g) => new Date(g.date).getTime()))
    const db = Math.min(...grouped.get(b).map((g) => new Date(g.date).getTime()))
    return da - db
  })

  function labelFor(key) {
    if (key.startsWith('round-')) {
      const round = key.slice('round-'.length)
      const days = [...new Set(grouped.get(key).map((g) => monthDay(g.date)))]
      const range = days.length > 1 ? `${days[0]}〜${days[days.length - 1]}` : days[0]
      return `第${round}節 (${range})`
    }
    return dateLabel(key.slice('date-'.length))
  }

  const todayDateKey = dateKey(new Date().toISOString())
  function containsToday(key) {
    return grouped.get(key).some((g) => dateKey(g.date) === todayDateKey)
  }

  const [selectedKey, setSelectedKey] = useState(() => {
    if (groupKeys.length === 0) return null
    const todayGroup = groupKeys.find(containsToday)
    if (todayGroup) return todayGroup
    const now = Date.now()
    const upcoming = groupKeys.find((k) => grouped.get(k).some((g) => new Date(g.date).getTime() >= now))
    return upcoming || groupKeys[groupKeys.length - 1]
  })

  if (!games || games.length === 0 || groupKeys.length === 0) {
    return <p className="muted">この期間の試合はありません</p>
  }

  const activeKey = groupKeys.includes(selectedKey) ? selectedKey : groupKeys[0]
  const activeIndex = groupKeys.indexOf(activeKey)
  const activeGames = grouped.get(activeKey) || []

  return (
    <div>
      <div className="week-picker-row">
        <button
          type="button"
          className="week-picker-arrow"
          disabled={activeIndex <= 0}
          onClick={() => setSelectedKey(groupKeys[Math.max(0, activeIndex - 1)])}
        >
          ←
        </button>
        <select className="week-picker-select" value={activeKey} onChange={(e) => setSelectedKey(e.target.value)}>
          {groupKeys.map((k) => (
            <option key={k} value={k}>
              {labelFor(k)}
              {containsToday(k) ? '(今日)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="week-picker-arrow"
          disabled={activeIndex >= groupKeys.length - 1}
          onClick={() => setSelectedKey(groupKeys[Math.min(groupKeys.length - 1, activeIndex + 1)])}
        >
          →
        </button>
      </div>

      <div className="game-list">
        {activeGames.map((g) => (
          <div key={g.id} className={`game-card ${g.isLive ? 'is-live' : ''}`}>
            <div className="game-card-status">
              {g.isLive && <span className="live-badge">LIVE</span>}
              <span>{g.isFinal || g.isLive ? translateGameStatus(g.statusDetail) : formatDate(g.date)}</span>
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
