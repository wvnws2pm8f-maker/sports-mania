import { useEffect, useState } from 'react'
import { getNflWeeks } from '../services/espn.js'
import GameList from './GameList.jsx'

// NFLは他競技と違い「第◯週」という単位でシーズンが進むため、通常の日付範囲の試合一覧ではなく
// 週を選んで結果/対戦カードを見られるようにする(2026-09-15、ユーザー要望)。
export default function NflWeeklyGames() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selectedWeek, setSelectedWeek] = useState(null)

  useEffect(() => {
    let cancelled = false
    getNflWeeks()
      .then((d) => {
        if (cancelled) return
        setData(d)
        setSelectedWeek(d.currentWeek)
      })
      .catch((err) => {
        console.warn('[NflWeeklyGames] load failed', err)
        if (!cancelled) setError('週別データを取得できませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="error-text">{error}</p>
  if (!data) return <p className="muted">よみこみちゅう…</p>

  const week = data.weeks.find((w) => w.week === selectedWeek)

  return (
    <div>
      <div className="week-picker-row">
        <button
          type="button"
          className="week-picker-arrow"
          disabled={selectedWeek <= 1}
          onClick={() => setSelectedWeek((w) => Math.max(1, w - 1))}
        >
          ←
        </button>
        <select className="week-picker-select" value={selectedWeek} onChange={(e) => setSelectedWeek(Number(e.target.value))}>
          {data.weeks.map((w) => (
            <option key={w.week} value={w.week}>
              第{w.week}週{w.week === data.currentWeek ? '(今週)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="week-picker-arrow"
          disabled={selectedWeek >= data.weeks.length}
          onClick={() => setSelectedWeek((w) => Math.min(data.weeks.length, w + 1))}
        >
          →
        </button>
      </div>
      <GameList games={week?.games} />
    </div>
  )
}
