import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDirectTrains, resolveStation, todayInNewYork } from '../schedule.js'
import { fakeSql } from './helpers.js'

// ---------------------------------------------------------------------------
// Fixtures. The leg rows have the shape the legs query in schedule.js returns:
// times in seconds after the service day's midnight (so 29:44:00 = 107040),
// one 0/1 flag per weekday, and the calendar window as YYYYMMDD numbers.
// 2026-10-29 is a Thursday (so 2026-10-28 is a Wednesday).
// ---------------------------------------------------------------------------

const hms = (h, m) => h * 3600 + m * 60
const ALL = { sunday: 1, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1 }
const NONE = { sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0 }
const only = (...days) => ({ ...NONE, ...Object.fromEntries(days.map((d) => [d, 1])) })

function leg(train, route, dep, arr, days, extra = {}) {
  return {
    train,
    route,
    dep_secs: dep,
    arr_secs: arr,
    can_board: true,
    can_alight: true,
    ...days,
    start_date: 20260906,
    end_date: 20270906,
    ...extra,
  }
}

const STOPS = [
  { stop_id: 'NYP', stop_name: 'Ny Moynihan Train Hall At Penn Station', stop_timezone: 'America/New_York' },
  { stop_id: 'BOS', stop_name: 'Boston', stop_timezone: 'America/New_York' },
  { stop_id: 'BBY', stop_name: 'Boston', stop_timezone: 'America/New_York' },
  { stop_id: 'BON', stop_name: 'Boston', stop_timezone: 'America/New_York' },
  { stop_id: 'PHL', stop_name: 'Philadelphia', stop_timezone: 'America/New_York' },
  { stop_id: 'PHN', stop_name: 'North Philadelphia Amtrak Station', stop_timezone: 'America/New_York' },
  { stop_id: 'WAS', stop_name: 'Washington Union Station', stop_timezone: 'America/New_York' },
  { stop_id: 'WAH', stop_name: 'Washington Amtrak Station', stop_timezone: 'America/Chicago' },
  { stop_id: 'PDX', stop_name: 'Portland', stop_timezone: 'America/Los_Angeles' },
  { stop_id: 'POR', stop_name: 'Portland', stop_timezone: 'America/New_York' },
  { stop_id: 'CHI', stop_name: 'Chicago Union Station', stop_timezone: 'America/Chicago' },
  { stop_id: 'LAX', stop_name: 'Los Angeles', stop_timezone: 'America/Los_Angeles' },
]

const NYP_BOS = [
  // Train 66: a WEDNESDAY-service trip that passes NYP at 29:44 = 5:44 AM
  // Thursday and reaches Boston at 34:05 = 10:05 AM Thursday.
  leg('66', 'Northeast Regional', hms(29, 44), hms(34, 5), only('wednesday')),
  leg('1150', 'Northeast Regional', hms(6, 53), hms(11, 7), only('thursday', 'friday')),
  leg('2150', 'Acela', hms(7, 57), hms(11, 44), only('thursday', 'friday')),
  leg('1168', 'Northeast Regional', hms(19, 0), hms(23, 36), only('thursday')),
  // Leaves 11:30 PM Thursday, arrives 1:10 AM Friday: a duration across midnight.
  leg('2999', 'Acela', hms(23, 30), hms(25, 10), only('thursday')),
  // Only exists from 2026-11-16 on (a calendar window that starts later).
  leg('2190', 'Acela', hms(5, 27), hms(9, 32), only('thursday'), { start_date: 20261116 }),
  // Runs Saturdays only: must not show on a Thursday.
  leg('150', 'Northeast Regional', hms(7, 0), hms(11, 16), only('saturday')),
]

const THURSDAY = '2026-10-29'

const run = (opts, extra = {}) => {
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': NYP_BOS }, ...extra })
  return findDirectTrains(sql, { today: '2026-10-23', ...opts }).then((r) => ({ r, sql }))
}
const departs = (r) => r.trains.map((t) => `${t.train}@${t.depart}`)

// ---------------------------------------------------------------------------
// The service-day / physical-day rule
// ---------------------------------------------------------------------------

