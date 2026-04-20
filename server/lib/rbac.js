import { createHash, randomBytes, randomUUID } from 'crypto'
import { normalizeEmail } from './team-utils.js'

export const ROLE_USER = 'user'
export const ROLE_HOST = 'host'
export const ROLE_ORGANIZER = 'organizer'
export const ROLE_ADMIN = 'admin'
export const SUPPORTED_ROLES = [ROLE_USER, ROLE_HOST, ROLE_ORGANIZER, ROLE_ADMIN]

function createId() {
  return randomUUID().replace(/-/g, '')
}

function hashSecurityKey(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

function mapRoleAssignmentRow(row) {
  if (!row) return null
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    role: row.role_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapHostInviteRow(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    inviteType: row.invite_type,
    inviteUrl: row.invite_url,
    invitedByAuthUserId: row.invited_by_auth_user_id,
    invitedByEmail: row.invited_by_email,
    status: row.status,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase()
  return SUPPORTED_ROLES.includes(role) ? role : ''
}

export function sanitizeHostAccountPayload(body = {}) {
  const golfCourseName = String(body.golfCourseName || '').trim()
  const contactName = String(body.contactName || '').trim()
  const phone = String(body.phone || '').trim()
  const websiteUrl = String(body.websiteUrl || '').trim()
  const city = String(body.city || '').trim()
  const state = String(body.state || '').trim()
  const postalCode = String(body.postalCode || '').trim()
  const notes = String(body.notes || '').trim()
  const securityKey = String(body.securityKey || '').trim()

  if (!golfCourseName) throw new Error('Golf course name is required.')
  if (!contactName) throw new Error('Contact name is required.')

  return {
    golfCourseName,
    contactName,
    phone: phone || null,
    websiteUrl: websiteUrl || null,
    city: city || null,
    state: state || null,
    postalCode: postalCode || null,
    notes: notes || null,
    securityKey: securityKey || null,
  }
}

export function sanitizeOrganizerAccountPayload(body = {}) {
  const organizationName = String(body.organizationName || '').trim()
  const contactName = String(body.contactName || '').trim()
  const phone = String(body.phone || '').trim()
  const websiteUrl = String(body.websiteUrl || '').trim()
  const notes = String(body.notes || '').trim()

  if (!organizationName) throw new Error('Organization name is required.')
  if (!contactName) throw new Error('Contact name is required.')

  return {
    organizationName,
    contactName,
    phone: phone || null,
    websiteUrl: websiteUrl || null,
    notes: notes || null,
  }
}

export function sanitizeTournamentPayload(body = {}) {
  const name = String(body.name || '').trim()
  const description = String(body.description || '').trim()
  const startDate = String(body.startDate || '').trim()
  const endDate = String(body.endDate || '').trim()
  const hostAccountId = String(body.hostAccountId || '').trim()
  const status = String(body.status || 'draft').trim().toLowerCase()
  const isPublic = body.isPublic === true || body.isPublic === 'true' || body.isPublic === 1 || body.isPublic === '1'
  const allowedStatuses = new Set(['draft', 'published', 'completed', 'cancelled'])

  if (!name) throw new Error('Tournament name is required.')
  if (!startDate) throw new Error('Tournament start date is required.')
  if (Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new Error('Tournament start date is invalid.')
  if (endDate && Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) throw new Error('Tournament end date is invalid.')
  if (endDate && endDate < startDate) throw new Error('Tournament end date cannot be earlier than the start date.')
  if (!allowedStatuses.has(status)) throw new Error('Tournament status is invalid.')

  return {
    name,
    description: description || null,
    startDate,
    endDate: endDate || null,
    hostAccountId: hostAccountId || null,
    status,
    isPublic,
  }
}

export function sanitizeHostInvitePayload(body = {}) {
  const email = normalizeEmail(body.email)
  const message = String(body.message || '').trim()
  const expiresInDays = Math.min(Math.max(Number(body.expiresInDays) || 14, 1), 90)
  if (!email) throw new Error('Invite email is required.')
  return { email, message: message || null, expiresInDays }
}

function mapHostAccountRow(row) {
  if (!row) return null
  return {
    id: row.id,
    roleAssignmentId: row.role_assignment_id,
    authUserId: row.auth_user_id,
    email: row.email,
    role: row.role_key,
    golfCourseName: row.golf_course_name,
    contactName: row.contact_name,
    phone: row.phone,
    websiteUrl: row.website_url,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapOrganizerAccountRow(row) {
  if (!row) return null
  return {
    id: row.id,
    roleAssignmentId: row.role_assignment_id,
    authUserId: row.auth_user_id,
    email: row.email,
    role: row.role_key,
    organizationName: row.organization_name,
    contactName: row.contact_name,
    phone: row.phone,
    websiteUrl: row.website_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapTournamentRow(row) {
  return {
    id: row.id,
    organizerAccountId: row.organizer_account_id,
    hostAccountId: row.host_account_id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    isPublic: Boolean(row.is_public),
    createdByAuthUserId: row.created_by_auth_user_id,
    organizerName: row.organizer_name,
    hostGolfCourseName: row.host_golf_course_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function ensureBaseUserRole(pool, user) {
  const email = normalizeEmail(user.email)
  await pool.execute(
    `INSERT INTO user_role_assignments (id, auth_user_id, email, role_key, status)
     VALUES (?, ?, ?, 'user', 'active')
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
    [createId(), user.id, email],
  )
}

export async function createOrUpdateRoleAssignment(pool, user, roleKey) {
  const role = normalizeRole(roleKey)
  if (!role || role === ROLE_USER) throw new Error('A creatable elevated role is required.')
  const email = normalizeEmail(user.email)

  await pool.execute(
    `INSERT INTO user_role_assignments (id, auth_user_id, email, role_key, status)
     VALUES (?, ?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
    [createId(), user.id, email, role],
  )

  const [rows] = await pool.execute(
    `SELECT id, auth_user_id, email, role_key, status, created_at, updated_at
       FROM user_role_assignments
      WHERE auth_user_id = ? AND role_key = ?
      LIMIT 1`,
    [user.id, role],
  )

  return rows[0] || null
}

export async function getUserRoles(pool, authUserId) {
  const [rows] = await pool.execute(
    `SELECT role_key
       FROM user_role_assignments
      WHERE auth_user_id = ? AND status = 'active'
      ORDER BY role_key ASC`,
    [authUserId],
  )

  const roles = rows.map((row) => row.role_key).filter(Boolean)
  return Array.from(new Set(roles))
}

export async function getRbacSummary(pool, user) {
  await ensureBaseUserRole(pool, user)
  const roles = await getUserRoles(pool, user.id)
  const [hostRows] = await pool.execute(
    `SELECT hra.*, ura.auth_user_id, ura.email, ura.role_key
       FROM host_role_accounts hra
       JOIN user_role_assignments ura ON ura.id = hra.role_assignment_id
      WHERE ura.auth_user_id = ?
      LIMIT 1`,
    [user.id],
  )
  const [organizerRows] = await pool.execute(
    `SELECT ora.*, ura.auth_user_id, ura.email, ura.role_key
       FROM organizer_role_accounts ora
       JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE ura.auth_user_id = ?
      LIMIT 1`,
    [user.id],
  )

  return {
    roles,
    canCreateHostAccount: !roles.includes(ROLE_HOST),
    canCreateOrganizerAccount: !roles.includes(ROLE_ORGANIZER),
    canAccessAdminPortal: roles.includes(ROLE_ADMIN),
    hostAccount: mapHostAccountRow(hostRows[0] || null),
    organizerAccount: mapOrganizerAccountRow(organizerRows[0] || null),
  }
}

export async function validateHostInviteSecurityKey(pool, email, securityKey) {
  const normalizedEmail = normalizeEmail(email)
  const rawKey = String(securityKey || '').trim()
  if (!normalizedEmail || !rawKey) throw new Error('A valid security key is required to create a golf course account.')

  const [rows] = await pool.execute(
    `SELECT *
       FROM host_account_invites
      WHERE email = ? AND invite_type = 'host_account' AND status = 'issued'
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizedEmail],
  )
  const invite = rows[0]
  if (!invite) throw new Error('No active golf course invite was found for this user.')
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    await pool.execute(`UPDATE host_account_invites SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [invite.id])
    throw new Error('The security key has expired. Request a new golf course invite from an admin.')
  }
  if (invite.security_key_hash !== hashSecurityKey(rawKey)) {
    throw new Error('The security key is invalid for this user.')
  }
  return invite
}

export async function consumeHostInvite(pool, inviteId) {
  if (!inviteId) return
  await pool.execute(
    `UPDATE host_account_invites
        SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'issued'`,
    [inviteId],
  )
}

export async function upsertHostAccount(pool, user, input) {
  const payload = sanitizeHostAccountPayload(input)
  const existingAccount = await getHostAccountForUser(pool, user.id)
  let invite = null
  if (!existingAccount) {
    invite = await validateHostInviteSecurityKey(pool, user.email, payload.securityKey)
  }

  const assignment = await createOrUpdateRoleAssignment(pool, user, ROLE_HOST)
  await pool.execute(
    `INSERT INTO host_role_accounts
      (id, role_assignment_id, golf_course_name, contact_name, phone, website_url, city, state, postal_code, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       golf_course_name = VALUES(golf_course_name),
       contact_name = VALUES(contact_name),
       phone = VALUES(phone),
       website_url = VALUES(website_url),
       city = VALUES(city),
       state = VALUES(state),
       postal_code = VALUES(postal_code),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [createId(), assignment.id, payload.golfCourseName, payload.contactName, payload.phone, payload.websiteUrl, payload.city, payload.state, payload.postalCode, payload.notes],
  )

  if (invite?.id) await consumeHostInvite(pool, invite.id)

  const [rows] = await pool.execute(
    `SELECT hra.*, ura.auth_user_id, ura.email, ura.role_key
       FROM host_role_accounts hra
       JOIN user_role_assignments ura ON ura.id = hra.role_assignment_id
      WHERE hra.role_assignment_id = ?
      LIMIT 1`,
    [assignment.id],
  )
  return mapHostAccountRow(rows[0] || null)
}

export async function upsertOrganizerAccount(pool, user, input) {
  const payload = sanitizeOrganizerAccountPayload(input)
  const assignment = await createOrUpdateRoleAssignment(pool, user, ROLE_ORGANIZER)
  await pool.execute(
    `INSERT INTO organizer_role_accounts
      (id, role_assignment_id, organization_name, contact_name, phone, website_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       organization_name = VALUES(organization_name),
       contact_name = VALUES(contact_name),
       phone = VALUES(phone),
       website_url = VALUES(website_url),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [createId(), assignment.id, payload.organizationName, payload.contactName, payload.phone, payload.websiteUrl, payload.notes],
  )

  const [rows] = await pool.execute(
    `SELECT ora.*, ura.auth_user_id, ura.email, ura.role_key
       FROM organizer_role_accounts ora
       JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE ora.role_assignment_id = ?
      LIMIT 1`,
    [assignment.id],
  )
  return mapOrganizerAccountRow(rows[0] || null)
}

export async function listHostAccounts(pool) {
  const [rows] = await pool.execute(
    `SELECT hra.*, ura.auth_user_id, ura.email, ura.role_key
       FROM host_role_accounts hra
       JOIN user_role_assignments ura ON ura.id = hra.role_assignment_id
      ORDER BY hra.golf_course_name ASC, hra.created_at ASC`,
  )
  return rows.map(mapHostAccountRow)
}

export async function getHostAccountForUser(pool, authUserId) {
  const [rows] = await pool.execute(
    `SELECT hra.*, ura.auth_user_id, ura.email, ura.role_key
       FROM host_role_accounts hra
       JOIN user_role_assignments ura ON ura.id = hra.role_assignment_id
      WHERE ura.auth_user_id = ?
      LIMIT 1`,
    [authUserId],
  )
  return mapHostAccountRow(rows[0] || null)
}

export async function getOrganizerAccountForUser(pool, authUserId) {
  const [rows] = await pool.execute(
    `SELECT ora.*, ura.auth_user_id, ura.email, ura.role_key
       FROM organizer_role_accounts ora
       JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE ura.auth_user_id = ?
      LIMIT 1`,
    [authUserId],
  )
  return mapOrganizerAccountRow(rows[0] || null)
}

export async function listOrganizerTournaments(pool, authUserId) {
  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name
       FROM tournaments t
       JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE ura.auth_user_id = ?
      ORDER BY t.start_date DESC, t.created_at DESC`,
    [authUserId],
  )
  return rows.map(mapTournamentRow)
}

export async function listAllTournaments(pool) {
  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name
       FROM tournaments t
       JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
      ORDER BY t.start_date DESC, t.created_at DESC`,
  )
  return rows.map(mapTournamentRow)
}

export async function listRoleAssignments(pool) {
  const [rows] = await pool.execute(
    `SELECT id, auth_user_id, email, role_key, status, created_at, updated_at
       FROM user_role_assignments
      ORDER BY email ASC, role_key ASC`,
  )
  return rows.map(mapRoleAssignmentRow)
}

export async function listAdminUsers(pool) {
  const [rows] = await pool.execute(
    `SELECT id, auth_user_id, email, name, primary_city, primary_state, primary_zip_code, alcohol_preference, cannabis_preference, sobriety_preference, created_at, updated_at, profile_enriched_at
       FROM app_users
      ORDER BY email ASC, created_at ASC`,
  )
  return rows.map((row) => ({
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    name: row.name,
    primaryCity: row.primary_city,
    primaryState: row.primary_state,
    primaryZipCode: row.primary_zip_code,
    alcoholPreference: row.alcohol_preference,
    cannabisPreference: row.cannabis_preference,
    sobrietyPreference: row.sobriety_preference,
    profileEnrichedAt: row.profile_enriched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function listHostInvites(pool) {
  const [rows] = await pool.execute(
    `SELECT id, email, invite_type, invite_url, invited_by_auth_user_id, invited_by_email, status, expires_at, consumed_at, created_at, updated_at
       FROM host_account_invites
      ORDER BY created_at DESC`,
  )
  return rows.map(mapHostInviteRow)
}

export async function createHostInvite(pool, { email, invitedBy, inviteUrl, expiresInDays = 14 }) {
  const securityKey = randomBytes(18).toString('hex')
  const id = createId()
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
  await pool.execute(
    `UPDATE host_account_invites
        SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
      WHERE email = ? AND invite_type = 'host_account' AND status = 'issued'`,
    [email],
  )
  await pool.execute(
    `INSERT INTO host_account_invites
      (id, email, invite_type, security_key_hash, invite_url, invited_by_auth_user_id, invited_by_email, status, expires_at)
     VALUES (?, ?, 'host_account', ?, ?, ?, ?, 'issued', ?)`,
    [id, email, hashSecurityKey(securityKey), inviteUrl || null, invitedBy?.id || null, normalizeEmail(invitedBy?.email || ''), expiresAt],
  )

  const [rows] = await pool.execute(
    `SELECT id, email, invite_type, invite_url, invited_by_auth_user_id, invited_by_email, status, expires_at, consumed_at, created_at, updated_at
       FROM host_account_invites
      WHERE id = ?
      LIMIT 1`,
    [id],
  )

  return {
    invite: mapHostInviteRow(rows[0] || null),
    securityKey,
  }
}

export async function getAdminPortalSummary(pool) {
  const [users, roleAssignments, hostAccounts, organizerAccounts, tournaments, hostInvites] = await Promise.all([
    listAdminUsers(pool),
    listRoleAssignments(pool),
    listHostAccounts(pool),
    (async () => {
      const [rows] = await pool.execute(
        `SELECT ora.*, ura.auth_user_id, ura.email, ura.role_key
           FROM organizer_role_accounts ora
           JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
          ORDER BY ora.organization_name ASC, ora.created_at ASC`,
      )
      return rows.map(mapOrganizerAccountRow)
    })(),
    listAllTournaments(pool),
    listHostInvites(pool),
  ])

  return { users, roleAssignments, hostAccounts, organizerAccounts, tournaments, hostInvites }
}

export async function createTournament(pool, user, input) {
  const payload = sanitizeTournamentPayload(input)
  const organizerAccount = await getOrganizerAccountForUser(pool, user.id)
  if (!organizerAccount) throw new Error('Organizer account is required before creating tournaments.')

  if (payload.hostAccountId) {
    const [hostRows] = await pool.execute(
      `SELECT id FROM host_role_accounts WHERE id = ? LIMIT 1`,
      [payload.hostAccountId],
    )
    if (!hostRows[0]) throw new Error('Selected host account was not found.')
  }

  const id = createId()
  await pool.execute(
    `INSERT INTO tournaments
      (id, organizer_account_id, host_account_id, name, description, start_date, end_date, status, is_public, created_by_auth_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizerAccount.id, payload.hostAccountId, payload.name, payload.description, payload.startDate, payload.endDate, payload.status, payload.isPublic ? 1 : 0, user.id],
  )

  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name
       FROM tournaments t
       JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
      WHERE t.id = ?
      LIMIT 1`,
    [id],
  )
  return mapTournamentRow(rows[0] || null)
}
