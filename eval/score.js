// Scoring logic for eval cases. See cases.js for what each check type means.
import { failureTypeOf } from './taxonomy.js'

// Heuristic, not exhaustive — built from refusal phrasing actually observed
// from the live model (e.g. "can't take a train", "no matching Amtrak
// station", "doesn't serve"). Expand it when a real refusal slips past it.
export const REFUSAL_PATTERN =
  /\b(can['’]?t|cannot|no\s+amtrak|doesn['’]?t\s+(serve|have|connect)|does\s+not\s+(serve|have|connect)|isn['’]?t\s+(served|possible)|no\s+(direct\s+)?(train|route|rail)|not\s+(possible|available)|no\s+matching)\b/i

// A correct schedule answer is told (system prompt, v2) to add a caveat like
// "I can't account for holiday schedules, so confirm on amtrak.com". That
// sentence contains "can't", which REFUSAL_PATTERN reads as a refusal, so a
// right answer would fail noRefusal for doing what it was told.
//
// Fix: noRefusal ignores sentences about holidays and tests the rest. Why not
// "pass if the answer contains an expected time" instead? Because that would
// also pass "I can't look that up, but maybe the 6:53?", which IS a refusal,
// and some cases have no expected time at all. Why not narrow REFUSAL_PATTERN
// itself? It has to keep matching "I can't ..." for the refusal cases.
// Limit: a sentence that mixes a holiday caveat with a real refusal is
// skipped as a whole; the other checks on those cases (anyOfTimes,
// toolCalled) still catch an answer with no real content.
export function withoutHolidayCaveats(answer) {
  return answer
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !/holiday/i.test(sentence))
    .join(' ')
}

// True if at least one entry in the group matches the answer. A string entry
// is a case-insensitive substring. A RegExp entry is tested against the
// answer as written; use one when a substring would match too much (e.g.
// "3h" also matches inside "13h", so use /\b3\s*h(?![a-z])/i instead).
function groupMatches(group, lowerAnswer, answer) {
  return group.some((s) =>
    s instanceof RegExp ? s.test(answer) : lowerAnswer.includes(s.toLowerCase()),
  )
}

// How a group is shown in a check's name (strings as-is, regexes as /.../).
const describeGroup = (group) => group.map(String).join(' | ')

export function scoreCase(caseDef, { answer, toolCalls }) {
  const checks = caseDef.checks || {}
  const lowerAnswer = (answer || '').toLowerCase()
  const queries = (toolCalls || []).map((tc) => (tc.query || '').toLowerCase())
  const results = []

  // Every result carries the check's key (`check`) and the failure type it
  // would be counted as (`type`, see taxonomy.js). `type` only matters when
  // `pass` is false.
  const add = (check, name, pass) =>
    results.push({ check, name, pass, type: failureTypeOf(check) })

  if (checks.anyOfGroups) {
    checks.anyOfGroups.forEach((group, i) => {
      add('anyOfGroups', `anyOf[${i}]: ${describeGroup(group)}`, groupMatches(group, lowerAnswer, answer || ''))
    })
  }

  // Same matching as anyOfGroups; a separate key only so a miss is counted as
  // `wrong-time` rather than `missing-entity`.
  if (checks.anyOfTimes) {
    checks.anyOfTimes.forEach((group, i) => {
      add('anyOfTimes', `anyOfTimes[${i}]: ${describeGroup(group)}`, groupMatches(group, lowerAnswer, answer || ''))
    })
  }

  if (checks.noneOf) {
    checks.noneOf.forEach((s) => {
      add('noneOf', `noneOf: ${s}`, !lowerAnswer.includes(s.toLowerCase()))
    })
  }

  if (checks.refusalExpected) {
    add('refusalExpected', 'refusalExpected', REFUSAL_PATTERN.test(answer || ''))
  }

  if (checks.declineConstraint) {
    add('declineConstraint', 'declineConstraint', REFUSAL_PATTERN.test(answer || ''))
  }

  // The mirror image of refusalExpected: the answer must NOT read as a
  // refusal. Holiday caveats are exempt (see withoutHolidayCaveats).
  if (checks.noRefusal) {
    add('noRefusal', 'noRefusal', !REFUSAL_PATTERN.test(withoutHolidayCaveats(answer || '')))
  }

  if (checks.toolQueriesInclude) {
    checks.toolQueriesInclude.forEach((s) => {
      add('toolQueriesInclude', `toolQueriesInclude: ${s}`, queries.some((q) => q.includes(s.toLowerCase())))
    })
  }

  // Structure check, not a string check: did the model call this tool at all?
  // (Each toolCalls entry records the tool's `name`.)
  if (checks.toolCalled) {
    add(
      'toolCalled',
      `toolCalled: ${checks.toolCalled}`,
      (toolCalls || []).some((tc) => tc.name === checks.toolCalled),
    )
  }

  return { pass: results.every((r) => r.pass), results }
}
