function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 試合ごとのハイライト動画を確実に一意に特定できる無料APIは無いため、
// 「ハイライト動画そのものへの埋め込み」ではなく「YouTube内で検索した結果に飛ぶ」方式にする
// (推しボクサーのX/ニュース検索リンクと同じ考え方)。チーム名は英語表記なので検索精度は十分実用的。
function highlightSearchUrl(g) {
  const q = `${g.away.team} vs ${g.home.team} highlights`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
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
          {/* プレーオフ中、ESPNが対戦カードに付けてくる"シリーズ何勝何敗か"の情報。
              レギュラーシーズン中はg.seriesがnullなので何も表示されない */}
          {g.series?.summary && <div className="game-card-series">🏆 {g.series.title ? `${g.series.title} ・ ` : ''}{g.series.summary}</div>}
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
            <a
              className="highlight-link"
              href={highlightSearchUrl(g)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              🎥 ハイライトを見る
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
