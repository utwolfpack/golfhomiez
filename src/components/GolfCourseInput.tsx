import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { findNearestGolfCourse, MAX_COURSE_SEARCH_LIMIT, type GolfCourseOption } from '../lib/golf-courses'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { useGolfCourseOptions } from '../hooks/useGolfCourseOptions'
import { loadSavedLocation } from '../lib/location-store'

function normalizeText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function courseOptionKey(course: GolfCourseOption) {
  return `${course.state || course.state_code || ''}::${course.id || ''}::${course.name}`.toLowerCase()
}

function formatDistanceFromYards(value: number | null | undefined) {
  const yards = Number(value)
  if (!Number.isFinite(yards) || yards < 0) return ''
  if (yards >= 1760) return `${(yards / 1760).toFixed(yards >= 17600 ? 0 : 1)} mi away`
  return `${Math.round(yards)} yd away`
}

function getBrowserCoordinates(): Promise<{ latitude: number; longitude: number; accuracy?: number | null; source: 'browser' | 'saved' }> {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, source: 'browser' }),
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      )
    })
  }
  return Promise.reject(new Error('Browser geolocation is unavailable.'))
}

function getSavedCoordinates(): { latitude: number; longitude: number; accuracy?: number | null; source: 'saved' } | null {
  const saved = loadSavedLocation()
  const latitude = Number(saved?.latitude)
  const longitude = Number(saved?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude, accuracy: null, source: 'saved' }
}

