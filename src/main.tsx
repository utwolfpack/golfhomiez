import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import AppErrorBoundary from './components/AppErrorBoundary'
import { initClientLogging, logClientEvent } from './lib/clientLogger'

initClientLogging()
logClientEvent('client_bootstrap_start', 'React application bootstrap started')

const rootElement = document.getElementById('root')

if (!rootElement) {
  logClientEvent('missing_root_element', 'Root element not found during bootstrap', {}, 'error')
  throw new Error('Root element #root not found')
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </React.StrictMode>
  )
  logClientEvent('client_bootstrap_rendered', 'React root render call completed')
} catch (error) {
  logClientEvent('client_bootstrap_failed', 'React bootstrap failed before render completed', {
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { value: String(error) },
  }, 'error')
  throw error
}
