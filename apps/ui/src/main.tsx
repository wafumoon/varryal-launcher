import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './theme/global.css'
import './i18n/index'

// Suppress the WebView2/Chromium right-click context menu app-wide.
document.addEventListener('contextmenu', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
