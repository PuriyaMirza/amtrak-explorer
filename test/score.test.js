import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreCase,
  REFUSAL_PATTERN_V1,
  REFUSAL_PATTERN_LOOSE,
  REFUSAL_PATTERN_EXPECT,
  SCORER_VERSION,
  withoutHolidayCaveats,
  withoutScopeDisclaimers,
} from '../eval/score.js'

// Small helper: score a made-up case with the given checks and response.
const score = (checks, response) => scoreCase({ id: 'x', category: 'easy', checks }, response)
const failedTypes = (r) => r.results.filter((x) => !x.pass).map((x) => x.type)

test('a case with no checks passes', () => {
  assert.equal(score({}, { answer: 'anything', toolCalls: [] }).pass, true)
})

test('anyOfGroups: each group needs one hit; case-insensitive', () => {
  const checks = { anyOfGroups: [['Acela', 'Regional'], ['Boston']] }
  assert.equal(score(checks, { answer: 'the ACELA goes to boston' }).pass, true)
  const r = score(checks, { answer: 'the Acela goes to Providence' })
  assert.equal(r.pass, false)
  assert.deepEqual(failedTypes(r), ['missing-entity'])
  assert.equal(r.results.length, 2) // one result per group
})

test('anyOfTimes: same matching, but counted as wrong-time', () => {
  const checks = { anyOfTimes: [['6:53', '5:44']] }
  assert.equal(score(checks, { answer: 'It leaves at 6:53 AM.' }).pass, true)
  const r = score(checks, { answer: 'It leaves at 8:00 AM.' })
  assert.equal(r.pass, false)
  assert.deepEqual(failedTypes(r), ['wrong-time'])
})

test('noneOf: fails when a forbidden string appears', () => {
  const checks = { noneOf: ['$', 'Hogwarts Express'] }
  assert.equal(score(checks, { answer: 'No pricing available.' }).pass, true)
  const r = score(checks, { answer: 'Tickets are $49.' })
  assert.equal(r.pass, false)
  assert.deepEqual(failedTypes(r), ['hallucinated-entity'])
})

test('refusalExpected: passes on a refusal, fails on a confident answer', () => {
  const checks = { refusalExpected: true }
  assert.equal(score(checks, { answer: "I can't find a station called Honolulu." }).pass, true)
  const r = score(checks, { answer: 'Take the Acela to Honolulu.' })
  assert.equal(r.pass, false)
  assert.deepEqual(failedTypes(r), ['missed-refusal'])
})

test('declineConstraint: same refusal test, also counted as missed-refusal', () => {
  const checks = { declineConstraint: true }
  assert.equal(score(checks, { answer: 'I cannot filter by duration.' }).pass, true)
  const r = score(checks, { answer: 'The fastest is 43 hours.' })
  assert.deepEqual(failedTypes(r), ['missed-refusal'])
})

test('noRefusal: the mirror image; a refusal fails it as wrong-refusal', () => {
  const checks = { noRefusal: true }
  assert.equal(score(checks, { answer: 'The first train leaves at 6:53.' }).pass, true)
  const r = score(checks, { answer: "I can't look up train times." })
  assert.equal(r.pass, false)
  assert.deepEqual(failedTypes(r), ['wrong-refusal'])
})

test('toolQueriesInclude: matches substrings of the queries Claude issued', () => {
  const checks = { toolQueriesInclude: ['chicago'] }
  const ok = { answer: 'x', toolCalls: [{ name: 'search_trains', query: 'Chicago Union' }] }
  assert.equal(score(checks, ok).pass, true)
  const r = score(checks, { answer: 'x', toolCalls: [{ name: 'search_trains', query: 'boston' }] })
  assert.equal(r.pass, false)
  assert.deepEqual(failedTypes(r), ['no-grounding'])
})

test('toolQueriesInclude: no tool calls at all fails', () => {
  assert.equal(score({ toolQueriesInclude: ['x'] }, { answer: 'x' }).pass, false)
  assert.equal(score({ toolQueriesInclude: ['x'] }, { answer: 'x', toolCalls: [] }).pass, false)
})

test('toolCalled: needs a toolCalls entry with that name', () => {
  const checks = { toolCalled: 'find_trains' }
  const ok = { answer: 'x', toolCalls: [{ name: 'search_trains' }, { name: 'find_trains' }] }
  assert.equal(score(checks, ok).pass, true)
  const r = score(checks, { answer: 'x', toolCalls: [{ name: 'search_trains', query: 'find_trains' }] })
  assert.equal(r.pass, false) // the QUERY text does not count, only the tool name
  assert.deepEqual(failedTypes(r), ['wrong-tool'])
  assert.equal(score(checks, { answer: 'x' }).pass, false) // toolCalls missing entirely
})

