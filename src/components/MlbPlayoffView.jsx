import { useEffect, useState } from 'react'
import { getMlbPlayoffs } from '../services/espn.js'
import { mlbPlayoffFormat } from '../data/championshipInfo.js'
import japanesePlayersData from '../data/mlbJapanesePlayers.json'
import { translateGameStatus } from '../utils/espnLabels.js'
import { highlightSearchUrl } from '../utils/highlightLink.js'
import MlbPlayoffBracket from './MlbPlayoffBracket.jsx'

// MLBプレーオフを「トーナメント表」として楽しめるように追加(2026-09-28の要望:
// 対戦組み合わせ一覧・シリーズの何勝何敗・ラウンド別分類・日程・日本人選手を目立たせたい)。
// データはscripts/fetch-mlb-playoffs.mjsがESPNのスコアボードから
// (ラウンド名+シリーズ何勝何敗)を自動で再構成したもの(public/data/mlb-playoffs.json)。

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`
}

// 対戦相手がまだ確定していないカードは、ESPNが「Yankees/Red Sox」のような
// スラッシュ区切りの仮名を返す。日本人選手バッジはこの仮チームには付けない。
function isDeterminedTeam(t) {
  return Boolean(t?.team) && !t.team.includes('/') && t.team !== 'TBD'
}

function japaneseFor(teamId) {
  return japanesePlayersData.playersByTeamId?.[teamId] || []
}

function SeriesCard({ series, onSelectGame }) {
  const { teamA, teamB, winsA, winsB, completed, games } = series
  const aDetermined = isDeterminedTeam(teamA)
  const bDetermined = isDeterminedTeam(teamB)
  const aJP = aDetermined ? japaneseFor(teamA.id) : []
  const bJP = bDetermined ? japaneseFor(teamB.id) : []
  const aWinning = completed && winsA > winsB
  const bWinning = completed && winsB > winsA

  return (
    <div className="playoff-series-card">
      <div className={`playoff-series-team-row ${aWinning ? 'is-winner' : ''}`}>
        {teamA?.logo && <img className="team-logo" src={teamA.logo} alt="" />}
        <span className="playoff-series-team-name">{teamA?.team || 'TBD'}</span>
        {aJP.length > 0 && <span className="jp-player-badge">🎌 {aJP.join('・')}</span>}
        <span className="playoff-series-score">{winsA}</span>
      </div>
      <div className={`playoff-series-team-row ${bWinning ? 'is-winner' : ''}`}>
        {teamB?.logo && <img className="team-logo" src={teamB.logo} alt="" />}
        <span className="playoff-series-team-name">{teamB?.team || 'TBD'}</span>
        {bJP.length > 0 && <span className="jp-player-badge">🎌 {bJP.join('・')}</span>}
        <span className="playoff-series-score">{winsB}</span>
      </div>
      {completed && (
        <div className="playoff-series-status">🏆 {aWinning ? teamA.team : teamB.team}が勝ち抜け</div>
      )}
      <div className="playoff-series-games">
        {games.map((g) => (
          <div key={g.id} className={`playoff-series-game ${g.isLive ? 'is-live' : ''}`}>
            <button
              type="button"
              className="playoff-series-game-tap"
              onClick={() => g.isFinal && onSelectGame && onSelectGame(g)}
              disabled={!g.isFinal}
            >
              <span className="playoff-series-game-num">Game{g.gameNum}</span>
              <span>{g.isFinal || g.isLive ? translateGameStatus(g.statusDetail) : formatDate(g.date)}</span>
              {(g.isFinal || g.isLive) && (
                <span className="playoff-series-game-score">
                  {g.away.score}-{g.home.score}
                </span>
              )}
            </button>
            {/* 終了した試合はハイライト動画を探せるように(2026-09-30の要望、
                GameList.jsx/BoxingView.jsxと同じYouTube検索リンク方式) */}
            {g.isFinal && (
              <a
                className="playoff-series-game-highlight"
                href={highlightSearchUrl(`${g.away.team} vs ${g.home.team} highlights`)}
                target="_blank"
                rel="noreferrer"
                aria-label="ハイライトを見る"
              >
                🎥
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FormatExplainer() {
  return (
    <>
      <div className="standings-group-title">🏆 プレーオフ方式</div>
      <ul className="playoff-format-list">
        {mlbPlayoffFormat.rounds.map((r) => (
          <li key={r.name}>
            <strong>{r.name}</strong>: {r.format}
          </li>
        ))}
      </ul>
      <div className="playoff-format-tip">{mlbPlayoffFormat.tip}</div>
    </>
  )
}

export default function MlbPlayoffView({ onSelectGame }) {
  const [data, setData] = useState(undefined) // undefined=読み込み中
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getMlbPlayoffs()
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        console.warn('[MlbPlayoffView] load failed', err)
        if (!cancelled) setError('プレーオフ情報を取得できませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="error-text">{error}</p>
  if (data === undefined) return <p className="muted">よみこみちゅう…</p>

  if (!data?.inPostseason || !data.rounds || data.rounds.length === 0) {
    return (
      <div>
        <FormatExplainer />
        <p className="muted" style={{ marginTop: 12 }}>
          プレーオフはまだ始まっていません。開幕すると、ここに対戦組み合わせが表示されます。
        </p>
      </div>
    )
  }

  // 同じラウンド名(ワイルドカード等)のAL/NL枠を1つの見出しの下にまとめて表示する
  const byName = new Map()
  for (const r of data.rounds) {
    if (!byName.has(r.name)) byName.set(r.name, [])
    byName.get(r.name).push(r)
  }

  return (
    <div>
      <div className="standings-group-title">🏆 トーナメント表</div>
      <MlbPlayoffBracket rounds={data.rounds} />

      <div className="playoff-format-tip" style={{ margin: '14px 0' }}>
        {mlbPlayoffFormat.tip}
      </div>
      <div className="standings-group-title">📋 ラウンド別の詳細(日程・ハイライト)</div>
      {[...byName.entries()].map(([name, roundsForName]) => (
        <div key={name} className="standings-group">
          <div className="standings-group-title">{name}</div>
          {roundsForName.map((r) => (
            <div key={r.code}>
              {r.league && <div className="playoff-league-label">{r.league === 'AL' ? 'ア・リーグ' : 'ナ・リーグ'}</div>}
              <div className="playoff-series-list">
                {r.series.map((s, i) => (
                  <SeriesCard key={i} series={s} onSelectGame={onSelectGame} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
