import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import ProtectedRoute from '../components/ProtectedRoute'
import { createTeam, deleteTeam, fetchTeams, lookupUserByEmail, sendRegistrationInvite, updateTeam } from '../lib/teams'
import type { ScoreEntry, Team, TeamMember } from '../types'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'
import InviteHomieModal from '../components/InviteHomieModal'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'

type CreateMemberValidationState = 'idle' | 'checking' | 'validated' | 'invited'
type DraftMember = { id: string; firstName: string; lastName: string; email: string; status?: TeamMember['status']; verified?: boolean; validationState?: CreateMemberValidationState }
type TeamNameApiError = Error & { suggestedTeamName?: string }

const MIN_TEAM_SIZE = 2
const MAX_TEAM_SIZE = 4
const CREATE_EXTRA_MEMBER_LIMIT = MAX_TEAM_SIZE - 1
const TEAM_SIZE_ERROR = 'Teams can only have 2 to 4 team members.'

export default function TeamsPage() {
  return (
    <ProtectedRoute>
      <TeamsInner />
    </ProtectedRoute>
  )
}

function TeamsInner() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<{ teamId: string; email: string; memberId?: string; source?: 'create' | 'edit' } | null>(null)
  const [editTeamId, setEditTeamId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftNamePlaceholder, setDraftNamePlaceholder] = useState('Team name')
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>([])
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createNamePlaceholder, setCreateNamePlaceholder] = useState('e.g. Fairway Finders')
  const [createMembers, setCreateMembers] = useState<DraftMember[]>([makeBlankDraftMember()])
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showCreateValidation, setShowCreateValidation] = useState(false)
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null)

  async function load() {
    try {
      const [t, s] = await Promise.all([fetchTeams(), api<ScoreEntry[]>('/api/scores')])
      setTeams(t)
      setScores(s)
      logFrontendEvent({ category: 'teams.page', message: 'teams_loaded', data: { teamCount: t.length, scoreCount: s.length } })
    } catch (e: any) {
      const message = e.message || 'Failed to load teams'
      setErr(message)
      logFrontendEvent({ category: 'teams.page', level: 'error', message: 'teams_load_failed', data: { error: message } })
    }
  }

  useEffect(() => {
    load()
    const interval = window.setInterval(load, 15000)
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams])
  const myEmail = String(user?.email || '').toLowerCase()
  const leadMember = useMemo(() => buildLeadDraftMember(user), [user?.id, user?.name, user?.email])
  const myTeams = useMemo(() => {
    if (!myEmail) return []
    return sorted.filter(t => (t.members || []).some(m => String(m.email || '').toLowerCase() === myEmail))
  }, [sorted, myEmail])

  const recordByTeam = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number; ties: number }>()
    const bump = (teamName: string, outcome: true | false | null) => {
      const key = String(teamName || '')
      if (!key) return
      const prev = map.get(key) || { wins: 0, losses: 0, ties: 0 }
      const next = { ...prev }
      if (outcome === true) next.wins += 1
      else if (outcome === false) next.losses += 1
      else next.ties += 1
      map.set(key, next)
    }

    for (const s of scores as any[]) {
      if (s.mode === 'solo') continue
      const t = String(s.team || '')
      const o = String(s.opponentTeam || '')
      const won = s.won as (true | false | null)
      if (t) bump(t, won)
      if (o) bump(o, won === null ? null : won === true ? false : true)
    }
    return map
  }, [scores])

  const editTeam = useMemo(() => myTeams.find(t => t.id === editTeamId) || null, [myTeams, editTeamId])

  const normalizedCreateMembers = useMemo(() => {
    const extras = createMembers
      .map(toTeamMemberDraft)
      .filter(m => m.name || m.email)
      .filter(m => m.email.toLowerCase() !== leadMember.email.toLowerCase())
    return [toTeamMemberDraft(leadMember), ...extras].slice(0, MAX_TEAM_SIZE)
  }, [createMembers, leadMember])

  const createMissing = useMemo(() => {
    const missing: string[] = []
    if (!createName.trim()) missing.push('Team name')
    if (!isValidTeamSize(normalizedCreateMembers.length)) missing.push('2 to 4 team members')
    for (const member of normalizedCreateMembers) {
      if (!member.email) missing.push('Each team member email')
      if (member.email && !isValidEmailAddress(member.email)) missing.push('Valid team member emails')
    }
    for (const member of createMembers.filter(member => member.email.trim() && member.validationState === 'invited')) {
      if (!member.firstName.trim()) missing.push('First name for invited teammates')
      if (!member.lastName.trim()) missing.push('Last name for invited teammates')
    }
    if (createMembers.some(member => member.email.trim() && !['validated', 'invited'].includes(member.validationState || 'idle'))) missing.push('Validated or invited teammate emails')
    if (hasDuplicateEmails(normalizedCreateMembers)) missing.push('Unique teammate emails')
    return [...new Set(missing)]
  }, [createMembers, createName, normalizedCreateMembers])

  useEffect(() => {
    if (!editTeam) return
    setDraftName(editTeam.name)
    setDraftNamePlaceholder('Team name')
    setDraftMembers((editTeam.members || []).map(m => {
      const split = splitName(m.name)
      return {
        id: m.id,
        firstName: split.firstName,
        lastName: split.lastName,
        email: m.email,
        status: m.status,
        verified: m.verified,
      }
    }))
    setEditingMemberId(null)
    setSaveError(null)
  }, [editTeam])

  function toggleCreateTeam() {
    const next = !createOpen
    setCreateOpen(next)
    setErr(null)
    setMsg(null)
    setCreateError(null)
    setShowCreateValidation(false)
    logFrontendEvent({ category: 'teams.create', message: next ? 'opened' : 'closed', data: { memberCount: normalizedCreateMembers.length } })
  }

  function closeModal() {
    setEditTeamId(null)
    setEditingMemberId(null)
    setSaving(false)
    setSaveError(null)
    setDraftNamePlaceholder('Team name')
  }

  function openTeamDetails(team: Team) {
    setEditTeamId(team.id)
    logFrontendEvent({
      category: 'teams.page',
      message: 'team_line_item_selected',
      data: {
        teamId: team.id,
        teamIdentifier: team.teamIdentifier,
        teamName: team.name,
        memberCount: team.members?.length || 0,
        status: teamStatusLabel(team),
      },
    })
  }

  function resetCreateForm() {
    setCreateName('')
    setCreateNamePlaceholder('e.g. Fairway Finders')
    setCreateMembers([makeBlankDraftMember()])
    setCreateError(null)
    setShowCreateValidation(false)
  }

  function addCreateMember() {
    if (createMembers.length >= CREATE_EXTRA_MEMBER_LIMIT) return
    setCreateMembers(prev => [...prev, makeBlankDraftMember()])
  }

  function patchCreateMember(id: string, field: 'firstName' | 'lastName' | 'email', value: string) {
    setCreateMembers(prev => prev.map(m => {
      if (m.id !== id) return m
      if (field === 'email') {
        return { ...m, email: value, firstName: '', lastName: '', status: undefined, verified: false, validationState: 'idle' }
      }
      return { ...m, [field]: value }
    }))
  }

  function removeCreateMember(id: string) {
    setCreateMembers(prev => prev.filter(m => m.id !== id))
  }

  async function validateCreateMember(id: string) {
    const target = createMembers.find(m => m.id === id)
    const email = String(target?.email || '').trim().toLowerCase()
    const correlationId = getCorrelationId()
    setCreateError(null)
    setMsg(null)

    if (!target) return
    if (!isValidEmailAddress(email)) {
      const message = 'Enter a valid teammate email address before validating.'
      setCreateError(message)
      logFrontendEvent({ category: 'teams.create.member_validation', level: 'warn', message: 'invalid_email', data: { correlationId, memberId: id, email } })
      return
    }
    if (email === leadMember.email.toLowerCase() || createMembers.some(m => m.id !== id && m.email.trim().toLowerCase() === email)) {
      const message = 'That teammate is already on this team. Pick a different golfer.'
      setCreateError(message)
      logFrontendEvent({ category: 'teams.create.member_validation', level: 'warn', message: 'duplicate_email', data: { correlationId, memberId: id, email } })
      return
    }

    setCreateMembers(prev => prev.map(m => (m.id === id ? { ...m, email, validationState: 'checking' } : m)))
    logFrontendEvent({ category: 'teams.create.member_validation', message: 'started', data: { correlationId, memberId: id, email } })

    try {
      const result = await lookupUserByEmail(email)
      if (!result.found) {
        setCreateMembers(prev => prev.map(m => (m.id === id ? { ...m, email, firstName: '', lastName: '', status: undefined, verified: false, validationState: 'idle' } : m)))
        setInviteTarget({ teamId: '', email, memberId: id, source: 'create' })
        setInviteOpen(true)
        setCreateError(null)
        setMsg(`No GolfHomiez account was found for ${email}. Send an invite so they can be added as an invited team member.`)
        logFrontendEvent({ category: 'teams.create.member_validation', level: 'warn', message: 'not_found_invite_opened', data: { correlationId, memberId: id, email } })
        return
      }

      const split = splitName(result.name || result.email)
      const firstName = result.firstName || split.firstName
      const lastName = result.lastName || split.lastName
      setCreateMembers(prev => prev.map(m => (
        m.id === id
          ? { ...m, email: result.email || email, firstName, lastName, status: result.verified ? 'active' : 'pending_verification', verified: result.verified, validationState: 'validated' }
          : m
      )))
      setMsg(`${firstName || 'Teammate'} validated.`)
      logFrontendEvent({ category: 'teams.create.member_validation', message: 'validated', data: { correlationId, memberId: id, email: result.email || email, verified: Boolean(result.verified) } })
    } catch (e: any) {
      const message = e.message || 'Could not validate teammate email'
      setCreateMembers(prev => prev.map(m => (m.id === id ? { ...m, validationState: 'idle' } : m)))
      setCreateError(message)
      logFrontendEvent({ category: 'teams.create.member_validation', level: 'error', message: 'failed', data: { correlationId, memberId: id, email, error: message } })
    }
  }

  function addMember() {
    if (draftMembers.length >= MAX_TEAM_SIZE || editingMemberId) return
    const member = makeBlankDraftMember()
    setDraftMembers(prev => [...prev, member])
    setEditingMemberId(member.id)
    logFrontendEvent({ category: 'teams.update.member_edit', message: 'new_member_edit_started', data: { correlationId: getCorrelationId(), teamId: editTeam?.id || null, memberId: member.id, memberCount: draftMembers.length + 1 } })
  }

  function patchMember(id: string, field: 'firstName' | 'lastName' | 'email', value: string) {
    if (editingMemberId !== id) return
    setDraftMembers(prev => prev.map(m => (m.id === id ? { ...m, [field]: value } : m)))
  }

  function removeMember(id: string) {
    if (editingMemberId !== id) return
    setDraftMembers(prev => prev.filter(m => m.id !== id))
    setEditingMemberId(null)
    logFrontendEvent({ category: 'teams.update.member_edit', message: 'member_removed_from_draft', data: { correlationId: getCorrelationId(), teamId: editTeam?.id || null, memberId: id, memberCount: Math.max(0, draftMembers.length - 1) } })
  }

  function beginMemberEdit(member: DraftMember) {
    if (editingMemberId && editingMemberId !== member.id) return
    setEditingMemberId(member.id)
    setSaveError(null)
    logFrontendEvent({ category: 'teams.update.member_edit', message: 'member_edit_started', data: { correlationId: getCorrelationId(), teamId: editTeam?.id || null, memberId: member.id, memberEmail: member.email || null } })
  }

  function cancelMemberEdit(member: DraftMember) {
    const original = editTeam?.members?.find(candidate => candidate.id === member.id)
    if (original) {
      const split = splitName(original.name)
      setDraftMembers(prev => prev.map(candidate => candidate.id === member.id ? {
        id: original.id,
        firstName: split.firstName,
        lastName: split.lastName,
        email: original.email,
        status: original.status,
        verified: original.verified,
      } : candidate))
    } else {
      setDraftMembers(prev => prev.filter(candidate => candidate.id !== member.id))
    }
    setEditingMemberId(null)
    setSaveError(null)
    logFrontendEvent({ category: 'teams.update.member_edit', message: 'member_edit_cancelled', data: { correlationId: getCorrelationId(), teamId: editTeam?.id || null, memberId: member.id, existingMember: Boolean(original) } })
  }

  function finishMemberEdit(member: DraftMember) {
    const firstName = member.firstName.trim()
    const lastName = member.lastName.trim()
    const email = member.email.trim().toLowerCase()
    if (!firstName) {
      setSaveError('Enter the team member first name before finishing the edit.')
      return
    }
    if (!lastName) {
      setSaveError('Enter the team member last name before finishing the edit.')
      return
    }
    if (!isValidEmailAddress(email)) {
      setSaveError('Enter a valid team member email address before finishing the edit.')
      return
    }
    const duplicate = draftMembers.some(candidate => candidate.id !== member.id && candidate.email.trim().toLowerCase() === email)
    if (duplicate) {
      setSaveError('You cannot add the same team member twice.')
      return
    }
    setDraftMembers(prev => prev.map(candidate => candidate.id === member.id ? { ...candidate, firstName, lastName, email } : candidate))
    setEditingMemberId(null)
    setSaveError(null)
    logFrontendEvent({ category: 'teams.update.member_edit', message: 'member_edit_finished', data: { correlationId: getCorrelationId(), teamId: editTeam?.id || null, memberId: member.id, memberEmail: email } })
  }

  async function handleCreateTeam() {
    const correlationId = getCorrelationId()
    setShowCreateValidation(true)
    setCreateError(null)
    setMsg(null)

    if (createMissing.length) {
      const message = `Missing or invalid: ${createMissing.join(', ')}`
      setCreateError(message)
      logFrontendEvent({ category: 'teams.create', level: 'warn', message: 'validation_failed', data: { correlationId, createMissing, teamName: createName.trim(), memberCount: normalizedCreateMembers.length } })
      return
    }

    setCreateSaving(true)
    logFrontendEvent({ category: 'teams.create', message: 'started', data: { correlationId, teamName: createName.trim(), memberCount: normalizedCreateMembers.length } })
    try {
      const created = await createTeam(createName.trim(), normalizedCreateMembers as Omit<TeamMember, 'id'>[])
      setTeams(prev => [...prev.filter(t => t.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)))
      setMsg(`Team ${created.name} created. GolfHomiez Team ID: ${created.teamIdentifier}.`)
      setCreateOpen(false)
      resetCreateForm()
      logFrontendEvent({ category: 'teams.create', message: 'succeeded', data: { correlationId, teamId: created.id, teamIdentifier: created.teamIdentifier, teamName: created.name, memberCount: created.members?.length || normalizedCreateMembers.length } })
    } catch (e: any) {
      const apiError = e as TeamNameApiError
      const suggestedTeamName = apiError.suggestedTeamName || buildSuggestedTeamName(createName, teams)
      const duplicate = /already exists/i.test(apiError.message || '')
      const message = duplicate ? `Team name already exists. Suggested team name: "${suggestedTeamName}".` : (apiError.message || 'Failed to create team')
      if (duplicate) {
        setCreateName(suggestedTeamName)
        setCreateNamePlaceholder(suggestedTeamName)
      }
      setCreateError(message)
      logFrontendEvent({ category: 'teams.create', level: 'error', message: duplicate ? 'duplicate_name' : 'failed', data: { correlationId, teamName: createName.trim(), suggestedTeamName: duplicate ? suggestedTeamName : null, error: message } })
    } finally {
      setCreateSaving(false)
    }
  }

  async function handleSave() {
    if (!editTeam) return
    const correlationId = getCorrelationId()
    setSaving(true)
    setSaveError(null)
    try {
      if (editingMemberId) throw new Error('Finish or cancel the open team member edit before saving the team.')
      const normalizedEmails = new Set<string>()
      const members = draftMembers
        .map(toTeamMemberDraft)
        .filter(m => m.name || m.email)

      if (!isValidTeamSize(members.length)) throw new Error(TEAM_SIZE_ERROR)

      for (const member of members) {
        if (!member.name) throw new Error('Each team member needs a name.')
        if (!member.email) throw new Error('Each team member needs an email address.')
        if (normalizedEmails.has(member.email)) throw new Error('You cannot add the same team member twice.')
        normalizedEmails.add(member.email)
      }

      logFrontendEvent({ category: 'teams.update', message: 'started', data: { correlationId, teamId: editTeam.id, teamIdentifier: editTeam.teamIdentifier, teamName: draftName.trim(), memberCount: members.length } })
      const updated = await updateTeam(editTeam.id, draftName.trim(), members)
      setTeams(prev => prev.map(t => (t.id === updated.id ? updated : t)).sort((a, b) => a.name.localeCompare(b.name)))
      logFrontendEvent({ category: 'teams.update', message: 'succeeded', data: { correlationId, teamId: updated.id, teamIdentifier: updated.teamIdentifier, teamName: updated.name, memberCount: updated.members?.length || members.length } })
      closeModal()
    } catch (e: any) {
      const apiError = e as TeamNameApiError
      const suggestedTeamName = apiError.suggestedTeamName || buildSuggestedTeamName(draftName, teams, editTeam.id)
      const duplicate = /already exists/i.test(apiError.message || '')
      const message = duplicate ? `Team name already exists. Suggested team name: "${suggestedTeamName}".` : (apiError?.message || 'Failed to update team')
      if (duplicate) {
        setDraftName(suggestedTeamName)
        setDraftNamePlaceholder(suggestedTeamName)
      }
      setSaveError(message)
      logFrontendEvent({ category: 'teams.update', level: 'error', message: duplicate ? 'duplicate_name' : 'failed', data: { correlationId, teamId: editTeam.id, teamName: draftName.trim(), suggestedTeamName: duplicate ? suggestedTeamName : null, error: message } })
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTeam(team: Team) {
    const correlationId = getCorrelationId()
    const teamName = String(team.name || '').trim()
    const confirmed = window.confirm(`Delete ${teamName}? Logged events for this team will remain saved.`)
    if (!confirmed) {
      logFrontendEvent({ category: 'teams.delete', message: 'cancelled', data: { correlationId, teamId: team.id, teamName } })
      return
    }

    setDeletingTeamId(team.id)
    setErr(null)
    setMsg(null)
    logFrontendEvent({ category: 'teams.delete', message: 'started', data: { correlationId, teamId: team.id, teamName } })
    try {
      const result = await deleteTeam(team.id)
      setTeams(prev => prev.filter(t => t.id !== team.id))
      if (editTeamId === team.id) closeModal()
      setMsg(`Team ${teamName} deleted. ${result.retainedLoggedEventsCount || 0} logged event(s) were kept.`)
      logFrontendEvent({ category: 'teams.delete', message: 'succeeded', data: { correlationId, teamId: team.id, teamName, retainedLoggedEventsCount: result.retainedLoggedEventsCount || 0 } })
    } catch (e: any) {
      const message = e.message || 'Failed to delete team'
      setErr(message)
      logFrontendEvent({ category: 'teams.delete', level: 'error', message: 'failed', data: { correlationId, teamId: team.id, teamName, error: message } })
    } finally {
      setDeletingTeamId(null)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Rosters and records"
          title="Your teams at a glance"
          subtitle="Create teams, keep rosters clean, and use each team's numeric GolfHomiez Team ID when creating a Team Challenge."
          actions={
            <Link
              className="btn btnLightGreen btnSmall"
              to="/profile"
              onClick={() => logFrontendEvent({ category: 'teams.navigation', message: 'return_to_profile_clicked', data: { teamCount: myTeams.length } })}
            >
              Return to Profile
            </Link>
          }
        />

        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btnPrimary" onClick={toggleCreateTeam}>{createOpen ? 'Hide Create Team' : 'Create Team'}</button>
          <span className="small">Teams can have 2 to 4 members. Team names must be unique.</span>
        </div>

        {err ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>{err}</div> : null}
        {msg ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{msg}</div> : null}

        {createOpen ? (
          <div className="card" style={{ marginTop: 14, background: '#fafbff' }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Create Team</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ maxWidth: 560 }}>
                <label className="label">Team name</label>
                <input className="input" value={createName} onChange={e => setCreateName(e.target.value)} placeholder={createNamePlaceholder} />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Team members</div>
                <div className="card" style={{ padding: 12, background: 'rgba(255,255,255,.72)' }}>
                  <div style={{ fontWeight: 800, marginTop: 4 }}>{leadMember.firstName} {leadMember.lastName}</div>
                  <div className="small">{leadMember.email}</div>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                  {createMembers.map((m, index) => (
                    <div key={m.id} className="card" style={{ padding: 12, background: 'rgba(255,255,255,.72)' }}>
                      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, alignItems: 'end' }}>
                        <div>
                          <label className="label">Email</label>
                          <input className="input" type="email" value={m.email} readOnly={m.validationState === 'validated' || m.validationState === 'invited'} onChange={e => patchCreateMember(m.id, 'email', e.target.value)} placeholder={`Member ${index + 2} email`} />
                        </div>
                        <button type="button" className="btn" disabled={m.validationState === 'checking' || m.validationState === 'validated' || m.validationState === 'invited'} onClick={() => validateCreateMember(m.id)}>
                          {m.validationState === 'validated' ? 'Validated' : m.validationState === 'invited' ? 'Invited' : m.validationState === 'checking' ? 'Validating…' : 'Validate'}
                        </button>
                        <button type="button" className="btn" onClick={() => removeCreateMember(m.id)}>Remove</button>
                      </div>
                      {m.validationState === 'validated' ? (
                        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                          <div>
                            <label className="label">First name</label>
                            <input className="input" value={m.firstName} readOnly />
                          </div>
                          <div>
                            <label className="label">Last name</label>
                            <input className="input" value={m.lastName} readOnly />
                          </div>
                        </div>
                      ) : m.validationState === 'invited' ? (
                        <div style={{ marginTop: 10 }}>
                          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                              <label className="label">First name</label>
                              <input className="input" value={m.firstName} onChange={e => patchCreateMember(m.id, 'firstName', e.target.value)} placeholder="First name" required />
                            </div>
                            <div>
                              <label className="label">Last name</label>
                              <input className="input" value={m.lastName} onChange={e => patchCreateMember(m.id, 'lastName', e.target.value)} placeholder="Last name" required />
                            </div>
                          </div>
                          <div className="small" style={{ marginTop: 8 }}>Invite sent. Add this golfer's first and last name before saving the team. The team remains pending until their GolfHomiez account is created and verified.</div>
                        </div>
                      ) : (
                        <div className="small" style={{ marginTop: 8 }}>Enter an email, then validate the golfer or invite them to GolfHomiez.</div>
                      )}
                    </div>
                  ))}
                </div>
                {createMembers.length < CREATE_EXTRA_MEMBER_LIMIT ? <button type="button" className="btn" style={{ marginTop: 10 }} onClick={addCreateMember}>+ Add member</button> : null}
                <div className="small" style={{ marginTop: 6 }}>Save is available for teams with 2 to 4 team members.</div>
              </div>
            </div>
            {showCreateValidation && createMissing.length ? <div className="small" style={{ marginTop: 12, color: '#b91c1c' }}>Missing or invalid: {createMissing.join(', ')}</div> : null}
            {createError ? <div className="small" style={{ marginTop: 12, color: '#b91c1c' }}>{createError}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => { setCreateOpen(false); resetCreateForm() }}>Cancel</button>
              <button type="button" className="btnPrimary" disabled={createSaving} onClick={handleCreateTeam}>{createSaving ? 'Creating…' : 'Save Team'}</button>
            </div>
          </div>
        ) : null}

        {myTeams.length === 0 ? (
          <div className="small" style={{ marginTop: 12 }}>
            You are not listed as a member of any team yet. Create a team here so it can be selected for Challenges page Team Challenges.
          </div>
        ) : (
          <div className="compactLineItemList teamLineItemList" style={{ marginTop: 14 }}>
            {myTeams.map(t => {
              const r = recordByTeam.get(t.name) || { wins: 0, losses: 0, ties: 0 }
              const members = t.members || []
              return (
                <button
                  type="button"
                  key={t.id}
                  className="compactLineItem teamLineItem"
                  onClick={() => openTeamDetails(t)}
                  aria-label={`Edit ${t.name}`}
                >
                  <span className="compactLineItemType compactLineItemType--identifier" aria-label={`GolfHomiez Team ID ${t.teamIdentifier}`}>Team ID {t.teamIdentifier}</span>
                  <span className="compactLineItemMain">
                    <strong className="compactLineItemTitle">{t.name}</strong>
                    <span className="compactLineItemMeta">{members.length} member{members.length === 1 ? '' : 's'} • Status: <strong>{teamStatusLabel(t)}</strong></span>
                    <span className="compactLineItemSecondary">{members.map(member => member.name).join(', ')}</span>
                  </span>
                  <span className="compactLineItemSummary">
                    <strong className="compactLineItemValue">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</strong>
                    <span>Record</span>
                  </span>
                  <span className="compactLineItemChevron" aria-hidden="true">›</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {editTeam ? (
        <div className="modalOverlay" onMouseDown={closeModal}>
          <div className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <div className="small">Edit team</div>
                <div className="teamIdentifierBadge" style={{ marginTop: 4 }}>Team ID {editTeam.teamIdentifier}</div>
                <div style={{ fontSize: 20, fontWeight: 900 }}>{editTeam.name}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  {(() => {
                    const r = recordByTeam.get(editTeam.name) || { wins: 0, losses: 0, ties: 0 }
                    return <>Record: <strong>{r.wins}-{r.losses}</strong>{r.ties ? <> (T{r.ties})</> : null}</>
                  })()}
                </div>
              </div>
              <button type="button" className="btn" onClick={closeModal}>Close</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="label">Team name</label>
              <input className="input" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder={draftNamePlaceholder} />
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <label className="label" style={{ margin: 0 }}>Members</label>
              {draftMembers.length < MAX_TEAM_SIZE ? <button type="button" className="btn" disabled={Boolean(editingMemberId)} onClick={addMember}>+ Add member</button> : null}
            </div>

            <div className="small" style={{ marginTop: 6 }}>Teams can have 2 to 4 members. Select Edit on one member at a time to update their information.</div>

            <div className="teamMemberEditList">
              {draftMembers.map((m, index) => {
                const memberVerified = m.status === 'active' || m.verified === true
                const memberEditing = editingMemberId === m.id
                return (
                  <div key={m.id} className={`teamMemberLineItem ${memberVerified ? 'teamMemberLineItem--verified' : 'teamMemberLineItem--pending'}${memberEditing ? ' teamMemberLineItem--editing' : ''}`}>
                    <div className="teamMemberLineItemHeader">
                      <span className={`teamMemberStatusBadge ${memberVerified ? 'teamMemberStatusBadge--verified' : 'teamMemberStatusBadge--pending'}`}>
                        {memberVerified ? 'Verified' : 'Pending'}
                      </span>
                      <span className="small">Member {index + 1}</span>
                      <button type="button" className="btn btnSmall teamMemberEditButton" disabled={Boolean(editingMemberId && !memberEditing)} onClick={() => beginMemberEdit(m)}>
                        {memberEditing ? 'Editing' : 'Edit'}
                      </button>
                    </div>

                    {memberEditing ? (
                      <div className="teamMemberEditFields">
                        <label className="label">First name
                          <input className="input" value={m.firstName} onChange={e => patchMember(m.id, 'firstName', e.target.value)} />
                        </label>
                        <label className="label">Last name
                          <input className="input" value={m.lastName} onChange={e => patchMember(m.id, 'lastName', e.target.value)} />
                        </label>
                        <label className="label teamMemberEmailField">Email
                          <input className="input" type="email" value={m.email} onChange={e => patchMember(m.id, 'email', e.target.value)} />
                        </label>
                        <div className="teamMemberEditActions">
                          <button type="button" className="btnPrimary btnSmall" onClick={() => finishMemberEdit(m)}>Done</button>
                          <button type="button" className="btn btnSmall" onClick={() => cancelMemberEdit(m)}>Cancel</button>
                          <button type="button" className="btn btnSmall btnDanger" disabled={draftMembers.length <= MIN_TEAM_SIZE} onClick={() => removeMember(m.id)}>Remove</button>
                        </div>
                      </div>
                    ) : (
                      <div className="teamMemberDisplayGrid">
                        <div><span>First name</span><strong>{m.firstName || '—'}</strong></div>
                        <div><span>Last name</span><strong>{m.lastName || '—'}</strong></div>
                        <div className="teamMemberDisplayEmail"><span>Email</span><strong>{m.email || '—'}</strong></div>
                      </div>
                    )}

                    {!memberVerified && m.email ? (
                      <button type="button" className="btn btnSmall teamMemberInviteButton" disabled={Boolean(editingMemberId)} onClick={() => { setInviteTarget({ teamId: editTeam.id, email: m.email, source: 'edit' }); setInviteOpen(true) }}>
                        Send Registration Invite
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {saveError ? <div className="small" style={{ marginTop: 12, color: '#b91c1c' }}>{saveError}</div> : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" disabled={deletingTeamId === editTeam.id} onClick={() => { void handleDeleteTeam(editTeam) }}>{deletingTeamId === editTeam.id ? 'Deleting…' : 'Delete Team'}</button>
              <button type="button" className="btn" onClick={closeModal}>Cancel</button>
              <button type="button" className="btnPrimary" disabled={saving || Boolean(editingMemberId)} onClick={handleSave}>{saving ? 'Saving…' : 'Save Team'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <InviteHomieModal
        open={inviteOpen}
        defaultEmail={inviteTarget?.email || ''}
        title="Send Registration Invite"
        submitLabel="Send Registration Invite"
        onClose={() => {
          if (inviteTarget?.source === 'create' && inviteTarget.memberId) {
            setCreateMembers(prev => prev.map(m => (m.id === inviteTarget.memberId && m.validationState === 'checking' ? { ...m, validationState: 'idle' } : m)))
          }
          setInviteOpen(false)
          setInviteTarget(null)
        }}
        onSubmit={async ({ email, message }) => {
          const correlationId = getCorrelationId()
          const target = inviteTarget
          logFrontendEvent({ category: 'teams.registration_invite', message: 'started', data: { correlationId, teamId: target?.teamId || null, email, source: target?.source || null, memberId: target?.memberId || null } })
          await sendRegistrationInvite(email, message, target?.teamId)
          if (target?.source === 'create' && target.memberId) {
            const normalizedEmail = String(email || target.email || '').trim().toLowerCase()
            setCreateMembers(prev => prev.map(m => (
              m.id === target.memberId
                ? { ...m, email: normalizedEmail, firstName: m.firstName, lastName: m.lastName, status: 'invited', verified: false, validationState: 'invited' }
                : m
            )))
            setMsg(`Registration invite sent to ${normalizedEmail}. Enter their first and last name before saving the team.`)
          }
          logFrontendEvent({ category: 'teams.registration_invite', message: 'succeeded', data: { correlationId, teamId: target?.teamId || null, email, source: target?.source || null, memberId: target?.memberId || null, manualNameRequired: target?.source === 'create' } })
          setInviteOpen(false)
          setInviteTarget(null)
          await load()
        }}
      />
    </div>
  )
}

function makeDraftMemberId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }
}

function makeBlankDraftMember(): DraftMember {
  return { id: makeDraftMemberId(), firstName: '', lastName: '', email: '', validationState: 'idle' }
}

function splitName(full: string) {
  const s = String(full || '').trim()
  if (!s) return { firstName: '', lastName: '' }
  const parts = s.split(/\s+/)
  const firstName = parts.shift() || ''
  const lastName = parts.join(' ')
  return { firstName, lastName }
}

function buildLeadDraftMember(user: any): DraftMember {
  const email = String(user?.email || '').trim().toLowerCase()
  const split = splitName(user?.name || email.split('@')[0] || '')
  return {
    id: String(user?.id || 'signed-in-user'),
    firstName: split.firstName || email,
    lastName: split.lastName,
    email,
    status: 'active',
    verified: true,
    validationState: 'validated',
  }
}

function toTeamMemberDraft(member: DraftMember): TeamMember {
  return {
    id: member.id,
    name: `${member.firstName} ${member.lastName}`.replace(/\s+/g, ' ').trim() || String(member.email || '').trim().toLowerCase(),
    email: String(member.email || '').trim().toLowerCase(),
    status: member.status,
    verified: member.verified,
  }
}

function isValidTeamSize(count: number) {
  return count >= MIN_TEAM_SIZE && count <= MAX_TEAM_SIZE
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function hasDuplicateEmails(members: TeamMember[]) {
  const seen = new Set<string>()
  for (const member of members) {
    const email = String(member.email || '').trim().toLowerCase()
    if (!email) continue
    if (seen.has(email)) return true
    seen.add(email)
  }
  return false
}


function teamStatusLabel(team: Team) {
  const members = team.members || []
  const hasPendingMember = Boolean((team as any).hasPendingMembers) || members.some(member => member.status !== 'active' || member.verified === false)
  return hasPendingMember ? 'Pending' : 'Verified'
}

function buildSuggestedTeamName(baseName: string, teams: Team[], excludeTeamId?: string) {
  const base = String(baseName || '').replace(/\s+/g, ' ').trim() || 'Team'
  const taken = new Set(
    teams
      .filter(team => !excludeTeamId || String(team.id) !== String(excludeTeamId))
      .map(team => String(team.name || '').replace(/\s+/g, ' ').trim().toLowerCase()),
  )
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now().toString(36)}`
}
