import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreCase, REFUSAL_PATTERN, withoutHolidayCaveats } from '../eval/score.js'

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

test('REFUSAL_PATTERN recognises the phrasings seen from the live model', () => {
  for (const s of [
    "I can't take a train there",
    'There is no matching Amtrak station',
    'Amtrak does not serve Honolulu',
    'That is not possible',
  ]) {
    assert.match(s, REFUSAL_PATTERN)
  }
  assert.doesNotMatch('The Acela serves Boston and New York.', REFUSAL_PATTERN)
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
