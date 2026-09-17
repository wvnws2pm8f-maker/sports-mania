// ESPNの非公式公開APIを叩いて、順位表・試合データを取得し public/data/ に静的JSONとして書き出す。
// ブラウザから直接ESPN APIを叩くとCORSでブロックされるため、
// GitHub Actions(サーバー環境=CORS制約なし)でこのスクリプトを定期実行し、
// 結果のJSONをリポジトリにコミットする方式に変更した。
// アプリはビルド後にこの public/data/*.json を fetch する。
import { writeFileSync, mkdirSync } from 'node:fs'
import { TARGETS } from './leagues.mjs'

const BASE = 'https://site.api.espn.com/apis'

// 直近◯日前〜◯日後までの試合を拾う(常に「今日だけ」だと閑散期に空になりがちなため)。
// リーグによって試合間隔の粗さが全く違うため、範囲を可変にできるようにしている。
//
// 【重要・2026-09-15にESPN側の仕様変更で発覚】以前は dates=YYYYMMDD-YYYYMMDD という
// 範囲指定が使えたが、ある時点からESPNがこの「範囲」形式のクエリを一律400エラーで
// 拒否するようになった(世界中の他プロジェクトでも同時多発的に報告されている既知の変更で、
// このアプリだけの問題ではない)。単一日付(dates=20260916)や月単位(dates=202609)の
// クエリはまだ通るため、範囲を「月」単位に分割し、それぞれ取得してから
// 実際に欲しい期間だけに絞り込む方式に変更した。
function dateWindow(daysBack, daysForward) {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - daysBack)
  const to = new Date(now)
  to.setDate(to.getDate() + daysForward)
  return { from, to }
}

