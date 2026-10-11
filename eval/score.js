// Scoring logic for eval cases. See cases.js for what each check type means.

// Heuristic, not exhaustive — built from refusal phrasing actually observed
// from the live model (e.g. "can't take a train", "no matching Amtrak
// station", "doesn't serve"). Expand it when a real refusal slips past it.
export const REFUSAL_PATTERN =
  /\b(can['’]?t|cannot|no\s+amtrak|doesn['’]?t\s+(serve|have|connect)|does\s+not\s+(serve|have|connect)|isn['’]?t\s+(served|possible)|no\s+(direct\s+)?(train|route|rail)|not\s+(possible|available)|no\s+matching)\b/i

export function scoreCase(caseDef, { answer, toolCalls }) {
  const checks = caseDef.checks || {}
  const lowerAnswer = (answer || '').toLowerCase()
  const queries = (toolCalls || []).map((tc) => (tc.query || '').toLowerCase())
  const results = []

  if (checks.anyOfGroups) {
    checks.anyOfGroups.forEach((group, i) => {
      const pass = group.some((s) => lowerAnswer.includes(s.toLowerCase()))
      results.push({ name: `anyOf[${i}]: ${group.join(' | ')}`, pass })
    })
  }

  if (checks.noneOf) {
    checks.noneOf.forEach((s) => {
      const pass = !lowerAnswer.includes(s.toLowerCase())
      results.push({ name: `noneOf: ${s}`, pass })
    })
  }

  if (checks.refusalExpected) {
    results.push({ name: 'refusalExpected', pass: REFUSAL_PATTERN.test(answer || '') })
  }

  if (checks.declineConstraint) {
    results.push({ name: 'declineConstraint', pass: REFUSAL_PATTERN.test(answer || '') })
  }

  if (checks.toolQueriesInclude) {
    checks.toolQueriesInclude.forEach((s) => {
      const pass = queries.some((q) => q.includes(s.toLowerCase()))
      results.push({ name: `toolQueriesInclude: ${s}`, pass })
    })
  }

  return { pass: results.every((r) => r.pass), results }
}