export default function GolfCourseInput({
  label = 'Course',
  state,
  searchValue,
  selectedCourseName,
  selectedCourseId = '',
  onSearchChange,
  onCourseSelected,
  onStateChange,
  placeholder = 'Search courses in the selected state',
  disabled = false,
  required = false,
  helperText,
  inputId,
  limit = MAX_COURSE_SEARCH_LIMIT,
  enableNearestDefault = false,
}: {
  label?: string
  state?: string
  searchValue: string
  selectedCourseName: string
  selectedCourseId?: string
  onSearchChange: (next: string) => void
  onCourseSelected: (course: GolfCourseOption) => void
  onStateChange?: (nextState: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  helperText?: string | null
  inputId?: string
  limit?: number
  enableNearestDefault?: boolean
}) {
  const generatedInputId = useId()
  const id = inputId || generatedInputId
  const inputRef = useRef<HTMLInputElement | null>(null)
  const nearestAttemptedRef = useRef(false)
  const manualInputRef = useRef(false)
  const [focused, setFocused] = useState(false)
  const [nearestStatus, setNearestStatus] = useState<'idle' | 'detecting' | 'needs_confirmation' | 'confirmed' | 'manual' | 'unavailable'>('idle')
  const [nearestMessage, setNearestMessage] = useState<string | null>(null)
  const [nearestSuggestion, setNearestSuggestion] = useState<GolfCourseOption | null>(null)
  const inputValue = searchValue || selectedCourseName
  const normalizedInputValue = normalizeText(inputValue).toLowerCase()
  const normalizedSelectedName = normalizeText(selectedCourseName).toLowerCase()
  const { courses, loading, error } = useGolfCourseOptions({
    state,
    query: inputValue,
    enabled: !disabled && Boolean(state),
    limit,
    minQueryLength: 0,
  })

  const uniqueCourses = useMemo(() => {
    const seen = new Set<string>()
    return courses.filter((course) => {
      const key = courseOptionKey(course)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [courses])

  const visibleCourses = useMemo(() => uniqueCourses.slice(0, 12), [uniqueCourses])
  const showResults = Boolean(state) && !disabled && focused

  const selectCourse = useCallback((course: GolfCourseOption, source: 'exact_match' | 'result_click' | 'nearest_default') => {
    if (source === 'result_click') {
      manualInputRef.current = true
      setNearestSuggestion(null)
      setNearestStatus('manual')
      setNearestMessage(null)
    }
    logFrontendEvent({
      category: 'golf-courses.search',
      message: 'course_selected',
      data: {
        correlationId: getCorrelationId(),
        source,
        state: state || course.state || course.state_code || '',
        courseId: course.id || '',
        courseName: course.name || '',
      },
    })
    onCourseSelected(course)
  }, [onCourseSelected, state])

  useEffect(() => {
    if (!enableNearestDefault || disabled || nearestAttemptedRef.current || selectedCourseName || searchValue) return
    nearestAttemptedRef.current = true
    let active = true
    const correlationId = getCorrelationId()

    async function applyNearestCourseDefault() {
      setNearestStatus('detecting')
      setNearestMessage('Checking your device location for the closest golf course…')
      logFrontendEvent({ category: 'golf-courses.nearest_default', message: 'started', data: { correlationId, state: state || '' } })

      let coordinates: { latitude: number; longitude: number; accuracy?: number | null; source: 'browser' | 'saved' } | null = null
      try {
        coordinates = await getBrowserCoordinates()
      } catch (error) {
        coordinates = getSavedCoordinates()
        logFrontendEvent({ category: 'golf-courses.nearest_default', level: coordinates ? 'warn' : 'info', message: 'browser_location_unavailable', data: { correlationId, fallback: coordinates?.source || null, error: error instanceof Error ? error.message : String(error) } })
      }

      if (!active || manualInputRef.current) return
      if (!coordinates) {
        setNearestStatus('unavailable')
        setNearestMessage('Location is unavailable. Type a course name to search the selected state.')
        return
      }

      try {
        const nearest = await findNearestGolfCourse({ latitude: coordinates.latitude, longitude: coordinates.longitude })
        if (!active || manualInputRef.current) return
        if (!nearest) {
          setNearestStatus('unavailable')
          setNearestMessage('No nearby course with location data was found. Type a course name to search the selected state.')
          logFrontendEvent({ category: 'golf-courses.nearest_default', level: 'warn', message: 'no_course_found', data: { correlationId, source: coordinates.source } })
          return
        }

        const nearestState = String(nearest.state || nearest.state_code || '').trim().toUpperCase()
        if (nearestState && onStateChange) onStateChange(nearestState)
        setNearestSuggestion(nearest)
        setNearestStatus('needs_confirmation')
        const distanceLabel = formatDistanceFromYards(nearest.distanceYards ?? nearest.distance_yards)
        setNearestMessage(`Nearest course selected from your device location: ${nearest.name}${distanceLabel ? ` (${distanceLabel})` : ''}.`)
        selectCourse(nearest, 'nearest_default')
        logFrontendEvent({ category: 'golf-courses.nearest_default', message: 'course_applied', data: { correlationId, source: coordinates.source, courseId: nearest.id || '', courseName: nearest.name || '', state: nearestState, distanceYards: nearest.distanceYards ?? nearest.distance_yards ?? null } })
      } catch (error) {
        if (!active) return
        setNearestStatus('unavailable')
        setNearestMessage('Nearest course lookup is unavailable. Type a course name to search the selected state.')
        logFrontendEvent({ category: 'golf-courses.nearest_default', level: 'warn', message: 'failed', data: { correlationId, error: error instanceof Error ? error.message : String(error) } })
      }
    }

    void applyNearestCourseDefault()
    return () => { active = false }
  }, [disabled, enableNearestDefault, onStateChange, searchValue, selectCourse, selectedCourseName, state])

  useEffect(() => {
    if (!normalizedInputValue || !uniqueCourses.length) return
    const exactMatch = uniqueCourses.find((course) => normalizeText(course.name).toLowerCase() === normalizedInputValue)
    if (!exactMatch) return
    if (selectedCourseId && exactMatch.id === selectedCourseId) return
    if (!selectedCourseId && normalizedSelectedName === normalizedInputValue) return
    selectCourse(exactMatch, 'exact_match')
  }, [normalizedInputValue, normalizedSelectedName, selectedCourseId, selectCourse, uniqueCourses])

  function handleSearchChange(next: string) {
    manualInputRef.current = true
    setNearestSuggestion(null)
    setNearestStatus('manual')
    setNearestMessage(null)
    onSearchChange(next)
  }

  function confirmNearestCourse() {
    if (!nearestSuggestion) return
    setNearestStatus('confirmed')
    setNearestMessage(`Confirmed course: ${nearestSuggestion.name}.`)
    logFrontendEvent({ category: 'golf-courses.nearest_default', message: 'confirmed', data: { correlationId: getCorrelationId(), courseId: nearestSuggestion.id || '', courseName: nearestSuggestion.name || '', state: nearestSuggestion.state || nearestSuggestion.state_code || '' } })
  }

  function focusCourseSearchForChange() {
    manualInputRef.current = true
    setNearestSuggestion(null)
    setNearestStatus('manual')
    setNearestMessage('Type a course name to change the selected course.')
    inputRef.current?.focus()
    inputRef.current?.select()
  }

  return (
    <div className="courseSearchField">
      <label className="label" htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        className="input"
        type="search"
        value={inputValue}
        onChange={(event) => handleSearchChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => setFocused(false), 120)
        }}
        placeholder={placeholder}
        aria-label="Course search"
        aria-autocomplete="list"
        aria-controls={`${id}-results`}
        autoComplete="off"
        disabled={disabled || !state}
        required={required}
      />
      {selectedCourseName ? <div className="small" style={{ marginTop: 6 }}>Selected: {selectedCourseName}</div> : null}
      {nearestMessage ? (
        <div className={`courseNearestConfirmation courseNearestConfirmation--${nearestStatus}`} aria-live="polite">
          <span>{nearestMessage}</span>
          {nearestSuggestion && nearestStatus === 'needs_confirmation' ? (
            <span className="courseNearestConfirmationActions">
              <button type="button" className="btnTiny" onClick={confirmNearestCourse}>Confirm course</button>
              <button type="button" className="btnTiny btnTinySecondary" onClick={focusCourseSearchForChange}>Change</button>
            </span>
          ) : null}
        </div>
      ) : null}
      {helperText ? <div className="small" style={{ marginTop: 6 }}>{helperText}</div> : null}
      {!state ? <div className="small" style={{ marginTop: 6 }}>Select a state before searching courses.</div> : null}
      {showResults ? (
        <div id={`${id}-results`} className="courseSearchResults" role="listbox" aria-label="Golf course search results">
          {loading ? <div className="courseSearchStatus">Searching all available courses for the selected state…</div> : null}
          {!loading && error ? <div className="courseSearchStatus courseSearchStatus--error">{error}</div> : null}
          {!loading && !error && visibleCourses.length === 0 ? <div className="courseSearchStatus">No courses found for this state and search.</div> : null}
          {!loading && !error ? visibleCourses.map((course) => (
            <button
              key={courseOptionKey(course)}
              type="button"
              className="courseSearchResultButton"
              role="option"
              aria-selected={Boolean((selectedCourseId && course.id === selectedCourseId) || (!selectedCourseId && normalizeText(course.name).toLowerCase() === normalizedSelectedName))}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                selectCourse(course, 'result_click')
                inputRef.current?.blur()
              }}
            >
              <span>{course.name}</span>
              <span className="courseSearchResultMeta">{[course.city, course.state || course.state_code, course.parTotal || course.par ? `Par ${course.parTotal || course.par}` : ''].filter(Boolean).join(' · ')}</span>
            </button>
          )) : null}
          {!loading && !error && uniqueCourses.length > visibleCourses.length ? (
            <div className="courseSearchStatus">Showing {visibleCourses.length} of {uniqueCourses.length}. Keep typing to narrow the results.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
