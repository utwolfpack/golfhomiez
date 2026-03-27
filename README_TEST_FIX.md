This patch updates `src/lib/frontend-logger.ts` to keep the safe mobile diagnostics approach while restoring compatibility with existing imports and tests.

It restores:
- `attachRequestMetadata`
- `logFrontendEvent(...)` in both call styles
- `installFrontendDiagnostics`
- correlation ID propagation

It also keeps the safe pixel-beacon transport using `new Image(1, 1)` instead of the earlier recursive preboot network logging pattern.
