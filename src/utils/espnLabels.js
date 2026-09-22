// ESPNの生データ(英語)のうち、アプリ内で頻繁に表示される値を日本語化するための変換関数群。
// Geminiのような外部AI翻訳を使わず、既知のパターンだけを対象にした固定変換にしている
// (試合ステータス・地区名・成績カテゴリ名は種類が限られており、都度AI翻訳するより
// 確実で速く、Gemini側のクォータにも一切影響しない)。
// 未知のパターンは変換せず原文のまま返す(表示が壊れるより、英語のまま見える方がまし)。

const ORDINAL = /(\d+)(st|nd|rd|th)/i

const EXACT_STATUS = {
  final: '試合終了',
  ft: '試合終了',
  'full time': '試合終了',
  'final/ot': '試合終了(OT)',
  halftime: 'ハーフタイム',
  ht: 'ハーフタイム',
  postponed: '延期',
  suspended: '中断',
  canceled: '中止',
  cancelled: '中止',
  scheduled: '試合前',
  'pre-game': '試合前',
  tbd: '未定'
}

// 「見出し・要約しか翻訳されず全文が読めない」等の翻訳改善要望(2026-09-22)を受けて、
// 常時表示される試合ステータス(GameList/GameDetail/TeamDetail)を、Gemini頼みではなく
// 確定パターンの変換で確実に日本語化するために追加。
export function translateGameStatus(text) {
  if (!text) return text
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (EXACT_STATUS[lower]) return EXACT_STATUS[lower]

  // "Final/10", "Final/11" (延長イニング)
  const finalExtra = lower.match(/^final\/(\d+)$/)
  if (finalExtra) return `試合終了(延長${finalExtra[1]}回)`

  // "3:03 - 3rd" (NFL/NBAのライブ: 残り時間 - 第Nピリオド)
  const clockPeriod = trimmed.match(/^(\d+:\d+)\s*-\s*(\d+)(st|nd|rd|th)$/i)
  if (clockPeriod) return `第${clockPeriod[2]}Q ${clockPeriod[1]}`

  // 野球のイニング表記: "Top 3rd" "Bot 5th" / "Bottom 5th" "Mid 7th" "End 2nd"
  const inning = trimmed.match(/^(Top|Bot|Bottom|Mid|End)\s+(\d+)(st|nd|rd|th)$/i)
  if (inning) {
    const n = inning[2]
    const part = inning[1].toLowerCase()
    if (part === 'top') return `${n}回表`
    if (part === 'bot' || part === 'bottom') return `${n}回裏`
    if (part === 'mid') return `${n}回中`
    if (part === 'end') return `${n}回終了`
  }

  // "1st Quarter" / "2nd Quarter" 等(数値部分だけ抜き出して短く表示)
  const quarter = trimmed.match(/^(\d+)(st|nd|rd|th)\s+Quarter$/i)
  if (quarter) return `第${quarter[1]}Q`

  if (ORDINAL.test(trimmed) && /half/i.test(trimmed)) {
    const half = trimmed.match(/^(\d+)(st|nd|rd|th)\s+Half$/i)
    if (half) return half[1] === '1' ? '前半' : '後半'
  }

  return text
}

// ESPN順位表のgroupName(地区・カンファレンス・国内リーグ名)の日本語化。
const EXACT_GROUP = {
  'american league east': 'アメリカンリーグ東地区',
  'american league central': 'アメリカンリーグ中地区',
  'american league west': 'アメリカンリーグ西地区',
  'national league east': 'ナショナルリーグ東地区',
  'national league central': 'ナショナルリーグ中地区',
  'national league west': 'ナショナルリーグ西地区',
  'eastern conference': '東カンファレンス',
  'western conference': '西カンファレンス',
  'afc east': 'AFC東地区',
  'afc north': 'AFC北地区',
  'afc south': 'AFC南地区',
  'afc west': 'AFC西地区',
  'nfc east': 'NFC東地区',
  'nfc north': 'NFC北地区',
  'nfc south': 'NFC南地区',
  'nfc west': 'NFC西地区',
  'league phase': 'リーグフェーズ'
}

// サッカーの国内リーグ順位表は "2026-27 English Premier League" のように
// シーズン+リーグ名の英語1行がそのまま来るため、既知リーグ名だけ日本語に置き換える。
const SOCCER_LEAGUE_NAMES = [
  [/english premier league/i, 'プレミアリーグ'],
  [/italian serie a/i, 'セリエA'],
  [/german bundesliga/i, 'ブンデスリーガ'],
  [/laliga/i, 'ラ・リーガ'],
  [/ligue 1/i, 'リーグ・アン']
]

export function translateGroupName(name) {
  if (!name) return name
  const lower = name.trim().toLowerCase()
  if (EXACT_GROUP[lower]) return EXACT_GROUP[lower]

  for (const [pattern, ja] of SOCCER_LEAGUE_NAMES) {
    if (pattern.test(name)) {
      const season = name.match(/\d{4}-\d{2,4}/)
      return season ? `${ja}(${season[0]})` : ja
    }
  }

  return name
}

// 試合詳細(GameDetail)の「主な選手成績」に出る統計カテゴリ名の日本語化。
const EXACT_STAT_CATEGORY = {
  'batting average': '打率',
  'earned run average': '防御率',
  'home runs': '本塁打',
  'runs batted in': '打点',
  strikeouts: '奪三振',
  wins: '勝利数',
  'passing yards': 'パス獲得ヤード',
  'rushing yards': 'ラッシュ獲得ヤード',
  'receiving yards': 'レシーブ獲得ヤード',
  sacks: 'サック',
  tackles: 'タックル',
  points: '得点',
  rebounds: 'リバウンド',
  assists: 'アシスト'
}

export function translateStatCategory(name) {
  if (!name) return name
  return EXACT_STAT_CATEGORY[name.trim().toLowerCase()] || name
}

// F1のレース結果ステータス("Finished"以外: リタイア理由等)の日本語化。
const EXACT_F1_STATUS = {
  finished: '完走',
  retired: 'リタイア',
  accident: 'アクシデント',
  collision: '接触',
  disqualified: '失格',
  'engine': 'エンジントラブル',
  '+1 lap': '+1周遅れ',
  '+2 laps': '+2周遅れ',
  'did not finish': '未完走',
  'did not qualify': '予選未通過',
  'did not start': '未出走'
}

export function translateF1Status(status) {
  if (!status) return status
  return EXACT_F1_STATUS[status.trim().toLowerCase()] || status
}
