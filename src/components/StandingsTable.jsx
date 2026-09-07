// groups: [{ groupName, rows: [{team, logo, rank, wins, losses, ties, winPercent, gamesBehind, streak, points, gamesPlayed, goalDiff}] }]
// サッカー系(points/gamesPlayed/goalDiffがある)とUSスポーツ系(winPercent/gamesBehindがある)で表示列を切り替える
export default function StandingsTable({ groups }) {
  if (!groups || groups.length === 0) {
    return <p className="muted">順位表を取得できませんでした</p>
  }

  return (
    <div className="standings-wrap">
      {groups.map((g) => {
        const isSoccerStyle = g.rows.some((r) => r.points !== '')
        return (
          <div key={g.groupName} className="standings-group">
            <div className="standings-group-title">{g.groupName}</div>
            <table className="standings-table">
              <thead>
                <tr>
                  <th className="col-rank">#</th>
                  <th className="col-team">チーム</th>
                  {isSoccerStyle ? (
                    <>
                      <th>試合</th>
                      <th>勝</th>
                      <th>分</th>
                      <th>敗</th>
                      <th>得失点</th>
                      <th>勝点</th>
                    </>
                  ) : (
                    <>
                      <th>勝</th>
                      <th>敗</th>
                      <th>勝率</th>
                      <th>差</th>
                      <th>連勝/連敗</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={r.id || i}>
                    <td className="col-rank">{r.rank || i + 1}</td>
                    <td className="col-team">
                      {r.logo && <img className="team-logo" src={r.logo} alt="" />}
                      <span>{r.team}</span>
                    </td>
                    {isSoccerStyle ? (
                      <>
                        <td>{r.gamesPlayed}</td>
                        <td>{r.wins}</td>
                        <td>{r.ties}</td>
                        <td>{r.losses}</td>
                        <td>{r.goalDiff}</td>
                        <td className="col-strong">{r.points}</td>
                      </>
                    ) : (
                      <>
                        <td>{r.wins}</td>
                        <td>{r.losses}</td>
                        <td className="col-strong">{r.winPercent}</td>
                        <td>{r.gamesBehind}</td>
                        <td>{r.streak}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
