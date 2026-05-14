import { api } from './api'

export type SupportMessageInput = {
  subject: string
  message: string
}

export type SupportMessageResult = {
  ok: boolean
}

export function sendSupportMessage(input: SupportMessageInput) {
  return api<SupportMessageResult>('/api/support/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
