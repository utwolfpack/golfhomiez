import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import HoleByHoleScorecard, { type PendingHoleScoreSaveHandler } from '../components/HoleByHoleScorecard'
import TeeColorSelector from '../components/TeeColorSelector'
import GolfCourseInput from '../components/GolfCourseInput'
import { useAuth } from '../context/AuthContext'
import {
  fetchInboxMessages,
  fetchSentInboxMessages,
  markInboxMessageRead,
  RecipientNotFoundError,
  replyToInboxMessage,
  sendInboxMessage,
  TeamNotFoundError,
  completeInboxChallenge,
  setInboxChallengeDeleted,
  updateTeamChallengeScore,
  updateIndividualChallengeScore,
  type IndividualChallengeParticipant,
  type InboxMessage,
  type InboxMessageType,
} from '../lib/inbox'
import { fetchTeams } from '../lib/teams'
import { getUserTodayISO } from '../lib/date'
import { useGolfCourseStates } from '../hooks/useGolfCourseStates'
import { logFrontendEvent } from '../lib/frontend-logger'
import { buildClientDefaultHoleScorecard, formatHoleScoreOutcome, hasSavedHoleScoreValue, missingHoleScoreNumbers, nextUnscoredHoleNumber, normalizeHoleScorecard, scoreOutcomeClassName } from '../lib/hole-scorecard'
import type { HoleScoreDetail, Team } from '../types'
import type { TeeColorSelection } from '../lib/tee-colors'
import { DEFAULT_TEE_COLOR, normalizeTeeColor, teeColorLabel } from '../lib/tee-colors'
import { calculateTeamChallengePoints, isSkinsTeamChallenge, normalizeTeamChallengePointsPerHole, normalizeTeamChallengeScoringType, teamChallengeScoringTypeLabel, type TeamChallengeScoringType } from '../lib/team-challenge-scoring'

type TeamChallengeLeaderboardSide = 'proposer' | 'challenged'

type TeamChallengeScorecardTarget = {
  message: InboxMessage
  side: 'proposer' | 'challenged'
}

type IndividualChallengeScorecardTarget = {
  message: InboxMessage
  participant: IndividualChallengeParticipant
}

type InboxThread = {
  threadId: string
  displayMessage: InboxMessage
  messages: InboxMessage[]
  unreadMessages: InboxMessage[]
  unreadCount: number
}

function applyChallengeTeeColor(holes: HoleScoreDetail[], teeColor: string): HoleScoreDetail[] {
  const selectedTeeColor = normalizeTeeColor(teeColor || DEFAULT_TEE_COLOR)
  return holes.map((hole) => ({
    ...hole,
    teeColor: selectedTeeColor,
    teeBoxType: selectedTeeColor,
  }))
}

function formatHoleMetadata(hole: HoleScoreDetail) {
  const items = [`Par ${hole.par || '—'}`]
  const yards = Number(hole.yards)
  if (hole.yards != null && Number.isFinite(yards) && yards > 0) items.push(`${Math.trunc(yards)} yds`)
  return items.join(' • ')
}

function formatInboxTimestamp(value?: string | null) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function messageTypeLabel(type: InboxMessageType | string) {
  if (type === 'challenge_request') return 'Team Challenge'
  if (type === 'individual_challenge') return 'Individual Challenge'
  return 'Message'
}

function messageThreadId(message: InboxMessage) {
  return message.threadId || message.id
}

