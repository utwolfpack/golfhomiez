Replace this file in your app:
- src/lib/frontend-logger.ts

Why the build failed:
- Earlier patches introduced imports of `attachRequestMetadata` from `src/lib/frontend-logger.ts`.
- The minimal mobile diagnostics patch did not export that function.
- Some files also call `logFrontendEvent(...)` with an object payload shape, while the minimal patch only supported `(eventType, payload)`.

What this fix does:
- Exports `attachRequestMetadata`
- Keeps `getCorrelationId` and `installBootDiagnostics`
- Makes `logFrontendEvent` backward-compatible with both call styles:
  - `logFrontendEvent('event_name', { ... })`
  - `logFrontendEvent({ category, level, message, data })`

After replacing the file, rebuild:
- npm run build
