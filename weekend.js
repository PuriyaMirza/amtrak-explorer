// "Leave Friday after work, come back Sunday": pairs an outbound direct train
// with a return direct train and says how many hours you get at the destination.
//
// Like schedule.js, this takes the Neon `sql` client as its first argument and
// returns plain data, with no prompt text and no AI-specific shapes. Today the
// ask box's `plan_weekend` tool calls it; the planned browse "weekend finder"
// can call the very same function from a normal /api/ endpoint.
//
// It contains NO SQL of its own. Both legs come from findDirectTrains (the
// single source of truth for "which direct trains run, and when"), so the
// service-day vs physical-day handling in schedule.js applies here for free.
//
// ---------------------------------------------------------------------------
// HOW A PAIR IS BUILT
// ---------------------------------------------------------------------------
//   hours at destination = (return train's departure) - (outbound train's arrival)
//
// Both are physical clock times. The outbound ARRIVAL is not always on the
// outbound date: a train that leaves at 11:23 PM Friday and arrives at 12:51 AM
// has arriveDayOffset = 1, so you only get there on Saturday, and the time you
// have at the destination shrinks by those hours. A pair is dropped if the hours
// come out below `minHoursAtDestination` (default 0, which still means the
// stay must be longer than zero: you can't catch a train that leaves before (or
// the minute) you've arrived).
//
// WHY THE RESULT IS CAPPED
// Every outbound could pair with every return (10 x 25 = 250 pairs), and the
// model sees (and we pay for) every row. So each outbound train is paired only
// with its LATEST return that still works: that is the pair that gives the most
// time at the destination, which is what "leave Friday, back Sunday" is about.
// Then at most `limit` of those pairs are kept (the ones with the most hours).
// "I want an earlier Sunday train" is answered by passing returnDepartAfter
// or a smaller window, not by listing everything.
// ---------------------------------------------------------------------------
import {
  findDirectTrains,
  todayInNewYork,
  parseIsoDate,
  parseClock,
  addDays,
  toIso,
  clockLabelToMinutes,
  FEED_TIMEZONE,
  WEEKDAYS,
} from './schedule.js'

export const DEFAULT_PAIR_LIMIT = 10
// Most trains listed per direction. The pairs are built from ALL trains; this
// only cuts what is shown, and summary.outboundCount / inboundCount say how many.
export const TRAIN_LIST_LIMIT = 12

const MINUTES_PER_DAY = 1440
const MS_PER_DAY = 86400 * 1000

// Eastern's offset from UTC in minutes at a wall-clock moment: `minuteOfDay`
// minutes after midnight on `isoDate` (-240 in summer, -300 in winter). Used so
// "hours at the destination" stays right when the clocks change between the two
// moments (e.g. Fri 2026-10-30 -> Sun 2026-11-01 is the weekend the clocks go
// back, so the real elapsed time is one hour more than the clock difference).
//
// It must be asked about the actual MOMENT, not just the date: the change
// happens at 2 AM, so 12:30 AM on 2026-11-01 is still summer time and 8 AM
// that day is winter time. We build the UTC instant by assuming winter time
// (UTC = wall + 5h) and ask Intl what Eastern's offset is at that instant. For
// the ambiguous 1:00-1:59 AM hour that comes out as winter time.
//
// Remembered per moment: pairing calls it for every outbound x return
// combination, and building the formatter each time would be needlessly slow.
const offsetCache = new Map()
function easternOffsetMinutes(isoDate, minuteOfDay) {
  const key = `${isoDate}|${minuteOfDay}`
  if (offsetCache.has(key)) return offsetCache.get(key)
  const minutes = computeEasternOffsetMinutes(isoDate, minuteOfDay)
  offsetCache.set(key, minutes)
  return minutes
}

function computeEasternOffsetMinutes(isoDate, minuteOfDay) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: FEED_TIMEZONE, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(Date.parse(`${isoDate}T00:00:00Z`) + (minuteOfDay + 300) * 60000))
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(name)
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0)
  return m[1] === '-' ? -minutes : minutes
}

