import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { logFrontendEvent } from '../lib/frontend-logger'
import {
  fetchMarketingVideoSections,
  MARKETING_VIDEO_AUDIENCES,
  toYouTubeEmbedUrl,
  type MarketingVideoAudience,
  type MarketingVideoSection,
} from '../lib/marketing'

type MarketingVideoLibraryProps = {
  audience: MarketingVideoAudience
  title: string
  description: string
}

function VideoSectionCard({ section }: { section: MarketingVideoSection }) {
  const embedUrl = toYouTubeEmbedUrl(section.youtubeUrl)
  const isShort = /youtube\.com\/shorts\//i.test(section.youtubeUrl)

  return (
    <section id={section.sectionSlug} className="card marketingVideoLibrarySection" aria-labelledby={`${section.sectionSlug}-title`}>
      <div className="marketingVideoLibrarySectionHeader">
        <h2 id={`${section.sectionSlug}-title`}>{section.name}</h2>
        <Link
          className="marketingVideoHelperLink"
          to={section.relativeLink}
          aria-label={`Direct link to ${section.name}`}
          onClick={() => logFrontendEvent({
            category: 'marketing.videos',
            message: 'helper_video_direct_link_clicked',
            data: { sectionId: section.id, sectionName: section.name, relativeLink: section.relativeLink },
          })}
        >
          Direct link
        </Link>
      </div>
      {embedUrl ? (
        <div className={`marketingVideoLibraryFrameWrap${isShort ? ' marketingVideoLibraryFrameWrap--short' : ''}`}>
          <iframe
            className="marketingVideoLibraryFrame"
            src={embedUrl}
            title={`${section.name} video`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            onLoad={() => logFrontendEvent({
              category: 'marketing.videos',
              message: 'helper_video_loaded',
              data: { sectionId: section.id, sectionName: section.name, audience: section.audience },
            })}
          />
        </div>
      ) : (
        <div className="small homeVideoUnavailable">This video is temporarily unavailable.</div>
      )}
    </section>
  )
}

function MarketingVideoLibrary({ audience, title, description }: MarketingVideoLibraryProps) {
  const [sections, setSections] = useState<MarketingVideoSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const location = useLocation()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    logFrontendEvent({ category: 'marketing.videos', message: 'helper_video_page_load_started', data: { audience, route: location.pathname } })
    void fetchMarketingVideoSections(audience)
      .then((loadedSections) => {
        if (!active) return
        setSections(loadedSections)
        logFrontendEvent({
          category: 'marketing.videos',
          message: 'helper_video_page_loaded',
          data: { audience, route: location.pathname, sectionCount: loadedSections.length },
        })
      })
      .catch((loadError) => {
        if (!active) return
        const message = loadError instanceof Error ? loadError.message : 'Could not load videos.'
        setError(message)
        logFrontendEvent({
          category: 'marketing.videos',
          level: 'error',
          message: 'helper_video_page_load_failed',
          data: { audience, route: location.pathname, error: message },
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [audience, location.pathname])

  useEffect(() => {
    if (!sections.length || !location.hash) return
    const targetId = decodeURIComponent(location.hash.replace(/^#/, ''))
    const target = document.getElementById(targetId)
    if (!target) return

    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      logFrontendEvent({
        category: 'marketing.videos',
        message: 'helper_video_deep_link_opened',
        data: { audience, route: location.pathname, sectionSlug: targetId },
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [audience, location.hash, location.pathname, sections])

  return (
    <main className="container marketingVideoLibraryPage">
      <header className="card marketingVideoLibraryHero">
        <div>
          <div className="homeMissionEyebrow">GolfHomiez Videos</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Link className="btn" to="/">Back to home</Link>
      </header>

      {loading ? <section className="card marketingVideoLibraryStatus">Loading videos…</section> : null}
      {error ? <section className="card marketingVideoLibraryStatus marketingVideoLibraryStatus--error" role="alert">{error}</section> : null}
      {!loading && !error && sections.length === 0 ? (
        <section className="card marketingVideoLibraryStatus">No videos are available yet.</section>
      ) : null}

      <div className="marketingVideoLibraryStack">
        {sections.map((section) => <VideoSectionCard key={section.id} section={section} />)}
      </div>
    </main>
  )
}

export function GolfHomiezVideos() {
  return (
    <MarketingVideoLibrary
      audience={MARKETING_VIDEO_AUDIENCES.golfHomiez}
      title="Golf Homiez Videos"
      description="Quick videos to help golfers create an account, build teams, register for tournaments, create challenges, and log rounds."
    />
  )
}

export function GolfHomiezCourseVideos() {
  return (
    <MarketingVideoLibrary
      audience={MARKETING_VIDEO_AUDIENCES.golfHomiezCourses}
      title="Golf Homiez Course Videos"
      description="Quick videos to help golf courses manage their GolfHomiez website, tournaments, and GolfHomiez course account."
    />
  )
}
