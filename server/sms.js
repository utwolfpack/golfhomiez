import { sendMail } from './mailer.js'
import { getCorrelationId, logSmtp } from './lib/logger.js'

export const SMS_PROFILE_UPDATE_MESSAGE = 'Your Golf Homiez profile has been updated https://golfhomiez.com'
const BREVO_SMS_ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/send'

function normalizePhoneDigits(value = '') {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''
  return hasPlus ? `+${digits}` : digits
}

function normalizePhoneDigitsOnly(value = '') {
  return String(value || '').replace(/\D/g, '')
}

export function isValidSmsPhoneNumber(value = '') {
  const normalized = normalizePhoneDigits(value)
  const digitCount = normalized.replace(/\D/g, '').length
  return digitCount >= 10 && digitCount <= 15
}

function isValidEmailAddress(value = '') {
  const email = String(value || '').trim()
  if (!email || /\s/.test(email) || email.includes('://')) return false
  return /^[^@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)
}

function normalizeGatewayDomain(value = '') {
  const domain = String(value || '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^@+/, '')
    .replace(/\/+$/, '')

  if (!domain || domain.includes('@') || domain.includes('://') || /\s/.test(domain)) return ''
  if (!/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)) return ''
  return domain.toLowerCase()
}

function configuredSmsGatewayDomain() {
  return String(process.env.SMS_EMAIL_DOMAIN || process.env.SMS_SMTP_DOMAIN || process.env.SMS_GATEWAY_DOMAIN || '').trim()
}

function smsGatewayDomain() {
  return normalizeGatewayDomain(configuredSmsGatewayDomain())
}

function getSmsProvider() {
  const provider = String(process.env.SMS_PROVIDER || 'smtp-sms').trim().toLowerCase()
  if (['brevo', 'brevo-sms', 'brevosms', 'transactional-sms'].includes(provider)) return 'brevo-sms'
  return 'smtp-sms'
}

