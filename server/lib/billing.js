import crypto, { randomUUID } from 'crypto'
import Stripe from 'stripe'
import { logApi, logError } from './logger.js'

const DAY_MS = 86_400_000
const billingEnabled = () => String(process.env.BILLING_ENABLED || '').toLowerCase() === 'true'
const fromUnix = (value) => value ? new Date(Number(value) * 1000) : null
const mysqlDate = (value) => value ? new Date(value).toISOString().slice(0, 19).replace('T', ' ') : null

function envText(name, fallback = '', maxLength = 1200) {
  return String(process.env[name] || fallback).trim().slice(0, maxLength)
}

function httpsUrl(value) {
  const candidate = String(value || '').trim()
  if (!candidate) return ''
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch { return '' }
}

function hexColor(value, fallback) {
  const candidate = String(value || '').trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : fallback
}

export function buildCheckoutBranding(env = process.env) {
  const fonts = new Set(['be_vietnam_pro', 'bitter', 'chakra_petch', 'default', 'hahmlet', 'inconsolata', 'inter', 'lato', 'lora', 'm_plus_1_code', 'montserrat', 'noto_sans', 'noto_serif', 'nunito', 'open_sans', 'prata', 'pt_sans', 'pt_serif', 'raleway', 'roboto', 'roboto_slab', 'source_sans_pro', 'titillium_web', 'ubuntu'])
  const borders = new Set(['pill', 'rectangular', 'rounded'])
  const font = String(env.STRIPE_CHECKOUT_FONT_FAMILY || 'inter').trim().toLowerCase()
  const border = String(env.STRIPE_CHECKOUT_BORDER_STYLE || 'rounded').trim().toLowerCase()
  const logoUrl = httpsUrl(env.STRIPE_CHECKOUT_LOGO_URL)
  const iconUrl = logoUrl ? '' : httpsUrl(env.STRIPE_CHECKOUT_ICON_URL)
  return {
    display_name: String(env.STRIPE_CHECKOUT_BRAND_NAME || 'Golf Homiez').trim().slice(0, 100) || 'Golf Homiez',
    background_color: hexColor(env.STRIPE_CHECKOUT_BACKGROUND_COLOR, '#F6FBF7'),
    button_color: hexColor(env.STRIPE_CHECKOUT_BUTTON_COLOR, '#15803D'),
    font_family: fonts.has(font) ? font : 'inter',
    border_style: borders.has(border) ? border : 'rounded',
    ...(logoUrl ? { logo: { type: 'url', url: logoUrl } } : {}),
    ...(iconUrl ? { icon: { type: 'url', url: iconUrl } } : {}),
  }
}

export function buildCheckoutExperience(env = process.env) {
  const submitMessage = String(env.STRIPE_CHECKOUT_SUBMIT_MESSAGE || 'Your Golf Homiez membership helps us keep building a better golf community.').trim().slice(0, 1200)
  const afterMessage = String(env.STRIPE_CHECKOUT_AFTER_SUBMIT_MESSAGE || 'Welcome to the Golf Homiez Community!').trim().slice(0, 1200)
  return {
    branding_settings: buildCheckoutBranding(env),
    locale: 'auto',
    submit_type: 'subscribe',
    custom_text: {
      ...(submitMessage ? { submit: { message: submitMessage } } : {}),
      ...(afterMessage ? { after_submit: { message: afterMessage } } : {}),
    },
    ...(envBooleanFrom(env.STRIPE_REQUIRE_TERMS_ACCEPTANCE, false) ? { consent_collection: { terms_of_service: 'required' } } : {}),
  }
}

function envBooleanFrom(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

export function buildPortalSession(customerId, returnUrl, env = process.env) {
  const configuration = String(env.STRIPE_PORTAL_CONFIGURATION_ID || '').trim()
  const focusedPaymentUpdate = envBooleanFrom(env.STRIPE_PORTAL_DIRECT_PAYMENT_UPDATE, true)
  return {
    customer: customerId,
    return_url: returnUrl,
    ...(configuration ? { configuration } : {}),
    ...(focusedPaymentUpdate ? {
      flow_data: {
        type: 'payment_method_update',
        after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
      },
    } : {}),
  }
}

function stripeClient() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim()
  if (!key) throw new Error('STRIPE_SECRET_KEY is required when billing is enabled')
  return new Stripe(key)
}

