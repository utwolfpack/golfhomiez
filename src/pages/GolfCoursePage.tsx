import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import PageHero from '../components/PageHero'
import GolfCoursePublicNav from '../components/GolfCoursePublicNav'
import { fetchGolfCoursePublicPage, type GolfCoursePublicPage as GolfCoursePublicPageRecord } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
const defaultGolfCourseBanner = '/DefaultGolfBanner.jpg'
const TOURNAMENTS_PER_PAGE = 15
const UPCOMING_CALENDAR_ITEM_LIMIT = 5

function formatTournamentDate(value?: string | null) {
  if (!value) return 'Date to be announced'
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function tournamentYear(value?: string | null) {
  if (!value) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date.getFullYear()
}

function formatTournamentStatus(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'Listed'
  return normalized.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function formatTournamentStartType(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'shotgun') return 'Shotgun start'
  if (normalized === 'tee-times') return 'Tee times'
  return normalized ? formatTournamentStatus(normalized) : 'Start details posted'
}

function formatTournamentStartTime(value?: string | null) {
  if (!value) return ''
  const [rawHour, rawMinute] = String(value).split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return String(value)
  const date = new Date(2000, 0, 1, hour, minute)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

export default function GolfCoursePage() {
  const { golfCourseSlug = '' } = useParams()
  const [page, setPage] = useState<GolfCoursePublicPageRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTournamentYear, setSelectedTournamentYear] = useState(() => String(new Date().getFullYear()))
  const [selectedTournamentPage, setSelectedTournamentPage] = useState(1)

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
          category: 'golf-course.public-page',
          message: 'golf_course_public_page_loaded',
          data: { slug: loaded.slug, golfCourseId: loaded.golfCourseId || null, tournamentCount: loaded.tournamentCount, courseEventCount: loaded.courseEventCount, uploadedBannerUsed: Boolean(loaded.bannerImageData) },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load golf-course page.'
        if (active) setError(message)
        logFrontendEvent({
          category: 'golf-course.public-page',
          level: 'error',
          message: 'golf_course_public_page_load_failed',
          data: { slug: golfCourseSlug, error: message },
        })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [golfCourseSlug])

  const address = useMemo(() => [
    page?.addressLine1,
    [page?.city, page?.stateCode].filter(Boolean).join(', '),
    page?.postalCode,
  ].filter(Boolean).join(' '), [page])

  const currentYear = new Date().getFullYear()
  const visiblePublicTournaments = useMemo(() => (page?.tournaments || []).filter((tournament) => ['published', 'completed'].includes(String(tournament.status || '').toLowerCase())), [page?.tournaments])
  const tournamentYears = useMemo(() => {
    const years = new Set<number>([currentYear])
    ;visiblePublicTournaments.forEach((tournament) => {
      const year = tournamentYear(tournament.startDate)
      if (year) years.add(year)
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [currentYear, visiblePublicTournaments])

  const selectedYearNumber = Number(selectedTournamentYear) || currentYear
  const filteredTournaments = useMemo(() => visiblePublicTournaments
    .filter((tournament) => tournamentYear(tournament.startDate) === selectedYearNumber)
    .sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || ''))), [visiblePublicTournaments, selectedYearNumber])
  const pageCount = Math.max(1, Math.ceil(filteredTournaments.length / TOURNAMENTS_PER_PAGE))
  const safeTournamentPage = Math.min(Math.max(selectedTournamentPage, 1), pageCount)
  const visibleTournaments = filteredTournaments.slice((safeTournamentPage - 1) * TOURNAMENTS_PER_PAGE, safeTournamentPage * TOURNAMENTS_PER_PAGE)
  const todayCourseDateKey = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])
  const upcomingCalendarItems = useMemo(() => [
    ...(page?.tournaments || [])
      .filter((tournament) => ['published', 'completed'].includes(String(tournament.status || '').toLowerCase()) && String(tournament.startDate || '').slice(0, 10) >= todayCourseDateKey)
      .map((tournament) => ({ kind: 'tournament' as const, id: tournament.id, title: tournament.name, eventDate: String(tournament.startDate || '').slice(0, 10), startTime: tournament.startTime || null, details: `${formatTournamentStartType(tournament.startType)} tournament`, path: tournament.portalPath })),
    ...(page?.courseEvents || [])
      .filter((event) => String(event.eventDate || '') >= todayCourseDateKey)
      .map((event) => ({ kind: 'courseEvent' as const, id: event.id, title: event.title, eventDate: event.eventDate, startTime: event.startTime || null, endTime: event.endTime || null, details: event.details || null, path: page?.calendarPath || '' })),
  ]
    .sort((left, right) => {
      const dateCompare = String(left.eventDate || '').localeCompare(String(right.eventDate || ''))
      if (dateCompare) return dateCompare
      const leftTime = String(left.startTime || '99:99')
      const rightTime = String(right.startTime || '99:99')
      return leftTime.localeCompare(rightTime) || String(left.title || '').localeCompare(String(right.title || ''))
    })
    .slice(0, UPCOMING_CALENDAR_ITEM_LIMIT), [page?.calendarPath, page?.courseEvents, page?.tournaments, todayCourseDateKey])

  useEffect(() => {
    setSelectedTournamentYear(String(new Date().getFullYear()))
    setSelectedTournamentPage(1)
  }, [golfCourseSlug])

  useEffect(() => {
    setSelectedTournamentPage(1)
  }, [selectedTournamentYear])

  useEffect(() => {
    if (selectedTournamentPage !== safeTournamentPage) setSelectedTournamentPage(safeTournamentPage)
  }, [safeTournamentPage, selectedTournamentPage])

  if (loading) {
    return <div className="container pageStack"><div className="card pageCardShell">Loading golf-course page…</div></div>
  }

  if (!page || error) {
    return (
      <div className="container pageStack">
        <div className="card pageCardShell">
          <PageHero eyebrow="GolfHomiez golf courses" title="Golf-course page not found" subtitle={error || 'This page is not available.'} />
          <Link className="btn btnPrimary" to="/">Return to GolfHomiez</Link>
        </div>
      </div>
    )
  }

  const bannerImage = page.bannerImageData || defaultGolfCourseBanner

  return (
    <main className="golfCoursePublicPage">
      <section className="golfCoursePublicHero hasBanner" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.68)), url(${bannerImage})` }}>
        <div className="container golfCoursePublicHeroContent">
          <div className="golfCoursePublicEyebrow">GolfHomiez golf course</div>
          <h1>{page.golfCourseName}</h1>
          {(page.city || page.stateCode) ? <div className="golfCoursePublicLocation">{[page.city, page.stateCode].filter(Boolean).join(', ')}</div> : null}
        </div>
      </section>

      <div className="container golfCoursePublicContent">
        <GolfCoursePublicNav slug={page.slug} golfCourseName={page.golfCourseName} calendarAvailable={page.calendarAvailable} />

        <section className="card golfCoursePublicSummaryCard">
          <div className="golfCoursePublicSummaryHeading">
            <h2>About the course</h2>
            {page.calendarAvailable ? (
              <Link
                className="golfCourseCalendarHappyLink"
                to={page.calendarPath}
                onClick={() => logFrontendEvent({ category: 'golf-course.public-page', message: 'tournament_calendar_happy_link_selected', data: { slug: page.slug, calendarPath: page.calendarPath } })}
              >
                Tournament Calendar
              </Link>
            ) : null}
          </div>
          <section className="golfCourseUpcomingEvents" aria-label="Upcoming golf course events">
            <div className="golfCourseUpcomingEventsHeader">
              <div>
                <div className="golfCoursePublicEyebrow">Course calendar</div>
                <h3>Upcoming events</h3>
              </div>
              <span>{upcomingCalendarItems.length ? `Next ${upcomingCalendarItems.length}` : 'No events scheduled'}</span>
            </div>
            {upcomingCalendarItems.length ? (
              <div className="golfCourseUpcomingEventList">
                {upcomingCalendarItems.map((event) => {
                  const timeRange = [formatTournamentStartTime(event.startTime), event.kind === 'courseEvent' ? formatTournamentStartTime(event.endTime) : ''].filter(Boolean).join(' – ')
                  return (
                    <Link
                      key={`${event.kind}-${event.id}`}
                      className="golfCourseUpcomingEventRow"
                      to={event.path || page.calendarPath}
                      onClick={() => logFrontendEvent({ category: 'golf-course.public-page', message: event.kind === 'tournament' ? 'upcoming_tournament_selected' : 'upcoming_course_event_selected', data: { slug: page.slug, itemId: event.id, itemType: event.kind, eventDate: event.eventDate, destinationPath: event.path || page.calendarPath } })}
                    >
                      <div className="golfCourseUpcomingEventDate">
                        <strong>{formatTournamentDate(event.eventDate)}</strong>
                        <span>{timeRange || 'Time TBA'}</span>
                      </div>
                      <div className="golfCourseUpcomingEventMain">
                        <span className={`golfCourseUpcomingEventType golfCourseUpcomingEventType--${event.kind}`}>{event.kind === 'tournament' ? 'Tournament' : 'Course event'}</span>
                        <strong>{event.title}</strong>
                      </div>
                      <span className="golfCourseUpcomingEventAction" aria-hidden="true">View →</span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="golfCourseUpcomingEventsEmpty">No upcoming course events are scheduled yet. Check the tournament calendar for tournament dates and future updates.</p>
            )}
          </section>
          <p>{page.summary}</p>
          <div className="golfCoursePublicContactGrid">
            {address ? (
              <div>
                <div className="label">Address</div>
                <div>{address}</div>
              </div>
            ) : null}
            {page.contactPhone ? (
              <div>
                <div className="label">Contact</div>
                <a href={`tel:${page.contactPhone.replace(/\D/g, '')}`}>{page.contactPhone}</a>
              </div>
            ) : null}
          </div>
          {page.websiteUrl ? (
            <a className="btn btnPrimary" href={page.websiteUrl} target="_blank" rel="noreferrer">Visit golf-course website</a>
          ) : null}
        </section>

        <section className="card golfCourseTournamentSection">
          <div className="golfCourseTournamentHeader">
            <div>
              <div className="golfCoursePublicEyebrow">GolfHomiez tournaments</div>
              <h2>Tournaments hosted at {page.golfCourseName}</h2>
            </div>
            <div className="golfCourseTournamentCount" aria-label={`${page.tournamentCount} tournaments`}>{page.tournamentCount}</div>
          </div>

          {page.tournaments.length ? (
            <>
              <div className="golfCourseTournamentControls" aria-label="Tournament year filters">
                <div className="golfCourseTournamentYearTabs">
                  {tournamentYears.map((year) => (
                    <button
                      type="button"
                      key={year}
                      className={`golfCourseTournamentYearTab ${selectedYearNumber === year ? 'golfCourseTournamentYearTab--active' : ''}`}
                      onClick={() => setSelectedTournamentYear(String(year))}
                    >
                      {year}
                    </button>
                  ))}
                </div>
                <div className="small">{filteredTournaments.length} tournament{filteredTournaments.length === 1 ? '' : 's'} in {selectedYearNumber}</div>
              </div>
              {visibleTournaments.length ? (
                <div className="golfCourseTournamentList">
                  {visibleTournaments.map((tournament) => {
                    const startLabel = [formatTournamentStartType(tournament.startType), formatTournamentStartTime(tournament.startTime)].filter(Boolean).join(' • ')
                    return (
                      <Link className="golfCourseTournamentRow" to={tournament.portalPath} key={tournament.id}>
                        <div>
                          <strong>{tournament.name}</strong>
                          <div className="golfCourseTournamentRowMeta">
                            <span>{formatTournamentDate(tournament.startDate)}</span>
                            <span>{startLabel}</span>
                          </div>
                        </div>
                        <span aria-hidden="true">View tournament →</span>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="small">No public GolfHomiez tournaments are currently listed for {selectedYearNumber}.</div>
              )}
              {pageCount > 1 ? (
                <div className="golfCourseTournamentPagination" aria-label="Tournament pagination">
                  <button type="button" className="btn btnSmall" disabled={safeTournamentPage <= 1} onClick={() => setSelectedTournamentPage((pageNumber) => Math.max(1, pageNumber - 1))}>Previous</button>
                  <span className="small">Page {safeTournamentPage} of {pageCount}</span>
                  <button type="button" className="btn btnSmall" disabled={safeTournamentPage >= pageCount} onClick={() => setSelectedTournamentPage((pageNumber) => Math.min(pageCount, pageNumber + 1))}>Next</button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="small">No public GolfHomiez tournaments are currently listed for this course.</div>
          )}
        </section>
      </div>
    </main>
  )
}
