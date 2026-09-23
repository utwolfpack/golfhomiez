import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import bannerImg from '../assets/GolfHomiezEmblem.png'
import { logFrontendEvent } from '../lib/frontend-logger'
import { DEFAULT_HOME_MARKETING_SETTINGS, fetchHomeMarketingSettings, toYouTubeEmbedUrl, type HomeMarketingSettings } from '../lib/marketing'
import { useAuth } from '../context/AuthContext'


type SocialPlatform = 'facebook' | 'instagram' | 'youtube'

const GOLFHOMIEZ_SOCIAL_LINKS: Array<{ platform: SocialPlatform; label: string; href: string }> = [
  { platform: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/people/Golf-Homiez/61593610114459/' },
  { platform: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/golfhomiez/' },
  { platform: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@GolfHomiez' },
]

function SocialPlatformIcon({ platform }: { platform: SocialPlatform }) {
  if (platform === 'facebook') {
    return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.1 8.2V6.5c0-.9.6-1.1 1.2-1.1h1.9V2.2h-2.8c-3.1 0-4.8 1.8-4.8 5v1H7v3.6h2.6V22h4.1V11.8h3l.5-3.6h-3.1Z" /></svg>
  }
  if (platform === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="17.5" cy="6.5" r="1.1" />
      </svg>
    )
  }
  if (platform === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="2.5" y="5.2" width="19" height="13.6" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m10 9 5 3-5 3V9Z" />
      </svg>
    )
  }
  return null
}

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
  const { user, loading: authLoading } = useAuth()
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
          {!authLoading && !user ? (
            <div className="homeMissionActions" aria-label="Get started with GolfHomiez">
              <Link className="btn homeMissionPrimaryAction" to="/register" onClick={() => logFrontendEvent({ category: 'home.hero', message: 'create_account_selected', data: { destination: '/register' } })}>Join GolfHomiez</Link>
              <Link className="btn homeMissionSecondaryAction" to="/login" onClick={() => logFrontendEvent({ category: 'home.hero', message: 'sign_in_selected', data: { destination: '/login' } })}>Sign in</Link>
            </div>
          ) : null}
          <ul className="homeBenefitList" aria-label="GolfHomiez highlights">
            <li>Track rounds</li>
            <li>Challenge friends</li>
            <li>Play tournaments</li>
          </ul>
        </div>
        <div className="homeMissionAside">
          <div className="homeMissionEmblemWrap" aria-hidden="true">
            <img
              className="homeMissionEmblem"
              src={bannerImg}
              alt=""
              onLoad={() => logFrontendEvent({ category: 'home.banner', message: 'app_banner_emblem_loaded' })}
              onError={() => logFrontendEvent({ category: 'home.banner', level: 'error', message: 'app_banner_emblem_load_failed' })}
            />
          </div>
          <nav className="homeMissionSocial" aria-label="Follow GolfHomiez">
            {GOLFHOMIEZ_SOCIAL_LINKS.map((social) => (
              <a
                key={social.platform}
                className={`homeMissionSocialLink homeMissionSocialLink--${social.platform}`}
                href={social.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`GolfHomiez on ${social.label}`}
                title={social.label}
                onClick={() => logFrontendEvent({ category: 'home.social', message: 'social_link_selected', data: { platform: social.platform, destination: social.href } })}
              >
                <SocialPlatformIcon platform={social.platform} />
                <span className="visuallyHidden">{social.label}</span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      <div className="homeCommercialStack" aria-label="GolfHomiez videos">
        <HomeVideoSection title="Golf Homiez" url={marketingSettings.golfHomiezVideoUrl} logKey="golf-homiez" pagePath="/golfhomiezvideos" />
        <HomeVideoSection title="Golf Homiez Courses" url={marketingSettings.golfHomiezCoursesVideoUrl} logKey="golf-homiez-courses" pagePath="/golfhomiezcoursevideos" />
      </div>
    </div>
  )
}