function sortThreadMessages(messages: InboxMessage[]) {
  return [...messages].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

function latestThreadMessage(messages: InboxMessage[]) {
  const sorted = sortThreadMessages(messages)
  return sorted[sorted.length - 1]
}

function buildInboxThreads(messages: InboxMessage[]): InboxThread[] {
  const grouped = new Map<string, InboxMessage[]>()
  messages.forEach((message) => {
    const threadId = messageThreadId(message)
    grouped.set(threadId, [...(grouped.get(threadId) || []), message])
  })

  return Array.from(grouped.entries())
    .map(([threadId, threadMessages]) => {
      const sortedMessages = sortThreadMessages(threadMessages)
      const unreadMessages = sortedMessages.filter((message) => !message.readAt)
      return {
        threadId,
        displayMessage: unreadMessages[unreadMessages.length - 1] || sortedMessages[sortedMessages.length - 1],
        messages: sortedMessages,
        unreadMessages,
        unreadCount: unreadMessages.length,
      }
    })
    .sort((a, b) => String(b.displayMessage.createdAt || '').localeCompare(String(a.displayMessage.createdAt || '')))
}

function getThreadInitialChallengeMessage(thread: InboxThread) {
  return thread.messages.find((item) => !item.parentMessageId) || sortThreadMessages(thread.messages)[0] || thread.displayMessage
}

function getChallengeStatusSortRank(message: InboxMessage) {
  if (message.challengeDeletedAt) return 2
  return String(message.challengeStatus || '').trim().toLowerCase() === 'completed' ? 1 : 0
}

function getChallengeSortDate(message: InboxMessage) {
  const value = String(message.challengeDate || message.createdAt || '').trim()
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortChallengeThreadsByStatusAndDate(threads: InboxThread[]) {
  return [...threads].sort((a, b) => {
    const aChallenge = getThreadInitialChallengeMessage(a)
    const bChallenge = getThreadInitialChallengeMessage(b)
    const statusDifference = getChallengeStatusSortRank(aChallenge) - getChallengeStatusSortRank(bChallenge)
    if (statusDifference !== 0) return statusDifference

    const dateDifference = getChallengeSortDate(bChallenge) - getChallengeSortDate(aChallenge)
    if (dateDifference !== 0) return dateDifference

    return String(b.displayMessage.createdAt || '').localeCompare(String(a.displayMessage.createdAt || ''))
  })
}

function getMessagePreview(body?: string | null) {
  const normalized = String(body || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= 140) return normalized
  return `${normalized.slice(0, 140)}…`
}

function teamContainsEmail(team: Team, email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  return (team.members || []).some((member) => String(member.email || '').trim().toLowerCase() === normalizedEmail)
}

function uniqueInboxMessages(messages: InboxMessage[]) {
  const byId = new Map<string, InboxMessage>()
  messages.forEach((message) => {
    if (message?.id) byId.set(String(message.id), message)
  })
  return Array.from(byId.values())
}


function parseIndividualChallengeEmails(value: string) {
  const seen = new Set<string>()
  return String(value || '')
    .split(/[\n,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => {
      if (!email || seen.has(email)) return false
      seen.add(email)
      return true
    })
}

function isChallengeMessage(message: InboxMessage) {
  return message.messageType === 'challenge_request' || message.messageType === 'individual_challenge'
}


export default function Challenges() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [sentMessages, setSentMessages] = useState<InboxMessage[]>([])
  const [sentChallenges, setSentChallenges] = useState<InboxMessage[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [challengesComposeOpen, setChallengesComposeOpen] = useState(false)
  const [challengeView, setChallengeView] = useState<'active' | 'completed' | 'deleted'>('active')
  const [updatingChallengeDeleteThreadId, setUpdatingChallengeDeleteThreadId] = useState<string | null>(null)
  const [challengeType, setChallengeType] = useState<'team' | 'individual'>('team')
  const [proposerTeamId, setProposerTeamId] = useState('')
  const [challengedTeamIdentifier, setChallengedTeamIdentifier] = useState('')
  const [teamChallengeDate, setTeamChallengeDate] = useState(() => getUserTodayISO())
  const [teamChallengeState, setTeamChallengeState] = useState('UT')
  const [teamChallengeCourse, setTeamChallengeCourse] = useState('')
  const [teamChallengeCourseSearch, setTeamChallengeCourseSearch] = useState('')
  const [teamChallengeTeeColor, setTeamChallengeTeeColor] = useState<TeeColorSelection>('')
  const [teamChallengeScoringType, setTeamChallengeScoringType] = useState<TeamChallengeScoringType>('stroke_play')
  const [teamChallengePointsPerHole, setTeamChallengePointsPerHole] = useState('1')
  const { states: stateOptions, loading: statesLoading, error: statesError } = useGolfCourseStates(challengesComposeOpen)
  const [individualParticipantEmails, setIndividualParticipantEmails] = useState('')
  const [challengeBody, setChallengeBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<InboxMessage | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [replySending, setReplySending] = useState(false)
  const [updatingChallengeScoreKey, setUpdatingChallengeScoreKey] = useState<string | null>(null)
  const [teamChallengeScorecards, setTeamChallengeScorecards] = useState<Record<string, HoleScoreDetail[]>>({})
  const [individualChallengeScorecards, setIndividualChallengeScorecards] = useState<Record<string, HoleScoreDetail[]>>({})
  const [activeTeamChallengeScorecard, setActiveTeamChallengeScorecard] = useState<TeamChallengeScorecardTarget | null>(null)
  const [activeIndividualChallengeScorecard, setActiveIndividualChallengeScorecard] = useState<IndividualChallengeScorecardTarget | null>(null)
  const [activeIndividualChallengeLeaderboard, setActiveIndividualChallengeLeaderboard] = useState<InboxMessage | null>(null)
  const [activeIndividualLeaderboardParticipant, setActiveIndividualLeaderboardParticipant] = useState<IndividualChallengeParticipant | null>(null)
  const [activeTeamChallengeLeaderboard, setActiveTeamChallengeLeaderboard] = useState<InboxMessage | null>(null)
  const [activeTeamLeaderboardSide, setActiveTeamLeaderboardSide] = useState<TeamChallengeLeaderboardSide | null>(null)
  const [teamChallengeLeaderboardReturnTarget, setTeamChallengeLeaderboardReturnTarget] = useState<TeamChallengeScorecardTarget | null>(null)
  const [individualChallengeLeaderboardReturnTarget, setIndividualChallengeLeaderboardReturnTarget] = useState<IndividualChallengeScorecardTarget | null>(null)
  const [scorecardResumeHoles, setScorecardResumeHoles] = useState<Record<string, number>>({})
  const [refreshingLeaderboard, setRefreshingLeaderboard] = useState(false)
  const autoMarkedReadThreadIds = useRef(new Set<string>())
  const teamChallengePendingHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)
  const individualChallengePendingHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)
  const [completingChallengeThreadId, setCompletingChallengeThreadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const currentUserEmail = useMemo(() => String(user?.email || '').trim().toLowerCase(), [user?.email])
  const myTeams = useMemo(() => teams.filter((team) => teamContainsEmail(team, currentUserEmail)), [teams, currentUserEmail])
  const selectedProposerTeam = useMemo(() => myTeams.find((team) => team.id === proposerTeamId) || null, [myTeams, proposerTeamId])
  const teamChallengeOptions = useMemo(() => teams.filter((team) => team.id !== proposerTeamId), [teams, proposerTeamId])
  const selectedChallengedTeam = useMemo(() => teamChallengeOptions.find((team) => String(team.teamIdentifier) === challengedTeamIdentifier.trim()) || null, [teamChallengeOptions, challengedTeamIdentifier])
  const isTeamChallenge = challengeType === 'team'
  const isIndividualChallenge = challengeType === 'individual'
  const parsedIndividualParticipantEmails = useMemo(() => parseIndividualChallengeEmails(individualParticipantEmails), [individualParticipantEmails])
  const canSubmitChallenge = Boolean(teamChallengeDate && teamChallengeState && teamChallengeCourse) && (isTeamChallenge ? Boolean(proposerTeamId && /^\d+$/.test(challengedTeamIdentifier.trim())) : Boolean(challengeBody.trim() && parsedIndividualParticipantEmails.length > 0 && parsedIndividualParticipantEmails.length <= 25))
  const teamChallengeMessages = useMemo(() => uniqueInboxMessages([...messages, ...sentChallenges].filter((message) => isChallengeMessage(message) && currentUserCanViewChallenge(message))), [messages, sentChallenges, teams, currentUserEmail, user?.id])
  const teamChallengeThreads = useMemo(() => sortChallengeThreadsByStatusAndDate(buildInboxThreads(teamChallengeMessages).map((thread) => {
    const unreadMessages = thread.unreadMessages.filter((message) => currentUserShouldSeeUnreadNotification(message))
    return { ...thread, unreadMessages, unreadCount: unreadMessages.length }
  })), [teamChallengeMessages, teams, currentUserEmail, user?.id])
  const visibleChallengeThreads = useMemo(() => teamChallengeThreads.filter((thread) => {
    const challenge = getInitialChallengeMessage(thread)
    const deleted = Boolean(challenge.challengeDeletedAt)
    if (challengeView === 'deleted') return deleted
    if (deleted) return false
    return challengeView === 'completed' ? isChallengeCompleted(challenge) : !isChallengeCompleted(challenge)
  }), [teamChallengeThreads, challengeView])
  const displayedChallengeThreads = useMemo(() => {
    if (!expandedThreadId) return visibleChallengeThreads
    const selectedThreads = visibleChallengeThreads.filter((thread) => thread.threadId === expandedThreadId)
    return selectedThreads.length > 0 ? selectedThreads : visibleChallengeThreads
  }, [visibleChallengeThreads, expandedThreadId])
  const allConversationMessages = useMemo(() => uniqueInboxMessages([...messages, ...sentMessages, ...sentChallenges]), [messages, sentMessages, sentChallenges])

  function rememberScorecardResumeHole(key: string, holeNumber: number | null | undefined) {
    const normalizedHole = Number(holeNumber)
    if (!Number.isFinite(normalizedHole) || normalizedHole < 1) return
    const nextHole = Math.trunc(normalizedHole)
    setScorecardResumeHoles((current) => (current[key] === nextHole ? current : { ...current, [key]: nextHole }))
  }

  function resolveLeaderboardResumeHole(holes: HoleScoreDetail[], currentHole: number | null | undefined, saved: boolean) {
    const normalizedCurrentHole = Number.isFinite(Number(currentHole)) ? Math.trunc(Number(currentHole)) : null
    if (saved) return nextUnscoredHoleNumber(holes, normalizedCurrentHole || 0) || normalizedCurrentHole || nextUnscoredHoleNumber(holes, 0) || 1
    return normalizedCurrentHole || nextUnscoredHoleNumber(holes, 0) || holes[0]?.hole || 1
  }

  function getConversationFor(message: InboxMessage) {
    const threadId = messageThreadId(message)
    return sortThreadMessages(allConversationMessages.filter((item) => messageThreadId(item) === threadId))
  }

  function getLatestConversationMessage(message: InboxMessage) {
    return latestThreadMessage(getConversationFor(message)) || message
  }

  function sentByCurrentUser(message: InboxMessage) {
    return String(message.senderUserId || '') === String(user?.id || '') || String(message.senderEmail || '').trim().toLowerCase() === currentUserEmail
  }

  function receivedByCurrentUser(message: InboxMessage) {
    return String(message.recipientUserId || '') === String(user?.id || '') || String(message.recipientEmail || '').trim().toLowerCase() === currentUserEmail
  }

  function isChallengeCompleted(message: InboxMessage) {
    return String(message.challengeStatus || '').trim().toLowerCase() === 'completed'
  }

  function selectChallengeView(nextView: 'active' | 'completed' | 'deleted') {
    const previousView = challengeView
    setChallengeView(nextView)
    setExpandedThreadId(null)
    setStatus(null)
    setError(null)
    logFrontendEvent({
      category: 'inbox.challenge.view',
      message: 'challenge_view_selected',
      data: { previousView, nextView },
    })
  }

  function currentUserShouldSeeUnreadNotification(message: InboxMessage) {
    if (message.readAt) return false
    if (message.messageType === 'challenge_request') return receivedByCurrentUser(message) || getTeamChallengeUserSide(message) === 'challenged'
    if (message.messageType === 'individual_challenge') return receivedByCurrentUser(message) || (!sentByCurrentUser(message) && getIndividualChallengeParticipants(message).some((participant) => currentUserCanEditIndividualParticipant(participant)))
    return receivedByCurrentUser(message)
  }

  function teamExists(teamId?: string | null) {
    const id = String(teamId || '').trim()
    return Boolean(id && teams.some((team) => String(team.id) === id))
  }

  function getTeamChallengeDisplayName(message: InboxMessage, side: 'proposer' | 'challenged') {
    const teamId = side === 'proposer' ? message.proposerTeamId : message.challengedTeamId
    const teamName = side === 'proposer' ? (message.proposerTeamName || 'Proposing team') : (message.challengedTeamName || 'Challenged team')
    return teamId && !teamExists(teamId) ? `${teamName} (team deleted)` : teamName
  }

  function currentUserCanViewChallenge(message: InboxMessage) {
    if (message.messageType === 'individual_challenge') {
      return sentByCurrentUser(message) || receivedByCurrentUser(message) || getIndividualChallengeParticipants(message).some((participant) => currentUserCanEditIndividualParticipant(participant))
    }
    if (message.messageType === 'challenge_request') {
      return sentByCurrentUser(message) || receivedByCurrentUser(message) || Boolean(getTeamChallengeUserSide(message))
    }
    return false
  }

  function getInitialChallengeMessage(thread: InboxThread) {
    return getThreadInitialChallengeMessage(thread)
  }

  function currentUserCreatedInitialChallenge(thread: InboxThread) {
    return sentByCurrentUser(getInitialChallengeMessage(thread))
  }

  function getTeamChallengeUserSide(message: InboxMessage): 'proposer' | 'challenged' | null {
    if (message.messageType !== 'challenge_request') return null
    if (myTeams.some((team) => String(team.id) === String(message.proposerTeamId || ''))) return 'proposer'
    if (myTeams.some((team) => String(team.id) === String(message.challengedTeamId || ''))) return 'challenged'
    return null
  }

  function getTeamChallengeScoreKey(message: InboxMessage, side: 'proposer' | 'challenged') {
    return `${messageThreadId(message)}:${side}`
  }

  function getTeamChallengeTeamName(message: InboxMessage, side: 'proposer' | 'challenged') {
    return getTeamChallengeDisplayName(message, side)
  }

  function getTeamChallengeStateCode(message: InboxMessage) {
    return String(message.challengeState || '').trim().toUpperCase()
  }

  function getTeamChallengeCourseName(message: InboxMessage) {
    return String(message.challengeCourse || '').trim() || 'Team Challenge'
  }

  function getTeamChallengeTeeColor(message: InboxMessage) {
    return normalizeTeeColor(message.challengeTeeColor || DEFAULT_TEE_COLOR)
  }

  function getTeamChallengeScoringType(message: InboxMessage) {
    return normalizeTeamChallengeScoringType(message.challengeScoringType)
  }

  function getTeamChallengePointsPerHole(message: InboxMessage) {
    return normalizeTeamChallengePointsPerHole(message.challengePointsPerHole)
  }

  function getTeamChallengeScoringLabel(message: InboxMessage) {
    const label = teamChallengeScoringTypeLabel(getTeamChallengeScoringType(message))
    return isSkinsTeamChallenge(getTeamChallengeScoringType(message)) ? `${label} · ${formatPointNumber(getTeamChallengePointsPerHole(message))} pts/hole` : label
  }

  function getTeamChallengePointSummary(message: InboxMessage) {
    return calculateTeamChallengePoints(
      getTeamChallengeHoles(message, 'proposer'),
      getTeamChallengeHoles(message, 'challenged'),
      getTeamChallengeScoringType(message),
      getTeamChallengePointsPerHole(message),
    )
  }

  function getHoleByNumber(holes: HoleScoreDetail[]) {
    const byHole = new Map<number, HoleScoreDetail>()
    holes.forEach((hole, index) => {
      const holeNumber = Number(hole?.hole ?? index + 1)
      if (Number.isFinite(holeNumber) && holeNumber >= 1 && holeNumber <= 18) byHole.set(Math.trunc(holeNumber), hole)
    })
    return byHole
  }

  function formatHoleReviewScore(hole?: HoleScoreDetail | null) {
    if (!hole || !hole.scoreProvided || !Number.isFinite(Number(hole.score))) return '—'
    return String(Number(hole.score))
  }

  function getTeamChallengeSideInitial(message: InboxMessage, side: 'proposer' | 'challenged') {
    const name = getTeamChallengeTeamName(message, side)
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || (side === 'proposer' ? 'P' : 'C')
  }

  function getTeamChallengeSummaryWinnerLabel(message: InboxMessage, winner: 'proposer' | 'challenged' | 'tie' | 'pending') {
    if (winner === 'pending' || winner === 'tie') return '—'
    return getTeamChallengeSideInitial(message, winner)
  }

  function getTeamChallengeSummaryScoreClass(winner: 'proposer' | 'challenged' | 'tie' | 'pending', side: 'proposer' | 'challenged') {
    if (winner === side) return 'inboxTeamChallengeSummaryScore--winner'
    if (winner === 'tie' || winner === 'pending') return 'inboxTeamChallengeSummaryScore--push'
    return 'inboxTeamChallengeSummaryScore--loss'
  }

  function getTeamChallengeTotalScoreClass(proposerScore: number | null, challengedScore: number | null, side: 'proposer' | 'challenged') {
    if (proposerScore == null || challengedScore == null || proposerScore === challengedScore) return 'inboxTeamChallengeSummaryTotalScore--push'
    const winner = proposerScore < challengedScore ? 'proposer' : 'challenged'
    return winner === side ? 'inboxTeamChallengeSummaryTotalScore--winner' : 'inboxTeamChallengeSummaryTotalScore--loss'
  }

  function getTeamChallengePushPointsForSummary(result: { winner: 'proposer' | 'challenged' | 'tie' | 'pending'; pointsAwarded: number; carryoverAfterHole: number; strokeDifferentialBonus: number }, pointSummary: ReturnType<typeof calculateTeamChallengePoints>) {
    if (pointSummary.scoringType !== 'skins_push') return 0
    if (result.winner === 'tie' || result.winner === 'pending') return Math.max(0, result.carryoverAfterHole)
    if (result.winner === 'proposer' || result.winner === 'challenged') return Math.max(0, result.pointsAwarded - pointSummary.pointsPerHole - result.strokeDifferentialBonus)
    return 0
  }

  function formatTeamChallengePointLeadLabel(message: InboxMessage, proposerPoints: number, challengedPoints: number) {
    if (proposerPoints === challengedPoints) return '—'
    const leader = proposerPoints > challengedPoints ? 'proposer' : 'challenged'
    const difference = Math.abs(proposerPoints - challengedPoints)
    return `${getTeamChallengeSideInitial(message, leader)} +${formatPointNumber(difference)}`
  }

  function formatPointNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  }

  function formatPointTotal(value: number) {
    return `${formatPointNumber(value)} pts`
  }

  function formatOpponentAdjustedPointLabel(ownPoints: number, opponentPoints: number) {
    return `${formatPointTotal(ownPoints)} won • ${formatPointTotal(opponentPoints)} opponent`
  }

  function getStoredTeamChallengeHoles(message: InboxMessage, side: 'proposer' | 'challenged') {
    const holes = side === 'proposer' ? message.proposerTeamHoles : message.challengedTeamHoles
    const selectedTeeColor = getTeamChallengeTeeColor(message)
    return Array.isArray(holes) && holes.length ? applyChallengeTeeColor(normalizeHoleScorecard(holes, getTeamChallengeStateCode(message), getTeamChallengeCourseName(message), selectedTeeColor), selectedTeeColor) : null
  }

  function getProvidedHoleCount(holes: HoleScoreDetail[]) {
    return holes.filter((hole) => hole.scoreProvided).length
  }

  function getProvidedHoleScoreTotal(holes: HoleScoreDetail[]) {
    return holes
      .filter((hole) => hole.scoreProvided)
      .reduce((sum, hole) => sum + (Number.isFinite(Number(hole.score)) ? Number(hole.score) : 0), 0)
  }

  function getTeamChallengeHoles(message: InboxMessage, side: 'proposer' | 'challenged', preferCached = true) {
    const key = getTeamChallengeScoreKey(message, side)
    const selectedTeeColor = getTeamChallengeTeeColor(message)
    if (preferCached && teamChallengeScorecards[key]) return applyChallengeTeeColor(teamChallengeScorecards[key], selectedTeeColor)
    return getStoredTeamChallengeHoles(message, side) || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(message), getTeamChallengeCourseName(message), selectedTeeColor)
  }

  function getTeamChallengeScore(message: InboxMessage, side: 'proposer' | 'challenged', preferCached = true) {
    const holes = getTeamChallengeHoles(message, side, preferCached)
    const providedCount = getProvidedHoleCount(holes)
    if (providedCount > 0) return getProvidedHoleScoreTotal(holes)
    const storedScore = side === 'proposer' ? message.proposerTeamScore : message.challengedTeamScore
    return Number.isFinite(Number(storedScore)) ? Number(storedScore) : null
  }

  function getTeamChallengeScorecardSummary(message: InboxMessage, side: 'proposer' | 'challenged') {
    const holes = getTeamChallengeHoles(message, side)
    const missing = missingHoleScoreNumbers(holes)
    const providedCount = Math.max(0, holes.length - missing.length)
    const score = getTeamChallengeScore(message, side)
    if (providedCount === 0 && score == null) return 'Score pending'
    if (providedCount === 0 && score != null) return `Saved score ${score}`
    return `${providedCount} of ${holes.length || 18} holes entered • Current score ${getProvidedHoleScoreTotal(holes)}`
  }


  function getTeamChallengeLeaderboardRows(message: InboxMessage) {
    const pointSummary = getTeamChallengePointSummary(message)
    const sides: Array<{ side: 'proposer' | 'challenged'; name: string }> = [
      { side: 'proposer', name: getTeamChallengeDisplayName(message, 'proposer') },
      { side: 'challenged', name: getTeamChallengeDisplayName(message, 'challenged') },
    ]

    return sides
      .map((entry) => {
        const holes = getTeamChallengeHoles(message, entry.side, false)
        const enteredHoles = holes.filter((hole) => hole.scoreProvided)
        const score = getTeamChallengeScore(message, entry.side, false)
        const parTotal = enteredHoles.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0)
        const relativeScore = score == null || enteredHoles.length === 0 ? null : score - parTotal
        const ownPoints = entry.side === 'proposer' ? pointSummary.proposerPoints : pointSummary.challengedPoints
        const opponentPoints = entry.side === 'proposer' ? pointSummary.challengedPoints : pointSummary.proposerPoints
        const points = entry.side === 'proposer' ? pointSummary.proposerNetPoints : pointSummary.challengedNetPoints
        return {
          side: entry.side,
          teamName: entry.name,
          holes,
          score,
          thru: enteredHoles.length,
          relativeScore,
          points,
          ownPoints,
          opponentPoints,
          pointsLabel: isSkinsTeamChallenge(pointSummary.scoringType) ? formatPointTotal(points) : '—',
          pointsRelativeLabel: isSkinsTeamChallenge(pointSummary.scoringType) ? formatOpponentAdjustedPointLabel(ownPoints, opponentPoints) : 'Stroke play',
          roundLabel: formatLeaderboardRelative(relativeScore),
          totalLabel: score == null ? 'Pending' : String(score),
        }
      })
      .sort((a, b) => {
        if (isSkinsTeamChallenge(pointSummary.scoringType) && a.points !== b.points) return b.points - a.points
        if (a.relativeScore == null && b.relativeScore == null) return a.teamName.localeCompare(b.teamName)
        if (a.relativeScore == null) return 1
        if (b.relativeScore == null) return -1
        if (a.relativeScore !== b.relativeScore) return a.relativeScore - b.relativeScore
        return (a.score ?? Number.MAX_SAFE_INTEGER) - (b.score ?? Number.MAX_SAFE_INTEGER)
      })
      .map((row, index) => ({ ...row, position: index + 1 }))
  }


  function getTeamRoundSummaryRows(message: InboxMessage, side: TeamChallengeLeaderboardSide) {
    let runningPar = 0
    let runningScore = 0
    return getTeamChallengeHoles(message, side, false).map((hole) => {
      const par = Number(hole.par)
      const score = Number(hole.score)
      const scoreProvided = Boolean(hole.scoreProvided) && Number.isFinite(score)
      if (scoreProvided) {
        runningPar += Number.isFinite(par) ? par : 0
        runningScore += score
      }
      const relativeScore = scoreProvided ? runningScore - runningPar : null
      return {
        hole: hole.hole,
        par: Number.isFinite(par) && par > 0 ? par : null,
        score: scoreProvided ? score : null,
        relativeLabel: formatLeaderboardRelative(relativeScore),
        totalLabel: scoreProvided ? String(runningScore) : '—',
      }
    })
  }

  function openTeamLeaderboardRoundSummary(message: InboxMessage, side: TeamChallengeLeaderboardSide) {
    setActiveTeamLeaderboardSide(side)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_round_summary_opened', data: { messageId: message.id, threadId: messageThreadId(message), side, teamName: getTeamChallengeDisplayName(message, side), course: getTeamChallengeCourseName(message), summaryColumns: ['Hole', 'Par', 'Score', 'Current round score over/under', 'Current round total stroke score'] } })
  }

  function returnFromTeamRoundSummary(message: InboxMessage) {
    const side = activeTeamLeaderboardSide
    setActiveTeamLeaderboardSide(null)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_round_summary_back_to_leaderboard', data: { messageId: message.id, threadId: messageThreadId(message), side } })
  }

  async function fetchCurrentChallengeForLeaderboard(message: InboxMessage, messageType: 'challenge_request' | 'individual_challenge', trigger: 'open' | 'refresh') {
    const activeThreadId = messageThreadId(message)
    setRefreshingLeaderboard(true)
    logFrontendEvent({ category: 'inbox.leaderboard', message: 'leaderboard_current_data_fetch_started', data: { messageId: message.id, threadId: activeThreadId, messageType, trigger } })
    try {
      const loaded = await loadInbox()
      const refreshed = loaded ? uniqueInboxMessages([...(loaded.inboxMessages || []), ...(loaded.sentChallenges || [])])
        .find((item) => item.messageType === messageType && messageThreadId(item) === activeThreadId) : null
      if (!refreshed) {
        const errorMessage = 'Could not load the latest leaderboard data.'
        setError(errorMessage)
        logFrontendEvent({ category: 'inbox.leaderboard', level: 'error', message: 'leaderboard_current_data_fetch_failed', data: { messageId: message.id, threadId: activeThreadId, messageType, trigger, error: errorMessage } })
        return null
      }
      syncLeaderboardScorecardCaches(refreshed)
      logFrontendEvent({ category: 'inbox.leaderboard', message: 'leaderboard_current_data_fetch_succeeded', data: { messageId: refreshed.id, threadId: activeThreadId, messageType, trigger, source: 'api' } })
      return refreshed
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not load the latest leaderboard data.'
      setError(errorMessage)
      logFrontendEvent({ category: 'inbox.leaderboard', level: 'error', message: 'leaderboard_current_data_fetch_failed', data: { messageId: message.id, threadId: activeThreadId, messageType, trigger, error: errorMessage } })
      return null
    } finally {
      setRefreshingLeaderboard(false)
    }
  }

  async function openTeamChallengeLeaderboard(message: InboxMessage, returnTarget: TeamChallengeScorecardTarget | null = null) {
    const currentMessage = await fetchCurrentChallengeForLeaderboard(message, 'challenge_request', 'open')
    if (!currentMessage) return null
    const rows = getTeamChallengeLeaderboardRows(currentMessage)
    const pointSummary = getTeamChallengePointSummary(currentMessage)
    const showPointsColumn = isSkinsTeamChallenge(pointSummary.scoringType)
    setTeamChallengeLeaderboardReturnTarget(returnTarget)
    setActiveTeamLeaderboardSide(null)
    setActiveTeamChallengeLeaderboard(currentMessage)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_opened', data: { messageId: currentMessage.id, threadId: currentMessage.threadId || currentMessage.id, proposerTeamId: currentMessage.proposerTeamId, challengedTeamId: currentMessage.challengedTeamId, displayOrder: showPointsColumn ? ['Round', 'Points', 'Thru', 'Total'] : ['Round', 'Thru', 'Total'], totalDisplayMode: showPointsColumn ? 'entered_strokes_and_points' : 'entered_strokes', pointsDisplayMode: showPointsColumn ? 'opponent_adjusted_net_points' : 'not_applicable', rowCount: rows.length, completedCount: rows.filter((row) => row.score != null).length, showPointsColumn, summaryViewVisible: true, summaryViewMode: 'compact_line_item', opponentReadOnlyScoreTileRemoved: true, pushColumnVisible: true, scoreColorLegend: ['win', 'loss', 'push'], skinsPushDifferentialHoleCount: pointSummary.holeResults.filter((hole) => hole.strokeDifferentialBonus > 0).length, fetchedCurrentData: true, returnToScorecard: Boolean(returnTarget) } })
    return currentMessage
  }

  async function openTeamChallengeLeaderboardFromScorecard(message: InboxMessage, side: 'proposer' | 'challenged', editable: boolean) {
    const key = getTeamChallengeScoreKey(message, side)
    let resumeHole = scorecardResumeHoles[key] || null
    try {
      if (editable && teamChallengePendingHoleSaveRef.current) {
        const pendingResult = await teamChallengePendingHoleSaveRef.current('team_challenge_leaderboard_open')
        const latestHoles = pendingResult.holes || getTeamChallengeHoles(message, side)
        updateTeamChallengeScorecard(message, side, latestHoles)
        resumeHole = resolveLeaderboardResumeHole(latestHoles, pendingResult.hole || resumeHole, pendingResult.saved)
        rememberScorecardResumeHole(key, resumeHole)
      }
      const opened = await openTeamChallengeLeaderboard(message, { message, side })
      if (opened) {
        setActiveTeamChallengeScorecard(null)
        logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'scorecard_transitioned_to_leaderboard', data: { messageId: message.id, threadId: messageThreadId(message), side, returnToHole: resumeHole } })
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save the active hole before opening the leaderboard.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', level: 'error', message: 'scorecard_transition_to_leaderboard_failed', data: { messageId: message.id, threadId: messageThreadId(message), side, error: messageText } })
    }
  }

  function returnFromTeamChallengeLeaderboard(source: 'back' | 'close' | 'overlay') {
    const returnTarget = teamChallengeLeaderboardReturnTarget
    const leaderboardMessage = activeTeamChallengeLeaderboard
    setActiveTeamLeaderboardSide(null)
    setActiveTeamChallengeLeaderboard(null)
    setTeamChallengeLeaderboardReturnTarget(null)
    if (!returnTarget) return

    const returnMessage = leaderboardMessage && messageThreadId(leaderboardMessage) === messageThreadId(returnTarget.message)
      ? leaderboardMessage
      : returnTarget.message
    setActiveTeamChallengeScorecard({ message: returnMessage, side: returnTarget.side })
    const key = getTeamChallengeScoreKey(returnMessage, returnTarget.side)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'returned_to_hole_scorecard', data: { messageId: returnMessage.id, threadId: messageThreadId(returnMessage), side: returnTarget.side, source, returnToHole: scorecardResumeHoles[key] || null } })
  }

  async function refreshTeamChallengeLeaderboard() {
    if (!activeTeamChallengeLeaderboard) return
    const activeThreadId = messageThreadId(activeTeamChallengeLeaderboard)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_refresh_started', data: { messageId: activeTeamChallengeLeaderboard.id, threadId: activeThreadId } })
    const refreshed = await fetchCurrentChallengeForLeaderboard(activeTeamChallengeLeaderboard, 'challenge_request', 'refresh')
    if (refreshed) {
      setActiveTeamLeaderboardSide(null)
      setActiveTeamChallengeLeaderboard(refreshed)
    }
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_refresh_succeeded', data: { messageId: refreshed?.id || activeTeamChallengeLeaderboard.id, threadId: activeThreadId, refreshed: Boolean(refreshed) } })
  }

  function getIndividualChallengeParticipants(message: InboxMessage) {
    return Array.isArray(message.individualChallengeParticipants) ? message.individualChallengeParticipants : []
  }

  function participantDisplayName(participant: IndividualChallengeParticipant) {
    return participant.name || participant.email || 'Golfer'
  }

  function participantEmail(participant: IndividualChallengeParticipant) {
    return String(participant.email || '').trim().toLowerCase()
  }

  function currentUserCanEditIndividualParticipant(participant: IndividualChallengeParticipant) {
    return String(participant.userId || '') === String(user?.id || '') || participantEmail(participant) === currentUserEmail
  }

  function getIndividualChallengeScoreKey(message: InboxMessage, participant: IndividualChallengeParticipant) {
    return `${messageThreadId(message)}:individual:${participantEmail(participant)}`
  }

  function getStoredIndividualChallengeHoles(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const holes = participant.holes
    const selectedTeeColor = getTeamChallengeTeeColor(message)
    return Array.isArray(holes) && holes.length ? applyChallengeTeeColor(normalizeHoleScorecard(holes, getTeamChallengeStateCode(message), getTeamChallengeCourseName(message), selectedTeeColor), selectedTeeColor) : null
  }

  function getIndividualChallengeHoles(message: InboxMessage, participant: IndividualChallengeParticipant, preferCached = true) {
    const key = getIndividualChallengeScoreKey(message, participant)
    const selectedTeeColor = getTeamChallengeTeeColor(message)
    if (preferCached && individualChallengeScorecards[key]) return applyChallengeTeeColor(individualChallengeScorecards[key], selectedTeeColor)
    return getStoredIndividualChallengeHoles(message, participant) || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(message), getTeamChallengeCourseName(message), selectedTeeColor)
  }

  function getIndividualChallengeScore(message: InboxMessage, participant: IndividualChallengeParticipant, preferCached = true) {
    const holes = getIndividualChallengeHoles(message, participant, preferCached)
    const providedCount = getProvidedHoleCount(holes)
    if (providedCount > 0) return getProvidedHoleScoreTotal(holes)
    const storedScore = participant.score
    return Number.isFinite(Number(storedScore)) ? Number(storedScore) : null
  }

  function getIndividualChallengeScorecardSummary(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const holes = getIndividualChallengeHoles(message, participant)
    const missing = missingHoleScoreNumbers(holes)
    const providedCount = Math.max(0, holes.length - missing.length)
    const score = getIndividualChallengeScore(message, participant)
    if (providedCount === 0 && score == null) return 'Score pending'
    if (providedCount === 0 && score != null) return `Saved score ${score}`
    return `${providedCount} of ${holes.length || 18} holes entered • Live score ${score ?? 0}`
  }

  function formatLeaderboardRelative(value: number | null) {
    if (value == null || !Number.isFinite(value)) return '—'
    if (value === 0) return 'E'
    return value > 0 ? `+${value}` : String(value)
  }

  function getIndividualChallengeLeaderboardRows(message: InboxMessage) {
    return getIndividualChallengeParticipants(message)
      .map((participant) => {
        const holes = getIndividualChallengeHoles(message, participant, false)
        const enteredHoles = holes.filter((hole) => hole.scoreProvided)
        const score = getIndividualChallengeScore(message, participant, false)
        const parTotal = enteredHoles.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0)
        const relativeScore = score == null || enteredHoles.length === 0 ? null : score - parTotal
        return {
          participant,
          holes,
          score,
          thru: enteredHoles.length,
          relativeScore,
          roundLabel: formatLeaderboardRelative(relativeScore),
          totalLabel: score == null ? 'Pending' : String(score),
        }
      })
      .sort((a, b) => {
        if (a.relativeScore == null && b.relativeScore == null) return participantDisplayName(a.participant).localeCompare(participantDisplayName(b.participant))
        if (a.relativeScore == null) return 1
        if (b.relativeScore == null) return -1
        if (a.relativeScore !== b.relativeScore) return a.relativeScore - b.relativeScore
        return (a.score ?? Number.MAX_SAFE_INTEGER) - (b.score ?? Number.MAX_SAFE_INTEGER)
      })
      .map((row, index) => ({ ...row, position: index + 1 }))
  }

  async function openIndividualChallengeLeaderboard(message: InboxMessage, returnTarget: IndividualChallengeScorecardTarget | null = null) {
    const currentMessage = await fetchCurrentChallengeForLeaderboard(message, 'individual_challenge', 'open')
    if (!currentMessage) return null
    const rows = getIndividualChallengeLeaderboardRows(currentMessage)
    setIndividualChallengeLeaderboardReturnTarget(returnTarget)
    setActiveIndividualLeaderboardParticipant(null)
    setActiveIndividualChallengeLeaderboard(currentMessage)
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_leaderboard_opened', data: { messageId: currentMessage.id, threadId: messageThreadId(currentMessage), participantCount: getIndividualChallengeParticipants(currentMessage).length, displayOrder: ['Round', 'Thru', 'Total'], totalDisplayMode: 'entered_strokes', rowCount: rows.length, completedCount: rows.filter((row) => row.score != null).length, golferRowsClickable: true, roundSummaryColumns: ['Hole', 'Par', 'Score', 'Current round score over/under', 'Current round total stroke score'], readOnlyScoreTilesRemoved: true, fetchedCurrentData: true, returnToScorecard: Boolean(returnTarget) } })
    return currentMessage
  }

  async function openIndividualChallengeLeaderboardFromScorecard(message: InboxMessage, participant: IndividualChallengeParticipant, editable: boolean) {
    const key = getIndividualChallengeScoreKey(message, participant)
    let resumeHole = scorecardResumeHoles[key] || null
    try {
      if (editable && individualChallengePendingHoleSaveRef.current) {
        const pendingResult = await individualChallengePendingHoleSaveRef.current('individual_challenge_leaderboard_open')
        const latestHoles = pendingResult.holes || getIndividualChallengeHoles(message, participant)
        updateIndividualChallengeScorecard(message, participant, latestHoles)
        resumeHole = resolveLeaderboardResumeHole(latestHoles, pendingResult.hole || resumeHole, pendingResult.saved)
        rememberScorecardResumeHole(key, resumeHole)
      }
      const opened = await openIndividualChallengeLeaderboard(message, { message, participant })
      if (opened) {
        setActiveIndividualChallengeScorecard(null)
        logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'scorecard_transitioned_to_leaderboard', data: { messageId: message.id, threadId: messageThreadId(message), participantEmail: participantEmail(participant), returnToHole: resumeHole } })
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save the active hole before opening the leaderboard.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', level: 'error', message: 'scorecard_transition_to_leaderboard_failed', data: { messageId: message.id, threadId: messageThreadId(message), participantEmail: participantEmail(participant), error: messageText } })
    }
  }

  function openIndividualLeaderboardRoundSummary(message: InboxMessage, participant: IndividualChallengeParticipant) {
    setActiveIndividualLeaderboardParticipant(participant)
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_round_summary_opened', data: { messageId: message.id, threadId: messageThreadId(message), participantEmail: participantEmail(participant), course: getTeamChallengeCourseName(message), editable: currentUserCanEditIndividualParticipant(participant), summaryColumns: ['Hole', 'Par', 'Score', 'Current round score over/under', 'Current round total stroke score'] } })
  }

  function returnFromIndividualChallengeLeaderboard(source: 'back' | 'close' | 'overlay') {
    const returnTarget = individualChallengeLeaderboardReturnTarget
    const leaderboardMessage = activeIndividualChallengeLeaderboard
    setActiveIndividualLeaderboardParticipant(null)
    setActiveIndividualChallengeLeaderboard(null)
    setIndividualChallengeLeaderboardReturnTarget(null)
    if (!returnTarget) return

    const returnMessage = leaderboardMessage && messageThreadId(leaderboardMessage) === messageThreadId(returnTarget.message)
      ? leaderboardMessage
      : returnTarget.message
    const targetEmail = participantEmail(returnTarget.participant)
    const returnParticipant = getIndividualChallengeParticipants(returnMessage)
      .find((participant) => participantEmail(participant) === targetEmail) || returnTarget.participant
    setActiveIndividualChallengeScorecard({ message: returnMessage, participant: returnParticipant })
    const key = getIndividualChallengeScoreKey(returnMessage, returnParticipant)
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'returned_to_hole_scorecard', data: { messageId: returnMessage.id, threadId: messageThreadId(returnMessage), participantEmail: targetEmail, source, returnToHole: scorecardResumeHoles[key] || null } })
  }

  function closeIndividualChallengeLeaderboard() {
    returnFromIndividualChallengeLeaderboard('close')
  }

  function getIndividualRoundSummaryRows(message: InboxMessage, participant: IndividualChallengeParticipant) {
    let runningPar = 0
    let runningScore = 0
    return getIndividualChallengeHoles(message, participant).map((hole) => {
      const par = Number(hole.par)
      const score = Number(hole.score)
      const scoreProvided = Boolean(hole.scoreProvided) && Number.isFinite(score)
      if (scoreProvided) {
        runningPar += Number.isFinite(par) ? par : 0
        runningScore += score
      }
      const relativeScore = scoreProvided ? runningScore - runningPar : null
      return {
        hole: hole.hole,
        par: Number.isFinite(par) && par > 0 ? par : null,
        score: scoreProvided ? score : null,
        relativeLabel: formatLeaderboardRelative(relativeScore),
        totalLabel: scoreProvided ? String(runningScore) : '—',
      }
    })
  }

  function syncLeaderboardScorecardCaches(refreshed: InboxMessage) {
    if (refreshed.messageType === 'challenge_request') {
      setTeamChallengeScorecards((prev) => ({
        ...prev,
        [`${messageThreadId(refreshed)}:proposer`]: getStoredTeamChallengeHoles(refreshed, 'proposer') || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(refreshed), getTeamChallengeCourseName(refreshed), getTeamChallengeTeeColor(refreshed)),
        [`${messageThreadId(refreshed)}:challenged`]: getStoredTeamChallengeHoles(refreshed, 'challenged') || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(refreshed), getTeamChallengeCourseName(refreshed), getTeamChallengeTeeColor(refreshed)),
      }))
      return
    }

    if (refreshed.messageType === 'individual_challenge') {
      const nextEntries: Record<string, HoleScoreDetail[]> = {}
      getIndividualChallengeParticipants(refreshed).forEach((participant) => {
        nextEntries[getIndividualChallengeScoreKey(refreshed, participant)] = getStoredIndividualChallengeHoles(refreshed, participant) || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(refreshed), getTeamChallengeCourseName(refreshed), getTeamChallengeTeeColor(refreshed))
      })
      setIndividualChallengeScorecards((prev) => ({ ...prev, ...nextEntries }))
    }
  }

  async function refreshIndividualChallengeLeaderboard() {
    if (!activeIndividualChallengeLeaderboard) return
    const activeThreadId = messageThreadId(activeIndividualChallengeLeaderboard)
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_leaderboard_refresh_started', data: { messageId: activeIndividualChallengeLeaderboard.id, threadId: activeThreadId } })
    const refreshed = await fetchCurrentChallengeForLeaderboard(activeIndividualChallengeLeaderboard, 'individual_challenge', 'refresh')
    if (refreshed) setActiveIndividualChallengeLeaderboard(refreshed)
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_leaderboard_refresh_succeeded', data: { messageId: refreshed?.id || activeIndividualChallengeLeaderboard.id, threadId: activeThreadId, refreshed: Boolean(refreshed) } })
  }

  async function loadInbox() {
    setLoading(true)
    setError(null)
    try {
      const [inboxResult, sentResult, teamResult] = await Promise.all([fetchInboxMessages(), fetchSentInboxMessages(), fetchTeams()])
      setMessages(inboxResult.messages || [])
      setSentMessages(sentResult.sentMessages || [])
      setSentChallenges(sentResult.sentChallenges || [])
      setTeams(teamResult || [])
      logFrontendEvent({
        category: 'inbox.page',
        message: 'inbox_messages_loaded',
        data: {
          unreadCount: inboxResult.unreadCount,
          messageCount: inboxResult.messages?.length || 0,
          receivedThreadCount: buildInboxThreads((inboxResult.messages || []).filter((message) => message.messageType === 'message')).length,
          teamChallengeThreadCount: buildInboxThreads(uniqueInboxMessages([...(inboxResult.messages || []), ...(sentResult.sentChallenges || [])].filter(isChallengeMessage))).length,
          sentMessageCount: sentResult.sentMessages?.length || 0,
          sentChallengeCount: sentResult.sentChallenges?.length || 0,
          teamCount: teamResult?.length || 0,
        },
      })
      return {
        inboxMessages: inboxResult.messages || [],
        sentMessages: sentResult.sentMessages || [],
        sentChallenges: sentResult.sentChallenges || [],
        teams: teamResult || [],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load inbox.'
      setError(message)
      logFrontendEvent({ category: 'inbox.page', level: 'error', message: 'inbox_messages_load_failed', data: { error: message } })
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInbox()
  }, [])

  useEffect(() => {
    if (loading) return
    const unreadThreads = teamChallengeThreads.filter((thread) => thread.unreadMessages.length > 0 && !autoMarkedReadThreadIds.current.has(thread.threadId))
    if (unreadThreads.length === 0) return
    unreadThreads.forEach((thread) => {
      autoMarkedReadThreadIds.current.add(thread.threadId)
      void handleAutoMarkThreadRead(thread)
    })
  }, [loading, teamChallengeThreads])

  useEffect(() => {
    if (!proposerTeamId && myTeams.length > 0) {
      setProposerTeamId(myTeams[0].id)
    }
    if (proposerTeamId && myTeams.length > 0 && !myTeams.some((team) => team.id === proposerTeamId)) {
      setProposerTeamId(myTeams[0].id)
    }
  }, [myTeams, proposerTeamId])

  useEffect(() => {
    if (stateOptions.length && !stateOptions.some(option => option.abbr === teamChallengeState)) {
      setTeamChallengeState(stateOptions[0].abbr)
      setTeamChallengeCourse('')
    }
  }, [stateOptions, teamChallengeState])

  async function handleChallengeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setError(null)
    setStatus(null)
    const trimmedChallengeTeamIdentifier = challengedTeamIdentifier.trim()
    const trimmedChallengeDate = teamChallengeDate.trim()
    const trimmedChallengeState = teamChallengeState.trim().toUpperCase()
    const trimmedChallengeCourse = teamChallengeCourse.trim()
    const trimmedBody = challengeBody.trim()
    const messageTypeForChallenge: InboxMessageType = isTeamChallenge ? 'challenge_request' : 'individual_challenge'
    const effectiveChallengeTeeColor = normalizeTeeColor(teamChallengeTeeColor)
    const effectiveChallengeScoringType = normalizeTeamChallengeScoringType(teamChallengeScoringType)
    const effectiveChallengePointsPerHole = isSkinsTeamChallenge(effectiveChallengeScoringType) ? normalizeTeamChallengePointsPerHole(teamChallengePointsPerHole) : null
    const participantEmails = parsedIndividualParticipantEmails

    try {
      logFrontendEvent({
        category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge',
        message: isTeamChallenge ? 'team_challenge_send_started' : 'individual_challenge_send_started',
        data: { challengedTeamIdentifier: trimmedChallengeTeamIdentifier, challengedTeamName: selectedChallengedTeam?.name || null, proposerTeamId, proposerTeamName: selectedProposerTeam?.name, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, participantCount: participantEmails.length },
      })
      const result = await sendInboxMessage(isTeamChallenge
        ? { proposerTeamId, challengedTeamIdentifier: trimmedChallengeTeamIdentifier, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, messageType: messageTypeForChallenge, body: trimmedBody }
        : { individualParticipantEmails: participantEmails, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, challengeTeeColor: effectiveChallengeTeeColor, messageType: messageTypeForChallenge, body: trimmedBody })
      setStatus(result.notice || (isTeamChallenge ? 'Your Team Challenge was sent successfully.' : 'Your Individual Challenge was sent successfully.'))
      setChallengedTeamIdentifier('')
      setIndividualParticipantEmails('')
      setTeamChallengeDate(getUserTodayISO())
      setTeamChallengeCourse('')
      setTeamChallengeCourseSearch('')
      setTeamChallengeTeeColor('')
      setTeamChallengeScoringType('stroke_play')
      setTeamChallengePointsPerHole('1')
      setChallengeBody('')
      setChallengesComposeOpen(false)
      logFrontendEvent({
        category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge',
        message: isTeamChallenge ? 'team_challenge_send_succeeded' : 'individual_challenge_send_succeeded',
        data: { challengedTeamIdentifier: trimmedChallengeTeamIdentifier, challengedTeamName: selectedChallengedTeam?.name || result.message?.challengedTeamName || null, proposerTeamId, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, participantCount: participantEmails.length, messageId: result.message?.id, threadId: result.message?.threadId },
      })
      await loadInbox()
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        const message = err.message || 'GolfHomiez Team ID does not exist.'
        setError(message)
        logFrontendEvent({ category: 'inbox.teamChallenge', level: 'warn', message: 'team_challenge_team_not_found_displayed', data: { challengedTeamIdentifier: err.challengedTeamIdentifier, proposerTeamId } })
        return
      }
      if (err instanceof RecipientNotFoundError) {
        const message = err.message || 'Recipient does not exist in Golf Homiez. Send them an invite to join.'
        logFrontendEvent({ category: isIndividualChallenge ? 'inbox.individualChallenge' : 'inbox.message', level: 'warn', message: 'individual_challenge_recipient_not_found_redirecting_to_invite_homie', data: { recipientEmail: err.recipientEmail } })
        navigate(`/invite-homie?email=${encodeURIComponent(err.recipientEmail)}&reason=recipient-not-found`, { state: { notice: message } })
        return
      }
      const message = err instanceof Error ? err.message : isTeamChallenge ? 'Could not send Team Challenge.' : 'Could not send Individual Challenge.'
      setError(message)
      logFrontendEvent({ category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge', level: 'error', message: isTeamChallenge ? 'team_challenge_send_failed' : 'individual_challenge_send_failed', data: { challengedTeamIdentifier: trimmedChallengeTeamIdentifier, proposerTeamId, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, participantCount: participantEmails.length, error: message } })
    } finally {
      setSending(false)
    }
  }

  async function handleReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!replyingTo) return
    const trimmedBody = replyBody.trim()
    setReplySending(true)
    setError(null)
    setStatus(null)

    try {
      logFrontendEvent({ category: replyingTo.messageType === 'challenge_request' ? 'inbox.teamChallenge.reply' : (replyingTo.messageType === 'individual_challenge' ? 'inbox.individualChallenge.reply' : 'inbox.reply'), message: replyingTo.messageType === 'challenge_request' ? 'team_challenge_reply_started' : (replyingTo.messageType === 'individual_challenge' ? 'individual_challenge_reply_started' : 'inbox_reply_started'), data: { replyToMessageId: replyingTo.id, threadId: replyingTo.threadId || replyingTo.id, recipientEmail: replyingTo.senderEmail, proposerTeamId: replyingTo.proposerTeamId, challengedTeamId: replyingTo.challengedTeamId } })
      const result = await replyToInboxMessage({ message: replyingTo, body: trimmedBody })
      setStatus(result.notice || 'Your message was sent successfully.')
      setReplyingTo(null)
      setReplyBody('')
      logFrontendEvent({ category: replyingTo.messageType === 'challenge_request' ? 'inbox.teamChallenge.reply' : (replyingTo.messageType === 'individual_challenge' ? 'inbox.individualChallenge.reply' : 'inbox.reply'), message: replyingTo.messageType === 'challenge_request' ? 'team_challenge_reply_succeeded' : (replyingTo.messageType === 'individual_challenge' ? 'individual_challenge_reply_succeeded' : 'inbox_reply_succeeded'), data: { replyToMessageId: replyingTo.id, messageId: result.message?.id, threadId: result.message?.threadId } })
      await loadInbox()
    } catch (err) {
      if (err instanceof RecipientNotFoundError) {
        const message = err.message || 'Recipient does not exist in Golf Homiez. Send them an invite to join.'
        logFrontendEvent({ category: 'inbox.reply', level: 'warn', message: 'inbox_reply_recipient_not_found_redirecting_to_invite_homie', data: { recipientEmail: err.recipientEmail, replyToMessageId: replyingTo.id } })
        navigate(`/invite-homie?email=${encodeURIComponent(err.recipientEmail)}&reason=recipient-not-found`, { state: { notice: message } })
        return
      }
      const message = err instanceof Error ? err.message : 'Could not send reply.'
      setError(message)
      logFrontendEvent({ category: replyingTo.messageType === 'challenge_request' ? 'inbox.teamChallenge.reply' : (replyingTo.messageType === 'individual_challenge' ? 'inbox.individualChallenge.reply' : 'inbox.reply'), level: 'error', message: replyingTo.messageType === 'challenge_request' ? 'team_challenge_reply_failed' : (replyingTo.messageType === 'individual_challenge' ? 'individual_challenge_reply_failed' : 'inbox_reply_failed'), data: { replyToMessageId: replyingTo.id, error: message } })
    } finally {
      setReplySending(false)
    }
  }


  function openTeamChallengeScorecard(message: InboxMessage, side: 'proposer' | 'challenged') {
    const key = getTeamChallengeScoreKey(message, side)
    const holes = getTeamChallengeHoles(message, side)
    setTeamChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
    setActiveTeamChallengeScorecard({ message, side })
    logFrontendEvent({ category: 'inbox.teamChallenge.scorecard', message: 'team_challenge_scorecard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, side, challengeTeeColor: getTeamChallengeTeeColor(message), proposerTeamId: message.proposerTeamId, challengedTeamId: message.challengedTeamId, lineItemReviewView: true, reviewColumns: ['Hole', 'Par', 'Score', 'Distance'], reviewHoleCount: holes.length } })
  }

  function updateTeamChallengeScorecard(message: InboxMessage, side: 'proposer' | 'challenged', holes: HoleScoreDetail[]) {
    const key = getTeamChallengeScoreKey(message, side)
    setTeamChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
  }

  function patchTeamChallengeUpdate(updated: InboxMessage) {
    const patchScore = (item: InboxMessage) => (messageThreadId(item) === messageThreadId(updated) ? {
      ...item,
      challengeScoringType: updated.challengeScoringType,
      challengePointsPerHole: updated.challengePointsPerHole,
      proposerTeamScore: updated.proposerTeamScore,
      challengedTeamScore: updated.challengedTeamScore,
      proposerTeamHoles: updated.proposerTeamHoles,
      challengedTeamHoles: updated.challengedTeamHoles,
    } : item)
    setMessages((prev) => prev.map(patchScore))
    setSentChallenges((prev) => prev.map(patchScore))
    setActiveTeamChallengeLeaderboard((current) => (current && messageThreadId(current) === messageThreadId(updated) ? patchScore(current) : current))
    setActiveTeamChallengeScorecard((current) => (current && messageThreadId(current.message) === messageThreadId(updated) ? { ...current, message: patchScore(current.message) } : current))
    setTeamChallengeScorecards((prev) => ({
      ...prev,
      [`${messageThreadId(updated)}:proposer`]: getStoredTeamChallengeHoles(updated, 'proposer') || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(updated), getTeamChallengeCourseName(updated), getTeamChallengeTeeColor(updated)),
      [`${messageThreadId(updated)}:challenged`]: getStoredTeamChallengeHoles(updated, 'challenged') || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(updated), getTeamChallengeCourseName(updated), getTeamChallengeTeeColor(updated)),
    }))
  }

  async function getTeamChallengeHolesForPersistence(message: InboxMessage, side: 'proposer' | 'challenged', source: string) {
    const key = getTeamChallengeScoreKey(message, side)
    let holes = getTeamChallengeHoles(message, side)
    const activeKey = activeTeamChallengeScorecard ? getTeamChallengeScoreKey(activeTeamChallengeScorecard.message, activeTeamChallengeScorecard.side) : null
    if (activeKey === key && teamChallengePendingHoleSaveRef.current) {
      const pendingSave = await teamChallengePendingHoleSaveRef.current(source)
      if (pendingSave.holes && Array.isArray(pendingSave.holes)) {
        holes = pendingSave.holes
        setTeamChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
      }
    }
    return holes
  }

  async function persistTeamChallengeScoreProgress(message: InboxMessage, side: 'proposer' | 'challenged', options: { closeModal?: boolean; source: 'hole_save' | 'hole_reset' | 'manual_save' | 'modal_close'; allowEmptyClose?: boolean; overrideHoles?: HoleScoreDetail[] }) {
    if (isChallengeCompleted(message)) {
      setError('This challenge is complete, so scores are locked.')
      return null
    }
    const key = getTeamChallengeScoreKey(message, side)
    const scoringType = getTeamChallengeScoringType(message)
    const skinsScoring = isSkinsTeamChallenge(scoringType)
    let holes: HoleScoreDetail[]
    try {
      holes = Array.isArray(options.overrideHoles)
        ? applyChallengeTeeColor(options.overrideHoles, getTeamChallengeTeeColor(message))
        : await getTeamChallengeHolesForPersistence(message, side, options.source === 'modal_close' ? 'team_challenge_modal_close' : 'team_challenge_manual_save')
      if (Array.isArray(options.overrideHoles)) setTeamChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save the active hole score.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.teamChallenge.score', level: 'error', message: 'team_challenge_pending_hole_save_failed', data: { messageId: message.id, threadId: message.threadId || message.id, side, scoringType, source: options.source, error: messageText } })
      return null
    }

    const providedCount = getProvidedHoleCount(holes)
    if (providedCount === 0 && options.source !== 'hole_reset') {
      if (options.closeModal || options.allowEmptyClose) {
        setActiveTeamChallengeScorecard(null)
        logFrontendEvent({ category: 'inbox.teamChallenge.score', message: 'team_challenge_score_close_without_entered_holes', data: { messageId: message.id, threadId: message.threadId || message.id, side, scoringType, source: options.source } })
        return null
      }
      setError('Enter at least one hole score before saving this Team Challenge score.')
      return null
    }

    const missingHoleNumbers = missingHoleScoreNumbers(holes)
    const holeLevelPersistence = options.source === 'hole_save' || options.source === 'hole_reset'
    if (!skinsScoring && !holeLevelPersistence && missingHoleNumbers.length) {
      const missingText = `Finish entering scores for ${getTeamChallengeTeamName(message, side)} holes: ${missingHoleNumbers.join(', ')}.`
      setError(missingText)
      logFrontendEvent({ category: 'inbox.teamChallenge.scorecard', level: 'warn', message: 'team_challenge_scorecard_incomplete', data: { messageId: message.id, threadId: message.threadId || message.id, side, scoringType, missingHoleNumbers } })
      return null
    }

    const score = providedCount > 0 ? getProvidedHoleScoreTotal(holes) : null
    if (score != null && (!Number.isFinite(score) || score < 0)) {
      setError('Team Challenge score must be zero or greater.')
      return null
    }

    setUpdatingChallengeScoreKey(key)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.teamChallenge.score', message: options.source === 'modal_close' ? 'team_challenge_score_modal_close_save_started' : 'team_challenge_score_update_started', data: { messageId: message.id, threadId: message.threadId || message.id, side, scoringType, challengePointsPerHole: getTeamChallengePointsPerHole(message), score, providedCount, holeCount: holes.length, missingHoleNumbers, proposerTeamId: message.proposerTeamId, challengedTeamId: message.challengedTeamId, source: options.source, strokeDifferentialBonusTotal: getTeamChallengePointSummary(message).holeResults.reduce((sum, hole) => sum + hole.strokeDifferentialBonus, 0) } })
      const updated = await updateTeamChallengeScore(message.id, score, holes)
      patchTeamChallengeUpdate(updated)
      if (options.closeModal) setActiveTeamChallengeScorecard(null)
      setStatus(providedCount > 0 ? `Team Challenge score saved. ${providedCount} of ${holes.length || 18} holes entered.` : 'Team Challenge score cleared.')
      logFrontendEvent({ category: 'inbox.teamChallenge.score', message: options.source === 'modal_close' ? 'team_challenge_score_modal_close_save_succeeded' : 'team_challenge_score_update_succeeded', data: { messageId: updated.id, threadId: updated.threadId || updated.id, side, scoringType: getTeamChallengeScoringType(updated), challengePointsPerHole: getTeamChallengePointsPerHole(updated), score, providedCount, holeCount: holes.length, proposerTeamScore: updated.proposerTeamScore, challengedTeamScore: updated.challengedTeamScore, source: options.source, strokeDifferentialBonusTotal: getTeamChallengePointSummary(updated).holeResults.reduce((sum, hole) => sum + hole.strokeDifferentialBonus, 0) } })
      await loadInbox()
      return updated
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save Team Challenge score.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.teamChallenge.score', level: 'error', message: options.source === 'modal_close' ? 'team_challenge_score_modal_close_save_failed' : 'team_challenge_score_update_failed', data: { messageId: message.id, side, scoringType, score, providedCount, source: options.source, error: messageText } })
      return null
    } finally {
      setUpdatingChallengeScoreKey(null)
    }
  }

  async function handleTeamChallengeScoreSave(message: InboxMessage, side: 'proposer' | 'challenged') {
    await persistTeamChallengeScoreProgress(message, side, { closeModal: true, source: 'manual_save' })
  }

  async function closeTeamChallengeScorecard(message: InboxMessage, side: 'proposer' | 'challenged', editable: boolean) {
    if (editable && isSkinsTeamChallenge(getTeamChallengeScoringType(message))) {
      await persistTeamChallengeScoreProgress(message, side, { closeModal: true, source: 'modal_close', allowEmptyClose: true })
      return
    }
    setActiveTeamChallengeScorecard(null)
  }

  function patchIndividualChallengeUpdate(updated: InboxMessage, participantEmailToUpdate?: string) {
    const patchScore = (item: InboxMessage) => (messageThreadId(item) === messageThreadId(updated) ? { ...item, individualChallengeParticipants: updated.individualChallengeParticipants } : item)
    setMessages((prev) => prev.map(patchScore))
    setSentChallenges((prev) => prev.map(patchScore))
    setActiveIndividualChallengeLeaderboard((current) => (current && messageThreadId(current) === messageThreadId(updated) ? patchScore(current) : current))
    setActiveIndividualChallengeScorecard((current) => {
      if (!current || messageThreadId(current.message) !== messageThreadId(updated)) return current
      const updatedParticipant = (updated.individualChallengeParticipants || []).find((participant) => participantEmail(participant) === participantEmailToUpdate) || current.participant
      return { message: patchScore(current.message), participant: updatedParticipant }
    })
  }

  async function persistIndividualChallengeScoreProgress(message: InboxMessage, participant: IndividualChallengeParticipant, holes: HoleScoreDetail[], options: { closeModal?: boolean; source: 'hole_save' | 'hole_reset' | 'manual_save' }) {
    if (isChallengeCompleted(message)) {
      setError('This challenge is complete, so scores are locked.')
      return null
    }
    const key = getIndividualChallengeScoreKey(message, participant)
    const providedCount = getProvidedHoleCount(holes)
    if (providedCount === 0 && options.source !== 'hole_reset') {
      setError('Enter at least one hole score before saving this Individual Challenge score.')
      return null
    }

    const score = providedCount > 0 ? getProvidedHoleScoreTotal(holes) : null
    setUpdatingChallengeScoreKey(key)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.individualChallenge.score', message: options.source === 'hole_save' ? 'individual_challenge_hole_score_record_started' : 'individual_challenge_score_update_started', data: { messageId: message.id, threadId: message.threadId || message.id, participantEmail: participantEmail(participant), score, providedCount, holeCount: holes.length, source: options.source } })
      const updated = await updateIndividualChallengeScore(message.id, score, holes)
      patchIndividualChallengeUpdate(updated, participantEmail(participant))
      if (options.closeModal) setActiveIndividualChallengeScorecard(null)
      setStatus(providedCount > 0 ? `${providedCount} of ${holes.length || 18} Individual Challenge holes saved.` : 'Individual Challenge score cleared.')
      logFrontendEvent({ category: 'inbox.individualChallenge.score', message: options.source === 'hole_save' ? 'individual_challenge_hole_score_record_succeeded' : 'individual_challenge_score_update_succeeded', data: { messageId: updated.id, threadId: updated.threadId || updated.id, participantEmail: participantEmail(participant), score, providedCount, holeCount: holes.length, source: options.source } })
      await loadInbox()
      return updated
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save Individual Challenge score.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.individualChallenge.score', level: 'error', message: options.source === 'hole_save' ? 'individual_challenge_hole_score_record_failed' : 'individual_challenge_score_update_failed', data: { messageId: message.id, participantEmail: participantEmail(participant), score, providedCount, source: options.source, error: messageText } })
      throw err
    } finally {
      setUpdatingChallengeScoreKey(null)
    }
  }

  function openIndividualChallengeScorecard(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const key = getIndividualChallengeScoreKey(message, participant)
    const holes = getIndividualChallengeHoles(message, participant)
    setIndividualChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
    setActiveIndividualChallengeScorecard({ message, participant })
    logFrontendEvent({ category: 'inbox.individualChallenge.scorecard', message: 'individual_challenge_scorecard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, participantEmail: participantEmail(participant), editable: currentUserCanEditIndividualParticipant(participant), lineItemReviewView: true, reviewColumns: ['Hole', 'Par', 'Score', 'Distance'], reviewHoleCount: holes.length } })
  }

  function updateIndividualChallengeScorecard(message: InboxMessage, participant: IndividualChallengeParticipant, holes: HoleScoreDetail[]) {
    const key = getIndividualChallengeScoreKey(message, participant)
    setIndividualChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
  }

  function toggleThreadExpansion(thread: InboxThread, source: 'messages' | 'team-challenges') {
    setExpandedThreadId((current) => {
      const next = current === thread.threadId ? null : thread.threadId
      if (next !== thread.threadId && replyingTo && messageThreadId(replyingTo) === thread.threadId) {
        setReplyingTo(null)
        setReplyBody('')
      }
      if (next === thread.threadId) {
        setReplyingTo(null)
        setReplyBody('')
      }
      logFrontendEvent({
        category: source === 'team-challenges' ? 'inbox.teamChallenge' : 'inbox.message',
        message: next === thread.threadId ? 'inbox_thread_expanded' : 'inbox_thread_collapsed',
        data: { threadId: thread.threadId, displayMessageId: thread.displayMessage.id, messageType: thread.displayMessage.messageType, threadMessageCount: thread.messages.length, unreadCount: thread.unreadCount, source, otherChallengesHidden: source === 'team-challenges' && next === thread.threadId, hiddenChallengeCount: source === 'team-challenges' && next === thread.threadId ? Math.max(0, visibleChallengeThreads.length - 1) : 0 },
      })
      return next
    })
  }

  async function handleAutoMarkThreadRead(thread: InboxThread) {
    if (thread.unreadMessages.length === 0) return
    try {
      const updatedMessages = await Promise.all(thread.unreadMessages.map((message) => markInboxMessageRead(message.id)))
      setMessages((prev) => prev.map((item) => updatedMessages.find((updated) => updated.id === item.id) || item))
      setSentChallenges((prev) => prev.map((item) => updatedMessages.find((updated) => updated.id === item.id) || item))
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_thread_marked_read', data: { threadId: thread.threadId, unreadCount: thread.unreadCount, messageIds: thread.unreadMessages.map((message) => message.id), messageType: thread.displayMessage.messageType, source: 'auto_visible_notification' } })
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not mark thread as read.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.message', level: 'error', message: 'inbox_thread_mark_read_failed', data: { threadId: thread.threadId, error: messageText, source: 'auto_visible_notification' } })
    }
  }

  async function handleCompleteChallenge(thread: InboxThread) {
    const initialMessage = getInitialChallengeMessage(thread)
    const threadId = messageThreadId(initialMessage)
    setCompletingChallengeThreadId(threadId)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.challenge.complete', message: 'challenge_complete_started', data: { messageId: initialMessage.id, threadId, messageType: initialMessage.messageType } })
      const updated = await completeInboxChallenge(initialMessage.id)
      const patchStatus = (item: InboxMessage) => (messageThreadId(item) === messageThreadId(updated) ? { ...item, challengeStatus: updated.challengeStatus } : item)
      setMessages((prev) => prev.map(patchStatus))
      setSentChallenges((prev) => prev.map(patchStatus))
      setActiveTeamChallengeLeaderboard((current) => (current && messageThreadId(current) === messageThreadId(updated) ? patchStatus(current) : current))
      setActiveIndividualChallengeLeaderboard((current) => (current && messageThreadId(current) === messageThreadId(updated) ? patchStatus(current) : current))
      setStatus('Challenge completed. Scores are now locked for everyone in this challenge.')
      logFrontendEvent({ category: 'inbox.challenge.complete', message: 'challenge_complete_succeeded', data: { messageId: updated.id, threadId: messageThreadId(updated), messageType: updated.messageType, challengeStatus: updated.challengeStatus } })
      await loadInbox()
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not complete challenge.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.challenge.complete', level: 'error', message: 'challenge_complete_failed', data: { messageId: initialMessage.id, threadId, messageType: initialMessage.messageType, error: messageText } })
    } finally {
      setCompletingChallengeThreadId(null)
    }
  }

  async function handleChallengeDeletedState(thread: InboxThread, deleted: boolean) {
    const initialMessage = getInitialChallengeMessage(thread)
    const threadId = messageThreadId(initialMessage)
    setUpdatingChallengeDeleteThreadId(threadId)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.challenge.visibility', message: deleted ? 'challenge_delete_started' : 'challenge_restore_started', data: { messageId: initialMessage.id, threadId, challengeView } })
      await setInboxChallengeDeleted(initialMessage.id, deleted)
      setExpandedThreadId(null)
      setStatus(deleted ? 'Challenge moved to Deleted for your account only.' : 'Challenge restored to its prior challenge view.')
      logFrontendEvent({ category: 'inbox.challenge.visibility', message: deleted ? 'challenge_delete_succeeded' : 'challenge_restore_succeeded', data: { messageId: initialMessage.id, threadId, participantDataUnaffected: true } })
      await loadInbox()
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not update challenge visibility.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.challenge.visibility', level: 'error', message: deleted ? 'challenge_delete_failed' : 'challenge_restore_failed', data: { messageId: initialMessage.id, threadId, error: messageText } })
    } finally {
      setUpdatingChallengeDeleteThreadId(null)
    }
  }

  function renderConversation(message: InboxMessage) {
    const conversation = getConversationFor(message)
    if (conversation.length <= 1) return null

    return (
      <div className="inboxConversationThread">
        <div className="small inboxConversationTitle">Conversation</div>
        {conversation.map((item) => (
          <div key={item.id} className={`inboxConversationItem ${sentByCurrentUser(item) ? 'inboxConversationItem--sent' : 'inboxConversationItem--received'}`}>
            <div className="small">{sentByCurrentUser(item) ? 'You' : (item.senderName || item.senderEmail)} · {formatInboxTimestamp(item.createdAt)}</div>
            <div>{item.body}</div>
          </div>
        ))}
      </div>
    )
  }

  function renderTeamChallengeContext(message: InboxMessage) {
    if (!isChallengeMessage(message)) return null
    const participants = getIndividualChallengeParticipants(message)
    return (
      <div className="inboxTeamChallengeContext" aria-label="Challenge details">
        {message.messageType === 'challenge_request' ? (
          <span>{getTeamChallengeDisplayName(message, 'proposer')} challenged {getTeamChallengeDisplayName(message, 'challenged')}</span>
        ) : (
          <span>{participants.length} golfer challenge</span>
        )}
        {message.challengeDate || message.challengeState || message.challengeCourse ? (
          <span className="small">{[message.challengeDate, message.challengeState, message.challengeCourse, `${teeColorLabel(getTeamChallengeTeeColor(message))} tees`].filter(Boolean).join(' • ')}</span>
        ) : null}
        {message.messageType === 'challenge_request' ? <span className="teamChallengeTypeIndicator">{getTeamChallengeScoringLabel(message)}</span> : null}
        {isChallengeCompleted(message) ? <span className="challengeCompletedLabel">Completed · scores locked</span> : null}
      </div>
    )
  }

  function renderReplyForm(message: InboxMessage) {
    const isTeamChallengeMessage = message.messageType === 'challenge_request'
    const isIndividualChallengeMessage = message.messageType === 'individual_challenge'
    const latestMessage = getLatestConversationMessage(message)
    const replyTarget = replyingTo && messageThreadId(replyingTo) === messageThreadId(message)
    if (!replyTarget || isChallengeCompleted(message)) return null

    return (
      <form className="formStack inboxReplyForm" onSubmit={handleReplySubmit}>
        <label className="label" htmlFor={`reply-${messageThreadId(message)}`}>Reply to {isTeamChallengeMessage ? (getTeamChallengeDisplayName(message, 'proposer') || getTeamChallengeDisplayName(message, 'challenged') || 'Team Challenge') : (isIndividualChallengeMessage ? 'Individual Challenge' : (latestMessage.senderName || latestMessage.senderEmail))}</label>
        <textarea
          id={`reply-${messageThreadId(message)}`}
          className="input"
          rows={4}
          required
          maxLength={2000}
          value={replyBody}
          onChange={(event) => setReplyBody(event.target.value)}
          placeholder={isTeamChallengeMessage ? 'Write your Team Challenge reply' : (isIndividualChallengeMessage ? 'Write your Individual Challenge reply' : 'Write your reply')}
        />
        <div className="small">{replyBody.length}/2000 characters</div>
        <div className="pageHeroActions inboxMessageActions">
          <button className="btn btnPrimary btnSmall" type="submit" disabled={replySending || !replyBody.trim()}>{replySending ? 'Sending reply…' : 'Send Reply'}</button>
          <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(null); setReplyBody('') }}>Cancel</button>
        </div>
      </form>
    )
  }

  function renderTeamChallengeScores(message: InboxMessage) {
    if (message.messageType !== 'challenge_request') return null
    const userSide = getTeamChallengeUserSide(message)
    const completed = isChallengeCompleted(message)
    const scoreRows: Array<{ side: 'proposer' | 'challenged'; label: string; score?: number | null }> = (userSide ? [userSide] : (['proposer', 'challenged'] as const)).map((side) => ({
      side,
      label: getTeamChallengeDisplayName(message, side),
      score: side === 'proposer' ? message.proposerTeamScore : message.challengedTeamScore,
    }))

    return (
      <div className="inboxTeamChallengeScores">
        <div className="inboxScoreSectionHeader">
          <div>
            <div className="small inboxConversationTitle">Team Challenge Scores</div>
            <div className="small">{getTeamChallengeScoringLabel(message)}</div>
          </div>
          <button type="button" className="btn btnSmall inboxLeaderboardButton" disabled={refreshingLeaderboard} aria-busy={refreshingLeaderboard} onClick={() => openTeamChallengeLeaderboard(message)}>{refreshingLeaderboard ? 'Loading leaderboard…' : 'Leaderboard'}</button>
        </div>
        <div className="inboxTeamChallengeScoreGrid">
          {scoreRows.map((row) => {
            const editable = userSide === row.side && !completed
            const score = getTeamChallengeScore(message, row.side)
            return (
              <div key={row.side} className={`inboxTeamChallengeScoreCard ${editable ? 'inboxTeamChallengeScoreCard--editable' : 'inboxTeamChallengeScoreCard--readonly'}`}>
                <label className="label">{row.label} Score</label>
                <button
                  type="button"
                  className={`teamScorecardOpenButton teamScorecardInputButton ${editable ? '' : 'teamScorecardInputButton--readonly'}`}
                  onClick={() => openTeamChallengeScorecard(message, row.side)}
                >
                  <span className="teamScorecardInputBadge">{editable ? 'Tap to enter score' : 'Completed · locked'}</span>
                  <strong>{score == null ? 'Pending' : score}</strong>
                  <span>{getTeamChallengeScorecardSummary(message, row.side)}</span>
                  <span>{editable ? 'Only members of this team can edit this score.' : 'This challenge is complete, so scores are locked.'}</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderIndividualChallengeScores(message: InboxMessage) {
    if (message.messageType !== 'individual_challenge') return null
    const completed = isChallengeCompleted(message)
    const editableParticipants = getIndividualChallengeParticipants(message).filter((participant) => currentUserCanEditIndividualParticipant(participant) && !completed)
    return (
      <div className="inboxTeamChallengeScores inboxIndividualChallengeScores">
        <div className="inboxScoreSectionHeader">
          <div className="small inboxConversationTitle">Individual Challenge Score</div>
          <button type="button" className="btn btnSmall inboxLeaderboardButton" disabled={refreshingLeaderboard} aria-busy={refreshingLeaderboard} onClick={() => openIndividualChallengeLeaderboard(message)}>{refreshingLeaderboard ? 'Loading leaderboard…' : 'Leaderboard'}</button>
        </div>
        {editableParticipants.length ? (
          <div className="inboxTeamChallengeScoreGrid inboxIndividualChallengeScoreGrid">
            {editableParticipants.map((participant) => {
              const score = getIndividualChallengeScore(message, participant, false)
              return (
                <div key={participantEmail(participant)} className="inboxTeamChallengeScoreCard inboxTeamChallengeScoreCard--editable">
                  <label className="label">{participantDisplayName(participant)} Score</label>
                  <button type="button" className="teamScorecardOpenButton teamScorecardInputButton" onClick={() => openIndividualChallengeScorecard(message, participant)}>
                    <span className="teamScorecardInputBadge">Tap to enter score</span>
                    <strong>{score == null ? 'Pending' : score}</strong>
                    <span>{getIndividualChallengeScorecardSummary(message, participant)}</span>
                    <span>Only you can edit your Individual Challenge score.</span>
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="small inboxIndividualLeaderboardHint">Open the leaderboard to review each golfer's hole-by-hole round summary.</div>
        )}
      </div>
    )
  }

  function formatRoundReviewHoleDistance(hole: HoleScoreDetail) {
    const distance = Number(hole.yards ?? hole.distanceToCenterYards ?? hole.distanceToFlagYards ?? hole.distanceToBackYards ?? hole.distanceToFrontYards)
    return Number.isFinite(distance) && distance > 0 ? `${Math.trunc(distance)} yds` : '—'
  }

  function renderReadonlyRoundHoleLineItems(holes: HoleScoreDetail[], label: string, extraClassName = '') {
    if (!holes.length) return <div className="small">No hole-by-hole score has been entered yet.</div>
    return (
      <div className={`roundHoleLineItemTable inboxReadonlySoloScoreGrid ${extraClassName}`} role="table" aria-label={label}>
        <div className="roundHoleLineItemHeader" role="row">
          <span>Hole</span>
          <span>Par</span>
          <span>Score</span>
          <span>Distance</span>
        </div>
        {holes.map((hole) => {
          const scoreProvided = Boolean(hole.scoreProvided)
          const outcomeClass = scoreProvided ? scoreOutcomeClassName({ par: hole.par, score: hole.score }) : 'roundHoleDetailPill--unknown'
          const outcome = scoreProvided ? formatHoleScoreOutcome({ par: hole.par, score: hole.score }) : 'No score'
          return (
            <div key={hole.hole} className="roundHoleLineItemRow" role="row">
              <strong>{hole.hole}</strong>
              <span>{hole.par == null ? '—' : hole.par}</span>
              <span className={`roundHoleLineItemScore ${outcomeClass}`}>
                <strong>{formatHoleReviewScore(hole)}</strong>
                <small>{outcome}</small>
              </span>
              <span>{formatRoundReviewHoleDistance(hole)}</span>
            </div>
          )
        })}
      </div>
    )
  }

  function renderReadonlyTeamChallengeHoles(holes: HoleScoreDetail[]) {
    return renderReadonlyRoundHoleLineItems(holes, 'Read-only Team Challenge hole scores', 'inboxReadonlyTeamScoreGrid')
  }

  function renderReadonlyIndividualChallengeHoles(holes: HoleScoreDetail[]) {
    return renderReadonlyRoundHoleLineItems(holes, 'Read-only Individual Challenge hole scores')
  }

  function renderTeamChallengeSummaryView(message: InboxMessage) {
    const proposerTeamName = getTeamChallengeTeamName(message, 'proposer')
    const challengedTeamName = getTeamChallengeTeamName(message, 'challenged')
    const proposerHoles = getTeamChallengeHoles(message, 'proposer', false)
    const challengedHoles = getTeamChallengeHoles(message, 'challenged', false)
    const proposerByHole = getHoleByNumber(proposerHoles)
    const challengedByHole = getHoleByNumber(challengedHoles)
    const proposerScore = getTeamChallengeScore(message, 'proposer', false)
    const challengedScore = getTeamChallengeScore(message, 'challenged', false)
    const pointSummary = getTeamChallengePointSummary(message)
    const resultsByHole = new Map(pointSummary.holeResults.map((result) => [result.hole, result]))
    const holeNumbers = Array.from(new Set([
      ...pointSummary.holeResults.map((result) => result.hole),
      ...proposerHoles.map((hole) => hole.hole),
      ...challengedHoles.map((hole) => hole.hole),
    ]))
      .filter((holeNumber) => Number.isFinite(Number(holeNumber)) && Number(holeNumber) >= 1 && Number(holeNumber) <= 18)
      .map((holeNumber) => Math.trunc(Number(holeNumber)))
      .sort((left, right) => left - right)

    if (!holeNumbers.length) return null

    let runningProposerPoints = 0
    let runningChallengedPoints = 0
    let pushedPointsTotal = 0
    const rows = holeNumbers.map((holeNumber) => {
      const proposerHole = proposerByHole.get(holeNumber)
      const challengedHole = challengedByHole.get(holeNumber)
      const result = resultsByHole.get(holeNumber) || { hole: holeNumber, winner: 'pending' as const, proposerScore: null, challengedScore: null, pointsAwarded: 0, carryoverAfterHole: 0, strokeDifferential: 0, strokeDifferentialBonus: 0 }
      if (result.winner === 'proposer') runningProposerPoints += result.pointsAwarded
      if (result.winner === 'challenged') runningChallengedPoints += result.pointsAwarded
      const pushedPoints = getTeamChallengePushPointsForSummary(result, pointSummary)
      pushedPointsTotal += pushedPoints
      return {
        holeNumber,
        par: Number(proposerHole?.par || challengedHole?.par) || null,
        proposerHole,
        challengedHole,
        result,
        pushedPoints,
        pointLeadLabel: formatTeamChallengePointLeadLabel(message, runningProposerPoints, runningChallengedPoints),
      }
    })
    const finalLeadLabel = formatTeamChallengePointLeadLabel(message, pointSummary.proposerPoints, pointSummary.challengedPoints)

    return (
      <div className="inboxTeamChallengeSummaryView" aria-label="Team Challenge scoring summary">
        <div className="inboxTeamChallengeSummaryScorebar" aria-label="Team Challenge total scores">
          <div className={`inboxTeamChallengeSummaryTeamTotal ${getTeamChallengeTotalScoreClass(proposerScore, challengedScore, 'proposer')}`}>
            <strong>{proposerTeamName}</strong>
            <span>{proposerScore == null ? 'Pending' : proposerScore}</span>
            <small>Total score</small>
          </div>
          <div className="inboxTeamChallengeSummaryVs" aria-hidden="true">VS</div>
          <div className={`inboxTeamChallengeSummaryTeamTotal ${getTeamChallengeTotalScoreClass(proposerScore, challengedScore, 'challenged')}`}>
            <strong>{challengedTeamName}</strong>
            <span>{challengedScore == null ? 'Pending' : challengedScore}</span>
            <small>Total score</small>
          </div>
        </div>

        <div className="inboxTeamChallengeSummaryTable" role="table" aria-label="Hole-by-hole Team Challenge summary">
          <div className="inboxTeamChallengeSummaryHeader" role="row">
            <span>Hole</span>
            <span>Par</span>
            <span title={proposerTeamName}>{proposerTeamName}</span>
            <span title={challengedTeamName}>{challengedTeamName}</span>
            <span>Winner</span>
            <span>Push</span>
            <span>Points</span>
          </div>
          {rows.map((row) => (
            <div key={row.holeNumber} className="inboxTeamChallengeSummaryRow" role="row">
              <strong>{row.holeNumber}</strong>
              <span>{row.par == null ? '—' : row.par}</span>
              <span className={`inboxTeamChallengeSummaryScore ${getTeamChallengeSummaryScoreClass(row.result.winner, 'proposer')}`}>{formatHoleReviewScore(row.proposerHole)}</span>
              <span className={`inboxTeamChallengeSummaryScore ${getTeamChallengeSummaryScoreClass(row.result.winner, 'challenged')}`}>{formatHoleReviewScore(row.challengedHole)}</span>
              <span className={`inboxTeamChallengeSummaryWinner inboxTeamChallengeSummaryWinner--${row.result.winner}`}>{getTeamChallengeSummaryWinnerLabel(message, row.result.winner)}</span>
              <span>{row.pushedPoints > 0 ? formatPointNumber(row.pushedPoints) : '—'}</span>
              <strong className="inboxTeamChallengeSummaryPoints">{row.pointLeadLabel}</strong>
            </div>
          ))}
          <div className="inboxTeamChallengeSummaryRow inboxTeamChallengeSummaryRow--total" role="row">
            <strong>Total</strong>
            <span>{rows.reduce((sum, row) => sum + (row.par || 0), 0)}</span>
            <span className={getTeamChallengeTotalScoreClass(proposerScore, challengedScore, 'proposer')}>{proposerScore == null ? '—' : proposerScore}</span>
            <span className={getTeamChallengeTotalScoreClass(proposerScore, challengedScore, 'challenged')}>{challengedScore == null ? '—' : challengedScore}</span>
            <span>—</span>
            <span>{pushedPointsTotal > 0 ? formatPointNumber(pushedPointsTotal) : '—'}</span>
            <strong className="inboxTeamChallengeSummaryPoints">{finalLeadLabel}</strong>
          </div>
        </div>
        <div className="inboxTeamChallengeSummaryLegend" aria-label="Score color legend">
          <span><i className="inboxTeamChallengeSummaryLegendDot inboxTeamChallengeSummaryLegendDot--win" /> Win</span>
          <span><i className="inboxTeamChallengeSummaryLegendDot inboxTeamChallengeSummaryLegendDot--loss" /> Loss</span>
          <span><i className="inboxTeamChallengeSummaryLegendDot" /> Push / tie</span>
        </div>
      </div>
    )
  }

  function renderTeamChallengeScorecardModal() {
    if (!activeTeamChallengeScorecard) return null
    const { message, side } = activeTeamChallengeScorecard
    const key = getTeamChallengeScoreKey(message, side)
    const teamName = getTeamChallengeTeamName(message, side)
    const holes = getTeamChallengeHoles(message, side)
    const completed = isChallengeCompleted(message)
    const editable = getTeamChallengeUserSide(message) === side && !completed
    const score = getTeamChallengeScore(message, side)

    return (
      <div className="modalOverlay teamScorecardModalOverlay" role="presentation" onClick={() => void closeTeamChallengeScorecard(message, side, editable)}>
        <div className="modalCard teamScorecardModalCard" role="dialog" aria-modal="true" aria-label={`${teamName} Team Challenge scorecard`} onClick={(event) => event.stopPropagation()}>
          {editable ? (
            <>
              <HoleByHoleScorecard
                enabled={true}
                stateCode={getTeamChallengeStateCode(message)}
                course={getTeamChallengeCourseName(message)}
                holes={holes}
                onChange={(nextHoles) => updateTeamChallengeScorecard(message, side, nextHoles)}
                onHoleSaved={(nextHoles, _savedHole, action) => persistTeamChallengeScoreProgress(message, side, { closeModal: false, source: action === 'reset' ? 'hole_reset' : 'hole_save', overrideHoles: nextHoles })}
                scoreOwnerLabel={`${teamName} score`}
                loadScorecardOnMount={!holes.some((hole) => hasSavedHoleScoreValue(hole))}
                teeColor={getTeamChallengeTeeColor(message)}
                registerPendingHoleSave={(handler) => { teamChallengePendingHoleSaveRef.current = handler }}
                initialHoleNumber={scorecardResumeHoles[key] || null}
                onActiveHoleChange={(holeNumber) => rememberScorecardResumeHole(key, holeNumber)}
              />
              <div className="small holeInputModalHint">Enter each hole score, then save the Team Challenge score.</div>
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button
                  type="button"
                  className="btnPrimary btnSmall"
                  disabled={updatingChallengeScoreKey === key}
                  onClick={() => void handleTeamChallengeScoreSave(message, side)}
                >
                  {updatingChallengeScoreKey === key ? 'Saving score…' : 'Save Team Challenge Score'}
                </button>
                <button type="button" className="btn btnSmall" onClick={() => void closeTeamChallengeScorecard(message, side, editable)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  disabled={refreshingLeaderboard}
                  aria-busy={refreshingLeaderboard}
                  onClick={() => { void openTeamChallengeLeaderboardFromScorecard(message, side, editable) }}
                >
                  {refreshingLeaderboard ? 'Loading leaderboard…' : 'Leaderboard'}
                </button>
              </div>
            </>
          ) : (
            <div className="card holeInputPanel inboxTeamChallengeReadonlyPanel">
              <div className="holeInputTeamLabel">{teamName} score</div>
              {!completed ? <div className="small holeInputModalHint">Opponent team score is read-only.</div> : null}
              <div className="holeInputPageTotals" aria-label="Team Challenge totals">
                <div>
                  <span>Total score</span>
                  <strong>{score == null ? 'Pending' : score}</strong>
                </div>
                <div>
                  <span>Hole scores entered</span>
                  <strong>{holes.length - missingHoleScoreNumbers(holes).length} of {holes.length || 18}</strong>
                </div>
              </div>
              {renderReadonlyTeamChallengeHoles(holes)}
              {renderTeamChallengeSummaryView(message)}
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button type="button" className="btn btnSmall" onClick={() => void closeTeamChallengeScorecard(message, side, editable)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  disabled={refreshingLeaderboard}
                  aria-busy={refreshingLeaderboard}
                  onClick={() => { void openTeamChallengeLeaderboardFromScorecard(message, side, editable) }}
                >
                  {refreshingLeaderboard ? 'Loading leaderboard…' : 'Leaderboard'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderIndividualChallengeScorecardModal() {
    if (!activeIndividualChallengeScorecard) return null
    const { message, participant } = activeIndividualChallengeScorecard
    const golferName = participantDisplayName(participant)
    const holes = getIndividualChallengeHoles(message, participant)
    const completed = isChallengeCompleted(message)
    const editable = currentUserCanEditIndividualParticipant(participant) && !completed
    const score = getIndividualChallengeScore(message, participant)

    return (
      <div className="modalOverlay teamScorecardModalOverlay" role="presentation" onClick={() => setActiveIndividualChallengeScorecard(null)}>
        <div className="modalCard teamScorecardModalCard" role="dialog" aria-modal="true" aria-label={`${golferName} Individual Challenge scorecard`} onClick={(event) => event.stopPropagation()}>
          {editable ? (
            <>
              <HoleByHoleScorecard
                enabled={true}
                stateCode={getTeamChallengeStateCode(message)}
                course={getTeamChallengeCourseName(message)}
                holes={holes}
                onChange={(nextHoles) => updateIndividualChallengeScorecard(message, participant, nextHoles)}
                onHoleSaved={(nextHoles, _savedHole, action) => persistIndividualChallengeScoreProgress(message, participant, nextHoles, { closeModal: false, source: action === 'reset' ? 'hole_reset' : 'hole_save' })}
                scoreOwnerLabel={`${golferName} score`}
                loadScorecardOnMount={!holes.some((hole) => hasSavedHoleScoreValue(hole))}
                teeColor={getTeamChallengeTeeColor(message)}
                registerPendingHoleSave={(handler) => { individualChallengePendingHoleSaveRef.current = handler }}
                initialHoleNumber={scorecardResumeHoles[getIndividualChallengeScoreKey(message, participant)] || null}
                onActiveHoleChange={(holeNumber) => rememberScorecardResumeHole(getIndividualChallengeScoreKey(message, participant), holeNumber)}
              />
              <div className="small holeInputModalHint">Enter each hole score; each completed hole saves automatically.</div>
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button type="button" className="btn btnSmall" onClick={() => setActiveIndividualChallengeScorecard(null)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  disabled={refreshingLeaderboard}
                  aria-busy={refreshingLeaderboard}
                  onClick={() => { void openIndividualChallengeLeaderboardFromScorecard(message, participant, editable) }}
                >
                  {refreshingLeaderboard ? 'Loading leaderboard…' : 'Leaderboard'}
                </button>
              </div>
            </>
          ) : (
            <div className="card holeInputPanel inboxTeamChallengeReadonlyPanel inboxIndividualReadonlyScorecardPanel">
              <div className="holeInputTeamLabel">{golferName} score</div>
              <div className="holeInputPageTotals" aria-label="Individual Challenge totals">
                <div>
                  <span>Total score</span>
                  <strong>{score == null ? 'Pending' : score}</strong>
                </div>
                <div>
                  <span>Hole scores entered</span>
                  <strong>{holes.length - missingHoleScoreNumbers(holes).length} of {holes.length || 18}</strong>
                </div>
              </div>
              {renderReadonlyIndividualChallengeHoles(holes)}
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button type="button" className="btn btnSmall" onClick={() => setActiveIndividualChallengeScorecard(null)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  disabled={refreshingLeaderboard}
                  aria-busy={refreshingLeaderboard}
                  onClick={() => { void openIndividualChallengeLeaderboardFromScorecard(message, participant, editable) }}
                >
                  {refreshingLeaderboard ? 'Loading leaderboard…' : 'Leaderboard'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }


  function renderTeamChallengeLeaderboardModal() {
    if (!activeTeamChallengeLeaderboard) return null
    const message = activeTeamChallengeLeaderboard
    const rows = getTeamChallengeLeaderboardRows(message)
    const completedCount = rows.filter((row) => row.score != null).length
    const pointSummary = getTeamChallengePointSummary(message)
    const showPointsColumn = isSkinsTeamChallenge(pointSummary.scoringType)
    const selectedSide = activeTeamLeaderboardSide
    const selectedTeamName = selectedSide ? getTeamChallengeDisplayName(message, selectedSide) : ''
    const selectedSummaryRows = selectedSide ? getTeamRoundSummaryRows(message, selectedSide) : []

    return (
      <div className="modalOverlay inboxLeaderboardModalOverlay" role="presentation" onClick={() => returnFromTeamChallengeLeaderboard('overlay')}>
        <div className="modalCard inboxLeaderboardModal" role="dialog" aria-modal="true" aria-label={selectedSide ? `${selectedTeamName} round summary` : 'Team Challenge Leaderboard'} onClick={(event) => event.stopPropagation()}>
          <div className="inboxLeaderboardHero">
            <div className="inboxLeaderboardHeroTopline">
              <button
                type="button"
                className="inboxLeaderboardIconButton"
                aria-label={selectedSide ? 'Back to leaderboard' : (teamChallengeLeaderboardReturnTarget ? `Back to Hole ${scorecardResumeHoles[getTeamChallengeScoreKey(message, teamChallengeLeaderboardReturnTarget.side)] || 1}` : 'Close leaderboard')}
                onClick={() => {
                  if (selectedSide) returnFromTeamRoundSummary(message)
                  else returnFromTeamChallengeLeaderboard('back')
                }}
              >‹</button>
              <div className="inboxLeaderboardCrest" aria-hidden="true">⛳</div>
              <div className="inboxLeaderboardTopRightActions">
                {!selectedSide ? (
                  <button
                    type="button"
                    className="inboxLeaderboardIconButton inboxLeaderboardRefreshButton"
                    aria-label="Refresh Team Challenge leaderboard"
                    disabled={refreshingLeaderboard}
                    onClick={() => void refreshTeamChallengeLeaderboard()}
                  >
                    {refreshingLeaderboard ? '…' : '↻'}
                  </button>
                ) : null}
                <button type="button" className="inboxLeaderboardIconButton" aria-label={teamChallengeLeaderboardReturnTarget ? `Return to Hole ${scorecardResumeHoles[getTeamChallengeScoreKey(message, teamChallengeLeaderboardReturnTarget.side)] || 1}` : 'Close leaderboard'} onClick={() => returnFromTeamChallengeLeaderboard('close')}>×</button>
              </div>
            </div>
            <div className="inboxLeaderboardYear">Golf Homiez</div>
            <h2>{selectedSide ? 'Team Round Summary' : 'Team Challenge Leaderboard'}</h2>
            <div className="inboxLeaderboardDivider" />
            <strong>{selectedSide ? selectedTeamName : (message.challengeCourse || 'Team Challenge')}</strong>
            {selectedSide ? <span className="inboxIndividualRoundSummaryCourse">{message.challengeCourse || 'Course not provided'}</span> : null}
            <span>{[message.challengeDate, message.challengeState, `${teeColorLabel(getTeamChallengeTeeColor(message))} tees`].filter(Boolean).join(' • ')}</span>
            {!selectedSide ? <span>{getTeamChallengeScoringLabel(message)}</span> : null}
          </div>

          {selectedSide ? (
            <div className="inboxLeaderboardBoard inboxIndividualRoundSummaryBoard">
              <div className="inboxIndividualRoundSummaryActions">
                <strong className="inboxRoundSummarySelectedName">{selectedTeamName}</strong>
                <button type="button" className="btn btnSmall" onClick={() => returnFromTeamRoundSummary(message)}>Back to leaderboard</button>
              </div>
              <div className="inboxIndividualRoundSummaryTable" role="table" aria-label={`${selectedTeamName} hole-by-hole round summary`}>
                <div className="inboxIndividualRoundSummaryHeader" role="row">
                  <span>Hole</span><span>Par</span><span>Score</span><span>Round</span><span>Total</span>
                </div>
                {selectedSummaryRows.map((row) => (
                  <div className="inboxIndividualRoundSummaryRow" role="row" key={row.hole}>
                    <strong>{row.hole}</strong>
                    <span>{row.par ?? '—'}</span>
                    <span>{row.score ?? '—'}</span>
                    <strong>{row.relativeLabel}</strong>
                    <strong>{row.totalLabel}</strong>
                  </div>
                ))}
              </div>
              <div className="inboxIndividualRoundSummaryLegend">Round is the current cumulative score over or under par. Total is the current cumulative stroke score.</div>
            </div>
          ) : (
            <>
              <div className="inboxLeaderboardBoard">
                <div className={`inboxLeaderboardHeaderRow inboxLeaderboardHeaderRow--team ${showPointsColumn ? '' : 'inboxLeaderboardHeaderRow--teamNoPoints'}`}>
                  <span>POS</span>
                  <span>TEAM</span>
                  <span>ROUND</span>
                  {showPointsColumn ? <span>PTS</span> : null}
                  <span>THRU</span>
                  <span>TOTAL</span>
                </div>
                {rows.map((row) => {
                  const initials = row.teamName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GH'
                  const positionClass = row.position <= 3 ? `inboxLeaderboardRow--top${row.position}` : ''
                  return (
                    <button type="button" key={row.side} className={`inboxLeaderboardRow inboxLeaderboardRow--team inboxLeaderboardRow--clickable ${showPointsColumn ? '' : 'inboxLeaderboardRow--teamNoPoints'} ${positionClass}`} onClick={() => openTeamLeaderboardRoundSummary(message, row.side)} aria-label={`View ${row.teamName} round summary`}>
                      <div className="inboxLeaderboardPosition"><span>{row.position}</span></div>
                      <div className="inboxLeaderboardPlayer">
                        <div className="inboxLeaderboardAvatar" aria-hidden="true">{initials}</div>
                        <div>
                          <strong>{row.teamName}</strong>
                          <span>{row.side === 'proposer' ? 'Proposing team' : 'Challenged team'}</span>
                        </div>
                      </div>
                      <span>{row.roundLabel}</span>
                      {showPointsColumn ? (
                        <div className="inboxLeaderboardPoints">
                          <strong>{row.pointsLabel}</strong>
                          <span>{row.pointsRelativeLabel}</span>
                        </div>
                      ) : null}
                      <span>{row.thru || '—'}</span>
                      <strong className="inboxLeaderboardScore">{row.totalLabel}</strong>
                    </button>
                  )
                })}
                <div className="inboxLeaderboardUpdated">{completedCount} of {rows.length} team scores entered live{isSkinsTeamChallenge(pointSummary.scoringType) && pointSummary.carryoverPoints ? ` • ${formatPointNumber(pointSummary.carryoverPoints)} carryover points pending` : ''} • Select a team for the hole-by-hole round summary</div>
              </div>

              {renderTeamChallengeSummaryView(message)}
            </>
          )}
        </div>
      </div>
    )
  }

  function renderIndividualChallengeLeaderboardModal() {
    if (!activeIndividualChallengeLeaderboard) return null
    const message = activeIndividualChallengeLeaderboard
    const rows = getIndividualChallengeLeaderboardRows(message)
    const completedCount = rows.filter((row) => row.score != null).length
    const selectedParticipant = activeIndividualLeaderboardParticipant
    const selectedName = selectedParticipant ? participantDisplayName(selectedParticipant) : ''
    const summaryRows = selectedParticipant ? getIndividualRoundSummaryRows(message, selectedParticipant) : []
    const canEditSelected = selectedParticipant ? currentUserCanEditIndividualParticipant(selectedParticipant) && !isChallengeCompleted(message) : false

    return (
      <div className="modalOverlay inboxLeaderboardModalOverlay" role="presentation" onClick={() => returnFromIndividualChallengeLeaderboard('overlay')}>
        <div className="modalCard inboxLeaderboardModal" role="dialog" aria-modal="true" aria-label={selectedParticipant ? `${selectedName} round summary` : 'Individual Challenge Leaderboard'} onClick={(event) => event.stopPropagation()}>
          <div className="inboxLeaderboardHero">
            <div className="inboxLeaderboardHeroTopline">
              <button
                type="button"
                className="inboxLeaderboardIconButton"
                aria-label={selectedParticipant ? 'Back to leaderboard' : (individualChallengeLeaderboardReturnTarget ? `Back to Hole ${scorecardResumeHoles[getIndividualChallengeScoreKey(message, individualChallengeLeaderboardReturnTarget.participant)] || 1}` : 'Close leaderboard')}
                onClick={() => {
                  if (selectedParticipant) {
                    setActiveIndividualLeaderboardParticipant(null)
                    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_round_summary_back_to_leaderboard', data: { messageId: message.id, threadId: messageThreadId(message) } })
                  } else returnFromIndividualChallengeLeaderboard('back')
                }}
              >‹</button>
              <div className="inboxLeaderboardCrest" aria-hidden="true">⛳</div>
              <div className="inboxLeaderboardTopRightActions">
                {!selectedParticipant ? (
                  <button type="button" className="inboxLeaderboardIconButton inboxLeaderboardRefreshButton" aria-label="Refresh leaderboard" disabled={refreshingLeaderboard} onClick={() => void refreshIndividualChallengeLeaderboard()}>
                    {refreshingLeaderboard ? '…' : '↻'}
                  </button>
                ) : null}
                <button type="button" className="inboxLeaderboardIconButton" aria-label={individualChallengeLeaderboardReturnTarget ? `Return to Hole ${scorecardResumeHoles[getIndividualChallengeScoreKey(message, individualChallengeLeaderboardReturnTarget.participant)] || 1}` : 'Close leaderboard'} onClick={() => returnFromIndividualChallengeLeaderboard('close')}>×</button>
              </div>
            </div>
            <div className="inboxLeaderboardYear">Golf Homiez</div>
            <h2>{selectedParticipant ? 'Round Summary' : 'Individual Challenge Leaderboard'}</h2>
            <div className="inboxLeaderboardDivider" />
            <strong>{selectedParticipant ? selectedName : (message.challengeCourse || 'Individual Challenge')}</strong>
            {selectedParticipant ? <span className="inboxIndividualRoundSummaryCourse">{message.challengeCourse || 'Course not provided'}</span> : null}
            <span>{[message.challengeDate, message.challengeState, `${teeColorLabel(getTeamChallengeTeeColor(message))} tees`].filter(Boolean).join(' • ')}</span>
          </div>

          {selectedParticipant ? (
            <div className="inboxLeaderboardBoard inboxIndividualRoundSummaryBoard">
              <div className="inboxIndividualRoundSummaryActions">
                <strong className="inboxRoundSummarySelectedName">{selectedName}</strong>
                <button type="button" className="btn btnSmall" onClick={() => setActiveIndividualLeaderboardParticipant(null)}>Back to leaderboard</button>
                {canEditSelected ? (
                  <button type="button" className="btn btnPrimary btnSmall" onClick={() => {
                    setActiveIndividualLeaderboardParticipant(null)
                    setActiveIndividualChallengeLeaderboard(null)
                    openIndividualChallengeScorecard(message, selectedParticipant)
                    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_round_summary_edit_score_opened', data: { messageId: message.id, threadId: messageThreadId(message), participantEmail: participantEmail(selectedParticipant) } })
                  }}>Edit my score</button>
                ) : null}
              </div>
              <div className="inboxIndividualRoundSummaryTable" role="table" aria-label={`${selectedName} hole-by-hole round summary`}>
                <div className="inboxIndividualRoundSummaryHeader" role="row">
                  <span>Hole</span><span>Par</span><span>Score</span><span>Round</span><span>Total</span>
                </div>
                {summaryRows.map((row) => (
                  <div className="inboxIndividualRoundSummaryRow" role="row" key={row.hole}>
                    <strong>{row.hole}</strong>
                    <span>{row.par ?? '—'}</span>
                    <span>{row.score ?? '—'}</span>
                    <strong>{row.relativeLabel}</strong>
                    <strong>{row.totalLabel}</strong>
                  </div>
                ))}
              </div>
              <div className="inboxIndividualRoundSummaryLegend">Round is the current cumulative score over or under par. Total is the current cumulative stroke score.</div>
            </div>
          ) : (
            <div className="inboxLeaderboardBoard">
              <div className="inboxLeaderboardHeaderRow">
                <span>POS</span><span>PLAYER</span><span>ROUND</span><span>THRU</span><span>TOTAL</span>
              </div>
              {rows.map((row) => {
                const name = participantDisplayName(row.participant)
                const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GH'
                const positionClass = row.position <= 3 ? `inboxLeaderboardRow--top${row.position}` : ''
                return (
                  <button type="button" key={participantEmail(row.participant)} className={`inboxLeaderboardRow inboxLeaderboardRow--clickable ${positionClass}`} onClick={() => openIndividualLeaderboardRoundSummary(message, row.participant)} aria-label={`View ${name} round summary`}>
                    <div className="inboxLeaderboardPosition"><span>{row.position}</span></div>
                    <div className="inboxLeaderboardPlayer"><div className="inboxLeaderboardAvatar" aria-hidden="true">{initials}</div><div><strong>{name}</strong><span>{participantEmail(row.participant)}</span></div></div>
                    <span>{row.roundLabel}</span><span>{row.thru || '—'}</span><strong className="inboxLeaderboardScore">{row.totalLabel}</strong>
                  </button>
                )
              })}
              <div className="inboxLeaderboardUpdated">{completedCount} of {rows.length} scores entered live • Select a golfer for the hole-by-hole round summary</div>
            </div>
          )}
        </div>
      </div>
    )
  }


  function renderThreadCard(thread: InboxThread, source: 'messages' | 'team-challenges') {
    const message = thread.displayMessage
    const challengeMessage = source === 'team-challenges' ? getInitialChallengeMessage(thread) : message
    const isExpanded = expandedThreadId === thread.threadId
    const isTeamChallengeMessage = challengeMessage.messageType === 'challenge_request'
    const isIndividualChallengeMessage = challengeMessage.messageType === 'individual_challenge'
    const challengeCompleted = source === 'team-challenges' && isChallengeCompleted(challengeMessage)
    const challengeStatusLabel = challengeMessage.challengeDeletedAt ? 'Deleted' : (challengeCompleted ? 'Completed' : 'Active')
    const challengeStatusClass = challengeStatusLabel.toLowerCase()
    const canCompleteChallenge = source === 'team-challenges' && isExpanded && !challengeCompleted && currentUserCreatedInitialChallenge(thread)
    const latestMessage = getLatestConversationMessage(message)
    const unreadText = thread.unreadCount === 1 ? '1 new' : `${thread.unreadCount} new`
    const challengeTitle = isTeamChallengeMessage
      ? `${getTeamChallengeDisplayName(challengeMessage, 'proposer')} vs ${getTeamChallengeDisplayName(challengeMessage, 'challenged')}`
      : `${getIndividualChallengeParticipants(challengeMessage).length} golfer Individual Challenge`
    const challengeMetadata = [challengeMessage.challengeDate, challengeMessage.challengeState, challengeMessage.challengeCourse].filter(Boolean).join(' • ')

    return (
      <article key={thread.threadId} className={`inboxChallengeLineItem ${thread.unreadCount > 0 ? 'inboxChallengeLineItem--unread' : 'inboxChallengeLineItem--read'} ${isExpanded ? 'inboxChallengeLineItem--expanded' : ''}`}>
        <button
          type="button"
          className="inboxChallengeLineItemButton"
          aria-expanded={isExpanded}
          aria-controls={`challenge-details-${thread.threadId}`}
          onClick={() => toggleThreadExpansion(thread, source)}
        >
          <span className="inboxChallengeLineItemType">{messageTypeLabel(challengeMessage.messageType)}</span>
          <span className="inboxChallengeLineItemMain">
            <strong>{challengeTitle}</strong>
            <span>{challengeMetadata || getMessagePreview(latestMessage.body)}</span>
          </span>
          {thread.unreadCount > 0 ? <span className="inboxChallengeLineItemActivity"><strong>{unreadText}</strong></span> : null}
          <span className={`inboxChallengeLineItemStatus inboxChallengeLineItemStatus--${challengeStatusClass}`}>{challengeStatusLabel}</span>
          <span className="inboxChallengeLineItemChevron" aria-hidden="true">{isExpanded ? '⌃' : '›'}</span>
        </button>

        {isExpanded ? (
          <div id={`challenge-details-${thread.threadId}`} className="inboxChallengeLineItemDetails">
            <p className="inboxMessageBody">{latestMessage.body}</p>
            {source === 'team-challenges' && isTeamChallengeMessage ? renderTeamChallengeScores(challengeMessage) : null}
            {source === 'team-challenges' && isIndividualChallengeMessage ? renderIndividualChallengeScores(challengeMessage) : null}
            {renderConversation(challengeMessage)}
            <div className="pageHeroActions inboxMessageActions">
              {!challengeCompleted ? <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(getLatestConversationMessage(challengeMessage)); setReplyBody('') }}>Reply</button> : null}
              {canCompleteChallenge ? (
                <button type="button" className="btn btnPrimary btnSmall" disabled={completingChallengeThreadId === messageThreadId(challengeMessage)} onClick={() => void handleCompleteChallenge(thread)}>
                  {completingChallengeThreadId === messageThreadId(challengeMessage) ? 'Completing…' : 'Complete Challenge'}
                </button>
              ) : null}
              {source === 'team-challenges' ? (
                <button type="button" className="btn btnSmall" disabled={updatingChallengeDeleteThreadId === messageThreadId(challengeMessage)} onClick={() => void handleChallengeDeletedState(thread, challengeView !== 'deleted')}>
                  {updatingChallengeDeleteThreadId === messageThreadId(challengeMessage) ? 'Updating…' : (challengeView === 'deleted' ? 'Restore Challenge' : 'Delete Challenge')}
                </button>
              ) : null}
              <button type="button" className="btn btnSmall" onClick={() => toggleThreadExpansion(thread, source)}>Close details</button>
            </div>
            {renderReplyForm(challengeMessage)}
          </div>
        ) : null}
      </article>
    )
  }


  return (
    <div className="container pageStack inboxPage">
      <section className="card inboxListCard inboxChallengeListCard">
        <div className="inboxSectionHeader inboxSectionHeader--withActions">
          <div>
            <h2 className="inboxSectionTitle">Challenges</h2>
            <div className="small">Team and Individual Challenges involving you.</div>
          </div>
          <div className="inboxSectionActions">
            <Link className="btn btnLightGreen btnSmall" to="/directions">Directions</Link>
            <div className="inboxChallengeViewButtons" role="group" aria-label="Challenge views">
              {(['active', 'completed', 'deleted'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={`btn btnSmall inboxChallengeViewButton ${challengeView === view ? 'btnPrimary' : ''}`}
                  aria-pressed={challengeView === view}
                  onClick={() => selectChallengeView(view)}
                >
                  {view.charAt(0).toUpperCase() + view.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btnPrimary btnSmall inboxCreateChallengeButton"
              aria-expanded={challengesComposeOpen}
              onClick={() => {
                setChallengesComposeOpen(true)
                logFrontendEvent({ category: 'inbox.challengeCompose', message: 'create_challenge_button_opened' })
              }}
            >
              Create Challenge
            </button>
          </div>
        </div>

        {challengesComposeOpen ? (
          <form className="formStack inboxEmbeddedForm inboxChallengeComposeForm" onSubmit={handleChallengeSubmit}>
            <div className="formRow formRow--split">
              <div>
                <label className="label" htmlFor="challengeType">Challenge type</label>
                <select
                  id="challengeType"
                  className="input"
                  value={challengeType}
                  onChange={(event) => {
                    const nextChallengeType = event.target.value as 'team' | 'individual'
                    setChallengeType(nextChallengeType)
                    logFrontendEvent({ category: 'inbox.challengeCompose', message: 'challenge_type_changed', data: { challengeType: nextChallengeType } })
                    setError(null)
                    setStatus(null)
                  }}
                >
                  <option value="team">Team Challenge</option>
                  <option value="individual">Individual Challenge</option>
                </select>
              </div>
              {isTeamChallenge ? (
                <div>
                  <label className="label" htmlFor="proposerTeamId">Your team</label>
                  <select
                    id="proposerTeamId"
                    className="input"
                    required={isTeamChallenge}
                    value={proposerTeamId}
                    onChange={(event) => setProposerTeamId(event.target.value)}
                    disabled={myTeams.length === 0}
                  >
                    {myTeams.length === 0 ? <option value="">Create or join a team first</option> : null}
                    {myTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="label" htmlFor="individualParticipantEmails">Recipient emails</label>
                  <textarea
                    id="individualParticipantEmails"
                    className="input"
                    rows={3}
                    required={isIndividualChallenge}
                    value={individualParticipantEmails}
                    onChange={(event) => setIndividualParticipantEmails(event.target.value)}
                    placeholder="golfer1@example.com, golfer2@example.com"
                  />
                  <div className="small">Add up to 25 golfer email addresses separated by commas, semicolons, or new lines. Each golfer can edit only their own Individual Challenge score.</div>
                  <div className="small">{parsedIndividualParticipantEmails.length}/25 golfers entered</div>
                </div>
              )}
            </div>

            {isTeamChallenge ? (
              <div>
                <label className="label" htmlFor="teamChallengeIdentifier">GolfHomiez Team ID</label>
                <input
                  id="teamChallengeIdentifier"
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  list="teamChallengeOptions"
                  required={isTeamChallenge}
                  value={challengedTeamIdentifier}
                  onChange={(event) => setChallengedTeamIdentifier(event.target.value.replace(/\D/g, ''))}
                  placeholder="Enter the team's numeric ID"
                />
                <datalist id="teamChallengeOptions">
                  {teamChallengeOptions.map((team) => <option key={team.id} value={String(team.teamIdentifier)} label={team.name} />)}
                </datalist>
                <div className="small">Use the numeric ID shown on the team's Teams page.{selectedChallengedTeam ? ` Selected team: ${selectedChallengedTeam.name}.` : ''}</div>
              </div>
            ) : null}

            <div className="grid grid3 inboxTeamChallengeCourseGrid">
              <div>
                <label className="label" htmlFor="teamChallengeDate">Date</label>
                <input
                  id="teamChallengeDate"
                  className="input"
                  type="date"
                  value={teamChallengeDate}
                  onChange={(event) => setTeamChallengeDate(event.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="teamChallengeState">State</label>
                <select
                  id="teamChallengeState"
                  className="input"
                  value={teamChallengeState}
                  onChange={(event) => {
                    setTeamChallengeState(event.target.value)
                    setTeamChallengeCourse('')
                    setTeamChallengeCourseSearch('')
                  }}
                  required
                  disabled={statesLoading && !stateOptions.length}
                >
                  {!stateOptions.length ? <option value={teamChallengeState}>{statesLoading ? 'Loading golf course states…' : (teamChallengeState || 'No golf course states available')}</option> : null}
                  {stateOptions.map((state) => (
                    <option key={state.abbr} value={state.abbr}>{state.name}</option>
                  ))}
                </select>
                {statesError ? <div className="small">{statesError}</div> : null}
              </div>

              <div>
                <GolfCourseInput
                  label="Course"
                  state={teamChallengeState}
                  searchValue={teamChallengeCourseSearch}
                  selectedCourseName={teamChallengeCourse}
                  onSearchChange={(next) => {
                    setTeamChallengeCourseSearch(next)
                    setTeamChallengeCourse('')
                  }}
                  onCourseSelected={(selected) => {
                    setTeamChallengeCourse(selected.name || '')
                    setTeamChallengeCourseSearch(selected.name || '')
                  }}
                  placeholder="Search courses in the selected state"
                  inputId="teamChallengeCourseSearch"
                  disabled={!challengesComposeOpen}
                  required
                />
              </div>
            </div>

            <TeeColorSelector value={teamChallengeTeeColor} onChange={setTeamChallengeTeeColor} label="Tees played" />

            {isTeamChallenge ? (
              <div className="grid grid2 teamChallengeSkinsOptions">
                <div>
                  <label className="label" htmlFor="teamChallengeScoringType">Team challenge game</label>
                  <select
                    id="teamChallengeScoringType"
                    className="input"
                    value={teamChallengeScoringType}
                    onChange={(event) => {
                      const nextScoringType = normalizeTeamChallengeScoringType(event.target.value)
                      setTeamChallengeScoringType(nextScoringType)
                      logFrontendEvent({ category: 'inbox.teamChallenge.scoring', message: 'team_challenge_scoring_type_changed', data: { challengeScoringType: nextScoringType } })
                    }}
                  >
                    <option value="stroke_play">Standard team score</option>
                    <option value="skins">Skins</option>
                    <option value="skins_push">Skins - Push</option>
                  </select>
                  <div className="small">Skins awards points for holes won. Skins - Push carries tied-hole points forward until a team wins a hole.</div>
                </div>

                {isSkinsTeamChallenge(teamChallengeScoringType) ? (
                  <div>
                    <label className="label" htmlFor="teamChallengePointsPerHole">Points per hole</label>
                    <input
                      id="teamChallengePointsPerHole"
                      className="input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={teamChallengePointsPerHole}
                      onChange={(event) => setTeamChallengePointsPerHole(event.target.value)}
                      placeholder="1"
                    />
                    <div className="small">Optional. Blank or invalid values default to 1 point per hole.</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="label" htmlFor="challengeMessageBody">Challenge Message</label>
              <textarea
                id="challengeMessageBody"
                className="input"
                rows={5}
                maxLength={2000}
                value={challengeBody}
                onChange={(event) => setChallengeBody(event.target.value)}
                placeholder={isTeamChallenge ? 'Optional: write your Team Challenge details' : 'Write your Individual Challenge details'}
              />
              <div className="small">{challengeBody.length}/2000 characters</div>
            </div>

            {status ? <div className="inboxStatus inboxStatus--success">{status}</div> : null}
            {error ? <div className="inboxStatus inboxStatus--error">{error}</div> : null}

            <div className="pageHeroActions">
              <button className="btn btnPrimary" type="submit" disabled={sending || !canSubmitChallenge}>{sending ? 'Sending…' : isTeamChallenge ? 'Send Team Challenge' : 'Send Individual Challenge'}</button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setChallengesComposeOpen(false)
                  logFrontendEvent({ category: 'inbox.challengeCompose', message: 'create_challenge_form_cancelled' })
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {loading ? null : visibleChallengeThreads.length === 0 ? <div className="small">{challengeView === 'completed' ? 'No completed Challenges.' : (challengeView === 'deleted' ? 'No deleted Challenges.' : 'No active Challenges yet.')}</div> : null}
        <div className="inboxMessageList">
          {displayedChallengeThreads.map((thread) => renderThreadCard(thread, 'team-challenges'))}
        </div>
      </section>

      {renderTeamChallengeScorecardModal()}
      {renderIndividualChallengeScorecardModal()}
      {renderTeamChallengeLeaderboardModal()}
      {renderIndividualChallengeLeaderboardModal()}
    </div>
  )
}