test('a case passes only if every check passes', () => {
  const checks = { anyOfGroups: [['Acela']], noneOf: ['Hogwarts'], toolQueriesInclude: ['acela'] }
  const response = { answer: 'The Acela.', toolCalls: [{ name: 'search_trains', query: 'acela' }] }
  assert.equal(score(checks, response).pass, true)
  const bad = score(checks, { answer: 'The Acela to Hogwarts.', toolCalls: [] })
  assert.equal(bad.pass, false)
  assert.deepEqual(failedTypes(bad).sort(), ['hallucinated-entity', 'no-grounding'])
})

test('every result carries the check key, a name, and a failure type', () => {
  const r = score(
    {
      anyOfGroups: [['a']],
      anyOfTimes: [['b']],
      noneOf: ['c'],
      refusalExpected: true,
      declineConstraint: true,
      noRefusal: true,
      toolQueriesInclude: ['d'],
      toolCalled: 'e',
    },
    { answer: '', toolCalls: [] },
  )
  for (const x of r.results) {
    assert.equal(typeof x.check, 'string')
    assert.equal(typeof x.name, 'string')
    assert.equal(typeof x.type, 'string', `${x.check} has no failure type`)
  }
})

test('missing answer is treated as an empty string, not a crash', () => {
  assert.doesNotThrow(() => score({ anyOfGroups: [['a']], refusalExpected: true }, {}))
})

test('REFUSAL_PATTERN_V1 and _LOOSE recognise the phrasings seen from the live model', () => {
  for (const s of [
    "I can't take a train there",
    'There is no matching Amtrak station',
    'Amtrak does not serve Honolulu',
    'That is not possible',
  ]) {
    assert.match(s, REFUSAL_PATTERN_V1)
    assert.match(s, REFUSAL_PATTERN_LOOSE)
  }
  assert.doesNotMatch('The Acela serves Boston and New York.', REFUSAL_PATTERN_V1)
  assert.doesNotMatch('The Acela serves Boston and New York.', REFUSAL_PATTERN_LOOSE)
})

test('RegExp entries in a group are tested as regexes (word boundaries work)', () => {
  const checks = { anyOfTimes: [[/\b[34]\s*(hours?|hrs?|h)(?![a-z])/i]] }
  assert.equal(score(checks, { answer: 'About 4 hours.' }).pass, true)
  assert.equal(score(checks, { answer: 'Roughly 3h 47m.' }).pass, true)
  assert.equal(score(checks, { answer: 'It takes 13h.' }).pass, false) // "3h" inside "13h"
  assert.equal(score(checks, { answer: 'It takes 13 hours.' }).pass, false)
  assert.equal(score(checks, { answer: 'It takes 3hrs' }).pass, true)
})

test('noRefusal: a correct answer with a holiday caveat is NOT a refusal', () => {
  const checks = { noRefusal: true }
  const caveat = "I can't account for holidays, so please confirm on amtrak.com."
  for (const answer of [
    `The first train is 66 at 5:44 AM Eastern. ${caveat}`,
    `Train 66 leaves at 5:44 AM. Holiday schedules aren't modelled, so check amtrak.com.`,
    'Train 66 leaves at 5:44 AM Eastern. I cannot account for holiday schedules, so please confirm on amtrak.com.',
    `The first train is 66 at 5:44 AM.\n${caveat}`,
  ]) {
    assert.equal(score(checks, { answer }).pass, true, answer)
  }
})

test('noRefusal: real refusals still fail, even when they mention holidays', () => {
  const checks = { noRefusal: true }
  for (const answer of [
    // The two QA examples: the refusal is IN the same sentence as the holiday words.
    "I can't look that up because holiday schedules are not modelled.",
    "I can't give you times, since holiday schedules aren't modelled.",
    "I can't look up train schedules.",
    "I can't find a direct train. I also can't account for holidays.",
    'There is no matching Amtrak station. Holiday schedules are not modelled.',
    "I cannot give times. Please check amtrak.com.",
  ]) {
    const r = score(checks, { answer })
    assert.equal(r.pass, false, answer)
    assert.deepEqual(failedTypes(r), ['wrong-refusal'])
  }
})

test('holiday caveats do not rescue refusalExpected: only noRefusal ignores them', () => {
  // A case that EXPECTS a refusal reads the whole answer as before.
  assert.equal(score({ refusalExpected: true }, { answer: "I can't account for holidays." }).pass, true)
})

