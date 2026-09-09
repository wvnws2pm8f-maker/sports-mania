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
  { id: 'home', name: 'ホーム', emoji: '🏠' },
  { id: 'soccer', name: 'サッカー', emoji: '⚽' },
  { id: 'nba', name: 'NBA', emoji: '🏀' },
  { id: 'mlb', name: 'MLB', emoji: '⚾' },
  { id: 'boxing', name: 'ボクシング', emoji: '🥊' }
]

// ホーム画面(注目カード・好調チーム検出)が全リーグを横断してスキャンするための一覧。
// SportPanelの各Viewが使うsportPath/leaguePathと一致させること。
export const allLeagueTargets = [
  ...soccerLeagues.map((l) => ({ sportPath: 'soccer', leaguePath: l.id, leagueName: l.name })),
  { sportPath: 'basketball', leaguePath: 'nba', leagueName: 'NBA' },
  { sportPath: 'baseball', leaguePath: 'mlb', leagueName: 'MLB' }
]
