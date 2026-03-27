import { requestJson } from './request'

export type ApiError = { message: string }

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const { data, correlationId, response } = await requestJson<T>(url, opts)
  if (!response.ok) {
    const msg = (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string')
      ? data.message
      : `Request failed (${response.status}) [correlationId=${correlationId}]`
    throw new Error(msg)
  }
  return data as T
}
