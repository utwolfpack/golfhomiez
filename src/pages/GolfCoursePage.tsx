import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import PageHero from '../components/PageHero'
import { fetchGolfCoursePublicPage, type GolfCoursePublicPage as GolfCoursePublicPageRecord } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
const defaultGolfCourseBanner = '/DefaultGolfBanner.jpg'

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

export default function GolfCoursePage() {
  const { golfCourseSlug = '' } = useParams()
  const [page, setPage] = useState<GolfCoursePublicPageRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
          data: { slug: loaded.slug, golfCourseId: loaded.golfCourseId || null, tournamentCount: loaded.tournamentCount, uploadedBannerUsed: Boolean(loaded.bannerImageData) },
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
        <section className="card golfCoursePublicSummaryCard">
          <h2>About the course</h2>
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
            <div className="golfCourseTournamentList">
              {page.tournaments.map((tournament) => (
                <Link className="golfCourseTournamentRow" to={tournament.portalPath} key={tournament.id}>
                  <div>
                    <strong>{tournament.name}</strong>
                    <div className="small">{formatTournamentDate(tournament.startDate)}</div>
                  </div>
                  <span aria-hidden="true">View tournament →</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="small">No public GolfHomiez tournaments are currently listed for this course.</div>
          )}
        </section>
      </div>
    </main>
  )
}
