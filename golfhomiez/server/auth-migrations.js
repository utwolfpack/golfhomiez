import { getMigrations } from 'better-auth/db/migration'
import { auth } from './auth.js'

export async function runAuthMigrations() {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options)

  if ((toBeCreated?.length || 0) > 0 || (toBeAdded?.length || 0) > 0) {
    console.log('[better-auth] applying database migrations...')
  }

  await runMigrations()
}
