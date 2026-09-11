import { useState } from 'react'
import boxingData from '../data/boxingSchedule.json'
import boxerProfiles from '../data/boxerProfiles.json'
import { articles } from '../data/articles.js'
import { isFavoriteBoxer, toggleFavoriteBoxer, getFavoritePlayers } from '../utils/favorites.js'
import ArticleList from './ArticleList.jsx'

const boxingArticles = articles.filter((a) => a.sport === 'boxing')
const SUB_TABS = ['試合予定', '読み物']

function formatDate(iso) {
  const d = new Date(iso)
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`
}

function findProfile(name) {
  return boxerProfiles.boxers.find((b) => b.name === name) || null
}

// ボクシングにはチーム/ロスターが無いため、選手名そのものに☆を付けて推し登録する。
function FighterChip({ name, onToggle }) {
  const [fav, setFav] = useState(() => isFavoriteBoxer(name))
  return (
    <button
      type="button"
      className={`fighter-chip ${fav ? 'is-active' : ''}`}
      onClick={() => {
        setFav(toggleFavoriteBoxer(name))
        onToggle()
      }}
    >
      {fav ? '★' : '☆'} {name}
    </button>
  )
}

// 試合予定に載っていない選手(まだ次戦が発表されていない等)も、名前を直接入力して推し登録できる。
function AddBoxerForm({ onAdded }) {
  const [name, setName] = useState('')
  return (
    <form
      className="add-boxer-form"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        toggleFavoriteBoxer(trimmed)
        setName('')
        onAdded()
      }}
    >
      <input
        className="add-boxer-input"
        type="text"
        placeholder="選手名を入力(例: 井上尚弥)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="add-boxer-button">
        ☆ 推しに追加
      </button>
    </form>
  )
}

export default function BoxingView() {
  const [subTab, setSubTab] = useState('試合予定')
  const [favBoxers, setFavBoxers] = useState(() => getFavoritePlayers().filter((p) => p.sportPath === 'boxing'))

  function refreshFavBoxers() {
    setFavBoxers(getFavoritePlayers().filter((p) => p.sportPath === 'boxing'))
  }

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
          <AddBoxerForm onAdded={refreshFavBoxers} />

          {favBoxers.length > 0 && (
            <>
              <div className="team-detail-section-title">⭐ 推しボクサー</div>
              <div className="boxer-profile-list">
                {favBoxers.map((p) => {
                  const profile = findProfile(p.name)
                  const nextFight = boxingData.fights.find((f) => (f.fighters || []).includes(p.name))
                  return (
                    <div key={p.name} className="boxer-profile-card">
                      <div className="boxer-profile-name">{p.name}</div>
                      {profile ? (
                        <>
                          <div className="boxer-profile-line">
                            {profile.weightClass} ・ {profile.titles}
                          </div>
                          <div className="boxer-profile-line col-strong">{profile.record}</div>
                          <div className="boxer-profile-note">{profile.note}</div>
                        </>
                      ) : (
                        <div className="muted">
                          プロフィール未登録です。「{p.name}のプロフィールを追加して」と頼んでもらえれば調べて追加します。
                        </div>
                      )}
                      {nextFight ? (
                        <div className="boxer-profile-line">
                          📅 次戦: {formatDate(nextFight.date)} {nextFight.cardName}
                        </div>
                      ) : (
                        <div className="muted">次戦は未発表です</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <p className="muted boxing-note">
            ※ ボクシングは自動データ更新に対応する無料APIが無いため、手動で更新しています（最終更新: {boxingData.updatedAt}）
          </p>
          <div className="game-list">
            {boxingData.fights.map((f, i) => (
              <div key={i} className="game-card boxing-card">
                <div className="game-card-status">{formatDate(f.date)}</div>
                <div className="boxing-card-title">{f.cardName}</div>
                {f.fighters && f.fighters.length > 0 && (
                  <div className="fighter-chip-row">
                    {f.fighters.map((name) => (
                      <FighterChip key={name} name={name} onToggle={refreshFavBoxers} />
                    ))}
                  </div>
                )}
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
