import process from 'node:process'
import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

function signingSecret() {
  const value = String(process.env.SOCIAL_MEDIA_SIGNING_SECRET || process.env.BETTER_AUTH_SECRET || '').trim()
  if (!value) {
    const error = new Error('SOCIAL_MEDIA_SIGNING_SECRET or BETTER_AUTH_SECRET is required for signed social media URLs')
    error.code = 'SOCIAL_MEDIA_SIGNING_SECRET_MISSING'
    throw error
  }
  return value
}

function signPayload(payload) {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url')
}

export function createSignedSocialMediaToken({ runId, relativePath, ttlSeconds = 3600 } = {}) {
  const expiresAt = Date.now() + Math.max(300, Number(ttlSeconds || 3600)) * 1000
  const payload = Buffer.from(JSON.stringify({ runId, relativePath, expiresAt }), 'utf8').toString('base64url')
  return `${payload}.${signPayload(payload)}`
}

export function verifySignedSocialMediaToken(token) {
  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) throw new Error('Signed media token is invalid')
  const expected = Buffer.from(signPayload(payload))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Signed media token signature is invalid')
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!parsed?.expiresAt || Number(parsed.expiresAt) < Date.now()) throw new Error('Signed media token has expired')
  if (!parsed.relativePath || !parsed.runId) throw new Error('Signed media token payload is incomplete')
  return parsed
}
