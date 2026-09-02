# Billing onboarding and access-code directions

## Application paths

- Golfer profile setup: `/profile`
- Golfer payment and promo-code setup: `/profile/billing`
- Admin-generated access codes: `/golfadmin/access-codes`

New golfers must complete required profile information first, then either add a payment method or apply a promo code. Client and API route guards keep incomplete accounts in these recovery paths. The API independently enforces the same requirements for protected golfer endpoints.

The admin access-code page shows each full generated code and generation date in a collapsed line item. Expanding one item collapses the previously open item and shows expiration, status, limits, and the accounts and dates associated with redemptions.

## Environment and deployment

Configure the billing variables documented in `.env.example`. `ACCESS_CODE_HASH_SECRET` protects both the keyed redemption lookup hash and the encrypted, admin-recoverable code value. Use the same strong secret in every instance that must read codes created by that environment. Changing this secret prevents existing access codes from being redeemed or displayed.

No port is embedded in this feature. The application server continues to read `PORT` from `.env`/the deployment environment.

Run:

```text
npm install
```

The existing `postinstall` workflow runs `npm run db:migrate` before the production build. It applies:

- `migration_scripts/20260901_082_stripe_billing.sql`
- `migration_scripts/20260902_083_billing_onboarding_details.sql`

Set `REQUIRE_DB_MIGRATIONS=true` in production so installation fails instead of silently skipping migrations when the database is unavailable. Back up the production database before deployment. The migration runner also creates its configured schema backup and tracks applied versions in `app_schema_migrations`.

## Logging and diagnosis

Every browser request includes `X-Correlation-Id`; the server returns the same ID and carries it through asynchronous request logging. Search one correlation ID across:

- `logging/access.log` for HTTP method, path, response status, and duration
- `logging/api.log` for billing, access-code, onboarding-gate, and webhook transactions
- `logging/error.log` for server and Stripe failures
- `logging/frontend.log` for browser API lifecycle events and UI actions

Access-code values and complete payment details are not written to logs. Only Stripe-safe display data (card brand, last four digits, and expiration) is stored locally. Full generated codes are encrypted at rest while a keyed hash remains the redemption lookup value.

## Stripe configuration

Configure the Stripe webhook to send subscription, invoice, and `checkout.session.completed` events to `/api/stripe/webhook`. The scheduled `reconcileStripeSubscriptions` job repairs delayed subscription state. The billing status endpoint refreshes safe payment-method display data from Stripe when a customer exists.

### Golf Homiez hosted-page branding

Every Checkout Session now applies these environment-controlled defaults:

- Display name: `Golf Homiez`
- Background: `#F6FBF7`
- Primary button: `#15803D`
- Font: `inter`
- Border style: `rounded`
- Golf Homiez membership and welcome messages

Set `STRIPE_CHECKOUT_LOGO_URL` to a public HTTPS logo URL. If a wide logo is not available, leave it blank and set `STRIPE_CHECKOUT_ICON_URL` to a square public HTTPS image. Stripe does not allow both on the same Checkout Session, so the application gives the logo priority. Invalid colors, fonts, border values, or non-HTTPS image URLs safely fall back to the Golf Homiez defaults.

To require Checkout terms acceptance, first configure a public terms URL in Stripe's Public details, then set:

```text
STRIPE_REQUIRE_TERMS_ACCEPTANCE=true
STRIPE_TERMS_OF_SERVICE_URL=https://your-domain.example/terms
STRIPE_PRIVACY_POLICY_URL=https://your-domain.example/privacy
```

### Customer Portal

After configuring the Stripe secret, client origin, and public policy URLs, run:

```text
npm run stripe:configure-portal
```

The command idempotently creates or updates the `Golf Homiez customer portal` configuration. Copy the returned `bpc_...` value into `STRIPE_PORTAL_CONFIGURATION_ID` for that environment. The configuration lets golfers update their name, phone, billing address, and payment method and view invoices. Stripe-side subscription cancellation is disabled intentionally so it cannot bypass Golf Homiez's 14-day cancellation rule.

The application opens the portal directly in its payment-method update flow and returns to `/profile/billing?portal=complete`. Set `STRIPE_PORTAL_DIRECT_PAYMENT_UPDATE=false` only if you intentionally want the portal home page instead.

Stripe Customer Portal appearance is account-wide. In Stripe Dashboard **Settings → Branding**, upload the Golf Homiez icon/logo and set the same green colors, Inter font, and rounded shapes used by Checkout. Those settings also brand supported Stripe emails, receipts, and invoices.

### Custom payment domain

In Stripe Dashboard **Settings → Custom domains**, connect a subdomain such as `payments.your-domain.example`. Add the CNAME and TXT verification records Stripe provides. Checkout and Customer Portal sessions created by this application automatically use the account's verified custom domain; no application port or URL is hardcoded. Stripe custom domains are a paid Stripe feature.

Test all branding and portal behavior in a Stripe sandbox before repeating the Dashboard configuration and `npm run stripe:configure-portal` with live-mode credentials.
