import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import ProtectedRoute from '../components/ProtectedRoute'
import type { HoleScoreDetail, ScoreEntry, TeamMember } from '../types'
import { useGolfCourseStates } from '../hooks/useGolfCourseStates'
import { createTeam, fetchTeams, lookupUserByEmail, sendHomieInvite } from '../lib/teams'
import { getUserTodayISO } from '../lib/date'
import { useAuth } from '../context/AuthContext'
import UseMyLocationButton from '../components/UseMyLocationButton'
import InviteHomieModal from '../components/InviteHomieModal'
import { useNavigate } from 'react-router-dom'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import HoleByHoleScorecard from '../components/HoleByHoleScorecard'
import TeeColorSelector from '../components/TeeColorSelector'
import GolfCourseInput from '../components/GolfCourseInput'
import { buildClientDefaultHoleScorecard, missingHoleScoreNumbers, providedHoleScoreTotal } from '../lib/hole-scorecard'
import type { TeeColorSelection } from '../lib/tee-colors'
import { DEFAULT_TEE_COLOR, normalizeTeeColor } from '../lib/tee-colors'

type DraftMember = { firstName: string; lastName: string; email: string; invited?: boolean }

type TeamRoundScoreLookup = {
  score: ScoreEntry | null
  teamTotal: number | null
  opponentTotal: number | null
  teamHoles?: HoleScoreDetail[] | null
  opponentHoles?: HoleScoreDetail[] | null
}

function splitUserName(name: string | null | undefined, email: string | null | undefined) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return { firstName: String(email || '').split('@')[0] || '', lastName: '' }
  const [firstName = '', ...rest] = trimmed.split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}

export default function GolfLoggerPage() {
  return (
    <ProtectedRoute>
      <GolfLoggerInner />
    </ProtectedRoute>
  )
}

