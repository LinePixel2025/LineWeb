import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// 异步加载字体 — 不阻塞首屏渲染
// @fontsource/instrument-serif 的 CSS 文件包含 font-face 声明和 local() 回退
const loadFonts = () => {
  import('@fontsource/instrument-serif/latin-400.css')
  import('@fontsource/instrument-serif/latin-400-italic.css')
}

// 首屏渲染后再加载字体（requestIdleCallback 回退到 100ms 延迟）
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(loadFonts)
  } else {
    setTimeout(loadFonts, 100)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
