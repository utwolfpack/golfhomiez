import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { emitFrontendStage, installRuntimeDiagnostics } from './lib/frontend-logger'

emitFrontendStage('main_tsx_loaded')
installRuntimeDiagnostics()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = ReactDOM.createRoot(rootElement)
emitFrontendStage('react_root_created')

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

emitFrontendStage('react_render_requested')
