import { Fragment, useEffect, useMemo, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { fetchMyTeams, fetchTournamentPortal, registerForTournament, type TournamentFinalLeaderboardRow, type TournamentPortal as TournamentPortalData, type TournamentStartAssignment } from '../lib/accounts'
import type { Team } from '../types'
import { formatFriendlyDate } from '../lib/time-format'
import { DEFAULT_TOURNAMENT_BANNER_URL, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL, DEFAULT_TOURNAMENT_CHARITY_MESSAGE, getTournamentTemplate, emptyTournamentTemplateData, getTournamentTeamSize, type TournamentTemplateData, type TournamentAttributeIconKey } from '../lib/tournament-templates'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { getTournamentQrCodeUrl } from '../lib/tournament-qr'
import golfHomiezEmblemUrl from '../assets/GolfHomiezEmblem.png'
import HoleStrokeScore from '../components/HoleStrokeScore'

function lines(value?: string | null) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function applyFallbackImage(event: SyntheticEvent<HTMLImageElement>, fallbackUrl: string) {
  const image = event.currentTarget
  if (!fallbackUrl || image.dataset.fallbackApplied === 'true' || image.src.endsWith(fallbackUrl)) return
  image.dataset.fallbackApplied = 'true'
  image.src = fallbackUrl
}

function TournamentAttributeIcon({ iconKey, size = 34, contained = false }: { iconKey: TournamentAttributeIconKey; size?: number; contained?: boolean }) {
  const icon = (() => {
    switch (iconKey) {
      case 'date':
        return <><rect x="5" y="7" width="14" height="12" rx="2" /><path d="M8 4v5M16 4v5M5 11h14" /></>
      case 'checkInTime':
      case 'teeTime':
        return <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>
      case 'course':
        return <><path d="M7 20V5" /><path d="M7 5h9l-2 3 2 3H7" /><path d="M4 20h8" /></>
      case 'location':
        return <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>
      case 'format':
        return <><path d="M7 5h10v3a5 5 0 0 1-10 0V5Z" /><path d="M9 15h6M12 13v5M8 20h8" /><path d="M7 7H4v1a4 4 0 0 0 4 4M17 7h3v1a4 4 0 0 1-4 4" /></>
      case 'registrationFee':
        return <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.8-1.7-1.2-3-1.2-1.7 0-3 .9-3 2.2 0 3.4 6 1.6 6 5 0 1.4-1.3 2.3-3.2 2.3-1.4 0-2.6-.5-3.4-1.4M12 5.5v13" /></>
      default:
        return <circle cx="12" cy="12" r="8" />
    }
  })()

  return (
    <span className={`tournament-attribute-icon${contained ? ' tournament-attribute-icon--contained' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" focusable="false">{icon}</svg>
    </span>
  )
}

function FlyerList({ title, items, iconKey, accent = '#0f3f24' }: { title: string; items: string[]; iconKey?: TournamentAttributeIconKey; accent?: string }) {
  return (
    <div className="tournament-flyer-info-panel" style={{ minWidth: 0, padding: 12, border: '1px solid #b7d7ad', borderRadius: 14, background: '#f7fbf5', color: '#1f2937' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {iconKey ? <span style={{ color: accent }}><TournamentAttributeIcon iconKey={iconKey} size={34} contained /></span> : null}
        <h3 style={{ color: accent, margin: 0, fontSize: 16, textTransform: 'uppercase' }}>{title}</h3>
      </div>
      {items.length ? <ul style={{ marginTop: 0 }}>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="small">Details coming soon.</p>}
    </div>
  )
}

const ATTRIBUTE_ROWS: Array<{ key: TournamentAttributeIconKey; label: string; value: (tournament: NonNullable<TournamentPortalData['tournament']>, templateData: TournamentTemplateData) => string }> = [
  { key: 'date', label: 'Date', value: (tournament) => tournament.startDate ? formatFriendlyDate(tournament.startDate || '') : 'To be announced' },
  { key: 'checkInTime', label: 'Check-in time', value: (_tournament, templateData) => templateData.checkInTime || 'To be announced' },
  { key: 'teeTime', label: 'Tee time', value: (_tournament, templateData) => templateData.teeTime || 'To be announced' },
  { key: 'course', label: 'Course / Venue', value: (tournament) => tournament.hostGolfCourseName || 'To be announced' },
  { key: 'location', label: 'Location', value: (tournament, templateData) => templateData.locationAddress || tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || 'To be announced' },
  { key: 'format', label: 'Players / team', value: (_tournament, templateData) => `${getTournamentTeamSize(templateData)} players` },
  { key: 'registrationFee', label: 'Registration Fee', value: (_tournament, templateData) => templateData.entryFee || 'To be announced' },
]

function ClassicTournamentFlyer({ tournament, templateData, attributeIcons, accentColor }: { tournament: NonNullable<TournamentPortalData['tournament']>; templateData: TournamentTemplateData; attributeIcons: Record<TournamentAttributeIconKey, string>; accentColor: string }) {
  const title = tournament.name
  const host = templateData.hostOrganization || tournament.hostGolfCourseName || tournament.organizerName || 'Host organization'
  const logos = Array.isArray(templateData.logoFiles) ? templateData.logoFiles.slice(0, 18) : []
  const feeValue = templateData.entryFee ? (String(templateData.entryFee).trim().startsWith('$') ? templateData.entryFee : `$${templateData.entryFee}`) : 'To be announced'
  const rows = ATTRIBUTE_ROWS.map((row) => ({ ...row, displayValue: row.key === 'registrationFee' ? feeValue : row.value(tournament, templateData) }))
  const backgroundImageUrl = tournament.templateBackgroundImageUrl || DEFAULT_TOURNAMENT_BANNER_URL
  const isDefaultBackground = !tournament.templateBackgroundImageUrl
  const description = String(tournament.description || '').trim()
  const flyerPageUrl = tournament.portalUrl || (typeof window !== 'undefined' ? window.location.href : tournament.portalPath || '')
  const charityImageUrl = templateData.supportingPhotoUrl || DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL
  const charityMessage = templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE
  const isDefaultCharityImage = !templateData.supportingPhotoUrl
  const qrCodeUrl = getTournamentQrCodeUrl(tournament.tournamentIdentifier || tournament.id)
  const qrCorrelationId = getCorrelationId()
  const bannerCorrelationId = getCorrelationId()
  const charityCorrelationId = getCorrelationId()

  return (
    <section className="card tournament-flyer" aria-label="Tournament flyer" style={{ position: 'relative', overflow: 'hidden', padding: 0, border: '1px solid #b7d7ad', background: '#fff' }}>
      {isDefaultBackground ? (
        <img
          className="tournament-flyer-top-right-emblem"
          src={golfHomiezEmblemUrl}
          alt="Golf Homiez"
          loading="lazy"
          decoding="async"
          aria-label="Golf Homiez icon"
        />
      ) : null}
      <div className="tournament-flyer-print-content">
      <div className="tournament-flyer-header" style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px 18px', textAlign: 'center' }}>
        <div style={{ color: '#c6922e', fontSize: 36, lineHeight: 1 }}>♕</div>
        <div className="tournament-flyer-title" style={{ color: accentColor, fontSize: 'clamp(36px, 7vw, 74px)', lineHeight: .95, fontWeight: 900, letterSpacing: '.02em', textTransform: 'uppercase' }}>{title}</div>
        <div className="tournament-flyer-presented-by" style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'center', marginTop: 12, color: accentColor, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          <span style={{ flex: '0 1 170px', height: 2, background: '#c6922e' }} />
          <span className="tournament-flyer-presented-by-text">Presented by / {host}</span>
          <span style={{ flex: '0 1 170px', height: 2, background: '#c6922e' }} />
        </div>
        <div className="tournament-flyer-banner" aria-label="Tournament flyer background banner" style={{ position: 'relative', margin: '18px auto 0', width: '100%', maxWidth: 920, height: 204, borderRadius: 16, overflow: 'hidden', border: '1px solid #b7d7ad' }}>
          <img
            src={backgroundImageUrl}
            alt={isDefaultBackground ? 'Default Golf Homiez tournament flyer banner' : 'Tournament flyer banner'}
            loading="lazy"
            decoding="async"
            data-correlation-id={bannerCorrelationId}
            onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_banner_loaded', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultBackground, correlationId: bannerCorrelationId } })}
            onError={(event) => { applyFallbackImage(event, DEFAULT_TOURNAMENT_BANNER_URL); logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_banner_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultBackground, backgroundImageUrl, fallbackApplied: !isDefaultBackground, correlationId: bannerCorrelationId } }) }}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: isDefaultBackground ? 'center right' : 'center center', opacity: 0.82 }}
          />
        </div>
        {description ? <p style={{ maxWidth: 780, margin: '16px auto 0', color: '#374151', fontSize: 18, lineHeight: 1.45 }}>{description}</p> : null}
      </div>

      <div className="tournament-flyer-attributes" aria-label="Tournament flyer attribute rows" style={{ maxWidth: 920, margin: '0 auto', padding: '0 20px' }}>
        {rows.map((row) => (
          <div className="tournament-flyer-attribute-row" key={row.key} style={{ display: 'grid', gridTemplateColumns: '96px 28px minmax(145px, 260px) 1fr', alignItems: 'center', gap: 16, borderTop: '1px solid #b7d7ad', minHeight: 88, padding: '10px 0' }}>
            <span style={{ color: accentColor, justifySelf: 'center' }}><TournamentAttributeIcon iconKey={row.key} size={58} contained /></span>
            <div style={{ width: 2, alignSelf: 'stretch', background: '#b7d7ad' }} />
            <div style={{ color: accentColor, fontWeight: 900, fontSize: 20, textTransform: 'uppercase', lineHeight: 1.1 }}>{row.label}</div>
            <div className="tournament-flyer-attribute-value" style={{ color: '#111827', fontSize: 18, lineHeight: 1.25 }}>{row.displayValue}</div>
          </div>
        ))}
      </div>

      <div className="tournament-flyer-body" style={{ maxWidth: 920, margin: '0 auto', padding: '0 20px 24px' }}>
        <div className="grid grid3 tournament-flyer-summary-grid" style={{ gap: 20, borderTop: '1px solid #b7d7ad', paddingTop: 18 }}>
          <FlyerList title="What’s Included" items={lines(templateData.feesInclude)} accent={accentColor} />
          <FlyerList title="Prizes / Awards" items={lines(templateData.prizeDetails)} iconKey="format" accent={accentColor} />
          <FlyerList title="Contest Holes / Extras" items={lines(templateData.holeContestsExtras)} iconKey="location" accent={accentColor} />
        </div>
        {templateData.miscNotes ? <div className="card" style={{ marginTop: 18, padding: 12, background: '#f7fbf5', borderColor: '#b7d7ad' }}><strong style={{ color: accentColor }}>Tournament Information:</strong> {templateData.miscNotes}</div> : null}
        <div className="card tournament-flyer-beneficiary-section" style={{ marginTop: 20, padding: 18, background: '#f7fbf5', borderColor: '#b7d7ad' }}>
          <div className="tournament-flyer-beneficiary-layout" style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 18, alignItems: 'center' }}>
            <div className="tournament-flyer-beneficiary-image-frame" style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #b7d7ad', background: '#fff', minHeight: 170 }}>
              <img
                src={charityImageUrl}
                alt={isDefaultCharityImage ? 'Default Golf Homiez charity image' : 'Tournament beneficiary or charity image'}
                loading="lazy"
                decoding="async"
                data-correlation-id={charityCorrelationId}
                onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'charity_image_loaded', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultCharityImage, correlationId: charityCorrelationId } })}
                onError={(event) => { applyFallbackImage(event, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL); logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'charity_image_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultCharityImage, charityImageUrl, fallbackApplied: !isDefaultCharityImage, correlationId: charityCorrelationId } }) }}
                style={{ width: '100%', height: '100%', minHeight: 170, objectFit: 'cover', display: 'block' }}
              />
            </div>
            <div className="tournament-flyer-beneficiary-copy">
              <div style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: accentColor, fontWeight: 800 }}>Beneficiary / Charity</div>
              <div style={{ marginTop: 6, color: accentColor, fontWeight: 900, fontSize: 'clamp(24px, 4vw, 36px)', lineHeight: 1.05 }}>{templateData.beneficiaryCharity || 'Proceeds benefit'}</div>
              <p style={{ margin: '10px 0 0', color: '#374151', lineHeight: 1.45 }}>{charityMessage}</p>
            </div>
          </div>
        </div>
        {logos.length ? (
          <div className="tournament-flyer-sponsors-section" style={{ marginTop: 20 }}>
            <h3 style={{ textAlign: 'center', color: accentColor }}>{templateData.sponsorsAvailable ? 'SPONSORS — opportunities available' : 'SPONSORS'}</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
              {logos.map((logo, index) => <div key={`${logo.slice(0, 24)}-${index}`} className="tournament-flyer-sponsor-logo" style={{ padding: 8, background: 'transparent', border: 'none', boxShadow: 'none' }}><img src={logo} alt={`Sponsor logo ${index + 1}`} style={{ width: '100%', height: 60, objectFit: 'contain' }} onError={(event) => { const slot = event.currentTarget.closest('.tournament-flyer-sponsor-logo') as HTMLElement | null; if (slot) slot.style.display = 'none'; logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'tournament_sponsor_logo_load_failed', data: { tournamentId: tournament.id, templateKey: 'classic-flyer', sponsorIndex: index } }) }} /></div>)}
            </div>
          </div>
        ) : null}
        <div className="tournament-flyer-contact-register-grid" style={{ margin: '20px auto 0', maxWidth: 920, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 1fr)', gap: 16, alignItems: 'stretch' }}>
          <div className="card tournament-flyer-contact-card" style={{ padding: 18, background: '#f7fbf5', borderColor: '#b7d7ad' }}>
            <strong style={{ color: accentColor }}>Contact</strong>
            <div>{templateData.contactPerson || 'Contact person'}</div>
            <div>{templateData.contactPhone || 'Phone'}</div>
            <div>{templateData.contactEmail || 'Email'}</div>
          </div>
          <div className="tournament-flyer-register-card" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 190px', border: `2px solid ${accentColor}`, borderRadius: 10, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ background: accentColor, color: '#fff', padding: 16, fontWeight: 900, fontSize: 28, textTransform: 'uppercase' }}>
              Register Now
              <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'none', overflowWrap: 'anywhere' }}><a href={flyerPageUrl || undefined} style={{ color: '#fff', textDecoration: 'underline' }}>{flyerPageUrl}</a></div>
            </div>
            <div className="tournament-flyer-qr-code" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: accentColor, fontWeight: 800, padding: 12, background: '#fff' }}>
              {qrCodeUrl ? (
                <img
                  src={qrCodeUrl}
                  alt={`QR code for ${title} tournament page`}
                  width="156"
                  height="156"
                  loading="lazy"
                  decoding="async"
                  data-correlation-id={qrCorrelationId}
                  onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'qr_code_loaded', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, correlationId: qrCorrelationId } })}
                  onError={() => logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'qr_code_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, correlationId: qrCorrelationId } })}
                  style={{ width: 156, height: 156, display: 'block' }}
                />
              ) : <span>QR CODE</span>}
              <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', textAlign: 'center' }}>Scan to open tournament page</span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </section>
  )
}


type GuidedTournamentFlyerProps = {
  tournament: NonNullable<TournamentPortalData['tournament']>
  templateData: TournamentTemplateData
  attributeIcons: Record<TournamentAttributeIconKey, string>
  accentColor: string
  templateKey: string
}

function GuidedTournamentFlyer({ tournament, templateData, attributeIcons, accentColor, templateKey }: GuidedTournamentFlyerProps) {
  const title = tournament.name
  const host = templateData.hostOrganization || tournament.hostGolfCourseName || tournament.organizerName || 'Host organization'
  const backgroundImageUrl = tournament.templateBackgroundImageUrl || DEFAULT_TOURNAMENT_BANNER_URL
  const charityImageUrl = templateData.supportingPhotoUrl || DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL
  const description = String(tournament.description || '').trim()
  const charityMessage = templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE
  const feeValue = templateData.entryFee ? (String(templateData.entryFee).trim().startsWith('$') ? templateData.entryFee : `$${templateData.entryFee}`) : 'To be announced'
  const rows = ATTRIBUTE_ROWS.map((row) => ({ ...row, displayValue: row.key === 'registrationFee' ? feeValue : row.value(tournament, templateData) }))
  const flyerPageUrl = tournament.portalUrl || (typeof window !== 'undefined' ? window.location.href : tournament.portalPath || '')
  const qrCodeUrl = getTournamentQrCodeUrl(tournament.tournamentIdentifier || tournament.id)
  const logos = Array.isArray(templateData.logoFiles) ? templateData.logoFiles.slice(0, 18) : []
  const bannerCorrelationId = getCorrelationId()
  const charityCorrelationId = getCorrelationId()
  const qrCorrelationId = getCorrelationId()
  const slug = templateKey.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()

  return (
    <section
      className={`card tournament-flyer tournament-guided-flyer tournament-guided-flyer--${slug}`}
      aria-label="Tournament flyer"
      style={{ '--tournament-template-accent': accentColor } as CSSProperties}
    >
      <div className="tournament-guided-hero">
        <img
          className="tournament-guided-hero-image"
          src={backgroundImageUrl}
          alt="Tournament flyer banner"
          loading="lazy"
          decoding="async"
          data-correlation-id={bannerCorrelationId}
          onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_template_banner_loaded', data: { tournamentId: tournament.id, templateKey, correlationId: bannerCorrelationId } })}
          onError={(event) => { applyFallbackImage(event, DEFAULT_TOURNAMENT_BANNER_URL); logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_template_banner_load_failed', data: { tournamentId: tournament.id, templateKey, fallbackApplied: backgroundImageUrl !== DEFAULT_TOURNAMENT_BANNER_URL, correlationId: bannerCorrelationId } }) }}
        />
        <div className="tournament-guided-hero-shade" />
        <div className="tournament-guided-hero-copy">
          <div className="tournament-guided-kicker">Golf Homiez presents</div>
          <h1>{title}</h1>
          <div className="tournament-guided-host">{host}</div>
          {description ? <p>{description}</p> : null}
        </div>
      </div>

      <div className="tournament-guided-facts" aria-label="Tournament flyer event details">
        {rows.map((row) => (
          <div className={`tournament-guided-fact tournament-guided-fact--${row.key}`} key={row.key}>
            <TournamentAttributeIcon iconKey={row.key} size={34} />
            <div>
              <strong>{row.label}</strong>
              <span>{row.displayValue}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="tournament-guided-body">
        <section className="tournament-guided-charity">
          <div className="tournament-guided-charity-image-frame">
            <img
              src={charityImageUrl}
              alt="Tournament beneficiary or charity"
              loading="lazy"
              decoding="async"
              data-correlation-id={charityCorrelationId}
              onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_template_charity_image_loaded', data: { tournamentId: tournament.id, templateKey, correlationId: charityCorrelationId } })}
              onError={(event) => { applyFallbackImage(event, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL); logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_template_charity_image_load_failed', data: { tournamentId: tournament.id, templateKey, fallbackApplied: charityImageUrl !== DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL, correlationId: charityCorrelationId } }) }}
            />
          </div>
          <div className="tournament-guided-charity-copy">
            <div className="tournament-guided-section-label">Beneficiary / Charity</div>
            <h2>{templateData.beneficiaryCharity || 'Proceeds benefit'}</h2>
            <p>{charityMessage}</p>
            {templateData.miscNotes ? <p className="tournament-guided-notes"><strong>Tournament information:</strong> {templateData.miscNotes}</p> : null}
          </div>
        </section>

        <section className="tournament-guided-highlights">
          <FlyerList title="What’s Included" items={lines(templateData.feesInclude)} accent={accentColor} />
          <FlyerList title="Prizes / Awards" items={lines(templateData.prizeDetails)} iconKey="format" accent={accentColor} />
          <FlyerList title="Contest Holes / Extras" items={lines(templateData.holeContestsExtras)} iconKey="location" accent={accentColor} />
        </section>

        <section className="tournament-guided-footer">
          <div className="tournament-guided-contact">
            <div className="tournament-guided-section-label">Contact</div>
            {templateData.contactPerson ? <strong>{templateData.contactPerson}</strong> : null}
            {templateData.contactPhone ? <span>{templateData.contactPhone}</span> : null}
            {templateData.contactEmail ? <span>{templateData.contactEmail}</span> : null}
            {!templateData.contactPerson && !templateData.contactPhone && !templateData.contactEmail ? <span className="small">Contact information coming soon.</span> : null}
          </div>
          <div className="tournament-guided-register">
            <div>
              <div className="tournament-guided-register-title">Register Now</div>
              <a href={flyerPageUrl || undefined}>{flyerPageUrl}</a>
            </div>
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt={`QR code for ${title} tournament page`}
                width="138"
                height="138"
                loading="lazy"
                decoding="async"
                data-correlation-id={qrCorrelationId}
                onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_template_qr_code_loaded', data: { tournamentId: tournament.id, templateKey, correlationId: qrCorrelationId } })}
                onError={() => logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_template_qr_code_load_failed', data: { tournamentId: tournament.id, templateKey, correlationId: qrCorrelationId } })}
              />
            ) : null}
          </div>
        </section>

        {logos.length ? (
          <section className="tournament-guided-sponsors">
            <div className="tournament-guided-section-label">{templateData.sponsorsAvailable ? 'Sponsors — opportunities available' : 'Sponsors'}</div>
            <div className="tournament-guided-sponsor-grid">
              {logos.map((logo, index) => <img key={`${logo.slice(0, 24)}-${index}`} src={logo} alt={`Sponsor logo ${index + 1}`} onError={(event) => { event.currentTarget.style.display = 'none'; logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'tournament_sponsor_logo_load_failed', data: { tournamentId: tournament.id, templateKey, sponsorIndex: index } }) }} />)}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  )
}

function TournamentFlyer({ tournament, templateData, attributeIcons, accentColor, templateKey }: GuidedTournamentFlyerProps) {
  if (!templateKey || templateKey === 'classic-flyer') {
    return <ClassicTournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={accentColor} />
  }
  return <GuidedTournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={accentColor} templateKey={templateKey} />
}

function PrintableTournamentFlyer({ tournament, templateData, attributeIcons, accentColor, templateKey }: GuidedTournamentFlyerProps) {
  const title = tournament.name
  const host = templateData.hostOrganization || tournament.hostGolfCourseName || tournament.organizerName || 'Host organization'
  const feeValue = templateData.entryFee ? (String(templateData.entryFee).trim().startsWith('$') ? templateData.entryFee : `$${templateData.entryFee}`) : 'To be announced'
  const rows = ATTRIBUTE_ROWS.map((row) => ({ ...row, displayValue: row.key === 'registrationFee' ? feeValue : row.value(tournament, templateData) }))
  const backgroundImageUrl = tournament.templateBackgroundImageUrl || DEFAULT_TOURNAMENT_BANNER_URL
  const isDefaultBackground = !tournament.templateBackgroundImageUrl
  const description = String(tournament.description || '').trim()
  const flyerPageUrl = tournament.portalUrl || (typeof window !== 'undefined' ? window.location.href : tournament.portalPath || '')
  const charityMessage = templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE
  const qrCodeUrl = getTournamentQrCodeUrl(tournament.tournamentIdentifier || tournament.id)
  const logos = Array.isArray(templateData.logoFiles) ? templateData.logoFiles.slice(0, 10) : []

  return (
    <section className={`tournament-print-flyer tournament-print-flyer--${templateKey || 'classic-flyer'}`} aria-label="Printable tournament flyer">
      {isDefaultBackground ? <img className="tournament-print-emblem" src={golfHomiezEmblemUrl} alt="Golf Homiez" /> : null}
      <div className="tournament-print-header">
        <div className="tournament-print-eyebrow">Golf Homiez Tournament</div>
        <h1>{title}</h1>
        <div className="tournament-print-presented">Presented by / {host}</div>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="tournament-print-banner">
        <img src={backgroundImageUrl} alt={isDefaultBackground ? 'Default Golf Homiez tournament flyer banner' : 'Tournament flyer banner'} onError={(event) => applyFallbackImage(event, DEFAULT_TOURNAMENT_BANNER_URL)} />
      </div>
      <div className="tournament-print-detail-grid">
        {rows.map((row) => (
          <div className="tournament-print-detail" key={row.key}>
            <TournamentAttributeIcon iconKey={row.key} size={34} />
            <div>
              <strong>{row.label}</strong>
              <span>{row.displayValue}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="tournament-print-columns">
        <FlyerList title="What’s Included" items={lines(templateData.feesInclude)} accent={accentColor} />
        <FlyerList title="Prizes / Awards" items={lines(templateData.prizeDetails)} iconKey="format" accent={accentColor} />
        <FlyerList title="Contest Holes / Extras" items={lines(templateData.holeContestsExtras)} iconKey="location" accent={accentColor} />
      </div>
      <div className="tournament-print-footer-grid">
        <div className="tournament-print-beneficiary">
          <strong>Beneficiary / Charity</strong>
          <span>{templateData.beneficiaryCharity || 'Proceeds benefit'}</span>
          <p>{charityMessage}</p>
          {templateData.miscNotes ? <p><strong>Tournament Information:</strong> {templateData.miscNotes}</p> : null}
        </div>
        <div className="tournament-print-contact">
          <strong>Contact</strong>
          <span>{templateData.contactPerson || 'Contact person'}</span>
          <span>{templateData.contactPhone || 'Phone'}</span>
          <span>{templateData.contactEmail || 'Email'}</span>
        </div>
        <div className="tournament-print-register">
          <strong>Register Now</strong>
          {qrCodeUrl ? <img src={qrCodeUrl} alt={`QR code for ${title} tournament page`} /> : null}
          <span>{flyerPageUrl}</span>
        </div>
      </div>
      {logos.length ? (
        <div className="tournament-print-sponsors">
          <strong>{templateData.sponsorsAvailable ? 'Sponsors — opportunities available' : 'Sponsors'}</strong>
          <div>
            {logos.map((logo, index) => <img key={`${logo.slice(0, 24)}-${index}`} src={logo} alt={`Sponsor logo ${index + 1}`} onError={(event) => { event.currentTarget.style.display = 'none' }} />)}
          </div>
        </div>
      ) : null}
    </section>
  )
}


function readTeamSlotLimit(value: unknown, fallback = 24) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 9999)
}

function getTournamentCapacityStats(portal: TournamentPortalData | null) {
  const tournament = portal?.tournament
  const registeredTeamCount = portal?.registeredTeamCount ?? tournament?.registeredTeamCount ?? portal?.registrationCount ?? portal?.registrations?.length ?? tournament?.registrations?.length ?? 0
  const teamSlotLimit = readTeamSlotLimit(portal?.teamSlotLimit ?? tournament?.teamSlotLimit)
  return {
    registeredTeamCount,
    verifiedUserCount: portal?.verifiedUserCount ?? tournament?.verifiedUserCount ?? 0,
    teamSlotLimit,
    openTeamSlotCount: portal?.openTeamSlotCount ?? tournament?.openTeamSlotCount ?? Math.max(teamSlotLimit - registeredTeamCount, 0),
  }
}

function TournamentPublicSlotSummary({ portal }: { portal: TournamentPortalData }) {
  const stats = getTournamentCapacityStats(portal)
  return (
    <div className="tournament-public-slot-summary" aria-label="Tournament open team slots">
      <div className="card statCardCompact tournament-capacity-card"><div className="statCardLabel">Team slots open</div><div className="statCardValue">{stats.openTeamSlotCount}</div><div className="small">of {stats.teamSlotLimit} teams</div></div>
    </div>
  )
}

function formatTournamentStartTime(value?: string | null) {
  const raw = String(value || '').slice(0, 5)
  if (!/^\d{2}:\d{2}$/.test(raw)) return raw || 'Time to be announced'
  const [hours, minutes] = raw.split(':').map(Number)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 || 12
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`
}

function TournamentTeamStartSchedule({ assignments }: { assignments: TournamentStartAssignment[] }) {
  const rows = [...assignments].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
  if (!rows.length) return null
  const startType = rows[0]?.startType === 'tee-times' ? 'Tee times' : 'Shotgun start'
  return (
    <section className="tournament-public-start-schedule" aria-label="Assigned team start times">
      <div className="tournament-public-start-schedule-heading">
        <div>
          <div className="golfCoursePublicEyebrow">Team start assignments</div>
          <h3>{startType}</h3>
        </div>
        <div className="small">{rows.length} team{rows.length === 1 ? '' : 's'} scheduled</div>
      </div>
      <div className="tournament-public-start-schedule-list">
        {rows.map((assignment) => (
          <div className="tournament-public-start-schedule-row" key={assignment.teamKey}>
            <strong>{assignment.teamName}</strong>
            <span>{formatTournamentStartTime(assignment.startTime)}</span>
            <span>{assignment.startType === 'shotgun' ? `Hole ${assignment.startingHole || 'TBD'}` : `Tee ${assignment.startingHole || '1'}`}</span>
            {assignment.notes ? <span className="small">{assignment.notes}</span> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function TournamentFinalLeaderboard({ rows }: { rows: TournamentFinalLeaderboardRow[] }) {
  if (!rows.length) {
    return (
      <section className="tournament-final-leaderboard" aria-label="Final tournament leaderboard">
        <div className="tournament-final-leaderboard-heading">
          <div>
            <div className="golfCoursePublicEyebrow">Tournament results</div>
            <h2>Final Leaderboard</h2>
          </div>
        </div>
        <div className="small">No final team scores were recorded for this tournament.</div>
      </section>
    )
  }

  return (
    <section className="tournament-final-leaderboard" aria-label="Final tournament leaderboard">
      <div className="tournament-final-leaderboard-heading">
        <div>
          <div className="golfCoursePublicEyebrow">Tournament results</div>
          <h2>Final Leaderboard</h2>
        </div>
        <div className="tournament-final-leaderboard-status">Final</div>
      </div>
      <div className="tournament-final-leaderboard-table" role="table" aria-label="Final tournament team standings">
        <div className="tournament-final-leaderboard-row tournament-final-leaderboard-row--header" role="row">
          <span>Pos</span><span>Team</span><span>Round</span><span>Total</span><span>Status</span>
        </div>
        {rows.map((row) => (
          <Fragment key={row.teamKey}>
            <div className={`tournament-final-leaderboard-row ${row.position <= 3 ? `tournament-final-leaderboard-row--top${row.position}` : ''}`} role="row">
              <strong className="tournament-final-leaderboard-position">{row.position}</strong>
              <div className="tournament-final-leaderboard-team">
                <strong>{row.teamName}</strong>
                {row.teamMemberNames?.length ? <span className="tournament-final-leaderboard-team-members">{row.teamMemberNames.join(' · ')}</span> : null}
              </div>
              <span>{row.roundLabel || '—'}</span>
              <strong>{row.totalScore == null ? '—' : row.totalScore}</strong>
              <span className="small">{row.holesCompleted >= 18 ? 'Final' : row.holesCompleted > 0 ? `${row.holesCompleted} holes` : 'No score'}</span>
            </div>
            {row.holes?.length ? (
              <div className="tournament-final-leaderboard-hole-strip" role="row" aria-label={`${row.teamName} hole-by-hole final score`}>
                {row.holes.map((hole) => (
                  <span className="tournament-final-leaderboard-hole" key={`${row.teamKey}-${hole.hole}`}>
                    <small>H{hole.hole}</small>
                    <HoleStrokeScore score={hole.score ?? null} par={hole.par ?? null} compact />
                  </span>
                ))}
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
    </section>
  )
}

function CompletedTournamentSummary({ summary }: { summary?: string | null }) {
  const text = String(summary || '').trim()
  if (!text) return null
  return (
    <section className="tournament-completed-summary" aria-label="Tournament summary">
      <div className="golfCoursePublicEyebrow">Tournament recap</div>
      <h2>Tournament Summary</h2>
      <div className="tournament-completed-summary__text">{text}</div>
    </section>
  )
}

const TOURNAMENT_FLYER_PRINT_STYLES = `
@media screen {
  .tournament-print-flyer { display: none !important; }
}
@media print {
  @page { size: letter portrait; margin: 0.25in; }
  html,
  body,
  #root {
    width: 8.5in !important;
    height: 11in !important;
    min-width: 0 !important;
    max-width: none !important;
    overflow: hidden !important;
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    print-color-adjust: exact !important;
    -webkit-print-color-adjust: exact !important;
  }
  body * { visibility: hidden !important; }
  .tournament-print-flyer,
  .tournament-print-flyer * { visibility: visible !important; }
  .container.pageStack,
  .pageCardShell { display: contents !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; background: transparent !important; }
  .tournament-print-flyer ~ .formStack,
  .tournament-flyer,
  .no-print { display: none !important; }
  .tournament-print-flyer {
    display: grid !important;
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    gap: 0.09in;
    position: fixed !important;
    inset: 0 !important;
    width: 7.95in !important;
    height: 10.45in !important;
    margin: 0 auto !important;
    padding: 0.18in !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    background: #ffffff !important;
    border: 2px solid #b7d7ad !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    color: #111827 !important;
    font-family: Arial, Helvetica, sans-serif !important;
    break-after: avoid !important;
    page-break-after: avoid !important;
    page-break-inside: avoid !important;
  }
  .tournament-print-emblem {
    position: absolute !important;
    top: 0.14in !important;
    right: 0.16in !important;
    width: 0.72in !important;
    height: 0.72in !important;
    object-fit: contain !important;
    z-index: 2 !important;
  }
  .tournament-print-header { text-align: center !important; padding: 0 0.74in 0 0.12in !important; }
  .tournament-print-eyebrow { color: #c6922e !important; font-size: 10pt !important; font-weight: 800 !important; letter-spacing: .12em !important; text-transform: uppercase !important; }
  .tournament-print-header h1 { margin: 0.03in 0 !important; color: #0f3f24 !important; font-size: 34pt !important; line-height: .92 !important; font-weight: 900 !important; letter-spacing: .01em !important; text-transform: uppercase !important; }
  .tournament-print-presented { color: #0f3f24 !important; font-size: 10pt !important; font-weight: 800 !important; text-transform: uppercase !important; }
  .tournament-print-header p { margin: 0.04in auto 0 !important; max-width: 6.8in !important; font-size: 9pt !important; line-height: 1.18 !important; color: #374151 !important; }
  .tournament-print-banner { height: 1.05in !important; border: 1px solid #b7d7ad !important; overflow: hidden !important; border-radius: 0.08in !important; }
  .tournament-print-banner img { width: 100% !important; height: 100% !important; object-fit: cover !important; object-position: center right !important; display: block !important; }
  .tournament-print-detail-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 0.06in !important; }
  .tournament-print-detail { display: grid !important; grid-template-columns: 0.38in minmax(0, 1fr) !important; gap: 0.06in !important; align-items: center !important; padding: 0.05in 0.07in !important; border: 1px solid #b7d7ad !important; border-radius: 0.07in !important; background: #f7fbf5 !important; min-width: 0 !important; }
  .tournament-print-detail img { width: 0.32in !important; height: 0.32in !important; object-fit: contain !important; }
  .tournament-print-detail .tournament-attribute-icon { width: 0.32in !important; height: 0.32in !important; color: #0f3f24 !important; display: inline-flex !important; }
  .tournament-print-detail .tournament-attribute-icon svg { width: 82% !important; height: 82% !important; }
  .tournament-print-detail strong { display: block !important; color: #0f3f24 !important; font-size: 8.5pt !important; line-height: 1.05 !important; text-transform: uppercase !important; }
  .tournament-print-detail span { display: block !important; color: #111827 !important; font-size: 9pt !important; line-height: 1.12 !important; overflow-wrap: anywhere !important; }
  .tournament-print-columns { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 0.07in !important; }
  .tournament-print-columns .tournament-flyer-info-panel { padding: 0.07in !important; border-radius: 0.08in !important; min-height: 0 !important; background: #f7fbf5 !important; }
  .tournament-print-columns .tournament-flyer-info-panel h3 { font-size: 8.5pt !important; line-height: 1.05 !important; margin: 0 !important; }
  .tournament-print-columns .tournament-flyer-info-panel span { width: 0.25in !important; height: 0.25in !important; }
  .tournament-print-columns .tournament-flyer-info-panel span img { width: 0.16in !important; height: 0.16in !important; }
  .tournament-print-columns .tournament-flyer-info-panel .tournament-attribute-icon { width: 0.25in !important; height: 0.25in !important; display: inline-flex !important; }
  .tournament-print-columns .tournament-flyer-info-panel .tournament-attribute-icon svg { width: 74% !important; height: 74% !important; }
  .tournament-print-columns .tournament-flyer-info-panel ul { margin: 0 !important; padding-left: 0.15in !important; }
  .tournament-print-columns .tournament-flyer-info-panel li,
  .tournament-print-columns .tournament-flyer-info-panel p { font-size: 8pt !important; line-height: 1.12 !important; margin: 0 0 0.02in !important; }
  .tournament-print-footer-grid { display: grid !important; grid-template-columns: minmax(0, 1.55fr) minmax(0, .85fr) 1.15in !important; gap: 0.08in !important; min-height: 0 !important; }
  .tournament-print-beneficiary,
  .tournament-print-contact,
  .tournament-print-register { border: 1px solid #b7d7ad !important; border-radius: 0.08in !important; background: #f7fbf5 !important; padding: 0.08in !important; min-width: 0 !important; }
  .tournament-print-beneficiary strong,
  .tournament-print-contact strong,
  .tournament-print-register strong { display: block !important; color: #0f3f24 !important; font-size: 9pt !important; line-height: 1.08 !important; text-transform: uppercase !important; }
  .tournament-print-beneficiary span { display: block !important; color: #0f3f24 !important; font-size: 14pt !important; line-height: 1 !important; font-weight: 900 !important; }
  .tournament-print-beneficiary p,
  .tournament-print-contact span,
  .tournament-print-register span { display: block !important; margin: 0.03in 0 0 !important; font-size: 8pt !important; line-height: 1.12 !important; overflow-wrap: anywhere !important; }
  .tournament-print-register { text-align: center !important; }
  .tournament-print-register img { width: 0.88in !important; height: 0.88in !important; margin: 0.04in auto !important; display: block !important; }
  .tournament-print-sponsors { border-top: 1px solid #b7d7ad !important; padding-top: 0.04in !important; }
  .tournament-print-sponsors strong { display: block !important; color: #0f3f24 !important; font-size: 8.5pt !important; text-transform: uppercase !important; text-align: center !important; }
  .tournament-print-sponsors div { display: grid !important; grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 0.05in !important; align-items: center !important; min-height: 0.34in !important; }
  .tournament-print-sponsors img { max-width: 100% !important; max-height: 0.34in !important; object-fit: contain !important; margin: 0 auto !important; display: block !important; }
  .tournament-print-sponsors span { text-align: center !important; font-size: 8pt !important; color: #374151 !important; grid-column: 1 / -1 !important; }
  .tournament-print-flyer--fairway-poster { background: #f4f8e4 !important; border-color: #174b22 !important; }
  .tournament-print-flyer--fairway-poster .tournament-print-header { background: #174b22 !important; margin: -0.18in -0.18in 0 !important; padding: 0.16in 0.9in 0.14in !important; }
  .tournament-print-flyer--fairway-poster .tournament-print-header h1,
  .tournament-print-flyer--fairway-poster .tournament-print-presented { color: #fff !important; }
  .tournament-print-flyer--fairway-poster .tournament-print-eyebrow { color: #dbe93b !important; }
  .tournament-print-flyer--modern-open { background: #eff1d9 !important; border-color: #244b17 !important; }
  .tournament-print-flyer--modern-open .tournament-print-header { text-align: left !important; padding-right: 0.8in !important; }
  .tournament-print-flyer--modern-open .tournament-print-header h1 { color: #244b17 !important; }
  .tournament-print-flyer--modern-open .tournament-print-detail:nth-child(odd) { background: #dfe8ba !important; }
  .tournament-print-flyer--charity-tribute { background: #1f3d0f !important; border-color: #6f8f2d !important; color: #fff !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-header h1,
  .tournament-print-flyer--charity-tribute .tournament-print-presented { color: #fff !important; font-family: Georgia, 'Times New Roman', serif !important; text-transform: none !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-eyebrow { color: #d8de63 !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-header p { color: #eef4df !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-detail,
  .tournament-print-flyer--charity-tribute .tournament-print-beneficiary,
  .tournament-print-flyer--charity-tribute .tournament-print-contact,
  .tournament-print-flyer--charity-tribute .tournament-print-register { background: #f4f6e8 !important; }
  .tournament-print-flyer--sunset-drive { background: #f5f0dc !important; border-color: #41520d !important; }
  .tournament-print-flyer--sunset-drive .tournament-print-banner { height: 1.45in !important; }
  .tournament-print-flyer--sunset-drive .tournament-print-header h1 { color: #41520d !important; font-size: 38pt !important; }
}
`

export default function TournamentPortal() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading, roles } = useAuth()
  const [portal, setPortal] = useState<TournamentPortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamMode, setTeamMode] = useState<'existing' | 'new'>('existing')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamMembers, setNewTeamMembers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const requiredTeamSize = getTournamentTeamSize(portal?.tournament?.templateData)
  const requiredTeammateCount = Math.max(1, requiredTeamSize - 1)
  const eligibleTeams = useMemo(() => teams.filter((team) => (team.members?.length || 0) === requiredTeamSize), [teams, requiredTeamSize])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchTournamentPortal(id)
        if (!active) return
        setPortal(result)
        setRegistered(Boolean(result.isViewerRegistered))
        const completed = String(result.tournament?.status || '').toLowerCase() === 'completed'
        logFrontendEvent({ category: 'tournament.portal', message: 'portal_loaded', data: { tournamentId: id, tournamentStatus: result.tournament?.status || null, teamSlotLimit: result.teamSlotLimit, openTeamSlotCount: result.openTeamSlotCount, isViewerRegistered: Boolean(result.isViewerRegistered), finalLeaderboardTeamCount: completed ? Number(result.finalLeaderboard?.length || 0) : 0, templateKey: result.tournament?.templateKey || 'classic-flyer' } })
        if (completed) {
          logFrontendEvent({ category: 'tournament.portal', message: 'completed_tournament_final_leaderboard_render_ready', data: { tournamentId: id, teamCount: Number(result.finalLeaderboard?.length || 0), holeScoreDisplayFormat: 'golf_score_symbols_v1' } })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load tournament portal.'
        if (active) setError(message)
        logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'portal_load_failed', data: { tournamentId: id, error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [id])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const result = await fetchMyTeams()
        if (!active) return
        setTeams(result)
        logFrontendEvent({ category: 'tournament.portal', message: 'team_options_loaded', data: { tournamentId: id, teamCount: result.length } })
      } catch (err) {
        logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'team_options_load_failed', data: { tournamentId: id, error: err instanceof Error ? err.message : String(err) } })
      }
    })()
    return () => { active = false }
  }, [id, user])

  useEffect(() => {
    setSelectedTeamId((current) => eligibleTeams.some((team) => team.id === current) ? current : (eligibleTeams[0]?.id || ''))
  }, [eligibleTeams])

  useEffect(() => {
    setNewTeamMembers((current) => Array.from({ length: requiredTeammateCount }, (_, index) => (
      current[index] || { id: crypto.randomUUID(), name: '', email: '' }
    )))
    logFrontendEvent({ category: 'tournament.portal', message: 'registration_team_size_applied', data: { tournamentId: id, requiredTeamSize, requiredTeammateCount } })
  }, [id, requiredTeamSize, requiredTeammateCount])

  const registrationClosed = useMemo(() => {
    const status = portal?.tournament.status
    return status === 'cancelled' || status === 'completed'
  }, [portal?.tournament.status])

  const slotsFull = useMemo(() => getTournamentCapacityStats(portal).openTeamSlotCount <= 0, [portal])
  const registrationTeamReady = teamMode === 'existing'
    ? Boolean(selectedTeamId && eligibleTeams.some((team) => team.id === selectedTeamId))
    : Boolean(newTeamName.trim() && newTeamMembers.length === requiredTeammateCount && newTeamMembers.every((member) => member.name.trim() && member.email.trim()))

  async function onRegister() {
    if (!id) return
    if (!user && !authLoading) {
      const returnTo = `/tournaments/${encodeURIComponent(id)}`
      logFrontendEvent({ category: 'tournament.portal', message: 'registration_requires_account', data: { tournamentId: id, returnTo } })
      navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`)
      return
    }

    if (!registrationTeamReady) {
      const message = teamMode === 'existing'
        ? `Select one of your ${requiredTeamSize}-player teams.`
        : `Enter a team name and exactly ${requiredTeammateCount} teammate${requiredTeammateCount === 1 ? '' : 's'} so the team has ${requiredTeamSize} players including you.`
      setError(message)
      logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'registration_team_size_validation_failed', data: { tournamentId: id, requiredTeamSize, teamMode, selectedTeamId: selectedTeamId || null, teammateCount: newTeamMembers.length } })
      return
    }

    setRegistering(true)
    setError(null)
    try {
      const payload = teamMode === 'existing'
        ? { teamId: selectedTeamId }
        : { teamName: newTeamName, teamMembers: newTeamMembers }
      const result = await registerForTournament(id, payload)
      setRegistered(true)
      setPortal((current) => {
        if (!current) return current
        const stats = getTournamentCapacityStats(current)
        const registrationDelta = result.alreadyRegistered || result.teamAlreadyRegistered ? 0 : 1
        const openTeamSlotCount = Math.max(stats.openTeamSlotCount - registrationDelta, 0)
        return {
          ...current,
          openTeamSlotCount,
          isViewerRegistered: true,
          viewerRegistration: result.registration || current.viewerRegistration || null,
          tournament: {
            ...current.tournament,
            openTeamSlotCount,
          },
        }
      })
      logFrontendEvent({ category: 'tournament.portal', message: 'registration_completed', data: { tournamentId: id, requiredTeamSize, alreadyRegistered: Boolean(result.alreadyRegistered), teamAlreadyRegistered: Boolean(result.teamAlreadyRegistered) } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not register for tournament.'
      setError(message)
      if (/Unauthorized|Authentication/i.test(message)) navigate(`/register?returnTo=${encodeURIComponent(`/tournaments/${id}`)}`)
      logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'registration_failed', data: { tournamentId: id, error: message } })
    } finally {
      setRegistering(false)
    }
  }

  if (loading) return <div className="container"><div className="card">Loading tournament portal…</div></div>
  const tournament = portal?.tournament
  const isCompletedTournament = String(tournament?.status || '').toLowerCase() === 'completed'
  const canCloseToPreviousPage = Boolean(user) || roles.some((role) => ['host', 'organizer', 'admin'].includes(String(role || '').toLowerCase()))
  const closeTournamentPortal = () => {
    logFrontendEvent({ category: 'tournament.portal', message: 'tournament_portal_close_to_previous_page', data: { tournamentId: id, roles, authenticated: Boolean(user) } })
    navigate(-1)
  }
  const template = getTournamentTemplate(tournament?.templateKey)
  const templateData = { ...emptyTournamentTemplateData(), ...(tournament?.templateData || {}) }
  const attributeIcons = template.attributeIcons

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {tournament ? <button type="button" className="btn btnPrimary" onClick={() => window.print()}>Print flyer</button> : null}
          {tournament && Number(tournament.imageCount || 0) > 0 ? (
            <Link
              className="btn tournamentFlyerPicturesButton"
              to={`/tournaments/${encodeURIComponent(tournament.tournamentIdentifier || tournament.id)}/pictures`}
              onClick={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_flyer_pictures_opened', data: { tournamentId: tournament.id, imageCount: Number(tournament.imageCount || 0) } })}
            >Pictures</Link>
          ) : null}
          {tournament ? (
            <Link
              className="btn tournamentFlyerLeaderboardButton"
              to={`/tournaments/${encodeURIComponent(tournament.tournamentIdentifier || tournament.id)}/leaderboard`}
              onClick={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_flyer_leaderboard_opened', data: { tournamentId: tournament.id } })}
            >Leaderboard</Link>
          ) : null}
          {canCloseToPreviousPage ? <button className="btn" type="button" onClick={closeTournamentPortal} aria-label="Close tournament portal and return to the previous page">Close</button> : null}
        </div>
        <style>{TOURNAMENT_FLYER_PRINT_STYLES}</style>
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {tournament ? (
          <>
            <TournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} templateKey={template.key} />
            <PrintableTournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} templateKey={template.key} />
            <div className="formStack" style={{ maxWidth: 760 }}>
              {isCompletedTournament ? (
                <>
                  <TournamentFinalLeaderboard rows={portal?.finalLeaderboard || []} />
                  <CompletedTournamentSummary summary={String((templateData as any).tournamentSummary || '')} />
                </>
              ) : (
                <>
                  <TournamentTeamStartSchedule assignments={portal?.startAssignments || tournament.startAssignments || []} />
                  <div className="card tournament-public-details-card" style={{ padding: 16 }}>
                    <div><strong>Date:</strong> {tournament.startDate ? formatFriendlyDate(tournament.startDate) : 'Date to be announced'}</div>
                    <div><strong>Organizer:</strong> {tournament.organizerName || 'Golf Homiez organizer'}</div>
                    <div><strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</div>
                    {portal ? <TournamentPublicSlotSummary portal={portal} /> : null}
                  </div>
                  <div className="card" style={{ padding: 16 }}>
                    <strong>Registration</strong>
                    {!registered && user ? (
                      <div className="formStack" style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <label><input type="radio" checked={teamMode === 'existing'} onChange={() => setTeamMode('existing')} /> Existing team</label>
                          <label><input type="radio" checked={teamMode === 'new'} onChange={() => setTeamMode('new')} /> New team</label>
                        </div>
                        {teamMode === 'existing' ? (
                          <div>
                            <label className="label">Team</label>
                            <select className="input" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
                              <option value="">Select one of your teams</option>
                              {eligibleTeams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.members?.length || 0} players)</option>)}
                            </select>
                            {eligibleTeams.length === 0 ? <div className="small" style={{ marginTop: 6 }}>You do not currently have a {requiredTeamSize}-player team. Choose New team to create one for this tournament.</div> : null}
                          </div>
                        ) : (
                          <div className="formStack">
                            <div>
                              <label className="label">Team name</label>
                              <input className="input" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" />
                            </div>
                            <div className="small">This tournament requires exactly {requiredTeamSize} players per team. You are included automatically; enter {requiredTeammateCount} teammate{requiredTeammateCount === 1 ? '' : 's'} below.</div>
                            {newTeamMembers.map((member, index) => (
                              <div key={member.id} className="grid tournament-registration-member-row" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <input className="input" value={member.name} onChange={(e) => setNewTeamMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, name: e.target.value } : item))} placeholder={`Teammate ${index + 1} name`} />
                                <input className="input" type="email" value={member.email} onChange={(e) => setNewTeamMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, email: e.target.value } : item))} placeholder="email@example.com" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {registered ? (
                      <div className="small" style={{ color: '#166534', fontWeight: 700 }}>You are already registered for this tournament.</div>
                    ) : slotsFull ? (
                      <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>Tournament team slots are full.</div>
                    ) : (
                      <button className="btn btnPrimary" type="button" disabled={registering || registrationClosed || authLoading || slotsFull || (Boolean(user) && !registrationTeamReady)} onClick={onRegister}>
                        {registering ? 'Registering…' : user ? 'Register for tournament team' : 'Create account to register'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : <Link className="btn" to="/">Go home</Link>}
      </div>
    </div>
  )
}
