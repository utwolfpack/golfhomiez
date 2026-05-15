import { betterAuth } from 'better-auth'
import { getPool } from './db.js'
import { setLatestPasswordReset, setLatestVerificationLink } from './auth-debug.js'
import { sendMail } from './mailer.js'
import { sendSms, isValidSmsPhoneNumber } from './sms.js'
import { logApi, logError, logWarn } from './lib/logger.js'

const authSecret = process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me-1234567890123456'

function getHeaderValue(request, headerName) {
  const headers = request?.headers
  if (!headers) return ''
  const lowerName = String(headerName || '').toLowerCase()

  if (typeof headers.get === 'function') {
    return String(headers.get(headerName) || headers.get(lowerName) || '').trim()
  }

  if (typeof headers === 'object') {
    return String(headers[headerName] || headers[lowerName] || '').trim()
  }

  return ''
}

async function readPasswordResetRequestBody(request) {
  const body = request?.body
  if (body && typeof body === 'object' && !body.getReader) return body

  const contentType = getHeaderValue(request, 'content-type').toLowerCase()
  if (!contentType.includes('application/json') || typeof request?.clone !== 'function') return {}

  try {
    return await request.clone().json()
  } catch {
    return {}
  }
}

async function getRequestedPasswordResetDelivery(request) {
  const headerDelivery = getHeaderValue(request, 'x-password-reset-delivery')
  const body = await readPasswordResetRequestBody(request)
  const delivery = String(headerDelivery || body?.deliveryMethod || body?.delivery || '').trim().toLowerCase()
  return delivery === 'sms' ? 'sms' : 'email'
}

async function getProfilePhoneForPasswordReset(user = {}) {
  const userId = String(user.id || '').trim()
  const email = String(user.email || '').trim()
  if (!userId && !email) return ''

  try {
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT phone
         FROM app_users
        WHERE (auth_user_id = ? OR LOWER(email) = LOWER(?))
          AND phone IS NOT NULL AND phone <> ''
        ORDER BY CASE WHEN auth_user_id = ? THEN 0 ELSE 1 END
        LIMIT 1`,
      [userId, email, userId],
    )
    const phone = String(rows?.[0]?.phone || '').trim()
    return isValidSmsPhoneNumber(phone) ? phone : ''
  } catch (error) {
    logWarn('auth_password_reset_phone_lookup_failed', { email, userId, error })
    return ''
  }
}

export const auth = betterAuth({
  appName: 'Golf Homiez',
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  database: getPool(),
  secret: authSecret,
  session: {
    // 24-hour authentication TTL. updateAge 0 keeps the sliding window fresh on activity.
    expiresIn: 60 * 60 * 24,
    updateAge: 0,
  },
  trustedOrigins: Array.from(new Set([
    process.env.BETTER_AUTH_URL,
    process.env.CLIENT_ORIGIN,
    process.env.DEV_CLIENT_ORIGIN,
    process.env.DEV_API_ORIGIN,
  ].filter(Boolean))),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url, token }, request) => {
      const requestBody = await readPasswordResetRequestBody(request)
      const expiresAt = requestBody?.expiresAt || null
      const deliveryMethod = await getRequestedPasswordResetDelivery(request)
      logApi('auth_password_reset_requested', {
        email: user.email,
        deliveryMethod,
        deliveryHeader: getHeaderValue(request, 'x-password-reset-delivery') || null,
      })
      setLatestPasswordReset({
        email: user.email,
        token,
        url,
        expiresAt,
        deliveryMethod,
      })

      if (deliveryMethod === 'sms') {
        const phone = await getProfilePhoneForPasswordReset(user)
        if (!phone) {
          logWarn('auth_password_reset_sms_skipped_missing_phone', {
            email: user.email,
            expiresAt,
          })
          return
        }

        const smsResult = await sendSms({
          to: phone,
          subject: 'Golf Homiez password reset',
          body: `Reset your Golf Homiez password: ${url}`,
          tag: 'golfhomiez-password-reset',
        })

        if (smsResult?.fallback) {
          logWarn('auth_password_reset_sms_fallback', {
            email: user.email,
            expiresAt,
            provider: smsResult.provider,
            reason: smsResult.reason || null,
          })
          return
        }

        logApi('auth_password_reset_sms_sent', {
          email: user.email,
          expiresAt,
          provider: smsResult?.provider || null,
          messageId: smsResult?.messageId || null,
        })
        return
      }

      await sendMail({
        to: user.email,
        subject: 'Reset your Golf Homiez password',
        text: `Use this link to reset your Golf Homiez password: ${url}`,
        html: `
          <p>Use the link below to reset your Golf Homiez password:</p>
          <p><a href="${url}">${url}</a></p>
        `,
      })

      logApi('auth_password_reset_email_sent', {
        email: user.email,
        expiresAt,
      })
      console.log(`[better-auth] password reset ${deliveryMethod} sent to ${user.email}`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url, token }, request) => {
      try {
        setLatestVerificationLink({
          email: user.email,
          token,
          url,
          callbackURL: request?.body?.callbackURL || null,
        })

        await sendMail({
          to: user.email,
          subject: 'Verify your Golf Homiez email',
          text: `Verify your Golf Homiez email by opening this link: ${url}`,
          html: `
            <p>Welcome to Golf Homiez.</p>
            <p>Verify your email by clicking the link below:</p>
            <p><a href="${url}">${url}</a></p>
          `,
        })

        logApi('auth_verification_email_sent', {
          email: user.email,
          callbackURL: request?.body?.callbackURL || null,
          verificationPath: (() => { try { return new URL(url).pathname } catch { return null } })(),
          tokenPresent: Boolean(token),
        })

        console.log(`[better-auth] verification email sent to ${user.email}`)
      } catch (error) {
        logError('Auth verification email send failed', {
          email: user.email,
          callbackURL: request?.body?.callbackURL || null,
          error,
        })
        throw error
      }
    },
  },
})
