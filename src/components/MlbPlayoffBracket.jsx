// 「こういうやつ(横並びのトーナメント表)は無いよね？」との要望(2026-10-01)で追加。
// それまでは節/ラウンドごとにカードを縦に並べるだけだったが、ユーザーが求めていたのは
// 1回戦〜決勝まで列で並び、勝ち上がりが見て分かる横長の「トーナメント表」そのものだった。
// MLBは各リーグ6チーム(地区優勝3+ワイルドカード3)のうち上位2チームがワイルドカードを
// 免除されて直接ディビジョンシリーズに進む変則トーナメントのため、免除された2チームは
// ワイルドカード列に対戦相手の無い「1回戦免除」ボックスとして表示する(実データのteamIdを
// ワイルドカードの対戦カードと突き合わせて自動判定、固定のシード番号を持たせていない)。
// ア・リーグは左から右、ナ・リーグは右から左へ進み、中央のワールドシリーズで合流する
// 構成(ESPN公式サイトのブラケット表示と同じ左右対称レイアウト)。

function isDeterminedTeam(t) {
  return Boolean(t?.team) && !t.team.includes('/') && t.team !== 'TBD'
}

function MatchBox({ series }) {
  const { teamA, teamB, winsA, winsB, completed } = series
  const aWin = completed && winsA > winsB
  const bWin = completed && winsB > winsA
  return (
    <div className="bracket-match">
      <div className={`bracket-match-team ${aWin ? 'is-winner' : ''}`}>
        {teamA?.logo && <img className="team-logo" src={teamA.logo} alt="" />}
        <span className="bracket-match-team-name">{teamA?.team || 'TBD'}</span>
        <span className="bracket-match-score">{winsA}</span>
      </div>
      <div className={`bracket-match-team ${bWin ? 'is-winner' : ''}`}>
        {teamB?.logo && <img className="team-logo" src={teamB.logo} alt="" />}
        <span className="bracket-match-team-name">{teamB?.team || 'TBD'}</span>
        <span className="bracket-match-score">{winsB}</span>
      </div>
    </div>
  )
}

function ByeBox({ team }) {
  return (
    <div className="bracket-match bracket-bye">
      <div className="bracket-match-team">
        {team?.logo && <img className="team-logo" src={team.logo} alt="" />}
        <span className="bracket-match-team-name">{team?.team}</span>
      </div>
      <div className="bracket-bye-label">1回戦免除</div>
    </div>
  )
}

// ワイルドカードに登場していないのにディビジョンシリーズに登場しているチーム=immune(免除)
function findByeTeams(wcRound, dsRound) {
  if (!wcRound || !dsRound) return []
  const wcIds = new Set()
  for (const s of wcRound.series) {
    if (s.teamA) wcIds.add(s.teamA.id)
    if (s.teamB) wcIds.add(s.teamB.id)
  }
  const seen = new Set()
  const byes = []
  for (const s of dsRound.series) {
    for (const t of [s.teamA, s.teamB]) {
      if (t && isDeterminedTeam(t) && !wcIds.has(t.id) && !seen.has(t.id)) {
        seen.add(t.id)
        byes.push(t)
      }
    }
  }
  return byes
}

function LeagueColumns({ byCode, prefix }) {
  const wc = byCode[`${prefix}WC`]
  const ds = byCode[`${prefix}DS`]
  const cs = byCode[`${prefix}CS`]
  const byeTeams = findByeTeams(wc, ds)

  return (
    <>
      <div className="bracket-col">
        <div className="bracket-col-label">ワイルドカード</div>
        <div className="bracket-col-matches">
          {wc?.series.map((s, i) => (
            <MatchBox key={`wc-${i}`} series={s} />
          ))}
          {byeTeams.map((t) => (
            <ByeBox key={t.id} team={t} />
          ))}
        </div>
      </div>
      <div className="bracket-col">
        <div className="bracket-col-label">ディビジョンシリーズ</div>
        <div className="bracket-col-matches">
          {ds?.series.map((s, i) => (
            <MatchBox key={`ds-${i}`} series={s} />
          ))}
        </div>
      </div>
      <div className="bracket-col">
        <div className="bracket-col-label">リーグCS</div>
        <div className="bracket-col-matches">
          {cs?.series.map((s, i) => (
            <MatchBox key={`cs-${i}`} series={s} />
          ))}
        </div>
      </div>
    </>
  )
}

export default function MlbPlayoffBracket({ rounds }) {
  const byCode = {}
  for (const r of rounds) byCode[r.code] = r
  const ws = byCode['World Series']

  return (
    <div className="bracket-scroll">
      <div className="bracket-rounds">
        <div className="bracket-league-group">
          <div className="bracket-league-heading">ア・リーグ</div>
          <div className="bracket-league-row">
            <LeagueColumns byCode={byCode} prefix="AL" />
          </div>
        </div>

        <div className="bracket-col bracket-col-ws">
          <div className="bracket-col-label">ワールドシリーズ</div>
          <div className="bracket-col-matches">
            {ws?.series.map((s, i) => (
              <MatchBox key={`ws-${i}`} series={s} />
            ))}
          </div>
        </div>

        <div className="bracket-league-group">
          <div className="bracket-league-heading">ナ・リーグ</div>
          <div className="bracket-league-row bracket-league-row-reverse">
            <LeagueColumns byCode={byCode} prefix="NL" />
          </div>
        </div>
      </div>
    </div>
  )
}
