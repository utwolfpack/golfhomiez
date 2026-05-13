import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchMyTeams, fetchTournamentPortal, registerForTournament, type TournamentPortal as TournamentPortalData } from '../lib/accounts'
import type { Team } from '../types'
import { formatFriendlyDate } from '../lib/time-format'
import { DEFAULT_TOURNAMENT_BANNER_URL, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL, DEFAULT_TOURNAMENT_CHARITY_MESSAGE, getTournamentTemplate, emptyTournamentTemplateData, type TournamentTemplateData, type TournamentAttributeIconKey } from '../lib/tournament-templates'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { getTournamentQrCodeUrl } from '../lib/tournament-qr'
import golfHomiezEmblemUrl from '../assets/GolfHomiezEmblem.png'

function lines(value?: string | null) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function FlyerList({ title, items, icon, accent = '#0f3f24' }: { title: string; items: string[]; icon?: string; accent?: string }) {
  return (
    <div className="tournament-flyer-info-panel" style={{ minWidth: 0, padding: 12, border: '1px solid #b7d7ad', borderRadius: 14, background: '#f7fbf5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {icon ? <span style={{ display: 'inline-flex', width: 34, height: 34, borderRadius: '50%', background: accent, alignItems: 'center', justifyContent: 'center' }}><img src={icon} alt="" aria-hidden="true" style={{ width: 22, height: 22, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} /></span> : null}
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
  { key: 'format', label: 'Format', value: (_tournament, templateData) => templateData.tournamentFormat || 'To be announced' },
  { key: 'registrationFee', label: 'Registration Fee', value: (_tournament, templateData) => templateData.entryFee || 'To be announced' },
]

function TournamentFlyer({ tournament, templateData, attributeIcons, accentColor }: { tournament: NonNullable<TournamentPortalData['tournament']>; templateData: TournamentTemplateData; attributeIcons: Record<TournamentAttributeIconKey, string>; accentColor: string }) {
  const title = tournament.name
  const host = templateData.hostOrganization || tournament.organizerName || 'Host organization'
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
            onError={() => logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'tournament_banner_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultBackground, backgroundImageUrl, correlationId: bannerCorrelationId } })}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: isDefaultBackground ? 'center right' : 'center center', opacity: 0.82 }}
          />
        </div>
        {description ? <p style={{ maxWidth: 780, margin: '16px auto 0', color: '#374151', fontSize: 18, lineHeight: 1.45 }}>{description}</p> : null}
      </div>

      <div className="tournament-flyer-attributes" aria-label="Tournament flyer attribute rows" style={{ maxWidth: 920, margin: '0 auto', padding: '0 20px' }}>
        {rows.map((row) => (
          <div className="tournament-flyer-attribute-row" key={row.key} style={{ display: 'grid', gridTemplateColumns: '96px 28px minmax(145px, 260px) 1fr', alignItems: 'center', gap: 16, borderTop: '1px solid #b7d7ad', minHeight: 88, padding: '10px 0' }}>
            <img src={attributeIcons[row.key]} alt="" aria-hidden="true" style={{ width: 72, height: 72, objectFit: 'contain', justifySelf: 'center' }} />
            <div style={{ width: 2, alignSelf: 'stretch', background: '#b7d7ad' }} />
            <div style={{ color: accentColor, fontWeight: 900, fontSize: 20, textTransform: 'uppercase', lineHeight: 1.1 }}>{row.label}</div>
            <div className="tournament-flyer-attribute-value" style={{ color: '#111827', fontSize: 18, lineHeight: 1.25 }}>{row.displayValue}</div>
          </div>
        ))}
      </div>

      <div className="tournament-flyer-body" style={{ maxWidth: 920, margin: '0 auto', padding: '0 20px 24px' }}>
        <div className="grid grid3 tournament-flyer-summary-grid" style={{ gap: 20, borderTop: '1px solid #b7d7ad', paddingTop: 18 }}>
          <FlyerList title="What’s Included" items={lines(templateData.feesInclude)} accent={accentColor} />
          <FlyerList title="Prizes / Awards" items={lines(templateData.prizeDetails)} icon={attributeIcons.format} accent={accentColor} />
          <FlyerList title="Contest Holes / Extras" items={lines(templateData.holeContestsExtras)} icon={attributeIcons.location} accent={accentColor} />
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
                onError={() => logFrontendEvent({ category: 'tournament.portal', level: 'error', message: 'charity_image_load_failed', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, isDefaultCharityImage, charityImageUrl, correlationId: charityCorrelationId } })}
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
        <div className="tournament-flyer-sponsors-section" style={{ marginTop: 20 }}>
          <h3 style={{ textAlign: 'center', color: accentColor }}>{templateData.sponsorsAvailable ? 'SPONSERS - available' : 'SPONSORS'}</h3>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
            {logos.length ? logos.map((logo, index) => <div key={`${logo.slice(0, 24)}-${index}`} className="tournament-flyer-sponsor-logo" style={{ padding: 8, background: 'transparent', border: 'none', boxShadow: 'none' }}><img src={logo} alt={`Sponsor logo ${index + 1}`} style={{ width: '100%', height: 60, objectFit: 'contain' }} /></div>) : Array.from({ length: 6 }).map((_, index) => <div key={index} className="card small" style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', borderStyle: 'dashed' }}>Your logo here</div>)}
          </div>
        </div>
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

function PrintableTournamentFlyer({ tournament, templateData, attributeIcons, accentColor }: { tournament: NonNullable<TournamentPortalData['tournament']>; templateData: TournamentTemplateData; attributeIcons: Record<TournamentAttributeIconKey, string>; accentColor: string }) {
  const title = tournament.name
  const host = templateData.hostOrganization || tournament.organizerName || 'Host organization'
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
    <section className="tournament-print-flyer" aria-label="Printable tournament flyer">
      {isDefaultBackground ? <img className="tournament-print-emblem" src={golfHomiezEmblemUrl} alt="Golf Homiez" /> : null}
      <div className="tournament-print-header">
        <div className="tournament-print-eyebrow">Golf Homiez Tournament</div>
        <h1>{title}</h1>
        <div className="tournament-print-presented">Presented by / {host}</div>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="tournament-print-banner">
        <img src={backgroundImageUrl} alt={isDefaultBackground ? 'Default Golf Homiez tournament flyer banner' : 'Tournament flyer banner'} />
      </div>
      <div className="tournament-print-detail-grid">
        {rows.map((row) => (
          <div className="tournament-print-detail" key={row.key}>
            <img src={attributeIcons[row.key]} alt="" aria-hidden="true" />
            <div>
              <strong>{row.label}</strong>
              <span>{row.displayValue}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="tournament-print-columns">
        <FlyerList title="What’s Included" items={lines(templateData.feesInclude)} accent={accentColor} />
        <FlyerList title="Prizes / Awards" items={lines(templateData.prizeDetails)} icon={attributeIcons.format} accent={accentColor} />
        <FlyerList title="Contest Holes / Extras" items={lines(templateData.holeContestsExtras)} icon={attributeIcons.location} accent={accentColor} />
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
      <div className="tournament-print-sponsors">
        <strong>{templateData.sponsorsAvailable ? 'Sponsors available' : 'Sponsors'}</strong>
        <div>
          {logos.length ? logos.map((logo, index) => <img key={`${logo.slice(0, 24)}-${index}`} src={logo} alt={`Sponsor logo ${index + 1}`} />) : <span>Ask about sponsor opportunities</span>}
        </div>
      </div>
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
  .tournament-print-detail strong { display: block !important; color: #0f3f24 !important; font-size: 8.5pt !important; line-height: 1.05 !important; text-transform: uppercase !important; }
  .tournament-print-detail span { display: block !important; color: #111827 !important; font-size: 9pt !important; line-height: 1.12 !important; overflow-wrap: anywhere !important; }
  .tournament-print-columns { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 0.07in !important; }
  .tournament-print-columns .tournament-flyer-info-panel { padding: 0.07in !important; border-radius: 0.08in !important; min-height: 0 !important; background: #f7fbf5 !important; }
  .tournament-print-columns .tournament-flyer-info-panel h3 { font-size: 8.5pt !important; line-height: 1.05 !important; margin: 0 !important; }
  .tournament-print-columns .tournament-flyer-info-panel span { width: 0.25in !important; height: 0.25in !important; }
  .tournament-print-columns .tournament-flyer-info-panel span img { width: 0.16in !important; height: 0.16in !important; }
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
}
`

export default function TournamentPortal() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
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

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchTournamentPortal(id)
        if (!active) return
        setPortal(result)
        setRegistered(Boolean(result.isViewerRegistered))
        logFrontendEvent({ category: 'tournament.portal', message: 'portal_loaded', data: { tournamentId: id, teamSlotLimit: result.teamSlotLimit, openTeamSlotCount: result.openTeamSlotCount, isViewerRegistered: Boolean(result.isViewerRegistered) } })
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
        setTeams(result.filter((team) => [2, 4].includes(team.members?.length || 0)))
        if (result[0]?.id) setSelectedTeamId(result[0].id)
      } catch (err) {
        logFrontendEvent({ category: 'tournament.portal', level: 'warn', message: 'team_options_load_failed', data: { tournamentId: id, error: err instanceof Error ? err.message : String(err) } })
      }
    })()
    return () => { active = false }
  }, [id, user])

  const registrationClosed = useMemo(() => {
    const status = portal?.tournament.status
    return status === 'cancelled' || status === 'completed'
  }, [portal?.tournament.status])

  const slotsFull = useMemo(() => getTournamentCapacityStats(portal).openTeamSlotCount <= 0, [portal])

  async function onRegister() {
    if (!id) return
    if (!user && !authLoading) {
      const returnTo = `/tournaments/${encodeURIComponent(id)}`
      logFrontendEvent({ category: 'tournament.portal', message: 'registration_requires_account', data: { tournamentId: id, returnTo } })
      navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`)
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
      logFrontendEvent({ category: 'tournament.portal', message: 'registration_completed', data: { tournamentId: id, alreadyRegistered: Boolean(result.alreadyRegistered), teamAlreadyRegistered: Boolean(result.teamAlreadyRegistered) } })
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
  const template = getTournamentTemplate(tournament?.templateKey)
  const templateData = { ...emptyTournamentTemplateData(), ...(tournament?.templateData || {}) }
  const attributeIcons = template.attributeIcons

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {tournament ? <button type="button" className="btn btnPrimary" onClick={() => window.print()}>Print flyer</button> : null}
          <Link className="btn" to="/my-tournaments" aria-label="Close tournament portal and return to my tournaments">Close</Link>
        </div>
        <style>{TOURNAMENT_FLYER_PRINT_STYLES}</style>
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {tournament ? (
          <>
            <TournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} />
            <PrintableTournamentFlyer tournament={tournament} templateData={templateData} attributeIcons={attributeIcons} accentColor={template.accentColor} />
            <div className="formStack" style={{ maxWidth: 760 }}>
            <div className="card" style={{ padding: 16 }}>
              <div><strong>Date:</strong> {tournament.startDate ? formatFriendlyDate(tournament.startDate) : 'Date to be announced'}</div>
              <div><strong>Organizer:</strong> {tournament.organizerName || 'Golf Homiez organizer'}</div>
              <div><strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</div>
              {portal ? <TournamentPublicSlotSummary portal={portal} /> : null}
            </div>
            <div className="card" style={{ padding: 16 }}>
              <strong>Registration</strong>
              <p className="small">Only golfers signed in with a Golf Homiez user account can register. Select one of your existing two-person or four-person teams, or create a new tournament team.</p>
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
                        {teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.members?.length || 0} players)</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="formStack">
                      <div>
                        <label className="label">Team name</label>
                        <input className="input" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" />
                      </div>
                      <div className="small">Add 1 or 3 teammates. You are automatically included, so tournament teams must total exactly 2 or 4 players.</div>
                      {newTeamMembers.map((member, index) => (
                        <div key={member.id} className="grid tournament-registration-member-row" style={{ gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                          <input className="input" value={member.name} onChange={(e) => setNewTeamMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, name: e.target.value } : item))} placeholder={`Teammate ${index + 1} name`} />
                          <input className="input" value={member.email} onChange={(e) => setNewTeamMembers((prev) => prev.map((item) => item.id === member.id ? { ...item, email: e.target.value } : item))} placeholder="email@example.com" />
                          <button type="button" className="btn" onClick={() => setNewTeamMembers((prev) => prev.filter((item) => item.id !== member.id))}>Remove</button>
                        </div>
                      ))}
                      {newTeamMembers.length < 3 ? <button type="button" className="btn" onClick={() => setNewTeamMembers((prev) => [...prev, { id: crypto.randomUUID(), name: '', email: '' }])}>+ Add teammate</button> : null}
                    </div>
                  )}
                </div>
              ) : null}
              {registered ? (
                <div className="small" style={{ color: '#166534', fontWeight: 700 }}>You are already registered for this tournament.</div>
              ) : slotsFull ? (
                <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>Tournament team slots are full.</div>
              ) : (
                <button className="btn btnPrimary" type="button" disabled={registering || registrationClosed || authLoading || slotsFull} onClick={onRegister}>
                  {registering ? 'Registering…' : user ? 'Register for tournament team' : 'Create account to register'}
                </button>
              )}
            </div>
            </div>
          </>
        ) : <Link className="btn" to="/">Go home</Link>}
      </div>
    </div>
  )
}
