// ホーム画面「🏆 チャンピオンへの道」用: MLB/NBAの公式シーズン日程(ESPNのcore API)から
// 「プレーオフ(ポストシーズン)まであと何日か」を正確に計算する。
// 適当な日付を決め打ちすると信頼を損ねるため、必ず実データから計算する。
import { writeFileSync } from 'node:fs'

const CORE_BASE = 'http://sports.core.api.espn.com/v2/sports'

async function fetchSeasonType(sportPath, leaguePath, year, type) {
  const url = `${CORE_BASE}/${sportPath}/leagues/${leaguePath}/seasons/${year}/types/${type}?lang=en&region=us`
  const res = await fetch(url, { headers: { 'User-Agent': 'sports-mania-app/1.0 (data sync script)' } })
  if (!res.ok) return null
  const j = await res.json()
  if (!j.startDate || !j.endDate) return null
  return { name: j.name, type: j.type, startDate: j.startDate, endDate: j.endDate }
}

// ESPNの「シーズン年」のラベル付けは競技によって違う(MLBはカレンダー年、NBAはシーズン終了年)。
// 決め打ちせず、今年と来年の両方を取得して、実際に「今」を含む/これから始まる区間を選ぶ。
async function findMilestones(sportPath, leaguePath) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const types = [1, 2, 3] // 1=プレシーズン 2=レギュラーシーズン 3=ポストシーズン
  const entries = []
  for (const year of [thisYear, thisYear + 1]) {
    for (const type of types) {
      const t = await fetchSeasonType(sportPath, leaguePath, year, type)
      if (t) entries.push(t)
    }
  }

  const nowMs = now.getTime()
  const current = entries.find((e) => nowMs >= new Date(e.startDate).getTime() && nowMs <= new Date(e.endDate).getTime())
  // プレシーズン(type 1)はファン向けの「盛り上がり」としては弱いので、次のマイルストーンには含めない
  // (例: NBAのオフシーズン中は「プレシーズン開幕まで」ではなく「開幕(レギュラーシーズン)まで」を示す)
  const upcoming = entries
    .filter((e) => e.type !== 1 && new Date(e.startDate).getTime() > nowMs)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))

  const postseason = entries.find((e) => e.type === 3 && new Date(e.startDate).getTime() > nowMs)
  const inPostseason = current?.type === 3

  return {
    currentPhase: current?.name || null,
    inPostseason,
    postseasonStart: postseason?.startDate || null,
    nextMilestone: upcoming[0] || null // 直近に控えているフェーズ(プレシーズン開幕/開幕/プレーオフ開幕など)
  }
}

async function main() {
  const result = {}
  for (const [key, sportPath, leaguePath] of [
    ['mlb', 'baseball', 'mlb'],
    ['nba', 'basketball', 'nba']
  ]) {
    try {
      result[key] = await findMilestones(sportPath, leaguePath)
      console.log(`ok: ${key}`, JSON.stringify(result[key]))
    } catch (err) {
      console.error(`FAILED: ${key}: ${err.message}`)
    }
  }
  writeFileSync(
    new URL('../public/data/season-milestones.json', import.meta.url),
    JSON.stringify({ ...result, updatedAt: new Date().toISOString() })
  )
  console.log('done.')
}

main()
