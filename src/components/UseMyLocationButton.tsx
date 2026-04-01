import { useState } from 'react'
import { resolveMyLocationFromBrowser } from '../lib/locations'
import { logFrontendEvent } from '../lib/frontend-logger'
import type { SavedLocation } from '../lib/location-store'

type Props = {
  className?: string
  label?: string
  onResolved: (location: SavedLocation) => void | Promise<void>
  onStatus?: (message: string | null) => void
}

export default function UseMyLocationButton({ className = 'btn', label = 'Use my location', onResolved, onStatus }: Props) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    onStatus?.(null)
    logFrontendEvent({ category: 'location.resolve', message: 'started' })

    try {
      const location = await resolveMyLocationFromBrowser()
      await onResolved(location)
      onStatus?.(`Location set to ${location.label}.`)
      logFrontendEvent({ category: 'location.resolve', message: 'succeeded', data: { label: location.label, stateCode: location.stateCode } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Location lookup failed.'
      onStatus?.(message)
      logFrontendEvent({ category: 'location.resolve', level: 'error', message: 'failed', data: { error: message } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={className} onClick={handleClick} disabled={busy}>
      {busy ? 'Detecting…' : label}
    </button>
  )
}
