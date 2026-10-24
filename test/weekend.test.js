import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planWeekend, TRAIN_LIST_LIMIT, DEFAULT_PAIR_LIMIT } from '../weekend.js'
import { clockLabelToMinutes } from '../schedule.js'
import { askQuestion, WEEKEND_PAIR_MAX } from '../ask-core.js'
import { fakeAnthropic, fakeSql, toolUseFor, textResponse } from './helpers.js'

// ---------------------------------------------------------------------------
// Fixtures. Leg rows have the shape the legs query in schedule.js returns (see
// schedule.test.js). Calendar dates used below, all in the feed (Sep 2026 -
// Sep 2027): 2026-09-18 is a Friday, 2026-09-20 a Sunday. 2026-10-30 is a Friday
// and 2026-11-01 the Sunday the clocks go back.
// ---------------------------------------------------------------------------

const hms = (h, m) => h * 3600 + m * 60
const NONE = { sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0 }
const only = (...days) => ({ ...NONE, ...Object.fromEntries(days.map((d) => [d, 1])) })

const leg = (train, route, dep, arr, days, extra = {}) => ({
  train, route, dep_secs: dep, arr_secs: arr, can_board: true, can_alight: true, ...days,
  start_date: 20260906, end_date: 20270906, ...extra,
})

const STOPS = [
  { stop_id: 'NYP', stop_name: 'Ny Moynihan Train Hall At Penn Station', stop_timezone: 'America/New_York' },
  { stop_id: 'PHL', stop_name: 'Philadelphia', stop_timezone: 'America/New_York' },
  { stop_id: 'PDX', stop_name: 'Portland', stop_timezone: 'America/Los_Angeles' },
  { stop_id: 'POR', stop_name: 'Portland', stop_timezone: 'America/New_York' },
]

// Friday NYP -> PHL: A is a normal evening train; B leaves 11:23 PM and arrives
// 1:00 AM SATURDAY (arriveDayOffset 1: an overnight outbound). C runs Saturdays
// only, so it must never show up on a Friday.
const NYP_PHL = [
  leg('A', 'Northeast Regional', hms(18, 5), hms(19, 30), only('friday')),
  leg('B', 'Northeast Regional', hms(23, 23), hms(25, 0), only('friday')),
  leg('C', 'Keystone Service', hms(9, 0), hms(10, 30), only('saturday')),
]
// Sunday PHL -> NYP.
const PHL_NYP = [
  leg('X', 'Northeast Regional', hms(9, 0), hms(10, 30), only('sunday')),
  leg('Y', 'Keystone Service', hms(17, 0), hms(18, 30), only('sunday')),
  leg('Z', 'Palmetto', hms(20, 0), hms(21, 30), only('sunday')),
]

const run = (opts, { legs = { 'NYP>PHL': NYP_PHL, 'PHL>NYP': PHL_NYP }, ...extra } = {}) => {
  const sql = fakeSql({ stops: STOPS, legs, ...extra })
  return planWeekend(sql, { from: 'NYP', to: 'PHL', today: '2026-10-23', ...opts }).then((r) => ({ r, sql }))
}
const FRI_SUN = { outDate: '2026-09-18', returnDate: '2026-09-20' }

// ---------------------------------------------------------------------------
// Pairing math
// ---------------------------------------------------------------------------

test('clockLabelToMinutes undoes the schedule display format', () => {
  assert.equal(clockLabelToMinutes('12:00 AM'), 0)
  assert.equal(clockLabelToMinutes('12:30 AM'), 30)
  assert.equal(clockLabelToMinutes('6:05 PM'), 18 * 60 + 5)
  assert.equal(clockLabelToMinutes('12:15 PM'), 12 * 60 + 15)
  assert.equal(clockLabelToMinutes('11:59 PM'), 23 * 60 + 59)
  assert.equal(clockLabelToMinutes('25:00'), null)
  assert.equal(clockLabelToMinutes('13:00 PM'), null)
})

