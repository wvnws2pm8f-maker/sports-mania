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
// 各イベントは scoringPlay という真偽値フラグを持つ、と判明した(この部分は実データで動作確認済み、
// 得点イベント自体は正しく拾えている)。
// ただし得点者名は依然として100%「不明」になる不具合が残っていた(2026-09-20発覚)。
// athletesInvolved配列を想定していたが、外部ドキュメント(同じくsportsdataverse-py)を
// 改めて確認したところ、正しくは athlete という単一オブジェクト(配列ではない)に
// { id, displayName } が入っている形と判明。旧パスも万一のフォールバックとして残す。
function extractSoccerGoals(summary) {
  const keyEvents = summary?.keyEvents || summary?.header?.competitions?.[0]?.details || []
  const goals = keyEvents.filter((d) => d?.scoringPlay === true || /goal/i.test(d?.type?.text || d?.type?.id || ''))
  if (goals.length === 0) return null
  return goals.map((d) => ({
    minute: d.clock?.displayValue || '',
    scorer:
      d.athlete?.displayName ||
      d.athletesInvolved?.[0]?.displayName ||
      d.athletesInvolved?.[0]?.athlete?.displayName ||
      d.participants?.[0]?.athlete?.displayName ||
      '',
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
// 各athleteのstatsを含む形を想定。ホームランは実データで動作確認済み(2026-09-18)だが、
// 「DEC」(勝敗)ラベルでの投手成績抽出は実データで1件もヒットせず、ラベル名の想定が
// 誤っていたと判明。「誰が投げたか/誰が出場したか」を知りたいという要望(2026-09-18)には
// 個別の成績値より前に「名前が確実に取れる」ことの方が重要なため、DEC探索は諦めて
// 各グループの選手名をそのまま列挙する方式(extractBaseballLineups)に切り替えた。
function extractBaseballHighlights(summary) {
  const teams = summary?.boxscore?.players || []
  if (!Array.isArray(teams) || teams.length === 0) return null
  const result = []
  for (const teamBlock of teams) {
    const teamId = teamBlock?.team?.id
    for (const group of teamBlock?.statistics || []) {
      const isBatting = /batting|hitting/i.test(group?.name || group?.type || '')
      if (!isBatting) continue
      const labels = group?.labels || group?.keys || []
      const hrIdx = labels.findIndex((l) => /^HR$/i.test(l))
      if (hrIdx < 0) continue
      for (const athlete of group?.athletes || []) {
        const name = athlete?.athlete?.displayName
        if (!name) continue
        if (Number(athlete.stats?.[hrIdx]) > 0) {
          result.push({ teamId, kind: 'HR', athlete: name, value: athlete.stats[hrIdx] })
        }
      }
    }
  }
  return result.length > 0 ? result : null
}

// 野球: 「誰が投げて、誰が出場したか」。個別の成績値(防御率・打率等)はラベル名の想定が
// 外れるリスクがあるため踏み込まず、各チームの投手・野手の名前だけを確実に列挙する
// (2026-09-18、「投手は誰なのか、出場した選手も分かると良い」との要望で追加)。
// 先発投手はstarterフラグがあればそれで判定し、無ければ投手陣の最初の1人を先発扱いにする
// (ESPNの表示順は通常そのまま登板順になっているという一般的な慣習に基づく、未検証の推測)。
function extractBaseballLineups(summary) {
  const teams = summary?.boxscore?.players || []
  if (!Array.isArray(teams) || teams.length === 0) return null
  const lineups = []
  for (const teamBlock of teams) {
    const teamId = teamBlock?.team?.id
    let pitchers = []
    let batters = []
    for (const group of teamBlock?.statistics || []) {
      const names = (group?.athletes || [])
        .map((a) => ({ name: a?.athlete?.displayName, starter: a?.starter === true }))
        .filter((a) => a.name)
      if (/pitching/i.test(group?.name || group?.type || '')) pitchers = names
      else if (/batting|hitting/i.test(group?.name || group?.type || '')) batters = names
    }
    if (pitchers.length > 0 && !pitchers.some((p) => p.starter)) pitchers[0].starter = true
    if (pitchers.length > 0 || batters.length > 0) {
      lineups.push({
        teamId,
        startingPitchers: pitchers.filter((p) => p.starter).map((p) => p.name),
        otherPitchers: pitchers.filter((p) => !p.starter).map((p) => p.name),
        batters: batters.map((b) => b.name)
      })
    }
  }
  return lineups.length > 0 ? lineups : null
}

function extractSummary(sportPath, summary) {
  if (sportPath === 'soccer') return { goals: extractSoccerGoals(summary) }
  if (sportPath === 'baseball') {
    return { highlights: extractBaseballHighlights(summary), lineups: extractBaseballLineups(summary) }
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