test('train 66 (Wednesday service, 29:44) is the FIRST train on physical Thursday, at 5:44 AM', async () => {
  const { r } = await run({ from: 'NYP', to: 'BOS', date: THURSDAY })

  assert.deepEqual(departs(r), [
    '66@5:44 AM',
    '1150@6:53 AM',
    '2150@7:57 AM',
    '1168@7:00 PM',
    '2999@11:30 PM',
  ])
  const t66 = r.trains[0]
  assert.equal(t66.route, 'Northeast Regional')
  assert.equal(t66.arrive, '10:05 AM') // 34:05 minus the whole day
  assert.equal(t66.arriveDayOffset, 0) // same physical day as it left
  assert.equal(t66.durationMinutes, 261)
  assert.equal(t66.duration, '4h 21m')
  assert.equal(t66.overnight, false)
  assert.equal(t66.serviceDate, '2026-10-28') // the Wednesday it "belongs" to
  assert.ok(r.notes.some((n) => /evening before/.test(n)))
  assert.equal(r.summary.earliest.train, '66')
  assert.equal(r.date, THURSDAY)
  assert.equal(r.weekday, 'thursday')
})

test('train 66 does NOT appear on Wednesday itself, and its Thursday-morning run is not duplicated on Friday', async () => {
  // Wednesday 2026-10-28: its 29:44 stop is Thursday morning, so no 66 here.
  const wed = await run({ from: 'NYP', to: 'BOS', date: '2026-10-28' })
  assert.ok(!departs(wed.r).some((d) => d.startsWith('66@')))
  // Friday 2026-10-30: 66 would need Thursday service, and it only has Wednesday.
  const fri = await run({ from: 'NYP', to: 'BOS', date: '2026-10-30' })
  assert.ok(!departs(fri.r).some((d) => d.startsWith('66@')))
  // Thursday trains (service flag thursday) show on Friday only via their own
  // Friday flag: 1150 and 2150 have it, 1168 does not.
  assert.deepEqual(departs(fri.r), ['1150@6:53 AM', '2150@7:57 AM'])
})

test('a train needs service on its SERVICE day: Saturday-only 150 is Saturday, not Thursday', async () => {
  const sat = await run({ from: 'NYP', to: 'BOS', date: '2026-10-31' })
  // Saturday: 150 at 7:00 AM; and 66's Friday-service... 66 has Wednesday only,
  // and 29:44 on Saturday means Friday service, so it is absent.
  assert.deepEqual(departs(sat.r), ['150@7:00 AM'])
})

test('the feed\'s first day: a 24h+ train can\'t come from a service day before the feed starts', async () => {
  // 66 runs on Wednesday service. For physical Thursday 2026-09-10 the service
  // day is Wednesday 2026-09-09, inside the feed, so it shows...
  const inside = await run({ from: 'NYP', to: 'BOS', date: '2026-09-10' })
  assert.ok(departs(inside.r).includes('66@5:44 AM'))
  // ...but the feed starts Sunday 2026-09-06, and a leg with service on Sunday
  // only, seen on physical Monday 2026-09-07, needs service day 09-06: fine;
  // on physical Sunday 2026-09-06 it would need 09-05: before the window.
  const early = [leg('77', 'Test', hms(25, 0), hms(29, 0), only('saturday', 'sunday'))]
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': early } })
  const first = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: '2026-09-06', today: '2026-09-01' })
  assert.deepEqual(first.trains, [])
  const second = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: '2026-09-07', today: '2026-09-01' })
  assert.equal(second.trains.length, 1)
})

test('weekday only: means the next such day, with the same physical-day rule', async () => {
  // Today (2026-10-23) is a Friday, so "thursday" is 2026-10-29.
  const { r } = await run({ from: 'NYP', to: 'BOS', weekday: 'Thursday' })
  assert.equal(r.date, THURSDAY)
  assert.equal(r.dateSource, 'next-weekday')
  assert.equal(r.trains[0].train, '66')
  assert.ok(r.notes.some((n) => /next thursday \(2026-10-29\)/i.test(n)))

  // If today IS that weekday, it means today, not next week.
  const same = await run({ from: 'NYP', to: 'BOS', weekday: 'thursday', today: THURSDAY })
  assert.equal(same.r.date, THURSDAY)
})

