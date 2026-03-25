export function sortScoresNewestFirst(entries) {
  return [...entries].sort((a, b) => {
    const dateCmp = String(b?.date || '').localeCompare(String(a?.date || ''))
    if (dateCmp !== 0) return dateCmp
    return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))
  })
}

function average(values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function describeDelta(delta, unit = 'strokes') {
  if (delta === null || Number.isNaN(delta)) return 'right in line with your average'
  if (Math.abs(delta) < 0.05) return 'right in line with your average'
  if (delta < 0) return `${Math.abs(delta).toFixed(1)} ${unit} better than your average`
  return `${delta.toFixed(1)} ${unit} above your average`
}

export function compareRoundToHistory(round, allScores) {
  if (!round || !round.course) return 'No comparison is available for this round yet.'

  const ordered = sortScoresNewestFirst(allScores || [])
  const sameMode = ordered.filter((entry) => entry && entry.mode === round.mode)
  const sameCourse = sameMode.filter((entry) => entry.course === round.course)
  const recentWindow = sameMode.filter((entry) => entry.id !== round.id).slice(0, 8)

  if (round.mode === 'solo') {
    const courseScores = sameCourse
      .map((entry) => Number(entry.roundScore))
      .filter((value) => Number.isFinite(value))
    const recentScores = recentWindow
      .map((entry) => Number(entry.roundScore))
      .filter((value) => Number.isFinite(value))
    const courseOrdered = [...sameCourse].sort((a, b) => Number(a.roundScore || 0) - Number(b.roundScore || 0))
    const courseRank = Math.max(1, courseOrdered.findIndex((entry) => entry.id === round.id) + 1)
    const courseAvg = average(courseScores)
    const recentAvg = average(recentScores)
    const best = courseOrdered[0]
    const courseDelta = courseAvg === null ? null : Number(round.roundScore || 0) - courseAvg
    const recentDelta = recentAvg === null ? null : Number(round.roundScore || 0) - recentAvg

    return `At ${round.course}, this solo round ranks #${courseRank} of ${sameCourse.length || 1} logged solo rounds and sits ${describeDelta(courseDelta)}, based on a course average of ${courseAvg?.toFixed(1) ?? '—'}. Your best solo score here is ${best?.roundScore ?? '—'}. Against your ${recentWindow.length} most recent solo rounds, this score was ${describeDelta(recentDelta)}.`
  }

  const courseMargins = sameCourse
    .map((entry) => Number(entry.opponentTotal || 0) - Number(entry.teamTotal || 0))
    .filter((value) => Number.isFinite(value))
  const recentMargins = recentWindow
    .map((entry) => Number(entry.opponentTotal || 0) - Number(entry.teamTotal || 0))
    .filter((value) => Number.isFinite(value))
  const wins = sameCourse.filter((entry) => entry.won === true).length
  const losses = sameCourse.filter((entry) => entry.won === false).length
  const ties = sameCourse.filter((entry) => entry.won === null).length
  const margin = Number(round.opponentTotal || 0) - Number(round.teamTotal || 0)
  const courseAvgMargin = average(courseMargins)
  const recentAvgMargin = average(recentMargins)
  const courseDelta = courseAvgMargin === null ? null : margin - courseAvgMargin
  const recentDelta = recentAvgMargin === null ? null : margin - recentAvgMargin
  const resultText = round.won === true ? `won by ${Math.abs(margin)}` : round.won === false ? `lost by ${Math.abs(margin)}` : 'finished tied'

  return `This team round ${resultText} at ${round.course}. Your team record on this course is ${wins}-${losses}${ties ? `-${ties}` : ''} across ${sameCourse.length || 1} logged events, and the margin was ${describeDelta(-courseDelta, 'shots')} compared with your usual course result. Compared with your ${recentWindow.length} most recent team rounds, the match margin was ${describeDelta(-recentDelta, 'shots')}.`
}
