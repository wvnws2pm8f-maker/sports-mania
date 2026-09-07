import { useState } from 'react'
import boxingData from '../data/boxingSchedule.json'
import { articles } from '../data/articles.js'
import ArticleList from './ArticleList.jsx'

const boxingArticles = articles.filter((a) => a.sport === 'boxing')
const SUB_TABS = ['試合予定', '読み物']

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`
}

export default function BoxingView() {
  const [subTab, setSubTab] = useState('試合予定')

  return (
    <div className="sport-panel">
      <div className="sub-tab-row">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`sub-tab ${subTab === t ? 'is-active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {subTab === '試合予定' && (
        <>
          <p className="muted boxing-note">
            ※ ボクシングは自動データ更新に対応する無料APIが無いため、手動で更新しています（最終更新: {boxingData.updatedAt}）
          </p>
          <div className="game-list">
            {boxingData.fights.map((f, i) => (
              <div key={i} className="game-card boxing-card">
                <div className="game-card-status">{formatDate(f.date)}</div>
                <div className="boxing-card-title">{f.cardName}</div>
                <div className="boxing-card-venue">📍 {f.venue}</div>
                {f.broadcast && <div className="boxing-card-broadcast">📺 {f.broadcast}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {subTab === '読み物' && <ArticleList articles={boxingArticles} />}
    </div>
  )
}
