import { useEffect, useState, useCallback } from 'react'
import { getStandings, getScoreboard, getDataUpdatedAt, invalidate, getHotTeams } from '../services/espn.js'
import { findStreaks } from '../utils/teamForm.js'
import StandingsTable from './StandingsTable.jsx'
import GameList from './GameList.jsx'
import ArticleList from './ArticleList.jsx'
import TeamDetail from './TeamDetail.jsx'

const SUB_TABS = ['順位表', '試合', '読み物']

// サッカー/NBA/MLB共通の画面。順位表・試合・読み物のサブタブを持つ。
export default function SportPanel({ sportPath, leaguePath, articles }) {
  const [subTab, setSubTab] = useState('順位表')
  const [standings, setStandings] = useState(null)
  const [games, setGames] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [hotTeamsAll, setHotTeamsAll] = useState(null)

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
    setSelectedTeam(null)
    load(false)
  }, [load])

  // 「好調なチーム」帯用。全スポーツ分をまとめたファイルなので一度だけ取得し、このリーグの分だけ絞り込む。
  useEffect(() => {
    let cancelled = false
    getHotTeams()
      .then((d) => !cancelled && setHotTeamsAll(d.teams))
      .catch((err) => console.warn('[SportPanel] hot teams load failed', err))
    return () => {
      cancelled = true
    }
  }, [])

  function selectTeamById(teamId) {
    const row = standings?.flatMap((g) => g.rows).find((r) => r.id === teamId)
    if (row) setSelectedTeam(row)
  }

  if (selectedTeam) {
    return (
      <div className="sport-panel">
        <TeamDetail
          sportPath={sportPath}
          leaguePath={leaguePath}
          teamId={selectedTeam.id}
          standingsRow={selectedTeam}
          games={games}
          onBack={() => setSelectedTeam(null)}
        />
      </div>
    )
  }

  const streaks = subTab === '順位表' ? findStreaks(sportPath, standings).slice(0, 6) : []
  const hotTeams = subTab === '順位表' ? (hotTeamsAll || []).filter((t) => t.sportPath === sportPath && t.leaguePath === leaguePath) : []

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

      {subTab === '順位表' && !error && (streaks.length > 0 || hotTeams.length > 0) && (
        <div className="team-form-band">
          {streaks.length > 0 && (
            <div className="streak-row">
              {streaks.map((s, i) => (
                <button type="button" key={i} className="streak-chip" onClick={() => selectTeamById(s.teamId)}>
                  {s.logo && <img className="team-logo" src={s.logo} alt="" />}
                  <span className="streak-chip-team">{s.team}</span>
                  <span className="streak-chip-count">{s.streak}連勝</span>
                </button>
              ))}
            </div>
          )}
          {hotTeams.length > 0 && (
            <div className="hot-teams-row">
              {hotTeams.map((t, i) => (
                <button type="button" key={i} className="hot-team-card" onClick={() => selectTeamById(t.teamId)}>
                  <div className="hot-team-card-top">
                    {t.logo && <img className="team-logo" src={t.logo} alt="" />}
                    <span className="streak-chip-team">{t.team}</span>
                    <span className="streak-chip-count">
                      {t.wins}勝{t.losses}敗
                    </span>
                  </div>
                  {t.commentary && <div className="hot-team-card-commentary">{t.commentary}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === '順位表' && !error && (loading && !standings ? <p className="muted">よみこみちゅう…</p> : <StandingsTable groups={standings} variant={sportPath === 'soccer' ? 'soccer' : 'us'} onSelectTeam={setSelectedTeam} />)}
      {subTab === '試合' && !error && (loading && !games ? <p className="muted">よみこみちゅう…</p> : <GameList games={games} />)}
      {subTab === '読み物' && <ArticleList articles={articles} />}
    </div>
  )
}
