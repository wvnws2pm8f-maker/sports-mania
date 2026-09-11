// 「推し」チーム・選手の登録。このアプリにはログイン機能が無いため、
// この端末(このブラウザ)のlocalStorageにだけ保存する(他の端末とは同期されない)。
const TEAMS_KEY = 'sportsmania:favoriteTeams'
const PLAYERS_KEY = 'sportsmania:favoritePlayers'

function readList(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は黙って諦める(致命的ではない)
  }
}

// team: { sportPath, leaguePath, teamId, name, logo }
export function getFavoriteTeams() {
  return readList(TEAMS_KEY)
}

export function isFavoriteTeam(sportPath, teamId) {
  return getFavoriteTeams().some((t) => t.sportPath === sportPath && t.teamId === teamId)
}

// 登録済みなら解除、未登録なら登録する。戻り値は「登録された(true)/解除された(false)」
export function toggleFavoriteTeam(team) {
  const list = getFavoriteTeams()
  const idx = list.findIndex((t) => t.sportPath === team.sportPath && t.teamId === team.teamId)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(team)
  writeList(TEAMS_KEY, list)
  return idx < 0
}

// player: { sportPath, leaguePath, teamId, playerId, name, jersey, position, headshot, teamName, teamLogo }
export function getFavoritePlayers() {
  return readList(PLAYERS_KEY)
}

export function isFavoritePlayer(sportPath, playerId) {
  return getFavoritePlayers().some((p) => p.sportPath === sportPath && p.playerId === playerId)
}

export function toggleFavoritePlayer(player) {
  const list = getFavoritePlayers()
  const idx = list.findIndex((p) => p.sportPath === player.sportPath && p.playerId === player.playerId)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(player)
  writeList(PLAYERS_KEY, list)
  return idx < 0
}

// ボクシングにはチーム/ロスターの概念が無く、選手(ボクサー)単体を推し登録する。
// playerIdはESPNの選手IDが無いので、名前そのものをキーに使う(同名衝突のリスクはあるが、
// この規模のアプリでは十分実用的)。
export function isFavoriteBoxer(name) {
  return isFavoritePlayer('boxing', name)
}

export function toggleFavoriteBoxer(name) {
  return toggleFavoritePlayer({
    sportPath: 'boxing',
    leaguePath: null,
    teamId: null,
    playerId: name,
    name,
    jersey: '',
    position: '',
    headshot: '',
    teamName: '',
    teamLogo: ''
  })
}
