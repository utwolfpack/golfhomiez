Replace this file in your app:
- src/lib/frontend-logger.ts

Why the build failed:
- src/lib/auth-api.ts imports attachRequestMetadata from src/lib/frontend-logger.ts
- the current frontend-logger.ts in your tree does not export that symbol

What this file restores:
- attachRequestMetadata export
- compatible logFrontendEvent API for both calling styles
- correlation id header propagation
- guarded runtime logging that avoids recursive failures
