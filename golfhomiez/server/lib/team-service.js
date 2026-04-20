import { v4 as uuidv4 } from 'uuid'
import { isEmail, normalizeEmail } from './validation.js'

export function normalizeTeamPayload({ name, members }) {
  const trimmedName = String(name || '').trim()
  if (!trimmedName) return { ok: false, message: 'Team name required' }

  const normalizedMembers = (Array.isArray(members) ? members : [])
    .map((member) => ({
      id: member && member.id ? String(member.id) : uuidv4(),
      name: String(member?.name || '').trim(),
      email: normalizeEmail(member?.email || ''),
    }))
    .filter((member) => member.name || member.email)

  if (normalizedMembers.length < 2) {
    return { ok: false, message: 'A team must have at least 2 members' }
  }

  if (normalizedMembers.length > 4) {
    return { ok: false, message: 'A team can have at most 4 members' }
  }

  const seen = new Set()
  for (const member of normalizedMembers) {
    if (!member.name) return { ok: false, message: 'Each team member must have a name' }
    if (!member.email) return { ok: false, message: 'Each team member must have an email' }
    if (!isEmail(member.email)) return { ok: false, message: `Invalid team member email: ${member.email}` }
    if (seen.has(member.email)) return { ok: false, message: 'Duplicate team member email in the same team' }
    seen.add(member.email)
  }

  return { ok: true, data: { name: trimmedName, members: normalizedMembers } }
}
