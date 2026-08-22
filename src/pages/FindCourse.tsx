import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  searchGolfHomiezCourses,
  type GolfHomiezCourseSearchFilters,
  type GolfHomiezCourseSearchResult,
} from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { fetchProfile } from '../lib/profile'
import { US_STATES } from '../data/usStates'
import { formatValidUsPhoneForDisplay } from '../lib/phone-validation'

const SEARCH_PAGE_SIZE = 20
const FALLBACK_STATE = 'UT'

type SearchPagination = {
  page: number
  pageSize: number
  totalResults: number
  totalPages: number
}

type ZipSearchStatus = {
  requestedZipCode?: string | null
  radiusMiles: number
  radiusResolved: boolean
  source?: string | null
}

const EMPTY_PAGINATION: SearchPagination = {
  page: 1,
  pageSize: SEARCH_PAGE_SIZE,
  totalResults: 0,
  totalPages: 0,
}

function profileStateCode(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return US_STATES.find((state) => state.abbr.toLowerCase() === normalized || state.name.toLowerCase() === normalized)?.abbr || ''
}

function formatCourseLocation(course: GolfHomiezCourseSearchResult) {
  return [course.city, course.state, course.zipCode].filter(Boolean).join(', ') || course.state
}

function absoluteCourseWebsiteUrl(path?: string | null, fallbackUrl?: string | null) {
  if (!path) return fallbackUrl || 'Website unavailable'
  if (typeof window === 'undefined' || !window.location?.origin) return path
  return new URL(path, window.location.origin).href
}

function visiblePageNumbers(currentPage: number, totalPages: number) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
  return Array.from({ length: 5 }, (_, index) => start + index)
}

