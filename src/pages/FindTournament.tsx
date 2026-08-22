import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  searchGolfCourseTournaments,
  type GolfCourseTournamentSearchFilters,
  type GolfCourseTournamentSearchResult,
} from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatValidUsPhoneForDisplay } from '../lib/phone-validation'
import { fetchProfile } from '../lib/profile'
import { US_STATES } from '../data/usStates'

const SEARCH_PAGE_SIZE = 20

type SearchPagination = {
  page: number
  pageSize: number
  totalResults: number
  totalPages: number
}

const EMPTY_PAGINATION: SearchPagination = {
  page: 1,
  pageSize: SEARCH_PAGE_SIZE,
  totalResults: 0,
  totalPages: 0,
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
  if (Number.isNaN(dateOnly.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(dateOnly)
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addUtcMonths(date: Date, months: number) {
  const result = new Date(date.getTime())
  const originalDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDayOfTargetMonth = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0,
    12,
    0,
    0,
  )).getUTCDate()
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth))
  return result
}

function tournamentSearchDateBounds() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0))
  const defaultTo = new Date(start.getTime())
  defaultTo.setUTCDate(defaultTo.getUTCDate() + 14)
  const max = addUtcMonths(start, 6)
  return {
    min: dateInputValue(start),
    defaultTo: dateInputValue(defaultTo),
    max: dateInputValue(max),
  }
}

function profileStateCode(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return US_STATES.find((state) => state.abbr.toLowerCase() === normalized || state.name.toLowerCase() === normalized)?.abbr || ''
}

function formatSearchResultLocation(tournament: GolfCourseTournamentSearchResult) {
  return [tournament.city, tournament.state, tournament.zipCode].filter(Boolean).join(', ') || tournament.state
}

function absoluteCourseWebsiteUrl(path?: string | null, fallbackUrl?: string | null) {
  if (!path) return fallbackUrl || 'Website not listed'
  if (typeof window === 'undefined' || !window.location?.origin) return path
  return new URL(path, window.location.origin).href
}

function visiblePageNumbers(currentPage: number, totalPages: number) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
  return Array.from({ length: 5 }, (_, index) => start + index)
}

