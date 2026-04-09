import crypto from 'node:crypto'
import { getPool } from './db.js'
import { sendMail } from './mailer.js'
import { setLatestVerificationLink } from './auth-debug.js'
import { getCorrelationId, logApi, logError } from './lib/logger.js'

const DEFAULT_CALLBACK_PATH = '/login?verified=1'
const TOKEN_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || '24')

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizeCallbackPath(callbackURL) {
  const fallback = DEFAULT_CALLBACK_PATH
  const raw = String(callbackURL || '').trim()
  if (!raw) return fallback

  if (raw.startsWith('/')) return raw

  try {
    const clientOrigin = process.env.CLIENT_ORIGIN || process.env.BETTER_AUTH_URL || 'http://127.0.0.1:5001'
    const parsed = new URL(raw, clientOrigin)
    const allowedOrigins = new Set([
      process.env.CLIENT_ORIGIN,
      process.env.BETTER_AUTH_URL,
      clientOrigin,
    ].filter(Boolean))

    if (allowedOrigins.has(parsed.origin)) {
      return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`
    }
  } catch {
    // ignore invalid callback values
  }

  return fallback
}

function getVerificationOrigin() {
  const raw = String(process.env.BETTER_AUTH_URL || process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5001').trim()
  return raw.replace(/\/$/, '')
}

function buildVerificationUrl(token, callbackPath) {
  const url = new URL('/api/account-verification/verify-email', `${getVerificationOrigin()}/`)
  url.searchParams.set('token', token)
  url.searchParams.set('callbackURL', callbackPath)
  return url.toString()
}

function nextExpiryDate() {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
  return expiresAt
}

async function findUserByEmail(conn, email) {
  const [rows] = await conn.execute(
    'SELECT id, email, name, emailVerified FROM `user` WHERE LOWER(email) = ? LIMIT 1',
    [normalizeEmail(email)],
  )
  return rows[0] || null
}

export async function getEmailVerificationStatus(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return { found: false, email: normalized, verified: false }

  const db = getPool()
  const user = await findUserByEmail(db, normalized)
  if (!user) return { found: false, email: normalized, verified: false }

  return {
    found: true,
    email: user.email,
    verified: Boolean(user.emailVerified),
    name: user.name || null,
  }
}

export async function sendEmailVerificationForUser(email, callbackURL) {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    return { error: { message: 'Email is required', code: 'EMAIL_REQUIRED' } }
  }

  const db = getPool()
  const conn = await db.getConnection()

  try {
    await conn.beginTransaction()
    const user = await findUserByEmail(conn, normalized)

    if (!user) {
      await conn.rollback()
      return { error: { message: 'No account was found for that email address', code: 'EMAIL_NOT_FOUND' } }
    }

    if (Boolean(user.emailVerified)) {
      await conn.rollback()
      return {
        data: {
          alreadyVerified: true,
          email: user.email,
          callbackURL: normalizeCallbackPath(callbackURL),
        },
      }
    }

    const callbackPath = normalizeCallbackPath(callbackURL)
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = nextExpiryDate()

    await conn.execute(
      `UPDATE email_verification_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE LOWER(email) = ?
         AND consumed_at IS NULL
         AND revoked_at IS NULL`,
      [normalized],
    )

    await conn.execute(
      `INSERT INTO email_verification_tokens (id, user_id, email, token, callback_path, expires_at, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), user.id, normalized, token, callbackPath, expiresAt, getCorrelationId()],
    )

    await conn.commit()

    const url = buildVerificationUrl(token, callbackPath)
    setLatestVerificationLink({
      email: normalized,
      token,
      url,
      callbackURL: callbackPath,
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
      correlationId: getCorrelationId(),
      email: user.email,
      callbackURL: callbackPath,
      verificationPath: '/api/account-verification/verify-email',
      tokenPresent: true,
      latestOnly: true,
    })

    return {
      data: {
        ok: true,
        email: user.email,
        alreadyVerified: false,
        callbackURL: callbackPath,
      },
    }
  } catch (error) {
    await conn.rollback().catch(() => {})
    logError('Auth verification email send failed', {
      correlationId: getCorrelationId(),
      email: normalized,
      callbackURL: normalizeCallbackPath(callbackURL),
      error,
    })
    throw error
  } finally {
    conn.release()
  }
}

export async function verifyEmailToken(token) {
  const rawToken = String(token || '').trim()
  if (!rawToken) {
    return { error: { message: 'Verification token is required', code: 'TOKEN_REQUIRED' } }
  }

  const db = getPool()
  const conn = await db.getConnection()

  try {
    await conn.beginTransaction()

    const [rows] = await conn.execute(
      `SELECT id, user_id, email, token, callback_path, expires_at, consumed_at, revoked_at
       FROM email_verification_tokens
       WHERE token = ?
       LIMIT 1`,
      [rawToken],
    )

    const record = rows[0]
    if (!record) {
      await conn.rollback()
      return { error: { message: 'This verification link is invalid or has expired.', code: 'TOKEN_INVALID' } }
    }

    const callbackPath = normalizeCallbackPath(record.callback_path)
    const user = await findUserByEmail(conn, record.email)

    if (Boolean(user?.emailVerified)) {
      await conn.execute(
        `UPDATE email_verification_tokens
         SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP), revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE LOWER(email) = ? AND consumed_at IS NULL`,
        [normalizeEmail(record.email)],
      )
      await conn.commit()
      return { data: { verified: true, alreadyVerified: true, callbackURL: callbackPath } }
    }

    if (record.consumed_at || record.revoked_at || !record.expires_at || new Date(record.expires_at).getTime() < Date.now()) {
      await conn.rollback()
      return { error: { message: 'This verification link is invalid or has expired.', code: 'TOKEN_EXPIRED' } }
    }

    if (!user) {
      await conn.rollback()
      return { error: { message: 'This verification link is invalid or has expired.', code: 'TOKEN_INVALID' } }
    }

    await conn.execute('UPDATE `user` SET emailVerified = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [user.id])
    await conn.execute(
      `UPDATE email_verification_tokens
       SET consumed_at = CURRENT_TIMESTAMP,
           revoked_at = CASE WHEN token <> ? THEN CURRENT_TIMESTAMP ELSE revoked_at END
       WHERE LOWER(email) = ?
         AND consumed_at IS NULL`,
      [rawToken, normalizeEmail(record.email)],
    )

    await conn.commit()

    logApi('auth_email_verified', {
      correlationId: getCorrelationId(),
      email: record.email,
      callbackURL: callbackPath,
      tokenMatched: true,
    })

    return { data: { verified: true, alreadyVerified: false, callbackURL: callbackPath } }
  } catch (error) {
    await conn.rollback().catch(() => {})
    logError('Email verification failed', { correlationId: getCorrelationId(), error })
    throw error
  } finally {
    conn.release()
  }
}
