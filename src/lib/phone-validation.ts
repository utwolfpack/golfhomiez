export const PHONE_PATTERN = '^\\d{3}\\s\\d{3}\\s\\d{4}$'
export const PHONE_VALIDATION_MESSAGE = 'Enter a valid 10-digit phone number formatted like 801 743 7000.'

function digitsForFormatting(value?: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

export function formatPhoneNumber(value?: string | null) {
  const digits = digitsForFormatting(value).slice(0, 10)
  if (!digits) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}

export function sanitizePhoneInput(value: string) {
  return formatPhoneNumber(value)
}

export function normalizeOptionalPhone(value?: string | null) {
  const formatted = formatPhoneNumber(value)
  return formatted ? formatted : null
}

export function isValidPhoneNumber(value?: string | null) {
  const phone = normalizeOptionalPhone(value)
  if (!phone) return true
  return new RegExp(PHONE_PATTERN).test(phone) && phone.replace(/\D/g, '').length === 10
}

export function validateOptionalPhoneNumber(value?: string | null) {
  return isValidPhoneNumber(value) ? null : PHONE_VALIDATION_MESSAGE
}

export function validateRequiredPhoneNumber(value?: string | null) {
  const phone = normalizeOptionalPhone(value)
  if (!phone) return 'Phone number is required.'
  return isValidPhoneNumber(phone) ? null : PHONE_VALIDATION_MESSAGE
}
