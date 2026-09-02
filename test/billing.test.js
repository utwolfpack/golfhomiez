import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCheckoutBranding, buildCheckoutExperience, buildPortalSession, decryptAccessCode, encryptAccessCode, nextMonthEndAfter } from '../server/lib/billing.js'

test('first bill date is the next last calendar day after the free 30-day threshold', () => {
  assert.equal(nextMonthEndAfter(new Date('2026-01-30T12:00:00Z')).toISOString(), '2026-01-31T12:00:00.000Z')
  assert.equal(nextMonthEndAfter(new Date('2026-02-01T12:00:00Z')).toISOString(), '2026-02-28T12:00:00.000Z')
  assert.equal(nextMonthEndAfter(new Date('2028-02-01T12:00:00Z')).toISOString(), '2028-02-29T12:00:00.000Z')
})

test('billing migration preserves existing golfers and stores code hashes instead of plaintext', () => {
  const sql = fs.readFileSync(new URL('../migration_scripts/20260901_082_stripe_billing.sql', import.meta.url), 'utf8')
  assert.match(sql, /legacy_free/)
  assert.match(sql, /code_hash CHAR\(64\)/)
  assert.doesNotMatch(sql, /\bcode\s+VARCHAR/i)
  assert.match(sql, /UNIQUE KEY uq_billing_user_permanent_grant/)
})

test('admin-visible access codes are encrypted at rest and can be recovered with the deployment secret', () => {
  const previousSecret = process.env.ACCESS_CODE_HASH_SECRET
  process.env.ACCESS_CODE_HASH_SECRET = 'test-only-secret-with-enough-entropy-for-encryption'
  try {
    const encrypted = encryptAccessCode('GH-FRIENDS-2026')
    assert.notEqual(encrypted, 'GH-FRIENDS-2026')
    assert.doesNotMatch(encrypted, /GH-FRIENDS-2026/)
    assert.equal(decryptAccessCode(encrypted), 'GH-FRIENDS-2026')
  } finally {
    if (previousSecret == null) delete process.env.ACCESS_CODE_HASH_SECRET
    else process.env.ACCESS_CODE_HASH_SECRET = previousSecret
  }
})

test('billing detail migration is registered for install-time production deployment', () => {
  const sql = fs.readFileSync(new URL('../migration_scripts/20260902_083_billing_onboarding_details.sql', import.meta.url), 'utf8')
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  assert.match(migrations, /20260902_083/)
  assert.match(sql, /code_ciphertext TEXT/)
  assert.match(sql, /payment_method_last_four CHAR\(4\)/)
  assert.match(sql, /payment_method_exp_month/)
  assert.match(sql, /payment_method_exp_year/)
})

test('server uses raw signed Stripe webhooks before JSON parsing and enforces paid access', () => {
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const webhook = source.indexOf("app.post('/api/stripe/webhook'")
  const json = source.indexOf('app.use(express.json')
  assert.ok(webhook > 0 && webhook < json)
  assert.match(source, /stripe-signature/)
  assert.match(source, /BILLING_ACCESS_REQUIRED/)
  assert.match(source, /BILLING_SETUP_REQUIRED/)
  assert.match(source, /PROFILE_SETUP_REQUIRED/)
  assert.match(source, /billing\/checkout\/complete/)
})

test('requested admin and payment interfaces expose details and enforce one-at-a-time expansion', () => {
  const admin = fs.readFileSync(new URL('../src/pages/AdminAccessCodes.tsx', import.meta.url), 'utf8')
  const billing = fs.readFileSync(new URL('../src/pages/Billing.tsx', import.meta.url), 'utf8')
  const protectedRoute = fs.readFileSync(new URL('../src/components/ProtectedRoute.tsx', import.meta.url), 'utf8')

  assert.match(admin, /expandedId/)
  assert.match(admin, /aria-expanded/)
  assert.match(admin, /item\.code/)
  assert.doesNotMatch(admin, /••••\{item\.codeLastFour\}/)
  assert.match(admin, /Generated/)
  assert.match(admin, /Redemption activity/)
  assert.match(admin, /Account ID:/)

  assert.match(billing, /Payment Information/)
  assert.match(billing, /Golf Homiez is only \$0\.99 per month/)
  assert.match(billing, /ending in \{status\.paymentMethod\.lastFour\}/)
  assert.match(billing, /Expires/)
  assert.match(billing, /Homie Token \$\{status\.accessCode/)
  assert.doesNotMatch(billing, /No refunds except where required by law/)
  assert.match(protectedRoute, /!billingStatus\.setupComplete/)
  assert.match(protectedRoute, /needsProfileEnrichment/)
})

test('billing transactions emit correlated API and frontend lifecycle logs', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const billingServer = fs.readFileSync(new URL('../server/lib/billing.js', import.meta.url), 'utf8')
  const billingUi = fs.readFileSync(new URL('../src/pages/Billing.tsx', import.meta.url), 'utf8')
  assert.match(server, /billing_checkout_created/)
  assert.match(server, /billing_status_loaded/)
  assert.match(billingServer, /billing_access_code_redeemed/)
  assert.match(billingUi, /logFrontendEvent/)
  assert.match(billingUi, /homie_token_applied/)
})