function normalizeOptions({
  from, to, outDate, returnDate, outDay, returnDay,
  departAfter, returnDepartAfter, minHoursAtDestination, limit, today,
}) {
  const fail = (msg) => {
    throw new Error(msg)
  }
  const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100
  if (!isText(from)) fail('"from" must be a station id or name (1-100 characters)')
  if (!isText(to)) fail('"to" must be a station id or name (1-100 characters)')

  for (const [name, value] of [['outDate', outDate], ['returnDate', returnDate]]) {
    if (value != null && (typeof value !== 'string' || !parseIsoDate(value))) {
      fail(`"${name}" must be a real calendar date written YYYY-MM-DD`)
    }
  }
  const outDayName = String(outDay ?? 'friday').toLowerCase()
  const returnDayName = String(returnDay ?? 'sunday').toLowerCase()
  for (const [name, value] of [['outDay', outDayName], ['returnDay', returnDayName]]) {
    if (!WEEKDAYS.includes(value)) {
      fail(`"${name}" must be one of monday, tuesday, wednesday, thursday, friday, saturday, sunday`)
    }
  }
  for (const [name, value] of [['departAfter', departAfter], ['returnDepartAfter', returnDepartAfter]]) {
    if (value != null && parseClock(String(value)) === null) fail(`"${name}" must be a 24-hour time like "18:00"`)
  }

  const minHours = minHoursAtDestination == null ? 0 : Number(minHoursAtDestination)
  if (!Number.isFinite(minHours) || minHours < 0 || minHours > 240) {
    fail('"minHoursAtDestination" must be a number from 0 to 240')
  }
  const max = limit == null ? DEFAULT_PAIR_LIMIT : Number(limit)
  if (!Number.isInteger(max) || max < 1 || max > 100) fail('"limit" must be a whole number from 1 to 100')

  const todayIso = today ?? todayInNewYork()
  if (!parseIsoDate(todayIso)) fail('"today" must be YYYY-MM-DD')

  return { from: from.trim(), to: to.trim(), outDate, returnDate, outDayName, returnDayName, departAfter, returnDepartAfter, minHours, max, todayIso }
}

// The first date on or after `start` (a UTC-midnight Date) that is `weekdayName`.
// "On or after" means today counts when today is that weekday.
function onOrAfter(start, weekdayName) {
  const ahead = (WEEKDAYS.indexOf(weekdayName) - start.getUTCDay() + 7) % 7
  return addDays(start, ahead)
}

// The few fields of a train that the pair output needs. (schedule.js trains
// also carry serviceDate, durationMinutes, ... which would only cost tokens.)
const slim = (t) => ({
  train: t.train,
  route: t.route,
  depart: t.depart,
  arrive: t.arrive,
  arriveDayOffset: t.arriveDayOffset,
  duration: t.duration,
})