test('each outbound pairs with its LATEST return; an overnight outbound has fewer hours', async () => {
  const { r } = await run(FRI_SUN)
  assert.deepEqual(r.pairs.map((p) => [p.out.train, p.back.train, p.hoursAtDestination]), [
    // arrive Fri 7:30 PM -> leave Sun 8:00 PM = 48.5 h
    ['A', 'Z', 48.5],
    // arrive Sat 1:00 AM (arriveDayOffset 1) -> Sun 8:00 PM = 43 h, 5.5 h less than A
    ['B', 'Z', 43],
  ])
  assert.equal(r.pairs[1].out.arriveDayOffset, 1)
  assert.equal(r.outDate, '2026-09-18')
  assert.equal(r.returnDate, '2026-09-20')
  // C (Saturday only) is not a Friday train.
  assert.deepEqual(r.outbound.map((t) => t.train), ['A', 'B'])
  assert.deepEqual(r.inbound.map((t) => t.train), ['X', 'Y', 'Z'])
})

test('summary: counts, best pair for the earliest outbound, and the most hours possible', async () => {
  const { r } = await run(FRI_SUN)
  assert.equal(r.summary.outboundCount, 2)
  assert.equal(r.summary.inboundCount, 3)
  assert.equal(r.summary.pairCount, 2)
  assert.equal(r.summary.maxHoursAtDestination, 48.5)
  assert.deepEqual(
    [r.summary.latestReturnForEarliestOut.out.train, r.summary.latestReturnForEarliestOut.back.train],
    ['A', 'Z'],
  )
})

test('returnDepartAfter and departAfter are applied to the right leg', async () => {
  const { r } = await run({ ...FRI_SUN, departAfter: '20:00', returnDepartAfter: '10:00' })
  assert.deepEqual(r.outbound.map((t) => t.train), ['B'])
  assert.deepEqual(r.inbound.map((t) => t.train), ['Y', 'Z'])
  assert.deepEqual(r.pairs.map((p) => [p.out.train, p.back.train]), [['B', 'Z']])
})

test('minHoursAtDestination drops pairs that leave too little time', async () => {
  const mid = (await run({ ...FRI_SUN, minHoursAtDestination: 44 })).r
  assert.deepEqual(mid.pairs.map((p) => p.out.train), ['A'])

  const none = (await run({ ...FRI_SUN, minHoursAtDestination: 100 })).r
  assert.deepEqual(none.pairs, [])
  assert.equal(none.summary.maxHoursAtDestination, null)
  assert.ok(none.notes.some((n) => /at least 100 hours/.test(n)))
})

test('default: a return that leaves before the outbound arrives is excluded', async () => {
  // Same day (a day trip): out 8:00-10:00; returns at 9:00 (before arrival) and 15:00.
  const legs = {
    'NYP>PHL': [leg('S1', 'Northeast Regional', hms(8, 0), hms(10, 0), only('saturday'))],
    'PHL>NYP': [
      leg('R1', 'Northeast Regional', hms(9, 0), hms(10, 30), only('saturday')),
      leg('R2', 'Northeast Regional', hms(15, 0), hms(16, 30), only('saturday')),
    ],
  }
  const { r } = await run({ outDate: '2026-09-19', returnDate: '2026-09-19' }, { legs })
  assert.deepEqual(r.pairs.map((p) => [p.out.train, p.back.train, p.hoursAtDestination]), [['S1', 'R2', 5]])

  // Only the early return exists: no pair, and the note says why.
  const early = { ...legs, 'PHL>NYP': [legs['PHL>NYP'][0]] }
  const none = (await run({ outDate: '2026-09-19', returnDate: '2026-09-19' }, { legs: early })).r
  assert.deepEqual(none.pairs, [])
  assert.ok(none.notes.some((n) => /No return train leaves after any outbound train arrives/.test(n)))
})

