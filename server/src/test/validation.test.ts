import assert from 'node:assert/strict'
import test from 'node:test'
import { ChoirRole } from '@prisma/client'
import { AppError } from '../errors.js'
import { canUpdateDirectorTask, memberVisibilityFilter, requireRole } from '../tenant.js'
import {
  attendanceSchema,
  eventSchema,
  practiceSchema,
  rehearsalChangesSchema,
  rehearsalSchema,
  resourceSchema,
  songSchema,
} from '../schemas.js'
import { normalizeLoginName, normalizeChoirName } from '../identity.js'
import { buildWhere, createRecordSchema, recordSchema } from '../routes/finance.js'
import { csvCell } from '../csv.js'

test('song schema trims titles and accepts optional catalog details', () => {
  const song = songSchema.parse({ title: '  Be Thou My Vision  ', bpm: 96 })
  assert.equal(song.title, 'Be Thou My Vision')
  assert.equal(song.bpm, 96)
})

test('song schema rejects blank titles and out-of-range tempos', () => {
  assert.equal(songSchema.safeParse({ title: '  ' }).success, false)
  assert.equal(songSchema.safeParse({ title: 'Song', bpm: 500 }).success, false)
})

test('rehearsal schema rejects an end time before its start time', () => {
  const result = rehearsalSchema.safeParse({
    title: 'Choir practice',
    startsAt: '2026-10-14T18:00:00.000Z',
    endsAt: '2026-10-14T17:30:00.000Z',
  })
  assert.equal(result.success, false)
})

test('rehearsal schema accepts a valid date range', () => {
  const result = rehearsalSchema.safeParse({
    title: 'Choir practice',
    startsAt: '2026-10-14T17:00:00.000Z',
    endsAt: '2026-10-14T18:30:00.000Z',
  })
  assert.equal(result.success, true)
})

test('rehearsal updates accept partial edits for route-level range validation', () => {
  assert.deepEqual(
    rehearsalChangesSchema.parse({ title: 'Updated practice' }),
    { title: 'Updated practice' },
  )
})

test('role guards reject unauthorized choir actions', () => {
  assert.throws(
    () => requireRole(ChoirRole.MEMBER, [ChoirRole.ADMIN]),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  )
})

test('member directory scope stays within the caller role', () => {
  assert.deepEqual(
    memberVisibilityFilter(ChoirRole.MEMBER, 'member-id', null),
    { userId: 'member-id' },
  )
  assert.deepEqual(
    memberVisibilityFilter(ChoirRole.SECTION_LEADER, 'leader-id', 'section-id'),
    { sectionId: 'section-id' },
  )
  assert.equal(
    memberVisibilityFilter(ChoirRole.SECTION_LEADER, 'leader-id', null),
    null,
  )
  assert.deepEqual(
    memberVisibilityFilter(ChoirRole.ADMIN, 'admin-id', null),
    {},
  )
})

test('director task updates stay within assigned choir sections and individual assignments', () => {
  assert.equal(canUpdateDirectorTask(ChoirRole.MEMBER, 'member-a', 'section-a', {
    assignedToId: 'member-a',
    targetSectionId: null,
  }), true)
  assert.equal(canUpdateDirectorTask(ChoirRole.MEMBER, 'member-a', 'section-a', {
    assignedToId: 'member-b',
    targetSectionId: null,
  }), false)
  assert.equal(canUpdateDirectorTask(ChoirRole.SECTION_LEADER, 'leader-a', 'section-a', {
    assignedToId: null,
    targetSectionId: 'section-b',
  }), false)
  assert.equal(canUpdateDirectorTask(ChoirRole.SECTION_LEADER, 'leader-a', 'section-a', {
    assignedToId: null,
    targetSectionId: 'section-a',
  }), true)
  assert.equal(canUpdateDirectorTask(ChoirRole.TREASURER, 'treasurer', null, {
    assignedToId: null,
    targetSectionId: null,
  }), false)
})

test('login names and choir names are case-insensitive and whitespace-normalized', () => {
  assert.equal(normalizeLoginName('  Aline   Uwimana '), 'aline uwimana')
  assert.equal(normalizeChoirName(' St. Cecilia   Choir '), 'st. cecilia choir')
})

