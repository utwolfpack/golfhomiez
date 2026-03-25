import { v4 as uuidv4 } from 'uuid'

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

export function splitName(name, fallbackEmail = '') {
  const trimmed = String(name || '').trim()
  if (!trimmed) {
    const local = String(fallbackEmail || '').split('@')[0] || ''
    return { firstName: local, lastName: '' }
  }
  const [firstName = '', ...rest] = trimmed.split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}

export function buildLockedLeadMember(user) {
  const email = normalizeEmail(user?.email)
  const names = splitName(user?.name, email)
  return {
    id: String(user?.id || uuidv4()),
    name: `${names.firstName} ${names.lastName}`.replace(/\s+/g, ' ').trim() || email,
    email,
  }
}

export function normalizeCreateTeamMembers(members, user) {
  const lead = buildLockedLeadMember(user)
  const raw = Array.isArray(members) ? members : []
  const extras = raw
    .map((member) => ({
      id: member && member.id ? String(member.id) : uuidv4(),
      name: String(member?.name || '').replace(/\s+/g, ' ').trim(),
      email: normalizeEmail(member?.email),
    }))
    .filter((member) => member.name || member.email)
    .filter((member) => member.email && member.email !== lead.email)

  const seen = new Set([lead.email])
  const normalized = [lead]
  for (const member of extras) {
    if (seen.has(member.email)) continue
    seen.add(member.email)
    normalized.push(member)
    if (normalized.length >= 4) break
  }
  return normalized
}
