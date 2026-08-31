import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import bannerImg from '../assets/GolfHomiezEmblem.png'
import { logFrontendEvent } from '../lib/frontend-logger'
import { DEFAULT_HOME_MARKETING_SETTINGS, fetchHomeMarketingSettings, toYouTubeEmbedUrl, type HomeMarketingSettings } from '../lib/marketing'

function HomeVideoSection({ title, url, logKey, pagePath }: { title: string; url: string; logKey: string; pagePath: string }) {
  const embedUrl = toYouTubeEmbedUrl(url)

  return (
    <section className="homeVideoSection card" aria-labelledby={`${logKey}-title`}>
      <div className="homeSectionHeader">
        <div>
          <div className="homeSectionKicker">Watch &amp; learn</div>
          <h2 id={`${logKey}-title`}>
          <Link
            className="homeVideoSectionTitleLink"
            to={pagePath}
            onClick={() => logFrontendEvent({ category: 'home.marketing', message: 'marketing_video_library_opened', data: { video: logKey, destination: pagePath } })}
          >
            {title}
          </Link>
          </h2>
        </div>
        <Link
          className="homeVideoBrowseLink"
          to={pagePath}
          onClick={() => logFrontendEvent({ category: 'home.marketing', message: 'marketing_video_library_browse_selected', data: { video: logKey, destination: pagePath } })}
        >
          Browse videos <span aria-hidden="true">→</span>
        </Link>
      </div>
      {embedUrl ? (
        <div className="homeVideoFrameWrap">
          <iframe
            className="homeVideoFrame"
            src={embedUrl}
            title={`${title} video`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            onLoad={() => logFrontendEvent({ category: 'home.marketing', message: 'marketing_video_loaded', data: { video: logKey, url } })}
          />
        </div>
      ) : (
        <div className="small homeVideoUnavailable">This video is temporarily unavailable.</div>
      )}
    </section>
  )
}

export default function Home() {
  const [marketingSettings, setMarketingSettings] = useState<HomeMarketingSettings>(DEFAULT_HOME_MARKETING_SETTINGS)

  useEffect(() => {
    let active = true
    logFrontendEvent({ category: 'home.marketing', message: 'home_marketing_settings_load_started' })
    void fetchHomeMarketingSettings()
      .then((settings) => {
        if (!active) return
        setMarketingSettings(settings)
        logFrontendEvent({
          category: 'home.marketing',
          message: 'home_marketing_settings_loaded',
          data: { updatedAt: settings.updatedAt || null },
        })
      })
      .catch((marketingError) => {
        if (!active) return
        setMarketingSettings(DEFAULT_HOME_MARKETING_SETTINGS)
        logFrontendEvent({
          category: 'home.marketing',
          level: 'error',
          message: 'home_marketing_settings_load_failed_using_defaults',
          data: { error: marketingError instanceof Error ? marketingError.message : String(marketingError) },
        })
      })

    return () => { active = false }
  }, [])

  return (
    <div className="container homeDashboard">
      <section className="bannerCard homeMissionBanner" aria-labelledby="golfhomiez-mission-title">
        <div className="homeMissionContent">
          <div className="homeMissionEyebrow">GolfHomiez Mission</div>
          <h1 id="golfhomiez-mission-title">Built by golfers, for golfers.</h1>
          <p>GolfHomiez makes golf simple, social, and fun. Log solo rounds or team challenges with your homiez, then create, register for, and follow seamless golf-course tournaments through dedicated GolfHomiez course pages that showcase every hosted event.</p>
          <div className="homeMissionActions" aria-label="Get started with GolfHomiez">
            <Link className="btn homeMissionPrimaryAction" to="/register" onClick={() => logFrontendEvent({ category: 'home.hero', message: 'create_account_selected', data: { destination: '/register' } })}>Join GolfHomiez</Link>
            <Link className="btn homeMissionSecondaryAction" to="/login" onClick={() => logFrontendEvent({ category: 'home.hero', message: 'sign_in_selected', data: { destination: '/login' } })}>Sign in</Link>
          </div>
          <ul className="homeBenefitList" aria-label="GolfHomiez highlights">
            <li>Track rounds</li>
            <li>Challenge friends</li>
            <li>Play tournaments</li>
          </ul>
        </div>
        <div className="homeMissionEmblemWrap" aria-hidden="true">
          <img
            className="homeMissionEmblem"
            src={bannerImg}
            alt=""
            onLoad={() => logFrontendEvent({ category: 'home.banner', message: 'app_banner_emblem_loaded' })}
            onError={() => logFrontendEvent({ category: 'home.banner', level: 'error', message: 'app_banner_emblem_load_failed' })}
          />
        </div>
      </section>

      <div className="homeCommercialStack" aria-label="GolfHomiez videos">
        <HomeVideoSection title="Golf Homiez" url={marketingSettings.golfHomiezVideoUrl} logKey="golf-homiez" pagePath="/golfhomiezvideos" />
        <HomeVideoSection title="Golf Homiez Courses" url={marketingSettings.golfHomiezCoursesVideoUrl} logKey="golf-homiez-courses" pagePath="/golfhomiezcoursevideos" />
      </div>
    </div>
  )
}
