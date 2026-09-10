import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 自動生成される最小限のregisterSW.js(ただregister()するだけで更新チェックが無い)は使わず、
      // src/main.jsxでvirtual:pwa-registerのregisterSW()を自前で呼び、1分おきの更新確認+
      // 見つかり次第の自動リロードを行う(2026-09-10、Dockアプリが更新に気づかない不具合の対策)。
      injectRegister: false,
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'マニアスタジアム',
        short_name: 'マニアスタジアム',
        description: 'サッカー・NBA・MLB・ボクシングをマニアックに追いかける観戦アプリ',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        lang: 'ja',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        // public/data/ は15分〜1日おきに中身が変わる動的データ(試合結果・ニュース・ロスター等)。
        // globPatternsの json にマッチして毎回ビルド時点のスナップショットとしてSWにキャッシュされて
        // しまい、「サーバー側は更新されているのにアプリだけ古い表示のまま」になるバグの原因だった
        // (2026-09-10発覚)。ここは常にネットワークから取りに行きたいので、precache対象から除外する。
        globIgnores: ['data/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 試合スコアAPIは常に最新を取りに行きたいのでSWのキャッシュ対象に含めない
        navigateFallbackDenylist: [/^\/apis\//]
      }
    })
  ]
})
