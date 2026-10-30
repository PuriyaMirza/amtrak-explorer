import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CASES } from '../eval/cases.js'
import { FAILURE_TYPES } from '../eval/taxonomy.js'
import { scoreCase } from '../eval/score.js'

// These guard the case list itself: a typo'd check name in cases.js would
// otherwise be silently ignored by the scorer (and the case would pass).

test('there are exactly 42 cases with unique ids', () => {
  assert.equal(CASES.length, 42)
  assert.equal(new Set(CASES.map((c) => c.id)).size, 42)
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
    if (k.toolInputHas) {
      const { tool, field, matches } = k.toolInputHas
      assert.ok(typeof tool === 'string' && typeof field === 'string', `${c.id}.toolInputHas`)
      if (matches !== undefined) new RegExp(matches) // throws on a bad pattern
    }
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

test('PR 3 flips: duration-constraint now expects a real answer from find_trains', () => {
  const c = CASES.find((c) => c.id === 'duration-constraint')
  assert.equal(c.checks.declineConstraint, undefined)
  assert.equal(c.checks.noRefusal, true)
  assert.equal(c.checks.toolCalled, 'find_trains')
  const calls = [{ name: 'find_trains', input: { from: 'CHI', to: 'LAX' } }]
  const good = {
    answer: 'The Southwest Chief is fastest at 43h 57m. I cannot account for holidays, so confirm on amtrak.com.',
    toolCalls: calls,
  }
  assert.equal(scoreCase(c, good).pass, true)
  // The v1 behaviour (decline, no tool) now fails.
  const old = { answer: "I can't filter by duration, but the Southwest Chief connects them.", toolCalls: [{ name: 'search_trains', query: 'chicago' }] }
  assert.equal(scoreCase(c, old).pass, false)
})

test('first-train-on-Thursday cases expect train 66 at 5:44 (physical day), not 6:53', () => {
  const c = CASES.find((c) => c.id === 'first-train-nyc-boston-thursday-date')
  const calls = [{ name: 'find_trains' }]
  assert.equal(scoreCase(c, { answer: 'Train 66 at 5:44 AM Eastern. Confirm holidays on amtrak.com.', toolCalls: calls }).pass, true)
  assert.equal(scoreCase(c, { answer: 'Train 1150 at 6:53 AM.', toolCalls: calls }).pass, false)
})

test('a correct schedule answer passes noRefusal despite the required holiday caveat', () => {
  const c = CASES.find((c) => c.id === 'last-train-nyc-boston-thursday-date')
  const answer = "The last Thursday train is 1168 at 7:00 PM Eastern. I can't account for holiday schedules, so confirm on amtrak.com."
  assert.equal(scoreCase(c, { answer, toolCalls: [{ name: 'find_trains' }] }).pass, true)
})

test('PR 4: both weekend cases require plan_weekend; the dated one pins the outbound trains only', () => {
  const dated = CASES.find((c) => c.id === 'weekend-friday-evening-philadelphia-date')
  const generic = CASES.find((c) => c.id === 'weekend-generic-philadelphia')
  assert.equal(dated.checks.toolCalled, 'plan_weekend')
  assert.equal(generic.checks.toolCalled, 'plan_weekend')
  assert.equal(generic.checks.noRefusal, true)

  const calls = [{ name: 'plan_weekend' }]
  const good = 'Take the 7:10 PM Northeast Regional 1107 out and come back any time Sunday. Confirm holidays on amtrak.com.'
  assert.equal(scoreCase(dated, { answer: good, toolCalls: calls }).pass, true)
  // No outbound train named: fails.
  assert.equal(scoreCase(dated, { answer: 'Several trains run on Sunday.', toolCalls: calls }).pass, false)
  // Right answer but from the wrong tool: fails.
  assert.equal(scoreCase(dated, { answer: good, toolCalls: [{ name: 'find_trains' }] }).pass, false)
})