// [from, to]区間にまたがる年月(YYYYMM)を重複無く列挙する
function monthsInWindow(from, to) {
  const months = []
  const cur = new Date(from.getFullYear(), from.getMonth(), 1)
  const last = new Date(to.getFullYear(), to.getMonth(), 1)
  while (cur <= last) {
    months.push(`${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
}

// チャンピオンズリーグ(新方式のリーグフェーズ)は1試合日から次の試合日まで
// 約3〜4週間空くことがあり、既定の-3日/+10日の範囲では前回・次回どちらの試合も
// 拾えず「試合が1件も無い」ように見えてしまっていた(2026-09-16、ユーザー指摘で発覚。
// 実際には順位表の消化試合数が示す通り既に試合は行われていた)。
// この競技だけ前後3週間分に広げて、間隔の粗さを吸収する。
const SCOREBOARD_RANGE = { 'uefa.champions': [21, 21] }

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
}

function statVal(entry, name) {
  const s = entry.stats?.find((s) => s.name === name)
  return s ? s.displayValue : ''
}

function normalizeEntry(entry) {
  return {
    id: entry.team?.id,
    team: entry.team?.displayName || entry.team?.name || '',
    shortName: entry.team?.abbreviation || '',
    logo: entry.team?.logos?.[0]?.href || entry.team?.logo || '',
    rank: statVal(entry, 'playoffSeed') || statVal(entry, 'rank'),
    gamesPlayed: statVal(entry, 'gamesPlayed'),
    wins: statVal(entry, 'wins'),
    ties: statVal(entry, 'ties'),
    losses: statVal(entry, 'losses'),
    winPercent: statVal(entry, 'winPercent'),
    gamesBehind: statVal(entry, 'gamesBehind'),
    streak: statVal(entry, 'streak'),
    points: statVal(entry, 'points'),
    goalDiff: statVal(entry, 'pointDifferential')
  }
}

// ESPNの順位表APIはリーグによって階層の深さが違う。MLB/NBAは
// リーグ/カンファレンス(children) > 地区(さらにchildren) > 各チーム、と2階層ネストしており、
// 従来はこの1階層目(アメリカンリーグ/ナショナルリーグ=15チームずつ)で止めていたため、
// 本来の「地区別」順位表(ア・ナ各リーグ東地区/中地区/西地区=5チームずつ×6)にならず、
// ユーザーから「違う、もう少し細かいはず」と指摘された(2026-09-12)。
// 子(children)を持つノードは実体の無い中間集計なので、子が無くなる末端までずっと辿る。
function collectStandingsGroups(node) {
  if (node.children && node.children.length > 0) {
    return node.children.flatMap(collectStandingsGroups)
  }
  return [{ name: node.name, entries: node.standings?.entries || [] }]
}

// ESPNのstandings.entriesはグループ(地区/カンファレンス)ごとに必ずしも成績順に並んでおらず、
// 特に地区別(level=3)で取得すると、そのグループ内の実際の勝敗と無関係な順番で返ってくることがある
// (例: ドジャースが地区首位なのに配列の3番目に来る)。表示側で必ず勝率(無ければ勝点)の高い順に
// 並べ直す(ユーザー指摘、2026-09-13「ドジャースとかの順位がおかしい」)。
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const aHasWinPercent = a.winPercent !== ''
    const bHasWinPercent = b.winPercent !== ''
    if (aHasWinPercent || bHasWinPercent) {
      return parseFloat(b.winPercent || '0') - parseFloat(a.winPercent || '0')
    }
    return parseInt(b.points || '0', 10) - parseInt(a.points || '0', 10)
  })
}

function normalizeStandings(data) {
  const groups =
    data.children && data.children.length > 0
      ? data.children.flatMap(collectStandingsGroups)
      : [{ name: data.name, entries: data.standings?.entries || [] }]
  return groups
    .map((g) => ({
      groupName: g.name,
      rows: sortRows((g.entries || []).map(normalizeEntry))
    }))
    .filter((g) => g.rows.length > 0)
}

function normalizeEvent(ev) {
  const comp = ev.competitions?.[0]
  const competitors = comp?.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home')
  const away = competitors.find((c) => c.homeAway === 'away')
  const statusType = ev.status?.type || {}
  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    statusDetail: statusType.shortDetail || statusType.description || '',
    isLive: statusType.state === 'in',
    isFinal: Boolean(statusType.completed),
    venue: comp?.venue?.fullName || '',
    home: {
      id: home?.team?.id || '',
      team: home?.team?.displayName || '',
      score: home?.score ?? '',
      logo: home?.team?.logo || ''
    },
    away: {
      id: away?.team?.id || '',
      team: away?.team?.displayName || '',
      score: away?.score ?? '',
      logo: away?.team?.logo || ''
    },
    // プレーオフ期間中、ESPNは対戦カードに"シリーズ何勝何敗か"の情報(series)を付けてくることがある
    // (例: "Lakers lead series 2-1")。レギュラーシーズン中はこのフィールド自体が無いので、
    // その場合はnullのまま(表示側は無ければ何も出さないだけで、壊れない)。
    // 2026-09シーズンのプレーオフがまだ始まっておらず実データで形を確認できていないため、
    // 生の値をそのまま渡すだけにしておき、実際にプレーオフが始まったら表示側を仕上げる。
    series: comp?.series?.summary ? { summary: comp.series.summary, title: comp.series.title || '' } : null
  }
}

function normalizeScoreboard(data) {
  return (data.events || []).map(normalizeEvent)
}

// levelを明示しないと、このAPIはデフォルトでリーグ/カンファレンス止まりの集計
// (MLBならアメリカンリーグ/ナショナルリーグの15チームずつ)しか返してくれない
// (2026-09-12、実データで確認して発覚)。ただし「細かければ良い」わけではなく、
// スポーツごとに慣習的な単位が違う: MLBは地区別(東/中/西=level3)、
// NBAはカンファレンス別(東/西=level2)で見るのが一般的、とユーザーから指摘された(2026-09-13)。
// サッカーは地区の概念が無い1枚のリーグ表なので指定不要(levelを省略)。
// NFLもMLBと同じく地区別(AFC/NFC × East/North/South/West=8地区×4チーム)で見るのが
// 一般的な慣習なのでlevel=3にする(2026-09-13、NFL追加時)。
const STANDINGS_LEVEL = { mlb: 3, nba: 2, nfl: 3 }

// 月ごとに分割してscoreboardを取得し、実際に欲しい[from, to]の範囲だけに絞り込んで返す。
async function fetchScoreboardWindow(sportPath, leaguePath, daysBack, daysForward) {
  const { from, to } = dateWindow(daysBack, daysForward)
  const months = monthsInWindow(from, to)
  const results = await Promise.all(
    months.map((ym) => fetchJson(`${BASE}/site/v2/sports/${sportPath}/${leaguePath}/scoreboard?dates=${ym}`))
  )
  const byId = new Map()
  for (const data of results) {
    for (const ev of normalizeScoreboard(data)) {
      byId.set(ev.id, ev)
    }
  }
  const fromTime = from.getTime()
  const toTime = to.getTime()
  return [...byId.values()]
    .filter((ev) => {
      const t = new Date(ev.date).getTime()
      return t >= fromTime && t <= toTime
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

async function fetchLeague(sportPath, leaguePath) {
  const range = SCOREBOARD_RANGE[leaguePath] || [3, 10]
  const level = STANDINGS_LEVEL[leaguePath]
  const standingsUrl = `${BASE}/v2/sports/${sportPath}/${leaguePath}/standings${level ? `?level=${level}` : ''}`
  const [standingsRaw, games] = await Promise.all([
    fetchJson(standingsUrl),
    fetchScoreboardWindow(sportPath, leaguePath, range[0], range[1])
  ])
  return {
    standings: normalizeStandings(standingsRaw),
    games,
    updatedAt: new Date().toISOString()
  }
}

async function main() {
  mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })
  const results = []
  for (const [sportPath, leaguePath] of TARGETS) {
    const key = `${sportPath}-${leaguePath}`
    try {
      const data = await fetchLeague(sportPath, leaguePath)
      writeFileSync(new URL(`../public/data/${key}.json`, import.meta.url), JSON.stringify(data))
      console.log(`ok: ${key} (standings groups=${data.standings.length}, games=${data.games.length})`)
      results.push({ key, ok: true })
    } catch (err) {
      // 通常のconsole.errorだけだとGitHub Actionsの実行ログを見ないと原因が分からず、
      // ログ閲覧には管理者権限が要る(このプロジェクトでは開発者側から見れないことがある)。
      // ::error::形式にしておくと、ログを開かなくてもAnnotations(公開APIから取得可能)に
      // 実際のエラー内容が出るようになる(2026-09-17、原因調査のため追加)。
      console.log(`::error::FAILED ${key}: ${err.message}`)
      results.push({ key, ok: false, error: err.message })
    }
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length === results.length) {
    // 全滅した場合だけビルド/コミットを失敗させる(一部リーグの不調では失敗させない)
    console.log(`::error::全リーグのデータ取得に失敗しました: ${failed.map((f) => `${f.key}=${f.error}`).join(' | ')}`)
    throw new Error('全リーグのデータ取得に失敗しました')
  }
  if (failed.length > 0) {
    console.warn(`一部失敗: ${failed.map((f) => f.key).join(', ')}`)
  }
}

main()
