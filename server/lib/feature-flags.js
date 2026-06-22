const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

export const FEATURE_FLAGS = Object.freeze({
  profileSocialPreferences: Object.freeze({
    key: 'profileSocialPreferences',
    envName: 'FEATURE_PROFILE_SOCIAL_PREFERENCES',
    defaultEnabled: false,
    description: 'Shows alcohol, 420, and sobriety profile preference fields and saves preference updates.',
  }),
})

export function parseFeatureFlagBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

async function readDatabaseOverrides(db) {
  if (!db || typeof db.execute !== 'function') return new Map()
  try {
    const [rows] = await db.execute('SELECT flag_key AS flagKey, enabled FROM app_feature_flags')
    return new Map((rows || []).map((row) => [String(row.flagKey || ''), Boolean(Number(row.enabled))]))
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146 || /app_feature_flags/i.test(String(error?.message || ''))) {
      return new Map()
    }
    throw error
  }
}

export async function getFeatureFlags(db) {
  const databaseOverrides = await readDatabaseOverrides(db)
  return Object.fromEntries(
    Object.values(FEATURE_FLAGS).map((definition) => {
      const databaseValue = databaseOverrides.has(definition.key) ? databaseOverrides.get(definition.key) : definition.defaultEnabled
      const enabled = parseFeatureFlagBoolean(process.env[definition.envName], databaseValue)
      return [definition.key, enabled]
    }),
  )
}

export function isFeatureEnabled(flags, key) {
  return Boolean(flags?.[key])
}

export function featureFlagDefinitionsForApi() {
  return Object.fromEntries(
    Object.values(FEATURE_FLAGS).map((definition) => [
      definition.key,
      {
        key: definition.key,
        envName: definition.envName,
        defaultEnabled: definition.defaultEnabled,
        description: definition.description,
      },
    ]),
  )
}
