import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import RoundDetailModal from '../components/RoundDetailModal'
import HandicapBreakdownModal from '../components/HandicapBreakdownModal'
import HandicapSummaryCard from '../components/HandicapSummaryCard'
import StatCard from '../components/StatCard'
import { useAuth } from '../context/AuthContext'
import { US_STATES } from '../data/usStates'
import { api } from '../lib/api'
import { sortScoresNewestFirst } from '../lib/roundInsights'
import { calculateHandicapFromScores } from '../lib/handicap'
import type { ScoreEntry, SoloScoreEntry, TeamScoreEntry } from '../types'

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function isTeamScore(s: ScoreEntry): s is TeamScoreEntry { return (s as any).mode !== 'solo' }
function isSoloScore(s: ScoreEntry): s is SoloScoreEntry { return (s as any).mode === 'solo' }
function rowClass(round: ScoreEntry) {
  if (round.mode !== 'team') return 'roundRow'
  return `roundRow ${round.won === true ? 'rowWin' : round.won === false ? 'rowLoss' : 'rowTie'}`
}

function ScoreButton({ round, onClick }: { round: ScoreEntry; onClick: () => void }) {
  if (round.mode === 'solo') {
    return (
      <button type="button" className={rowClass(round)} onClick={onClick}>
        <div>
          <div className="roundRowTitle">{round.course}</div>
          <div className="roundRowMeta">{round.date} • {String((round as any).state || '').toUpperCase()} • Solo round</div>
        </div>
        <div className="roundRowSummary">
          <div className="roundRowValue">{round.roundScore}</div>
          <div className="small">Tap for details</div>
        </div>
      </button>
    )
  }

  const result = round.won === true ? 'Win' : round.won === false ? 'Loss' : 'Tie'
  return (
    <button type="button" className={rowClass(round)} onClick={onClick}>
      <div>
        <div className="roundRowTitle">{round.course}</div>
        <div className="roundRowMeta">{round.date} • {String((round as any).state || '').toUpperCase()} • {round.team} vs {round.opponentTeam}</div>
      </div>
      <div className="roundRowSummary">
        <div className="roundRowValue">{round.teamTotal}-{round.opponentTotal}</div>
        <div className="small">{result} • {formatMoney(round.money || 0)}</div>
      </div>
    </button>
  )
}

export default function MyGolfScoresPage() {
  return (
    <ProtectedRoute>
      <MyGolfScoresInner />
    </ProtectedRoute>
  )
}

