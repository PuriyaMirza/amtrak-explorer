// Failure taxonomy: every check that can fail maps to ONE named failure type.
//
// Why bother? "27/40 passed" tells you the score; it doesn't tell you what to
// fix. "9 hallucinated-entity, 4 wrong-refusal" does: the first is a prompt
// problem, the second is usually a missing tool. The names below are what
// show up in the runner output and in eval/RESULTS.md.
//
// The key is the check's name in cases.js; the value is the failure type.
export const FAILURE_TYPES = {
  // The answer should name a real station/route and didn't.
  anyOfGroups: 'missing-entity',
  // The answer should contain a real time/duration/train number and didn't.
  anyOfTimes: 'wrong-time',
  // The answer named something it must not (an invented place, a price).
  noneOf: 'hallucinated-entity',
  // Should have refused (nonexistent place, no data) but answered.
  refusalExpected: 'missed-refusal',
  declineConstraint: 'missed-refusal',
  // Refused (or hedged "I can't") when a real answer was available.
  noRefusal: 'wrong-refusal',
  // Never issued a search_trains query mentioning the thing asked about, so
  // the answer was not grounded in a lookup.
  toolQueriesInclude: 'no-grounding',
  // Never called the tool this question needs (e.g. a schedule tool).
  toolCalled: 'wrong-tool',
  // Called the tool but without the input the question needs, e.g. "the next
  // train" with no departAfter, so the answer can't be about trains from now.
  toolInputHas: 'ignored-time',
  // The request itself blew up (HTTP error, API error, timeout).
  request: 'request-error',
}

// One line per type, used in the RESULTS.md header and handy when reading a run.
export const FAILURE_TYPE_DESCRIPTIONS = {
  'missing-entity': 'answer left out a station/route it should have named',
  'wrong-time': 'answer left out the real time, duration or train number',
  'hallucinated-entity': 'answer included something it must not (invented place, price)',
  'missed-refusal': 'answered when it should have refused or declined',
  'wrong-refusal': 'refused when a real answer was available',
  'no-grounding': 'no search query about the thing asked, so the answer is ungrounded',
  'wrong-tool': 'never called the tool the question needs',
  'ignored-time': 'called the tool without the current time ("next train" with no departAfter)',
  'request-error': 'the request itself failed (HTTP/API error)',
}

export function failureTypeOf(checkKey) {
  return FAILURE_TYPES[checkKey]
}

// Counts failed checks by type across a whole run. A single case can fail
// several checks (and so contribute to several types); that is intentional,
// because each is a different thing to fix.
// outcomes: [{ pass, results: [{ pass, type }] }]
export function countFailures(outcomes) {
  const counts = {}
  for (const outcome of outcomes) {
    for (const r of outcome.results || []) {
      if (!r.pass) counts[r.type] = (counts[r.type] || 0) + 1
    }
  }
  // Most common first, so the biggest problem is at the top.
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}
