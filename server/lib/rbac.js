import { createHash, randomBytes, randomUUID } from 'crypto'
import { normalizeEmail } from './team-utils.js'
import { getOrganizerAuthAccountByEmail } from './organizer-auth.js'

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

function slugifyTournamentName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function buildTournamentIdentifier(name) {
  const base = slugifyTournamentName(name) || 'tournament'
  const suffix = randomBytes(3).toString('hex')
  return `${base}-${suffix}`
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

function mapOrganizerTournamentInviteRow(row) {
  if (!row) return null
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    tournamentIdentifier: row.tournament_identifier,
    organizerEmail: row.organizer_email,
    organizerAccountId: row.organizer_account_id,
    inviteToken: row.invite_token,
    inviteUrl: row.invite_url,
    status: row.status,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}


async function resolveHostTournamentAccountId(pool, hostAccountId) {
  const directHostAccountId = String(hostAccountId || '').trim()
  if (!directHostAccountId) throw new Error('Host account is required.')

  const [existingRows] = await pool.execute(
    `SELECT id
       FROM host_role_accounts
      WHERE id = ?
      LIMIT 1`,
    [directHostAccountId],
  )
  if (existingRows[0]?.id) return existingRows[0].id

  let hostAccount = null
  try {
    const [hostRows] = await pool.execute(
      `SELECT id, auth_user_id, email, golf_course_name, account_name
         FROM host_accounts
        WHERE id = ?
        LIMIT 1`,
      [directHostAccountId],
    )
    hostAccount = hostRows[0] || null
  } catch {
    hostAccount = null
  }

  const normalizedEmail = normalizeEmail(hostAccount?.email)
  const authUserId = String(hostAccount?.auth_user_id || '').trim()

  if (authUserId) {
    const [authRows] = await pool.execute(
      `SELECT hra.id
         FROM host_role_accounts hra
         JOIN user_role_assignments ura ON ura.id = hra.role_assignment_id
        WHERE ura.auth_user_id = ?
        LIMIT 1`,
      [authUserId],
    )
    if (authRows[0]?.id) return authRows[0].id
  }

  if (normalizedEmail) {
    const [emailRows] = await pool.execute(
      `SELECT hra.id
         FROM host_role_accounts hra
         JOIN user_role_assignments ura ON ura.id = hra.role_assignment_id
        WHERE LOWER(ura.email) = ?
        LIMIT 1`,
      [normalizedEmail],
    )
    if (emailRows[0]?.id) return emailRows[0].id
  }

  if (!hostAccount) {
    throw new Error('Host account was not found for tournament creation.')
  }

  const roleAssignmentAuthUserId = authUserId || `host-direct:${hostAccount.id}`
  const roleAssignmentEmail = normalizedEmail || `${hostAccount.id}@host.local`
  const roleAssignmentId = createId()

  await pool.execute(
    `INSERT INTO user_role_assignments
      (id, auth_user_id, email, role_key, status)
     VALUES (?, ?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
    [roleAssignmentId, roleAssignmentAuthUserId, roleAssignmentEmail, ROLE_HOST],
  )

  const [assignmentRows] = await pool.execute(
    `SELECT id
       FROM user_role_assignments
      WHERE auth_user_id = ? AND role_key = ?
      LIMIT 1`,
    [roleAssignmentAuthUserId, ROLE_HOST],
  )
  const assignmentId = assignmentRows[0]?.id
  if (!assignmentId) {
    throw new Error('Unable to prepare host role assignment for tournament creation.')
  }

  const golfCourseName = String(hostAccount.golf_course_name || hostAccount.account_name || 'Host account').trim() || 'Host account'
  const contactName = String(hostAccount.account_name || hostAccount.golf_course_name || 'Host account').trim() || 'Host account'

  await pool.execute(
    `INSERT INTO host_role_accounts
      (id, role_assignment_id, golf_course_name, contact_name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       role_assignment_id = VALUES(role_assignment_id),
       golf_course_name = VALUES(golf_course_name),
       contact_name = VALUES(contact_name),
       updated_at = CURRENT_TIMESTAMP`,
    [directHostAccountId, assignmentId, golfCourseName, contactName],
  )

  return directHostAccountId
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

export function sanitizeTournamentPayload(body = {}, options = {}) {
  const name = String(body.name || '').trim()
  const description = String(body.description || '').trim()
  const startDate = String(body.startDate || '').trim()
  const endDate = String(body.endDate || '').trim()
  const hostAccountId = String(body.hostAccountId || '').trim()
  const status = String(body.status || 'draft').trim().toLowerCase()
  const isPublic = body.isPublic === true || body.isPublic === 'true' || body.isPublic === 1 || body.isPublic === '1'
  const requireDates = options.requireDates !== false
  const allowedStatuses = new Set(['draft', 'published', 'completed', 'cancelled'])

  if (!name) throw new Error('Tournament name is required.')
  if (requireDates && !startDate) throw new Error('Tournament start date is required.')
  if (startDate && Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new Error('Tournament start date is invalid.')
  if (endDate && Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) throw new Error('Tournament end date is invalid.')
  if (startDate && endDate && endDate < startDate) throw new Error('Tournament end date cannot be earlier than the start date.')
  if (!allowedStatuses.has(status)) throw new Error('Tournament status is invalid.')

  return {
    name,
    description: description || null,
    startDate: startDate || null,
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

export function sanitizeOrganizerTournamentInvitePayload(body = {}) {
  const organizerEmail = normalizeEmail(body.organizerEmail || body.email)
  const message = String(body.message || '').trim()
  if (!organizerEmail) throw new Error('Organizer email is required.')
  return { organizerEmail, message: message || null }
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
    tournamentIdentifier: row.tournament_identifier,
    organizerEmail: row.organizer_email,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    isPublic: Boolean(row.is_public),
    createdByAuthUserId: row.created_by_auth_user_id,
    organizerName: row.organizer_name,
    hostGolfCourseName: row.host_golf_course_name,
    invitedByHostAccountId: row.invited_by_host_account_id || null,
    inviteId: row.invite_id || null,
    inviteStatus: row.invite_status || null,
    inviteUrl: row.invite_url || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function ensureTournamentInviteSchema(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS organizer_tournament_invites (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    tournament_id VARCHAR(191) NOT NULL,
    host_account_id VARCHAR(191) NOT NULL,
    organizer_email VARCHAR(191) NOT NULL,
    organizer_account_id VARCHAR(191) NULL,
    invite_token VARCHAR(191) NOT NULL,
    invite_url TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'issued',
    sent_at DATETIME NULL,
    accepted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_organizer_tournament_invites_tournament_id (tournament_id),
    KEY idx_organizer_tournament_invites_email (organizer_email),
    KEY idx_organizer_tournament_invites_status (status)
  )`)

  const [identifierColumnRows] = await pool.execute(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tournaments'
        AND COLUMN_NAME = 'tournament_identifier'
      LIMIT 1`,
  )
  if (!identifierColumnRows.length) {
    await pool.execute(`ALTER TABLE tournaments ADD COLUMN tournament_identifier VARCHAR(191) NULL`)
  }

  const [organizerEmailColumnRows] = await pool.execute(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tournaments'
        AND COLUMN_NAME = 'organizer_email'
      LIMIT 1`,
  )
  if (!organizerEmailColumnRows.length) {
    await pool.execute(`ALTER TABLE tournaments ADD COLUMN organizer_email VARCHAR(191) NULL`)
  }

  const [nullableColumnRows] = await pool.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tournaments'
        AND COLUMN_NAME IN ('organizer_account_id', 'start_date', 'end_date')`,
  )
  const nullableColumns = new Map(nullableColumnRows.map((row) => [row.COLUMN_NAME, row.IS_NULLABLE]))
  if (nullableColumns.get('organizer_account_id') === 'NO') {
    await pool.execute(`ALTER TABLE tournaments MODIFY COLUMN organizer_account_id VARCHAR(191) NULL`)
  }
  if (nullableColumns.get('start_date') === 'NO') {
    await pool.execute(`ALTER TABLE tournaments MODIFY COLUMN start_date DATE NULL`)
  }
  if (nullableColumns.get('end_date') === 'NO') {
    await pool.execute(`ALTER TABLE tournaments MODIFY COLUMN end_date DATE NULL`)
  }

  const [identifierIndexRows] = await pool.execute(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tournaments'
        AND INDEX_NAME = 'uq_tournaments_identifier'
      LIMIT 1`,
  )
  if (!identifierIndexRows.length) {
    await pool.execute(`ALTER TABLE tournaments ADD UNIQUE INDEX uq_tournaments_identifier (tournament_identifier)`)
  }

  const [organizerEmailIndexRows] = await pool.execute(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tournaments'
        AND INDEX_NAME = 'idx_tournaments_organizer_email'
      LIMIT 1`,
  )
  if (!organizerEmailIndexRows.length) {
    await pool.execute(`ALTER TABLE tournaments ADD INDEX idx_tournaments_organizer_email (organizer_email)`)
  }
}

async function getAppUserByEmail(pool, email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null
  const [rows] = await pool.execute(`SELECT id, email, name FROM user WHERE LOWER(email) = ? LIMIT 1`, [normalizedEmail])
  return rows[0] || null
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
  await ensureTournamentInviteSchema(pool)
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
    throw new Error('The security key is invalid for this golf course invite.')
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

export async function ensureOrganizerAccountForInvitedUser(pool, user) {
  await ensureTournamentInviteSchema(pool)
  const existing = await getOrganizerAccountForUser(pool, user.id)
  if (existing) return existing

  const normalizedEmail = normalizeEmail(user.email)
  const [inviteRows] = await pool.execute(
    `SELECT oti.*, t.name AS tournament_name
       FROM organizer_tournament_invites oti
       JOIN tournaments t ON t.id = oti.tournament_id
      WHERE oti.organizer_email = ? AND oti.status IN ('issued', 'accepted')
      ORDER BY oti.created_at ASC`,
    [normalizedEmail],
  )
  if (!inviteRows[0]) return null

  const fallbackName = String(user.name || normalizedEmail.split('@')[0] || 'Organizer').trim()
  const fallbackOrg = `${inviteRows[0].tournament_name || 'Tournament'} Organizer`
  const account = await upsertOrganizerAccount(pool, user, {
    organizationName: fallbackOrg,
    contactName: fallbackName,
    phone: '',
    websiteUrl: '',
    notes: 'Auto-created from tournament invitation.',
  })

  await pool.execute(
    `UPDATE organizer_tournament_invites
        SET organizer_account_id = ?,
            status = CASE WHEN status = 'issued' THEN 'accepted' ELSE status END,
            accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE organizer_email = ?`,
    [account.id, normalizedEmail],
  )

  await pool.execute(
    `UPDATE tournaments
        SET organizer_account_id = COALESCE(organizer_account_id, ?)
      WHERE organizer_email = ?`,
    [account.id, normalizedEmail],
  )

  return account
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

export async function getOrganizerAccountByEmail(pool, email) {
  const normalizedEmail = normalizeEmail(email)
  const [rows] = await pool.execute(
    `SELECT ora.*, ura.auth_user_id, ura.email, ura.role_key
       FROM organizer_role_accounts ora
       JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id
      WHERE LOWER(ura.email) = ?
      LIMIT 1`,
    [normalizedEmail],
  )
  return mapOrganizerAccountRow(rows[0] || null)
}

export async function getOrganizerInviteEligibility(pool, email) {
  await ensureTournamentInviteSchema(pool)
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return {
      email: '',
      eligible: false,
      inviteCount: 0,
      hasOrganizerAccount: false,
    }
  }

  const organizerAccount = await getOrganizerAuthAccountByEmail(pool, normalizedEmail)
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS invite_count
       FROM organizer_tournament_invites
      WHERE organizer_email = ? AND status IN ('issued', 'accepted')`,
    [normalizedEmail],
  )

  const inviteCount = Number(countRows[0]?.invite_count || 0)
  return {
    email: normalizedEmail,
    eligible: inviteCount > 0,
    inviteCount,
    hasOrganizerAccount: Boolean(organizerAccount),
  }
}

export async function listOrganizerTournaments(pool, authUserId) {
  await ensureTournamentInviteSchema(pool)
  const organizerAccount = await getOrganizerAccountForUser(pool, authUserId)
  const organizerAccountId = organizerAccount?.id || null
  const authEmail = organizerAccount?.email ? normalizeEmail(organizerAccount.email) : null
  const params = []
  const where = []
  if (organizerAccountId) {
    where.push('(t.organizer_account_id = ? OR oti.organizer_account_id = ?)')
    params.push(organizerAccountId, organizerAccountId)
  }
  if (authEmail) {
    where.push('oti.organizer_email = ?')
    params.push(authEmail)
  }
  if (!where.length) return []

  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name,
            oti.id AS invite_id, oti.status AS invite_status, oti.invite_url, oti.host_account_id AS invited_by_host_account_id
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN organizer_tournament_invites oti ON oti.tournament_id = t.id AND oti.status IN ('issued', 'accepted')
      WHERE ${where.join(' OR ')}
      ORDER BY t.start_date DESC, t.created_at DESC`,
    params,
  )
  return rows.map(mapTournamentRow)
}

export async function listOrganizerTournamentsByEmail(pool, organizerEmail) {
  await ensureTournamentInviteSchema(pool)
  const normalizedEmail = normalizeEmail(organizerEmail)
  if (!normalizedEmail) return []

  const legacyOrganizerAccount = await getOrganizerAccountByEmail(pool, normalizedEmail)
  const params = [normalizedEmail]
  let where = '(t.organizer_email = ? OR oti.organizer_email = ?)'
  params.push(normalizedEmail)

  if (legacyOrganizerAccount?.id) {
    where = `${where} OR t.organizer_account_id = ? OR oti.organizer_account_id = ?`
    params.push(legacyOrganizerAccount.id, legacyOrganizerAccount.id)
  }

  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name,
            oti.id AS invite_id, oti.status AS invite_status, oti.invite_url, oti.host_account_id AS invited_by_host_account_id
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN organizer_tournament_invites oti ON oti.tournament_id = t.id AND oti.status IN ('issued', 'accepted')
      WHERE ${where}
      ORDER BY t.start_date DESC, t.created_at DESC`,
    params,
  )
  return rows.map(mapTournamentRow)
}

