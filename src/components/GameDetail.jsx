import { useEffect, useState } from 'react'
import { getGameSummary } from '../services/espn.js'
import { translateGameStatus, translateStatCategory } from '../utils/espnLabels.js'

// 試合の詳細(得点者・出場選手の主な成績など)。2026-09-17の要望で追加。
// 【注意】ESPNの試合詳細データの正確な形をこの開発環境からは検証できておらず、
// scripts/fetch-game-summaries.mjsが「取れた範囲だけ」保存している。そのため表示できる
// 情報が無い試合もある(取得失敗・対象期間外・フィールド名の想定違いなど)。
export default function GameDetail({ sportPath, leaguePath, game, onBack }) {
  const [detail, setDetail] = useState(undefined) // undefined=読み込み中, null=データ無し
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setDetail(undefined)
    getGameSummary(sportPath, leaguePath, game.id)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => {
        console.warn('[GameDetail] load failed', err)
        if (!cancelled) setError('試合詳細を取得できませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [sportPath, leaguePath, game.id])

  const teamName = (teamId) => (teamId === game.home.id ? game.home.team : teamId === game.away.id ? game.away.team : '')
  // detailは「取得はできたが中身が全部null」({goals:null}など)のこともあり、
  // detail === null(取得失敗/対象外)だけで判定すると、その場合に何も表示されず
  // 画面が真っ白になる不具合があった(2026-09-17、実データで発覚)。
  const hasContent = Boolean(
    detail?.goals?.length || detail?.highlights?.length || detail?.leaders?.length || detail?.lineups?.length
  )

  return (
    <div className="game-detail">
      <button type="button" className="back-button" onClick={onBack}>
        ← 戻る
      </button>

      <div className="game-detail-header">
        <div className="game-detail-team-row">
          {game.away.logo && <img className="team-logo" src={game.away.logo} alt="" />}
          <span className="game-detail-team-name">{game.away.team}</span>
          <span className="game-detail-score">{game.away.score}</span>
        </div>
        <div className="game-detail-team-row">
          {game.home.logo && <img className="team-logo" src={game.home.logo} alt="" />}
          <span className="game-detail-team-name">{game.home.team}</span>
          <span className="game-detail-score">{game.home.score}</span>
        </div>
        <div className="game-detail-status">{translateGameStatus(game.statusDetail)}</div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {detail === undefined && !error && <p className="muted">よみこみちゅう…</p>}

      {detail !== undefined && !error && !hasContent && (
        <p className="muted">この試合の詳細データはまだありません(取得対象外の期間か、データが見つかりませんでした)</p>
      )}

      {detail?.goals?.length > 0 && (
        <>
          <div className="team-detail-section-title">⚽ 得点者</div>
          <div className="game-detail-events">
            {detail.goals.map((g, i) => (
              <div key={i} className="game-detail-event-row">
                <span className="game-detail-event-minute">{g.minute}</span>
                <span className="game-detail-event-scorer">
                  {g.scorer || '(選手名不明)'}
                  {g.ownGoal && ' (OG)'}
                  {g.penalty && ' (PK)'}
                </span>
                <span className="game-detail-event-team">{teamName(g.teamId)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {detail?.highlights?.length > 0 && (
        <>
          <div className="team-detail-section-title">⚾ 注目の成績</div>
          <div className="game-detail-events">
            {detail.highlights.map((h, i) => (
              <div key={i} className="game-detail-event-row">
                <span className="game-detail-event-scorer">{h.athlete}</span>
                <span className="game-detail-event-team">
                  {h.kind === 'HR' ? `本塁打${h.value > 1 ? ` x${h.value}` : ''}` : h.value}
                </span>
                <span className="game-detail-event-team">{teamName(h.teamId)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {detail?.lineups?.length > 0 && (
        <>
          <div className="team-detail-section-title">🧢 投手・出場選手</div>
          {detail.lineups.map((l, i) => (
            <div key={i} className="game-detail-lineup-card">
              <div className="game-detail-lineup-team">{teamName(l.teamId) || `チーム${i + 1}`}</div>
              {l.startingPitchers.length > 0 && (
                <div className="game-detail-lineup-line">
                  <span className="game-detail-lineup-label">先発投手</span> {l.startingPitchers.join(', ')}
                </div>
              )}
              {l.otherPitchers.length > 0 && (
                <div className="game-detail-lineup-line">
                  <span className="game-detail-lineup-label">継投</span> {l.otherPitchers.join(', ')}
                </div>
              )}
              {l.batters.length > 0 && (
                <div className="game-detail-lineup-line">
                  <span className="game-detail-lineup-label">出場選手</span> {l.batters.join(', ')}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {detail?.leaders?.length > 0 && (
        <>
          <div className="team-detail-section-title">📊 主な選手成績</div>
          <div className="game-detail-events">
            {detail.leaders.map((l, i) => (
              <div key={i} className="game-detail-event-row">
                <span className="game-detail-event-scorer">{l.athlete}</span>
                <span className="game-detail-event-team">
                  {translateStatCategory(l.category)} {l.value}
                </span>
                <span className="game-detail-event-team">{teamName(l.teamId)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
