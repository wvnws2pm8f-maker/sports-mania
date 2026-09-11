// アプリ内で自動収集はできない(静的サイトにはニュースを検索する仕組みが無い)ので、
// 代わりにX/Googleニュースの検索結果に一発で飛べるリンクを用意する。
// BoxingViewとHomeView(推し選手の詳細)の両方から使う共通部品。
export default function SearchLinks({ name }) {
  return (
    <div className="search-links-row">
      <a
        className="search-link-button"
        href={`https://twitter.com/search?q=${encodeURIComponent(name)}&f=live`}
        target="_blank"
        rel="noreferrer"
      >
        𝕏 で検索
      </a>
      <a
        className="search-link-button"
        href={`https://www.google.com/search?q=${encodeURIComponent(name)}&tbm=nws`}
        target="_blank"
        rel="noreferrer"
      >
        🔍 ニュース検索
      </a>
    </div>
  )
}
