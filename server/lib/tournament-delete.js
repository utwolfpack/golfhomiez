const SAFE_TOURNAMENT_CHILD_DELETES = [
  {
    tableName: 'tournament_registrations',
    countKey: 'tournamentRegistrations',
    description: 'golfer tournament registration rows',
    deleteSql: 'DELETE FROM tournament_registrations WHERE tournament_id = ?',
  },
  {
    tableName: 'organizer_tournament_invites',
    countKey: 'organizerTournamentInvites',
    description: 'organizer tournament invite rows',
    deleteSql: 'DELETE FROM organizer_tournament_invites WHERE tournament_id = ?',
  },
]

export { SAFE_TOURNAMENT_CHILD_DELETES }

async function tableExists(connection, tableName) {
  const [[row] = []] = await connection.execute(
    `SELECT COUNT(*) AS table_exists
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName],
  )
  return Number(row?.table_exists || 0) > 0
}

export async function deleteTournamentWithSafeAssociations(pool, tournamentRow) {
  const tournamentId = String(tournamentRow?.id || '').trim()
  if (!tournamentId) throw new Error('Tournament id is required for deletion.')

  const connection = await pool.getConnection()
  const deletedRecords = {
    tournamentRegistrations: 0,
    organizerTournamentInvites: 0,
    tournaments: 0,
  }

  try {
    await connection.beginTransaction()

    const [[lockedTournament] = []] = await connection.execute(
      `SELECT id, tournament_identifier, name, status
         FROM tournaments
        WHERE id = ?
        FOR UPDATE`,
      [tournamentId],
    )

    if (!lockedTournament) {
      await connection.rollback()
      return null
    }

    for (const childDelete of SAFE_TOURNAMENT_CHILD_DELETES) {
      if (!(await tableExists(connection, childDelete.tableName))) continue
      const [result] = await connection.execute(childDelete.deleteSql, [tournamentId])
      deletedRecords[childDelete.countKey] = Number(result?.affectedRows || 0)
    }

    const [tournamentDeleteResult] = await connection.execute(
      'DELETE FROM tournaments WHERE id = ?',
      [tournamentId],
    )
    deletedRecords.tournaments = Number(tournamentDeleteResult?.affectedRows || 0)

    await connection.commit()

    return {
      deleted: deletedRecords.tournaments > 0,
      tournamentId,
      tournamentIdentifier: lockedTournament.tournament_identifier || tournamentRow.tournament_identifier || null,
      name: lockedTournament.name || tournamentRow.name || null,
      status: lockedTournament.status || tournamentRow.status || null,
      deletedRecords,
    }
  } catch (error) {
    try {
      await connection.rollback()
    } catch {}
    throw error
  } finally {
    connection.release()
  }
}