// planWeekend(sql, { from, to, outDate?, returnDate?, outDay = 'friday', returnDay = 'sunday',
//                    departAfter?, returnDepartAfter?, minHoursAtDestination = 0, limit = 10, today? })
//
//   from / to           station ids or names (see resolveStation); the return trip is to -> from
//   outDate             'YYYY-MM-DD' the traveler leaves; if absent, the next `outDay` (today counts)
//   returnDate          'YYYY-MM-DD' of the return; if absent, the first `returnDay` on or after the outbound date
//   departAfter         'HH:MM', earliest outbound departure (e.g. after work)
//   returnDepartAfter   'HH:MM', earliest return departure
//   minHoursAtDestination  drop pairs that leave less time than this at the destination
//   limit               max pairs returned (default 10)
//
// Returns plain data:
//   { from, to, outDate, returnDate, outbound, inbound, pairs, summary,
//     unavailable, outsideFeed, notes }
// where outbound/inbound are slim trains (first TRAIN_LIST_LIMIT by departure) and
//   pairs   = [{ out, back, hoursAtDestination }] sorted by outbound departure
//   summary = { outboundCount, inboundCount, earliestReturn, latestReturn, pairCount, latestReturnForEarliestOut, maxHoursAtDestination }
// `from`/`to` are the resolved stations (status 'ambiguous' lists candidates).
export async function planWeekend(sql, options) {
  const o = normalizeOptions(options)
  const todayDate = parseIsoDate(o.todayIso)

  // Which dates? Spelled-out dates win; a bare weekday means the next such day.
  const notes = []
  const outD = o.outDate ? parseIsoDate(o.outDate) : onOrAfter(todayDate, o.outDayName)
  if (!o.outDate) {
    notes.push(`No outbound date was given, so this is the next ${o.outDayName} (${toIso(outD)}).`)
  }
  const retD = o.returnDate ? parseIsoDate(o.returnDate) : onOrAfter(outD, o.returnDayName)
  if (!o.returnDate) {
    notes.push(`No return date was given, so this is the first ${o.returnDayName} on or after the outbound date (${toIso(retD)}).`)
  }
  if (retD < outD) {
    throw new Error(`the return date (${toIso(retD)}) is before the outbound date (${toIso(outD)}); give outDate and returnDate explicitly`)
  }
  const outDate = toIso(outD)
  const returnDate = toIso(retD)

  // Outbound first. Its station lookup is reused for the return, so the user's
  // text ("Boston") is resolved once, and any ambiguity is reported once.
  // limit 100 = everything (the pairs must be built from ALL trains).
  const out = await findDirectTrains(sql, {
    from: o.from, to: o.to, date: outDate, departAfter: o.departAfter, limit: 100, today: o.todayIso,
  })
  const result = {
    from: out.from,
    to: out.to,
    outDate,
    returnDate,
    outbound: [],
    inbound: [],
    pairs: [],
    summary: {
      outboundCount: 0, inboundCount: 0, earliestReturn: null, latestReturn: null, pairCount: 0, latestReturnForEarliestOut: null, maxHoursAtDestination: null,
    },
    unavailable: [],
    outsideFeed: out.outsideFeed,
    notes,
  }

  const stationsOk = out.from.status === 'matched' && out.to.status === 'matched' && out.from.stop_id !== out.to.stop_id
  if (!stationsOk) {
    notes.push(...out.notes)
    return result
  }

  // Return leg: the same two stations, swapped, by id.
  const back = await findDirectTrains(sql, {
    from: out.to.stop_id, to: out.from.stop_id, date: returnDate, departAfter: o.returnDepartAfter, limit: 100, today: o.todayIso,
  })
  result.outsideFeed = out.outsideFeed || back.outsideFeed

  // Notes from both legs (the timezone/holiday notes would otherwise appear twice).
  for (const n of [...out.notes, ...back.notes]) if (!notes.includes(n)) notes.push(n)
  const unavailableSeen = new Set()
  for (const u of [...out.unavailable, ...back.unavailable]) {
    const key = `${u.train}|${u.reason}`
    if (!unavailableSeen.has(key)) {
      unavailableSeen.add(key)
      result.unavailable.push(u)
    }
  }

  result.outbound = out.trains.slice(0, TRAIN_LIST_LIMIT).map(slim)
  result.inbound = back.trains.slice(0, TRAIN_LIST_LIMIT).map(slim)
  result.summary.outboundCount = out.trains.length
  result.summary.inboundCount = back.trains.length
  // From the FULL return list (before any cap), so "earliest train back Sunday"
  // and "last train back" are explicit and don't depend on pairs or the list cut.
  result.summary.earliestReturn = back.trains.length > 0 ? slim(back.trains[0]) : null
  result.summary.latestReturn = back.trains.length > 0 ? slim(back.trains.at(-1)) : null
  if (out.trains.length > TRAIN_LIST_LIMIT || back.trains.length > TRAIN_LIST_LIMIT) {
    notes.push(
      `Trains are listed for at most ${TRAIN_LIST_LIMIT} per direction (by departure time); ` +
        'pairs use all of them. Use departAfter / returnDepartAfter to see later ones.',
    )
  }

  // ---- pairing ----
  // Real elapsed minutes between an outbound arrival and a return departure.
  const dayGap = Math.round((retD.getTime() - outD.getTime()) / MS_PER_DAY)
  let clockChange = false
  const stayMinutes = (outTrain, backTrain) => {
    const arrive = outTrain.arriveDayOffset * MINUTES_PER_DAY + clockLabelToMinutes(outTrain.arrive)
    const depart = clockLabelToMinutes(backTrain.depart)
    // Offsets at the real arrival moment and the real departure moment.
    const arriveOffset = easternOffsetMinutes(toIso(addDays(outD, outTrain.arriveDayOffset)), clockLabelToMinutes(outTrain.arrive))
    const returnOffset = easternOffsetMinutes(returnDate, depart)
    if (arriveOffset !== returnOffset) clockChange = true
    return dayGap * MINUTES_PER_DAY + depart - arrive + arriveOffset - returnOffset
  }

  const minMinutes = o.minHours * 60
  const candidates = []
  for (const outTrain of out.trains) {
    let best = null
    for (const backTrain of back.trains) {
      const minutes = stayMinutes(outTrain, backTrain)
      // A zero-minute stay isn't a trip, so the stay must be positive even when minHours is 0.
      if (minutes <= 0 || minutes < minMinutes) continue
      // Latest-departing return = most minutes. Ties keep the first train listed.
      if (best === null || minutes > best.minutes) best = { backTrain, minutes }
    }
    if (best) candidates.push({ outTrain, ...best })
  }
  if (clockChange) {
    notes.push(
      'The clocks change between the outbound arrival and the return, so hours at the destination are ' +
        'real elapsed time (one hour different from the difference on the clock).',
    )
  }

  const toPair = (c) => ({ out: slim(c.outTrain), back: slim(c.backTrain), hoursAtDestination: Math.round(c.minutes / 6) / 10 })
  result.summary.pairCount = candidates.length
  if (candidates.length > 0) {
    // candidates are in outbound-departure order, so [0] is the earliest outbound with a working return.
    result.summary.latestReturnForEarliestOut = toPair(candidates[0])
    result.summary.maxHoursAtDestination = Math.round(Math.max(...candidates.map((c) => c.minutes)) / 6) / 10

    // Keep the `limit` pairs with the most time at the destination, shown in departure order.
    const kept = [...candidates].sort((a, b) => b.minutes - a.minutes).slice(0, o.max)
    const keptSet = new Set(kept)
    result.pairs = candidates.filter((c) => keptSet.has(c)).map(toPair)
    notes.push(
      'Each outbound train is paired only with its latest return (the most time at the destination); ' +
        'use returnDepartAfter for an earlier return.',
    )
    if (candidates.length > result.pairs.length) {
      notes.push(`Showing the ${result.pairs.length} of ${candidates.length} outbound trains with the most time at the destination.`)
    }
  } else if (out.trains.length > 0 && back.trains.length > 0) {
    notes.push(
      o.minHours > 0
        ? `No outbound and return train combination leaves at least ${o.minHours} hours at the destination.`
        : 'No return train leaves after any outbound train arrives.',
    )
  }

  return result
}
