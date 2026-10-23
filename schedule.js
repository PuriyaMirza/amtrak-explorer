// Single source of truth for "which direct trains run between A and B, and when".
//
// Like search.js, this takes the Neon `sql` client as its first argument
// instead of importing one (dependency injection), and it contains no
// AI-specific shapes or prompt text: it returns plain data. Today the ask
// box's `find_trains` tool calls it; later a browse endpoint (api/...) can
// call the very same function.
//
// ---------------------------------------------------------------------------
// THE ONE IDEA YOU NEED: service day vs physical day
// ---------------------------------------------------------------------------
// In GTFS (the feed format), a trip belongs to the "service day" it STARTS on,
// and later stops can have times past 24:00:00. Train 66 starts in Roanoke on
// a Wednesday evening and passes New York Penn at "29:44:00". That is 24:00 +
// 5:44, i.e. 5:44 AM on THURSDAY, even though the trip's calendar row says it
// runs on Wednesday service.
//
// A traveler asking about "Thursday" means the physical Thursday. So for a
// requested date D, a train belongs in the answer when
//
//     service date S = D - floor(board_time / 24h)
//
// has calendar service. A board time under 24h means S = D; a time of
// 24:00-47:59 means S = D - 1 (train 66); a time of 48:00-71:59 means
// S = D - 2 (long-distance trains, some stops are at 60+ hours); and so on.
// The time shown to the user is the board time minus those whole days.
// ---------------------------------------------------------------------------
//
// Times are returned exactly as the feed gives them. Every time in this feed
// is US Eastern, even at Chicago or Los Angeles (see TIMEZONE_NOTE).

export const FEED_TIMEZONE = 'America/New_York'

const SECONDS_PER_DAY = 86400

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// Same order as Date#getUTCDay() (0 = Sunday), which is how we index it.

// Names people use that don't substring-match the feed's station names.
// The feed calls NYP "Ny Moynihan Train Hall At Penn Station", so a plain
// "New York" search finds nothing. And "Boston" is the exact name of THREE
// stations (BOS, BBY, BON), so without an alias it could never be resolved.
// Keys are lower-case with punctuation removed (see normalizeName).
// A `note` is shown to the caller so a choice made for them is never silent.
export const STATION_ALIASES = {
  'new york': { id: 'NYP' },
  'new york city': { id: 'NYP' },
  'nyc': { id: 'NYP' },
  'ny penn': { id: 'NYP' },
  'new york penn': { id: 'NYP' },
  'new york penn station': { id: 'NYP' },
  'penn station new york': { id: 'NYP' },
  'washington dc': { id: 'WAS' },
  'washington d c': { id: 'WAS' },
  'dc': { id: 'WAS' },
  'boston': {
    id: 'BOS',
    note: '"Boston" names three stations (BOS, BBY, BON); used BOS, the main one. Pass BBY or BON for the others.',
  },
}

const TIMEZONE_NOTE =
  'All times are US Eastern time at every station, exactly as the schedule data gives them ' +
  '(not the station\'s local clock), so a Chicago or Los Angeles departure is also shown in Eastern time.'

const HOLIDAY_NOTE =
  'Holiday schedules are not modelled (the data has no holiday exceptions); confirm on amtrak.com.'

// ---------------------------------------------------------------------------
// Small date/time helpers (no libraries; dates are plain 'YYYY-MM-DD' strings)
// ---------------------------------------------------------------------------

// Parses 'YYYY-MM-DD' strictly. Returns a UTC midnight Date, or null if the
// string isn't a real calendar date ("2026-02-31" is rejected).
function parseIsoDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === text ? d : null
}