test('no date and no weekday means today', async () => {
  const { r } = await run({ from: 'NYP', to: 'BOS', today: THURSDAY })
  assert.equal(r.date, THURSDAY)
  assert.equal(r.dateSource, 'today')
})

test('a window that starts later is respected (Acela 2190 only from 2026-11-16)', async () => {
  const before = await run({ from: 'NYP', to: 'BOS', date: THURSDAY })
  assert.ok(!before.r.trains.some((t) => t.train === '2190'))
  const after = await run({ from: 'NYP', to: 'BOS', date: '2026-11-19' })
  assert.equal(after.r.trains[0].train, '2190') // 5:27 AM now beats 66 at 5:44
  assert.equal(after.r.trains[1].train, '66')
})

// ---------------------------------------------------------------------------
// Durations, day offsets, summary
// ---------------------------------------------------------------------------

test('duration across midnight: 11:30 PM to 1:10 AM is 100 minutes, arriving +1 day', async () => {
  const { r } = await run({ from: 'NYP', to: 'BOS', date: THURSDAY })
  const t = r.trains.find((x) => x.train === '2999')
  assert.equal(t.depart, '11:30 PM')
  assert.equal(t.arrive, '1:10 AM')
  assert.equal(t.arriveDayOffset, 1)
  assert.equal(t.durationMinutes, 100)
  assert.equal(t.duration, '1h 40m')
  assert.equal(t.overnight, true)
})

test('a multi-day journey: Chicago 14:30 to Los Angeles 58:27 is 43h 57m, arriving +2 days', async () => {
  const legs = { 'CHI>LAX': [leg('3', 'Southwest Chief', hms(14, 30), hms(58, 27), ALL)] }
  const sql = fakeSql({ stops: STOPS, legs })
  const r = await findDirectTrains(sql, { from: 'Chicago', to: 'Los Angeles', date: THURSDAY, today: '2026-10-23' })
  const t = r.trains[0]
  assert.equal(t.depart, '2:30 PM')
  assert.equal(t.arrive, '10:27 AM')
  assert.equal(t.arriveDayOffset, 2)
  assert.equal(t.durationMinutes, 2637)
  assert.equal(t.duration, '43h 57m')
  // Both stations are outside Eastern time: the result says times are Eastern.
  assert.ok(r.notes.some((n) => /US Eastern/.test(n)))
  assert.ok(r.notes.some((n) => /America\/Chicago/.test(n) && /America\/Los_Angeles/.test(n)))
})

test('a boarding time past 48h still maps back to the right service day', async () => {
  // Boards at 60:00 = 12:00 noon two days after the service day starts.
  const legs = { 'NYP>BOS': [leg('99', 'Long Haul', hms(60, 0), hms(63, 0), only('tuesday'))] }
  const sql = fakeSql({ stops: STOPS, legs })
  // Service Tuesday 2026-10-27 + 2 days = Thursday 2026-10-29.
  const hit = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: THURSDAY, today: '2026-10-23' })
  assert.deepEqual(departs(hit), ['99@12:00 PM'])
  const miss = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: '2026-10-28', today: '2026-10-23' })
  assert.deepEqual(miss.trains, [])
})

test('summary covers ALL trains even when limit cuts the list; earliest/latest/fastest are right', async () => {
  const { r } = await run({ from: 'NYP', to: 'BOS', date: THURSDAY, limit: 2 })
  assert.equal(r.trains.length, 2)
  assert.deepEqual(departs(r), ['66@5:44 AM', '1150@6:53 AM'])
  assert.equal(r.summary.count, 5)
  assert.equal(r.summary.latest.train, '2999')
  assert.equal(r.summary.fastest.train, '2999') // 100 minutes, the shortest fixture
  assert.ok(r.notes.some((n) => /first 2 of 5/.test(n)))
})

test('filters: departAfter / departBefore are inclusive, route matches by substring', async () => {
  const evening = await run({ from: 'NYP', to: 'BOS', date: THURSDAY, departAfter: '19:00' })
  assert.deepEqual(departs(evening.r), ['1168@7:00 PM', '2999@11:30 PM'])
  const morning = await run({ from: 'NYP', to: 'BOS', date: THURSDAY, departBefore: '06:53' })
  assert.deepEqual(departs(morning.r), ['66@5:44 AM', '1150@6:53 AM'])
  const acela = await run({ from: 'NYP', to: 'BOS', date: THURSDAY, route: 'acela' })
  assert.deepEqual(departs(acela.r), ['2150@7:57 AM', '2999@11:30 PM'])
})

