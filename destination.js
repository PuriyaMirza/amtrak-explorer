// destinationSummary(): the numbers for the destination header (PRD §7.1, B3,
// Figma sheet 07). "From your home station to X on a date: fastest, median,
// trains per day, earliest/latest departure, and the routes that serve it."
//
// Like weekend.js, there is NO SQL here: everything comes from
// findDirectTrains (schedule.js), so station matching, the service-day rule,
// boarding restrictions and the feed's date window all behave exactly as in
// the ask box. Plain data, no prompt text, no AI in the path.
import { findDirectTrains } from './schedule.js'
import { stationName } from './home-station.js'

// Our display name where we have one ("New York Penn Station", not the feed's
// "Ny Moynihan Train Hall At Penn Station"), the same names the picker and the
// ask box use. Unmatched stations pass through unchanged.
const withDisplayName = (st) =>
  st?.status === 'matched' ? { ...st, name: stationName(st.stop_id, st.name) } : st

// findDirectTrains caps its list at 100 (its own maximum). Its `summary`
// always counts every train, but the median needs the durations themselves,
// so we ask for the full 100. No real pair in this feed comes close (busy
// Northeast Corridor pairs run a few dozen a day); if one ever did, the median
// would cover the first 100 by departure and `medianPartial` says so.
export const SUMMARY_TRAIN_LIMIT = 100

// The middle value of a list of numbers (average of the two middle ones for an
// even count), or null for an empty list. Does not change its input.
export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// "1h 27m" from minutes, matching how schedule.js writes `duration`.
export function formatMinutes(minutes) {
  if (minutes == null) return null
  const m = Math.round(minutes)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// destinationSummary(sql, { from, to, date?, today? })
//   from / to   station id or name (resolveStation rules); callers pass a
//               VALIDATED home station id as `from` (see api/destination.js)
//   date        'YYYY-MM-DD'; absent means today (New York)
//   today       override of "today", for tests
//
// Returns
//   { from, to, date, weekday, trainsPerDay, fastest, median, earliest, latest,
//     routes, medianPartial, outsideFeed, ok, notes }
// where fastest/earliest/latest are trains as findDirectTrains returns them,
// median is { minutes, duration }, and routes are route names, most trains first.
// `ok` is false when a station didn't match or the pair is the same station;
// the notes from findDirectTrains say why.
export async function destinationSummary(sql, { from, to, date, today }) {
  const r = await findDirectTrains(sql, { from, to, date, limit: SUMMARY_TRAIN_LIMIT, today })

  const durations = r.trains.map((t) => t.durationMinutes)
  const medianMinutes = median(durations)

  // Routes serving the pair on that day, most trains first, then by name.
  const perRoute = new Map()
  for (const t of r.trains) perRoute.set(t.route, (perRoute.get(t.route) ?? 0) + 1)
  const routes = [...perRoute.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)

  const matched = r.from?.status === 'matched' && r.to?.status === 'matched' && r.from.stop_id !== r.to.stop_id

  return {
    from: withDisplayName(r.from),
    to: withDisplayName(r.to),
    date: r.date,
    weekday: r.weekday,
    trainsPerDay: r.summary.count,
    fastest: r.summary.fastest,
    median: medianMinutes == null ? null : { minutes: medianMinutes, duration: formatMinutes(medianMinutes) },
    earliest: r.summary.earliest,
    latest: r.summary.latest,
    routes,
    medianPartial: r.summary.count > r.trains.length,
    outsideFeed: r.outsideFeed,
    ok: matched,
    notes: r.notes,
  }
}
