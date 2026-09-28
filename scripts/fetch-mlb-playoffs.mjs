// MLBプレーオフ(ポストシーズン)を「トーナメント表」として楽しめるようにする機能
// (2026-09-28、プレーオフ開幕直前の要望: 対戦組み合わせ一覧・シリーズの何勝何敗・
// ラウンド別分類・日程・日本人選手を目立たせたい)。
//
// ESPNのスコアボードAPIには、レギュラーシーズンには無い2つの追加情報が
// ポストシーズン中の各試合イベントに含まれることを実データ(2025年10月分)で確認済み:
// ①comp.notes[0].headline: "ALDS - Game 2"のような「ラウンド名 - Game番号」の文字列
// ②comp.series: {summary:"TOR leads series 2-0", competitors:[{id,wins},...], completed}
//   という、そのシリーズの現在の勝敗数(試合が進むたびに更新される)
// この2つを使えば、通常のスコアボード取得だけで「どのラウンドの何回戦か」「シリーズ何勝何敗か」
// が分かるため、手動でブラケット(組み合わせ)を管理しなくても自動でトーナメント表を再構成できる。
//
// レギュラーシーズンは162試合×30球団と非常に多いためシーズン全体を毎回取得する方式
// (fetch-soccer-rounds.mjsと同じ発想)は使えないが、ポストシーズンは例年9〜11月・
// 最大12チームだけの短期決戦なので、この期間だけ月単位でまるごと取得しても問題にならない。
import { writeFileSync } from 'node:fs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard'

