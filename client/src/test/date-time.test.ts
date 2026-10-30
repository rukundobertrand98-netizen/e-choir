import assert from 'node:assert/strict'
import test from 'node:test'
import { dateTimeLocalToIso, isoToDateTimeLocal } from '../date-time.js'

test('choir local time conversion uses the choir timezone, not the browser timezone', () => {
  assert.equal(
    dateTimeLocalToIso('2026-06-14T18:30', 'Africa/Kigali'),
    '2026-06-14T16:30:00.000Z',
  )
  assert.equal(
    isoToDateTimeLocal('2026-06-14T16:30:00.000Z', 'Africa/Kigali'),
    '2026-06-14T18:30',
  )
})

test('choir local time conversion rejects a nonexistent daylight-saving time', () => {
  assert.equal(
    dateTimeLocalToIso('2026-03-08T02:30', 'America/New_York'),
    null,
  )
})

test('choir local time conversion rejects an invalid timezone', () => {
  assert.equal(dateTimeLocalToIso('2026-06-14T18:30', 'Not/AZone'), null)
})