test('withoutHolidayCaveats cuts only the caveat clause, so other refusal wording survives', () => {
  assert.equal(
    withoutHolidayCaveats("Train 66 leaves at 5:44 AM. I can't account for holidays. Confirm on amtrak.com."),
    'Train 66 leaves at 5:44 AM. I . Confirm on amtrak.com.',
  )
  assert.equal(
    withoutHolidayCaveats("I can't look that up because holiday schedules are not modelled."),
    "I can't look that up because .",
  )
  assert.equal(withoutHolidayCaveats('No caveat here.'), 'No caveat here.')
  assert.equal(withoutHolidayCaveats(''), '')
})

// ---- scorer v2: plural refusals and scope disclaimers ----------------------

const ANCHORAGE_ANSWER =
  'There are no trains from Seattle to Anchorage. I searched for Anchorage and found no station or route ' +
  'with that name in the Amtrak data.'
const WEEKEND_ANSWER =
  'Friday: Keystone 643 leaves New York Penn at 5:20 PM Eastern and arrives in Philadelphia at 7:05 PM. ' +
  'Sunday: Acela 2250 leaves Philadelphia at 6:00 PM, so you get about 47 hours there. ' +
  "Holiday schedules are not modelled, so please confirm on amtrak.com. I can't see fares or seat availability."

test('SCORER_VERSION is 4 (toolInputHas, for the prompt-v6 next-train case)', () => {
  assert.equal(SCORER_VERSION, 4)
})

// Scorer 3. The real prompt-v5 answer to cardinal-no-boarding-was-nyc: a
// correct, grounded refusal that says no three ways, none of which scorer v2
// recognised (eval run 2026-10-26, the single failure in 40/41).
const CARDINAL_V5_ANSWER =
  'No. The Cardinal (train 50) stops at both Washington Union Station and New York Penn Station, ' +
  "but it doesn't allow boarding at Washington. The schedule data says this applies on any date, " +
  'and it found no usable Cardinal from Washington to New York. The Cardinal does run the other ' +
  "way, from New York toward Washington. I can check other direct trains from Washington to New " +
  "York if you'd like.\n\nHoliday schedules are not modelled, so please confirm on amtrak.com."

test('refusalExpected: the real cardinal-no-boarding-was-nyc v5 answer passes (scorer 3)', () => {
  // v2 missed it; the three new phrasings are what catch it.
  assert.doesNotMatch(CARDINAL_V5_ANSWER, REFUSAL_PATTERN_LOOSE)
  assert.match(CARDINAL_V5_ANSWER, REFUSAL_PATTERN_EXPECT)
  assert.equal(score({ refusalExpected: true }, { answer: CARDINAL_V5_ANSWER }).pass, true)
})

// The structural guarantee behind scorer 3: the new phrasings live in a pattern
// that noRefusal never reads, so widening "must refuse" cannot make the
// "must NOT refuse" direction stricter. A correct answer that happens to open
// with "No." or mention a boarding restriction still passes noRefusal.
test('noRefusal is unaffected by the scorer-3 phrasings', () => {
  const answers = [
    'No. Train 86 leaves New York Penn at 6:00 AM Eastern and arrives at 10:05 AM.',
    "Train 50 doesn't allow boarding at Washington, but Northeast Regional 158 leaves at 7:20 AM.",
  ]
  for (const answer of answers) {
    assert.match(answer, REFUSAL_PATTERN_EXPECT) // the refuse direction sees it
    assert.doesNotMatch(answer, REFUSAL_PATTERN_V1) // noRefusal's pattern does not
    assert.equal(score({ noRefusal: true }, { answer }).pass, true)
  }
})

test('refusalExpected: the real anchorage-refusal answer passes (plural "no trains")', () => {
  assert.match(ANCHORAGE_ANSWER, REFUSAL_PATTERN_LOOSE)
  assert.equal(score({ refusalExpected: true }, { answer: ANCHORAGE_ANSWER }).pass, true)
})

test('REFUSAL_PATTERN_LOOSE accepts plurals; the narrow V1 pattern does not (so noRefusal stays v1-like)', () => {
  for (const s of [
    'No trains run there.',
    'There are no routes to Paris.',
    'I found no stations by that name.',
    'No direct trains go there.',
    "I'm unable to find that.",
    "I'm not able to look that up.",
    "I couldn't find a station by that name.",
    "That route isn't served by Amtrak.",
  ]) {
    assert.match(s, REFUSAL_PATTERN_LOOSE)
  }
  for (const s of [
    'No trains run there.',
    'There are no routes to Paris.',
    'No direct trains go there.',
  ]) {
    assert.doesNotMatch(s, REFUSAL_PATTERN_V1)
  }
  for (const s of [
    'Three trains run each day, and the route is served by the Acela.',
    'Amtrak trains serve Boston and New York.',
    'The station is open daily.',
    'The last train leaves at 9:30 PM; there are no trains after 11 PM.',
    'There are no stations between New York and Boston other than NHV.',
  ]) {
    assert.doesNotMatch(s, REFUSAL_PATTERN_LOOSE)
  }
})

