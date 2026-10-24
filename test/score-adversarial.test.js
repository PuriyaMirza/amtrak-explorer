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
