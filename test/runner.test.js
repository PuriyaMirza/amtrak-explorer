import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseMode, runCases } from '../eval/runner.js'

test('chooseMode: ASK_URL wins, then local, else null', () => {
  assert.equal(chooseMode({ ASK_URL: 'http://x' }), 'remote')
  assert.equal(chooseMode({ ASK_URL: 'http://x', DATABASE_URL: 'd', ANTHROPIC_API_KEY: 'k' }), 'remote')
  assert.equal(chooseMode({ DATABASE_URL: 'd', ANTHROPIC_API_KEY: 'k' }), 'local')
  assert.equal(chooseMode({ DATABASE_URL: 'd' }), null)
  assert.equal(chooseMode({ ANTHROPIC_API_KEY: 'k' }), null)
  assert.equal(chooseMode({}), null)
})

const cases = [
  { id: 'good', category: 'easy', question: 'q-good', checks: { anyOfGroups: [['Acela']] } },
  { id: 'bad', category: 'schedule', question: 'q-bad', checks: { noRefusal: true, toolCalled: 'find_trains' } },
  { id: 'boom', category: 'easy', question: 'q-boom', checks: { anyOfGroups: [['x']] } },
]

// A fake `ask`: answers by question, one of them throws.
async function fakeAsk(question) {
  if (question === 'q-good') return { answer: 'The Acela.', toolCalls: [] }
  if (question === 'q-bad') return { answer: "I can't look up schedules.", toolCalls: [] }
  throw new Error('HTTP 401')
}

test('runCases scores each case, survives a throwing ask, and tallies the taxonomy', async () => {
  const seen = []
  const { outcomes, taxonomy } = await runCases(cases, fakeAsk, { onOutcome: (o) => seen.push(o.caseDef.id) })

  assert.deepEqual(seen, ['good', 'bad', 'boom'])
  assert.deepEqual(outcomes.map((o) => o.pass), [true, false, false])

  const boom = outcomes[2]
  assert.equal(boom.error, 'HTTP 401')
  assert.equal(boom.results[0].type, 'request-error')

  assert.deepEqual(taxonomy, { 'request-error': 1, 'wrong-refusal': 1, 'wrong-tool': 1 })
})

test('runCases keeps the raw response so the runner can read model/promptVersion', async () => {
  const { outcomes } = await runCases([cases[0]], async () => ({
    answer: 'The Acela.',
    toolCalls: [],
    model: 'm',
    promptVersion: 'v9',
  }))
  assert.equal(outcomes[0].response.promptVersion, 'v9')
})
