import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { ScoreEntry, TeamScoreEntry, SoloScoreEntry } from '../types'
import StatCard from '../components/StatCard'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import { US_STATES } from '../data/usStates'
import bannerImg from '../assets/golf-banner.png'
import { jumpToFirstByLetter } from '../lib/selectHotkey'

function formatMoney(n: number) {
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  return fmt.format(n)
}

function isTeamScore(s: ScoreEntry): s is TeamScoreEntry {
  return (s as any).mode !== 'solo'
}

function isSoloScore(s: ScoreEntry): s is SoloScoreEntry {
  return (s as any).mode === 'solo'
}

function sortScoresNewestFirst<T extends ScoreEntry>(entries: T[]) {
  return [...entries].sort((a, b) => {
    const dateCmp = String(b.date || '').localeCompare(String(a.date || ''))
    if (dateCmp !== 0) return dateCmp
    return String((b as any).createdAt || '').localeCompare(String((a as any).createdAt || ''))
  })
}

export default function Home() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'team' | 'solo'>('team')
  const [stateFilter, setStateFilter] = useState('UT')
  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    ;(async () => {
      if (!user) {
        setScores([])
        setLoading(false)
        return
      }
      setLoading(true); setError(null)
      try {
        const data = await api<ScoreEntry[]>('/api/scores')
        const normalized = data.map((s: any) => ({ ...s, mode: s.mode || 'team' }))
        setScores(normalized)
      } catch (e: any) {
        setScores([])
        setError(e?.message || null)
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const userScores = useMemo(() => {
    const email = String(user?.email || '').toLowerCase()
    if (!email) return []
    return scores.filter(s => String((s as any).createdByEmail || '').toLowerCase() === email)
  }, [scores, user?.email])

  const viewScores = useMemo(() => {
    return userScores.filter(s => (view === 'solo' ? isSoloScore(s) : isTeamScore(s)))
  }, [userScores, view])

  const nameByAbbr = useMemo(() => new Map(US_STATES.map(s => [s.abbr, s.name])), [])

  const stateOptions = useMemo(() => {
    const fromLogs = viewScores.map(s => String((s as any).state || '').toUpperCase()).filter(Boolean)
    const unique = Array.from(new Set(fromLogs))
    const list = unique.length ? unique : ['UT']
    return Array.from(new Set(list)).sort((a, b) => {
      if (a === 'UT') return -1
      if (b === 'UT') return 1
      return (nameByAbbr.get(a) || a).localeCompare(nameByAbbr.get(b) || b)
    })
  }, [viewScores, nameByAbbr])

  useEffect(() => {
    if (stateOptions.length && stateFilter !== 'all' && !stateOptions.includes(stateFilter)) {
      setStateFilter(stateOptions[0])
      setCourseFilter('all')
      setTeamFilter('all')
    }
  }, [stateOptions, stateFilter])

  const courseOptions = useMemo(() => {
    const fromLogs = viewScores
      .filter(s => (stateFilter === 'all') ? true : (String((s as any).state || '').toUpperCase() === stateFilter))
      .map(s => s.course)
      .filter(Boolean)
    return Array.from(new Set(fromLogs)).sort((a, b) => a.localeCompare(b))
  }, [viewScores, stateFilter])

  const teamOptions = useMemo(() => {
    if (view !== 'team') return []
    const fromLogs = viewScores
      .filter(s => {
        const ss = s as any
        if (stateFilter !== 'all' && String(ss.state || '').toUpperCase() !== stateFilter) return false
        if (courseFilter !== 'all' && s.course !== courseFilter) return false
        return true
      })
      .map(s => (s as any).team)
      .filter(Boolean)
    return Array.from(new Set(fromLogs)).sort((a, b) => a.localeCompare(b))
  }, [viewScores, view, stateFilter, courseFilter])

  const filteredScores = useMemo(() => {
    return viewScores.filter((s: any) => {
      const sState = String(s.state || '').toUpperCase()
      if (stateFilter !== 'all' && sState !== stateFilter) return false
      if (courseFilter !== 'all' && s.course !== courseFilter) return false
      if (view === 'team' && teamFilter !== 'all' && String(s.team || '') !== teamFilter) return false
      return true
    })
  }, [viewScores, view, stateFilter, courseFilter, teamFilter])

  const teamStats = useMemo(() => {
    const teamOnly = filteredScores.filter(isTeamScore)
    const total = teamOnly.length
    const wins = teamOnly.filter(s => s.won === true).length
    const losses = teamOnly.filter(s => s.won === false).length
    const ties = teamOnly.filter(s => s.won === null).length
    const winPct = total === 0 ? 0 : (wins / total) * 100
    const money = teamOnly.reduce((sum, s) => sum + (s.money || 0), 0)
    return { total, wins, losses, ties, winPct, money }
  }, [filteredScores])

  const soloStats = useMemo(() => {
    const soloOnly = filteredScores.filter(isSoloScore)
    const total = soloOnly.length
    const avg = total === 0 ? 0 : soloOnly.reduce((s, x) => s + x.roundScore, 0) / total
    const best = total === 0 ? 0 : Math.min(...soloOnly.map(x => x.roundScore))
    return { total, avg, best }
  }, [filteredScores])

  const recent = useMemo(() => sortScoresNewestFirst(filteredScores), [filteredScores])

  useEffect(() => {
    setPage(1)
  }, [view, stateFilter, courseFilter, teamFilter])

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(recent.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedRecent = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return recent.slice(start, start + pageSize)
  }, [recent, currentPage])

  return (
    <div className="container">
      <div className="bannerCard">
        <img src={bannerImg} alt="Golf Homiez banner" className="bannerImg" />
        <div className="bannerOverlay">
          <div className="bannerTitle">Fairways, Friends & Scorecards</div>
          <div className="bannerSubtitle">Track scrambles • Track solo rounds • Keep it fun</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Dashboard</h2>
            <div className="small">Pick a view and filter down your rounds.</div>
          </div>
          {!user ? (
            <div className="small">
              Please <Link to="/login"><strong>login</strong></Link> to view and track rounds.
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className={view === 'team' ? 'btnPrimary' : 'btn'} onClick={() => { setView('team'); setTeamFilter('all') }}>
            Team Scrambles
          </button>
          <button type="button" className={view === 'solo' ? 'btnPrimary' : 'btn'} onClick={() => { setView('solo'); setTeamFilter('all') }}>
            Solo Rounds
          </button>
        </div>

        <div className="grid" style={{ gridTemplateColumns: view === 'team' ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
          <div>
            <label className="label">State</label>
            <select
              className="input"
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); setCourseFilter('all'); setTeamFilter('all') }}
              onKeyDown={(e) => jumpToFirstByLetter(e, stateOptions, (v) => { setStateFilter(v); setCourseFilter('all'); setTeamFilter('all') })}
            >
              {stateOptions.length > 1 ? <option value="all">All states</option> : null}
              {stateOptions.map((abbr) => (
                <option key={abbr} value={abbr}>{nameByAbbr.get(abbr) || abbr}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Course</label>
            <select
              className="input"
              value={courseFilter}
              onChange={(e) => { setCourseFilter(e.target.value); setTeamFilter('all') }}
              onKeyDown={(e) => jumpToFirstByLetter(e, courseOptions, (v) => { setCourseFilter(v); setTeamFilter('all') })}
            >
              <option value="all">All courses</option>
              {courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {view === 'team' ? (
            <div>
              <label className="label">Team</label>
              <select
                className="input"
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                onKeyDown={(e) => jumpToFirstByLetter(e, teamOptions, (v) => setTeamFilter(v))}
              >
                <option value="all">All teams</option>
                {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
        {error ? <div className="small" style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}

        {view === 'team' ? (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
            <StatCard title="Win %" value={`${teamStats.winPct.toFixed(0)}%`} subtitle={`${teamStats.wins}-${teamStats.losses}${teamStats.ties ? `-${teamStats.ties}` : ''} (W-L${teamStats.ties ? '-T' : ''})`} />
            <StatCard title="Money Won/Lost" value={formatMoney(teamStats.money)} subtitle="From your logged rounds" />
            <StatCard title="Rounds Logged" value={`${teamStats.total}`} subtitle="Filtered view" />
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
            <StatCard title="Solo Rounds" value={`${soloStats.total}`} subtitle="Filtered view" />
            <StatCard title="Average Score" value={soloStats.total ? soloStats.avg.toFixed(1) : '—'} subtitle="Lower is better" />
            <StatCard title="Best Score" value={soloStats.total ? `${soloStats.best}` : '—'} subtitle="Your lowest round" />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16 }}>
          <h3 style={{ margin: 0 }}>Recent Rounds</h3>
          {view === 'team' ? <Link className="small" to="/golf-logger">Log a team round</Link> : <Link className="small" to="/solo-logger">Log a solo round</Link>}
        </div>

        <div className="tableWrap" style={{ marginTop: 10 }}>
          <table className="table tableCompactUltra">
            <thead>
              <tr>
                <th>Date</th>
                <th>State</th>
                <th>Course</th>
                {view === 'team' ? (<><th>Team</th><th>Opponent</th><th>Score</th><th>Result</th><th>Money</th></>) : (<><th>Round Score</th></>)}
              </tr>
            </thead>
            <tbody>
              {pagedRecent.map((s: any) => {
                if (view === 'solo') {
                  return (
                    <tr key={s.id}>
                      <td>{s.date}</td>
                      <td>{String(s.state || '').toUpperCase()}</td>
                      <td>{s.course}</td>
                      <td>{s.roundScore}</td>
                    </tr>
                  )
                }

                const result = s.won === true ? 'Win' : s.won === false ? 'Loss' : 'Tie'
                const scoreStr = `${s.teamTotal}-${s.opponentTotal}`
                return (
                  <tr key={s.id} className={s.won === true ? 'rowWin' : s.won === false ? 'rowLoss' : 'rowTie'}>
                    <td>{s.date}</td>
                    <td>{String(s.state || '').toUpperCase()}</td>
                    <td>{s.course}</td>
                    <td>{s.team}</td>
                    <td>{s.opponentTeam}</td>
                    <td>{scoreStr}</td>
                    <td>{result}</td>
                    <td>{formatMoney(s.money || 0)}</td>
                  </tr>
                )
              })}
              {!pagedRecent.length ? (
                <tr>
                  <td colSpan={view === 'team' ? 8 : 4} className="small">No rounds yet for this view and filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {recent.length > pageSize ? (
          <div className="paginationBar">
            <button type="button" className="btn" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <div className="small">Page {currentPage} of {totalPages}</div>
            <button type="button" className="btn" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