test('financial records require valid amounts and default to pending instead of paid', () => {
  const base = {
    type: 'INCOME',
    transactionDate: '2026-10-13T10:00:00.000Z',
    amount: 25.5,
    category: 'Contribution',
    description: 'Choir donation received outside the application',
  }
  assert.equal(recordSchema.parse(base).status, 'PENDING')
  assert.equal(recordSchema.safeParse({ ...base, amount: -1 }).success, false)
  assert.equal(recordSchema.safeParse({ ...base, amount: 1.239 }).success, false)
})

test('member contributions require a linked member, month, and completed payment status', () => {
  const contribution = {
    type: 'INCOME',
    status: 'PAID',
    transactionDate: '2026-10-13T10:00:00.000Z',
    amount: 25,
    category: 'Member contribution',
    description: 'Monthly contribution recorded after external receipt',
    membershipId: 'f4e9e863-22b0-4c84-90e6-26b5b4ebfb5b',
    contributionMonth: '2026-10-01T00:00:00.000Z',
  }
  assert.equal(createRecordSchema.safeParse(contribution).success, true)
  assert.equal(createRecordSchema.safeParse({ ...contribution, membershipId: null }).success, false)
  assert.equal(createRecordSchema.safeParse({ ...contribution, status: 'PENDING' }).success, false)
  assert.equal(createRecordSchema.safeParse({ ...contribution, type: 'EXPENSE' }).success, false)
  assert.equal(createRecordSchema.safeParse({ ...contribution, category: 'Donation' }).success, false)
})

test('financial record filters always remain scoped to their choir', () => {
  assert.deepEqual(buildWhere('choir-a', { type: 'INCOME' }), { choirId: 'choir-a', type: 'INCOME' })
  assert.deepEqual(buildWhere('choir-b', {}), { choirId: 'choir-b' })
  assert.deepEqual(buildWhere('choir-c', { search: 'Alice' }), {
    choirId: 'choir-c',
    OR: [
      { category: { contains: 'Alice', mode: 'insensitive' } },
      { description: { contains: 'Alice', mode: 'insensitive' } },
      { payerName: { contains: 'Alice', mode: 'insensitive' } },
      { beneficiary: { contains: 'Alice', mode: 'insensitive' } },
      { referenceNumber: { contains: 'Alice', mode: 'insensitive' } },
      { membership: { user: { name: { contains: 'Alice', mode: 'insensitive' } } } },
    ],
  })
})

test('CSV exports neutralize spreadsheet formulas and preserve CSV escaping', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), '"\'=HYPERLINK(""https://example.invalid"")"')
  assert.equal(csvCell('ordinary, value'), '"ordinary, value"')
})

test('event schema validates time ranges and defaults empty setlists and participants', () => {
  const valid = eventSchema.parse({
    title: 'Spring concert',
    type: 'CONCERT',
    startsAt: '2026-11-01T17:00:00.000Z',
    endsAt: '2026-11-01T19:00:00.000Z',
  })
  assert.deepEqual(valid.songIds, [])
  assert.deepEqual(valid.participantIds, [])
  assert.equal(eventSchema.safeParse({
    ...valid,
    endsAt: '2026-11-01T16:00:00.000Z',
  }).success, false)
})

test('practice assignments cannot target a section and an individual simultaneously', () => {
  const base = {
    songId: '00000000-0000-4000-8000-000000000001',
    sectionId: '00000000-0000-4000-8000-000000000002',
  }
  assert.equal(practiceSchema.safeParse(base).success, true)
  assert.equal(practiceSchema.safeParse({
    ...base,
    membershipId: '00000000-0000-4000-8000-000000000003',
  }).success, false)
})

test('attendance records require a supported status and at least one member', () => {
  assert.equal(attendanceSchema.safeParse({ records: [] }).success, false)
  assert.equal(attendanceSchema.safeParse({
    records: [{ membershipId: '00000000-0000-4000-8000-000000000001', status: 'LATE' }],
  }).success, true)
})

test('song resource links require HTTPS', () => {
  const resource = { title: 'Soprano part', type: 'SOPRANO_TRACK' }
  assert.equal(resourceSchema.safeParse({ ...resource, url: 'https://example.org/part.pdf' }).success, true)
  assert.equal(resourceSchema.safeParse({ ...resource, url: 'http://example.org/part.pdf' }).success, false)
})
