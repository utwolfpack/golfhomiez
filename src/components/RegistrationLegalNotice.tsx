import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import golfHomiezEmblem from '../assets/GolfHomiezEmblem.png'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'

type LegalDocument = 'terms' | 'privacy'

type Props = {
  accountType: 'golfer' | 'host' | 'organizer'
  actionLabel: string
}

const LAST_UPDATED = 'September 18, 2026'

function TermsContent() {
  return (
    <>
      <p>
        These Terms and Conditions govern access to and use of GolfHomiez, including the GolfHomiez website,
        score logging, teams, challenges, golf-course pages, tournaments, host and organizer tools, pictures,
        messaging, support, and related services (collectively, the “Service”). By creating or requesting an
        account, accessing the Service, or using a GolfHomiez feature, you agree to these Terms.
      </p>

      <h3>Account eligibility and responsibility</h3>
      <p>
        You must be legally able to enter into these Terms and must provide accurate, current information. You
        are responsible for protecting your account credentials and for activity performed through your account.
        Tell GolfHomiez promptly through Support if you believe your account has been accessed without permission.
      </p>

      <h3>Golf scores, teams, challenges, and tournaments</h3>
      <p>
        GolfHomiez provides tools to record golf activity and coordinate play. You are responsible for the
        accuracy of scores, rosters, challenge details, tournament registrations, dates, course information, and
        other information you submit. Course data, distances, handicaps, rankings, results, and other calculated
        information are provided as convenience features and should be reviewed before being relied upon for an
        official competition or decision.
      </p>

      <h3>Host and organizer responsibilities</h3>
      <p>
        Golf-course hosts and tournament organizers may publish event information, invite participants, manage
        registrations, send messages, and administer tournament content. If you use those features, you represent
        that you are authorized to act for the golf course, tournament, or organization you identify and that you
        have permission to provide the participant and event information you submit.
      </p>

      <h3>User content and pictures</h3>
      <p>
        You retain ownership of content you submit. You give GolfHomiez permission to store, process, resize,
        display, and otherwise use that content as needed to operate the features you choose, including round,
        challenge, tournament, course, and support features. Do not upload content that you do not have the right
        to use or that violates another person’s privacy, intellectual-property, or other legal rights.
      </p>

      <h3>Payments and third-party services</h3>
      <p>
        Some GolfHomiez features may use third-party services, including payment, email, mapping, analytics, golf
        course data, media, and hosting providers. When a payment feature is used, payment information may be
        processed by GolfHomiez’s payment provider rather than stored directly by GolfHomiez. Third-party services
        may also have their own terms and privacy practices.
      </p>

      <h3>Acceptable use</h3>
      <p>
        You may not misuse the Service, attempt unauthorized access, interfere with security or availability,
        impersonate another person or organization, submit unlawful or deceptive content, scrape or automate use
        in a manner that harms the Service, distribute malware, or use GolfHomiez to harass or abuse another user.
      </p>

      <h3>Service availability and changes</h3>
      <p>
        GolfHomiez may update features, correct errors, change or discontinue functionality, or perform maintenance.
        GolfHomiez does not guarantee that every feature, course record, external data source, or third-party
        integration will always be available, current, complete, or error-free.
      </p>

      <h3>GolfHomiez intellectual property</h3>
      <p>
        GolfHomiez branding, software, interfaces, documentation, and original service content are owned by
        GolfHomiez or its licensors and may not be copied, modified, or used to imply endorsement without
        permission, except as allowed by law.
      </p>

      <h3>Suspension and termination</h3>
      <p>
        GolfHomiez may restrict or terminate access when reasonably necessary to protect users or the Service,
        comply with law, address fraud or security concerns, or respond to a material violation of these Terms.
        You may stop using the Service at any time.
      </p>

      <h3>Disclaimer and limitation of liability</h3>
      <p>
        The Service is provided on an “as is” and “as available” basis to the extent permitted by law. GolfHomiez
        does not warrant that the Service will be uninterrupted or that third-party data will always be accurate.
        To the fullest extent permitted by law, GolfHomiez is not liable for indirect, incidental, special,
        consequential, exemplary, or punitive damages arising from use of, or inability to use, the Service.
      </p>

      <h3>Changes to these Terms</h3>
      <p>
        GolfHomiez may update these Terms as the Service changes. The current version will identify its last-updated
        date. Continued use after an updated version becomes effective constitutes acceptance to the extent allowed
        by law. Questions about these Terms may be submitted through the GolfHomiez Support page.
      </p>
    </>
  )
}

