import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import GolfCoursePublicNav from '../components/GolfCoursePublicNav'
import PageHero from '../components/PageHero'
import { fetchGolfCoursePublicPage, type GolfCoursePublicPage, type GolfCoursePublicPageTournament } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

const defaultGolfCourseBanner = '/DefaultGolfBanner.jpg'
const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type CalendarCell = {
  key: string
  day: number
  dateKey: string
}

function dateKey(value?: string | null) {
  const normalized = String(value || '').trim()
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || ''
}

function formatDate(value?: string | null) {
  const key = dateKey(value)
  if (!key) return 'Date to be announced'
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day, 12))
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(value)
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function buildCalendarCells(month: Date): Array<CalendarCell | null> {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstWeekday = new Date(year, monthIndex, 1).getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const cells: Array<CalendarCell | null> = Array.from({ length: firstWeekday }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKeyValue = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({ key: dateKeyValue, day, dateKey: dateKeyValue })
  }

  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function pointOfContact(tournament: GolfCoursePublicPageTournament) {
  const pieces = [tournament.contactPerson, tournament.contactPhone, tournament.contactEmail].filter(Boolean)
  return pieces.length ? pieces : ['Contact information has not been provided.']
}

export default function GolfCourseCalendarPage() {
  const { golfCourseSlug = '' } = useParams()
  const [page, setPage] = useState<GolfCoursePublicPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedTournament, setSelectedTournament] = useState<GolfCoursePublicPageTournament | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const loaded = await fetchGolfCoursePublicPage(golfCourseSlug)
        if (!active) return
        setPage(loaded)
        logFrontendEvent({
          category: 'golf-course.calendar',
          message: 'tournament_calendar_loaded',
          data: {
            slug: loaded.slug,
            golfCourseId: loaded.golfCourseId || null,
            calendarAvailable: loaded.calendarAvailable,
            tournamentCount: loaded.tournaments.length,
            defaultMonth: monthKey(new Date()),
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load the tournament calendar.'
        if (active) setError(message)
        logFrontendEvent({
          category: 'golf-course.calendar',
          level: 'error',
          message: 'tournament_calendar_load_failed',
          data: { slug: golfCourseSlug, error: message },
        })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [golfCourseSlug])

  useEffect(() => {
    const now = new Date()
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedTournament(null)
  }, [golfCourseSlug])

  const eventsByDate = useMemo(() => {
    const result = new Map<string, GolfCoursePublicPageTournament[]>()
    for (const tournament of page?.tournaments || []) {
      const key = dateKey(tournament.startDate)
      if (!key) continue
      if (!result.has(key)) result.set(key, [])
      result.get(key)?.push(tournament)
    }
    for (const tournaments of result.values()) tournaments.sort((left, right) => left.name.localeCompare(right.name))
    return result
  }, [page?.tournaments])

  const calendarCells = useMemo(() => buildCalendarCells(month), [month])
  const visibleMonthKey = monthKey(month)
  const visibleEventCount = useMemo(() => Array.from(eventsByDate.entries())
    .filter(([key]) => key.startsWith(`${visibleMonthKey}-`))
    .reduce((count, [, tournaments]) => count + tournaments.length, 0), [eventsByDate, visibleMonthKey])

  function changeMonth(offset: number) {
    setMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + offset, 1)
      logFrontendEvent({ category: 'golf-course.calendar', message: 'calendar_month_changed', data: { slug: golfCourseSlug, month: monthKey(next) } })
      return next
    })
    setSelectedTournament(null)
  }

  function resetToCurrentMonth() {
    const now = new Date()
    const current = new Date(now.getFullYear(), now.getMonth(), 1)
    setMonth(current)
    setSelectedTournament(null)
    logFrontendEvent({ category: 'golf-course.calendar', message: 'calendar_current_month_selected', data: { slug: golfCourseSlug, month: monthKey(current) } })
  }

  function selectTournament(tournament: GolfCoursePublicPageTournament) {
    setSelectedTournament(tournament)
    logFrontendEvent({
      category: 'golf-course.calendar',
      message: 'calendar_tournament_selected',
      data: { slug: golfCourseSlug, tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, startDate: dateKey(tournament.startDate) },
    })
  }

  if (loading) return <div className="container pageStack"><div className="card pageCardShell">Loading tournament calendar…</div></div>

  if (!page || error) {
    return (
      <div className="container pageStack">
        <div className="card pageCardShell">
          <PageHero eyebrow="GolfHomiez golf courses" title="Tournament calendar not found" subtitle={error || 'This tournament calendar is not available.'} />
          <Link className="btn btnPrimary" to="/">Return to GolfHomiez</Link>
        </div>
      </div>
    )
  }

  if (!page.calendarAvailable) {
    return (
      <main className="golfCoursePublicPage">
        <section className="golfCoursePublicHero hasBanner" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.68)), url(${page.bannerImageData || defaultGolfCourseBanner})` }}>
          <div className="container golfCoursePublicHeroContent">
            <div className="golfCoursePublicEyebrow">GolfHomiez golf course</div>
            <h1>{page.golfCourseName}</h1>
          </div>
        </section>
        <div className="container golfCoursePublicContent">
          <GolfCoursePublicNav slug={page.slug} golfCourseName={page.golfCourseName} calendarAvailable={false} />
          <section className="card golfCourseCalendarUnavailable">
            <h2>Tournament Calendar</h2>
            <p>This calendar becomes available when the golf course has its first GolfHomiez tournament.</p>
            <Link className="btn btnPrimary" to={page.path}>Return to the course page</Link>
          </section>
        </div>
      </main>
    )
  }

  const todayKey = localDateKey(new Date())

  return (
    <main className="golfCoursePublicPage">
      <section className="golfCoursePublicHero hasBanner" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.68)), url(${page.bannerImageData || defaultGolfCourseBanner})` }}>
        <div className="container golfCoursePublicHeroContent">
          <div className="golfCoursePublicEyebrow">GolfHomiez tournament calendar</div>
          <h1>{page.golfCourseName}</h1>
          {(page.city || page.stateCode) ? <div className="golfCoursePublicLocation">{[page.city, page.stateCode].filter(Boolean).join(', ')}</div> : null}
        </div>
      </section>

      <div className="container golfCoursePublicContent">
        <GolfCoursePublicNav slug={page.slug} golfCourseName={page.golfCourseName} calendarAvailable={page.calendarAvailable} />

        <section className="card golfCourseCalendarCard">
          <div className="golfCourseCalendarHeader">
            <div>
              <div className="golfCoursePublicEyebrow">Tournament Calendar</div>
              <h2>{formatMonth(month)}</h2>
              <div className="small">{visibleEventCount} GolfHomiez tournament{visibleEventCount === 1 ? '' : 's'} this month</div>
            </div>
            <div className="golfCourseCalendarActions">
              <button className="btn" type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">Previous</button>
              <button className="btn" type="button" onClick={resetToCurrentMonth}>Current month</button>
              <button className="btn" type="button" onClick={() => changeMonth(1)} aria-label="Next month">Next</button>
            </div>
          </div>

          <div className="golfCourseCalendarWeekdays" aria-hidden="true">
            {dayLabels.map((label) => <div key={label}>{label}</div>)}
          </div>
          <div className="golfCourseCalendarGrid" role="grid" aria-label={`${formatMonth(month)} tournament calendar`}>
            {calendarCells.map((cell, index) => {
              if (!cell) return <div key={`blank-${index}`} className="golfCourseCalendarDay golfCourseCalendarDay--blank" aria-hidden="true" />
              const events = eventsByDate.get(cell.dateKey) || []
              return (
                <div key={cell.key} className={`golfCourseCalendarDay${cell.dateKey === todayKey ? ' golfCourseCalendarDay--today' : ''}`} role="gridcell" aria-label={`${formatDate(cell.dateKey)}${events.length ? `, ${events.length} tournament${events.length === 1 ? '' : 's'}` : ''}`}>
                  <div className="golfCourseCalendarDayNumber">{cell.day}</div>
                  <div className="golfCourseCalendarEvents">
                    {events.map((tournament) => (
                      <button key={tournament.id} className="golfCourseCalendarEvent" type="button" onClick={() => selectTournament(tournament)}>
                        {tournament.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {selectedTournament ? (
          <section className="card golfCourseCalendarDetails" aria-live="polite">
            <div className="golfCourseCalendarDetailsHeader">
              <div>
                <div className="golfCoursePublicEyebrow">Tournament details</div>
                <h2>{selectedTournament.name}</h2>
              </div>
              <button className="btn" type="button" onClick={() => setSelectedTournament(null)}>Close</button>
            </div>
            <div className="golfCourseCalendarDetailGrid">
              <div>
                <div className="label">Date</div>
                <div>{formatDate(selectedTournament.startDate)}</div>
              </div>
              <div>
                <div className="label">Name of Course</div>
                <div>{selectedTournament.golfCourseName || page.golfCourseName}</div>
              </div>
              <div>
                <div className="label">Point of Contact</div>
                <div className="golfCourseCalendarContact">
                  {pointOfContact(selectedTournament).map((piece) => {
                    if (piece === selectedTournament.contactEmail) return <a key={piece} href={`mailto:${piece}`}>{piece}</a>
                    if (piece === selectedTournament.contactPhone) return <a key={piece} href={`tel:${String(piece).replace(/\D/g, '')}`}>{piece}</a>
                    return <span key={piece}>{piece}</span>
                  })}
                </div>
              </div>
            </div>
            <Link className="btn btnPrimary" to={selectedTournament.portalPath}>View tournament</Link>
          </section>
        ) : null}
      </div>
    </main>
  )
}
