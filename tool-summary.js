// One short line per tool call, for the "Lookups:" note under an answer.
// Pure (no DOM, no fetch), so it runs in the browser and in `npm test`.
//
// Each tool records different fields (see askQuestion in ask-core.js):
//   search_trains  { name, input: { query }, query }
//   find_trains    { name, input: { from, to, date?, weekday? }, result? }
//   plan_weekend   { name, input: { from, to, outDate?, outDay?, ... }, result? }
// `result` is missing when the tool threw (then `error` is set), so every
// branch falls back to what the model asked for.
//
// Returns plain text; the caller escapes it before inserting into the page.

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// "NYP" if the tool resolved the station, else the text the model sent.
function stationLabel(resolved, typed) {
  if (resolved?.status === 'matched' && resolved.stop_id) return resolved.stop_id
  return typed || '?'
}

// "2026-10-29" -> "Thu 2026-10-29"; a weekday name -> "next thursday".
function dayLabel(iso, weekday) {
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = new Date(`${iso}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return `${DAY_ABBR[d.getUTCDay()]} ${iso}`
  }
  if (weekday) return `next ${weekday}`
  return null
}

export function describeToolCall(call) {
  const input = call?.input ?? {}
  const result = call?.result
  let text

  if (call?.name === 'search_trains') {
    text = `Searched for "${call.query ?? input.query ?? ''}"`
  } else if (call?.name === 'find_trains') {
    const route = `${stationLabel(result?.from, input.from)} → ${stationLabel(result?.to, input.to)}`
    const day = dayLabel(result?.date ?? input.date, input.weekday)
    text = `Looked up trains ${route}${day ? `, ${day}` : ''}`
  } else if (call?.name === 'plan_weekend') {
    const route = `${stationLabel(result?.from, input.from)} ⇄ ${stationLabel(result?.to, input.to)}`
    const out = dayLabel(result?.outDate ?? input.outDate, input.outDay)
    const back = dayLabel(result?.returnDate ?? input.returnDate, input.returnDay)
    const days = out && back ? `, ${out} – ${back}` : out ? `, ${out}` : ''
    text = `Planned a round trip ${route}${days}`
  } else {
    text = `Used ${call?.name ?? 'a tool'}`
  }

  return call?.error ? `${text} (failed)` : text
}
