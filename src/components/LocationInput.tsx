import { useEffect, useMemo, useState } from 'react'
import { US_STATES } from '../data/usStates'
import { loadSavedLocation, saveLocation, type SavedLocation } from '../lib/location-store'

type Props = {
  value: SavedLocation | null
  onChange: (next: SavedLocation | null) => void
}

function buildLocation(city: string, stateCode: string): SavedLocation | null {
  const trimmedCity = city.trim()
  const state = US_STATES.find((item) => item.abbr === stateCode)
  if (!trimmedCity || !state) return null

  return {
    city: trimmedCity,
    stateCode: state.abbr,
    stateName: state.name,
    label: `${trimmedCity}, ${state.abbr} · ${state.name}`,
    latitude: 0,
    longitude: 0,
  }
}

export default function LocationInput({ value, onChange }: Props) {
  const [city, setCity] = useState(value?.city || '')
  const [stateCode, setStateCode] = useState(value?.stateCode || '')
  const [helperText, setHelperText] = useState<string | null>(null)

  useEffect(() => {
    setCity(value?.city || '')
    setStateCode(value?.stateCode || '')
  }, [value?.city, value?.stateCode])

  useEffect(() => {
    if (value) {
      saveLocation(value)
      return
    }

    const saved = loadSavedLocation()
    if (saved) {
      onChange(saved)
      setCity(saved.city)
      setStateCode(saved.stateCode)
      setHelperText(`Using saved location: ${saved.label}`)
    }
  }, [])

  const selectedStateName = useMemo(() => {
    return US_STATES.find((item) => item.abbr === stateCode)?.name || ''
  }, [stateCode])

  function updateLocation(nextCity: string, nextStateCode: string) {
    const next = buildLocation(nextCity, nextStateCode)
    onChange(next)
    saveLocation(next)

    if (!nextCity.trim() && !nextStateCode) {
      setHelperText(null)
      return
    }

    if (!nextCity.trim()) {
      setHelperText('Enter your city to finish setting your location.')
      return
    }

    if (!nextStateCode) {
      setHelperText('Choose your state to finish setting your location.')
      return
    }

    setHelperText(`Selected ${next?.label}`)
  }

  return (
    <div className="locationBox">
      <label className="label">Location</label>
      <div className="formRow formRow--split">
        <div>
          <input
            className="input"
            value={city}
            onChange={(e) => {
              const nextCity = e.target.value
              setCity(nextCity)
              updateLocation(nextCity, stateCode)
            }}
            placeholder="City"
            autoComplete="address-level2"
          />
        </div>

        <div>
          <select
            className="input"
            value={stateCode}
            onChange={(e) => {
              const nextStateCode = e.target.value
              setStateCode(nextStateCode)
              updateLocation(city, nextStateCode)
            }}
            autoComplete="address-level1"
          >
            <option value="">Select state</option>
            {US_STATES.map((state) => (
              <option key={state.abbr} value={state.abbr}>
                {state.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        {helperText || (selectedStateName ? `City, ${selectedStateName}` : 'Enter your city and choose your state.')}
      </div>
    </div>
  )
}
