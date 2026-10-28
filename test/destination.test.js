// destination.js (PRD §7.1 B3) and its endpoint api/destination.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinationSummary, median, formatMinutes } from '../destination.js'
import { createHandler } from '../api/destination.js'
import { fakeSql, mockRes } from './helpers.js'

// Same fixture shape as test/schedule.test.js: seconds after the service
// day's midnight, one flag per weekday, calendar window as YYYYMMDD numbers.
const hms = (h, m) => h * 3600 + m * 60
const NONE = { sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0 }
const only = (...days) => ({ ...NONE, ...Object.fromEntries(days.map((d) => [d, 1])) })
const leg = (train, route, dep, arr, days) => ({
  train, route, dep_secs: dep, arr_secs: arr, can_board: true, can_alight: true,
  ...days, start_date: 20260906, end_date: 20270906,
})

const STOPS = [
  { stop_id: 'NYP', stop_name: 'Ny Moynihan Train Hall At Penn Station', stop_timezone: 'America/New_York' },
  { stop_id: 'BOS', stop_name: 'Boston South Station', stop_timezone: 'America/New_York' },
  { stop_id: 'PHL', stop_name: 'Philadelphia 30th Street', stop_timezone: 'America/New_York' },
]

// Thursday 2026-10-29 from NYP to BOS: five trains.
//   66   Wed-service, passes NYP 29:44 = 5:44 AM Thu, 4h 21m
//   1150 6:53 AM, 4h 14m      2150 Acela 7:57 AM, 3h 47m
//   1168 7:00 PM, 4h 36m      2999 Acela 11:30 PM, 1h 40m (fastest)
// Durations sorted: 100, 227, 254, 261, 276 -> median 254 = 4h 14m.
// Friday 2026-10-30: only 1150 and 2150 -> median (254 + 227) / 2 = 240.5.
const NYP_BOS = [
  leg('66', 'Northeast Regional', hms(29, 44), hms(34, 5), only('wednesday')),
  leg('1150', 'Northeast Regional', hms(6, 53), hms(11, 7), only('thursday', 'friday')),
  leg('2150', 'Acela', hms(7, 57), hms(11, 44), only('thursday', 'friday')),
  leg('1168', 'Northeast Regional', hms(19, 0), hms(23, 36), only('thursday')),
  leg('2999', 'Acela', hms(23, 30), hms(25, 10), only('thursday')),
]
const sqlFor = () => fakeSql({ stops: STOPS, legs: { 'NYP>BOS': NYP_BOS } })
const TODAY = '2026-10-28'

// ---- pure helpers ----

test('median: odd count, even count, unsorted input, empty', () => {
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([276, 100, 254, 227, 261]), 254)
  assert.equal(median([]), null)
  const input = [3, 1, 2]
  median(input)
  assert.deepEqual(input, [3, 1, 2], 'must not sort the caller’s array')
})

test('formatMinutes: same "Xh MMm" shape as schedule.js, rounded', () => {
  assert.equal(formatMinutes(254), '4h 14m')
  assert.equal(formatMinutes(240.5), '4h 01m')
  assert.equal(formatMinutes(59), '0h 59m')
  assert.equal(formatMinutes(null), null)
})

// ---- destinationSummary ----

test('summary for a real day: count, fastest, median, first/last, routes by frequency', async () => {
  const s = await destinationSummary(sqlFor(), { from: 'NYP', to: 'BOS', date: '2026-10-29', today: TODAY })
  assert.equal(s.ok, true)
  assert.equal(s.trainsPerDay, 5)
  assert.equal(s.fastest.train, '2999')
  assert.equal(s.fastest.duration, '1h 40m')
  assert.deepEqual(s.median, { minutes: 254, duration: '4h 14m' })
  // Service-day rule: train 66 (Wednesday service) is the FIRST Thursday departure.
  assert.equal(s.earliest.train, '66')
  assert.equal(s.earliest.depart, '5:44 AM')
  assert.equal(s.latest.depart, '11:30 PM')
  assert.deepEqual(s.routes, ['Northeast Regional', 'Acela'])
  assert.equal(s.medianPartial, false)
  assert.equal(s.weekday, 'thursday')
  // Our display names, not the feed's ("Ny Moynihan Train Hall At Penn Station").
  assert.equal(s.from.name, 'New York Penn Station')
  assert.equal(s.to.name, 'Boston South Station')
})

