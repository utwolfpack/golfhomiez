export function isTournamentArchived(row) {
  return Boolean(row?.archived_at || row?.archivedAt)
}

export async function setTournamentArchiveState(db, tournamentId, archived) {
  const id = String(tournamentId || '').trim()
  if (!id) throw new Error('Tournament id is required')

  const [result] = await db.execute(
    archived
      ? 'UPDATE tournaments SET archived_at = UTC_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL'
      : 'UPDATE tournaments SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NOT NULL',
    [id],
  )

  return {
    tournamentId: id,
    archived: Boolean(archived),
    changed: Number(result?.affectedRows || 0) > 0,
  }
}
