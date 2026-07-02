import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'

type IgolfViewerConfig = {
  enabled: boolean
  apiKey: string
  key: string
  scriptUrl: string
  style: string
  substyle: string
  colorAccent: string
  scorecard?: boolean
}

type CourseTour3DViewApi = {
  initialize: (options: Record<string, unknown>) => Promise<unknown>
  deinitialize?: (handler: unknown) => void
}

type Props = {
  courseId?: string | null
  holeNumber: number
}

let igolfViewerScriptPromise: Promise<void> | null = null

function loadIgolfViewerScript(scriptUrl: string) {
  if (typeof document === 'undefined') return Promise.resolve()
  if ((window as any).CourseTour3DView) return Promise.resolve()
  if (igolfViewerScriptPromise) return igolfViewerScriptPromise

  igolfViewerScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-igolf-viewer="true"][src="${scriptUrl}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('iGolf 3D viewer script failed to load.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = scriptUrl
    script.async = true
    script.dataset.igolfViewer = 'true'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('iGolf 3D viewer script failed to load.')), { once: true })
    document.head.appendChild(script)
  })

  return igolfViewerScriptPromise
}

export default function IgolfHoleViewer({ courseId, holeNumber }: Props) {
  const containerId = useMemo(() => `igolf-hole-viewer-${Math.random().toString(36).slice(2)}`, [])
  const handlerRef = useRef<unknown>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    const correlationId = getCorrelationId()

    async function initializeViewer() {
      if (!courseId) {
        setStatus('iGolf course viewer is unavailable until a course is selected.')
        return
      }

      setStatus('Loading iGolf hole viewer…')
      logFrontendEvent({ category: 'igolf.viewer', message: 'started', data: { correlationId, courseId, holeNumber } })

      try {
        const config = await api<IgolfViewerConfig>('/api/igolf-viewer-config')
        if (cancelled) return
        if (!config.enabled) {
          setStatus('iGolf 3D viewer is not configured for this environment.')
          logFrontendEvent({ category: 'igolf.viewer', level: 'warn', message: 'not_configured', data: { correlationId, courseId, holeNumber } })
          return
        }

        await loadIgolfViewerScript(config.scriptUrl)
        if (cancelled) return

        const viewerApi = (window as any).CourseTour3DView as CourseTour3DViewApi | undefined
        if (!viewerApi?.initialize) throw new Error('iGolf 3D viewer API was not found after the script loaded.')

        const handler = await viewerApi.initialize({
          apiKey: config.apiKey,
          key: config.key,
          id_course: courseId,
          el: containerId,
          style: config.style || 'a',
          substyle: config.substyle || 'v1',
          colorAccent: config.colorAccent || '#0094cc',
          initHoleNumber: holeNumber,
          singleHole: true,
          scorecard: Boolean(config.scorecard),
        })
        if (cancelled) {
          viewerApi.deinitialize?.(handler)
          return
        }
        handlerRef.current = handler
        setStatus('')
        logFrontendEvent({ category: 'igolf.viewer', message: 'succeeded', data: { correlationId, courseId, holeNumber, style: config.style, substyle: config.substyle } })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'iGolf 3D viewer could not be loaded.'
        setStatus(message)
        logFrontendEvent({ category: 'igolf.viewer', level: 'error', message: 'failed', data: { correlationId, courseId, holeNumber, error: message } })
      }
    }

    void initializeViewer()

    return () => {
      cancelled = true
      const handler = handlerRef.current
      handlerRef.current = null
      const viewerApi = (window as any).CourseTour3DView as CourseTour3DViewApi | undefined
      if (handler && viewerApi?.deinitialize) {
        try {
          viewerApi.deinitialize(handler)
        } catch (error) {
          logFrontendEvent({ category: 'igolf.viewer', level: 'warn', message: 'deinitialize_failed', data: { correlationId, courseId, holeNumber, error: error instanceof Error ? error.message : String(error) } })
        }
      }
    }
  }, [courseId, holeNumber, containerId])

  return (
    <div className="igolfHoleViewerShell" aria-label={`iGolf 3D viewer for hole ${holeNumber}`}>
      <div id={containerId} className="igolfHoleViewer" />
      {status ? <div className="small igolfHoleViewerStatus">{status}</div> : null}
    </div>
  )
}