const ROUND_INFO = {
  ALWC: { name: 'ワイルドカードシリーズ', order: 1, league: 'AL' },
  NLWC: { name: 'ワイルドカードシリーズ', order: 1, league: 'NL' },
  ALDS: { name: 'ディビジョンシリーズ', order: 2, league: 'AL' },
  NLDS: { name: 'ディビジョンシリーズ', order: 2, league: 'NL' },
  ALCS: { name: 'リーグチャンピオンシップシリーズ', order: 3, league: 'AL' },
  NLCS: { name: 'リーグチャンピオンシップシリーズ', order: 3, league: 'NL' },
  'World Series': { name: 'ワールドシリーズ', order: 4, league: null }
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' }, signal: controller.signal })
    if (!res.ok) throw new Error(`fetch failed ${res.status} ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ポストシーズンは例年9〜11月に収まる(season-milestones.jsonの実データでも2026年は
// 9/29〜11/12)。安全マージンを持たせるため9〜12月を対象にする。
function postseasonMonths() {
  const year = new Date().getFullYear()
  return [9, 10, 11, 12].map((m) => `${year}${String(m).padStart(2, '0')}`)
}

// 【重要・実データで発覚】seasontype=3(ポストシーズン)を指定してもESPNのscoreboardは
// 9月分に限って一部のレギュラーシーズンの延期分ダブルヘッダー("Doubleheader - Game 2"等)が
// 紛れ込むことがある(2025年9月のCleveland at Minnesota等で確認)。既知のラウンドコード
// (ROUND_INFOに定義したものだけ)に厳密一致する場合のみプレーオフの試合として扱い、
// それ以外(Doubleheader等)は黙って除外する。
function parseRound(comp) {
  const headline = comp.notes?.[0]?.headline || ''
  const m = headline.match(/^(.+?) - Game (\d+)$/)
  if (!m) return null
  const [, code, gameNumStr] = m
  const info = ROUND_INFO[code]
  if (!info) return null
  return { code, gameNum: parseInt(gameNumStr, 10), ...info }
}

function normalizeEvent(ev) {
  const comp = ev.competitions?.[0]
  const competitors = comp?.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home')
  const away = competitors.find((c) => c.homeAway === 'away')
  const statusType = ev.status?.type || {}
  const round = parseRound(comp || {})
  const seriesRaw = comp?.series
  return {
    id: ev.id,
    date: ev.date,
    statusDetail: statusType.shortDetail || statusType.description || '',
    isLive: statusType.state === 'in',
    isFinal: Boolean(statusType.completed),
    home: { id: home?.team?.id || '', team: home?.team?.displayName || '', score: home?.score ?? '', logo: home?.team?.logo || '' },
    away: { id: away?.team?.id || '', team: away?.team?.displayName || '', score: away?.score ?? '', logo: away?.team?.logo || '' },
    round,
    series: seriesRaw
      ? {
          summary: seriesRaw.summary || '',
          completed: Boolean(seriesRaw.completed),
          competitors: (seriesRaw.competitors || []).map((c) => ({ id: c.id, wins: c.wins ?? 0 }))
        }
      : null
  }
}

async function fetchAllPostseasonEvents() {
  const months = postseasonMonths()
  const results = await Promise.all(
    months.map((ym) =>
      fetchJson(`${BASE}?dates=${ym}&seasontype=3&limit=500`).catch((err) => {
        console.log(`::warning::mlb-playoffs ${ym} 取得失敗: ${err.message}`)
        return { events: [] }
      })
    )
  )
  const byId = new Map()
  for (const data of results) {
    for (const ev of data.events || []) {
      const norm = normalizeEvent(ev)
      // notesがラウンド名を含まない試合(オールスター等、seasontype=3に混入することは
      // 無いはずだが念のため)は対象外にする
      if (norm.id && norm.round) byId.set(norm.id, norm)
    }
  }
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date))
}

// (ラウンド×対戦カード)単位でグルーピングしてシリーズを再構成する。
// 同じシリーズの試合はホーム/アウェーが入れ替わるため、チームIDのペア(ソート済み)を
// キーにする。各シリーズの勝敗数・完了フラグは「そのシリーズの最新の試合」が持つ
// series情報を正とする(試合が進むたびにESPN側の値も更新されているはずのため)。
function buildSeries(events) {
  const map = new Map()
  for (const ev of events) {
    // 【重要・実データで発覚】ALDS/ALCS等、対戦相手がまだ確定していないラウンドでは
    // ESPNが「Yankees/Red Sox」のような未確定側のチーム名を仮のプレースホルダーで返すが、
    // そのチームIDは試合ごとに"-1"/"-2"のように変わることがあり、IDでグルーピングすると
    // 同じ対戦カードのgame1・2と、game3以降が別シリーズとして分裂してしまった(2026-09-28、
    // 2026年ポストシーズン開幕前のプレースホルダーデータで確認)。表示名は安定しているため、
    // チームIDではなくチーム名のペアでグルーピングする。
    const pairKey = [ev.home.team, ev.away.team].sort().join('|')
    const key = `${ev.round.code}-${pairKey}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(ev)
  }
  const seriesList = []
  for (const games of map.values()) {
    games.sort((a, b) => (a.round.gameNum || 0) - (b.round.gameNum || 0))
    const latest = [...games].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    // 勝敗数(series.competitors)はチームIDで紐づいているため、teamA/teamBも必ず
    // 同じ「最新の試合」のhome/awayから作る(古い試合のプレースホルダーIDと混ぜない)。
    const teamA = { id: latest.home.id, team: latest.home.team, logo: latest.home.logo }
    const teamB = { id: latest.away.id, team: latest.away.team, logo: latest.away.logo }
    const seriesWins = latest.series?.competitors || []
    seriesList.push({
      round: games[0].round,
      teamA,
      teamB,
      winsA: seriesWins.find((c) => c.id === teamA.id)?.wins ?? 0,
      winsB: seriesWins.find((c) => c.id === teamB.id)?.wins ?? 0,
      completed: Boolean(latest.series?.completed),
      games: games.map((g) => ({
        id: g.id,
        date: g.date,
        gameNum: g.round.gameNum,
        statusDetail: g.statusDetail,
        isLive: g.isLive,
        isFinal: g.isFinal,
        home: g.home,
        away: g.away
      }))
    })
  }
  return seriesList
}

async function main() {
  try {
    const events = await fetchAllPostseasonEvents()
    const seriesList = buildSeries(events)
    const roundsMap = new Map()
    for (const s of seriesList) {
      const key = s.round.code
      if (!roundsMap.has(key)) {
        roundsMap.set(key, { code: s.round.code, name: s.round.name, order: s.round.order, league: s.round.league, series: [] })
      }
      roundsMap.get(key).series.push(s)
    }
    const rounds = [...roundsMap.values()].sort((a, b) => a.order - b.order || (a.league || '').localeCompare(b.league || ''))
    const data = { inPostseason: events.length > 0, rounds, updatedAt: new Date().toISOString() }
    writeFileSync(new URL('../public/data/mlb-playoffs.json', import.meta.url), JSON.stringify(data))
    console.log(`ok: mlb-playoffs (events=${events.length}, series=${seriesList.length}, rounds=${rounds.length})`)
  } catch (err) {
    console.log(`::error::FAILED mlb-playoffs: ${err.message}`)
  }
}

main()