test('a train listed twice by overlapping calendar windows appears once', async () => {
  const dup = [
    leg('1150', 'Northeast Regional', hms(6, 53), hms(11, 7), only('thursday')),
    leg('1150', 'Northeast Regional', hms(6, 53), hms(11, 7), only('thursday'), { start_date: 20261001 }),
  ]
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': dup } })
  const r = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: THURSDAY, today: '2026-10-23' })
  assert.equal(r.trains.length, 1)
})

test('numbers that arrive as strings (how Neon returns bigint) work too', async () => {
  const stringy = NYP_BOS.map((l) => ({
    ...l,
    dep_secs: String(l.dep_secs),
    arr_secs: String(l.arr_secs),
    start_date: String(l.start_date),
    end_date: String(l.end_date),
    thursday: String(l.thursday),
    wednesday: String(l.wednesday),
  }))
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': stringy }, window: { first_day: '20260906', last_day: '20270906' } })
  const r = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: THURSDAY, today: '2026-10-23' })
  assert.equal(r.trains[0].train, '66')
  assert.deepEqual(r.calendarWindow, { start: '2026-09-06', end: '2027-09-06' })
})

// ---------------------------------------------------------------------------
// Pickup / drop-off restrictions
// ---------------------------------------------------------------------------

test('a train that stops but does not allow boarding is "unavailable", never listed with times', async () => {
  const legs = {
    'WAS>NYP': [
      // Cardinal 50 at Washington: stored 43:09, pickup_type = 1 (no boarding).
      leg('50', 'Cardinal', hms(43, 9), hms(46, 23), only('tuesday', 'thursday', 'saturday'), { can_board: false }),
      leg('2160', 'Acela', hms(8, 0), hms(10, 50), ALL),
    ],
  }
  const sql = fakeSql({ stops: STOPS, legs })
  // Friday 2026-10-30: the Cardinal's service day is Thursday, so it WOULD run.
  const fri = await findDirectTrains(sql, { from: 'WAS', to: 'NYP', date: '2026-10-30', today: '2026-10-23' })
  assert.deepEqual(departs(fri), ['2160@8:00 AM'])
  assert.deepEqual(fri.unavailable, [
    { train: '50', route: 'Cardinal', reason: 'stops at Washington Union Station but does not allow boarding there' },
  ])
  assert.ok(!JSON.stringify(fri.trains).includes('7:09'))

  // Asking only about the Cardinal still explains why there is nothing to take,
  // even on a day it doesn't run at all.
  const mon = await findDirectTrains(sql, { from: 'WAS', to: 'NYP', route: 'Cardinal', date: '2026-10-26', today: '2026-10-23' })
  assert.deepEqual(mon.trains, [])
  assert.equal(mon.unavailable[0].train, '50')
})

test('no drop-off at the destination is also unavailable', async () => {
  const legs = { 'NYP>BOS': [leg('55', 'Test', hms(9, 0), hms(13, 0), ALL, { can_alight: false })] }
  const sql = fakeSql({ stops: STOPS, legs })
  const r = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: THURSDAY, today: '2026-10-23' })
  assert.deepEqual(r.trains, [])
  assert.match(r.unavailable[0].reason, /does not allow getting off/)
})

// ---------------------------------------------------------------------------
// Range, ambiguity, aliases, validation
// ---------------------------------------------------------------------------

test('a date outside the feed says so explicitly and never reports "no trains"', async () => {
  const { r, sql } = await run({ from: 'NYP', to: 'BOS', date: '2030-01-05' })
  assert.equal(r.outsideFeed, true)
  assert.deepEqual(r.trains, [])
  assert.deepEqual(r.calendarWindow, { start: '2026-09-06', end: '2027-09-06' })
  assert.ok(r.notes.some((n) => /outside the schedule data/.test(n) && /2027-09-06/.test(n)))
  assert.ok(!r.notes.some((n) => /No direct train runs/.test(n)))
  // We didn't even ask the database for trains.
  assert.ok(!sql.calls.some((c) => c.text.includes('from stop_times a')))
  // Before the feed starts is also outside.
  const early = await run({ from: 'NYP', to: 'BOS', date: '2026-08-01' })
  assert.equal(early.r.outsideFeed, true)
})

