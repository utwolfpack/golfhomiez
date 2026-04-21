import { useEffect, useState } from 'react'
import { searchGolfCourses, type GolfCourseOption } from '../lib/golf-courses'

export function useGolfCourseOptions({ state, query, enabled = true, limit = 50 }: { state?: string; query?: string; enabled?: boolean; limit?: number }) {
  const [courses, setCourses] = useState<GolfCourseOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!enabled) {
      setCourses([])
      setLoading(false)
      setError(null)
      return () => {
        active = false
      }
    }

    const trimmedQuery = String(query || '').trim()
    if (!trimmedQuery && !state) {
      setCourses([])
      setLoading(false)
      setError(null)
      return () => {
        active = false
      }
    }

    setLoading(true)
    setError(null)
    const timer = globalThis.setTimeout(async () => {
      try {
        const next = await searchGolfCourses({ state, query: trimmedQuery, limit })
        if (active) setCourses(next)
      } catch (err) {
        if (active) {
          setCourses([])
          setError(err instanceof Error ? err.message : 'Could not load golf courses.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 150)

    return () => {
      active = false
      globalThis.clearTimeout(timer)
    }
  }, [enabled, state, query, limit])

  return { courses, loading, error }
}