export async function createOrganizerTournamentForEmail(pool, organizerEmail, input) {
  await ensureTournamentInviteSchema(pool)
  const payload = sanitizeTournamentPayload(input)
  const normalizedEmail = normalizeEmail(organizerEmail)
  if (!normalizedEmail) throw new Error('Organizer email is required before creating tournaments.')

  if (payload.hostAccountId) {
    const [hostRows] = await pool.execute(
      `SELECT id FROM host_role_accounts WHERE id = ? LIMIT 1`,
      [payload.hostAccountId],
    )
    if (!hostRows[0]) throw new Error('Selected host account was not found.')
  }

  const legacyOrganizerAccount = await getOrganizerAccountByEmail(pool, normalizedEmail)
  const id = createId()
  const tournamentIdentifier = buildTournamentIdentifier(payload.name)
  await pool.execute(
    `INSERT INTO tournaments
      (id, organizer_account_id, host_account_id, tournament_identifier, organizer_email, name, description, start_date, end_date, status, is_public, created_by_auth_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, legacyOrganizerAccount?.id || null, payload.hostAccountId, tournamentIdentifier, normalizedEmail, payload.name, payload.description, payload.startDate, payload.endDate, payload.status, payload.isPublic ? 1 : 0, `organizer:${normalizedEmail}`],
  )

  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
      WHERE t.id = ?
      LIMIT 1`,
    [id],
  )
  return mapTournamentRow(rows[0] || null)
}

