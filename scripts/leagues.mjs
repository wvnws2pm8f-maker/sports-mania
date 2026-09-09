// ESPNデータ取得スクリプト群(fetch-espn-data.mjs / fetch-team-details.mjs)で共有する
// [sportPath, leaguePath] の組み合わせ。src/components/*View.jsx が使っているものと一致させること。
export const TARGETS = [
  ['soccer', 'eng.1'],
  ['soccer', 'esp.1'],
  ['soccer', 'ita.1'],
  ['soccer', 'ger.1'],
  ['soccer', 'fra.1'],
  ['soccer', 'uefa.champions'],
  ['basketball', 'nba'],
  ['baseball', 'mlb']
]

// 表示用のリーグ名(hot-teams.json等、リーグ横断の一覧に使う)。src/data/leagues.jsと一致させること。
export const LEAGUE_NAMES = {
  'eng.1': 'プレミアリーグ',
  'esp.1': 'ラ・リーガ',
  'ita.1': 'セリエA',
  'ger.1': 'ブンデスリーガ',
  'fra.1': 'リーグ・アン',
  'uefa.champions': 'チャンピオンズリーグ',
  nba: 'NBA',
  mlb: 'MLB'
}
