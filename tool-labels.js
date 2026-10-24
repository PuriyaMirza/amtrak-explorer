// Turns one entry of /api/ask's `toolCalls` into a short line for the page,
// e.g. "Looked up trains NYP → BOS, 2026-10-29". Pure (no DOM), so it can be
// unit-tested in node and imported by index.html as-is.
//
// Each tool's entry has `name` + `input` (what the model asked for); only
// search_trains has `query`. Values come from the model, so the caller must
// still escape the returned text before putting it in HTML.

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// A date wins; a bare weekday means "the next such day" (see schedule.js).
function dayLabel(date, weekday) {
  if (date) return String(date)
  if (weekday) return `next ${capitalize(String(weekday))}`
  return null
}

export function formatToolCall(call) {
  const input = call?.input ?? {}
  let label

  if (call?.name === 'search_trains') {
    label = `Searched for "${call.query ?? input.query ?? ''}"`
  } else if (call?.name === 'find_trains') {
    const parts = [`Looked up trains ${input.from ?? '?'} → ${input.to ?? '?'}`]
    const day = dayLabel(input.date, input.weekday)
    if (day) parts.push(day)
    if (input.departAfter) parts.push(`after ${input.departAfter}`)
    if (input.departBefore) parts.push(`before ${input.departBefore}`)
    if (input.route) parts.push(`route ${input.route}`)
    label = parts.join(', ')
  } else if (call?.name === 'plan_weekend') {
    const parts = [`Planned a round trip ${input.from ?? '?'} ⇄ ${input.to ?? '?'}`]
    const out = dayLabel(input.outDate, input.outDay)
    const back = dayLabel(input.returnDate, input.returnDay)
    if (out) parts.push(`out ${out}`)
    if (back) parts.push(`back ${back}`)
    label = parts.join(', ')
  } else {
    label = `Used ${call?.name ?? 'a tool'}`
  }

  return call?.error ? `${label} (failed)` : label
}