function PrivacyContent() {
  return (
    <>
      <p>
        This Privacy Policy explains how GolfHomiez collects, uses, and shares information when you use GolfHomiez
        score logging, teams, challenges, golf-course pages, tournaments, host and organizer tools, pictures,
        messaging, support, payments, and related features.
      </p>

      <h3>Information GolfHomiez collects</h3>
      <p>
        Depending on the features you use, GolfHomiez may collect account and profile information such as name,
        email address, phone number, city, state, and profile preferences; golf activity such as courses, dates,
        scores, hole-by-hole details, teams, challenges, tournament registrations, and results; host or organizer
        account and event information; pictures and other content you upload; support requests and messages; and
        transaction or subscription records associated with GolfHomiez services.
      </p>
      <p>
        GolfHomiez also receives technical information needed to run and secure the Service, such as IP address,
        browser or device information, request and error logs, correlation identifiers, session information, and
        feature interactions. Precise device location is collected only when a location-enabled feature is used and
        your device/browser permits access.
      </p>

      <h3>When information is collected</h3>
      <p>
        Information is collected when you register, sign in, update a profile, log a round, create or join a team
        or challenge, register for or administer a tournament, upload content, send messages, request support, use
        location-enabled course features, make a payment, or otherwise interact with the Service.
      </p>

      <h3>How GolfHomiez uses information</h3>
      <p>
        GolfHomiez uses information to authenticate accounts; provide scoring, handicap, course, team, challenge,
        tournament, messaging, image, and support features; process account access and payments; send service and
        verification communications; personalize relevant in-app information; prevent abuse and diagnose errors;
        measure application reliability and usage; and comply with legal obligations.
      </p>

      <h3>How information is shared</h3>
      <p>
        Information is shared with other GolfHomiez users when a feature requires it—for example, team rosters,
        challenge participants, tournament registrations, leaderboards, course-hosted events, messages, or public
        course/tournament pages. GolfHomiez may also share information with service providers that perform hosting,
        email, payment, analytics, mapping, media, data, or security functions on GolfHomiez’s behalf, and when
        disclosure is required by law or reasonably necessary to protect users, GolfHomiez, or the Service.
      </p>
      <p>
        GolfHomiez does not sell personal information for money. If GolfHomiez materially changes how personal
        information is used or shared, this policy will be updated before the new practice is applied where notice
        is required by law.
      </p>

      <h3>Payments</h3>
      <p>
        Payment-card details used with GolfHomiez payment features are handled by the configured payment provider.
        GolfHomiez may retain transaction identifiers, billing status, and related records needed to provide access,
        reconcile transactions, prevent fraud, and support customers, but GolfHomiez does not need to store the full
        payment-card number to provide those features.
      </p>

      <h3>Cookies, sessions, and local storage</h3>
      <p>
        GolfHomiez uses browser cookies, session identifiers, and local browser storage when needed to keep you
        signed in, remember application state and preferences, restore in-progress scoring activity, protect account
        sessions, and understand or diagnose application behavior. Blocking required browser storage may prevent
        some features from working correctly.
      </p>

      <h3>Data retention and security</h3>
      <p>
        GolfHomiez keeps information for as long as reasonably necessary to operate the Service, maintain account
        and transaction history, resolve support or security issues, and satisfy legal requirements. GolfHomiez uses
        reasonable administrative and technical safeguards, but no internet service can guarantee absolute security.
      </p>

      <h3>Your choices</h3>
      <p>
        You can update available profile information through GolfHomiez account features and can choose whether to
        use optional location and upload features. You may contact GolfHomiez through Support with questions about
        your information or requests available under applicable privacy law. Some information may need to be retained
        when required for security, fraud prevention, accounting, dispute resolution, or legal compliance.
      </p>

      <h3>Children</h3>
      <p>
        GolfHomiez is not directed to children under 13 and does not knowingly seek personal information from a child
        under 13 without legally required authorization.
      </p>

      <h3>Changes to this Privacy Policy</h3>
      <p>
        GolfHomiez may update this Privacy Policy as features, vendors, and legal requirements change. The current
        version will identify its last-updated date. Privacy questions may be submitted through the GolfHomiez Support
        page.
      </p>
    </>
  )
}

export default function RegistrationLegalNotice({ accountType, actionLabel }: Props) {
  const [openDocument, setOpenDocument] = useState<LegalDocument | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!openDocument) return

    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenDocument(null)
    }
    window.addEventListener('keydown', onKeyDown)

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior
    }
  }, [openDocument])

  function openLegalDocument(document: LegalDocument) {
    setOpenDocument(document)
    logFrontendEvent({
      category: 'registration.legal',
      message: 'registration_legal_document_opened',
      data: { correlationId: getCorrelationId(), accountType, document },
    })
  }

  function closeLegalDocument(source: 'close_button' | 'overlay') {
    if (!openDocument) return
    logFrontendEvent({
      category: 'registration.legal',
      message: 'registration_legal_document_closed',
      data: { correlationId: getCorrelationId(), accountType, document: openDocument, source },
    })
    setOpenDocument(null)
  }

  const title = openDocument === 'terms' ? 'Terms and Conditions' : 'Privacy Policy'

  return (
    <>
      <div className="registrationLegalNotice">
        By selecting <strong>{actionLabel}</strong>, you agree to the GolfHomiez{' '}
        <a href="#golfhomiez-terms" onClick={(event) => { event.preventDefault(); openLegalDocument('terms') }}>Terms and Conditions</a>{' '}
        and acknowledge the GolfHomiez{' '}
        <a href="#golfhomiez-privacy" onClick={(event) => { event.preventDefault(); openLegalDocument('privacy') }}>Privacy Policy</a>.
      </div>

      {openDocument && typeof document !== 'undefined'
        ? createPortal(
            <div className="modalOverlay registrationLegalOverlay" onMouseDown={() => closeLegalDocument('overlay')}>
              <div className="modalCard registrationLegalModal" role="dialog" aria-modal="true" aria-labelledby="registration-legal-title" onMouseDown={(event) => event.stopPropagation()}>
                <header className="registrationLegalHeader">
                  <div className="registrationLegalBrand">
                    <img src={golfHomiezEmblem} alt="GolfHomiez" />
                    <div>
                      <span>GolfHomiez</span>
                      <h2 id="registration-legal-title">{title}</h2>
                    </div>
                  </div>
                  <button ref={closeButtonRef} className="btn btnSmall registrationLegalClose" type="button" onClick={() => closeLegalDocument('close_button')}>Close</button>
                </header>
                <div className="registrationLegalUpdated">Last updated {LAST_UPDATED}</div>
                <div className="registrationLegalBody">
                  {openDocument === 'terms' ? <TermsContent /> : <PrivacyContent />}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
