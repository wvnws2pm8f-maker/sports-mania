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