const toIso = (d) => d.toISOString().slice(0, 10)
// 2026-10-29 -> 20261029, the way the calendar table stores dates.
const toYmdInt = (d) => Number(toIso(d).replaceAll('-', ''))
const fromYmdInt = (n) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`
const addDays = (d, n) => new Date(d.getTime() + n * SECONDS_PER_DAY * 1000)

// "Today" as a calendar date in New York, because the feed is Eastern and
// "next Thursday" should not flip at midnight UTC. `now` is injectable so
// tests (and the system prompt) don't depend on the real clock.
export function todayInNewYork(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FEED_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

// 'HH:MM' (24-hour) -> minutes after midnight, or null if malformed.
function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

// Seconds after (physical) midnight -> "7:00 PM". Whole days are dropped
// first, so callers pass already-normalised or raw values alike.
function formatClock(seconds) {
  const s = ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
  const h24 = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(minutes).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

const formatDuration = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

// ---------------------------------------------------------------------------
// Station matching
// ---------------------------------------------------------------------------

const normalizeName = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Resolves what a person typed to ONE station, or says why it can't.
//
//   1. exact stop_id ("NYP"; case-insensitive)
//   2. an alias ("NYC" -> NYP)
//   3. a station whose whole name equals the text ("Philadelphia" is PHL even
//      though "North Philadelphia Amtrak Station" also contains the word)
//   4. a single station whose name contains the text
//   5. more than one candidate at step 3 or 4 -> status 'ambiguous' with the
//      candidates. We never guess: "Washington" is both DC and a Missouri town.
export async function resolveStation(sql, input) {
  const text = String(input ?? '').trim()
  if (text.length === 0) return { input: text, status: 'not_found', candidates: [] }
  // hasOwn: a plain lookup would also "find" inherited keys like "constructor".
  const aliasKey = normalizeName(text)
  const alias = Object.hasOwn(STATION_ALIASES, aliasKey) ? STATION_ALIASES[aliasKey] : undefined
  const lookup = alias ? alias.id : text
  // % and _ are wildcards in LIKE; people's text should be taken literally.
  const pattern = `%${lookup.replace(/[%_\\]/g, '')}%`

  const rows = await sql`
    select stop_id, stop_name, stop_timezone
    from stops
    where upper(stop_id) = upper(${lookup}) or stop_name ilike ${pattern}
    order by
      (upper(stop_id) = upper(${lookup})) desc,
      (lower(stop_name) = lower(${lookup})) desc,
      stop_name, stop_id
    limit 25
  `
  const station = (r) => ({ stop_id: r.stop_id, name: r.stop_name, timezone: r.stop_timezone })
  const matched = (r) => ({ input: text, status: 'matched', ...station(r), ...(alias?.note ? { note: alias.note } : {}) })

  const byId = rows.filter((r) => r.stop_id.toUpperCase() === lookup.toUpperCase())
  if (byId.length === 1) return matched(byId[0])

  const lowerLookup = lookup.toLowerCase()
  const byName = rows.filter((r) => r.stop_name.toLowerCase() === lowerLookup)
  if (byName.length === 1) return matched(byName[0])

  const candidates = byName.length > 1 ? byName : rows
  if (candidates.length === 1) return matched(candidates[0])
  if (candidates.length === 0) return { input: text, status: 'not_found', candidates: [] }
  return { input: text, status: 'ambiguous', candidates: candidates.slice(0, 10).map(station) }
}

// ---------------------------------------------------------------------------
// The main function
// ---------------------------------------------------------------------------

// Validates and normalises the options. Throws an Error with a plain message
// (the ask tool hands it back to the model so it can correct itself).
function normalizeOptions({ from, to, date, weekday, departAfter, departBefore, route, limit, today }) {
  const fail = (msg) => {
    throw new Error(msg)
  }
  const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100
  if (!isText(from)) fail('"from" must be a station id or name (1-100 characters)')
  if (!isText(to)) fail('"to" must be a station id or name (1-100 characters)')

  if (date != null && weekday != null) fail('give either "date" or "weekday", not both')
  if (date != null && (typeof date !== 'string' || !parseIsoDate(date))) {
    fail('"date" must be a real calendar date written YYYY-MM-DD')
  }
  const weekdayName = weekday == null ? null : String(weekday).toLowerCase()
  if (weekdayName != null && !WEEKDAYS.includes(weekdayName)) {
    fail('"weekday" must be one of monday, tuesday, wednesday, thursday, friday, saturday, sunday')
  }

  const after = departAfter == null ? null : parseClock(String(departAfter))
  const before = departBefore == null ? null : parseClock(String(departBefore))
  if (departAfter != null && after === null) fail('"departAfter" must be a 24-hour time like "18:00"')
  if (departBefore != null && before === null) fail('"departBefore" must be a 24-hour time like "09:30"')

  if (route != null && (typeof route !== 'string' || route.length > 100)) fail('"route" must be text, e.g. "Acela"')

  const max = limit == null ? 25 : Number(limit)
  if (!Number.isInteger(max) || max < 1 || max > 100) fail('"limit" must be a whole number from 1 to 100')

  const todayDate = parseIsoDate(today ?? todayInNewYork())
  if (!todayDate) fail('"today" must be YYYY-MM-DD')

  return { from: from.trim(), to: to.trim(), date, weekdayName, after, before, route: route?.trim() || null, max, todayDate }
}

// findDirectTrains(sql, { from, to, date?, weekday?, departAfter?, departBefore?, route?, limit?, today? })
//
//   from / to       station id ("NYP") or name ("new york", "Boston"); see resolveStation
//   date            'YYYY-MM-DD', the physical day the traveler leaves
//   weekday         'thursday' etc. instead of a date: means the NEXT such day
//                   from today, so one real timetable is used (timetables
//                   change through the year; mixing them would list trains that
//                   never run on the same day)
//   (neither)       today
//   departAfter     'HH:MM' 24-hour, inclusive; departBefore likewise
//   route           keep only routes whose name contains this text ("Acela")
//   limit           max trains returned (default 25); `summary` always covers all
//   today           'YYYY-MM-DD' override of "today" (for tests)
//
// Returns plain data:
//   { from, to, date, weekday, dateSource, trains, unavailable, summary,
//     calendarWindow, outsideFeed, notes }
// where each train is
//   { train, route, depart, arrive, arriveDayOffset, durationMinutes,
//     duration, overnight, serviceDate }
// `depart` is on the requested date; `arriveDayOffset` counts days after it
// (1 = arrives the next day). `overnight` means arriveDayOffset > 0.
export async function findDirectTrains(sql, options) {
  const o = normalizeOptions(options)

  // Which physical date are we answering for?
  let requested
  let dateSource
  if (o.date) {
    requested = parseIsoDate(o.date)
    dateSource = 'requested'
  } else if (o.weekdayName) {
    const target = WEEKDAYS.indexOf(o.weekdayName)
    const ahead = (target - o.todayDate.getUTCDay() + 7) % 7
    requested = addDays(o.todayDate, ahead)
    dateSource = 'next-weekday'
  } else {
    requested = o.todayDate
    dateSource = 'today'
  }
  const requestedIso = toIso(requested)

  const notes = []
  if (dateSource === 'next-weekday') {
    notes.push(
      `No date was given, so this is the next ${o.weekdayName} (${requestedIso}). ` +
        'Timetables change through the year; give a date for an exact answer.',
    )
  } else if (dateSource === 'today') {
    notes.push(`No date was given, so this is today (${requestedIso}).`)
  }

  // Stations and the feed's date range are independent lookups: run together.
  const [fromStation, toStation, windowRows] = await Promise.all([
    resolveStation(sql, o.from),
    resolveStation(sql, o.to),
    sql`select min(start_date)::int as first_day, max(end_date)::int as last_day from calendar`,
  ])
  const calendarWindow = windowRows[0]?.first_day
    ? { start: fromYmdInt(Number(windowRows[0].first_day)), end: fromYmdInt(Number(windowRows[0].last_day)) }
    : null

  const result = {
    from: fromStation,
    to: toStation,
    date: requestedIso,
    weekday: WEEKDAYS[requested.getUTCDay()],
    dateSource,
    trains: [],
    unavailable: [],
    summary: { count: 0, earliest: null, latest: null, fastest: null },
    calendarWindow,
    outsideFeed: false,
    notes,
  }

  for (const [label, st] of [['from', fromStation], ['to', toStation]]) {
    if (st.status === 'not_found') notes.push(`No station matches ${label} "${st.input}".`)
    if (st.status === 'ambiguous') {
      notes.push(`${label} "${st.input}" matches more than one station; pick one by stop_id from the candidates and ask again.`)
    }
    if (st.note) notes.push(st.note)
  }
  if (fromStation.status !== 'matched' || toStation.status !== 'matched') return result
  if (fromStation.stop_id === toStation.stop_id) {
    notes.push('from and to are the same station.')
    return result
  }

  // The feed only covers one stretch of dates; outside it there is no data,
  // and an empty list would wrongly read as "no trains run".
  if (calendarWindow && (requestedIso < calendarWindow.start || requestedIso > calendarWindow.end)) {
    result.outsideFeed = true
    notes.push(
      `${requestedIso} is outside the schedule data, which covers ${calendarWindow.start} to ${calendarWindow.end}. ` +
        'No times can be given for that date.',
    )
    return result
  }

  // Every direct leg between the two stations, any day. Direct = same trip_id
  // with the from-stop earlier in the trip than the to-stop. Times are text
  // like "6:53:00" (no leading zero) that can pass 24h, so we convert to
  // seconds in SQL; comparing the strings would sort "10:00" before "6:53".
  // Boarding/alighting restrictions (pickup_type / drop_off_type = 1) are
  // returned as flags rather than filtered, so we can explain a "no" (e.g. the
  // Cardinal at Washington) instead of silently showing nothing.
  // Numbers are cast to int because Neon returns bigint columns as strings.
  const legs = await sql`
    select
      t.trip_short_name::text as train,
      r.route_long_name as route,
      split_part(a.departure_time, ':', 1)::int * 3600
        + split_part(a.departure_time, ':', 2)::int * 60
        + split_part(a.departure_time, ':', 3)::int as dep_secs,
      split_part(b.arrival_time, ':', 1)::int * 3600
        + split_part(b.arrival_time, ':', 2)::int * 60
        + split_part(b.arrival_time, ':', 3)::int as arr_secs,
      coalesce(a.pickup_type, 0) <> 1 as can_board,
      coalesce(b.drop_off_type, 0) <> 1 as can_alight,
      c.sunday::int as sunday, c.monday::int as monday, c.tuesday::int as tuesday,
      c.wednesday::int as wednesday, c.thursday::int as thursday,
      c.friday::int as friday, c.saturday::int as saturday,
      c.start_date::int as start_date, c.end_date::int as end_date
    from stop_times a
    join stop_times b on b.trip_id = a.trip_id and a.stop_sequence < b.stop_sequence
    join trips t on t.trip_id = a.trip_id
    join routes r on r.route_id = t.route_id
    join calendar c on c.service_id = t.service_id
    where a.stop_id = ${fromStation.stop_id} and b.stop_id = ${toStation.stop_id}
  `

  const routeFilter = o.route?.toLowerCase()
  const seen = new Set()
  const seenRestricted = new Set()
  const trains = []
  const unavailable = []
  let startedEarlierDay = 0

  for (const leg of legs) {
    const dep = Number(leg.dep_secs)
    const arr = Number(leg.arr_secs)
    if (routeFilter && !String(leg.route).toLowerCase().includes(routeFilter)) continue

    // Trains that stop at both stations but can't be used (no boarding at
    // `from`, or no getting off at `to`) are listed whatever the date, so
    // "can I take the Cardinal from Washington?" gets a real "no, you can't
    // board there" instead of a puzzling empty list.
    if (!leg.can_board || !leg.can_alight) {
      const reason = !leg.can_board
        ? `stops at ${fromStation.name} but does not allow boarding there`
        : `stops at ${toStation.name} but does not allow getting off there`
      const restrictedKey = `${leg.train}|${reason}`
      if (!seenRestricted.has(restrictedKey)) {
        seenRestricted.add(restrictedKey)
        unavailable.push({ train: String(leg.train), route: leg.route, reason })
      }
      continue
    }

    // The service-day rule from the top of this file.
    const wholeDays = Math.floor(dep / SECONDS_PER_DAY)
    const serviceDate = addDays(requested, -wholeDays)
    const serviceYmd = toYmdInt(serviceDate)
    if (serviceYmd < Number(leg.start_date) || serviceYmd > Number(leg.end_date)) continue
    if (Number(leg[WEEKDAYS[serviceDate.getUTCDay()]]) !== 1) continue

    const departSecs = dep - wholeDays * SECONDS_PER_DAY
    const arriveSecs = arr - wholeDays * SECONDS_PER_DAY
    const departMinutes = Math.floor(departSecs / 60)
    if (o.after !== null && departMinutes < o.after) continue
    if (o.before !== null && departMinutes > o.before) continue

    // The same train can appear twice when two calendar windows overlap.
    const key = `${leg.train}|${departSecs}|${arriveSecs}`
    if (seen.has(key)) continue
    seen.add(key)

    const durationMinutes = Math.round((arr - dep) / 60)
    const arriveDayOffset = Math.floor(arriveSecs / SECONDS_PER_DAY)
    if (wholeDays > 0) startedEarlierDay++
    trains.push({
      train: String(leg.train),
      route: leg.route,
      depart: formatClock(departSecs),
      arrive: formatClock(arriveSecs),
      arriveDayOffset,
      durationMinutes,
      duration: formatDuration(durationMinutes),
      overnight: arriveDayOffset > 0,
      serviceDate: toIso(serviceDate),
      // sort keys, removed before returning
      _depart: departSecs,
      _arrive: arriveSecs,
    })
  }

  trains.sort((x, y) => x._depart - y._depart || x._arrive - y._arrive || x.train.localeCompare(y.train))
  const clean = ({ _depart, _arrive, ...train }) => train
  const all = trains.map(clean)

  // The summary is computed on the FULL list so that "last train" and
  // "fastest" stay right even when `limit` cuts the list short.
  const fastest = all.reduce((best, t) => (best === null || t.durationMinutes < best.durationMinutes ? t : best), null)
  result.summary = { count: all.length, earliest: all[0] ?? null, latest: all.at(-1) ?? null, fastest }
  result.trains = all.slice(0, o.max)
  result.unavailable = unavailable.slice(0, 10)

  // On the feed's very first day, a train that started the evening before
  // (before the data begins) is missing, so an empty or short list may be wrong.
  const firstDay = calendarWindow && requestedIso === calendarWindow.start
  if (firstDay) {
    notes.push(
      `${requestedIso} is the first day in the schedule data, so trains that started the previous day ` +
        '(and pass after midnight) are not in the data and may be missing.',
    )
  } else if (all.length === 0) {
    notes.push(`No direct train runs ${fromStation.name} to ${toStation.name} on ${requestedIso} with these filters.`)
  }
  if (all.length > o.max) {
    notes.push(`Showing the first ${o.max} of ${all.length} trains by departure time; the summary covers all ${all.length}. Use departAfter to see later ones.`)
  }
  if (startedEarlierDay > 0) {
    notes.push(
      `${startedEarlierDay} train(s) started their journey the evening before (their serviceDate is earlier) ` +
        `and pass ${fromStation.name} after midnight, so they leave in the early hours of ${requestedIso}.`,
    )
  }
  if (result.unavailable.length > 0) {
    notes.push('Some trains stop at both stations but cannot be used for this trip (on any date); see "unavailable".')
  }
  if (all.length > 0 || result.unavailable.length > 0) notes.push(TIMEZONE_NOTE, HOLIDAY_NOTE)
  const zones = [fromStation, toStation].filter((s) => s.timezone && s.timezone !== FEED_TIMEZONE)
  if (zones.length > 0 && all.length > 0) {
    notes.push(`${zones.map((s) => `${s.name} (${s.timezone})`).join(' and ')} keep a different local clock than the Eastern times shown.`)
  }

  return result
}
