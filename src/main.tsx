import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { installGlobalFrontendLogging, logFrontendEvent } from './lib/frontend-logger'

installGlobalFrontendLogging()

const rootElement = document.getElementById('root')

if (!rootElement) {
  logFrontendEvent({
    level: 'error',
    category: 'bootstrap',
    message: 'root_element_missing',
    data: {
      htmlLength: document.documentElement?.outerHTML?.length || null,
    },
  })
  throw new Error('React root element not found')
}

logFrontendEvent({
  category: 'bootstrap',
  message: 'react_render_starting',
})

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
