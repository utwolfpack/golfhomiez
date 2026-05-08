import { getCorrelationId } from './frontend-logger'

export function getTournamentQrCodeUrl(tournamentId?: string | null): string {
  const id = String(tournamentId || '').trim()
  if (!id) return ''
  const params = new URLSearchParams({ cid: getCorrelationId() })
  return `/api/tournament-portals/${encodeURIComponent(id)}/qr-code.svg?${params.toString()}`
}
