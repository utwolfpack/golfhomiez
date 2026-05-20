import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import HoleByHoleScorecard from '../components/HoleByHoleScorecard'
import UseMyLocationButton from '../components/UseMyLocationButton'
import { useAuth } from '../context/AuthContext'
import {
  fetchInboxMessages,
  fetchSentInboxMessages,
  markInboxMessageRead,
  RecipientNotFoundError,
  replyToInboxMessage,
  sendInboxMessage,
  TeamNotFoundError,
  updateTeamChallengeScore,
  updateIndividualChallengeScore,
  type IndividualChallengeParticipant,
  type InboxMessage,
  type InboxMessageType,
} from '../lib/inbox'
import { fetchTeams } from '../lib/teams'
import { api } from '../lib/api'
import { getUserTodayISO } from '../lib/date'
import { US_STATES } from '../data/usStates'
import { logFrontendEvent } from '../lib/frontend-logger'
import { buildClientDefaultHoleScorecard, formatHoleScoreOutcome, holeScoreTotal, missingHoleScoreNumbers, normalizeHoleScorecard, scoreOutcomeClassName } from '../lib/hole-scorecard'
import type { HoleScoreDetail, Team } from '../types'

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
  const [challengeType, setChallengeType] = useState<'team' | 'individual'>('team')
  const [proposerTeamId, setProposerTeamId] = useState('')
  const [challengedTeamName, setChallengedTeamName] = useState('')
  const [teamChallengeDate, setTeamChallengeDate] = useState(() => getUserTodayISO())
  const [teamChallengeState, setTeamChallengeState] = useState('UT')
  const [teamChallengeCourse, setTeamChallengeCourse] = useState('')
  const [teamChallengeCourses, setTeamChallengeCourses] = useState<string[]>([])
  const [teamChallengeLocationMessage, setTeamChallengeLocationMessage] = useState<string | null>(null)
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
  const [activeTeamChallengeLeaderboard, setActiveTeamChallengeLeaderboard] = useState<InboxMessage | null>(null)
  const [refreshingLeaderboard, setRefreshingLeaderboard] = useState(false)
  const [markingReadThreadId, setMarkingReadThreadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const currentUserEmail = useMemo(() => String(user?.email || '').trim().toLowerCase(), [user?.email])
  const myTeams = useMemo(() => teams.filter((team) => teamContainsEmail(team, currentUserEmail)), [teams, currentUserEmail])
  const selectedProposerTeam = useMemo(() => myTeams.find((team) => team.id === proposerTeamId) || null, [myTeams, proposerTeamId])
  const teamChallengeOptions = useMemo(() => teams.filter((team) => team.id !== proposerTeamId), [teams, proposerTeamId])
  const isTeamChallenge = challengeType === 'team'
  const isIndividualChallenge = challengeType === 'individual'
  const parsedIndividualParticipantEmails = useMemo(() => parseIndividualChallengeEmails(individualParticipantEmails), [individualParticipantEmails])
  const canSubmitChallenge = Boolean(challengeBody.trim() && teamChallengeDate && teamChallengeState && teamChallengeCourse) && (isTeamChallenge ? Boolean(proposerTeamId && challengedTeamName.trim()) : parsedIndividualParticipantEmails.length > 0 && parsedIndividualParticipantEmails.length <= 25)
  const teamChallengeMessages = useMemo(() => uniqueInboxMessages([...messages, ...sentChallenges].filter(isChallengeMessage)), [messages, sentChallenges])
  const teamChallengeThreads = useMemo(() => buildInboxThreads(teamChallengeMessages), [teamChallengeMessages])
  const allConversationMessages = useMemo(() => uniqueInboxMessages([...messages, ...sentMessages, ...sentChallenges]), [messages, sentMessages, sentChallenges])

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
    return side === 'proposer' ? (message.proposerTeamName || 'Proposing team') : (message.challengedTeamName || 'Challenged team')
  }

  function getTeamChallengeStateCode(message: InboxMessage) {
    return String(message.challengeState || '').trim().toUpperCase()
  }

  function getTeamChallengeCourseName(message: InboxMessage) {
    return String(message.challengeCourse || '').trim() || 'Team Challenge'
  }

  function getStoredTeamChallengeHoles(message: InboxMessage, side: 'proposer' | 'challenged') {
    const holes = side === 'proposer' ? message.proposerTeamHoles : message.challengedTeamHoles
    return Array.isArray(holes) && holes.length ? normalizeHoleScorecard(holes, getTeamChallengeStateCode(message), getTeamChallengeCourseName(message)) : null
  }

  function getTeamChallengeHoles(message: InboxMessage, side: 'proposer' | 'challenged') {
    const key = getTeamChallengeScoreKey(message, side)
    if (teamChallengeScorecards[key]) return teamChallengeScorecards[key]
    return getStoredTeamChallengeHoles(message, side) || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(message), getTeamChallengeCourseName(message))
  }

  function getTeamChallengeScore(message: InboxMessage, side: 'proposer' | 'challenged') {
    const holes = getTeamChallengeHoles(message, side)
    const providedCount = holes.filter((hole) => hole.scoreProvided).length
    if (providedCount > 0) return holeScoreTotal(holes)
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
    return `${providedCount} of ${holes.length || 18} holes entered • Current score ${holeScoreTotal(holes)}`
  }


  function getTeamChallengeLeaderboardRows(message: InboxMessage) {
    const sides: Array<{ side: 'proposer' | 'challenged'; name: string }> = [
      { side: 'proposer', name: message.proposerTeamName || 'Proposing team' },
      { side: 'challenged', name: message.challengedTeamName || 'Challenged team' },
    ]

    return sides
      .map((entry) => {
        const holes = getTeamChallengeHoles(message, entry.side)
        const enteredHoles = holes.filter((hole) => hole.scoreProvided)
        const score = getTeamChallengeScore(message, entry.side)
        const parTotal = enteredHoles.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0)
        const relativeScore = score == null || enteredHoles.length === 0 ? null : score - parTotal
        return {
          side: entry.side,
          teamName: entry.name,
          holes,
          score,
          thru: enteredHoles.length,
          relativeScore,
          roundLabel: formatLeaderboardRelative(relativeScore),
          totalLabel: score == null ? 'Pending' : formatLeaderboardRelative(relativeScore),
        }
      })
      .sort((a, b) => {
        if (a.relativeScore == null && b.relativeScore == null) return a.teamName.localeCompare(b.teamName)
        if (a.relativeScore == null) return 1
        if (b.relativeScore == null) return -1
        if (a.relativeScore !== b.relativeScore) return a.relativeScore - b.relativeScore
        return (a.score ?? Number.MAX_SAFE_INTEGER) - (b.score ?? Number.MAX_SAFE_INTEGER)
      })
      .map((row, index) => ({ ...row, position: index + 1 }))
  }

  function openTeamChallengeLeaderboard(message: InboxMessage) {
    setActiveTeamChallengeLeaderboard(message)
    logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, proposerTeamId: message.proposerTeamId, challengedTeamId: message.challengedTeamId } })
  }

  async function refreshTeamChallengeLeaderboard() {
    if (!activeTeamChallengeLeaderboard) return
    const activeThreadId = messageThreadId(activeTeamChallengeLeaderboard)
    setRefreshingLeaderboard(true)
    try {
      logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_refresh_started', data: { messageId: activeTeamChallengeLeaderboard.id, threadId: activeThreadId } })
      const loaded = await loadInbox()
      const refreshed = loaded ? uniqueInboxMessages([...(loaded.inboxMessages || []), ...(loaded.sentChallenges || [])])
        .find((item) => item.messageType === 'challenge_request' && messageThreadId(item) === activeThreadId) : null
      if (refreshed) setActiveTeamChallengeLeaderboard(refreshed)
      logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', message: 'team_challenge_leaderboard_refresh_succeeded', data: { messageId: refreshed?.id || activeTeamChallengeLeaderboard.id, threadId: activeThreadId, refreshed: Boolean(refreshed) } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not refresh Team Challenge leaderboard.'
      setError(message)
      logFrontendEvent({ category: 'inbox.teamChallenge.leaderboard', level: 'error', message: 'team_challenge_leaderboard_refresh_failed', data: { threadId: activeThreadId, error: message } })
    } finally {
      setRefreshingLeaderboard(false)
    }
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
    return Array.isArray(holes) && holes.length ? normalizeHoleScorecard(holes, getTeamChallengeStateCode(message), getTeamChallengeCourseName(message)) : null
  }

  function getIndividualChallengeHoles(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const key = getIndividualChallengeScoreKey(message, participant)
    if (individualChallengeScorecards[key]) return individualChallengeScorecards[key]
    return getStoredIndividualChallengeHoles(message, participant) || buildClientDefaultHoleScorecard(getTeamChallengeStateCode(message), getTeamChallengeCourseName(message))
  }

  function getProvidedHoleCount(holes: HoleScoreDetail[]) {
    return holes.filter((hole) => hole.scoreProvided).length
  }

  function getProvidedHoleScoreTotal(holes: HoleScoreDetail[]) {
    return holes
      .filter((hole) => hole.scoreProvided)
      .reduce((sum, hole) => sum + (Number.isFinite(hole.score) ? hole.score : 0), 0)
  }

  function getIndividualChallengeScore(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const holes = getIndividualChallengeHoles(message, participant)
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
        const holes = getIndividualChallengeHoles(message, participant)
        const enteredHoles = holes.filter((hole) => hole.scoreProvided)
        const score = getIndividualChallengeScore(message, participant)
        const parTotal = enteredHoles.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0)
        const relativeScore = score == null || enteredHoles.length === 0 ? null : score - parTotal
        return {
          participant,
          holes,
          score,
          thru: enteredHoles.length,
          relativeScore,
          roundLabel: formatLeaderboardRelative(relativeScore),
          totalLabel: score == null ? 'Pending' : formatLeaderboardRelative(relativeScore),
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

  function openIndividualChallengeLeaderboard(message: InboxMessage) {
    setActiveIndividualChallengeLeaderboard(message)
    logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_leaderboard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, participantCount: getIndividualChallengeParticipants(message).length } })
  }

  async function refreshIndividualChallengeLeaderboard() {
    if (!activeIndividualChallengeLeaderboard) return
    const activeThreadId = messageThreadId(activeIndividualChallengeLeaderboard)
    setRefreshingLeaderboard(true)
    try {
      logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_leaderboard_refresh_started', data: { messageId: activeIndividualChallengeLeaderboard.id, threadId: activeThreadId } })
      const loaded = await loadInbox()
      const refreshed = loaded ? uniqueInboxMessages([...(loaded.inboxMessages || []), ...(loaded.sentChallenges || [])])
        .find((item) => item.messageType === 'individual_challenge' && messageThreadId(item) === activeThreadId) : null
      if (refreshed) setActiveIndividualChallengeLeaderboard(refreshed)
      logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', message: 'individual_challenge_leaderboard_refresh_succeeded', data: { messageId: refreshed?.id || activeIndividualChallengeLeaderboard.id, threadId: activeThreadId, refreshed: Boolean(refreshed) } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not refresh leaderboard.'
      setError(message)
      logFrontendEvent({ category: 'inbox.individualChallenge.leaderboard', level: 'error', message: 'individual_challenge_leaderboard_refresh_failed', data: { threadId: activeThreadId, error: message } })
    } finally {
      setRefreshingLeaderboard(false)
    }
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
    if (!proposerTeamId && myTeams.length > 0) {
      setProposerTeamId(myTeams[0].id)
    }
    if (proposerTeamId && myTeams.length > 0 && !myTeams.some((team) => team.id === proposerTeamId)) {
      setProposerTeamId(myTeams[0].id)
    }
  }, [myTeams, proposerTeamId])

  useEffect(() => {
    if (!challengesComposeOpen || !teamChallengeState) return
    let cancelled = false

    async function loadTeamChallengeCourses() {
      try {
        const names = await api<string[]>(`/api/golf-courses?state=${encodeURIComponent(teamChallengeState)}`)
        if (cancelled) return
        setTeamChallengeCourses(names)
        setTeamChallengeCourse((prev) => (prev && names.includes(prev) ? prev : (names[0] || '')))
      } catch (err) {
        if (cancelled) return
        setTeamChallengeCourses([])
        setTeamChallengeCourse('')
        const message = err instanceof Error ? err.message : 'Could not load courses for Team Challenge.'
        logFrontendEvent({ category: 'inbox.teamChallenge.course', level: 'warn', message: 'team_challenge_courses_load_failed', data: { state: teamChallengeState, error: message } })
      }
    }

    void loadTeamChallengeCourses()
    return () => { cancelled = true }
  }, [challengesComposeOpen, teamChallengeState])

  async function handleChallengeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setError(null)
    setStatus(null)
    const trimmedChallengeTeam = challengedTeamName.trim()
    const trimmedChallengeDate = teamChallengeDate.trim()
    const trimmedChallengeState = teamChallengeState.trim().toUpperCase()
    const trimmedChallengeCourse = teamChallengeCourse.trim()
    const trimmedBody = challengeBody.trim()
    const messageTypeForChallenge: InboxMessageType = isTeamChallenge ? 'challenge_request' : 'individual_challenge'
    const participantEmails = parsedIndividualParticipantEmails

    try {
      logFrontendEvent({
        category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge',
        message: isTeamChallenge ? 'team_challenge_send_started' : 'individual_challenge_send_started',
        data: { challengedTeamName: trimmedChallengeTeam, proposerTeamId, proposerTeamName: selectedProposerTeam?.name, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, participantCount: participantEmails.length },
      })
      const result = await sendInboxMessage(isTeamChallenge
        ? { proposerTeamId, challengedTeamName: trimmedChallengeTeam, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, body: trimmedBody }
        : { individualParticipantEmails: participantEmails, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, body: trimmedBody })
      setStatus(result.notice || (isTeamChallenge ? 'Your Team Challenge was sent successfully.' : 'Your Individual Challenge was sent successfully.'))
      setChallengedTeamName('')
      setIndividualParticipantEmails('')
      setTeamChallengeDate(getUserTodayISO())
      setTeamChallengeLocationMessage(null)
      setChallengeBody('')
      setChallengesComposeOpen(false)
      logFrontendEvent({
        category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge',
        message: isTeamChallenge ? 'team_challenge_send_succeeded' : 'individual_challenge_send_succeeded',
        data: { challengedTeamName: trimmedChallengeTeam, proposerTeamId, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, participantCount: participantEmails.length, messageId: result.message?.id, threadId: result.message?.threadId },
      })
      await loadInbox()
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        const message = err.message || 'Team does not exist.'
        setError(message)
        logFrontendEvent({ category: 'inbox.teamChallenge', level: 'warn', message: 'team_challenge_team_not_found_displayed', data: { challengedTeamName: err.challengedTeamName, proposerTeamId } })
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
      logFrontendEvent({ category: isTeamChallenge ? 'inbox.teamChallenge' : 'inbox.individualChallenge', level: 'error', message: isTeamChallenge ? 'team_challenge_send_failed' : 'individual_challenge_send_failed', data: { challengedTeamName: trimmedChallengeTeam, proposerTeamId, challengeDate: trimmedChallengeDate, challengeState: trimmedChallengeState, challengeCourse: trimmedChallengeCourse, messageType: messageTypeForChallenge, participantCount: participantEmails.length, error: message } })
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
    logFrontendEvent({ category: 'inbox.teamChallenge.scorecard', message: 'team_challenge_scorecard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, side, proposerTeamId: message.proposerTeamId, challengedTeamId: message.challengedTeamId } })
  }

  function updateTeamChallengeScorecard(message: InboxMessage, side: 'proposer' | 'challenged', holes: HoleScoreDetail[]) {
    const key = getTeamChallengeScoreKey(message, side)
    setTeamChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
  }

  async function handleTeamChallengeScoreSave(message: InboxMessage, side: 'proposer' | 'challenged') {
    const key = getTeamChallengeScoreKey(message, side)
    const holes = getTeamChallengeHoles(message, side)
    const missingHoleNumbers = missingHoleScoreNumbers(holes)
    if (missingHoleNumbers.length) {
      const missingText = `Finish entering scores for ${getTeamChallengeTeamName(message, side)} holes: ${missingHoleNumbers.join(', ')}.`
      setError(missingText)
      logFrontendEvent({ category: 'inbox.teamChallenge.scorecard', level: 'warn', message: 'team_challenge_scorecard_incomplete', data: { messageId: message.id, threadId: message.threadId || message.id, side, missingHoleNumbers } })
      return
    }

    const score = holeScoreTotal(holes)
    if (!Number.isFinite(score) || score < 0) {
      setError('Team Challenge score must be zero or greater.')
      return
    }

    setUpdatingChallengeScoreKey(key)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.teamChallenge.score', message: 'team_challenge_score_update_started', data: { messageId: message.id, threadId: message.threadId || message.id, side, score, holeCount: holes.length, proposerTeamId: message.proposerTeamId, challengedTeamId: message.challengedTeamId } })
      const updated = await updateTeamChallengeScore(message.id, score, holes)
      const patchScore = (item: InboxMessage) => (messageThreadId(item) === messageThreadId(updated) ? {
        ...item,
        proposerTeamScore: updated.proposerTeamScore,
        challengedTeamScore: updated.challengedTeamScore,
        proposerTeamHoles: updated.proposerTeamHoles,
        challengedTeamHoles: updated.challengedTeamHoles,
      } : item)
      setMessages((prev) => prev.map(patchScore))
      setSentChallenges((prev) => prev.map(patchScore))
      setTeamChallengeScorecards((prev) => ({
        ...prev,
        [`${messageThreadId(updated)}:proposer`]: getStoredTeamChallengeHoles(updated, 'proposer') || buildClientDefaultHoleScorecard('', getTeamChallengeTeamName(updated, 'proposer')),
        [`${messageThreadId(updated)}:challenged`]: getStoredTeamChallengeHoles(updated, 'challenged') || buildClientDefaultHoleScorecard('', getTeamChallengeTeamName(updated, 'challenged')),
      }))
      setActiveTeamChallengeScorecard(null)
      setStatus('Team Challenge score saved.')
      logFrontendEvent({ category: 'inbox.teamChallenge.score', message: 'team_challenge_score_update_succeeded', data: { messageId: updated.id, threadId: updated.threadId || updated.id, side, score, holeCount: holes.length, proposerTeamScore: updated.proposerTeamScore, challengedTeamScore: updated.challengedTeamScore } })
      await loadInbox()
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not save Team Challenge score.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.teamChallenge.score', level: 'error', message: 'team_challenge_score_update_failed', data: { messageId: message.id, side, score, error: messageText } })
    } finally {
      setUpdatingChallengeScoreKey(null)
    }
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

  async function persistIndividualChallengeScoreProgress(message: InboxMessage, participant: IndividualChallengeParticipant, holes: HoleScoreDetail[], options: { closeModal?: boolean; source: 'hole_save' | 'manual_save' }) {
    const key = getIndividualChallengeScoreKey(message, participant)
    const providedCount = getProvidedHoleCount(holes)
    if (providedCount === 0) {
      setError('Enter at least one hole score before saving this Individual Challenge score.')
      return null
    }

    const score = getProvidedHoleScoreTotal(holes)
    setUpdatingChallengeScoreKey(key)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.individualChallenge.score', message: options.source === 'hole_save' ? 'individual_challenge_hole_score_record_started' : 'individual_challenge_score_update_started', data: { messageId: message.id, threadId: message.threadId || message.id, participantEmail: participantEmail(participant), score, providedCount, holeCount: holes.length, source: options.source } })
      const updated = await updateIndividualChallengeScore(message.id, score, holes)
      patchIndividualChallengeUpdate(updated, participantEmail(participant))
      if (options.closeModal) setActiveIndividualChallengeScorecard(null)
      setStatus(`${providedCount} of ${holes.length || 18} Individual Challenge holes saved.`)
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
    logFrontendEvent({ category: 'inbox.individualChallenge.scorecard', message: 'individual_challenge_scorecard_opened', data: { messageId: message.id, threadId: message.threadId || message.id, participantEmail: participantEmail(participant), editable: currentUserCanEditIndividualParticipant(participant) } })
  }

  function updateIndividualChallengeScorecard(message: InboxMessage, participant: IndividualChallengeParticipant, holes: HoleScoreDetail[]) {
    const key = getIndividualChallengeScoreKey(message, participant)
    setIndividualChallengeScorecards((prev) => ({ ...prev, [key]: holes }))
  }

  async function handleIndividualChallengeScoreSave(message: InboxMessage, participant: IndividualChallengeParticipant) {
    const holes = getIndividualChallengeHoles(message, participant)
    try {
      await persistIndividualChallengeScoreProgress(message, participant, holes, { closeModal: true, source: 'manual_save' })
    } catch {
      // Error state and logs are handled by persistIndividualChallengeScoreProgress.
    }
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
        data: { threadId: thread.threadId, displayMessageId: thread.displayMessage.id, messageType: thread.displayMessage.messageType, threadMessageCount: thread.messages.length, unreadCount: thread.unreadCount, source },
      })
      return next
    })
  }

  async function handleMarkThreadRead(thread: InboxThread) {
    if (thread.unreadMessages.length === 0) return
    setMarkingReadThreadId(thread.threadId)
    try {
      const updatedMessages = await Promise.all(thread.unreadMessages.map((message) => markInboxMessageRead(message.id)))
      setMessages((prev) => prev.map((item) => updatedMessages.find((updated) => updated.id === item.id) || item))
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_thread_marked_read', data: { threadId: thread.threadId, unreadCount: thread.unreadCount, messageIds: thread.unreadMessages.map((message) => message.id), messageType: thread.displayMessage.messageType } })
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not mark thread as read.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.message', level: 'error', message: 'inbox_thread_mark_read_failed', data: { threadId: thread.threadId, error: messageText } })
    } finally {
      setMarkingReadThreadId(null)
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
      <div className="inboxTeamChallengeContext">
        <span className="pill">{messageTypeLabel(message.messageType)}</span>
        {message.messageType === 'challenge_request' ? (
          <span>{message.proposerTeamName || 'Proposing team'} challenged {message.challengedTeamName || 'Team to Challenge'}</span>
        ) : (
          <span>{participants.length} golfer Individual Challenge</span>
        )}
        {message.challengeDate || message.challengeState || message.challengeCourse ? (
          <span className="small">{[message.challengeDate, message.challengeState, message.challengeCourse].filter(Boolean).join(' • ')}</span>
        ) : null}
      </div>
    )
  }

  function renderReplyForm(message: InboxMessage) {
    const isTeamChallengeMessage = message.messageType === 'challenge_request'
    const isIndividualChallengeMessage = message.messageType === 'individual_challenge'
    const latestMessage = getLatestConversationMessage(message)
    const replyTarget = replyingTo && messageThreadId(replyingTo) === messageThreadId(message)
    if (!replyTarget) return null

    return (
      <form className="formStack inboxReplyForm" onSubmit={handleReplySubmit}>
        <label className="label" htmlFor={`reply-${messageThreadId(message)}`}>Reply to {isTeamChallengeMessage ? (message.proposerTeamName || message.challengedTeamName || 'Team Challenge') : (isIndividualChallengeMessage ? 'Individual Challenge' : (latestMessage.senderName || latestMessage.senderEmail))}</label>
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
    const scoreRows: Array<{ side: 'proposer' | 'challenged'; label: string; score?: number | null }> = [
      { side: 'proposer', label: message.proposerTeamName || 'Proposing team', score: message.proposerTeamScore },
      { side: 'challenged', label: message.challengedTeamName || 'Challenged team', score: message.challengedTeamScore },
    ]

    return (
      <div className="inboxTeamChallengeScores">
        <div className="inboxScoreSectionHeader">
          <div className="small inboxConversationTitle">Team Challenge Scores</div>
          <button type="button" className="btn btnSmall inboxLeaderboardButton" onClick={() => openTeamChallengeLeaderboard(message)}>Leaderboard</button>
        </div>
        <div className="inboxTeamChallengeScoreGrid">
          {scoreRows.map((row) => {
            const editable = userSide === row.side
            const score = getTeamChallengeScore(message, row.side)
            return (
              <div key={row.side} className={`inboxTeamChallengeScoreCard ${editable ? 'inboxTeamChallengeScoreCard--editable' : 'inboxTeamChallengeScoreCard--readonly'}`}>
                <label className="label">{row.label} Score</label>
                <button
                  type="button"
                  className={`teamScorecardOpenButton teamScorecardInputButton ${editable ? '' : 'teamScorecardInputButton--readonly'}`}
                  onClick={() => openTeamChallengeScorecard(message, row.side)}
                >
                  <span className="teamScorecardInputBadge">{editable ? 'Tap to enter score' : 'Read-only score'}</span>
                  <strong>{score == null ? 'Pending' : score}</strong>
                  <span>{getTeamChallengeScorecardSummary(message, row.side)}</span>
                  <span>{editable ? 'Only members of this team can edit this score.' : 'Opponent team score is read-only.'}</span>
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
    const participants = getIndividualChallengeParticipants(message)
    return (
      <div className="inboxTeamChallengeScores inboxIndividualChallengeScores">
        <div className="inboxScoreSectionHeader">
          <div className="small inboxConversationTitle">Individual Challenge Scores</div>
          <button type="button" className="btn btnSmall inboxLeaderboardButton" onClick={() => openIndividualChallengeLeaderboard(message)}>Leaderboard</button>
        </div>
        <div className="inboxTeamChallengeScoreGrid inboxIndividualChallengeScoreGrid">
          {participants.map((participant) => {
            const editable = currentUserCanEditIndividualParticipant(participant)
            const score = getIndividualChallengeScore(message, participant)
            return (
              <div key={participantEmail(participant)} className={`inboxTeamChallengeScoreCard ${editable ? 'inboxTeamChallengeScoreCard--editable' : 'inboxTeamChallengeScoreCard--readonly'}`}>
                <label className="label">{participantDisplayName(participant)} Score</label>
                <button
                  type="button"
                  className={`teamScorecardOpenButton teamScorecardInputButton ${editable ? '' : 'teamScorecardInputButton--readonly'}`}
                  onClick={() => openIndividualChallengeScorecard(message, participant)}
                >
                  <span className="teamScorecardInputBadge">{editable ? 'Tap to enter score' : 'Read-only score'}</span>
                  <strong>{score == null ? 'Pending' : score}</strong>
                  <span>{getIndividualChallengeScorecardSummary(message, participant)}</span>
                  <span>{editable ? 'Only you can edit your Individual Challenge score.' : 'Other golfer scores are read-only.'}</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderReadonlyTeamChallengeHoles(holes: HoleScoreDetail[], ownerName: string) {
    if (!holes.length) return <div className="small">No hole-by-hole score has been entered yet.</div>
    return (
      <div className="roundHoleDetailGrid inboxReadonlySoloScoreGrid inboxReadonlyTeamScoreGrid" aria-label="Read-only Team Challenge hole scores">
        {holes.map((hole) => {
          const scoreProvided = Boolean(hole.scoreProvided)
          const outcomeClass = scoreProvided ? scoreOutcomeClassName({ par: hole.par, score: hole.score }) : 'roundHoleDetailPill--unknown'
          const outcome = scoreProvided ? formatHoleScoreOutcome({ par: hole.par, score: hole.score }) : 'No score'
          return (
            <div key={hole.hole} className={`roundHoleDetailPill ${outcomeClass}`}>
              <span className="roundHoleDetailOwner">{ownerName}</span>
              <strong>Hole {hole.hole}</strong>
              <span>Par {hole.par || '—'} • {hole.yards || '—'} yds</span>
              <span className="roundHoleDetailScore">{outcome}</span>
            </div>
          )
        })}
      </div>
    )
  }

  function renderReadonlyIndividualChallengeHoles(holes: HoleScoreDetail[], ownerName: string) {
    if (!holes.length) return <div className="small">No hole-by-hole score has been entered yet.</div>
    return (
      <div className="roundHoleDetailGrid inboxReadonlySoloScoreGrid" aria-label="Read-only Individual Challenge hole scores">
        {holes.map((hole) => {
          const scoreProvided = Boolean(hole.scoreProvided)
          const outcomeClass = scoreProvided ? scoreOutcomeClassName({ par: hole.par, score: hole.score }) : 'roundHoleDetailPill--unknown'
          const outcome = scoreProvided ? formatHoleScoreOutcome({ par: hole.par, score: hole.score }) : 'No score'
          return (
            <div key={hole.hole} className={`roundHoleDetailPill ${outcomeClass}`}>
              <span className="roundHoleDetailOwner">{ownerName}</span>
              <strong>Hole {hole.hole}</strong>
              <span>Par {hole.par || '—'} • {hole.yards || '—'} yds</span>
              <span className="roundHoleDetailScore">{outcome}</span>
            </div>
          )
        })}
      </div>
    )
  }

  function renderTeamChallengeScorecardModal() {
    if (!activeTeamChallengeScorecard) return null
    const { message, side } = activeTeamChallengeScorecard
    const key = getTeamChallengeScoreKey(message, side)
    const teamName = getTeamChallengeTeamName(message, side)
    const holes = getTeamChallengeHoles(message, side)
    const editable = getTeamChallengeUserSide(message) === side
    const score = getTeamChallengeScore(message, side)

    return (
      <div className="modalOverlay teamScorecardModalOverlay" role="presentation" onClick={() => setActiveTeamChallengeScorecard(null)}>
        <div className="modalCard teamScorecardModalCard" role="dialog" aria-modal="true" aria-label={`${teamName} Team Challenge scorecard`} onClick={(event) => event.stopPropagation()}>
          <div className="teamScorecardModalHeader">
            <div>
              <div className="small">Team Challenge score input</div>
              <h2>{teamName} Score</h2>
              <div className="small">{editable ? 'Enter each hole score, then save the Team Challenge score.' : 'Opponent team score is read-only.'}</div>
            </div>
            <button type="button" className="btn btnSmall" onClick={() => setActiveTeamChallengeScorecard(null)}>Close</button>
          </div>
          {editable ? (
            <>
              <HoleByHoleScorecard
                enabled={true}
                stateCode={getTeamChallengeStateCode(message)}
                course={getTeamChallengeCourseName(message)}
                holes={holes}
                onChange={(nextHoles) => updateTeamChallengeScorecard(message, side, nextHoles)}
                scoreOwnerLabel={`${teamName} score`}
                loadScorecardOnMount={!holes.some((hole) => hole.scoreProvided)}
              />
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button
                  type="button"
                  className="btnPrimary btnSmall"
                  disabled={updatingChallengeScoreKey === key}
                  onClick={() => void handleTeamChallengeScoreSave(message, side)}
                >
                  {updatingChallengeScoreKey === key ? 'Saving score…' : 'Save Team Challenge Score'}
                </button>
                <button type="button" className="btn btnSmall" onClick={() => setActiveTeamChallengeScorecard(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  onClick={() => {
                    setActiveTeamChallengeScorecard(null)
                    openTeamChallengeLeaderboard(message)
                  }}
                >
                  Leaderboard
                </button>
              </div>
            </>
          ) : (
            <div className="card holeInputPanel inboxTeamChallengeReadonlyPanel">
              <div className="holeInputTeamLabel">{teamName} score</div>
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
              {renderReadonlyTeamChallengeHoles(holes, teamName)}
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button type="button" className="btn btnSmall" onClick={() => setActiveTeamChallengeScorecard(null)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  onClick={() => {
                    setActiveTeamChallengeScorecard(null)
                    openTeamChallengeLeaderboard(message)
                  }}
                >
                  Leaderboard
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
    const key = getIndividualChallengeScoreKey(message, participant)
    const golferName = participantDisplayName(participant)
    const holes = getIndividualChallengeHoles(message, participant)
    const editable = currentUserCanEditIndividualParticipant(participant)
    const score = getIndividualChallengeScore(message, participant)

    return (
      <div className="modalOverlay teamScorecardModalOverlay" role="presentation" onClick={() => setActiveIndividualChallengeScorecard(null)}>
        <div className="modalCard teamScorecardModalCard" role="dialog" aria-modal="true" aria-label={`${golferName} Individual Challenge scorecard`} onClick={(event) => event.stopPropagation()}>
          <div className="teamScorecardModalHeader">
            <div>
              <div className="small">Individual Challenge score input</div>
              <h2>{golferName} Score</h2>
              <div className="small">{editable ? 'Enter each hole score, then save your Individual Challenge score.' : 'Other golfer scores are read-only.'}</div>
            </div>
            <button type="button" className="btn btnSmall" onClick={() => setActiveIndividualChallengeScorecard(null)}>Close</button>
          </div>
          {editable ? (
            <>
              <HoleByHoleScorecard
                enabled={true}
                stateCode={getTeamChallengeStateCode(message)}
                course={getTeamChallengeCourseName(message)}
                holes={holes}
                onChange={(nextHoles) => updateIndividualChallengeScorecard(message, participant, nextHoles)}
                onHoleSaved={(nextHoles) => persistIndividualChallengeScoreProgress(message, participant, nextHoles, { closeModal: false, source: 'hole_save' })}
                scoreOwnerLabel={`${golferName} score`}
                loadScorecardOnMount={!holes.some((hole) => hole.scoreProvided)}
              />
              <div className="small inboxLiveScoreSaveNote">Each saved hole records immediately so the live leaderboard can update.</div>
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button
                  type="button"
                  className="btnPrimary btnSmall"
                  disabled={updatingChallengeScoreKey === key || !getProvidedHoleCount(holes)}
                  onClick={() => void handleIndividualChallengeScoreSave(message, participant)}
                >
                  {updatingChallengeScoreKey === key ? 'Saving score…' : 'Save Individual Challenge Score'}
                </button>
                <button type="button" className="btn btnSmall" onClick={() => setActiveIndividualChallengeScorecard(null)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  onClick={() => {
                    setActiveIndividualChallengeScorecard(null)
                    openIndividualChallengeLeaderboard(message)
                  }}
                >
                  Leaderboard
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
              {renderReadonlyIndividualChallengeHoles(holes, golferName)}
              <div className="pageHeroActions inboxMessageActions inboxTeamChallengeScorecardActions">
                <button type="button" className="btn btnSmall" onClick={() => setActiveIndividualChallengeScorecard(null)}>Close</button>
                <button
                  type="button"
                  className="btn btnSmall inboxLeaderboardButton"
                  onClick={() => {
                    setActiveIndividualChallengeScorecard(null)
                    openIndividualChallengeLeaderboard(message)
                  }}
                >
                  Leaderboard
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

    return (
      <div className="modalOverlay inboxLeaderboardModalOverlay" role="presentation" onClick={() => setActiveTeamChallengeLeaderboard(null)}>
        <div className="modalCard inboxLeaderboardModal" role="dialog" aria-modal="true" aria-label="Team Challenge Leaderboard" onClick={(event) => event.stopPropagation()}>
          <div className="inboxLeaderboardHero">
            <div className="inboxLeaderboardHeroTopline">
              <button type="button" className="inboxLeaderboardIconButton" aria-label="Close leaderboard" onClick={() => setActiveTeamChallengeLeaderboard(null)}>‹</button>
              <div className="inboxLeaderboardCrest" aria-hidden="true">⛳</div>
              <div className="inboxLeaderboardTopRightActions">
                <button
                  type="button"
                  className="inboxLeaderboardIconButton inboxLeaderboardRefreshButton"
                  aria-label="Refresh Team Challenge leaderboard"
                  disabled={refreshingLeaderboard}
                  onClick={() => void refreshTeamChallengeLeaderboard()}
                >
                  {refreshingLeaderboard ? '…' : '↻'}
                </button>
                <button type="button" className="inboxLeaderboardIconButton" aria-label="Close leaderboard" onClick={() => setActiveTeamChallengeLeaderboard(null)}>×</button>
              </div>
            </div>
            <div className="inboxLeaderboardYear">Golf Homiez</div>
            <h2>Team Challenge Leaderboard</h2>
            <div className="inboxLeaderboardDivider" />
            <strong>{message.challengeCourse || 'Team Challenge'}</strong>
            <span>{[message.challengeDate, message.challengeState].filter(Boolean).join(' • ')}</span>
          </div>

          <div className="inboxLeaderboardBoard">
            <div className="inboxLeaderboardHeaderRow">
              <span>POS</span>
              <span>TEAM</span>
              <span>TOTAL</span>
              <span>THRU</span>
              <span>ROUND</span>
            </div>
            {rows.map((row) => {
              const initials = row.teamName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GH'
              const positionClass = row.position <= 3 ? `inboxLeaderboardRow--top${row.position}` : ''
              return (
                <div key={row.side} className={`inboxLeaderboardRow ${positionClass}`}>
                  <div className="inboxLeaderboardPosition"><span>{row.position}</span></div>
                  <div className="inboxLeaderboardPlayer">
                    <div className="inboxLeaderboardAvatar" aria-hidden="true">{initials}</div>
                    <div>
                      <strong>{row.teamName}</strong>
                      <span>{row.side === 'proposer' ? 'Proposing team' : 'Challenged team'}</span>
                    </div>
                  </div>
                  <strong className="inboxLeaderboardScore">{row.totalLabel}</strong>
                  <span>{row.thru || '—'}</span>
                  <span>{row.roundLabel}</span>
                </div>
              )
            })}
            <div className="inboxLeaderboardUpdated">{completedCount} of {rows.length} team scores entered live</div>
          </div>
        </div>
      </div>
    )
  }

  function renderIndividualChallengeLeaderboardModal() {
    if (!activeIndividualChallengeLeaderboard) return null
    const message = activeIndividualChallengeLeaderboard
    const rows = getIndividualChallengeLeaderboardRows(message)
    const completedCount = rows.filter((row) => row.score != null).length

    return (
      <div className="modalOverlay inboxLeaderboardModalOverlay" role="presentation" onClick={() => setActiveIndividualChallengeLeaderboard(null)}>
        <div className="modalCard inboxLeaderboardModal" role="dialog" aria-modal="true" aria-label="Individual Challenge Leaderboard" onClick={(event) => event.stopPropagation()}>
          <div className="inboxLeaderboardHero">
            <div className="inboxLeaderboardHeroTopline">
              <button type="button" className="inboxLeaderboardIconButton" aria-label="Close leaderboard" onClick={() => setActiveIndividualChallengeLeaderboard(null)}>‹</button>
              <div className="inboxLeaderboardCrest" aria-hidden="true">⛳</div>
              <div className="inboxLeaderboardTopRightActions">
                <button
                  type="button"
                  className="inboxLeaderboardIconButton inboxLeaderboardRefreshButton"
                  aria-label="Refresh leaderboard"
                  disabled={refreshingLeaderboard}
                  onClick={() => void refreshIndividualChallengeLeaderboard()}
                >
                  {refreshingLeaderboard ? '…' : '↻'}
                </button>
                <button type="button" className="inboxLeaderboardIconButton" aria-label="Close leaderboard" onClick={() => setActiveIndividualChallengeLeaderboard(null)}>×</button>
              </div>
            </div>
            <div className="inboxLeaderboardYear">Golf Homiez</div>
            <h2>Individual Challenge Leaderboard</h2>
            <div className="inboxLeaderboardDivider" />
            <strong>{message.challengeCourse || 'Individual Challenge'}</strong>
            <span>{[message.challengeDate, message.challengeState].filter(Boolean).join(' • ')}</span>
          </div>

          <div className="inboxLeaderboardBoard">
            <div className="inboxLeaderboardHeaderRow">
              <span>POS</span>
              <span>PLAYER</span>
              <span>TOTAL</span>
              <span>THRU</span>
              <span>ROUND</span>
            </div>
            {rows.map((row) => {
              const name = participantDisplayName(row.participant)
              const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GH'
              const positionClass = row.position <= 3 ? `inboxLeaderboardRow--top${row.position}` : ''
              return (
                <div key={participantEmail(row.participant)} className={`inboxLeaderboardRow ${positionClass}`}>
                  <div className="inboxLeaderboardPosition"><span>{row.position}</span></div>
                  <div className="inboxLeaderboardPlayer">
                    <div className="inboxLeaderboardAvatar" aria-hidden="true">{initials}</div>
                    <div>
                      <strong>{name}</strong>
                      <span>{participantEmail(row.participant)}</span>
                    </div>
                  </div>
                  <strong className="inboxLeaderboardScore">{row.totalLabel}</strong>
                  <span>{row.thru || '—'}</span>
                  <span>{row.roundLabel}</span>
                </div>
              )
            })}
            <div className="inboxLeaderboardUpdated">{completedCount} of {rows.length} scores entered live</div>
          </div>
        </div>
      </div>
    )
  }


  function renderThreadCard(thread: InboxThread, source: 'messages' | 'team-challenges') {
    const message = thread.displayMessage
    const isExpanded = expandedThreadId === thread.threadId
    const isTeamChallengeMessage = message.messageType === 'challenge_request'
    const isIndividualChallengeMessage = message.messageType === 'individual_challenge'
    const latestMessage = getLatestConversationMessage(message)
    const unreadText = thread.unreadCount === 1 ? '1 new' : `${thread.unreadCount} new`

    return (
      <article key={thread.threadId} className={`inboxMessageCard ${thread.unreadCount > 0 ? 'inboxMessageCard--unread' : 'inboxMessageCard--read'} ${isExpanded ? 'inboxMessageCard--expanded' : 'inboxMessageCard--collapsed'}`}>
        <div className="inboxMessageTopline">
          <span className="pill">{messageTypeLabel(message.messageType)}</span>
          {thread.unreadCount > 0 ? <span className="inboxUnreadIndicator">{unreadText}</span> : <span className="small">Latest {formatInboxTimestamp(latestMessage.createdAt)}</span>}
        </div>
        {source === 'team-challenges' ? <div className="inboxMessageSender">Challenge thread</div> : <div className="inboxMessageSender">From: {message.senderName || message.senderEmail}</div>}
        <div className="small">Latest activity {formatInboxTimestamp(latestMessage.createdAt)}</div>
        {renderTeamChallengeContext(message)}
        {isExpanded ? (
          <>
            <p className="inboxMessageBody">{latestMessage.body}</p>
            {source === 'team-challenges' && isTeamChallengeMessage ? renderTeamChallengeScores(message) : null}
            {source === 'team-challenges' && isIndividualChallengeMessage ? renderIndividualChallengeScores(message) : null}
            {renderConversation(message)}
          </>
        ) : (
          <p className="inboxMessagePreview">{getMessagePreview(latestMessage.body)}</p>
        )}
        <div className="pageHeroActions inboxMessageActions">
          <button type="button" className="btn btnSmall" aria-expanded={isExpanded} onClick={() => toggleThreadExpansion(thread, source)}>{isExpanded ? 'Collapse' : 'Expand'}</button>
          {thread.unreadCount > 0 ? <button type="button" className="btn btnSmall" disabled={markingReadThreadId === thread.threadId} onClick={() => void handleMarkThreadRead(thread)}>{markingReadThreadId === thread.threadId ? 'Marking…' : 'Mark read'}</button> : null}
          {isExpanded ? <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(getLatestConversationMessage(message)); setReplyBody('') }}>Reply</button> : null}
        </div>
        {isExpanded ? renderReplyForm(message) : null}
      </article>
    )
  }

  return (
    <div className="container pageStack inboxPage">
      <PageHero
        eyebrow="Golf user challenges"
        title="Challenges"
      />

      <section className="card inboxListCard inboxChallengeListCard">
        <div className="inboxSectionHeader inboxSectionHeader--withActions">
          <div>
            <h2 className="inboxSectionTitle">Challenges</h2>
            <div className="small">Team and Individual Challenges involving you.</div>
          </div>
          <div className="inboxSectionActions">
            <Link className="btn btnLightGreen btnSmall" to="/directions">Directions</Link>
            <span className="challengeActiveCountLabel">{teamChallengeThreads.length} active</span>
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
                    setChallengeType(event.target.value as 'team' | 'individual')
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
                <label className="label" htmlFor="teamChallengeName">Team to Challenge</label>
                <input
                  id="teamChallengeName"
                  className="input"
                  type="text"
                  list="teamChallengeOptions"
                  required={isTeamChallenge}
                  value={challengedTeamName}
                  onChange={(event) => setChallengedTeamName(event.target.value)}
                  placeholder="Select or type the team to challenge"
                />
                <datalist id="teamChallengeOptions">
                  {teamChallengeOptions.map((team) => <option key={team.id} value={team.name} />)}
                </datalist>
                <div className="small">Team search is not case-sensitive. Enter the team you want to challenge.</div>
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
                  }}
                  required
                >
                  {US_STATES.map((state) => (
                    <option key={state.abbr} value={state.abbr}>{state.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="teamChallengeCourse">Course</label>
                <select
                  id="teamChallengeCourse"
                  className="input"
                  value={teamChallengeCourse}
                  onChange={(event) => setTeamChallengeCourse(event.target.value)}
                  disabled={!teamChallengeCourses.length}
                  required
                >
                  {!teamChallengeCourses.length ? <option value="">No courses available</option> : null}
                  {teamChallengeCourses.map((course) => <option key={course} value={course}>{course}</option>)}
                </select>
                <div className="inboxTeamChallengeLocationActions">
                  <UseMyLocationButton
                    onResolved={(location) => {
                      setTeamChallengeState(location.stateCode)
                      setTeamChallengeCourse('')
                      setTeamChallengeLocationMessage(`Location set to ${location.label}.`)
                    }}
                    onStatus={setTeamChallengeLocationMessage}
                  />
                  {teamChallengeLocationMessage ? <span className="small">{teamChallengeLocationMessage}</span> : null}
                </div>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="challengeMessageBody">Challenge Message</label>
              <textarea
                id="challengeMessageBody"
                className="input"
                rows={5}
                required
                maxLength={2000}
                value={challengeBody}
                onChange={(event) => setChallengeBody(event.target.value)}
                placeholder={isTeamChallenge ? 'Write your Team Challenge details' : 'Write your Individual Challenge details'}
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

        {loading ? null : teamChallengeThreads.length === 0 ? <div className="small">No Challenges yet.</div> : null}
        <div className="inboxMessageList">
          {teamChallengeThreads.map((thread) => renderThreadCard(thread, 'team-challenges'))}
        </div>
      </section>

      {renderTeamChallengeScorecardModal()}
      {renderIndividualChallengeScorecardModal()}
      {renderTeamChallengeLeaderboardModal()}
      {renderIndividualChallengeLeaderboardModal()}
    </div>
  )
}
