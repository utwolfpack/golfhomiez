import { useEffect, useMemo, useRef, useState } from 'react'
import { getNearestLocation, searchLocations } from '../lib/locations'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'

type Props = {
  value: SavedLocation | null
  onChange: (next: SavedLocation | null) => void
}

export default function LocationInput({ value, onChange }: Props) {
  const [query, setQuery] = useState(value?.label || '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<SavedLocation[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [helperText, setHelperText] = useState<string | null>(null)
  const blurTimer = useRef<number | null>(null)
  const debounceTimer = useRef<number | null>(null)
  const searchRequestId = useRef(0)
  const trimmedQuery = useMemo(() => query.trim(), [query])

  useEffect(() => {
    setQuery(value?.label || '')
  }, [value?.label])

  useEffect(() => {
    if (value) {
      saveLocation(value)
      return
    }

    const saved = loadSavedLocation()
    if (saved) {
      onChange(saved)
      setQuery(saved.label)
    }
  }, [])

  useEffect(() => {
    if (!showSuggestions) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      return
    }

    if (trimmedQuery.length < 2) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      setHelperText('Type at least 2 characters to search for a city or state.')
      return
    }

    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current)
    }

    const requestId = ++searchRequestId.current
    setIsLoadingSuggestions(true)
    debounceTimer.current = window.setTimeout(() => {
      logFrontendEvent({
        category: 'location.lookup',
        message: 'location_search_started',
        data: { correlationId: getCorrelationId(), query: trimmedQuery },
      })

      searchLocations(trimmedQuery, 8)
        .then((results) => {
          if (requestId !== searchRequestId.current) return
          setSuggestions(results)
          setHelperText(results.length ? null : 'No matching cities were found yet. Keep typing.')
        })
        .catch((error: unknown) => {
          if (requestId !== searchRequestId.current) return
          setSuggestions([])
          setHelperText('Location suggestions are temporarily unavailable. You can keep typing.')
          logFrontendEvent({
            category: 'location.lookup',
            level: 'error',
            message: 'location_search_failed',
            data: {
              correlationId: getCorrelationId(),
              query: trimmedQuery,
              error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
            },
          })
        })
        .finally(() => {
          if (requestId === searchRequestId.current) setIsLoadingSuggestions(false)
        })
    }, 180)

    return () => {
      if (debounceTimer.current) {
        window.clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [trimmedQuery, showSuggestions])

  function detectNearestLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setHelperText('Location detection is not available in this browser.')
      return
    }

    setIsDetecting(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          logFrontendEvent({
            category: 'location.lookup',
            message: 'location_nearest_started',
            data: {
              correlationId: getCorrelationId(),
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            },
          })
          const nearest = await getNearestLocation(position.coords.latitude, position.coords.longitude)
          if (nearest) {
            onChange(nearest)
            setQuery(nearest.label)
            setHelperText(`Nearest detected location selected: ${nearest.label}`)
            saveLocation(nearest)
          } else {
            setHelperText('No nearby location match was found. You can still type to search.')
          }
        } catch (error) {
          setHelperText('Location lookup failed. You can still type to search.')
          logFrontendEvent({
            category: 'location.lookup',
            level: 'error',
            message: 'location_nearest_failed',
            data: {
              correlationId: getCorrelationId(),
              error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
            },
          })
        } finally {
          setIsDetecting(false)
        }
      },
      () => {
        setHelperText('Location access was unavailable. You can still type to search.')
        setIsDetecting(false)
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
    )
  }

  function selectLocation(next: SavedLocation) {
    onChange(next)
    setQuery(next.label)
    setShowSuggestions(false)
    setHelperText(`Selected ${next.label}`)
    saveLocation(next)
    logFrontendEvent({
      category: 'location.lookup',
      message: 'location_selected',
      data: { correlationId: getCorrelationId(), label: next.label },
    })
  }

  function handleBlur() {
    blurTimer.current = window.setTimeout(() => setShowSuggestions(false), 120)
  }

  function handleFocus() {
    if (blurTimer.current) window.clearTimeout(blurTimer.current)
    setShowSuggestions(true)
  }

  return (
    <div className="locationBox">
      <label className="label">Location</label>
      <div className="locationBoxControl">
        <input
          className="input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowSuggestions(true)
            if (value && e.target.value !== value.label) onChange(null)
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Start typing a city or state"
          autoComplete="off"
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            setShowSuggestions(false)
            setHelperText(null)
            detectNearestLocation()
          }}
          disabled={isDetecting}
        >
          {isDetecting ? 'Detecting…' : 'Use my location'}
        </button>
      </div>
      {showSuggestions ? (
        <div className="locationSuggestions">
          {isLoadingSuggestions ? <div className="small" style={{ padding: 8 }}>Loading location suggestions…</div> : null}
          {!isLoadingSuggestions && suggestions.map((item) => (
            <button
              type="button"
              key={`${item.city}|${item.stateCode}|${item.latitude}|${item.longitude}`}
              className="locationSuggestion"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectLocation(item)}
            >
              <span>{item.city}, {item.stateCode}</span>
              <span className="small">{item.stateName}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="small" style={{ marginTop: 8 }}>
        {helperText || 'Type at least 2 characters to search the server-backed US city index. Use the location button any time if you want to detect the nearest city.'}
      </div>
    </div>
  )
}
