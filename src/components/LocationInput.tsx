import { useEffect, useMemo, useRef, useState } from 'react'
import { getNearestLocation, searchLocations } from '../lib/locations'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'

type Props = {
  value: SavedLocation | null
  onChange: (next: SavedLocation | null) => void
}

export default function LocationInput({ value, onChange }: Props) {
  const [query, setQuery] = useState(value?.label || '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [helperText, setHelperText] = useState<string | null>(null)
  const blurTimer = useRef<number | null>(null)
  const didAutoDetect = useRef(false)

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

  function detectNearestLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setHelperText('Location detection is not available in this browser.')
      return
    }

    setIsDetecting(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearest = getNearestLocation(position.coords.latitude, position.coords.longitude)
        if (nearest) {
          onChange(nearest)
          setQuery(nearest.label)
          setHelperText(`Nearest detected location selected: ${nearest.label}`)
          saveLocation(nearest)
        } else {
          setHelperText('No nearby location match was found. You can still type to search.')
        }
        setIsDetecting(false)
      },
      () => {
        setHelperText('Location access was unavailable. You can still type to search.')
        setIsDetecting(false)
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
    )
  }

  useEffect(() => {
    if (value || didAutoDetect.current) return
    didAutoDetect.current = true
    detectNearestLocation()
  }, [value])

  const suggestions = useMemo(() => {
    if (!showSuggestions) return []
    return searchLocations(query, 8)
  }, [query, showSuggestions])

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
            didAutoDetect.current = true
            setShowSuggestions(false)
            setHelperText(null)
            detectNearestLocation()
          }}
          disabled={isDetecting}
        >
          {isDetecting ? 'Detecting…' : 'Use my location'}
        </button>
      </div>
      {showSuggestions && suggestions.length ? (
        <div className="locationSuggestions">
          {suggestions.map((item) => (
            <button
              type="button"
              key={item.key}
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
        {helperText || 'Type ahead will suggest matching US cities. The nearest detected city is used as the default when location access is allowed.'}
      </div>
    </div>
  )
}
