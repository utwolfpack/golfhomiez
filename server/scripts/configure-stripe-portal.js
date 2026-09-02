import 'dotenv/config'
import Stripe from 'stripe'

const CONFIGURATION_NAME = 'Golf Homiez customer portal'

function optionalHttpsUrl(value, label) {
  const candidate = String(value || '').trim()
  if (!candidate) return undefined
  const parsed = new URL(candidate)
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !localHttp) throw new Error(`${label} must use HTTPS.`)
  return parsed.toString()
}

export function buildGolfHomiezPortalConfiguration(env = process.env) {
  const appUrl = optionalHttpsUrl(env.CLIENT_ORIGIN, 'CLIENT_ORIGIN')
  if (!appUrl) throw new Error('CLIENT_ORIGIN is required to configure the Stripe customer portal.')
  const privacyPolicyUrl = optionalHttpsUrl(env.STRIPE_PRIVACY_POLICY_URL, 'STRIPE_PRIVACY_POLICY_URL')
  const termsUrl = optionalHttpsUrl(env.STRIPE_TERMS_OF_SERVICE_URL, 'STRIPE_TERMS_OF_SERVICE_URL')

  return {
    name: CONFIGURATION_NAME,
    business_profile: {
      headline: String(env.STRIPE_PORTAL_HEADLINE || 'Manage your Golf Homiez membership and payment details.').trim().slice(0, 60),
      ...(privacyPolicyUrl ? { privacy_policy_url: privacyPolicyUrl } : {}),
      ...(termsUrl ? { terms_of_service_url: termsUrl } : {}),
    },
    default_return_url: new URL('/profile/billing?portal=complete', appUrl).toString(),
    features: {
      customer_update: { enabled: true, allowed_updates: ['address', 'name', 'phone'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      // Cancellation remains in Golf Homiez so the application's 14-day rule cannot be bypassed.
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false, default_allowed_updates: [] },
    },
    metadata: { managed_by: 'golfhomiez', purpose: 'billing_portal' },
  }
}

async function main() {
  const secret = String(process.env.STRIPE_SECRET_KEY || '').trim()
  if (!secret) throw new Error('STRIPE_SECRET_KEY is required.')
  const stripe = new Stripe(secret)
  const desired = buildGolfHomiezPortalConfiguration()
  const configurations = await stripe.billingPortal.configurations.list({ limit: 100 })
  const existing = configurations.data.find((item) => item.active && (item.name === CONFIGURATION_NAME || item.metadata?.managed_by === 'golfhomiez'))
  const configuration = existing
    ? await stripe.billingPortal.configurations.update(existing.id, desired)
    : await stripe.billingPortal.configurations.create(desired)

  console.log(`Stripe customer portal configuration ready: ${configuration.id}`)
  console.log(`Set STRIPE_PORTAL_CONFIGURATION_ID=${configuration.id} in this environment.`)
}

main().catch((error) => {
  console.error('Stripe customer portal configuration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
