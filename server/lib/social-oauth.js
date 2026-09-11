function removed() {
  const error = new Error('The in-app social OAuth workflow was removed. Configure publishing credentials in the server .env file.')
  error.code = 'SOCIAL_OAUTH_REMOVED'
  throw error
}

export const buildSocialAuthorizationUrl = removed
export const buildSocialOAuthRedirectUri = removed
export const completeSocialOAuth = removed

export function providerKey(platform) {
  const normalized = String(platform || '').trim().toLowerCase()
  if (normalized === 'facebook' || normalized === 'instagram' || normalized === 'meta') return 'meta'
  if (normalized === 'google') return 'youtube'
  return normalized
}