test('a station without one of our names keeps the feed name', async () => {
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>PHL': [leg('171', 'Northeast Regional', hms(8, 5), hms(9, 32), only('thursday'))] } })
  const s = await destinationSummary(sql, { from: 'NYP', to: 'PHL', date: '2026-10-29', today: TODAY })
  assert.equal(s.to.name, 'Philadelphia 30th Street')
})

test('summary for an even number of trains averages the middle two', async () => {
  const s = await destinationSummary(sqlFor(), { from: 'NYP', to: 'BOS', date: '2026-10-30', today: TODAY })
  assert.equal(s.trainsPerDay, 2)
  assert.deepEqual(s.median, { minutes: 240.5, duration: '4h 01m' })
})

test('no trains that day: ok, zero count, no median', async () => {
  const s = await destinationSummary(sqlFor(), { from: 'NYP', to: 'BOS', date: '2026-11-01', today: TODAY })
  assert.equal(s.ok, true)
  assert.equal(s.trainsPerDay, 0)
  assert.equal(s.median, null)
  assert.deepEqual(s.routes, [])
})

test('unknown station or the same station: ok is false, notes say why', async () => {
  const unknown = await destinationSummary(sqlFor(), { from: 'NYP', to: 'ZZZ', date: '2026-10-29', today: TODAY })
  assert.equal(unknown.ok, false)
  assert.ok(unknown.notes.some((n) => n.includes('ZZZ')))
  const same = await destinationSummary(sqlFor(), { from: 'NYP', to: 'NYP', date: '2026-10-29', today: TODAY })
  assert.equal(same.ok, false)
})

test('a date outside the feed is flagged, not shown as "no trains"', async () => {
  const s = await destinationSummary(sqlFor(), { from: 'NYP', to: 'BOS', date: '2028-01-05', today: TODAY })
  assert.equal(s.outsideFeed, true)
})

// ---- api/destination.js ----

const call = async (query, sql = sqlFor()) => {
  const res = mockRes()
  await createHandler({ makeSql: () => sql })({ method: 'GET', query }, res)
  return { res, sql }
}
const legQueries = (sql) => sql.calls.filter((c) => c.text.includes('from stop_times a')).map((c) => c.values.slice(0, 2))

test('endpoint: GET only', async () => {
  const res = mockRes()
  await createHandler({ makeSql: sqlFor })({ method: 'POST', query: { to: 'BOS' } }, res)
  assert.equal(res.statusCode, 405)
})

test('endpoint: `to` must be a station id, not free text', async () => {
  for (const to of [undefined, '', 'Boston South', '<script>', 'A'.repeat(11), ['BOS']]) {
    const { res } = await call({ to })
    assert.equal(res.statusCode, 400, `to=${JSON.stringify(to)}`)
  }
})

test('endpoint: `date` must be YYYY-MM-DD when given', async () => {
  const { res } = await call({ to: 'BOS', date: 'next thursday' })
  assert.equal(res.statusCode, 400)
})

test('endpoint: valid request returns the summary from the home station', async () => {
  const { res, sql } = await call({ to: 'BOS', from: 'NYP', date: '2026-10-29' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.trainsPerDay, 5)
  assert.deepEqual(legQueries(sql), [['NYP', 'BOS']])
})

test('endpoint: a bad or unknown `from` falls back to New York Penn (same guard as the ask box)', async () => {
  for (const from of ['ZZZ', 'NYP; drop table stops', '<img src=x>', 'Boston South Station']) {
    const { res, sql } = await call({ to: 'BOS', from, date: '2026-10-29' })
    assert.equal(res.statusCode, 200, `from=${from}`)
    assert.deepEqual(legQueries(sql), [['NYP', 'BOS']], `from=${from} should fall back to NYP`)
  }
})

test('endpoint: a database error is a 500 with the message', async () => {
  const { res } = await call({ to: 'BOS', date: '2026-10-29' }, fakeSql({ fail: 'db down' }))
  assert.equal(res.statusCode, 500)
  assert.equal(res.body.error, 'db down')
})
