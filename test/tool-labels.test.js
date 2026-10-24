import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatToolCall } from '../tool-labels.js'

test('search_trains: shows the query', () => {
  const call = { name: 'search_trains', input: { query: 'boston' }, query: 'boston' }
  assert.equal(formatToolCall(call), 'Searched for "boston"')
})

test('find_trains: stations and date, never "undefined"', () => {
  const call = { name: 'find_trains', input: { from: 'NYP', to: 'BOS', date: '2026-10-29' } }
  assert.equal(formatToolCall(call), 'Looked up trains NYP → BOS, 2026-10-29')
})

test('find_trains: weekday and filters', () => {
  const call = {
    name: 'find_trains',
    input: { from: 'New York', to: 'Philadelphia', weekday: 'friday', departAfter: '18:00', route: 'Acela' },
  }
  assert.equal(
    formatToolCall(call),
    'Looked up trains New York → Philadelphia, next Friday, after 18:00, route Acela',
  )
})

test('plan_weekend: stations and both days', () => {
  const call = { name: 'plan_weekend', input: { from: 'NYP', to: 'PHL', outDay: 'friday', returnDate: '2026-11-01' } }
  assert.equal(formatToolCall(call), 'Planned a round trip NYP ⇄ PHL, out next Friday, back 2026-11-01')
})

test('a failed tool call is marked', () => {
  const call = { name: 'find_trains', input: { from: 'XYZ', to: 'BOS' }, error: 'Unknown station' }
  assert.equal(formatToolCall(call), 'Looked up trains XYZ → BOS (failed)')
})

test('unknown tool or missing input: still no "undefined"', () => {
  assert.equal(formatToolCall({ name: 'weather' }), 'Used weather')
  assert.equal(formatToolCall({ name: 'find_trains' }), 'Looked up trains ? → ?')
  for (const name of ['search_trains', 'find_trains', 'plan_weekend', 'other']) {
    assert.doesNotMatch(formatToolCall({ name }), /undefined/)
  }
})
