import type { TournamentInput } from './accounts'

function normalizeMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value || '').trim()
}

export function validateTournamentForSave(input: TournamentInput | null | undefined): string | null {
  const name = String(input?.name || '').trim()
  const startDate = String(input?.startDate || '').trim()
  const status = String(input?.status || 'draft').trim().toLowerCase()
  const templateData = (input?.templateData && typeof input.templateData === 'object') ? input.templateData as Record<string, unknown> : {}
  const registrationDeadline = String(templateData.registrationDeadline || '').trim().slice(0, 10)

  if (!name) return 'Tournament Name is a required field. Enter a tournament name and try again.'
  if (['published', 'completed'].includes(status) && !startDate) {
    return 'Tournament Start Date is a required field before publishing or completing. Add a tournament date and try again.'
  }
  if (startDate && Number.isNaN(Date.parse(`${startDate}T00:00:00`))) {
    return 'Tournament Start Date is invalid. Select a valid calendar date and try again.'
  }
  if (registrationDeadline && Number.isNaN(Date.parse(`${registrationDeadline}T00:00:00`))) {
    return 'Registration Deadline is invalid. Select a valid calendar date and try again.'
  }
  if (startDate && registrationDeadline && registrationDeadline > startDate.slice(0, 10)) {
    return 'Registration Deadline cannot be after the Tournament Start Date. Select a deadline on or before the tournament date and try again.'
  }
  return null
}

export function getFriendlyTournamentError(error: unknown, action: 'create' | 'save' | 'load' = 'save') {
  const raw = normalizeMessage(error)
  if (/start date.*required|required.*start date/i.test(raw)) {
    return 'Tournament Start Date is a required field before publishing or completing. Add a tournament date and try again.'
  }
  if (/tournament name.*required|required.*tournament name/i.test(raw)) {
    return 'Tournament Name is a required field. Enter a tournament name and try again.'
  }
  if (/start date.*invalid|invalid.*start date/i.test(raw)) {
    return 'Tournament Start Date is invalid. Select a valid calendar date and try again.'
  }
  if (/registration deadline.*after|after.*registration deadline/i.test(raw)) {
    return 'Registration Deadline cannot be after the Tournament Start Date. Select a deadline on or before the tournament date and try again.'
  }
  if (/registration deadline.*invalid|invalid.*registration deadline/i.test(raw)) {
    return 'Registration Deadline is invalid. Select a valid calendar date and try again.'
  }
  if (/organizer email.*required/i.test(raw)) {
    return 'Organizer Email is required for this action. Enter a valid email address and try again.'
  }
  if (/email.*invalid|valid organizer email/i.test(raw)) {
    return 'Organizer Email is invalid. Enter a complete email address or leave it blank.'
  }
  if (/too large|payload/i.test(raw)) {
    return 'An uploaded tournament image is too large. Remove it or upload a smaller image and try again.'
  }
  if (raw && !/^request failed \(\d+\)$/i.test(raw) && !/^could not /i.test(raw) && !/^the tournament could not/i.test(raw)) {
    return /[.!?]$/.test(raw) ? raw : `${raw}.`
  }

  if (action === 'create') {
    return 'The tournament could not be created. Review the required fields and try again.'
  }
  if (action === 'load') {
    return 'The tournament information could not be loaded. Refresh the page and try again.'
  }
  return 'The tournament could not be saved. Review the highlighted information and try again.'
}