function priceId() {
  const value = String(process.env.STRIPE_PRICE_ID || '').trim()
  if (!value) throw new Error('STRIPE_PRICE_ID is required when billing is enabled')
  return value
}

function accessCodeSecret() {
  const secret = String(process.env.ACCESS_CODE_HASH_SECRET || '').trim()
  if (!secret) throw new Error('ACCESS_CODE_HASH_SECRET is required for access codes')
  return secret
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase()
}

function codeHash(code) {
  return crypto.createHmac('sha256', accessCodeSecret()).update(normalizeCode(code)).digest('hex')
}

export function encryptAccessCode(code) {
  const iv = crypto.randomBytes(12)
  const key = crypto.createHash('sha256').update(accessCodeSecret()).digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(normalizeCode(code), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':')
}

export function decryptAccessCode(value) {
  if (!value) return null
  const [version, ivValue, tagValue, encryptedValue] = String(value).split(':')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) return null
  const key = crypto.createHash('sha256').update(accessCodeSecret()).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
}

function nextMonthEndAfter(date) {
  const threshold = new Date(date)
  for (let offset = 0; offset < 3; offset += 1) {
    const candidate = new Date(Date.UTC(threshold.getUTCFullYear(), threshold.getUTCMonth() + offset + 1, 0, 12, 0, 0))
    if (candidate > threshold) return candidate
  }
  throw new Error('Could not calculate billing date')
}

async function activeRoles(pool, user) {
  try {
    const [rows] = await pool.execute(
      `SELECT role_key FROM user_role_assignments
        WHERE status = 'active' AND (auth_user_id = ? OR LOWER(email) = LOWER(?))`,
      [user.id, user.email],
    )
    return new Set(rows.map((row) => String(row.role_key || '').toLowerCase()))
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return new Set()
    throw error
  }
}

export async function ensureBillingAccount(pool, user, now = new Date()) {
  const trialEnds = new Date(now.getTime() + 30 * DAY_MS)
  await pool.execute(
    `INSERT IGNORE INTO billing_accounts
      (user_id, access_source, subscription_status, trial_started_at, trial_ends_at, initial_trial_consumed)
     VALUES (?, 'trial', 'trialing', ?, ?, 1)`,
    [user.id, mysqlDate(now), mysqlDate(trialEnds)],
  )
  const [[row]] = await pool.execute('SELECT * FROM billing_accounts WHERE user_id = ? LIMIT 1', [user.id])
  return row
}

