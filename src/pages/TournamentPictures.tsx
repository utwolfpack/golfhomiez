import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { fetchPublicTournamentPictures, type UserImageRecord } from '../lib/user-images'
import { formatFriendlyDate } from '../lib/time-format'
import { logFrontendEvent } from '../lib/frontend-logger'
import golfHomiezEmblem from '../assets/GolfHomiezEmblem.png'

const AUTO_ADVANCE_MS = 7000
const INACTIVITY_RESUME_MS = 15000

export default function TournamentPictures() {
  const { id = '' } = useParams()
  const [images, setImages] = useState<UserImageRecord[]>([])
  const [tournament, setTournament] = useState<{ id: string; name: string; startDate?: string | null } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [carouselPaused, setCarouselPaused] = useState(false)
  const resumeTimerRef = useRef<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchPublicTournamentPictures(id)
      .then((response) => {
        if (cancelled) return
        setTournament(response.tournament)
        setImages(response.images || [])
        logFrontendEvent({ category: 'tournament.pictures', message: 'tournament_pictures_page_loaded', data: { tournamentId: response.tournament.id, imageCount: response.images?.length || 0 } })
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load tournament pictures.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (images.length < 2 || carouselPaused) return
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % images.length)
      logFrontendEvent({ category: 'tournament.pictures.carousel', message: 'tournament_picture_carousel_advanced', data: { tournamentId: tournament?.id || id, imageCount: images.length, source: 'automatic', intervalMs: AUTO_ADVANCE_MS } })
    }, AUTO_ADVANCE_MS)
    return () => window.clearInterval(interval)
  }, [carouselPaused, id, images.length, tournament?.id])

  useEffect(() => () => {
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current)
  }, [])

  function scheduleCarouselResume(source: 'previous' | 'next' | 'thumbnail' | 'pause') {
    setCarouselPaused(true)
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null
      setCarouselPaused(false)
      setActiveIndex((current) => images.length > 1 ? (current + 1) % images.length : current)
      logFrontendEvent({ category: 'tournament.pictures.carousel', message: 'tournament_picture_carousel_resumed_after_inactivity', data: { tournamentId: tournament?.id || id, imageCount: images.length, inactivityMs: INACTIVITY_RESUME_MS, source } })
    }, INACTIVITY_RESUME_MS)
  }

  function resumeCarouselNow() {
    if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = null
    setCarouselPaused(false)
    logFrontendEvent({ category: 'tournament.pictures.carousel', message: 'tournament_picture_carousel_resumed_by_user', data: { tournamentId: tournament?.id || id, imageCount: images.length } })
  }

  function moveToPicture(nextIndex: number, source: 'previous' | 'next' | 'thumbnail') {
    if (!images.length) return
    const normalized = (nextIndex + images.length) % images.length
    setActiveIndex(normalized)
    scheduleCarouselResume(source)
    logFrontendEvent({ category: 'tournament.pictures.carousel', message: 'tournament_picture_selected_by_user', data: { tournamentId: tournament?.id || id, imageCount: images.length, imageIndex: normalized, source } })
  }

  const activeImage = images.length ? images[Math.min(activeIndex, images.length - 1)] : null

  return (
    <div className="container leaderboardPage tournamentPicturesPage">
      <section className="card leaderboardPanel tournamentPicturesPanel">
      <header className="leaderboardHeader tournamentPicturesHero">
        <div>
          <div className="leaderboardEyebrow">Golf Homiez Tournament Pictures</div>
          <h1>{tournament?.name || 'Tournament'}</h1>
          {tournament?.startDate ? <div className="leaderboardMeta"><span><strong>Date:</strong> {formatFriendlyDate(tournament.startDate)}</span></div> : null}
        </div>
        <div className="leaderboardRefreshStatus tournamentPicturesHeaderActions">
          <img className="leaderboardBrandIcon" src={golfHomiezEmblem} alt="Golf Homiez" />
          <Link className="btn" to={`/tournaments/${encodeURIComponent(id)}`}>Tournament</Link>
        </div>
      </header>

      {loading ? <div className="card">Loading tournament pictures…</div> : null}
      {error ? <div className="card errorBox" role="alert">{error}</div> : null}
      {!loading && !error && !activeImage ? <div className="card">This tournament does not have pictures yet.</div> : null}

      {activeImage ? (
        <section className="tournamentPictureViewer" aria-label="Tournament picture viewer">
          <img key={activeImage.id} className="tournamentPictureViewerImage" src={activeImage.url} alt={`${tournament?.name || 'Tournament'} picture ${activeIndex + 1} of ${images.length}`} />
          <div className="tournamentPictureViewerControls">
            <button className="btn" type="button" disabled={images.length < 2} onClick={() => moveToPicture(activeIndex - 1, 'previous')}>Previous</button>
            {images.length > 1 ? (
              <button className="btn" type="button" onClick={() => carouselPaused ? resumeCarouselNow() : scheduleCarouselResume('pause')}>{carouselPaused ? 'Resume' : 'Pause'}</button>
            ) : null}
            <strong>{activeIndex + 1} of {images.length}</strong>
            <button className="btn" type="button" disabled={images.length < 2} onClick={() => moveToPicture(activeIndex + 1, 'next')}>Next</button>
          </div>
          {images.length > 1 ? (
            <div className="pictureThumbnailGrid">
              {images.map((image, index) => (
                <button key={image.id} type="button" className={`pictureThumbnail${index === activeIndex ? ' pictureThumbnail--active' : ''}`} onClick={() => moveToPicture(index, 'thumbnail')}>
                  <img src={image.url} alt={`Open tournament picture ${index + 1}`} />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      </section>
    </div>
  )
}
