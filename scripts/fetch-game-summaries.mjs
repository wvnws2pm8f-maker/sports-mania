// 試合詳細(得点者・出場選手・打撃/投手成績など)取得スクリプト。
// 「試合をタップしたら誰がゴールを決めたか/誰がホームランを打ったか知りたい」という
// 要望(2026-09-17)に対応する。
//
// 【重要な注意】ESPNの summary?event={id} エンドポイントの正確なJSON構造は、
// このプロジェクトの開発環境からはESPNへの直接アクセスがブロックされており実地検証できていない。
// そのため、複数のありうるフィールド名を候補として試し、見つかった範囲だけを保存する
// 「取れたものだけ出す、無ければ何も壊れない」設計にしている。将来、実際にコミットされた
// データを見てフィールド名が違うと分かった場合はここを直せばよい(前回の順位表level=3問題や
// series情報と同じ、段階的に実データで補正していく方針)。
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { TARGETS } from './leagues.mjs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports'
// 直近に終了した試合だけを対象にする(全期間分だと呼び出し数が膨れ上がるため)。
// これから起きる試合には詳細データが存在しないので対象外。
const RECENT_DAYS = 6
const CONCURRENCY = 4

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }
  return res.json()
}

async function runPool(items, limit, worker) {
  const results = []
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      try {
        results[idx] = { ok: true, value: await worker(items[idx]) }
      } catch (err) {
        results[idx] = { ok: false, error: err }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
  return results
}

// サッカー: 得点イベントを拾う。
// 2026-09-17、実際に0-0以外の試合(バルセロナ7-2ラシン・サンタンデール)でgoalsが
// 常にnullになる不具合が発覚し、外部ドキュメント(sportsdataverse-pyのESPN summary解説)で
// 裏取りしたところ、正しくは summary.keyEvents 配列(header.competitions[0].detailsではない)で、
// 各イベントは scoringPlay という真偽値フラグを持つ、と判明した。
// それでも万一フィールド名が違った場合に備え、旧パス(header.competitions[0].details)も
// フォールバックとして残し、type.textの正規表現判定も併用する。
function extractSoccerGoals(summary) {
  const keyEvents = summary?.keyEvents || summary?.header?.competitions?.[0]?.details || []
  const goals = keyEvents.filter((d) => d?.scoringPlay === true || /goal/i.test(d?.type?.text || d?.type?.id || ''))
  if (goals.length === 0) return null
  return goals.map((d) => ({
    minute: d.clock?.displayValue || '',
    scorer: d.athletesInvolved?.[0]?.displayName || d.athletesInvolved?.[0]?.athlete?.displayName || '',
    teamId: d.team?.id || '',
    ownGoal: /own goal/i.test(d?.text || d?.shortText || d?.type?.text || ''),
    penalty: /penalty|\(pen\.?\)|pk/i.test(d?.text || d?.shortText || d?.type?.text || '')
  }))
}

// NBA/MLB/NFL: 試合の主要選手成績(リーダー)。summary.leadersは
// [{ team: {id}, leaders: [{ name, displayName, leaders: [{ athlete: {displayName}, displayValue }] }] }]
// という形が一般的だが、未検証のためオプショナルチェーンで安全に辿る。
function extractLeaders(summary) {
  const leadersByTeam = summary?.leaders || summary?.boxscore?.players || []
  if (!Array.isArray(leadersByTeam) || leadersByTeam.length === 0) return null
  const result = []
  for (const teamBlock of leadersByTeam) {
    const teamId = teamBlock?.team?.id
    const categories = teamBlock?.leaders || teamBlock?.statistics || []
    for (const cat of categories) {
      const top = cat?.leaders?.[0] || cat?.athletes?.[0]
      const athleteName = top?.athlete?.displayName || top?.athlete?.shortName
      const value = top?.displayValue
      if (athleteName && value) {
        result.push({ teamId, category: cat.displayName || cat.name || cat.abbreviation || '', athlete: athleteName, value })
      }
    }
  }
  return result.length > 0 ? result : null
}

// 野球の打撃/投手成績。boxscore.players[].statistics[]にbatting/pitchingの区分があり、
// 各athleteのstatsを含む形を想定(未検証・best effort)。ホームラン・勝敗投手だけ抜き出す。
function extractBaseballHighlights(summary) {
  const teams = summary?.boxscore?.players || []
  if (!Array.isArray(teams) || teams.length === 0) return null
  const result = []
  for (const teamBlock of teams) {
    const teamId = teamBlock?.team?.id
    for (const group of teamBlock?.statistics || []) {
      const isBatting = /batting|hitting/i.test(group?.name || group?.type || '')
      const isPitching = /pitching/i.test(group?.name || group?.type || '')
      if (!isBatting && !isPitching) continue
      const labels = group?.labels || group?.keys || []
      const hrIdx = labels.findIndex((l) => /^HR$/i.test(l))
      const decIdx = labels.findIndex((l) => /^DEC$/i.test(l))
      for (const athlete of group?.athletes || []) {
        const name = athlete?.athlete?.displayName
        if (!name) continue
        if (isBatting && hrIdx >= 0 && Number(athlete.stats?.[hrIdx]) > 0) {
          result.push({ teamId, kind: 'HR', athlete: name, value: athlete.stats[hrIdx] })
        }
        if (isPitching && decIdx >= 0 && athlete.stats?.[decIdx]) {
          result.push({ teamId, kind: 'DEC', athlete: name, value: athlete.stats[decIdx] })
        }
      }
    }
  }
  return result.length > 0 ? result : null
}

function extractSummary(sportPath, summary) {
  if (sportPath === 'soccer') return { goals: extractSoccerGoals(summary) }
  if (sportPath === 'baseball') {
    const highlights = extractBaseballHighlights(summary)
    return { highlights, leaders: highlights ? null : extractLeaders(summary) }
  }
  return { leaders: extractLeaders(summary) }
}

function loadExistingGames(sportPath, leaguePath) {
  const path = new URL(`../public/data/${sportPath}-${leaguePath}.json`, import.meta.url)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')).games || []
  } catch {
    return []
  }
}

async function main() {
  mkdirSync(new URL('../public/data/summaries/', import.meta.url), { recursive: true })
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
  let totalOk = 0
  let totalFail = 0

  for (const [sportPath, leaguePath] of TARGETS) {
    const games = loadExistingGames(sportPath, leaguePath)
    const recentFinished = games.filter((g) => g.isFinal && new Date(g.date).getTime() >= cutoff)
    if (recentFinished.length === 0) {
      console.log(`skip: ${sportPath}-${leaguePath} (直近${RECENT_DAYS}日以内に終了した試合なし)`)
      continue
    }

    const outPath = new URL(`../public/data/summaries/${sportPath}-${leaguePath}.json`, import.meta.url)
    const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {}

    const results = await runPool(recentFinished, CONCURRENCY, async (g) => {
      const data = await fetchJson(`${BASE}/${sportPath}/${leaguePath}/summary?event=${g.id}`)
      return { id: g.id, extracted: extractSummary(sportPath, data) }
    })

    const games2 = { ...existing }
    for (const r of results) {
      if (r.ok) {
        games2[r.value.id] = r.value.extracted
        totalOk++
      } else {
        totalFail++
      }
    }
    writeFileSync(outPath, JSON.stringify({ games: games2, updatedAt: new Date().toISOString() }))
    console.log(`ok: ${sportPath}-${leaguePath} (${results.filter((r) => r.ok).length}/${recentFinished.length}件)`)
  }

  console.log(`done. ok=${totalOk} fail=${totalFail}`)
}

main()
