export type SavedLocation = {
  city: string
  stateCode: string
  stateName: string
  label: string
  latitude: number
  longitude: number
}

const STORAGE_KEY = 'golf-homiez:selected-location'

export function loadSavedLocation(): SavedLocation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SavedLocation
  } catch {
    return null
  }
}

export function saveLocation(location: SavedLocation | null) {
  try {
    if (!location) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location))
  } catch {
    // ignore storage failures
  }
}
