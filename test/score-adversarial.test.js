// Runs every fixture in test/fixtures/scorer-adversarial.js through scoreCase.
// A fixture's `pass` is the scorer's CURRENT behavior, including the
// knownLimitation ones (documented gaps), so any scorer change that flips a
// result shows up here and has to be a deliberate decision.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreCase } from '../eval/score.js'
import { SCORER_ADVERSARIAL_FIXTURES } from './fixtures/scorer-adversarial.js'

for (const f of SCORER_ADVERSARIAL_FIXTURES) {
  const tag = f.knownLimitation ? 'known limitation' : 'ok'
  test(`adversarial [${f.check}] (${tag}): ${f.answer.slice(0, 70)}`, () => {
    const r = scoreCase({ checks: { [f.check]: true } }, { answer: f.answer, toolCalls: [] })
    assert.equal(r.pass, f.pass, f.note)
  })
}

test('adversarial fixtures: knownLimitation entries carry an ideal result that differs from today', () => {
  for (const f of SCORER_ADVERSARIAL_FIXTURES.filter((x) => x.knownLimitation)) {
    assert.equal(typeof f.ideal, 'boolean', f.answer)
    assert.notEqual(f.ideal, f.pass, f.answer)
  }
  assert.ok(SCORER_ADVERSARIAL_FIXTURES.length >= 70)
})

// The regression guard: v2 must never be wrong where v1 was right. "Right"
// means matching QA's expectation (`pass` for ordinary fixtures, `ideal` for
// knownLimitation ones). Scores each fixture with the frozen v1 scorer too.
import { scoreCase as scoreV1 } from './fixtures/score-v1.js'

test('v2 is never wrong where v1 was right (all fixtures)', () => {
  const tally = { bothRight: 0, fixed: 0, regressed: [], bothWrong: 0 }
  for (const f of SCORER_ADVERSARIAL_FIXTURES) {
    const want = f.knownLimitation ? f.ideal : f.pass
    const input = { answer: f.answer, toolCalls: [] }
    const checks = { checks: { [f.check]: true } }
    const v1Right = scoreV1(checks, input).pass === want
    const v2Right = scoreCase(checks, input).pass === want
    if (v1Right && !v2Right) tally.regressed.push(f.answer)
    else if (v1Right) tally.bothRight++
    else if (v2Right) tally.fixed++
    else tally.bothWrong++
  }
  assert.deepEqual(tally.regressed, [], 'v2 regressed on these answers')
  // Every documented limitation is one v1 had too (nothing v2 broke is hidden there).
  assert.equal(tally.bothWrong, SCORER_ADVERSARIAL_FIXTURES.filter((f) => f.knownLimitation).length)
})
