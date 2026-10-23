import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CASES } from '../eval/cases.js'
import { FAILURE_TYPES } from '../eval/taxonomy.js'
import { scoreCase } from '../eval/score.js'

// These guard the case list itself: a typo'd check name in cases.js would
// otherwise be silently ignored by the scorer (and the case would pass).

test('there are exactly 40 cases with unique ids', () => {
  assert.equal(CASES.length, 40)
  assert.equal(new Set(CASES.map((c) => c.id)).size, 40)
})

test('categories are the four documented ones, schedule has at least 10', () => {
  const counts = {}
  for (const c of CASES) counts[c.category] = (counts[c.category] || 0) + 1
  assert.deepEqual(Object.keys(counts).sort(), ['adversarial', 'ambiguous', 'easy', 'schedule'])
  assert.ok(counts.schedule >= 10, `only ${counts.schedule} schedule cases`)
})

test('the original 9 cases are still present, first, and in order', () => {
  assert.deepEqual(
    CASES.slice(0, 9).map((c) => c.id),
    [
      'chicago-routes-through', 'los-angeles-routes', 'acela-stations',
      'new-york-naming-quirk', 'washington-town-vs-dc', 'portland-or-vs-me',
      'duration-constraint', 'honolulu-refusal', 'nonexistent-station',
    ],
  )
})

test('every case has a question, and every check key is one the scorer knows', () => {
  const known = new Set(Object.keys(FAILURE_TYPES))
  for (const c of CASES) {
    assert.equal(typeof c.question, 'string', c.id)
    assert.ok(c.question.length > 0 && c.question.length <= 500, `${c.id}: bad question length`)
    assert.ok(c.checks && Object.keys(c.checks).length > 0, `${c.id}: no checks`)
    for (const key of Object.keys(c.checks)) {
      assert.ok(known.has(key), `${c.id}: unknown check "${key}"`)
    }
  }
})

test('check values have the right shape', () => {
  for (const c of CASES) {
    const k = c.checks
    for (const key of ['anyOfGroups', 'anyOfTimes']) {
      if (k[key]) {
        assert.ok(Array.isArray(k[key]) && k[key].every((g) => Array.isArray(g) && g.length > 0), `${c.id}.${key}`)
      }
    }
    for (const key of ['noneOf', 'toolQueriesInclude']) {
      if (k[key]) assert.ok(Array.isArray(k[key]) && k[key].length > 0, `${c.id}.${key}`)
    }
    if (k.toolCalled) assert.equal(typeof k.toolCalled, 'string', `${c.id}.toolCalled`)
    for (const key of ['refusalExpected', 'declineConstraint', 'noRefusal']) {
      if (key in k) assert.equal(k[key], true, `${c.id}.${key}`)
    }
  }
})

test('schedule cases fail against a baseline-style answer (that is their purpose)', () => {
  // What the app says today: it declines, and only ever calls search_trains.
  const baseline = {
    answer: "I can't look up train schedules, times or durations.",
    toolCalls: [{ name: 'search_trains', query: 'boston' }],
  }
  const schedule = CASES.filter((c) => c.category === 'schedule')
  assert.ok(schedule.length >= 10)
  for (const c of schedule) {
    assert.equal(scoreCase(c, baseline).pass, false, `${c.id} would already pass at baseline`)
  }
})

test('ticket-price needs a no-fare-data statement, not just the absence of "$"', () => {
  const c = CASES.find((c) => c.id === 'ticket-price')
  const say = (answer) => scoreCase(c, { answer, toolCalls: [] }).pass
  assert.equal(say("I don't have fare or pricing information."), true)
  assert.equal(say('The Acela is a fast train between the two cities.'), false) // silent dodge
  assert.equal(say("I can't see prices, but it might be about 50 dollars."), false)
  assert.equal(say('It costs $49.'), false)
})

test('cardinal case fails an answer that says yes', () => {
  const c = CASES.find((c) => c.id === 'cardinal-no-boarding-was-nyc')
  const baseline = { toolCalls: [{ name: 'find_trains' }] }
  assert.equal(scoreCase(c, { ...baseline, answer: 'Yes, take Cardinal 50 from Washington.' }).pass, false)
  assert.equal(scoreCase(c, { ...baseline, answer: "No: you can't board the Cardinal at Washington going to New York." }).pass, true)
})
