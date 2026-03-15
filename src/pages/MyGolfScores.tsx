import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import StatCard from '../components/StatCard'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { ScoreEntry, TeamScoreEntry, SoloScoreEntry } from '../types'
import { US_STATES } from '../data/usStates'

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function isTeamScore(s: ScoreEntry): s is TeamScoreEntry { return (s as any).mode !== 'solo' }
function isSoloScore(s: ScoreEntry): s is SoloScoreEntry { return (s as any).mode === 'solo' }
function sortScoresNewestFirst<T extends ScoreEntry>(entries: T[]) {
  return [...entries].sort((a, b) => {
    const dateCmp = String(b.date || '').localeCompare(String(a.date || ''))
    if (dateCmp !== 0) return dateCmp
    return String((b as any).createdAt || '').localeCompare(String((a as any).createdAt || ''))
  })
}

export default function MyGolfScoresPage() {
  return <ProtectedRoute><MyGolfScoresInner /></ProtectedRoute>
}

function MyGolfScoresInner() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'all' | 'team' | 'solo'>('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const data = await api<ScoreEntry[]>('/api/scores')
        const normalized = data.map((s: any) => ({ ...s, mode: s.mode || 'team' }))
        const email = String(user?.email || '').toLowerCase()
        setScores(normalized.filter((s: any) => String(s.createdByEmail || '').toLowerCase() === email))
      } catch (e: any) {
        setError(e?.message || 'Failed to load scores')
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.email])

  const scopedByView = useMemo(() => {
    return scores.filter(s => view === 'all' ? true : view === 'team' ? isTeamScore(s) : isSoloScore(s))
  }, [scores, view])

  const nameByAbbr = useMemo(() => new Map(US_STATES.map(s => [s.abbr, s.name])), [])

  const stateOptions = useMemo(() => Array.from(new Set(scopedByView.map((s: any) => String(s.state || '').toUpperCase()).filter(Boolean))).sort(), [scopedByView])
  const courseOptions = useMemo(() => {
    return Array.from(new Set(scopedByView
      .filter((s: any) => stateFilter === 'all' ? true : String(s.state || '').toUpperCase() === stateFilter)
      .map(s => s.course)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [scopedByView, stateFilter])
  const teamOptions = useMemo(() => {
    return Array.from(new Set(scopedByView
      .filter(isTeamScore)
      .filter((s: any) => stateFilter === 'all' ? true : String(s.state || '').toUpperCase() === stateFilter)
      .filter(s => courseFilter === 'all' ? true : s.course === courseFilter)
      .map(s => s.team)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [scopedByView, stateFilter, courseFilter])

  const filteredScores = useMemo(() => {
    const next = scopedByView.filter((s: any) => {
      if (stateFilter !== 'all' && String(s.state || '').toUpperCase() !== stateFilter) return false
      if (courseFilter !== 'all' && s.course !== courseFilter) return false
      if (teamFilter !== 'all' && (s.mode === 'solo' || s.team !== teamFilter)) return false
      return true
    })
    return sortScoresNewestFirst(next)
  }, [scopedByView, stateFilter, courseFilter, teamFilter])

  const teamFiltered = useMemo(() => filteredScores.filter(isTeamScore), [filteredScores])
  const soloFiltered = useMemo(() => filteredScores.filter(isSoloScore), [filteredScores])

  useEffect(() => {
    setPage(1)
  }, [view, stateFilter, courseFilter, teamFilter])

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(filteredScores.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedScores = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredScores.slice(start, start + pageSize)
  }, [filteredScores, currentPage])

  const teamStats = useMemo(() => {
    const total = teamFiltered.length
    const wins = teamFiltered.filter(s => s.won === true).length
    const losses = teamFiltered.filter(s => s.won === false).length
    const ties = teamFiltered.filter(s => s.won === null).length
    const winPct = total ? (wins / total) * 100 : 0
    const money = teamFiltered.reduce((sum, s) => sum + (s.money || 0), 0)
    return { total, wins, losses, ties, winPct, money }
  }, [teamFiltered])

  const soloStats = useMemo(() => {
    const total = soloFiltered.length
    const avg = total ? soloFiltered.reduce((sum, s) => sum + s.roundScore, 0) / total : 0
    const best = total ? Math.min(...soloFiltered.map(s => s.roundScore)) : 0
    return { total, avg, best }
  }, [soloFiltered])

  const recentTenTeamAvg = useMemo(() => {
    const subset = teamFiltered.slice(0, 10)
    if (!subset.length) return null
    return subset.reduce((sum, s) => sum + s.teamTotal, 0) / subset.length
  }, [teamFiltered])

  const recentTenSoloAvg = useMemo(() => {
    const subset = soloFiltered.slice(0, 10)
    if (!subset.length) return null
    return subset.reduce((sum, s) => sum + s.roundScore, 0) / subset.length
  }, [soloFiltered])

  const bestGame = useMemo(() => {
    if (!filteredScores.length) return null
    const ranked = [...filteredScores].sort((a, b) => {
      const aScore = (a as any).mode === 'solo' ? (a as SoloScoreEntry).roundScore : (a as TeamScoreEntry).teamTotal
      const bScore = (b as any).mode === 'solo' ? (b as SoloScoreEntry).roundScore : (b as TeamScoreEntry).teamTotal
      if (aScore !== bScore) return aScore - bScore
      return String(a.date || '').localeCompare(String(b.date || ''))
    })
    return ranked[0]
  }, [filteredScores])

  const tileCards = useMemo(() => {
    const cards: JSX.Element[] = [
      <StatCard key="rounds" title="Rounds Logged" value={`${filteredScores.length}`} subtitle="Current filtered set" />,
    ]

    if (view !== 'solo') {
      cards.push(
        <StatCard key="winpct" title="Win %" value={`${teamStats.winPct.toFixed(0)}%`} subtitle={`${teamStats.wins}-${teamStats.losses}${teamStats.ties ? `-${teamStats.ties}` : ''}`} />,
        <StatCard key="money" title="Money Won/Lost" value={formatMoney(teamStats.money)} subtitle="Team rounds only" />,
        <StatCard key="teamavg" title="Team Avg (Last 10)" value={recentTenTeamAvg !== null ? recentTenTeamAvg.toFixed(1) : '—'} subtitle={teamFiltered.length >= 10 ? 'Newest 10 team rounds' : `All ${teamFiltered.length || 0} team rounds`} />,
      )
    }

    if (view !== 'team') {
      cards.push(
        <StatCard key="soloavg" title="Solo Avg (Last 10)" value={recentTenSoloAvg !== null ? recentTenSoloAvg.toFixed(1) : '—'} subtitle={soloFiltered.length >= 10 ? 'Newest 10 solo rounds' : `All ${soloFiltered.length || 0} solo rounds`} />
      )
    }

    return cards
  }, [filteredScores.length, view, teamStats, recentTenTeamAvg, teamFiltered.length, recentTenSoloAvg, soloFiltered.length])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0 }}>My Golf Scores</h2>
            <div className="small">Every round you logged, with filters and dashboard tiles that respond instantly.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn" to="/golf-logger">Team Logger</Link>
            <Link className="btn" to="/solo-logger">Solo Logger</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className={view === 'all' ? 'btnPrimary' : 'btn'} onClick={() => setView('all')}>All Rounds</button>
          <button type="button" className={view === 'team' ? 'btnPrimary' : 'btn'} onClick={() => setView('team')}>Team Rounds</button>
          <button type="button" className={view === 'solo' ? 'btnPrimary' : 'btn'} onClick={() => setView('solo')}>Solo Rounds</button>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
          <div>
            <label className="label">State</label>
            <select className="input" value={stateFilter} onChange={e => { setStateFilter(e.target.value); setCourseFilter('all'); setTeamFilter('all') }}>
              <option value="all">All states</option>
              {stateOptions.map(state => <option key={state} value={state}>{nameByAbbr.get(state) || state}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Course</label>
            <select className="input" value={courseFilter} onChange={e => { setCourseFilter(e.target.value); setTeamFilter('all') }}>
              <option value="all">All courses</option>
              {courseOptions.map(course => <option key={course} value={course}>{course}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Team</label>
            <select className="input" value={teamFilter} onChange={e => setTeamFilter(e.target.value)} disabled={view === 'solo'}>
              <option value="all">All teams</option>
              {teamOptions.map(team => <option key={team} value={team}>{team}</option>)}
            </select>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14, padding: '14px 16px' }}>
          <div className="small">Best game callout</div>
          {bestGame ? (
            <div style={{ marginTop: 6, fontWeight: 700 }}>
              Your best game in this view was on <strong>{bestGame.date}</strong> at <strong>{bestGame.course}</strong> with a score of <strong>{bestGame.mode === 'solo' ? bestGame.roundScore : bestGame.teamTotal}</strong>{bestGame.mode === 'solo' ? ' in a solo round.' : ` for ${bestGame.team}.`}
            </div>
          ) : (
            <div className="small" style={{ marginTop: 6 }}>No rounds match the current filters yet.</div>
          )}
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 14 }}>
          {tileCards}
        </div>

        {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
        {error ? <div className="small" style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}

        <div className="tableWrap" style={{ marginTop: 14 }}>
          {view === 'solo' ? (
            <table className="table tableCompactUltra">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>State</th>
                  <th>Course</th>
                  <th>Round Score</th>
                </tr>
              </thead>
              <tbody>
                {pagedScores.map((s: any) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{String(s.state || '').toUpperCase()}</td>
                    <td>{s.course}</td>
                    <td>{s.roundScore}</td>
                  </tr>
                ))}
                {!pagedScores.length ? (
                  <tr><td colSpan={4} className="small">No rounds match the current filters.</td></tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <table className="table tableCompactUltra">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>State</th>
                  <th>Course</th>
                  <th>Team</th>
                  <th>Opponent</th>
                  <th>Score</th>
                  <th>Result</th>
                  <th>Money</th>
                </tr>
              </thead>
              <tbody>
                {pagedScores.map((s: any) => {
                  if (s.mode === 'solo') {
                    return (
                      <tr key={s.id}>
                        <td>{s.date}</td>
                        <td>Solo</td>
                        <td>{String(s.state || '').toUpperCase()}</td>
                        <td>{s.course}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{s.roundScore}</td>
                        <td>—</td>
                        <td>—</td>
                      </tr>
                    )
                  }
                  const result = s.won === true ? 'Win' : s.won === false ? 'Loss' : 'Tie'
                  return (
                    <tr key={s.id} className={s.won === true ? 'rowWin' : s.won === false ? 'rowLoss' : 'rowTie'}>
                      <td>{s.date}</td>
                      <td>Team</td>
                      <td>{String(s.state || '').toUpperCase()}</td>
                      <td>{s.course}</td>
                      <td>{s.team}</td>
                      <td>{s.opponentTeam}</td>
                      <td>{s.teamTotal}-{s.opponentTotal}</td>
                      <td>{result}</td>
                      <td>{formatMoney(s.money || 0)}</td>
                    </tr>
                  )
                })}
                {!pagedScores.length ? (
                  <tr><td colSpan={9} className="small">No rounds match the current filters.</td></tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>

        {filteredScores.length > pageSize ? (
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
