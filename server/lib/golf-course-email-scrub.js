import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { GOLF_COURSE_EMAILS_OUTPUT_PATH } from './golf-course-emails.js'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REQUIRED_EMAIL_HEADER = 'Email Address'

function cleanValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 191)
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

export function normalizeGolfCourseEmailScrubValues(values) {
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

export function parseGolfCourseEmailsCsv(csvText) {
  const source = String(csvText ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"' && cell.length === 0) {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (quoted) throw new Error('golfCourseEmails.csv contains an unterminated quoted field')
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  while (rows.length && rows[rows.length - 1].every((value) => value === '')) rows.pop()
  return rows
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function headerIndex(header, expected) {
  const target = expected.trim().toLowerCase()
  return header.findIndex((value) => String(value ?? '').trim().toLowerCase() === target)
}

export function scrubGolfCourseEmailsCsv(csvText, matchValues, { signal = null, onDelete = null, onDuplicate = null } = {}) {
  const values = normalizeGolfCourseEmailScrubValues(matchValues)
  const normalizedValues = values.map((value) => ({ value, lower: value.toLowerCase() }))
  const rows = parseGolfCourseEmailsCsv(csvText)
  if (!rows.length) throw new Error('golfCourseEmails.csv is empty and does not contain the required header row')

  const header = rows[0]
  const emailIndex = headerIndex(header, REQUIRED_EMAIL_HEADER)
  if (emailIndex < 0) throw new Error(`golfCourseEmails.csv is missing the required "${REQUIRED_EMAIL_HEADER}" column`)
  const courseNameIndex = headerIndex(header, 'Golf Course Name')
  const keptRows = [header]
  const matchedValueCounts = Object.fromEntries(values.map((value) => [value, 0]))
  const seenEmails = new Map()
  let deletedCount = 0
  let matchedDeletedCount = 0
  let duplicateDeletedCount = 0
  let recordsProcessed = 0

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    throwIfCancelled(signal, { configuredValueCount: values.length, recordsProcessed, deletedCount })
    const row = rows[rowIndex]
    if (!row.some((value) => String(value ?? '').trim())) continue
    recordsProcessed += 1
    const emailAddress = String(row[emailIndex] ?? '')
    const lowerEmail = emailAddress.toLowerCase()
    const matched = normalizedValues.find((candidate) => lowerEmail.includes(candidate.lower))
    if (matched) {
      deletedCount += 1
      matchedDeletedCount += 1
      matchedValueCounts[matched.value] += 1
      if (typeof onDelete === 'function') {
        onDelete({
          rowNumber: rowIndex + 1,
          golfCourseName: courseNameIndex >= 0 ? String(row[courseNameIndex] ?? '').trim() : '',
          matchValue: matched.value,
        })
      }
      continue
    }

    const normalizedEmail = emailAddress.trim().toLowerCase()
    if (normalizedEmail) {
      const existing = seenEmails.get(normalizedEmail)
      if (existing) {
        deletedCount += 1
        duplicateDeletedCount += 1
        if (typeof onDuplicate === 'function') {
          onDuplicate({
            rowNumber: rowIndex + 1,
            golfCourseName: courseNameIndex >= 0 ? String(row[courseNameIndex] ?? '').trim() : '',
            duplicateOfRowNumber: existing.rowNumber,
            duplicateOfGolfCourseName: existing.golfCourseName,
          })
        }
        continue
      }
      seenEmails.set(normalizedEmail, {
        rowNumber: rowIndex + 1,
        golfCourseName: courseNameIndex >= 0 ? String(row[courseNameIndex] ?? '').trim() : '',
      })
    }
    keptRows.push(row)
  }

  return {
    csv: serializeCsv(keptRows),
    configuredValues: values,
    configuredValueCount: values.length,
    recordsProcessed,
    deletedCount,
    matchedDeletedCount,
    duplicateDeletedCount,
    retainedCount: keptRows.length - 1,
    matchedValueCounts,
  }
}

async function writeCsvAtomically(outputPath, csv) {
  const directory = path.dirname(outputPath)
  await mkdir(directory, { recursive: true })
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tempPath, csv, 'utf8')
    await rename(tempPath, outputPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

export async function runScrubGolfCourseEmails(_db, {
  matchValues = [],
  correlationId = null,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
  outputPath = GOLF_COURSE_EMAILS_OUTPUT_PATH,
} = {}) {
  const values = normalizeGolfCourseEmailScrubValues(matchValues)
  const relativeOutputFile = path.relative(PROJECT_ROOT, outputPath).replace(/\\/g, '/')
  const startDetails = {
    correlationId,
    triggeredBy,
    configuredValueCount: values.length,
    outputFile: relativeOutputFile,
  }
  throwIfCancelled(signal, startDetails)
  logApi('scrub_golf_course_emails_started', startDetails)
  logScheduledJob('scrub_golf_course_emails_started', startDetails)

  let csvText
  try {
    csvText = await readFile(outputPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missing = new Error('docs/golfCourseEmails.csv was not found. Run Build Golf Course Emails before Scrub Golf Course Emails.')
      missing.code = 'GOLF_COURSE_EMAILS_FILE_NOT_FOUND'
      logError('Scrub Golf Course Emails source CSV was not found', { correlationId, outputPath, error: missing })
      throw missing
    }
    logError('Scrub Golf Course Emails could not read the source CSV', { correlationId, outputPath, error })
    throw error
  }

  throwIfCancelled(signal, startDetails)
  const result = scrubGolfCourseEmailsCsv(csvText, values, {
    signal,
    onDelete({ rowNumber, golfCourseName, matchValue }) {
      logScheduledJob('scrub_golf_course_emails_row_deleted', {
        correlationId,
        rowNumber,
        golfCourseName: golfCourseName || null,
        matchValue,
      })
    },
    onDuplicate({ rowNumber, golfCourseName, duplicateOfRowNumber, duplicateOfGolfCourseName }) {
      logScheduledJob('scrub_golf_course_emails_duplicate_deleted', {
        correlationId,
        rowNumber,
        golfCourseName: golfCourseName || null,
        duplicateOfRowNumber,
        duplicateOfGolfCourseName: duplicateOfGolfCourseName || null,
      })
    },
  })

  throwIfCancelled(signal, {
    ...startDetails,
    recordsProcessed: result.recordsProcessed,
    deletedCount: result.deletedCount,
  })
  await writeCsvAtomically(outputPath, result.csv)

  const output = {
    outputFile: relativeOutputFile,
    configuredValueCount: result.configuredValueCount,
    recordsProcessed: result.recordsProcessed,
    deletedCount: result.deletedCount,
    matchedDeletedCount: result.matchedDeletedCount,
    duplicateDeletedCount: result.duplicateDeletedCount,
    retainedCount: result.retainedCount,
    matchedValueCounts: result.matchedValueCounts,
  }
  logApi('scrub_golf_course_emails_completed', { correlationId, ...output })
  logScheduledJob('scrub_golf_course_emails_completed', { correlationId, ...output })
  return output
}
