import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
// 自托管 Inter（可变字重，latin 子集 48KB）：Apple 设备命中 SF Pro，其余平台命中 Inter
import '@fontsource-variable/inter'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
