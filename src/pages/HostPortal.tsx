import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'
import { archiveHostTournamentRecord, createHostTournament, restoreHostTournamentRecord, sendHostTournamentInvite, updateHostTournamentRecord, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import TournamentTemplateFields, { TournamentRegistrationDeadlineField, TournamentSummaryField } from '../components/TournamentTemplateFields'
import TournamentStartScheduleManager from '../components/TournamentStartScheduleManager'
import TournamentManagementLineItem, { TournamentManagementPagination } from '../components/TournamentManagementLineItem'
import { fetchHostPortal } from '../lib/host-auth'
import { DEFAULT_TEE_TIME_INTERVAL_MINUTES, DEFAULT_TOURNAMENT_CHECK_IN_TIME, DEFAULT_TOURNAMENT_TEE_TIME, emptyTournamentTemplateData } from '../lib/tournament-templates'
import { getFriendlyTournamentError, validateTournamentForSave } from '../lib/tournament-errors'

const DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT = 24
const TOURNAMENTS_PER_PAGE = 10

type HostPortalState = {
  account?: {
    id?: string | null
    golfCourseName: string
    golfCourseAddress?: string | null
    defaultTournamentLocation?: string | null
    email: string
    isValidated: boolean
  }
  invites?: Array<{ id: string; email: string; golfCourseName: string | null; consumedAt: string | null }>
  tournaments?: Tournament[]
}

function readTeamSlotLimit(value?: number | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT
}

function tournamentStats(tournament: Tournament) {
  const registeredTeamCount = tournament.registeredTeamCount ?? tournament.registrationCount ?? tournament.registrations?.length ?? 0
  const teamSlotLimit = readTeamSlotLimit(tournament.teamSlotLimit)
  return {
    registeredTeamCount,
    verifiedUserCount: tournament.verifiedUserCount ?? 0,
    teamSlotLimit,
    openTeamSlotCount: tournament.openTeamSlotCount ?? Math.max(teamSlotLimit - registeredTeamCount, 0),
  }
}

function tournamentCreatedTimestamp(tournament: Tournament) {
  const parsed = Date.parse(String(tournament.createdAt || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function sortTournamentsByCreatedDescending(tournaments: Tournament[] = []) {
  return [...tournaments].sort((left, right) => tournamentCreatedTimestamp(right) - tournamentCreatedTimestamp(left))
}

function tournamentYear(value?: string | null) {
  if (!value) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date.getFullYear()
}

function tournamentYearOptions(tournaments: Tournament[], currentYear: number) {
  const years = new Set<number>([currentYear])
  tournaments.forEach((tournament) => {
    const year = tournamentYear(tournament.startDate)
    if (year) years.add(year)
  })
  return Array.from(years).sort((a, b) => b - a)
}

function TournamentCapacitySummary({ tournament }: { tournament: Tournament }) {
  const stats = tournamentStats(tournament)
  return (
    <div className="tournament-capacity-grid" aria-label="Tournament team registration summary">
      <div className="card statCardCompact tournament-capacity-card"><div className="statCardLabel">Teams registered</div><div className="statCardValue">{stats.registeredTeamCount}</div></div>
      <div className="card statCardCompact tournament-capacity-card"><div className="statCardLabel">Team slots open</div><div className="statCardValue">{stats.openTeamSlotCount}</div><div className="small">of {stats.teamSlotLimit} teams</div></div>
    </div>
  )
}

function applyGolfCourseTournamentDefaults(templateData: Record<string, unknown> | null | undefined, defaultLocation = '', golfCourseName = '') {
  const current = { ...emptyTournamentTemplateData(), ...(templateData || {}) }
  return {
    ...current,
    locationAddress: String(current.locationAddress || '').trim() || defaultLocation,
    hostOrganization: String(current.hostOrganization || '').trim() || golfCourseName,
    checkInTime: String(current.checkInTime || '').trim() || DEFAULT_TOURNAMENT_CHECK_IN_TIME,
    teeTime: String(current.teeTime || '').trim() || DEFAULT_TOURNAMENT_TEE_TIME,
    teeTimeIntervalMinutes: Number(current.teeTimeIntervalMinutes) >= 5 && Number(current.teeTimeIntervalMinutes) <= 60
      ? Math.trunc(Number(current.teeTimeIntervalMinutes))
      : DEFAULT_TEE_TIME_INTERVAL_MINUTES,
  }
}

function isValidOptionalEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function createEmptyTournamentForm(defaultLocation = '', golfCourseName = ''): TournamentInput {
  return {
    name: '',
    description: '',
    startDate: null,
    endDate: null,
    status: 'draft',
    isPublic: false,
    organizerEmail: '',
    templateKey: 'classic-flyer',
    templateBackgroundImageUrl: null,
    templateData: applyGolfCourseTournamentDefaults({}, defaultLocation, golfCourseName),
    teamSlotLimit: DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT,
  }
}

function formatRegisteredAt(value?: string | null) {
  if (!value) return 'Unknown time'
  return formatFriendlyDateTime(value)
}


function tournamentMemberStatus(member: { registered?: boolean; verified?: boolean }) {
  if (member.registered) return 'Registered'
  return 'Needs registration'
}

function tournamentMemberStatusClass(member: { registered?: boolean; verified?: boolean }) {
  if (member.registered && member.verified) return 'tournament-member-status tournament-member-status--verified'
  if (member.registered) return 'tournament-member-status tournament-member-status--registered'
  return 'tournament-member-status tournament-member-status--needs-registration'
}

function RegisteredGolfers({ tournament }: { tournament: Tournament }) {
  const registrations = tournament.registrations || []
  const [selectedRegistration, setSelectedRegistration] = useState<(typeof registrations)[number] | null>(null)
  const openRegistration = (registration: (typeof registrations)[number]) => {
    setSelectedRegistration(registration)
    logFrontendEvent({ category: 'host.portal', message: 'host_tournament_team_registration_opened', data: { tournamentId: tournament.id, registrationId: registration.id, teamName: registration.teamName || registration.name || null } })
  }
  const onRegistrationKeyDown = (event: KeyboardEvent<HTMLButtonElement>, registration: (typeof registrations)[number]) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openRegistration(registration)
  }
  return (
    <div className="card" style={{ padding: 12, background: '#f8fafc' }}>
      <div style={{ fontWeight: 700 }}>Teams signed up ({tournamentStats(tournament).registeredTeamCount})</div>
      <TournamentCapacitySummary tournament={tournament} />
      {registrations.length === 0 ? (
        <div className="small">No teams have signed up yet.</div>
      ) : (
        <div className="tournament-team-registration-lines" style={{ marginTop: 8 }}>
          {registrations.map((registration) => (
            <button
              key={registration.id}
              type="button"
              className="tournament-team-registration-line"
              onClick={() => openRegistration(registration)}
              onKeyDown={(event) => onRegistrationKeyDown(event, registration)}
            >
              <span><span>Team name</span><strong>{registration.teamName || registration.name || 'Registered team'}</strong></span>
              <span><span>Date registered</span><strong>{formatRegisteredAt(registration.registeredAt)}</strong></span>
              <span><span>Registrant</span><strong>{registration.name || 'Registered golfer'}</strong><small>{registration.email}</small></span>
            </button>
          ))}
        </div>
      )}
      {selectedRegistration ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={`${selectedRegistration.teamName || 'Team'} registration details`} onClick={() => setSelectedRegistration(null)}>
          <div className="modalCard tournament-registration-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h3>{selectedRegistration.teamName || selectedRegistration.name || 'Registered team'}</h3>
                <div className="small">Registered by {selectedRegistration.name || 'Registered golfer'} · {formatRegisteredAt(selectedRegistration.registeredAt)}</div>
              </div>
              <button type="button" className="btn btnSmall" onClick={() => setSelectedRegistration(null)}>Close</button>
            </div>
            <div className="small" style={{ overflowWrap: 'anywhere' }}>{selectedRegistration.email}</div>
            {(selectedRegistration.teamMembers || []).length ? (
              <ul className="tournament-team-member-status-list" aria-label={`${selectedRegistration.teamName || 'Team'} member registration statuses`}>
                {(selectedRegistration.teamMembers || []).map((member) => (
                  <li key={member.email || member.id || member.name}>
                    <span className="tournament-team-member-name">{member.name || member.email || 'Team member'}</span>
                    {member.email ? <span className="small tournament-team-member-email">{member.email}</span> : null}
                    <span className={tournamentMemberStatusClass(member)}>{tournamentMemberStatus(member)}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="small" style={{ marginTop: 10 }}>Team roster unavailable.</div>}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function toEditableTemplateData(tournament: Tournament): Record<string, unknown> {
  return applyGolfCourseTournamentDefaults(
    tournament.templateData,
    tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || '',
    tournament.hostGolfCourseName || '',
  )
}

function toEditForm(tournament: Tournament): TournamentInput {
  return {
    name: tournament.name || '',
    description: tournament.description || '',
    startDate: tournament.startDate ? String(tournament.startDate).slice(0, 10) : '',
    endDate: null,
    status: tournament.status || 'draft',
    isPublic: tournament.status === 'published',
    templateKey: tournament.templateKey || 'classic-flyer',
    templateBackgroundImageUrl: tournament.templateBackgroundImageUrl || null,
    templateData: toEditableTemplateData(tournament),
    teamSlotLimit: readTeamSlotLimit(tournament.teamSlotLimit),
  }
}

export default function HostPortal() {
  const { hostAccount } = useHostAuth()
  const [portalData, setPortalData] = useState<HostPortalState | null>(null)
  const [form, setForm] = useState<TournamentInput>(() => createEmptyTournamentForm())
  const [editForm, setEditForm] = useState<TournamentInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null)
  const [inviteEmailByTournament, setInviteEmailByTournament] = useState<Record<string, string>>({})
  const [createTournamentOpen, setCreateTournamentOpen] = useState(false)
  const [createAdditionalFieldsOpen, setCreateAdditionalFieldsOpen] = useState(false)
  const [showArchivedTournaments, setShowArchivedTournaments] = useState(false)
  const [selectedHostTournamentYear, setSelectedHostTournamentYear] = useState(() => String(new Date().getFullYear()))
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null)
  const [tournamentPage, setTournamentPage] = useState(1)

  async function loadPortal() {
    const result = await fetchHostPortal()
    if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not load host portal')
    const nextPortalData = result.data as unknown as HostPortalState
    setPortalData(nextPortalData)
    const defaultLocation = nextPortalData.account?.defaultTournamentLocation || nextPortalData.account?.golfCourseAddress || nextPortalData.account?.golfCourseName || ''
    const golfCourseName = nextPortalData.account?.golfCourseName || ''
    setForm((current) => {
      return { ...current, templateData: applyGolfCourseTournamentDefaults(current.templateData, defaultLocation, golfCourseName) }
    })
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        await loadPortal()
      } catch (err: any) {
        if (active) setError(err?.message || 'Could not load host portal')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => { active = false }
  }, [])


  useEffect(() => {
    const cancelledTournaments = (portalData?.tournaments || []).filter((tournament) => tournament.status === 'cancelled' && !tournament.archivedAt)
    if (!cancelledTournaments.length) return
    logFrontendEvent({
      category: 'host.portal',
      message: 'cancelled_tournament_deletion_notice_shown',
      data: { count: cancelledTournaments.length, tournamentIds: cancelledTournaments.map((tournament) => tournament.id) },
    })
  }, [portalData?.tournaments])

  function startEditing(tournament: Tournament) {
    setCreateTournamentOpen(false)
    setCreateAdditionalFieldsOpen(false)
    setEditingId(tournament.id)
    setEditForm(toEditForm(tournament))
    setError(null)
    setSuccess(null)
    logFrontendEvent({
      category: 'host.portal',
      message: 'host_tournament_edit_started',
      data: {
        tournamentId: tournament.id,
        tournamentIdentifier: tournament.tournamentIdentifier || null,
        otherTournamentCountHidden: Math.max((portalData?.tournaments || []).length - 1, 0),
      },
    })
  }

  async function onCreateTournament(event: FormEvent) {
    event.preventDefault()
    const tournamentName = String(form.name || '').trim()
    const tournamentEmail = String(form.organizerEmail || '').trim().toLowerCase()
    const validationMessage = validateTournamentForSave({ ...form, name: tournamentName })
    if (validationMessage || !isValidOptionalEmail(tournamentEmail)) {
      const message = validationMessage || 'Organizer Email is invalid. Enter a complete email address or leave it blank.'
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'warn', message: 'host_tournament_create_validation_failed', data: { tournamentNameProvided: Boolean(tournamentName), tournamentEmailProvided: Boolean(tournamentEmail), validationMessage: message } })
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const created = await createHostTournament({ ...form, name: tournamentName, organizerEmail: tournamentEmail || null })
      logFrontendEvent({
        category: 'host.portal',
        message: 'host_tournament_created',
        data: {
          tournamentId: created.tournament.id,
          tournamentIdentifier: created.tournament.tournamentIdentifier,
          teamSlotLimit: created.tournament.teamSlotLimit,
          optionalFieldsExpanded: createAdditionalFieldsOpen,
          defaultLocationPresent: Boolean(String((form.templateData as any)?.locationAddress || '').trim()),
          organizerInviteRequested: Boolean(tournamentEmail),
          checkInTime: String((form.templateData as any)?.checkInTime || ''),
          teeTime: String((form.templateData as any)?.teeTime || ''),
          templateKey: String(form.templateKey || 'classic-flyer'),
        },
      })
      if (tournamentEmail) {
        try {
          const invited = await sendHostTournamentInvite(created.tournament.id, { organizerEmail: tournamentEmail })
          setSuccess(`Tournament created. Organizer invite sent to ${tournamentEmail}. Link: ${invited.organizerUrl}`)
        } catch (inviteError) {
          const inviteMessage = inviteError instanceof Error ? inviteError.message : 'Could not send the organizer invite.'
          setSuccess('Tournament created.')
          setError(`The tournament was created, but the organizer invite was not sent. Use Invite organizer from the tournament record. ${inviteMessage}`)
          logFrontendEvent({
            category: 'host.portal',
            level: 'error',
            message: 'host_tournament_invite_after_create_failed',
            data: { tournamentId: created.tournament.id, tournamentEmail, error: inviteMessage },
          })
        }
      } else {
        setSuccess('Tournament created. An organizer can be invited later from the tournament record.')
      }
      const defaultLocation = portalData?.account?.defaultTournamentLocation || portalData?.account?.golfCourseAddress || portalData?.account?.golfCourseName || ''
      const golfCourseName = portalData?.account?.golfCourseName || ''
      setForm(createEmptyTournamentForm(defaultLocation, golfCourseName))
      setCreateAdditionalFieldsOpen(false)
      setCreateTournamentOpen(false)
      await loadPortal()
    } catch (err) {
      const message = getFriendlyTournamentError(err, 'create')
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_create_failed', data: { error: message, tournamentEmailProvided: Boolean(tournamentEmail), organizerInviteRequested: Boolean(tournamentEmail) } })
    } finally {
      setSaving(false)
    }
  }

  async function onSaveTournament(event: FormEvent) {
    event.preventDefault()
    if (!editingId || !editForm) return
    const validationMessage = validateTournamentForSave(editForm)
    if (validationMessage) {
      setError(validationMessage)
      logFrontendEvent({ category: 'host.portal', level: 'warn', message: 'host_tournament_update_validation_failed', data: { tournamentId: editingId, validationMessage } })
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const saved = await updateHostTournamentRecord(editingId, { ...editForm, endDate: null })
      setPortalData((prev) => prev ? { ...prev, tournaments: (prev.tournaments || []).map((item) => item.id === saved.id ? { ...item, ...saved } : item) } : prev)
      setSuccess(['published', 'completed'].includes(String(saved.status || '').toLowerCase()) && (saved.registrationUrl || saved.portalUrl) ? `Tournament updated. ${saved.status === 'completed' ? 'Tournament page URL' : 'Registration URL'}: ${saved.registrationUrl || saved.portalUrl}` : 'Tournament updated.')
      setEditingId(null)
      setEditForm(null)
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_updated', data: { tournamentId: saved.id, status: saved.status, templateKey: saved.templateKey || editForm.templateKey || 'classic-flyer', teamSlotLimit: saved.teamSlotLimit, registeredTeamCount: saved.registeredTeamCount, openTeamSlotCount: saved.openTeamSlotCount, tournamentSummaryPresent: Boolean(String((editForm.templateData as any)?.tournamentSummary || '').trim()), tournamentSummaryLength: String((editForm.templateData as any)?.tournamentSummary || '').length } })
    } catch (err) {
      const message = getFriendlyTournamentError(err, 'save')
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_update_failed', data: { tournamentId: editingId, error: message } })
    } finally {
      setSaving(false)
    }
  }


  async function onSendInvite(tournamentId: string, organizerEmail: string) {
    const normalizedEmail = String(organizerEmail || '').trim().toLowerCase()
    if (!normalizedEmail || !isValidOptionalEmail(normalizedEmail)) {
      setError('Enter a valid organizer email before sending an invite.')
      logFrontendEvent({ category: 'host.portal', level: 'warn', message: 'host_tournament_invite_validation_failed', data: { tournamentId, organizerEmailProvided: Boolean(normalizedEmail) } })
      return
    }
    setSendingInviteId(tournamentId)
    setError(null)
    setSuccess(null)
    try {
      const result = await sendHostTournamentInvite(tournamentId, { organizerEmail: normalizedEmail })
      setSuccess(`Organizer invite sent. Registration or login link: ${result.organizerUrl}`)
      setInviteEmailByTournament((current) => ({ ...current, [tournamentId]: '' }))
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_organizer_invited', data: { tournamentId, organizerEmail: normalizedEmail } })
      await loadPortal()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send organizer invite.'
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_organizer_invite_failed', data: { tournamentId, organizerEmail: normalizedEmail, error: message } })
    } finally {
      setSendingInviteId(null)
    }
  }

  async function onArchiveTournament(tournament: Tournament) {
    setArchiveBusyId(tournament.id)
    setError(null)
    setSuccess(null)
    try {
      const archived = await archiveHostTournamentRecord(tournament.id)
      setPortalData((previous) => previous ? { ...previous, tournaments: (previous.tournaments || []).map((item) => item.id === archived.id ? { ...item, ...archived } : item) } : previous)
      setSuccess(`${tournament.name} was archived.`)
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_archived', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The tournament could not be archived. Try again.'
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_archive_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setArchiveBusyId(null)
    }
  }

  async function onRestoreTournament(tournament: Tournament) {
    setArchiveBusyId(tournament.id)
    setError(null)
    setSuccess(null)
    try {
      const restored = await restoreHostTournamentRecord(tournament.id)
      setPortalData((previous) => previous ? { ...previous, tournaments: (previous.tournaments || []).map((item) => item.id === restored.id ? { ...item, ...restored } : item) } : previous)
      setSuccess(`${tournament.name} was restored to active tournaments.`)
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_restored', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, status: restored.status } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The tournament could not be restored. Try again.'
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_restore_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setArchiveBusyId(null)
    }
  }

  const hostedTournaments = sortTournamentsByCreatedDescending(portalData?.tournaments || [])
  const activeHostedTournaments = hostedTournaments.filter((tournament) => !tournament.archivedAt)
  const archivedHostedTournaments = hostedTournaments.filter((tournament) => Boolean(tournament.archivedAt))
  const selectedTournamentPool = showArchivedTournaments ? archivedHostedTournaments : activeHostedTournaments
  const currentYear = new Date().getFullYear()
  const hostTournamentYears = useMemo(() => tournamentYearOptions(selectedTournamentPool, currentYear), [currentYear, selectedTournamentPool])
  const selectedHostYearNumber = Number(selectedHostTournamentYear) || currentYear
  const selectedHostedTournaments = selectedTournamentPool.filter((tournament) => tournamentYear(tournament.startDate) === selectedHostYearNumber)
  const totalTournamentPages = Math.max(1, Math.ceil(selectedHostedTournaments.length / TOURNAMENTS_PER_PAGE))
  const safeTournamentPage = Math.min(tournamentPage, totalTournamentPages)
  const pagedHostedTournaments = selectedHostedTournaments.slice((safeTournamentPage - 1) * TOURNAMENTS_PER_PAGE, safeTournamentPage * TOURNAMENTS_PER_PAGE)
  const visibleHostedTournaments = editingId ? selectedTournamentPool.filter((tournament) => tournament.id === editingId) : pagedHostedTournaments

  useEffect(() => {
    if (tournamentPage > totalTournamentPages) setTournamentPage(totalTournamentPages)
  }, [tournamentPage, totalTournamentPages])

  useEffect(() => {
    if (!hostTournamentYears.includes(selectedHostYearNumber)) {
      setSelectedHostTournamentYear(String(currentYear))
      setTournamentPage(1)
    }
  }, [currentYear, hostTournamentYears, selectedHostYearNumber])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course portal" title={hostAccount ? hostAccount.golfCourseName : 'Host portal'} subtitle="Create tournaments, select a tournament line item to modify it, copy registration URLs after publishing, and invite organizers into their portal." />
        {busy ? <div className="small">Loading host portal…</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {success ? <div className="small" style={{ color: '#166534' }}>{success}</div> : null}

        {portalData?.account ? (
          <div className="formStack" style={{ maxWidth: 1100 }}>
            {!editingId ? <section className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <strong>Create tournament</strong>
                  <div className="small">Only the tournament name is required. Add an organizer email now to send an invitation, or invite an organizer later.</div>
                </div>
                <button
                  className="btn btnPrimary"
                  type="button"
                  aria-expanded={createTournamentOpen}
                  aria-controls="host-create-tournament-panel"
                  onClick={() => {
                    const nextOpen = !createTournamentOpen
                    const defaultLocation = portalData.account?.defaultTournamentLocation || portalData.account?.golfCourseAddress || portalData.account?.golfCourseName || ''
                    const golfCourseName = portalData.account?.golfCourseName || ''
                    if (nextOpen) {
                      setShowArchivedTournaments(false)
                      setEditingId(null)
                      setEditForm(null)
                      setForm((current) => ({ ...current, templateData: applyGolfCourseTournamentDefaults(current.templateData, defaultLocation, golfCourseName) }))
                    } else {
                      setCreateAdditionalFieldsOpen(false)
                    }
                    setCreateTournamentOpen(nextOpen)
                    const flowLogData = {
                      tournamentCountHidden: nextOpen ? activeHostedTournaments.length : 0,
                      defaultLocationAvailable: Boolean(defaultLocation),
                      defaultHostOrganizationAvailable: Boolean(golfCourseName),
                      defaultCheckInTime: DEFAULT_TOURNAMENT_CHECK_IN_TIME,
                      defaultTeeTime: DEFAULT_TOURNAMENT_TEE_TIME,
                    }
                    logFrontendEvent({
                      category: 'host.portal',
                      message: nextOpen ? 'host_tournament_create_panel_opened' : 'host_tournament_create_panel_minimized',
                      data: flowLogData,
                    })
                    logFrontendEvent({
                      category: 'host.portal',
                      message: nextOpen ? 'host_tournament_create_flow_started' : 'host_tournament_create_flow_minimized',
                      data: flowLogData,
                    })
                  }}
                >
                  {createTournamentOpen ? 'Minimize create tournament' : 'Create tournament'}
                </button>
              </div>
              {createTournamentOpen ? (
                <form id="host-create-tournament-panel" onSubmit={onCreateTournament} className="formStack" style={{ marginTop: 16 }}>
                  <div className="card" style={{ padding: 14, background: '#f8fafc' }}>
                    <div style={{ fontWeight: 700, marginBottom: 10 }}>Tournament setup</div>
                    <div className="formStack">
                      <div>
                        <label className="label">Tournament name</label>
                        <input className="input" required value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Spring Member Classic" />
                      </div>
                      <div>
                        <label className="label">Organizer email (optional)</label>
                        <input className="input" type="email" value={form.organizerEmail || ''} onChange={(e) => setForm((prev) => ({ ...prev, organizerEmail: e.target.value }))} placeholder="organizer@example.com" />
                        <div className="small" style={{ marginTop: 4 }}>When provided, Golf Homiez sends this address an organizer invitation after the tournament is created.</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={createAdditionalFieldsOpen}
                      aria-controls="host-create-tournament-optional-fields"
                      onClick={() => {
                        const nextOpen = !createAdditionalFieldsOpen
                        setCreateAdditionalFieldsOpen(nextOpen)
                        logFrontendEvent({ category: 'host.portal', message: 'host_tournament_optional_fields_toggled', data: { expanded: nextOpen } })
                      }}
                    >
                      {createAdditionalFieldsOpen ? 'Hide optional tournament fields' : 'Show optional tournament fields'}
                    </button>
                    <div className="small" style={{ marginTop: 6 }}>Optional fields can be completed now or by the invited organizer later.</div>
                  </div>

                  {createAdditionalFieldsOpen ? (
                    <div id="host-create-tournament-optional-fields" className="formStack">
                      <div>
                        <label className="label">Description</label>
                        <textarea className="input" rows={4} value={form.description || ''} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
                      </div>
                      <div className="formRow formRow--split">
                        <div>
                          <label className="label">Tournament date</label>
                          <input className="input" type="date" value={form.startDate || ''} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value, endDate: null }))} />
                        </div>
                      </div>
                      <TournamentRegistrationDeadlineField value={form} onChange={(next) => setForm((prev) => ({ ...prev, ...next }))} />
                      <div>
                        <label className="label">Number of teams to play in the tournament</label>
                        <input className="input" type="number" min={1} step={1} value={form.teamSlotLimit ?? DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT} onChange={(e) => setForm((prev) => ({ ...prev, teamSlotLimit: readTeamSlotLimit(Number(e.target.value)) }))} />
                      </div>
                      <TournamentTemplateFields value={form} hideRegistrationDeadline onChange={(next) => setForm((prev) => ({ ...prev, ...next }))} />
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btnPrimary" disabled={saving}>{saving ? 'Creating…' : (String(form.organizerEmail || '').trim() ? 'Create tournament and invite organizer' : 'Create tournament')}</button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const defaultLocation = portalData.account?.defaultTournamentLocation || portalData.account?.golfCourseAddress || portalData.account?.golfCourseName || ''
                        setForm(createEmptyTournamentForm(defaultLocation, portalData.account?.golfCourseName || ''))
                        setCreateAdditionalFieldsOpen(false)
                        setCreateTournamentOpen(false)
                        setError(null)
                        logFrontendEvent({ category: 'host.portal', message: 'host_tournament_create_flow_cancelled' })
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </section> : null}

            {!createTournamentOpen ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{showArchivedTournaments ? 'Archived tournaments' : 'Tournaments hosted here'}</strong>
                    {showArchivedTournaments ? <div className="small">Archived tournaments remain stored and can be restored to the active list.</div> : null}
                  </div>
                  {!editingId ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const next = !showArchivedTournaments
                        setShowArchivedTournaments(next)
                        setTournamentPage(1)
                        setSelectedHostTournamentYear(String(new Date().getFullYear()))
                        setError(null)
                        setSuccess(null)
                        logFrontendEvent({ category: 'host.portal', message: next ? 'host_archived_tournaments_view_opened' : 'host_active_tournaments_view_opened', data: { archivedCount: archivedHostedTournaments.length, activeCount: activeHostedTournaments.length } })
                      }}
                    >
                      {showArchivedTournaments ? `View active tournaments (${activeHostedTournaments.length})` : `View archived tournaments (${archivedHostedTournaments.length})`}
                    </button>
                  ) : null}
                </div>
                {!editingId ? (
                  <div className="golfCourseTournamentControls hostTournamentYearControls" aria-label="Host tournament year filters">
                    <div className="golfCourseTournamentYearTabs">
                      {hostTournamentYears.map((year) => (
                        <button
                          type="button"
                          key={year}
                          className={`golfCourseTournamentYearTab ${selectedHostYearNumber === year ? 'golfCourseTournamentYearTab--active' : ''}`}
                          onClick={() => {
                            setSelectedHostTournamentYear(String(year))
                            setTournamentPage(1)
                            logFrontendEvent({ category: 'host.portal', message: 'host_tournament_year_selected', data: { archived: showArchivedTournaments, year } })
                          }}
                        >
                          {year}
                        </button>
                      ))}
                    </div>
                    <div className="small">{selectedHostedTournaments.length} tournament{selectedHostedTournaments.length === 1 ? '' : 's'} in {selectedHostYearNumber}</div>
                  </div>
                ) : null}
                <div className="formStack" style={{ marginTop: 12 }}>
                  {visibleHostedTournaments.length === 0 ? <div className="small">{showArchivedTournaments ? `No archived tournaments in ${selectedHostYearNumber}.` : `No active tournaments in ${selectedHostYearNumber}.`}</div> : visibleHostedTournaments.map((tournament) => (
                  <div key={tournament.id} className={editingId === tournament.id ? 'card' : undefined} style={editingId === tournament.id ? { padding: 16 } : undefined}>
                    {editingId === tournament.id && editForm ? (
                      <form onSubmit={onSaveTournament} className="formStack" onClick={(e) => e.stopPropagation()}>
                        <RegisteredGolfers tournament={tournament} />
                        <div>
                          <label className="label">Status</label>
                          <select className="input" value={editForm.status || 'draft'} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, status: e.target.value }) : prev)}>
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        {editForm.status === 'cancelled' ? <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>This tournament is scheduled to be deleted because it is cancelled</div> : null}
                        <div>
                          <label className="label">Tournament name</label>
                          <input className="input" value={editForm.name} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, name: e.target.value }) : prev)} />
                        </div>
                        <div>
                          <label className="label">Description</label>
                          <textarea className="input" rows={4} value={editForm.description || ''} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, description: e.target.value }) : prev)} />
                        </div>
                        <div className="formRow formRow--split">
                          <div>
                            <label className="label">Tournament date</label>
                            <input className="input" type="date" value={editForm.startDate || ''} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, startDate: e.target.value, endDate: null }) : prev)} />
                          </div>
                        </div>
                        <TournamentRegistrationDeadlineField value={editForm} onChange={(next) => setEditForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                        <div>
                          <label className="label">Number of teams to play in the tournament</label>
                          <input className="input" type="number" min={1} step={1} value={editForm.teamSlotLimit ?? DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, teamSlotLimit: readTeamSlotLimit(Number(e.target.value)) }) : prev)} />
                        </div>
                        <TournamentTemplateFields value={editForm} hideRegistrationDeadline onChange={(next) => setEditForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                        <TournamentStartScheduleManager
                          tournamentId={tournament.id}
                          actor="host"
                          registrations={tournament.registrations || []}
                          assignments={tournament.startAssignments || []}
                          startType={String((editForm.templateData as any)?.startType || 'shotgun')}
                          firstStartTime={String((editForm.templateData as any)?.teeTime || DEFAULT_TOURNAMENT_TEE_TIME)}
                          intervalMinutes={Number((editForm.templateData as any)?.teeTimeIntervalMinutes || DEFAULT_TEE_TIME_INTERVAL_MINUTES)}
                          onAssignmentsChange={(startAssignments) => setPortalData((previous) => previous ? {
                            ...previous,
                            tournaments: (previous.tournaments || []).map((item) => item.id === tournament.id ? { ...item, startAssignments } : item),
                          } : previous)}
                        />
                        <TournamentSummaryField value={editForm} onChange={(next) => setEditForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                        <div className="card" style={{ padding: 12, background: '#f8fafc' }}>
                          <div style={{ fontWeight: 700 }}>Organizer</div>
                          {tournament.organizerEmail ? (
                            <>
                              <div className="small" style={{ marginTop: 4 }}>{tournament.organizerName || tournament.organizerEmail}</div>
                              {tournament.inviteUrl ? <div className="small">Organizer link: <a href={tournament.inviteUrl}>{tournament.inviteUrl}</a></div> : null}
                              <button className="btn" style={{ marginTop: 8 }} type="button" onClick={() => { void onSendInvite(tournament.id, tournament.organizerEmail || '') }} disabled={sendingInviteId === tournament.id}>{sendingInviteId === tournament.id ? 'Sending…' : 'Resend organizer invite'}</button>
                            </>
                          ) : (
                            <>
                              <label className="label" htmlFor={`organizer-email-${tournament.id}`}>Organizer email (optional)</label>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
                                <input
                                  id={`organizer-email-${tournament.id}`}
                                  className="input"
                                  type="email"
                                  style={{ flex: '1 1 260px' }}
                                  value={inviteEmailByTournament[tournament.id] || ''}
                                  onChange={(e) => setInviteEmailByTournament((current) => ({ ...current, [tournament.id]: e.target.value }))}
                                  placeholder="organizer@example.com"
                                />
                                <button className="btn" type="button" onClick={() => { void onSendInvite(tournament.id, inviteEmailByTournament[tournament.id] || '') }} disabled={sendingInviteId === tournament.id}>{sendingInviteId === tournament.id ? 'Sending…' : 'Invite organizer'}</button>
                              </div>
                              <div className="small" style={{ marginTop: 4 }}>The tournament can remain host-managed without an organizer.</div>
                            </>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save tournament changes'}</button>
                          <button type="button" className="btn" onClick={() => {
                            logFrontendEvent({ category: 'host.portal', message: 'host_tournament_edit_cancelled', data: { tournamentId: editingId } })
                            setEditingId(null)
                            setEditForm(null)
                            setError(null)
                          }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <TournamentManagementLineItem
                        tournament={tournament}
                        archived={showArchivedTournaments}
                        busy={archiveBusyId === tournament.id}
                        onSelect={showArchivedTournaments ? undefined : startEditing}
                        onArchive={onArchiveTournament}
                        onRestore={onRestoreTournament}
                      />
                    )}
                  </div>
                  ))}
                </div>
                {!editingId ? (
                  <TournamentManagementPagination
                    currentPage={safeTournamentPage}
                    totalPages={totalTournamentPages}
                    totalItems={selectedHostedTournaments.length}
                    onPageChange={(page) => {
                      setTournamentPage(page)
                      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_page_selected', data: { archived: showArchivedTournaments, page, totalPages: totalTournamentPages } })
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <div className="small" role="status">Existing tournaments are hidden while the create tournament flow is open.</div>
            )}
          </div>
        ) : null}

      </div>
    </div>
  )
}
