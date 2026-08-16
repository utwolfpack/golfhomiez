import type { KeyboardEvent, MouseEvent } from 'react'
import type { Tournament } from '../lib/accounts'
import { formatFriendlyDate } from '../lib/time-format'
import { logFrontendEvent } from '../lib/frontend-logger'

function tournamentCounts(tournament: Tournament) {
  const registeredTeamCount = tournament.registeredTeamCount ?? tournament.registrationCount ?? tournament.registrations?.length ?? 0
  const teamSlotLimit = Number(tournament.teamSlotLimit)
  const hasTeamSlotLimit = Number.isFinite(teamSlotLimit) && teamSlotLimit > 0
  const openTeamSlotCount = tournament.openTeamSlotCount ?? (hasTeamSlotLimit ? Math.max(teamSlotLimit - registeredTeamCount, 0) : null)
  return { registeredTeamCount, openTeamSlotCount, hasTeamSlotLimit }
}

function formatTournamentStatus(status?: string | null) {
  const normalized = String(status || 'draft').trim().toLowerCase()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function TournamentManagementPagination({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <nav className="paginationBar tournament-management-pagination" aria-label="Tournament pages">
      <button className="btn btnSmall" type="button" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>Previous</button>
      <span className="small">Page {currentPage} of {totalPages} · {totalItems} tournaments</span>
      <button className="btn btnSmall" type="button" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>Next</button>
    </nav>
  )
}

export default function TournamentManagementLineItem({
  tournament,
  archived = false,
  busy = false,
  onSelect,
  onArchive,
  onRestore,
}: {
  tournament: Tournament
  archived?: boolean
  busy?: boolean
  onSelect?: (tournament: Tournament) => void
  onArchive?: (tournament: Tournament) => void
  onRestore?: (tournament: Tournament) => void
}) {
  const counts = tournamentCounts(tournament)
  const publicStatus = ['published', 'completed'].includes(String(tournament.status || '').toLowerCase())
  const tournamentUrl = !archived && publicStatus ? (tournament.registrationUrl || tournament.portalUrl || null) : null
  const selectable = !archived && Boolean(onSelect)

  const selectTournament = () => {
    if (selectable) onSelect?.(tournament)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selectable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    selectTournament()
  }

  const stopActionClick = (event: MouseEvent) => event.stopPropagation()
  const copyTournamentUrl = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!tournamentUrl) return
    try {
      await navigator.clipboard?.writeText(tournamentUrl)
      logFrontendEvent({ category: 'host.tournaments', message: 'copy_tournament_registration_url', data: { tournamentId: tournament.id, tournamentName: tournament.name } })
    } catch (_) {
      // Clipboard access may be unavailable in some browsers; the visible URL remains selectable.
    }
  }

  return (
    <div
      className={`tournament-management-line${selectable ? ' tournament-management-line--selectable' : ''}${archived ? ' tournament-management-line--archived' : ''}`}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectTournament}
      onKeyDown={onKeyDown}
      aria-label={selectable ? `Edit ${tournament.name}` : undefined}
    >
      <div className="tournament-management-line__body">
        <div className="tournament-management-line__title-row">
          <strong className="tournament-management-line__title">{tournament.name}</strong>
          {archived ? <span className="tournament-management-line__badge">Archived</span> : null}
        </div>
        <div className="tournament-management-line__details">
          <div><span>Tournament Date</span><strong>{tournament.startDate ? formatFriendlyDate(tournament.startDate) : 'Not set'}</strong></div>
          <div><span>Status</span><strong>{formatTournamentStatus(tournament.status)}</strong></div>
          {tournament.organizerName || tournament.organizerEmail ? <div><span>Organizer</span><strong>{tournament.organizerName || tournament.organizerEmail}</strong></div> : null}
          <div><span>Teams Registered</span><strong>{counts.registeredTeamCount}</strong></div>
          {counts.hasTeamSlotLimit && counts.openTeamSlotCount != null ? <div><span>Team Slots Open</span><strong>{counts.openTeamSlotCount}</strong></div> : null}
          {tournamentUrl ? (
            <div className="tournament-management-line__url">
              <span>GOLFER REGISTRATION URL</span>
              <span className="tournament-management-line__url-row">
                <a href={tournamentUrl} onClick={stopActionClick}>{tournamentUrl}</a>
                <button className="btn btnSmall tournament-management-line__copy" type="button" aria-label="Copy golfer registration URL" onClick={copyTournamentUrl}>⧉</button>
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="tournament-management-line__actions" onClick={stopActionClick}>
        {archived ? (
          <button className="btn" type="button" disabled={busy} onClick={() => onRestore?.(tournament)}>{busy ? 'Restoring…' : 'Restore to active'}</button>
        ) : (
          <button className="btn" type="button" disabled={busy} onClick={() => onArchive?.(tournament)}>{busy ? 'Archiving…' : 'Archive'}</button>
        )}
      </div>
    </div>
  )
}
