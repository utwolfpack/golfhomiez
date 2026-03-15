import { betterAuth } from 'better-auth'
import { getPool } from './db.js'
import { setLatestPasswordReset } from './auth-debug.js'

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
      console.log(`[better-auth] password reset for ${user.email}: ${url}`)
    },
  },
})
