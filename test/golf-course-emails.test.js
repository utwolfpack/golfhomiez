import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import {
  buildGolfCourseEmailsCsv,
  dedupeGolfCourseEmailRecords,
  extractGolfCourseEmailContacts,
  findBestGolfCourseContactPage,
  runBuildGolfCourseEmails,
} from '../server/lib/golf-course-emails.js'
import { SCHEDULED_JOB_DEFINITIONS } from '../server/lib/scheduled-jobs.js'
import {
  normalizeGolfCourseEmailScrubValues,
  runScrubGolfCourseEmails,
  scrubGolfCourseEmailsCsv,
} from '../server/lib/golf-course-email-scrub.js'

test('Build Golf Course Emails is registered as an admin scheduled job', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === 'buildGolfCourseEmails')
  assert.ok(definition)
  assert.equal(definition.name, 'Build Golf Course Emails')
  assert.equal(definition.defaultSchedule?.type, 'manual')
  assert.equal(definition.backgroundManualRun, true)
  assert.match(definition.description, /docs\/golfCourseEmails\.csv/)
  assert.match(definition.description, /at most two page attempts/i)
})

test('golf course email extraction captures required email plus nearby optional contact details', () => {
  const contacts = extractGolfCourseEmailContacts(`
    <section class="staff-card">
      <h3>Jane Smith</h3>
      <p>Director of Golf</p>
      <a href="mailto:Jane.Smith@ExampleGolf.com">Jane.Smith@ExampleGolf.com</a>
    </section>
    <footer>Questions: info@examplegolf.com</footer>
  `)
  assert.equal(contacts.length, 2)
  const jane = contacts.find((contact) => contact.email === 'jane.smith@examplegolf.com')
  assert.ok(jane)
  assert.equal(jane.firstName, 'Jane')
  assert.equal(jane.lastName, 'Smith')
  assert.equal(jane.position, 'Director Of Golf')
  assert.ok(contacts.some((contact) => contact.email === 'info@examplegolf.com'))
})

test('contact-page discovery stays on the golf course website and prefers contact/staff links', () => {
  const selected = findBestGolfCourseContactPage(`
    <a href="/about">About Us</a>
    <a href="/contact-us">Contact</a>
    <a href="https://outside.example/staff">Staff elsewhere</a>
  `, 'https://course.example/')
  assert.equal(selected, 'https://course.example/contact-us')
})