test('when the clocks go back between the two days, hours are real elapsed time (+1 h)', async () => {
  // Fri 2026-10-30 -> Sun 2026-11-01 (DST ends that morning). Clock difference
  // 7:30 PM Fri -> 8:00 PM Sun is 48.5 h; the Sunday is an hour longer, so 49.5 h.
  const { r } = await run({ outDate: '2026-10-30', returnDate: '2026-11-01' })
  assert.equal(r.pairs[0].hoursAtDestination, 49.5)
  assert.ok(r.notes.some((n) => /clocks change/.test(n)))
  // No clock change, no note.
  const plain = (await run(FRI_SUN)).r
  assert.ok(!plain.notes.some((n) => /clocks change/.test(n)))
})

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('weekday-only input resolves across a month boundary, and the notes state the dates', async () => {
  // Wednesday 2026-10-28 -> the next Friday is 2026-10-30; the first Sunday on
  // or after it is 2026-11-01 (the next month).
  const { r } = await run({ today: '2026-10-28' })
  assert.equal(r.outDate, '2026-10-30')
  assert.equal(r.returnDate, '2026-11-01')
  assert.ok(r.notes.some((n) => n.includes('next friday (2026-10-30)')))
  assert.ok(r.notes.some((n) => n.includes('first sunday on or after the outbound date (2026-11-01)')))
})

test('today counts when it is the outbound weekday', async () => {
  const { r } = await run({ today: '2026-10-23' }) // a Friday
  assert.equal(r.outDate, '2026-10-23')
  assert.equal(r.returnDate, '2026-10-25')
})

test('custom days, and the return is the first returnDay ON or after the outbound date', async () => {
  const sat = (await run({ outDay: 'saturday', returnDay: 'sunday' })).r
  assert.deepEqual([sat.outDate, sat.returnDate], ['2026-10-24', '2026-10-25'])
  const same = (await run({ outDay: 'saturday', returnDay: 'saturday' })).r
  assert.deepEqual([same.outDate, same.returnDate], ['2026-10-24', '2026-10-24'])
})

test('a given outDate fixes the return too: first returnDay after it', async () => {
  const { r } = await run({ outDate: '2026-09-18' })
  assert.deepEqual([r.outDate, r.returnDate], ['2026-09-18', '2026-09-20'])
  // Only the return date was resolved, so only it is explained.
  assert.ok(!r.notes.some((n) => /No outbound date/.test(n)))
  assert.ok(r.notes.some((n) => /No return date/.test(n)))
})

test('a return date before the outbound date is an error the model can read', async () => {
  await assert.rejects(run({ outDate: '2026-09-20', returnDate: '2026-09-18' }), /before the outbound date/)
})

test('bad input is rejected with a plain message', async () => {
  await assert.rejects(run({ outDate: '2026-02-31' }), /"outDate" must be a real calendar date/)
  await assert.rejects(run({ outDay: 'funday' }), /"outDay" must be one of/)
  await assert.rejects(run({ returnDepartAfter: '25:00' }), /"returnDepartAfter" must be a 24-hour time/)
  await assert.rejects(run({ minHoursAtDestination: -1 }), /"minHoursAtDestination"/)
  await assert.rejects(run({ limit: 0 }), /"limit"/)
  await assert.rejects(run({ from: '' }), /"from" must be/)
})

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

test('pairs are capped: one per outbound train, then the `limit` with the most hours (never N x M)', async () => {
  const outs = [10, 11, 12, 13].map((h, i) => leg(`O${i}`, 'Northeast Regional', hms(h, 0), hms(h + 1, 0), only('friday')))
  const backs = [9, 12, 15, 18].map((h, i) => leg(`R${i}`, 'Northeast Regional', hms(h, 0), hms(h + 1, 0), only('sunday')))
  const legs = { 'NYP>PHL': outs, 'PHL>NYP': backs }

  const all = (await run(FRI_SUN, { legs })).r
  assert.equal(all.pairs.length, 4) // not 4 x 4 = 16
  assert.ok(all.pairs.every((p) => p.back.train === 'R3')) // each uses the latest return

  const two = (await run({ ...FRI_SUN, limit: 2 }, { legs })).r
  // The two earliest outbounds have the most hours; shown in departure order.
  assert.deepEqual(two.pairs.map((p) => p.out.train), ['O0', 'O1'])
  assert.equal(two.summary.pairCount, 4)
  assert.ok(two.notes.some((n) => /Showing the 2 of 4 outbound trains/.test(n)))
})

