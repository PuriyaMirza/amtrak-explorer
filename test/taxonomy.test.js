import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FAILURE_TYPES,
  FAILURE_TYPE_DESCRIPTIONS,
  failureTypeOf,
  countFailures,
} from '../eval/taxonomy.js'

test('each check key maps to the documented failure type', () => {
  assert.deepEqual(FAILURE_TYPES, {
    anyOfGroups: 'missing-entity',
    anyOfTimes: 'wrong-time',
    noneOf: 'hallucinated-entity',
    refusalExpected: 'missed-refusal',
    declineConstraint: 'missed-refusal',
    noRefusal: 'wrong-refusal',
    toolQueriesInclude: 'no-grounding',
    toolCalled: 'wrong-tool',
    toolInputHas: 'ignored-time',
    request: 'request-error',
  })
})

test('every failure type used has a description (so RESULTS.md can explain it)', () => {
  for (const type of new Set(Object.values(FAILURE_TYPES))) {
    assert.ok(FAILURE_TYPE_DESCRIPTIONS[type], `no description for ${type}`)
  }
})

test('failureTypeOf looks a check key up', () => {
  assert.equal(failureTypeOf('noRefusal'), 'wrong-refusal')
  assert.equal(failureTypeOf('nonsense'), undefined)
})

test('countFailures counts failed checks by type, most common first', () => {
  const outcomes = [
    { pass: false, results: [
      { pass: false, type: 'no-grounding' },
      { pass: true, type: 'missing-entity' },
      { pass: false, type: 'wrong-time' },
    ] },
    { pass: false, results: [{ pass: false, type: 'wrong-time' }] },
    { pass: true, results: [{ pass: true, type: 'noneOf' }] },
    { pass: false, results: [{ pass: false, type: 'request-error' }] },
  ]
  const counts = countFailures(outcomes)
  assert.deepEqual(counts, { 'wrong-time': 2, 'no-grounding': 1, 'request-error': 1 })
  assert.deepEqual(Object.keys(counts), ['wrong-time', 'no-grounding', 'request-error'])
})

test('countFailures on an all-pass run is empty', () => {
  assert.deepEqual(countFailures([{ pass: true, results: [{ pass: true, type: 'x' }] }]), {})
})
