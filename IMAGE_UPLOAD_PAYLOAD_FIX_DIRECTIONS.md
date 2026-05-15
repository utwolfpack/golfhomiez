# Image upload payload fix directions

## Changed files and application paths

Copy these files into the same paths in the application:

- `src/lib/image-upload.ts`
- `src/components/ImageUploadField.tsx`
- `src/components/TournamentTemplateFields.tsx`
- `server/index.js`
- `test/app.test.js`

## What changed

- Image compression now repeatedly reduces JPEG quality and then image dimensions until the encoded data URL is below a configured byte limit.
- Tournament flyer background uploads now use banner-sized compression settings: `1400 x 700`, target max `420 KB`.
- Supporting photos now target max `320 KB`.
- Sponsor logos now target max `120 KB` each.
- Upload errors are shown inline instead of being thrown as unhandled front-end promise errors.
- API JSON payload parsing now uses `API_JSON_BODY_LIMIT`, defaulting to `4mb`, and logs/returns a clear `413` response if a request is still too large.

## Environment setting

Optional production override:

```env
API_JSON_BODY_LIMIT=4mb
```

Increase this only if tournament forms legitimately need larger combined image/logo payloads. The front-end compression should keep normal flyer/background uploads below this limit.

## Install and validation

After copying the files, run:

```bash
npm install
npm test
npm run build
```

No database migration is required for this fix.
