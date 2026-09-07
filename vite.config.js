import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 試合スコアAPIは常に最新を取りに行きたいのでSWのキャッシュ対象に含めない
        navigateFallbackDenylist: [/^\/apis\//]
      }
    })
  ]
})
