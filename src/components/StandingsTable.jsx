import { translateGroupName } from '../utils/espnLabels.js'

// groups: [{ groupName, rows: [{team, logo, rank, wins, losses, ties, winPercent, gamesBehind, streak, points, gamesPlayed, goalDiff, clincher, magicNumberDivision, magicNumberWildcard}] }]
// variant: 'soccer' | 'us' で表示列を切り替える。
// (以前はrowsの中身から推測していたが、ESPNのNBA順位表にもたまたま
//  "points"という名前の統計(得失点差寄りの値)が入っていて誤判定していたため、
//  呼び出し側から明示的に渡す方式にした)

// clincher記号(ESPN標準の表記): z=最高勝率確定, y=地区優勝確定, x=プレーオフ進出確定, e=敗退確定。
// 「ドジャースの地区優勝が分からない」との要望(2026-09-18)で追加。
//
// 【重要・修正】実際にドジャースが地区優勝を決めた後もこのclincherフィールドが
// 常に空文字のままで、確定が表示されないという不具合が発覚(2026-09-18、ユーザー指摘)。
// このESPNの取得方法(level=3)ではclincherが埋まらないようで、代わりにマジックナンバーが
// 「0」になったことをもって確定と判断するようにした(数値の方は正しく取得できていた:
// 例えばドジャースはマジック1〜0の間で優勝が決まった)。clincherが将来埋まる場合に備えて
// 判定は残しつつ、マジックナンバーによる判定を優先的なフォールバックとして追加している。
function isDivisionClinched(row) {
  const mDiv = parseInt(row.magicNumberDivision, 10)
  return Boolean(row.clincher?.includes('y') || row.clincher?.includes('z') || (Number.isFinite(mDiv) && mDiv <= 0))
}

function clinchBadge(row) {
  const mWc = parseInt(row.magicNumberWildcard, 10)
  if (isDivisionClinched(row)) {
    return { text: '🏆 地区優勝', className: 'clinch-badge-division' }
  }
  if (row.clincher?.includes('x') || (Number.isFinite(mWc) && mWc <= 0)) {
    return { text: '✓ PO進出', className: 'clinch-badge-playoff' }
  }
  if (row.clincher?.includes('e')) {
    return { text: '敗退', className: 'clinch-badge-eliminated' }
  }
  return null
}

// マジックナンバーは「地区優勝/プレーオフ進出まであと何勝(+相手の敗戦)が必要か」の目安。
// 既に確定/敗退しているチームや対象外のチームには意味の無い値(0や空、異常値)が
// 入ることがあるため、1〜99の範囲の数値だけを信頼して表示する(未検証のため保守的に)。
// 0以下はclinchBadge側で「確定」として扱うため、ここでは1以上だけを対象にする。
//
// divisionDecided: 同じグループ内の別チームが既に地区優勝を決めている場合、
// 自チームの地区マジックナンバーを表示し続けても意味が無い(2026-09-20、
// 「マジックが他のチームに点灯されているが事実上必要ない数字」との指摘で追加)。
// その場合はワイルドカード(プレーオフ進出)側のマジックナンバーがあればそちらを見せる
// (地区争いとは独立した、まだ意味のある数字のため)。
function magicNumberValue(row, divisionDecided) {
  const mDiv = parseInt(row.magicNumberDivision, 10)
  if (!divisionDecided && Number.isFinite(mDiv) && mDiv > 0 && mDiv < 100) return { value: mDiv, wildcard: false }
  const mWc = parseInt(row.magicNumberWildcard, 10)
  // divisionDecided時にワイルドカード側へフォールバックした場合は、地区のマジックと
  // 混同しないよう「WC」表記にする(2026-09-20、「地区優勝後の他チームの数字が紛らわしい」
  // 指摘を受けての改善)。
  return Number.isFinite(mWc) && mWc > 0 && mWc < 100 ? { value: mWc, wildcard: divisionDecided } : null
}

export default function StandingsTable({ groups, variant = 'us', onSelectTeam }) {
  if (!groups || groups.length === 0) {
    return <p className="muted">順位表を取得できませんでした</p>
  }

  const isSoccerStyle = variant === 'soccer'

  return (
    <div className="standings-wrap">
      {groups.map((g) => {
        const divisionDecided = !isSoccerStyle && g.rows.some(isDivisionClinched)
        return (
          <div key={g.groupName} className="standings-group">
            <div className="standings-group-title">{translateGroupName(g.groupName)}</div>
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
                    {/* r.rankはESPNのplayoffSeed(リーグ/カンファレンス全体でのプレーオフ順位)で、
                        地区別に表示すると「2, 6, 7, 14, 15」のように飛び飛びになり紛らわしいため
                        使わない(2026-09-13指摘)。表示中のグループ内での並び順(勝率順に整列済み)を
                        そのまま「#」として使う */}
                    <td className="col-rank">{i + 1}</td>
                    <td className="col-team">
                      <button
                        type="button"
                        className="team-cell-button"
                        onClick={() => onSelectTeam && onSelectTeam(r)}
                        disabled={!onSelectTeam}
                      >
                        {r.logo && <img className="team-logo" src={r.logo} alt="" />}
                        <span>{r.team}</span>
                      </button>
                      {!isSoccerStyle &&
                        (() => {
                          const badge = clinchBadge(r)
                          if (badge) return <span className={`clinch-badge ${badge.className}`}>{badge.text}</span>
                          const magic = magicNumberValue(r, divisionDecided)
                          return magic ? (
                            <span className="clinch-badge magic-number-badge">
                              {magic.wildcard ? 'WC-M' : 'M'}
                              {magic.value}
                            </span>
                          ) : null
                        })()}
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
