export const ACCOUNT_RESET_TYPES = Object.freeze(['user', 'host', 'organizer'])

export const ACCOUNT_RESET_SCRIPT_FILES = Object.freeze({
  user: 'migration_scripts/manual_account_resets/reset_user_accounts.sql',
  host: 'migration_scripts/manual_account_resets/reset_host_accounts.sql',
  organizer: 'migration_scripts/manual_account_resets/reset_organizer_accounts.sql',
})

export const ACCOUNT_RESET_NPM_SCRIPTS = Object.freeze({
  user: 'data:reset:user',
  host: 'data:reset:host',
  organizer: 'data:reset:organizer',
})

const PLAN_DEFINITIONS = Object.freeze({
  user: {
    label: 'All golfer user accounts reset',
    targetDescription: 'all golfer user accounts',
    accountTables: ['user', 'app_users', 'user_role_assignments'],
    relatedTables: [
      'session',
      'account',
      'verification',
      'email_verification_tokens',
      'scores',
      'scorecard_hole_drafts',
      'team_members',
      'teams',
      'inbox_messages',
      'inbox_challenge_user_state',
      'tournament_registrations',
    ],
    deletes: [
      'Better Auth sessions, linked accounts, and verification records for all golfer users',
      'GolfHomiez app profile rows and user role assignments for all golfer users',
      'solo/team scores, active scorecard drafts, inbox records, tournament registrations, and team membership rows owned by all golfer users',
      'teams that become empty after golfer user memberships are removed',
      'Better Auth user rows for the selected account type scope',
    ],
  },
  host: {
    label: 'All host accounts reset',
    targetDescription: 'all host accounts',
    accountTables: ['host_accounts', 'host_role_accounts', 'user_role_assignments'],
    relatedTables: [
      'host_sessions',
      'host_password_reset_tokens',
      'host_account_requests',
      'host_account_invites',
      'golf_course_public_pages',
      'organizer_tournament_invites',
      'tournaments',
      'tournament_registrations',
      'tournament_team_scores',
      'tournament_team_start_assignments',
      'golf_course_tournaments',
    ],
    deletes: [
      'host sessions and host password reset tokens for all host accounts',
      'host account requests and invite records for all host accounts',
      'public golf course profile pages owned by all host accounts',
      'host-managed tournaments and tournament child records',
      'all host_accounts, host_role_accounts, and host role assignments',
    ],
  },
  organizer: {
    label: 'All organizer accounts reset',
    targetDescription: 'all organizer accounts',
    accountTables: ['organizer_role_accounts', 'user_role_assignments'],
    relatedTables: [
      'organizer_sessions',
      'organizer_password_reset_tokens',
      'organizer_tournament_invites',
      'tournaments',
      'tournament_registrations',
      'tournament_team_scores',
      'tournament_team_start_assignments',
      'golf_course_tournaments',
    ],
    deletes: [
      'organizer sessions and organizer password reset tokens for all organizer accounts',
      'organizer tournament invites for all organizer accounts',
      'organizer-owned tournaments and tournament child records',
      'all organizer_role_accounts and organizer role assignments',
    ],
  },
})

export function normalizeAccountResetType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!ACCOUNT_RESET_TYPES.includes(normalized)) {
    throw new Error(`Unsupported account reset type "${value}". Expected one of: ${ACCOUNT_RESET_TYPES.join(', ')}`)
  }
  return normalized
}

export function getAccountResetPlan(accountType) {
  const type = normalizeAccountResetType(accountType)
  return {
    type,
    ...PLAN_DEFINITIONS[type],
    scriptFile: ACCOUNT_RESET_SCRIPT_FILES[type],
    npmScript: ACCOUNT_RESET_NPM_SCRIPTS[type],
  }
}

export function listAccountResetPlans() {
  return ACCOUNT_RESET_TYPES.map((type) => getAccountResetPlan(type))
}
