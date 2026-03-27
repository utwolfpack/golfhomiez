import React from 'react'
import { logClientEvent } from '../lib/clientLogger'

type State = {
  hasError: boolean
  message: string
}

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error',
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logClientEvent('react_render_error', 'React error boundary captured a render failure', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      componentStack: errorInfo.componentStack,
    }, 'error')
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center' }}>
          <section>
            <h1>Something went wrong loading GolfHomiez.</h1>
            <p>{this.state.message}</p>
            <p>Please refresh the page. The error details were logged for diagnosis.</p>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
