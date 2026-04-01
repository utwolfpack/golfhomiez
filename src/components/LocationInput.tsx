import { useEffect, useRef, useState } from 'react'
import { getNearestLocation, searchLocations } from '../lib/locations'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'
import { getCorrelationId, sendFrontendLog } from '../lib/frontend-logger'

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
  const searchRequestId = useRef(0)

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

  async function logLocationEvent(message: string, metadata: Record<string, unknown> = {}, level: 'info' | 'error' = 'info') {
    await sendFrontendLog({
      correlationId: getCorrelationId(),
      level,
      type: 'use_my_location',
      message,
      action: 'Use my location',
      status: typeof metadata.status === 'string' ? metadata.status : null,
      route: window.location.pathname,
      metadata,
    })
  }

  useEffect(() => {
    if (!showSuggestions) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      return
    }

    const trimmedQuery = query.trim()
    const requestId = ++searchRequestId.current
    const startedAt = Date.now()
    setIsLoadingSuggestions(true)
    void logLocationEvent('location_suggestions_requested', {
      queryLength: trimmedQuery.length,
      queryPreview: trimmedQuery.slice(0, 32),
      status: 'started',
    })

    searchLocations(query, 8)
      .then((results) => {
        if (requestId !== searchRequestId.current) return
        setSuggestions(results)
        void logLocationEvent('location_suggestions_completed', {
          queryLength: trimmedQuery.length,
          resultCount: results.length,
          durationMs: Date.now() - startedAt,
          status: 'completed',
        })
      })
      .catch((error) => {
        if (requestId !== searchRequestId.current) return
        setSuggestions([])
        setHelperText('Location suggestions are temporarily unavailable. You can keep typing.')
        void logLocationEvent('location_suggestions_failed', {
          queryLength: trimmedQuery.length,
          durationMs: Date.now() - startedAt,
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack || null : null,
        }, 'error')
      })
      .finally(() => {
        if (requestId === searchRequestId.current) setIsLoadingSuggestions(false)
      })
  }, [query, showSuggestions])

  function detectNearestLocation() {
    const startedAt = Date.now()
    void logLocationEvent('use_my_location_clicked', {
      status: 'started',
      hasNavigator: typeof navigator !== 'undefined',
      hasGeolocation: typeof navigator !== 'undefined' && Boolean(navigator.geolocation),
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
      isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      language: typeof navigator !== 'undefined' ? navigator.language : null,
      platform: typeof navigator !== 'undefined' ? navigator.platform : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setHelperText('Location detection is not available in this browser.')
      void logLocationEvent('use_my_location_unsupported', {
        status: 'unsupported',
        durationMs: Date.now() - startedAt,
      }, 'error')
      return
    }

    setIsDetecting(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        void logLocationEvent('use_my_location_geolocation_success', {
          status: 'coords_received',
          durationMs: Date.now() - startedAt,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          positionTimestamp: position.timestamp,
        })

        const lookupStartedAt = Date.now()
        try {
          const nearest = await getNearestLocation(position.coords.latitude, position.coords.longitude)
          if (nearest) {
            onChange(nearest)
            setQuery(nearest.label)
            setHelperText(`Nearest detected location selected: ${nearest.label}`)
            saveLocation(nearest)
            await logLocationEvent('use_my_location_lookup_completed', {
              status: 'selected',
              durationMs: Date.now() - lookupStartedAt,
              totalDurationMs: Date.now() - startedAt,
              label: nearest.label,
              city: nearest.city,
              stateCode: nearest.stateCode,
              stateName: nearest.stateName,
            })
          } else {
            setHelperText('No nearby location match was found. You can still type to search.')
            await logLocationEvent('use_my_location_lookup_completed', {
              status: 'no_match',
              durationMs: Date.now() - lookupStartedAt,
              totalDurationMs: Date.now() - startedAt,
            }, 'error')
          }
        } catch (error) {
          setHelperText('Location lookup failed. You can still type to search.')
          await logLocationEvent('use_my_location_lookup_failed', {
            status: 'lookup_failed',
            durationMs: Date.now() - lookupStartedAt,
            totalDurationMs: Date.now() - startedAt,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack || null : null,
          }, 'error')
        } finally {
          setIsDetecting(false)
        }
      },
      async (error) => {
        setHelperText('Location access was unavailable. You can still type to search.')
        setIsDetecting(false)
        await logLocationEvent('use_my_location_geolocation_failed', {
          status: 'geolocation_failed',
          durationMs: Date.now() - startedAt,
          code: error?.code ?? null,
          message: error?.message || 'Unknown geolocation error',
          permissionState: null,
        }, 'error')
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
    void logLocationEvent('location_suggestion_selected', {
      status: 'selected',
      label: next.label,
      city: next.city,
      stateCode: next.stateCode,
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
        {helperText || 'Type ahead will suggest matching US cities. Use the location button any time if you want to detect the nearest city.'}
      </div>
    </div>
  )
}