function MyGolfScoresInner() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<ScoreEntry | null>(null)
  const [showHandicapModal, setShowHandicapModal] = useState(false)

  const [view, setView] = useState<'all' | 'team' | 'solo'>('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await api<ScoreEntry[]>('/api/scores')
        const normalized = data.map((s: any) => ({ ...s, mode: s.mode || 'team' }))
        const email = String(user?.email || '').toLowerCase()
        setScores(normalized.filter((s) => String((s as any).createdByEmail || '').toLowerCase() === email))
      } catch (e: any) {
        setError(e?.message || null)
        setScores([])
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.email])

  const scopedByView = useMemo(() => scores.filter((s) => (view === 'all' ? true : view === 'solo' ? isSoloScore(s) : isTeamScore(s))), [scores, view])
  const nameByAbbr = useMemo(() => new Map(US_STATES.map((s) => [s.abbr, s.name])), [])
  const stateOptions = useMemo(() => Array.from(new Set(scopedByView.map((s: any) => String(s.state || '').toUpperCase()).filter(Boolean))).sort(), [scopedByView])
  const courseOptions = useMemo(() => Array.from(new Set(scopedByView.filter((s: any) => stateFilter === 'all' ? true : String(s.state || '').toUpperCase() === stateFilter).map((s) => s.course).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [scopedByView, stateFilter])
  const teamOptions = useMemo(() => Array.from(new Set(scopedByView.filter(isTeamScore).filter((s: any) => stateFilter === 'all' ? true : String(s.state || '').toUpperCase() === stateFilter).filter((s) => courseFilter === 'all' ? true : s.course === courseFilter).map((s) => s.team).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [scopedByView, stateFilter, courseFilter])

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
    const wins = teamFiltered.filter((s) => s.won === true).length
    const losses = teamFiltered.filter((s) => s.won === false).length
    const ties = teamFiltered.filter((s) => s.won === null).length
    const money = teamFiltered.reduce((sum, s) => sum + (s.money || 0), 0)
    return { total, wins, losses, ties, money, winPct: total ? (wins / total) * 100 : 0 }
  }, [teamFiltered])

  const soloStats = useMemo(() => {
    const total = soloFiltered.length
    const avg = total ? soloFiltered.reduce((sum, s) => sum + s.roundScore, 0) / total : 0
    const best = total ? Math.min(...soloFiltered.map((s) => s.roundScore)) : 0
    return { total, avg, best }
  }, [soloFiltered])
  const handicapStats = useMemo(() => calculateHandicapFromScores(filteredScores), [filteredScores])

  const tileCards = useMemo(() => {
    const cards = [
      <StatCard key="rounds" title="Rounds" value={`${filteredScores.length}`} subtitle="Current filtered set" />,
    ]

    if (view !== 'solo') {
      cards.push(
        <StatCard key="record" title="Team Record" value={`${teamStats.wins}-${teamStats.losses}${teamStats.ties ? `-${teamStats.ties}` : ''}`} subtitle={`${teamStats.winPct.toFixed(0)}% win rate`} />,
        <StatCard key="money" title="Money" value={formatMoney(teamStats.money)} subtitle="Team rounds only" />,
      )
    }

    if (view !== 'team') {
      cards.push(
        <StatCard key="soloAvg" title="Solo Avg" value={soloStats.total ? soloStats.avg.toFixed(1) : '—'} subtitle={soloStats.total ? `Best ${soloStats.best}` : 'No solo rounds'} />,
        <HandicapSummaryCard key="soloHandicap" stats={handicapStats} onClick={() => setShowHandicapModal(true)} />,
      )
    }

    return cards
  }, [filteredScores.length, view, teamStats, soloStats, handicapStats])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0 }}>My Golf Scores</h2>
            <div className="small">Compact stats up top and larger tap targets for every logged event.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btnSmall btnLightBlue" to="/golf-logger">Team Logger</Link>
            <Link className="btn btnSmall btnLightBlue" to="/solo-logger">Solo Logger</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className={view === 'all' ? 'btnPrimary btnSmall' : 'btn btnSmall'} onClick={() => setView('all')}>All Rounds</button>
          <button type="button" className={view === 'team' ? 'btnPrimary btnSmall' : 'btn btnSmall'} onClick={() => setView('team')}>Team Rounds</button>
          <button type="button" className={view === 'solo' ? 'btnPrimary btnSmall' : 'btn btnSmall'} onClick={() => setView('solo')}>Solo Rounds</button>
          <button type="button" className="btn btnSmall" onClick={() => { setStateFilter('all'); setCourseFilter('all'); setTeamFilter('all') }}>Clear filters</button>
        </div>

        <div className="filtersCompactGrid" style={{ marginTop: 14 }}>
          <div>
            <label className="label">State</label>
            <select className="input" value={stateFilter} onChange={e => { setStateFilter(e.target.value); setCourseFilter('all'); setTeamFilter('all') }}>
              <option value="all">All states</option>
              {stateOptions.map((state) => <option key={state} value={state}>{nameByAbbr.get(state) || state}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Course</label>
            <select className="input" value={courseFilter} onChange={e => { setCourseFilter(e.target.value); setTeamFilter('all') }}>
              <option value="all">All courses</option>
              {courseOptions.map((course) => <option key={course} value={course}>{course}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Team</label>
            <select className="input" value={teamFilter} onChange={e => setTeamFilter(e.target.value)} disabled={view === 'solo'}>
              <option value="all">All teams</option>
              {teamOptions.map((team) => <option key={team} value={team}>{team}</option>)}
            </select>
          </div>
        </div>

        <div className="compactTilesGrid" style={{ marginTop: 14 }}>
          {tileCards}
        </div>

        {view !== 'team' ? (
          <div className="small" style={{ marginTop: 10 }}>
            Handicap is relative to the filters currently applied on this page.
          </div>
        ) : null}

        {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
        {error ? <div className="small" style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}

        <div className="roundRowsStack" style={{ marginTop: 14 }}>
          {pagedScores.map((round) => <ScoreButton key={round.id} round={round} onClick={() => setSelectedRound(round)} />)}
          {!pagedScores.length ? <div className="small">No rounds match the current filters.</div> : null}
        </div>

        {filteredScores.length > pageSize ? (
          <div className="paginationBar">
            <button type="button" className="btn btnSmall" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <div className="small">Page {currentPage} of {totalPages}</div>
            <button type="button" className="btn btnSmall" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        ) : null}
      </div>

      <RoundDetailModal round={selectedRound} allScores={filteredScores} onClose={() => setSelectedRound(null)} />
      <HandicapBreakdownModal open={showHandicapModal} stats={handicapStats} onClose={() => setShowHandicapModal(false)} />
    </div>
  )
}
