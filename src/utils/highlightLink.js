// 試合ごとのハイライト動画を確実に一意に特定できる無料APIは無いため、
// 「ハイライト動画そのものへの埋め込み」ではなく「YouTube内で検索した結果に飛ぶ」方式にする
// (推しボクサーのX/ニュース検索リンクと同じ考え方)。GameList.jsx(サッカー/NBA/MLB/NFL)と
// BoxingView.jsx(ボクシング)の両方から使う共通ヘルパー。
export function highlightSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}
