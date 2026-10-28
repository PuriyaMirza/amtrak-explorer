// Scoring logic for eval cases. See cases.js for what each check type means.
import { failureTypeOf } from './taxonomy.js'

// Version of the scoring rules. Written next to the Prompt version in each
// eval/RESULTS.md row, because a change here moves pass rates just like a
// prompt change does, and rows scored by different versions are not directly
// comparable. Bump it whenever a change here could flip a case's result.
//   1 = the original scorer (implicit; rows before this constant existed)
//   2 = plural refusal phrases ("no trains") for refusalExpected/declineConstraint
//       only + "unable to"/"couldn't" + scope-disclaimer stripping in noRefusal.
//       Rule: never wrong where v1 was right (test/score-adversarial.test.js)
//       (motivating false negatives: anchorage-refusal, weekend-generic-philadelphia)
//   3 = REFUSAL_PATTERN_EXPECT for refusalExpected/declineConstraint only:
//       bare sentence-initial "No.", "doesn't allow", "no usable/boardable".
//       noRefusal is untouched by construction (it never reads this pattern).
//       (motivating false negative: cardinal-no-boarding-was-nyc, prompt v5)
//   4 = adds the toolInputHas check (structure: a tool input field is present
//       and well-formed). Every existing check is byte-identical, so the 41 v3
//       cases score exactly as under v3; only the new case reads it.
//       (motivating case: next-train-uses-current-time, prompt v6)
export const SCORER_VERSION = 4

// Heuristic, not exhaustive — built from refusal phrasing actually observed
// from the live model (e.g. "can't take a train", "no matching Amtrak
// station", "doesn't serve"). Expand it when a real refusal slips past it.
//
// Two patterns, because the two directions want opposite things:
//   - noRefusal ("this answer must NOT read as a refusal") wants a NARROW
//     pattern: every extra phrase risks flagging a correct answer ("No trains
//     run on Christmas Day, but train 66 leaves at 5:44 AM"). It uses
//     REFUSAL_PATTERN_V1: the original (v1) pattern plus "unable to",
//     "not able to", "couldn't / could not".
//   - refusalExpected / declineConstraint ("the answer must refuse") want a
//     WIDER pattern, since recognising more refusal phrasings is the goal.
//     REFUSAL_PATTERN_LOOSE adds plural "no trains / no routes / no stations"
//     (the model says "There are no trains from Seattle to Anchorage"), except
//     when the next word is a time or place qualifier ("no trains after 11 PM").
export const REFUSAL_PATTERN_V1 =
  /\b(can['’]?t|cannot|unable\s+to|not\s+able\s+to|could(?:n['’]?t|\s+not)|no\s+amtrak|doesn['’]?t\s+(serve|have|connect)|does\s+not\s+(serve|have|connect)|isn['’]?t\s+(served|possible)|no\s+(direct\s+)?(train|route|rail)|not\s+(possible|available)|no\s+matching)\b/i
export const REFUSAL_PATTERN_LOOSE = new RegExp(
  REFUSAL_PATTERN_V1.source.replace(
    'no\\s+(direct\\s+)?(train|route|rail)',
    'no\\s+(?:direct\\s+)?(?:trains?|routes?|rail|stations?)(?!\\s+(?:after|before|on|during|until|past|between|stop))',
  ),
  'i',
)

//   - refusalExpected / declineConstraint ALSO read REFUSAL_PATTERN_EXPECT,
//     which is LOOSE plus three phrasings that v5 answers actually used and
//     v2 missed (case cardinal-no-boarding-was-nyc, scorer v2):
//       "No. The Cardinal ... doesn't allow boarding ... found no usable Cardinal"
//     Why a THIRD pattern instead of widening LOOSE: noRefusal falls back to
//     LOOSE whenever a scope disclaimer was cut (see the noRefusal branch), so
//     widening LOOSE would also change the "must NOT refuse" direction, where
//     every extra phrase risks failing a correct answer. Keeping the additions
//     here means noRefusal behavior is unchanged by construction.
//
//     Each addition is deliberately narrow:
//       - a bare sentence-initial "No." / "No," (the v5 answer opens with it).
//         Anchored to start-of-string or after sentence punctuation, so it
//         cannot fire inside a word or mid-clause.
//       - "doesn't / does not allow" (boarding restrictions: pickup_type = 1).
//         The verb list in V1 stops at serve/have/connect.
//       - "no usable / no boardable <anything>", NOT a general "no <noun>":
//         a general form would read "no usable" and "no Acela" alike and is
//         the kind of over-generalization that cost a pass rate before.
const REFUSAL_EXTRA_EXPECT = String.raw`(?:^|[.!?]\s+)no[,.]|\b(?:doesn['’]?t|does\s+not)\s+allow\b|\bno\s+(?:usable|boardable)\b`
export const REFUSAL_PATTERN_EXPECT = new RegExp(
  `${REFUSAL_PATTERN_LOOSE.source}|${REFUSAL_EXTRA_EXPECT}`,
  'i',
)

