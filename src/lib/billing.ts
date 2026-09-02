import { api } from './api'

export type BillingStatus = {
  enabled: boolean
  accessAllowed: boolean
  setupComplete: boolean
  accessSource: string
  accessCode?: string | null
  accessCodeLabel?: string | null
  subscriptionStatus?: string | null
  trialEndsAt?: string | null
  currentPeriodEndsAt?: string | null
  cancellationAllowedAt?: string | null
  cancelAtPeriodEnd?: boolean
  graceEndsAt?: string | null
  hasPaymentAccount?: boolean
  paymentMethod?: {
    brand: string
    lastFour: string
    expMonth?: number | null
    expYear?: number | null
  } | null
}

export const fetchBillingStatus = () => api<BillingStatus>('/api/billing/status')
export const startCheckout = () => api<{ url: string }>('/api/billing/checkout', { method: 'POST' })
export const completeCheckout = (sessionId: string) => api<BillingStatus>('/api/billing/checkout/complete', { method: 'POST', body: JSON.stringify({ sessionId }) })
export const openBillingPortal = () => api<{ url: string }>('/api/billing/portal', { method: 'POST' })
export const cancelSubscription = () => api<BillingStatus>('/api/billing/cancel', { method: 'POST' })
export const resumeSubscription = () => api<BillingStatus>('/api/billing/resume', { method: 'POST' })
export const redeemAccessCode = (code: string) => api<BillingStatus>('/api/billing/redeem-code', { method: 'POST', body: JSON.stringify({ code }) })
