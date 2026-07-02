import { useEffect, useState } from 'react'
import { fetchGolfCourseStates, type GolfCourseStateOption } from '../lib/golf-courses'

export function useGolfCourseStates(enabled = true) {
  const [states, setStates] = useState<GolfCourseStateOption[]>([])
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    setError('')
    fetchGolfCourseStates()
      .then((results) => {
        if (cancelled) return
        setStates(results)
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setStates([])
        setError(err instanceof Error ? err.message : 'Golf course states are temporarily unavailable.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return { states, loading, error }
}
