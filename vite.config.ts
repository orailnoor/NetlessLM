import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    dedupe: ['onnxruntime-web']
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['aether-mark.svg'],
      manifest: {
        name: 'NetlessLM Local AI',
        short_name: 'NetlessLM',
        description: 'Private, browser-native AI that runs on your device.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/aether-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        globIgnores: [
          '**/text-worker-*.js',
          '**/media-worker-*.js',
          '**/audio-model-*.js',
          '**/transformers.web-*.js',
          '**/pdf-*.js',
          '**/pdf.worker-*.js',
          '**/mammoth.browser-*.js',
          '**/*.wasm'
        ],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/huggingface\.co\//,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022'
  }
});