test('Checkout return reconciles the exact session and Homie Tokens are admin-defined', () => {
  const billing = fs.readFileSync(new URL('../server/lib/billing.js', import.meta.url), 'utf8')
  assert.match(billing, /session_id=\{CHECKOUT_SESSION_ID\}/)
  assert.match(billing, /checkout\.sessions\.retrieve/)
  assert.match(billing, /session\.metadata\?\.golfhomiez_user_id !== user\.id/)
  assert.match(billing, /input\.homieToken \|\| input\.code/)
  assert.doesNotMatch(billing, /crypto\.randomBytes\(9\).*base64url/)
})

test('admin portal uses Homie Token, Paid Homie, and tournament lifecycle metrics', () => {
  const portal = fs.readFileSync(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8')
  const billing = fs.readFileSync(new URL('../server/lib/billing.js', import.meta.url), 'utf8')
  assert.match(portal, /label="Homie Token"/)
  assert.match(portal, /label="Paid Homie"/)
  assert.match(portal, /label="Tournaments Completed"/)
  assert.match(portal, /label="Tournaments Created"/)
  assert.doesNotMatch(portal, /label="Verified users"/)
  assert.match(portal, /generated_user_count/)
  assert.match(billing, /BINARY users\.id = BINARY accounts\.user_id/)
  assert.match(billing, /BINARY redemptions\.user_id = BINARY accounts\.user_id/)
})

test('Stripe Checkout sessions use safe Golf Homiez branding defaults and optional HTTPS artwork', () => {
  const defaults = buildCheckoutBranding({})
  assert.deepEqual(defaults, {
    display_name: 'Golf Homiez',
    background_color: '#F6FBF7',
    button_color: '#15803D',
    font_family: 'inter',
    border_style: 'rounded',
  })

  const customized = buildCheckoutBranding({
    STRIPE_CHECKOUT_BRAND_NAME: 'Golf Homiez Members',
    STRIPE_CHECKOUT_BACKGROUND_COLOR: '#FFFFFF',
    STRIPE_CHECKOUT_BUTTON_COLOR: '#14532D',
    STRIPE_CHECKOUT_FONT_FAMILY: 'lato',
    STRIPE_CHECKOUT_BORDER_STYLE: 'pill',
    STRIPE_CHECKOUT_LOGO_URL: 'https://golfhomiez.example/logo.png',
    STRIPE_CHECKOUT_ICON_URL: 'https://golfhomiez.example/icon.png',
  })
  assert.equal(customized.display_name, 'Golf Homiez Members')
  assert.equal(customized.logo.url, 'https://golfhomiez.example/logo.png')
  assert.equal(customized.icon, undefined, 'Stripe does not allow a logo and icon in the same session')

  const invalid = buildCheckoutBranding({ STRIPE_CHECKOUT_BUTTON_COLOR: 'green', STRIPE_CHECKOUT_LOGO_URL: 'http://unsafe.example/logo.png' })
  assert.equal(invalid.button_color, '#15803D')
  assert.equal(invalid.logo, undefined)
})

test('Stripe Checkout messaging, consent, and focused Customer Portal return flow are configured', () => {
  const experience = buildCheckoutExperience({ STRIPE_REQUIRE_TERMS_ACCEPTANCE: 'true' })
  assert.equal(experience.submit_type, 'subscribe')
  assert.equal(experience.locale, 'auto')
  assert.equal(experience.consent_collection.terms_of_service, 'required')
  assert.match(experience.custom_text.submit.message, /Golf Homiez membership/)

  const portal = buildPortalSession('cus_golfhomiez', 'https://golfhomiez.example/profile/billing?portal=complete', {
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_golfhomiez',
    STRIPE_PORTAL_DIRECT_PAYMENT_UPDATE: 'true',
  })
  assert.equal(portal.configuration, 'bpc_golfhomiez')
  assert.equal(portal.flow_data.type, 'payment_method_update')
  assert.equal(portal.flow_data.after_completion.redirect.return_url, portal.return_url)
})

test('Stripe portal setup remains idempotent and preserves the application cancellation policy', () => {
  const source = fs.readFileSync(new URL('../server/scripts/configure-stripe-portal.js', import.meta.url), 'utf8')
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dependencies.stripe, '^20.4.0')
  assert.equal(pkg.scripts['stripe:configure-portal'], 'node server/scripts/configure-stripe-portal.js')
  assert.match(source, /configurations\.list/)
  assert.match(source, /configurations\.update/)
  assert.match(source, /configurations\.create/)
  assert.match(source, /subscription_cancel: \{ enabled: false \}/)
  assert.match(source, /payment_method_update: \{ enabled: true \}/)
})
