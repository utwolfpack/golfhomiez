import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { installBootDiagnostics, logFrontendEvent } from './lib/frontend-logger'

installBootDiagnostics()
logFrontendEvent('react_bootstrap_start')

const rootElement = document.getElementById('root')
logFrontendEvent('react_root_lookup', { rootFound: Boolean(rootElement) })

ReactDOM.createRoot(rootElement!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