function isSmsDevFallbackEnabled() {
  const configured = String(process.env.SMS_DEV_FALLBACK || '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(configured)) return true
  if (['0', 'false', 'no', 'off'].includes(configured)) return false
  return false
}

function getSmsRecipientFailureReason(to) {
  const raw = String(to || '').trim()
  if (!raw) return 'missing_recipient'
  if (raw.includes('@')) return isValidEmailAddress(raw) ? '' : 'invalid_recipient_email'
  const configuredDomain = configuredSmsGatewayDomain()
  if (!configuredDomain) return 'missing_sms_gateway_domain'
  if (!smsGatewayDomain()) return 'invalid_sms_gateway_domain'
  return 'invalid_sms_recipient'
}

function buildSmsRecipient(to) {
  const raw = String(to || '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return isValidEmailAddress(raw) ? raw : ''
  const domain = smsGatewayDomain()
  if (!domain) return ''
  const digits = normalizePhoneDigits(raw).replace(/\D/g, '')
  const recipient = digits ? `${digits}@${domain}` : ''
  return isValidEmailAddress(recipient) ? recipient : ''
}

function buildSmsConfigurationError(reason) {
  if (reason === 'missing_sms_gateway_domain') {
    return new Error('SMS delivery is not configured. Set SMS_EMAIL_DOMAIN to a valid email-to-SMS gateway domain before using SMS delivery, or set SMS_PROVIDER=brevo to use Brevo Transactional SMS.')
  }
  if (reason === 'invalid_sms_gateway_domain') {
    return new Error('SMS delivery is not configured correctly. SMS_EMAIL_DOMAIN must be a valid email-to-SMS gateway domain, not a URL or malformed address.')
  }
  if (reason === 'invalid_recipient_email') {
    return new Error('SMS recipient email gateway address is invalid.')
  }
  return new Error('SMS recipient could not be converted to a valid SMTP delivery address.')
}

function getBrevoSmsApiKey() {
  return String(process.env.BREVO_SMS_API_KEY || process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || '').trim()
}

function getBrevoSmsSender() {
  return String(process.env.BREVO_SMS_SENDER || process.env.SMS_SENDER || 'GolfHomiez').trim()
}

function getBrevoSmsType() {
  const type = String(process.env.BREVO_SMS_TYPE || process.env.SMS_TYPE || 'transactional').trim().toLowerCase()
  return type === 'marketing' ? 'marketing' : 'transactional'
}

function getDefaultCountryCode() {
  return String(process.env.SMS_DEFAULT_COUNTRY_CODE || '1').replace(/\D/g, '')
}

function normalizeBrevoSmsRecipient(value = '') {
  const raw = String(value || '').trim()
  const digits = normalizePhoneDigitsOnly(raw)
  if (!digits) return ''
  if (raw.startsWith('+')) return digits

  const defaultCountryCode = getDefaultCountryCode()
  if (digits.length === 10 && defaultCountryCode) return `${defaultCountryCode}${digits}`
  return digits
}

function validateBrevoSmsSender(sender) {
  return /^[A-Za-z0-9]{1,11}$/.test(sender) || /^\d{1,15}$/.test(sender)
}

function buildBrevoSmsConfigurationError(reason) {
  if (reason === 'missing_api_key') {
    return new Error('Brevo SMS delivery is not configured. Set BREVO_API_KEY or BREVO_SMS_API_KEY before using SMS delivery.')
  }
  if (reason === 'invalid_sender') {
    return new Error('BREVO_SMS_SENDER must be 1-11 alphanumeric characters or 1-15 numeric characters.')
  }
  if (reason === 'missing_body') {
    return new Error('SMS message body is required.')
  }
  return new Error('SMS recipient phone number is invalid. Use a phone number with country code, for example +18015551212, or set SMS_DEFAULT_COUNTRY_CODE for local 10-digit numbers.')
}

async function sendWithBrevoSms({ to, body, subject = 'Golf Homiez', tag = 'golfhomiez' }) {
  const correlationId = getCorrelationId()
  const normalizedTo = normalizePhoneDigits(to)
  const recipient = normalizeBrevoSmsRecipient(to)
  const content = String(body || '').trim()
  const apiKey = getBrevoSmsApiKey()
  const sender = getBrevoSmsSender()
  const type = getBrevoSmsType()
  const organisationPrefix = String(process.env.BREVO_SMS_ORGANISATION_PREFIX || '').trim()
  const digitCount = recipient.length
  const fallbackEnabled = isSmsDevFallbackEnabled()

  let reason = ''
  if (!recipient || digitCount < 6 || digitCount > 15) reason = 'invalid_recipient'
  else if (!content) reason = 'missing_body'
  else if (!apiKey) reason = 'missing_api_key'
  else if (!validateBrevoSmsSender(sender)) reason = 'invalid_sender'

  if (reason) {
    logSmtp('sms_configuration_error', {
      provider: 'brevo-sms',
      correlationId,
      to: normalizedTo || String(to || '').trim(),
      subject,
      bodyLength: String(body || '').length,
      reason,
      fallbackEnabled,
    })

    if (!fallbackEnabled) throw buildBrevoSmsConfigurationError(reason)

    logSmtp('sms_dev_fallback', {
      provider: 'brevo-sms',
      correlationId,
      to: normalizedTo || String(to || '').trim(),
      subject,
      bodyLength: String(body || '').length,
      reason,
    })
    return { accepted: [normalizedTo || String(to || '').trim()], provider: 'dev-fallback', fallback: true, reason }
  }

  const payload = {
    sender,
    recipient,
    content,
    type,
    tag,
    unicodeEnabled: true,
    ...(organisationPrefix ? { organisationPrefix } : {}),
  }

  logSmtp('sms_send_started', {
    provider: 'brevo-sms',
    correlationId,
    to: normalizedTo || String(to || '').trim(),
    recipient,
    subject,
    bodyLength: content.length,
    tag,
    type,
  })

  const response = await fetch(BREVO_SMS_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  let responseBody = null
  try {
    responseBody = responseText ? JSON.parse(responseText) : null
  } catch {
    responseBody = responseText
  }

  if (!response.ok) {
    logSmtp('sms_send_failed', {
      provider: 'brevo-sms',
      correlationId,
      to: normalizedTo || String(to || '').trim(),
      recipient,
      subject,
      status: response.status,
      response: responseBody,
      tag,
    })
    throw new Error(`Brevo SMS send failed: ${response.status} ${responseText}`)
  }

  logSmtp('sms_send_succeeded', {
    provider: 'brevo-sms',
    correlationId,
    to: normalizedTo || String(to || '').trim(),
    recipient,
    subject,
    messageId: responseBody?.messageId || null,
    tag,
  })

  return {
    accepted: [recipient],
    provider: 'brevo-sms',
    messageId: responseBody?.messageId || null,
    response: responseBody,
  }
}

async function sendWithSmtpSms({ to, body, subject = 'Golf Homiez' }) {
  const normalizedTo = normalizePhoneDigits(to)
  if (!isValidSmsPhoneNumber(normalizedTo) && !String(to || '').includes('@')) {
    throw new Error('SMS recipient phone number is invalid.')
  }

  const recipient = buildSmsRecipient(to)
  const correlationId = getCorrelationId()

  if (!recipient) {
    const reason = getSmsRecipientFailureReason(to)
    const fallbackEnabled = isSmsDevFallbackEnabled()
    logSmtp('sms_configuration_error', {
      provider: 'smtp-sms',
      correlationId,
      to: normalizedTo || String(to || '').trim(),
      subject,
      bodyLength: String(body || '').length,
      configuredGateway: Boolean(configuredSmsGatewayDomain()),
      gatewayDomainValid: Boolean(smsGatewayDomain()),
      reason,
      fallbackEnabled,
    })

    if (!fallbackEnabled) {
      throw buildSmsConfigurationError(reason)
    }

    logSmtp('sms_dev_fallback', {
      provider: 'smtp-sms',
      correlationId,
      to: normalizedTo || String(to || '').trim(),
      subject,
      bodyLength: String(body || '').length,
      configuredGateway: Boolean(configuredSmsGatewayDomain()),
      reason,
    })
    return { accepted: [normalizedTo || String(to || '').trim()], provider: 'dev-fallback', fallback: true, reason }
  }

  logSmtp('sms_send_started', {
    provider: 'smtp-sms',
    correlationId,
    to: normalizedTo || String(to || '').trim(),
    recipientDomain: recipient.split('@').pop(),
    subject,
    bodyLength: String(body || '').length,
  })

  const result = await sendMail({
    to: recipient,
    subject,
    text: String(body || ''),
    html: `<pre>${String(body || '')}</pre>`,
  })

  logSmtp('sms_send_succeeded', {
    provider: 'smtp-sms',
    correlationId,
    to: normalizedTo || String(to || '').trim(),
    recipientDomain: recipient.split('@').pop(),
    subject,
  })

  return { ...result, provider: 'smtp-sms', smsRecipient: recipient }
}

export async function sendSms({ to, body, subject = 'Golf Homiez', tag = 'golfhomiez' }) {
  const provider = getSmsProvider()
  if (provider === 'brevo-sms') return sendWithBrevoSms({ to, body, subject, tag })
  return sendWithSmtpSms({ to, body, subject })
}
