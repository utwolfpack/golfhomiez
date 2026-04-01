This fixes the exact npm run dev crash you posted.

Cause
- server/index.js still contains this named import:
  import { ... requestCorrelationMiddleware } from './lib/logger.js'
- Your current server/lib/logger.js does not export requestCorrelationMiddleware.
- ESM aborts before startup.

Fix
- Use a namespace import instead.
- Read logger functions off the namespace.
- Provide safe fallbacks for missing exports.

Files
- server/index.js

If the error still shows the old import line after applying this patch, the file was not actually replaced.