test('the default pair limit and the train-list limit keep the result small', async () => {
  const outs = Array.from({ length: 15 }, (_, i) => leg(`O${i}`, 'Northeast Regional', hms(6, i * 10), hms(8, i * 10), only('friday')))
  const backs = Array.from({ length: 15 }, (_, i) => leg(`R${i}`, 'Northeast Regional', hms(6, i * 10), hms(8, i * 10), only('sunday')))
  const { r } = await run(FRI_SUN, { legs: { 'NYP>PHL': outs, 'PHL>NYP': backs } })
  assert.equal(r.pairs.length, DEFAULT_PAIR_LIMIT)
  assert.equal(r.outbound.length, TRAIN_LIST_LIMIT)
  assert.equal(r.inbound.length, TRAIN_LIST_LIMIT)
  assert.equal(r.summary.outboundCount, 15)
  assert.equal(r.summary.pairCount, 15)
  assert.ok(r.notes.some((n) => /at most 12 per direction/.test(n)))
  // Slim trains only: no serviceDate / durationMinutes / overnight flag.
  assert.deepEqual(Object.keys(r.outbound[0]).sort(), ['arrive', 'arriveDayOffset', 'depart', 'duration', 'route', 'train'])
})

// ---------------------------------------------------------------------------
// Pass-through from findDirectTrains
// ---------------------------------------------------------------------------

test('an ambiguous station is reported with candidates and no legs are searched', async () => {
  const { r, sql } = await run({ to: 'Portland', ...FRI_SUN })
  assert.equal(r.to.status, 'ambiguous')
  assert.deepEqual(r.to.candidates.map((c) => c.stop_id).sort(), ['PDX', 'POR'])
  assert.deepEqual(r.pairs, [])
  assert.deepEqual(r.inbound, [])
  assert.ok(r.notes.some((n) => /matches more than one station/.test(n)))
  assert.ok(!sql.calls.some((c) => c.text.includes('from stop_times a')))
})

test('an unknown station is reported, not paired', async () => {
  const { r } = await run({ to: 'Atlantis', ...FRI_SUN })
  assert.equal(r.to.status, 'not_found')
  assert.ok(r.notes.some((n) => /No station matches to "Atlantis"/.test(n)))
})

test('a date outside the schedule data sets outsideFeed and gives no pairs', async () => {
  const back = (await run({ outDate: '2026-09-18', returnDate: '2030-01-06' })).r
  assert.equal(back.outsideFeed, true)
  assert.deepEqual(back.pairs, [])
  assert.ok(back.notes.some((n) => /outside the schedule data/.test(n)))
  const out = (await run({ outDate: '2030-01-04', returnDate: '2030-01-06' })).r
  assert.equal(out.outsideFeed, true)
  assert.deepEqual(out.pairs, [])
  // An ordinary request is not flagged.
  assert.equal((await run(FRI_SUN)).r.outsideFeed, false)
})

test('unavailable trains from both legs are passed through, deduplicated', async () => {
  const legs = {
    'NYP>PHL': [...NYP_PHL, leg('50', 'Cardinal', hms(10, 0), hms(12, 0), only('friday'), { can_board: false })],
    'PHL>NYP': PHL_NYP,
  }
  const { r } = await run(FRI_SUN, { legs })
  assert.equal(r.unavailable.length, 1)
  assert.equal(r.unavailable[0].train, '50')
  assert.ok(r.pairs.length > 0)
})

