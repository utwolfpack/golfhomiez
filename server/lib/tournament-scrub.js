function cleanValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 191)
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&')
}

function cancellationError(signal, output = null) {
  const reason = signal?.reason
  const error = reason instanceof Error ? reason : new Error('Scheduled job cancellation requested')
  if (!error.code) error.code = 'SCHEDULED_JOB_CANCELLED'
  if (output) error.output = { ...output, cancelled: true }
  return error
}

function throwIfCancelled(signal, output = null) {
  if (signal?.aborted) throw cancellationError(signal, output)
}

export function normalizeTournamentScrubValues(values) {
  const result = []
  const seen = new Set()
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = cleanValue(rawValue)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= 100) break
  }
  return result
}

export async function runScrubTournaments(db, {
  matchValues = [],
  correlationId,
  triggeredBy = 'scheduled',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
} = {}) {
  const values = normalizeTournamentScrubValues(matchValues)
  const summary = {
    correlationId,
    triggeredBy,
    configuredValueCount: values.length,
    valuesProcessed: 0,
    deletedCount: 0,
    failures: [],
    valueResults: [],
  }

  throwIfCancelled(signal, summary)
  logApi('scrub_tournaments_started', { correlationId, triggeredBy, configuredValueCount: values.length })
  logScheduledJob('scrub_tournaments_started', { correlationId, triggeredBy, configuredValueCount: values.length })

  for (const value of values) {
    throwIfCancelled(signal, summary)
    summary.valuesProcessed += 1
    try {
      const pattern = `%${escapeLike(value.toLowerCase())}%`
      const [result] = await db.execute(
        `DELETE FROM golf_course_tournaments
          WHERE tournament_name IS NOT NULL
            AND LOWER(tournament_name) LIKE ? ESCAPE '\\\\'`,
        [pattern],
      )
      const deleted = Number(result?.affectedRows || 0)
      summary.deletedCount += deleted
      summary.valueResults.push({ value, deletedCount: deleted })
      logApi('scrub_tournaments_value_completed', { correlationId, value, deletedCount: deleted })
      logScheduledJob('scrub_tournaments_value_completed', { correlationId, value, deletedCount: deleted })
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal, summary)
      const failure = { value, error: error?.message || String(error) }
      summary.failures.push(failure)
      summary.valueResults.push({ value, deletedCount: 0, error: failure.error })
      logError('Tournament scrub failed for configured value; continuing', { correlationId, value, error })
      logScheduledJob('scrub_tournaments_value_failed', { correlationId, value, level: 'error', error: failure.error })
    }
  }

  logApi('scrub_tournaments_completed', summary)
  logScheduledJob('scrub_tournaments_completed', summary)
  return summary
}