test('Build Golf Course Emails crawls no more than two pages per course and writes the requested CSV in docs format', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'golf-course-emails-'))
  const outputPath = path.join(tempDir, 'docs', 'golfCourseEmails.csv')
  const requests = []
  const db = {
    async execute(sql) {
      assert.match(sql, /FROM golf_courses/)
      assert.match(sql, /TRIM\(website\)/)
      return [[{
        id: 'course-1',
        name: 'Example Golf Club',
        state_code: 'UT',
        city: 'Salt Lake City',
        website: 'http://93.184.216.34/',
      }]]
    },
  }
  const fetchImpl = async (url) => {
    requests.push(String(url))
    if (String(url).endsWith('/contact')) {
      return new Response(`
        <div>Jane Smith | General Manager | <a href="mailto:jane@example.com">jane@example.com</a></div>
        <a href="/staff">Staff</a>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    return new Response(`
      <footer>Email info@example.com</footer>
      <a href="/about">About</a>
      <a href="/contact">Contact Us</a>
      <a href="/staff">Staff</a>
    `, { status: 200, headers: { 'content-type': 'text/html' } })
  }

  try {
    const output = await runBuildGolfCourseEmails(db, {
      correlationId: 'test-correlation',
      fetchImpl,
      outputPath,
      concurrency: 1,
      timeoutMs: 2_000,
    })
    assert.equal(requests.length, 2)
    assert.equal(output.golfCoursesEligible, 1)
    assert.equal(output.golfCoursesProcessed, 1)
    assert.equal(output.golfCoursesWithEmails, 1)
    assert.equal(output.pagesAttempted, 2)
    assert.equal(output.pagesFetched, 2)
    assert.equal(output.emailRecords, 2)

    const csv = await readFile(outputPath, 'utf8')
    assert.match(csv, /^Golf Course Name,Email Address,First Name,Last Name,Position\n/)
    assert.match(csv, /Example Golf Club,info@example\.com,,,/)
    assert.match(csv, /Example Golf Club,jane@example\.com,Jane,Smith,General Manager/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('CSV escaping keeps commas and quotes valid for downstream email jobs', () => {
  const csv = buildGolfCourseEmailsCsv([{ golfCourseName: 'Golf, Club', email: 'pro@example.com', firstName: 'Ann', lastName: 'O"Neil', position: 'GM' }])
  assert.equal(csv, 'Golf Course Name,Email Address,First Name,Last Name,Position\n"Golf, Club",pro@example.com,Ann,"O""Neil",GM\n')
})


test('golfCourseEmails.csv creation prevents duplicate email addresses case-insensitively', () => {
  const records = [
    { golfCourseName: 'Alpha Golf Club', email: 'Pro@Example.com', firstName: 'Ann', lastName: 'Green', position: 'GM' },
    { golfCourseName: 'Beta Golf Club', email: ' pro@example.com ', firstName: 'Bob', lastName: 'Blue', position: 'Director' },
    { golfCourseName: 'Gamma Golf Club', email: 'events@example.com', firstName: '', lastName: '', position: '' },
  ]
  const uniqueRecords = dedupeGolfCourseEmailRecords(records)
  assert.equal(uniqueRecords.length, 2)
  assert.equal(uniqueRecords[0].golfCourseName, 'Alpha Golf Club')

  const csv = buildGolfCourseEmailsCsv(records)
  assert.equal((csv.match(/pro@example\.com/gi) || []).length, 1)
  assert.match(csv, /Alpha Golf Club,Pro@Example\.com,Ann,Green,GM/)
  assert.doesNotMatch(csv, /Beta Golf Club/)
  assert.match(csv, /Gamma Golf Club,events@example\.com,,,/)
})

test('transient root failures receive only one retry and consume the two-attempt course budget', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'golf-course-emails-retry-'))
  const outputPath = path.join(tempDir, 'docs', 'golfCourseEmails.csv')
  let requestCount = 0
  const db = {
    async execute() {
      return [[{
        id: 'course-retry',
        name: 'Retry Golf Club',
        state_code: 'UT',
        city: 'Ogden',
        website: 'http://93.184.216.34/',
      }]]
    },
  }
  const fetchImpl = async () => {
    requestCount += 1
    if (requestCount === 1) return new Response('temporary failure', { status: 503, headers: { 'content-type': 'text/plain' } })
    return new Response(`
      <a href="mailto:manager@retry.example">manager@retry.example</a>
      <a href="/contact">Contact</a>
    `, { status: 200, headers: { 'content-type': 'text/html' } })
  }

  try {
    const output = await runBuildGolfCourseEmails(db, { fetchImpl, outputPath, concurrency: 1, timeoutMs: 2_000 })
    assert.equal(requestCount, 2)
    assert.equal(output.pagesAttempted, 2)
    assert.equal(output.pagesFetched, 1)
    assert.equal(output.emailRecords, 1)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})


test('Scrub Golf Course Emails is registered as a configurable manual scheduled job', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === 'scrubGolfCourseEmails')
  assert.ok(definition)
  assert.equal(definition.name, 'Scrub Golf Course Emails')
  assert.equal(definition.defaultSchedule?.type, 'manual')
  assert.deepEqual(definition.defaultJobConfig, { matchValues: [] })
  assert.match(definition.description, /Email Address/)
  assert.match(definition.description, /docs\/golfCourseEmails\.csv/)
  assert.match(definition.description, /duplicate email-address rows/i)
})

test('golf course email scrub values are trimmed, de-duplicated case-insensitively, and capped', () => {
  const values = normalizeGolfCourseEmailScrubValues([' noreply@ ', 'NOREPLY@', '', 'example.invalid'])
  assert.deepEqual(values, ['noreply@', 'example.invalid'])
})

test('Scrub Golf Course Emails removes matching email rows record by record and preserves valid CSV quoting', () => {
  const source = [
    'Golf Course Name,Email Address,First Name,Last Name,Position',
    'Keep Golf Club,pro@keepgolf.com,Kim,Green,Director of Golf',
    'Delete One,no-reply@example.com,,,',
    '"Delete, Two",staff@blocked.example,Ann,"O""Neil",GM',
    'Keep Two,events@example.org,,,Events Director',
    '',
  ].join('\n')
  const deletedRows = []
  const result = scrubGolfCourseEmailsCsv(source, ['NO-REPLY@', 'blocked.example'], {
    onDelete: (row) => deletedRows.push(row),
  })

  assert.equal(result.recordsProcessed, 4)
  assert.equal(result.deletedCount, 2)
  assert.equal(result.retainedCount, 2)
  assert.deepEqual(result.matchedValueCounts, { 'NO-REPLY@': 1, 'blocked.example': 1 })
  assert.deepEqual(deletedRows.map((row) => ({ golfCourseName: row.golfCourseName, matchValue: row.matchValue })), [
    { golfCourseName: 'Delete One', matchValue: 'NO-REPLY@' },
    { golfCourseName: 'Delete, Two', matchValue: 'blocked.example' },
  ])
  assert.match(result.csv, /^Golf Course Name,Email Address,First Name,Last Name,Position\n/)
  assert.match(result.csv, /Keep Golf Club,pro@keepgolf\.com,Kim,Green,Director of Golf/)
  assert.match(result.csv, /Keep Two,events@example\.org,,,Events Director/)
  assert.doesNotMatch(result.csv, /no-reply@example\.com/)
  assert.doesNotMatch(result.csv, /staff@blocked\.example/)
})

test('Scrub Golf Course Emails removes duplicate email rows and keeps the first record', () => {
  const source = [
    'Golf Course Name,Email Address,First Name,Last Name,Position',
    'First Course,contact@example.com,Jane,Smith,GM',
    'Duplicate Course, CONTACT@EXAMPLE.COM ,John,Doe,Director',
    'Unique Course,events@example.org,,,Events Director',
    '',
  ].join('\n')
  const duplicates = []
  const result = scrubGolfCourseEmailsCsv(source, [], {
    onDuplicate: (row) => duplicates.push(row),
  })

  assert.equal(result.recordsProcessed, 3)
  assert.equal(result.deletedCount, 1)
  assert.equal(result.matchedDeletedCount, 0)
  assert.equal(result.duplicateDeletedCount, 1)
  assert.equal(result.retainedCount, 2)
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].golfCourseName, 'Duplicate Course')
  assert.equal(duplicates[0].duplicateOfGolfCourseName, 'First Course')
  assert.match(result.csv, /First Course,contact@example\.com,Jane,Smith,GM/)
  assert.doesNotMatch(result.csv, /Duplicate Course/)
  assert.match(result.csv, /Unique Course,events@example\.org,,,Events Director/)
})

test('Scrub Golf Course Emails rewrites docs CSV atomically and emits correlated job diagnostics', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'golf-course-email-scrub-'))
  const outputPath = path.join(tempDir, 'docs', 'golfCourseEmails.csv')
  const apiEvents = []
  const jobEvents = []
  try {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, [
      'Golf Course Name,Email Address,First Name,Last Name,Position',
      'Delete Golf Course,contact@invalid.test,,,',
      'Keep Golf Course,events@validgolf.com,,,',
      'Duplicate Golf Course, EVENTS@VALIDGOLF.COM ,Pat,Green,Manager',
      '',
    ].join('\n'), 'utf8')

    const output = await runScrubGolfCourseEmails(null, {
      matchValues: ['invalid.test'],
      correlationId: 'email-scrub-correlation',
      outputPath,
      logApi: (message, data) => apiEvents.push({ message, data }),
      logScheduledJob: (message, data) => jobEvents.push({ message, data }),
    })

    assert.equal(output.recordsProcessed, 3)
    assert.equal(output.deletedCount, 2)
    assert.equal(output.matchedDeletedCount, 1)
    assert.equal(output.duplicateDeletedCount, 1)
    assert.equal(output.retainedCount, 1)
    assert.equal(output.configuredValueCount, 1)
    const csv = await readFile(outputPath, 'utf8')
    assert.doesNotMatch(csv, /contact@invalid\.test/)
    assert.match(csv, /Keep Golf Course,events@validgolf\.com/)
    assert.doesNotMatch(csv, /Duplicate Golf Course/)
    assert.ok(apiEvents.some((event) => event.message === 'scrub_golf_course_emails_started' && event.data.correlationId === 'email-scrub-correlation'))
    assert.ok(apiEvents.some((event) => event.message === 'scrub_golf_course_emails_completed' && event.data.deletedCount === 2 && event.data.duplicateDeletedCount === 1))
    assert.ok(jobEvents.some((event) => event.message === 'scrub_golf_course_emails_row_deleted' && event.data.matchValue === 'invalid.test'))
    assert.ok(jobEvents.some((event) => event.message === 'scrub_golf_course_emails_duplicate_deleted' && event.data.golfCourseName === 'Duplicate Golf Course'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('Scrub Golf Course Emails reports a clear prerequisite error when golfCourseEmails.csv does not exist', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'golf-course-email-scrub-missing-'))
  try {
    await assert.rejects(
      () => runScrubGolfCourseEmails(null, { matchValues: ['noreply@'], outputPath: path.join(tempDir, 'docs', 'golfCourseEmails.csv') }),
      /Run Build Golf Course Emails before Scrub Golf Course Emails/,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