test('noRefusal: the real weekend-generic-philadelphia answer passes (scope disclaimer)', () => {
  assert.equal(score({ noRefusal: true }, { answer: WEEKEND_ANSWER }).pass, true)
})

test('noRefusal: scope disclaimers about fares, seats, delays, booking, connections pass', () => {
  for (const tail of [
    "I can't see fares or seat availability.",
    'I cannot book tickets or show live delays.',
    "I can't see fares, seat availability, or real-time delays.",
    "I don't have fare information or live delay info.",
    "I can't make reservations, but you can book on amtrak.com.",
    "Direct trains only, so I can't show connections.",
    "I can't tell you anything about fares.",
  ]) {
    const answer = `Train 66 leaves at 5:44 AM Eastern. ${tail}`
    assert.equal(score({ noRefusal: true }, { answer }).pass, true, tail)
  }
})

test('noRefusal: a real refusal still fails when a fare disclaimer is attached', () => {
  for (const answer of [
    WEEKEND_ANSWER.replace(/^.*Holiday/, 'Holiday').replace('Holiday', "I can't look that up. Holiday"),
    "I can't look that up, and I can't see fares.",
    "I can't give you times, and I can't see fares or seat availability.",
    "I can't see fares, and there is no matching Amtrak station.",
    "I can't see fares or give you any times.",
    "I can't see fares, delays, or times.",
    "I can't see fares or the schedule.",
    "I can't see connections between Boston and Paris.",
    "I can't find fares or trains.",
    "I can't check availability of trains on that route.",
    "I can't check seat availability of trains from Boston to Paris.",
    "I can't find any connections from Boston to Anchorage.",
    'There are no trains from Boston to Anchorage. Fares are not available.',
    'There are no direct trains. I can\'t see fares.',
    "I don't have schedule data for that. Fares are not available either.",
    // bare "X are not available" sentences are not cut, as in v1
    'Fares and booking are not available through this tool.',
  ]) {
    const r = score({ noRefusal: true }, { answer })
    assert.equal(r.pass, false, answer)
    assert.deepEqual(failedTypes(r), ['wrong-refusal'])
  }
})

test('withoutScopeDisclaimers cuts only the disclaimer clause', () => {
  assert.equal(withoutScopeDisclaimers("I can't see fares or seat availability."), 'I .')
  assert.equal(
    withoutScopeDisclaimers("I can't look that up, and I can't see fares."),
    "I can't look that up, and I .",
  )
  assert.equal(withoutScopeDisclaimers("I can't see fares or give times."), "I can't see fares or give times.")
  assert.equal(withoutScopeDisclaimers('No disclaimer here.'), 'No disclaimer here.')
  assert.equal(withoutScopeDisclaimers(''), '')
})

test('scope disclaimers do not rescue refusalExpected or declineConstraint', () => {
  assert.equal(score({ refusalExpected: true }, { answer: "I can't see fares." }).pass, true)
  assert.equal(score({ declineConstraint: true }, { answer: 'No fares are shown.' }).pass, false)
})

test('toolInputHas: passes only when that tool sent the field, well-formed', () => {
  const checks = { toolInputHas: { tool: 'find_trains', field: 'departAfter', matches: '^\\d{1,2}:\\d{2}$' } }
  const run = (toolCalls) => scoreCase({ checks }, { answer: 'x', toolCalls }).pass
  assert.equal(run([{ name: 'find_trains', input: { from: 'NYP', to: 'BOS', departAfter: '12:25' } }]), true)
  assert.equal(run([{ name: 'find_trains', input: { from: 'NYP', to: 'BOS' } }]), false, 'no departAfter')
  assert.equal(run([{ name: 'find_trains', input: { departAfter: '' } }]), false, 'empty')
  assert.equal(run([{ name: 'find_trains', input: { departAfter: 'noon' } }]), false, 'not HH:MM')
  assert.equal(run([{ name: 'plan_weekend', input: { departAfter: '12:25' } }]), false, 'wrong tool')
  assert.equal(run([{ name: 'find_trains' }]), false, 'no input recorded')
  assert.equal(run([]), false)
  // Any one matching call is enough (the model may call find_trains twice).
  assert.equal(run([{ name: 'find_trains', input: {} }, { name: 'find_trains', input: { departAfter: '9:05' } }]), true)
})

test('toolInputHas: a miss is counted as ignored-time', () => {
  const out = scoreCase({ checks: { toolInputHas: { tool: 'find_trains', field: 'departAfter' } } }, { answer: '', toolCalls: [] })
  assert.equal(out.results[0].type, 'ignored-time')
})
