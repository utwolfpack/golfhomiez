import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import HoleByHoleScorecard, { type PendingHoleScoreSaveHandler } from '../components/HoleByHoleScorecard'
import HoleStrokeScore from '../components/HoleStrokeScore'
import TeeColorSelector from '../components/TeeColorSelector'
import GolfCourseInput from '../components/GolfCourseInput'
import InviteHomieModal from '../components/InviteHomieModal'
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
  updateIndividualChallengeCourse,
  updateInboxChallengeSettings,
  addIndividualChallengeParticipant,
  refreshIndividualChallengeParticipants,
  type IndividualChallengeParticipant,
  type InboxMessage,
  type InboxMessageType,
} from '../lib/inbox'
import { fetchTeams, lookupUserByEmail, sendRegistrationInvite } from '../lib/teams'
import { getUserTodayISO } from '../lib/date'
import { useGolfCourseStates } from '../hooks/useGolfCourseStates'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { buildClientDefaultHoleScorecard, formatHoleScoreOutcome, hasSavedHoleScoreValue, missingHoleScoreNumbers, nextUnscoredHoleNumber, normalizeHoleScorecard, scoreOutcomeClassName } from '../lib/hole-scorecard'
import type { HoleScoreDetail, Team } from '../types'
import type { TeeColorSelection } from '../lib/tee-colors'
import { DEFAULT_TEE_COLOR, normalizeTeeColor, teeColorLabel } from '../lib/tee-colors'
import { fetchProfile } from '../lib/profile'
import { calculateTeamChallengePoints, isSkinsTeamChallenge, normalizeTeamChallengePointsPerHole, normalizeTeamChallengeScoringType, teamChallengeScoringTypeLabel, type TeamChallengeScoringType } from '../lib/team-challenge-scoring'

type TeamChallengeLeaderboardSide = 'proposer' | 'challenged'
type ChallengeDetailSection = 'settings' | 'score' | 'discussion'

type TeamChallengeScorecardTarget = {
  message: InboxMessage
  side: 'proposer' | 'challenged'
}

type IndividualChallengeScorecardTarget = {
  message: InboxMessage
  participant: IndividualChallengeParticipant
}

type IndividualChallengeCoursePickerTarget = {
  message: InboxMessage
  participant: IndividualChallengeParticipant
}

type ChallengeMemberValidationState = 'idle' | 'checking' | 'validated' | 'invited'

type IndividualChallengeMemberDraft = {
  id: string
  email: string
  name?: string | null
  validationState: ChallengeMemberValidationState
}

type ChallengeSettingsDraft = {
  threadId: string
  teeColor: TeeColorSelection
  scoringType: TeamChallengeScoringType
  pointsPerHole: string
  challengeDate: string
  challengeEndDate: string
  challengeState: string
  challengeCourse: string
}

