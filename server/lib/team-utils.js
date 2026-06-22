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

export function normalizeTeamName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function teamNameKey(value) {
  return normalizeTeamName(value).toLowerCase()
}

export function isValidTeamSize(count) {
  return count >= 2 && count <= 5
}

export function buildSuggestedTeamName(baseName, existingTeams = [], excludeTeamId = null) {
  const base = normalizeTeamName(baseName) || 'Team'
  const taken = new Set(
    (Array.isArray(existingTeams) ? existingTeams : [])
      .filter((team) => !excludeTeamId || String(team?.id) !== String(excludeTeamId))
      .map((team) => teamNameKey(team?.name))
      .filter(Boolean),
  )

  const baseKey = teamNameKey(base)
  if (baseKey && !taken.has(baseKey)) return base

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`
    if (!taken.has(teamNameKey(candidate))) return candidate
  }

  return `${base} ${Date.now().toString(36)}`
}

export function buildLockedLeadMember(user) {
  const email = normalizeEmail(user?.email)
  const names = splitName(user?.name, email)
  return {
    id: String(user?.id || uuidv4()),
    name: `${names.firstName} ${names.lastName}`.replace(/\s+/g, ' ').trim() || email,
    email,
    status: 'active',
    verified: true,
  }
}

export function normalizeCreateTeamMembers(members, user) {
  const lead = buildLockedLeadMember(user)
  const raw = Array.isArray(members) ? members : []
  const extras = raw
    .map((member) => {
      const email = normalizeEmail(member?.email)
      const name = String(member?.name || '').replace(/\s+/g, ' ').trim() || (email ? email.split('@')[0] : '')
      return {
        id: member && member.id ? String(member.id) : uuidv4(),
        name,
        email,
        status: normalizeTeamMemberStatus(member?.status, member?.verified),
        verified: Boolean(member?.verified),
      }
    })
    .filter((member) => member.email)
    .filter((member) => member.email !== lead.email)

  const seen = new Set([lead.email])
  const normalized = [lead]
  for (const member of extras) {
    if (seen.has(member.email)) continue
    seen.add(member.email)
    normalized.push(member)
    if (normalized.length >= 5) break
  }
  return normalized
}

export function normalizeTeamMemberStatus(status, verified = false) {
  if (verified === true) return 'active'
  const value = String(status || '').trim().toLowerCase()
  if (value === 'active' || value === 'pending_verification' || value === 'invited') return value
  return 'invited'
}