export async function getBillingStatus(pool, user, now = new Date()) {
  if (!billingEnabled()) return { enabled: false, accessAllowed: true, setupComplete: true, accessSource: 'billing_disabled' }
  let account = await ensureBillingAccount(pool, user, now)
  if (account.stripe_customer_id) {
    try {
      if (!account.stripe_subscription_id) {
        await syncCustomerSubscription(pool, account)
        account = await ensureBillingAccount(pool, user, now)
      }
      await syncCustomerPaymentMethod(pool, account)
      account = await ensureBillingAccount(pool, user, now)
    } catch (error) {
      logError('billing_payment_method_refresh_failed', { error, userId: user.id })
    }
  }
  const roles = await activeRoles(pool, user)
  let accessSource = account.access_source
  let accessAllowed = false
  if (roles.has('host')) { accessSource = 'complimentary_host'; accessAllowed = true }
  else if (accessSource === 'legacy_free' || accessSource === 'code_free') accessAllowed = true
  else if (roles.has('organizer')) { accessSource = 'complimentary_organizer'; accessAllowed = true }
  else if (account.subscription_status === 'active' || account.subscription_status === 'trialing') accessAllowed = true
  else if (account.trial_ends_at && new Date(account.trial_ends_at) > now) accessAllowed = true
  else if (account.grace_ends_at && new Date(account.grace_ends_at) > now) accessAllowed = true

  const [[redemption]] = await pool.execute(
    `SELECT codes.code_ciphertext AS codeCiphertext, codes.code_last_four AS codeLastFour, codes.label
       FROM billing_access_code_redemptions redemptions
       JOIN billing_access_codes codes ON codes.id = redemptions.access_code_id
      WHERE redemptions.user_id = ?
      ORDER BY redemptions.redeemed_at DESC
      LIMIT 1`,
    [user.id],
  )
  let accessCode = null
  if (redemption?.codeCiphertext) {
    try { accessCode = decryptAccessCode(redemption.codeCiphertext) } catch (error) { logError('billing_access_code_decrypt_failed', { error, userId: user.id }) }
  }
  const complimentary = ['legacy_free', 'code_free', 'complimentary_host', 'complimentary_organizer'].includes(accessSource)
  const paymentMethod = account.payment_method_last_four ? {
    brand: account.payment_method_brand || 'Card',
    lastFour: account.payment_method_last_four,
    expMonth: account.payment_method_exp_month == null ? null : Number(account.payment_method_exp_month),
    expYear: account.payment_method_exp_year == null ? null : Number(account.payment_method_exp_year),
  } : null

  return {
    enabled: true,
    accessAllowed,
    setupComplete: complimentary || Boolean(paymentMethod),
    accessSource,
    accessCode: accessCode || (redemption?.codeLastFour ? `Code ending ${redemption.codeLastFour}` : null),
    accessCodeLabel: redemption?.label || null,
    subscriptionStatus: account.subscription_status,
    trialEndsAt: account.trial_ends_at,
    currentPeriodEndsAt: account.current_period_ends_at,
    cancelAtPeriodEnd: Boolean(account.cancel_at_period_end),
    cancellationAllowedAt: new Date(new Date(account.created_at).getTime() + 14 * DAY_MS),
    graceEndsAt: account.grace_ends_at,
    hasPaymentAccount: Boolean(account.stripe_customer_id),
    paymentMethod,
  }
}

export async function requireBillingAccess(pool, user) {
  const status = await getBillingStatus(pool, user)
  return status.accessAllowed ? status : null
}

export async function createCheckout(pool, user, baseUrl) {
  const account = await ensureBillingAccount(pool, user)
  const stripe = stripeClient()
  let customerId = account.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { golfhomiez_user_id: user.id } }, { idempotencyKey: `gh-customer-${user.id}` })
    customerId = customer.id
    await pool.execute('UPDATE billing_accounts SET stripe_customer_id = ? WHERE user_id = ?', [customerId, user.id])
  }
  const originalTrialEnd = account.trial_ends_at ? new Date(account.trial_ends_at) : null
  const firstSubscription = !account.stripe_subscription_id && !['canceled', 'unpaid'].includes(String(account.subscription_status || ''))
  const firstBillAt = firstSubscription && originalTrialEnd && originalTrialEnd > new Date() ? nextMonthEndAfter(originalTrialEnd) : null
  const checkout = {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId(), quantity: 1 }],
    success_url: `${baseUrl}/profile/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/profile/billing?checkout=cancelled`,
    billing_address_collection: 'required',
    customer_update: {
      address: 'auto',
    },
    automatic_tax: {
      enabled: true,
    },
    subscription_data: {
      metadata: {
        golfhomiez_user_id: user.id,
      },
      ...(firstBillAt
        ? { trial_end: Math.floor(firstBillAt.getTime() / 1000) }
        : {}),
    },
    allow_promotion_codes: false,
    metadata: {
      golfhomiez_user_id: user.id,
    },
    ...buildCheckoutExperience(),
  }
  const session = await stripe.checkout.sessions.create(checkout, { idempotencyKey: `gh-checkout-${user.id}-${Math.floor(Date.now() / 300000)}` })
  logApi('stripe_checkout_branded_session_created', {
    userId: user.id,
    hasLogo: Boolean(checkout.branding_settings.logo || checkout.branding_settings.icon),
    brandName: checkout.branding_settings.display_name,
    termsAcceptanceRequired: checkout.consent_collection?.terms_of_service === 'required',
  })
  return session.url
}