test('an ambiguous name returns candidates instead of guessing', async () => {
  const { r, sql } = await run({ from: 'NYP', to: 'Washington', date: THURSDAY })
  assert.equal(r.to.status, 'ambiguous')
  assert.deepEqual(
    r.to.candidates.map((c) => c.stop_id),
    ['WAH', 'WAS'],
  )
  // The candidates carry the timezone, which is what tells DC from Missouri.
  assert.equal(r.to.candidates[0].timezone, 'America/Chicago')
  assert.equal(r.from.status, 'matched')
  assert.deepEqual(r.trains, [])
  assert.ok(r.notes.some((n) => /more than one station/.test(n)))
  assert.ok(!sql.calls.some((c) => c.text.includes('from stop_times a')))

  const portland = await resolveStation(fakeSql({ stops: STOPS }), 'Portland')
  assert.equal(portland.status, 'ambiguous')
  assert.deepEqual(portland.candidates.map((c) => c.stop_id).sort(), ['PDX', 'POR'])
})

test('an unknown station is not_found', async () => {
  const { r } = await run({ from: 'NYP', to: 'Hogwarts', date: THURSDAY })
  assert.equal(r.to.status, 'not_found')
  assert.deepEqual(r.trains, [])
  assert.ok(r.notes.some((n) => /No station matches to "Hogwarts"/.test(n)))
})

test('station matching: ids, aliases, exact names beat substrings', async () => {
  const sql = fakeSql({ stops: STOPS })
  const id = async (text) => (await resolveStation(sql, text)).stop_id

  assert.equal(await id('NYP'), 'NYP')
  assert.equal(await id('bos'), 'BOS') // ids are case-insensitive
  assert.equal(await id('New York'), 'NYP') // alias: the feed calls NYP "Ny Moynihan ..."
  assert.equal(await id('NYC'), 'NYP')
  assert.equal(await id('  new york city '), 'NYP')
  assert.equal(await id('Washington, DC'), 'WAS')
  assert.equal(await id('Moynihan'), 'NYP') // a unique substring works
  assert.equal(await id('chicago'), 'CHI')
  // "Philadelphia" is the exact name of PHL even though PHN contains the word.
  assert.equal(await id('Philadelphia'), 'PHL')
  assert.equal((await resolveStation(sql, 'north philadelphia')).stop_id, 'PHN')

  // "Boston" is three stations with the same name: the alias picks BOS and says so.
  const boston = await resolveStation(sql, 'Boston')
  assert.equal(boston.stop_id, 'BOS')
  assert.match(boston.note, /BBY/)
  assert.equal((await resolveStation(sql, 'BBY')).stop_id, 'BBY')
})

test('station lookup is capped by a SQL limit and puts exact matches first', async () => {
  const sql = fakeSql({ stops: STOPS })
  await resolveStation(sql, 'a')
  assert.match(sql.calls[0].text, /limit 25/)
  assert.match(sql.calls[0].text, /order by\s+\(upper\(stop_id\) = upper\(\?\)\) desc/)
  // 40 stations containing "x": the fake applies the same limit.
  const many = Array.from({ length: 40 }, (_, i) => ({ stop_id: `X${String(i).padStart(2, '0')}`, stop_name: `Xville ${i}`, stop_timezone: 'America/New_York' }))
  const r = await resolveStation(fakeSql({ stops: many }), 'x')
  assert.equal(r.status, 'ambiguous')
  assert.equal(r.candidates.length, 10)
})

test('odd station text is handled: empty, inherited property names', async () => {
  const sql = fakeSql({ stops: STOPS })
  assert.equal((await resolveStation(sql, '   ')).status, 'not_found')
  assert.equal(sql.calls.length, 0) // empty text never reaches the database
  assert.equal((await resolveStation(sql, 'constructor')).status, 'not_found')
})

test('wildcard characters in a station name are taken literally', async () => {
  const sql = fakeSql({ stops: STOPS })
  await resolveStation(sql, '%')
  const lookup = sql.calls.at(-1)
  assert.equal(lookup.values[1], '%%') // the % the person typed was removed
})

