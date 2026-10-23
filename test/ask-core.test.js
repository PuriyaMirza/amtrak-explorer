import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  askQuestion,
  MODEL,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  SEARCH_TOOL,
  MAX_ROUNDS,
} from '../ask-core.js'
import { fakeAnthropic, fakeSql, toolUseResponse, textResponse } from './helpers.js'

const BOSTON_STATIONS = [
  { stop_id: 'BOS', stop_name: 'Boston', stop_timezone: 'America/New_York', routes: ['Acela'] },
]
const BOSTON_ROUTES = [{ route_long_name: 'Acela', stops: ['Boston', 'New Haven'] }]

test('constants: model is pinned and prompt version starts at v1', () => {
  assert.equal(MODEL, 'claude-sonnet-5-5')
  assert.equal(PROMPT_VERSION, 'v1')
})

test('tool_use then text: runs the real query and returns the full result shape', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston'), textResponse('The Acela serves Boston.')])
  const sql = fakeSql({ stations: BOSTON_STATIONS, routes: BOSTON_ROUTES })

  const result = await askQuestion({ anthropic, sql, question: 'What serves Boston?' })

  assert.equal(result.answer, 'The Acela serves Boston.')
  assert.equal(result.rounds, 2)
  assert.equal(result.model, MODEL)
  assert.equal(result.promptVersion, PROMPT_VERSION)
  // Tokens are summed across both rounds.
  assert.deepEqual(result.usage, { input_tokens: 250, output_tokens: 50 })

  // toolCalls records the tool name (needed for the toolCalled eval check),
  // the query, and the rows we sent back.
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].name, 'search_trains')
  assert.equal(result.toolCalls[0].query, 'boston')
  assert.deepEqual(result.toolCalls[0].result.stations, [
    { id: 'BOS', name: 'Boston', timezone: 'America/New_York', routes: ['Acela'] },
  ])
  assert.deepEqual(result.toolCalls[0].result.routes, [
    { name: 'Acela', stops: ['Boston', 'New Haven'] },
  ])

  // The database was queried with the model's search text as a bound parameter.
  assert.equal(sql.calls.length, 2)
  assert.ok(sql.calls.every((c) => c.values.includes('%boston%')))
})

test('the first request carries the pinned model, system prompt and tool', async () => {
  const anthropic = fakeAnthropic([textResponse('hi')])
  await askQuestion({ anthropic, sql: fakeSql(), question: 'hello' })

  const [req] = anthropic.calls
  assert.equal(req.model, MODEL)
  assert.equal(req.system, SYSTEM_PROMPT)
  assert.deepEqual(req.tools, [SEARCH_TOOL])
  assert.deepEqual(req.messages, [{ role: 'user', content: 'hello' }])
})

test('the second request sends the real rows back as a tool_result', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston', { id: 'tu_42' }), textResponse('ok')])
  const sql = fakeSql({ stations: BOSTON_STATIONS, routes: BOSTON_ROUTES })
  await askQuestion({ anthropic, sql, question: 'q' })

  const second = anthropic.calls[1].messages
  const last = second[second.length - 1]
  assert.equal(last.role, 'user')
  assert.equal(last.content[0].type, 'tool_result')
  assert.equal(last.content[0].tool_use_id, 'tu_42')
  assert.match(last.content[0].content, /Acela/)
})

test('no tool use: answers in one round with no tool calls', async () => {
  const anthropic = fakeAnthropic([textResponse('Just text.')])
  const result = await askQuestion({ anthropic, sql: fakeSql(), question: 'hi' })
  assert.equal(result.rounds, 1)
  assert.deepEqual(result.toolCalls, [])
  assert.equal(result.answer, 'Just text.')
})

test('a failing query is reported to the model and recorded, not thrown', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston'), textResponse('Sorry, lookup failed.')])
  const sql = fakeSql({ fail: 'db down' })

  const result = await askQuestion({ anthropic, sql, question: 'q' })

  assert.equal(result.answer, 'Sorry, lookup failed.')
  assert.equal(result.toolCalls[0].name, 'search_trains')
  assert.equal(result.toolCalls[0].error, 'db down')
  const last = anthropic.calls[1].messages.at(-1)
  assert.match(last.content[0].content, /db down/)
})

test('stops after MAX_ROUNDS if the model keeps asking for the tool', async () => {
  const responses = Array.from({ length: MAX_ROUNDS }, (_, i) =>
    toolUseResponse('boston', { id: `tu_${i}` }),
  )
  const anthropic = fakeAnthropic(responses)
  const result = await askQuestion({ anthropic, sql: fakeSql({ stations: [], routes: [] }), question: 'q' })

  assert.equal(result.rounds, MAX_ROUNDS)
  assert.equal(anthropic.calls.length, MAX_ROUNDS)
  // No text from the model, so the fallback message is used.
  assert.match(result.answer, /try rephrasing/)
})

test('missing usage from the API counts as zero instead of crashing', async () => {
  const anthropic = fakeAnthropic([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }])
  const result = await askQuestion({ anthropic, sql: fakeSql(), question: 'q' })
  assert.deepEqual(result.usage, { input_tokens: 0, output_tokens: 0 })
})

test('multiple text blocks are joined and trimmed', async () => {
  const anthropic = fakeAnthropic([
    {
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: '  Part one.' },
        { type: 'text', text: 'Part two.  ' },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  ])
  const result = await askQuestion({ anthropic, sql: fakeSql(), question: 'q' })
  assert.equal(result.answer, 'Part one.\nPart two.')
})
