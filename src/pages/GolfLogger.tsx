import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import ProtectedRoute from '../components/ProtectedRoute'
import type { ScoreEntry, TeamMember } from '../types'
import { US_STATES } from '../data/usStates'
import { getCoursesForState } from '../data/coursesByState'
import { createTeam, fetchTeams, lookupUserByEmail, sendHomieInvite } from '../lib/teams'
import { getUserTodayISO } from '../lib/date'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'
import UseMyLocationButton from '../components/UseMyLocationButton'
import InviteHomieModal from '../components/InviteHomieModal'

const NUM_HOLES = 18
type DraftMember = { firstName: string; lastName: string; email: string; invited?: boolean }

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
  const today = getUserTodayISO()
  const [date, setDate] = useState(() => getUserTodayISO())
  const [stateAbbr, setStateAbbr] = useState('UT')
  const [allTeams, setAllTeams] = useState<string[]>([])
  const [myTeams, setMyTeams] = useState<string[]>([])
  const [course, setCourse] = useState('')
  const [team, setTeam] = useState('')
  const [opponentTeam, setOpponentTeam] = useState('')
  const [teamTotal, setTeamTotal] = useState<string>('')
  const [opponentTotal, setOpponentTotal] = useState<string>('')
  const [useHoles, setUseHoles] = useState(false)
  const [holes, setHoles] = useState<number[]>(Array(NUM_HOLES).fill(0))
  const [busy, setBusy] = useState(false)
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

  const holesTotal = useMemo(() => holes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), [holes])
  const courseOptions = useMemo(() => getCoursesForState(stateAbbr), [stateAbbr])

  const totals = useMemo(() => {
    const your = Number(teamTotal)
    const opp = Number(opponentTotal)
    const valid = teamTotal !== '' && opponentTotal !== '' && Number.isFinite(your) && Number.isFinite(opp)
    const result = !valid ? '' : (your < opp ? 'Win' : your > opp ? 'Loss' : 'Tie')
    const diff = !valid ? 0 : Math.abs(opp - your)
    const money = !valid ? 0 : (your < opp ? diff : your > opp ? -diff : 0)
    return { your, opp, valid, result, money }
  }, [teamTotal, opponentTotal])

  const moneyText = useMemo(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totals.money), [totals.money])
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
    if (opponentTotal === '' || !Number.isFinite(Number(opponentTotal))) missing.push('Opponent round score')
    return missing
  }, [date, today, stateAbbr, course, team, opponentTeam, teamTotal, opponentTotal])

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

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Team scramble"
          title="Log a team round fast"
          subtitle="Keep the roster-aware workflow, get the result auto-calculated, and save without extra clicks."
        />

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
                  <div className="small">Signed-in golfer</div>
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
                <div className="small" style={{ marginTop: 6 }}>Member 1 is always the signed-in user and cannot be changed.</div>
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
                  <div className="small" style={{ marginTop: 10 }}>This team already has the maximum 4 golfers, so the add-teammate input is hidden.</div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btnSmall btnLightBlue"
                    disabled={busy}
                    onClick={async () => {
                      setShowCreateTeamValidation(true)
                      if (createMissing.length) {
                        setErr(`Please complete: ${createMissing.join(', ')}`)
                        return
                      }
                      setBusy(true)
                      setErr(null)
                      setMsg(null)
                      try {
                        const created = await createTeam(newTeamName.trim(), cleanedNewMembers as Omit<TeamMember, 'id'>[])
                        setMsg(`Team ${created.name} created.`)
                        setShowCreateTeam(false)
                        setShowCreateTeamValidation(false)
                        setNewTeamName('')
                        setNewMembers([leadMember])
                        setLookupEmail('')
                        await loadTeams()
                        setTeam(created.name)
                      } catch (e: any) {
                        setErr(e.message || 'Failed to create team')
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {busy ? 'Creating…' : 'Save Team'}
                  </button>
                </div>
                {showCreateTeamValidation && createMissing.length ? <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>Missing or invalid: {createMissing.join(', ')}</div> : null}
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

        <div className="grid grid2" style={{ marginTop: 14 }}>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">State</label>
            <select className="input" value={stateAbbr} onChange={(e) => { setStateAbbr(e.target.value); setCourse('') }}>
              {US_STATES.map(s => (
                <option key={s.abbr} value={s.abbr}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Course</label>
            <input className="input" list="courseOptionsByState" value={course} onChange={e => setCourse(e.target.value)} placeholder="Start typing a course…" />
            <datalist id="courseOptionsByState">
              {courseOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <UseMyLocationButton
                onResolved={(location) => {
                  setStateAbbr(location.stateCode)
                  const nextCourses = getCoursesForState(location.stateCode)
                  setCourse(nextCourses[0] || '')
                  setLocationMessage(`Location set to ${location.label}.`)
                }}
                onStatus={setLocationMessage}
              />
              {locationMessage ? <span className="small">{locationMessage}</span> : null}
            </div>
          </div>
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
          <div>
            <label className="label">{team ? `${team} Round Score` : 'Your Team Round Score'}</label>
            <input className="input" type="number" value={teamTotal} onChange={e => setTeamTotal(e.target.value)} />
          </div>
          <div>
            <label className="label">{opponentTeam ? `${opponentTeam} Round Score` : 'Opponent Round Score'}</label>
            <input className="input" type="number" value={opponentTotal} onChange={e => setOpponentTotal(e.target.value)} />
          </div>
          <div>
            <label className="label">Money Won / Lost</label>
            <input className={`input inputReadOnly ${resultClass}`} readOnly value={totals.valid ? moneyText : ''} />
            <div className="small" style={{ marginTop: 6 }}>Automatically calculated using standard golf scoring (lower score wins).</div>
          </div>
          <div>
            <label className="label">Result</label>
            <input className={`input inputReadOnly ${resultClass}`} readOnly value={totals.result} />
            <div className="small" style={{ marginTop: 6 }}>Read-only and computed from the two round scores.</div>
          </div>
          <div>
            <label className="label">Per-hole entry (future-friendly)</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={useHoles} onChange={e => setUseHoles(e.target.checked)} />
              <span className="small">Enable 18-hole inputs (optional)</span>
            </div>
            {useHoles ? <div className="small" style={{ marginTop: 6 }}>Per-hole total: <strong>{holesTotal}</strong></div> : null}
          </div>
        </div>

        {useHoles ? (
          <div className="card" style={{ marginTop: 16, background: '#fafbff' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Hole Scores (Course specific)</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
              {holes.map((v, idx) => (
                <div key={idx}>
                  <label className="label">Hole {idx + 1}</label>
                  <input className="input" type="number" value={v} onChange={e => { const next = holes.slice(); next[idx] = Number(e.target.value); setHoles(next) }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {inviteMessage ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{inviteMessage}</div> : null}
        {msg ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{msg}</div> : null}
        {showRoundValidation && missingFields.length ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
        {err ? <div className="small" style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btnSmall btnLightBlue"
            disabled={busy}
            onClick={async () => {
              setShowRoundValidation(true)
              if (missingFields.length) {
                setErr(`Please complete: ${missingFields.join(', ')}`)
                return
              }
              setBusy(true)
              setErr(null)
              setMsg(null)
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
                if (!totals.valid) throw new Error('Please enter both round scores')

                const body: Partial<ScoreEntry> & any = {
                  date,
                  state: stateAbbr,
                  course,
                  team: trimmedTeam,
                  opponentTeam: trimmedOpp,
                  teamTotal: totals.your,
                  opponentTotal: totals.opp,
                  holes: useHoles ? holes : null
                }
                await api<ScoreEntry>('/api/scores', { method: 'POST', body: JSON.stringify(body) })
                setMsg('Saved! Go to Home to see updated dashboard.')
                setCourse('')
                setTeam(myTeams[0] || '')
                setOpponentTeam('')
                setTeamTotal('')
                setOpponentTotal('')
                setHoles(Array(NUM_HOLES).fill(0))
                setShowRoundValidation(false)
              } catch (e: any) {
                setErr(e.message || 'Failed to save')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save Round'}
          </button>
        </div>
      </div>
    </div>
  )
}