export default function FindCourse() {
  const navigate = useNavigate()
  const [defaultState, setDefaultState] = useState(FALLBACK_STATE)
  const [searchFilters, setSearchFilters] = useState<GolfHomiezCourseSearchFilters>({ state: FALLBACK_STATE, city: '', zipCode: '', golfCourseName: '' })
  const [searchResults, setSearchResults] = useState<GolfHomiezCourseSearchResult[]>([])
  const [submittedFilters, setSubmittedFilters] = useState<GolfHomiezCourseSearchFilters | null>(null)
  const [pagination, setPagination] = useState<SearchPagination>(EMPTY_PAGINATION)
  const [zipSearch, setZipSearch] = useState<ZipSearchStatus | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    let active = true
    fetchProfile()
      .then((profile) => {
        if (!active) return
        const state = profileStateCode(profile.primaryState) || FALLBACK_STATE
        setDefaultState(state)
        setSearchFilters((current) => current.state ? current : { ...current, state })
        logFrontendEvent({ category: 'user.golfCourses.search', message: 'golf_course_search_defaults_loaded', data: { route: '/find-course', state } })
      })
      .catch((err) => {
        if (!active) return
        setDefaultState(FALLBACK_STATE)
        setSearchFilters((current) => current.state ? current : { ...current, state: FALLBACK_STATE })
        logFrontendEvent({ category: 'user.golfCourses.search', level: 'warn', message: 'golf_course_search_profile_default_failed', data: { route: '/find-course', fallbackState: FALLBACK_STATE, error: err instanceof Error ? err.message : String(err) } })
      })
    return () => { active = false }
  }, [])

  async function executeSearch(filters: GolfHomiezCourseSearchFilters, page: number) {
    setSearching(true)
    setSearchError(null)
    setHasSearched(true)
    logFrontendEvent({ category: 'user.golfCourses.search', message: 'golf_course_search_started', data: { route: '/find-course', page, pageSize: SEARCH_PAGE_SIZE, ...filters } })
    try {
      const result = await searchGolfHomiezCourses(filters, page)
      setSearchResults(result.courses || [])
      setPagination(result.pagination || EMPTY_PAGINATION)
      setZipSearch(result.zipSearch || null)
      logFrontendEvent({
        category: 'user.golfCourses.search',
        message: 'golf_course_search_completed',
        data: {
          route: '/find-course',
          filters: result.filters,
          page: result.pagination?.page || page,
          pageSize: result.pagination?.pageSize || SEARCH_PAGE_SIZE,
          resultCount: result.courses?.length || 0,
          totalResults: result.pagination?.totalResults || 0,
          zipRadiusMiles: result.zipSearch?.radiusMiles || 50,
          zipRadiusResolved: result.zipSearch?.radiusResolved ?? true,
          zipRadiusSource: result.zipSearch?.source || null,
        },
      })
      if (result.filters.zipCode && !result.zipSearch?.radiusResolved) {
        logFrontendEvent({ category: 'user.golfCourses.search', level: 'warn', message: 'golf_course_search_zip_radius_unavailable', data: { route: '/find-course', zipCode: result.filters.zipCode, fallback: 'exact_zip_only' } })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not search GolfHomiez golf courses.'
      setSearchResults([])
      setPagination(EMPTY_PAGINATION)
      setZipSearch(null)
      setSearchError(message)
      logFrontendEvent({ category: 'user.golfCourses.search', level: 'error', message: 'golf_course_search_failed', data: { route: '/find-course', page, ...filters, error: message } })
    } finally {
      setSearching(false)
    }
  }

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const filters = { ...searchFilters }
    setSubmittedFilters(filters)
    await executeSearch(filters, 1)
  }

  async function changePage(page: number) {
    if (searching || page < 1 || page > pagination.totalPages || page === pagination.page) return
    logFrontendEvent({ category: 'user.golfCourses.search', message: 'golf_course_search_page_selected', data: { route: '/find-course', fromPage: pagination.page, toPage: page, totalPages: pagination.totalPages } })
    await executeSearch(submittedFilters || searchFilters, page)
  }

  function clearSearch() {
    setSearchFilters({ state: defaultState, city: '', zipCode: '', golfCourseName: '' })
    setSearchResults([])
    setSubmittedFilters(null)
    setPagination(EMPTY_PAGINATION)
    setZipSearch(null)
    setSearchError(null)
    setHasSearched(false)
    logFrontendEvent({ category: 'user.golfCourses.search', message: 'golf_course_search_cleared', data: { route: '/find-course', state: defaultState } })
  }

  const pageNumbers = visiblePageNumbers(pagination.page, pagination.totalPages)

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div className="findTournamentHeaderActions">
          <Link
            className="btn btnLightGreen btnSmall"
            to="/find-tournament"
            onClick={() => logFrontendEvent({ category: 'user.golfCourses.navigation', message: 'find_tournament_clicked', data: { route: '/find-course', destination: '/find-tournament' } })}
          >
            Find a Tournament
          </Link>
        </div>

        <section className="card tournamentSearchCard" aria-labelledby="golf-course-search-heading">
          <h2 id="golf-course-search-heading" style={{ margin: '0 0 14px' }}>Find a Golf Course</h2>
          <form onSubmit={onSearch} className="tournamentSearchForm">
            <div className="tournamentSearchGrid">
              <label className="field">
                <span>State</span>
                <select className="input" value={searchFilters.state || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, state: event.target.value }))}>
                  {US_STATES.map((state) => <option key={state.abbr} value={state.abbr}>{state.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>City</span>
                <input className="input" value={searchFilters.city || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, city: event.target.value }))} placeholder="City" maxLength={128} />
              </label>
              <label className="field">
                <span>Zip Code</span>
                <input className="input" value={searchFilters.zipCode || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, zipCode: event.target.value }))} placeholder="Zip Code" inputMode="numeric" maxLength={10} />
              </label>
              <label className="field tournamentSearchCourseField">
                <span>Golf Course Name</span>
                <input className="input" value={searchFilters.golfCourseName || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, golfCourseName: event.target.value }))} placeholder="Golf course name" maxLength={191} />
              </label>
            </div>
            <div className="tournamentSearchActions">
              <div className="tournamentSearchSubmitBlock">
                <button className="btnPrimary" type="submit" disabled={searching}>{searching ? 'Searching…' : 'Find a Golf Course'}</button>
                {hasSearched && !searchError ? (
                  <div className="small tournamentSearchResultCount" aria-live="polite">
                    {pagination.totalResults.toLocaleString('en-US')} search {pagination.totalResults === 1 ? 'result' : 'results'}
                  </div>
                ) : null}
              </div>
              <button className="btn" type="button" onClick={clearSearch} disabled={searching}>Clear</button>
            </div>
          </form>

          {searchError ? <div className="statusMessage statusError">{searchError}</div> : null}
          {zipSearch?.requestedZipCode && !zipSearch.radiusResolved ? (
            <div className="statusMessage" role="status">The {zipSearch.radiusMiles}-mile ZIP radius lookup is temporarily unavailable. Exact ZIP matches are shown until the radius lookup is available.</div>
          ) : null}
          {hasSearched && !searching && !searchError && pagination.totalResults === 0 ? (
            <div className="small tournamentSearchEmpty">No golf courses matched those search criteria.</div>
          ) : null}
          {searchResults.length > 0 ? (
            <>
              <div className="compactLineItemList tournamentSearchResults" aria-live="polite">
                {searchResults.map((course) => {
                  const target = course.golfCoursePagePath || course.websiteUrl || ''
                  const websiteLabel = absoluteCourseWebsiteUrl(course.golfCoursePagePath, course.websiteUrl)
                  const displayPhone = formatValidUsPhoneForDisplay(course.phone)
                  const openCourse = () => {
                    if (!target) return
                    logFrontendEvent({ category: 'user.golfCourses.search', message: 'golf_course_search_result_opened', data: { route: '/find-course', golfCourseId: course.golfCourseId || course.id, golfCourseName: course.golfCourseName, target, displayedWebsite: websiteLabel, hasPhone: Boolean(displayPhone), isGolfHomiezWebsite: Boolean(course.golfCoursePagePath), distanceMiles: course.distanceMiles ?? null } })
                    if (target.startsWith('/')) navigate(target)
                    else window.open(target, '_blank', 'noopener,noreferrer')
                  }
                  const onCourseKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    openCourse()
                  }
                  return (
                    <div
                      className={`compactLineItem tournamentSearchResult tournamentSearchResultClickable${course.hostedTournamentCount > 0 ? ' tournamentSearchResultGolfHomiez' : ''}`}
                      key={course.id}
                      role={target ? 'button' : undefined}
                      tabIndex={target ? 0 : undefined}
                      onClick={openCourse}
                      onKeyDown={onCourseKeyDown}
                      aria-label={target ? `Open ${course.golfCourseName}` : undefined}
                    >
                      <span className="compactLineItemMain tournamentSearchResultMain">
                        <strong className="tournamentSearchCourseName">{course.golfCourseName}</strong>
                        <span className="tournamentSearchMidline">
                          <span><strong>Location:</strong> {formatCourseLocation(course)}</span>
                          {displayPhone ? <span><strong>Phone:</strong> {displayPhone}</span> : null}
                          {course.distanceMiles != null && searchFilters.zipCode ? <span><strong>ZIP distance:</strong> {course.distanceMiles.toFixed(1)} miles</span> : null}
                        </span>
                        <span className="tournamentSearchTournamentName"><strong>Website:</strong> {websiteLabel}</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {pagination.totalPages > 1 ? (
                <nav className="tournamentSearchPagination" aria-label="Golf course search result pages">
                  <button className="btn btnSmall" type="button" disabled={searching || pagination.page <= 1} onClick={() => void changePage(pagination.page - 1)}>Previous</button>
                  <div className="tournamentSearchPageNumbers">
                    {pageNumbers.map((page) => (
                      <button
                        className={`btn btnSmall ${page === pagination.page ? 'btnPrimary' : ''}`}
                        type="button"
                        key={page}
                        aria-current={page === pagination.page ? 'page' : undefined}
                        disabled={searching}
                        onClick={() => void changePage(page)}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <button className="btn btnSmall" type="button" disabled={searching || pagination.page >= pagination.totalPages} onClick={() => void changePage(pagination.page + 1)}>Next</button>
                  <span className="small tournamentSearchPageSummary">Page {pagination.page} of {pagination.totalPages}</span>
                </nav>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}
