import { useEffect, useState } from 'react'
import { getF1Data } from '../services/espn.js'
import { articles } from '../data/articles.js'
import { translateF1Status } from '../utils/espnLabels.js'
import ArticleList from './ArticleList.jsx'

const f1Articles = articles.filter((a) => a.sport === 'f1')
const SUB_TABS = ['ランキング', 'レースカレンダー', '読み物']

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`
}

export default function F1View() {
  const [subTab, setSubTab] = useState('ランキング')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getF1Data()
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        console.warn('[F1View] load failed', err)
        if (!cancelled) setError('F1データを取得できませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const today = new Date().toISOString().slice(0, 10)

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
      </div>

      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p className="muted">よみこみちゅう…</p>}

      {data && (
        <div className="updated-at">
          データ更新 {formatDate(data.updatedAt)} ・ {data.season}シーズン
        </div>
      )}

      {data && data.nextRace && (
        <div className="f1-next-race-card">
          <div className="f1-next-race-label">🏁 次のレース</div>
          <div className="f1-next-race-name">{data.nextRace.raceName}</div>
          <div className="f1-next-race-meta">
            {formatDate(data.nextRace.date)} ・ {data.nextRace.circuitName}({data.nextRace.locality}, {data.nextRace.country})
          </div>
        </div>
      )}

      {subTab === 'ランキング' && data && (
        <>
          <div className="standings-group">
            <div className="standings-group-title">🏎️ ドライバーズランキング</div>
            <table className="standings-table">
              <thead>
                <tr>
                  <th className="col-rank">#</th>
                  <th className="col-team">ドライバー</th>
                  <th>チーム</th>
                  <th>勝数</th>
                  <th>ポイント</th>
                </tr>
              </thead>
              <tbody>
                {data.driverStandings.map((d) => (
                  <tr key={d.driverId}>
                    <td className="col-rank">{d.position}</td>
                    <td className="col-team">{d.name}</td>
                    <td>{d.constructorName}</td>
                    <td>{d.wins}</td>
                    <td className="col-strong">{d.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="standings-group">
            <div className="standings-group-title">🏗️ コンストラクターズランキング</div>
            <table className="standings-table">
              <thead>
                <tr>
                  <th className="col-rank">#</th>
                  <th className="col-team">チーム</th>
                  <th>勝数</th>
                  <th>ポイント</th>
                </tr>
              </thead>
              <tbody>
                {data.constructorStandings.map((c) => (
                  <tr key={c.constructorId}>
                    <td className="col-rank">{c.position}</td>
                    <td className="col-team">{c.name}</td>
                    <td>{c.wins}</td>
                    <td className="col-strong">{c.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.lastRace && (
            <div className="standings-group">
              <div className="standings-group-title">
                🏆 直近レース結果: {data.lastRace.raceName}({formatDate(data.lastRace.date)})
              </div>
              <table className="standings-table">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-team">ドライバー</th>
                    <th>チーム</th>
                    <th>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lastRace.results.map((r, i) => (
                    <tr key={i}>
                      <td className="col-rank">{r.position}</td>
                      <td className="col-team">{r.driverName}</td>
                      <td>{r.constructorName}</td>
                      <td>{r.status === 'Finished' ? `${r.points}pt` : translateF1Status(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {subTab === 'レースカレンダー' && data && (
        <div className="game-list">
          {data.races.map((r) => (
            <div key={r.round} className={`game-card ${r.date === today ? 'is-live' : ''}`}>
              <div className="game-card-status">
                {r.date < today ? '終了' : formatDate(r.date)}
                {r.date === today && <span className="live-badge">本日開催</span>}
              </div>
              <div className="boxing-card-title">
                第{r.round}戦 {r.raceName}
              </div>
              <div className="boxing-card-venue">
                📍 {r.circuitName}({r.locality}, {r.country})
              </div>
            </div>
          ))}
        </div>
      )}

      {subTab === '読み物' && <ArticleList articles={f1Articles} />}
    </div>
  )
}