export async function completeCheckout(pool, user, sessionId) {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId.startsWith('cs_')) {
    const error = new Error('A valid Checkout session is required.')
    error.statusCode = 400
    throw error
  }
  const account = await ensureBillingAccount(pool, user)
  const session = await stripeClient().checkout.sessions.retrieve(normalizedSessionId, {
    expand: ['subscription', 'subscription.default_payment_method'],
  })
  if (session.status !== 'complete' || session.metadata?.golfhomiez_user_id !== user.id) {
    const error = new Error('Checkout is not complete for this account.')
    error.statusCode = 409
    throw error
  }
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  if (!customerId || customerId !== account.stripe_customer_id) {
    const error = new Error('Checkout customer does not match this account.')
    error.statusCode = 403
    throw error
  }
  const subscription = session.subscription
  if (subscription && typeof subscription !== 'string') await syncSubscription(pool, subscription)
  else if (typeof subscription === 'string') {
    await pool.execute('UPDATE billing_accounts SET stripe_subscription_id = ? WHERE user_id = ?', [subscription, user.id])
  }
  const refreshed = await ensureBillingAccount(pool, user)
  await syncCustomerPaymentMethod(pool, refreshed)
  logApi('billing_checkout_reconciled', { userId: user.id, checkoutSessionId: normalizedSessionId, stripeCustomerId: customerId })
  return getBillingStatus(pool, user)
}

export async function createPortal(pool, user, baseUrl) {
  const account = await ensureBillingAccount(pool, user)
  if (!account.stripe_customer_id) throw new Error('No payment account exists yet')
  const returnUrl = `${baseUrl}/profile/billing?portal=complete`
  const sessionOptions = buildPortalSession(account.stripe_customer_id, returnUrl)
  const session = await stripeClient().billingPortal.sessions.create(sessionOptions)
  logApi('stripe_portal_branded_session_created', {
    userId: user.id,
    hasConfiguration: Boolean(sessionOptions.configuration),
    focusedPaymentUpdate: Boolean(sessionOptions.flow_data),
  })
  return session.url
}

export async function setCancellation(pool, user, cancel) {
  const account = await ensureBillingAccount(pool, user)
  if (!account.stripe_subscription_id) throw new Error('No active subscription exists')
  if (cancel && Date.now() < new Date(account.created_at).getTime() + 14 * DAY_MS) {
    const error = new Error('Cancellation is available 14 days after account creation.')
    error.statusCode = 409
    throw error
  }
  const subscription = await stripeClient().subscriptions.update(account.stripe_subscription_id, { cancel_at_period_end: Boolean(cancel) })
  await syncSubscription(pool, subscription)
  return getBillingStatus(pool, user)
}

export async function redeemAccessCode(pool, user, rawCode) {
  const hash = codeHash(rawCode)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[code]] = await connection.execute('SELECT * FROM billing_access_codes WHERE code_hash = ? FOR UPDATE', [hash])
    if (!code || !code.active || (code.expires_at && new Date(code.expires_at) <= new Date()) || (code.max_redemptions != null && code.redemption_count >= code.max_redemptions)) {
      const error = new Error('That access code is invalid, expired, or fully used.')
      error.statusCode = 400
      throw error
    }
    await ensureBillingAccount(connection, user)
    await connection.execute('INSERT INTO billing_access_code_redemptions (id, access_code_id, user_id) VALUES (?, ?, ?)', [randomUUID(), code.id, user.id])
    await connection.execute('UPDATE billing_access_codes SET redemption_count = redemption_count + 1 WHERE id = ?', [code.id])
    await connection.execute("UPDATE billing_accounts SET access_source = 'code_free', subscription_status = 'code_free' WHERE user_id = ?", [user.id])
    await connection.commit()
    logApi('billing_access_code_redeemed', { userId: user.id, accessCodeId: code.id })
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    if (error?.code === 'ER_DUP_ENTRY') { error.statusCode = 409; error.message = 'This account already has a permanent access-code grant.' }
    throw error
  } finally { connection.release() }
}