test('bad input throws a plain message (the ask tool hands it to the model)', async () => {
  const sql = fakeSql({ stops: STOPS })
  const bad = (opts, pattern) =>
    assert.rejects(() => findDirectTrains(sql, { from: 'NYP', to: 'BOS', today: THURSDAY, ...opts }), pattern)

  await bad({ date: '2026-02-31' }, /real calendar date/)
  await bad({ date: 'next thursday' }, /YYYY-MM-DD/)
  await bad({ date: THURSDAY, weekday: 'thursday' }, /either "date" or "weekday"/)
  await bad({ weekday: 'someday' }, /weekday/)
  await bad({ departAfter: '6pm' }, /departAfter/)
  await bad({ departBefore: '25:00' }, /departBefore/)
  await bad({ limit: 0 }, /limit/)
  await bad({ limit: 101 }, /limit/)
  await bad({ from: '' }, /"from"/)
  await bad({ to: 42 }, /"to"/)
  await bad({ route: 5 }, /route/)
  assert.equal(sql.calls.length, 0) // nothing hit the database
})

test('same station on both ends returns no trains and says why', async () => {
  const { r } = await run({ from: 'NYP', to: 'new york', date: THURSDAY })
  assert.deepEqual(r.trains, [])
  assert.ok(r.notes.some((n) => /same station/.test(n)))
})

test('an empty result says so, and still carries the date and calendar window', async () => {
  const sql = fakeSql({ stops: STOPS, legs: {} })
  const r = await findDirectTrains(sql, { from: 'NYP', to: 'PHL', date: THURSDAY, today: '2026-10-23' })
  assert.deepEqual(r.trains, [])
  assert.equal(r.summary.count, 0)
  assert.equal(r.summary.earliest, null)
  assert.ok(r.notes.some((n) => /No direct train runs/.test(n)))
})

test('results with trains carry the timezone and holiday notes, as plain data', async () => {
  const { r } = await run({ from: 'NYP', to: 'BOS', date: THURSDAY })
  assert.ok(r.notes.some((n) => /US Eastern time at every station/.test(n)))
  assert.ok(r.notes.some((n) => /Holiday schedules are not modelled/.test(n)))
  // Plain JSON: it survives a round trip unchanged (no functions, no Dates).
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r)
})

test('todayInNewYork uses New York time, not UTC', () => {
  // 02:00 UTC on the 24th is still the evening of the 23rd in New York.
  assert.equal(todayInNewYork(new Date('2026-10-24T02:00:00Z')), '2026-10-23')
  assert.equal(todayInNewYork(new Date('2026-10-24T05:00:00Z')), '2026-10-24')
})

// ---------------------------------------------------------------------------
// Boundary tests: exactly 24:00:00, and inclusive calendar dates. The feed has
// 12 legs departing and 13 arriving at exactly 24:00:00.
// ---------------------------------------------------------------------------

const runLegs = async (legs, opts) => {
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': legs } })
  return findDirectTrains(sql, { from: 'NYP', to: 'BOS', today: '2026-10-23', ...opts })
}

test('a leg departing at exactly 24:00:00 is 12:00 AM on the NEXT day (service day + 1)', async () => {
  // Wednesday service, boards at 24:00:00 = midnight starting Thursday.
  const legs = [leg('88', 'Test', hms(24, 0), hms(27, 30), only('wednesday'))]
  const thu = await runLegs(legs, { date: THURSDAY })
  assert.equal(thu.trains.length, 1)
  assert.equal(thu.trains[0].depart, '12:00 AM')
  assert.equal(thu.trains[0].serviceDate, '2026-10-28') // the Wednesday
  assert.equal(thu.trains[0].arrive, '3:30 AM')
  assert.equal(thu.trains[0].arriveDayOffset, 0)
  assert.equal(thu.trains[0].durationMinutes, 210)
  // NOT on Wednesday itself: 24:00:00 is already Thursday.
  const wed = await runLegs(legs, { date: '2026-10-28' })
  assert.deepEqual(wed.trains, [])
})

