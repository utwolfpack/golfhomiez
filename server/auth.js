import { betterAuth } from 'better-auth'
import { getPool } from './db.js'
import { setLatestPasswordReset } from './auth-debug.js'
import { sendMail } from './mailer.js'

const authSecret = process.env.BETTER_AUTH_SECRET || 'dev-only-secret-change-me-1234567890123456'

export const auth = betterAuth({
  appName: 'Golf Homiez',
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  database: getPool(),
  secret: authSecret,
  trustedOrigins: [
    process.env.BETTER_AUTH_URL,
    process.env.CLIENT_ORIGIN,
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5001',
    'http://127.0.0.1:5001',
  ].filter(Boolean),
  emailAndPassword: {
    enabled: true,
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

      console.log(`[better-auth] password reset email sent to ${user.email}`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
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

      console.log(`[better-auth] verification email sent to ${user.email}`)
    },
  },
})