export async function createAccessCode(pool, adminUser, input = {}) {
  const code = normalizeCode(input.homieToken || input.code)
  if (!code) { const error = new Error('Enter a Homie Token.'); error.statusCode = 400; throw error }
  if (code.length < 4 || code.length > 64 || !/^[A-Z0-9][A-Z0-9 _-]*$/.test(code)) {
    const error = new Error('Homie Tokens must be 4–64 characters and use letters, numbers, spaces, hyphens, or underscores.')
    error.statusCode = 400
    throw error
  }
  const id = randomUUID()
  await pool.execute(
    `INSERT INTO billing_access_codes (id, code_hash, code_ciphertext, code_last_four, label, max_redemptions, expires_at, created_by_admin_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, codeHash(code), encryptAccessCode(code), code.slice(-4), String(input.label || '').trim() || null, input.maxRedemptions == null ? null : Number(input.maxRedemptions), mysqlDate(input.expiresAt), adminUser.id],
  )
  logApi('billing_access_code_created', { adminUserId: adminUser.id, accessCodeId: id, maxRedemptions: input.maxRedemptions ?? null, expiresAt: input.expiresAt || null })
  return { id, code, homieToken: code, codeLastFour: code.slice(-4) }
}

export async function listAccessCodes(pool) {
  const [rows] = await pool.execute(`SELECT codes.id, codes.code_ciphertext AS codeCiphertext, codes.code_last_four AS codeLastFour,
    codes.label, codes.max_redemptions AS maxRedemptions, codes.redemption_count AS redemptionCount,
    codes.expires_at AS expiresAt, codes.active, codes.created_at AS createdAt,
    redemptions.id AS redemptionId, redemptions.redeemed_at AS redeemedAt,
    users.id AS userId, users.email AS userEmail, users.name AS userName
    FROM billing_access_codes codes
    LEFT JOIN billing_access_code_redemptions redemptions ON redemptions.access_code_id = codes.id
    LEFT JOIN app_users users ON BINARY users.id = BINARY redemptions.user_id OR BINARY users.auth_user_id = BINARY redemptions.user_id
    ORDER BY codes.created_at DESC, redemptions.redeemed_at DESC`)
  const byId = new Map()
  for (const row of rows) {
    let item = byId.get(row.id)
    if (!item) {
      let code = `Code ending ${row.codeLastFour}`
      if (row.codeCiphertext) {
        try { code = decryptAccessCode(row.codeCiphertext) || code } catch (error) { logError('admin_access_code_decrypt_failed', { error, accessCodeId: row.id }) }
      }
      item = { id: row.id, code, homieToken: code, codeLastFour: row.codeLastFour, label: row.label, maxRedemptions: row.maxRedemptions,
        redemptionCount: row.redemptionCount, expiresAt: row.expiresAt, active: Boolean(row.active), createdAt: row.createdAt, redemptions: [] }
      byId.set(row.id, item)
    }
    if (row.redemptionId) item.redemptions.push({ id: row.redemptionId, redeemedAt: row.redeemedAt, userId: row.userId, email: row.userEmail, name: row.userName })
  }
  return [...byId.values()]
}

export async function listBillingAdminCustomers(pool) {
  const [rows] = await pool.execute(`
    SELECT accounts.user_id AS userId,
           COALESCE(NULLIF(users.email, ''), NULLIF(auth.email, '')) AS email,
           COALESCE(NULLIF(users.name, ''), NULLIF(auth.name, '')) AS name,
           accounts.access_source AS accessSource,
           accounts.subscription_status AS subscriptionStatus,
           accounts.stripe_customer_id AS stripeCustomerId,
           accounts.stripe_subscription_id AS stripeSubscriptionId,
           accounts.payment_method_brand AS paymentMethodBrand,
           accounts.payment_method_last_four AS paymentMethodLastFour,
           accounts.payment_method_exp_month AS paymentMethodExpMonth,
           accounts.payment_method_exp_year AS paymentMethodExpYear,
           accounts.created_at AS createdAt,
           redemptions.redeemed_at AS homieTokenRedeemedAt,
           codes.id AS homieTokenId,
           codes.code_ciphertext AS homieTokenCiphertext,
           codes.code_last_four AS homieTokenLastFour,
           codes.label AS homieTokenLabel
      FROM billing_accounts accounts
      LEFT JOIN app_users users ON BINARY users.id = BINARY accounts.user_id OR BINARY users.auth_user_id = BINARY accounts.user_id
      LEFT JOIN \`user\` auth ON BINARY auth.id = BINARY accounts.user_id
      LEFT JOIN billing_access_code_redemptions redemptions ON BINARY redemptions.user_id = BINARY accounts.user_id
      LEFT JOIN billing_access_codes codes ON BINARY codes.id = BINARY redemptions.access_code_id
     ORDER BY accounts.created_at DESC`)
  return rows.map((row) => {
    let homieToken = null
    if (row.homieTokenCiphertext) {
      try { homieToken = decryptAccessCode(row.homieTokenCiphertext) } catch (error) { logError('admin_homie_token_decrypt_failed', { error, homieTokenId: row.homieTokenId }) }
    }
    return {
      userId: row.userId,
      email: row.email,
      name: row.name,
      accessSource: row.accessSource,
      subscriptionStatus: row.subscriptionStatus,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      paymentMethodBrand: row.paymentMethodBrand,
      paymentMethodLastFour: row.paymentMethodLastFour,
      paymentMethodExpMonth: row.paymentMethodExpMonth,
      paymentMethodExpYear: row.paymentMethodExpYear,
      createdAt: row.createdAt,
      homieToken: homieToken || (row.homieTokenLastFour ? `Token ending ${row.homieTokenLastFour}` : null),
      homieTokenId: row.homieTokenId,
      homieTokenLabel: row.homieTokenLabel,
      homieTokenRedeemedAt: row.homieTokenRedeemedAt,
    }
  })
}

