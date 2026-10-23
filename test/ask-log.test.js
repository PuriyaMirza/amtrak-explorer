import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../api/ask.js'
import { buildAskMetadata, logAsk, UNKNOWN_ID } from '../ask-log.js'
import { INSERTABLE_COLUMNS } from '../event-store.js'
import { MODEL, PROMPT_VERSION } from '../ask-core.js'
import { mockRes, fakeAnthropic, fakeSql, toolUseResponse, toolUseFor, textResponse } from './helpers.js'

const STATIONS = [{ stop_id: 'BOS', stop_name: 'Boston', stop_timezone: 'America/New_York', routes: ['Acela'] }]

// The inserted row as an object keyed by column name.
function rowOf(insert) {
  return Object.fromEntries(INSERTABLE_COLUMNS.map((c, i) => [c, insert.params[i]]))
}

// Silence console.error for tests that expect a logged failure.
async function quietly(fn) {
  const real = console.error
  const seen = []
  console.error = (...args) => seen.push(args)
  try { return await fn(seen) } finally { console.error = real }
}

test('success: logs one ask row with the documented metadata shape', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston'), textResponse('The Acela serves Boston.')])
  const sql = fakeSql({ stations: STATIONS })
  const ask = createHandler({ makeClients: () => ({ anthropic, sql }) })
  const res = mockRes()
  await ask({ method: 'POST', body: { question: 'What serves Boston?', device_id: 'dev1', session_id: 'ses1' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(sql.inserts.length, 1)
  const row = rowOf(sql.inserts[0])
  assert.equal(row.event_type, 'ask')
  assert.equal(row.query_text, 'What serves Boston?')
  assert.equal(row.device_id, 'dev1')
  assert.equal(row.session_id, 'ses1')

  const m = row.metadata
  assert.equal(m.answer, 'The Acela serves Boston.')
  assert.deepEqual(m.tool_calls, [{ name: 'search_trains', input: { query: 'boston' }, row_count: 1 }])
  assert.equal(m.rounds, 2)
  assert.equal(m.input_tokens, 250)
  assert.equal(m.output_tokens, 50)
  assert.equal(m.model, MODEL)
  assert.equal(m.prompt_version, PROMPT_VERSION)
  assert.equal(typeof m.latency_ms, 'number')
  assert.ok(!('error' in m))
  // Full tool result rows must not be stored.
  assert.ok(!JSON.stringify(m).includes('stop_timezone'))
})

test('missing or bad ids fall back to the placeholder (the table requires them)', async () => {
  const anthropic = fakeAnthropic([textResponse('hi')])
  const sql = fakeSql()
  const ask = createHandler({ makeClients: () => ({ anthropic, sql }) })
  await ask({ method: 'POST', body: { question: 'hello', device_id: 42, session_id: 'x'.repeat(101) } }, mockRes())
  const row = rowOf(sql.inserts[0])
  assert.equal(row.device_id, UNKNOWN_ID)
  assert.equal(row.session_id, UNKNOWN_ID)
})

test('askQuestion error: logs an ask row with metadata.error, still returns 500', async () => {
  const anthropic = fakeAnthropic([]) // first create() throws "no more responses"
  const sql = fakeSql()
  const ask = createHandler({ makeClients: () => ({ anthropic, sql }) })
  const res = mockRes()
  await quietly(() => ask({ method: 'POST', body: { question: 'hi', device_id: 'd', session_id: 's' } }, res))

  assert.equal(res.statusCode, 500)
  assert.equal(sql.inserts.length, 1)
  const row = rowOf(sql.inserts[0])
  assert.equal(row.event_type, 'ask')
  assert.equal(row.query_text, 'hi')
  assert.match(row.metadata.error, /no more responses/)
  assert.equal(typeof row.metadata.latency_ms, 'number')
  assert.ok(!('answer' in row.metadata))
})

test('a logging failure does not break the 200 response', async () => {
  const anthropic = fakeAnthropic([textResponse('Fine.')])
  const sql = fakeSql({ insertFail: 'db down' })
  const ask = createHandler({ makeClients: () => ({ anthropic, sql }) })
  const res = mockRes()
  await quietly(async (seen) => {
    await ask({ method: 'POST', body: { question: 'hi' } }, res)
    assert.equal(seen.length, 1) // the failure was reported to the server log
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.answer, 'Fine.')
})

test('a logging failure does not turn an ask error into anything but the original 500', async () => {
  const anthropic = fakeAnthropic([])
  const sql = fakeSql({ insertFail: 'db down' })
  const ask = createHandler({ makeClients: () => ({ anthropic, sql }) })
  const res = mockRes()
  await quietly(() => ask({ method: 'POST', body: { question: 'hi' } }, res))
  assert.equal(res.statusCode, 500)
  assert.match(res.body.error, /no more responses/)
})

test('a hanging insert is abandoned after the timeout', async () => {
  const sql = { query: () => new Promise(() => {}) } // never resolves
  const started = Date.now()
  await quietly(() => logAsk(sql, { question: 'q', latencyMs: 1 }, { timeoutMs: 20 }))
  assert.ok(Date.now() - started < 1000)
})

test('invalid requests are not logged', async () => {
  const sql = fakeSql()
  const ask = createHandler({ makeClients: () => ({ anthropic: fakeAnthropic([]), sql }) })
  await ask({ method: 'POST', body: {} }, mockRes())
  assert.equal(sql.inserts.length, 0)
})

test('buildAskMetadata: tool error and failed-ask shapes', () => {
  const m = buildAskMetadata({
    result: {
      answer: 'a', rounds: 1, usage: { input_tokens: 1, output_tokens: 2 }, model: 'm', promptVersion: 'v',
      toolCalls: [{ name: 'search_trains', query: 'x', error: 'boom' }],
    },
    latencyMs: 5,
  })
  assert.deepEqual(m.tool_calls, [{ name: 'search_trains', input: { query: 'x' }, error: 'boom' }])
  assert.deepEqual(buildAskMetadata({ error: 'bad', latencyMs: 7 }), { latency_ms: 7, error: 'bad' })
})

test('a find_trains call logs its full input and its row_count (not search_trains\' shape)', async () => {
  const input = { from: 'New York', to: 'BOS', date: '2026-10-29', departAfter: '05:00' }
  const anthropic = fakeAnthropic([toolUseFor('find_trains', input), textResponse('Train 66 at 5:44 AM.')])
  const hms = (h, m) => h * 3600 + m * 60
  const days = { sunday: 0, monday: 0, tuesday: 0, wednesday: 1, thursday: 1, friday: 0, saturday: 0 }
  const legs = {
    'NYP>BOS': [
      { train: '66', route: 'Northeast Regional', dep_secs: hms(29, 44), arr_secs: hms(34, 5), can_board: true, can_alight: true, ...days, start_date: 20260906, end_date: 20270906 },
      { train: '1150', route: 'Northeast Regional', dep_secs: hms(6, 53), arr_secs: hms(11, 7), can_board: true, can_alight: true, ...days, start_date: 20260906, end_date: 20270906 },
    ],
  }
  const stops = [
    { stop_id: 'NYP', stop_name: 'Ny Moynihan Train Hall At Penn Station', stop_timezone: 'America/New_York' },
    { stop_id: 'BOS', stop_name: 'Boston', stop_timezone: 'America/New_York' },
  ]
  const sql = fakeSql({ stops, legs })
  const ask = createHandler({ makeClients: () => ({ anthropic, sql }) })
  await ask({ method: 'POST', body: { question: 'First train?', device_id: 'd', session_id: 's' } }, mockRes())

  const m = rowOf(sql.inserts[0]).metadata
  // Full input object, and the number of trains the model was shown.
  assert.deepEqual(m.tool_calls, [{ name: 'find_trains', input, row_count: 2 }])
  // No train rows are stored.
  assert.ok(!JSON.stringify(m).includes('Northeast Regional'))
})

test('a failed find_trains call logs its input and the error', () => {
  const m = buildAskMetadata({
    result: {
      answer: 'x', rounds: 2, model: 'm', promptVersion: 'v2',
      toolCalls: [{ name: 'find_trains', input: { from: 'NYP', to: 'BOS', date: 'bad' }, error: 'bad date' }],
    },
    latencyMs: 1,
  })
  assert.deepEqual(m.tool_calls, [{ name: 'find_trains', input: { from: 'NYP', to: 'BOS', date: 'bad' }, error: 'bad date' }])
})
