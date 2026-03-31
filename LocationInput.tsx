import { useEffect, useMemo, useRef, useState } from 'react'
import { searchLocations } from '../lib/locations'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'

type Props = {
  value: SavedLocation | null
  onChange: (next: SavedLocation | null) => void
}

export default function LocationInput({ value, onChange }: Props) {
  const [query, setQuery] = useState(value?.label || '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [helperText, setHelperText] = useState<string | null>(null)
  const blurTimer = useRef<number | null>(null)

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
      setHelperText(`Loaded saved location: ${saved.label}`)
    }
  }, [])

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
            setHelperText(null)
            if (value && e.target.value !== value.label) onChange(null)
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Start typing a city or state"
          autoComplete="off"
        />
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
        {helperText || 'Type ahead will suggest matching US cities. Registration no longer detects your current location automatically.'}
      </div>
    </div>
  )
}
