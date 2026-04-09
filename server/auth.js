import { betterAuth } from 'better-auth'
import { getPool } from './db.js'
import { setLatestPasswordReset, setLatestVerificationLink } from './auth-debug.js'
import { sendMail } from './mailer.js'
import { logApi, logError } from './lib/logger.js'

const authSecret = process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me-1234567890123456'

export const auth = betterAuth({
  appName: 'Golf Homiez',
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  database: getPool(),
  secret: authSecret,
  session: {
    expiresIn: 60 * 60 * 24,
    updateAge: 60 * 60,
  },
  trustedOrigins: Array.from(new Set([
    process.env.BETTER_AUTH_URL,
    process.env.CLIENT_ORIGIN,
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5001',
    'http://127.0.0.1:5001',
  ].filter(Boolean))),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
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