export default function FindTournament() {
  const navigate = useNavigate()
  const dateBounds = useMemo(tournamentSearchDateBounds, [])
  const [defaultState, setDefaultState] = useState('')
  const [searchFilters, setSearchFilters] = useState<GolfCourseTournamentSearchFilters>({
    state: '',
    city: '',
    zipCode: '',
    golfCourseName: '',
    fromDate: dateBounds.min,
    toDate: dateBounds.defaultTo,
  })
  const [searchResults, setSearchResults] = useState<GolfCourseTournamentSearchResult[]>([])
  const [submittedFilters, setSubmittedFilters] = useState<GolfCourseTournamentSearchFilters | null>(null)
  const [pagination, setPagination] = useState<SearchPagination>(EMPTY_PAGINATION)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    let active = true
    fetchProfile()
      .then((profile) => {
        if (!active) return
        const state = profileStateCode(profile.primaryState)
        if (!state) return
        setDefaultState(state)
        setSearchFilters((current) => current.state ? current : { ...current, state })
        logFrontendEvent({ category: 'user.tournaments.search', message: 'tournament_search_defaults_loaded', data: { route: '/find-tournament', state, fromDate: dateBounds.min, toDate: dateBounds.defaultTo } })
      })
      .catch((err) => {
        if (!active) return
        logFrontendEvent({ category: 'user.tournaments.search', level: 'warn', message: 'tournament_search_profile_default_failed', data: { route: '/find-tournament', error: err instanceof Error ? err.message : String(err) } })
      })
    return () => { active = false }
  }, [dateBounds.defaultTo, dateBounds.min])

  async function executeSearch(filters: GolfCourseTournamentSearchFilters, page: number) {
    setSearching(true)
    setSearchError(null)
    setHasSearched(true)
    logFrontendEvent({ category: 'user.tournaments.search', message: 'tournament_search_started', data: { route: '/find-tournament', page, pageSize: SEARCH_PAGE_SIZE, ...filters } })
    try {
      const result = await searchGolfCourseTournaments(filters, page)
      setSearchResults(result.tournaments || [])
      setPagination(result.pagination || EMPTY_PAGINATION)
      logFrontendEvent({
        category: 'user.tournaments.search',
        message: 'tournament_search_completed',
        data: {
          route: '/find-tournament',
          filters: result.filters,
          page: result.pagination?.page || page,
          pageSize: result.pagination?.pageSize || SEARCH_PAGE_SIZE,
          resultCount: result.tournaments?.length || 0,
          totalResults: result.pagination?.totalResults || 0,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not search golf tournaments.'
      setSearchResults([])
      setPagination(EMPTY_PAGINATION)
      setSearchError(message)
      logFrontendEvent({ category: 'user.tournaments.search', level: 'error', message: 'tournament_search_failed', data: { route: '/find-tournament', page, ...filters, error: message } })
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
    logFrontendEvent({ category: 'user.tournaments.search', message: 'tournament_search_page_selected', data: { route: '/find-tournament', fromPage: pagination.page, toPage: page, totalPages: pagination.totalPages } })
    await executeSearch(submittedFilters || searchFilters, page)
  }

  function clearSearch() {
    setSearchFilters({ state: defaultState, city: '', zipCode: '', golfCourseName: '', fromDate: dateBounds.min, toDate: dateBounds.defaultTo })
    setSearchResults([])
    setSubmittedFilters(null)
    setPagination(EMPTY_PAGINATION)
    setSearchError(null)
    setHasSearched(false)
    logFrontendEvent({ category: 'user.tournaments.search', message: 'tournament_search_cleared', data: { route: '/find-tournament', state: defaultState, fromDate: dateBounds.min, toDate: dateBounds.defaultTo } })
  }

  const pageNumbers = visiblePageNumbers(pagination.page, pagination.totalPages)

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div className="findTournamentHeaderActions">
          <Link
            className="btn btnLightGreen btnSmall"
            to="/my-tournaments"
            onClick={() => logFrontendEvent({ category: 'user.tournaments.navigation', message: 'my_tournaments_clicked', data: { route: '/find-tournament' } })}
          >
            My Tournaments
          </Link>
        </div>

        <section className="card tournamentSearchCard" aria-labelledby="tournament-search-heading">
          <h2 id="tournament-search-heading" style={{ margin: '0 0 14px' }}>Find a Tournament</h2>
          <form onSubmit={onSearch} className="tournamentSearchForm">
            <div className="tournamentSearchGrid">
              <label className="field">
                <span>State</span>
                <select className="input" value={searchFilters.state || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, state: event.target.value }))}>
                  <option value="">All states</option>
                  {US_STATES.map((state) => <option key={state.abbr} value={state.abbr}>{state.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>City</span>
                <input className="input" value={searchFilters.city || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, city: event.target.value }))} placeholder="City" maxLength={128} />
              </label>
              <label className="field">
                <span>Zip Code</span>
                <input className="input" value={searchFilters.zipCode || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, zipCode: event.target.value }))} placeholder="Zip Code" inputMode="numeric" maxLength={32} />
              </label>
              <label className="field tournamentSearchCourseField">
                <span>Golf Course Name</span>
                <input className="input" value={searchFilters.golfCourseName || ''} onChange={(event) => setSearchFilters((current) => ({ ...current, golfCourseName: event.target.value }))} placeholder="Golf course name" maxLength={191} />
              </label>
              <label className="field">
                <span>From Date</span>
                <input className="input" type="date" min={dateBounds.min} max={dateBounds.max} value={searchFilters.fromDate || dateBounds.min} onChange={(event) => setSearchFilters((current) => ({ ...current, fromDate: event.target.value }))} required />
              </label>
              <label className="field">
                <span>To Date</span>
                <input className="input" type="date" min={searchFilters.fromDate || dateBounds.min} max={dateBounds.max} value={searchFilters.toDate || dateBounds.defaultTo} onChange={(event) => setSearchFilters((current) => ({ ...current, toDate: event.target.value }))} required />
              </label>
            </div>
            <div className="tournamentSearchActions">
              <div className="tournamentSearchSubmitBlock">
                <button className="btnPrimary" type="submit" disabled={searching}>{searching ? 'Searching…' : 'Find a Tournament'}</button>
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
          {hasSearched && !searching && !searchError && pagination.totalResults === 0 ? (
            <div className="small tournamentSearchEmpty">No tournaments matched those search criteria.</div>
          ) : null}
          {searchResults.length > 0 ? (
            <>
              <div className="compactLineItemList tournamentSearchResults" aria-live="polite">
                {searchResults.map((tournament) => {
                  const isGolfHomiezTournament = Boolean(tournament.isGolfHomiezTournament)
                  const golfCourseTarget = tournament.golfCoursePagePath || ''
                  const websiteTarget = tournament.golfCourseWebsiteUrl || golfCourseTarget || tournament.tournamentWebsite || tournament.sourceUrl || ''
                  const tournamentTarget = isGolfHomiezTournament ? (tournament.tournamentPath || '') : websiteTarget
                  const websiteLabel = absoluteCourseWebsiteUrl(tournament.golfCoursePagePath, tournament.golfCourseWebsiteUrl || tournament.tournamentWebsite || tournament.sourceUrl)
                  const displayPhone = formatValidUsPhoneForDisplay(tournament.golfCoursePhone)
                  const openTournament = () => {
                    if (!tournamentTarget) return
                    logFrontendEvent({
                      category: 'user.tournaments.search',
                      message: isGolfHomiezTournament ? 'golfhomiez_tournament_line_item_opened' : 'golf_course_website_line_item_opened',
                      data: { route: '/find-tournament', tournamentId: tournament.golfHomiezTournamentId || tournament.id, golfCourseName: tournament.golfCourseName, target: tournamentTarget, displayedWebsite: websiteLabel, hasPhone: Boolean(displayPhone), isGolfHomiezWebsite: Boolean(tournament.golfCoursePagePath), registered: Boolean(tournament.isRegistered) },
                    })
                    if (tournamentTarget.startsWith('/')) navigate(tournamentTarget)
                    else window.open(tournamentTarget, '_blank', 'noopener,noreferrer')
                  }
                  const onTournamentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    openTournament()
                  }
                  return (
                    <div
                      className={`compactLineItem tournamentSearchResult tournamentSearchResultClickable ${isGolfHomiezTournament ? 'tournamentSearchResultGolfHomiez' : ''}`}
                      key={tournament.id}
                      role={tournamentTarget ? 'button' : undefined}
                      tabIndex={tournamentTarget ? 0 : undefined}
                      onClick={openTournament}
                      onKeyDown={onTournamentKeyDown}
                      aria-label={tournamentTarget ? `Open ${tournament.tournamentName || 'golf tournament'}` : undefined}
                    >
                      <span className="compactLineItemMain tournamentSearchResultMain">
                        <span className="tournamentSearchCourseHeading">
                          <strong className="tournamentSearchCourseName">{tournament.golfCourseName}</strong>
                        </span>
                        <span className="tournamentSearchMidline">
                          <span><strong>Date:</strong> {formatDate(tournament.tournamentDate)}</span>
                          <span><strong>Location:</strong> {formatSearchResultLocation(tournament)}</span>
                          {displayPhone ? <span><strong>Phone:</strong> {displayPhone}</span> : null}
                          <span><strong>Website:</strong> {websiteLabel}</span>
                        </span>
                        <span className="tournamentSearchTournamentName">
                          {tournament.tournamentName || 'Golf tournament'}
                          {isGolfHomiezTournament && tournament.isRegistered ? <span className="tournamentSearchRegistrationStatus">Registered</span> : null}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {pagination.totalPages > 1 ? (
                <nav className="tournamentSearchPagination" aria-label="Tournament search result pages">
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
