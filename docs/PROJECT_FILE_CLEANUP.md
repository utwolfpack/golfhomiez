# Project file cleanup

The project documentation has been centralized under `docs/` so the application root stays focused on runtime and build files.

## Documentation moved into `docs/`

- `AUTH_TTL_LOGGING_DIRECTIONS.md`
- `BREVO-SMTP.md`
- `DOCKER-README.md`
- `FEATURE_FLAG_FRAMEWORK_DIRECTIONS.md`
- `GOLFBERT_API_IMPLEMENTATION_DIRECTIONS.md`
- `IGOLF_API_IMPLEMENTATION_DIRECTIONS.md`
- `ORGANIZER_FORGOT_PASSWORD_LINK_DIRECTIONS.md`
- `PromptGuide.md`
- `README.md`
- `failtest062226.md`

## Orphaned files removed by `npm install`

The `cleanup:project-files` script removes these known orphaned/generated files if they still exist after a patch is applied:

- `LocationInput.tsx`
- `index.js`
- `app.test.js.patch`
- `README.txt`
- `README_IGOLF_CHANGESET.txt`
- `cleanup/remove_obsolete_readmes.txt`
- `mnt/data/REMOVED_PATCH_FILES.txt`
- `tsconfig.tsbuildinfo`
