import { useEffect, useRef, useState } from 'react'
import { getNearestLocation, searchLocations } from '../lib/locations'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'

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

  useEffect(() => {
    if (!showSuggestions) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      return
    }

    const requestId = ++searchRequestId.current
    setIsLoadingSuggestions(true)
    searchLocations(query, 8)
      .then((results) => {
        if (requestId !== searchRequestId.current) return
        setSuggestions(results)
      })
      .catch(() => {
        if (requestId !== searchRequestId.current) return
        setSuggestions([])
        setHelperText('Location suggestions are temporarily unavailable. You can keep typing.')
      })
      .finally(() => {
        if (requestId === searchRequestId.current) setIsLoadingSuggestions(false)
      })
  }, [query, showSuggestions])

  function detectNearestLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setHelperText('Location detection is not available in this browser.')
      return
    }

    setIsDetecting(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const nearest = await getNearestLocation(position.coords.latitude, position.coords.longitude)
          if (nearest) {
            onChange(nearest)
            setQuery(nearest.label)
            setHelperText(`Nearest detected location selected: ${nearest.label}`)
            saveLocation(nearest)
          } else {
            setHelperText('No nearby location match was found. You can still type to search.')
          }
        } catch {
          setHelperText('Location lookup failed. You can still type to search.')
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
