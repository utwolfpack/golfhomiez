import { createAuthClient } from 'better-auth/react'

const baseURL =
  import.meta.env.VITE_AUTH_BASE_URL || 'http://127.0.0.1:5001/api/auth'

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    credentials: 'include',
  },
})