test('shared notes (timezone, holidays) appear once, and the empty-day note survives', async () => {
  const { r } = await run(FRI_SUN)
  assert.equal(r.notes.filter((n) => /Holiday schedules are not modelled/.test(n)).length, 1)
  assert.equal(r.notes.filter((n) => /US Eastern time at every station/.test(n)).length, 1)

  // Thursday: no outbound train runs, so there is nothing to pair.
  const noTrains = (await run({ outDate: '2026-09-17', returnDate: '2026-09-20' })).r
  assert.deepEqual(noTrains.pairs, [])
  assert.ok(noTrains.notes.some((n) => /No direct train runs .* on 2026-09-17/.test(n)))
})

// ---------------------------------------------------------------------------
// Tool wiring (askQuestion with a fake model; no network)
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-23T16:00:00Z') // Friday 2026-10-23, New York

test('plan_weekend through askQuestion: real pairs go back to the model, rowCount = pairs', async () => {
  const input = { from: 'NYP', to: 'PHL', outDate: '2026-09-18', returnDate: '2026-09-20' }
  const anthropic = fakeAnthropic([toolUseFor('plan_weekend', input), textResponse('Train A out, Z back.')])
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>PHL': NYP_PHL, 'PHL>NYP': PHL_NYP } })
  const result = await askQuestion({ anthropic, sql, question: 'weekend?', now: NOW })

  const call = result.toolCalls[0]
  assert.equal(call.name, 'plan_weekend')
  assert.deepEqual(call.input, input)
  assert.equal(call.rowCount, 2)
  assert.equal(call.result.pairs[0].hoursAtDestination, 48.5)
  const sent = anthropic.calls[1].messages.at(-1).content[0].content
  assert.match(sent, /"hoursAtDestination":48\.5/)
})

test('plan_weekend: a model-supplied `today` (and other unknown fields) is ignored; the real clock is used', async () => {
  const input = { from: 'NYP', to: 'PHL', today: '1999-01-01', sql: 'drop table x', evil: true }
  const anthropic = fakeAnthropic([toolUseFor('plan_weekend', input), textResponse('ok')])
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>PHL': NYP_PHL, 'PHL>NYP': PHL_NYP } })
  const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })

  // If 1999 had been used, the dates would be 1999-01-01 and flagged outsideFeed.
  const r = result.toolCalls[0].result
  assert.equal(r.outDate, '2026-10-23')
  assert.equal(r.returnDate, '2026-10-25')
  assert.equal(r.outsideFeed, false)
  assert.equal(result.toolCalls[0].error, undefined)
})

test('plan_weekend: the model cannot raise the pair cap above WEEKEND_PAIR_MAX', async () => {
  const outs = Array.from({ length: 25 }, (_, i) => leg(`O${i}`, 'Northeast Regional', hms(5, i * 10), hms(6, i * 10), only('friday')))
  const backs = [leg('R', 'Northeast Regional', hms(20, 0), hms(21, 0), only('sunday'))]
  const input = { from: 'NYP', to: 'PHL', outDate: '2026-09-18', returnDate: '2026-09-20', limit: 999 }
  const anthropic = fakeAnthropic([toolUseFor('plan_weekend', input), textResponse('ok')])
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>PHL': outs, 'PHL>NYP': backs } })
  const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })
  assert.equal(result.toolCalls[0].result.pairs.length, WEEKEND_PAIR_MAX)
  assert.equal(result.toolCalls[0].rowCount, WEEKEND_PAIR_MAX)
})

test('plan_weekend: a validation error goes back to the model and is recorded', async () => {
  const anthropic = fakeAnthropic([
    toolUseFor('plan_weekend', { from: 'NYP', to: 'PHL', outDate: '2026-09-20', returnDate: '2026-09-18' }),
    textResponse('Sorry.'),
  ])
  const sql = fakeSql({ stops: STOPS, legs: {} })
  const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })
  assert.match(result.toolCalls[0].error, /before the outbound date/)
  assert.match(anthropic.calls[1].messages.at(-1).content[0].content, /before the outbound date/)
})
