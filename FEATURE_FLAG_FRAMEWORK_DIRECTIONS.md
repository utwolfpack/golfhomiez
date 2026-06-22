# Feature Flag Framework

The app now has a server-side feature flag framework for capabilities that should be deployable before they are visible to users.

## Current flag

| Flag key | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `profileSocialPreferences` | `FEATURE_PROFILE_SOCIAL_PREFERENCES` | `false` | Shows and enables the profile Alcohol, 420, and Sobriety preference controls. |

## How it works

1. `migration_scripts/20260622_056_app_feature_flags.sql` creates the `app_feature_flags` table and registers `profileSocialPreferences` as disabled by default.
2. `server/lib/feature-flags.js` loads flags from the database and lets environment variables override the stored value.
3. `/api/feature-flags` exposes enabled flags and definitions for future client features.
4. `/api/profile` includes `featureFlags` in its response so the profile page can decide what to render.
5. When `profileSocialPreferences` is disabled, the profile page hides Alcohol, Weed/420, and Sobriety controls, and the API preserves existing stored preference values instead of saving hidden fields.

## Releasing the hidden profile preferences later

Enable the flag in the environment and restart the server:

```env
FEATURE_PROFILE_SOCIAL_PREFERENCES=true
```

The database row can also be enabled manually:

```sql
UPDATE app_feature_flags
   SET enabled = 1
 WHERE flag_key = 'profileSocialPreferences';
```

Environment variables take precedence, so remove or set `FEATURE_PROFILE_SOCIAL_PREFERENCES=false` if you want the database value to control the flag.