export async function updateAccessCode(pool, id, input) {
  const fields = []; const values = []
  if ('active' in input) { fields.push('active = ?'); values.push(Boolean(input.active)) }
  if ('expiresAt' in input) { fields.push('expires_at = ?'); values.push(mysqlDate(input.expiresAt)) }
  if ('maxRedemptions' in input) { fields.push('max_redemptions = ?'); values.push(input.maxRedemptions == null ? null : Number(input.maxRedemptions)) }
  if (!fields.length) return
  values.push(id)
  await pool.execute(`UPDATE billing_access_codes SET ${fields.join(', ')} WHERE id = ?`, values)
  logApi('billing_access_code_updated', { accessCodeId: id, fields: fields.map((field) => field.split(' = ')[0]) })
}

async function resolveStripePaymentMethod(stripe, account) {
  let paymentMethod = null
  const customer = await stripe.customers.retrieve(account.stripe_customer_id)
  if (!customer.deleted) paymentMethod = customer.invoice_settings?.default_payment_method || null
  if (!paymentMethod && account.stripe_subscription_id) {
    const subscription = await stripe.subscriptions.retrieve(account.stripe_subscription_id)
    paymentMethod = subscription.default_payment_method || null
  }
  if (!paymentMethod) {
    const methods = await stripe.paymentMethods.list({ customer: account.stripe_customer_id, type: 'card', limit: 1 })
    paymentMethod = methods.data[0] || null
  }
  if (typeof paymentMethod === 'string') paymentMethod = await stripe.paymentMethods.retrieve(paymentMethod)
  return paymentMethod?.card ? paymentMethod : null
}

