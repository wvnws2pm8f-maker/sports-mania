import { useState } from 'react'
import { sports } from './data/leagues.js'
import SoccerView from './components/SoccerView.jsx'
import NBAView from './components/NBAView.jsx'
import MLBView from './components/MLBView.jsx'
import BoxingView from './components/BoxingView.jsx'

const VIEWS = {
  soccer: SoccerView,
  nba: NBAView,
  mlb: MLBView,
  boxing: BoxingView
}

export default function App() {
  const [sport, setSport] = useState('soccer')
  const ActiveView = VIEWS[sport]

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">🏟️ マニアスタジアム</span>
      </header>

      <main className="app-main">
        <ActiveView />
      </main>

      <nav className="bottom-nav">
        {sports.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`nav-tab ${sport === s.id ? 'is-active' : ''}`}
            onClick={() => setSport(s.id)}
          >
            <span className="nav-tab-emoji">{s.emoji}</span>
            <span>{s.name}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