function makeChallengeMemberDraft(email = ''): IndividualChallengeMemberDraft {
  let id = ''
  try {
    id = crypto.randomUUID()
  } catch {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }
  return { id, email, name: null, validationState: 'idle' }
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function maxIndividualChallengeEndDate(startDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return ''
  const date = new Date(`${startDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

function resolveProfileStateCode(primaryState: string, options: Array<{ abbr: string; name: string }>) {
  const normalized = String(primaryState || '').trim()
  if (!normalized) return ''
  if (/^[A-Za-z]{2}$/.test(normalized)) return normalized.toUpperCase()
  const match = options.find((option) => option.name.toLowerCase() === normalized.toLowerCase() || option.abbr.toLowerCase() === normalized.toLowerCase())
  return match?.abbr || ''
}

function challengeDateLabel(message: InboxMessage) {
  const start = String(message.challengeDate || '').trim()
  const end = String(message.challengeEndDate || '').trim()
  if (!start) return ''
  if (!end || end === start) return start
  return `${start} – ${end}`
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

function isIndividualChallengeInviteActivityMessage(message: InboxMessage) {
  if (message.messageType !== 'individual_challenge') return false
  return / was invited to the Individual Challenge\.$/i.test(String(message.body || '').trim())
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



function isChallengeMessage(message: InboxMessage) {
  return message.messageType === 'challenge_request' || message.messageType === 'individual_challenge'
}


export default function Challenges() {
  const navigate = useNavigate()
  const location = useLocation()
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
  const [teamChallengeState, setTeamChallengeState] = useState('')
  const [teamChallengeCourse, setTeamChallengeCourse] = useState('')
  const [teamChallengeCourseSearch, setTeamChallengeCourseSearch] = useState('')
  const [profilePrimaryState, setProfilePrimaryState] = useState('')
  const [individualLocationEnabled, setIndividualLocationEnabled] = useState(false)
  const [individualChallengeEndDate, setIndividualChallengeEndDate] = useState(() => getUserTodayISO())
  const [teamChallengeTeeColor, setTeamChallengeTeeColor] = useState<TeeColorSelection>('')
  const [teamChallengeScoringType, setTeamChallengeScoringType] = useState<TeamChallengeScoringType>('stroke_play')
  const [teamChallengePointsPerHole, setTeamChallengePointsPerHole] = useState('1')
  const { states: stateOptions, loading: statesLoading, error: statesError } = useGolfCourseStates(challengesComposeOpen)
  const [individualChallengeMembers, setIndividualChallengeMembers] = useState<IndividualChallengeMemberDraft[]>([makeChallengeMemberDraft()])
  const [individualInviteOpen, setIndividualInviteOpen] = useState(false)
  const [individualInviteTarget, setIndividualInviteTarget] = useState<{ email: string; draftId?: string; challengeMessageId?: string } | null>(null)
  const [individualAddMemberDraft, setIndividualAddMemberDraft] = useState<IndividualChallengeMemberDraft>(makeChallengeMemberDraft())
  const [individualAddMemberThreadId, setIndividualAddMemberThreadId] = useState<string | null>(null)
  const [addingIndividualParticipant, setAddingIndividualParticipant] = useState(false)
  const [challengeSettingsDraft, setChallengeSettingsDraft] = useState<ChallengeSettingsDraft | null>(null)
  const [expandedChallengeSections, setExpandedChallengeSections] = useState<Record<string, boolean>>({})
  const [teamChallengeMembersModal, setTeamChallengeMembersModal] = useState<InboxMessage | null>(null)
  const [updatingChallengeSettings, setUpdatingChallengeSettings] = useState(false)
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
  const [individualCoursePicker, setIndividualCoursePicker] = useState<IndividualChallengeCoursePickerTarget | null>(null)
  const [individualCourseState, setIndividualCourseState] = useState('')
  const [individualCourseName, setIndividualCourseName] = useState('')
  const [individualCourseSearch, setIndividualCourseSearch] = useState('')
  const [individualCourseId, setIndividualCourseId] = useState('')
  const [savingIndividualCourse, setSavingIndividualCourse] = useState(false)
  const [activeIndividualChallengeLeaderboard, setActiveIndividualChallengeLeaderboard] = useState<InboxMessage | null>(null)
  const [activeIndividualLeaderboardParticipant, setActiveIndividualLeaderboardParticipant] = useState<IndividualChallengeParticipant | null>(null)
  const [individualChallengeParticipantsModal, setIndividualChallengeParticipantsModal] = useState<InboxMessage | null>(null)
  const [refreshingIndividualParticipantsThreadId, setRefreshingIndividualParticipantsThreadId] = useState<string | null>(null)
  const [activeTeamChallengeLeaderboard, setActiveTeamChallengeLeaderboard] = useState<InboxMessage | null>(null)
  const [activeTeamLeaderboardSide, setActiveTeamLeaderboardSide] = useState<TeamChallengeLeaderboardSide | null>(null)
  const [teamChallengeLeaderboardReturnTarget, setTeamChallengeLeaderboardReturnTarget] = useState<TeamChallengeScorecardTarget | null>(null)
  const [individualChallengeLeaderboardReturnTarget, setIndividualChallengeLeaderboardReturnTarget] = useState<IndividualChallengeScorecardTarget | null>(null)
  const [scorecardResumeHoles, setScorecardResumeHoles] = useState<Record<string, number>>({})
  const [refreshingLeaderboard, setRefreshingLeaderboard] = useState(false)
  const autoMarkedReadThreadIds = useRef(new Set<string>())
  const deepLinkedThreadRef = useRef<string | null>(null)
  const teamChallengePendingHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)
  const individualChallengePendingHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)
  const [completingChallengeThreadId, setCompletingChallengeThreadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const { states: individualCourseStateOptions, loading: individualCourseStatesLoading, error: individualCourseStatesError } = useGolfCourseStates(Boolean(individualCoursePicker))

  const currentUserEmail = useMemo(() => String(user?.email || '').trim().toLowerCase(), [user?.email])
  const myTeams = useMemo(() => teams.filter((team) => teamContainsEmail(team, currentUserEmail)), [teams, currentUserEmail])
  const selectedProposerTeam = useMemo(() => myTeams.find((team) => team.id === proposerTeamId) || null, [myTeams, proposerTeamId])
  const teamChallengeOptions = useMemo(() => teams.filter((team) => team.id !== proposerTeamId), [teams, proposerTeamId])
  const selectedChallengedTeam = useMemo(() => teamChallengeOptions.find((team) => String(team.teamIdentifier) === challengedTeamIdentifier.trim()) || null, [teamChallengeOptions, challengedTeamIdentifier])
  const isTeamChallenge = challengeType === 'team'
  const isIndividualChallenge = challengeType === 'individual'
  const parsedIndividualParticipantEmails = useMemo(() => individualChallengeMembers
    .filter((member) => member.validationState === 'validated' || member.validationState === 'invited')
    .map((member) => member.email.trim().toLowerCase())
    .filter(Boolean), [individualChallengeMembers])
  const individualChallengeDateRangeValid = Boolean(teamChallengeDate && individualChallengeEndDate && individualChallengeEndDate >= teamChallengeDate && (!maxIndividualChallengeEndDate(teamChallengeDate) || individualChallengeEndDate <= maxIndividualChallengeEndDate(teamChallengeDate)))
  const teamChallengeLocationValid = Boolean(teamChallengeState && teamChallengeCourse)
  const individualChallengeLocationValid = !individualLocationEnabled || Boolean(teamChallengeState && teamChallengeCourse)
  const canSubmitChallenge = isTeamChallenge
    ? Boolean(teamChallengeDate && teamChallengeLocationValid && proposerTeamId && /^\d+$/.test(challengedTeamIdentifier.trim()))
    : Boolean(individualChallengeDateRangeValid && individualChallengeLocationValid && parsedIndividualParticipantEmails.length > 0 && parsedIndividualParticipantEmails.length <= 24)
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
  useEffect(() => {
    const threadId = new URLSearchParams(location.search).get('thread')
    if (!threadId || deepLinkedThreadRef.current === threadId) return
    const thread = teamChallengeThreads.find((item) => item.threadId === threadId)
    if (!thread) return
    const challenge = getInitialChallengeMessage(thread)
    deepLinkedThreadRef.current = threadId
    setChallengeView(challenge.challengeDeletedAt ? 'deleted' : (isChallengeCompleted(challenge) ? 'completed' : 'active'))
    setExpandedThreadId(threadId)
    if (challenge.messageType === 'individual_challenge') void refreshIndividualChallengeParticipantStatuses(challenge, 'deep_link')
    logFrontendEvent({ category: 'inbox.challenge.navigation', message: 'challenge_notification_deep_link_opened', data: { threadId, deleted: Boolean(challenge.challengeDeletedAt), completed: isChallengeCompleted(challenge) } })
  }, [location.search, teamChallengeThreads])
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
    const visibleConversation = getConversationFor(message).filter((item) => !isIndividualChallengeInviteActivityMessage(item))
    return latestThreadMessage(visibleConversation) || message
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

  function challengeSectionKey(message: InboxMessage, section: ChallengeDetailSection) {
    return `${messageThreadId(message)}:${section}`
  }

  function isChallengeSectionExpanded(message: InboxMessage, section: ChallengeDetailSection) {
    return Boolean(expandedChallengeSections[challengeSectionKey(message, section)])
  }

  function toggleChallengeSection(message: InboxMessage, section: ChallengeDetailSection) {
    const key = challengeSectionKey(message, section)
    const nextExpanded = !expandedChallengeSections[key]
    const prefix = `${messageThreadId(message)}:`
    setExpandedChallengeSections((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([currentKey]) => !currentKey.startsWith(prefix)))
      if (!current[key]) next[key] = true
      return next
    })
    logFrontendEvent({
      category: 'inbox.challenge.section',
      message: nextExpanded ? 'challenge_section_expanded' : 'challenge_section_collapsed',
      data: { threadId: messageThreadId(message), messageId: message.id, messageType: message.messageType, section, siblingSectionLinksHidden: nextExpanded },
    })
  }

  function resetChallengeSections(threadId: string) {
    const prefix = `${threadId}:`
    setExpandedChallengeSections((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))))
  }

  function getTeamForChallengeSide(message: InboxMessage, side: 'proposer' | 'challenged') {
    const teamId = side === 'proposer' ? message.proposerTeamId : message.challengedTeamId
    return teams.find((team) => String(team.id) === String(teamId || '')) || null
  }

  function teamMemberDisplayName(member: { name?: string | null; email?: string | null }) {
    const name = String(member.name || '').replace(/\s+/g, ' ').trim()
    const email = String(member.email || '').trim()
    return name && name.toLowerCase() !== email.toLowerCase() ? name : (email || 'Golfer')
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

  function getTeamChallengeDisplayHoleCount(message: InboxMessage) {
    const explicitScorecards = [
      getStoredTeamChallengeHoles(message, 'proposer'),
      getStoredTeamChallengeHoles(message, 'challenged'),
      teamChallengeScorecards[getTeamChallengeScoreKey(message, 'proposer')] || null,
      teamChallengeScorecards[getTeamChallengeScoreKey(message, 'challenged')] || null,
    ].filter((holes): holes is HoleScoreDetail[] => Array.isArray(holes) && holes.length > 0)
    const explicitLengths = explicitScorecards.map((holes) => Math.min(18, Math.max(0, holes.length)))
    if (explicitLengths.some((length) => length > 9)) return 18
    if (explicitLengths.some((length) => length === 9)) return 9
    return 18
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
    const displayHoleCount = getTeamChallengeDisplayHoleCount(message)
    const holes = preferCached && teamChallengeScorecards[key]
      ? applyChallengeTeeColor(teamChallengeScorecards[key], selectedTeeColor)
      : (getStoredTeamChallengeHoles(message, side) || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(message), getTeamChallengeCourseName(message), selectedTeeColor))
    return holes.slice(0, displayHoleCount)
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
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_round_summary_opened', data: { messageId: message.id, threadId: messageThreadId(message), side, teamName: getTeamChallengeDisplayName(message, side), course: getTeamChallengeCourseName(message), summaryColumns: ['Hole', 'Par', 'Score', 'Current round score over/under', 'Current round total stroke score'], holeScoreDisplayFormat: 'golf_score_symbols_v1' } })
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
    const pointSummary = getTeamChallengePointSummary(currentMessage)
    const showPushColumn = pointSummary.scoringType === 'skins_push'
    const pointsScoringActive = isSkinsTeamChallenge(pointSummary.scoringType)
    const displayOrder = ['Hole', 'Par', getTeamChallengeDisplayName(currentMessage, 'proposer'), getTeamChallengeDisplayName(currentMessage, 'challenged'), 'Winner', ...(showPushColumn ? ['Push'] : []), 'Points']
    setTeamChallengeLeaderboardReturnTarget(returnTarget)
    setActiveTeamLeaderboardSide(null)
    setActiveTeamChallengeLeaderboard(currentMessage)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_opened', data: { messageId: currentMessage.id, threadId: currentMessage.threadId || currentMessage.id, proposerTeamId: currentMessage.proposerTeamId, challengedTeamId: currentMessage.challengedTeamId, displayOrder, totalDisplayMode: 'hole_by_hole_team_comparison', pointsDisplayMode: pointsScoringActive ? 'running_team_point_lead' : 'not_applicable', rowCount: pointSummary.holeResults.length, completedCount: pointSummary.completedHoles, pointsColumnVisible: true, pointsScoringActive, summaryViewVisible: true, summaryViewMode: 'team_leaderboard_hole_grid', opponentReadOnlyScoreTileRemoved: true, pushColumnVisible: showPushColumn, holeScoreDisplayFormat: 'golf_score_symbols_v1', skinsPushDifferentialHoleCount: pointSummary.holeResults.filter((hole) => hole.strokeDifferentialBonus > 0).length, fetchedCurrentData: true, returnToScorecard: Boolean(returnTarget) } })
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

  function getIndividualChallengeParticipantStateCode(message: InboxMessage, participant: IndividualChallengeParticipant) {
    if (String(message.challengeCourse || '').trim()) return String(message.challengeState || '').trim().toUpperCase()
    return String(participant.courseState || '').trim().toUpperCase()
  }

  function getIndividualChallengeParticipantCourseName(message: InboxMessage, participant: IndividualChallengeParticipant) {
    if (String(message.challengeCourse || '').trim()) return String(message.challengeCourse || '').trim()
    return String(participant.courseName || '').trim()
  }

  function applyRefreshedIndividualChallengeParticipants(updated: InboxMessage) {
    const updatedThreadId = messageThreadId(updated)
    const participants = updated.individualChallengeParticipants || []
    const patchParticipants = (item: InboxMessage) => (item.messageType === 'individual_challenge' && messageThreadId(item) === updatedThreadId
      ? { ...item, individualChallengeParticipants: participants }
      : item)
    setMessages((current) => current.map(patchParticipants))
    setSentMessages((current) => current.map(patchParticipants))
    setSentChallenges((current) => current.map(patchParticipants))
    setActiveIndividualChallengeLeaderboard((current) => (current && messageThreadId(current) === updatedThreadId ? patchParticipants(current) : current))
    setIndividualChallengeParticipantsModal((current) => (current && messageThreadId(current) === updatedThreadId ? patchParticipants(current) : current))
  }

  async function refreshIndividualChallengeParticipantStatuses(message: InboxMessage, trigger: 'challenge_selected' | 'participants_opened' | 'deep_link' | 'leaderboard_open') {
    if (message.messageType !== 'individual_challenge') return message
    const threadId = messageThreadId(message)
    const correlationId = getCorrelationId()
    setRefreshingIndividualParticipantsThreadId(threadId)
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_participant_status_refresh_started', data: { correlationId, messageId: message.id, threadId, trigger, participantCount: getIndividualChallengeParticipants(message).length } })
    try {
      const result = await refreshIndividualChallengeParticipants(message.id)
      const updated = result.message || { ...message, individualChallengeParticipants: result.participants || [] }
      applyRefreshedIndividualChallengeParticipants(updated)
      logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_participant_status_refresh_succeeded', data: { correlationId, messageId: updated.id, threadId, trigger, participantCount: result.participants?.length || 0, registeredCount: result.registeredCount, pendingCount: result.pendingCount, transitionedToRegisteredCount: result.transitionedToRegisteredCount } })
      return updated
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not refresh invited golfer status.'
      logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'error', message: 'individual_challenge_participant_status_refresh_failed', data: { correlationId, messageId: message.id, threadId, trigger, error: errorMessage } })
      return message
    } finally {
      setRefreshingIndividualParticipantsThreadId((current) => current === threadId ? null : current)
    }
  }

  async function openIndividualChallengeParticipants(message: InboxMessage) {
    setIndividualChallengeParticipantsModal(message)
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_participant_list_opened', data: { messageId: message.id, threadId: messageThreadId(message), participantCount: getIndividualChallengeParticipants(message).length } })
    const refreshed = await refreshIndividualChallengeParticipantStatuses(message, 'participants_opened')
    setIndividualChallengeParticipantsModal(refreshed)
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
    const stateCode = getIndividualChallengeParticipantStateCode(message, participant)
    const courseName = getIndividualChallengeParticipantCourseName(message, participant)
    return Array.isArray(holes) && holes.length ? applyChallengeTeeColor(normalizeHoleScorecard(holes, stateCode, courseName, selectedTeeColor), selectedTeeColor) : null
  }

  function getIndividualChallengeHoles(message: InboxMessage, participant: IndividualChallengeParticipant, preferCached = true) {
    const key = getIndividualChallengeScoreKey(message, participant)
    const selectedTeeColor = getTeamChallengeTeeColor(message)
    const stateCode = getIndividualChallengeParticipantStateCode(message, participant)
    const courseName = getIndividualChallengeParticipantCourseName(message, participant)
    if (preferCached && individualChallengeScorecards[key]) return applyChallengeTeeColor(individualChallengeScorecards[key], selectedTeeColor)
    return getStoredIndividualChallengeHoles(message, participant) || buildClientDefaultHoleScorecard(stateCode, courseName, selectedTeeColor)
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
          courseName: getIndividualChallengeParticipantCourseName(message, participant) || 'Course not selected',
          courseState: getIndividualChallengeParticipantStateCode(message, participant),
          roundLabel: formatLeaderboardRelative(relativeScore),
          totalLabel: score == null ? 'Pending' : String(score),
        }
      })
      .filter((row) => row.thru > 0)
      .sort((a, b) => {
        if (a.relativeScore == null && b.relativeScore == null) return participantDisplayName(a.participant).localeCompare(participantDisplayName(b.participant))
        if (a.relativeScore == null) return 1
        if (b.relativeScore == null) return -1
        if (a.relativeScore !== b.relativeScore) return a.relativeScore - b.relativeScore
        return (a.score ?? Number.MAX_SAFE_INTEGER) - (b.score ?? Number.MAX_SAFE_INTEGER)
      })
      .map((row, index) => ({ ...row, position: index + 1 }))
  }

  function getCompletedChallengeResultLabel(message: InboxMessage) {
    if (!isChallengeCompleted(message)) return ''
    if (message.messageType === 'individual_challenge') {
      const winner = getIndividualChallengeLeaderboardRows(message)[0]
      return winner ? `1st place: ${participantDisplayName(winner.participant)}` : '1st place: No score recorded'
    }

    const rows = getTeamChallengeLeaderboardRows(message)
    const proposer = rows.find((row) => row.side === 'proposer')
    const challenged = rows.find((row) => row.side === 'challenged')
    if (!proposer || !challenged) return 'Result unavailable'
    const scoringType = getTeamChallengeScoringType(message)
    if (isSkinsTeamChallenge(scoringType)) {
      const proposerPoints = Number(proposer.ownPoints || 0)
      const challengedPoints = Number(challenged.ownPoints || 0)
      if (proposerPoints === challengedPoints) return `Result: ${proposer.teamName} ${formatPointNumber(proposerPoints)} pts — ${challenged.teamName} ${formatPointNumber(challengedPoints)} pts · Tie`
      const winner = proposerPoints > challengedPoints ? proposer : challenged
      return `Result: ${proposer.teamName} ${formatPointNumber(proposerPoints)} pts — ${challenged.teamName} ${formatPointNumber(challengedPoints)} pts · ${winner.teamName} wins`
    }
    if (proposer.score == null || challenged.score == null) return 'Result unavailable'
    if (proposer.score === challenged.score) return `Result: ${proposer.teamName} ${proposer.score} — ${challenged.teamName} ${challenged.score} · Tie`
    const winner = proposer.relativeScore != null && challenged.relativeScore != null
      ? (proposer.relativeScore < challenged.relativeScore ? proposer : challenged)
      : (proposer.score < challenged.score ? proposer : challenged)
    return `Result: ${proposer.teamName} ${proposer.score} — ${challenged.teamName} ${challenged.score} · ${winner.teamName} wins`
  }

  async function openIndividualChallengeLeaderboard(message: InboxMessage, returnTarget: IndividualChallengeScorecardTarget | null = null) {
    const directoryRefreshedMessage = await refreshIndividualChallengeParticipantStatuses(message, 'leaderboard_open')
    const currentMessage = await fetchCurrentChallengeForLeaderboard(directoryRefreshedMessage, 'individual_challenge', 'open')
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
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_round_summary_opened', data: { messageId: message.id, threadId: messageThreadId(message), participantEmail: participantEmail(participant), course: getIndividualChallengeParticipantCourseName(message, participant), editable: currentUserCanEditIndividualParticipant(participant), summaryColumns: ['Hole', 'Par', 'Score', 'Current round score over/under', 'Current round total stroke score'], holeScoreDisplayFormat: 'golf_score_symbols_v1' } })
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
    let active = true
    if (!user?.id) return () => { active = false }
    fetchProfile()
      .then((profile) => {
        if (!active) return
        setProfilePrimaryState(String(profile.primaryState || '').trim())
        logFrontendEvent({ category: 'challenges.profile', message: 'challenge_default_state_profile_loaded', data: { hasPrimaryState: Boolean(profile.primaryState), primaryState: profile.primaryState || null } })
      })
      .catch((err) => {
        if (!active) return
        setProfilePrimaryState('')
        logFrontendEvent({ category: 'challenges.profile', level: 'warn', message: 'challenge_default_state_profile_load_failed', data: { error: err instanceof Error ? err.message : String(err) } })
      })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (!challengesComposeOpen || teamChallengeState) return
    const profileStateCode = resolveProfileStateCode(profilePrimaryState, stateOptions)
    if (!profileStateCode) return
    setTeamChallengeState(profileStateCode)
    setTeamChallengeCourse('')
    setTeamChallengeCourseSearch('')
    logFrontendEvent({ category: 'challenges.location', message: 'challenge_state_defaulted_from_profile', data: { profilePrimaryState, stateCode: profileStateCode } })
  }, [challengesComposeOpen, profilePrimaryState, stateOptions, teamChallengeState])

  useEffect(() => {
    if (!individualCoursePicker || individualCourseState) return
    const profileStateCode = resolveProfileStateCode(profilePrimaryState, individualCourseStateOptions)
    if (!profileStateCode) return
    setIndividualCourseState(profileStateCode)
    logFrontendEvent({ category: 'inbox.individualChallenge.course', message: 'individual_challenge_course_state_defaulted_from_profile', data: { profilePrimaryState, stateCode: profileStateCode, messageId: individualCoursePicker.message.id, threadId: messageThreadId(individualCoursePicker.message) } })
  }, [individualCoursePicker, individualCourseState, individualCourseStateOptions, profilePrimaryState])

  function addIndividualChallengeCreateMember() {
    if (individualChallengeMembers.length >= 24) return
    setIndividualChallengeMembers((current) => [...current, makeChallengeMemberDraft()])
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_create_member_row_added', data: { memberRowCount: individualChallengeMembers.length + 1 } })
  }

  function patchIndividualChallengeCreateMember(id: string, email: string) {
    setIndividualChallengeMembers((current) => current.map((member) => member.id === id ? { ...member, email, name: null, validationState: 'idle' } : member))
  }

  function removeIndividualChallengeCreateMember(id: string) {
    setIndividualChallengeMembers((current) => {
      const next = current.filter((member) => member.id !== id)
      return next.length ? next : [makeChallengeMemberDraft()]
    })
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_create_member_row_removed', data: { memberId: id } })
  }

  async function validateIndividualChallengeCreateMember(id: string) {
    const target = individualChallengeMembers.find((member) => member.id === id)
    if (!target) return
    const email = target.email.trim().toLowerCase()
    const correlationId = getCorrelationId()
    setError(null)
    setStatus(null)
    if (!isValidEmailAddress(email)) {
      setError('Enter a valid golfer email before validating.')
      logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'warn', message: 'individual_challenge_member_validation_invalid_email', data: { correlationId, memberId: id, email } })
      return
    }
    if (email === currentUserEmail || individualChallengeMembers.some((member) => member.id !== id && member.email.trim().toLowerCase() === email)) {
      setError('That golfer is already included in this Individual Challenge.')
      return
    }
    setIndividualChallengeMembers((current) => current.map((member) => member.id === id ? { ...member, email, validationState: 'checking' } : member))
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_member_validation_started', data: { correlationId, memberId: id, email } })
    try {
      const result = await lookupUserByEmail(email)
      if (!result.found) {
        setIndividualChallengeMembers((current) => current.map((member) => member.id === id ? { ...member, email, name: null, validationState: 'idle' } : member))
        setIndividualInviteTarget({ email, draftId: id })
        setIndividualInviteOpen(true)
        logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'warn', message: 'individual_challenge_member_not_found_invite_opened', data: { correlationId, memberId: id, email } })
        return
      }
      setIndividualChallengeMembers((current) => current.map((member) => member.id === id ? { ...member, email: result.email || email, name: result.name || [result.firstName, result.lastName].filter(Boolean).join(' ') || result.email || email, validationState: 'validated' } : member))
      setStatus(`${result.name || result.firstName || 'Golfer'} validated.`)
      logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_member_validated', data: { correlationId, memberId: id, email: result.email || email } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not validate golfer email.'
      setIndividualChallengeMembers((current) => current.map((member) => member.id === id ? { ...member, validationState: 'idle' } : member))
      setError(message)
      logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'error', message: 'individual_challenge_member_validation_failed', data: { correlationId, memberId: id, email, error: message } })
    }
  }

  function resetIndividualAddMember(threadId?: string | null) {
    setIndividualAddMemberDraft(makeChallengeMemberDraft())
    setIndividualAddMemberThreadId(threadId || null)
  }

  async function validateIndividualChallengeExistingMember(message: InboxMessage) {
    const email = individualAddMemberDraft.email.trim().toLowerCase()
    const correlationId = getCorrelationId()
    if (!isValidEmailAddress(email)) {
      setError('Enter a valid golfer email before validating.')
      return
    }
    if (getIndividualChallengeParticipants(message).some((participant) => participantEmail(participant) === email)) {
      setError('That golfer is already invited to this Individual Challenge.')
      return
    }
    setAddingIndividualParticipant(true)
    setError(null)
    setStatus(null)
    setIndividualAddMemberDraft((current) => ({ ...current, email, validationState: 'checking' }))
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_existing_member_validation_started', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email } })
    try {
      const result = await lookupUserByEmail(email)
      if (!result.found) {
        setIndividualAddMemberDraft((current) => ({ ...current, email, name: null, validationState: 'idle' }))
        setIndividualInviteTarget({ email, challengeMessageId: message.id })
        setIndividualInviteOpen(true)
        logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'warn', message: 'individual_challenge_existing_member_not_found_invite_opened', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email } })
        return
      }
      setIndividualAddMemberDraft((current) => ({ ...current, email: result.email || email, name: result.name || [result.firstName, result.lastName].filter(Boolean).join(' ') || result.email || email, validationState: 'validated' }))
      setStatus(`${result.name || result.firstName || 'Golfer'} validated. Select Add to challenge.`)
      logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_existing_member_validated', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email: result.email || email } })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not validate golfer email.'
      setIndividualAddMemberDraft((current) => ({ ...current, validationState: 'idle' }))
      setError(errorMessage)
      logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'error', message: 'individual_challenge_existing_member_validation_failed', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email, error: errorMessage } })
    } finally {
      setAddingIndividualParticipant(false)
    }
  }

  async function addValidatedIndividualChallengeExistingMember(message: InboxMessage) {
    if (individualAddMemberDraft.validationState !== 'validated') return
    const email = individualAddMemberDraft.email.trim().toLowerCase()
    const correlationId = getCorrelationId()
    setAddingIndividualParticipant(true)
    setError(null)
    setStatus(null)
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_member_add_started', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email } })
    try {
      const result = await addIndividualChallengeParticipant(message.id, email)
      setStatus(`${result.participants.find((participant) => participantEmail(participant) === email)?.name || email} added to the Individual Challenge.`)
      resetIndividualAddMember(messageThreadId(message))
      await loadInbox()
      logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_member_add_succeeded', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email, participantCount: result.participants.length } })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not add golfer to Individual Challenge.'
      setError(errorMessage)
      logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'error', message: 'individual_challenge_member_add_failed', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), email, error: errorMessage } })
    } finally {
      setAddingIndividualParticipant(false)
    }
  }

  function buildChallengeSettingsDraft(message: InboxMessage): ChallengeSettingsDraft {
    return {
      threadId: messageThreadId(message),
      teeColor: normalizeTeeColor(message.challengeTeeColor || DEFAULT_TEE_COLOR),
      scoringType: normalizeTeamChallengeScoringType(message.challengeScoringType),
      pointsPerHole: String(message.challengePointsPerHole ?? '1'),
      challengeDate: String(message.challengeDate || ''),
      challengeEndDate: String(message.challengeEndDate || message.challengeDate || ''),
      challengeState: String(message.challengeState || ''),
      challengeCourse: String(message.challengeCourse || ''),
    }
  }

  async function saveChallengeSettings(message: InboxMessage) {
    const draft = challengeSettingsDraft?.threadId === messageThreadId(message) ? challengeSettingsDraft : buildChallengeSettingsDraft(message)
    const correlationId = getCorrelationId()
    setUpdatingChallengeSettings(true)
    setError(null)
    setStatus(null)
    try {
      const payload = message.messageType === 'challenge_request'
        ? {
            challengeTeeColor: draft.teeColor,
            challengeScoringType: draft.scoringType,
            challengePointsPerHole: isSkinsTeamChallenge(draft.scoringType) ? draft.pointsPerHole : null,
          }
        : {
            challengeTeeColor: draft.teeColor,
            challengeDate: draft.challengeDate,
            challengeEndDate: draft.challengeEndDate || draft.challengeDate,
          }
      logFrontendEvent({ category: message.messageType === 'challenge_request' ? 'inbox.teamChallenge.settings' : 'inbox.individualChallenge.settings', message: 'challenge_settings_save_started', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), ...payload } })
      const updated = await updateInboxChallengeSettings(message.id, payload)
      setChallengeSettingsDraft(buildChallengeSettingsDraft(updated))
      setStatus('Challenge settings saved.')
      await loadInbox()
      logFrontendEvent({ category: message.messageType === 'challenge_request' ? 'inbox.teamChallenge.settings' : 'inbox.individualChallenge.settings', message: 'challenge_settings_save_succeeded', data: { correlationId, messageId: updated.id, threadId: messageThreadId(updated), challengeTeeColor: updated.challengeTeeColor, challengeScoringType: updated.challengeScoringType || null, challengePointsPerHole: updated.challengePointsPerHole ?? null, challengeDate: updated.challengeDate || null, challengeEndDate: updated.challengeEndDate || null } })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not update challenge settings.'
      setError(errorMessage)
      logFrontendEvent({ category: message.messageType === 'challenge_request' ? 'inbox.teamChallenge.settings' : 'inbox.individualChallenge.settings', level: 'error', message: 'challenge_settings_save_failed', data: { correlationId, messageId: message.id, threadId: messageThreadId(message), error: errorMessage } })
    } finally {
      setUpdatingChallengeSettings(false)
    }
  }


  function patchChallengeSettingsDraft(message: InboxMessage, patch: Partial<ChallengeSettingsDraft>) {
    const threadId = messageThreadId(message)
    setChallengeSettingsDraft((current) => ({ ...(current?.threadId === threadId ? current : buildChallengeSettingsDraft(message)), ...patch, threadId }))
  }

  async function handleIndividualInviteSubmit(payload: { email: string; message: string }) {
    const target = individualInviteTarget
    if (!target) throw new Error('No golfer invite is selected.')
    const email = payload.email.trim().toLowerCase()
    const correlationId = getCorrelationId()
    logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_golfhomiez_invite_send_started', data: { correlationId, email, mode: target.challengeMessageId ? 'existing_challenge' : 'create_challenge', challengeMessageId: target.challengeMessageId || null } })
    try {
      await sendRegistrationInvite(email, payload.message)
      if (target.draftId) {
        setIndividualChallengeMembers((current) => current.map((member) => member.id === target.draftId ? { ...member, email, name: null, validationState: 'invited' } : member))
        setStatus(`Invitation sent to ${email}. The golfer will be included in the challenge.`)
      } else if (target.challengeMessageId) {
        const result = await addIndividualChallengeParticipant(target.challengeMessageId, email)
        setStatus(`Invitation sent to ${email} and the golfer was added to the Individual Challenge.`)
        resetIndividualAddMember(messageThreadId(result.message))
        await loadInbox()
      }
      logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_golfhomiez_invite_send_succeeded', data: { correlationId, email, mode: target.challengeMessageId ? 'existing_challenge' : 'create_challenge', challengeMessageId: target.challengeMessageId || null } })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not invite this golfer to GolfHomiez.'
      logFrontendEvent({ category: 'inbox.individualChallenge.members', level: 'error', message: 'individual_challenge_golfhomiez_invite_send_failed', data: { correlationId, email, mode: target.challengeMessageId ? 'existing_challenge' : 'create_challenge', challengeMessageId: target.challengeMessageId || null, error: errorMessage } })
      throw err
    }
  }

  async function handleChallengeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setError(null)
    setStatus(null)
    const trimmedChallengeTeamIdentifier = challengedTeamIdentifier.trim()
    const trimmedChallengeDate = teamChallengeDate.trim()
    const trimmedChallengeEndDate = individualChallengeEndDate.trim() || trimmedChallengeDate
    const trimmedChallengeState = teamChallengeState.trim().toUpperCase()
    const trimmedChallengeCourse = teamChallengeCourse.trim()
    const trimmedBody = challengeBody.trim()
    const messageTypeForChallenge: InboxMessageType = isTeamChallenge ? 'challenge_request' : 'individual_challenge'
    const effectiveChallengeTeeColor = normalizeTeeColor(teamChallengeTeeColor)
    const effectiveChallengeScoringType = normalizeTeamChallengeScoringType(teamChallengeScoringType)
    const effectiveChallengePointsPerHole = isSkinsTeamChallenge(effectiveChallengeScoringType) ? normalizeTeamChallengePointsPerHole(teamChallengePointsPerHole) : null
    const participantEmails = parsedIndividualParticipantEmails
    const effectiveChallengeState = isTeamChallenge || individualLocationEnabled ? trimmedChallengeState : ''
    const effectiveChallengeCourse = isTeamChallenge || individualLocationEnabled ? trimmedChallengeCourse : ''

    try {
      logFrontendEvent({
        category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge',
        message: isTeamChallenge ? 'team_challenge_send_started' : 'individual_challenge_send_started',
        data: { challengedTeamIdentifier: trimmedChallengeTeamIdentifier, challengedTeamName: selectedChallengedTeam?.name || null, proposerTeamId, proposerTeamName: selectedProposerTeam?.name, challengeDate: trimmedChallengeDate, challengeEndDate: isIndividualChallenge ? trimmedChallengeEndDate : null, challengeState: effectiveChallengeState || null, challengeCourse: effectiveChallengeCourse || null, locationRequired: isTeamChallenge, locationSelected: Boolean(effectiveChallengeCourse), messageType: messageTypeForChallenge, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, participantCount: participantEmails.length },
      })
      const result = await sendInboxMessage(isTeamChallenge
        ? { proposerTeamId, challengedTeamIdentifier: trimmedChallengeTeamIdentifier, challengeDate: trimmedChallengeDate, challengeState: effectiveChallengeState, challengeCourse: effectiveChallengeCourse, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, messageType: messageTypeForChallenge, body: trimmedBody }
        : { individualParticipantEmails: participantEmails, challengeDate: trimmedChallengeDate, challengeEndDate: trimmedChallengeEndDate, challengeState: effectiveChallengeState || null, challengeCourse: effectiveChallengeCourse || null, challengeTeeColor: effectiveChallengeTeeColor, messageType: messageTypeForChallenge, body: trimmedBody })
      setStatus(result.notice || (isTeamChallenge ? 'Your Team Challenge was sent successfully.' : 'Your Individual Challenge was sent successfully.'))
      setChallengedTeamIdentifier('')
      setIndividualChallengeMembers([makeChallengeMemberDraft()])
      const today = getUserTodayISO()
      setTeamChallengeDate(today)
      setIndividualChallengeEndDate(today)
      setTeamChallengeCourse('')
      setTeamChallengeCourseSearch('')
      setIndividualLocationEnabled(false)
      setTeamChallengeTeeColor('')
      setTeamChallengeScoringType('stroke_play')
      setTeamChallengePointsPerHole('1')
      setChallengeBody('')
      setChallengesComposeOpen(false)
      logFrontendEvent({
        category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge',
        message: isTeamChallenge ? 'team_challenge_send_succeeded' : 'individual_challenge_send_succeeded',
        data: { challengedTeamIdentifier: trimmedChallengeTeamIdentifier, challengedTeamName: selectedChallengedTeam?.name || result.message?.challengedTeamName || null, proposerTeamId, challengeDate: trimmedChallengeDate, challengeEndDate: isIndividualChallenge ? trimmedChallengeEndDate : null, challengeState: effectiveChallengeState || null, challengeCourse: effectiveChallengeCourse || null, messageType: messageTypeForChallenge, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, participantCount: participantEmails.length, messageId: result.message?.id, threadId: result.message?.threadId },
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
      logFrontendEvent({ category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge', level: 'error', message: isTeamChallenge ? 'team_challenge_send_failed' : 'individual_challenge_send_failed', data: { challengedTeamIdentifier: trimmedChallengeTeamIdentifier, proposerTeamId, challengeDate: trimmedChallengeDate, challengeEndDate: isIndividualChallenge ? trimmedChallengeEndDate : null, challengeState: effectiveChallengeState || null, challengeCourse: effectiveChallengeCourse || null, messageType: messageTypeForChallenge, challengeTeeColor: effectiveChallengeTeeColor, challengeScoringType: effectiveChallengeScoringType, challengePointsPerHole: effectiveChallengePointsPerHole, participantCount: participantEmails.length, error: message } })
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

  function openIndividualChallengeCoursePicker(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const existingState = String(participant.courseState || '').trim().toUpperCase()
    const profileStateCode = /^[A-Za-z]{2}$/.test(profilePrimaryState.trim()) ? profilePrimaryState.trim().toUpperCase() : ''
    setIndividualCourseState(existingState || profileStateCode)
    setIndividualCourseName(String(participant.courseName || '').trim())
    setIndividualCourseSearch(String(participant.courseName || '').trim())
    setIndividualCourseId(String(participant.courseId || '').trim())
    setIndividualCoursePicker({ message, participant })
    setError(null)
    logFrontendEvent({ category: 'inbox.individualChallenge.course', message: 'individual_challenge_course_picker_opened', data: { messageId: message.id, threadId: messageThreadId(message), participantEmail: participantEmail(participant), existingState: existingState || null, existingCourse: participant.courseName || null } })
  }

  function openIndividualChallengeScorecard(message: InboxMessage, participant: IndividualChallengeParticipant) {
    if (!String(message.challengeCourse || '').trim() && !getIndividualChallengeParticipantCourseName(message, participant)) {
      openIndividualChallengeCoursePicker(message, participant)
      return
    }
    const key = getIndividualChallengeScoreKey(message, participant)
    const holes = getIndividualChallengeHoles(message, participant)
    setIndividualChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
    setActiveIndividualChallengeScorecard({ message, participant })
    logFrontendEvent({ category: 'inbox.individualChallenge.scorecard', message: 'individual_challenge_scorecard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, participantEmail: participantEmail(participant), courseState: getIndividualChallengeParticipantStateCode(message, participant), courseName: getIndividualChallengeParticipantCourseName(message, participant), editable: currentUserCanEditIndividualParticipant(participant), lineItemReviewView: true, reviewColumns: ['Hole', 'Par', 'Score', 'Distance'], reviewHoleCount: holes.length } })
  }

  async function saveIndividualChallengeCourse() {
    const target = individualCoursePicker
    if (!target || !individualCourseState || !individualCourseName) return
    const correlationId = getCorrelationId()
    setSavingIndividualCourse(true)
    setError(null)
    logFrontendEvent({ category: 'inbox.individualChallenge.course', message: 'individual_challenge_course_save_started', data: { correlationId, messageId: target.message.id, threadId: messageThreadId(target.message), participantEmail: participantEmail(target.participant), courseState: individualCourseState, courseName: individualCourseName, courseId: individualCourseId || null } })
    try {
      const updated = await updateIndividualChallengeCourse(target.message.id, { state: individualCourseState, course: individualCourseName, courseId: individualCourseId || null })
      const email = participantEmail(target.participant)
      patchIndividualChallengeUpdate(updated, email)
      const updatedParticipant = (updated.individualChallengeParticipants || []).find((participant) => participantEmail(participant) === email)
      if (!updatedParticipant) throw new Error('The selected golfer could not be refreshed after choosing a course.')
      const key = getIndividualChallengeScoreKey(updated, updatedParticipant)
      setIndividualChallengeScorecards((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      setIndividualCoursePicker(null)
      setStatus(`Golf course selected: ${getIndividualChallengeParticipantCourseName(updated, updatedParticipant)}.`)
      logFrontendEvent({ category: 'inbox.individualChallenge.course', message: 'individual_challenge_course_save_succeeded', data: { correlationId, messageId: updated.id, threadId: messageThreadId(updated), participantEmail: email, courseState: updatedParticipant.courseState || null, courseName: updatedParticipant.courseName || null, courseId: updatedParticipant.courseId || null } })
      openIndividualChallengeScorecard(updated, updatedParticipant)
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save the golf course for this Individual Challenge.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.individualChallenge.course', level: 'error', message: 'individual_challenge_course_save_failed', data: { correlationId, messageId: target.message.id, threadId: messageThreadId(target.message), participantEmail: participantEmail(target.participant), error: messageText } })
    } finally {
      setSavingIndividualCourse(false)
    }
  }

  function updateIndividualChallengeScorecard(message: InboxMessage, participant: IndividualChallengeParticipant, holes: HoleScoreDetail[]) {
    const key = getIndividualChallengeScoreKey(message, participant)
    setIndividualChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
  }

  function toggleThreadExpansion(thread: InboxThread, source: 'messages' | 'team-challenges') {
    const openingThread = expandedThreadId !== thread.threadId
    if (source === 'team-challenges') resetChallengeSections(thread.threadId)
    if (openingThread && source === 'team-challenges') {
      const initialChallenge = getInitialChallengeMessage(thread)
      if (initialChallenge.messageType === 'individual_challenge') void refreshIndividualChallengeParticipantStatuses(initialChallenge, 'challenge_selected')
    }
    setExpandedThreadId((current) => {
      const next = current === thread.threadId ? null : thread.threadId
      if (next !== thread.threadId && replyingTo && messageThreadId(replyingTo) === thread.threadId) {
        setReplyingTo(null)
        setReplyBody('')
      }
      if (next === thread.threadId) {
        setReplyingTo(null)
        setReplyBody('')
        if (source === 'team-challenges') {
          const initialChallenge = getInitialChallengeMessage(thread)
          setChallengeSettingsDraft(buildChallengeSettingsDraft(initialChallenge))
          if (initialChallenge.messageType === 'individual_challenge' && currentUserCreatedInitialChallenge(thread) && !isChallengeCompleted(initialChallenge)) {
            resetIndividualAddMember(thread.threadId)
          } else {
            setIndividualAddMemberThreadId(null)
          }
        }
      } else if (source === 'team-challenges') {
        setChallengeSettingsDraft(null)
        setIndividualAddMemberThreadId(null)
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
    const conversation = getConversationFor(message).filter((item) => !isIndividualChallengeInviteActivityMessage(item) && Boolean(String(item.body || '').trim()))
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
          <span className="small">{[challengeDateLabel(message), message.challengeState, message.challengeCourse, `${teeColorLabel(getTeamChallengeTeeColor(message))} tees`].filter(Boolean).join(' • ')}</span>
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
        <label className="label" htmlFor={`reply-${messageThreadId(message)}`}>{isIndividualChallengeMessage ? 'Say something to your challenge group' : `Reply to ${isTeamChallengeMessage ? (getTeamChallengeDisplayName(message, 'proposer') || getTeamChallengeDisplayName(message, 'challenged') || 'Team Challenge') : (latestMessage.senderName || latestMessage.senderEmail)}`}</label>
        <textarea
          id={`reply-${messageThreadId(message)}`}
          className="input"
          rows={4}
          required
          maxLength={2000}
          value={replyBody}
          onChange={(event) => setReplyBody(event.target.value)}
          placeholder={isTeamChallengeMessage ? 'Write your Team Challenge reply' : (isIndividualChallengeMessage ? 'Smack talk your homiez' : 'Write your reply')}
        />
        {!isIndividualChallengeMessage ? <div className="small">{replyBody.length}/2000 characters</div> : null}
        <div className="pageHeroActions inboxMessageActions">
          <button className="btn btnPrimary btnSmall" type="submit" disabled={replySending || !replyBody.trim()}>{replySending ? 'Sending…' : (isIndividualChallengeMessage ? 'Send' : 'Send Reply')}</button>
          <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(null); setReplyBody('') }}>Cancel</button>
        </div>
      </form>
    )
  }


  function renderChallengeSettingsEditor(message: InboxMessage, canEdit: boolean) {
    if (!canEdit || isChallengeCompleted(message)) return null
    const draft = challengeSettingsDraft?.threadId === messageThreadId(message) ? challengeSettingsDraft : buildChallengeSettingsDraft(message)
    const individualRangeValid = message.messageType !== 'individual_challenge' || Boolean(draft.challengeDate && draft.challengeEndDate && draft.challengeEndDate >= draft.challengeDate && (!maxIndividualChallengeEndDate(draft.challengeDate) || draft.challengeEndDate <= maxIndividualChallengeEndDate(draft.challengeDate)))
    return (
      <div className="challengeSettingsEditor">
        <div className="inboxScoreSectionHeader">
          <div>
            <div className="small inboxConversationTitle">Challenge settings</div>
            <div className="small">The challenge creator can edit these settings until the challenge is completed.</div>
          </div>
        </div>
        <TeeColorSelector value={draft.teeColor} onChange={(value) => patchChallengeSettingsDraft(message, { teeColor: value })} label="Tees played" />
        {message.messageType === 'challenge_request' ? (
          <div className="grid grid2 teamChallengeSkinsOptions">
            <div>
              <label className="label" htmlFor={`challenge-game-${messageThreadId(message)}`}>Team challenge game</label>
              <select id={`challenge-game-${messageThreadId(message)}`} className="input" value={draft.scoringType} onChange={(event) => patchChallengeSettingsDraft(message, { scoringType: normalizeTeamChallengeScoringType(event.target.value) })}>
                <option value="stroke_play">Standard team score</option>
                <option value="skins">Skins</option>
                <option value="skins_push">Skins - Push</option>
              </select>
            </div>
            {isSkinsTeamChallenge(draft.scoringType) ? (
              <div>
                <label className="label" htmlFor={`challenge-points-${messageThreadId(message)}`}>Points per hole</label>
                <input id={`challenge-points-${messageThreadId(message)}`} className="input" type="number" min="0.01" step="0.01" value={draft.pointsPerHole} onChange={(event) => patchChallengeSettingsDraft(message, { pointsPerHole: event.target.value })} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid grid2 individualChallengeSettingsDates">
            <div>
              <label className="label" htmlFor={`challenge-start-${messageThreadId(message)}`}>Start date</label>
              <input
                id={`challenge-start-${messageThreadId(message)}`}
                className="input"
                type="date"
                value={draft.challengeDate}
                onChange={(event) => {
                  const challengeDate = event.target.value
                  const maximum = maxIndividualChallengeEndDate(challengeDate)
                  const challengeEndDate = !draft.challengeEndDate || draft.challengeEndDate < challengeDate || (maximum && draft.challengeEndDate > maximum) ? challengeDate : draft.challengeEndDate
                  patchChallengeSettingsDraft(message, { challengeDate, challengeEndDate })
                }}
              />
            </div>
            <div>
              <label className="label" htmlFor={`challenge-end-${messageThreadId(message)}`}>End date</label>
              <input id={`challenge-end-${messageThreadId(message)}`} className="input" type="date" min={draft.challengeDate || undefined} max={maxIndividualChallengeEndDate(draft.challengeDate) || undefined} value={draft.challengeEndDate} onChange={(event) => patchChallengeSettingsDraft(message, { challengeEndDate: event.target.value })} />
              <div className="small">Maximum challenge length: one month.</div>
            </div>
          </div>
        )}
        <div className="pageHeroActions">
          <button type="button" className="btn btnPrimary btnSmall" disabled={updatingChallengeSettings || !individualRangeValid} onClick={() => void saveChallengeSettings(message)}>{updatingChallengeSettings ? 'Saving…' : 'Save challenge settings'}</button>
        </div>
      </div>
    )
  }

  function renderIndividualChallengeInvites(message: InboxMessage, canManage: boolean) {
    if (message.messageType !== 'individual_challenge' || !canManage) return null
    const participants = getIndividualChallengeParticipants(message)
    const creatorEmail = String(message.senderEmail || '').trim().toLowerCase()
    const invitedParticipants = participants.filter((participant) => participantEmail(participant) !== creatorEmail)
    const completed = isChallengeCompleted(message)
    const addDraft = individualAddMemberThreadId === messageThreadId(message) ? individualAddMemberDraft : makeChallengeMemberDraft()
    const canAdd = !completed && participants.length < 25
    const nameParts = String(addDraft.name || '').trim().split(/\s+/).filter(Boolean)
    return (
      <div className="individualChallengeInviteSection">
        <div className="inboxScoreSectionHeader">
          <div>
            <div className="small inboxConversationTitle">Invited golfers</div>
            <div className="small">{invitedParticipants.length} golfer{invitedParticipants.length === 1 ? '' : 's'} invited</div>
          </div>
        </div>
        {invitedParticipants.length ? (
          <div className="individualChallengeInviteList">
            {invitedParticipants.map((participant) => (
              <div className="individualChallengeInviteRow" key={participantEmail(participant)}>
                <div><strong>{participantDisplayName(participant)}</strong><span className="small">{participantEmail(participant)}</span></div>
                {!participant.userId ? <span className="challengeInviteStatus challengeInviteStatus--pending">Invitation pending</span> : null}
              </div>
            ))}
          </div>
        ) : <div className="small">No additional golfers have been invited yet.</div>}
        {canAdd ? (
          <div className="challengeMemberCard challengeExistingMemberCard">
            <label className="label" htmlFor={`existing-challenge-member-${messageThreadId(message)}`}>Add another golfer</label>
            <div className="challengeMemberEmailRow">
              <input
                id={`existing-challenge-member-${messageThreadId(message)}`}
                className="input"
                type="email"
                value={addDraft.email}
                readOnly={addDraft.validationState === 'validated'}
                onChange={(event) => setIndividualAddMemberDraft({ ...addDraft, email: event.target.value, name: null, validationState: 'idle' })}
                placeholder="Golfer email"
              />
              <button type="button" className="btn btnSmall" disabled={addingIndividualParticipant || addDraft.validationState === 'validated' || !addDraft.email.trim()} onClick={() => void validateIndividualChallengeExistingMember(message)}>{addingIndividualParticipant ? 'Validating…' : addDraft.validationState === 'validated' ? 'Validated' : 'Validate'}</button>
              <button type="button" className="btn btnSmall" onClick={() => resetIndividualAddMember(messageThreadId(message))}>Remove</button>
            </div>
            {addDraft.validationState === 'validated' ? (
              <>
                <div className="grid grid2 challengeValidatedMemberFields">
                  <div><label className="label">First name</label><input className="input" value={nameParts[0] || ''} readOnly /></div>
                  <div><label className="label">Last name</label><input className="input" value={nameParts.slice(1).join(' ')} readOnly /></div>
                </div>
                <button type="button" className="btn btnPrimary btnSmall" disabled={addingIndividualParticipant} onClick={() => void addValidatedIndividualChallengeExistingMember(message)}>{addingIndividualParticipant ? 'Adding…' : '+ Add member'}</button>
              </>
            ) : null}
          </div>
        ) : null}
        {completed ? <div className="small">This challenge is completed, so the invited golfer list is locked.</div> : null}
      </div>
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
        <div className="inboxScoreSectionHeader inboxScoreSectionHeader--actionsOnly">
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
                    <span className="teamScorecardInputBadge">{!message.challengeCourse && !participant.courseName ? 'Choose course to enter score' : 'Tap to enter score'}</span>
                    <strong>{score == null ? 'Pending' : score}</strong>
                    <span>{getIndividualChallengeScorecardSummary(message, participant)}</span>
                    <span>{getIndividualChallengeParticipantCourseName(message, participant) ? `Course: ${getIndividualChallengeParticipantCourseName(message, participant)}` : 'Choose the golf course you are playing for this challenge.'}</span>
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

  function renderTeamChallengeSummaryView(
    message: InboxMessage,
    options: {
      showScorebar?: boolean
      leaderboardMode?: boolean
      onTeamSelect?: (side: TeamChallengeLeaderboardSide) => void
    } = {},
  ) {
    const proposerTeamName = getTeamChallengeTeamName(message, 'proposer')
    const challengedTeamName = getTeamChallengeTeamName(message, 'challenged')
    const proposerHoles = getTeamChallengeHoles(message, 'proposer', false)
    const challengedHoles = getTeamChallengeHoles(message, 'challenged', false)
    const proposerByHole = getHoleByNumber(proposerHoles)
    const challengedByHole = getHoleByNumber(challengedHoles)
    const proposerScore = getTeamChallengeScore(message, 'proposer', false)
    const challengedScore = getTeamChallengeScore(message, 'challenged', false)
    const pointSummary = getTeamChallengePointSummary(message)
    const showPushColumn = pointSummary.scoringType === 'skins_push'
    const showPointsColumn = isSkinsTeamChallenge(pointSummary.scoringType)
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
    const showScorebar = options.showScorebar !== false
    const leaderboardMode = options.leaderboardMode === true
    const tableClassName = `inboxTeamChallengeSummaryTable${showPushColumn ? '' : ' inboxTeamChallengeSummaryTable--noPush'}${showPointsColumn ? '' : ' inboxTeamChallengeSummaryTable--noPoints'}${leaderboardMode ? ' inboxTeamChallengeSummaryTable--leaderboard' : ''}`
    const renderTeamHeader = (side: TeamChallengeLeaderboardSide, teamName: string) => options.onTeamSelect ? (
      <button
        type="button"
        className="inboxTeamChallengeSummaryTeamHeaderButton"
        title={`View ${teamName} round summary`}
        aria-label={`View ${teamName} round summary`}
        onClick={() => options.onTeamSelect?.(side)}
      >
        {teamName}
      </button>
    ) : <span title={teamName}>{teamName}</span>

    return (
      <div className={`inboxTeamChallengeSummaryView${leaderboardMode ? ' inboxTeamChallengeSummaryView--leaderboard' : ''}`} aria-label="Team Challenge scoring summary">
        {showScorebar ? (
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
        ) : null}

        <div className={tableClassName} role="table" aria-label="Hole-by-hole Team Challenge summary">
          <div className="inboxTeamChallengeSummaryHeader" role="row">
            <span>Hole</span>
            <span>Par</span>
            {renderTeamHeader('proposer', proposerTeamName)}
            {renderTeamHeader('challenged', challengedTeamName)}
            <span>Winner</span>
            {showPushColumn ? <span>Push</span> : null}
            {showPointsColumn ? <span>Points</span> : null}
          </div>
          {rows.map((row) => (
            <div key={row.holeNumber} className="inboxTeamChallengeSummaryRow" role="row">
              <strong>{row.holeNumber}</strong>
              <span>{row.par == null ? '—' : row.par}</span>
              <span className="inboxTeamChallengeSummaryScore"><HoleStrokeScore score={row.proposerHole?.scoreProvided ? row.proposerHole.score : null} par={row.par} compact /></span>
              <span className="inboxTeamChallengeSummaryScore"><HoleStrokeScore score={row.challengedHole?.scoreProvided ? row.challengedHole.score : null} par={row.par} compact /></span>
              <span className={`inboxTeamChallengeSummaryWinner inboxTeamChallengeSummaryWinner--${row.result.winner}`}>{getTeamChallengeSummaryWinnerLabel(message, row.result.winner)}</span>
              {showPushColumn ? <span>{row.pushedPoints > 0 ? formatPointNumber(row.pushedPoints) : '—'}</span> : null}
              {showPointsColumn ? <strong className="inboxTeamChallengeSummaryPoints">{row.pointLeadLabel}</strong> : null}
            </div>
          ))}
          <div className="inboxTeamChallengeSummaryRow inboxTeamChallengeSummaryRow--total" role="row">
            <strong>Total</strong>
            <span>{rows.reduce((sum, row) => sum + (row.par || 0), 0)}</span>
            <span>{proposerScore == null ? '—' : proposerScore}</span>
            <span>{challengedScore == null ? '—' : challengedScore}</span>
            <span>—</span>
            {showPushColumn ? <span>{pushedPointsTotal > 0 ? formatPointNumber(pushedPointsTotal) : '—'}</span> : null}
            {showPointsColumn ? <strong className="inboxTeamChallengeSummaryPoints">{finalLeadLabel}</strong> : null}
          </div>
        </div>
        {leaderboardMode ? (
          <div className="inboxLeaderboardUpdated">
            {pointSummary.completedHoles} of {holeNumbers.length} holes have scores from both teams • Select a team name for its round summary
          </div>
        ) : null}
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
                stateCode={getIndividualChallengeParticipantStateCode(message, participant)}
                course={getIndividualChallengeParticipantCourseName(message, participant)}
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
    const selectedSide = activeTeamLeaderboardSide
    const selectedTeamName = selectedSide ? getTeamChallengeDisplayName(message, selectedSide) : ''
    const selectedSummaryRows = selectedSide ? getTeamRoundSummaryRows(message, selectedSide) : []
    const rankedTeams = getTeamChallengeLeaderboardRows(message)

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
                    <span><HoleStrokeScore score={row.score} par={row.par} compact /></span>
                    <strong>{row.relativeLabel}</strong>
                    <strong>{row.totalLabel}</strong>
                  </div>
                ))}
              </div>
              <div className="inboxIndividualRoundSummaryLegend">Round is the current cumulative score over or under par. Total is the current cumulative stroke score.</div>
            </div>
          ) : (
            <div className="inboxLeaderboardBoard inboxTeamChallengeHoleLeaderboardBoard">
              <div className="inboxTeamRankings" role="table" aria-label="Team Challenge stack rank">
                <div className="inboxLeaderboardHeaderRow inboxTeamRankingsHeader" role="row">
                  <span>POS</span><span>TEAM</span><span>ROUND</span><span>THRU</span><span>TOTAL</span>
                </div>
                {rankedTeams.map((row) => (
                  <button
                    type="button"
                    role="row"
                    className="inboxLeaderboardRow inboxTeamRankingsRow"
                    key={row.side}
                    onClick={() => {
                      logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_stack_rank_selected', data: { messageId: message.id, threadId: messageThreadId(message), side: row.side, teamName: row.teamName, position: row.position } })
                      openTeamLeaderboardRoundSummary(message, row.side)
                    }}
                  >
                    <strong>{row.position}</strong>
                    <span className="inboxLeaderboardPlayer"><strong>{row.teamName}</strong><small>{row.pointsRelativeLabel}</small></span>
                    <strong>{row.roundLabel}</strong>
                    <strong>{row.thru || '—'}</strong>
                    <strong>{row.totalLabel}</strong>
                  </button>
                ))}
              </div>
              <div className="inboxTeamComparisonHeading">Hole-by-hole comparison</div>
              {renderTeamChallengeSummaryView(message, {
                showScorebar: false,
                leaderboardMode: true,
                onTeamSelect: (side) => openTeamLeaderboardRoundSummary(message, side),
              })}
            </div>
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
            {selectedParticipant ? <span className="inboxIndividualRoundSummaryCourse">{getIndividualChallengeParticipantCourseName(message, selectedParticipant) || 'Course not selected'}</span> : null}
            <span>{[message.challengeDate, selectedParticipant ? getIndividualChallengeParticipantStateCode(message, selectedParticipant) : message.challengeState, `${teeColorLabel(getTeamChallengeTeeColor(message))} tees`].filter(Boolean).join(' • ')}</span>
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
                    <span><HoleStrokeScore score={row.score} par={row.par} compact /></span>
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
                <span>POS</span><span>PLAYER / COURSE</span><span>ROUND</span><span>THRU</span><span>TOTAL</span>
              </div>
              {rows.length === 0 ? <div className="inboxLeaderboardEmpty">No golfers have entered a score yet.</div> : null}
              {rows.map((row) => {
                const name = participantDisplayName(row.participant)
                const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GH'
                const positionClass = row.position <= 3 ? `inboxLeaderboardRow--top${row.position}` : ''
                return (
                  <button type="button" key={participantEmail(row.participant)} className={`inboxLeaderboardRow inboxLeaderboardRow--clickable ${positionClass}`} onClick={() => openIndividualLeaderboardRoundSummary(message, row.participant)} aria-label={`View ${name} round summary`}>
                    <div className="inboxLeaderboardPosition"><span>{row.position}</span></div>
                    <div className="inboxLeaderboardPlayer"><div className="inboxLeaderboardAvatar" aria-hidden="true">{initials}</div><div><strong>{name}</strong><span>{participantEmail(row.participant)}</span><span className="inboxLeaderboardCourseName">{row.courseName}{row.courseState ? ` · ${row.courseState}` : ''}</span></div></div>
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


  function renderIndividualChallengeCoursePickerModal() {
    const target = individualCoursePicker
    if (!target) return null
    const golferName = participantDisplayName(target.participant)
    return (
      <div className="modalOverlay" role="presentation" onClick={() => !savingIndividualCourse && setIndividualCoursePicker(null)}>
        <div className="modalCard individualChallengeCoursePickerModal" role="dialog" aria-modal="true" aria-label="Choose Individual Challenge golf course" onClick={(event) => event.stopPropagation()}>
          <div className="modalHeader">
            <div>
              <h2>Choose golf course</h2>
              <div className="small">{golferName} can play this Individual Challenge at any course because the challenge creator did not assign one.</div>
            </div>
            <button type="button" className="btn btnSmall" disabled={savingIndividualCourse} onClick={() => setIndividualCoursePicker(null)}>Close</button>
          </div>
          <div className="formStack">
            <div>
              <label className="label" htmlFor="individualParticipantCourseState">State</label>
              <select
                id="individualParticipantCourseState"
                className="input"
                value={individualCourseState}
                onChange={(event) => {
                  setIndividualCourseState(event.target.value)
                  setIndividualCourseName('')
                  setIndividualCourseSearch('')
                  setIndividualCourseId('')
                }}
                disabled={individualCourseStatesLoading && !individualCourseStateOptions.length}
                required
              >
                <option value="">{individualCourseStatesLoading ? 'Loading states…' : 'Select state'}</option>
                {individualCourseStateOptions.map((state) => <option key={state.abbr} value={state.abbr}>{state.name}</option>)}
              </select>
              {individualCourseStatesError ? <div className="small">{individualCourseStatesError}</div> : null}
            </div>
            <GolfCourseInput
              label="Golf course"
              state={individualCourseState}
              searchValue={individualCourseSearch}
              selectedCourseName={individualCourseName}
              selectedCourseId={individualCourseId}
              onSearchChange={(next) => {
                setIndividualCourseSearch(next)
                setIndividualCourseName('')
                setIndividualCourseId('')
              }}
              onCourseSelected={(selected) => {
                setIndividualCourseState(String(selected.state || selected.state_code || individualCourseState).toUpperCase())
                setIndividualCourseName(selected.name || '')
                setIndividualCourseSearch(selected.name || '')
                setIndividualCourseId(selected.id || '')
              }}
              placeholder="Search courses in the selected state"
              inputId="individualParticipantCourseSearch"
              required
            />
          </div>
          <div className="pageHeroActions">
            <button type="button" className="btn" disabled={savingIndividualCourse} onClick={() => setIndividualCoursePicker(null)}>Cancel</button>
            <button type="button" className="btn btnPrimary" disabled={savingIndividualCourse || !individualCourseState || !individualCourseName} onClick={() => void saveIndividualChallengeCourse()}>{savingIndividualCourse ? 'Saving…' : 'Continue to scorecard'}</button>
          </div>
        </div>
      </div>
    )
  }

  function renderIndividualChallengeParticipantsModal() {
    const message = individualChallengeParticipantsModal
    if (!message) return null
    const participants = getIndividualChallengeParticipants(message)
    return (
      <div
        className="modalOverlay"
        role="presentation"
        onClick={() => {
          setIndividualChallengeParticipantsModal(null)
          logFrontendEvent({ category: 'inbox.individualChallenge.members', message: 'individual_challenge_participant_list_closed', data: { messageId: message.id, threadId: messageThreadId(message) } })
        }}
      >
        <div className="modalCard individualChallengeParticipantsModalCard" role="dialog" aria-modal="true" aria-label="Individual Challenge golfers" onClick={(event) => event.stopPropagation()}>
          <div className="modalHeader">
            <div>
              <h2>Individual Challenge golfers</h2>
              <div className="small">{participants.length} golfer{participants.length === 1 ? '' : 's'} in this challenge</div>
            </div>
            <button type="button" className="btn btnSmall" onClick={() => setIndividualChallengeParticipantsModal(null)}>Close</button>
          </div>
          <div className="individualChallengeInviteList">
            {participants.map((participant) => (
              <div className="individualChallengeInviteRow" key={participantEmail(participant)}>
                <div>
                  <strong>{participantDisplayName(participant)}</strong>
                  <span className="small">{participantEmail(participant)}</span>
                </div>
                {!participant.userId ? <span className="challengeInviteStatus challengeInviteStatus--pending">Invitation pending</span> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderTeamChallengeMembersModal() {
    const message = teamChallengeMembersModal
    if (!message) return null
    const proposerTeam = getTeamForChallengeSide(message, 'proposer')
    const challengedTeam = getTeamForChallengeSide(message, 'challenged')
    const sides = [
      { side: 'proposer' as const, team: proposerTeam, label: getTeamChallengeDisplayName(message, 'proposer') },
      { side: 'challenged' as const, team: challengedTeam, label: getTeamChallengeDisplayName(message, 'challenged') },
    ]
    return (
      <div className="modalOverlay" role="presentation" onClick={() => setTeamChallengeMembersModal(null)}>
        <div className="modalCard teamChallengeMembersModal" role="dialog" aria-modal="true" aria-label="Team Challenge golfers" onClick={(event) => event.stopPropagation()}>
          <div className="modalHeader">
            <div><h2>Team Challenge golfers</h2><div className="small">{getTeamChallengeDisplayName(message, 'proposer')} vs {getTeamChallengeDisplayName(message, 'challenged')}</div></div>
            <button type="button" className="btn btnSmall" onClick={() => setTeamChallengeMembersModal(null)}>Close</button>
          </div>
          <div className="teamChallengeMembersGrid">
            {sides.map(({ side, team, label }) => (
              <section className="teamChallengeMembersTeam" key={side}>
                <h3>{label}</h3>
                {team?.members?.length ? (
                  <div className="teamChallengeMembersList">
                    {team.members.map((member) => (
                      <div className="teamChallengeMemberRow" key={member.id || member.email}>
                        <strong>{teamMemberDisplayName(member)}</strong>
                        <span className="small">{member.email || 'Email not available'}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="small">Team member information is not available.</div>}
              </section>
            ))}
          </div>
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
      : 'Individual Challenge'
    const individualParticipantCount = isIndividualChallengeMessage ? getIndividualChallengeParticipants(challengeMessage).length : 0
    const challengeMetadata = [challengeDateLabel(challengeMessage), challengeMessage.challengeState, challengeMessage.challengeCourse].filter(Boolean).join(' • ')
    const settingsExpanded = source === 'team-challenges' && isChallengeSectionExpanded(challengeMessage, 'settings')
    const scoreExpanded = source === 'team-challenges' && isChallengeSectionExpanded(challengeMessage, 'score')
    const discussionExpanded = source === 'team-challenges' && isChallengeSectionExpanded(challengeMessage, 'discussion')
    const activeChallengeSection: ChallengeDetailSection | null = settingsExpanded ? 'settings' : (scoreExpanded ? 'score' : (discussionExpanded ? 'discussion' : null))
    const completedResult = source === 'team-challenges' && challengeCompleted ? getCompletedChallengeResultLabel(challengeMessage) : ''
    const visibleConversation = getConversationFor(challengeMessage).filter((item) => !isIndividualChallengeInviteActivityMessage(item) && Boolean(String(item.body || '').trim()))

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
            <span>{challengeMetadata || getMessagePreview(latestMessage.body)}</span>
          </span>
          {thread.unreadCount > 0 ? <span className="inboxChallengeLineItemActivity"><strong>{unreadText}</strong></span> : null}
          <span className={`inboxChallengeLineItemStatus inboxChallengeLineItemStatus--${challengeStatusClass}`}>{challengeStatusLabel}</span>
          <span className="inboxChallengeLineItemChevron" aria-hidden="true">{isExpanded ? '⌃' : '›'}</span>
        </button>
        {isTeamChallengeMessage ? (
          <div className="teamChallengeMembersLinkBar">
            <button
              type="button"
              className="teamChallengeMembersLink"
              onClick={() => {
                setTeamChallengeMembersModal(challengeMessage)
                logFrontendEvent({ category: 'inbox.teamChallenge.members', message: 'team_challenge_members_modal_opened', data: { messageId: challengeMessage.id, threadId: messageThreadId(challengeMessage), proposerTeamId: challengeMessage.proposerTeamId || null, challengedTeamId: challengeMessage.challengedTeamId || null } })
              }}
            >
              {challengeTitle}
            </button>
          </div>
        ) : null}
        {isIndividualChallengeMessage ? (
          <div className="individualChallengeParticipantCountBar">
            <button
              type="button"
              className="individualChallengeParticipantCountButton"
              disabled={refreshingIndividualParticipantsThreadId === messageThreadId(challengeMessage)}
              onClick={() => void openIndividualChallengeParticipants(challengeMessage)}
            >
              {refreshingIndividualParticipantsThreadId === messageThreadId(challengeMessage) ? 'Refreshing golfers…' : `${individualParticipantCount} golfer${individualParticipantCount === 1 ? '' : 's'} Individual Challenge`}
            </button>
          </div>
        ) : null}
        {completedResult ? <div className="challengeCompletedResultLine">{completedResult}</div> : null}

        {isExpanded ? (
          <div id={`challenge-details-${thread.threadId}`} className="inboxChallengeLineItemDetails">
            {source === 'team-challenges' ? (
              <div className="challengeDetailSections">
                {activeChallengeSection === null || activeChallengeSection === 'settings' ? <section className="challengeDetailSection">
                  <button type="button" className="challengeDetailSectionLink" aria-expanded={settingsExpanded} onClick={() => toggleChallengeSection(challengeMessage, 'settings')}>
                    <span>Challenge Settings</span><span aria-hidden="true">{settingsExpanded ? '−' : '+'}</span>
                  </button>
                  {settingsExpanded ? (
                    <div className="challengeDetailSectionContent">
                      {renderTeamChallengeContext(challengeMessage)}
                      {renderChallengeSettingsEditor(challengeMessage, currentUserCreatedInitialChallenge(thread))}
                      {isIndividualChallengeMessage ? renderIndividualChallengeInvites(challengeMessage, currentUserCreatedInitialChallenge(thread)) : null}
                    </div>
                  ) : null}
                </section> : null}

                {activeChallengeSection === null || activeChallengeSection === 'score' ? <section className="challengeDetailSection">
                  <button type="button" className="challengeDetailSectionLink" aria-expanded={scoreExpanded} onClick={() => toggleChallengeSection(challengeMessage, 'score')}>
                    <span>Challenge Score</span><span aria-hidden="true">{scoreExpanded ? '−' : '+'}</span>
                  </button>
                  {scoreExpanded ? (
                    <div className="challengeDetailSectionContent">
                      {isTeamChallengeMessage ? renderTeamChallengeScores(challengeMessage) : null}
                      {isIndividualChallengeMessage ? renderIndividualChallengeScores(challengeMessage) : null}
                    </div>
                  ) : null}
                </section> : null}

                {activeChallengeSection === null || activeChallengeSection === 'discussion' ? <section className="challengeDetailSection">
                  <button type="button" className="challengeDetailSectionLink" aria-expanded={discussionExpanded} onClick={() => toggleChallengeSection(challengeMessage, 'discussion')}>
                    <span>Challenge Discussion</span><span aria-hidden="true">{discussionExpanded ? '−' : '+'}</span>
                  </button>
                  {discussionExpanded ? (
                    <div className="challengeDetailSectionContent challengeDiscussionContent">
                      {visibleConversation.length <= 1 && latestMessage.body ? <p className="inboxMessageBody">{latestMessage.body}</p> : null}
                      {renderConversation(challengeMessage)}
                      {!challengeCompleted ? (
                        <div className="pageHeroActions inboxMessageActions">
                          <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(getLatestConversationMessage(challengeMessage)); setReplyBody('') }}>{isIndividualChallengeMessage ? 'Say Something' : 'Reply'}</button>
                        </div>
                      ) : null}
                      {renderReplyForm(challengeMessage)}
                    </div>
                  ) : null}
                </section> : null}
              </div>
            ) : (
              <>
                {latestMessage.body ? <p className="inboxMessageBody">{latestMessage.body}</p> : null}
                {renderConversation(challengeMessage)}
                {renderReplyForm(challengeMessage)}
              </>
            )}
            <div className="challengeExitActions">
              {source !== 'team-challenges' && !challengeCompleted ? <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(getLatestConversationMessage(challengeMessage)); setReplyBody('') }}>Reply</button> : null}
              <button
                type="button"
                className="btn btnSmall challengeExitChallengeButton"
                onClick={() => {
                  logFrontendEvent({ category: 'inbox.challenge.navigation', message: 'exit_challenge_clicked', data: { threadId: thread.threadId, messageId: challengeMessage.id, messageType: challengeMessage.messageType, activeSection: activeChallengeSection } })
                  toggleThreadExpansion(thread, source)
                }}
              >
                Exit Challenge
              </button>
              {source === 'team-challenges' && !activeChallengeSection ? (
                <div className="challengeManagementActions">
                  {canCompleteChallenge ? (
                    <button type="button" className="btn btnPrimary btnSmall" disabled={completingChallengeThreadId === messageThreadId(challengeMessage)} onClick={() => void handleCompleteChallenge(thread)}>
                      {completingChallengeThreadId === messageThreadId(challengeMessage) ? 'Completing…' : 'Complete Challenge'}
                    </button>
                  ) : null}
                  <button type="button" className="btn btnSmall" disabled={updatingChallengeDeleteThreadId === messageThreadId(challengeMessage)} onClick={() => void handleChallengeDeletedState(thread, challengeView !== 'deleted')}>
                    {updatingChallengeDeleteThreadId === messageThreadId(challengeMessage) ? 'Updating…' : (challengeView === 'deleted' ? 'Restore Challenge' : 'Delete Challenge')}
                  </button>
                </div>
              ) : null}
            </div>
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
                setExpandedThreadId(null)
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
                  <label className="label">Challenge format</label>
                  <div className="small">You and the golfers you invite participate individually. Each golfer records only their own score.</div>
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


            {isIndividualChallenge ? (
              <div className="challengeMemberBuilder">
                <div className="label">Challenge members</div>
                <div className="challengeMemberCard challengeMemberCard--current">
                  <strong>{user?.name || user?.email || 'You'}</strong>
                  <span className="small">{user?.email || ''}</span>
                </div>
                {individualChallengeMembers.map((member, index) => {
                  const nameParts = String(member.name || '').trim().split(/\s+/).filter(Boolean)
                  const firstName = nameParts[0] || ''
                  const lastName = nameParts.slice(1).join(' ')
                  const locked = member.validationState === 'validated' || member.validationState === 'invited'
                  return (
                    <div className="challengeMemberCard" key={member.id}>
                      <label className="label" htmlFor={`challenge-member-${member.id}`}>Email</label>
                      <div className="challengeMemberEmailRow">
                        <input
                          id={`challenge-member-${member.id}`}
                          className="input"
                          type="email"
                          value={member.email}
                          readOnly={locked}
                          onChange={(event) => patchIndividualChallengeCreateMember(member.id, event.target.value)}
                          placeholder={`Member ${index + 2} email`}
                        />
                        <button type="button" className="btn btnSmall" disabled={member.validationState === 'checking' || locked || !member.email.trim()} onClick={() => void validateIndividualChallengeCreateMember(member.id)}>
                          {member.validationState === 'checking' ? 'Validating…' : locked ? 'Validated' : 'Validate'}
                        </button>
                        <button type="button" className="btn btnSmall" onClick={() => removeIndividualChallengeCreateMember(member.id)}>Remove</button>
                      </div>
                      {member.validationState === 'validated' ? (
                        <div className="grid grid2 challengeValidatedMemberFields">
                          <div><label className="label">First name</label><input className="input" value={firstName} readOnly /></div>
                          <div><label className="label">Last name</label><input className="input" value={lastName} readOnly /></div>
                        </div>
                      ) : null}
                      {member.validationState === 'invited' ? <div className="small">GolfHomiez invitation sent. This golfer will be included in the challenge.</div> : null}
                    </div>
                  )
                })}
                <button type="button" className="btn btnSmall challengeAddMemberButton" disabled={individualChallengeMembers.length >= 24} onClick={addIndividualChallengeCreateMember}>+ Add member</button>
                <div className="small">Validate each golfer before sending. You can invite up to 24 other golfers now and continue adding golfers until the challenge is completed.</div>
              </div>
            ) : null}

            {isTeamChallenge ? (
              <div className="grid grid3 inboxTeamChallengeCourseGrid">
                <div>
                  <label className="label" htmlFor="teamChallengeDate">Date</label>
                  <input id="teamChallengeDate" className="input" type="date" value={teamChallengeDate} onChange={(event) => setTeamChallengeDate(event.target.value)} required />
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
                    {stateOptions.map((state) => <option key={state.abbr} value={state.abbr}>{state.name}</option>)}
                  </select>
                  {statesError ? <div className="small">{statesError}</div> : null}
                  {profilePrimaryState ? <div className="small">Defaults to your profile state.</div> : null}
                </div>
                <div>
                  <GolfCourseInput
                    label="Course"
                    state={teamChallengeState}
                    searchValue={teamChallengeCourseSearch}
                    selectedCourseName={teamChallengeCourse}
                    onSearchChange={(next) => { setTeamChallengeCourseSearch(next); setTeamChallengeCourse('') }}
                    onCourseSelected={(selected) => { setTeamChallengeCourse(selected.name || ''); setTeamChallengeCourseSearch(selected.name || '') }}
                    placeholder="Search courses in the selected state"
                    inputId="teamChallengeCourseSearch"
                    disabled={!challengesComposeOpen}
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="formStack individualChallengeSchedule">
                <div className="grid grid2">
                  <div>
                    <label className="label" htmlFor="individualChallengeStartDate">Start date</label>
                    <input
                      id="individualChallengeStartDate"
                      className="input"
                      type="date"
                      value={teamChallengeDate}
                      onChange={(event) => {
                        const nextStart = event.target.value
                        const maximum = maxIndividualChallengeEndDate(nextStart)
                        setTeamChallengeDate(nextStart)
                        setIndividualChallengeEndDate((current) => !current || current < nextStart || (maximum && current > maximum) ? nextStart : current)
                      }}
                      required
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="individualChallengeEndDate">End date</label>
                    <input
                      id="individualChallengeEndDate"
                      className="input"
                      type="date"
                      min={teamChallengeDate || undefined}
                      max={maxIndividualChallengeEndDate(teamChallengeDate) || undefined}
                      value={individualChallengeEndDate}
                      onChange={(event) => setIndividualChallengeEndDate(event.target.value)}
                      required
                    />
                    <div className="small">Individual Challenges can run for up to one month.</div>
                  </div>
                </div>
                <label className="challengeOptionalLocationToggle">
                  <input
                    type="checkbox"
                    checked={individualLocationEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      setIndividualLocationEnabled(enabled)
                      if (!enabled) {
                        setTeamChallengeCourse('')
                        setTeamChallengeCourseSearch('')
                      }
                      logFrontendEvent({ category: 'inbox.individualChallenge.location', message: 'individual_challenge_optional_location_toggled', data: { enabled } })
                    }}
                  />
                  <span>Use a specific golf course (optional)</span>
                </label>
                <div className="small">Leave location off to let each golfer play their challenge round at any course.</div>
                {individualLocationEnabled ? (
                  <div className="grid grid2 inboxTeamChallengeCourseGrid">
                    <div>
                      <label className="label" htmlFor="individualChallengeState">State</label>
                      <select
                        id="individualChallengeState"
                        className="input"
                        value={teamChallengeState}
                        onChange={(event) => { setTeamChallengeState(event.target.value); setTeamChallengeCourse(''); setTeamChallengeCourseSearch('') }}
                        required
                        disabled={statesLoading && !stateOptions.length}
                      >
                        {!stateOptions.length ? <option value={teamChallengeState}>{statesLoading ? 'Loading golf course states…' : (teamChallengeState || 'No golf course states available')}</option> : null}
                        {stateOptions.map((state) => <option key={state.abbr} value={state.abbr}>{state.name}</option>)}
                      </select>
                      {profilePrimaryState ? <div className="small">Defaults to your profile state.</div> : null}
                    </div>
                    <GolfCourseInput
                      label="Course"
                      state={teamChallengeState}
                      searchValue={teamChallengeCourseSearch}
                      selectedCourseName={teamChallengeCourse}
                      onSearchChange={(next) => { setTeamChallengeCourseSearch(next); setTeamChallengeCourse('') }}
                      onCourseSelected={(selected) => { setTeamChallengeCourse(selected.name || ''); setTeamChallengeCourseSearch(selected.name || '') }}
                      placeholder="Search courses in the selected state"
                      inputId="individualChallengeCourseSearch"
                      disabled={!challengesComposeOpen}
                      required
                    />
                  </div>
                ) : null}
              </div>
            )}

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
              <label className="label" htmlFor="challengeMessageBody">Challenge Message (optional)</label>
              <textarea
                id="challengeMessageBody"
                className="input"
                rows={5}
                maxLength={2000}
                value={challengeBody}
                onChange={(event) => setChallengeBody(event.target.value)}
                placeholder={isTeamChallenge ? 'Optional: write your Team Challenge details' : 'Optional: write your Individual Challenge details'}
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

        {!challengesComposeOpen ? (
          <>
            {loading ? null : visibleChallengeThreads.length === 0 ? <div className="small">{challengeView === 'completed' ? 'No completed Challenges.' : (challengeView === 'deleted' ? 'No deleted Challenges.' : 'No active Challenges yet.')}</div> : null}
            <div className="inboxMessageList">
              {displayedChallengeThreads.map((thread) => renderThreadCard(thread, 'team-challenges'))}
            </div>
          </>
        ) : null}
      </section>

      {renderTeamChallengeScorecardModal()}
      {renderTeamChallengeMembersModal()}
      {renderIndividualChallengeCoursePickerModal()}
      {renderIndividualChallengeScorecardModal()}
      {renderTeamChallengeLeaderboardModal()}
      {renderIndividualChallengeLeaderboardModal()}
      {renderIndividualChallengeParticipantsModal()}
      <InviteHomieModal
        open={individualInviteOpen}
        defaultEmail={individualInviteTarget?.email || ''}
        title="Invite golfer to GolfHomiez"
        submitLabel="Send GolfHomiez invite"
        onClose={() => {
          setIndividualInviteOpen(false)
          setIndividualInviteTarget(null)
        }}
        onSubmit={handleIndividualInviteSubmit}
      />
    </div>
  )
}
