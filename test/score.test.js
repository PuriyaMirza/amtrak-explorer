import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreCase, REFUSAL_PATTERN } from '../eval/score.js'

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