test('exactly 24:00:00 vs one second earlier: 23:59:59 stays on the service day', async () => {
  const legs = [leg('89', 'Test', hms(23, 59) + 59, hms(26, 0), only('wednesday'))]
  const wed = await runLegs(legs, { date: '2026-10-28' })
  assert.equal(wed.trains.length, 1)
  assert.equal(wed.trains[0].depart, '11:59 PM')
  const thu = await runLegs(legs, { date: THURSDAY })
  assert.deepEqual(thu.trains, [])
})

test('a leg arriving at exactly 24:00:00 arrives 12:00 AM with arriveDayOffset 1', async () => {
  const legs = [leg('90', 'Test', hms(22, 0), hms(24, 0), only('thursday'))]
  const r = await runLegs(legs, { date: THURSDAY })
  const t = r.trains[0]
  assert.equal(t.depart, '10:00 PM')
  assert.equal(t.arrive, '12:00 AM')
  assert.equal(t.arriveDayOffset, 1)
  assert.equal(t.overnight, true)
  assert.equal(t.durationMinutes, 120)
  // One minute earlier is still the same day.
  const same = await runLegs([leg('91', 'Test', hms(22, 0), hms(23, 59), only('thursday'))], { date: THURSDAY })
  assert.equal(same.trains[0].arriveDayOffset, 0)
  assert.equal(same.trains[0].overnight, false)
})

test('arrival offset is measured from the PHYSICAL departure day (47:00 -> 48:00 is +1)', async () => {
  // Boards 47:00 (service day + 1), arrives 48:00 = exactly one more day boundary.
  const legs = [leg('92', 'Test', hms(47, 0), hms(48, 0), only('wednesday'))]
  const r = await runLegs(legs, { date: THURSDAY })
  const t = r.trains[0]
  assert.equal(t.depart, '11:00 PM')
  assert.equal(t.arrive, '12:00 AM')
  assert.equal(t.arriveDayOffset, 1)
  // Boards at 48:00:00 exactly: service day + 2, midnight.
  const two = await runLegs([leg('93', 'Test', hms(48, 0), hms(50, 0), only('tuesday'))], { date: THURSDAY })
  assert.equal(two.trains[0].depart, '12:00 AM')
  assert.equal(two.trains[0].serviceDate, '2026-10-27')
})

test('calendar start_date and end_date are inclusive', async () => {
  const endsToday = [leg('94', 'Test', hms(9, 0), hms(13, 0), only('thursday'), { start_date: 20260906, end_date: 20261029 })]
  assert.equal((await runLegs(endsToday, { date: THURSDAY })).trains.length, 1) // end_date == requested date
  const endedYesterday = [leg('94', 'Test', hms(9, 0), hms(13, 0), only('thursday'), { end_date: 20261028 })]
  assert.equal((await runLegs(endedYesterday, { date: THURSDAY })).trains.length, 0)
  const startsToday = [leg('95', 'Test', hms(9, 0), hms(13, 0), only('thursday'), { start_date: 20261029 })]
  assert.equal((await runLegs(startsToday, { date: THURSDAY })).trains.length, 1)
  const startsTomorrow = [leg('95', 'Test', hms(9, 0), hms(13, 0), only('thursday'), { start_date: 20261030 })]
  assert.equal((await runLegs(startsTomorrow, { date: THURSDAY })).trains.length, 0)
  // The inclusive end applies to the SERVICE date for after-midnight trains too:
  // 66-style leg, service Wednesday 10-28 = end_date.
  const overnightEnd = [leg('96', 'Test', hms(29, 0), hms(31, 0), only('wednesday'), { end_date: 20261028 })]
  assert.equal((await runLegs(overnightEnd, { date: THURSDAY })).trains.length, 1)
})

test('first day of the feed: the note says prior-day trains are not in the data', async () => {
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': [] } })
  const r = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: '2026-09-06', today: '2026-09-01' })
  assert.deepEqual(r.trains, [])
  assert.ok(r.notes.some((n) => /first day in the schedule data/.test(n) && /previous day/.test(n)))
  assert.ok(!r.notes.some((n) => /No direct train runs/.test(n)))
  // Any other day keeps the plain message.
  const other = await findDirectTrains(sql, { from: 'NYP', to: 'BOS', date: '2026-09-07', today: '2026-09-01' })
  assert.ok(other.notes.some((n) => /No direct train runs/.test(n)))
})