// A correct schedule answer is told (system prompt, v2) to add a caveat like
// "I can't account for holiday schedules, so confirm on amtrak.com". That
// clause contains "can't", which REFUSAL_PATTERN_V1 reads as a refusal, so a
// right answer would fail noRefusal for doing what it was told.
//
// Fix: before testing noRefusal, cut out just the caveat CLAUSE (the
// holiday phrase and the "can't ..." wording attached to it) and test what is
// left. So "I can't account for holidays, so confirm on amtrak.com." leaves
// nothing refusal-like and passes, while "I can't look that up because holiday
// schedules are not modelled." leaves "I can't look that up because ." and
// still fails. (An earlier version dropped whole holiday sentences, which let
// that second example through.)
//
// Why not "pass if the answer contains an expected time"? Because that would
// also pass "I can't look that up, but maybe the 6:53?", which IS a refusal,
// and some cases have no expected time at all. Why not narrow REFUSAL_PATTERN_V1?
// It has to keep matching "I can't ..." for the refusal cases.
//
// The clause shapes recognised: "<can't/cannot/unable to/don't/do not>
// <account for/model/see/include/cover/know/verify/reflect> [any] holiday(s)
// [schedules/service/...]" and "holiday schedules <are/aren't> [not] modelled/
// included/covered". A caveat worded some other way is not stripped, and fails
// noRefusal: loosen this regex when a real caveat wording shows up.
const HOLIDAY_WORD = String.raw`holidays?(?:\s+(?:schedules?|service|changes|closures|exceptions))?`
const HOLIDAY_CAVEAT = new RegExp(
  String.raw`\b(?:(?:can['’]?t|cannot|unable\s+to|(?:do|does|did)\s*n['’]?t|(?:do|does)\s+not)\s+` +
    String.raw`(?:account\s+for|model|see|include|cover|know|verify|reflect)\s+(?:any\s+|the\s+)?${HOLIDAY_WORD}` +
    String.raw`|${HOLIDAY_WORD}\s+(?:are|is|aren['’]?t|isn['’]?t|were)\s+(?:not\s+)?(?:being\s+)?` +
    String.raw`(?:modell?ed|included|covered|reflected|accounted\s+for))`,
  'gi',
)

export function withoutHolidayCaveats(answer) {
  return answer.replace(HOLIDAY_CAVEAT, '')
}

// Scope disclaimers. The system prompt tells the model to say what it can't
// do: fares, seat availability, live delays, booking. A correct schedule
// answer that ends "I can't see fares or seat availability." would otherwise
// fail noRefusal for doing what it was told (case weekend-generic-philadelphia,
// scorer v1).
//
// Same approach as the holiday caveat: cut only the disclaimer CLAUSE and test
// what is left, so a sentence that also refuses the real question keeps its
// refusal wording ("I can't look that up, and I can't see fares" leaves
// "I can't look that up, and I ."). Deliberately narrow; a clause is cut only
// if ALL of these hold:
//   - shape: <can't / cannot / unable to / not able to / don't have / do not
//     have> [see/show/give/book/...] [filler] <topics>. Bare "fares are not
//     available" sentences are NOT cut (they stay refusal-like, as in v1).
//   - the topics are only the out-of-scope ones (fares, prices, tickets, seat
//     availability, delays/live status, booking/reservations, connections),
//     joined by commas / "or" / "and"
//   - nothing after the topics continues the negation onto something else
//     ("can't see fares or the times", "or give times") or points at the actual
//     route ("can't see connections between X and Y")
// Verbs like find/search/look up are NOT in the list: those are how the model
// refuses the real question. Wording not recognised is simply not cut, and
// fails noRefusal; loosen this when a real disclaimer wording shows up.
const SCOPE_TOPIC = String.raw`(?:fares?(?:\s+(?:data|info(?:rmation)?))?|(?:ticket\s+)?prices?|pricing|tickets?|ticketing|` +
  String.raw`(?:seat|ticket)\s+availability|seats?|delays?(?:\s+info(?:rmation)?)?|` +
  String.raw`(?:live|real-time|realtime)\s+(?:train\s+)?(?:status|updates?|info(?:rmation)?|data)|` +
  String.raw`bookings?|booking\s+info(?:rmation)?|reservations?|connections?|transfers?)\b`
