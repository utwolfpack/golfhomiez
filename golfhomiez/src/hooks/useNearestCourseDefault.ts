import { useEffect, useState } from 'react'

export function useNearestCourseDefault(
  state: string,
  currentCourse: string,
  setCourse: (value: string) => void,
  fallbackCourses: string[],
) {
  const [locationStatus, setLocationStatus] = useState<'idle' | 'manual' | 'unavailable'>('idle')

  useEffect(() => {
    if (!fallbackCourses.length) {
      setCourse('')
      setLocationStatus('unavailable')
      return
    }

    if (currentCourse && fallbackCourses.includes(currentCourse)) {
      setLocationStatus('manual')
      return
    }

    setCourse(fallbackCourses[0] || '')
    setLocationStatus('manual')
  }, [state, currentCourse, fallbackCourses, setCourse])

  return locationStatus
}
