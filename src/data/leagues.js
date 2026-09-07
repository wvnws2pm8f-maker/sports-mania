// サッカーはリーグが複数あるので選べるようにする。
// id は ESPN API の leaguePath としてそのまま使う。
export const soccerLeagues = [
  { id: 'eng.1', name: 'プレミアリーグ', country: 'イングランド' },
  { id: 'esp.1', name: 'ラ・リーガ', country: 'スペイン' },
  { id: 'ita.1', name: 'セリエA', country: 'イタリア' },
  { id: 'ger.1', name: 'ブンデスリーガ', country: 'ドイツ' },
  { id: 'fra.1', name: 'リーグ・アン', country: 'フランス' },
  { id: 'uefa.champions', name: 'チャンピオンズリーグ', country: '欧州全体' }
]

export const sports = [
  { id: 'soccer', name: 'サッカー', emoji: '⚽' },
  { id: 'nba', name: 'NBA', emoji: '🏀' },
  { id: 'mlb', name: 'MLB', emoji: '⚾' },
  { id: 'boxing', name: 'ボクシング', emoji: '🥊' }
]