export async function listAllTournaments(pool) {
  await ensureTournamentInviteSchema(pool)
  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
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

export async function listOrganizerTournamentInvitesForTournament(pool, tournamentId) {
  await ensureTournamentInviteSchema(pool)
  const [rows] = await pool.execute(
    `SELECT *
       FROM organizer_tournament_invites
      WHERE tournament_id = ?
      ORDER BY created_at DESC`,
    [tournamentId],
  )
  return rows.map(mapOrganizerTournamentInviteRow)
}

export async function listHostManagedTournaments(pool, hostAccountId) {
  await ensureTournamentInviteSchema(pool)
  const resolvedHostAccountId = await resolveHostTournamentAccountId(pool, hostAccountId)
  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name,
            oti.id AS invite_id, oti.status AS invite_status, oti.invite_url, oti.host_account_id AS invited_by_host_account_id
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN organizer_tournament_invites oti ON oti.tournament_id = t.id AND oti.status IN ('issued', 'accepted')
      WHERE t.host_account_id = ?
      ORDER BY t.created_at DESC`,
    [resolvedHostAccountId],
  )
  return rows.map(mapTournamentRow)
}

export async function createTournament(pool, user, input) {
  await ensureTournamentInviteSchema(pool)
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
  const tournamentIdentifier = buildTournamentIdentifier(payload.name)
  await pool.execute(
    `INSERT INTO tournaments
      (id, organizer_account_id, host_account_id, tournament_identifier, organizer_email, name, description, start_date, end_date, status, is_public, created_by_auth_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizerAccount.id, payload.hostAccountId, tournamentIdentifier, normalizeEmail(user.email), payload.name, payload.description, payload.startDate, payload.endDate, payload.status, payload.isPublic ? 1 : 0, user.id],
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

export async function createHostManagedTournament(pool, hostAccountId, input) {
  await ensureTournamentInviteSchema(pool)
  const resolvedHostAccountId = await resolveHostTournamentAccountId(pool, hostAccountId)
  const payload = sanitizeTournamentPayload({ ...input, hostAccountId: resolvedHostAccountId }, { requireDates: false })
  const organizerEmail = normalizeEmail(input.organizerEmail || input.email)
  const id = createId()
  const tournamentIdentifier = buildTournamentIdentifier(payload.name)

  await pool.execute(
    `INSERT INTO tournaments
      (id, organizer_account_id, host_account_id, tournament_identifier, organizer_email, name, description, start_date, end_date, status, is_public, created_by_auth_user_id)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, resolvedHostAccountId, tournamentIdentifier, organizerEmail || null, payload.name, payload.description, payload.startDate, payload.endDate, payload.status, payload.isPublic ? 1 : 0, `host:${resolvedHostAccountId}`],
  )

  const [rows] = await pool.execute(
    `SELECT t.*, hra.golf_course_name AS host_golf_course_name
       FROM tournaments t
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
      WHERE t.id = ?
      LIMIT 1`,
    [id],
  )
  return mapTournamentRow(rows[0] || null)
}

export async function createTournamentOrganizerInvite(pool, { tournamentId, hostAccountId, organizerEmail, inviteUrl }) {
  await ensureTournamentInviteSchema(pool)
  const resolvedHostAccountId = await resolveHostTournamentAccountId(pool, hostAccountId)
  const normalizedEmail = normalizeEmail(organizerEmail)
  if (!normalizedEmail) throw new Error('Organizer email is required.')

  const organizerAccount = await getOrganizerAccountByEmail(pool, normalizedEmail)
  const inviteToken = randomBytes(18).toString('hex')
  const id = createId()

  await pool.execute(
    `UPDATE organizer_tournament_invites
        SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
      WHERE tournament_id = ? AND organizer_email = ? AND status = 'issued'`,
    [tournamentId, normalizedEmail],
  )

  await pool.execute(
    `INSERT INTO organizer_tournament_invites
      (id, tournament_id, host_account_id, organizer_email, organizer_account_id, invite_token, invite_url, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', CURRENT_TIMESTAMP)`,
    [id, tournamentId, resolvedHostAccountId, normalizedEmail, organizerAccount?.id || null, inviteToken, inviteUrl || null],
  )

  await pool.execute(
    `UPDATE tournaments
        SET organizer_email = ?, organizer_account_id = COALESCE(organizer_account_id, ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [normalizedEmail, organizerAccount?.id || null, tournamentId],
  )

  const [rows] = await pool.execute(`SELECT * FROM organizer_tournament_invites WHERE id = ? LIMIT 1`, [id])
  return mapOrganizerTournamentInviteRow(rows[0] || null)
}

export async function acceptOrganizerInvitesForEmail(pool, organizerEmail) {
  await ensureTournamentInviteSchema(pool)
  const normalizedEmail = normalizeEmail(organizerEmail)
  if (!normalizedEmail) return

  await pool.execute(
    `UPDATE organizer_tournament_invites
        SET status = CASE WHEN status = 'issued' THEN 'accepted' ELSE status END,
            accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE organizer_email = ? AND status IN ('issued', 'accepted')`,
    [normalizedEmail],
  )
}

export async function buildOrganizerInviteDetails(pool, organizerEmail, tournamentIdentifier) {
  const normalizedEmail = normalizeEmail(organizerEmail)
  const organizerAccount = await getOrganizerAuthAccountByEmail(pool, normalizedEmail)
  const appUser = await getAppUserByEmail(pool, normalizedEmail)
  const path = organizerAccount ? '/organizer/login' : '/organizer/register'
  const query = new URLSearchParams({ email: normalizedEmail, tournament: tournamentIdentifier }).toString()
  return {
    organizerAccount,
    appUser,
    invitePath: path,
    inviteQuery: query,
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
