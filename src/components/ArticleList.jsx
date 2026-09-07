import { useState } from 'react'

export default function ArticleList({ articles }) {
  const [openId, setOpenId] = useState(null)

  if (!articles || articles.length === 0) {
    return <p className="muted">読み物はまだありません</p>
  }

  return (
    <div className="article-list">
      {articles.map((a) => {
        const isOpen = openId === a.id
        return (
          <div key={a.id} className="article-card">
            <button
              type="button"
              className="article-card-header"
              onClick={() => setOpenId(isOpen ? null : a.id)}
            >
              <span className="article-card-title">{a.title}</span>
              <span className="article-card-toggle">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="article-card-body">
                {a.body.split('\n\n').map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
