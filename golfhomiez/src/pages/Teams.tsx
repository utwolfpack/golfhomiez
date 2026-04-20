import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import { fetchTeams, sendRegistrationInvite, updateTeam } from '../lib/teams'
import type { ScoreEntry, Team } from '../types'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'
import InviteHomieModal from '../components/InviteHomieModal'

type DraftMember = { id: string; firstName: string; lastName: string; email: string }

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
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<{ teamId: string; email: string } | null>(null)
  const [editTeamId, setEditTeamId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function load() {
    try {
      const [t, s] = await Promise.all([fetchTeams(), api<ScoreEntry[]>('/api/scores')])
      setTeams(t)
      setScores(s)
    } catch (e: any) {
      setErr(e.message || 'Failed to load teams')
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

  useEffect(() => {
    if (!editTeam) return
    setDraftName(editTeam.name)
    setDraftMembers((editTeam.members || []).map(m => {
      const split = splitName(m.name)
      return {
        id: m.id,
        firstName: split.firstName,
        lastName: split.lastName,
        email: m.email,
      }
    }))
    setSaveError(null)
  }, [editTeam])

  function closeModal() {
    setEditTeamId(null)
    setSaving(false)
    setSaveError(null)
  }

  function addMember() {
    if (draftMembers.length >= 4) return
    setDraftMembers(prev => [...prev, { id: crypto.randomUUID(), firstName: '', lastName: '', email: '' }])
  }

  function patchMember(id: string, field: 'firstName' | 'lastName' | 'email', value: string) {
    setDraftMembers(prev => prev.map(m => (m.id === id ? { ...m, [field]: value } : m)))
  }

  function removeMember(id: string) {
    setDraftMembers(prev => prev.filter(m => m.id !== id))
  }

  async function handleSave() {
    if (!editTeam) return
    setSaving(true)
    setSaveError(null)
    try {
      const normalizedEmails = new Set<string>()
      const members = draftMembers
        .map(m => ({
          id: m.id,
          name: `${m.firstName} ${m.lastName}`.replace(/\s+/g, ' ').trim(),
          email: String(m.email || '').trim().toLowerCase(),
        }))
        .filter(m => m.name || m.email)

      if (members.length < 2) throw new Error('Teams must have at least 2 players.')
      if (members.length > 4) throw new Error('Teams can have a maximum of 4 people.')

      for (const member of members) {
        if (!member.email) throw new Error('Each team member needs an email address.')
        if (normalizedEmails.has(member.email)) throw new Error('You cannot add the same team member twice.')
        normalizedEmails.add(member.email)
      }

      const updated = await updateTeam(editTeam.id, draftName.trim(), members)
      setTeams(prev => prev.map(t => (t.id === updated.id ? updated : t)).sort((a, b) => a.name.localeCompare(b.name)))
      closeModal()
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to update team')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Rosters and records"
          title="Your teams at a glance"
          subtitle="See team status, pending registrations, roster details, and click a team to edit it."
        />

        {err ? <div className="small" style={{ color: '#b91c1c' }}>{err}</div> : null}

        {myTeams.length === 0 ? (
          <div className="small" style={{ marginTop: 12 }}>
            You are not listed as a member of any team yet. Use the Create Team button on the Team Logger page to add one with your email on the roster.
          </div>
        ) : (
          <div className="grid grid3" style={{ marginTop: 14 }}>
            {myTeams.map(t => {
              const r = recordByTeam.get(t.name) || { wins: 0, losses: 0, ties: 0 }
              const pendingMembers = (t.members || []).filter(member => member.status !== 'active')
              return (
                <button
                  key={t.id}
                  className="card cardClickable"
                  type="button"
                  onClick={() => setEditTeamId(t.id)}
                  style={{ textAlign: 'left' }}
                >
                  <div className="small">Team</div>
                  <div style={{ fontSize: 20, fontWeight: 900, marginTop: 6 }}>{t.name}</div>
                  <div className="small" style={{ marginTop: 8 }}>
                    Record: <strong>{r.wins}-{r.losses}</strong>{r.ties ? <span> (T{r.ties})</span> : null}
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>{(t.members?.length || 0)} member(s)</div>
                  {t.hasPendingMembers ? <div className="pill" style={{ marginTop: 10 }}>Pending teammate verification</div> : <div className="pill" style={{ marginTop: 10 }}>Ready to play</div>}
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {(t.members || []).map(member => (
                      <div key={member.id} className="card" style={{ padding: 10, background: 'rgba(255,255,255,.72)' }}>
                        <div style={{ fontWeight: 700 }}>{member.name}</div>
                        <div className="small">{member.email}</div>
                        <div className="small" style={{ marginTop: 4 }}>
                          {member.status === 'active' ? 'Verified and active' : 'Pending registration or email verification'}
                        </div>
                        {member.status !== 'active' ? (
                          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); setInviteTarget({ teamId: t.id, email: member.email }); setInviteOpen(true) }}>
                            Send Registration Invite
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {pendingMembers.length ? <div className="small" style={{ marginTop: 10 }}>This team stays pending until every teammate completes app verification.</div> : null}
                  <div className="small" style={{ marginTop: 10, opacity: 0.8 }}>Click to edit roster</div>
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
              <input className="input" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Team name" />
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <label className="label" style={{ margin: 0 }}>Members</label>
              {draftMembers.length < 4 ? <button type="button" className="btn" onClick={addMember}>+ Add member</button> : null}
            </div>

            <div className="small" style={{ marginTop: 6 }}>Teams must have between 2 and 4 players.</div>

            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              {draftMembers.map(m => (
                <div key={m.id} className="card" style={{ padding: 12 }}>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1.4fr auto', gap: 10, alignItems: 'end' }}>
                    <div>
                      <label className="label">First name</label>
                      <input className="input" value={m.firstName} onChange={e => patchMember(m.id, 'firstName', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Last name</label>
                      <input className="input" value={m.lastName} onChange={e => patchMember(m.id, 'lastName', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Email</label>
                      <input className="input" type="email" value={m.email} onChange={e => patchMember(m.id, 'email', e.target.value)} />
                    </div>
                    <button type="button" className="btn" disabled={draftMembers.length <= 2} onClick={() => removeMember(m.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>

            {saveError ? <div className="small" style={{ marginTop: 12, color: '#b91c1c' }}>{saveError}</div> : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" onClick={closeModal}>Cancel</button>
              <button type="button" className="btnPrimary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save Team'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <InviteHomieModal
        open={inviteOpen}
        defaultEmail={inviteTarget?.email || ''}
        title="Send Registration Invite"
        submitLabel="Send Registration Invite"
        onClose={() => setInviteOpen(false)}
        onSubmit={async ({ email, message }) => {
          await sendRegistrationInvite(email, message, inviteTarget?.teamId)
          setInviteOpen(false)
          await load()
        }}
      />
    </div>
  )
}

function splitName(full: string) {
  const s = String(full || '').trim()
  if (!s) return { firstName: '', lastName: '' }
  const parts = s.split(/\s+/)
  const firstName = parts.shift() || ''
  const lastName = parts.join(' ')
  return { firstName, lastName }
}
