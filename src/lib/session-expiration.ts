import { logFrontendEvent } from './frontend-logger'

const USER_LOGIN_ROUTE = '/login'
const HOST_LOGIN_ROUTE = '/host/login'
const ADMIN_LOGIN_ROUTE = '/golfadmin'

function getCurrentPath() {
  return globalThis.location?.pathname || '/'
}

export function resolveExpiredSessionLoginRoute(path = getCurrentPath()) {
  if (path.startsWith('/host')) return HOST_LOGIN_ROUTE
  if (path.startsWith('/golfadmin')) return ADMIN_LOGIN_ROUTE
  return USER_LOGIN_ROUTE
}

export function handleExpiredSession(source: string, status?: number) {
  if (status !== 401) return
  const route = resolveExpiredSessionLoginRoute()
  logFrontendEvent({
    level: 'warn',
    category: 'auth.session',
    message: 'session_ttl_exhausted_redirect',
    data: { source, status, route },
  })
  if (globalThis.location?.pathname !== route) {
    globalThis.location.assign(route)
  }
}