const SCOPE_FILLER = String.raw`(?:(?:any|anything|the|current|live|real-time|realtime|real\s+time|actual|exact|up-to-date|accurate|you|your|about|on|for)\s+)*`
const SCOPE_TOPICS =
  SCOPE_FILLER + SCOPE_TOPIC +
  String.raw`(?:(?:\s*,\s*(?:(?:or|and|nor)\s+)?|\s+(?:or|and|nor)\s+)` + SCOPE_FILLER + SCOPE_TOPIC + String.raw`)*`
const SCOPE_VERB =
  String.raw`(?:see|show|give|provide|check|book|reserve|access(?:\s+to)?|tell|know|offer|quote|confirm|make|process|handle)`
// The verb is optional ("I don't have fare information") but a verb chain may
// be joined with "or" ("see or book").
const SCOPE_VP = String.raw`(?:${SCOPE_VERB}(?:\s+or\s+${SCOPE_VERB})*\s+)?${SCOPE_TOPICS}`
const SCOPE_DISCLAIMER = new RegExp(
  String.raw`\b(?:can['’]?t|cannot|unable\s+to|not\s+able\s+to|(?:do|does)\s*n['’]?t\s+have|(?:do|does)\s+not\s+have)\s+` +
    String.raw`${SCOPE_VP}(?:\s*,?\s*(?:or|and)\s+${SCOPE_VP})*`,
  'gi',
)
// What may NOT follow a matched clause (else it is left alone, so its refusal
// wording still counts): "or"/"and"/"nor" + anything but a fresh clause start
// (the negation reaches that word too), or a pointer at the actual route (between/from/to/via/of).
const SCOPE_BAD_CONTINUATION =
  /^(?:\s*,?\s*(?:or|and|nor)\s+(?!(?:I|we|it|please|you|this|that|these|those|my|our)\b)|\s+(?:between|from|to|via|of)\b)/i

export function withoutScopeDisclaimers(answer) {
  return answer.replace(SCOPE_DISCLAIMER, (match, offset, whole) =>
    SCOPE_BAD_CONTINUATION.test(whole.slice(offset + match.length)) ? match : '',
  )
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
    add('refusalExpected', 'refusalExpected', REFUSAL_PATTERN_EXPECT.test(answer || ''))
  }

  if (checks.declineConstraint) {
    add('declineConstraint', 'declineConstraint', REFUSAL_PATTERN_EXPECT.test(answer || ''))
  }

  // The mirror image of refusalExpected: the answer must NOT read as a
  // refusal. The holiday-caveat and scope-disclaimer clauses are exempt (see
  // withoutHolidayCaveats / withoutScopeDisclaimers).
  if (checks.noRefusal) {
    const noHoliday = withoutHolidayCaveats(answer || '')
    const cleaned = withoutScopeDisclaimers(noHoliday)
    // When a disclaimer was cut, its "can't" no longer masks a plural refusal
    // elsewhere ("There are no direct trains. I can't see fares." failed in v1
    // only because of that "can't"), so the rest is tested with the wider
    // pattern. Without a cut, the narrow pattern keeps v1's behavior.
    const pattern = cleaned !== noHoliday ? REFUSAL_PATTERN_LOOSE : REFUSAL_PATTERN_V1
    add('noRefusal', 'noRefusal', !pattern.test(cleaned))
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

  // Structure check on the tool INPUT: some call to `tool` must have sent
  // `field`, and (if given) it must match `matches`. For "the next train" this
  // asserts departAfter was a real 'HH:MM' without fixing which time: the
  // right train changes by the hour, so the answer text can't be pinned.
  if (checks.toolInputHas) {
    const { tool, field, matches } = checks.toolInputHas
    const ok = (toolCalls || []).some((tc) => {
      if (tc.name !== tool) return false
      const value = tc.input?.[field]
      if (value == null || value === '') return false
      return matches ? new RegExp(matches).test(String(value)) : true
    })
    add('toolInputHas', `toolInputHas: ${tool}.${field}${matches ? ` ~ /${matches}/` : ''}`, ok)
  }

  return { pass: results.every((r) => r.pass), results }
}
