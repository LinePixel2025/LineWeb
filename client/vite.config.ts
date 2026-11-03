import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    // 旧 Android WebView / iPad Safari：生成 ES5 兼容包 + 按使用情况注入 core-js polyfill。
    // 现代浏览器仍加载 modern chunk，不会变慢；只有旧内核走 nomodule 的传统包。
    legacy({
      targets: ['chrome >= 40', 'safari >= 9', 'ios >= 9', 'not dead'],
      modernTargets: ['chrome >= 61', 'safari >= 11', 'ios >= 11'],
      // 只补现代包里真正用到的 API，避免给所有现代浏览器多塞 140KB core-js
      modernPolyfills: [
        'es.promise.all-settled',
        'es.promise.finally',
        'es.object.from-entries',
        'es.array.flat-map',
        'web.queue-microtask',
      ],
      renderLegacyChunks: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Vite 6 默认目标是 chrome107+，对旧 WebView 太新；显式降到 Safari 11 / Chrome 61 语法级别
    target: ['chrome61', 'safari11'],
    cssCodeSplit: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@lexical') || id.includes('node_modules/lexical')) {
            return 'lexical'
          }
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'vendor'
          }
          if (id.includes('node_modules/react')) {
            return 'vendor'
          }
          if (id.includes('node_modules/@tanstack/react-query')) {
            return 'query'
          }
          // Markdown / LaTeX 渲染链（AI 对话、首页助手、Markdown 预览）：
          // 只有打开对应页面时才需要，单独分包避免拖累主包。
          if (/node_modules\/(marked|marked-katex-extension|katex|dompurify)/.test(id)) {
            return 'markdown'
          }
          // three.js（我的世界体素渲染）：只有游戏页懒加载，独立分包避免污染主包
          if (id.includes('node_modules/three')) {
            return 'three'
          }
          // foliate-js（EPUB 阅读引擎，vendored 在 src 下）：只在打开 EPUB 时动态加载
          if (id.includes('lib/reader/foliate/')) {
            return 'foliate'
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // 聊天图片同源直链（只代理图片前缀，避免影响 SPA 的 /chat 路由）
      '^/chat/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // 网页反代：/proxy/:siteId/* 与 WebSocket 中继 /proxy-ws/:siteId
      // 必须先匹配 /proxy-ws（带 ws: true），否则会被 /proxy 前缀吃掉
      '^/proxy-ws': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '^/proxy/': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
