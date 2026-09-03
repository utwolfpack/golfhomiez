import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import GolfCoursePublicNav from '../components/GolfCoursePublicNav'
import PageHero from '../components/PageHero'
import { fetchGolfCoursePublicPage, type GolfCoursePublicPage, type GolfCoursePublicPageEvent, type GolfCoursePublicPageTournament } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

const defaultGolfCourseBanner = '/DefaultGolfBanner.jpg'
const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type CalendarCell = { key: string; day: number; dateKey: string }
type CalendarItem =
  | { kind: 'tournament'; id: string; name: string; date: string; tournament: GolfCoursePublicPageTournament }
  | { kind: 'courseEvent'; id: string; name: string; date: string; event: GolfCoursePublicPageEvent }

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

function formatTime(value?: string | null) {
  const normalized = String(value || '').slice(0, 5)
  if (!/^\d{2}:\d{2}$/.test(normalized)) return ''
  const [hour, minute] = normalized.split(':').map(Number)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute))
}

function formatTimeRange(event: GolfCoursePublicPageEvent) {
  const start = formatTime(event.startTime)
  const end = formatTime(event.endTime)
  if (start && end) return `${start} – ${end}`
  return start || 'Time to be announced'
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
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null)

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
          message: 'course_calendar_loaded',
          data: {
            slug: loaded.slug,
            golfCourseId: loaded.golfCourseId || null,
            calendarAvailable: loaded.calendarAvailable,
            tournamentCount: loaded.tournaments.length,
            courseEventCount: loaded.courseEvents?.length || 0,
            defaultMonth: monthKey(new Date()),
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load the course calendar.'
        if (active) setError(message)
        logFrontendEvent({ category: 'golf-course.calendar', level: 'error', message: 'course_calendar_load_failed', data: { slug: golfCourseSlug, error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [golfCourseSlug])

  useEffect(() => {
    const now = new Date()
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedItem(null)
  }, [golfCourseSlug])

  const itemsByDate = useMemo(() => {
    const result = new Map<string, CalendarItem[]>()
    for (const tournament of page?.tournaments || []) {
      const key = dateKey(tournament.startDate)
      if (!key) continue
      const item: CalendarItem = { kind: 'tournament', id: tournament.id, name: tournament.name, date: key, tournament }
      if (!result.has(key)) result.set(key, [])
      result.get(key)?.push(item)
    }
    for (const event of page?.courseEvents || []) {
      const key = dateKey(event.eventDate)
      if (!key) continue
      const item: CalendarItem = { kind: 'courseEvent', id: event.id, name: event.title, date: key, event }
      if (!result.has(key)) result.set(key, [])
      result.get(key)?.push(item)
    }
    for (const items of result.values()) items.sort((left, right) => left.name.localeCompare(right.name))
    return result
  }, [page?.courseEvents, page?.tournaments])

  const calendarCells = useMemo(() => buildCalendarCells(month), [month])
  const visibleMonthKey = monthKey(month)
  const visibleItemCount = useMemo(() => Array.from(itemsByDate.entries())
    .filter(([key]) => key.startsWith(`${visibleMonthKey}-`))
    .reduce((count, [, items]) => count + items.length, 0), [itemsByDate, visibleMonthKey])

  function changeMonth(offset: number) {
    setMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + offset, 1)
      logFrontendEvent({ category: 'golf-course.calendar', message: 'calendar_month_changed', data: { slug: golfCourseSlug, month: monthKey(next) } })
      return next
    })
    setSelectedItem(null)
  }

  function resetToCurrentMonth() {
    const now = new Date()
    const current = new Date(now.getFullYear(), now.getMonth(), 1)
    setMonth(current)
    setSelectedItem(null)
    logFrontendEvent({ category: 'golf-course.calendar', message: 'calendar_current_month_selected', data: { slug: golfCourseSlug, month: monthKey(current) } })
  }

  function selectItem(item: CalendarItem) {
    setSelectedItem(item)
    logFrontendEvent({
      category: 'golf-course.calendar',
      message: item.kind === 'tournament' ? 'calendar_tournament_selected' : 'calendar_course_event_selected',
      data: { slug: golfCourseSlug, itemId: item.id, itemType: item.kind, date: item.date },
    })
  }

  if (loading) return <div className="container pageStack"><div className="card pageCardShell">Loading course calendar…</div></div>

  if (!page || error) {
    return (
      <div className="container pageStack">
        <div className="card pageCardShell">
          <PageHero eyebrow="GolfHomiez golf courses" title="Course calendar not found" subtitle={error || 'This course calendar is not available.'} />
          <Link className="btn btnPrimary" to="/">Return to GolfHomiez</Link>
        </div>
      </div>
    )
  }

  if (!page.calendarAvailable) {
    return (
      <main className="golfCoursePublicPage">
        <section className="golfCoursePublicHero hasBanner" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.68)), url(${page.bannerImageData || defaultGolfCourseBanner})` }}>
          <div className="container golfCoursePublicHeroContent"><div className="golfCoursePublicEyebrow">GolfHomiez golf course</div><h1>{page.golfCourseName}</h1></div>
        </section>
        <div className="container golfCoursePublicContent">
          <GolfCoursePublicNav slug={page.slug} golfCourseName={page.golfCourseName} calendarAvailable={false} />
          <section className="card golfCourseCalendarUnavailable">
            <h2>Course Calendar</h2>
            <p>This calendar becomes available when the golf course has its first tournament or course event.</p>
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
          <div className="golfCoursePublicEyebrow">GolfHomiez course calendar</div>
          <h1>{page.golfCourseName}</h1>
          {(page.city || page.stateCode) ? <div className="golfCoursePublicLocation">{[page.city, page.stateCode].filter(Boolean).join(', ')}</div> : null}
        </div>
      </section>

      <div className="container golfCoursePublicContent">
        <GolfCoursePublicNav slug={page.slug} golfCourseName={page.golfCourseName} calendarAvailable={page.calendarAvailable} />
        <section className="card golfCourseCalendarCard">
          <div className="golfCourseCalendarHeader">
            <div>
              <div className="golfCoursePublicEyebrow">Course Calendar</div>
              <h2>{formatMonth(month)}</h2>
              <div className="small">{visibleItemCount} scheduled item{visibleItemCount === 1 ? '' : 's'} this month</div>
            </div>
            <div className="golfCourseCalendarActions">
              <button className="btn" type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">Previous</button>
              <button className="btn" type="button" onClick={resetToCurrentMonth}>Current month</button>
              <button className="btn" type="button" onClick={() => changeMonth(1)} aria-label="Next month">Next</button>
            </div>
          </div>
          <div className="golfCourseCalendarLegend" aria-label="Calendar color legend">
            <span><i className="golfCourseCalendarLegendTournament" aria-hidden="true" /> Tournament</span>
            <span><i className="golfCourseCalendarLegendCourseEvent" aria-hidden="true" /> Course event</span>
          </div>
          <div className="golfCourseCalendarWeekdays" aria-hidden="true">{dayLabels.map((label) => <div key={label}>{label}</div>)}</div>
          <div className="golfCourseCalendarGrid" role="grid" aria-label={`${formatMonth(month)} course calendar`}>
            {calendarCells.map((cell, index) => {
              if (!cell) return <div key={`blank-${index}`} className="golfCourseCalendarDay golfCourseCalendarDay--blank" aria-hidden="true" />
              const items = itemsByDate.get(cell.dateKey) || []
              return (
                <div key={cell.key} className={`golfCourseCalendarDay${cell.dateKey === todayKey ? ' golfCourseCalendarDay--today' : ''}`} role="gridcell" aria-label={`${formatDate(cell.dateKey)}${items.length ? `, ${items.length} scheduled item${items.length === 1 ? '' : 's'}` : ''}`}>
                  <div className="golfCourseCalendarDayNumber">{cell.day}</div>
                  <div className="golfCourseCalendarEvents">
                    {items.map((item) => (
                      <button key={`${item.kind}-${item.id}`} className={`golfCourseCalendarEvent${item.kind === 'courseEvent' ? ' golfCourseCalendarEvent--courseEvent' : ''}`} type="button" onClick={() => selectItem(item)}>
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {selectedItem?.kind === 'tournament' ? (
          <section className="card golfCourseCalendarDetails" aria-live="polite">
            <div className="golfCourseCalendarDetailsHeader"><div><div className="golfCoursePublicEyebrow">Tournament details</div><h2>{selectedItem.tournament.name}</h2></div><button className="btn" type="button" onClick={() => setSelectedItem(null)}>Close</button></div>
            <div className="golfCourseCalendarDetailGrid">
              <div><div className="label">Date</div><div>{formatDate(selectedItem.tournament.startDate)}</div></div>
              <div><div className="label">Name of Course</div><div>{selectedItem.tournament.golfCourseName || page.golfCourseName}</div></div>
              <div><div className="label">Point of Contact</div><div className="golfCourseCalendarContact">{pointOfContact(selectedItem.tournament).map((piece) => {
                if (piece === selectedItem.tournament.contactEmail) return <a key={piece} href={`mailto:${piece}`}>{piece}</a>
                if (piece === selectedItem.tournament.contactPhone) return <a key={piece} href={`tel:${String(piece).replace(/\D/g, '')}`}>{piece}</a>
                return <span key={piece}>{piece}</span>
              })}</div></div>
            </div>
            <Link className="btn btnPrimary" to={selectedItem.tournament.portalPath}>View tournament</Link>
          </section>
        ) : null}

        {selectedItem?.kind === 'courseEvent' ? (
          <section className="card golfCourseCalendarDetails golfCourseCalendarDetails--courseEvent" aria-live="polite">
            <div className="golfCourseCalendarDetailsHeader"><div><div className="golfCoursePublicEyebrow">Course event details</div><h2>{selectedItem.event.title}</h2></div><button className="btn" type="button" onClick={() => setSelectedItem(null)}>Close</button></div>
            <div className="golfCourseCalendarDetailGrid">
              <div><div className="label">Date</div><div>{formatDate(selectedItem.event.eventDate)}</div></div>
              <div><div className="label">Time</div><div>{formatTimeRange(selectedItem.event)}</div></div>
              <div><div className="label">Golf course</div><div>{page.golfCourseName}</div></div>
            </div>
            {selectedItem.event.details ? <div className="golfCourseCalendarCourseEventDetails">{selectedItem.event.details}</div> : <div className="small">No additional event details were provided.</div>}
          </section>
        ) : null}
      </div>
    </main>
  )
}
