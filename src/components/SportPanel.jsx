import { useEffect, useState, useCallback } from 'react'
import { getStandings, getScoreboard, getDataUpdatedAt, invalidate } from '../services/espn.js'
import StandingsTable from './StandingsTable.jsx'
import GameList from './GameList.jsx'
import ArticleList from './ArticleList.jsx'

const SUB_TABS = ['順位表', '試合', '読み物']

// サッカー/NBA/MLB共通の画面。順位表・試合・読み物のサブタブを持つ。
export default function SportPanel({ sportPath, leaguePath, articles }) {
  const [subTab, setSubTab] = useState('順位表')
  const [standings, setStandings] = useState(null)
  const [games, setGames] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(
    async (forceRefresh) => {
      setLoading(true)
      setError(null)
      if (forceRefresh) invalidate(sportPath, leaguePath)
      try {
        const [s, g, u] = await Promise.all([
          getStandings(sportPath, leaguePath),
          getScoreboard(sportPath, leaguePath),
          getDataUpdatedAt(sportPath, leaguePath)
        ])
        setStandings(s)
        setGames(g)
        setUpdatedAt(u)
      } catch (err) {
        console.warn('[SportPanel] load failed', err)
        setError('データを取得できませんでした。電波状況を確認して、もう一度お試しください。')
      } finally {
        setLoading(false)
      }
    },
    [sportPath, leaguePath]
  )

  useEffect(() => {
    setStandings(null)
    setGames(null)
    load(false)
  }, [load])

  return (
    <div className="sport-panel">
      <div className="sub-tab-row">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`sub-tab ${subTab === t ? 'is-active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t}
          </button>
        ))}
        {subTab !== '読み物' && (
          <button type="button" className="refresh-button" onClick={() => load(true)} disabled={loading}>
            {loading ? '更新中…' : '↻ 更新'}
          </button>
        )}
      </div>

      {subTab !== '読み物' && updatedAt && (
        <div className="updated-at">
          データ更新 {updatedAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {subTab === '順位表' && !error && (loading && !standings ? <p className="muted">よみこみちゅう…</p> : <StandingsTable groups={standings} variant={sportPath === 'soccer' ? 'soccer' : 'us'} />)}
      {subTab === '試合' && !error && (loading && !games ? <p className="muted">よみこみちゅう…</p> : <GameList games={games} />)}
      {subTab === '読み物' && <ArticleList articles={articles} />}
    </div>
  )
}
