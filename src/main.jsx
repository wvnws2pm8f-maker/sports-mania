import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import './styles.css'

// PWAのService Workerを自前で登録し、更新を積極的に反映させる。
// 以前はvite-plugin-pwaが自動生成する最小限のregisterSW.jsに任せていたが、あれは
// ただ register() するだけで、更新チェックの仕組みが無かった。
// ホーム画面/Dockに追加した「開きっぱなしのアプリ」はページ遷移が起きないため、
// ブラウザが自発的に新しいService Workerを探しに行くタイミングがほぼ無く、
// 結果として「サーバー側は更新されているのにアプリだけ古いまま」になり、
// ユーザーが手動でアプリを完全終了→再起動しないと直らない、という不具合が繰り返し起きていた。
// (2026-09-10、複数回にわたって発覚)
//
// ここでは1分おきに能動的に更新の有無を確認し、新しいバージョンが見つかったら
// 自動でページをリロードして反映させる(ユーザーに再起動をお願いする必要が無くなる)。
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        registration.update()
      }, 60 * 1000)
    },
    onNeedRefresh() {
      updateSW(true) // 新しいSWをすぐに有効化させ、ページをリロードする
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
