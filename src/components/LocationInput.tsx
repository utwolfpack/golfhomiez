import { useEffect, useRef, useState } from 'react'
import { searchLocations } from '../lib/locations'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'
import UseMyLocationButton from './UseMyLocationButton'

type Props = {
  value: SavedLocation | null
  onChange: (next: SavedLocation | null) => void
}

export default function LocationInput({ value, onChange }: Props) {
  const [query, setQuery] = useState(value?.label || '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<SavedLocation[]>([])
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

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      return
    }

    const requestId = ++searchRequestId.current
    setIsLoadingSuggestions(true)
    setHelperText(null)

    const timer = window.setTimeout(() => {
      searchLocations(trimmed, 8)
        .then((results) => {
          if (requestId !== searchRequestId.current) return
          setSuggestions(results)
          if (!results.length) setHelperText('No matching cities were found. Keep typing to refine the search.')
        })
        .catch(() => {
          if (requestId !== searchRequestId.current) return
          setSuggestions([])
          setHelperText('Location suggestions are temporarily unavailable. You can keep typing.')
        })
        .finally(() => {
          if (requestId === searchRequestId.current) setIsLoadingSuggestions(false)
        })
    }, 250)

    return () => window.clearTimeout(timer)
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
        <UseMyLocationButton
          onResolved={(location) => {
            onChange(location)
            setQuery(location.label)
            setShowSuggestions(false)
            setHelperText(`Location set to ${location.label}.`)
            saveLocation(location)
          }}
          onStatus={setHelperText}
        />
      </div>
      {showSuggestions ? (
        <div className="locationSuggestions">
          {query.trim().length < 2 ? <div className="small" style={{ padding: 8 }}>Type at least 2 characters to search locations.</div> : null}
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
        {helperText || 'Type ahead suggests matching US cities from the server. Use the location button to fill the field from your device location.'}
      </div>
    </div>
  )
}
