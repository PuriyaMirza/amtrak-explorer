import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeToolCall } from '../tool-summary.js'

const matched = (stop_id) => ({ input: stop_id, status: 'matched', stop_id, name: stop_id })

test('search_trains shows the query', () => {
  assert.equal(
    describeToolCall({ name: 'search_trains', input: { query: 'chicago' }, query: 'chicago' }),
    'Searched for "chicago"',
  )
})

test('find_trains uses the resolved stations and date', () => {
  const call = {
    name: 'find_trains',
    input: { from: 'New York', to: 'Boston', weekday: 'thursday' },
    result: { from: matched('NYP'), to: matched('BOS'), date: '2026-10-29' },
  }
  assert.equal(describeToolCall(call), 'Looked up trains NYP → BOS, Thu 2026-10-29')
})

test('find_trains falls back to the input when the tool failed', () => {
  const call = { name: 'find_trains', input: { from: 'NYP', to: 'BOS', weekday: 'friday' }, error: 'boom' }
  assert.equal(describeToolCall(call), 'Looked up trains NYP → BOS, next friday (failed)')
})

test('find_trains keeps the typed name for an ambiguous station', () => {
  const call = {
    name: 'find_trains',
    input: { from: 'NYP', to: 'Washington' },
    result: { from: matched('NYP'), to: { input: 'Washington', status: 'ambiguous', candidates: [] }, date: '2026-10-24' },
  }
  assert.equal(describeToolCall(call), 'Looked up trains NYP → Washington, Sat 2026-10-24')
})

test('plan_weekend shows both days', () => {
  const call = {
    name: 'plan_weekend',
    input: { from: 'NYP', to: 'Philadelphia' },
    result: { from: matched('NYP'), to: matched('PHL'), outDate: '2026-10-30', returnDate: '2026-11-01' },
  }
  assert.equal(describeToolCall(call), 'Planned a round trip NYP ⇄ PHL, Fri 2026-10-30 – Sun 2026-11-01')
})

test('never prints "undefined", whatever the shape', () => {
  for (const call of [
    { name: 'search_trains', input: {} },
    { name: 'find_trains', input: {} },
    { name: 'plan_weekend' },
    { name: 'some_new_tool' },
    {},
    null,
  ]) {
    assert.doesNotMatch(describeToolCall(call), /undefined/)
  }
})
