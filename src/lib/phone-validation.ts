export const PHONE_PATTERN = '^\\+?[1-9][0-9\\s().-]{7,19}$'
export const PHONE_VALIDATION_MESSAGE = 'Enter a valid phone number using digits, spaces, dashes, periods, parentheses, and an optional leading +.'
export const PHONE_REQUIRED_MESSAGE = 'Phone number is required.'

export function sanitizePhoneInput(value: string) {
  return value
    .replace(/[^0-9+().\-\s]/g, '')
    .replace(/(?!^)\+/g, '')
    .slice(0, 24)
}

export function normalizeOptionalPhone(value?: string | null) {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : null
}

export function isValidPhoneNumber(value?: string | null) {
  const phone = normalizeOptionalPhone(value)
  if (!phone) return true
  if (!new RegExp(PHONE_PATTERN).test(phone)) return false
  const digitCount = phone.replace(/\D/g, '').length
  return digitCount >= 10 && digitCount <= 15
}

export function validateOptionalPhoneNumber(value?: string | null) {
  return isValidPhoneNumber(value) ? null : PHONE_VALIDATION_MESSAGE
}

export function validateRequiredPhoneNumber(value?: string | null) {
  const phone = normalizeOptionalPhone(value)
  if (!phone) return PHONE_REQUIRED_MESSAGE
  return isValidPhoneNumber(phone) ? null : PHONE_VALIDATION_MESSAGE
}