async function syncCustomerPaymentMethod(pool, account) {
  const method = await resolveStripePaymentMethod(stripeClient(), account)
  await pool.execute(
    `UPDATE billing_accounts SET payment_method_brand = ?, payment_method_last_four = ?,
      payment_method_exp_month = ?, payment_method_exp_year = ? WHERE user_id = ?`,
    [method?.card?.brand || null, method?.card?.last4 || null, method?.card?.exp_month || null, method?.card?.exp_year || null, account.user_id],
  )
  return method
}

async function syncCustomerSubscription(pool, account) {
  const subscriptions = await stripeClient().subscriptions.list({
    customer: account.stripe_customer_id,
    status: 'all',
    limit: 10,
  })
  const preferredStatuses = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])
  const subscription = subscriptions.data.find((candidate) => preferredStatuses.has(candidate.status))
    || subscriptions.data[0]
  if (subscription) await syncSubscription(pool, subscription)
  return subscription || null
}

async function syncSubscription(pool, subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
  await pool.execute(
    `UPDATE billing_accounts SET stripe_subscription_id = ?, stripe_price_id = ?, access_source = 'stripe', subscription_status = ?,
      current_period_ends_at = ?, cancel_at_period_end = ? WHERE stripe_customer_id = ?`,
    [subscription.id, subscription.items?.data?.[0]?.price?.id || null, subscription.status, mysqlDate(fromUnix(subscription.current_period_end)), Boolean(subscription.cancel_at_period_end), customerId],
  )
}

export async function processStripeWebhook(pool, rawBody, signature) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required')
  const stripe = stripeClient()
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  try { await pool.execute('INSERT INTO stripe_webhook_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type]) }
  catch (error) { if (error?.code === 'ER_DUP_ENTRY') return { duplicate: true, type: event.type }; throw error }
  try {
    const object = event.data.object
    if (event.type.startsWith('customer.subscription.')) await syncSubscription(pool, object)
    if (event.type === 'checkout.session.completed') {
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id
      if (customerId && subscriptionId) {
        await pool.execute('UPDATE billing_accounts SET stripe_subscription_id = ? WHERE stripe_customer_id = ?', [subscriptionId, customerId])
        const [[account]] = await pool.execute('SELECT * FROM billing_accounts WHERE stripe_customer_id = ? LIMIT 1', [customerId])
        if (account) await syncCustomerPaymentMethod(pool, account)
      }
    }
    if (event.type === 'invoice.payment_failed') {
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id
      await pool.execute(`UPDATE billing_accounts SET subscription_status = 'past_due', first_payment_failed_at = COALESCE(first_payment_failed_at, NOW()), grace_ends_at = COALESCE(grace_ends_at, DATE_ADD(NOW(), INTERVAL 60 DAY)) WHERE stripe_customer_id = ?`, [customerId])
    }
    if (event.type === 'invoice.paid') {
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id
      await pool.execute("UPDATE billing_accounts SET subscription_status = 'active', first_payment_failed_at = NULL, grace_ends_at = NULL WHERE stripe_customer_id = ?", [customerId])
    }
  } catch (error) {
    // Permit Stripe to retry an event that reached us but could not be fully applied.
    await pool.execute('DELETE FROM stripe_webhook_events WHERE event_id = ?', [event.id]).catch(() => { })
    throw error
  }
  logApi('stripe_webhook_processed', { stripeEventId: event.id, stripeEventType: event.type })
  return { duplicate: false, type: event.type }
}

export async function reconcileStripeSubscriptions(pool) {
  const [rows] = await pool.execute('SELECT stripe_subscription_id FROM billing_accounts WHERE stripe_subscription_id IS NOT NULL')
  const stripe = stripeClient(); let updated = 0; let failed = 0
  for (const row of rows) {
    try { await syncSubscription(pool, await stripe.subscriptions.retrieve(row.stripe_subscription_id)); updated += 1 }
    catch { failed += 1 }
  }
  return { checked: rows.length, updated, failed }
}

export { billingEnabled, nextMonthEndAfter }
