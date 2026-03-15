import { useEffect, useState } from 'react'
import { findNearestCourseForState, type CourseGeoPoint } from '../data/courseDetails'

export function useNearestCourseDefault(
  state: string,
  currentCourse: string,
  setCourse: (value: string) => void,
  fallbackCourses: string[],
) {
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'>('idle')

  useEffect(() => {
    let cancelled = false

    if (!fallbackCourses.length) {
      setCourse('')
      return () => {
        cancelled = true
      }
    }

    if (currentCourse && fallbackCourses.includes(currentCourse)) {
      return () => {
        cancelled = true
      }
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationStatus('unavailable')
      setCourse(fallbackCourses[0] || '')
      return () => {
        cancelled = true
      }
    }

    setLocationStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setLocationStatus('granted')
        const point: CourseGeoPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }
        const nearest = findNearestCourseForState(state, point)
        setCourse(nearest?.name || fallbackCourses[0] || '')
      },
      () => {
        if (cancelled) return
        setLocationStatus('denied')
        setCourse(fallbackCourses[0] || '')
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )

    return () => {
      cancelled = true
    }
  }, [state, currentCourse, fallbackCourses, setCourse])

  return locationStatus
}
