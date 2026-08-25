import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { getPool } from './db.js'
import { setLatestPasswordReset, setLatestVerificationLink } from './auth-debug.js'
import { sendMail } from './mailer.js'
import { logApi, logError } from './lib/logger.js'
import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGE, getPasswordPolicyFailures } from './lib/password-policy.js'

const authSecret = process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me-1234567890123456'

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
    minPasswordLength: PASSWORD_MIN_LENGTH,
    sendResetPassword: async ({ user, url, token }, request) => {
      const expiresAt = request?.body?.expiresAt || null
      setLatestPasswordReset({
        email: user.email,
        token,
        url,
        expiresAt,
      })

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
      console.log(`[better-auth] password reset email sent to ${user.email}`)
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const password = ctx.path === '/sign-up/email'
        ? ctx.body?.password
        : ['/reset-password', '/change-password'].includes(ctx.path)
          ? ctx.body?.newPassword
          : null

      if (password == null) return
      const failures = getPasswordPolicyFailures(password)
      if (!failures.length) return

      logApi('auth_password_policy_rejected', {
        correlationId: ctx.request?.headers?.get?.('x-correlation-id') || null,
        path: ctx.path,
        failures,
      })
      throw new APIError('BAD_REQUEST', { message: PASSWORD_POLICY_MESSAGE })
    }),
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
