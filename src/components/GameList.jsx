function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function GameList({ games }) {
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
          </div>
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
        </div>
      ))}
    </div>
  )
}
