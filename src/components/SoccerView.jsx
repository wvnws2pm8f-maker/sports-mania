import { useState } from 'react'
import { soccerLeagues } from '../data/leagues.js'
import { articles } from '../data/articles.js'
import SportPanel from './SportPanel.jsx'

const soccerArticles = articles.filter((a) => a.sport === 'soccer')

export default function SoccerView() {
  const [league, setLeague] = useState(soccerLeagues[0].id)

  return (
    <div>
      <div className="league-tab-row">
        {soccerLeagues.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`league-tab ${league === l.id ? 'is-active' : ''}`}
            onClick={() => setLeague(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>
      <SportPanel sportPath="soccer" leaguePath={league} articles={soccerArticles} />
    </div>
  )
}
