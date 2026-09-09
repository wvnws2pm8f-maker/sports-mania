// 「今週末の注目カード」で優先的に拾い上げる伝統の一戦・人気カード。
// team idはpublic/data/team/<sportPath>-<teamId>.jsonのファイル名と対応する
// (scripts/fetch-team-details.mjsが書き出すものと同じESPNのteam.id)。
// ここに無い組み合わせの試合は、順位表の首位同士の対戦を自動的に拾う(HomeView.jsx)。
export const rivalries = [
  // ---- サッカー ----
  { sportPath: 'soccer', teamIds: ['86', '83'], label: 'エル・クラシコ' }, // Real Madrid vs Barcelona
  { sportPath: 'soccer', teamIds: ['382', '360'], label: 'マンチェスター・ダービー' }, // Man City vs Man United
  { sportPath: 'soccer', teamIds: ['359', '367'], label: '北ロンドン・ダービー' }, // Arsenal vs Tottenham
  { sportPath: 'soccer', teamIds: ['364', '368'], label: 'マージーサイド・ダービー' }, // Liverpool vs Everton
  { sportPath: 'soccer', teamIds: ['103', '110'], label: 'ミラノ・ダービー' }, // AC Milan vs Inter
  { sportPath: 'soccer', teamIds: ['132', '124'], label: 'デア・クラシカー' }, // Bayern Munich vs Borussia Dortmund
  { sportPath: 'soccer', teamIds: ['160', '176'], label: 'ル・クラシック' }, // PSG vs Marseille
  { sportPath: 'soccer', teamIds: ['86', '1068'], label: 'マドリード・ダービー' }, // Real Madrid vs Atlético Madrid

  // ---- NBA ----
  { sportPath: 'basketball', teamIds: ['13', '2'], label: 'レイカーズ vs セルティックス' },
  { sportPath: 'basketball', teamIds: ['18', '17'], label: 'ニックス vs ネッツ' },

  // ---- MLB ----
  { sportPath: 'baseball', teamIds: ['10', '2'], label: 'ヤンキース vs レッドソックス' },
  { sportPath: 'baseball', teamIds: ['19', '26'], label: 'ドジャース vs ジャイアンツ' },
  { sportPath: 'baseball', teamIds: ['16', '24'], label: 'カブス vs カージナルス' }
]
