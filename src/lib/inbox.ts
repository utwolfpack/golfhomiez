import { api } from './api'
import { logFrontendEvent } from './frontend-logger'
import { requestJson } from './request'
import type { HoleScoreDetail, ScoreEntry } from '../types'

export type InboxMessageType = 'message' | 'challenge_request' | 'individual_challenge'
export type TeamChallengeStatus = 'proposed' | 'accepted' | 'declined'

export type IndividualChallengeParticipant = {
  userId?: string | null
  email: string
  name?: string | null
  score?: number | null
  holes?: HoleScoreDetail[] | null
  soloScoreId?: string | null
}

export type InboxMessage = {
  id: string
  threadId?: string | null
  parentMessageId?: string | null
  messageType: InboxMessageType
  senderUserId?: string | null
  senderEmail: string
  senderName?: string | null
  recipientUserId?: string | null
  recipientEmail: string
  proposerTeamId?: string | null
  proposerTeamName?: string | null
  challengedTeamId?: string | null
  challengedTeamName?: string | null
  challengeStatus?: TeamChallengeStatus | null
  challengeDate?: string | null
  challengeState?: string | null
  challengeCourse?: string | null
  proposerTeamScore?: number | null
  challengedTeamScore?: number | null
  proposerTeamHoles?: HoleScoreDetail[] | null
  challengedTeamHoles?: HoleScoreDetail[] | null
  individualChallengeParticipants?: IndividualChallengeParticipant[] | null
  body: string
  readAt?: string | null
  createdAt?: string | null
}

export type InboxMessagesResponse = {
  messages: InboxMessage[]
  unreadCount: number
}

export type SentInboxMessagesResponse = {
  messages: InboxMessage[]
  sentMessages: InboxMessage[]
  sentChallenges: InboxMessage[]
}

export type InboxSummary = {
  unreadCount: number
}

export type TeamChallengeScoreRecordsResponse = {
  scores: ScoreEntry[]
}

export type SendInboxMessageInput = {
  recipientEmail?: string
  messageType: InboxMessageType
  body: string
  replyToMessageId?: string | null
  proposerTeamId?: string | null
  challengedTeamName?: string | null
  challengeDate?: string | null
  challengeState?: string | null
  challengeCourse?: string | null
  individualParticipantEmails?: string[]
}

export class RecipientNotFoundError extends Error {
  recipientEmail: string
  inviteRequired: boolean

  constructor(message: string, recipientEmail: string) {
    super(message)
    this.name = 'RecipientNotFoundError'
    this.recipientEmail = recipientEmail
    this.inviteRequired = true
  }
}

export class TeamNotFoundError extends Error {
  challengedTeamName: string
  teamNotFound: boolean

  constructor(message: string, challengedTeamName: string) {
    super(message)
    this.name = 'TeamNotFoundError'
    this.challengedTeamName = challengedTeamName
    this.teamNotFound = true
  }
}

export async function fetchInboxSummary(): Promise<InboxSummary> {
  return api<InboxSummary>('/api/inbox/summary')
}

export async function fetchInboxMessages(): Promise<InboxMessagesResponse> {
  return api<InboxMessagesResponse>('/api/inbox/messages')
}

export async function fetchSentInboxMessages(): Promise<SentInboxMessagesResponse> {
  return api<SentInboxMessagesResponse>('/api/inbox/sent')
}

export async function fetchTeamChallengeScoreRecords(): Promise<TeamChallengeScoreRecordsResponse> {
  return api<TeamChallengeScoreRecordsResponse>('/api/inbox/team-challenge-scores')
}

export async function sendInboxMessage(input: SendInboxMessageInput): Promise<{ ok: boolean; message: InboxMessage; notice: string }> {
  const { data, response, correlationId } = await requestJson<{ ok?: boolean; message?: InboxMessage | string; notice?: string; inviteRequired?: boolean; recipientEmail?: string; teamNotFound?: boolean; challengedTeamName?: string }>('/api/inbox/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  if (response.status === 404 && data?.inviteRequired) {
    logFrontendEvent({ category: 'inbox.message', level: 'warn', message: 'recipient_not_found_invite_redirect', data: { recipientEmail: data.recipientEmail || input.recipientEmail, correlationId } })
    throw new RecipientNotFoundError(typeof data.message === 'string' ? data.message : 'Recipient does not exist in Golf Homiez. Send them an invite to join.', data.recipientEmail || input.recipientEmail || '')
  }

  if (response.status === 404 && data?.teamNotFound) {
    logFrontendEvent({ category: 'inbox.teamChallenge', level: 'warn', message: 'team_challenge_team_not_found', data: { challengedTeamName: data.challengedTeamName || input.challengedTeamName, correlationId } })
    throw new TeamNotFoundError(typeof data.message === 'string' ? data.message : 'Team does not exist.', data.challengedTeamName || input.challengedTeamName || '')
  }

  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `Request failed (${response.status})`
    throw new Error(message)
  }

  return {
    ok: Boolean(data?.ok),
    message: data?.message as InboxMessage,
    notice: data?.notice || 'Your message was sent successfully.',
  }
}

export async function replyToInboxMessage(input: { message: InboxMessage; body: string }): Promise<{ ok: boolean; message: InboxMessage; notice: string }> {
  return sendInboxMessage({
    recipientEmail: input.message.senderEmail,
    messageType: input.message.messageType === 'challenge_request' ? 'challenge_request' : (input.message.messageType === 'individual_challenge' ? 'individual_challenge' : 'message'),
    body: input.body,
    replyToMessageId: input.message.id,
  })
}

export async function markInboxMessageRead(messageId: string): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/read`, { method: 'PATCH' })
}

export async function updateTeamChallengeStatus(messageId: string, status: TeamChallengeStatus): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/challenge-status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function updateTeamChallengeScore(messageId: string, score: number, holes?: HoleScoreDetail[]): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/team-score`, {
    method: 'PATCH',
    body: JSON.stringify({ score, holes: holes || [] }),
  })
}

export async function updateIndividualChallengeScore(messageId: string, score: number, holes?: HoleScoreDetail[]): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/individual-score`, {
    method: 'PATCH',
    body: JSON.stringify({ score, holes: holes || [] }),
  })
}