function GolfLoggerInner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const today = getUserTodayISO()
  const [date, setDate] = useState(() => getUserTodayISO())
  const [stateAbbr, setStateAbbr] = useState('UT')
  const [allTeams, setAllTeams] = useState<string[]>([])
  const [myTeams, setMyTeams] = useState<string[]>([])
  const [course, setCourse] = useState('')
  const [courseId, setCourseId] = useState('')
  const [courseSearch, setCourseSearch] = useState('')
  const [teeColor, setTeeColor] = useState<TeeColorSelection>('')
  const [team, setTeam] = useState('')
  const [opponentTeam, setOpponentTeam] = useState('')
  const [teamTotal, setTeamTotal] = useState<string>('')
  const [opponentTotal, setOpponentTotal] = useState<string>('')
  const [useHoles, setUseHoles] = useState(false)
  const [holes, setHoles] = useState<HoleScoreDetail[]>(() => buildClientDefaultHoleScorecard('UT', '', DEFAULT_TEE_COLOR))
  const [opponentHoles, setOpponentHoles] = useState<HoleScoreDetail[]>(() => buildClientDefaultHoleScorecard('UT', '', DEFAULT_TEE_COLOR))
  const [activeScorecardSide, setActiveScorecardSide] = useState<'team' | 'opponent' | null>(null)
  const [busy, setBusy] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [showRoundValidation, setShowRoundValidation] = useState(false)
  const [showCreateTeamValidation, setShowCreateTeamValidation] = useState(false)

  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const leadMember = useMemo(() => {
    const names = splitUserName(user?.name, user?.email)
    return { firstName: names.firstName, lastName: names.lastName, email: user?.email || '' }
  }, [user?.email, user?.name])
  const [newMembers, setNewMembers] = useState<DraftMember[]>([leadMember])
  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const [existingTeamRoundScoreId, setExistingTeamRoundScoreId] = useState<string | null>(null)
  const { states: stateOptions, loading: statesLoading, error: statesError } = useGolfCourseStates()
  const [opponentScoreStatus, setOpponentScoreStatus] = useState<string | null>(null)

  async function loadTeams() {
    try {
      const t = await fetchTeams()
      const names = t.map(x => x.name).sort((a, b) => a.localeCompare(b))
      setAllTeams(names)

      const myEmail = String(user?.email || '').toLowerCase()
      const mine = myEmail
        ? t.filter(teamObj => Array.isArray(teamObj.members) && teamObj.members.some((m: any) => String(m.email || '').toLowerCase() === myEmail))
            .map(x => x.name)
            .sort((a, b) => a.localeCompare(b))
        : []
      setMyTeams(mine)

      if (mine.length > 0) {
        setTeam(prev => (mine.includes(prev) ? prev : mine[0]))
      } else {
        setTeam('')
      }
    } catch {
      setAllTeams([])
      setMyTeams([])
    }
  }

  useEffect(() => {
    loadTeams()
  }, [user?.email])

  useEffect(() => {
    setNewMembers(prev => {
      if (!prev.length) return [leadMember]
      const next = [...prev]
      next[0] = leadMember
      return next
    })
  }, [leadMember])

  useEffect(() => {
    if (stateOptions.length && !stateOptions.some(option => option.abbr === stateAbbr)) {
      setStateAbbr(stateOptions[0].abbr)
      setCourse('')
      setCourseId('')
      setCourseSearch('')
    }
  }, [stateOptions, stateAbbr])

  const holesTotal = useMemo(() => providedHoleScoreTotal(holes), [holes])
  const missingHoleNumbers = useMemo(() => missingHoleScoreNumbers(holes), [holes])
  const missingOpponentHoleNumbers = useMemo(() => missingHoleScoreNumbers(opponentHoles), [opponentHoles])
  const teamScoreProvidedCount = useMemo(() => holes.filter((hole) => hole.scoreProvided).length, [holes])
  const opponentScoreProvidedCount = useMemo(() => opponentHoles.filter((hole) => hole.scoreProvided).length, [opponentHoles])
  const teamRoundContextLocked = useMemo(() => useHoles && teamScoreProvidedCount > 0, [useHoles, teamScoreProvidedCount])
  const scorecardContextReady = useMemo(() => Boolean(useHoles && date && stateAbbr && course && team.trim() && opponentTeam.trim() && team.trim().toLowerCase() !== opponentTeam.trim().toLowerCase()), [useHoles, date, stateAbbr, course, team, opponentTeam])

  useEffect(() => {
    if (!useHoles) return
    setTeamTotal(String(holesTotal))
  }, [useHoles, holesTotal])
  useEffect(() => {
    let cancelled = false
    async function loadExistingTeamRoundScore() {
      if (!date || !stateAbbr || !course || !team.trim() || !opponentTeam.trim() || team.trim().toLowerCase() === opponentTeam.trim().toLowerCase()) {
        setExistingTeamRoundScoreId(null)
        setOpponentScoreStatus(null)
        return
      }

      const params = new URLSearchParams({ date, state: stateAbbr, course, team, opponentTeam })
      if (courseId) params.set('courseId', courseId)
      try {
        const result = await api<TeamRoundScoreLookup>(`/api/team-round-score?${params.toString()}`)
        if (cancelled) return
        setExistingTeamRoundScoreId(result.score?.id || null)
        setOpponentTotal(result.opponentTotal === null || result.opponentTotal === undefined ? '' : String(result.opponentTotal))
        setOpponentHoles(Array.isArray(result.opponentHoles) ? result.opponentHoles : buildClientDefaultHoleScorecard(stateAbbr, course))
        if ((teamTotal === '' || teamTotal === '0') && Number.isFinite(Number(result.teamTotal))) setTeamTotal(String(result.teamTotal))
        setOpponentScoreStatus(result.opponentTotal === null || result.opponentTotal === undefined ? 'Opponent score pending. Only the opponent team can update it.' : 'Opponent score loaded as read-only.')
        logFrontendEvent({ category: 'team.round.scoreLookup', message: 'loaded', data: { date, stateAbbr, course, team, opponentTeam, scoreId: result.score?.id || null, hasOpponentTotal: result.opponentTotal !== null && result.opponentTotal !== undefined } })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Could not load opponent score.'
        setExistingTeamRoundScoreId(null)
        setOpponentScoreStatus('Opponent score pending. Only the opponent team can update it.')
        logFrontendEvent({ category: 'team.round.scoreLookup', level: 'warn', message: 'failed', data: { date, stateAbbr, course, team, opponentTeam, error: message } })
      }
    }
    void loadExistingTeamRoundScore()
    return () => { cancelled = true }
  }, [date, stateAbbr, course, courseId, team, opponentTeam])

  const totals = useMemo(() => {
    const your = Number(teamTotal)
    const opp = Number(opponentTotal)
    const valid = teamTotal !== '' && Number.isFinite(your)
    const opponentValid = opponentTotal !== '' && Number.isFinite(opp)
    const result = !valid ? '' : (!opponentValid ? 'Pending opponent score' : (your < opp ? 'Win' : your > opp ? 'Loss' : 'Tie'))
    return { your, opp, valid, opponentValid, result }
  }, [teamTotal, opponentTotal])

  const resultClass = totals.result === 'Win' ? 'eventWin' : totals.result === 'Loss' ? 'eventLoss' : totals.result === 'Tie' ? 'eventTie' : ''

  const missingFields = useMemo(() => {
    const missing: string[] = []
    if (!date) missing.push('Date')
    if (date && date > today) missing.push('Date cannot be in the future')
    if (!stateAbbr) missing.push('State')
    if (!course.trim()) missing.push('Course')
    if (!team.trim()) missing.push('Your team')
    if (!opponentTeam.trim()) missing.push('Opponent team')
    if (team.trim() && opponentTeam.trim() && team.trim().toLowerCase() === opponentTeam.trim().toLowerCase()) missing.push('Opponent team must be different from your team')
    if (teamTotal === '' || !Number.isFinite(Number(teamTotal))) missing.push('Your team round score')
    return missing
  }, [date, today, stateAbbr, course, team, opponentTeam, teamTotal])

  const cleanedNewMembers = useMemo(() => {
    return newMembers
      .map(m => ({ name: `${m.firstName} ${m.lastName}`.trim(), email: m.email.trim() }))
      .filter(m => m.name || m.email)
  }, [newMembers])

  const createMissing = useMemo(() => {
    const missing: string[] = []
    if (!newTeamName.trim()) missing.push('Team name')
    if (cleanedNewMembers.length < 2) missing.push('At least one teammate')
    if (cleanedNewMembers.length > 4) missing.push('Only four team members are allowed')
    return missing
  }, [newTeamName, cleanedNewMembers])


  async function handleLookupMember() {
    const email = lookupEmail.trim().toLowerCase()
    if (!email) {
      setErr('Enter an email to look up.')
      return
    }
    if (newMembers.some(member => member.email.trim().toLowerCase() === email)) {
      setErr('That teammate is already on this team. Pick a different golfer.')
      return
    }
    if (newMembers.length >= 4) {
      setErr('Teams can have a maximum of 4 people.')
      return
    }

    setLookupBusy(true)
    setErr(null)
    try {
      const result = await lookupUserByEmail(email)
      if (!result.found) {
        setInviteEmail(email)
        setShowInviteModal(true)
        return
      }
      const split = splitUserName(result.name, result.email)
      setNewMembers(prev => [...prev, { firstName: result.firstName || split.firstName, lastName: split.lastName, email: result.email, invited: false }])
      setLookupEmail('')
      setMsg(`${result.firstName || 'Teammate'} added to the team roster.`)
    } catch (e: any) {
      setErr(e.message || 'Could not look up teammate')
    } finally {
      setLookupBusy(false)
    }
  }



  async function cancelTeamRoundRecords() {
    if (!useHoles || !date || !stateAbbr || !course || !team.trim() || !opponentTeam.trim()) return null
    const params = new URLSearchParams({
      mode: 'team',
      date,
      state: stateAbbr,
      course,
      team,
      opponentTeam,
    })
    if (courseId) params.set('courseId', courseId)
    if (existingTeamRoundScoreId) params.set('scoreId', existingTeamRoundScoreId)
    return api(`/api/scores/cancel-round?${params.toString()}`, { method: 'DELETE' })
  }

  async function handleCancelRound() {
    const correlationId = getCorrelationId()
    setCanceling(true)
    setErr(null)
    logFrontendEvent({
      category: 'team.round.cancel',
      message: 'started',
      data: { correlationId, date, stateAbbr, course, courseId, teeColor, team, opponentTeam, useHoles, teamScoreProvidedCount, opponentScoreProvidedCount, scoreId: existingTeamRoundScoreId },
    })
    try {
      const cancelResult = await cancelTeamRoundRecords()
      logFrontendEvent({ category: 'team.round.cancel', message: 'succeeded', data: { correlationId, scoreId: existingTeamRoundScoreId, cancelResult } })
      navigate('/my-golf-scores')
    } catch (e: any) {
      const message = e?.message || 'Could not cancel this round.'
      logFrontendEvent({ category: 'team.round.cancel', level: 'error', message: 'failed', data: { correlationId, scoreId: existingTeamRoundScoreId, error: message } })
      setErr(message)
    } finally {
      setCanceling(false)
    }
  }

  function openScorecardModal(side: 'team' | 'opponent') {
    setErr(null)
    if (!scorecardContextReady) {
      setErr('Select a date, state, course, your team, and opponent team before entering hole-by-hole scores.')
      return
    }
    const effectiveTeeColor = normalizeTeeColor(teeColor)
    if (side === 'opponent') {
      setErr('Opponent score is read-only. Only members of the opponent team can modify that score.')
      logFrontendEvent({ category: 'team.scorecard.modal', level: 'warn', message: 'opponent_score_read_only_blocked', data: { side, date, stateAbbr, course, courseId, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor), team, opponentTeam } })
      return
    }
    setActiveScorecardSide(side)
    logFrontendEvent({ category: 'team.scorecard.modal', message: 'opened', data: { side, date, stateAbbr, course, courseId, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor), team, opponentTeam } })
  }

  function scorecardButtonLabel(side: 'team' | 'opponent') {
    const label = side === 'team' ? (team || 'Your Team') : (opponentTeam || 'Opponent Team')
    return `Score input for ${label}`
  }

  function scorecardButtonSummary(side: 'team' | 'opponent') {
    if (side === 'opponent') return opponentTotal ? `Read-only opponent score ${opponentTotal}` : 'Opponent score pending'
    const provided = teamScoreProvidedCount
    const total = holesTotal
    return `${provided} of 18 holes entered • Current score ${total}`
  }

  function scorecardButtonHelp(side: 'team' | 'opponent') {
    if (side === 'opponent') return 'Read-only opponent score. Only that team can update it.'
    const missing = missingHoleNumbers
    if (!scorecardContextReady) return 'Complete round setup first, then tap here to enter hole scores.'
    if (!missing.length) return 'Tap to review or update saved hole scores.'
    return `Tap to enter hole-by-hole scores. Needs holes ${missing.join(', ')}.`
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <h1 className="pageSimpleTitle">Team Round</h1>

        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => { setShowCreateTeam(v => !v); setErr(null); setMsg(null) }}>
            {showCreateTeam ? 'Hide Create Team' : 'Create Team'}
          </button>
        </div>

        {showCreateTeam ? (
          <div className="card" style={{ marginTop: 14, background: '#fafbff' }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Create Team</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ maxWidth: 560 }}>
                <label className="label">Team name</label>
                <input className="input" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. Fairway Finders" />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Team members (max 4)</div>
                <div className="card" style={{ padding: 12, background: 'rgba(255,255,255,.72)' }}>
                  <div style={{ fontWeight: 800, marginTop: 4 }}>{leadMember.firstName} {leadMember.lastName}</div>
                  <div className="small">{leadMember.email}</div>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {newMembers.slice(1).map((m, idx) => (
                    <div key={`${m.email}-${idx}`} className="card" style={{ padding: 12, background: 'rgba(255,255,255,.72)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800 }}>{m.firstName} {m.lastName}</div>
                          <div className="small">{m.email}</div>
                          <div className="small" style={{ marginTop: 4 }}>{m.invited ? 'Registration invite sent' : 'Ready to add to team'}</div>
                        </div>
                        <button type="button" className="btn" onClick={() => setNewMembers(prev => prev.filter(member => member.email !== m.email))}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
                {newMembers.length < 4 ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, marginTop: 10, maxWidth: 620 }}>
                      <div>
                        <label className="label">Teammate email</label>
                        <input className="input" type="email" value={lookupEmail} onChange={e => setLookupEmail(e.target.value)} placeholder="Find teammate by email" />
                      </div>
                      <button type="button" className="btn" style={{ alignSelf: 'end' }} disabled={lookupBusy} onClick={handleLookupMember}>Lookup</button>
                    </div>
                    <div className="small" style={{ marginTop: 6 }}>If the email is not found, an invite will open so you can send a registration invite and then come right back here.</div>
                  </>
                ) : (
                  <div className="small" style={{ marginTop: 10 }}>This team already has the maximum 4 golfers, so the add-teammate input is hidden.
                  Member 1 is always the signed-in user and cannot be changed.</div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btnSmall btnLightBlue"
                    disabled={busy}
                    onClick={async () => {
                      const correlationId = getCorrelationId()
                      setShowCreateTeamValidation(true)
                      if (createMissing.length) {
                        const message = `Please complete: ${createMissing.join(', ')}`
                        setErr(message)
                        logFrontendEvent({ category: 'team.create', level: 'warn', message: 'validation_failed', data: { correlationId, createMissing, teamName: newTeamName.trim() } })
                        return
                      }
                      setBusy(true)
                      setErr(null)
                      setMsg(null)
                      logFrontendEvent({ category: 'team.create', message: 'started', data: { correlationId, teamName: newTeamName.trim(), memberCount: cleanedNewMembers.length } })
                      try {
                        const created = await createTeam(newTeamName.trim(), cleanedNewMembers as Omit<TeamMember, 'id'>[])
                        logFrontendEvent({ category: 'team.create', message: 'succeeded', data: { correlationId, teamName: created.name, memberCount: cleanedNewMembers.length } })
                        setMsg(`Team ${created.name} created.`)
                        setShowCreateTeam(false)
                        setShowCreateTeamValidation(false)
                        setNewTeamName('')
                        setNewMembers([leadMember])
                        setLookupEmail('')
                        setInviteMessage(null)
                        await loadTeams()
                        setTeam(created.name)
                      } catch (e: any) {
                        const message = e.message || 'Failed to create team'
                        logFrontendEvent({ category: 'team.create', level: 'error', message: 'failed', data: { correlationId, teamName: newTeamName.trim(), error: message } })
                        setErr(message)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {busy ? 'Creating…' : 'Save Team'}
                  </button>
                  {showCreateTeamValidation && createMissing.length ? <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>Missing or invalid: {createMissing.join(', ')}</div> : null}
                  {err && showCreateTeam ? <div className="small" style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <InviteHomieModal
          open={showInviteModal}
          defaultEmail={inviteEmail}
          onClose={() => setShowInviteModal(false)}
          onSubmit={async ({ email, message }) => {
            await sendHomieInvite(email, message)
            const normalizedEmail = email.trim().toLowerCase()
            const alreadyAdded = newMembers.some(member => member.email.trim().toLowerCase() === normalizedEmail)
            if (!alreadyAdded && newMembers.length < 4) {
              const [firstName = 'Invited golfer'] = normalizedEmail.split('@')
              setNewMembers(prev => [...prev, { firstName, lastName: '', email: normalizedEmail, invited: true }])
            }
            setInviteMessage(`Invite sent to ${normalizedEmail}. They will show as pending until they register and verify.`)
            setLookupEmail('')
            setShowInviteModal(false)
            setMsg(`Invite sent. ${normalizedEmail} was added to the team list as pending.`)
          }}
        />

        {teamRoundContextLocked ? null : (
          <div className="grid grid2" style={{ marginTop: 14 }}>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">State</label>
            <select className="input" value={stateAbbr} onChange={(e) => { setStateAbbr(e.target.value); setCourse(''); setCourseId(''); setCourseSearch('') }} disabled={statesLoading && !stateOptions.length}>
              {!stateOptions.length ? <option value={stateAbbr}>{statesLoading ? 'Loading golf course states…' : (stateAbbr || 'No golf course states available')}</option> : null}
              {stateOptions.map(s => (
                <option key={s.abbr} value={s.abbr}>{s.name}</option>
              ))}
            </select>
            {statesError ? <div className="small">{statesError}</div> : null}
          </div>
          <div>
            <GolfCourseInput
              label="Course"
              state={stateAbbr}
              searchValue={courseSearch}
              selectedCourseName={course}
              selectedCourseId={courseId}
              onSearchChange={(next) => {
                setCourseSearch(next)
                setCourse('')
                setCourseId('')
              }}
              onCourseSelected={(selected) => {
                setCourseId(selected.id || '')
                setCourse(selected.name || '')
                setCourseSearch(selected.name || '')
              }}
              placeholder="Search courses in the selected state"
              helperText="Search checks every available course for the selected state."
              inputId="teamRoundCourseSearch"
              enableNearestDefault
              onStateChange={setStateAbbr}
              required
            />
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <UseMyLocationButton
                onResolved={(location) => {
                  setStateAbbr(location.stateCode)
                  setCourse('')
                  setCourseId('')
                  setCourseSearch('')
                  setLocationMessage(`Location set to ${location.label}.`)
                }}
                onStatus={setLocationMessage}
              />
              {locationMessage ? <span className="small">{locationMessage}</span> : null}
            </div>
          </div>
          <TeeColorSelector value={teeColor} onChange={setTeeColor} label="Tees played" />
          <div>
            <label className="label">Your team</label>
            <input
              className="input"
              list="my-teams-list"
              value={team}
              onChange={e => {
                const nextTeam = e.target.value
                setTeam(nextTeam)
                if (nextTeam && nextTeam.trim().toLowerCase() === String(opponentTeam || '').trim().toLowerCase()) setOpponentTeam('')
              }}
              placeholder={myTeams.length ? 'Select your team…' : 'Create a team first'}
            />
            <datalist id="my-teams-list">
              {myTeams.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="small" style={{ marginTop: 6 }}>Only teams you are a member of are available to log rounds for.</div>
          </div>
          <div>
            <label className="label">Opponent team</label>
            <input className="input" list="opponent-teams-list" value={opponentTeam} onChange={e => setOpponentTeam(e.target.value)} placeholder="Select or type…" />
            <datalist id="opponent-teams-list">
              {allTeams.filter(t => t.toLowerCase() !== String(team || '').trim().toLowerCase()).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="small" style={{ marginTop: 6 }}>Opponent is required and must be different from your team.</div>
          </div>
          {!useHoles ? (
            <>
              <div>
                <label className="label">{team ? `${team} Round Score` : 'Your Team Round Score'}</label>
                <input className="input" type="number" value={teamTotal} onChange={e => setTeamTotal(e.target.value)} />
              </div>
              <div>
                <label className="label">{opponentTeam ? `${opponentTeam} Round Score` : 'Opponent Round Score'}</label>
                <input className="input inputReadOnly" type="number" value={opponentTotal} readOnly placeholder="Opponent score pending" />
                <div className="small" style={{ marginTop: 6 }}>{opponentScoreStatus || 'Only members of the opponent team can update this score.'}</div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">{team ? `${team} Score` : 'Your Team Score'}</label>
                <button type="button" className="teamScorecardOpenButton teamScorecardInputButton" onClick={() => openScorecardModal('team')} disabled={!scorecardContextReady}>
                  <span className="teamScorecardInputBadge">Tap to enter score</span>
                  <strong>{scorecardButtonLabel('team')}</strong>
                  <span>{scorecardButtonSummary('team')}</span>
                  <span>{scorecardButtonHelp('team')}</span>
                </button>
              </div>
              <div>
                <label className="label">{opponentTeam ? `${opponentTeam} Score` : 'Opponent Team Score'}</label>
                <button type="button" className="teamScorecardOpenButton teamScorecardInputButton teamScorecardInputButton--readonly" onClick={() => openScorecardModal('opponent')} disabled={!scorecardContextReady}>
                  <span className="teamScorecardInputBadge">Read-only score</span>
                  <strong>{scorecardButtonLabel('opponent')}</strong>
                  <span>{scorecardButtonSummary('opponent')}</span>
                  <span>{scorecardButtonHelp('opponent')}</span>
                </button>
              </div>
            </>
          )}
          <div>
            <label className="label">Result</label>
            <input className={`input inputReadOnly ${resultClass}`} readOnly value={totals.result} />
          </div>
          <div>
            <label className="label">Hole-by-hole entry</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={useHoles} onChange={e => setUseHoles(e.target.checked)} />
              <span className="small">Enable scorecard input</span>
            </div>
          </div>
        </div>
        )}


        {teamRoundContextLocked ? (
          <div className="soloLockedRoundSummary teamLockedRoundSummary" aria-label="Locked team round details">
            <div>
              <span>Your Team</span>
              <strong>{team || 'Selected team'}</strong>
            </div>
            <div>
              <span>Opponent Team</span>
              <strong>{opponentTeam || 'Opponent team'}</strong>
            </div>
            <div>
              <span>{team ? `${team} Round Score` : 'Your Team Round Score'}</span>
              <button type="button" className="lockedScorecardButton" onClick={() => openScorecardModal('team')}>
                <strong>{teamTotal || String(holesTotal)}</strong>
                <small>{scorecardButtonHelp('team')}</small>
              </button>
            </div>
            <div>
              <span>{opponentTeam ? `${opponentTeam} Round Score` : 'Opponent Round Score'}</span>
              <button type="button" className="lockedScorecardButton lockedScorecardButton--readonly" onClick={() => openScorecardModal('opponent')}>
                <strong>{opponentTotal || 'Pending'}</strong>
                <small>{scorecardButtonHelp('opponent')}</small>
              </button>
            </div>
            <div>
              <span>Result</span>
              <strong className={resultClass}>{totals.result || 'Enter opponent score'}</strong>
            </div>
          </div>
        ) : null}

        {inviteMessage ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{inviteMessage}</div> : null}
        {msg ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{msg}</div> : null}
        {showRoundValidation && missingFields.length ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
        {err && !showCreateTeam ? <div className="small" style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btnPrimary"
            disabled={busy || canceling}
            onClick={async () => {
              const correlationId = getCorrelationId()
              setShowRoundValidation(true)
              if (missingFields.length) {
                const message = `Please complete: ${missingFields.join(', ')}`
                setErr(message)
                logFrontendEvent({ category: 'team.round.save', level: 'warn', message: 'validation_failed', data: { correlationId, missingFields } })
                return
              }
              if (useHoles && missingHoleNumbers.length) {
                const message = `Finish entering scores for your team holes: ${missingHoleNumbers.join(', ')}.`
                setErr(message)
                logFrontendEvent({ category: 'team.round.save', level: 'warn', message: 'hole_scores_incomplete', data: { correlationId, missingHoleNumbers } })
                return
              }
              const effectiveTeeColor = normalizeTeeColor(teeColor)
              setBusy(true)
              setErr(null)
              setMsg(null)
              logFrontendEvent({ category: 'team.round.save', message: 'started', data: { correlationId, date, stateAbbr, course, courseId, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor), team, opponentTeam, useHoles } })
              try {
                const trimmedTeam = String(team || '').trim()
                const trimmedOpp = String(opponentTeam || '').trim()
                if (!date) throw new Error('Date is required')
                if (date > today) throw new Error('Date cannot be in the future')
                if (!stateAbbr) throw new Error('State is required')
                if (!trimmedTeam) throw new Error('Team is required')
                if (!trimmedOpp) throw new Error('Opponent team is required')
                if (trimmedTeam.toLowerCase() === trimmedOpp.toLowerCase()) throw new Error('Opponent team must be different from your team')
                if (!course.trim()) throw new Error('Course is required')
                if (!totals.valid) throw new Error('Please enter your team round score')

                const body: Partial<ScoreEntry> & any = {
                  date,
                  state: stateAbbr,
                  course,
                  courseId,
                  teeColor: effectiveTeeColor,
                  team: trimmedTeam,
                  opponentTeam: trimmedOpp,
                  teamTotal: useHoles ? holesTotal : totals.your,
                  holes: useHoles ? holes : null
                }
                const savePath = existingTeamRoundScoreId ? `/api/scores/${encodeURIComponent(existingTeamRoundScoreId)}` : '/api/scores'
                const saveMethod = existingTeamRoundScoreId ? 'PATCH' : 'POST'
                await api<ScoreEntry>(savePath, { method: saveMethod, body: JSON.stringify(body) })
                logFrontendEvent({ category: 'team.round.save', message: 'succeeded', data: { correlationId, team: trimmedTeam, opponentTeam: trimmedOpp, course, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor), result: totals.result, useHoles, cumulativeScore: useHoles ? holesTotal : null, existingTeamRoundScoreId, opponentScoreReadOnly: true } })
                setMsg('Round saved. Opponent score remains read-only for the opponent team.')
                setCourse('')
                setCourseId('')
                setTeam(myTeams[0] || '')
                setOpponentTeam('')
                setTeamTotal('')
                setOpponentTotal('')
                setHoles(buildClientDefaultHoleScorecard(stateAbbr, course, effectiveTeeColor))
                setOpponentHoles(buildClientDefaultHoleScorecard(stateAbbr, course, effectiveTeeColor))
                setExistingTeamRoundScoreId(null)
                setOpponentScoreStatus(null)
                setShowRoundValidation(false)
                navigate('/')
              } catch (e: any) {
                const message = e.message || 'Failed to save'
                logFrontendEvent({ category: 'team.round.save', level: 'error', message: 'failed', data: { correlationId, error: message, team, opponentTeam, course, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor) } })
                setErr(message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save Round'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || canceling}
            onClick={handleCancelRound}
          >
            {canceling ? 'Canceling…' : 'Cancel Round'}
          </button>
        </div>

        {activeScorecardSide ? (
          <div className="modalOverlay teamScorecardModalOverlay" role="presentation" onClick={() => setActiveScorecardSide(null)}>
            <div className="modalCard teamScorecardModalCard" role="dialog" aria-modal="true" aria-label={activeScorecardSide === 'team' ? 'Your team hole-by-hole scorecard' : 'Opponent team hole-by-hole scorecard'} onClick={(event) => event.stopPropagation()}>
              <div className="teamScorecardModalHeader">
                <div>
                  <div className="small">Hole-by-hole score input</div>
                  <h2>{activeScorecardSide === 'team' ? `${team || 'Your Team'} Score` : `${opponentTeam || 'Opponent Team'} Score`}</h2>
                </div>
                <button type="button" className="btn btnSmall" onClick={() => setActiveScorecardSide(null)}>Close</button>
              </div>
              <HoleByHoleScorecard
                enabled={true}
                stateCode={stateAbbr}
                course={course}
                courseId={courseId}
                holes={activeScorecardSide === 'team' ? holes : opponentHoles}
                onChange={activeScorecardSide === 'team' ? setHoles : setOpponentHoles}
                draftContext={{ mode: 'team', date, team, opponentTeam, scoringSide: activeScorecardSide }}
                scoreOwnerLabel={activeScorecardSide === 'team' ? `${team || 'Your Team'} score` : `${opponentTeam || 'Opponent Team'} score`}
                teeColor={teeColor}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
