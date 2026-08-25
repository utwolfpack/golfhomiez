import { api } from './api'
import { logFrontendEvent } from './frontend-logger'
import { requestJson } from './request'
import type { HoleScoreDetail, ScoreEntry } from '../types'
import type { TeamChallengeScoringType } from './team-challenge-scoring'

export type InboxMessageType = 'message' | 'challenge_request' | 'individual_challenge' | 'group_message' | 'tournament_notification'
export type TeamChallengeStatus = 'proposed' | 'accepted' | 'declined' | 'completed'

export type IndividualChallengeParticipant = {
  userId?: string | null
  email: string
  name?: string | null
  score?: number | null
  holes?: HoleScoreDetail[] | null
  soloScoreId?: string | null
  courseId?: string | null
  courseState?: string | null
  courseName?: string | null
}

export type InboxMessage = {
  id: string
  threadId?: string | null
  parentMessageId?: string | null
  messageType: InboxMessageType
  senderUserId?: string | null
  senderEmail: string
  senderName?: string | null
  senderRole?: string | null
  recipientUserId?: string | null
  recipientEmail: string
  groupId?: string | null
  groupName?: string | null
  groupDeletedAt?: string | null
  tournamentId?: string | null
  tournamentConversationId?: string | null
  tournamentName?: string | null
  eventDate?: string | null
  actionUrl?: string | null
  correlationId?: string | null
  proposerTeamId?: string | null
  proposerTeamName?: string | null
  challengedTeamId?: string | null
  challengedTeamName?: string | null
  challengeStatus?: TeamChallengeStatus | null
  challengeDeletedAt?: string | null
  challengeDate?: string | null
  challengeEndDate?: string | null
  challengeState?: string | null
  challengeCourse?: string | null
  challengeTeeColor?: 'red' | 'white' | 'blue' | 'black' | string | null
  challengeScoringType?: TeamChallengeScoringType | string | null
  challengePointsPerHole?: number | null
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
  challengedTeamIdentifier?: number | string | null
  challengeDate?: string | null
  challengeEndDate?: string | null
  challengeState?: string | null
  challengeCourse?: string | null
  challengeTeeColor?: 'red' | 'white' | 'blue' | 'black' | string | null
  challengeScoringType?: TeamChallengeScoringType | string | null
  challengePointsPerHole?: number | string | null
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
  challengedTeamIdentifier: string
  teamNotFound: boolean

  constructor(message: string, challengedTeamIdentifier: string) {
    super(message)
    this.name = 'TeamNotFoundError'
    this.challengedTeamIdentifier = challengedTeamIdentifier
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
  const { data, response, correlationId } = await requestJson<{ ok?: boolean; message?: InboxMessage | string; notice?: string; inviteRequired?: boolean; recipientEmail?: string; teamNotFound?: boolean; challengedTeamIdentifier?: number | string }>('/api/inbox/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  if (response.status === 404 && data?.inviteRequired) {
    logFrontendEvent({ category: 'inbox.message', level: 'warn', message: 'recipient_not_found_invite_redirect', data: { recipientEmail: data.recipientEmail || input.recipientEmail, correlationId } })
    throw new RecipientNotFoundError(typeof data.message === 'string' ? data.message : 'Recipient does not exist in Golf Homiez. Send them an invite to join.', data.recipientEmail || input.recipientEmail || '')
  }

  if (response.status === 404 && data?.teamNotFound) {
    const challengedTeamIdentifier = String(data.challengedTeamIdentifier || input.challengedTeamIdentifier || '')
    logFrontendEvent({ category: 'inbox.teamChallenge', level: 'warn', message: 'team_challenge_team_not_found', data: { challengedTeamIdentifier, correlationId } })
    throw new TeamNotFoundError(typeof data.message === 'string' ? data.message : 'GolfHomiez Team ID does not exist.', challengedTeamIdentifier)
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



export async function setInboxChallengeDeleted(messageId: string, deleted: boolean): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/deleted`, {
    method: 'PATCH',
    body: JSON.stringify({ deleted }),
  })
}

export async function completeInboxChallenge(messageId: string): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/complete`, { method: 'PATCH' })
}

export async function updateInboxChallengeSettings(messageId: string, input: {
  challengeTeeColor?: string | null
  challengeScoringType?: TeamChallengeScoringType | string | null
  challengePointsPerHole?: number | string | null
  challengeDate?: string | null
  challengeEndDate?: string | null
  challengeState?: string | null
  challengeCourse?: string | null
}): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/challenge-settings`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function addIndividualChallengeParticipant(messageId: string, email: string): Promise<{ message: InboxMessage; participants: IndividualChallengeParticipant[]; golfHomiezUserFound: boolean }> {
  return api(`/api/inbox/messages/${encodeURIComponent(messageId)}/individual-participants`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function refreshIndividualChallengeParticipants(messageId: string): Promise<{ message: InboxMessage; participants: IndividualChallengeParticipant[]; transitionedToRegisteredCount: number; registeredCount: number; pendingCount: number }> {
  return api(`/api/inbox/messages/${encodeURIComponent(messageId)}/individual-participants/refresh`, {
    method: 'PATCH',
  })
}

export async function updateIndividualChallengeCourse(messageId: string, input: { state: string; course: string; courseId?: string | null }): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/individual-course`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function updateTeamChallengeScore(messageId: string, score: number | null, holes?: HoleScoreDetail[]): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/team-score`, {
    method: 'PATCH',
    body: JSON.stringify({ score, holes: holes || [] }),
  })
}

export async function updateIndividualChallengeScore(messageId: string, score: number | null, holes?: HoleScoreDetail[]): Promise<InboxMessage> {
  return api<InboxMessage>(`/api/inbox/messages/${encodeURIComponent(messageId)}/individual-score`, {
    method: 'PATCH',
    body: JSON.stringify({ score, holes: holes || [] }),
  })
}
