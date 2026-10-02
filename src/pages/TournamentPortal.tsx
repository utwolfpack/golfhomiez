import { Fragment, useEffect, useMemo, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { fetchMyTeams, fetchTournamentPortal, registerForTournament, type TournamentFinalLeaderboardRow, type TournamentPortal as TournamentPortalData, type TournamentStartAssignment } from '../lib/accounts'
import type { Team } from '../types'
import { formatFriendlyDate } from '../lib/time-format'
import { DEFAULT_TOURNAMENT_BANNER_URL, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL, DEFAULT_TOURNAMENT_CHARITY_MESSAGE, getTournamentTemplate, emptyTournamentTemplateData, getTournamentTeamSize, normalizeTournamentBackgroundColor, type TournamentTemplateData, type TournamentAttributeIconKey } from '../lib/tournament-templates'
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
  if (!items.length) return null
  return (
    <div className="tournament-flyer-info-panel" style={{ minWidth: 0, padding: 12, border: '1px solid #b7d7ad', borderRadius: 14, background: '#f7fbf5', color: '#1f2937' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {iconKey ? <span style={{ color: accent }}><TournamentAttributeIcon iconKey={iconKey} size={34} contained /></span> : null}
        <h3 style={{ color: accent, margin: 0, fontSize: 16, textTransform: 'uppercase' }}>{title}</h3>
      </div>
      <ul style={{ marginTop: 0 }}>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  )
}

const ATTRIBUTE_ROWS: Array<{ key: TournamentAttributeIconKey; label: string; value: (tournament: NonNullable<TournamentPortalData['tournament']>, templateData: TournamentTemplateData) => string }> = [
  { key: 'date', label: 'Date', value: (tournament) => tournament.startDate ? formatFriendlyDate(tournament.startDate || '') : 'To be announced' },
  { key: 'location', label: 'Location', value: (tournament, templateData) => templateData.locationAddress || tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || 'To be announced' },
  { key: 'checkInTime', label: 'Check-in time', value: (_tournament, templateData) => templateData.checkInTime || 'To be announced' },
  { key: 'teeTime', label: 'Tee time', value: (_tournament, templateData) => templateData.teeTime || 'To be announced' },
  { key: 'course', label: 'Course / Venue', value: (tournament) => tournament.hostGolfCourseName || 'To be announced' },
  { key: 'format', label: 'Format', value: (_tournament, templateData) => templateData.tournamentFormat || `${getTournamentTeamSize(templateData)}-player team` },
  { key: 'registrationFee', label: 'Registration Fee', value: (_tournament, templateData) => templateData.entryFee || 'To be announced' },
]

function flyerRegistrationDeadline(templateData: TournamentTemplateData) {
  const raw = String(templateData.registrationDeadline || '').trim()
  if (!raw) return ''
  return formatFriendlyDate(raw)
}

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
  const promotionalPhotoUrl = String(templateData.promotionalPhotoUrl || '').trim()
  const flyerBackgroundColor = normalizeTournamentBackgroundColor(templateData.flyerBackgroundColor)
  const hasMiscSection = Boolean(String(templateData.miscNotes || '').trim() || promotionalPhotoUrl)
  const charityMessage = templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE
  const isDefaultCharityImage = !templateData.supportingPhotoUrl
  const qrCodeUrl = getTournamentQrCodeUrl(tournament.tournamentIdentifier || tournament.id)
  const registrationDeadline = flyerRegistrationDeadline(templateData)
  const feesInclude = lines(templateData.feesInclude)
  const prizeDetails = lines(templateData.prizeDetails)
  const contestDetails = lines(templateData.holeContestsExtras)
  const highlightCount = [feesInclude, prizeDetails, contestDetails].filter((items) => items.length > 0).length
  const hasContact = Boolean(String(templateData.contactPerson || '').trim() || String(templateData.contactPhone || '').trim() || String(templateData.contactEmail || '').trim())
  const qrCorrelationId = getCorrelationId()
  const bannerCorrelationId = getCorrelationId()
  const charityCorrelationId = getCorrelationId()
  const promotionalPhotoCorrelationId = getCorrelationId()

  return (
    <section className="card tournament-flyer tournament-flyer--spec-layout" aria-label="Tournament flyer" style={{ position: 'relative', overflow: 'hidden', padding: 0, border: '1px solid #b7d7ad', background: flyerBackgroundColor || '#fff', '--tournament-template-accent': accentColor } as CSSProperties}>
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
        <section className="tournament-flyer-primary-section" aria-label="Tournament introduction">
          <div className="tournament-flyer-header">
            <div className="tournament-flyer-title">{title}</div>
            <div className="tournament-flyer-presented-by">
              <span className="tournament-flyer-presented-by-rule" />
              <span className="tournament-flyer-presented-by-text">Presented by / {host}</span>
              <span className="tournament-flyer-presented-by-rule" />
            </div>
          </div>
          <div className="tournament-flyer-banner" aria-label="Tournament flyer background banner">
            <img
              src={backgroundImageUrl}
              alt={isDefaultBackground ? 'Default Golf Homiez tournament flyer banner' : 'Tournament flyer banner'}
              loading="lazy"
              decoding="async"
              data-correlation-id={bannerCorrelationId}
              onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_banner_loaded', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultBackground, correlationId: bannerCorrelationId } })}
              onError={(event) => { applyFallbackImage(event, DEFAULT_TOURNAMENT_BANNER_URL); logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_banner_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultBackground, backgroundImageUrl, fallbackApplied: !isDefaultBackground, correlationId: bannerCorrelationId } }) }}
            />
          </div>
          {description ? <p className="tournament-flyer-description">{description}</p> : null}
        </section>

        <section className="tournament-flyer-essentials-section" aria-label="Tournament essentials">
          <div className="tournament-flyer-attributes tournament-flyer-essentials-grid" aria-label="Tournament flyer event details">
            {rows.map((row) => (
              <div className={`tournament-flyer-attribute-row tournament-flyer-attribute-row--${row.key}`} key={row.key}>
                <span className="tournament-flyer-attribute-icon" style={{ color: accentColor }}><TournamentAttributeIcon iconKey={row.key} size={46} contained /></span>
                <div className="tournament-flyer-attribute-copy">
                  <strong>{row.label}</strong>
                  <span className="tournament-flyer-attribute-value">{row.displayValue}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="tournament-flyer-action-band" style={{ background: accentColor }}>
            <div>
              <span className="tournament-flyer-action-kicker">Ready to play?</span>
              <strong>Register for this tournament</strong>
              {registrationDeadline ? <small>Registration deadline: {registrationDeadline}</small> : <small>Scan the QR code below or open the tournament page.</small>}
            </div>
            <a href={flyerPageUrl || undefined}>Register now</a>
          </div>
        </section>

        <div className="tournament-flyer-body">
          <section className={`tournament-flyer-story-grid${hasMiscSection ? ' tournament-flyer-story-grid--with-misc' : ''}`} aria-label="Tournament story and beneficiary">
            <div className="card tournament-flyer-beneficiary-section">
              <div className="tournament-flyer-beneficiary-layout">
                <div className="tournament-flyer-beneficiary-image-frame">
                  <img
                    src={charityImageUrl}
                    alt={isDefaultCharityImage ? 'Default Golf Homiez charity image' : 'Tournament beneficiary or charity image'}
                    loading="lazy"
                    decoding="async"
                    data-correlation-id={charityCorrelationId}
                    onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'charity_image_loaded', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultCharityImage, correlationId: charityCorrelationId } })}
                    onError={(event) => { applyFallbackImage(event, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL); logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'charity_image_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultCharityImage, charityImageUrl, fallbackApplied: !isDefaultCharityImage, correlationId: charityCorrelationId } }) }}
                  />
                </div>
                <div className="tournament-flyer-beneficiary-copy">
                  <div className="tournament-flyer-section-label">Beneficiary / Charity</div>
                  <h2>{templateData.beneficiaryCharity || 'Proceeds benefit'}</h2>
                  <p>{charityMessage}</p>
                </div>
              </div>
            </div>
            {hasMiscSection ? (
              <section className={`tournament-flyer-misc-section${templateData.miscNotes ? '' : ' tournament-flyer-misc-section--image-only'}`} aria-label="Tournament information">
                {templateData.miscNotes ? (
                  <div className="tournament-flyer-misc-copy">
                    <div className="tournament-flyer-section-label">Tournament Information</div>
                    <p>{templateData.miscNotes}</p>
                  </div>
                ) : null}
                {promotionalPhotoUrl ? (
                  <div className="tournament-flyer-promotional-image-frame" aria-label="Tournament promotional image">
                    <img
                      src={promotionalPhotoUrl}
                      alt={`${title} tournament promotional`}
                      loading="lazy"
                      decoding="async"
                      data-correlation-id={promotionalPhotoCorrelationId}
                      onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_promotional_image_loaded', data: { tournamentId: tournament.id, templateKey: 'classic-flyer', section: 'misc', correlationId: promotionalPhotoCorrelationId } })}
                      onError={(event) => { const frame = event.currentTarget.closest('.tournament-flyer-promotional-image-frame') as HTMLElement | null; if (frame) frame.style.display = 'none'; logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_promotional_image_load_failed', data: { tournamentId: tournament.id, templateKey: 'classic-flyer', section: 'misc', correlationId: promotionalPhotoCorrelationId } }) }}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}
          </section>

          {(highlightCount || logos.length) ? (
            <section className="tournament-flyer-support-section" aria-label="Tournament inclusions, prizes, contests, and sponsors">
              {highlightCount ? (
                <div className={`tournament-flyer-summary-grid tournament-flyer-summary-grid--${highlightCount}`}>
                  {feesInclude.length ? <FlyerList title="What’s Included" items={feesInclude} accent={accentColor} /> : null}
                  {prizeDetails.length ? <FlyerList title="Prizes / Awards" items={prizeDetails} iconKey="format" accent={accentColor} /> : null}
                  {contestDetails.length ? <FlyerList title="Contest Holes / Extras" items={contestDetails} iconKey="location" accent={accentColor} /> : null}
                </div>
              ) : null}
              {logos.length ? (
                <div className="tournament-flyer-sponsors-section">
                  <h3>{templateData.sponsorsAvailable ? 'SPONSORS — opportunities available' : 'SPONSORS'}</h3>
                  <div className="tournament-flyer-sponsor-grid">
                    {logos.map((logo, index) => <div key={`${logo.slice(0, 24)}-${index}`} className="tournament-flyer-sponsor-logo"><img src={logo} alt={`Sponsor logo ${index + 1}`} onError={(event) => { const slot = event.currentTarget.closest('.tournament-flyer-sponsor-logo') as HTMLElement | null; if (slot) slot.style.display = 'none'; logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'tournament_sponsor_logo_load_failed', data: { tournamentId: tournament.id, templateKey: 'classic-flyer', sponsorIndex: index } }) }} /></div>)}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className={`tournament-flyer-contact-register-grid${hasContact ? '' : ' tournament-flyer-contact-register-grid--register-only'}`} aria-label="Tournament registration and contact">
            {hasContact ? (
              <div className="card tournament-flyer-contact-card">
                <strong>Contact</strong>
                {templateData.contactPerson ? <div>{templateData.contactPerson}</div> : null}
                {templateData.contactPhone ? <div>{templateData.contactPhone}</div> : null}
                {templateData.contactEmail ? <div>{templateData.contactEmail}</div> : null}
              </div>
            ) : null}
            <div className="tournament-flyer-register-card" style={{ borderColor: accentColor }}>
              <div className="tournament-flyer-register-copy" style={{ background: accentColor }}>
                Register Now
                <div><a href={flyerPageUrl || undefined}>{flyerPageUrl}</a></div>
              </div>
              <div className="tournament-flyer-qr-code" style={{ color: accentColor }}>
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
                  />
                ) : <span>QR CODE</span>}
                <span>Scan to open tournament page</span>
              </div>
            </div>
          </section>
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
  const promotionalPhotoUrl = String(templateData.promotionalPhotoUrl || '').trim()
  const flyerBackgroundColor = normalizeTournamentBackgroundColor(templateData.flyerBackgroundColor)
  const hasMiscSection = Boolean(String(templateData.miscNotes || '').trim() || promotionalPhotoUrl)
  const description = String(tournament.description || '').trim()
  const charityMessage = templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE
  const feeValue = templateData.entryFee ? (String(templateData.entryFee).trim().startsWith('$') ? templateData.entryFee : `$${templateData.entryFee}`) : 'To be announced'
  const rows = ATTRIBUTE_ROWS.map((row) => ({ ...row, displayValue: row.key === 'registrationFee' ? feeValue : row.value(tournament, templateData) }))
  const flyerPageUrl = tournament.portalUrl || (typeof window !== 'undefined' ? window.location.href : tournament.portalPath || '')
  const qrCodeUrl = getTournamentQrCodeUrl(tournament.tournamentIdentifier || tournament.id)
  const logos = Array.isArray(templateData.logoFiles) ? templateData.logoFiles.slice(0, 18) : []
  const registrationDeadline = flyerRegistrationDeadline(templateData)
  const feesInclude = lines(templateData.feesInclude)
  const prizeDetails = lines(templateData.prizeDetails)
  const contestDetails = lines(templateData.holeContestsExtras)
  const highlightCount = [feesInclude, prizeDetails, contestDetails].filter((items) => items.length > 0).length
  const hasContact = Boolean(String(templateData.contactPerson || '').trim() || String(templateData.contactPhone || '').trim() || String(templateData.contactEmail || '').trim())
  const bannerCorrelationId = getCorrelationId()
  const charityCorrelationId = getCorrelationId()
  const promotionalPhotoCorrelationId = getCorrelationId()
  const qrCorrelationId = getCorrelationId()
  const slug = templateKey.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()

  return (
    <section
      className={`card tournament-flyer tournament-guided-flyer tournament-guided-flyer--${slug} tournament-guided-flyer--spec-layout`}
      aria-label="Tournament flyer"
      style={{ '--tournament-template-accent': accentColor, '--tournament-template-background': flyerBackgroundColor || undefined } as CSSProperties}
    >
      <section className="tournament-guided-primary-section" aria-label="Tournament introduction">
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
          </div>
        </div>
        {description ? <div className="tournament-guided-description"><p>{description}</p></div> : null}
      </section>

      <section className="tournament-guided-essentials-section" aria-label="Tournament essentials">
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
        <div className="tournament-guided-action-band">
          <div>
            <span>Ready to play?</span>
            <strong>Register for this tournament</strong>
            {registrationDeadline ? <small>Registration deadline: {registrationDeadline}</small> : <small>Use the tournament page or scan the QR code below.</small>}
          </div>
          <a href={flyerPageUrl || undefined}>Register now</a>
        </div>
      </section>

      <div className="tournament-guided-body">
        <section className={`tournament-guided-story-grid${hasMiscSection ? ' tournament-guided-story-grid--with-misc' : ''}`} aria-label="Tournament story and beneficiary">
          <div className="tournament-guided-charity">
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
            </div>
          </div>

          {hasMiscSection ? (
            <div className={`tournament-guided-misc${templateData.miscNotes ? '' : ' tournament-guided-misc--image-only'}`} aria-label="Tournament information">
              {templateData.miscNotes ? (
                <div className="tournament-guided-misc-copy">
                  <div className="tournament-guided-section-label">Tournament Information</div>
                  <p>{templateData.miscNotes}</p>
                </div>
              ) : null}
              {promotionalPhotoUrl ? (
                <div className="tournament-guided-promotional-image" aria-label="Tournament promotional image">
                  <img
                    src={promotionalPhotoUrl}
                    alt={`${title} tournament promotional`}
                    loading="lazy"
                    decoding="async"
                    data-correlation-id={promotionalPhotoCorrelationId}
                    onLoad={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_promotional_image_loaded', data: { tournamentId: tournament.id, templateKey, section: 'misc', correlationId: promotionalPhotoCorrelationId } })}
                    onError={(event) => { const section = event.currentTarget.closest('.tournament-guided-promotional-image') as HTMLElement | null; if (section) section.style.display = 'none'; logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_promotional_image_load_failed', data: { tournamentId: tournament.id, templateKey, section: 'misc', correlationId: promotionalPhotoCorrelationId } }) }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {(highlightCount || logos.length) ? (
          <section className="tournament-guided-support-section" aria-label="Tournament inclusions, prizes, contests, and sponsors">
            {highlightCount ? (
              <div className={`tournament-guided-highlights tournament-guided-highlights--${highlightCount}`}>
                {feesInclude.length ? <FlyerList title="What’s Included" items={feesInclude} accent={accentColor} /> : null}
                {prizeDetails.length ? <FlyerList title="Prizes / Awards" items={prizeDetails} iconKey="format" accent={accentColor} /> : null}
                {contestDetails.length ? <FlyerList title="Contest Holes / Extras" items={contestDetails} iconKey="location" accent={accentColor} /> : null}
              </div>
            ) : null}
            {logos.length ? (
              <div className="tournament-guided-sponsors">
                <div className="tournament-guided-section-label">{templateData.sponsorsAvailable ? 'Sponsors — opportunities available' : 'Sponsors'}</div>
                <div className="tournament-guided-sponsor-grid">
                  {logos.map((logo, index) => <img key={`${logo.slice(0, 24)}-${index}`} src={logo} alt={`Sponsor logo ${index + 1}`} onError={(event) => { event.currentTarget.style.display = 'none'; logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'tournament_sponsor_logo_load_failed', data: { tournamentId: tournament.id, templateKey, sponsorIndex: index } }) }} />)}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={`tournament-guided-footer${hasContact ? '' : ' tournament-guided-footer--register-only'}`} aria-label="Tournament registration and contact">
          {hasContact ? (
            <div className="tournament-guided-contact">
              <div className="tournament-guided-section-label">Contact</div>
              {templateData.contactPerson ? <strong>{templateData.contactPerson}</strong> : null}
              {templateData.contactPhone ? <span>{templateData.contactPhone}</span> : null}
              {templateData.contactEmail ? <span>{templateData.contactEmail}</span> : null}
            </div>
          ) : null}
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
  const charityImageUrl = templateData.supportingPhotoUrl || DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL
  const promotionalPhotoUrl = String(templateData.promotionalPhotoUrl || '').trim()
  const flyerBackgroundColor = normalizeTournamentBackgroundColor(templateData.flyerBackgroundColor)
  const printMiscNotes = String(templateData.miscNotes || '').trim()
  const hasPrintMisc = Boolean(printMiscNotes || promotionalPhotoUrl)
  const charityMessage = templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE
  const qrCodeUrl = getTournamentQrCodeUrl(tournament.tournamentIdentifier || tournament.id)
  const logos = Array.isArray(templateData.logoFiles) ? templateData.logoFiles.slice(0, 10) : []
  const printFeesInclude = lines(templateData.feesInclude)
  const printPrizeDetails = lines(templateData.prizeDetails)
  const printContestDetails = lines(templateData.holeContestsExtras)
  const printInfoPanelCount = [printFeesInclude, printPrizeDetails, printContestDetails].filter((items) => items.length > 0).length
  const printContactPerson = String(templateData.contactPerson || '').trim()
  const printContactPhone = String(templateData.contactPhone || '').trim()
  const printContactEmail = String(templateData.contactEmail || '').trim()
  const hasPrintContact = Boolean(printContactPerson || printContactPhone || printContactEmail)
  const printRegistrationDeadline = flyerRegistrationDeadline(templateData)
  const printOptionalContentCount = printFeesInclude.length + printPrizeDetails.length + printContestDetails.length + logos.length + (printMiscNotes ? 2 : 0) + (promotionalPhotoUrl ? 2 : 0)
  const printContentDensity = printInfoPanelCount <= 2 && logos.length === 0 && printOptionalContentCount <= 10 && description.length <= 260 && charityMessage.length <= 420
    ? 'light'
    : printOptionalContentCount >= 16 || description.length > 320 || charityMessage.length > 520
      ? 'full'
      : 'balanced'

  return (
    <section
      className={`tournament-print-flyer tournament-print-flyer--${templateKey || 'classic-flyer'} tournament-print-flyer--content-${printContentDensity} tournament-print-flyer--spec-layout`}
      aria-label="Printable tournament flyer"
      style={{ '--tournament-print-background': flyerBackgroundColor || undefined, '--tournament-template-accent': accentColor } as CSSProperties}
    >
      {isDefaultBackground ? <img className="tournament-print-emblem" src={golfHomiezEmblemUrl} alt="Golf Homiez" /> : null}

      <section className="tournament-print-primary-section" aria-label="Tournament introduction">
        <div className="tournament-print-header">
          <h1>{title}</h1>
          <div className="tournament-print-presented">Presented by / {host}</div>
        </div>
        <div className="tournament-print-banner">
          <img src={backgroundImageUrl} alt={isDefaultBackground ? 'Default Golf Homiez tournament flyer banner' : 'Tournament flyer banner'} onError={(event) => applyFallbackImage(event, DEFAULT_TOURNAMENT_BANNER_URL)} />
        </div>
        {description ? <div className="tournament-print-description">{description}</div> : null}
      </section>

      <section className="tournament-print-essentials-section" aria-label="Tournament essentials">
        <div className="tournament-print-detail-grid">
          {rows.map((row) => (
            <div className={`tournament-print-detail tournament-print-detail--${row.key}`} key={row.key}>
              <TournamentAttributeIcon iconKey={row.key} size={34} />
              <div>
                <strong>{row.label}</strong>
                <span>{row.displayValue}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="tournament-print-action-band">
          <strong>Register now</strong>
          <span>{printRegistrationDeadline ? `Registration deadline: ${printRegistrationDeadline}` : 'Scan the QR code below to open the tournament page.'}</span>
        </div>
      </section>

      <section className={`tournament-print-story-grid${hasPrintMisc ? ' tournament-print-story-grid--with-misc' : ''}`} aria-label="Tournament beneficiary and information">
        <div className="tournament-print-beneficiary">
          <div className="tournament-print-beneficiary-layout">
            <img className="tournament-print-beneficiary-image" src={charityImageUrl} alt="Tournament beneficiary or charity" onError={(event) => applyFallbackImage(event, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL)} />
            <div className="tournament-print-beneficiary-copy">
              <strong>Beneficiary / Charity</strong>
              <span>{templateData.beneficiaryCharity || 'Proceeds benefit'}</span>
              <p>{charityMessage}</p>
            </div>
          </div>
        </div>
        {hasPrintMisc ? (
          <div className={`tournament-print-misc${printMiscNotes ? '' : ' tournament-print-misc--image-only'}`} aria-label="Tournament information">
            {printMiscNotes ? (
              <div className="tournament-print-misc-copy">
                <strong>Tournament Information</strong>
                <p>{printMiscNotes}</p>
              </div>
            ) : null}
            {promotionalPhotoUrl ? (
              <div className="tournament-print-photo-strip tournament-print-photo-strip--promotional-only tournament-print-misc-promotional" aria-label="Tournament promotional photo">
                <div className="tournament-print-photo-card tournament-print-photo-card--promotional">
                  <img src={promotionalPhotoUrl} alt={`${title} tournament promotional`} onError={(event) => { const strip = event.currentTarget.closest('.tournament-print-photo-strip') as HTMLElement | null; if (strip) strip.style.display = 'none' }} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {(printInfoPanelCount || logos.length) ? (
        <section className="tournament-print-support-section" aria-label="Tournament inclusions, prizes, contests, and sponsors">
          {printInfoPanelCount ? (
            <div className="tournament-print-mid-grid tournament-print-mid-grid--info-only">
              <div className={`tournament-print-columns tournament-print-columns--${printInfoPanelCount}`}>
                {printFeesInclude.length ? <FlyerList title="What’s Included" items={printFeesInclude} accent={accentColor} /> : null}
                {printPrizeDetails.length ? <FlyerList title="Prizes / Awards" items={printPrizeDetails} iconKey="format" accent={accentColor} /> : null}
                {printContestDetails.length ? <FlyerList title="Contest Holes / Extras" items={printContestDetails} iconKey="location" accent={accentColor} /> : null}
              </div>
            </div>
          ) : null}
          {logos.length ? (
            <div className="tournament-print-sponsors">
              <strong>{templateData.sponsorsAvailable ? 'Sponsors — opportunities available' : 'Sponsors'}</strong>
              <div>
                {logos.map((logo, index) => <img key={`${logo.slice(0, 24)}-${index}`} src={logo} alt={`Sponsor logo ${index + 1}`} onError={(event) => { event.currentTarget.style.display = 'none' }} />)}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={`tournament-print-footer-grid${hasPrintContact ? '' : ' tournament-print-footer-grid--register-only'}`} aria-label="Tournament registration and contact">
        {hasPrintContact ? (
          <div className="tournament-print-contact">
            <strong>Contact</strong>
            {printContactPerson ? <span>{printContactPerson}</span> : null}
            {printContactPhone ? <span>{printContactPhone}</span> : null}
            {printContactEmail ? <span>{printContactEmail}</span> : null}
          </div>
        ) : null}
        <div className="tournament-print-register">
          <strong>Register Now</strong>
          {qrCodeUrl ? <img src={qrCodeUrl} alt={`QR code for ${title} tournament page`} /> : null}
        </div>
      </section>
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
    grid-template-rows: auto auto minmax(1.45in, 1fr) auto auto !important;
    gap: 0.1in !important;
    position: fixed !important;
    inset: 0 !important;
    width: 7.95in !important;
    height: 10.45in !important;
    margin: 0 auto !important;
    padding: 0.18in !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    background: var(--tournament-print-background, #ffffff) !important;
    border: 2px solid #b7d7ad !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    color: #111827 !important;
    font-family: Arial, Helvetica, sans-serif !important;
    break-after: avoid !important;
    page-break-after: avoid !important;
    page-break-inside: avoid !important;
  }
  .tournament-print-flyer--content-full {
    grid-template-rows: auto auto auto auto auto !important;
    gap: 0.065in !important;
  }
  .tournament-print-emblem {
    position: absolute !important;
    top: 0.14in !important;
    right: 0.16in !important;
    width: 0.64in !important;
    height: 0.64in !important;
    object-fit: contain !important;
    z-index: 2 !important;
  }

  .tournament-print-primary-section,
  .tournament-print-essentials-section,
  .tournament-print-support-section {
    display: grid !important;
    gap: 0.065in !important;
    min-width: 0 !important;
    min-height: 0 !important;
  }
  .tournament-print-header { text-align: center !important; padding: 0 0.68in 0 0.1in !important; }
  .tournament-print-header h1 {
    margin: 0.02in 0 !important;
    color: #0f3f24 !important;
    font-size: 32pt !important;
    line-height: .92 !important;
    font-weight: 900 !important;
    letter-spacing: .005em !important;
    text-transform: uppercase !important;
  }
  .tournament-print-presented { color: #0f3f24 !important; font-size: 9pt !important; font-weight: 800 !important; text-transform: uppercase !important; }
  .tournament-print-banner {
    height: 1.35in !important;
    border: 1px solid #b7d7ad !important;
    overflow: hidden !important;
    border-radius: 0.08in !important;
    background: #d8e4da !important;
  }
  .tournament-print-flyer--content-light .tournament-print-banner { height: 1.82in !important; }
  .tournament-print-flyer--content-balanced .tournament-print-banner { height: 1.55in !important; }
  .tournament-print-flyer--content-full .tournament-print-banner { height: 1.12in !important; }
  .tournament-print-banner img { width: 100% !important; height: 100% !important; object-fit: cover !important; object-position: center !important; display: block !important; }
  .tournament-print-description {
    margin: 0 !important;
    padding: 0.05in 0.09in !important;
    border: 1px solid #d7e6d2 !important;
    border-radius: 0.06in !important;
    background: rgba(255,255,255,.96) !important;
    color: #334155 !important;
    text-align: center !important;
    font-size: 8.4pt !important;
    line-height: 1.16 !important;
    overflow-wrap: anywhere !important;
  }

  .tournament-print-detail-grid {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 0.055in !important;
    min-width: 0 !important;
  }
  .tournament-print-detail {
    display: grid !important;
    grid-template-columns: 0.31in minmax(0, 1fr) !important;
    gap: 0.055in !important;
    align-items: center !important;
    padding: 0.045in 0.065in !important;
    border: 1px solid #b7d7ad !important;
    border-radius: 0.065in !important;
    background: #f7fbf5 !important;
    min-width: 0 !important;
  }
  .tournament-print-detail .tournament-attribute-icon { width: 0.29in !important; height: 0.29in !important; color: #0f3f24 !important; display: inline-flex !important; }
  .tournament-print-detail .tournament-attribute-icon svg { width: 82% !important; height: 82% !important; }
  .tournament-print-detail strong { display: block !important; color: #0f3f24 !important; font-size: 7.8pt !important; line-height: 1 !important; text-transform: uppercase !important; }
  .tournament-print-detail span { display: block !important; color: #111827 !important; margin-top: 0.012in !important; font-size: 8.6pt !important; line-height: 1.08 !important; overflow-wrap: anywhere !important; }
  .tournament-print-detail:last-child:nth-child(odd) { grid-column: 1 / -1 !important; }
  .tournament-print-action-band {
    display: grid !important;
    grid-template-columns: auto minmax(0,1fr) !important;
    gap: 0.09in !important;
    align-items: center !important;
    padding: 0.055in 0.09in !important;
    border-radius: 0.065in !important;
    background: var(--tournament-template-accent, #0f3f24) !important;
    color: #fff !important;
  }
  .tournament-print-action-band strong { font-size: 10pt !important; line-height: 1 !important; text-transform: uppercase !important; white-space: nowrap !important; }
  .tournament-print-action-band span { font-size: 8.2pt !important; line-height: 1.08 !important; }

  .tournament-print-story-grid {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 0.08in !important;
    min-width: 0 !important;
    min-height: 0 !important;
    align-items: stretch !important;
  }
  .tournament-print-story-grid--with-misc { grid-template-columns: minmax(0, 1.12fr) minmax(2.25in, .88fr) !important; }
  .tournament-print-beneficiary,
  .tournament-print-misc,
  .tournament-print-contact,
  .tournament-print-register {
    border: 1px solid #b7d7ad !important;
    border-radius: 0.07in !important;
    background: #f7fbf5 !important;
    color: #111827 !important;
    min-width: 0 !important;
    min-height: 0 !important;
    box-sizing: border-box !important;
  }
  .tournament-print-beneficiary { display: flex !important; align-items: center !important; padding: 0.07in 0.08in !important; height: 100% !important; }
  .tournament-print-beneficiary-layout { display: grid !important; grid-template-columns: auto minmax(0, 1fr) !important; gap: 0.08in !important; align-items: center !important; width: 100% !important; }
  .tournament-print-beneficiary-image {
    width: auto !important;
    max-width: 1.28in !important;
    height: auto !important;
    max-height: 1.18in !important;
    object-fit: contain !important;
    object-position: center !important;
    border-radius: 0.08in !important;
    background: transparent !important;
    display: block !important;
  }
  .tournament-print-flyer--content-light .tournament-print-beneficiary-image { max-width: 1.62in !important; max-height: 1.52in !important; }
  .tournament-print-beneficiary-copy { min-width: 0 !important; }
  .tournament-print-beneficiary strong,
  .tournament-print-misc-copy strong,
  .tournament-print-contact strong,
  .tournament-print-register strong { display: block !important; color: #0f3f24 !important; font-size: 8pt !important; line-height: 1.02 !important; text-transform: uppercase !important; }
  .tournament-print-beneficiary span { display: block !important; color: #0f3f24 !important; margin-top: 0.018in !important; font-size: 11.8pt !important; line-height: 1 !important; font-weight: 900 !important; }
  .tournament-print-beneficiary p,
  .tournament-print-misc-copy p { display: block !important; color: #1f2937 !important; margin: 0.025in 0 0 !important; font-size: 7.7pt !important; line-height: 1.11 !important; overflow-wrap: anywhere !important; }
  .tournament-print-flyer--content-light .tournament-print-beneficiary span { font-size: 12.8pt !important; }
  .tournament-print-flyer--content-light .tournament-print-beneficiary p { font-size: 8pt !important; line-height: 1.13 !important; }
  .tournament-print-beneficiary p strong { display: inline !important; color: #0f3f24 !important; font-size: inherit !important; line-height: inherit !important; }

  .tournament-print-misc {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 0.055in !important;
    align-content: center !important;
    align-items: center !important;
    padding: 0.065in !important;
    height: 100% !important;
  }
  .tournament-print-misc:has(.tournament-print-misc-copy):has(.tournament-print-misc-promotional) { grid-template-columns: minmax(0,1fr) auto !important; }
  .tournament-print-misc--image-only { justify-items: center !important; }
  .tournament-print-misc-copy { min-width: 0 !important; }
  .tournament-print-misc-promotional { justify-self: end !important; align-self: center !important; }
  .tournament-print-photo-strip { display: flex !important; align-items: center !important; justify-content: center !important; min-width: 0 !important; min-height: 0 !important; }
  .tournament-print-photo-card { display: flex !important; align-items: center !important; justify-content: center !important; width: fit-content !important; max-width: 1.9in !important; padding: 0 !important; border: 0 !important; background: transparent !important; }
  .tournament-print-photo-card img { width: auto !important; max-width: 1.9in !important; height: auto !important; max-height: 1.35in !important; object-fit: contain !important; object-position: center !important; background: transparent !important; border-radius: 0.08in !important; display: block !important; }
  .tournament-print-flyer--content-light .tournament-print-photo-card,
  .tournament-print-flyer--content-light .tournament-print-photo-card img { max-width: 2.25in !important; }
  .tournament-print-flyer--content-light .tournament-print-photo-card img { max-height: 1.6in !important; }

  .tournament-print-support-section { align-content: start !important; }
  .tournament-print-mid-grid { display: grid !important; min-width: 0 !important; }
  .tournament-print-columns { display: grid !important; gap: 0.06in !important; min-width: 0 !important; width: 100% !important; }
  .tournament-print-columns--1 { grid-template-columns: minmax(0, 1fr) !important; }
  .tournament-print-columns--2 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .tournament-print-columns--3 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  .tournament-print-columns .tournament-flyer-info-panel {
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    height: 100% !important;
    min-height: 0 !important;
    padding: 0.055in 0.065in !important;
    border-radius: 0.065in !important;
    background: #f7fbf5 !important;
    box-sizing: border-box !important;
  }
  .tournament-print-columns .tournament-flyer-info-panel > div { margin-bottom: 0.025in !important; }
  .tournament-print-columns .tournament-flyer-info-panel h3 { font-size: 7.8pt !important; line-height: 1 !important; margin: 0 !important; }
  .tournament-print-columns .tournament-flyer-info-panel .tournament-attribute-icon { width: 0.22in !important; height: 0.22in !important; display: inline-flex !important; }
  .tournament-print-columns .tournament-flyer-info-panel ul { margin: 0 !important; padding-left: 0.14in !important; }
  .tournament-print-columns .tournament-flyer-info-panel li { font-size: 7.6pt !important; line-height: 1.08 !important; margin: 0 0 0.015in !important; }
  .tournament-print-sponsors { border-top: 1px solid #b7d7ad !important; padding-top: 0.035in !important; }
  .tournament-print-sponsors strong { display: block !important; color: #0f3f24 !important; font-size: 7.8pt !important; text-transform: uppercase !important; text-align: center !important; }
  .tournament-print-sponsors div { display: grid !important; grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 0.04in !important; align-items: center !important; min-height: 0.3in !important; }
  .tournament-print-sponsors img { max-width: 100% !important; max-height: 0.3in !important; object-fit: contain !important; margin: 0 auto !important; display: block !important; }

  .tournament-print-footer-grid {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 1.05in !important;
    gap: 0.1in !important;
    align-items: end !important;
    min-width: 0 !important;
    min-height: 0 !important;
  }
  .tournament-print-footer-grid--register-only { grid-template-columns: 1.05in !important; justify-content: end !important; }
  .tournament-print-contact { justify-self: stretch !important; align-self: end !important; padding: 0.06in 0.075in !important; }
  .tournament-print-contact span { display: block !important; color: #111827 !important; margin: 0.02in 0 0 !important; font-size: 7.8pt !important; line-height: 1.08 !important; overflow-wrap: anywhere !important; }
  .tournament-print-register { width: 1.05in !important; justify-self: end !important; align-self: end !important; text-align: center !important; padding: 0.055in !important; }
  .tournament-print-register img { width: 0.82in !important; height: 0.82in !important; margin: 0.025in auto 0 !important; display: block !important; }

  .tournament-print-flyer--fairway-poster { background: var(--tournament-print-background, #f4f8e4) !important; border-color: #174b22 !important; }
  .tournament-print-flyer--fairway-poster .tournament-print-header { background: #174b22 !important; margin: -0.18in -0.18in 0 !important; padding: 0.14in 0.82in 0.12in !important; }
  .tournament-print-flyer--fairway-poster .tournament-print-header h1,
  .tournament-print-flyer--fairway-poster .tournament-print-presented { color: #fff !important; }
  .tournament-print-flyer--modern-open { background: var(--tournament-print-background, #eff1d9) !important; border-color: #244b17 !important; }
  .tournament-print-flyer--modern-open .tournament-print-header { text-align: left !important; padding-right: 0.72in !important; }
  .tournament-print-flyer--modern-open .tournament-print-header h1 { color: #244b17 !important; }
  .tournament-print-flyer--modern-open .tournament-print-detail:nth-child(odd) { background: #dfe8ba !important; }
  .tournament-print-flyer--charity-tribute { background: var(--tournament-print-background, #1f3d0f) !important; border-color: #6f8f2d !important; color: #fff !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-header h1,
  .tournament-print-flyer--charity-tribute .tournament-print-presented { color: #fff !important; font-family: Georgia, 'Times New Roman', serif !important; text-transform: none !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-description,
  .tournament-print-flyer--charity-tribute .tournament-print-detail,
  .tournament-print-flyer--charity-tribute .tournament-print-beneficiary,
  .tournament-print-flyer--charity-tribute .tournament-print-misc,
  .tournament-print-flyer--charity-tribute .tournament-print-contact,
  .tournament-print-flyer--charity-tribute .tournament-print-register,
  .tournament-print-flyer--charity-tribute .tournament-print-columns .tournament-flyer-info-panel { background: #f4f6e8 !important; color: #111827 !important; }
  .tournament-print-flyer--charity-tribute .tournament-print-beneficiary p,
  .tournament-print-flyer--charity-tribute .tournament-print-misc-copy p,
  .tournament-print-flyer--charity-tribute .tournament-print-contact span { color: #111827 !important; }
  .tournament-print-flyer--sunset-drive { background: var(--tournament-print-background, #f5f0dc) !important; border-color: #41520d !important; }
  .tournament-print-flyer--sunset-drive .tournament-print-header h1 { color: #41520d !important; font-size: 36pt !important; }
  .tournament-print-flyer--green-invite { background: var(--tournament-print-background, #f4f1df) !important; border-color: #176b2c !important; }
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
  const isDraftTournament = String(tournament?.status || '').toLowerCase() === 'draft'
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
          {tournament ? <button type="button" className="btn btnPrimary" onClick={() => { logFrontendEvent({ category: 'tournament.portal', message: 'tournament_flyer_print_requested', data: { tournamentId: tournament.id, beneficiaryImageFit: 'contain-natural-size', promotionalImageFit: templateData.promotionalPhotoUrl ? 'contain-natural-size' : 'not-provided', photoPresentation: 'embedded-no-container', descriptionPlacement: 'separate-readable-block', printedTournamentUrlText: false, printFooterLayout: 'aligned-contact-left-qr-right', printWhitespaceStrategy: 'flyer-specs-five-section-composition', customBackgroundColor: normalizeTournamentBackgroundColor(templateData.flyerBackgroundColor) || null } }); window.print() }}>Print flyer</button> : null}
          {tournament && !isDraftTournament && Number(tournament.imageCount || 0) > 0 ? (
            <Link
              className="btn tournamentFlyerPicturesButton"
              to={`/tournaments/${encodeURIComponent(tournament.tournamentIdentifier || tournament.id)}/pictures`}
              onClick={() => logFrontendEvent({ category: 'tournament.portal', message: 'tournament_flyer_pictures_opened', data: { tournamentId: tournament.id, imageCount: Number(tournament.imageCount || 0) } })}
            >Pictures</Link>
          ) : null}
          {tournament && !isDraftTournament ? (
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
            {isDraftTournament ? (
              <div className="card tournament-draft-preview-notice no-print" role="status">
                <strong>Draft preview</strong>
                <span>This dedicated Golf Homiez tournament URL is visible to the signed-in host while the tournament is in Draft status. Publish the tournament when it is ready for golfers to view and register.</span>
              </div>
            ) : null}
            <TournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} templateKey={template.key} />
            <PrintableTournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} templateKey={template.key} />
            <div className="formStack" style={{ maxWidth: 760 }}>
              {isCompletedTournament ? (
                <>
                  <TournamentFinalLeaderboard rows={portal?.finalLeaderboard || []} />
                  <CompletedTournamentSummary summary={String((templateData as any).tournamentSummary || '')} />
                </>
              ) : isDraftTournament ? (
                <div className="card tournament-draft-preview-details" style={{ padding: 16 }}>
                  <strong>Draft tournament page</strong>
                  <div className="small">Registration is unavailable while this tournament is in Draft status. The same dedicated tournament URL becomes the golfer-facing tournament page after publication.</div>
                </div>
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
