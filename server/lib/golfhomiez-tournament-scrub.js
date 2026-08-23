const DELETE_BATCH_SIZE = 250

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

function cleanText(value, maxLength = 255) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export async function runScrubGolfHomiezTournaments(db, {
  correlationId,
  triggeredBy = 'scheduled',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
} = {}) {
  const summary = {
    correlationId,
    triggeredBy,
    recordsReviewed: 0,
    localGolfHomiezRecordsKept: 0,
    importedGolfHomiezRecordsDeleted: 0,
    deleteBatches: 0,
    deletedRecordSamples: [],
  }

  throwIfCancelled(signal, summary)
  logApi('scrub_golfhomiez_tournaments_started', { correlationId, triggeredBy })
  logScheduledJob('scrub_golfhomiez_tournaments_started', { correlationId, triggeredBy })

  try {
    const [rows] = await db.execute(
      `SELECT gct.id,
              gct.golfhomiez_tournament_id,
              gct.tournament_name,
              gct.source_type,
              CASE WHEN t.id IS NULL THEN 0 ELSE 1 END AS local_tournament_exists
         FROM golf_course_tournaments gct
         LEFT JOIN tournaments t
           ON BINARY t.id = BINARY gct.golfhomiez_tournament_id
        WHERE gct.golfhomiez_tournament_id IS NOT NULL
          AND TRIM(gct.golfhomiez_tournament_id) <> ''`,
    )

    const candidates = Array.isArray(rows) ? rows : []
    summary.recordsReviewed = candidates.length
    const importedRows = candidates.filter((row) => Number(row.local_tournament_exists || 0) !== 1)
    summary.localGolfHomiezRecordsKept = candidates.length - importedRows.length
    summary.deletedRecordSamples = importedRows.slice(0, 20).map((row) => ({
      id: cleanText(row.id, 80),
      golfHomiezTournamentId: cleanText(row.golfhomiez_tournament_id, 191),
      tournamentName: cleanText(row.tournament_name, 255) || null,
      sourceType: cleanText(row.source_type, 32) || null,
    }))

    for (let offset = 0; offset < importedRows.length; offset += DELETE_BATCH_SIZE) {
      throwIfCancelled(signal, summary)
      const batch = importedRows.slice(offset, offset + DELETE_BATCH_SIZE)
      const ids = batch.map((row) => String(row.id || '').trim()).filter(Boolean)
      if (!ids.length) continue
      const placeholders = ids.map(() => '?').join(', ')
      const [result] = await db.execute(`DELETE FROM golf_course_tournaments WHERE id IN (${placeholders})`, ids)
      const deleted = Number(result?.affectedRows || 0)
      summary.importedGolfHomiezRecordsDeleted += deleted
      summary.deleteBatches += 1
      logApi('scrub_golfhomiez_tournaments_batch_deleted', {
        correlationId,
        triggeredBy,
        batchNumber: summary.deleteBatches,
        requestedDeleteCount: ids.length,
        deletedCount: deleted,
      })
      logScheduledJob('scrub_golfhomiez_tournaments_batch_deleted', {
        correlationId,
        triggeredBy,
        batchNumber: summary.deleteBatches,
        requestedDeleteCount: ids.length,
        deletedCount: deleted,
      })
    }

    throwIfCancelled(signal, summary)
    logApi('scrub_golfhomiez_tournaments_completed', summary)
    logScheduledJob('scrub_golfhomiez_tournaments_completed', summary)
    return summary
  } catch (error) {
    if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') throw cancellationError(signal, summary)
    logError('Scrub Golf Homiez Tournaments failed', { correlationId, triggeredBy, error })
    logScheduledJob('scrub_golfhomiez_tournaments_failed', {
      correlationId,
      triggeredBy,
      level: 'error',
      error: error?.message || String(error),
      ...summary,
    })
    throw error
  }
}
